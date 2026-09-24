import { Alert } from 'react-native';
import { router } from 'expo-router';
import { IdentityKeyState } from './secured';

/**
 * Send a device whose identity key is missing or wrong to key recovery.
 *
 * Shared by Bootstrap and the tabs layout so both give the same explanation
 * and land on the same screen. `recovery` tells ScanningKeys it was reached
 * from a guard rather than from Settings, so it can offer a way out - it sits
 * outside the tabs, so without one the user has nowhere to go.
 */
export function routeToKeyRecovery(state: Exclude<IdentityKeyState, 'ok'>): void {
  Alert.alert(
    'Sync your keys',
    state === 'missing'
      ? 'This device does not have your encryption key yet. Open Share Keys on a device you already use, then scan the code shown here.'
      : 'The encryption key on this device belongs to a different account. Scan the code from a device you already use to restore the right one.'
  );

  router.replace({
    pathname: '/tabs/managekeys/ScanningKeys',
    params: { recovery: '1' },
  });
}
