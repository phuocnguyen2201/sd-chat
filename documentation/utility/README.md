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
│   ├── secured.ts                   # Message encryption/decryption
│   └── ConversationKeyManagement.ts # Conversation key caching and storage
├── session/
│   └── UserContext.tsx              # User context provider and hook
└── types/
    ├── supabse.ts                   # Supabase database types
    └── user.ts                      # User and profile types
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
- `generateKeyPair()`: Generates Ed25519 key pair (tweetnacl)
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

### `session/UserContext.tsx`
**Purpose**: React context for user authentication and profile state.

**Context Provider**: `UserProvider`

**State**:
- `user`: Current authenticated user (from Supabase Auth)
- `profile`: User profile data (from database)
- `loading`: Loading state during auth check

**Methods**:
- `refreshProfile()`: Refetch profile from database
- `logout()`: Sign out, clear state, redirect to home

**Features**:
- **Auto-redirect**: Redirects to Complete Profile or Chat based on profile completion
- **Session Persistence**: Stores user and profile in AsyncStorage
- **Auth State Listener**: Listens for auth state changes
- **One-time Navigation**: Prevents multiple redirects

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
**Purpose**: TypeScript types for user and profile data.

**Types**:
- `User`: Supabase Auth user type
- `Profile`: User profile type from database
- `UserContextType`: User context interface

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
- `tweetnacl`: Ed25519 key pairs and ECDH

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
6. **Service Role Key**: Only used server-side, never exposed to client

## Error Handling

All API functions return `ApiResponse<T>` with:
- `data`: Success data or null
- `error`: Error object or null

This allows consistent error handling across the application.
