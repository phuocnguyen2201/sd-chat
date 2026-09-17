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
- Noted but not changed: `.env` spells the pairing URL `EXPO_PUBLIC_PAIRTING_KEY_URL` (typo) while `eas.json` spells it `EXPO_PUBLIC_PAIRING_KEY_URL`. No code references either yet, so it is not an active bug.
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
