/**
 * Notification previews check the sender's signature (security #8c) before
 * any text is shown, without going to the network: the pinned key wins, a
 * sender never seen before is pinned from the key the push carries, and a
 * changed key is never trusted here.
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
jest.mock('expo-notifications', () => ({
  scheduleNotificationAsync: jest.fn(),
  registerTaskAsync: jest.fn(async () => undefined),
  BackgroundNotificationTaskResult: { NoData: 1, NewData: 2, Failed: 3 },
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: jest.fn() }));
jest.mock('@/utility/securedMessage/ConversationKeyManagement', () => ({
  ConversationKeyManager: { getKey: jest.fn() },
}));

import * as nacl from 'tweetnacl';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { buildSignedMessageRow, ownSigningPublicKey } from '@/utility/securedMessage/MessageSigning';
import { PeerKeyPins } from '@/utility/securedMessage/PeerKeyPins';
import { senderVerifies, type MessagePushData } from '../MessageNotification';

const ME = 'me-id';
const ALICE = 'alice-id';
const MALLORY = 'mallory-id';
const CONVO = '11111111-1111-4111-8111-111111111111';

async function pushFrom(senderId: string, signingKeyOnProfile: string | null): Promise<MessagePushData> {
  const conversationKey = await MessageEncryption.createConversationKey();
  const row = buildSignedMessageRow({
    conversationId: CONVO,
    senderId,
    messageType: 'text',
    envelope: MessageEncryption.encryptMessage('hello', conversationKey),
  });
  return {
    kind: 'message',
    message_id: row.id,
    conversation_id: row.conversation_id,
    sender_id: row.sender_id,
    message_type: row.message_type,
    content: row.content,
    nonce: row.nonce,
    wrapped_key: row.wrapped_key,
    key_nonce: row.key_nonce,
    signature: row.signature,
    created_at: new Date().toISOString(),
    signing_public_key: signingKeyOnProfile,
  };
}

describe('senderVerifies (notification previews)', () => {
  beforeEach(() => {
    mockSecureStoreData.clear();
    for (const id of [ME, ALICE, MALLORY]) {
      MessageEncryption.setPrivateKey(id, nacl.box.keyPair().secretKey);
    }
  });

  it("pins a new sender's key from the push and accepts the message", async () => {
    const push = await pushFrom(ALICE, ownSigningPublicKey(ALICE));
    expect(await senderVerifies(ME, push)).toBe(true);
    expect(await PeerKeyPins.getPinnedSigningKey(ME, ALICE)).toBe(ownSigningPublicKey(ALICE));
  });

  it('checks against the pin, not a different key the push carries', async () => {
    await PeerKeyPins.checkPeerSigningKey(ME, ALICE, ownSigningPublicKey(ALICE) as string);
    // Mallory signs as Alice and the server swaps the published key to match.
    const forged = { ...(await pushFrom(MALLORY, ownSigningPublicKey(MALLORY))), sender_id: ALICE };
    expect(await senderVerifies(ME, forged)).toBe(false);
    expect(await PeerKeyPins.getPinnedSigningKey(ME, ALICE)).toBe(ownSigningPublicKey(ALICE));
  });

  it('refuses a signed message when there is no key at all', async () => {
    expect(await senderVerifies(ME, await pushFrom(ALICE, null))).toBe(false);
  });

  it("checks the user's own messages from another device against this device's key", async () => {
    expect(await senderVerifies(ME, await pushFrom(ME, null))).toBe(true);
  });

  it('accepts an unsigned message while no cutoff is set', async () => {
    const push = { ...(await pushFrom(ALICE, null)), signature: null };
    expect(await senderVerifies(ME, push)).toBe(true);
  });

  it('refuses a tampered message', async () => {
    const push = await pushFrom(ALICE, ownSigningPublicKey(ALICE));
    const other = await pushFrom(ALICE, ownSigningPublicKey(ALICE));
    expect(await senderVerifies(ME, { ...push, content: other.content })).toBe(false);
  });
});
