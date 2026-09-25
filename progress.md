# Progress Log

## 2026-09-17 — Launch video (`/brag`), no app code touched

- Built a 23.8s vertical (1080x1920) launch video for SD Chat with the `brag` plugin + Hyperframes. Output lives in `brag-output/` (untracked; `composition/node_modules` is covered by the existing `node_modules/` ignore).
  - `brag-output/brag.mp4` — 4.4 MB, 30fps, h264 + aac, poster baked as frame 0
  - `brag-output/brag.jpg` — poster (the t=6.9s ciphertext beat)
  - `brag-output/brag-plan.md`, `composition-brief.md`, `share-copy.txt`, `composition/` (the Hyperframes project)
- Story: type + send a real message → cut to the ciphertext the Supabase row actually stores → the crypto stack (ChaCha20-Poly1305 / per-conversation keys / private key in Secure Store behind Face ID) → the device-pairing flow (`Share Keys` → 4-digit code + 30s TTL → `Receive Keys` → `Verify` → QR scan → paired) → logo. All on-screen copy is real app copy; colours are the real palette (`#2563EB` sent bubble — one step darker than the app's `bg-blue-500` so the render passes the WCAG AA gate — `#E5E7EB` received, lime `#CAF020` sampled from `assets/images/icon.png`), and the mono face is the project's own `SpaceMono-Regular.ttf`.
- `npx hyperframes check` passes clean: 0 lint / runtime / motion errors, 37/37 WCAG AA text checks.
- Toolchain note for re-rendering: Homebrew has **no bottles for this macOS/Intel combo** and started compiling ffmpeg's ~90 deps from source (hours). Switched to npm `ffmpeg-static` + `ffprobe-static`, symlinked at `brag-output/composition/.bin/`. Re-render with:
  `cd brag-output/composition && PATH="$PWD/.bin:$PATH" npx hyperframes render --quality looks --output ../brag.mp4`
- Installed as a side effect: the `brag` plugin (`/plugin`) and the Hyperframes AI skills into `~/.claude/skills/` (`npx hyperframes skills`). No app source, Supabase schema, or documentation was modified.

## 2026-09-11 — Secure device-to-device key sync (commit `c7ad612`)

- Replaced the old single-QR plaintext key transfer (`ManageKeys`/`ScanningKeys`) with a two-QR ephemeral ECDH handshake: X25519 + HKDF-SHA512 + ChaCha20-Poly1305 (`utility/securedMessage/secured.ts`: `generateEphemeralKeyPair`, `ecdhSeal`, `ecdhOpen`). A bystander who photographs either QR now gets either a bare ephemeral public key or AEAD ciphertext — never a usable private key.
- Added `utility/securedMessage/DevicePairing.ts` — in-memory ephemeral key state + seal/unwrap for the local (camera/QR) pairing transport.
- Added a server-relayed alternative transport for devices that aren't physically together: `supabase/functions/device-pairing/index.ts` (create/status/approve/confirm/fetch-key/cancel actions), backed by new `devices` and `device_pairing_requests` tables (SQL run manually against Supabase — not yet tracked under `supabase/migrations/`, see in-progress.md). Client side: `utility/securedMessage/RemoteDevicePairing.ts` + `utility/securedMessage/DeviceIdentity.ts`.
- Factored the shared "gather this device's private key + conversation keys" logic into `utility/securedMessage/KeySyncPayload.ts` (used by both transports).
- Removed the broken, unwired `identityCode` edge function stub.
- Updated `documentation/app/README.md`, `documentation/app/tabs/managekeys/*.md`, `documentation/supabase/README.md`, `documentation/utility/README.md` to match.
- Flagged but deliberately **not fixed**: `utility/connection.ts` exports a `supabaseAdmin` client built from `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`, which Expo inlines into the shipped client bundle — the service-role key (bypasses RLS) is extractable from the compiled app, and is actively used for account/message deletion. User said to leave it for now, address later.

## 2026-09-15

- Briefed the user on the current device-pairing implementation (no code changes this session yet).
- Designed and implemented a new local (same-room) pairing gate in front of the existing QR handshake:
  - SQL: `local_pairing_codes` table + RLS (no client-facing policies, same rationale as `device_pairing_requests`) — applied by the user directly against Supabase.
  - Edge function: added `local-code-create` / `local-code-status` / `local-code-verify` / `local-code-cancel` actions to `supabase/functions/device-pairing/index.ts`. 4-digit code via unbiased rejection-sampled RNG (not `% 10`, which would be biased since 256 isn't a multiple of 10). Code TTL (3 min) is deliberately shorter than the 5-attempt lockout (5 min), so a lockout clearing never grants a second batch of guesses against the same code — a fresh code is always required, capping total guesses per code at 5.
  - Factored the shared Edge-Function caller out of `RemoteDevicePairing.ts` into `utility/securedMessage/DevicePairingFunctionClient.ts` (now used by both the remote and local-code flows).
  - New client module `utility/securedMessage/LocalPairingCode.ts`.
  - New screens: `app/tabs/managekeys/PairingCode.tsx` (old device: shows the code, polls for verification, Cancel button) and `app/tabs/managekeys/EnterPairingCode.tsx` (new device: code entry, attempts-remaining/lockout messaging).
  - Rewired `ManageKeys.tsx`: "Share Keys" now goes through `PairingCode` first (auto-resumes the existing QR flow via an `autoShare=1` param once verified); "Receive Keys" now goes through `EnterPairingCode` first, then the existing `ScanningKeys`. The underlying QR/ECDH handshake itself is unchanged.
  - Manually patched `.expo/types/router.d.ts` (gitignored, regenerated by the Expo dev server) to add the two new routes so `tsc` type-checks cleanly without a running dev server.

## 2026-09-16 — Removed two-QR handshake from key sharing; added Delete Chat (commit `4e02cce`)

- **Security regression (deliberate, by user):** `ManageKeys`/`ScanningKeys` no longer run the ephemeral-ECDH two-QR handshake (`utility/securedMessage/DevicePairing.ts`). `ManageKeys` now renders the `KeyObject` payload — including the plaintext private key — directly as a single QR (`shareKeys()`), same as the pre-`c7ad612` behavior, except it's still gated by the `PairingCode`/`EnterPairingCode` same-room 4-digit code screens from the 2026-09-15 session. `ScanningKeys` correspondingly dropped its own-ephemeral-key/second-scan step down to one `scan` phase that imports the QR's `KeyObject` directly (added a `validTime` expiry check that the old sealed-flow didn't need but the new plaintext one does). `DevicePairing.ts` is now dead code — nothing imports it.
- Added "Delete chat": long-press a conversation row in `Chat.tsx` to reveal an inline "Delete chat" action; confirms via `AlertDialog`, then calls a new `conversationAPI.leaveConversation()` (`utility/messages.ts`) that deletes only the current user's `conversation_participants` row (leave-for-me, not delete-for-everyone), clears the cached conversation key, and deletes the local snapshot. New automation locator `deleteChatButton`.
- Updated documentation to match: rewrote `documentation/app/tabs/managekeys/ManageKeys.md` / `ScanningKeys.md`, added `PairingCode.md` / `EnterPairingCode.md` (these two screens, added 2026-09-15, had never been documented until now), updated `documentation/app/README.md` (route map + caveats), `documentation/utility/README.md` (module list, marked `DevicePairing.ts` unused, documented `LocalPairingCode.ts`/`DevicePairingFunctionClient.ts`/`leaveConversation()`), and `documentation/supabase/README.md` (`local-code-*` actions, `local_pairing_codes` schema).

## 2026-09-17 — Fixed QR key-sync scanning (camera never detected the code)

**Symptom:** on the receiving device the camera preview opened and ran live, but no QR was ever detected — silently, with no error, no warning and nothing in `adb logcat`. Verified on real devices, both Android and iOS.

- **Root cause was the QR generator, not the scanner.** `react-native-qrcode-svg` defaults to **`quietZone = 0`**, so the code was rendered with no margin. The QR spec requires a quiet zone of ≥4 modules for decoders to locate the finder patterns. The wrapping `Box` in `ManageKeys.tsx` had a border and padding but **no background colour**, and that screen's `ScrollView` (unlike `ScanningKeys.tsx`) has no `bg-white dark:bg-black`, so in **dark mode** the library's 200×200 white square sat flush against a dark background. Result: a code that looks perfect to a human and is undecodable by any scanner. It would have worked in light mode, which is likely why it appeared to "work before".
- Fix in `ManageKeys.tsx`: `quietZone={16}`, `size` 200 → 260, and `bg-white` on the QR container so the margin is genuinely white in both themes. Size matters too — the 558-char payload at the default `ecl="M"` is a ~77×77-module code, which at 200dp is only ~2.6dp per module.
- `components/QrScannerView.tsx`: added `autofocus="on"`. `expo-camera` internally does `newProps.autoFocus = props?.autofocus ?? 'off'`, so without it the camera runs with focus **locked** — a real problem for a dense code at close range.
- `components/QrScannerView.tsx`: wrapped the preview in a themed border (`border-gray-300` / `dark:border-gray-600`, `rounded-2xl`, inset `p-1`, camera radius 12 nested inside the outer 16). `CameraView` is a native component and isn't wired into NativeWind here, so the wrapper `Box` is what makes `dark:` classes work.
- **Ruled out along the way** (recorded so it isn't re-investigated): the JS callback chain `QrScannerView` → `CameraView.onBarcodeScanned` → expo's `_onObjectDetected` wrapper → `onScanned` → `onScannedCode` is correct at every hop; MLKit *is* compiled into the build (`barcodeScannerEnabled: true` in the `expo-camera` config plugin, and the native "Barcode scanning has been disabled" warning never appeared); a fresh EAS development build did not help; and the scanning code has been structurally unchanged since it was first added in `0378fdc`, so there was no "last known good" commit to revert to. The decisive clue was that Google's standalone Code Scanner (`CameraView.launchScanner()`), a completely separate native implementation, failed on the same code — which pointed at the QR rather than the scanner.
- `eas.json`: split the simulator-only config into its own `development-simulator` profile. The `development` profile had `ios.simulator: true`, which produces a build that cannot install on a physical iPhone (and couldn't drive a real camera anyway). Also added an `env` block to `development` — `.env` is gitignored, so EAS **cloud** builds never received `EXPO_PUBLIC_*` vars; only `production` had them inline.
- Noted but not changed: `.env` spells the pairing URL `EXPO_PUBLIC_PAIRTING_KEY_URL` (typo) while `eas.json` spells it `EXPO_PUBLIC_PAIRING_KEY_URL`. No code references either yet, so it is not an active bug. **Fixed 2026-09-24:** `.env` now uses `EXPO_PUBLIC_PAIRING_KEY_URL`.
- Git housekeeping: cleared a stale, half-finished interactive rebase left in `.git/rebase-merge` (started months earlier, when `main` was at `ee561d1` "Update dark mode"). Used `git rebase --quit`, **not** `--abort`, since abort would have reset `main` back to `ee561d1` and dropped the scanner commit. `ee561d1` is on no branch; it is now tagged `stale-dark-mode-ee561d1`, and its contents (`isDarkMode`/`fetchThemeMode` in `SessionProvider.tsx`, `tailwind.config.js`) are already present in `main` by another route. Local `main` was then rebased onto `origin/main` to resolve a 1-ahead/1-behind divergence with `36ca6ab`.


## 2026-09-17 (session 2) — Maestro coverage audit + 6 new flows

- **Audited every feature against `maestro/`** (15 existing flows, no subdirs, no config file). Classified each feature by what automation it actually needs:
  - Most of the app is single-device testable; ~8 of the 15 existing flows silently depend on a hand-seeded peer account (`"Android Simulator"`) plus an existing `"Testing message"` in that DM.
  - **Only one feature family genuinely requires two devices: the key-sync QR handshake** (`PairingCode` → `ManageKeys` → `EnterPairingCode` → `ScanningKeys`). And even with two devices Maestro cannot drive it — device B's camera must physically see device A's screen. Two emulators don't help (the emulator's virtual-scene camera only shows a static wall image; the QR is generated per session).
  - Realtime delivery and push notifications need a *second actor*, not a second device — Maestro's `runScript` JS has an `http` object, so the peer can be driven against Supabase REST/Edge Functions from inside a flow.
  - `PairingCode` (generate/countdown/expire/regenerate/cancel) and **all** `EnterPairingCode` failure paths (wrong code → attempts remaining, 5 wrong → lockout, cancel) are **fully single-device testable** — `EnterPairingCode` self-registers via `DeviceIdentity.registerCurrentDevice()` at line 36, so no peer is needed.
  - `ManageKeys`' QR render / 30s TTL / expiry could be reached single-device via a deep link (`starterkitexpo://tabs/managekeys/ManageKeys?autoShare=1`) — the scheme is `starterkitexpo` (`app.json:8`), not the bundle id.
- **Found: `BiometricAuthentication.tsx:62` — the button labelled "Back" calls `router.push('/tabs/managekeys/ManageKeys')`, i.e. it navigates *forward*, straight past the biometric gate.** Useful as an automation bypass, but it means the gate isn't a gate. Not changed — flagged for a decision.
- **Added 6 Maestro flows** covering the gaps (all YAML-validated):
  - `create-group-chat.yaml` — "+" → CreateGroupChat modal → select recipient → `Create Group (1)`. Note `createGroupChat()` pushes straight into the new room, so the flow ends inside the conversation.
  - `rename-group-chat.yaml` — creates a group first (the rename UI only renders when `isGroup`; a DM shows a read-only `<Heading>`), then Edit Chat Room → rename to `"QA Group Chat"` → Save.
  - `edit-message.yaml` — sends its own message, long-press → Edit → composer pre-fill → re-send → asserts the realtime UPDATE swap.
  - `delete-message.yaml` — sends its own message, exercises Cancel *and* Okay on the confirm dialog.
  - `delete-chat.yaml` — deliberately creates and deletes a throwaway group rather than the seeded DM, which would drop the `"Testing message"` history that `send-reaction`/`forward-message` assert on.
  - `delete-account.yaml` — registers a throwaway account inline (never touches the shared `${EMAIL}` fixture), skips biometrics, then Settings → Delete Account → Cancel → confirm → back to login.
- Conventions followed from the existing suite: text selectors are **full-match regex** (hence `.*Android Simulator.*`), `"Input Field"` is gluestack's accessibility label and matches even when the field holds a value (proven by `change-display-name.yaml`'s backspace loop), and `point:` selectors are reused where the existing flows already use them.

## 2026-09-17 (session 3) — Fixed cross-device "Key unwrapping failed" (conversation-key divergence)

**Symptom:** Android sends → Android reads fine, iOS shows `Key unwrapping failed` and the chat screen will not open. Send the other way and the roles swap. That flip-flop is the signature of the two devices holding **different conversation keys for the same conversation**, not a crypto bug — the error is thrown in `decryptMessage` (`secured.ts`) when the per-message key is unwrapped with the wrong conversation key.

**Root cause:** `handleUserPress` in `app/tabs/(tabs)/Chat.tsx` treated the `else` branch (the one that calls `conversationAPI.getOrCreateDM`) as "this is a new conversation" and unconditionally minted a fresh conversation key — overwriting the peer's `wrapped_key` row and this device's own stored key. But `create_dm_conversation` is **get-or-create** (`Returns: string`, see `utility/types/supabse.ts`): it hands back the existing conversation when there is one. The only guard was `verifyDMConversation`, which is fragile (reads the user from `AsyncStorage` rather than the session, and `get_conversation_between_users` is hand-applied SQL that is not in the generated types, so the assumed `data[0].conversation_id` shape is unverified). Every time that guard came back empty for an existing DM, the conversation was silently re-keyed.

The "Delete chat" feature added the day before (commit `4e02cce`) made this much easier to hit: `leaveConversation` hard-deletes the user's `conversation_participants` row — which is where their `wrapped_key` lives — so the conversation vanishes from the chat list, the only way back is the user-avatar list (`handleUserPress`), and with the participant row gone the guard cannot match.

**Changes:**
- `app/tabs/(tabs)/Chat.tsx`
  - `handleUserPress` now resolves the conversation id first, then resolves the key separately. A key is minted **only** when no key can be found anywhere.
  - Split the old `getConversationKeyForOtherParticipants` into `lookupConversationKey`, which returns `found` / `absent` / `failed`. The distinction is the point: `absent` (no wrapped row) may mint, `failed` (a wrapped key exists but will not open) must never mint, because minting over it locks the peer out of every message sent so far. `getConversationKeyForOtherParticipants` is kept as a thin `Uint8Array | null` wrapper for `handleConversationPress`.
  - New `createAndDistributeConversationKey` also wraps a copy of the key **for the minting user's own participant row**. Previously only the recipient got a row, so the creator's key existed solely in local Secure Store — a reinstall or a Delete chat made it unrecoverable.
  - Invariant now made explicit: `wrapConversationKey()` always wraps with the *local* device's private key, so every row's `other_party_pub_key` must be the **wrapper's own** public key. Group creation was storing each participant's *own* public key in their row instead of the creator's, which would make those rows unopenable.
  - Restored the group / 1-1 branching in `handleConversationPress` that commit `2b15f14` ("update the condition chain") flattened: dropping the `else` made the 1-1 logic run for group chats too and overwrite the creator's public key. That commit also changed `.filter(...)?.[0]?.profiles` to `.find(...)?.[0]?.profiles` — `find` returns the element, so `[0]` was always `undefined` and the group path resolved to `null` regardless. Both fixed.
  - Reordered the `!otherPublicKey` check so a locally stored key can still open a room when the public key is missing (the old code alerted after already having fetched the key).
- `utility/messages.ts` — `getWrappedKeyCurrent` now selects `other_party_pub_key` alongside `wrapped_key` / `key_nonce`. The column was already being written by `storeConversationKey` but never read, so callers were *guessing* the wrapping public key from the participants list. Now the row says which key opens it, and the guess is only a fallback for older rows.
- `app/tabs/msg/[room_id].tsx`
  - Unwrap now prefers `other_party_pub_key` from the row over the `public_key` route param (which is only set when the screen is reached from a notification).
  - Added `safeDecrypt`. `MessageEncryption.decryptMessage` was being called **directly inside render**, so one unreadable message threw during render and took the entire chat screen down — that is the "can't open the chat" half of the report. Failures now render `Message cannot be decrypted on this device` for that bubble only.

**Verification:** `npx tsc --noEmit` — app/utility errors went 6 → 5 (the removed one was a real `Uint8Array | null` argument error at the old render-time decrypt site). The remaining 5 are pre-existing and unrelated (gluestack `ColorValue`/icon prop typing, `MessageActionProps`, a `Message | undefined`). Not yet run on devices.

**Not fixed — existing broken conversations do not self-heal.** Any DM that was already re-keyed still has each device holding its own key in Secure Store, and the local cache wins over the database row by design (the minting device legitimately has no row of its own). Recovering a test conversation means clearing app storage on one device or starting a fresh conversation. An automatic reconciliation path would need a real key-rotation/re-share flow.

### Addendum — confirmed: the failing chat is a **group**, and `2b15f14` is the cause

Audited every SonarQube cleanup commit (`457af91` 2026-08-28 → `5b24186` 2026-09-10) by diffing the pre-spree tree (`6943923`) against `4e02cce` function by function. The spree touched the key path in exactly three places:
- `2b15f14` — `handleConversationPress`: dropped the `else` around the 1-1 branch and changed `.filter(...)?.[0]?.profiles` to `.find(...)?.[0]?.profiles`. **This is the regression.** Before it, groups resolved the creator's public key correctly; after it, `.find()` returns the element so `[0]` is `undefined`, and then the unconditional 1-1 branch overwrites the result with whichever of the first two participants isn't the current user. For a DM the behaviour is identical either way (`isGroup` is false, both versions take the same branch), which is why only group chats broke.
- `a1257f5` — `private static cache` → `private static readonly cache` in `ConversationKeyManager`. No behaviour change; readonly binds the reference, `.set()` still works.
- `f9b68e3` — `getPrivateKey()` rewritten to `?? ''` plus `return privateKey ?? privateKey`. Redundant but equivalent.

`handleUserPress`, `getConversationKeyForOtherParticipants`, `wrapConversationKey`, `unwrapConversationKey`, `hkdfSha512`, `encryptMessage`, `decryptMessage` and the room screen's `loadKey` were **not** semantically changed by the spree.

**Follow-up fixes made after confirming it was a group:**
- `lookupConversationKey` now tries **both** candidate public keys (the row's `other_party_pub_key`, then the caller's computed key) instead of trusting the row alone. This matters because `createGroupChat` used to record each participant's *own* public key in their row even though the creator's private key wrapped it — so preferring the row, as the first version of this fix did, would have stranded every group created before today. On success with the fallback the row is rewritten, so legacy rows repair themselves as members open the chat.
- `handleConversationPress` falls back to fetching the creator's public key from `profiles` when the creator is no longer in `conversation_participants` (they left the group), since their key is still what opens the row.

Still true: a group whose rows were written by the old code needs a member to open it once for the row to be corrected; nothing repairs a row for a member who never opens the chat.

### Addendum 2 — same fix applied to DMs; key resolution extracted to one module

The group bug and the DM gaps are the same mistake seen from two angles: **ECDH unwrapping must pair this device's private key with the *wrapper's* public key, never with this user's own.** Confirmed with the user that the design intent was "receiver decrypts with the receiver's public key", which cannot work - `DH(recv_priv, recv_pub)` is a secret the sender never computed. The wrap side was always correct (`sender_priv` + `receiver_pub`); only what the *receiving* side was handed had drifted.

- **New `utility/securedMessage/ConversationKeyResolver.ts`** - `resolveConversationKey(conversationId, userId, fallbackPublicKeys)`, the single implementation of cache → secure storage → wrapped participant row, with candidate retry (row's `other_party_pub_key` first, then whatever the caller believes the wrapper's key to be) and row self-repair when a fallback wins. Returns `found` / `absent` / `failed`.
- **`app/tabs/(tabs)/Chat.tsx`** now delegates to it; the in-component copy is gone.
- **`app/tabs/msg/[room_id].tsx`** now uses it too. Previously this screen had *none* of the above: it read the row once and unwrapped with `other_party_pub_key || public_key` (the notification route param) with no retry and no repair, so a DM opened from a push notification without that param, or with a stale row, simply failed. It also now distinguishes `absent` from `failed` in the message shown to the user.
- **DM public-key resolution hardened in `handleConversationPress`**: the participant-id array is filtered before querying `profiles` (it used to pass `undefined` when the other person had left, which `Delete chat` causes), and both branches now select the participant by "not me" rather than by a fixed index - previously, a DM where the other participant had left resolved to the *current user's own* public key, which can never unwrap.

Note for later: the diagnostic instrumentation (the `debugger` statements, the `[unwrapConversationKey]` log in `secured.ts`, and the `[handleConversationPress] could not resolve conversation key` log) is still in the tree and must come out before release.

### Addendum 3 — verified on device: fresh accounts work; legacy conversations do not

Tested on device 2026-09-17 with a **newly created pair of accounts**: sending and receiving works normally in both directions. That confirms the fixed key-resolution path is correct end to end.

A **pre-existing** group still fails with `no candidate public key could unwrap this row` — both ECDH candidates rejected. This is old data the client can no longer open, not a defect in the current logic. Recorded as an open edge case in in-progress.md with the ruled-out causes, the leading hypotheses (most likely: a keypair that changed after the conversation was created, which nothing in the app currently detects), what to capture when it reproduces, and three candidate remedies. Deferred by agreement rather than chased further.

The three diagnostic logs were switched to `JSON.stringify(..., null, 2)` because React Native's Metro console prints nested objects as `[Object]`, which was hiding every value that mattered.

## 2026-09-18 — Per-user key storage + identity-key guard at startup

Root cause of the "two different public keys on one device" class of failures: `profiles.public_key` is written **once** at sign-up (`INSERT` in `authAPI.signUp`, no `UPDATE` path exists anywhere), while the private key lived in a single unnamespaced Secure Store slot, `user_encryption_key`. One device could therefore only ever hold one identity key. Signing a second account in overwrote the first account's key — and `SessionProvider.logout()` never cleared Secure Store, so the key survived the account switch. Log back in as the first account and its profile still advertises the old public key while the device holds a different private one: a silent, permanent mismatch.

It stayed invisible because **the sender never unwraps its own conversation key** — it reads the plaintext from storage. Only the peer performs the ECDH, so a broken device looks healthy to its owner while everything it sends is unreadable to everyone else. Exactly the original "Android can read the chat, iOS can't" report.

### Changes
- **`utility/securedMessage/secured.ts`**
  - Identity key is now stored per user at `user_encryption_key_<userId>`; the old slot is kept as `LEGACY_USER_KEY_STORAGE` for adoption and is never written again.
  - `generateKeyPair()` **no longer persists**. At sign-up the account does not exist yet, so there is no id to file the key under; `login.tsx` now stores it with `setPrivateKey(userId, ...)` once sign-up returns the new user. A failed sign-up leaves nothing behind, so the two `deletePrivateKey()` cleanup calls were removed.
  - `getPrivateKey`, `setPrivateKey`, `deletePrivateKey`, `wrapConversationKey`, `unwrapConversationKey` all take a `userId`. Threaded through 10 call sites in 6 files; the compiler found every one.
  - New `derivePublicKey(userId)` and `verifyIdentityKey(userId, profilePublicKey) -> 'ok' | 'missing' | 'mismatch'`. `verifyIdentityKey` also performs the legacy migration, but **only adopts the old key when its derived public key matches the profile** — copying it blindly would cement another account's identity under this user, which is the very bug being fixed.
  - `deletePrivateKey` also clears the legacy slot, so a deleted account leaves nothing behind.
- **`utility/securedMessage/ConversationKeyManagement.ts`** — conversation keys move from `ck_<hash>` to `ck_<userId>_<hash>`, and the in-memory caches are keyed `userId:conversationId`. Legacy entries are adopted lazily on first read: Secure Store has **no enumeration API** (only get/set/delete by exact key), so they cannot be swept. No validation is needed there — a conversation key is shared by every participant by design, so a legacy entry for a conversation this user is in is the correct key.
- **`app/Bootstrap.tsx`** — after the profile and biometric gates, calls `verifyIdentityKey`. On `missing` or `mismatch` it explains which case it is and routes to `ScanningKeys` instead of letting the user into any conversation.
- **`utility/session/SessionProvider.tsx`** — `setCurrentConversation` and `getConversationKey` now close over `user`, so `user` was added to both `useCallback` dependency arrays. Without it they would have captured a stale (or empty) user id and read the wrong storage slot.

### Migration behaviour for existing installs
- Legacy key belongs to the logged-in account → adopted silently on first Bootstrap pass, user notices nothing.
- Legacy key belongs to a different account → treated as `missing`, user routed to key sync. This is the intended outcome, not a regression: that key was never usable for this account.
- The legacy slot is **not deleted** on adoption, so rolling back to a previous build still works.
- Legacy `ck_*` conversation keys carry forward on first read of each conversation.

`npx tsc --noEmit` unchanged at the 3 pre-existing app/utility errors (gluestack `ColorValue`/icon typing, `MessageActionProps`). **Nothing has been run on a device.**

## 2026-09-18 — Delete account: removed the N+1 delete loop, added a progress overlay

The freeze had two separate causes, one real and one perceptual.

**Real:** `authAPI.deleteAccount()` looped over the user's conversations and issued **three sequential round trips per conversation** (messages, participants, conversation). Twenty conversations meant sixty serialised requests. Replaced with three `.in(...)` statements total — the steps still run in order because of the foreign keys between the tables, but every conversation is handled in one statement. Guarded with a length check so an account with no conversations skips them entirely.

**Perceptual:** `handleDeleteAccount` showed no feedback at all. The confirmation dialog simply sat there until everything finished. Now the dialog closes first, a `Modal`-based progress overlay comes up (a `Modal` rather than an absolutely positioned `Box`, because the screen root is a `ScrollView` and an overlay inside it would not cover the viewport), and the overlay stays up through `router.replace('/')` so the transition does not flash back to Settings.

Two correctness problems fixed while in there:
- **Local keys were destroyed before the server call.** `MessageEncryption.deletePrivateKey()` ran first, so if `deleteAccount()` then failed the user still had an account but a device that could no longer read any conversation. The key is now discarded only after the account is confirmed gone.
- **It navigated away on failure.** `router.replace('/')` was in a `finally`, so a failed deletion still threw the user out to the root right after an alert they had no time to read. Failure now clears the overlay, reports the error, and leaves the user on Settings with their account intact.

The confirm button is also disabled and relabelled while a deletion is in flight, so it cannot be fired twice.

**Observed, not changed:** `deleteAccount()` deletes every conversation the user participates in, including group conversations, for *all* members — messages, participant rows and the conversation itself. Leaving a group would be the less destructive behaviour (`conversationAPI.leaveConversation` already does exactly that for the Delete chat feature). Flagged for a decision rather than changed, since it is long-standing behaviour and not what this task was about.

`npx tsc --noEmit` unchanged at the 3 pre-existing app/utility errors. Not yet run on a device.

### Addendum — `deleteAccount` switched to leave-not-destroy semantics

Reworked `authAPI.deleteAccount()` so it removes everything belonging to the account without taking other people's conversations with it. Conversations are now **left**, exactly as `conversationAPI.leaveConversation` does for the Delete chat feature, rather than deleted outright.

**Removed (belongs to the account):** its own messages; its own reactions; reactions and `files` rows attached to its messages (they cannot outlive the message, and would block the delete if the schema has no cascade); its `conversation_participants` rows across every conversation; `push_notification_tokens`; `files_profiles`; `devices`; the avatar in storage (already handled by `deleteAvatarFromSupabase` in the caller); the `profiles` row; and the auth user.

**Left alone (belongs to others):** other participants' messages, their reactions, and the conversations themselves. A group the account was in carries on for everyone else, minus that person's messages.

**Cleaned up:** **1-1** conversations left with zero participants are deleted along with their remaining messages, reactions, attachments and `files_group` rows. **Group conversations are never deleted**, however empty they look - a group is a shared thing with a name and a history that others may still reference or rejoin, and it is not a departing account's to remove. The cleanup filters on `conversations.is_group`.

**Local device state**, previously left behind entirely: `MessageEncryption.deletePrivateKey` was the only local cleanup. Now the identity key, every `ck_*` conversation key, and the SQLite snapshots all go. New `ConversationKeyManager.deleteAllKeys(userId, conversationIds)` handles the keys — Secure Store cannot enumerate itself, so the ids come from the local snapshots, which are the device's own record of the conversations it has held keys for. The three cleanups run concurrently since none depends on the others.

**To verify against the live schema** (hand-applied SQL, not tracked in `supabase/migrations/`):
- Does `conversations.created_by` have a foreign key to `profiles.id`? If it does and it is not `ON DELETE SET NULL`, deleting the profile will fail whenever a group this account created is still in use by others. Group key resolution itself is safe either way — `resolveConversationKey` reads the wrapping key from each row's `other_party_pub_key` before falling back to the creator's profile — but the delete would error out.
- Whether `reactions` and `files` cascade from `messages`. The explicit deletes are harmless no-ops if they do, and necessary if they do not.
- The `.in(...)` calls pass full id lists; fine at test-data scale, worth chunking if a user can accumulate thousands of messages.

`npx tsc --noEmit` unchanged at the 3 pre-existing errors. Not run on a device.

### Addendum — escape hatch on the key-recovery screen

The identity-key guard routes to `ScanningKeys`, which sits **outside the tab group** and so has no way back to Settings. Someone signed in on a device with no usable key — and no second device to scan from — was stuck there with no way to abandon the account.

- **New `utility/account/deleteAccount.ts`** — `deleteAccountAndLocalData(userId, hasAvatar)`, extracted from `Settings.tsx` so both screens share one implementation. Settings now calls it instead of inlining the sequence.
- **`app/Bootstrap.tsx`** passes `recovery: '1'` when the guard sends the user to `ScanningKeys`, so the screen can tell a forced arrival from a normal visit via Settings → Manage Keys. The destructive option only appears on the forced one.
- **`app/tabs/managekeys/ScanningKeys.tsx`** shows, under the scanner and only when `recovery=1`, a short explanation plus a **Delete this account** button, with the same confirmation dialog and progress overlay as Settings.

Two failure modes fixed while extracting the helper:
- **An empty user id would half-delete.** `MessageEncryption.deletePrivateKey('')` now throws by design (the storage slot needs an id), but `authAPI.deleteAccount()` reads the user from AsyncStorage independently and would already have succeeded — so the account was gone while the caller was told it failed. The helper now rejects an empty id up front, before anything is deleted.
- **Local cleanup failures were reported as deletion failures.** Once the account is gone it is gone; failing to tidy Secure Store or SQLite must not send the user back to a screen for an account that no longer exists. The local purge now has its own `try`/`catch`, logs, and still returns success.

`npx tsc --noEmit` unchanged at 3 pre-existing errors. Not run on a device.

## 2026-09-22 — Doomsday key-backup vault: reviewed the handoff, then built it

The `sd-chat-vault/` handoff was a design sketch written without the repo in
front of it. Reviewed it against the real code, corrected what did not match,
and wired the whole path end to end. Nothing has run on a device yet.

### What the sketch got wrong about this app
- **The identity key is not Ed25519.** It is a tweetnacl `nacl.box` X25519
  secret key, 32 bytes, base64, at `user_encryption_key_${userId}`
  (`secured.ts:152/165/171`). The sketch sealed an "Ed25519 seed" and restored
  it to `ed25519_private_key_seed` — a slot nothing reads. Recovery would have
  reported success and left the device keyless.
- **`Buffer` was used throughout and does not exist here** — no polyfill, no
  `buffer` dependency. Replaced with `MessageEncryption.bytesToBase64` /
  `base64ToBytes`.
- **`react-native-argon2` is not a dependency** and is a native module. Swapped
  for scrypt via `@noble/hashes` (added to `package.json`, already present
  transitively at 1.8.0): pure JS, no native module, no dev-client rebuild.
- **The device row was updated by `device_id`.** The repo's convention is
  `DeviceIdentity.registerCurrentDevice()` → row `id` → `markKeySynced(rowId)`,
  which also clears `is_new`.

### Client — `utility/securedMessage/VaultBackup.ts`
`backupIdentityKey` / `recoverIdentityKey` / `deleteVaultBackup` /
`hasVaultBackup`. scrypt N=2^15, r=8, p=1 → ChaCha20-Poly1305, with the account
id bound in as associated data so a blob cannot be opened under another account.
Parameters are stored per backup in `key_backups`, so the cost can be lowered
later without stranding existing backups.

The recovered key is derived to a public key and checked against
`profiles.public_key` **before** anything is written. A blob belonging to a
different identity is refused rather than cementing the exact silent mismatch
that `verifyIdentityKey` exists to catch.

Only the identity key is backed up, not conversation keys — those come back
through `ConversationKeyResolver` from each `conversation_participants.wrapped_key`
row. Conversations where this user has no wrapped key of their own (the ones a
device minted and never wrapped for itself) stay unreadable. Accepted, documented.

### Client — UI
- `app/tabs/managekeys/BackupKey.tsx`: passphrase + confirmation, a warning that
  a forgotten passphrase is unrecoverable, and a second warning when a backup
  already exists (saving replaces it, and the old passphrase stops working).
- `app/tabs/managekeys/RecoverKey.tsx`: passphrase, then recovery, with a
  distinct message per failure — wrong passphrase, no backup, vault unreachable,
  identity mismatch — because each calls for a different response.
- Entry points: "Back up my key" on `ManageKeys` (behind the existing biometric
  gate), "Recover from backup" on `ScanningKeys`, which is where Bootstrap
  already sends a device that holds no key. Both registered in `app/tabs/_layout.tsx`.
- `deleteAccountAndLocalData` now removes the vault backup **before**
  `authAPI.deleteAccount()` signs out, since the vault authenticates with that
  session. Best-effort: an unreachable Pi must not block deleting an account.

### Vault service
- `PUT`/`GET`/`DELETE /backup/:userId`, base64-in-JSON rather than raw binary
  bodies (RN's fetch is an XHR polyfill with uneven binary support). Writes are
  write-then-rename, so a pulled plug leaves the previous backup intact.
- **Dual-mode JWT verification**, chosen per token by its `alg`: HS256 against
  the shared secret, ES256 against the cached JWKS. The project signs HS256 with
  ES256 in standby, so promoting the standby key later needs no code change —
  just delete the secret from the Pi's `.env`.
- Docker, not systemd: `vault-service/Dockerfile`, `docker-compose.yml`
  (vault + cloudflared + a JWKS refresher on a 12h loop), `.env.example`,
  `DEPLOY.md`. No `ports:` mapping anywhere — the only route in is the tunnel.
  The `systemd/` units are left in place but unused.
- `supabase/migrations/20260922000000_key_backups.sql` reworked for scrypt
  parameters. Not applied yet.

### Verified
- **Service, end to end** (local, both auth modes): unauthenticated → 401;
  another account's token → 401; GET before PUT → 404; PUT → 204; GET returns
  the blob; non-base64 → 400; oversize → 413; path traversal → 401; DELETE →
  204, then 404; no file left behind. ES256-only, HS256-only and dual-mode
  configurations all behave as intended, and dropping the secret cleanly
  rejects HS tokens — which is the promotion path.
- **Crypto round trip** against the project's own modules: seal/open passes,
  the recovered secret derives the original public key, a wrong passphrase is
  rejected, and a wrong account id as associated data is rejected. Sealed blob
  is 48 bytes, 64 base64 chars. scrypt N=2^15 takes ~140ms on Node — Hermes
  will be several times slower and needs measuring on a real phone.
- `npx tsc --noEmit` unchanged at 27 pre-existing errors, all in
  `components/ui/` and `supabase/functions/`; none in `app/` or `utility/`.

### Not done
Nothing has run on a device. The migration is not applied, the Pi is not
deployed, and ES256 is not promoted — while it is not, the Pi would hold a
symmetric secret that can mint `service_role` tokens.

### Documentation updated (same session)
- **New**: `documentation/app/tabs/managekeys/BackupKey.md`, `RecoverKey.md` — flow, why the confirmation field and the "already have a backup" warning exist, the four typed errors and why each gets its own message, and a table comparing vault recovery against QR pairing.
- **Updated**: `app/README.md` (route map, implementation boundaries, a caveat that the vault has never run on a device), `utility/README.md` (new `VaultBackup.ts` and `ConversationKeyResolver.ts` sections, `@noble/hashes` dependency, a security note on how backups are sealed), `supabase/README.md` (the `key_backups` table and a section on the vault service), `ManageKeys.md` and `ScanningKeys.md` (the new entry points on each).
- **Corrected a misconception in `utility/README.md`**: it described `tweetnacl` as "Ed25519 key pairs and ECDH". The identity key is X25519 (`nacl.box`). That is exactly the assumption that made the first draft of the vault restore a key to a Secure Store slot nothing reads, so the line now says so explicitly.
- **Fixed relative links** in `documentation/app/tabs/managekeys/*.md` and `msg/*.md`: eight files used `../../../app/...` where their depth needs `../../../../`, so every "Source:" link in them pointed at nothing. All relative links in `documentation/` now resolve.

### Aligned to the Pi's actual compose file (2026-09-23)
The Pi is already running a compose stack with different names and paths than
the repo assumed. Repo now matches it rather than the other way round:
- Service name is `vault-service` (not `vault`), so the Cloudflare ingress must
  target `http://vault-service:8443`.
- The volume mounts at `/opt/sd-chat-vault`, not `/data`. Dockerfile `VOLUME`,
  `VAULT_DIR` / `JWKS_CACHE_PATH` defaults and `.env.example` all moved.
- **Dockerfile fix that matters**: the image now creates
  `/opt/sd-chat-vault/backups` owned by `node` *before* the volume mounts over
  it. Docker copies the image directory's ownership onto a named volume when it
  first creates it; with no such directory the volume is created root-owned and
  the unprivileged process cannot write a single backup. Reasoned, not tested —
  no Docker daemon available here — so DEPLOY.md step 6 opens with a one-line
  writability probe and the `chown` recovery command.
- Added a `jwks-refresh` service to their layout, sharing the volume.
- One `.env` at the vault root (their `env_file:`); removed the stale per-service
  `.env.example`, which still advertised `AUTH_MODE` and `HOST=127.0.0.1` — the
  latter would make the service unreachable from cloudflared and 502 everything.
- `DEPLOY.md` rewritten as a step-by-step runbook for this exact setup, with the
  verification ordered so each check isolates one layer.

### `install-vault.sh` (2026-09-23)
Getting the source onto the Pi by hand kept losing files — first the
`Dockerfile`, then `src/`. Added `sd-chat-vault/install-vault.sh`, generated
from the repo files so it cannot drift: it writes `docker-compose.yml`,
`.env.example` and the whole `vault-service/` tree, overwrites only those, and
leaves an existing `.env` alone. Verified by running it into a scratch
directory and diffing all eight files against the originals — byte-for-byte
identical. Can be run without copying anything:
`ssh pi@host 'mkdir -p ~/clouflared && cd ~/clouflared && sh -s' < install-vault.sh`

## 2026-09-23 — Vault deployed to the Pi and reachable through the tunnel

The service is live. `curl https://sd-chat-tunnel.bid/backup/<uuid>` from
outside returns **401**: the tunnel reached the service and the service refused
an unauthenticated caller, so both halves work. No phone has touched it yet.

### What the deployment actually needed, beyond DEPLOY.md
- **The compose file on the Pi had been merged rather than replaced**, leaving
  two top-level `services:` and two `volumes:` keys —
  `mapping key "services" already defined`. `docker compose config -q` now
  appears in DEPLOY.md as a pre-flight check.
- **Pinned the compose project name** to `sd-chat-vault`. Compose derives it
  from the directory otherwise, so the volume would have been
  `clouflared_vault-data` and would have silently become a different, empty
  volume if the folder were ever renamed. Consequence documented: the old
  project's containers use fixed `container_name`s and must be removed first, or
  the new project collides with *container name is already in use*.
- **Getting the source onto the Pi kept losing files** — first the `Dockerfile`
  (`failed to read dockerfile`), then `src/` (`COPY src ./src`). Fixed properly
  with `sd-chat-vault/install-vault.sh`, generated from the repo so it cannot
  drift: it writes `docker-compose.yml`, `.env.example` and the whole
  `vault-service/` tree, overwrites only those, and leaves an existing `.env`
  alone. Verified by running it into a scratch directory and diffing all eight
  outputs against the originals — byte-for-byte identical. Usable with no file
  copying at all:
  `ssh pi@host 'mkdir -p ~/clouflared && cd ~/clouflared && sh -s' < install-vault.sh`
- **A `listening on 127.0.0.1` log line with `HOST=0.0.0.0` set** turned out to
  be a stale line replayed by `docker compose logs`, not a live misconfiguration
  — an explicit `HOST` always beat the default, even in the original source, so
  a container started with that env could not have logged it. The check that
  settles it regardless of logs is
  `docker compose exec jwks-refresh wget -qO- http://vault-service:8443/healthz`.

### Paths and names, now fixed
The stack lives in `/home/<user>/clouflared/` on the Pi; the volume mounts at
`/opt/sd-chat-vault` **inside the container**. `Dockerfile`, the `VAULT_DIR` /
`JWKS_CACHE_PATH` defaults and `.env.example` were all realigned to that, and
the Dockerfile now creates `/opt/sd-chat-vault/backups` owned by `node` before
the volume mounts over it — without that the named volume comes up root-owned
and the unprivileged process cannot write a single backup. Reasoned, not tested
(no Docker daemon on the Mac), so DEPLOY.md step 6 opens with a writability
probe and the `chown` recovery command.

### `eas.json` — would have shipped a broken build
`EXPO_PUBLIC_VAULT_URL` was in `.env`, which is gitignored, and **EAS excludes
gitignored files from the upload** — which is exactly why every other
`EXPO_PUBLIC_*` var is duplicated into `eas.json`'s `env` blocks. The vault URL
was not, so a build would have shipped it `undefined` and both screens would
have failed with "there is no vault to talk to". Added to the `development` and
`production` profiles. Noted in passing: `preview` has no `env` block at all, so
it gets no Supabase configuration either.

### Not done
The migration has not been confirmed applied (the 401 does not prove it — the
vault never calls Supabase for an unauthenticated request), the app has not been
rebuilt, no device has exercised either screen, scrypt has never run on Hermes,
and ES256 is still in standby with the symmetric secret sitting on the Pi.
See in-progress.md for the ordered pick-up list.

## 2026-09-23 (later) — First real backup stored; the 401 was two compounding faults

`Back up my key` from the APK now succeeds end to end: phone → Cloudflare Tunnel
→ vault → blob on the Pi.

### Why it returned 401 at first
1. **The project signs ES256, not HS256.** Its JWKS publishes exactly one key
   (`alg=ES256`, `kty=EC`), so every token takes the JWKS path and the HS256
   secret on the Pi was never consulted. The earlier plan — "dual-mode now,
   promote ES256 later" — turned out to be describing a promotion that had
   already happened.
2. **The JWKS cache was never written, because the refresher's compose command
   was wrong.** `command: >` kept the surrounding single quotes, and with an
   exec-form `entrypoint: ["/bin/sh","-c"]` the whole loop arrived as one
   argument, so sh treated it as a *command name*:
   `while true; do node dist/jwks-refresh.js ...; done: command not found`.
   The container had been crash-looping since first start.

Together: ES256 token → JWKS path → no cache file → `AuthError` → 401 on every
request. Fixed by unquoting the command in `docker-compose.yml`. The immediate
unblock needed no redeploy at all, since the vault re-reads the cache from disk
on every request: `docker compose exec vault-service node dist/jwks-refresh.js`.

### Diagnostics added, because this was harder to see than it should have been
- **Client** (`VaultBackup.ts`): `describeRefusal()` now reads the response body
  at all three call sites, so the app reports `401 - <the vault's reason>`
  instead of a bare status. It also names the case where the responder was not
  the vault at all (an HTML body), which is what a Cloudflare Access policy in
  front of the tunnel would look like.
- **Service** (`index.ts`): auth refusals are logged with their reason. A 401
  here is never the user's fault, and the person who can fix it is reading the
  Pi's logs, not the phone's screen.
- `install-vault.sh` regenerated so it carries both.

### Consequence for the security item
Since the project is already asymmetric, `SUPABASE_JWT_SECRET` on the Pi is
doing nothing and can simply be deleted from `~/clouflared/.env`. The concern
about the Pi being able to mint `service_role` tokens goes away with it — no
dashboard rotation needed, it was already done.

## 2026-09-23 (session 3) — Planning: replicate Supabase data to the Pi
Planning only, no code changed. Audited what a Supabase → Raspberry Pi
replica would need; the gap list and open decisions are in in-progress.md
under "Supabase → Pi replication".

## 2026-09-23 (session 4) — Diagnosed: a keyless new device can create chats that nobody else can open
Investigation only, no code changed. The user reported: signing in on a new
device with no private key went straight to the chat list, a chat could be
created, the app crashed to the home screen a few seconds later, and the
recovery screen appeared on relaunch. After a vault recovery a second chat
worked on both devices, but the **first** chat would not open on the original
device.

Root cause is two separate defects stacking up; the full write-up and the fix
plan are in in-progress.md under "OPEN — keyless new device creates orphan chats".
1. **The identity-key guard can be skipped.** `app/Bootstrap.tsx` checks the
   biometric flags *before* `verifyIdentityKey`. They are stored per user in
   AsyncStorage, so a new device never has them. Bootstrap therefore routes to
   `EnableBiometric` and returns, and `EnableBiometric` sends the user straight
   to `/tabs/(tabs)/Chat`. The key check never runs on first login on a device.
2. **Minting a conversation key does not fail when there is no private key.**
   `wrapConversationKey` returns `null` when the key is missing, and both
   `createAndDistributeConversationKey` and `createGroupChat` in
   `app/tabs/(tabs)/Chat.tsx` skip writing the row on `null` but still return
   the key, save it on the device and open the room. The result is a
   conversation with a key on that one device and **no wrapped key rows in the
   database**, so no other device or participant can open it.

## 2026-09-24 — Fix: keyless devices can no longer reach the chats or create orphan chats
Implements fixes 1–4 from yesterday's diagnosis (in-progress.md, "Keyless new
device creates orphan chats"). Typechecks: same 22 pre-existing errors as
before (`components/ui`, Deno edge functions), none in files touched here.
**Not run on a device.**

- **Gate order** (`app/Bootstrap.tsx`): `verifyIdentityKey` now runs *before*
  the biometric branch. The Alert + redirect moved into the new
  `utility/securedMessage/IdentityKeyGuard.ts` (`routeToKeyRecovery`), shared
  with the tabs guard.
- **Tabs guard** (`app/tabs/(tabs)/_layout.tsx`): renders nothing until the
  identity key is verified, and sends the user to recovery otherwise. This
  covers the routes that skip Bootstrap: `EnableBiometric`, notification taps,
  direct `router` calls. `EnableBiometric` itself was left unchanged, since the
  guard makes changing it unnecessary.
- **Fail closed** (`secured.ts`): `wrapConversationKey` now throws when there
  is no private key, instead of returning `null`.
- **`Chat.tsx`**
  - New `ensureIdentityKey()`, called before `getOrCreateDM` /
    `createGroupConversation`, so a failure leaves no empty conversation behind.
  - DM: the self row is written first and is required. If it fails, the key is
    thrown away instead of kept locally. A failed recipient row is logged and
    repaired later by the backfill.
  - Group: the creator is now wrapped for too. The member picker never
    included them, so **the creator's own row was always empty**, and a group
    opened only from the creating device's local key. This probably explains
    some of the "legacy group" failures from 2026-09-17. A failed creator row
    now aborts the creation.
  - `handleUserPress`: when this user has no row (`absent`) but the
    conversation already **has messages**, it refuses to create a new key and
    shows an alert. Creating one there was how a conversation got split into
    two keys.
- **Self-heal backfill** (`ConversationKeyResolver.backfillMissingWrappedKeys`):
  runs in the background whenever a key is found while opening a chat. It
  wraps the key for every participant whose row has **no** `wrapped_key`, and
  only when this device's derived public key matches the profile. New
  `conversationAPI.fillMissingConversationKey` adds `.is('wrapped_key', null)`,
  so the database refuses to overwrite a row that is already filled. Also new:
  `getParticipantKeyRows`, `hasMessages`.

## 2026-09-24 (session 2) — Traefik + load-balanced vault replicas (built, not deployed)
Request path is now `cloudflared → traefik:8000 → vault-1 / vault-2 :8443`.
All changes are in `sd-chat-vault/`.

- **`traefik/traefik.yml`** (static): entrypoints `web :8000` (tunnel) and
  `admin :8080` (dashboard + ping); file provider, **no Docker socket**; JSON
  access log that drops every header except `CF-Connecting-IP` / `CF-Ray`, so
  bearer tokens are never logged. No TLS: Cloudflare terminates HTTPS.
- **`traefik/dynamic.yml`**: router ``PathPrefix(`/backup/`)`` → service
  `vault`, which load-balances across `vault-1`/`vault-2` with a `/healthz`
  check every 10s. Middlewares:
  - rate limit, 10/min with burst 5, **keyed on `CF-Connecting-IP`** (behind
    cloudflared every request otherwise shares one source address)
  - 16 KB body cap
  - retry ×2 on connection errors only
  - security headers

  `/healthz` is not routed.
- **`docker-compose.yml`**:
  - The replicas share an `x-vault` anchor. Only `vault-1` builds; the others
    use `image: sd-chat-vault:local` with `pull_policy: never`.
  - Two networks: `edge` (cloudflared, traefik) and `backend` (traefik,
    replicas, jwks-refresh). cloudflared can no longer reach the vault
    directly.
  - Traefik runs as `65534`, `read_only`, `cap_drop: ALL`,
    `no-new-privileges`. Its only port mapping is the dashboard on
    `127.0.0.1:8080`.
- **`vault-service/src/index.ts`**: the write-then-rename temp file is now
  `<id>.b64.<uuid>.tmp` and is removed on failure. With one fixed `.tmp` name,
  two replicas writing the same user at once could make one rename fail with
  ENOENT → 500.
- **`.env.example`**: the `HOST` comment now names Traefik as the caller. No
  new variables.
- **`install-vault.sh`** regenerated with the `traefik/` files. Round-trip
  checked: running it in an empty directory reproduces all 10 files byte for
  byte.
- **`DEPLOY.md`**: the ingress now points at `http://traefik:8000`, and the
  verify steps name the replicas and add in-network `curlimages/curl` checks.
  New sections: "Moving to Traefik…" (migration, `429` check, rollback) and
  "Operating the load balancer" (rolling restart, adding a replica,
  dashboard over SSH). The "no rate limit" note was replaced with the new
  limits, and the single-host limitation is recorded.

Validated with `docker compose config -q` and `tsc` only. There is no Docker
daemon on the Mac, so nothing has actually run.

## 2026-09-24 (session 3) — Traefik deployed on the Pi; two issues found at cutover
- **502 after migrating**: cloudflared logged `lookup vault-service … no such
  host`, because the tunnel ingress still pointed at the removed container.
  Fixed by changing the dashboard Public Hostname service to
  `http://traefik:8000`, as DEPLOY.md's migration step 5 says. Routing through
  Traefik then worked (the next error came from the vault itself).
- **401 `token is HS-signed but no shared secret is configured`**. The app
  sends the real session token (`VaultBackup.ts` → `getSession()`), so **the
  project still signs sessions with the legacy HS256 secret**.
  **Correction to the 2026-09-23 (later) entry:** its claim that "the project
  signs ES256" and that `SUPABASE_JWT_SECRET` "is doing nothing and can simply
  be deleted" was wrong. The JWKS endpoint also lists a key that is only on
  **standby**, and the HS256 secret is symmetric so it never appears there.
  One ES256 key in the JWKS does not show which key is current. The deleted
  secret only started to matter when the migration recreated the containers
  from `.env`.
- **Resolved: confirmed working by the user.** After the 401 fix, backups
  work end to end on the new stack:
  `app → Cloudflare → cloudflared → traefik:8000 → vault-1/vault-2`.
  Not recorded: whether the fix was **restoring `SUPABASE_JWT_SECRET`** or
  **promoting ES256**. See in-progress.md.

## 2026-09-24 (session 4) — Maestro suite wired into GitHub Actions (not yet run)
- New `.github/workflows/maestro-e2e.yml`: `npm ci` → writes `google-services.json` from a secret → `expo prebuild --platform android` → `assembleRelease` (x86_64 only; release bundles JS, so no Metro) → Android API 34 `google_apis` emulator via `reactivecircus/android-emulator-runner` → `.github/scripts/run-maestro.sh`. Triggers: manual (`workflow_dispatch`) and pushes to `main`; not on PRs, because it runs against the real Supabase project. JUnit + screenshots uploaded as the `maestro-results` artifact.
- `run-maestro.sh` runs flows one at a time in a fixed order (they share state), keeps going past failures, and writes a pass/fail summary to the job page.
- New CI-only flows in `maestro/ci/`: `setup-account.yaml` (registers `sdchat-ci-<run_id>-<attempt>@example.com`, skips biometric, lands on Chat) and `teardown-account.yaml` (deletes that account; always runs).
- Left out of CI: `login*.yaml` (dev-client "Downloading…" banner + needs keys already on the device), `send-images`/`send-files`/`create-account-with-picture` (specific gallery files), and the biometric account-creation flow (needs an enrolled fingerprint).

## 2026-09-24 (session 5) — `google-services.json` kept out of git; Maestro suite added to EAS Workflows
- `google-services.json` is now in `.gitignore`. GitHub Actions rebuilds it from the `GOOGLE_SERVICES_JSON_BASE64` secret (base64 of the **whole file**, not just the API key). The Firebase Android key ships inside the APK anyway; it's protected by API-key restrictions in Google Cloud, not by being secret.
- New `app.config.js`: `android.googleServicesFile` = `process.env.GOOGLE_SERVICES_JSON` (EAS file variable), falling back to `./google-services.json`.
- `eas.json` is no longer gitignored (EAS Workflows check the repo out from GitHub, so they need it). The `e2e-test` profile now sets `"environment": "preview"`.
- `.eas/workflows/e2e-test-android.yml` rewritten to run the same flows, in the same order, as `run-maestro.sh`: setup-account → suite → teardown-account. `MAESTRO_EMAIL` = `sdchat-eas-${{ workflow.id }}@example.com`; `MAESTRO_PASSWORD` comes from the preview EAS environment.
- The flows' `${EMAIL}`/`${PASSWORD}` were renamed to `${MAESTRO_EMAIL}`/`${MAESTRO_PASSWORD}`, because Maestro only reads shell variables that start with `MAESTRO_`. `run-maestro.sh` now passes `-e MAESTRO_EMAIL=… -e MAESTRO_PASSWORD=…`. For local runs, use `-e MAESTRO_EMAIL=… -e MAESTRO_PASSWORD=…`.
- Tried to re-run the GitHub workflow from here; failed because `gh` isn't authenticated (401).

## 2026-09-25 (session 6) — GitHub workflow split into `build` and `e2e` jobs
- `maestro-e2e.yml` now has a `build` job (prebuild + `assembleRelease`, uploads the APK as the `app-release-apk` artifact, kept 7 days) and an `e2e` job (`needs: build`; downloads the APK, boots the emulator, runs `run-maestro.sh`). Use "Re-run failed jobs": a test failure reruns only `e2e` against the existing APK; a build failure reruns from the build. Each attempt still gets a fresh CI account (`run_attempt` is in the email).
- Flaky first step fixed: flows did `launchApp` then `assertVisible: "Chat.*"`, which only waits a few seconds, while a cold start on the software-rendered CI emulator (session restore + key check + Supabase fetch) can take longer. That `assertVisible` is now `extendedWaitUntil` (50s) in every flow that opens on Chat. `teardown-account.yaml` now waits for Authentication *or* Chat before its "log in if needed" check, which previously raced the cold start and could skip the login.
- `setup-account.yaml` also failed at its first wait (Authentication screen not seen in 50s); cause unknown because `gh` can't read the run (invalid token). `run-maestro.sh` now saves `adb logcat` to `maestro-results/logcat.txt` so the next failure shows whether the app crashed, hung, or was covered by a system dialog.
- Stale testIDs: commit ccdef5e renamed the locators (`constants/automationLocatorsDataState.ts`), so `users-scroll` and `search` no longer existed in the app. Removed every `assertVisible: { id: "users-scroll" }`; `interactive-users.yaml` (which swipes the list) now uses `user-list`. `login.yaml` now uses `search-input`. The other unmatched IDs in the flows (`ImageView_image`, `icon_check`, `toolbar`, `bottombar_intent_review`) belong to Android's pickers, not the app.
- Chat room controls now have testIDs (from `automationLocatorsDataState.chatScreen`): `message-input`, `send-button`, `emoji-picker-button`, `picture-picker-button`, `files-picker-button`, plus new `edit-chat-room-button` on the room header. The emoji `Picker` now has `native` (emojis rendered as text, so Maestro can find them; added `native` to `types/emoji-mart-native.d.ts`). Chat-room flows switched from "Input Field"/"➤"/emoji text/`88%,7%`/`0%,92%` to these IDs; `send-emojies.yaml` rewritten to search "grimacing" in the picker, tap 😬, send, and wait for the sent 😬. Needs a new APK build (app change).
- CI teardown failed ("Could not delete CI account sdchat-ci-36115308585-1@example.com"): the flow expected the app to still be on Settings, but `launchApp` restarts it onto Chat, so `delete-account-button` was never on screen. Rewritten: wait for Authentication|Chat, log in if signed out, tap Settings, `scrollUntilVisible` the delete button, confirm. That account must be removed by hand in Supabase.
- Open: `run-maestro.sh` passes `MAESTRO_USER="$USER"` for forward-message's target, but nothing sets it, so on the runner it's the OS user `runner`.
