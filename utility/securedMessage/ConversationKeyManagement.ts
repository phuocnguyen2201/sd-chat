import { MessageEncryption } from '../securedMessage/secured';
import * as SecureStore from 'expo-secure-store';
import { supabase } from '../connection';

class ConversationKeyManager {
  private static cache = new Map<string, Uint8Array>();

  static async get(conversationId: string): Promise<Uint8Array> {
    // 1. Memory cache (fastest)
    const cached = this.cache.get(conversationId);
    if (cached) return cached;

    // 2. Encrypted local storage
    const stored = await SecureStore.getItemAsync(`ck:${conversationId}`);
    if (stored) {
      const key = MessageEncryption.base64ToBytes(stored);
      this.cache.set(conversationId, key);
      return key;
    }

    // 3. Fetch wrapped key from DB
    const wrapped = await fetchWrappedKeyFromDB(conversationId);

    const conversationKey = await MessageEncryption.unwrapConversationKey(
      wrapped.wrapped_key,
      wrapped.key_nonce,
      wrapped.other_party_public_key
    );

    // 4. Cache everywhere
    this.cache.set(conversationId, conversationKey);
    await SecureStore.setItemAsync(
      `ck:${conversationId}`,
      MessageEncryption.bytesToBase64(conversationKey)
    );

    return conversationKey;
  }

  static clear(conversationId?: string) {
    if (conversationId) {
      this.cache.delete(conversationId);
    } else {
      this.cache.clear();
    }
  }
}
