import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import * as nacl from 'tweetnacl';
import { utf8ToBytes } from '@noble/hashes/utils';

/*
  Encrypted storage for login sessions (security #25).

  Supabase kept its session - refresh token included - in AsyncStorage, which
  is plain files on disk and, with Android backups on, part of the backup.
  SecureStore can't simply replace it: values over ~2 KB are not reliable
  there, and a session is often bigger. So the split Supabase recommends for
  React Native:

  - a random 32-byte key in SecureStore, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY:
    readable by background work after the first unlock, never in a backup and
    never moved to another phone;
  - each value sealed with that key (XSalsa20-Poly1305) and the ciphertext
    in AsyncStorage under `enc:<key>`.

  A copy of AsyncStorage without the key - a backup, another phone - opens
  nothing. If the key is gone, every value reads as missing, so the worst case
  is signing in again.
*/

const KEY_NAME = 'session_storage_key_v1';
const PREFIX = 'enc:';
const KEY_OPTIONS = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

let keyPromise: Promise<Uint8Array> | null = null;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToUtf8(bytes: Uint8Array): string {
  if (typeof TextDecoder !== 'undefined') {
    return new TextDecoder().decode(bytes);
  }
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return decodeURIComponent(escape(binary));
}

async function loadKey(): Promise<Uint8Array> {
  const stored = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  if (stored) {
    const key = fromBase64(stored);
    if (key.length === nacl.secretbox.keyLength) return key;
  }
  // No key yet (or a broken one): start fresh. Anything sealed with an old
  // key can't be opened any more and reads as missing.
  const key = Crypto.getRandomBytes(nacl.secretbox.keyLength);
  await SecureStore.setItemAsync(KEY_NAME, toBase64(key), KEY_OPTIONS);
  return key;
}

function getKey(): Promise<Uint8Array> {
  if (!keyPromise) {
    keyPromise = loadKey().catch((error) => {
      keyPromise = null;
      throw error;
    });
  }
  return keyPromise;
}

export function seal(key: Uint8Array, plaintext: string): string {
  const nonce = Crypto.getRandomBytes(nacl.secretbox.nonceLength);
  const box = nacl.secretbox(utf8ToBytes(plaintext), nonce, key);
  return JSON.stringify({ v: 1, n: toBase64(nonce), c: toBase64(box) });
}

export function open(key: Uint8Array, sealed: string): string | null {
  try {
    const parsed = JSON.parse(sealed) as { v?: number; n?: string; c?: string };
    if (parsed?.v !== 1 || !parsed.n || !parsed.c) return null;
    const plain = nacl.secretbox.open(fromBase64(parsed.c), fromBase64(parsed.n), key);
    return plain ? bytesToUtf8(plain) : null;
  } catch {
    return null;
  }
}

export const SecureSessionStorage = {
  async getItem(name: string): Promise<string | null> {
    const key = await getKey();
    const sealed = await AsyncStorage.getItem(PREFIX + name);
    if (sealed !== null) {
      const value = open(key, sealed);
      if (value === null) {
        // Sealed with a key this device no longer has; drop it.
        await AsyncStorage.removeItem(PREFIX + name);
      }
      return value;
    }

    /*
      One-time move from the old plaintext storage: what Supabase wrote under
      the bare name before this change. Sealed first, then the plaintext copy
      is deleted, so a signed-in user stays signed in and nothing is left
      behind in the clear.
    */
    const legacy = await AsyncStorage.getItem(name);
    if (legacy !== null) {
      await AsyncStorage.setItem(PREFIX + name, seal(key, legacy));
      await AsyncStorage.removeItem(name);
    }
    return legacy;
  },

  async setItem(name: string, value: string): Promise<void> {
    const key = await getKey();
    await AsyncStorage.setItem(PREFIX + name, seal(key, value));
    // Never leave an older plaintext copy beside the sealed one.
    await AsyncStorage.removeItem(name);
  },

  async removeItem(name: string): Promise<void> {
    await AsyncStorage.multiRemove([PREFIX + name, name]);
  },

  /** For tests: forget the cached key so the next call reloads it. */
  _resetKeyCache(): void {
    keyPromise = null;
  },
};
