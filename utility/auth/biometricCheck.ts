import * as LocalAuthentication from 'expo-local-authentication';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Constants } from '@/constants/Constants';

/*
  'ok'       - the user passed Face ID / fingerprint.
  'fallback' - it didn't work: no hardware, nothing enrolled, locked out, a
               failed match, or the user tapped "Use app PIN" / cancelled.
               The caller shows the app PIN wall instead (never a free pass).
*/
export type BiometricOutcome = 'ok' | 'fallback';

/**
 * Whether this account turned on Touch ID or Face ID (EnableBiometric).
 * Someone who skipped that step goes straight to the app PIN.
 */
export async function hasChosenBiometrics(userId: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const keys = Constants.ASYNC_STORAGE_KEYS;
    const [touchId, faceId] = await Promise.all([
      AsyncStorage.getItem(keys.TOUCH_ID + userId),
      AsyncStorage.getItem(keys.FACE_ID + userId),
    ]);
    return touchId === 'true' || faceId === 'true';
  } catch {
    return false;
  }
}

export async function biometricCheck(reason: string): Promise<BiometricOutcome> {
  try {
    if (!(await LocalAuthentication.hasHardwareAsync())) return 'fallback';
    if (!(await LocalAuthentication.isEnrolledAsync())) return 'fallback';

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: reason,
      // The app PIN is the fallback, not the device passcode: the button on
      // the prompt (iOS "fallback", Android "cancel") leads to the PIN wall.
      fallbackLabel: 'Use app PIN',
      cancelLabel: 'Use app PIN',
      disableDeviceFallback: true,
    });

    return result.success ? 'ok' : 'fallback';
  } catch {
    return 'fallback';
  }
}
