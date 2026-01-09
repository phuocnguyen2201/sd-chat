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

export class MessageEncryption {
  private static readonly USER_KEY_STORAGE = 'user_encryption_key';
  private static readonly ALGORITHM = 'ChaCha20-Poly1305';
  private static readonly NONCE_SIZE = 12; // ChaCha20 uses 12-byte nonce
  private static readonly KEY_SIZE = 32; // 256-bit key

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
      if (conversationKey.length !== this.KEY_SIZE) {
        throw new Error('Invalid conversation key length');
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
   * Generate a key pair for a user (for E2E encryption)
   */
  static async generateKeyPair(): Promise<UserKeyPair> {
    // Use tweetnacl for key pair generation
    const keyPair = nacl.box.keyPair();

    // Validate key sizes
    if (keyPair.publicKey.length !== 32 || keyPair.secretKey.length !== 32) {
      throw new Error(`Invalid key pair generated: public=${keyPair.publicKey.length}, private=${keyPair.secretKey.length}`);
    }

    await SecureStore.setItemAsync(this.USER_KEY_STORAGE, this.bytesToBase64(keyPair.secretKey), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });

    return {
      publicKey: this.bytesToBase64(keyPair.publicKey),
      privateKey: this.bytesToBase64(keyPair.secretKey)
    };
  }

static async wrapConversationKey(
  conversationKey: Uint8Array,
  recipientPublicKey: Uint8Array
): Promise<{ wrappedKey: Uint8Array; nonce: Uint8Array } | null> {
  //console.log('Wrapping conversation key');
  // 1. Load sender private key
  const prvKeyBase64 = await SecureStore.getItemAsync(this.USER_KEY_STORAGE);
  if (!prvKeyBase64) {
    console.error('No private key found');
    return null;
  }

  const senderPrivateKey = this.base64ToBytes(prvKeyBase64);
  //console.log('Sender private key length:', senderPrivateKey.length);
  //console.log('Recipient public key length:', recipientPublicKey.length);
  
  // Validate key sizes
  if (recipientPublicKey.length !== 32) {
    console.error('Invalid recipient public key size:', recipientPublicKey.length, 'expected 32');
    console.error('Recipient public key (first 10 bytes):', recipientPublicKey.slice(0, 10));
    throw new Error(`Invalid recipient public key size: ${recipientPublicKey.length}, expected 32`);
  }
  if (senderPrivateKey.length !== 32) {
    console.error('Invalid sender private key size:', senderPrivateKey.length, 'expected 32');
    console.error('Sender private key (first 10 bytes):', senderPrivateKey.slice(0, 10));
    throw new Error(`Invalid sender private key size: ${senderPrivateKey.length}, expected 32`);
  }
  
  // 2. Diffie–Hellman using tweetnacl
  const sharedSecret = nacl.box.before(recipientPublicKey, senderPrivateKey);

  // 3. Derive wrapping key (simplified - in production use proper HKDF)
  // For now, use the shared secret directly as the wrapping key
  const wrapKey = sharedSecret;

  // 4. Encrypt (wrap) the conversation key using ChaCha20-Poly1305
  const nonce = nacl.randomBytes(12); // ChaCha20 nonce size

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
  otherPartyPublicKey: Uint8Array
): Promise<Uint8Array> {

  const prvKeyBase64 = await SecureStore.getItemAsync(this.USER_KEY_STORAGE);
  if (!prvKeyBase64) {
    throw new Error('No private key found');
  }

  const privateKey = this.base64ToBytes(prvKeyBase64);

  if (otherPartyPublicKey.length !== 32 || privateKey.length !== 32) {
    throw new Error('Invalid key size');
  }

  // 1. ECDH
  const sharedSecret = nacl.box.before(otherPartyPublicKey, privateKey);

  // 2. KDF (IMPORTANT)
  const unwrapKey = await this.hkdfSha512(
      sharedSecret,
      new TextEncoder().encode('conversation-key-wrap'),
      32
    );

  // 3. Unwrap conversation key
  const cipher = new ChaCha20Poly1305(unwrapKey);
  const conversationKey = cipher.open(nonce, wrappedKey);
  console.log('Coversation Key',conversationKey)

  if (!conversationKey) {
    throw new Error('Key unwrapping failed');
  }

  // 4. Zero sensitive data
  sharedSecret.fill(0);
  unwrapKey.fill(0);
  privateKey.fill(0);

  return conversationKey;
}
static async hkdfSha512(
  ikm: Uint8Array,
  info: Uint8Array,
  length = 32
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

  static async deletePrivateKey(): Promise<Uint8Array | null> {
    const storedPrivateKey = await SecureStore.getItemAsync(this.USER_KEY_STORAGE);
    if (storedPrivateKey) {
      await SecureStore.deleteItemAsync(this.USER_KEY_STORAGE);
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

  /**
   * Generate a secure random string (for testing/dev)
   */
  static generateRandomString(length: number = 16): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const randomBytesArr = Crypto.getRandomBytes(length);
    let result = '';
    
    for (let i = 0; i < length; i++) {
      result += chars[randomBytesArr[i] % chars.length];
    }
    
    return result;
  }
}