# Manage Keys Screen

**Source:** [`app/tabs/managekeys/ManageKeys.tsx`](../../../app/tabs/managekeys/ManageKeys.tsx)

`ManageKeys` is the "sharing device" side of local QR-based key sync. It no longer puts key material directly into a QR code — a bystander who photographs the screen at any point in the flow gets either a bare ephemeral public key or ciphertext, never a usable private key.

## Flow (two QR codes, not one)

1. **Idle** – shows a `Share Keys` button and instructions to start the *other* device's `Receive Keys` flow first.
2. **Scan peer** (`scan_peer`) – opens the device camera (`components/QrScannerView`) and scans the `pair_init` QR shown by the receiving device (see `ScanningKeys.md`). That payload carries only an ephemeral X25519 public key, a `userId`, and an `expiresAt`.
3. Validates the scanned code: well-formed `pair_init` shape, not expired, and (when both sides know it) the `userId` matches the current session — refuses to proceed otherwise.
4. Builds the key-sync payload via the shared `buildKeySyncPayload()` helper (`utility/securedMessage/KeySyncPayload.ts`): the local private key plus every conversation key this device holds, exactly as before.
5. Seals that payload to the scanned ephemeral public key with `DevicePairing.sealForPeer()` (ECDH + HKDF + ChaCha20-Poly1305, `utility/securedMessage/DevicePairing.ts`) and renders the resulting ciphertext as a second QR (`show_sealed`), with a 30s countdown.
6. The receiving device scans that second QR and unwraps it locally — see `ScanningKeys.md`.

## What changed from the old single-QR flow

- The old `ManageKeys` rendered one QR containing the raw `KeyObject` (private key + conversation keys) as plaintext JSON, expiring only by a client-side countdown that a captured screenshot could ignore entirely.
- The new flow never puts a private key into a QR. Only an ephemeral public key (step 2) or AEAD ciphertext bound to that specific key (step 5) is ever rendered.
- `Regenerate QR` was removed; there is no persistent QR to regenerate — each `Share Keys` attempt starts a fresh scan/seal cycle with a fresh ephemeral key pair on the receiving side.

## Related

- `components/QrScannerView.tsx` — shared camera/permission component used by both this screen and `ScanningKeys`.
- `utility/securedMessage/DevicePairing.ts` — holds the local pairing crypto and in-memory ephemeral key state for this (QR) transport.
- For the newer server-relayed alternative (no camera, works when devices aren't in the same room), see `documentation/supabase/README.md` (`device-pairing` function) and `utility/securedMessage/RemoteDevicePairing.ts` — not yet wired into a screen.
