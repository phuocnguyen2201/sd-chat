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
