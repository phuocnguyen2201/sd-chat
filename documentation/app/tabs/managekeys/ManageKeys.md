# Manage Keys Screen

**Source:** [`app/tabs/managekeys/ManageKeys.tsx`](../../../app/tabs/managekeys/ManageKeys.tsx)

`ManageKeys` is the "sharing device" side of key sync, and also the hub screen for both directions (it renders the `Share Keys` / `Receive Keys` entry points). It is reached from `BiometricAuthentication` after a successful biometric check.

## Flow

1. **Idle** – shows a `Share Keys` button and instructions to run the OTHER device's `Receive Keys` flow first.
2. Tapping `Share Keys` pushes `/tabs/managekeys/PairingCode` (see `PairingCode.md`), which proves the two devices are physically together via a server-checked 4-digit code before anything key-related happens.
3. Once `PairingCode` confirms the code was verified, it routes back here with `?autoShare=1`, which auto-triggers `shareKeys()` — no extra tap needed.
4. `shareKeys()` builds the key-sync payload via `buildKeySyncPayload()` (`utility/securedMessage/KeySyncPayload.ts`: the local private key plus every conversation key this device holds) and renders it **directly, as plaintext JSON**, in a QR code (`show_sealed` phase), with a 30s countdown after which the QR is cleared.
5. The receiving device scans that QR in `ScanningKeys` — see `ScanningKeys.md`.

`Receive Keys` pushes `/tabs/managekeys/EnterPairingCode` (the new device's half of the same code gate) rather than going straight to `ScanningKeys`.

## Security model (changed 2026-09-16, commit `4e02cce`)

This screen previously ran a two-QR ephemeral-ECDH handshake (`utility/securedMessage/DevicePairing.ts`) so that a bystander who photographed a QR never got a usable private key. **That layer was removed.** The QR rendered in step 4 now contains the private key in the clear — the code comment and on-screen copy both say so. The only protection left against an unintended recipient is:

- The 4-digit `PairingCode` gate (server-checked, rate-limited, short-lived — see `PairingCode.md` and `documentation/supabase/README.md`) that must be verified before a QR is ever generated.
- The 30s QR display window.

`utility/securedMessage/DevicePairing.ts` (`sealForPeer`/`openFromPeer`/ephemeral key pairs) is no longer imported by this screen or `ScanningKeys` and is currently dead code — nothing in the app calls it. It has not been deleted; see `in-progress.md`.

## Related

- `app/tabs/managekeys/PairingCode.tsx` — the 4-digit code gate this screen pushes into before sharing.
- `app/tabs/managekeys/EnterPairingCode.tsx` — the 4-digit code gate for the receiving side.
- `utility/securedMessage/KeySyncPayload.ts` — builds the `KeyObject` rendered into the QR.
- For the server-relayed alternative (no camera, works when devices aren't in the same room), see `documentation/supabase/README.md` (`device-pairing` function) and `utility/securedMessage/RemoteDevicePairing.ts` — not yet wired into a screen.
