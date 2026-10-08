/**
 * Trust-on-first-use for peer public keys (security #7): a conversation key
 * row must only ever be trusted against the key pinned for that peer on this
 * device - never re-trusted the moment someone (or something with DB access)
 * changes `profiles.public_key` / `other_party_pub_key`.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
  digestStringAsync: async (_algo: string, data: string) =>
    require('crypto').createHash('sha256').update(data).digest('hex'),
  CryptoDigestAlgorithm: { SHA256: 'SHA256' },
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

jest.mock('@/utility/messages', () => ({
  conversationAPI: {
    getWrappedKeyCurrent: jest.fn(),
    storeConversationKey: jest.fn(async () => ({ error: null })),
    getCurrentConversation: jest.fn(async () => ({ data: null, error: null })),
    getParticipantKeyRows: jest.fn(),
    fillMissingConversationKey: jest.fn(async () => ({ error: null })),
  },
  profileAPI: {
    getParticipantsPublicKey: jest.fn(),
  },
}));

import { Alert } from 'react-native';
import { MessageEncryption } from '../secured';
import { PeerKeyPins } from '../PeerKeyPins';
import { ConversationKeyManager } from '../ConversationKeyManagement';
import {
  backfillMissingWrappedKeys,
  resolveConversationKey,
  resolveConversationKeyInteractive,
} from '../ConversationKeyResolver';
import { conversationAPI, profileAPI } from '@/utility/messages';

// Spy rather than jest.mock('react-native'): a partial mock breaks
// jest-expo's setup, which needs the real Platform/Appearance modules.
const mockedAlert = jest.spyOn(Alert, 'alert').mockImplementation(() => {}) as jest.Mock<any>;

// Cast to `any`: the mock only needs to satisfy the shapes the resolver
// actually reads, not the full live ApiResponse/UserProfile types.
const mockedConversationAPI = conversationAPI as any;
const mockedProfileAPI = profileAPI as any;

const ME = 'aaaaaaaa-0000-4000-8000-000000000001';
const PEER = 'bbbbbbbb-0000-4000-8000-000000000002';
const CONVO = 'cccccccc-0000-4000-8000-000000000003';

afterEach(() => {
  mockSecureStoreData.clear();
  ConversationKeyManager.clear();
  jest.clearAllMocks();
});

describe('PeerKeyPins.checkPeerKey', () => {
  it('pins the first key seen, matches it back, and flags a later change', async () => {
    const first = await PeerKeyPins.checkPeerKey(ME, PEER, 'key-A');
    expect(first).toEqual({ state: 'new', pinned: 'key-A' });

    const again = await PeerKeyPins.checkPeerKey(ME, PEER, 'key-A');
    expect(again).toEqual({ state: 'match', pinned: 'key-A' });

    const changed = await PeerKeyPins.checkPeerKey(ME, PEER, 'key-B');
    expect(changed).toEqual({ state: 'changed', pinned: 'key-A' });
  });

  it('keeps pins separate per local user', async () => {
    await PeerKeyPins.checkPeerKey(ME, PEER, 'key-A');
    const otherLocalUser = await PeerKeyPins.checkPeerKey('other-user', PEER, 'key-B');
    expect(otherLocalUser).toEqual({ state: 'new', pinned: 'key-B' });
  });
});

/** Wrap `conversationKey` as if `wrapperId`'s device sent it to `recipientPublicKey`. */
async function wrapAs(wrapperId: string, wrapperSecretKey: Uint8Array, recipientPublicKey: Uint8Array, conversationKey: Uint8Array) {
  MessageEncryption.setPrivateKey(wrapperId, wrapperSecretKey);
  return MessageEncryption.wrapConversationKey(conversationKey, recipientPublicKey, wrapperId);
}

