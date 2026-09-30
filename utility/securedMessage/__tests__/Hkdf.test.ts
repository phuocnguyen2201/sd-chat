/**
 * HKDF hardening (security #8b): the hand-rolled derivation (plain SHA-512
 * hashing, no HMAC, no salt) is replaced with RFC-5869 HKDF via
 * @noble/hashes. Every conversation key already wrapped in the database used
 * the old derivation, so unwrapping must still open it ("write new, read
 * both") - this suite is what proves that fallback actually works.
 */
import { describe, expect, it, jest } from '@jest/globals';

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

import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';
import * as nacl from 'tweetnacl';
import { MessageEncryption } from '../secured';

/** Reproduces the pre-fix derivation, to build "legacy" ciphertexts in tests. */
function legacyKdfSha512(ikm: Uint8Array, info: Uint8Array, length: number): Uint8Array {
  const prk = nacl.hash(ikm);
  const t = nacl.hash(new Uint8Array([...prk, ...info, 0x01]));
  return t.slice(0, length);
}

describe('hkdfSha512', () => {
  it('matches @noble/hashes HKDF directly', async () => {
    const ikm = new Uint8Array(32).fill(7);
    const info = new TextEncoder().encode('conversation-key-wrap');

    const actual = await MessageEncryption.hkdfSha512(ikm, info, 32);
    const expected = hkdf(sha512, ikm, undefined, info, 32);

    expect(actual).toEqual(expected);
  });

  it('differs from the pre-fix (legacy) derivation - documents the break this fixes', async () => {
    const ikm = new Uint8Array(32).fill(3);
    const info = new TextEncoder().encode('conversation-key-wrap');

    const fixed = await MessageEncryption.hkdfSha512(ikm, info, 32);
    const legacy = legacyKdfSha512(ikm, info, 32);

    expect(fixed).not.toEqual(legacy);
  });
});

const USER = 'aaaaaaaa-0000-4000-8000-000000000001';

describe('unwrapConversationKey compatibility', () => {
  it('round trips a freshly wrapped key on the new derivation', async () => {
    const alice = await MessageEncryption.generateKeyPair();
    const bob = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(USER, MessageEncryption.base64ToBytes(alice.privateKey));

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await MessageEncryption.wrapConversationKey(
      conversationKey,
      MessageEncryption.base64ToBytes(bob.publicKey),
      USER
    );

    const opened = await MessageEncryption.unwrapConversationKey(
      wrapped.wrappedKey,
      wrapped.nonce,
      MessageEncryption.base64ToBytes(bob.publicKey),
      USER
    );

    expect(opened).toEqual(conversationKey);
  });

  it('still opens a key wrapped with the legacy (pre-fix) derivation', async () => {
    const alice = await MessageEncryption.generateKeyPair();
    const bob = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(USER, MessageEncryption.base64ToBytes(alice.privateKey));

    // Build a ciphertext the way the OLD hkdfSha512 would have, using bob's
    // side of the ECDH (equivalent by symmetry to alice's side + bob's key).
    const conversationKey = await MessageEncryption.createConversationKey();
    const sharedSecret = nacl.box.before(
      MessageEncryption.base64ToBytes(alice.publicKey),
      MessageEncryption.base64ToBytes(bob.privateKey)
    );
    const legacyWrapKey = legacyKdfSha512(sharedSecret, new TextEncoder().encode('conversation-key-wrap'), 32);
    const { ChaCha20Poly1305 } = require('@stablelib/chacha20poly1305');
    const nonce = nacl.randomBytes(12);
    const wrappedKey = new ChaCha20Poly1305(legacyWrapKey).seal(nonce, conversationKey);

    const opened = await MessageEncryption.unwrapConversationKey(
      wrappedKey,
      nonce,
      MessageEncryption.base64ToBytes(bob.publicKey),
      USER
    );

    expect(opened).toEqual(conversationKey);
  });

  it('still throws for a genuinely wrong key', async () => {
    const alice = await MessageEncryption.generateKeyPair();
    const bob = await MessageEncryption.generateKeyPair();
    const mallory = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(USER, MessageEncryption.base64ToBytes(alice.privateKey));

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await MessageEncryption.wrapConversationKey(
      conversationKey,
      MessageEncryption.base64ToBytes(bob.publicKey),
      USER
    );

    await expect(
      MessageEncryption.unwrapConversationKey(
        wrapped.wrappedKey,
        wrapped.nonce,
        MessageEncryption.base64ToBytes(mallory.publicKey),
        USER
      )
    ).rejects.toThrow(/Key unwrapping failed/);
  });

  it('writes exclusively under the new derivation, never the legacy one', async () => {
    const alice = await MessageEncryption.generateKeyPair();
    const bob = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(USER, MessageEncryption.base64ToBytes(alice.privateKey));

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await MessageEncryption.wrapConversationKey(
      conversationKey,
      MessageEncryption.base64ToBytes(bob.publicKey),
      USER
    );

    // If the write side ever regressed to the legacy derivation, this would open successfully.
    const sharedSecret = nacl.box.before(
      MessageEncryption.base64ToBytes(bob.publicKey),
      MessageEncryption.base64ToBytes(alice.privateKey)
    );
    const legacyWrapKey = legacyKdfSha512(sharedSecret, new TextEncoder().encode('conversation-key-wrap'), 32);
    const { ChaCha20Poly1305 } = require('@stablelib/chacha20poly1305');

    expect(new ChaCha20Poly1305(legacyWrapKey).open(wrapped.nonce, wrapped.wrappedKey)).toBeNull();
  });

  it('throws its documented error when a garbage payload opens under neither derivation', async () => {
    const alice = await MessageEncryption.generateKeyPair();
    const bob = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(USER, MessageEncryption.base64ToBytes(alice.privateKey));

    const garbageWrappedKey = new Uint8Array(48).fill(9); // 32-byte key + 16-byte auth tag, all garbage
    const nonce = nacl.randomBytes(12);

    await expect(
      MessageEncryption.unwrapConversationKey(garbageWrappedKey, nonce, MessageEncryption.base64ToBytes(bob.publicKey), USER)
    ).rejects.toThrow(/Key unwrapping failed/);
  });
});

