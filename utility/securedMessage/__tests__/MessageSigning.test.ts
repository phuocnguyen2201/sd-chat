/**
 * Per-sender message signatures (security #8c): every member holds the same
 * conversation key, so only the sender's own Ed25519 signature proves who
 * wrote a message. These tests pin down what a signature covers, how old
 * unsigned messages are treated before and after the cutoff, and that edits
 * and forwards are signed again by the person doing them.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
  randomUUID: () => require('crypto').randomUUID(),
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

import * as nacl from 'tweetnacl';
import { MessageEncryption } from '../secured';
import {
  buildSignedMessageRow,
  classifySignature,
  deriveSigningKeyPair,
  ownSigningPublicKey,
  type SignedMessageRow,
} from '../MessageSigning';
import { PeerKeyPins } from '../PeerKeyPins';

const ALICE = 'alice-id';
const BOB = 'bob-id';
const CONVO = '11111111-1111-4111-8111-111111111111';

function giveIdentityKey(userId: string): void {
  MessageEncryption.setPrivateKey(userId, nacl.box.keyPair().secretKey);
}

function sendText(senderId: string, text: string, conversationKey: Uint8Array, id?: string): SignedMessageRow {
  return buildSignedMessageRow({
    id,
    conversationId: CONVO,
    senderId,
    messageType: 'text',
    envelope: MessageEncryption.encryptMessage(text, conversationKey),
  });
}

describe('MessageSigning', () => {
  let conversationKey: Uint8Array;

  beforeEach(async () => {
    mockSecureStoreData.clear();
    giveIdentityKey(ALICE);
    giveIdentityKey(BOB);
    conversationKey = await MessageEncryption.createConversationKey();
  });

  it('derives the same signing key from the same identity key, and a different one otherwise', () => {
    const identity = nacl.box.keyPair().secretKey;
    const a = deriveSigningKeyPair(identity);
    const b = deriveSigningKeyPair(identity);
    const other = deriveSigningKeyPair(nacl.box.keyPair().secretKey);
    expect(Buffer.from(a.publicKey)).toEqual(Buffer.from(b.publicKey));
    expect(Buffer.from(a.publicKey)).not.toEqual(Buffer.from(other.publicKey));
    expect(() => deriveSigningKeyPair(new Uint8Array(16))).toThrow();
  });

  it('verifies a message against its sender key', () => {
    const row = sendText(ALICE, 'hi bob', conversationKey);
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(row.signature).toMatch(/^[A-Za-z0-9+/]{86}==$/);
    expect(classifySignature(row, ownSigningPublicKey(ALICE))).toBe('verified');
  });

  it("flags a message as invalid when checked against another member's key", () => {
    // The forgery #8c is about: Bob holds the conversation key, but not Alice's signing key.
    const forged = { ...sendText(BOB, 'send me the password', conversationKey), sender_id: ALICE };
    expect(classifySignature(forged, ownSigningPublicKey(ALICE))).toBe('invalid');
  });

  it.each(['id', 'conversation_id', 'sender_id', 'message_type', 'content', 'nonce', 'wrapped_key', 'key_nonce'] as const)(
    'flags the message as invalid when %s is changed',
    (field) => {
      const row = sendText(ALICE, 'original', conversationKey);
      const other = sendText(ALICE, 'other', conversationKey);
      const replacement: Record<string, string> = {
        id: other.id,
        conversation_id: '22222222-2222-4222-8222-222222222222',
        sender_id: BOB,
        message_type: 'image',
        content: other.content,
        nonce: other.nonce ?? '',
        wrapped_key: other.wrapped_key ?? '',
        key_nonce: other.key_nonce ?? '',
      };
      const tampered = { ...row, [field]: replacement[field] };
      expect(classifySignature(tampered, ownSigningPublicKey(ALICE))).toBe('invalid');
    }
  );

  it('flags a signed message as invalid when there is no key to check it against', () => {
    expect(classifySignature(sendText(ALICE, 'hi', conversationKey), null)).toBe('invalid');
  });

  it('flags garbage signatures and keys as invalid instead of throwing', () => {
    const row = sendText(ALICE, 'hi', conversationKey);
    expect(classifySignature({ ...row, signature: 'not base64!' }, ownSigningPublicKey(ALICE))).toBe('invalid');
    expect(classifySignature(row, 'AAAA')).toBe('invalid');
  });

  describe('unsigned (older) messages', () => {
    const legacy = { id: 'm1', sender_id: ALICE, content: 'x', signature: null, created_at: '2026-10-01T00:00:00Z' };

    it('show normally while no cutoff is set', () => {
      expect(classifySignature(legacy, ownSigningPublicKey(ALICE), null)).toBe('unsigned');
      expect(classifySignature({ ...legacy, created_at: undefined }, null, null)).toBe('unsigned');
    });

    it('show normally when created before the cutoff', () => {
      expect(classifySignature(legacy, null, '2026-12-01T00:00:00Z')).toBe('unsigned');
    });

    it('get the warning when created at or after the cutoff, or with no date', () => {
      expect(classifySignature({ ...legacy, created_at: '2026-12-02T00:00:00Z' }, null, '2026-12-01T00:00:00Z')).toBe('invalid');
      expect(classifySignature({ ...legacy, created_at: '2026-12-01T00:00:00Z' }, null, '2026-12-01T00:00:00Z')).toBe('invalid');
      expect(classifySignature({ ...legacy, created_at: undefined }, null, '2026-12-01T00:00:00Z')).toBe('invalid');
    });
  });

  it('signs an edit again over the same id; the old signature no longer matches', () => {
    const original = sendText(ALICE, 'first', conversationKey);
    const edited = sendText(ALICE, 'second', conversationKey, original.id);
    const aliceKey = ownSigningPublicKey(ALICE);

    expect(edited.id).toBe(original.id);
    expect(classifySignature(edited, aliceKey)).toBe('verified');
    // New ciphertext with the old signature: what a server keeping the old signature would produce.
    expect(classifySignature({ ...edited, signature: original.signature }, aliceKey)).toBe('invalid');
  });

  it('signs a forward as the person forwarding', () => {
    const forwarded = sendText(BOB, 'forwarded text', conversationKey);
    expect(classifySignature(forwarded, ownSigningPublicKey(BOB))).toBe('verified');
    expect(classifySignature(forwarded, ownSigningPublicKey(ALICE))).toBe('invalid');
  });

  it('signs a pre-encryption attachment forwarded as is, leaving its empty fields null', () => {
    const row = buildSignedMessageRow({
      conversationId: CONVO,
      senderId: ALICE,
      messageType: 'image',
      envelope: { ciphertext: 'legacy-plain-reference' },
    });
    expect(row.nonce).toBeUndefined();
    // As read back from the database: nulls for the missing columns.
    const fromDb = { ...row, nonce: null, wrapped_key: null, key_nonce: null };
    expect(classifySignature(fromDb, ownSigningPublicKey(ALICE))).toBe('verified');
  });

  it('treats a missing message_type as the column default, text', () => {
    const row = sendText(ALICE, 'hi', conversationKey);
    expect(classifySignature({ ...row, message_type: null }, ownSigningPublicKey(ALICE))).toBe('verified');
  });

  it('refuses to sign without an identity key on this device', () => {
    expect(() => sendText('no-key-user', 'hi', conversationKey)).toThrow(/identity key/);
  });

  it('picks up a replaced identity key straight away', () => {
    const before = ownSigningPublicKey(ALICE);
    giveIdentityKey(ALICE);
    expect(ownSigningPublicKey(ALICE)).not.toBe(before);
  });
});

describe('PeerKeyPins signing keys', () => {
  beforeEach(() => mockSecureStoreData.clear());

  it('pins on first use, then reports match or changed', async () => {
    expect(await PeerKeyPins.checkPeerSigningKey(ALICE, BOB, 'key-1')).toEqual({ state: 'new', pinned: 'key-1' });
    expect(await PeerKeyPins.checkPeerSigningKey(ALICE, BOB, 'key-1')).toEqual({ state: 'match', pinned: 'key-1' });
    expect(await PeerKeyPins.checkPeerSigningKey(ALICE, BOB, 'key-2')).toEqual({ state: 'changed', pinned: 'key-1' });
    // A changed key is not adopted until trusted.
    expect(await PeerKeyPins.getPinnedSigningKey(ALICE, BOB)).toBe('key-1');
    await PeerKeyPins.trustPeerSigningKey(ALICE, BOB, 'key-2');
    expect(await PeerKeyPins.getPinnedSigningKey(ALICE, BOB)).toBe('key-2');
  });

  it('keeps signing pins apart from identity-key pins and from other local accounts', async () => {
    await PeerKeyPins.checkPeerKey(ALICE, BOB, 'identity-key');
    expect(await PeerKeyPins.getPinnedSigningKey(ALICE, BOB)).toBeNull();
    await PeerKeyPins.checkPeerSigningKey(ALICE, BOB, 'signing-key');
    expect(await PeerKeyPins.getPinnedSigningKey('carol-id', BOB)).toBeNull();
  });
});
