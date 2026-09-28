# Scanning Keys Screen

**Source:** [`app/tabs/managekeys/ScanningKeys.tsx`](../../../../app/tabs/managekeys/ScanningKeys.tsx)

`ScanningKeys` is the "receiving device" side of key sync. It is reached from `EnterPairingCode` (see `EnterPairingCode.md`) after that screen's 4-digit code is verified — never directly from `ManageKeys`.

## Flow (single phase)

1. **Scan** (`scan`):
   - If `EnterPairingCode` left a one-time key in memory (`DevicePairing.publicKey()`), the screen opens the camera (`components/QrScannerView`) and shows the **pairing check** for that key.
   - Without one (app restarted, or arrived another way), it shows "Enter the pairing code from your other device first" with a button back to `EnterPairingCode`. There's no point scanning, since nothing could be opened.
2. On a scan, the QR is parsed as JSON:
   - A legacy plaintext `KeyObject` is refused: "Update the app on your other device".
   - Anything that isn't `pair_data` is refused.
   - `DevicePairing.openFromPeer()` decrypts it with the one-time secret. A QR sealed for another device fails with "made for a different device". An expired one sends the user back to enter a new code.
3. `importKeysToNewDevice()` validates: a session exists, the payload's `userId` matches the signed-in user, and `validTime` hasn't passed.
4. On success, restores the private key via `MessageEncryption.setPrivateKey()` and stores any conversation keys not already present via `ConversationKeyManager`, then shows the `done` completion dialog (`Ok` returns to Settings).

## The way out when there is nothing to scan

Below the camera, this screen offers `Recover from backup`, which pushes `/tabs/managekeys/RecoverKey`. That matters most when the key guard has sent someone to `EnterPairingCode` with `?recovery=1` — a device holding no usable key, whose owner may have no second device to scan from. `EnterPairingCode` in recovery mode links here ("No other device?") without a pairing in progress. The `recovery=1` branch additionally offers account deletion, as the last resort when neither a QR nor a backup exists.

See `RecoverKey.md` for what recovery restores (the identity key) and what it does not (conversation keys, which come back lazily through `ConversationKeyResolver`).

## Security model (sealed again 2026-09-28, security #4)

The QR is only useful to the device holding the one-time secret made in `EnterPairingCode`. That secret lives in `DevicePairing`'s module memory only (never persisted or passed through navigation) and is wiped after one use and when this screen unmounts. See `ManageKeys.md` for the full design and the residual risk the pairing check covers.

## Camera component notes (`components/QrScannerView.tsx`)

- **`autofocus="on"` is required.** `expo-camera` internally resolves `newProps.autoFocus = props?.autofocus ?? 'off'`, so omitting the prop leaves the camera with focus **locked**, which struggles with a dense QR at close range.
- The preview is wrapped in a `Box` carrying the themed border (`border-gray-300` / `dark:border-gray-600`). `CameraView` is a native component and is not wired into NativeWind in this project, so `className` cannot be applied to it directly — theme-aware styling has to live on the wrapper.
- `hasScannedRef` latches after the first successful read, because `onBarcodeScanned` keeps firing for as long as the code stays in frame; the parent's `active` prop resets it.
- If scanning ever appears broken again, suspect the **generated** QR before the camera — see the "QR rendering requirements" section in `ManageKeys.md`. A silent failure with a live preview and no logs is the signature of an undecodable code, not a broken scanner.

## Related

- `app/tabs/managekeys/EnterPairingCode.tsx` — the 4-digit code gate that must pass before this screen is reachable.
- `components/QrScannerView.tsx` — shared camera/permission component.
- `utility/types/user.ts` — `PairDataPayload` is the shape scanned here; `KeyObject` is what it decrypts to.
- `app/tabs/managekeys/RecoverKey.tsx` — the vault recovery flow this screen links to.