describe('resolveConversationKey with peer pinning', () => {
  it('pins a first-seen wrapper key and returns found', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const peer = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(peer.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);

    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: peer.publicKey,
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME, { peerId: PEER, publicKey: peer.publicKey });

    expect(lookup.status).toBe('found');
    expect(await PeerKeyPins.checkPeerKey(ME, PEER, peer.publicKey)).toEqual({ state: 'match', pinned: peer.publicKey });
  });

  it('reports peer_key_changed and does not cache or persist a key that differs from the pin', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const originalPeer = await MessageEncryption.generateKeyPair();
    const impostor = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    // Pin the real peer's key from a prior session.
    await PeerKeyPins.checkPeerKey(ME, PEER, originalPeer.publicKey);

    // The row now claims to be wrapped by a different key for the same peer id
    // (e.g. profiles.public_key / other_party_pub_key was swapped).
    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(impostor.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);

    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: impostor.publicKey,
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME, { peerId: PEER, publicKey: impostor.publicKey });

    expect(lookup).toMatchObject({ status: 'peer_key_changed', peerId: PEER, pinnedKey: originalPeer.publicKey, newKey: impostor.publicKey });
    expect(mockedConversationAPI.storeConversationKey).not.toHaveBeenCalled();
    expect(await ConversationKeyManager.getKey(ME, CONVO)).toBeNull();
  });

  it('bypasses pinning for a row this device wrapped for itself', async () => {
    const me = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    const conversationKey = await MessageEncryption.createConversationKey();
    // Wrapped by "me" for "me" - the self-copy every conversation key gets.
    const wrapped = await MessageEncryption.wrapConversationKey(conversationKey, MessageEncryption.base64ToBytes(me.publicKey), ME);

    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: me.publicKey,
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME);
    expect(lookup.status).toBe('found');
  });

  it('trusts a changed key once explicitly trusted, and resolves normally afterward', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const originalPeer = await MessageEncryption.generateKeyPair();
    const newPeerKey = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));
    await PeerKeyPins.checkPeerKey(ME, PEER, originalPeer.publicKey);

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(newPeerKey.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: newPeerKey.publicKey,
      }],
    });

    const first = await resolveConversationKey(CONVO, ME, { peerId: PEER, publicKey: newPeerKey.publicKey });
    expect(first.status).toBe('peer_key_changed');

    await PeerKeyPins.trustPeerKey(ME, PEER, newPeerKey.publicKey);
    const second = await resolveConversationKey(CONVO, ME, { peerId: PEER, publicKey: newPeerKey.publicKey });
    expect(second.status).toBe('found');
  });

  it('looks up the wrapping peer from the conversation when no wrapper is supplied', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const peer = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    mockedConversationAPI.getCurrentConversation.mockResolvedValue({
      data: {
        is_group: false,
        created_by: PEER,
        conversation_participants: [{ profiles: { id: ME } }, { profiles: { id: PEER } }],
      },
      error: null,
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(peer.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: peer.publicKey,
      }],
    });

    // No wrapper passed at all - the resolver must find PEER itself via
    // getCurrentConversation before it can pin/check the key.
    const lookup = await resolveConversationKey(CONVO, ME);
    expect(lookup.status).toBe('found');
    expect(await PeerKeyPins.checkPeerKey(ME, PEER, peer.publicKey)).toMatchObject({ state: 'match' });
  });

  it('fails closed when a changed-key row cannot be attributed to any peer', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const peer = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    // No participant found for this DM, and no wrapper hint supplied either.
    mockedConversationAPI.getCurrentConversation.mockResolvedValue({
      data: { is_group: false, created_by: null, conversation_participants: [] },
      error: null,
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(peer.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: peer.publicKey,
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME);
    expect(lookup.status).toBe('failed');
  });

  it('does not treat the group creator as a peer when this user created the group', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const peer = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    mockedConversationAPI.getCurrentConversation.mockResolvedValue({
      data: { is_group: true, created_by: ME, conversation_participants: [] },
      error: null,
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    // The row really was wrapped by someone else's key, but this user being
    // the group's creator means findKeyWrapperPeerId can't name a peer to pin it to.
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(peer.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: peer.publicKey,
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME);
    expect(lookup.status).toBe('failed');
  });

  it('identifies the group creator as the peer when someone else created the group', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const peer = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    mockedConversationAPI.getCurrentConversation.mockResolvedValue({
      data: { is_group: true, created_by: PEER, conversation_participants: [] },
      error: null,
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(peer.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: peer.publicKey,
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME);
    expect(lookup.status).toBe('found');
    expect(await PeerKeyPins.checkPeerKey(ME, PEER, peer.publicKey)).toMatchObject({ state: 'match' });
  });

  it('falls back to the wrapper hint when the recorded public key fails to unwrap, and corrects the row', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const peer = await MessageEncryption.generateKeyPair();
    const staleKey = await MessageEncryption.generateKeyPair(); // wrong key left on the row
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(peer.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: staleKey.publicKey, // does not actually unwrap the row
      }],
    });

    const lookup = await resolveConversationKey(CONVO, ME, { peerId: PEER, publicKey: peer.publicKey });

    expect(lookup.status).toBe('found');
    expect(mockedConversationAPI.storeConversationKey).toHaveBeenCalledWith(
      CONVO,
      ME,
      expect.any(String),
      expect.any(String),
      peer.publicKey
    );
  });
});

