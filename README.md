# SD Chat

A secure, real-time messaging application built with React Native and Expo, featuring end-to-end encryption, push notifications, and seamless cross-platform support.

## Overview

SD Chat is a modern messaging application that prioritizes security and user experience. The app enables users to send encrypted messages, share images and files, and communicate in real-time with a clean, intuitive interface. Built with privacy in mind, all messages are protected with end-to-end encryption, ensuring that only the intended recipients can read the content.

## Features

### 🔐 Security & Encryption
- **End-to-End Encryption**: All messages are encrypted using ChaCha20-Poly1305 encryption algorithm
- **Key Management**: Automatic key pair generation during registration using X25519 (`nacl.box`) cryptography
- **Secure Key Storage**: Private keys stored securely on device using Expo Secure Store
- **Conversation Keys**: Unique encryption keys for each conversation, wrapped with participants' public keys
- **Key Backup Vault**: Optional passphrase-protected backup of the identity key to a self-hosted vault, for recovery when no paired device is left

### 💬 Messaging
- **Real-time Messaging**: Instant message delivery using Supabase real-time subscriptions
- **Multiple Message Types**: Support for text messages, images, and file attachments
- **Message History**: Persistent message storage with automatic loading
- **Image Zoom**: Full-screen image viewing with zoom functionality
- **File Sharing**: Upload and download files directly within conversations

### 👥 User Management
- **User Profiles**: Customizable display names and avatars
- **User Search**: Real-time search to find and start conversations with other users
- **Conversation List**: View all conversations with last message previews and timestamps
- **Online Status**: Visual indicators for user availability

### 🔔 Notifications
- **Push Notifications**: Receive notifications for new messages even when app is closed
- **Notification Handling**: Tap notifications to navigate directly to conversations
- **Background Updates**: Automatic conversation list refresh on notification receipt

### 🎨 User Interface
- **Modern Design**: Clean, intuitive interface built with Gluestack UI components
- **Responsive Layout**: Optimized for both iOS and Android devices
- **Keyboard Handling**: Smart keyboard avoidance for seamless typing experience
- **Dark Mode Support**: Automatic theme adaptation based on system preferences

## Technologies Used

### Frontend Framework
- **React Native**: Cross-platform mobile application framework
- **Expo**: Development platform and toolchain for React Native
- **Expo Router**: File-based routing system for navigation
- **TypeScript**: Type-safe JavaScript for better code quality

### UI & Styling
- **Gluestack UI**: Modern, accessible component library
- **NativeWind**: Tailwind CSS for React Native
- **React Native Reanimated**: Smooth animations and gestures
- **Lucide React Native**: Beautiful icon library

### Backend & Database
- **Supabase**: Backend-as-a-Service platform providing:
  - PostgreSQL database for data storage
  - Real-time subscriptions for live updates
  - Authentication service for user management
  - Storage buckets for file and image uploads
  - Edge Functions for serverless operations

### Encryption & Security
- **@stablelib/chacha20poly1305**: ChaCha20-Poly1305 encryption implementation
- **tweetnacl**: Ed25519 key pair generation and ECDH key exchange
- **expo-crypto**: Cryptographic functions and random number generation
- **expo-secure-store**: Secure key storage on device

### Media & Files
- **expo-image-picker**: Image selection from gallery or camera
- **expo-document-picker**: File selection and upload
- **expo-image-manipulator**: Image resizing and compression

### Notifications
- **expo-notifications**: Push notification handling
- **expo-device**: Device information for notification setup

### State Management
- **React Context API**: User authentication and profile state management
- **AsyncStorage**: Local data persistence

## Supabase Integration

SD Chat leverages Supabase as its complete backend solution, providing:

### Database
- **PostgreSQL Database**: Stores user profiles, conversations, messages, and conversation participants
- **Real-time Subscriptions**: Live updates for new messages and conversation changes
- **Row Level Security**: Database-level security policies
- **Database Functions**: Custom PostgreSQL functions for conversation creation and message management

### Authentication
- **Email/Password Auth**: Secure user authentication with Supabase Auth
- **Session Management**: Automatic token refresh and session persistence
- **User Profiles**: Extended user data stored in profiles table

### Storage
- **Storage Buckets**: Three dedicated buckets for different content types:
  - `avatars`: User profile pictures
  - `storage-msg`: Message images
  - `chat-files`: File attachments
- **Signed URLs**: Time-limited access URLs for secure file sharing
- **Automatic Cleanup**: Old files removed when replaced

### Edge Functions
- **Push Notification Service**: Serverless function triggered by database webhooks
- **Message Processing**: Automatic push notification dispatch when new messages are created
- **Deno Runtime**: Fast, secure serverless execution environment

