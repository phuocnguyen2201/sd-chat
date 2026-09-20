import { MessageEncryption } from '../securedMessage/secured';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';

/*
  Conversation keys are stored per user, for the same reason identity keys are:
  the slot used to be `ck_<hash(conversationId)>` with no user in it, so two
  accounts sharing a device shared these entries, and logging out left them
  behind. Entries written under the old scheme are adopted lazily on first read
  - Secure Store has no way to enumerate keys, so they cannot be swept.

  No validation is needed when adopting: a conversation key is shared by every
  participant by design, so a legacy entry for a conversation this user is in is
  the correct key for it.
*/
export class ConversationKeyManager {
  
  private static readonly cache = new Map<string, Uint8Array>();
  private static readonly keyCache = new Map<string, Promise<string>>();

  private static cacheKey(userId: string, conversationId: string) {
    return `${userId}:${conversationId}`;
  }

  /**
   * Get conversation key as Uint8Array (preferred for internal use)
   * Uses cache first, then secure storage
   */
  static async getKey(userId: string, conversationId: string): Promise<Uint8Array | null> {
    // Check cache first
    const cached = this.cache.get(this.cacheKey(userId, conversationId));
    if (cached) {
      return cached;
    }

    // Check secure storage
    const storageKey = await this.makeKey(userId, conversationId);
    let base64Key = await SecureStore.getItemAsync(storageKey);

    if (!base64Key) {
      // Fall back to the pre-namespacing slot and carry it forward.
      const legacyKey = await this.legacyMakeKey(conversationId);
      base64Key = await SecureStore.getItemAsync(legacyKey);

      if (base64Key) {
        await SecureStore.setItemAsync(storageKey, base64Key);
      }
    }

    if (!base64Key) {
      return null;
    }

    // Convert to bytes and cache
    const keyBytes = MessageEncryption.base64ToBytes(base64Key);
    this.cache.set(this.cacheKey(userId, conversationId), keyBytes);
    return keyBytes;
  }

  /**
   * Get conversation key as base64 string (for router params)
   * Uses cache first, then secure storage
   */
  static async get(userId: string, conversationId: string): Promise<string> {
    // Check if we have a cached promise for this key
    const cachedPromise = this.keyCache.get(this.cacheKey(userId, conversationId));
    if (cachedPromise) {
      return cachedPromise;
    }

    const promise = (async () => {
      const keyBytes = await this.getKey(userId, conversationId);
      return keyBytes ? MessageEncryption.bytesToBase64(keyBytes) : '';
    })();

    this.keyCache.set(this.cacheKey(userId, conversationId), promise);
    return promise;
  }

  /**
   * Set conversation key (caches in memory and stores in secure storage)
   */
  static async setConversationKey(userId: string, conversationId: string, conversationKey: Uint8Array) {
    // Cache in memory immediately
    this.cache.set(this.cacheKey(userId, conversationId), conversationKey);
    
    // Store in secure storage (async, non-blocking)
    const storageKey = await this.makeKey(userId, conversationId);
    await SecureStore.setItemAsync(
      storageKey,
      MessageEncryption.bytesToBase64(conversationKey)
    );

    // Update base64 cache
    this.keyCache.set(
      this.cacheKey(userId, conversationId),
      Promise.resolve(MessageEncryption.bytesToBase64(conversationKey))
    );
  }

  static async makeKey(userId: string, conversationId: string) {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      conversationId
    );
    return `ck_${userId}_${hash}`;
  }

  private static async legacyMakeKey(conversationId: string) {
    const hash = await Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      conversationId
    );
    return `ck_${hash}`;
  }

  static clear(userId?: string, conversationId?: string) {
    if (userId && conversationId) {
      this.cache.delete(this.cacheKey(userId, conversationId));
      this.keyCache.delete(this.cacheKey(userId, conversationId));
    } else {
      this.cache.clear();
      this.keyCache.clear();
    }
  }

  /**
   * Drop every conversation key this device holds for `userId`.
   *
   * Secure Store cannot enumerate its own keys, so the conversation ids have to
   * come from the caller - the local snapshots are the device's own record of
   * which conversations it has ever held a key for.
   */
  static async deleteAllKeys(userId: string, conversationIds: string[]) {
    await Promise.all(
      conversationIds.map((conversationId) => this.deleteKey(userId, conversationId))
    );
    this.clear();
  }

  static async deleteKey(userId: string, conversationId: string){
    const hashKey = await this.makeKey(userId, conversationId)
    if(hashKey){
      await SecureStore.deleteItemAsync(hashKey)
    }
    await SecureStore.deleteItemAsync(await this.legacyMakeKey(conversationId))
    this.clear(userId, conversationId)
  }
}
