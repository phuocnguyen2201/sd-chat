/**
 * Migration of the pre-namespacing identity key: `user_encryption_key` is
 * adopted into `user_encryption_key_<userId>` by `verifyIdentityKey` only when
 * its derived public key matches the account's profile key.
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

import { MessageEncryption } from '../secured';

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const LEGACY = 'user_encryption_key';

afterEach(() => {
  mockSecureStoreData.clear();
});

describe('verifyIdentityKey legacy migration', () => {
  it('adopts a legacy key that matches the profile and clears the legacy slot', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    mockSecureStoreData.set(LEGACY, pair.privateKey);

    expect(await MessageEncryption.verifyIdentityKey(USER, pair.publicKey)).toBe('ok');
    expect(MessageEncryption.getPrivateKey(USER)).toBe(pair.privateKey);
    expect(mockSecureStoreData.has(LEGACY)).toBe(false);
  });

  it("leaves another account's legacy key alone", async () => {
    const other = await MessageEncryption.generateKeyPair();
    const mine = await MessageEncryption.generateKeyPair();
    mockSecureStoreData.set(LEGACY, other.privateKey);

    expect(await MessageEncryption.verifyIdentityKey(USER, mine.publicKey)).toBe('missing');
    expect(MessageEncryption.getPrivateKey(USER)).toBe('');
    expect(mockSecureStoreData.get(LEGACY)).toBe(other.privateKey);
  });

  it('refuses to adopt when the profile has no public key to prove ownership', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    mockSecureStoreData.set(LEGACY, pair.privateKey);

    expect(await MessageEncryption.verifyIdentityKey(USER, '')).toBe('missing');
    expect(MessageEncryption.getPrivateKey(USER)).toBe('');
    expect(mockSecureStoreData.get(LEGACY)).toBe(pair.privateKey);
  });

  it('reports missing when neither slot holds a key', async () => {
    const pair = await MessageEncryption.generateKeyPair();
    expect(await MessageEncryption.verifyIdentityKey(USER, pair.publicKey)).toBe('missing');
  });

  it('never touches the legacy slot when a per-user key exists', async () => {
    const mine = await MessageEncryption.generateKeyPair();
    const legacy = await MessageEncryption.generateKeyPair();
    mockSecureStoreData.set(`${LEGACY}_${USER}`, mine.privateKey);
    mockSecureStoreData.set(LEGACY, legacy.privateKey);

    expect(await MessageEncryption.verifyIdentityKey(USER, mine.publicKey)).toBe('ok');
    expect(mockSecureStoreData.get(LEGACY)).toBe(legacy.privateKey);
  });
});
