/**
 * Sealed local key-sync QR (security #4): what the old device shows must be
 * useless to anyone but the device that entered the pairing code.
 */
import { afterEach, describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
jest.mock('expo-secure-store', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  getItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

import { DevicePairing, isPairDataPayload, isPairInitPayload } from '../DevicePairing';
import { LocalKeyTransfer, isLegacyPlaintextPayload } from '../LocalKeyTransfer';
import { MessageEncryption } from '../secured';
import { KeyObject } from '@/utility/types/user';

const USER = '11111111-2222-4333-8444-555555555555';
const CODE = '4821';

const payload: KeyObject = {
  req: 'sync_key',
  userId: USER,
  validTime: Date.now() + 60_000,
  private_key: MessageEncryption.bytesToBase64(new Uint8Array(32).fill(7)),
  list: [{ id: 'conv-1', key: MessageEncryption.bytesToBase64(new Uint8Array(32).fill(9)) }],
};

afterEach(() => DevicePairing.reset());

describe('sealed key QR', () => {
  it('opens on the device that made the one-time key', async () => {
    DevicePairing.startPairing(USER);
    const qr = JSON.parse(JSON.stringify(await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload)));

    expect(isPairDataPayload(qr)).toBe(true);
    expect(JSON.stringify(qr)).not.toContain(payload.private_key);
    await expect(DevicePairing.openFromPeer(qr)).resolves.toEqual(payload);
    expect(DevicePairing.isPairing()).toBe(false); // one use
  });

  it('cannot be opened by another device (e.g. from a photo)', async () => {
    DevicePairing.startPairing(USER);
    const qr = await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload);

    DevicePairing.startPairing(USER); // a different device's one-time key
    await expect(DevicePairing.openFromPeer(qr)).rejects.toThrow(/authentication invalid/);
  });

  it('cannot be opened with no pairing in progress', async () => {
    DevicePairing.startPairing(USER);
    const qr = await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload);
    DevicePairing.reset();
    await expect(DevicePairing.openFromPeer(qr)).rejects.toThrow(/No pairing in progress/);
  });

  it('rejects a tampered ciphertext', async () => {
    DevicePairing.startPairing(USER);
    const qr = await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload);
    const bytes = MessageEncryption.base64ToBytes(qr.ciphertext);
    bytes[0] ^= 1;
    await expect(
      DevicePairing.openFromPeer({ ...qr, ciphertext: MessageEncryption.bytesToBase64(bytes) })
    ).rejects.toThrow(/authentication invalid/);
  });

  it('rejects an expired QR', async () => {
    DevicePairing.startPairing(USER);
    const qr = await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload);
    await expect(DevicePairing.openFromPeer({ ...qr, expiresAt: Date.now() - 1 })).rejects.toThrow(/expired/);
  });

  it('treats a NaN expiresAt as expired', async () => {
    DevicePairing.startPairing(USER);
    const qr = await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload);
    await expect(DevicePairing.openFromPeer({ ...qr, expiresAt: NaN })).rejects.toThrow(/expired/);
  });

  it('treats a missing expiresAt as expired', async () => {
    DevicePairing.startPairing(USER);
    const qr = await DevicePairing.sealForPeer(DevicePairing.publicKey()!, payload);
    const { expiresAt: _drop, ...rest } = qr;
    await expect(DevicePairing.openFromPeer(rest as typeof qr)).rejects.toThrow(/expired/);
  });

  it('rejects a successfully-decrypted but non-JSON payload', async () => {
    DevicePairing.startPairing(USER);
    const senderEphemeral = MessageEncryption.generateEphemeralKeyPair();
    // 'sd-chat-device-pairing-v1' mirrors DevicePairing's private PAIRING_INFO constant.
    const { ciphertext, nonce } = await MessageEncryption.ecdhSeal(
      new TextEncoder().encode('not valid json'),
      MessageEncryption.base64ToBytes(DevicePairing.publicKey()!),
      senderEphemeral.secretKey,
      'sd-chat-device-pairing-v1'
    );
    const qr = {
      req: 'pair_data' as const,
      senderEphemeralPublicKey: MessageEncryption.bytesToBase64(senderEphemeral.publicKey),
      ciphertext: MessageEncryption.bytesToBase64(ciphertext),
      nonce: MessageEncryption.bytesToBase64(nonce),
      expiresAt: Date.now() + 60_000,
    };
    await expect(DevicePairing.openFromPeer(qr)).rejects.toThrow();
    // The pairing state resets before JSON.parse runs, so the failed parse doesn't leave it stuck open.
    expect(DevicePairing.isPairing()).toBe(false);
  });

  it('starting again discards the previous ephemeral key and issues a new one', () => {
    DevicePairing.startPairing(USER);
    const first = DevicePairing.publicKey();
    DevicePairing.startPairing(USER);
    const second = DevicePairing.publicKey();
    expect(second).not.toBe(first);
    expect(DevicePairing.isPairing()).toBe(true);
  });
});

