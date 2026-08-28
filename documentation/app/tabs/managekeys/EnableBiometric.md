# Enable Biometric Screen

**Source:** [`app/tabs/managekeys/EnableBiometric.tsx`](../../../app/tabs/managekeys/EnableBiometric.tsx)

This screen is shown during first authenticated startup when the user has not enabled or skipped biometric setup. It can also be opened from Settings with `previousScreen=setting`.

## Actions

- **Enable Touch ID:** confirms, then stores `true` under the user-specific Touch ID key.
- **Enable Face ID:** confirms, then stores `true` under the user-specific Face ID key.
- **Skip:** stores the user-specific skip flag as `true` and opens Chat.
- **Back behavior:** when opened from Settings, enabling a biometric method stays on the screen; startup enrollment continues to Chat after a successful enable.

Existing enabled methods show an alert instead of writing again. Values are stored with `AsyncStorage` and key names from `Constants.ASYNC_STORAGE_KEYS`.
