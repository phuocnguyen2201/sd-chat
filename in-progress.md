# In Progress / Open Items

## Remote (server-relayed) device pairing — built but not wired to UI
`supabase/functions/device-pairing`, `RemoteDevicePairing.ts`, and `DeviceIdentity.ts` are fully implemented and callable, but no screen calls them yet. Still needed:
- Login/Bootstrap flow: detect "no local private key" and offer this as an option (currently only the local QR flow in `ManageKeys`/`ScanningKeys` is reachable from the UI).
- An "old device" approval screen: list incoming pairing requests, show the one-time code, call `RemoteDevicePairing.approve()`.
- A "new device" screen: call `createRequest()`, poll `status()`, enter the code via `confirm()`, then `fetchAndUnwrap()`.

## Known critical issue — deferred by user request
`utility/connection.ts` exports `supabaseAdmin` from `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`. Because Expo inlines `EXPO_PUBLIC_*` vars into the client bundle, the Supabase service-role key (bypasses RLS) ships inside the compiled app and is extractable from it. Actively used client-side in `utility/messages.ts` for account deletion (`supabaseAdmin.auth.admin.deleteUser`) and message/conversation deletion. Needs to move into server-side Edge Functions (same pattern as `push` / `device-pairing`), then the key should be rotated. User explicitly asked to leave this alone for now ("we'll handle later") — do not touch without being asked again.

## Schema not tracked in-repo
The `devices`, `device_pairing_requests`, and now `local_pairing_codes` tables (and their RLS) were applied by hand-running SQL directly against the Supabase project. There's no `supabase/migrations/` entry for any of them, so a fresh environment/CI wouldn't get this schema automatically. Worth adding migration files for traceability if/when convenient.

## Next up (2026-09-18): `ManageKeys` QR screen — `Done`/`Cancel` should return to Settings
On the **sharing** device, while the QR is displayed (`show_sealed` phase), pressing `Done` currently calls `cancel()`, which only clears `sealedQr` and drops the screen back to the `idle` phase — the user is left sitting on `ManageKeys` with a `Share Keys` button again. Desired behavior: `Done` (and any Cancel path on the QR screen) should navigate to the **Settings** screen instead, i.e. `router.replace({ pathname: '/tabs/(tabs)/Settings' })` — matching what `ScanningKeys` already does on the receiving side when its completion dialog's `Ok` is pressed. To implement next session.
- Decide whether the 30s TTL expiry path (`timeLeft === 0`, which currently also falls back to `idle`) should likewise bounce to Settings, or stay on `ManageKeys` so the user can regenerate — these are currently the same code path and would need splitting.

## Local pairing-code gate + single-QR key sharing — QR scan verified, rest still needs on-device testing
`PairingCode.tsx` / `EnterPairingCode.tsx` + the `local-code-*` Edge Function actions (2026-09-15) sit in front of key sharing; as of 2026-09-16 (commit `4e02cce`) the QR step behind that gate went back to a single plaintext-`KeyObject` QR (the two-QR ECDH handshake was removed — see progress.md).

