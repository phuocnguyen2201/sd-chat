/**
 * Key-import verification (security #8a): a scanned identity key must be
 * checked against what the account advertises BEFORE it overwrites whatever
 * key this device already trusted - ScanningKeys.tsx used to write it first
 * and never check at all.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

jest.mock('@/utility/messages', () => ({
  profileAPI: {
    getParticipantsPublicKey: jest.fn(),
  },
}));

import { MessageEncryption } from '../secured';
import { verifyScannedIdentityKey } from '../ScannedKeyVerification';
import { profileAPI } from '@/utility/messages';

const mockedProfileAPI = profileAPI as any;
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';

afterEach(() => {
  jest.clearAllMocks();
});

describe('verifyScannedIdentityKey', () => {
  it('rejects a key of the wrong length without looking anything up', async () => {
    const result = await verifyScannedIdentityKey(USER, new Uint8Array(16));
    expect(result).toBe('invalid');
    expect(mockedProfileAPI.getParticipantsPublicKey).not.toHaveBeenCalled();
  });

  it('accepts a key that matches the account’s advertised public key', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    mockedProfileAPI.getParticipantsPublicKey.mockResolvedValue({
      data: [{ id: USER, public_key: pair.publicKey }],
    });

    const result = await verifyScannedIdentityKey(USER, MessageEncryption.base64ToBytes(pair.privateKey));
    expect(result).toBe('ok');
  });

  it('accepts any key when the account has no advertised key yet', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    mockedProfileAPI.getParticipantsPublicKey.mockResolvedValue({ data: [{ id: USER, public_key: null }] });

    const result = await verifyScannedIdentityKey(USER, MessageEncryption.base64ToBytes(pair.privateKey));
    expect(result).toBe('ok');
  });

  it('rejects a scanned key that belongs to a different identity', async () => {
    const scanned = await MessageEncryption.generateKeyPair();
    const advertised = await MessageEncryption.generateKeyPair();
    mockedProfileAPI.getParticipantsPublicKey.mockResolvedValue({
      data: [{ id: USER, public_key: advertised.publicKey }],
    });

    const result = await verifyScannedIdentityKey(USER, MessageEncryption.base64ToBytes(scanned.privateKey));
    expect(result).toBe('mismatch');
  });

  it('surfaces a lookup failure instead of silently accepting the key', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    mockedProfileAPI.getParticipantsPublicKey.mockResolvedValue({ data: null, error: new Error('network') });

    const result = await verifyScannedIdentityKey(USER, MessageEncryption.base64ToBytes(pair.privateKey));
    expect(result).toBe('lookup-failed');
  });
});

describe('MessageEncryption.publicKeyFromSecret', () => {
  it('derives the same public key nacl.box.keyPair.fromSecretKey would', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    const secretKey = MessageEncryption.base64ToBytes(pair.privateKey);

    const derived = MessageEncryption.publicKeyFromSecret(secretKey);

    expect(derived).toBe(pair.publicKey);
  });
});
