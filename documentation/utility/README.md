# Utility Folder

## Overview
The `utility` folder contains core business logic, API integrations, helper functions, and shared utilities used throughout the application. It's organized into subdirectories by functionality.

## Structure

```
utility/
├── connection.ts                    # Supabase client configuration
├── handleStorage.ts                 # File and image storage operations
├── messages.ts                      # API functions for all database operations
├── push-notification/
│   └── push-Notification.ts         # Push notification registration and management
├── securedMessage/
│   ├── secured.ts                   # Message encryption/decryption, ephemeral ECDH sealing
│   ├── ConversationKeyManagement.ts # Conversation key caching and storage
│   ├── KeySyncPayload.ts            # Shared "gather this device's keys" payload builder
│   ├── DevicePairing.ts             # UNUSED — local (QR) ephemeral-ECDH crypto, no longer called by any screen
│   ├── DevicePairingFunctionClient.ts # Shared caller for the device-pairing Edge Function
│   ├── LocalPairingCode.ts          # Client for the same-room 4-digit pairing-code gate
│   ├── RemoteDevicePairing.ts       # Server-relayed device-pairing client (device-pairing Edge Function)
│   ├── DeviceIdentity.ts            # Stable per-install device id + `devices` row registration
│   ├── ConversationKeyResolver.ts   # Finds or unwraps a conversation's key, with fallback candidates
│   └── VaultBackup.ts               # Passphrase-sealed identity-key backup and recovery (the vault)
├── session/
│   └── SessionProvider.tsx          # Session, profile, theme, and conversation-key context
└── types/
    ├── supabse.ts                   # Supabase database types
    └── user.ts                      # User, profile, and device-pairing payload types
```

## Core Modules

### `connection.ts`
**Purpose**: Initializes and exports the Supabase client instance.

**Features**:
- Creates Supabase client with environment variables
- Configures authentication with AsyncStorage
- Enables auto-refresh tokens
- Persists sessions
- Uses process lock for concurrent request handling

**Exports**:
- `supabase`: Configured Supabase client instance

**Dependencies**:
- `@supabase/supabase-js`
- `@react-native-async-storage/async-storage`
- `react-native-url-polyfill`

### `messages.ts`
**Purpose**: Centralized API layer for all database operations.

**Modules**:

#### `authAPI`
Authentication and user management:
- `signUp()`: Register new user with email, password, and public key
- `signIn()`: Authenticate user with email and password
- `signOut()`: Sign out current user
- `getCurrentUser()`: Get current authenticated user
- `getProfileUser()`: Get user profile by ID
- `updatePassword()`: Update user password
- `deleteAccount()`: Permanently delete user account and all data

#### `profileAPI`
User profile operations:
- `getProfile()`: Get profile by user ID
- `createProfile()`: Create new user profile
- `updateProfile()`: Update profile fields (displayname, avatar_url)
- `getAllProfiles()`: Get all user profiles (excluding current user)

#### `conversationAPI`
Conversation management:
- `getOrCreateDM()`: Get or create direct message conversation
- `verifyDMConversation()`: Check if DM exists between two users
- `getConversations()`: Get all conversations with participants and last message
- `createGroupConversation()`: Create group conversation with multiple participants
- `storeConversationKey()`: Store encrypted conversation key
- `getWrappedKeyRecipient()`: Get wrapped key for recipient
- `getWrappedKeyCurrent()`: Get wrapped key for current user
- `leaveConversation(conversationId, userId)`: Deletes the current user's own `conversation_participants` row only — removes the chat from their list without touching the other participant's copy or message history (not a delete-for-everyone). Used by the Chat screen's long-press "Delete chat" action.

#### `messageAPI`
Message operations:
- `sendMessage()`: Send message to conversation
- `getMessages()`: Get messages with pagination
- `markMessagesAsRead()`: Mark messages as read

#### `realtimeAPI`
Real-time subscriptions:
- `subscribeToMessages()`: Subscribe to new messages in conversation
- `subscribeToConversations()`: Subscribe to conversation updates

