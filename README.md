# SD Chat

A secure, real-time messaging application built with React Native and Expo, featuring end-to-end encryption, push notifications, and seamless cross-platform support.

## Overview

SD Chat is a modern messaging application that prioritizes security and user experience. The app enables users to send encrypted messages, share images and files, and communicate in real-time with a clean, intuitive interface. Built with privacy in mind, all messages are protected with end-to-end encryption, ensuring that only the intended recipients can read the content.

## Features

### 🔐 Security & Encryption
- **End-to-End Encryption**: All messages are encrypted using ChaCha20-Poly1305 encryption algorithm
- **Key Management**: Automatic key pair generation during registration using Ed25519 cryptography
- **Secure Key Storage**: Private keys stored securely on device using Expo Secure Store
- **Conversation Keys**: Unique encryption keys for each conversation, wrapped with participants' public keys

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
│       └── msg/                # Message / room routes
│           ├── [room_id].tsx   # Individual encrypted chat room
│           └── ChatRoomEditing.tsx # (Optional) room editing utilities
├── components/                 # Reusable UI components
│   ├── CreateGroupChat.tsx
│   ├── ForwardMessage.tsx
│   ├── MessageAction.tsx
│   ├── LoadingModal.tsx
│   ├── ZoomImage.tsx
│   └── ui/                     # Gluestack v3 primitives
│       ├── box/, button/, text/, input/, ... 
├── utility/                    # Core business logic & helpers
│   ├── connection.ts           # Supabase client
│   ├── messages.ts             # Domain APIs (auth, profiles, conversations, messages, realtime)
│   ├── handleStorage.ts        # File/image storage (Supabase buckets)
│   ├── push-notification/      # Push notification registration + token storage
│   │   └── push-Notification.ts
│   ├── securedMessage/         # E2E encryption utilities
│   │   ├── secured.ts          # Message encryption / key wrapping
│   │   └── ConversationKeyManagement.ts # Conversation key cache + SecureStore
│   ├── session/                # Global session state
│   │   └── SessionProvider.tsx # Session context (user, profile, conversationKey)
│   └── types/                  # Shared TS types
│       ├── supabse.ts
│       └── user.ts
├── supabase/                   # Supabase project files
│   ├── config.toml             # Supabase CLI config
│   └── functions/              # Edge Functions (Deno)
│       └── push/               # Push notification function
│           ├── index.ts
│           └── deno.json, .npmrc
├── documentation/              # In-repo documentation grouped by feature
│   ├── app/
│   │   ├── index.md            # Auth screen docs
│   │   ├── CompleteProfile.md  # Profile screen docs
│   │   └── tabs/               # Tab-related docs
│   │       ├── Chat.md
│   │       └── msg/
│   │           └── room_id.md
│   ├── supabase/README.md      # Supabase & Edge Functions docs
│   └── utility/README.md       # Utility layer (APIs, encryption, session)
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
1. **Registration**: User generates Ed25519 key pair (public/private)
2. **Key Exchange**: Public keys stored in database, private keys in device secure storage
3. **Conversation Setup**: Unique conversation key generated and wrapped with each participant's public key
4. **Message Encryption**: Each message encrypted with unique key, wrapped with conversation key
5. **Message Decryption**: Recipient unwraps keys using their private key to decrypt messages

### Key Features
- **Forward Secrecy**: Each message uses a unique encryption key
- **Key Wrapping**: Conversation keys securely exchanged using ECDH
- **Secure Storage**: Private keys never leave the device
- **Key Caching**: Conversation keys cached for performance while maintaining security

## Documentation

Comprehensive documentation is available in the `documentation/` folder, covering:
- Individual screen documentation
- Utility functions and APIs
- Supabase configuration and Edge Functions
- Security and encryption details

## License

This project is private and proprietary.

---

Built with ❤️ using React Native, Expo, and Supabase
