import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { pbkdf2Async } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

/*
  The app PIN (security #21): the fallback for confirming "it's really you"
  on a device with no Face ID / fingerprint enrolled.

  Only a salted PBKDF2 hash is kept, in Secure Store (Keychain / Keystore),
  namespaced by the local user like every other per-account secret on the
  device. A 4 or 6 digit PIN has very few possible values, so the hash is not
  what protects it - the attempt limit is. After MAX_ATTEMPTS wrong tries the
  PIN is wiped and only the account password can set a new one, so guessing
  through the app runs out long before the PIN space does.
*/

export type PinLength = 4 | 6;
export const PIN_LENGTHS: readonly PinLength[] = [4, 6];
export const MAX_ATTEMPTS = 5;

const ITERATIONS = 10_000;
const STORE_OPTIONS = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };

type StoredPin = {
  v: 1;
  length: PinLength;
  salt: string;
  hash: string;
  failed: number;
};

export type VerifyResult =
  | { ok: true }
  | { ok: false; attemptsLeft: number }
  // The PIN was wiped after too many wrong tries; the password is needed now.
  | { ok: false; locked: true };

function storageKey(userId: string): string {
  if (!userId) {
    throw new Error('A user id is required to reach the app PIN');
  }
  return `app_pin_v1_${userId}`;
}

export function isValidPin(pin: string, length: PinLength): boolean {
  return pin.length === length && /^\d+$/.test(pin);
}

async function derive(pin: string, salt: Uint8Array): Promise<string> {
  const key = await pbkdf2Async(sha256, pin, salt, { c: ITERATIONS, dkLen: 32 });
  return bytesToHex(key);
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function read(userId: string): Promise<StoredPin | null> {
  const raw = await SecureStore.getItemAsync(storageKey(userId), STORE_OPTIONS);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StoredPin;
    if (parsed?.v !== 1 || !PIN_LENGTHS.includes(parsed.length) || !parsed.salt || !parsed.hash) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function write(userId: string, stored: StoredPin): Promise<void> {
  await SecureStore.setItemAsync(storageKey(userId), JSON.stringify(stored), STORE_OPTIONS);
}

export const AppPin = {
  async hasPin(userId: string): Promise<boolean> {
    return (await read(userId)) !== null;
  },

  async getLength(userId: string): Promise<PinLength | null> {
    return (await read(userId))?.length ?? null;
  },

  /**
   * Store a new PIN, replacing any old one. Callers must have confirmed the
   * user first (password, or the current PIN / biometrics when changing it):
   * whoever sets the PIN can pass every check that falls back to it.
   */
  async setPin(userId: string, pin: string, length: PinLength): Promise<void> {
    if (!isValidPin(pin, length)) {
      throw new Error(`The PIN must be exactly ${length} digits`);
    }
    const salt = Crypto.getRandomBytes(16);
    await write(userId, {
      v: 1,
      length,
      salt: bytesToHex(salt),
      hash: await derive(pin, salt),
      failed: 0,
    });
  },

  async verifyPin(userId: string, pin: string): Promise<VerifyResult> {
    const stored = await read(userId);
    if (!stored) {
      return { ok: false, locked: true };
    }

    const candidate = await derive(pin, hexToBytes(stored.salt));
    if (constantTimeEqual(candidate, stored.hash)) {
      if (stored.failed !== 0) {
        await write(userId, { ...stored, failed: 0 });
      }
      return { ok: true };
    }

    const failed = stored.failed + 1;
    if (failed >= MAX_ATTEMPTS) {
      await AppPin.clearPin(userId);
      return { ok: false, locked: true };
    }
    // Saved before answering, so restarting the app does not reset the count.
    await write(userId, { ...stored, failed });
    return { ok: false, attemptsLeft: MAX_ATTEMPTS - failed };
  },

  async clearPin(userId: string): Promise<void> {
    await SecureStore.deleteItemAsync(storageKey(userId), STORE_OPTIONS);
  },
};
