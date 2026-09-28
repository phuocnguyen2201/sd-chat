# Manage Keys Screen

**Source:** [`app/tabs/managekeys/ManageKeys.tsx`](../../../../app/tabs/managekeys/ManageKeys.tsx)

`ManageKeys` is the "sharing device" side of key sync, and also the hub screen for both directions (it renders the `Share Keys` / `Receive Keys` entry points). It is reached from `BiometricAuthentication` after a successful biometric check.

## Flow

1. **Idle** – shows a `Share Keys` button and instructions to run the OTHER device's `Receive Keys` flow first.
2. Tapping `Share Keys` pushes `/tabs/managekeys/PairingCode` (see `PairingCode.md`), which proves the two devices are physically together via a server-checked 4-digit code before anything key-related happens.
3. Once `PairingCode` confirms the code was verified, it routes back here with `?autoShare=1`, which auto-triggers `shareKeys()` — no extra tap needed.
4. `shareKeys()` (since 2026-09-28, security #4):
   - Takes the code this device displayed from memory (`LocalKeyTransfer.takeIssuedCode()`, set by `PairingCode`).
   - Reads `LocalPairingCode.status()`: it must be `verified` and carry the new device's one-time public key and `keyProof`.
   - Checks `LocalKeyTransfer.verifyKeyProof(userId, code, key, proof)`. If it fails, nothing is shared.
   - Builds the payload with `buildKeySyncPayload()` (the private key plus every conversation key) and **seals it** with `DevicePairing.sealForPeer(key, payload)` (X25519 ECDH → HKDF-SHA512 → ChaCha20-Poly1305).
   - Renders the resulting `pair_data` JSON as the QR (`show_sealed` phase) with a 30 s countdown, plus a 4-character **pairing check** (`LocalKeyTransfer.pairingCheck(key)`).
   - If the QR text would exceed 2,900 characters (too many conversations), it refuses and points to "Back up my key".
5. The receiving device scans that QR in `ScanningKeys` and opens it with its one-time secret. See `ScanningKeys.md`.

`Done` currently calls `cancel()`, which clears the QR and returns to the `idle` phase (staying on this screen). A pending change will route it to Settings instead — see `in-progress.md`.

## QR rendering requirements (do not regress — fixed 2026-09-17)

The `<QRCode>` here must keep **all three** of these, or the code becomes undecodable by every scanner while still looking correct to a human:

- **`quietZone={16}`** — `react-native-qrcode-svg` defaults to `quietZone = 0`. The QR spec requires a blank margin of ≥4 modules so decoders can locate the finder patterns.
- **`bg-white` on the wrapping `Box`** — the library paints white only out to the code's exact edge, and this screen's `ScrollView` has no background class, so without this the quiet zone is the *app's dark background* in dark mode. This was the original bug: unreadable in dark mode, fine in light.
- **`size={260}`** — at the previous `size={200}` a dense code was ~2.6dp per module, at the edge of what a phone camera can resolve off another phone's screen.

Since sealing (2026-09-28) the QR uses `ecl="L"`: the sealed JSON is about 1.4× the old plaintext (roughly 140 characters per conversation), and L gives the most capacity. `MAX_QR_CHARS = 2900` stays under L's 2,953-byte limit, which works out to roughly 20 conversations.

Payload size scales with the number of conversations, so a user with many chats gets a denser code. If scanning becomes unreliable again, check the payload length before suspecting the camera.

`Receive Keys` pushes `/tabs/managekeys/EnterPairingCode` (the new device's half of the same code gate) rather than going straight to `ScanningKeys`.

`Back up my key` pushes `/tabs/managekeys/BackupKey`, the entry point to the vault — the recovery path that does not need a second device. It sits on this screen, behind the same biometric gate, because there is nothing to back up unless this device already holds the key. See `BackupKey.md`.

## Security model (sealed again 2026-09-28, security #4)

From 2026-09-16 (`4e02cce`) to 2026-09-28 this QR held the private key and every conversation key **in plaintext**. The old two-QR handshake had been removed because the new device had to show a QR first. The current design keeps the single-QR steps the user sees and gets the sealing back:

- While entering the pairing code, the new device creates a one-time X25519 key pair (`DevicePairing.startPairing`). The public half and `keyProof = HMAC-SHA256("sd-chat-pairing-proof-v1|userId|code", publicKey)` travel with the code (`local-code-verify`). The server stores both on the `local_pairing_codes` row and returns them from `local-code-status`.
- This screen seals only after the proof matches the code it displayed, so nobody without the code can substitute a key. The QR holds ciphertext that only the device with the one-time secret can open. **A photo of the QR is useless.**
- **Residual risk:** whoever controls the database can brute-force a 4-digit `code_hash` and swap the key. The pairing check shown on both screens lets the user catch that (same trust level as security #7).
- Old plaintext QRs are refused by `ScanningKeys`, and the server refuses `local-code-verify` without the key fields. Both devices must run the new build.

## Related

- `app/tabs/managekeys/PairingCode.tsx` — the 4-digit code gate this screen pushes into before sharing.
- `app/tabs/managekeys/EnterPairingCode.tsx` — the 4-digit code gate for the receiving side.
- `utility/securedMessage/KeySyncPayload.ts` — builds the `KeyObject` that gets sealed.
- `utility/securedMessage/LocalKeyTransfer.ts` / `DevicePairing.ts` — key proof, pairing check, issued-code holder; seal/open.
- `app/tabs/managekeys/BackupKey.tsx` — the vault backup flow this screen links to.
- For the server-relayed alternative (no camera, works when devices aren't in the same room), see `documentation/supabase/README.md` (`device-pairing` function) and `utility/securedMessage/RemoteDevicePairing.ts` — not yet wired into a screen.
