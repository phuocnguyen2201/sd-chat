# Chat Room Screen

**Source:** [`app/tabs/msg/[room_id].tsx`](../../../app/tabs/msg/[room_id].tsx)

## Overview
The Chat Room screen (`[room_id].tsx`) is the individual conversation interface where users can send and receive messages in real-time. It supports text messages, image sharing, and file attachments with end-to-end encryption.

## Features

### Message Display
- **Message List**: Displays all messages in chronological order
- **Message Bubbles**: 
  - Sent messages: Blue background, aligned right
  - Received messages: Gray background, aligned left
- **Message Types**:
  - **Text**: Encrypted text messages
  - **Image**: Clickable images with zoom functionality
  - **File**: Downloadable file attachments
- **Empty State**: Shows message when conversation has no messages

### Message Sending
- **Text Input**: Input field for typing messages
- **Send Button**: Sends encrypted message
- **Image Upload**: Button to select and send images
- **File Upload**: Button to select and send files
- **Keyboard Handling**: Keyboard avoiding view for better UX

### Real-time Updates
- **Live Messages**: Subscribes to Supabase real-time channel for new messages
- **Automatic Updates**: New messages appear instantly without refresh
- **Scroll Management**: Auto-scrolls to bottom when new messages arrive

### Image Handling
- **Image Display**: Shows images inline in chat
- **Zoom Functionality**: Tap image to view in full-screen zoom modal
- **Image Upload**: Uploads images to Supabase storage and sends as message

### File Handling
- **File Display**: Shows download link for file attachments
- **File Upload**: Uploads files to Supabase storage and sends as message
- **Download**: Opens file URL in browser for download
- **Emoji reactions**: Long-press a message to add or update a reaction.
- **Edit and delete**: Long-press a message to edit or delete it.
- **Forward**: Long-press a message to forward text or file/image references.

## Key Components

### Route Parameters
- `conversation_id`: The conversation ID
- `displayName`: Other participant's display name
- `public_key`: Optional public key used when unwrapping a conversation key

The active conversation key is loaded through `SessionProvider` and `ConversationKeyManager`, rather than passed as `conversationKey` navigation data.

### State Management
- `avatarUrl`: URL for zoomed image
- `messages`: Array of all messages in conversation
- `newMessage`: Current message input text
- `loading`: Loading state for send operation
- `modalVisible`: Controls image zoom modal visibility
- `scrollRef`: Reference to ScrollView for auto-scrolling

### Key Functions

#### `loadMessages()`
Loads initial messages from database.
- Calls the `get_messages_with_reactions` RPC for the conversation and limits the result to 30 messages.
- Subscribes to message inserts, updates, and deletes.

#### `handleSend()`
Sends a new encrypted message.
1. Validates message content and conversation ID
2. Gets current user ID
3. Encrypts message using conversation key
4. Inserts message into database with:
   - Encrypted content (ciphertext)
   - Nonce for encryption
   - Wrapped key and key nonce
5. Clears input field
6. Real-time subscription handles UI update

#### `pickImage()`
Handles image selection and upload.
- Requests media library permissions
- Opens image picker
- Uploads image to Supabase storage
- Creates message with image URL
- Message type: 'image'

#### `pickFile()`
Handles file selection and upload.
- Opens document picker
- Uploads file to Supabase storage
- Creates message with file URL
- Message type: 'file'

## Encryption

### Message Encryption
- **Algorithm**: ChaCha20-Poly1305
- **Key Management**: Uses conversation key passed as route parameter
- **Encryption Process**:
  1. Generate unique message key
  2. Encrypt message with message key
  3. Wrap message key with conversation key
  4. Store ciphertext, nonce, wrapped key, and key nonce

### Message Decryption
- **Decryption Process**:
  1. Unwrap message key using conversation key
  2. Decrypt message using unwrapped message key
  3. Display plaintext message

### Security Features
- Each message uses a unique encryption key
- Keys are wrapped with conversation key
- Nonces prevent replay attacks
- Authentication tags ensure message integrity

## Real-time Subscriptions

### Message Channel
- **Channel Name**: `public:messages:conversation_id=eq.{conversation_id}`
- **Events**: `INSERT`, `UPDATE`, and `DELETE` on `messages` table
- **Filter**: Messages for current conversation only
- **Callback**: Adds new message to state array

### Cleanup
- Unsubscribes from channel on component unmount
- Prevents memory leaks and duplicate subscriptions

## UI/UX Features

### Keyboard Avoidance
- Uses `KeyboardAvoidingView` for iOS and Android
- Adjusts view when keyboard appears
- Maintains input field visibility

### Auto-scroll
- Automatically scrolls to bottom when:
  - New messages arrive
  - Component mounts with existing messages
- Uses `ScrollView` ref for smooth scrolling

### Message Rendering
- **Text Messages**: Decrypted and displayed as text
- **Image Messages**: Rendered as clickable images
- **File Messages**: Rendered as download links with icon

### Input Bar
- Fixed at bottom of screen
- Contains:
  - Image upload button (🖼️)
  - File upload button (📎)
  - Text input field
  - Send button (➤)
- Disabled state when input is empty or loading

## Storage Integration

### Image Storage
- **Bucket**: `storage-msg`
- **Path**: `images/{timestamp}-{filename}`
- **URL Expiration**: 7 days signed URL
- **Content Type**: `image/jpeg`

### File Storage
- **Bucket**: `chat-files`
- **Path**: `files/{timestamp}-{filename}`
- **URL Expiration**: 7 days signed URL
- **Content Type**: Determined by file type

## Error Handling
- **Permission Errors**: Shows alerts for denied permissions
- **Upload Errors**: Handles upload failures gracefully
- **Decryption Errors**: Handles decryption failures (may show encrypted content)
- **Network Errors**: Handles connection issues

## Dependencies
- `expo-router`: Navigation and route parameters
- `expo-image-picker`: Image selection
- `expo-document-picker`: File selection
- `@supabase/supabase-js`: Database and real-time
- `@/utility/handleStorage`: Storage operations
- `@/utility/securedMessage/secured`: Message encryption
- `@/utility/session/SessionProvider`: Session and conversation-key context
- `@/components/ZoomImage`: Image zoom component

## UI Components Used
- `KeyboardAvoidingView`: Keyboard handling
- `ScrollView`: Message list container
- `Box`, `VStack`, `HStack`: Layout components
- `Text`: Message text display
- `Image`: Image message display
- `Input`, `InputField`: Message input
- `Pressable`: Touchable buttons
- `Link`, `LinkText`: File download links
- `Icon`: File download icon