### Real-time Features
- **Postgres Changes**: Real-time database change notifications
- **Channel Subscriptions**: Subscribe to specific conversation channels
- **Automatic Reconnection**: Handles network interruptions gracefully

## Project Structure

```
sd-chat/
├── app/                        # Application screens and routes
│   ├── +html.tsx               # Web HTML shell
│   ├── +not-found.tsx          # 404 / fallback route
│   ├── _layout.tsx             # Root layout (providers, themes, routing shell)
│   ├── index.tsx               # Root entry (redirects to Bootstrap)
│   ├── Bootstrap.tsx           # Bootstrap / gate screen (session + push init)
│   ├── login.tsx               # Authentication (login/register) screen
│   ├── CompleteProfile.tsx     # Profile setup screen
│   ├── modal.tsx               # Global modal route
│   └── tabs/                   # Tab + nested navigation
│       ├── _layout.tsx         # Tabs stack layout
│       ├── (tabs)/             # Bottom tab navigator screens
│       │   ├── _layout.tsx     # Tabs layout (Chat, Settings)
│       │   ├── Chat.tsx        # Main chat list
│       │   └── Settings.tsx    # User settings
│       ├── msg/                # Message / room routes
│       │   ├── [room_id].tsx   # Individual encrypted chat room
│       │   └── ChatRoomEditing.tsx # Room editing utilities
│       └── managekeys/         # Key management, pairing and recovery
│           ├── BiometricAuthentication.tsx # Gate in front of key management
│           ├── EnableBiometric.tsx     # Touch ID / Face ID setup
│           ├── ManageKeys.tsx          # Hub: share keys, receive keys, back up
│           ├── PairingCode.tsx         # Old device: show the 4-digit code
│           ├── EnterPairingCode.tsx    # New device: enter that code
│           ├── ScanningKeys.tsx        # New device: scan the key QR
│           ├── BackupKey.tsx           # Seal the key behind a passphrase
│           └── RecoverKey.tsx          # Recover the key from the vault
├── components/                 # Reusable UI components
│   ├── CreateGroupChat.tsx
│   ├── EditScreenInfo.tsx
│   ├── ExternalLink.tsx
│   ├── ForwardMessage.tsx
│   ├── LoadingModal.tsx
│   ├── MessageAction.tsx
│   ├── Push.tsx
│   ├── QrScannerView.tsx       # Shared camera + permission component
│   ├── Themed.tsx
│   ├── ZoomImage.tsx
│   ├── useClientOnlyValue.ts
│   ├── useClientOnlyValue.web.ts
│   ├── useColorScheme.ts
│   ├── useColorScheme.web.ts
│   └── ui/                     # Gluestack UI primitives
├── utility/                    # Core business logic & helpers
│   ├── connection.ts           # Supabase client
│   ├── handleStorage.ts        # File/image storage (Supabase buckets)
│   ├── messages.ts             # Domain APIs (auth, profiles, conversations, messages, realtime)
│   ├── localstorage/           # Local persistence helpers
│   ├── account/                # Account deletion (server + local teardown)
│   ├── biometricsSecurity/     # Touch ID / Face ID checks
│   ├── push-notification/      # Push notification registration + token storage
│   │   └── push-Notification.ts
│   ├── securedMessage/         # E2E encryption, key sync and key recovery
│   │   ├── secured.ts          # Message encryption / key wrapping
│   │   ├── ConversationKeyManagement.ts # Conversation key cache + SecureStore
│   │   ├── ConversationKeyResolver.ts   # Find or unwrap a conversation's key
│   │   ├── KeySyncPayload.ts   # Builds the payload a paired device hands over
│   │   ├── LocalPairingCode.ts # Same-room 4-digit code gate client
│   │   ├── DeviceIdentity.ts   # Stable device id + `devices` registration
│   │   ├── RemoteDevicePairing.ts # Server-relayed pairing (no screen yet)
│   │   ├── DevicePairingFunctionClient.ts # Edge Function caller
│   │   ├── DevicePairing.ts    # Unused: removed ephemeral-ECDH handshake
│   │   └── VaultBackup.ts      # Key backup / recovery via the vault
│   ├── session/                # Global session state
│   │   └── SessionProvider.tsx # Session context (user, profile, conversationKey)
│   └── types/                  # Shared TS types
│       ├── supabse.ts
│       └── user.ts
├── supabase/                   # Supabase project files
│   ├── config.toml             # Supabase CLI config
│   └── functions/              # Edge Functions (Deno)
│       ├── push/               # Push notification function
│       │   ├── index.ts
│       │   └── deno.json, .npmrc
│       └── device-pairing/     # Pairing codes + server-relayed key handover
├── sd-chat-vault/              # Self-hosted key vault (runs on a Raspberry Pi)
│   ├── DEPLOY.md               # Setup, verification, ES256 promotion
│   ├── NOTES.md                # Design decisions and what changed in build-out
│   ├── install-vault.sh        # Writes the whole stack onto the Pi
│   ├── docker-compose.yml      # vault-service + cloudflared + JWKS refresher
│   ├── .env.example            # What the Pi needs configured
│   ├── vault-service/          # Fastify blob store (Node 22, unprivileged)
│   │   ├── Dockerfile
│   │   └── src/
│   │       ├── index.ts        # PUT/GET/DELETE /backup/:userId
│   │       ├── auth.ts         # Local JWT verification (ES256 or HS256)
│   │       └── jwks-refresh.ts # Refreshes the cached Supabase public keys
│   ├── supabase/migrations/    # `key_backups` table + RLS
│   └── cloudflared/            # Only used for a config-file tunnel
├── documentation/              # In-repo documentation grouped by feature
│   ├── app/
│   │   ├── index.md            # Auth screen docs
│   │   ├── CompleteProfile.md  # Profile screen docs
│   │   └── tabs/
│   │       ├── Chat.md
│   │       ├── Settings.md
│   │       ├── msg/
│   │       │   └── room_id.md
│   │       └── managekeys/     # One file per key-management screen,
│   │                           # including BackupKey.md and RecoverKey.md
│   ├── supabase/README.md      # Supabase & Edge Functions docs
│   └── utility/README.md       # Utility layer (APIs, encryption, session)
├── maestro/                    # Automated test scenario definitions
│   ├── change-display-name.yaml
│   ├── change-password.yaml
│   ├── create-account-with-picture.yaml
│   ├── forward-message.yaml
│   ├── interactive-users.yaml
│   ├── login-ios.yaml
│   ├── login.yaml
│   ├── search-bar.yaml
│   ├── send-emojies.yaml
│   ├── send-files.yaml
│   ├── send-images.yaml
│   ├── send-messages.yaml
│   ├── send-reaction.yaml
│   └── toggle-darkmode.yaml
├── components/ui/...           # Gluestack component implementations
├── assets/                     # Icons, images, fonts
├── constants/                  # App-wide constants
├── types/                      # Additional global type declarations
├── global.css                  # Global web styles
├── metro.config.js             # Metro bundler config
├── tailwind.config.js          # Tailwind / NativeWind config
└── tsconfig.json               # TypeScript configuration
```

