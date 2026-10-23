import { Alert } from 'react-native';
import { router } from 'expo-router';
import { IdentityKeyState } from './secured';

/**
 * Send a device whose identity key is missing or wrong to key recovery.
 *
 * Shared by Bootstrap and the tabs layout so both give the same explanation
 * and land on the same screen. `recovery` tells ScanningKeys / EnterPairingCode
 * they were reached from a guard rather than from Settings, so they offer a way
 * out - they sit outside the tabs, so without one the user has nowhere to go.
 */
export function routeToKeyRecovery(state: Exclude<IdentityKeyState, 'ok'>): void {
  Alert.alert(
    'Sync your keys',
    state === 'missing'
      ? 'This device does not have your encryption key yet. Pair with a device you already use, or recover it from your backup.'
      : 'The encryption key on this device belongs to a different account. Pair with a device you already use, or recover the right one from your backup.'
  );

  /*
    Recovery starts on ScanningKeys, which shows the choices (pairing code,
    backup, delete account) instead of the camera until a pairing has started.
    Pairing still goes through EnterPairingCode first: the key code is sealed to
    a one-time key this device creates there.
  */
  router.replace({
    pathname: '/tabs/managekeys/ScanningKeys',
    params: { recovery: '1' },
  });
}
