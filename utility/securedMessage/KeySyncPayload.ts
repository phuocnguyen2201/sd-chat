import { SnapShot } from '@/utility/localstorage/snapshot';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { KeyObject } from '@/utility/types/user';

const VALID_FOR_MS = 5 * 60 * 1000;

/**
 * Builds the payload an already-synced device seals and hands to a new
 * device: its identity private key plus every conversation key it holds.
 * Shared by both the local QR pairing flow and the remote (server-relayed)
 * pairing flow - the payload shape and its sourcing don't depend on how it
 * gets transported. Returns null if this device has no key to share yet.
 */
export async function buildKeySyncPayload(userId: string | undefined): Promise<KeyObject | null> {
    const privKey = MessageEncryption.getPrivateKey();
    if (!userId || privKey === '') {
        return null;
    }

    const data: KeyObject = {
        req: 'sync_key',
        userId,
        validTime: Date.now() + VALID_FOR_MS,
        private_key: privKey,
        list: [],
    };

    const snapshots = await SnapShot.getMessagesSnapshot();
    for (const snapshot of snapshots) {
        const key = await ConversationKeyManager.getKey(snapshot.conversation_id);
        if (key) {
            data.list.push({
                id: snapshot.conversation_id,
                key: MessageEncryption.bytesToBase64(key),
            });
        }
    }

    return data;
}
