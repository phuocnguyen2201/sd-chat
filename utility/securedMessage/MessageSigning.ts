import { hkdf } from '@noble/hashes/hkdf';
import { sha512 } from '@noble/hashes/sha2';
import * as Crypto from 'expo-crypto';
import * as nacl from 'tweetnacl';
import { MessageEncryption, type EncryptedMessage } from './secured';

/*
  Per-sender message signatures (security #8c).

  Every member of a conversation holds the same conversation key, so the AEAD
  tag on a message only proves "someone in this chat wrote this". Each message
  row is therefore also signed with the sender's own Ed25519 key, and readers
  check it against the key published in `profiles.signing_public_key` and
  pinned on first use (PeerKeyPins, same as security #7).

  The signing key is derived from the X25519 identity secret, not generated
  separately, so every device that already holds the identity key (pairing,
  QR transfer, vault backup) has the same signing key with nothing new to
  store or sync.

  The signature covers the row's id, conversation, sender and type as well as
  the encrypted fields, so a signed message cannot be replayed into another
  chat, re-attributed, or re-inserted under a new id. Editing signs again
  over the same id. Forwarding signs as the person forwarding.
*/

/**
 * Unsigned messages created at or after this moment get the "couldn't verify"
 * warning. Leave null while old app versions are still sending unsigned
 * messages; set it (ISO 8601) once most users have the signing update.
 *
 * Residual: `created_at` is set by the server, so a database-level attacker
 * can backdate a forged unsigned message to before the cutoff.
 */
export const SIGNATURES_REQUIRED_AFTER: string | null = null;

export type SignatureState = 'verified' | 'unsigned' | 'invalid';

/** The row fields a signature covers. Missing values sign as ''. */
export type SignedFields = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  content: string;
  nonce: string;
  wrapped_key: string;
  key_nonce: string;
};

type MessageLike = {
  id?: string | null;
  conversation_id?: string | null;
  sender_id?: string | null;
  message_type?: string | null;
  content?: string | null;
  nonce?: string | null;
  wrapped_key?: string | null;
  key_nonce?: string | null;
  signature?: string | null;
  created_at?: string | null;
};

const DOMAIN = 'sdchat-msg-v1';
const SIGNING_INFO = 'sd-chat/signing/v1';
const encoder = new TextEncoder();

export function deriveSigningKeyPair(identitySecret: Uint8Array): nacl.SignKeyPair {
  if (identitySecret.length !== 32) {
    throw new Error('The identity secret key must be 32 bytes');
  }
  const seed = hkdf(sha512, identitySecret, undefined, encoder.encode(SIGNING_INFO), 32);
  return nacl.sign.keyPair.fromSeed(seed);
}

// Deriving is cheap but runs on every send; keyed by the identity key so a
// recovered or replaced identity key is picked up straight away.
const ownKeyCache = new Map<string, { identity: string; pair: nacl.SignKeyPair }>();

/** This device's signing key pair for `userId`, or null without an identity key. */
export function ownSigningKeyPair(userId: string): nacl.SignKeyPair | null {
  const identity = MessageEncryption.getPrivateKey(userId);
  if (!identity) return null;

  const cached = ownKeyCache.get(userId);
  if (cached && cached.identity === identity) return cached.pair;

  const secret = MessageEncryption.base64ToBytes(identity);
  if (secret.length !== 32) return null;

  const pair = deriveSigningKeyPair(secret);
  ownKeyCache.set(userId, { identity, pair });
  return pair;
}

export function ownSigningPublicKey(userId: string): string | null {
  const pair = ownSigningKeyPair(userId);
  return pair ? MessageEncryption.bytesToBase64(pair.publicKey) : null;
}

