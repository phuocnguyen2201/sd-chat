import { conversationAPI } from '@/utility/messages';
import { ConversationKeyManager } from './ConversationKeyManagement';
import { MessageEncryption } from './secured';

/**
 * Outcome of looking for the key of a conversation this device is part of:
 * - `found`  the key is on this device, or was unwrapped from the participant row
 * - `absent` no wrapped key is stored for this user yet, so one may be minted
 * - `failed` a wrapped key exists but could not be opened
 *
 * The `absent` / `failed` split matters. Minting a fresh conversation key on top
 * of a wrapped key that merely failed to open is what leaves two devices holding
 * different keys, which then surfaces on the peer as `Key unwrapping failed`.
 */
export type ConversationKeyLookup =
  | { status: 'found'; key: Uint8Array }
  | { status: 'absent' }
  | { status: 'failed' };

/**
 * Resolve the conversation key for `userId`, in this order:
 *   1. the key this device already holds (memory cache, then secure storage)
 *   2. the wrapped key on this user's `conversation_participants` row
 *
 * Unwrapping is ECDH: it pairs THIS device's private key with the public key of
 * the device that wrapped the row - never with this user's own public key. The
 * row records that public key in `other_party_pub_key`, but rows written before
 * that was handled correctly need a second chance, so `fallbackPublicKeys` lets
 * the caller supply what it believes the wrapper's key to be (for a DM, the other
 * participant; for a group, the creator). When a fallback is the one that works,
 * the row is corrected so no other device has to guess again.
 */
export async function resolveConversationKey(
  conversationId: string,
  userId: string,
  fallbackPublicKeys: Array<string | null | undefined> = []
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

  const candidatePublicKeys = [wrappedKeyRow.other_party_pub_key, ...fallbackPublicKeys]
    .filter((candidate): candidate is string => !!candidate)
    .filter((candidate, index, all) => all.indexOf(candidate) === index);

  if (candidatePublicKeys.length === 0) {
    console.error('Cannot unwrap conversation key: wrapping public key unknown', {
      conversationId,
    });
    return { status: 'failed' };
  }

  for (const candidate of candidatePublicKeys) {
    try {
      const conversationKey = await MessageEncryption.unwrapConversationKey(
        MessageEncryption.base64ToBytes(wrappedKeyRow.wrapped_key),
        MessageEncryption.base64ToBytes(wrappedKeyRow.key_nonce),
        MessageEncryption.base64ToBytes(candidate),
        userId
      );

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
