# Scanning Keys Screen

**Source:** [`app/tabs/managekeys/ScanningKeys.tsx`](../../../app/tabs/managekeys/ScanningKeys.tsx)

This screen uses the device camera to scan a QR payload produced by `ManageKeys` and import encryption keys.

## Flow

- Requests camera permission and shows a grant-permission action when needed.
- Scans QR barcodes with `CameraView`.
- Accepts the current JSON `KeyObject` format with `req: "sync_key"`.
- Also parses the legacy semicolon-separated key format.
- Requires the scanned payload to belong to the currently logged-in account.
- Restores the private key when present and stores missing conversation keys through `ConversationKeyManager`.
- Shows a completion dialog after import and returns to Settings when confirmed.

Invalid payloads, a missing session, an account mismatch, and import failures are reported with alerts. Existing conversation keys are left unchanged.
