# Manage Keys Screen

**Source:** [`app/tabs/managekeys/ManageKeys.tsx`](../../../app/tabs/managekeys/ManageKeys.tsx)

`ManageKeys` creates a QR code containing the current user's key-sync payload.

## Payload generation

1. Reads conversation snapshots from local storage.
2. Reads the private key from `MessageEncryption`.
3. Verifies which snapshot conversations have a locally available conversation key.
4. Adds those conversation IDs and keys to a `KeyObject` payload.
5. Includes the private key when a user ID and private key are available.
6. Serializes the payload and renders it as a QR code.

The payload uses `req: "sync_key"` and is intended for import on another device. The screen warns users to share it only with trusted parties because it contains key material.

## Navigation and current limitation

- `Scan QR` opens `/tabs/managekeys/ScanningKeys`.
- `Regenerate QR` is currently rendered but has no implementation; the QR value is generated from current local state.
- The screen is normally reached after biometric verification from `BiometricAuthentication`.
