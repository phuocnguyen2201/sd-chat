import * as LocalAuthentication from 'expo-local-authentication';
import { Alert } from 'react-native';

export const checkBiometricAvailability = async () => {
  try {

    const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) return { success: false, error: 'Hardware not supported' };

      // 2. Check if the user has fingerprints or FaceID enrolled
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      if (!isEnrolled) return { success: false, error: 'No biometrics enrolled' };

      // 3. Trigger authentication
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Authenticate with Face ID / Fingerprint',
        fallbackLabel: 'Use Passcode',
        disableDeviceFallback: false, // Set to true if you want to FORBID PIN fallback
      });

      return result;
  } catch (error) {
    Alert.alert('Error', 'Failed to check biometric availability');
    return { success: false, error: error };
  }
};