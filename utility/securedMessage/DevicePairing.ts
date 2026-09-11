import { MessageEncryption } from './secured';
import { KeyObject, PairDataPayload, PairInitPayload } from '@/utility/types/user';

// Domain-separation string for the pairing handshake's HKDF derivation.
// Keeps pairing key material independent from conversation-key wrapping,
// which uses its own 'conversation-key-wrap' info string.
const PAIRING_INFO = 'sd-chat-device-pairing-v1';
const PAIR_TTL_MS = 60_000;

// The receiving device's ephemeral secret key never leaves memory: not
// persisted, not passed through navigation params, discarded after one use
// or on timeout/cancel.
let ephemeralKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;

export const DevicePairing = {
  /**
   * Called on the device that wants to RECEIVE keys. Generates a one-time
   * key pair and returns the QR payload advertising its public half.
   */
  startPairing(userId?: string): PairInitPayload {
    this.reset();
    ephemeralKeyPair = MessageEncryption.generateEphemeralKeyPair();
    return {
      req: 'pair_init',
      ephemeralPublicKey: MessageEncryption.bytesToBase64(ephemeralKeyPair.publicKey),
      userId,
      expiresAt: Date.now() + PAIR_TTL_MS,
    };
  },

  /**
   * Called on the device that already HAS the keys, after it scanned a
   * pair_init QR. Seals the key material to the peer's public key so only
   * that specific device (the one holding the matching secret key) can
   * read it back out.
   */
  async sealForPeer(peerPublicKeyBase64: string, payload: KeyObject): Promise<PairDataPayload> {
    const senderEphemeral = MessageEncryption.generateEphemeralKeyPair();
    const peerPublicKey = MessageEncryption.base64ToBytes(peerPublicKeyBase64);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));

    try {
      const { ciphertext, nonce } = await MessageEncryption.ecdhSeal(
        plaintext,
        peerPublicKey,
        senderEphemeral.secretKey,
        PAIRING_INFO
      );

      return {
        req: 'pair_data',
        senderEphemeralPublicKey: MessageEncryption.bytesToBase64(senderEphemeral.publicKey),
        ciphertext: MessageEncryption.bytesToBase64(ciphertext),
        nonce: MessageEncryption.bytesToBase64(nonce),
        expiresAt: Date.now() + PAIR_TTL_MS,
      };
    } finally {
      senderEphemeral.secretKey.fill(0);
    }
  },

  /**
   * Called on the receiving device after it scans the pair_data QR shown
   * by the sending device. Only succeeds if this device is still holding
   * the secret key matching the public key it advertised in startPairing.
   */
  async openFromPeer(data: PairDataPayload): Promise<KeyObject> {
    if (!ephemeralKeyPair) {
      throw new Error('No pairing in progress on this device');
    }
    if (!Number.isFinite(data.expiresAt) || Date.now() > data.expiresAt) {
      this.reset();
      throw new Error('Pairing code expired, start again');
    }

    const senderPublicKey = MessageEncryption.base64ToBytes(data.senderEphemeralPublicKey);
    const ciphertext = MessageEncryption.base64ToBytes(data.ciphertext);
    const nonce = MessageEncryption.base64ToBytes(data.nonce);

    const plaintextBytes = await MessageEncryption.ecdhOpen(
      ciphertext,
      nonce,
      senderPublicKey,
      ephemeralKeyPair.secretKey,
      PAIRING_INFO
    );

    this.reset();
    return JSON.parse(new TextDecoder().decode(plaintextBytes)) as KeyObject;
  },

  isPairing(): boolean {
    return ephemeralKeyPair !== null;
  },

  /** Wipe the in-memory ephemeral key pair (cancel, timeout, or unmount). */
  reset(): void {
    if (ephemeralKeyPair) {
      ephemeralKeyPair.secretKey.fill(0);
      ephemeralKeyPair = null;
    }
  },
};

export function isPairInitPayload(value: unknown): value is PairInitPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PairInitPayload).req === 'pair_init' &&
    typeof (value as PairInitPayload).ephemeralPublicKey === 'string'
  );
}

export function isPairDataPayload(value: unknown): value is PairDataPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as PairDataPayload).req === 'pair_data' &&
    typeof (value as PairDataPayload).senderEphemeralPublicKey === 'string' &&
    typeof (value as PairDataPayload).ciphertext === 'string' &&
    typeof (value as PairDataPayload).nonce === 'string'
  );
}
