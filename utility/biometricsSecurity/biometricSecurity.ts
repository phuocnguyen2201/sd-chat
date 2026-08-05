import ReactNativeBiometrics, { BiometryTypes } from 'react-native-biometrics';
import { Alert } from 'react-native';

export const checkBiometricAvailability = async (): Promise<boolean> => {
  try {
    const rnBiometrics = new ReactNativeBiometrics();

    const { biometryType } = await rnBiometrics.isSensorAvailable();
    if (biometryType === BiometryTypes.TouchID || 
         biometryType === BiometryTypes.FaceID || 
         biometryType === BiometryTypes.Biometrics) {

        const { success } = await rnBiometrics.simplePrompt({ promptMessage: 'Confirm your identity' });
        
        if (!success) {
            Alert.alert('Error', 'Biometric authentication failed');
            return false;
        }
        return true;

    } else {
        Alert.alert('Error', 'Biometric authentication is not available on this device');
        return false;
    }
  } catch (error) {
    Alert.alert('Error', 'Failed to check biometric availability');
    return false;
  }
};