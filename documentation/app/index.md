# Index Screen (Authentication)

## Overview
The Index screen (`index.tsx`) is the entry point of the application, serving as the authentication interface. It provides login and registration functionality for users to access the chat application.

## Features

### Authentication
- **Login**: Sign in with email and password
- **Registration**: Create new account with email, password, and automatic key pair generation
- **Password Visibility**: Toggle to show/hide password
- **Form Validation**: Basic email and password validation

### User Flow
- **After Login**: 
  - If profile incomplete → Redirects to Complete Profile
  - If profile complete → Redirects to Chat tab
- **After Registration**: 
  - Shows success message
  - Requires email verification
  - Generates encryption key pair

## Key Components

### State Management
- `email`: User's email input
- `password`: User's password input
- `message`: Status/error messages
- `showPassword`: Toggle for password visibility
- `showAlertDialog`: Controls alert dialog visibility

### Key Functions

#### `signInAsync()`
Handles user login.
1. Calls `authAPI.signIn()` with email and password
2. On success:
   - Fetches user profile
   - Checks if display name exists
   - Redirects to Complete Profile or Chat tab accordingly
3. On error: Displays error message in alert dialog

#### `signUpAsync()`
Handles user registration.
1. Generates encryption key pair using `MessageEncryption.generateKeyPair()`
2. Calls `authAPI.signUp()` with email, password, and public key
3. On success:
   - Shows success message
   - Private key stored in secure storage
   - Public key saved to user profile
4. On error:
   - Displays error message
   - Deletes private key if registration fails

#### `getPublicKey()`
Generates a new encryption key pair for the user.
- Uses `MessageEncryption.generateKeyPair()`
- Returns public key for database storage
- Private key automatically stored in secure storage

## Encryption Setup

### Key Pair Generation
- **Algorithm**: Uses tweetnacl for key pair generation
- **Key Size**: 32 bytes (256 bits) for both public and private keys
- **Storage**: 
  - Public key: Stored in user profile (database)
  - Private key: Stored in device secure storage (expo-secure-store)
- **Purpose**: Enables end-to-end encryption for messages

### Key Management
- **Generation**: Happens during registration
- **Storage**: Private key stored with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` access
- **Cleanup**: Private key deleted if registration fails

## UI Components

### Form Layout
- **Email Input**: Text input for email address
- **Password Input**: Secure text input with visibility toggle
- **Login Button**: Primary action button
- **Register Button**: Secondary action button
- **Alert Dialog**: Shows success/error messages

### Password Visibility Toggle
- Eye icon to show password
- Eye-off icon to hide password
- Toggle button in password input slot

## Navigation Logic

### Post-Authentication Routing
The app uses `UserContext` to handle routing:
1. User signs in/up
2. User context checks profile
3. If `displayname` is null → `/CompleteProfile`
4. If `displayname` exists → `/tabs/(tabs)/Chat`

### Alert Dialog
- **Purpose**: Display authentication status messages
- **Messages**:
  - Registration success: "Registration successful! Please check your email to verify your account."
  - Login errors: Error message from API
  - Registration errors: Error message from API

## Error Handling
- **API Errors**: Captured and displayed in alert dialog
- **Key Generation Errors**: Handled, private key cleaned up on failure
- **Network Errors**: Handled by API layer, shown to user

## Security Features

### Password Security
- **Secure Input**: Password field uses `secureTextEntry` by default
- **Visibility Toggle**: Optional password visibility for user convenience
- **No Password Storage**: Passwords never stored, only used for authentication

### Key Security
- **Secure Storage**: Private keys stored in device secure storage
- **Device-Only Access**: Keys only accessible when device is unlocked
- **Automatic Cleanup**: Failed registrations clean up keys

## Dependencies
- `expo-router`: Navigation
- `@/utility/messages`: Authentication API (authAPI)
- `@/utility/session/UserContext`: User context
- `@/utility/securedMessage/secured`: Encryption utilities

## UI Components Used
- `Box`, `VStack`: Layout components
- `FormControl`: Form container
- `Heading`, `Text`: Text components
- `Input`, `InputField`, `InputSlot`, `InputIcon`: Input fields
- `Button`, `ButtonText`: Action buttons
- `AlertDialog`: Status message dialog
- `Divider`: Visual separator
- `EyeIcon`, `EyeOffIcon`: Password visibility icons

## User Experience

### Registration Flow
1. User enters email and password
2. Clicks "Register"
3. Key pair generated automatically
4. Account created with public key
5. Success message shown
6. User must verify email before full access

### Login Flow
1. User enters email and password
2. Clicks "Login"
3. Authentication verified
4. Profile checked
5. Redirected to appropriate screen based on profile completion

## Integration Points
- **Supabase Auth**: Handles authentication
- **Profile API**: Creates/updates user profile
- **User Context**: Manages user state and routing
- **Encryption Service**: Generates and manages encryption keys
