# Biometric Authentication Screen

**Source:** [`app/tabs/managekeys/BiometricAuthentication.tsx`](../../../app/tabs/managekeys/BiometricAuthentication.tsx)

This screen is the access check before opening the key-management QR screen.

## Behavior

- Offers Touch ID and Face ID actions.
- Both actions call `checkBiometricAvailability()`.
- When the check succeeds, navigates to `/tabs/managekeys/ManageKeys`.
- Shows an alert when biometric authentication is unavailable or fails.
- The Back action returns to `/tabs/(tabs)/Settings`.

The screen checks availability but does not itself persist biometric preferences. Preference persistence is handled by `EnableBiometric`.
