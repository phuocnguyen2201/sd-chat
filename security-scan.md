# Security Scan

## 2026-10-09 — #9 and #12: fixed in code, not yet applied to the live project

**Live check first.** #9 was thought to be resolved, but it is not. The live `conversation_participants` policies (read via `supabase db query --linked`, 2026-10-09) are still `true` for SELECT, INSERT, UPDATE and DELETE. No migration in the repo touched them.

- **#9 — migration written and tested in a rolled-back transaction, not applied.** `supabase/migrations/20261009000000_conversation_participants_rls.sql`:
  - SELECT: members of the conversation only (`is_conversation_member`, SECURITY DEFINER, pinned `search_path`).
  - INSERT: no policy and no grant. Rows come only from the creation RPCs, which run as `postgres` and bypass RLS (checked live).
  - UPDATE: column grant limited to `wrapped_key`, `key_nonce`, `other_party_pub_key`. A user can always update their own row. Another member's row only while its `wrapped_key` is empty (the backfill and group-creation paths). Overwriting an existing key is refused.
  - DELETE: own row only.
  - Test (inside a transaction that ends in `RAISE EXCEPTION`, so it rolls back): outsider SELECT 0 rows, outsider INSERT/UPDATE/DELETE refused, member can't overwrite another member's key, can't change `user_id`, can't delete another member's row, can fill an empty row, and can update its own row. All as expected.
  - Client paths checked: `storeConversationKey` (own row, or a fresh group's rows, which are created empty), `fillMissingConversationKey` (fill-only), `leaveConversation` (own row). No client-side INSERT exists.
- **#12 — code changed, not deployed.** `supabase/functions/delete-account/index.ts` no longer deletes whole conversations. It removes only the caller's participant rows. A conversation is deleted only when nobody is left in it. DMs the caller created get `created_by` cleared, which is safe because DM key lookup doesn't read it. **Open decision:** a group the caller created that still has other members is refused with a 409, before anything changes. Clearing that group's `created_by` would break key lookup for every remaining member (`findKeyWrapperPeerId`). The client currently shows a generic failure for this case. Deno isn't installed here, so the function hasn't been type-checked.

| # | Status (2026-10-09) |
|---|---|
| 9 | 🟡 Migration written and tested (rolled back), **not applied to the live project**. Live policies still open as of this check. |
| 12 | 🟡 Code changed, **not deployed**. The group-creator case needs a decision (see above). |

## 2026-09-29 — Fixes for #5, #7, #8a, #8b (code only, not deployed/tested on device)

Implemented the three remaining findings from the 2026-09-26 manual white-box review pass, each as its own commit on its own local branch, not pushed to GitHub and not merged into `main` yet:

- `security/attachment-encryption` (#5)
- `security/peer-key-pinning` (#7)
- `security/key-import-and-hkdf` (#8a, #8b)

**Method:** code changes only, following the existing envelope-encryption/ECDH patterns already in `secured.ts`. Nothing was run against the live Supabase project for this pass (no live checks, no on-device test) - see "Pending" under each item below.

| # | Fix | Where | Status |
|---|---|---|---|
| 5 | **Attachments are now end-to-end encrypted.** A random per-file key seals the raw bytes with ChaCha20-Poly1305 before upload; only ciphertext reaches storage, under an opaque uuid path instead of a filename-derived one. The filename/mime/size/per-file-key travel inside an encrypted descriptor stored in the message's existing `content`/`nonce`/`wrapped_key`/`key_nonce` columns (no schema change). New `EncryptedAttachment` component decrypts to a local temp file for display (images) or share (files, via `expo-sharing`). | `utility/securedMessage/secured.ts` (`encryptAttachment`/`decryptAttachment`), `utility/handleStorage.ts`, `components/EncryptedAttachment.tsx` | 🟡 **Fixed in code (2026-09-29), not deployed/tested.** `expo-sharing` is a new native dependency - needs a dev-client rebuild before this branch can be tested at all. Attachments uploaded before this change stay plaintext in the buckets. Storage-bucket RLS itself (#10) is unchanged and still lets any authenticated user read any object in `chat-files`/`storage-msg` - it just now only ever contains ciphertext. |
| 7 | **Peer public keys are now pinned (trust-on-first-use).** The first key seen for a peer is pinned in SecureStore; a later unwrap with a different key returns `peer_key_changed` instead of being silently trusted/cached, and UI code (`resolveConversationKeyInteractive`) blocks with a confirmation dialog before trusting the change. The unauthenticated `public_key` notification route param is no longer fed into the resolver as a trust input. | `utility/securedMessage/PeerKeyPins.ts` (new), `utility/securedMessage/ConversationKeyResolver.ts`, `app/tabs/(tabs)/Chat.tsx`, `app/tabs/msg/[room_id].tsx` | 🟡 **Fixed in code (2026-09-29), not deployed/tested.** No live/on-device verification yet. Known limitation: TOFU trusts whatever key a new device first sees - inherent to the pattern, still a real improvement over unconditional trust on every use. |
| 8a | **`ScanningKeys` now verifies a scanned key before installing it,** using the account's advertised `profiles.public_key` (mirrors `VaultBackup.recoverIdentityKey`'s existing `IdentityMismatchError` check, which already existed but wasn't reused here). Extracted as `ScannedKeyVerification.verifyScannedIdentityKey`. | `app/tabs/managekeys/ScanningKeys.tsx`, `utility/securedMessage/ScannedKeyVerification.ts` (new) | ✅ **Fixed in code (2026-09-29), unit-tested.** Not tested on-device yet. |
| 8b | **The hand-rolled HKDF is replaced** with RFC-5869 HKDF via `@noble/hashes` (already a dependency). "Write new, read both": new wraps/seals use the correct derivation immediately; unwrapping tries it first and falls back to the old derivation (kept as `legacyKdfSha512`) so every key already wrapped in the database keeps opening - no migration needed. | `utility/securedMessage/secured.ts` (`hkdfSha512`, `legacyKdfSha512`, `unwrapConversationKey`, `ecdhOpen`) | ✅ **Fixed in code (2026-09-29), unit-tested** (round trip on the new derivation, legacy-wrapped data still opens, wrong key still throws). Not tested on-device yet. |
| 8c | **Deferred.** No per-sender authentication within a conversation - all participants share one symmetric key, so an AEAD tag proves "some group member sent this," not which one. Fixing this needs a per-user signing keypair (distributed and pinned - depends on #7), new message columns, and re-signing on forward/edit: a much larger change than this Low-severity finding's other parts warranted on their own. Documented as a known limitation in `ConversationKeyManagement.ts`. | `utility/securedMessage/ConversationKeyManagement.ts` (docstring) | 🔴 **Open by design (deferred).** Tracked here as a follow-up, not silently dropped. |

**Also fixed (test infra, not a security finding):** the project's Jest config couldn't run any crypto unit test at all - `@stablelib/chacha20poly1305` and `expo-modules-core` ship ESM/TS sources outside jest-expo's default `transformIgnorePatterns`, and `jest-expo` now needs `@react-native/jest-preset` as an explicit peer dependency it wasn't declaring. Fixed on all three branches so `npx jest utility/securedMessage --watchAll=false` actually runs (62 tests total across the three branches, all passing).

**Pending before any of this is real protection:** apply each branch (they're not merged into `main`), rebuild the dev client for `expo-file-system`/`expo-sharing` before testing `security/attachment-encryption`, and do the live/on-device verification passes 1-3 did for earlier fixes. See `need-action.md`.

## 2026-09-28 — Status update after the manual steps (checked live, read-only)

The user completed every step in need-action.md. Checked live: the trigger is applied (#16, #17), `push` v37 + Vault secret + `notify_push` trigger (#3), `device-pairing` v8 (#6), `delete-account` deployed, `.env` on the publishable key (#15, #1), and the probe users are deleted. Dashboard settings and key rotation are recorded as reported, since SQL can't see them.

**Still open:** **#12 is now live in production** (deploying `delete-account` shipped the whole-conversation wipe). #9 (`conversation_participants` still fully open), #10, #11, #13, #14 (leaked-password protection off). #4 is fixed in code (sealed QR); the migration and the `device-pairing` deploy are pending.

## 2026-09-28 (pass 3) — Email confirmation flow (following Strix `find-security-vulnerabilities-in-code`)

Scope: "Confirm email" (now ON), the new browser confirmation page `confirm-page/`, the `handle_new_user` trigger, `authAPI.signUp`, `app/login.tsx`, the Maestro confirmation script. Method: trust-boundary and data-flow review, plus live checks against project `kblseanmnntpxqzgmsho`:
- two real probe sign-ups to mail.tm inboxes, confirmed by `maestro/scripts/confirm-email.js`
- the trigger run against the live schema inside a rolled-back transaction
- the verify endpoint called with a bogus token (403 `otp_expired`)
- the page loaded in headless Chrome (no CSP violations, token stripped, no auto-verify)

Strix itself was not run (no Docker or LLM key), same as passes 1–2.

### Design decision: confirm in the browser, not through a deep link
The link opens `confirm-page/` in the browser and the user logs in afterwards. There is no redirect back into the app. This removes custom-scheme interception entirely: the app's scheme is the generic `starterkitexpo`, so any app built from the same starter template could register it and receive tokens.

| # | Risk in a browser confirmation page | Mitigation | Status |
|---|---|---|---|
| R1 | Supabase's default link redirects to the Site URL with a live access and refresh token in the URL fragment. **Seen live:** the first probe (logout bug in the script) left a session with a live refresh token. | Email template links straight to the page with `token_hash`. The page calls `verifyOtp` then `signOut()` (revokes the session), with `persistSession: false`. Second probe: 0 sessions, 0 live refresh tokens. |  ✅ Live: template changed (reported by the user, 2026-09-28) |
| R2 | Mail scanners (Safe Links etc.) prefetch the link and burn the one-time token. | Nothing happens on load; `verifyOtp` only runs on a button tap. | ✅ |
| R3 | Redirect allowlist wildcards (e.g. `https://*.vercel.app/**`) let a third party receive tokens. | Site URL = the exact page URL; Redirect URLs = that exact URL only; the app sends no `emailRedirectTo`. |  ✅ Done (reported by the user, 2026-09-28; not visible through SQL) |
| R4 | `token_hash` leaking through Referer or third-party scripts. | No third-party resources (supabase-js 2.89.0 is vendored), `no-referrer`, CSP `default-src 'none'; script-src 'self'; connect-src <project>`. The token is removed from the address bar with `history.replaceState` on load. | ✅ |
| R5 | Domain takeover of an abandoned page URL. | Host on a domain you keep. If retired, remove it from the URL config. |  ✅ Hosted (reported by the user, 2026-09-28) |
| R6 | Phishing habit. | The page never asks for a password or email and shows no server error text or account data. | ✅ |
| R7 | Account enumeration through sign-up. | Same message for new and existing emails. No private key is stored for Supabase's obfuscated user (`identities: []`). The username collision oracle is closed (#17). | ✅ |
| R8 | Email bombing through resend. | 60 s UI cooldown; `max_frequency = 60s` (config.toml; set the same in the dashboard). |  ✅ Done (UI cooldown in code; dashboard interval reported by the user) |
| R9 | Anon (publishable) key on a public page. | Already public in the app. RLS is the guard, so #9–#11 still matter most. | n/a |

### New findings (pass 3)
| # | Severity | Issue | Where | Status |
|---|---|---|---|---|
| 15 | **Critical** | **The local `.env` gives the app's main client a secret key.** `EXPO_PUBLIC_SUPABASE_KEY` starts with `sb_secret_`. `eas.json` and CI use a publishable key, but every local build (`expo run:*`, the `build-*.apk` files) bundles a key that bypasses all RLS. It also hides RLS bugs in local testing: the broken sign-up (#16) would have "worked" locally. | `.env` (gitignored; not in git history: `git log -S` only matches doc text) |  ✅ **Resolved (2026-09-28).** `.env` now uses the publishable key (checked). Rotation reported by the user. |
| 16 | High (availability) | **Sign-up broke once "Confirm email" was turned on.** `signUp` returns no session, so the app's `profiles` insert fails RLS (`auth.uid() = id`). The user sees an error although the account exists and the email was sent. Confirmed live: the probe users have no profile. | `utility/messages.ts` (old `signUp`) |  ✅ **Resolved (2026-09-28, checked live).** The trigger `on_auth_user_created → handle_new_user` is applied; EXECUTE only for postgres and service_role. |
| 17 | Medium | **Username collision fails sign-up and leaks existence.** `profiles.username` is `UNIQUE` and derived from the email's local part, so `john@a.com` then `john@b.com` failed. With the trigger, that would be a 500 "Database error saving new user", an oracle for whether a local part is taken. | `profiles_username_key` |  ✅ **Resolved (2026-09-28, checked live).** The deployed function contains the collision fallback and the key-format check. |
| 18 | Low | **Email local parts are world-readable.** `username` = the email local part, and `profiles` SELECT is `true`, so every user can list other users' email prefixes (helps targeting and phishing). | live `profiles` RLS | 🔴 **Open** (pre-existing behaviour kept). Consider a random or user-chosen handle, or fold into #13. |
| 19 | Info | Live password policy is lower + upper + digit + symbol. The client now checks the same rules on sign-up, with readable messages. `minimum_password_length` is 8 in config.toml; check that the dashboard matches. | `app/login.tsx`, `supabase/config.toml` | ✅ |

~~Left in the live project by this pass: two probe users~~ **Deleted by the user (checked 2026-09-28).** Separately, one legacy user (created 2026-01-14) has no profile row. It predates the trigger; note only.

## 2026-09-26 (pass 2) — Re-scan after commit `755073d`, with live Supabase checks

**Method:** The same Strix method (`find-security-vulnerabilities-in-code`), done by hand again. Strix is installed (`~/.strix/bin/strix`), but it couldn't run locally: Docker isn't running and no LLM key is set. This time the Supabase MCP was connected, so the live project (`kblseanmnntpxqzgmsho`) was inspected read-only: RLS policies, RPC bodies and grants, storage buckets and policies, foreign keys, deployed Edge Functions and the security advisors. That closes the "RLS and RPC not covered" gap from pass 1.

**Verification:** Nothing was exploited and nothing was written to the database. The live checks confirm the policies are configured as described below, but no attack was actually run. The code has not changed since pass 1 except for `755073d`, so #3–#8 were re-checked against the same code.

**Live state of the #1/#2 fixes:**
- `messages_delete_own` **is applied**, so #2 is resolved.
- `delete-account` is **not deployed**. Only `push` (v35) and `device-pairing` (v5) exist. Account deletion in current builds calls a function that doesn't exist, so it fails.
- The service key hasn't been rotated, and the local tag `stale-dark-mode-ee561d1` still exists.

### New findings (pass 2)

| # | Severity | Issue | Where | Status |
|---|---|---|---|---|
| 9 | **Critical** | **Any signed-up user can join any conversation and get its decryption key.** Every `conversation_participants` policy for `authenticated` is `true`: SELECT, INSERT, UPDATE and DELETE. The attack: (1) SELECT lists every conversation id and its members. (2) The attacker INSERTs a row for themselves, with no `wrapped_key`. (3) The next time a real member opens the chat, `backfillMissingWrappedKeys` sees the empty row and wraps the conversation key for the attacker's public key. (4) The attacker now meets the `messages` SELECT policy and can decrypt the full history and everything after it. Signup is open with no email confirmation, so anyone can do this. UPDATE also lets anyone overwrite another member's `wrapped_key` / `other_party_pub_key` (key substitution), and DELETE lets anyone remove anyone from any chat. **Fix:** SELECT only for rows in conversations you belong to. INSERT only through the RPCs (or `user_id = auth.uid()` plus creator checks). UPDATE only on your own row, or only the key columns of rows in a conversation you're in. DELETE only your own row. | live RLS on `conversation_participants`; `utility/securedMessage/ConversationKeyResolver.ts:104` |  🟡 **Fix written 2026-10-09** (migration `20261009000000_conversation_participants_rls.sql`, tested in a rolled-back transaction). **Not applied yet.** Live policies were still `true` on 2026-10-09. |
| 10 | High | **Every user can read, overwrite and delete every attachment and avatar.** The storage policies on `storage-msg`, `chat-files` and `avatars` only check `bucket_id`, for all four verbs. The `files`, `files_group` and `files_profiles` tables have an `ALL` policy of `true`, so any user can list every attachment's path, original filename and 365-day signed-URL token, and can edit or delete the rows. Attachments aren't E2E encrypted (#5), so this exposes the real files. **Fix:** scope object paths to the conversation (e.g. `<conversation_id>/…`) and check membership in the storage policy. Scope the `files*` policies through `messages` → `conversation_participants`. | live storage and `files*` RLS | 🔴 **Open** |
| 11 | High | **`create_conversation_with_participants` trusts the caller's `p_user_id` and can be called without signing in.** It is `SECURITY DEFINER`, `anon` and `authenticated` have EXECUTE, and it uses `p_user_id` as the creator and a member instead of `auth.uid()`. With just the public publishable key, anyone can create group chats "owned" by any user and put any users in them. **Fix:** use `auth.uid()`, reject a null caller, `REVOKE EXECUTE … FROM anon`, and set `search_path`. | live function `public.create_conversation_with_participants` (called from `utility/messages.ts:361`) |  🔴 **Open (re-checked 2026-09-28):** the advisor still flags anon EXECUTE on this function and on `create_dm_conversation`. |
| 12 | Medium | **`delete-account` deletes whole conversations for every member.** It deletes every conversation the caller was in, and `messages`, `reactions` and `files` cascade from `conversations`. So deleting your account wipes group chats and DMs for everyone else too. Combined with #9, any user could join any conversation and then delete their own account to destroy it. The function isn't deployed yet, so this is latent. **Fix:** delete only the caller's participant rows, and delete a conversation only when it has no members left. Fix #9 before deploying. | `supabase/functions/delete-account/index.ts:59-86` |  🔴 **Open, now LIVE (2026-09-28).** `delete-account` was deployed without this fix: any user who deletes their account wipes every shared conversation for all members. **Fix written 2026-10-09, not deployed.** Open decision: group creators (see the 2026-10-09 section). |
| 13 | Medium | **Too much metadata is readable by every user.** `profiles` SELECT is `true`, including `fcm_token` and `public_key`. `reactions` SELECT is `true` across all conversations, so anyone can see who reacted to which message, when. **Fix:** move `fcm_token` out of `profiles`, or expose profiles through a view without it. Scope `reactions` SELECT to conversation members. | live RLS on `profiles` and `reactions` | 🔴 **Open** |
| 14 | Low | **Supabase advisors:** 8 functions have a mutable `search_path`, which matters most for the `SECURITY DEFINER` ones (#11, `create_dm_conversation`, `messages_notify_new`). `messages_notify_new` (a trigger function) can be called by `authenticated`. Leaked-password protection (HaveIBeenPwned) is off. `device_pairing_requests` and `local_pairing_codes` have RLS with no policies, which is fine because only the Edge Function uses them. Separately, and not a security issue: `realtime.messages` has RLS on with no policies, so no client can join the private `user:<id>:notifications` channels that `messages_notify_new` sends to. | live advisors |  🔴 **Open (re-checked 2026-09-28):** still 8 functions with a mutable `search_path`; leaked-password protection still off (may need the Pro plan). |

### Pass 2 status summary
- **Resolved:** #2.
- **Partly fixed:** #1 (code only; rotation and deploy pending).
- **Fixed in code, not deployed:** #3, #6 (2026-09-27).
- **Open:** #4, #5, #7–#14. Suggested order: **#9** (critical, and #12 depends on it) → #10 → #11 → rotate the key and deploy `delete-account` after fixing #12 → #3 → #4.
- **Still not covered:** a dependency (SCA) scan, the gluestack UI components, and running Strix with a live sandbox (needs Docker and an LLM key, or `strix cloud`).

---

## 2026-09-26 — Manual white-box review (following Strix `find-security-vulnerabilities-in-code`)

**Method:** The review followed the method in `.agents/skills/find-security-vulnerabilities-in-code`: map the trust boundaries, trace data flow, and rank findings by what an attacker can actually reach. It was done by reading the code. Strix itself was not run.

**Verification:** Nothing was exploited live. Every finding is confirmed only by reading the code, with no working proof-of-concept. No code or config was changed.

### Findings

| # | Severity | Issue | Where | Status |
|---|---|---|---|---|
| 1 | **Critical** | **The service-role key ships inside every build.** `EXPO_PUBLIC_*` variables are inlined into the JS bundle, and this key (`sb_secret_…`) is set in `.env`, `eas.json` and the CI workflow. Anyone who unpacks the APK gets full access to the database, storage and admin auth. `eas.json` isn't gitignored and holds the key in plaintext. The key was also printed into the 2026-09-26 session transcript. **Rotate it.** | `utility/connection.ts:18` |  ✅ **Resolved (2026-09-28).** `.env` now holds the publishable key (checked), `delete-account` is deployed, the `stale-dark-mode-ee561d1` tag and old APKs are gone (checked). The user reports the key has been rotated; that isn't visible through SQL. |
| 2 | High | **Any user can delete any message.** `deleteMessage` uses the admin client with only a message id and no ownership check. | `utility/messages.ts:677` | ✅ **Resolved.** `deleteMessage` uses the user's session, and the live `messages_delete_own` policy (`sender_id = auth.uid()`) is applied (checked on the live DB). Still worth one on-device test. |
| 3 | High | **Anyone can send spoofed push notifications.** The function accepts any JWT, including the public anon/publishable key. It trusts `sender_id`, `conversation_id` and `content` from the request body, so an attacker can push any text under any sender name to members of any conversation. It also echoes the payload back and leaks the sender's public key. | `supabase/functions/push/index.ts:46-81` |  ✅ **Resolved (2026-09-28, checked live).** `push` v37 deployed with `verify_jwt=false`, Vault `push_webhook_secret` present, `messages` has only `push_notification → private.notify_push`, `preview_capable` column present. |
| 4 | High | **The key-sharing QR code is unencrypted.** It holds the identity private key and every conversation key in plaintext, so a photo of the screen within the 5-minute window exposes all messages. The ECDH seal helpers still exist in `secured.ts` but are unused. | `app/tabs/managekeys/ManageKeys.tsx:37`, `utility/securedMessage/KeySyncPayload.ts` |  🟡 **Fixed in code (2026-09-28), not deployed.** The new device creates a one-time X25519 key while entering the pairing code and sends the public half with `keyProof` = HMAC(code). The old device checks the proof against the code it displayed, then seals the payload (`DevicePairing.sealForPeer`), so the QR holds only ciphertext. Plaintext QRs are refused, and the server refuses `local-code-verify` without the key fields. 10 unit tests (round trip; another device's key, tampering, expiry and a wrong code/user/key all fail). Tested on an iOS simulator: code entry → scanner with the pairing check. Residual: a DB-level attacker could brute-force the 4-digit `code_hash` and swap the key; the pairing check on both screens covers it (same trust as #7). Pending: apply `20260928000100_local_pairing_ephemeral_key.sql`, deploy `device-pairing`, two-device test. |
| 5 | Medium | **Attachments are not end-to-end encrypted.** Images and files are uploaded raw, the filename goes into `messages.content` in plaintext, and signed URLs last 365 days with their tokens stored in the `files` table. | `utility/handleStorage.ts:19-44` | 🟡 **Fixed in code (2026-09-29, branch `security/attachment-encryption`), not deployed/tested.** See the 2026-09-29 entry above. |
| 6 | Medium | **The 4-digit local pairing code is enforced only in the client.** The server's `create` action never checks for a verified `local_pairing_codes` row. The 6-character confirm code is still the real gate. | `supabase/functions/device-pairing/index.ts:134` |  ✅ **Resolved on the server (2026-09-28).** `device-pairing` v8 deployed. The local QR gate is being fixed together with #4. |
| 7 | Medium | **Peer public keys are never verified.** Keys are read from `profiles.public_key` with no fingerprint or safety-number check, so whoever controls the database (or holds the leaked key) can swap keys and intercept new conversations. | `utility/securedMessage/ConversationKeyResolver.ts`, `secured.ts` | 🟡 **Fixed in code (2026-09-29, branch `security/peer-key-pinning`), not deployed/tested.** See the 2026-09-29 entry above. |
| 8 | Low | `ScanningKeys` overwrites the stored identity key without checking it against the profile. Messages aren't sender-authenticated within a conversation, because all participants share one symmetric key. The HKDF is hand-rolled. `minimum_password_length = 6` and `enable_confirmations = false` (**2026-09-28:** confirmations ON live, config.toml now 8 chars + character classes, see pass 3). The vault holds the HS256 JWT secret, which is already documented. | various | 🟡 **Parts a & b fixed in code (2026-09-29, branch `security/key-import-and-hkdf`), not deployed/tested; part c (no sender authentication) deferred by design.** See the 2026-09-29 entry above. |

### Looks solid
- **Vault service** (`sd-chat-vault/vault-service`): verifies JWTs locally, validates the UUID format before building file paths, and writes atomically.
- **`device-pairing` function:** single-attempt confirm, single-use fetch-and-delete, and rejection-sampled codes.
- **`key_backups` table:** RLS is scoped to the owner for all four verbs.

### Not covered
- *(Covered in pass 2 against the live DB; see #9–#14.)* **RLS and RPC SQL** for `profiles`, `conversations`, `conversation_participants`, `messages`, `files*`, `reactions` and the storage buckets. None of it is in the repo, so it couldn't be reviewed. Export it with `supabase db dump --schema public` and review it separately.
- **Dependencies:** no dependency (SCA) scan was run.
- **gluestack UI components** (`components/ui/`).

### Status
- **#1 fixed in code (2026-09-26), key not rotated yet.** `supabaseAdmin` and `EXPO_PUBLIC_SUPABASE_SERVICE_KEY` are gone from the app, `.env`, `eas.json` and the CI workflow. Account deletion now runs in the new `delete-account` Edge Function, which deletes whichever account the caller's JWT belongs to. `eas.json` was **not** gitignored after all: EAS needs it at build time, and what's left in it is `EXPO_PUBLIC_*` values that ship in the bundle anyway. Until the leaked key is revoked in the dashboard, every existing APK still leaks full access.
- **#2 fixed in code, policy not applied yet.** `deleteMessage` uses the user's session and fails when no row was deleted. The ownership check is the RLS policy in `supabase/migrations/20260926000000_messages_delete_own.sql`, which still has to be applied (check the existing `messages` policies first; the file says how). The chat screen now only removes a message from the list once the server delete succeeds.
- Git history: the key was committed in `ee561d1`, which was never pushed. It is only reachable from the local tag `stale-dark-mode-ee561d1`.
- **#3 fixed in code (2026-09-27), not deployed.** See the #3 row. Rollout: `supabase secrets set PUSH_WEBHOOK_SECRET`, `vault.create_secret(…, 'push_webhook_secret')`, deploy `push`, then apply `20260927000000_push_webhook_secret.sql` straight away.
- **#6 fixed in code (2026-09-27), not deployed.** See the #6 row; deploy with `supabase functions deploy device-pairing`.
- **#5, #7, #8a, #8b fixed in code (2026-09-29), each on its own unmerged branch** (`security/attachment-encryption`, `security/peer-key-pinning`, `security/key-import-and-hkdf`). See the 2026-09-29 entry at the top of this file. **#8c deferred by design.**
- Still open: 4 (deploy pending), 9-14 (see pass 2/3 above).