describe('PeerKeyPins.checkPeerKey storage validation', () => {
  it('throws when the local user id or peer id is empty', async () => {
    await expect(PeerKeyPins.checkPeerKey('', PEER, 'key')).rejects.toThrow(/local user id and a peer id/);
    await expect(PeerKeyPins.checkPeerKey(ME, '', 'key')).rejects.toThrow(/local user id and a peer id/);
  });
});

describe('PeerKeyPins.confirmPeerKeyChange', () => {
  it('resolves true when the user chooses to trust the new key', async () => {
    mockedAlert.mockImplementation((_title: string, _msg: string, buttons: any[]) =>
      buttons.find((b) => b.text === 'Trust new key')?.onPress()
    );
    await expect(PeerKeyPins.confirmPeerKeyChange('Alice')).resolves.toBe(true);
  });

  it('resolves false when the user cancels', async () => {
    mockedAlert.mockImplementation((_title: string, _msg: string, buttons: any[]) =>
      buttons.find((b) => b.text === 'Cancel')?.onPress()
    );
    await expect(PeerKeyPins.confirmPeerKeyChange('Alice')).resolves.toBe(false);
  });

  it('shows a non-cancelable alert so it cannot be dismissed without an explicit choice', () => {
    PeerKeyPins.confirmPeerKeyChange('Alice');
    const [, , , options] = mockedAlert.mock.calls[mockedAlert.mock.calls.length - 1];
    expect(options).toMatchObject({ cancelable: false });
  });
});

describe('resolveConversationKeyInteractive', () => {
  it('passes the result through unchanged when the peer key has not changed', async () => {
    const me = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({ data: [] });

    const lookup = await resolveConversationKeyInteractive(CONVO, ME);

    expect(lookup.status).toBe('absent');
    expect(mockedAlert).not.toHaveBeenCalled();
  });

  it('trusts a changed key on confirmation and resolves found on retry', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const originalPeer = await MessageEncryption.generateKeyPair();
    const newPeerKey = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));
    await PeerKeyPins.checkPeerKey(ME, PEER, originalPeer.publicKey);

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(newPeerKey.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: newPeerKey.publicKey,
      }],
    });
    mockedAlert.mockImplementation((_title: string, _msg: string, buttons: any[]) =>
      buttons.find((b) => b.text === 'Trust new key')?.onPress()
    );

    const lookup = await resolveConversationKeyInteractive(
      CONVO,
      ME,
      { peerId: PEER, publicKey: newPeerKey.publicKey },
      'Peer'
    );

    expect(lookup.status).toBe('found');
    expect(await PeerKeyPins.checkPeerKey(ME, PEER, newPeerKey.publicKey)).toMatchObject({ state: 'match' });
  });

  it('resolves untrusted and never trusts the new key when the user declines', async () => {
    const me = await MessageEncryption.generateKeyPair();
    const originalPeer = await MessageEncryption.generateKeyPair();
    const newPeerKey = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));
    await PeerKeyPins.checkPeerKey(ME, PEER, originalPeer.publicKey);

    const conversationKey = await MessageEncryption.createConversationKey();
    const wrapped = await wrapAs(PEER, MessageEncryption.base64ToBytes(newPeerKey.privateKey), MessageEncryption.base64ToBytes(me.publicKey), conversationKey);
    mockedConversationAPI.getWrappedKeyCurrent.mockResolvedValue({
      data: [{
        wrapped_key: MessageEncryption.bytesToBase64(wrapped.wrappedKey),
        key_nonce: MessageEncryption.bytesToBase64(wrapped.nonce),
        other_party_pub_key: newPeerKey.publicKey,
      }],
    });
    mockedAlert.mockImplementation((_title: string, _msg: string, buttons: any[]) =>
      buttons.find((b) => b.text === 'Cancel')?.onPress()
    );

    const lookup = await resolveConversationKeyInteractive(CONVO, ME, { peerId: PEER, publicKey: newPeerKey.publicKey });

    expect(lookup).toEqual({ status: 'untrusted' });
    // Still pinned to the original key - trustPeerKey was never called.
    expect(await PeerKeyPins.checkPeerKey(ME, PEER, originalPeer.publicKey)).toMatchObject({ state: 'match' });
  });
});

