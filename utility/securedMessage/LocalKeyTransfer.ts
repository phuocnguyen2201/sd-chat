import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { MessageEncryption } from './secured';

/**
 * Helpers for the sealed local key-sync QR (security #4).
 *
 * The new device creates a one-time X25519 key pair (DevicePairing) and sends
 * the public half with the pairing code it enters. The old device only seals
 * the QR to that key after checking `keyProof`, an HMAC keyed by the code it
 * displayed, so nobody without the code can swap in their own key. The QR
 * then holds ciphertext that only the new device can open.
 */

const PROOF_CONTEXT = 'sd-chat-pairing-proof-v1';

function proofBytes(userId: string, code: string, ephemeralPublicKey: string): Uint8Array {
  const key = new TextEncoder().encode(`${PROOF_CONTEXT}|${userId}|${code}`);
  return hmac(sha256, key, MessageEncryption.base64ToBytes(ephemeralPublicKey));
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// The code the old device is showing. Memory only: never navigation params or storage.
let issuedCode: string | null = null;

export const LocalKeyTransfer = {
  /** NEW DEVICE: bind its one-time public key to the code it is submitting. */
  computeKeyProof(userId: string, code: string, ephemeralPublicKey: string): string {
    return MessageEncryption.bytesToBase64(proofBytes(userId, code, ephemeralPublicKey));
  },

  /** OLD DEVICE: true only if the proof was made with the code it displayed. */
  verifyKeyProof(userId: string, code: string, ephemeralPublicKey: string, keyProof: string): boolean {
    try {
      return constantTimeEqual(
        proofBytes(userId, code, ephemeralPublicKey),
        MessageEncryption.base64ToBytes(keyProof)
      );
    } catch {
      return false;
    }
  },

  /**
   * Short check shown on both screens (4 hex characters of SHA-256 of the
   * one-time public key). Matching values mean the QR is sealed to the device
   * the user is holding - it catches a key swapped by whoever controls the server.
   */
  pairingCheck(ephemeralPublicKey: string): string {
    const digest = sha256(MessageEncryption.base64ToBytes(ephemeralPublicKey));
    return Array.from(digest.slice(0, 2))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  },

  setIssuedCode(code: string): void {
    issuedCode = code;
  },

  /** Returns the displayed code once and forgets it. */
  takeIssuedCode(): string | null {
    const code = issuedCode;
    issuedCode = null;
    return code;
  },

  clearIssuedCode(): void {
    issuedCode = null;
  },
};

/** A pre-#4 plaintext key QR (`KeyObject`), which is now refused. */
export function isLegacyPlaintextPayload(value: unknown): boolean {
  return (
    !!value &&
    typeof value === 'object' &&
    Array.isArray((value as { list?: unknown }).list) &&
    'private_key' in (value as object)
  );
}