#### `channelsAndUsersAPI`
Combined data fetching:
- `getChannelsAndUsers()`: Get both conversations and users in one call

**Helper Functions**:
- `getUserDisplayName()`: Get display name from profile with fallback

### `handleStorage.ts`
**Purpose**: Handles file uploads, image processing, and storage operations.

**Storage Buckets**:
- `storage-msg`: Message images
- `chat-files`: File attachments
- `avatars`: User avatars

**`storageAPIs`**:
- `uploadImageToSupabase()`: Upload image to messages bucket, create signed URL, insert message
- `uploadFileToSupabase()`: Upload file to files bucket, create signed URL, insert message
- `uploadAvatarToSupabase()`: Upload avatar, delete old avatar, update profile
- `resizedImage()`: Resize and compress image (128px width, 70% quality, JPEG)
- `deleteAvatarFromSupabase()`: Delete user's avatar from storage

**`handleDeviceFilePath`**:
- `pickImageFromAlbumOrGallery()`: Request permissions and open image picker
- `takePicture()`: Request camera permissions and open camera

**Features**:
- Automatic image resizing and compression
- Signed URL generation with expiration
- Old file cleanup before upload
- Permission handling for camera and gallery

### `push-notification/push-Notification.ts`
**Purpose**: Manages push notification registration and token storage.

**Functions**:
- `registerForPushNotificationsAsync()`: 
  - Requests notification permissions
  - Creates notification channel (Android)
  - Gets Expo push token
  - Returns token string
- `savePushTokenToDatabase()`: 
  - Saves FCM token to user profile
  - Skips if token already exists
- `verifyPushTokenInDatabase()`: 
  - Checks if user has FCM token in profile
  - Returns boolean

**Features**:
- Platform-specific channel setup (Android)
- Permission handling
- Token persistence in database
- Duplicate token prevention

### `securedMessage/secured.ts`
**Purpose**: End-to-end message encryption using ChaCha20-Poly1305.

**Class**: `MessageEncryption`

**Key Features**:
- **Algorithm**: ChaCha20-Poly1305 (AEAD encryption)
- **Key Size**: 32 bytes (256 bits)
- **Nonce Size**: 12 bytes

**Methods**:

#### Encryption
- `encryptMessage()`: Encrypts text message with conversation key
  - Generates unique message key
  - Encrypts message with message key
  - Wraps message key with conversation key
  - Returns ciphertext, nonces, and wrapped key

#### Decryption
- `decryptMessage()`: Decrypts encrypted message
  - Unwraps message key
  - Decrypts message
  - Returns plaintext

#### Key Management
- `generateKeyPair()`: Generates the account's identity key pair (X25519 via tweetnacl `box`), once, at sign-up
  - Stores private key in secure storage
  - Returns public key for database
- `createConversationKey()`: Generates random 32-byte conversation key
- `wrapConversationKey()`: Wraps conversation key with recipient's public key
  - Uses ECDH (Elliptic Curve Diffie-Hellman)
  - Uses HKDF for key derivation
  - Returns wrapped key and nonce
- `unwrapConversationKey()`: Unwraps conversation key using private key
  - Uses ECDH to derive shared secret
  - Uses HKDF for key derivation
  - Returns conversation key

#### Ephemeral pairing (device-to-device key sync)
Added for the QR and server-relayed device-pairing flows — a lower-level, transport-agnostic building block distinct from `wrapConversationKey`'s use of the account's long-lived identity key:
- `generateEphemeralKeyPair()`: generates a throwaway X25519 key pair that only ever lives in memory (never written to secure storage)
- `ecdhSeal(plaintext, recipientPublicKey, senderSecretKey, info)`: ECDH → HKDF-SHA512 (domain-separated by `info`) → ChaCha20-Poly1305; returns `{ ciphertext, nonce }`
- `ecdhOpen(ciphertext, nonce, senderPublicKey, recipientSecretKey, info)`: inverse of `ecdhSeal`; throws if the keys/`info` don't match or the AEAD tag fails to verify

