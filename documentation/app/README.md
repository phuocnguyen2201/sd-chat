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
| `/tabs/managekeys/ManageKeys` | `tabs/managekeys/ManageKeys.tsx` | Display an encryption-key QR payload |
| `/tabs/managekeys/ScanningKeys` | `tabs/managekeys/ScanningKeys.tsx` | Scan and import a key QR payload |

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
- Avatars and message/group files use `utility/handleStorage`.
- Gluestack UI primitives are under `components/ui`.

## Current caveats

- The app currently has `Chat` and `Settings` bottom tabs; key-management and message screens are stack routes.
- QR key sync is guarded by the logged-in user ID and imports only keys that are not already stored.
- The `ManageKeys` screen renders a `Regenerate QR` button, but its current handler is empty.
