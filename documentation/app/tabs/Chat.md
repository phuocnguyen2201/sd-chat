# Chat Tab

**Source:** [`app/tabs/(tabs)/Chat.tsx`](../../../app/tabs/(tabs)/Chat.tsx)

## Overview
The Chat tab is the main interface for viewing and managing conversations. It displays a list of all chat rooms and provides functionality to search, start new conversations, and navigate to individual chat rooms.

## Features

### User List
- **Horizontal Scrollable List**: Displays all available users (excluding the current user) in a horizontal scrollable view
- **User Avatars**: Shows user avatars with fallback text (first 2 characters of display name)
- **Availability Indicator**: Displays a green avatar badge; this is a visual indicator, not a documented presence subscription.
- **Start New Chat**: Tap on any user to start or continue a conversation

### Conversation List
- **Conversation Display**: Shows all conversations the user is part of
- **Participant Information**: Displays the other participant's name and avatar
- **Last Message Preview**: Shows the last message content or type (Text/Image/File)
- **Timestamp**: Displays the time of the last message
- **Empty State**: Shows a message when no conversations exist

### Search Functionality
- **Real-time Search**: Filters both users and conversations as you type
- **Search Criteria**:
  - Users: Filters by display name
  - Conversations: Filters by participant name or last message content

### Push Notifications
- Registration and notification-response routing are handled by [`Bootstrap`](../Bootstrap.md).
- The Chat screen refreshes its conversation list when a notification is received.

### Real-time Updates
- **Conversation Subscriptions**: Subscribes to real-time conversation updates
- **New Conversation Detection**: Automatically adds new conversations to the list when created

## Key Components

### State Management
- `userId`: Current user's ID
- `listUser`: List of all available users
- `listChatRooms`: List of all conversations
- `searchQuery`: Current search input
- `filteredChatRooms`: Filtered conversation list based on search
- `filteredUsers`: Filtered user list based on search
- `newChat`: Tracks newly created conversations

### Key Functions

#### `fetchUsers()`
Fetches all user profiles from the database (excluding current user).

#### `fetchChatRooms()`
Retrieves all conversations for the current user, including participant information and last message.

#### `getConversationKeyForOtherParticipants()`
- Retrieves or unwraps the conversation encryption key
- Checks cache first for performance
- Falls back to database if not cached
- Uses E2E encryption to unwrap the key using the other participant's public key

#### `createGroupChat(name, recipientIds)`
- Creates a group conversation.
- Generates a conversation key and wraps it for each participant.
- Stores wrapped keys and caches the group key before opening the room.

## Encryption & Security

### Conversation Key Management
- **Key Caching**: Uses `ConversationKeyManager` to cache conversation keys in memory and secure storage
- **Key Wrapping**: New conversations create a shared encryption key wrapped with each participant's public key
- **Key Validation**: Validates public key sizes before encryption operations

### New Conversation Flow
1. Verify if conversation already exists between users
2. If exists: Fetch and cache the conversation key
3. If new:
   - Create new conversation via API
   - Generate new conversation encryption key
   - Wrap key for recipient using their public key
   - Store wrapped key in database
   - Cache key locally

## Navigation

### To Chat Room
When a user taps on a conversation or user:
- Retrieves conversation encryption key (from cache or database)
- Navigates to `../msg/[room_id]` with parameters:
  - `conversation_id`: The conversation ID
  - `displayName`: Other participant's display name
  - The current conversation key is placed in `SessionProvider`; it is not passed as a route parameter by the current Chat implementation.

## Dependencies
- `expo-router`: Navigation
- `@/utility/messages`: API functions
- `@/utility/session/SessionProvider`: Session and conversation-key context
- `@/utility/push-notification/push-Notification`: Push notification handling
- `@/utility/securedMessage/secured`: Message encryption
- `@/utility/securedMessage/ConversationKeyManagement`: Key management

## UI Components Used
- `Box`, `HStack`, `VStack`: Layout components
- `Heading`, `Text`: Text components
- `Input`, `InputField`: Search input
- `Avatar`, `AvatarBadge`, `AvatarFallbackText`, `AvatarImage`: User avatars
- `Pressable`: Touchable components
- `ScrollView`: Scrollable containers