describe('backfillMissingWrappedKeys with peer pinning', () => {
  it('skips wrapping for a participant whose key has changed', async () => {
    const me = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    const originalPeer = await MessageEncryption.generateKeyPair();
    const changedPeer = await MessageEncryption.generateKeyPair();
    await PeerKeyPins.checkPeerKey(ME, PEER, originalPeer.publicKey);

    mockedConversationAPI.getParticipantKeyRows.mockResolvedValue({
      data: [{ user_id: PEER, wrapped_key: null }],
    });
    mockedProfileAPI.getParticipantsPublicKey.mockResolvedValue({
      data: [{ id: PEER, public_key: changedPeer.publicKey }],
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    await backfillMissingWrappedKeys(CONVO, ME, me.publicKey, conversationKey);

    expect(mockedConversationAPI.fillMissingConversationKey).not.toHaveBeenCalled();
  });

  it('wraps normally for a participant whose key is already pinned or new', async () => {
    const me = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));
    const peer = await MessageEncryption.generateKeyPair();

    mockedConversationAPI.getParticipantKeyRows.mockResolvedValue({
      data: [{ user_id: PEER, wrapped_key: null }],
    });
    mockedProfileAPI.getParticipantsPublicKey.mockResolvedValue({
      data: [{ id: PEER, public_key: peer.publicKey }],
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    await backfillMissingWrappedKeys(CONVO, ME, me.publicKey, conversationKey);

    expect(mockedConversationAPI.fillMissingConversationKey).toHaveBeenCalledTimes(1);
  });

  it('does nothing when no participant is missing a wrapped key', async () => {
    mockedConversationAPI.getParticipantKeyRows.mockResolvedValue({
      data: [{ user_id: PEER, wrapped_key: 'already-set' }],
    });

    await backfillMissingWrappedKeys(CONVO, ME, 'irrelevant', new Uint8Array(32));

    expect(mockedProfileAPI.getParticipantsPublicKey).not.toHaveBeenCalled();
    expect(mockedConversationAPI.fillMissingConversationKey).not.toHaveBeenCalled();
  });

  it('does nothing when this device does not hold the key the profile advertises', async () => {
    const me = await MessageEncryption.generateKeyPair();
    MessageEncryption.setPrivateKey(ME, MessageEncryption.base64ToBytes(me.privateKey));

    mockedConversationAPI.getParticipantKeyRows.mockResolvedValue({
      data: [{ user_id: PEER, wrapped_key: null }],
    });

    const conversationKey = await MessageEncryption.createConversationKey();
    await backfillMissingWrappedKeys(CONVO, ME, 'some-other-account-public-key', conversationKey);

    expect(mockedProfileAPI.getParticipantsPublicKey).not.toHaveBeenCalled();
    expect(mockedConversationAPI.fillMissingConversationKey).not.toHaveBeenCalled();
  });
});
