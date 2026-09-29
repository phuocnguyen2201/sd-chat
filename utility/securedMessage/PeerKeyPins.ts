import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';

export type PeerKeyState = 'new' | 'match' | 'changed';

/*
  Pins are namespaced by the LOCAL user, mirroring the identity-key storage
  in secured.ts: signing a second account in on the same device must not mix
  up who trusts which peer's key.
*/
function peerKeyStorage(userId: string, peerId: string): string {
  if (!userId || !peerId) {
    throw new Error('A local user id and a peer id are required to reach a pinned key');
  }
  return `peer_public_key_${userId}_${peerId}`;
}

export const PeerKeyPins = {
  /**
   * Trust-on-first-use: the first public key ever seen for a peer is pinned
   * immediately, since there is nothing to compare it against yet. Every
   * later call compares against that pin instead of trusting the key again.
   */
  async checkPeerKey(
    userId: string,
    peerId: string,
    publicKey: string
  ): Promise<{ state: PeerKeyState; pinned: string | null }> {
    const storageKey = peerKeyStorage(userId, peerId);
    const pinned = await SecureStore.getItemAsync(storageKey, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    if (!pinned) {
      await SecureStore.setItemAsync(storageKey, publicKey, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
      return { state: 'new', pinned: publicKey };
    }

    return { state: pinned === publicKey ? 'match' : 'changed', pinned };
  },

  /**
   * Overwrite the pin for `peerId`. Call only after the user has explicitly
   * confirmed the new key - never on a bare key-mismatch.
   */
  async trustPeerKey(userId: string, peerId: string, publicKey: string): Promise<void> {
    await SecureStore.setItemAsync(peerKeyStorage(userId, peerId), publicKey, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  },

  /**
   * Ask the user whether to trust a peer's changed key. Resolves `true` only
   * on the explicit "Trust new key" action - dismissing or cancelling
   * refuses the new key, matching a fail-closed default.
   */
  confirmPeerKeyChange(peerLabel: string): Promise<boolean> {
    return new Promise((resolve) => {
      Alert.alert(
        'Security key changed',
        `${peerLabel || 'This contact'}'s security key has changed since you last spoke. ` +
          'This can happen after they reinstall the app or set up a new device, but it can ' +
          'also mean someone is trying to intercept your messages. Only continue if you trust this change.',
        [
          { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
          { text: 'Trust new key', style: 'destructive', onPress: () => resolve(true) },
        ],
        { cancelable: false }
      );
    });
  },
};