describe('ecdhOpen compatibility', () => {
  it('opens a payload sealed on the new derivation', async () => {
    const sender = MessageEncryption.generateEphemeralKeyPair();
    const recipient = MessageEncryption.generateEphemeralKeyPair();
    const plaintext = new TextEncoder().encode('hello');

    const sealed = await MessageEncryption.ecdhSeal(plaintext, recipient.publicKey, sender.secretKey, 'test-info');
    const opened = await MessageEncryption.ecdhOpen(
      sealed.ciphertext,
      sealed.nonce,
      sender.publicKey,
      recipient.secretKey,
      'test-info'
    );

    expect(opened).toEqual(plaintext);
  });

  it('opens a payload sealed with the legacy derivation', async () => {
    const sender = MessageEncryption.generateEphemeralKeyPair();
    const recipient = MessageEncryption.generateEphemeralKeyPair();
    const plaintext = new TextEncoder().encode('legacy payload');

    const sharedSecret = nacl.box.before(recipient.publicKey, sender.secretKey);
    const legacySealKey = legacyKdfSha512(sharedSecret, new TextEncoder().encode('test-info'), 32);
    const { ChaCha20Poly1305 } = require('@stablelib/chacha20poly1305');
    const nonce = nacl.randomBytes(12);
    const ciphertext = new ChaCha20Poly1305(legacySealKey).seal(nonce, plaintext);

    const opened = await MessageEncryption.ecdhOpen(ciphertext, nonce, sender.publicKey, recipient.secretKey, 'test-info');
    expect(opened).toEqual(plaintext);
  });

  it('still throws for a wrong key', async () => {
    const sender = MessageEncryption.generateEphemeralKeyPair();
    const recipient = MessageEncryption.generateEphemeralKeyPair();
    const stranger = MessageEncryption.generateEphemeralKeyPair();
    const plaintext = new TextEncoder().encode('hello');

    const sealed = await MessageEncryption.ecdhSeal(plaintext, recipient.publicKey, sender.secretKey, 'test-info');

    await expect(
      MessageEncryption.ecdhOpen(sealed.ciphertext, sealed.nonce, sender.publicKey, stranger.secretKey, 'test-info')
    ).rejects.toThrow(/authentication invalid/);
  });

  it('writes exclusively under the new derivation, never the legacy one', async () => {
    const sender = MessageEncryption.generateEphemeralKeyPair();
    const recipient = MessageEncryption.generateEphemeralKeyPair();
    const plaintext = new TextEncoder().encode('hello');

    const sealed = await MessageEncryption.ecdhSeal(plaintext, recipient.publicKey, sender.secretKey, 'test-info');

    const sharedSecret = nacl.box.before(recipient.publicKey, sender.secretKey);
    const legacySealKey = legacyKdfSha512(sharedSecret, new TextEncoder().encode('test-info'), 32);
    const { ChaCha20Poly1305 } = require('@stablelib/chacha20poly1305');

    expect(new ChaCha20Poly1305(legacySealKey).open(sealed.nonce, sealed.ciphertext)).toBeNull();
  });

  it('throws its documented error when a garbage payload opens under neither derivation', async () => {
    const sender = MessageEncryption.generateEphemeralKeyPair();
    const recipient = MessageEncryption.generateEphemeralKeyPair();
    const garbageCiphertext = new Uint8Array(32).fill(9);
    const nonce = nacl.randomBytes(12);

    await expect(
      MessageEncryption.ecdhOpen(garbageCiphertext, nonce, sender.publicKey, recipient.secretKey, 'test-info')
    ).rejects.toThrow(/authentication invalid/);
  });
});
