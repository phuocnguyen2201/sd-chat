import { supabase } from '../connection';
import { ownSigningPublicKey } from './MessageSigning';
import { PeerKeyPins } from './PeerKeyPins';

/*
  Where readers get the key to check a sender's signatures against
  (security #8c). A peer's published key is pinned on first sight; after
  that the pin wins, and a different published key is reported as `changed`
  for the caller to confirm with the user. The user's own messages (sent
  from any of their devices) are checked against this device's own key.
*/

export type SenderKey = {
  /** The key to verify with, or null when there is none. */
  key: string | null;
  /** Set when the published key differs from the pin; `key` is still the pin. */
  changedTo?: string;
};

/**
 * Publish this device's signing key on the profile when it is missing or
 * out of date (e.g. after the identity key was replaced). Best effort: a
 * failure is retried on the next launch.
 */
export async function publishOwnSigningKey(userId: string, published: string | null | undefined): Promise<void> {
  const own = ownSigningPublicKey(userId);
  if (!own || own === published) return;

  const { error } = await supabase.from('profiles').update({ signing_public_key: own }).eq('id', userId);
  if (error) {
    console.warn('Could not publish the message signing key:', error.message);
  }
}

export async function resolveSenderKeys(
  localUserId: string,
  senderIds: string[]
): Promise<Map<string, SenderKey>> {
  const result = new Map<string, SenderKey>();
  const peers = [...new Set(senderIds.filter((id) => id && id !== localUserId))];

  if (senderIds.includes(localUserId)) {
    result.set(localUserId, { key: ownSigningPublicKey(localUserId) });
  }
  if (peers.length === 0) return result;

  const published = new Map<string, string | null>();
  const { data, error } = await supabase.from('profiles').select('id, signing_public_key').in('id', peers);
  if (error) {
    // Offline or refused: fall back to whatever is pinned already.
    console.warn('Could not load signing keys:', error.message);
  }
  for (const row of (data ?? []) as Array<{ id: string; signing_public_key: string | null }>) {
    published.set(row.id, row.signing_public_key);
  }

  await Promise.all(
    peers.map(async (peerId) => {
      const current = published.get(peerId) ?? null;
      if (!current) {
        result.set(peerId, { key: await PeerKeyPins.getPinnedSigningKey(localUserId, peerId) });
        return;
      }
      const { state, pinned } = await PeerKeyPins.checkPeerSigningKey(localUserId, peerId, current);
      result.set(peerId, state === 'changed' ? { key: pinned, changedTo: current } : { key: current });
    })
  );
  return result;
}
