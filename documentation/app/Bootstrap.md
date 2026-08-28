# Bootstrap Screen

**Source:** [`app/Bootstrap.tsx`](../../app/Bootstrap.tsx)

`Bootstrap` is the startup gate. The root index redirects here so session restoration and startup routing happen in one place.

## Responsibilities

- Reads `user`, `profile`, `loading`, `initialized`, and theme state from `SessionProvider`.
- Configures the Expo notification handler.
- Registers authenticated devices for push notifications and saves a token when it is not already present.
- Listens for notification responses and opens the related `/tabs/msg/[room_id]` route with conversation metadata.
- Routes once session initialization is complete.
- Shows a loading or initializing spinner while startup work is in progress.

## Routing rules

| Condition | Destination |
| --- | --- |
| Session is not initialized or is loading | Loading screen |
| No authenticated user | `/login` |
| `profile.displayname` is empty | `/CompleteProfile` |
| No skip flag and neither Touch ID nor Face ID is enabled | `/tabs/managekeys/EnableBiometric` |
| Otherwise | `/tabs/(tabs)/Chat` |

The startup navigation is guarded by a ref so the screen does not navigate more than once during initialization. Push-notification failures are logged and do not block navigation.

## Related state

Biometric and skip decisions are stored in `AsyncStorage` using keys from `Constants.ASYNC_STORAGE_KEYS`. Session and profile data are supplied by `SessionProvider`.
