/**
 * App PIN (security #21): the fallback for confirming the user when the
 * device has no Face ID / fingerprint. The attempt limit is what protects a
 * 4 or 6 digit PIN, so most of these checks are about that limit.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));

const mockSecureStoreData = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecureStoreData.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureStoreData.delete(key);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

import { AppPin, isValidPin, MAX_ATTEMPTS } from '../AppPin';

const USER = 'user-a';

describe('AppPin', () => {
  beforeEach(() => mockSecureStoreData.clear());

  it('accepts only digits of the chosen length', () => {
    expect(isValidPin('1234', 4)).toBe(true);
    expect(isValidPin('123456', 6)).toBe(true);
    expect(isValidPin('123456', 4)).toBe(false);
    expect(isValidPin('1234', 6)).toBe(false);
    expect(isValidPin('12a4', 4)).toBe(false);
    expect(isValidPin('', 4)).toBe(false);
  });

  it('refuses to store an invalid PIN', async () => {
    await expect(AppPin.setPin(USER, '12', 4)).rejects.toThrow();
    await expect(AppPin.setPin(USER, '12345', 6)).rejects.toThrow();
    expect(await AppPin.hasPin(USER)).toBe(false);
  });

  it.each([4, 6] as const)('stores and verifies a %i-digit PIN', async (length) => {
    const pin = length === 4 ? '4821' : '482193';
    await AppPin.setPin(USER, pin, length);
    expect(await AppPin.hasPin(USER)).toBe(true);
    expect(await AppPin.getLength(USER)).toBe(length);
    expect(await AppPin.verifyPin(USER, pin)).toEqual({ ok: true });
  });

  it('never stores the PIN itself', async () => {
    await AppPin.setPin(USER, '4821', 4);
    const raw = [...mockSecureStoreData.values()].join('');
    expect(raw).not.toContain('4821');
  });

  it('salts each PIN, so the same PIN gives a different hash', async () => {
    await AppPin.setPin(USER, '4821', 4);
    const first = JSON.parse([...mockSecureStoreData.values()][0]).hash;
    await AppPin.setPin(USER, '4821', 4);
    const second = JSON.parse([...mockSecureStoreData.values()][0]).hash;
    expect(first).not.toEqual(second);
  });

  it('counts down the tries left on a wrong PIN', async () => {
    await AppPin.setPin(USER, '4821', 4);
    expect(await AppPin.verifyPin(USER, '0000')).toEqual({ ok: false, attemptsLeft: MAX_ATTEMPTS - 1 });
    expect(await AppPin.verifyPin(USER, '0000')).toEqual({ ok: false, attemptsLeft: MAX_ATTEMPTS - 2 });
  });

  it('resets the count after a correct PIN', async () => {
    await AppPin.setPin(USER, '4821', 4);
    await AppPin.verifyPin(USER, '0000');
    await AppPin.verifyPin(USER, '0000');
    expect(await AppPin.verifyPin(USER, '4821')).toEqual({ ok: true });
    expect(await AppPin.verifyPin(USER, '0000')).toEqual({ ok: false, attemptsLeft: MAX_ATTEMPTS - 1 });
  });

  it(`removes the PIN after ${MAX_ATTEMPTS} wrong tries, even the right one is refused after`, async () => {
    await AppPin.setPin(USER, '4821', 4);
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      await AppPin.verifyPin(USER, '0000');
    }
    expect(await AppPin.verifyPin(USER, '0000')).toEqual({ ok: false, locked: true });
    expect(await AppPin.hasPin(USER)).toBe(false);
    expect(await AppPin.verifyPin(USER, '4821')).toEqual({ ok: false, locked: true });
  });

  it('keeps the failure count in storage, not memory', async () => {
    await AppPin.setPin(USER, '4821', 4);
    await AppPin.verifyPin(USER, '0000');
    const stored = JSON.parse([...mockSecureStoreData.values()][0]);
    expect(stored.failed).toBe(1);
  });

  it('keeps each account on the device separate', async () => {
    await AppPin.setPin(USER, '4821', 4);
    expect(await AppPin.hasPin('user-b')).toBe(false);
    expect(await AppPin.verifyPin('user-b', '4821')).toEqual({ ok: false, locked: true });
  });

  it('treats a corrupted entry as no PIN', async () => {
    mockSecureStoreData.set(`app_pin_v1_${USER}`, 'not json');
    expect(await AppPin.hasPin(USER)).toBe(false);
    expect(await AppPin.verifyPin(USER, '4821')).toEqual({ ok: false, locked: true });
  });

  it('needs a user id', async () => {
    await expect(AppPin.hasPin('')).rejects.toThrow();
  });
});