## Security Architecture

### Encryption Flow
1. **Registration**: User generates an X25519 key pair (public/private)
2. **Key Exchange**: Public keys stored in database, private keys in device secure storage
3. **Conversation Setup**: Unique conversation key generated and wrapped with each participant's public key
4. **Message Encryption**: Each message encrypted with unique key, wrapped with conversation key
5. **Message Decryption**: Recipient unwraps keys using their private key to decrypt messages

### Key Features
- **Forward Secrecy**: Each message uses a unique encryption key
- **Key Wrapping**: Conversation keys securely exchanged using ECDH
- **Secure Storage**: Private keys never leave the device
- **Key Caching**: Conversation keys cached for performance while maintaining security

### Key Recovery

Two independent paths restore an account's identity key on a new device:

1. **Device pairing** — a same-room 4-digit code gate, then a QR handover from a
   device that still holds the key. Restores conversation keys too, but needs a
   second working device.
2. **Key backup vault** *(new)* — the key is sealed on-device with a scrypt-derived
   key from a recovery passphrase, and only the ciphertext is uploaded to a
   self-hosted vault (a Raspberry Pi behind a Cloudflare Tunnel). Needs no second
   device, but the user must remember the passphrase.

The vault is zero-knowledge: it stores an opaque blob, verifies the caller's
Supabase JWT locally, and never sees the passphrase or any plaintext key. The
recovery passphrase is separate from the login password and is stored nowhere —
if it is forgotten, the backup cannot be opened by anyone, by design. Supabase
holds only the non-secret KDF parameters and nonce; the ciphertext never touches
it. Conversation keys are not in the blob — after recovery they are re-derived
from each participant row.

Setup and operation: `sd-chat-vault/DEPLOY.md`.

## Documentation

Comprehensive documentation is available in the `documentation/` folder, covering:
- Individual screen documentation
- Utility functions and APIs
- Supabase configuration and Edge Functions
- Security and encryption details

## License

This project is private and proprietary.
