import { MessageEncryption } from '../securedMessage/secured';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

export class ConversationKeyManager {
  
  private static cache = new Map<string, Uint8Array>();
  private static keyCache = new Map<string, Promise<string>>();

  /**
   * Get conversation key as Uint8Array (preferred for internal use)
   * Uses cache first, then secure storage
   */
  static async getKey(conversationId: string): Promise<Uint8Array | null> {
    // Check cache first
    const cached = this.cache.get(conversationId);
    if (cached) {
      return cached;
    }

    // Check secure storage
    const storageKey = await this.makeKey(conversationId);
    const base64Key = await SecureStore.getItemAsync(storageKey);
    
    if (!base64Key) {
      return null;
    }

    // Convert to bytes and cache
    const keyBytes = MessageEncryption.base64ToBytes(base64Key);
    this.cache.set(conversationId, keyBytes);
    return keyBytes;
  }

  /**
   * Get conversation key as base64 string (for router params)
   * Uses cache first, then secure storage
   */
  static async get(conversationId: string): Promise<string> {
    // Check if we have a cached promise for this key
    const cachedPromise = this.keyCache.get(conversationId);
    if (cachedPromise) {
      return cachedPromise;
    }

    const promise = (async () => {
      const keyBytes = await this.getKey(conversationId);
      return keyBytes ? MessageEncryption.bytesToBase64(keyBytes) : '';
    })();

    this.keyCache.set(conversationId, promise);
    return promise;
  }

  /**
   * Set conversation key (caches in memory and stores in secure storage)
   */
  static async setConversationKey(conversationId: string, conversationKey: Uint8Array) {
    // Cache in memory immediately
    this.cache.set(conversationId, conversationKey);
    
    // Store in secure storage (async, non-blocking)
    const storageKey = await this.makeKey(conversationId);
    await SecureStore.setItemAsync(
      storageKey,
      MessageEncryption.bytesToBase64(conversationKey)
    );

    // Update base64 cache
    this.keyCache.set(conversationId, Promise.resolve(MessageEncryption.bytesToBase64(conversationKey)));
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
      this.keyCache.delete(conversationId);
    } else {
      this.cache.clear();
      this.keyCache.clear();
    }
  }
}