**Confirmed working on a real device 2026-09-17:** the QR scan itself now completes, after fixing the missing quiet zone on the generated QR (see progress.md's 2026-09-17 entry). Still untested:
- Run through the full flow on two real devices: Settings → Biometric → Share Keys → code shown → other device → Receive Keys → enter code → confirm the (now single) QR scan completes correctly and both accounts match.
- Exercise the failure paths: wrong code (attempts-remaining message), 5 wrong attempts (lockout countdown), code expiry (regenerate button on `PairingCode`), QR expiry (30s, `ManageKeys` clears back to idle), Cancel on all four screens.
- Re-test the **inline** `QrScannerView` camera specifically. The scan was confirmed working while temporarily routed through `CameraView.launchScanner()` (Google's full-screen Code Scanner); that path was then reverted back to the inline `CameraView` and has not itself been re-verified against the fixed QR.
- Check the QR renders and scans in **both light and dark mode** — dark mode was the condition that made it undecodable in the first place.
- `.expo/types/router.d.ts` was hand-patched to add the `PairingCode`/`EnterPairingCode` routes so `tsc` would pass without a running dev server — once `expo start` runs normally it'll regenerate that file properly; just confirm it doesn't collide with the manual patch (it shouldn't, since that file is gitignored and fully regenerated, not merged).
- `BiometricAuthentication.tsx` was deliberately left unchanged (still routes to `ManageKeys`, which now gates both directions via the two new screens) — flag if a different entry point was actually intended.

## Dead code: `utility/securedMessage/DevicePairing.ts`
No longer imported by anything after commit `4e02cce` removed the two-QR ECDH handshake from `ManageKeys`/`ScanningKeys` (see progress.md's 2026-09-16 entry). Left in the tree, not deleted. Worth either removing it (and its `isPairInitPayload`/`isPairDataPayload` guards, and the now-unused `PairInitPayload`/`PairDataPayload` types in `utility/types/user.ts`) or confirming with the user whether the two-QR handshake is meant to come back later — flag before deleting, since it may be intentionally kept as a reference for restoring stronger security later.

## Maestro suite — 6 new flows written 2026-09-17, none run on a device yet
`create-group-chat`, `rename-group-chat`, `edit-message`, `delete-message`, `delete-chat`, `delete-account` were added under `maestro/`. They are YAML-validated only — **none has been executed against an emulator or device**. Expect selector drift on first run, most likely at:
- `rename-group-chat.yaml`'s `point: 88%,7%` header-edit tap (copied from `interactive-users.yaml`, Android-tuned).
- `rename-group-chat.yaml`'s `tapOn: { below: "Group Name" }` relative selector for the pre-filled room-name `TextInput`.
- `delete-chat.yaml`'s `tapOn: "^Delete$"` — depends on Maestro treating text selectors as full-match regex, which the existing flows' `.*Foo.*` style implies but which hasn't been confirmed for an anchored pattern.
- `delete-account.yaml`'s `tapOn: "Skip"` on `EnableBiometric` — the existing account-creation flow taps "Enable Touch ID" instead, so the Skip path is unproven.

Also still uncovered, and all single-device (no blocker, just unwritten): zoom image, shared files tab in `ChatRoomEditing`, standalone logout, Bootstrap's 4 routing branches, `PairingCode` countdown/expiry/regenerate, and every `EnterPairingCode` failure path.

## Maestro — seeded-fixture fragility
~8 of the 15 pre-existing flows depend on a hand-seeded peer account named `"Android Simulator"` and a message with the exact text `"Testing message"` already present in that DM. Nothing creates these; if the Supabase data is reset the suite breaks with confusing selector failures. Worth replacing with a `runScript` + `http` setup step that provisions the peer and the message against Supabase before the flow runs — this is the same mechanism that would remove the need for a second device on the realtime/push tests.

## `BiometricAuthentication` "Back" button navigates forward — decide if intended
`app/tabs/managekeys/BiometricAuthentication.tsx:62`: the button labelled **"Back"** calls `router.push('/tabs/managekeys/ManageKeys')`, so it skips the biometric check entirely and lands on key management. Either the label is wrong (should be `router.back()`) or the bypass is intentional for testing. Flagged, not changed — it currently doubles as the only way a Maestro flow can reach `ManageKeys` without a biometric sensor.

## Conversation-key divergence fix — needs two-device verification (2026-09-17 session 3)
The `Key unwrapping failed` re-keying bug is fixed in code (see progress.md) but **nothing has been run on a device**. To verify:
- Fresh accounts on both devices. A taps B in the **user avatar list**, sends a message; B opens from the **chat list** and reads it. Then B taps A in the **user avatar list** (the path that used to re-key) and confirms the thread still decrypts on both sides.
- Repeat with "Delete chat" in the middle: B deletes the chat, then reopens it via A's avatar. B should recover its own key rather than mint a new one, and A should still read every message.
- Group chat: create a group, confirm each invited participant can open it. The group path (`other_party_pub_key` = creator's key, and the restored `isGroup` branch in `handleConversationPress`) has never worked correctly, so this is effectively a first test, not a regression check.
- Confirm a message that genuinely cannot be decrypted now renders as `Message cannot be decrypted on this device` instead of blanking the screen.

**Known gap:** conversations already broken by the old behaviour will stay broken — each device keeps its own key in Secure Store and the local cache deliberately wins over the database row. Clear app storage on one device or use a new conversation when testing.

**Still unverified assumption:** `get_conversation_between_users` (hand-applied SQL, not in `utility/types/supabse.ts`) is assumed to return rows shaped `{ conversation_id }`. `verifyDMConversation` no longer decides whether a key is minted, so a wrong shape is no longer dangerous — but it is worth confirming the column name, since a mismatch means that guard has silently never worked.

## OPEN EDGE CASE — legacy conversations still unopenable after the 2026-09-17 key fixes

**Observed 2026-09-17, on device.** After the conversation-key fixes (see progress.md), a **brand new pair of accounts sends and receives normally in both directions** — DM and group. The fixed resolution path is therefore correct. But a **pre-existing** group conversation still fails with `[resolveConversationKey] no candidate public key could unwrap this row`, meaning neither the row's `other_party_pub_key` **nor** the computed creator/other-participant public key opens it. Both ECDH candidates were rejected by Poly1305.

This is not a logic bug in the current code — it is data written under the old behaviour that the client can no longer open. Deferred deliberately; capture the cause before choosing a remedy.

### What is already ruled out
- Wrong public key *selection* in the client. Every path now tries the row's recorded key and the computed wrapper key, and repairs the row when the fallback wins. Fresh accounts prove the selection is right.
- Key *sizes* and the wrap direction: `unwrapConversationKey` validates 32/32 and throws a distinct error otherwise; the wrap is `sender_priv` + `receiver_pub`, which is correct.

### Leading hypotheses, in order
1. **A keypair changed after the conversation was created.** Either the reading member's or the creator's. `profiles.public_key` gets written once at signup (`app/login.tsx` → `getPublicKey()`), while the private key lives only in that device's Secure Store, and **nothing verifies the two still correspond**. A reinstall, a re-signup, or a QR key-sync that overwrote the private key all silently break every row wrapped for the old public key. If the **creator's** pair changed, those rows are unopenable by anyone and the group can only be recreated.
2. **The wrapper is not `conversations.created_by`.** `createGroupChat` wraps with whoever ran it; the client assumes that is `created_by`. The RPC behind `createGroupConversation(name, userId, recipientIds)` is hand-applied SQL, not in `utility/types/supabse.ts`, so this is unverified — confirm it sets `created_by` to that `userId`.
3. Stored bytes damaged — cheap to exclude: the `[unwrapConversationKey]` log prints `wrappedKeyLength` (must be 48) and `nonceLength` (must be 12).

### What to capture next time it reproduces
The three instrumented logs, now `JSON.stringify`'d so Metro prints values rather than `[Object]`:
- `[handleConversationPress] could not resolve conversation key` — roster, `createdBy`, `resolvedOtherPublicKey`, `myProfilePublicKey`
- `[resolveConversationKey] no candidate public key could unwrap this row` — `rowPublicKey`, `candidatesTried`
- `[unwrapConversationKey] Poly1305 tag did not verify` — fires once per candidate with `otherPartyPublicKey`, `thisDeviceDerivedPublicKey`, byte lengths

**The single decisive comparison is `thisDeviceDerivedPublicKey` vs that user's `profiles.public_key`.** If they differ, hypothesis 1 is confirmed and no client-side fallback can help.

### Candidate solutions to evaluate later
- **Identity-key guard at startup** (`app/Bootstrap.tsx`): derive the public key from the stored private key and compare against `profile.public_key`; on mismatch or absence, route to key sync instead of letting the user into chats. Turns a silent late failure into an early actionable one. Does not recover data.
- **A real re-key / re-share flow**: an existing member who still holds the conversation key re-wraps it for a member whose identity key changed. This is the only path that recovers history, and nothing like it exists yet.
- **Accept and document**: conversations predating the fix must be recreated. Cheapest, and probably fine for a test dataset.

### Instrumentation has been removed (2026-09-17)
All `debugger` statements and the three verbose `console.error` diagnostic blocks were stripped once the edge case was recorded. What remains on the failure paths is concise and logs no key material: `Unable to unwrap the conversation key for <conversationId>` in `ConversationKeyResolver.ts`, and `Unable to decrypt message` in `app/tabs/msg/[room_id].tsx`. **If this edge case is picked up again, the instrumentation has to be re-added** - the three logs and their fields are described above.

## Per-user key storage (2026-09-18) — needs on-device verification
Implemented, typechecks, never run. To verify:
- **Fresh sign-up** on a clean install: key is stored only after sign-up succeeds, Bootstrap passes the identity check, DM and group both work.
- **Existing install** whose legacy `user_encryption_key` belongs to the logged-in account: should be adopted silently on the first Bootstrap pass and everything keeps working, including conversations whose `ck_*` entries are still under the old unnamespaced name.
- **Account switch on one device** (the original bug): sign in as a second account and confirm Bootstrap reports `missing` and routes to `ScanningKeys` rather than silently using the first account's key. Then switch back and confirm the first account still works — this is the case that used to destroy the key permanently.
- **Failed sign-up** (duplicate email, network drop): confirm no key is left in Secure Store, since `generateKeyPair()` no longer persists.
- **Account deletion** from Settings: confirm both the namespaced and legacy slots are cleared.
- Watch for a **navigation loop** on `ScanningKeys` if a user backs out of it without syncing — Bootstrap's `hasNavigated` ref guards one pass per mount, but this path has not been exercised.

Open question deliberately not addressed: `verifyIdentityKey` returns `ok` when `profiles.public_key` is empty and a key is present, because there is nothing to compare against. If an account can legitimately have a null public key, that is a hole worth closing.

## Doomsday key-backup vault — Pi deployed and reachable, app not yet built (2026-09-23)
The vault service is **live on the Pi and serving through the tunnel**. Verified
end to end from outside: `curl https://sd-chat-tunnel.bid/backup/<uuid>` returns
**401**, which means the tunnel reached the service and the service refused an
unauthenticated caller — both halves working. Nothing has touched it from a
phone yet.

### Pick up here
1. **Confirm the migration is applied.** `select * from key_backups;` in the
   Supabase SQL editor — `0 rows` is right, `relation does not exist` means it
   still needs running from
   `sd-chat-vault/supabase/migrations/20260922000000_key_backups.sql`. The 401
   above does **not** prove this: the vault never calls Supabase for an
   unauthenticated request.
2. **Build the app.** `eas build --platform android --profile production`.
   `EXPO_PUBLIC_VAULT_URL` was added to `eas.json` this session (see
   progress.md) — without it the build ships the variable undefined. Use
   `production` or `development`; `preview` has no `env` block at all and gets
   none of the Supabase vars either.
3. **Device test**, in this order, with `docker compose logs -f vault-service`
   open on the Pi: back up on a device that holds a key (expect `PUT` + `204`)
   → `docker compose exec vault-service ls -l /opt/sd-chat-vault/backups/` (one
   `<user-id>.b64`, 64 bytes) → check the `key_backups` row → reinstall or use a
   second device → sign in → `Recover from backup` → open a conversation and
   confirm messages decrypt.
4. **Time the passphrase steps.** That is scrypt on Hermes, the one number that
   could not be measured off-device. ~140ms on Node; if it is more than a few
   seconds on a phone, drop `SCRYPT_PARAMS.N` to `1 << 14` in
   `utility/securedMessage/VaultBackup.ts`. Backups written at the old value
   still open — the parameters travel with each one.

The failure worth watching for at step 3 is **"This backup does not match this
account"**: the recovered key did not match `profiles.public_key`, nothing was
written, and that would point at a real bug rather than user error.

### Still open after that
- **Promote ES256, then delete `SUPABASE_JWT_SECRET` from the Pi's `.env` and
  restart.** (2026-09-24: this is STILL needed. The 2026-09-23 note saying
  the promotion had already happened was wrong; see progress.md. Until then
  `SUPABASE_JWT_SECRET` **must stay** in `.env`, or every backup and recovery
  returns 401. Order: check that `jwks-cache.json` exists, promote in the
  dashboard, wait ~1h for sessions to refresh, then remove the secret.) The verifier picks the scheme per token, so no code change. Until
  then the Pi holds a symmetric secret that can mint `service_role` tokens,
  which makes it as sensitive as the service key. `DEPLOY.md` step 9.
- **Blob durability.** The volume is the SD card and nothing replicates it. The
  blobs are client-encrypted, so syncing them anywhere leaks nothing; there is a
  one-line `tar` snapshot command at the end of `DEPLOY.md`.
- **Rate limiting.** Now in Traefik (deployed 2026-09-24; the `429` path has not been checked). A
  Cloudflare WAF rule on the hostname is still worth adding, to stop requests
  at the edge.
- **Unmeasured gap**: conversations where this user has no wrapped key of their
  own stay unreadable after vault recovery. Worth counting before deciding
  whether to widen what the blob holds.

### Decisions taken (2026-09-22/23, user)
- **KDF**: scrypt via `@noble/hashes` (pure JS, no native module). Parameters
  stored per backup as `kdf_n` / `kdf_r` / `kdf_p`.
- **Blob scope**: identity private key only.
- **UX**: `BackupKey` from ManageKeys, `RecoverKey` from ScanningKeys.
- **Rotation**: overwrite, paired with a confirm-passphrase field and an
  explicit warning when a backup already exists.
- **JWT**: dual-mode now, ES256 promoted later.
- **Deployment**: Docker Compose in `/home/<user>/clouflared/` on the Pi,
  token-managed cloudflared with ingress in the Zero Trust dashboard
  (`backup/.*` → `http://vault-service:8443`). The `systemd/` units and
  `cloudflared/config.yml` are unused. Compose project name pinned to
  `sd-chat-vault` so the volume is not named after the directory.
- **Durability**: accepted as unsolved for now.

## Supabase → Pi replication — planning (2026-09-23), nothing built
Goal not yet fixed: **cold backup** (scheduled `pg_dump` + storage sync to the
Pi), **warm standby** (logical replication into Postgres on the Pi), or
**failover** (Pi serves the app when Supabase is down). Recommended: cold backup
first. Gaps found:
- No schema in the repo: no `supabase/migrations/` for the main project. Hand-applied
  tables and RPCs (`devices`, `device_pairing_requests`, `local_pairing_codes`,
  `key_backups`, `get_conversation_between_users`, `create_conversation_with_participants`,
  `get_messages_with_reactions`, …) exist only in the live DB. Capture them with
  `supabase db pull` before anything else.
- No DB connection string or DB password anywhere (only REST URL + keys).
  Direct connection is IPv6-only; from a home network use the session pooler (5432).
  Logical replication needs the direct connection.
- No Postgres on the Pi: `docker-compose.yml` only has vault + cloudflared + jwks.
  Match Supabase's PG major version; arm64 image.
- The Supabase-specific pieces won't restore into plain Postgres: `auth` schema,
  the `anon`/`authenticated`/`service_role` roles, RLS policies that call `auth.uid()`.
  Either dump `public` only with `--no-owner --no-acl`, or pre-create stubs.
- Storage buckets (`files`, `files_profiles`, `files_group`) are not in `pg_dump`.
  Needs Supabase S3 access keys + rclone. **Files are uploaded unencrypted**
  (`utility/handleStorage.ts`), unlike messages.
- Disk: the vault volume is already on the SD card with no replication; a DB
  replica needs a USB SSD.
- Privacy: the replica holds message ciphertext (fine) but also plaintext
  metadata, emails, push tokens, files and possibly `auth.users` password hashes.
  Needs to be encrypted at rest, and deleted accounts/messages stay in old
  snapshots, so a retention period has to be set.
- No scheduler, retention, monitoring or restore test yet.

## Keyless new device creates orphan chats — FIXED IN CODE 2026-09-24, needs device testing

**Status:** fixes 1–4 below are implemented (see progress.md, 2026-09-24).
Nothing has been run on a device yet. The crash (item 5) is still unexplained.
The diagnosis is kept below for reference.

### Reproduction (user's report)
1. Sign in on a **new device** that has no private key for the account.
2. Login succeeds and lands on the chat list, **not** the recovery screen.
3. Create a chat with user X. It opens and appears to work.
4. A few seconds later the app crashes to the phone's home screen.
5. Relaunch: the recovery screen appears (correct). Recover from the vault backup.
6. Create a chat with a **different** user Y.
7. On the **original** device, same account: the chat with Y opens, the
   **chat with X does not**.

### Why step 2 happens: the guard runs too late
`app/Bootstrap.tsx` runs its checks in this order: session → profile →
**biometric flags** → `verifyIdentityKey`. The biometric flags
(`SKIP`/`TOUCH_ID`/`FACE_ID` + userId) live in AsyncStorage, so **every new
device fails that check**. Bootstrap routes to `EnableBiometric` and returns.
`EnableBiometric.tsx` (lines 33, 48, 55) then goes straight to
`/tabs/(tabs)/Chat`. The identity check is never reached. On relaunch the flags
exist, Bootstrap gets as far as the identity check, and the recovery screen
appears. That is exactly what the user saw.

### Why step 3 "works" without a key
`MessageEncryption.wrapConversationKey` (`secured.ts:239`) **returns `null`**
when there is no private key; it does not throw. The callers treat `null` as
"skip":
- `createAndDistributeConversationKey` (`Chat.tsx` ~line 219): writes no row
  for the recipient and none for itself, **then returns the fresh key anyway**.
  `handleUserPress` saves it through `setCurrentConversation` (Secure Store,
  `ck_<userId>_<hash>`) and opens the room.
- `createGroupChat` (`Chat.tsx:99`): same pattern. Every participant's row is
  skipped, and the key is saved locally only.
- Also, `getOrCreateDM` / `createGroupConversation` have **already inserted the
  conversation and its participants** before any key exists. The conversation
  row is left behind even when key minting fails.

The result is an **orphan conversation**: the only copy of its key is in the
new device's Secure Store, and there are no wrapped key rows in
`conversation_participants`. Messages sent in it are encrypted with a key that
only that device holds.

### Why step 7: the first chat fails and the second works
- The chat with X has no wrapped row for this user, so the original device has
  nothing to unwrap (`resolveConversationKey` returns `absent`), and X cannot
  read it either.
- The chat with Y was created **after** recovery, when the private key existed
  and matched `profiles.public_key`, so its rows were wrapped correctly.

**Hidden risk:** in the `absent` case, `handleUserPress` (tapping the person in
the avatar list) **mints a new key** and writes rows. If the original device or
X does that for the orphan chat, the conversation ends up with **two different
keys**. The new device keeps its local one (local cache wins), and every
message it sent before becomes unreadable for everyone else. **Don't open the
orphan chat through the avatar list before the fix below is in.**

### The crash in step 4 is still unexplained
It is not proven by the code. Leading suspect: `unwrapConversationKey` **throws**
`No private key found` (`secured.ts:301`), unlike `wrap`, which returns null.
Anything that unwraps on the chat list or in the room (opening an existing
conversation, a realtime insert, a notification) will throw. An unhandled
rejection or a render-time throw in a release build would close the app. **If
it happens again, capture `adb logcat *:E ReactNativeJS:V`** (or the iOS device
console) before changing anything. Fix 1 below should make it impossible to
reach, but it is still worth confirming.

### Fix plan (implemented 2026-09-24, except item 5)
1. **Close the gate (main fix).** In `Bootstrap.tsx`, move
   `verifyIdentityKey` **above** the biometric branch, so a keyless device goes
   to `ScanningKeys` (recovery) before anything else. Also change
   `EnableBiometric` to `router.replace('/Bootstrap')` instead of going to
   `Chat` directly, so Bootstrap stays the only way in. For extra safety, add
   the same check to `app/tabs/(tabs)/_layout.tsx`, so no route (a deep link,
   a notification tap, `router.push` from anywhere) can reach the tabs without
   a valid key.
2. **Make key minting fail closed.** `wrapConversationKey` should **throw**
   when the private key is missing, not return `null`. In
   `createAndDistributeConversationKey` and `createGroupChat`, require the
   **self** row to be written before the key is saved locally or the room is
   opened. If that fails, show an alert, don't store anything and don't
   navigate. Optionally call `verifyIdentityKey` first, so we never mint with a
   key that doesn't match the profile either.
3. **Don't leave empty conversations behind.** Either run the key check before
   `getOrCreateDM` / `createGroupConversation`, or delete the conversation when
   minting fails. The check-first option is simpler and needs no server change.
4. **Repair the existing orphan chat (self-heal backfill).** The recovered
   device **still holds the X chat's key** in Secure Store, and now has a valid
   identity key. When a conversation opens and the key is found **locally**
   but this user's participant row has no `wrapped_key`, wrap the key for
   **every participant whose row is empty** (including self) and write those
   rows. **Only fill empty rows, never overwrite existing ones**, or we recreate
   the two-key problem. That recovers the X chat for the original device and
   for X, without the user having to do anything. Run it from the recovered
   device.
5. **Crash:** reproduce once with logs attached (see above), before or after
   fix 1, to confirm the suspect.

### Checks after the fix
- New device, no key, first login: lands on the recovery screen, never on the
  chat list. Check both **Skip** and **Enable Touch/Face ID** on `EnableBiometric`.
- Force a missing key (delete the Secure Store entry): creating a DM or a group
  shows an error, **no conversation row** appears in Supabase, and nothing is
  saved locally.
- Orphan X chat: open it on the recovered device → the rows are filled in →
  it opens on the original device and on X's device, and the old messages
  decrypt.
- A chat whose rows are already filled is left untouched by the backfill.
- **Avatar-list guard:** on the original device, tapping X in the avatar list
  *before* the recovered device has repaired the chat should show "Conversation
  key not available", not open a new, second key.
- **Group creator row:** create a group, then check in Supabase that the
  creator's own `conversation_participants` row now has a `wrapped_key`. It
  used to stay empty.
- **After recovery:** a new device that recovers its key lands on Settings and
  skips `EnableBiometric` that first time. It should appear on the next launch.
  Confirm, and decide whether that is acceptable.
- **RLS assumption:** the backfill writes *other* participants' rows, and
  `hasMessages` counts with `head: true`. Group creation already writes other
  people's rows, so the first should be allowed. If either query is refused,
  the console shows `Unable to backfill…`, or the avatar-list alert appears
  for every existing chat.

## Traefik + load-balanced vault replicas — DEPLOYED, working (2026-09-24)
Live on the Pi and confirmed by the user: backups go through
`cloudflared → traefik:8000 → vault-1/vault-2`. The tunnel's Public Hostname
now points at `http://traefik:8000` (path `backup/.*`).

### Still to do
1. **Confirm which 401 fix was applied**: `grep SUPABASE_JWT_SECRET ~/clouflared/.env`
   and check which key is Current in Supabase → JWT Keys.
   - If the secret was restored, promoting ES256 is still pending (see the
     vault section above for the order).
   - If ES256 was promoted, delete the secret from `.env` (if it is still
     there) and run `docker compose up -d`.
2. **Check the parts nobody has tested yet**:
   - the rate limit (about 20 fast `curl`s from outside should return `429`)
   - a normal backup, then recover, from the app, without hitting that limit
   - a rolling restart (`up -d --no-deps vault-1`, then `vault-2`) with no
     failed requests
   - the dashboard over SSH, showing both servers up
3. **Pin the images**: `traefik:v3` → the exact version now running
   (`docker compose exec traefik traefik version`), and `cloudflared:latest`
   → its running version.
4. **Optional**: a Cloudflare WAF rate-limit rule on `sd-chat-tunnel.bid`, to
   stop abusive traffic at the edge instead of on the Pi.

### Decisions taken (defaults, not confirmed by the user)
- Tunnel only, no LAN access. Answered implicitly by going ahead; revisit if
  LAN access is wanted.
- File provider, no Docker socket. Two replicas, round-robin, health check
  every 10s, retry ×2 on connection errors only.
- The load balancer is **single-host**: it covers crashes and zero-downtime
  restarts, not a dead Pi or SD card. A second machine needs shared or
  replicated blob storage first, which is the same gap as "Blob durability"
  above.
