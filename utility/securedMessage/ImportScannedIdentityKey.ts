import { MessageEncryption } from './secured';
import { ScannedKeyCheck, verifyScannedIdentityKey } from './ScannedKeyVerification';

/**
 * Verify a scanned identity key against the account BEFORE it is ever
 * written to SecureStore, and only write it on an 'ok' result. Split out of
 * ScanningKeys.tsx's importKeysToNewDevice so this gate - not just
 * verifyScannedIdentityKey itself - can be exercised directly in a test,
 * without pulling in the screen's UI component tree.
 */
export async function verifyAndImportIdentityKey(
  userId: string,
  scannedPrivateKeyBase64: string
): Promise<ScannedKeyCheck> {
  const scannedKey = MessageEncryption.base64ToBytes(scannedPrivateKeyBase64);
  const check = await verifyScannedIdentityKey(userId, scannedKey);

  if (check !== 'ok') {
    scannedKey.fill(0);
    return check;
  }

  MessageEncryption.setPrivateKey(userId, scannedKey);
  return check;
}
