# App Documentation

This folder documents the current Expo Router application under `app/`.

## Startup and navigation

- [`index.tsx`](../../app/index.tsx) redirects the root route to [`Bootstrap.tsx`](../../app/Bootstrap.tsx).
- [`Bootstrap.tsx`](Bootstrap.md) restores the session, initializes push notifications for authenticated users, and selects the next route.
- [`login.tsx`](../../app/login.tsx) handles sign-in and registration. It returns to `Bootstrap` after sign-in.
- [`CompleteProfile.tsx`](../../app/CompleteProfile.tsx) collects the required display name and optional avatar.
- [`tabs/_layout.tsx`](../../app/tabs/_layout.tsx) registers the chat, message, and key-management stack routes.

## Route map

| Route | Source | Purpose |
| --- | --- | --- |
| `/` | `index.tsx` | Redirects to startup bootstrap |
| `/Bootstrap` | `Bootstrap.tsx` | Restores session and routes the user |
| `/login` | `login.tsx` | Sign in or register |
| `/CompleteProfile` | `CompleteProfile.tsx` | Complete display name and avatar |
| `/tabs/(tabs)/Chat` | `tabs/(tabs)/Chat.tsx` | Search users, open chats, and create groups |
| `/tabs/(tabs)/Settings` | `tabs/(tabs)/Settings.tsx` | Profile, account, theme, and security settings |
| `/tabs/msg/[room_id]` | `tabs/msg/[room_id].tsx` | Encrypted conversation room |
| `/tabs/msg/ChatRoomEditing` | `tabs/msg/ChatRoomEditing.tsx` | Edit group details and browse shared files |
| `/tabs/managekeys/EnableBiometric` | `tabs/managekeys/EnableBiometric.tsx` | Enable or skip biometric setup |
| `/tabs/managekeys/BiometricAuthentication` | `tabs/managekeys/BiometricAuthentication.tsx` | Authenticate before key management |
| `/tabs/managekeys/ManageKeys` | `tabs/managekeys/ManageKeys.tsx` | Hub screen; generates the key-sync QR after the pairing code is verified |
| `/tabs/managekeys/PairingCode` | `tabs/managekeys/PairingCode.tsx` | Old device: show a 4-digit same-room pairing code |
| `/tabs/managekeys/EnterPairingCode` | `tabs/managekeys/EnterPairingCode.tsx` | New device: enter that code |
| `/tabs/managekeys/ScanningKeys` | `tabs/managekeys/ScanningKeys.tsx` | Scan and import a key QR payload |
| `/tabs/managekeys/BackupKey` | `tabs/managekeys/BackupKey.tsx` | Seal the identity key behind a passphrase and upload it to the vault |
| `/tabs/managekeys/RecoverKey` | `tabs/managekeys/RecoverKey.tsx` | Recover the identity key from the vault when no device is left to pair with |

## Authenticated startup flow

1. The root route redirects to `Bootstrap`.
2. `SessionProvider` restores the session and profile.
3. No authenticated user routes to `/login`.
4. An authenticated user without `profile.displayname` routes to `/CompleteProfile`.
5. A profile-complete user without a skip flag or enabled Touch ID/Face ID routes to `/tabs/managekeys/EnableBiometric`.
6. Otherwise the user routes to `/tabs/(tabs)/Chat`.

Push notification registration and notification response handling are centralized in `Bootstrap`; the chat screen refreshes its conversation list when a notification is received.

## Shared implementation boundaries

- Session, theme, current conversation, and conversation-key state live in `utility/session/SessionProvider`.
- Authentication, profile, conversation, message, and reaction calls are exposed by `utility/messages`.
- Message encryption uses `utility/securedMessage/secured`; conversation keys are cached by `ConversationKeyManager`.
- Device-to-device key sync gates `ManageKeys`/`ScanningKeys` behind a same-room 4-digit code (`PairingCode`/`EnterPairingCode`, `utility/securedMessage/LocalPairingCode`), then shares a plaintext key QR built by `utility/securedMessage/KeySyncPayload`. A separate, not-yet-wired server-relayed transport (`RemoteDevicePairing`, `DeviceIdentity`) also exists. See `tabs/managekeys/ManageKeys.md`, `PairingCode.md`, `EnterPairingCode.md`, `ScanningKeys.md`, and `documentation/supabase/README.md`.
- A second, independent recovery path stores the identity key encrypted at rest on a self-hosted vault (`utility/securedMessage/VaultBackup.ts`, `tabs/managekeys/BackupKey.tsx`, `RecoverKey.tsx`). Unlike pairing it needs no second device, but it needs the user to remember a recovery passphrase. See `tabs/managekeys/BackupKey.md`, `RecoverKey.md`, and `sd-chat-vault/DEPLOY.md`.
- Avatars and message/group files use `utility/handleStorage`.
- Gluestack UI primitives are under `components/ui`; `components/QrScannerView` is a shared camera/permission component used by the key-management screens.

## Current caveats

- The app currently has `Chat` and `Settings` bottom tabs; key-management and message screens are stack routes.
- **`ManageKeys` / `ScanningKeys` exchange a single QR containing the plaintext private key again** (commit `4e02cce`, 2026-09-16) — the brief two-QR ephemeral-ECDH handshake (sealed ciphertext, never a raw key on screen) was removed. The only remaining protection before a QR is generated is the `PairingCode`/`EnterPairingCode` same-room 4-digit code gate plus a 30s QR display window. See `tabs/managekeys/ManageKeys.md` and `ScanningKeys.md` for the full flow and the security-model note. `utility/securedMessage/DevicePairing.ts` (the removed handshake's crypto) is left in the tree unused.
- A second, server-relayed pairing transport exists (`device-pairing` Supabase Edge Function + `RemoteDevicePairing.ts`, for syncing devices that aren't physically together) but has no screen wired to it yet — only the local QR flow is reachable from the UI today.
- There is still no true multi-device identity model: `generateKeyPair()` only runs once, at sign-up (`login.tsx`), and its private key never leaves that device automatically. Every additional device must obtain that same private key through one of the pairing flows above before it can decrypt anything — this is not an optional backup feature, it's required onboarding for any device beyond the first.
- **The key vault is built but has never run on a device** (2026-09-22). The client, the service and its Docker deployment are all in place and typecheck/build clean, and the service was smoke-tested locally in both JWT modes — but the `key_backups` migration is not applied, the Pi is not deployed, and no phone has exercised either screen. Until that happens, QR pairing remains the only recovery path that has actually worked. See `in-progress.md`.
- **The key-sync QR's rendering props are load-bearing** (fixed 2026-09-17): `quietZone`, a white background behind the code, and a large enough `size` are all required for it to be scannable at all — `react-native-qrcode-svg` defaults `quietZone` to `0`, which silently produces a code no scanner can decode while still looking correct on screen. It failed only in dark mode. See the "QR rendering requirements" section in `tabs/managekeys/ManageKeys.md` before changing anything about that QR.
