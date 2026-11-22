import 'react-native-url-polyfill/auto'
import { AppState, Platform } from 'react-native'
import { createClient, processLock } from '@supabase/supabase-js'
import { SecureSessionStorage } from './auth/SecureSessionStorage'

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL!,
  process.env.EXPO_PUBLIC_SUPABASE_KEY!,
  {
    auth: {
      // Sealed with a device-only key instead of plain AsyncStorage (security #25).
      storage: SecureSessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      lock: processLock,
    },
  })

/*
  Supabase's React Native setup: run the token refresh only while the app is
  in the foreground. Without it the timer stalls in the background, and on
  resume an expired access token and several callers race to refresh; the
  refresh token is single-use, so the loser gets "Invalid Refresh Token".
*/
if (Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh()
    } else {
      supabase.auth.stopAutoRefresh()
    }
  })
}
