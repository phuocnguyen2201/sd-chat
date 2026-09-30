import { conversationAPI, profileAPI } from '@/utility/messages';
import { ConversationKeyManager } from './ConversationKeyManagement';
import { MessageEncryption } from './secured';
import { PeerKeyPins } from './PeerKeyPins';

/**
 * Identifies whose public key is expected to have wrapped a conversation
 * row, so a successful unwrap can be checked against that peer's pinned key
 * instead of being trusted outright. `publicKey` is an optional hint (e.g.
 * from a fresh profile fetch); when omitted the resolver looks it up itself.
 */
export type PeerKeyWrapper = { peerId: string; publicKey?: string | null };

/**
 * Outcome of looking for the key of a conversation this device is part of:
 * - `found`             the key is on this device, or was unwrapped from the participant row
 * - `absent`            no wrapped key is stored for this user yet, so one may be minted
 * - `failed`            a wrapped key exists but could not be opened (or opened with an
 *                        unidentifiable wrapper - see `resolveConversationKey`)
 * - `peer_key_changed`  the row opened, but with a public key that differs from the one
 *                        pinned for this peer on a previous device - do not trust yet
 * - `untrusted`         (only from `resolveConversationKeyInteractive`) the user declined
 *                        to trust a changed peer key
 *
 * The `absent` / `failed` split matters. Minting a fresh conversation key on top
 * of a wrapped key that merely failed to open is what leaves two devices holding
 * different keys, which then surfaces on the peer as `Key unwrapping failed`.
 */
export type ConversationKeyLookup =
  | { status: 'found'; key: Uint8Array }
  | { status: 'absent' }
  | { status: 'failed' }
  | { status: 'peer_key_changed'; peerId: string; pinnedKey: string; newKey: string }
  | { status: 'untrusted' };

/**
 * Work out whose public key is expected to have wrapped `conversationId`'s
 * key for `userId`, when the caller didn't already know: the creator for a
 * group (unless that's `userId` themself), or the other participant for a DM.
 * Returns null when nobody else can be identified (e.g. a DM whose other
 * participant has left).
 */
async function findKeyWrapperPeerId(conversationId: string, userId: string): Promise<string | null> {
  const { data } = await conversationAPI.getCurrentConversation(conversationId);
  if (!data) return null;

  if (data.is_group) {
    return data.created_by && data.created_by !== userId ? data.created_by : null;
  }

  const other = data.conversation_participants?.find(
    (participant) => participant?.profiles?.id && participant.profiles.id !== userId
  );
  return other?.profiles?.id ?? null;
}

/**
 * Resolve the conversation key for `userId`, in this order:
 *   1. the key this device already holds (memory cache, then secure storage)
 *   2. the wrapped key on this user's `conversation_participants` row
 *
 * Unwrapping is ECDH: it pairs THIS device's private key with the public key of
 * the device that wrapped the row - never with this user's own public key. The
 * row records that public key in `other_party_pub_key`, but rows written before
 * that was handled correctly need a second chance, so `wrapper.publicKey` lets
 * the caller supply what it believes the wrapper's key to be (for a DM, the other
 * participant; for a group, the creator). When a fallback is the one that works,
 * the row is corrected so no other device has to guess again.
 *
 * Before that correction is trusted, the wrapping key is checked against the
 * pin held for that peer (trust-on-first-use, see PeerKeyPins) - a row that
 * unwraps with a key that differs from the pin comes back as
 * `peer_key_changed` rather than being silently trusted and cached, since
 * whoever controls that key can otherwise swap it to intercept the
 * conversation. Prefer `resolveConversationKeyInteractive` from UI code,
 * which asks the user before trusting a changed key.
 */
export async function resolveConversationKey(
  conversationId: string,
  userId: string,
  wrapper?: PeerKeyWrapper
): Promise<ConversationKeyLookup> {
  const cached = await ConversationKeyManager.getKey(userId, conversationId);
  if (cached) {
    return { status: 'found', key: cached };
  }

  const getWrappedKey = await conversationAPI.getWrappedKeyCurrent(conversationId, userId);
  const wrappedKeyRow = getWrappedKey.data?.[0];

  if (!wrappedKeyRow?.wrapped_key || !wrappedKeyRow?.key_nonce) {
    // Nothing stored for this user: either the conversation is brand new, or
    // this device minted the key itself and never wrapped one for its own row.
    return { status: 'absent' };
  }

  const candidatePublicKeys = [wrappedKeyRow.other_party_pub_key, wrapper?.publicKey]
    .filter((candidate): candidate is string => !!candidate)
    .filter((candidate, index, all) => all.indexOf(candidate) === index);

  if (candidatePublicKeys.length === 0) {
    console.error('Cannot unwrap conversation key: wrapping public key unknown', {
      conversationId,
    });
    return { status: 'failed' };
  }

  const myPublicKey = await MessageEncryption.derivePublicKey(userId);
  let peerId = wrapper?.peerId ?? null;
  let peerIdLookedUp = false;

  for (const candidate of candidatePublicKeys) {
    try {
      const conversationKey = await MessageEncryption.unwrapConversationKey(
        MessageEncryption.base64ToBytes(wrappedKeyRow.wrapped_key),
        MessageEncryption.base64ToBytes(wrappedKeyRow.key_nonce),
        MessageEncryption.base64ToBytes(candidate),
        userId
      );

      // A row this device wrapped for itself is self-trust, not peer trust -
      // there is no peer key to pin here.
      const isSelfWrapped = !!myPublicKey && candidate === myPublicKey;

      if (!isSelfWrapped) {
        if (!peerId && !peerIdLookedUp) {
          peerId = await findKeyWrapperPeerId(conversationId, userId);
          peerIdLookedUp = true;
        }

        if (!peerId) {
          // The row opened, but there is nobody identified to vouch for that
          // key, so it cannot be pinned or trusted - fail closed.
          return { status: 'failed' };
        }

        const check = await PeerKeyPins.checkPeerKey(userId, peerId, candidate);
        if (check.state === 'changed') {
          return { status: 'peer_key_changed', peerId, pinnedKey: check.pinned!, newKey: candidate };
        }
      }

      if (candidate !== wrappedKeyRow.other_party_pub_key) {
        await conversationAPI.storeConversationKey(
          conversationId,
          userId,
          wrappedKeyRow.wrapped_key,
          wrappedKeyRow.key_nonce,
          candidate
        );
      }

      await ConversationKeyManager.setConversationKey(userId, conversationId, conversationKey);
      return { status: 'found', key: conversationKey };
    } catch {
      // Try the next candidate; only the final failure is worth reporting.
    }
  }

  console.error('Unable to unwrap the conversation key for', conversationId);

  return { status: 'failed' };
}

