export {
  // Catch any errors thrown by the Layout component.
  ErrorBoundary,
} from 'expo-router';

export const unstable_settings = {
  // Ensure that reloading on `/modal` keeps a back button present.
  initialRouteName: '(tabs)',
};

import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false, headerTitle: 'Home' }} />
      <Stack.Screen name="msg/[room_id]" />
      <Stack.Screen name="msg/ChatRoomEditing" options={{ title: 'Edit Chat Room' }} />
    </Stack>
  );
}
