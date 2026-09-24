import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as nacl from 'tweetnacl';

// Set up PRNG for tweetnacl using expo-crypto
nacl.setPRNG((x, n) => {
  const randomBytes = Crypto.getRandomBytes(n);
  for (let i = 0; i < n; i++) {
    x[i] = randomBytes[i];
  }
});

export interface EncryptedMessage {
  ciphertext: string;
  nonce: string;
  algorithm: string;
  timestamp: number;
    wrappedKey: string;
    keyNonce: string;
}

export interface UserKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Whether the identity private key held on this device matches the public key
 * this account advertises in `profiles.public_key`.
 * - `ok`       the two correspond; conversations can be unwrapped
 * - `missing`  this device holds no usable key for this account
 * - `mismatch` a key is present but belongs to a different identity
 */
export type IdentityKeyState = 'ok' | 'missing' | 'mismatch';

export class MessageEncryption {
  /*
    The identity private key is stored per user. It used to live under one
    unnamespaced slot, so signing a second account in on the same device
    overwrote the first account's key while its `profiles.public_key` stayed
    unchanged - a silent, permanent mismatch that only ever surfaced on the
    peer's device as `Key unwrapping failed`.
  */
  private static readonly LEGACY_USER_KEY_STORAGE = 'user_encryption_key';
  private static readonly ALGORITHM = 'ChaCha20-Poly1305';
  private static readonly NONCE_SIZE = 12; // ChaCha20 uses 12-byte nonce
  private static readonly KEY_SIZE = 32; // 256-bit key

  private static userKeyStorage(userId: string): string {
    if (!userId) {
      throw new Error('A user id is required to reach the identity key');
    }
    return `user_encryption_key_${userId}`;
  }

