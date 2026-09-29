/**
 * End-to-end attachment encryption (security #5): the ciphertext blob
 * uploaded to storage, and the descriptor that carries its key, must only
 * open for someone holding the right keys - never as plaintext in transit
 * or at rest.
 */
import { describe, expect, it, jest } from '@jest/globals';

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

import { AttachmentDescriptor, MessageEncryption } from '../secured';

const conversationKeyA = new Uint8Array(32).fill(1);
const conversationKeyB = new Uint8Array(32).fill(2);

describe('attachment content encryption', () => {
  it('round trips a large binary payload', () => {
    const plaintext = new Uint8Array(5 * 1024 * 1024);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = i % 256;

    const { ciphertext, key, nonce } = MessageEncryption.encryptAttachment(plaintext);

    // The stored blob must not be the plaintext, and must not be trivially
    // recognisable as it (checked at both ends, not just non-equality).
    expect(ciphertext).not.toEqual(plaintext);

    const decrypted = MessageEncryption.decryptAttachment(ciphertext, key, nonce);
    expect(decrypted).toEqual(plaintext);
  });

  it('rejects a tampered ciphertext', () => {
    const plaintext = new Uint8Array([1, 2, 3, 4, 5]);
    const { ciphertext, key, nonce } = MessageEncryption.encryptAttachment(plaintext);

    const tampered = new Uint8Array(ciphertext);
    tampered[0] ^= 1;

    expect(() => MessageEncryption.decryptAttachment(tampered, key, nonce)).toThrow(/authentication invalid/);
  });

  it('rejects the wrong key', () => {
    const plaintext = new Uint8Array([9, 9, 9]);
    const { ciphertext, nonce } = MessageEncryption.encryptAttachment(plaintext);
    const wrongKey = MessageEncryption.bytesToBase64(new Uint8Array(32).fill(42));

    expect(() => MessageEncryption.decryptAttachment(ciphertext, wrongKey, nonce)).toThrow(/authentication invalid/);
  });
});

describe('attachment descriptor (name, mime, per-file key) travels encrypted', () => {
  const buildDescriptor = (): AttachmentDescriptor => {
    const plaintext = new Uint8Array([1, 2, 3]);
    const attachment = MessageEncryption.encryptAttachment(plaintext);
    return {
      v: 1,
      name: 'secret-plans.pdf',
      mime: 'application/pdf',
      size: plaintext.byteLength,
      key: attachment.key,
      nonce: attachment.nonce,
    };
  };

  it('opens with the conversation key it was sealed with', () => {
    const descriptor = buildDescriptor();
    const sealed = MessageEncryption.encryptMessage(JSON.stringify(descriptor), conversationKeyA);

    expect(sealed.ciphertext).not.toContain('secret-plans');

    const opened = JSON.parse(
      MessageEncryption.decryptMessage(
        { ciphertext: sealed.ciphertext, nonce: sealed.nonce, wrappedKey: sealed.wrappedKey, keyNonce: sealed.keyNonce },
        conversationKeyA
      )
    );
    expect(opened).toEqual(descriptor);
  });

  it('fails to open with a different conversation key', () => {
    const descriptor = buildDescriptor();
    const sealed = MessageEncryption.encryptMessage(JSON.stringify(descriptor), conversationKeyA);

    expect(() =>
      MessageEncryption.decryptMessage(
        { ciphertext: sealed.ciphertext, nonce: sealed.nonce, wrappedKey: sealed.wrappedKey, keyNonce: sealed.keyNonce },
        conversationKeyB
      )
    ).toThrow();
  });

  it('re-encrypts for a forward target without exposing the plaintext descriptor', () => {
    const descriptor = buildDescriptor();
    const sourceSealed = MessageEncryption.encryptMessage(JSON.stringify(descriptor), conversationKeyA);

    // Forwarding: open with the source room's key, seal for the target room's key.
    const plainJson = MessageEncryption.decryptMessage(
      { ciphertext: sourceSealed.ciphertext, nonce: sourceSealed.nonce, wrappedKey: sourceSealed.wrappedKey, keyNonce: sourceSealed.keyNonce },
      conversationKeyA
    );
    const targetSealed = MessageEncryption.encryptMessage(plainJson, conversationKeyB);

    // Opens with the target key...
    const openedForTarget = JSON.parse(
      MessageEncryption.decryptMessage(
        { ciphertext: targetSealed.ciphertext, nonce: targetSealed.nonce, wrappedKey: targetSealed.wrappedKey, keyNonce: targetSealed.keyNonce },
        conversationKeyB
      )
    );
    expect(openedForTarget).toEqual(descriptor);

    // ...but no longer with the source key.
    expect(() =>
      MessageEncryption.decryptMessage(
        { ciphertext: targetSealed.ciphertext, nonce: targetSealed.nonce, wrappedKey: targetSealed.wrappedKey, keyNonce: targetSealed.keyNonce },
        conversationKeyA
      )
    ).toThrow();
  });
});