/** Length-prefixed, so no two different field lists produce the same bytes. */
export function signingBytes(fields: SignedFields): Uint8Array {
  const parts = [
    DOMAIN,
    fields.id,
    fields.conversation_id,
    fields.sender_id,
    fields.message_type,
    fields.content,
    fields.nonce,
    fields.wrapped_key,
    fields.key_nonce,
  ].map((part) => encoder.encode(part));

  const total = parts.reduce((sum, p) => sum + 4 + p.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let offset = 0;
  for (const part of parts) {
    view.setUint32(offset, part.length);
    out.set(part, offset + 4);
    offset += 4 + part.length;
  }
  return out;
}

export function fieldsFromMessage(m: MessageLike): SignedFields {
  return {
    id: m.id ?? '',
    conversation_id: m.conversation_id ?? '',
    sender_id: m.sender_id ?? '',
    // The column defaults to 'text'; older rows may rely on that default.
    message_type: m.message_type || 'text',
    content: m.content ?? '',
    nonce: m.nonce ?? '',
    wrapped_key: m.wrapped_key ?? '',
    key_nonce: m.key_nonce ?? '',
  };
}

export function signFields(fields: SignedFields, secretKey: Uint8Array): string {
  return MessageEncryption.bytesToBase64(nacl.sign.detached(signingBytes(fields), secretKey));
}

export function verifyFields(fields: SignedFields, signature: string, publicKey: string): boolean {
  try {
    const sig = MessageEncryption.base64ToBytes(signature);
    const pk = MessageEncryption.base64ToBytes(publicKey);
    if (sig.length !== nacl.sign.signatureLength || pk.length !== nacl.sign.publicKeyLength) {
      return false;
    }
    return nacl.sign.detached.verify(signingBytes(fields), sig, pk);
  } catch {
    return false;
  }
}

/**
 * What the reader should be told about a message.
 *
 * `senderKey` is the key to check against: the pinned key for a peer, or this
 * device's own key for the user's own messages. A signed message with no key
 * to check it against cannot be trusted, so it is 'invalid', not 'unsigned'.
 */
export function classifySignature(
  m: MessageLike,
  senderKey: string | null,
  requiredAfter: string | null = SIGNATURES_REQUIRED_AFTER
): SignatureState {
  if (!m.signature) {
    if (!requiredAfter) return 'unsigned';
    const created = m.created_at ? Date.parse(m.created_at) : NaN;
    if (Number.isNaN(created)) return 'invalid';
    return created >= Date.parse(requiredAfter) ? 'invalid' : 'unsigned';
  }
  if (!senderKey) return 'invalid';
  return verifyFields(fieldsFromMessage(m), m.signature, senderKey) ? 'verified' : 'invalid';
}

/*
  Ed25519 in plain JS costs milliseconds per check, more on Hermes, so a
  result is kept for as long as the app runs: reopening a chat doesn't check
  the same messages again. The key includes everything the result depends on.
*/
const MAX_CACHED_RESULTS = 2000;
const resultCache = new Map<string, SignatureState>();

export function classifySignatureCached(m: MessageLike, senderKey: string | null): SignatureState {
  const cacheKey = [
    m.id, m.conversation_id, m.sender_id, m.message_type, m.content,
    m.nonce, m.wrapped_key, m.key_nonce, m.signature, m.created_at, senderKey,
  ].map((v) => v ?? '').join('|');

  const hit = resultCache.get(cacheKey);
  if (hit) return hit;

  const state = classifySignature(m, senderKey);
  if (resultCache.size >= MAX_CACHED_RESULTS) {
    // Maps iterate in insertion order: drop the oldest.
    resultCache.delete(resultCache.keys().next().value as string);
  }
  resultCache.set(cacheKey, state);
  return state;
}

type Envelope = Pick<EncryptedMessage, 'ciphertext' | 'nonce' | 'wrappedKey' | 'keyNonce'>;

export type SignedMessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  message_type: string;
  content: string;
  nonce?: string;
  wrapped_key?: string;
  key_nonce?: string;
  signature: string;
};

/**
 * The columns for a new (or edited) message row, signed by `senderId`.
 * Pass `id` when editing so the signature stays bound to the same row.
 *
 * Envelope fields may be missing for attachments sent before encryption,
 * which are forwarded as they are; they are left out of the row (stay null)
 * and sign as ''.
 */
export function buildSignedMessageRow(input: {
  conversationId: string;
  senderId: string;
  messageType: string;
  envelope: Partial<Envelope>;
  id?: string;
}): SignedMessageRow {
  const pair = ownSigningKeyPair(input.senderId);
  if (!pair) {
    throw new Error('No identity key on this device to sign the message with');
  }

  const row: SignedMessageRow = {
    id: input.id ?? Crypto.randomUUID(),
    conversation_id: input.conversationId,
    sender_id: input.senderId,
    message_type: input.messageType || 'text',
    content: input.envelope.ciphertext ?? '',
    nonce: input.envelope.nonce,
    wrapped_key: input.envelope.wrappedKey,
    key_nonce: input.envelope.keyNonce,
    signature: '',
  };
  row.signature = signFields(fieldsFromMessage(row), pair.secretKey);
  return row;
}