#### Utilities
- `bytesToBase64()`: Converts Uint8Array to base64 string
- `base64ToBytes()`: Converts base64 string to Uint8Array
- `deletePrivateKey()`: Removes private key from secure storage
- `hkdfSha512()`: HKDF key derivation function

**Security Features**:
- Private keys stored in device secure storage
- Key wrapping for secure key exchange
- Unique nonces for each encryption
- Authentication tags prevent tampering
- Zeroing sensitive buffers

### `securedMessage/ConversationKeyManagement.ts`
**Purpose**: Manages conversation encryption keys with caching.

**Class**: `ConversationKeyManager`

**Features**:
- **In-Memory Cache**: Fast access to frequently used keys
- **Secure Storage**: Persistent key storage on device
- **Base64 Conversion**: Supports both Uint8Array and base64 formats

**Methods**:
- `getKey()`: Get key as Uint8Array (checks cache, then storage)
- `get()`: Get key as base64 string (for router params)
- `setConversationKey()`: Store key in cache and secure storage
- `makeKey()`: Generate storage key from conversation ID (SHA256 hash)
- `clear()`: Clear cache (optionally for specific conversation)

**Storage**:
- Keys stored with prefix `ck_` + SHA256 hash of conversation ID
- Uses expo-secure-store for secure storage
- Cache improves performance for repeated access

### `securedMessage/KeySyncPayload.ts`
**Purpose**: Builds the payload an already-synced device hands to a new device during pairing: the account's private key plus every conversation key this device holds.

**Export**: `buildKeySyncPayload(userId)` → `Promise<KeyObject | null>`
- Returns `null` when this device has no private key yet (nothing to share).
- Reads conversation keys via `ConversationKeyManager`, private key via `MessageEncryption.getPrivateKey()`.
- Shared by both `ManageKeys.tsx` (local QR flow) and `RemoteDevicePairing.approve()` (server-relayed flow) so the payload is built the same way regardless of transport.

### `securedMessage/DevicePairing.ts` — currently unused
**Purpose (historical)**: Crypto + in-memory state for a two-QR, ephemeral-ECDH device-pairing handshake that `ManageKeys`/`ScanningKeys` used to run. **As of commit `4e02cce` (2026-09-16) neither screen imports this module anymore** — they exchange a single plaintext QR instead, gated by the pairing-code screens below. The module still exists in the tree (not deleted) but nothing calls it; see `documentation/app/tabs/managekeys/ManageKeys.md`'s security-model note.

**Export**: `DevicePairing` object
- `startPairing(userId)`: generates a one-time ephemeral key pair (held in module memory only) and returns the `pair_init` QR payload
- `sealForPeer(peerPublicKeyBase64, payload)`: seals a `KeyObject` to a scanned peer public key with a fresh sender ephemeral key pair; returns the `pair_data` QR payload
- `openFromPeer(data)`: unwraps a `pair_data` payload using this device's held ephemeral secret key; rejects expired or undecryptable payloads
- `reset()` / `isPairing()`: wipe or query the in-memory ephemeral key pair

Also exports `isPairInitPayload()` / `isPairDataPayload()` type guards, likewise unused elsewhere now.

### `securedMessage/DevicePairingFunctionClient.ts`
**Purpose**: Shared low-level caller for the `device-pairing` Supabase Edge Function, used by both `RemoteDevicePairing.ts` and `LocalPairingCode.ts`.

