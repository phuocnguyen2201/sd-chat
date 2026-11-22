import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '@/utility/connection';
import { usePushNotifications } from '@/utility/push-notification/push-Notification';
import { RememberedAccounts } from './RememberedAccounts';

/**
 * Sign Out on this device only.
 *
 * The account's card stays on the login screen but its saved session is
 * dropped, so the next tap asks for the password. `scope: 'local'` ends only
 * this device's session; the default ('global') also signed the user out of
 * every other phone.
 */
export async function signOutThisDevice(userId: string | undefined): Promise<void> {
  if (userId) {
    // While the session still works: the token rows are owner-only.
    await usePushNotifications.deactivateThisDevice(userId);
    await RememberedAccounts.forgetSession(userId);
  }
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (error) {
    console.warn('Sign out:', error);
  }
  await AsyncStorage.multiRemove(['user', 'profile']);
}
