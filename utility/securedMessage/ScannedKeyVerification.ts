import { profileAPI } from '@/utility/messages';
import { MessageEncryption } from './secured';

export type ScannedKeyCheck = 'ok' | 'mismatch' | 'invalid' | 'lookup-failed';

/**
 * Check a scanned identity key against what this account advertises, BEFORE
 * it is ever written to SecureStore - setPrivateKey overwrites whatever key
 * this device already trusted, so a mismatch caught after the fact is too
 * late. Mirrors VaultBackup.recoverIdentityKey's IdentityMismatchError check.
 * Kept free of UI/storage side effects so it can be tested on its own.
 */
export async function verifyScannedIdentityKey(
  userId: string,
  scannedPrivateKey: Uint8Array
): Promise<ScannedKeyCheck> {
  if (scannedPrivateKey.length !== 32) {
    return 'invalid';
  }

  const scannedPublicKey = MessageEncryption.publicKeyFromSecret(scannedPrivateKey);
  const { data: profiles, error } = await profileAPI.getParticipantsPublicKey([userId]);

  if (error) {
    return 'lookup-failed';
  }

  const advertisedPublicKey = profiles?.[0]?.public_key;
  if (advertisedPublicKey && advertisedPublicKey !== scannedPublicKey) {
    return 'mismatch';
  }

  return 'ok';
}
