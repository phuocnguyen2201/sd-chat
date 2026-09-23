# Manage Keys Screen

**Source:** [`app/tabs/managekeys/ManageKeys.tsx`](../../../../app/tabs/managekeys/ManageKeys.tsx)

`ManageKeys` is the "sharing device" side of key sync, and also the hub screen for both directions (it renders the `Share Keys` / `Receive Keys` entry points). It is reached from `BiometricAuthentication` after a successful biometric check.

## Flow

1. **Idle** – shows a `Share Keys` button and instructions to run the OTHER device's `Receive Keys` flow first.
2. Tapping `Share Keys` pushes `/tabs/managekeys/PairingCode` (see `PairingCode.md`), which proves the two devices are physically together via a server-checked 4-digit code before anything key-related happens.
3. Once `PairingCode` confirms the code was verified, it routes back here with `?autoShare=1`, which auto-triggers `shareKeys()` — no extra tap needed.
4. `shareKeys()` builds the key-sync payload via `buildKeySyncPayload()` (`utility/securedMessage/KeySyncPayload.ts`: the local private key plus every conversation key this device holds) and renders it **directly, as plaintext JSON**, in a QR code (`show_sealed` phase), with a 30s countdown after which the QR is cleared.
5. The receiving device scans that QR in `ScanningKeys` — see `ScanningKeys.md`.

`Done` currently calls `cancel()`, which clears the QR and returns to the `idle` phase (staying on this screen). A pending change will route it to Settings instead — see `in-progress.md`.

## QR rendering requirements (do not regress — fixed 2026-09-17)

The `<QRCode>` here must keep **all three** of these, or the code becomes undecodable by every scanner while still looking correct to a human:

- **`quietZone={16}`** — `react-native-qrcode-svg` defaults to `quietZone = 0`. The QR spec requires a blank margin of ≥4 modules so decoders can locate the finder patterns.
- **`bg-white` on the wrapping `Box`** — the library paints white only out to the code's exact edge, and this screen's `ScrollView` has no background class, so without this the quiet zone is the *app's dark background* in dark mode. This was the original bug: unreadable in dark mode, fine in light.
- **`size={260}`** — the payload (private key + every conversation key, ~558 chars in testing) at the default `ecl="M"` produces a ~77×77-module code. At the previous `size={200}` that is ~2.6dp per module, at the edge of what a phone camera can resolve off another phone's screen.

Payload size scales with the number of conversations, so a user with many chats gets a denser code. If scanning becomes unreliable again, check the payload length before suspecting the camera.

`Receive Keys` pushes `/tabs/managekeys/EnterPairingCode` (the new device's half of the same code gate) rather than going straight to `ScanningKeys`.

`Back up my key` pushes `/tabs/managekeys/BackupKey`, the entry point to the vault — the recovery path that does not need a second device. It sits on this screen, behind the same biometric gate, because there is nothing to back up unless this device already holds the key. See `BackupKey.md`.

## Security model (changed 2026-09-16, commit `4e02cce`)

This screen previously ran a two-QR ephemeral-ECDH handshake (`utility/securedMessage/DevicePairing.ts`) so that a bystander who photographed a QR never got a usable private key. **That layer was removed.** The QR rendered in step 4 now contains the private key in the clear — the code comment and on-screen copy both say so. The only protection left against an unintended recipient is:

- The 4-digit `PairingCode` gate (server-checked, rate-limited, short-lived — see `PairingCode.md` and `documentation/supabase/README.md`) that must be verified before a QR is ever generated.
- The 30s QR display window.

`utility/securedMessage/DevicePairing.ts` (`sealForPeer`/`openFromPeer`/ephemeral key pairs) is no longer imported by this screen or `ScanningKeys` and is currently dead code — nothing in the app calls it. It has not been deleted; see `in-progress.md`.

## Related

- `app/tabs/managekeys/PairingCode.tsx` — the 4-digit code gate this screen pushes into before sharing.
- `app/tabs/managekeys/EnterPairingCode.tsx` — the 4-digit code gate for the receiving side.
- `utility/securedMessage/KeySyncPayload.ts` — builds the `KeyObject` rendered into the QR.
- `app/tabs/managekeys/BackupKey.tsx` — the vault backup flow this screen links to.
- For the server-relayed alternative (no camera, works when devices aren't in the same room), see `documentation/supabase/README.md` (`device-pairing` function) and `utility/securedMessage/RemoteDevicePairing.ts` — not yet wired into a screen.
