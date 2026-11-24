# Security & Backup Screen

**Source:** [`app/tabs/managekeys/SecurityBackup.tsx`](../../../../app/tabs/managekeys/SecurityBackup.tsx)
**Route:** `/tabs/managekeys/SecurityBackup` (stack title "Security & Backup", registered in `app/tabs/_layout.tsx`)

## Overview
Opened from Settings (the "Security & Backup" row, **Open** button, testID `security-backup-button`). It groups the three security options that used to sit directly on the Settings screen.

## Options
| Option | Button (testID) | Action |
|---|---|---|
| Key Management | Manage Keys (`manage-keys-button`) | Pushes `/tabs/managekeys/ManageKeys` (share, receive, back up keys). |
| Biometric Authentication | Manage Biometrics (`manage-biometrics-button`) | Pushes `/tabs/managekeys/EnableBiometric` with `previousScreen: 'setting'`, so it does not redirect to Chat afterwards. |
| App PIN | Set up PIN / Change PIN (`manage-app-pin-button`) | Runs `managePin()` from `useConfirmIdentity`; shows "App PIN saved" for 3 s when changed. |

## State
- `hasAppPin`: from `AppPin.hasPin(user.id)` on mount and after `managePin()`; shown as Set / Not set.
- `successMessage`: the green banner after a PIN change.

## Tests
Maestro `subflows/open-manage-keys.yaml` goes Settings → `security-backup-button` → Manage Keys.