describe('isPairInitPayload', () => {
  it('accepts a valid pair_init payload', () => {
    const init = DevicePairing.startPairing(USER);
    expect(isPairInitPayload(init)).toBe(true);
  });

  it('rejects the wrong req value', () => {
    const init = DevicePairing.startPairing(USER);
    expect(isPairInitPayload({ ...init, req: 'pair_data' })).toBe(false);
  });

  it('rejects a payload missing ephemeralPublicKey', () => {
    const init = DevicePairing.startPairing(USER);
    const { ephemeralPublicKey: _drop, ...rest } = init;
    expect(isPairInitPayload(rest)).toBe(false);
  });

  it('rejects non-object input', () => {
    expect(isPairInitPayload(null)).toBe(false);
    expect(isPairInitPayload(undefined)).toBe(false);
    expect(isPairInitPayload('pair_init')).toBe(false);
    expect(isPairInitPayload(42)).toBe(false);
  });
});

describe('key proof', () => {
  const pub = () => {
    DevicePairing.startPairing(USER);
    return DevicePairing.publicKey()!;
  };

  it('verifies with the same user, code and key', () => {
    const key = pub();
    const proof = LocalKeyTransfer.computeKeyProof(USER, CODE, key);
    expect(LocalKeyTransfer.verifyKeyProof(USER, CODE, key, proof)).toBe(true);
  });

  it('fails with a wrong code, wrong user or swapped key', () => {
    const key = pub();
    const proof = LocalKeyTransfer.computeKeyProof(USER, CODE, key);
    const otherKey = MessageEncryption.bytesToBase64(MessageEncryption.generateEphemeralKeyPair().publicKey);

    expect(LocalKeyTransfer.verifyKeyProof(USER, '4822', key, proof)).toBe(false);
    expect(LocalKeyTransfer.verifyKeyProof('someone-else', CODE, key, proof)).toBe(false);
    expect(LocalKeyTransfer.verifyKeyProof(USER, CODE, otherKey, proof)).toBe(false);
    expect(LocalKeyTransfer.verifyKeyProof(USER, CODE, key, 'not base64!')).toBe(false);
  });

  it('pairing check is 4 hex chars and stable per key', () => {
    const key = pub();
    expect(LocalKeyTransfer.pairingCheck(key)).toMatch(/^[0-9A-F]{4}$/);
    expect(LocalKeyTransfer.pairingCheck(key)).toBe(LocalKeyTransfer.pairingCheck(key));
  });

  it('issued code is read once', () => {
    LocalKeyTransfer.setIssuedCode(CODE);
    expect(LocalKeyTransfer.takeIssuedCode()).toBe(CODE);
    expect(LocalKeyTransfer.takeIssuedCode()).toBeNull();
  });

  it('clearIssuedCode forgets the code even before it is taken', () => {
    LocalKeyTransfer.setIssuedCode(CODE);
    LocalKeyTransfer.clearIssuedCode();
    expect(LocalKeyTransfer.takeIssuedCode()).toBeNull();
  });
});

describe('legacy plaintext QR', () => {
  it('is recognised (and refused by ScanningKeys)', () => {
    expect(isLegacyPlaintextPayload(payload)).toBe(true);
    expect(isPairDataPayload(payload)).toBe(false);
    expect(isLegacyPlaintextPayload({ req: 'pair_data', ciphertext: 'x' })).toBe(false);
  });
});
