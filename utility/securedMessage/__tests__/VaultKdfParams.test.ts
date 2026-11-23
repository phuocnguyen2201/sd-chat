/**
 * Security #24: key-backup recovery must refuse scrypt settings it did not
 * write, before downloading the blob or running scrypt, so a tampered
 * `key_backups` row can't hang or crash the app.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockScrypt = jest.fn<(...args: unknown[]) => Promise<Uint8Array>>();
jest.mock('@noble/hashes/scrypt', () => ({
  scryptAsync: (...args: unknown[]) => mockScrypt(...args),
}));

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(n),
}));

let mockRow: Record<string, unknown> | null = null;
jest.mock('@/utility/connection', () => ({
  supabase: {
    auth: {
      getSession: async () => ({
        data: { session: { access_token: 'at', user: { id: 'u1' } } },
        error: null,
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: mockRow, error: null }) }),
      }),
    }),
  },
}));

jest.mock('@/utility/securedMessage/secured', () => ({
  MessageEncryption: {
    base64ToBytes: (b64: string) => new Uint8Array(Buffer.from(b64, 'base64')),
    bytesToBase64: (b: Uint8Array) => Buffer.from(b).toString('base64'),
  },
}));
jest.mock('@/utility/securedMessage/DeviceIdentity', () => ({ DeviceIdentity: {} }));

import { checkKdfParams, checkSaltAndNonce, UnsupportedBackupError } from '../VaultKdfParams';
import { recoverIdentityKey } from '../VaultBackup';

const GOOD = { kdf: 'scrypt', kdf_n: 1 << 15, kdf_r: 8, kdf_p: 1 };
const b64 = (n: number) => Buffer.alloc(n).toString('base64');

describe('checkKdfParams', () => {
  it('accepts the settings backups are written with', () => {
    expect(checkKdfParams(GOOD)).toEqual({ N: 1 << 15, r: 8, p: 1 });
  });

  it('accepts the edges of the range', () => {
    expect(() => checkKdfParams({ ...GOOD, kdf_n: 1 << 14 })).not.toThrow();
    expect(() => checkKdfParams({ ...GOOD, kdf_n: 1 << 16 })).not.toThrow(); // 64 MiB at r=8
    expect(() => checkKdfParams({ ...GOOD, kdf_p: 4 })).not.toThrow();
  });

  it.each([
    ['a huge N', { kdf_n: 2 ** 30 }],
    ['N above 2^17', { kdf_n: 1 << 18 }],
    ['N below 2^14', { kdf_n: 1 << 10 }],
    ['N not a power of two', { kdf_n: 40000 }],
    ['r = 0', { kdf_r: 0 }],
    ['r above 16', { kdf_r: 32 }],
    ['p = 0', { kdf_p: 0 }],
    ['p above 4', { kdf_p: 1000 }],
    ['too much memory (2^17 at r=8 is 128 MiB)', { kdf_n: 1 << 17 }],
    ['a string', { kdf_n: '32768' }],
    ['a fraction', { kdf_r: 8.5 }],
    ['Infinity', { kdf_p: Infinity }],
    ['missing', { kdf_n: undefined }],
    ['another KDF', { kdf: 'argon2id' }],
  ])('refuses %s', (_label, patch) => {
    expect(() => checkKdfParams({ ...GOOD, ...patch })).toThrow(UnsupportedBackupError);
  });
});

describe('checkSaltAndNonce', () => {
  it('needs a 16-byte salt and a 12-byte nonce', () => {
    expect(() => checkSaltAndNonce(new Uint8Array(16), new Uint8Array(12))).not.toThrow();
    expect(() => checkSaltAndNonce(new Uint8Array(0), new Uint8Array(12))).toThrow(UnsupportedBackupError);
    expect(() => checkSaltAndNonce(new Uint8Array(16), new Uint8Array(24))).toThrow(UnsupportedBackupError);
  });
});

describe('recoverIdentityKey with a tampered row', () => {
  const fetchSpy = jest.fn<typeof fetch>();

  beforeEach(() => {
    mockScrypt.mockReset();
    fetchSpy.mockReset();
    (globalThis as { fetch: unknown }).fetch = fetchSpy;
  });

  it('refuses a huge N without downloading the blob or running scrypt', async () => {
    mockRow = { ...GOOD, kdf_n: 2 ** 30, kdf_salt: b64(16), nonce: b64(12), blob_version: 1 };
    await expect(recoverIdentityKey('passphrase')).rejects.toBeInstanceOf(UnsupportedBackupError);
    expect(mockScrypt).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refuses a salt of the wrong length the same way', async () => {
    mockRow = { ...GOOD, kdf_salt: b64(1), nonce: b64(12), blob_version: 1 };
    await expect(recoverIdentityKey('passphrase')).rejects.toBeInstanceOf(UnsupportedBackupError);
    expect(mockScrypt).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
