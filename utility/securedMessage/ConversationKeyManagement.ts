import { MessageEncryption } from '../securedMessage/secured';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

export class ConversationKeyManager {
  
  private static cache = new Map<string, Uint8Array>();

  static async get(conversationId: string): Promise<string> {
    // Encrypted local storage
    return await SecureStore.getItemAsync(await this.makeKey(conversationId))?? '';
  }

  static async setConversationKey(conversationId: string, conversationKey: Uint8Array){
    await SecureStore.setItemAsync(
        await this.makeKey(conversationId),
        MessageEncryption.bytesToBase64(conversationKey)
    );
  }


static async makeKey(conversationId: string) {
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    conversationId
  );
  return `ck_${hash}`;
}

  static clear(conversationId?: string) {
    if (conversationId) {
      this.cache.delete(conversationId);
    } else {
      this.cache.clear();
    }
  }
}
