import { Alert } from 'react-native';
import { router } from 'expo-router';
import { IdentityKeyState } from './secured';

/**
 * Send a device whose identity key is missing or wrong to key recovery.
 *
 * Shared by Bootstrap and the tabs layout so both give the same explanation
 * and land on the same screen. `recovery` tells EnterPairingCode / ScanningKeys
 * they were reached from a guard rather than from Settings, so they offer a way
 * out - they sit outside the tabs, so without one the user has nowhere to go.
 */
export function routeToKeyRecovery(state: Exclude<IdentityKeyState, 'ok'>): void {
  Alert.alert(
    'Sync your keys',
    state === 'missing'
      ? 'This device does not have your encryption key yet. Open Share Keys on a device you already use, enter the pairing code it shows here, then scan its key code.'
      : 'The encryption key on this device belongs to a different account. Open Share Keys on a device you already use and enter its pairing code here to restore the right one.'
  );

  /*
    The key code is sealed to a one-time key this device creates while entering
    the pairing code, so recovery starts there rather than at the scanner.
  */
  router.replace({
    pathname: '/tabs/managekeys/EnterPairingCode',
    params: { recovery: '1' },
  });
}
