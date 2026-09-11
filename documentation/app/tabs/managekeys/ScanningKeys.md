# Scanning Keys Screen

**Source:** [`app/tabs/managekeys/ScanningKeys.tsx`](../../../app/tabs/managekeys/ScanningKeys.tsx)

`ScanningKeys` is the "receiving device" side of local QR-based key sync. It initiates the handshake rather than only consuming a QR — this is what lets `ManageKeys` avoid ever encoding a private key directly.

## Flow (two phases)

1. **Show own code** (`show_own_code`) – on mount, generates a one-time X25519 key pair via `DevicePairing.startPairing(user?.id)` (kept in memory only, never persisted) and renders the resulting `pair_init` payload as a QR, with a 60s countdown. A `Generate a new code` action is offered once it expires.
2. User taps `Next: Scan the reply code` once the other device has scanned that QR and is showing its sealed reply.
3. **Scan sealed** (`scan_sealed`) – opens the camera (`components/QrScannerView`) and scans the `pair_data` QR produced by `ManageKeys`.
4. Unwraps it with `DevicePairing.openFromPeer()`, which fails closed unless this device still holds the matching ephemeral private key and the payload hasn't expired — then wipes that ephemeral key from memory regardless of outcome.
5. On success, imports the recovered `KeyObject` the same way the old flow did: restores the private key via `MessageEncryption.setPrivateKey()` and stores any conversation keys not already present via `ConversationKeyManager`, then shows the completion dialog.

Invalid QR shapes, an expired pairing session, a decrypt/authentication failure, a missing session, or an account mismatch are all reported via `Alert` and, where applicable, restart the pairing cycle with a fresh ephemeral key pair (`generateOwnCode()`).

## What changed from the old single-QR flow

- Previously this screen only scanned a single, self-contained QR (the current JSON `KeyObject` format, plus a legacy semicolon-separated format) that already contained the plaintext private key. Both are gone — a bystander scanning a QR shown at any point in the new flow gets no decryptable secret.
- The account/session ownership check is unchanged in spirit: the recovered payload's `userId` still must match the signed-in user before any key is imported.

## Related

- `components/QrScannerView.tsx` — shared camera/permission component.
- `utility/securedMessage/DevicePairing.ts` — ephemeral key generation, sealing, and unwrapping for this transport.
- `utility/types/user.ts` — `PairInitPayload` / `PairDataPayload` shapes exchanged over the two QR codes.
