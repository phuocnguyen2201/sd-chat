# Scanning Keys Screen

**Source:** [`app/tabs/managekeys/ScanningKeys.tsx`](../../../app/tabs/managekeys/ScanningKeys.tsx)

`ScanningKeys` is the "receiving device" side of key sync. It is reached from `EnterPairingCode` (see `EnterPairingCode.md`) after that screen's 4-digit code is verified — never directly from `ManageKeys`.

## Flow (single phase)

1. **Scan** (`scan`) – opens the camera (`components/QrScannerView`) and waits for the plaintext `KeyObject` QR shown by `ManageKeys`.
2. On a scan, parses the QR as JSON and checks it has a `list` array (`isArray`) before trusting it — not a full shape/signature check.
3. `importKeysToNewDevice()` validates: a session exists, the payload's `userId` matches the signed-in user, and `validTime` hasn't passed (`Date.now() > payload.validTime` → "QR code expired" alert).
4. On success, restores the private key via `MessageEncryption.setPrivateKey()` and stores any conversation keys not already present via `ConversationKeyManager`, then shows the `done` completion dialog (`Ok` returns to Settings).

## Security model (changed 2026-09-16, commit `4e02cce`)

This screen previously generated its own ephemeral key pair and scanned a *second*, AEAD-sealed QR from `ManageKeys` (`DevicePairing.openFromPeer()`), so an intercepted QR never contained a usable secret. **That handshake was removed** — this screen now scans and directly trusts the single plaintext QR `ManageKeys` renders. The account/session ownership (`userId` match) and expiry (`validTime`) checks are unchanged in spirit, but there is no cryptographic binding between this device and the QR anymore; anyone who captures the QR image within its 30s window can decrypt the account's messages. See `ManageKeys.md` for the full picture and what's still gating access (`EnterPairingCode`'s 4-digit code).

`utility/securedMessage/DevicePairing.ts` is no longer imported here — see `ManageKeys.md`'s note on it being dead code.

## Related

- `app/tabs/managekeys/EnterPairingCode.tsx` — the 4-digit code gate that must pass before this screen is reachable.
- `components/QrScannerView.tsx` — shared camera/permission component.
- `utility/types/user.ts` — `KeyObject` is the shape scanned here.