/**
 * Same as `resolveConversationKey`, but when the peer's key has changed it
 * asks the user before trusting it (`PeerKeyPins.confirmPeerKeyChange`)
 * instead of just reporting `peer_key_changed`. On confirmation the new key
 * is pinned and the lookup is retried; on refusal it resolves `untrusted`.
 * UI code should call this rather than `resolveConversationKey` directly.
 */
export async function resolveConversationKeyInteractive(
  conversationId: string,
  userId: string,
  wrapper?: PeerKeyWrapper,
  peerLabel?: string
): Promise<ConversationKeyLookup> {
  const lookup = await resolveConversationKey(conversationId, userId, wrapper);
  if (lookup.status !== 'peer_key_changed') {
    return lookup;
  }

  const trusted = await PeerKeyPins.confirmPeerKeyChange(peerLabel ?? '');
  if (!trusted) {
    return { status: 'untrusted' };
  }

  await PeerKeyPins.trustPeerKey(userId, lookup.peerId, lookup.newKey);
  return resolveConversationKey(conversationId, userId, wrapper);
}

/**
 * Wrap `conversationKey` for every participant whose row has no wrapped key,
 * and leave every other row alone.
 *
 * This repairs conversations created on a device that had no identity key:
 * the key was kept on that device only and no rows were written, so nobody
 * else could open the chat. Once that device has a valid identity key again,
 * opening the conversation there fills the rows in.
 *
 * Two rules keep this from making things worse:
 * - it only runs when this device's identity key matches `profilePublicKey`.
 *   A row wrapped with the wrong key is no longer empty, so it could never be
 *   repaired afterwards.
 * - it only fills empty rows (enforced by the database, see
 *   `fillMissingConversationKey`), so it never replaces a key another device
 *   already distributed.
 *
 * It also checks each recipient's key against their pin before wrapping for
 * them: this runs in the background with no UI, so a changed key is skipped
 * and logged rather than silently trusted - the next foreground open for
 * that peer will surface the normal confirmation prompt instead.
 */
export async function backfillMissingWrappedKeys(
  conversationId: string,
  userId: string,
  profilePublicKey: string,
  conversationKey: Uint8Array
): Promise<void> {
  const rows = await conversationAPI.getParticipantKeyRows(conversationId);
  const missingIds = (rows.data ?? [])
    .filter((row) => !row.wrapped_key)
    .map((row) => row.user_id);

  if (missingIds.length === 0) {
    return;
  }

  // Every row records the wrapper's public key, which has to be the key this
  // device really holds - derive it rather than trusting the profile alone.
  const myPublicKey = await MessageEncryption.derivePublicKey(userId);
  if (!myPublicKey || myPublicKey !== profilePublicKey) {
    return;
  }

  const { data: profiles } = await profileAPI.getParticipantsPublicKey(missingIds);

  for (const participant of profiles ?? []) {
    if (!participant?.id || !participant.public_key) continue;

    const recipientKey = MessageEncryption.base64ToBytes(participant.public_key);
    if (recipientKey.length !== 32) continue;

    const check = await PeerKeyPins.checkPeerKey(userId, participant.id, participant.public_key);
    if (check.state === 'changed') {
      console.warn('Skipping key backfill for peer with a changed key:', participant.id);
      continue;
    }

    const wrapped = await MessageEncryption.wrapConversationKey(conversationKey, recipientKey, userId);
    const { error } = await conversationAPI.fillMissingConversationKey(
      conversationId,
      participant.id,
      MessageEncryption.bytesToBase64(wrapped.wrappedKey),
      MessageEncryption.bytesToBase64(wrapped.nonce),
      myPublicKey
    );

    if (error) {
      console.error('Unable to backfill the conversation key for', conversationId);
    }
  }
}
