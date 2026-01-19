# Settings Tab

## Overview
The Settings tab allows users to manage their profile, account settings, and authentication preferences. It provides functionality to update display name, change password, update avatar, and manage account deletion.

## Features

### Profile Management
- **Display Name**: View and edit user's display name
- **Avatar Management**: 
  - View current avatar
  - Upload new avatar from photo library
  - Take new photo with camera
  - Automatic image resizing and optimization

### Account Security
- **Password Change**: Update account password with confirmation
- **Account Deletion**: Permanently delete user account and all associated data

### Authentication
- **Sign Out**: Log out from the current session
- **Session Management**: Clears local storage and redirects to home

## Key Components

### State Management
- `avatar`: Current avatar URL
- `displayName`: Current display name
- `newPassword`: New password input
- `confirmPassword`: Password confirmation input
- `showDisplayNameDialog`: Controls display name edit dialog visibility
- `showPasswordDialog`: Controls password change dialog visibility
- `showDeleteDialog`: Controls account deletion confirmation dialog
- `showActionsheet`: Controls avatar selection actionsheet visibility
- `loading`: Loading state for async operations
- `successMessage`: Success notification message

### Key Functions

#### `updateProfile()`
Updates user profile with new display name and avatar URL.
- Validates user ID
- Calls `profileAPI.updateProfile()`
- Shows success message
- Closes dialog on completion

#### `updatePassword(password, confirmPassword)`
Updates user password.
- Validates password match
- Calls `authAPI.updatePassword()`
- Shows success/error alerts
- Handles errors gracefully

#### `handleDeleteAccount()`
Permanently deletes user account.
- Deletes avatar from storage
- Deletes encryption private key
- Deletes all user conversations and messages
- Deletes user profile
- Deletes auth user
- Signs out and redirects to home

#### `pickImage()`
Opens image picker to select photo from gallery.
- Requests media library permissions
- Resizes image for optimization
- Uploads to Supabase storage
- Updates avatar URL in profile

#### `takePicture()`
Opens camera to take new photo.
- Requests camera permissions
- Resizes image for optimization
- Uploads to Supabase storage
- Updates avatar URL in profile

## Image Handling

### Image Processing
- **Resizing**: Images are automatically resized to 128px width
- **Compression**: Images are compressed to 70% quality
- **Format**: Converted to JPEG format
- **Storage**: Uploaded to Supabase `avatars` bucket

### Avatar Storage
- **Path Structure**: `avatars/{userId}/{timestamp}-{filename}`
- **URL Expiration**: 365 days signed URL
- **Cleanup**: Old avatar is deleted before uploading new one

## Dialogs & Modals

### Display Name Dialog
- Input field for new display name
- Save and Cancel buttons
- Loading state during save

### Password Dialog
- Two input fields (new password and confirmation)
- Secure text entry
- Validation for password match
- Update and Cancel buttons

### Delete Account Dialog
- Warning message about permanent deletion
- Confirmation required
- Destructive action button

### Avatar Actionsheet
- "Take Photo" option (opens camera)
- "Select from album" option (opens gallery)
- Bottom sheet UI component

## Security Features

### Encryption Key Management
- **Private Key Deletion**: When account is deleted, the user's encryption private key is removed from secure storage
- **Data Cleanup**: All encrypted messages and conversation keys are deleted

### Account Deletion Process
1. Delete avatar from storage
2. Delete encryption private key from secure storage
3. Delete all messages in user's conversations
4. Delete all conversation participants
5. Delete all conversations
6. Delete user profile
7. Delete auth user
8. Sign out and clear local storage

## Error Handling
- **Alert Dialogs**: Shows error alerts for failed operations
- **Loading States**: Displays loading indicators during async operations
- **Success Messages**: Shows success notifications for completed operations
- **Try-Catch Blocks**: Comprehensive error handling for all async operations

## Dependencies
- `expo-router`: Navigation
- `expo-image-picker`: Image selection and camera access
- `@/utility/messages`: API functions (authAPI, profileAPI)
- `@/utility/handleStorage`: Storage operations
- `@/utility/session/UserContext`: User context
- `@/utility/securedMessage/secured`: Encryption utilities
- `@supabase/supabase-js`: Supabase client
- `@react-native-async-storage/async-storage`: Local storage

## UI Components Used
- `ScrollView`: Scrollable container
- `Box`, `VStack`, `HStack`: Layout components
- `Heading`, `Text`: Text components
- `Button`, `ButtonText`: Buttons
- `Input`, `InputField`: Input fields
- `Avatar`, `AvatarBadge`, `AvatarFallbackText`, `AvatarImage`: Avatar display
- `AlertDialog`: Modal dialogs
- `Actionsheet`: Bottom sheet for avatar selection
- `Spinner`: Loading indicator
- `Pressable`: Touchable components