  static encryptMessage(text: string, conversationKey: Uint8Array): EncryptedMessage {
    try {
      // Generate unique key for this message
        const messageKey = Crypto.getRandomBytes(this.KEY_SIZE);
        
        // Generate nonce (ChaCha20 uses 12 bytes)
        const nonce = Crypto.getRandomBytes(this.NONCE_SIZE);
        
        // Create cipher
        const cipher = new ChaCha20Poly1305(messageKey);
        
        // Encrypt the message
        const plaintextBytes = new TextEncoder().encode(text);
        const encryptedBytes = cipher.seal(nonce, plaintextBytes);

        const keyNonce = Crypto.getRandomBytes(this.NONCE_SIZE);
        const keyCipher = new ChaCha20Poly1305(conversationKey);
        const wrappedKey = keyCipher.seal(keyNonce, messageKey);

      
        // Return encrypted data
        return {
        ciphertext: this.bytesToBase64(encryptedBytes),
        nonce: this.bytesToBase64(nonce),

        wrappedKey: this.bytesToBase64(wrappedKey),
        keyNonce: this.bytesToBase64(keyNonce),

        algorithm: this.ALGORITHM,
        timestamp: Date.now(),
        };

      
    } catch (error) {
      console.error('Error encrypting message:', error);
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Decrypt a message
   */
  static decryptMessage(encryptedData: Omit<EncryptedMessage, 'algorithm' | 'timestamp'>, conversationKey: Uint8Array): string {
    try {
      // Convert base64 strings back to bytes
      const ciphertextBytes = this.base64ToBytes(encryptedData.ciphertext);
      const nonceBytes = this.base64ToBytes(encryptedData.nonce);
      const keyNonceBytes = this.base64ToBytes(encryptedData.keyNonce);
      const keyBytes = this.base64ToBytes(encryptedData.wrappedKey);
      
      if (nonceBytes.length !== this.NONCE_SIZE) {
        throw new Error(`Invalid nonce size: expected ${this.NONCE_SIZE}, got ${nonceBytes.length}`);
      }
      if (keyNonceBytes.length !== this.NONCE_SIZE) {
        throw new Error('Invalid key nonce size');
    }
      // Create cipher
      if (!conversationKey || conversationKey.length !== this.KEY_SIZE) {

        throw new Error(''+conversationKey.length);
      }
      const cipherKey = new ChaCha20Poly1305(conversationKey);
        
        // Decrypt the message key
        const messageKey = cipherKey.open(keyNonceBytes, keyBytes);
        if (!messageKey) {
        throw new Error('Key unwrapping failed');
        }
      // Decrypt the message

      const cipher = new ChaCha20Poly1305(messageKey);
      const decryptedBytes = cipher.open(nonceBytes, ciphertextBytes);
      
      if (!decryptedBytes) {
        throw new Error('Decryption failed - authentication invalid');
      }
      
      // Convert back to string
      return new TextDecoder().decode(decryptedBytes);
      
    } catch (error) {
      console.error('Error decrypting message:', error);
      throw new Error(`Decryption failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a key pair for a user (for E2E encryption).
   *
   * This does NOT persist anything: at sign-up the account does not exist yet,
   * so there is no user id to file the private key under. The caller stores it
   * with `setPrivateKey(userId, ...)` once sign-up returns the new user.
   */
  static async generateKeyPair(): Promise<UserKeyPair> {
    // Use tweetnacl for key pair generation
    const keyPair = nacl.box.keyPair();

    // Validate key sizes
    if (keyPair.publicKey.length !== this.KEY_SIZE || keyPair.secretKey.length !== this.KEY_SIZE) {
      throw new Error(`Invalid key pair generated: public=${keyPair.publicKey.length}, private=${keyPair.secretKey.length}`);
    }

    return {
      publicKey: this.bytesToBase64(keyPair.publicKey),
      privateKey: this.bytesToBase64(keyPair.secretKey)
    };
  }

  static getPrivateKey(userId: string): string {
    return SecureStore.getItem(this.userKeyStorage(userId), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    }) ?? '';
  }

  static setPrivateKey(userId: string, key: Uint8Array): void {
    SecureStore.setItem(this.userKeyStorage(userId), this.bytesToBase64(key), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    })
  }

  /**
   * The public key that actually corresponds to the private key stored for
   * `userId` on this device. Returns null when no usable key is stored.
   */
  static async derivePublicKey(userId: string): Promise<string | null> {
    const prvKeyBase64 = await SecureStore.getItemAsync(this.userKeyStorage(userId));
    if (!prvKeyBase64) {
      return null;
    }

    const secretKey = this.base64ToBytes(prvKeyBase64);
    if (secretKey.length !== this.KEY_SIZE) {
      return null;
    }

    return this.bytesToBase64(nacl.box.keyPair.fromSecretKey(secretKey).publicKey);
  }

  /**
   * Check this device's identity key against what the account advertises, and
   * adopt the pre-namespacing key if it turns out to belong to this account.
   *
   * The legacy slot holds whichever account wrote it last, so it is only
   * adopted when its derived public key matches - copying it blindly would
   * cement another identity's key under this user's name.
   */
  static async verifyIdentityKey(
    userId: string,
    profilePublicKey: string
  ): Promise<IdentityKeyState> {
    const derived = await this.derivePublicKey(userId);

    if (derived) {
      // Without a public key on the profile there is nothing to check against.
      if (!profilePublicKey) return 'ok';
      return derived === profilePublicKey ? 'ok' : 'mismatch';
    }

    const legacyKeyBase64 = await SecureStore.getItemAsync(this.LEGACY_USER_KEY_STORAGE);
    if (!legacyKeyBase64) {
      return 'missing';
    }

    const legacySecretKey = this.base64ToBytes(legacyKeyBase64);
    if (legacySecretKey.length !== this.KEY_SIZE) {
      return 'missing';
    }

    const legacyPublicKey = this.bytesToBase64(
      nacl.box.keyPair.fromSecretKey(legacySecretKey).publicKey
    );

    if (profilePublicKey && legacyPublicKey !== profilePublicKey) {
      // Belongs to a different account that used this device. Leave it alone;
      // this user has to sync their own key from a device that holds it.
      return 'missing';
    }

    this.setPrivateKey(userId, legacySecretKey);
    return 'ok';
  }

  static async wrapConversationKey(
    conversationKey: Uint8Array,
    recipientPublicKey: Uint8Array,
    userId: string
  ): Promise<{ wrappedKey: Uint8Array; nonce: Uint8Array }> {
    //console.log('Wrapping conversation key');
    // 1. Load sender private key
    const prvKeyBase64 = await SecureStore.getItemAsync(this.userKeyStorage(userId));
    if (!prvKeyBase64) {
      /*
        Throw rather than return null. Callers used to treat null as "skip this
        row" and carry on, which let a device with no identity key mint a
        conversation key, keep it locally and write no rows at all - a chat
        nobody else could ever open.
      */
      throw new Error('No private key found');
  }

  const senderPrivateKey = this.base64ToBytes(prvKeyBase64);
  //console.log('Sender private key length:', senderPrivateKey.length);
  //console.log('Recipient public key length:', recipientPublicKey.length);
  
  // Validate key sizes
  if (recipientPublicKey.length !== this.KEY_SIZE) {
    console.error('Invalid recipient public key size:', recipientPublicKey.length, 'expected 32');
    console.error('Recipient public key (first 10 bytes):', recipientPublicKey.slice(0, 10));
    throw new Error(`Invalid recipient public key size: ${recipientPublicKey.length}, expected ${this.KEY_SIZE}`);
  }
  if (senderPrivateKey.length !== this.KEY_SIZE) {
    console.error('Invalid sender private key size:', senderPrivateKey.length, 'expected 32');
    console.error('Sender private key (first 10 bytes):', senderPrivateKey.slice(0, 10));
    throw new Error(`Invalid sender private key size: ${senderPrivateKey.length}, expected ${this.KEY_SIZE}`);
  }
  
  // 2. Diffie–Hellman using tweetnacl
  const sharedSecret = nacl.box.before(recipientPublicKey, senderPrivateKey);

  // 3. Derive wrapping key (simplified - in production use proper HKDF)
  // For now, use the shared secret directly as the wrapping key
  const wrapKey = await this.hkdfSha512(
    sharedSecret,
    new TextEncoder().encode('conversation-key-wrap'),
    this.KEY_SIZE
  );

  // 4. Encrypt (wrap) the conversation key using ChaCha20-Poly1305
  const nonce = nacl.randomBytes(this.NONCE_SIZE); // ChaCha20 nonce size

  const cipher = new ChaCha20Poly1305(wrapKey);
  const wrappedKey = cipher.seal(nonce, conversationKey);

  // 5. Zero sensitive buffers (defense-in-depth)
  sharedSecret.fill(0);
  wrapKey.fill(0);

  return { wrappedKey, nonce };
}

static async unwrapConversationKey(
  wrappedKey: Uint8Array,
  nonce: Uint8Array,
  otherPartyPublicKey: Uint8Array,
  userId: string
): Promise<Uint8Array> {

  const prvKeyBase64 = await SecureStore.getItemAsync(this.userKeyStorage(userId));
  if (!prvKeyBase64) {
    throw new Error('No private key found');
  }

  const privateKey = this.base64ToBytes(prvKeyBase64);

  if (otherPartyPublicKey.length !== this.KEY_SIZE || privateKey.length !== this.KEY_SIZE) {
    throw new Error(`Invalid key size: otherParty=${otherPartyPublicKey.length}, privateKey=${privateKey.length}`);
  }

  // 1. ECDH
  const sharedSecret = nacl.box.before(otherPartyPublicKey, privateKey);

  // 2. KDF (IMPORTANT)
  const unwrapKey = await this.hkdfSha512(
      sharedSecret,
      new TextEncoder().encode('conversation-key-wrap'),
      this.KEY_SIZE
    );

  // 3. Unwrap conversation key
  const cipher = new ChaCha20Poly1305(unwrapKey);
  const conversationKey = cipher.open(nonce, wrappedKey);

  if (!conversationKey) {
    // Zero the derived material before unwinding, not just on the success path.
    sharedSecret.fill(0);
    unwrapKey.fill(0);
    privateKey.fill(0);

    throw new Error('Key unwrapping failed');
  }

  // 4. Zero sensitive data
  sharedSecret.fill(0);
  unwrapKey.fill(0);
  privateKey.fill(0);

  return conversationKey;
}

// HKDF-SHA512 implementation
static async hkdfSha512(
  ikm: Uint8Array,
  info: Uint8Array,
  length = this.KEY_SIZE
): Promise<Uint8Array> {
  // Extract (no salt)
  const prk = nacl.hash(ikm);

  // Expand (single block is enough for 32 bytes)
  const t = nacl.hash(
    new Uint8Array([
      ...prk,
      ...info,
      0x01,
    ])
    
  );

  return t.slice(0, length);
}


  static async createConversationKey(): Promise<Uint8Array> {
    return Crypto.getRandomBytes(this.KEY_SIZE);
  }

  static async deletePrivateKey(userId: string): Promise<Uint8Array | null> {
    // Clear the legacy slot too, so a deleted account leaves nothing behind.
    await SecureStore.deleteItemAsync(this.LEGACY_USER_KEY_STORAGE);

    const storedPrivateKey = await SecureStore.getItemAsync(this.userKeyStorage(userId));
    if (storedPrivateKey) {
      await SecureStore.deleteItemAsync(this.userKeyStorage(userId));
      return this.base64ToBytes(storedPrivateKey);
    }
    return null;
  }
  /**
   * Helper: Convert Uint8Array to base64 string
   */
  public static bytesToBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode.apply(null, Array.from(bytes)));
  }

  /**
   * Helper: Convert base64 string to Uint8Array
   */
  public static base64ToBytes(base64: string): Uint8Array {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    return bytes;
  }
  static async randomEpoch(): Promise<Uint8Array> {
    return Crypto.getRandomBytes(1);
  }

  /**
   * Generate a throwaway X25519 key pair that lives only in memory
   * (used for one-time device-pairing handshakes, never persisted).
   */
  static generateEphemeralKeyPair(): { publicKey: Uint8Array; secretKey: Uint8Array } {
    return nacl.box.keyPair();
  }

  /**
   * Encrypt `plaintext` so only the holder of `recipientPublicKey`'s matching
   * private key can read it. Used to seal data for a QR code so a bystander
   * who scans it gets ciphertext, not secrets.
   */
  static async ecdhSeal(
    plaintext: Uint8Array,
    recipientPublicKey: Uint8Array,
    senderSecretKey: Uint8Array,
    info: string
  ): Promise<{ ciphertext: Uint8Array; nonce: Uint8Array }> {
    if (recipientPublicKey.length !== this.KEY_SIZE || senderSecretKey.length !== this.KEY_SIZE) {
      throw new Error('Invalid key size for ECDH seal');
    }

    const sharedSecret = nacl.box.before(recipientPublicKey, senderSecretKey);
    const sealKey = await this.hkdfSha512(sharedSecret, new TextEncoder().encode(info), this.KEY_SIZE);
    const nonce = nacl.randomBytes(this.NONCE_SIZE);
    const cipher = new ChaCha20Poly1305(sealKey);
    const ciphertext = cipher.seal(nonce, plaintext);

    sharedSecret.fill(0);
    sealKey.fill(0);

    return { ciphertext, nonce };
  }

  /**
   * Inverse of ecdhSeal: only succeeds if `recipientSecretKey` is the match
   * for the public key the sender sealed against.
   */
  static async ecdhOpen(
    ciphertext: Uint8Array,
    nonce: Uint8Array,
    senderPublicKey: Uint8Array,
    recipientSecretKey: Uint8Array,
    info: string
  ): Promise<Uint8Array> {
    if (senderPublicKey.length !== this.KEY_SIZE || recipientSecretKey.length !== this.KEY_SIZE) {
      throw new Error('Invalid key size for ECDH open');
    }

    const sharedSecret = nacl.box.before(senderPublicKey, recipientSecretKey);
    const openKey = await this.hkdfSha512(sharedSecret, new TextEncoder().encode(info), this.KEY_SIZE);
    const cipher = new ChaCha20Poly1305(openKey);
    const plaintext = cipher.open(nonce, ciphertext);

    sharedSecret.fill(0);
    openKey.fill(0);

    if (!plaintext) {
      throw new Error('ECDH unwrap failed - authentication invalid');
    }

    return plaintext;
  }
}