**Export**: `invokeDevicePairing<T>(action, payload)` — invokes the function with `{ action, ...payload }`, normalizes error extraction from both a non-2xx response and a `{ error }` field on an HTTP-200 body (the latter exists so "soft failure" responses like the local code's lockout countdown carry structured data instead of being swallowed as a thrown error), and throws an `Error` with the server's message on failure.

### `securedMessage/LocalPairingCode.ts`
**Purpose**: Client for the same-room, 4-digit pairing-code gate that sits in front of the QR key-sharing flow (see `documentation/app/tabs/managekeys/PairingCode.md` / `EnterPairingCode.md`). Added 2026-09-15 (commit `3104094`). Carries no key material itself — purely a physical-proximity check.

**Export**: `LocalPairingCode` object, calling the `local-code-*` device-pairing Edge Function actions via `invokeDevicePairing`:
- `create(deviceRowId)` — old device: request a fresh 4-digit code
- `status()` — either device: poll the account's current code state
- `verify(deviceRowId, code)` — new device: submit the digits; returns `verified`, or `locked` with `retryAfterSeconds`, or `attemptsRemaining`
- `cancel(deviceRowId)` — old device: invalidate the code immediately

### `securedMessage/RemoteDevicePairing.ts`
**Purpose**: Client for the **server-relayed** alternative to the QR flow — pairs devices that aren't physically together by relaying end-to-end sealed key material through the `device-pairing` Supabase Edge Function (see `documentation/supabase/README.md`). Not yet wired into a screen.

**Export**: `RemoteDevicePairing` object, mirroring the edge function's actions:
- `createRequest(deviceRowId)` — new device: generates an ephemeral key pair and registers a pairing request
- `status(deviceRowId)` — either device: polls the account's in-flight request
- `approve(deviceRowId, requesterEphemeralPublicKeyBase64, payload)` — old device: builds the payload via `buildKeySyncPayload`-shaped input, seals it locally with `MessageEncryption.ecdhSeal`, uploads only ciphertext, gets back a one-time display code
- `confirm(deviceRowId, requestId, code)` — new device: submits the code (single-shot server-side check)
- `fetchAndUnwrap(deviceRowId, requestId)` — new device: fetches the sealed payload (server deletes it on read) and unwraps it locally with `MessageEncryption.ecdhOpen`
- `cancel(deviceRowId, requestId)` / `reset()`

The ephemeral secret key generated by `createRequest` lives only in this module's memory for the duration of one attempt.

### `securedMessage/DeviceIdentity.ts`
**Purpose**: Stable per-install device identity used by the remote pairing flow and the `devices` bookkeeping table.

**Export**: `DeviceIdentity` object
- `registerCurrentDevice(userId)`: ensures a `devices` row exists for this install (a device id generated once via `expo-crypto` and persisted in SecureStore, so it survives re-login but not a restore onto different hardware) and returns that row's database id
- `markKeySynced(rowId)`: flips `synced_key = true, is_new = false` after a successful import

### `securedMessage/ConversationKeyResolver.ts`
**Purpose**: Resolve the key for a conversation this user is part of, from whatever is available.

**Export**: `resolveConversationKey(conversationId, userId, fallbackPublicKeys)` → `{ status: 'found', key } | { status: 'absent' } | { status: 'failed' }`

Looks first at what this device already holds (memory cache, then Secure Store), then at the wrapped key on this user's `conversation_participants` row. Unwrapping is ECDH between this device's private key and the public key of the device that *wrapped* the row — never this user's own — so `fallbackPublicKeys` exists for rows written before that was handled correctly; when a fallback works, the row is corrected in place.

The `absent` / `failed` distinction is load-bearing: minting a fresh conversation key on top of a wrapped key that merely failed to open is what leaves two devices holding different keys, which surfaces on the peer as `Key unwrapping failed`.

This is also what brings conversations back after a vault recovery, since the vault blob holds only the identity key.

### `securedMessage/VaultBackup.ts`
**Purpose**: The "doomsday vault" — a second recovery path for the identity private key, for when no device is left to pair with. Zero-knowledge: the key is sealed on-device and the vault only ever receives ciphertext.

**Exports**
- `backupIdentityKey(userId, passphrase)`: derives a sealing key with scrypt (N=2¹⁵, r=8, p=1), seals the identity key with ChaCha20-Poly1305 binding the account id as associated data, `PUT`s the ciphertext to the vault, then records the scrypt parameters and nonce in `key_backups`. Upserts — a second call replaces the first.
- `recoverIdentityKey(passphrase)`: reads those parameters, fetches the blob, opens it, **verifies the recovered key against `profiles.public_key` before writing anything**, installs it via `MessageEncryption.setPrivateKey()`, and registers/marks this device through `DeviceIdentity`.
- `deleteVaultBackup(userId)`: removes blob and parameters. Called by `deleteAccountAndLocalData` *before* sign-out, since the vault authenticates with the live session.
- `hasVaultBackup(userId)`: whether a backup exists, for deciding what the UI offers.

**Errors**: `NoBackupFoundError`, `WrongPassphraseError`, `VaultUnreachableError`, `IdentityMismatchError` — each maps to its own message in `RecoverKey.tsx`, because each calls for a different response from the user.

**Notes**
- The passphrase is separate from the login password and is stored nowhere. Forgetting it makes the backup unopenable, by anyone, permanently.
- KDF parameters are stored per backup rather than assumed, so the cost can be lowered later (e.g. N=2¹⁴ if scrypt proves too slow on Hermes) without stranding existing backups.
- Ciphertext travels as base64 inside JSON, not as a raw binary body: React Native's `fetch` is an XHR polyfill with uneven binary support, and this is the one code path that only runs after a user has already lost everything else.
- `EXPO_PUBLIC_VAULT_URL` points at the vault. Server side lives outside this repo's app tree, in `sd-chat-vault/` — see `sd-chat-vault/DEPLOY.md`.

### `session/SessionProvider.tsx`
**Purpose**: React context for session, profile, theme, and conversation-key state. (Note: this section previously documented an older `UserContext.tsx`/`useUser()` API that no longer exists in the codebase; corrected here in passing, not otherwise audited today.)

**Context Provider**: `SessionProvider`, consumed via the `useSession()` hook.

**State** (`SessionState`):
- `user`, `profile`: current authenticated user and profile
- `isDarkMode`: theme preference
- `conversationKey`, `currentConversationId`: the currently-open conversation's key material
- `loading`, `initialized`: startup/auth-check state

**Methods** (`SessionContextType`):
- `refreshProfile()`: refetch profile from database
- `fetchThemeMode()` / `setDarkMode()`: theme persistence
- `logout()`: sign out, clear state, redirect to home
- `setCurrentConversation()` / `getConversationKey()` / `clearCurrentConversation()`: conversation-key context used while a chat room is open

**Hook**: `useUser()`
- Returns user context
- Throws error if used outside provider

**Navigation Logic**:
- If user has no `displayname` → `/CompleteProfile`
- If user has `displayname` → `/tabs/(tabs)/Chat`

### `types/supabse.ts`
**Purpose**: TypeScript type definitions for Supabase database schema.

**Types**:
- `Database`: Complete database schema with tables, views, functions
- `UserProfile`: User profile interface
- `Conversation`: Conversation interface with participants
- `Message`: Message interface
- `ApiResponse<T>`: Generic API response wrapper
- `Json`: JSON value type

**Tables Defined**:
- `profiles`: User profiles
- `conversations`: Chat conversations
- `conversation_participants`: Conversation membership
- `messages`: Chat messages

**Functions Defined**:
- `create_dm_conversation`: Creates DM between two users
- `mark_messages_as_read`: Marks messages as read

### `types/user.ts`
**Purpose**: TypeScript types for user, profile, and device-pairing data.

**Types**:
- `User`: Supabase Auth user type
- `Profile`: User profile type from database
- `UserContextType`: User context interface
- `KeyObject`: the key-sync payload (`req`, `userId`, `validTime`, `private_key`, `list` of `{id, key}`) — what gets sealed and transported by either pairing flow
- `PairInitPayload` / `PairDataPayload`: the two-QR ECDH handshake's payload shapes — unused since commit `4e02cce` removed that handshake from `ManageKeys`/`ScanningKeys` (see `DevicePairing.ts` above)

**Fields**:
- User: id, email, user_metadata, app_metadata, timestamps
- Profile: id, email, username, displayname, fcm_token, public_key, avatar_url, bio, timestamps
- UserContextType: user, profile, loading, refreshProfile, logout

## Usage Patterns

### API Calls
```typescript
import { authAPI, profileAPI, conversationAPI } from '@/utility/messages';

// Authentication
const result = await authAPI.signIn(email, password);

// Profile
const profile = await profileAPI.getProfile(userId);

// Conversations
const conversations = await conversationAPI.getConversations();
```

### Encryption
```typescript
import { MessageEncryption } from '@/utility/securedMessage/secured';

// Encrypt
const encrypted = MessageEncryption.encryptMessage(text, conversationKey);

// Decrypt
const decrypted = MessageEncryption.decryptMessage(encrypted, conversationKey);
```

### User Context
```typescript
import { useUser } from '@/utility/session/UserContext';

const { user, profile, refreshProfile } = useUser();
```

### Storage
```typescript
import { storageAPIs, handleDeviceFilePath } from '@/utility/handleStorage';

// Upload image
const result = await storageAPIs.uploadImageToSupabase(uri, filename, conversationId, userId);

// Pick image
const image = await handleDeviceFilePath.pickImageFromAlbumOrGallery();
```

## Dependencies

### Core
- `@supabase/supabase-js`: Supabase client
- `@react-native-async-storage/async-storage`: Local storage
- `expo-secure-store`: Secure key storage
- `expo-crypto`: Cryptographic functions

### Encryption
- `@stablelib/chacha20poly1305`: ChaCha20-Poly1305 encryption
- `tweetnacl`: X25519 (`nacl.box`) key pairs and ECDH — **not Ed25519**, despite how often it gets described that way. The identity key is a 32-byte `nacl.box` secret key; assuming otherwise is what made the first draft of `VaultBackup.ts` restore a key to a Secure Store slot nothing reads.
- `@noble/hashes`: scrypt, for stretching the vault recovery passphrase (pure JS — no native module, so no dev-client rebuild)

### Media
- `expo-image-picker`: Image selection
- `expo-document-picker`: File selection
- `expo-image-manipulator`: Image processing

### Notifications
- `expo-notifications`: Push notifications
- `expo-device`: Device information

## Security Considerations

1. **Private Keys**: Stored only in device secure storage, never in database
2. **Key Wrapping**: Conversation keys wrapped with recipient's public key
3. **Secure Storage**: Uses expo-secure-store with device-only access
4. **Key Derivation**: Uses HKDF for key derivation from shared secrets
5. **Nonce Management**: Unique nonces for each encryption operation
6. **Ephemeral Pairing Keys**: Device-pairing key pairs (`generateEphemeralKeyPair`) exist only in memory, are never written to secure storage, and are wiped (`.fill(0)`) as soon as a handshake completes, fails, or is cancelled
7. **Vault Backups**: the identity key is sealed on-device with a scrypt-derived key before it is uploaded; the vault stores ciphertext and never sees the passphrase or the key. The account id is bound in as AEAD associated data, so a blob cannot be opened under a different account. A forgotten passphrase is unrecoverable by design.
8. **Service Role Key — KNOWN ISSUE, not yet fixed**: `connection.ts` currently exports `supabaseAdmin` built from `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`. Because Expo inlines any `EXPO_PUBLIC_*` variable into the client bundle, the service-role key (which bypasses RLS) ships inside the compiled app and is extractable from it. It's actively used client-side for account/message deletion (`utility/messages.ts`) and `auth.admin.deleteUser()`. This needs to move into server-side Edge Functions and the key needs rotating; deliberately left untouched during the device-pairing work below so it doesn't get committed together with unrelated changes.

## Error Handling

All API functions return `ApiResponse<T>` with:
- `data`: Success data or null
- `error`: Error object or null

This allows consistent error handling across the application.
