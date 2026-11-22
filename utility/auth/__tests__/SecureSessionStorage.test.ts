/**
 * Session storage (security #25): the session and its refresh token must
 * never sit in AsyncStorage in the clear, a copy without this device's key
 * must open nothing, and the old plaintext session moves over once.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecure.set(key, value);
  },
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
}));

const mockAsync = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockAsync.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    mockAsync.set(key, value);
  },
  removeItem: async (key: string) => {
    mockAsync.delete(key);
  },
  multiRemove: async (keys: string[]) => {
    keys.forEach((k) => mockAsync.delete(k));
  },
}));

import { SecureSessionStorage } from '../SecureSessionStorage';

const NAME = 'sb-project-auth-token';
const SESSION = JSON.stringify({
  access_token: 'eyJ.access.token',
  refresh_token: 'refresh-abc123',
  user: { id: 'u1', email: 'a@example.com', user_metadata: { name: 'Nguyễn Văn A 🙂' } },
});

describe('SecureSessionStorage', () => {
  beforeEach(() => {
    mockSecure.clear();
    mockAsync.clear();
    SecureSessionStorage._resetKeyCache();
  });

  it('gives back what was stored, including non-ASCII text', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    expect(await SecureSessionStorage.getItem(NAME)).toBe(SESSION);
  });

  it('never writes the session or its tokens in the clear', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    const everything = [...mockAsync.keys(), ...mockAsync.values()].join('\n');
    expect(everything).not.toContain('refresh-abc123');
    expect(everything).not.toContain('eyJ.access.token');
    expect(mockAsync.has(NAME)).toBe(false);
  });

  it('keeps the key in SecureStore, not AsyncStorage', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    expect(mockSecure.size).toBe(1);
    expect([...mockAsync.values()].join('')).not.toContain([...mockSecure.values()][0]);
  });

  it('uses a fresh nonce every time', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    const first = mockAsync.get(`enc:${NAME}`);
    await SecureSessionStorage.setItem(NAME, SESSION);
    expect(mockAsync.get(`enc:${NAME}`)).not.toEqual(first);
  });

  it('opens nothing without this device key (a backup or another phone)', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    mockSecure.clear();
    SecureSessionStorage._resetKeyCache();
    expect(await SecureSessionStorage.getItem(NAME)).toBeNull();
    // The unreadable copy is dropped.
    expect(mockAsync.has(`enc:${NAME}`)).toBe(false);
  });

  it('refuses a tampered value', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    const sealed = JSON.parse(mockAsync.get(`enc:${NAME}`)!);
    const bytes = Buffer.from(sealed.c, 'base64');
    bytes[0] ^= 1;
    mockAsync.set(`enc:${NAME}`, JSON.stringify({ ...sealed, c: bytes.toString('base64') }));
    expect(await SecureSessionStorage.getItem(NAME)).toBeNull();
  });

  it('moves an old plaintext session over once, then deletes the plaintext', async () => {
    mockAsync.set(NAME, SESSION);
    expect(await SecureSessionStorage.getItem(NAME)).toBe(SESSION);
    expect(mockAsync.has(NAME)).toBe(false);
    expect(mockAsync.has(`enc:${NAME}`)).toBe(true);
    expect(await SecureSessionStorage.getItem(NAME)).toBe(SESSION);
  });

  it('removes both the sealed and any plaintext copy', async () => {
    await SecureSessionStorage.setItem(NAME, SESSION);
    mockAsync.set(NAME, 'stale');
    await SecureSessionStorage.removeItem(NAME);
    expect(mockAsync.size).toBe(0);
    expect(await SecureSessionStorage.getItem(NAME)).toBeNull();
  });
});
