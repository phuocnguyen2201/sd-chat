/**
 * Key-import gate wiring (security #8a): ScanningKeys.tsx used to write a
 * scanned key first and never check it at all. `verifyAndImportIdentityKey`
 * is the extracted gate - this proves the caller actually refuses to persist
 * a key on anything but an 'ok' verification result, not just that
 * verifyScannedIdentityKey itself classifies correctly (see
 * ScanningKeysImport.test.ts for that).
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
const mockSecureStoreData = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItem: (key: string) => mockSecureStoreData.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  },
  getItemAsync: async (key: string) => mockSecureStoreData.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureStoreData.delete(key);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

jest.mock('../ScannedKeyVerification', () => ({
  verifyScannedIdentityKey: jest.fn(),
}));

import { MessageEncryption } from '../secured';
import { verifyScannedIdentityKey } from '../ScannedKeyVerification';
import { verifyAndImportIdentityKey } from '../ImportScannedIdentityKey';

const mockedVerify = verifyScannedIdentityKey as jest.Mock;
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';

afterEach(() => {
  mockSecureStoreData.clear();
  jest.clearAllMocks();
});

describe('verifyAndImportIdentityKey', () => {
  it('writes the scanned key when verification says ok', async () => {
    mockedVerify.mockResolvedValue('ok');
    const scanned = await MessageEncryption.generateKeyPair();

    const check = await verifyAndImportIdentityKey(USER, scanned.privateKey);

    expect(check).toBe('ok');
    expect(MessageEncryption.getPrivateKey(USER)).toBe(scanned.privateKey);
  });

  it('never writes the key when verification reports a mismatch', async () => {
    mockedVerify.mockResolvedValue('mismatch');
    const scanned = await MessageEncryption.generateKeyPair();

    const check = await verifyAndImportIdentityKey(USER, scanned.privateKey);

    expect(check).toBe('mismatch');
    expect(MessageEncryption.getPrivateKey(USER)).toBe('');
  });

  it('never writes the key when the lookup used to verify it fails', async () => {
    mockedVerify.mockResolvedValue('lookup-failed');
    const scanned = await MessageEncryption.generateKeyPair();

    const check = await verifyAndImportIdentityKey(USER, scanned.privateKey);

    expect(check).toBe('lookup-failed');
    expect(MessageEncryption.getPrivateKey(USER)).toBe('');
  });
});
