import { sha256 } from '@noble/hashes/sha256';
import { MessageEncryption } from './secured';

/**
 * Security #23: the check value that ties a remote pairing to the new device
 * the user is holding.
 *
 * The relay (device-pairing) hands the old device the new device's one-time
 * public key. Without a check, whoever controls the server can swap in its
 * own key and receive the sealed identity key. A short fingerprint of the key
 * alone is not enough: the server sees the real key first and can grind a key
 * of its own with the same 6 digits.
 *
 * So this is commit-then-reveal, the same idea as Bluetooth numeric comparison:
 *   1. New device: random nonce Nn, sends key K and commitment H(K || Nn).
 *   2. Old device: random nonce Na, sent only after the commitment is fixed.
 *   3. New device: reveals Nn, then shows check(K, Na, Nn).
 *   4. Old device: checks the commitment, and the user types the new device's
 *      check value. Only a match lets it seal the key to K.
 * A server that swaps K has to commit to its own nonce before it sees Na, so
 * it gets one guess at a 6-digit value: 1 in a million.
 */

const COMMIT_CONTEXT = 'sd-chat-remote-pairing-commit-v1';
const CHECK_CONTEXT = 'sd-chat-remote-pairing-check-v1';

export const REMOTE_PAIRING_NONCE_BYTES = 32;
export const REMOTE_PAIRING_CHECK_DIGITS = 6;

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Length-prefixed UTF-8, so no two field lists encode to the same bytes. */
function field(value: string | Uint8Array): Uint8Array {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, bytes.length);
  return concat(len, bytes);
}

function decode32(base64: string, what: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = MessageEncryption.base64ToBytes(base64);
  } catch {
    throw new Error(`Invalid ${what}`);
  }
  if (bytes.length !== 32) throw new Error(`Invalid ${what}`);
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * H(context || K || Nn), base64. Plain concatenation of fixed-size values,
 * so the device-pairing function can recompute it with Web Crypto.
 */
export function remotePairingCommitment(ephemeralPublicKey: string, requesterNonce: string): string {
  const digest = sha256(
    concat(
      new TextEncoder().encode(COMMIT_CONTEXT),
      decode32(ephemeralPublicKey, 'public key'),
      decode32(requesterNonce, 'nonce')
    )
  );
  return MessageEncryption.bytesToBase64(digest);
}

export function verifyRemotePairingCommitment(
  ephemeralPublicKey: string,
  requesterNonce: string,
  commitment: string
): boolean {
  try {
    return constantTimeEqual(
      MessageEncryption.base64ToBytes(remotePairingCommitment(ephemeralPublicKey, requesterNonce)),
      MessageEncryption.base64ToBytes(commitment)
    );
  } catch {
    return false;
  }
}

export interface RemotePairingCheckInput {
  userId: string;
  requestId: string;
  ephemeralPublicKey: string;
  approverNonce: string;
  requesterNonce: string;
}

/** The 6-digit value both screens show. */
export function remotePairingCheck(input: RemotePairingCheckInput): string {
  const digest = sha256(
    concat(
      field(CHECK_CONTEXT),
      field(input.userId),
      field(input.requestId),
      field(decode32(input.ephemeralPublicKey, 'public key')),
      field(decode32(input.approverNonce, 'nonce')),
      field(decode32(input.requesterNonce, 'nonce'))
    )
  );
  // 40 bits mod 10^6: the bias is under 1e-6, far below the 1e-6 guess odds.
  let value = 0;
  for (let i = 0; i < 5; i++) value = value * 256 + digest[i];
  return (value % 10 ** REMOTE_PAIRING_CHECK_DIGITS).toString().padStart(REMOTE_PAIRING_CHECK_DIGITS, '0');
}

/** Constant-time comparison of a typed check value (spaces ignored). */
export function remotePairingCheckMatches(expected: string, typed: string): boolean {
  const cleaned = typed.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(cleaned)) return false;
  const enc = new TextEncoder();
  return constantTimeEqual(enc.encode(expected), enc.encode(cleaned));
}
