# Complete Profile Screen

**Source:** [`app/CompleteProfile.tsx`](../../app/CompleteProfile.tsx)

## Overview
The Complete Profile screen is shown to new users after registration to collect essential profile information. It requires users to set a display name and optionally upload an avatar before they can access the main chat interface.

## Features

### Profile Setup
- **Display Name**: Required text input for user's display name
- **Avatar Upload**: Optional avatar selection (camera or gallery)
- **Form Validation**: Ensures display name is provided before saving

### Image Handling
- **Camera**: Option to take a new photo
- **Gallery**: Option to select from photo library
- **Image Processing**: Automatic resizing and optimization
- **Avatar Preview**: Shows selected avatar before saving

### Navigation Flow
- **On Success**: Redirects to Chat when biometric setup is satisfied; otherwise redirects to `/tabs/managekeys/EnableBiometric`
- **Back to Home**: Option to sign out and return to login screen

## Key Components

### State Management
- `displayName`: User's display name input
- `loading`: Loading state during image upload
- `avatar`: Avatar URL
- `showActionsheet`: Controls avatar selection actionsheet visibility

### Key Functions

#### `updateProfile()`
Saves the user profile with display name.
- Validates user ID
- Calls `profileAPI.updateProfile()` with display name
- On success: Navigates to Chat tab
- On error: Logs error and prevents navigation

#### `pickImage()`
Handles image selection from gallery.
- Requests media library permissions
- Opens image picker
- Resizes image (128px width, 70% quality)
- Uploads to Supabase storage
- Updates avatar state with new URL

#### `takePicture()`
Handles camera photo capture.
- Requests camera permissions
- Opens camera interface
- Resizes image (128px width, 70% quality)
- Uploads to Supabase storage
- Updates avatar state with new URL

## User Context Integration

### Profile Refresh
- Calls `refreshProfile()` on component mount
- Ensures latest profile data is loaded
- Uses `useUser()` hook for user and profile data

## Image Processing

### Resizing
- **Width**: 128 pixels
- **Compression**: 70% quality
- **Format**: JPEG
- **Purpose**: Optimize storage and loading performance

### Storage
- **Bucket**: `avatars`
- **Path**: `avatars/{userId}/{timestamp}-{filename}`
- **URL Expiration**: Determined by the storage helper
- **Cleanup**: Storage behavior is handled by `storageAPIs`

## UI Components

### Form Layout
- **Form Control**: Container with border and padding
- **Heading**: "Complete the profile" title
- **Input Field**: Display name text input
- **Avatar Section**: Avatar display with edit button
- **Action Buttons**: Save and Back to Home buttons

### Avatar Actionsheet
- **Take Photo**: Opens camera
- **Select from album**: Opens gallery
- **Loading Indicator**: Shows spinner during upload

## Navigation Logic

### Conditional Routing
`Bootstrap` routes users with a missing `displayname` here. This screen saves the display name and then checks the user-specific biometric and skip flags.

### After Profile Completion
- Profile is saved through `profileAPI.updateProfile()`.
- When Touch ID or Face ID is enabled and the skip flag is set, navigation goes to `/tabs/(tabs)/Chat`.
- Otherwise navigation goes to `/tabs/managekeys/EnableBiometric`.

## Error Handling
- **API Errors**: Logged to console, prevents navigation on failure
- **Image Upload Errors**: Handled gracefully, shows loading state
- **Permission Errors**: Handled by image picker (alerts shown)

## Dependencies
- `expo-router`: Navigation
- `expo-image-picker`: Image selection and camera
- `@/utility/messages`: Profile API (profileAPI)
- `@/utility/handleStorage`: Storage operations
- `@/utility/session/SessionProvider`: Session and profile context
- `@supabase/supabase-js`: Supabase client

## UI Components Used
- `Box`, `VStack`: Layout components
- `FormControl`: Form container
- `Heading`, `Text`: Text components
- `Input`, `InputField`: Display name input
- `Button`, `ButtonText`: Action buttons
- `Avatar`, `AvatarBadge`, `AvatarFallbackText`, `AvatarImage`: Avatar display
- `Actionsheet`: Avatar selection bottom sheet
- `Spinner`: Loading indicator
- `Pressable`: Touchable avatar button
- `Divider`: Visual separator

## Security Considerations
- Display name is validated before saving
- Avatar uploads are scoped to user's ID
- Profile updates require authenticated user
- Image processing prevents malicious file uploads
