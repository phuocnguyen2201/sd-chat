/**
 * Security #23: remote pairing only moves keys after the user typed, on the
 * old device, the check value shown on the new device - and a server in the
 * middle can't make the two values match.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

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

type Call = { action: string; payload: Record<string, any> };
let mockHandler: (call: Call) => any = () => ({});
const mockCalls: Call[] = [];
jest.mock('../DevicePairingFunctionClient', () => ({
  invokeDevicePairing: async (action: string, payload: Record<string, any>) => {
    const call = { action, payload };
    mockCalls.push(call);
    return mockHandler(call);
  },
}));

import { RemoteDevicePairing, RemotePairingCheckError } from '../RemoteDevicePairing';
import {
  remotePairingCheck,
  remotePairingCheckMatches,
  remotePairingCommitment,
  verifyRemotePairingCommitment,
} from '../RemotePairingCheck';
import { MessageEncryption } from '../secured';
import { KeyObject } from '@/utility/types/user';

const USER = '11111111-2222-4333-8444-555555555555';
const NEW_DEVICE = 'new-device-row';
const OLD_DEVICE = 'old-device-row';
const REQUEST = 'req-1';

const payload: KeyObject = {
  req: 'sync_key',
  userId: USER,
  validTime: Date.now() + 60_000,
  private_key: MessageEncryption.bytesToBase64(new Uint8Array(32).fill(7)),
  list: [{ id: 'conv-1', key: MessageEncryption.bytesToBase64(new Uint8Array(32).fill(9)) }],
};

const random32 = () => MessageEncryption.bytesToBase64(new Uint8Array(require('crypto').randomBytes(32)));

/** An honest relay: stores what each side sends and hands it to the other. */
function honestRelay() {
  const row: Record<string, any> = {};
  mockHandler = ({ action, payload: p }) => {
    switch (action) {
      case 'create':
        Object.assign(row, { key: p.ephemeralPublicKey, commitment: p.commitment, status: 'pending' });
        return { requestId: REQUEST, expiresAt: 'later' };
      case 'challenge':
        expect(p.requesterEphemeralPublicKey).toBe(row.key);
        expect(p.requesterCommitment).toBe(row.commitment);
        Object.assign(row, { approverNonce: p.approverNonce, status: 'challenged' });
        return { ok: true };
      case 'reveal':
        expect(verifyRemotePairingCommitment(row.key, p.requesterNonce, row.commitment)).toBe(true);
        Object.assign(row, { requesterNonce: p.requesterNonce, status: 'revealed' });
        return { ok: true };
      case 'approve':
        Object.assign(row, { sealed: p, status: 'approved' });
        return { requestId: REQUEST, expiresAt: 'later' };
      case 'fetch-key':
        return { senderEphemeralPublicKey: row.sealed.senderEphemeralPublicKey, ciphertext: row.sealed.ciphertext, nonce: row.sealed.nonce };
      case 'deny':
        row.status = 'denied';
        return { ok: true };
      default:
        return { ok: true };
    }
  };
  return row;
}

beforeEach(() => {
  RemoteDevicePairing.reset();
  mockCalls.length = 0;
});

describe('remote pairing check value', () => {
  it('moves the keys when the user types the value shown on the new device', async () => {
    const row = honestRelay();
    await RemoteDevicePairing.createRequest(NEW_DEVICE);
    await RemoteDevicePairing.challenge(OLD_DEVICE, {
      requestId: REQUEST,
      requestingEphemeralPublicKey: row.key,
      requesterCommitment: row.commitment,
    });
    const shownOnNew = await RemoteDevicePairing.reveal(NEW_DEVICE, USER, REQUEST, row.approverNonce);
    expect(shownOnNew).toMatch(/^\d{6}$/);

    await RemoteDevicePairing.approve(OLD_DEVICE, USER, row.requesterNonce, shownOnNew, payload);
    expect(row.status).toBe('approved');
    expect(mockCalls.find((c) => c.action === 'approve')!.payload.requestId).toBe(REQUEST);

    const received = await RemoteDevicePairing.fetchAndUnwrap(NEW_DEVICE, REQUEST);
    expect(received).toEqual(payload);
  });

  it('denies the request and seals nothing when the typed value is wrong', async () => {
    const row = honestRelay();
    await RemoteDevicePairing.createRequest(NEW_DEVICE);
    await RemoteDevicePairing.challenge(OLD_DEVICE, {
      requestId: REQUEST,
      requestingEphemeralPublicKey: row.key,
      requesterCommitment: row.commitment,
    });
    const shownOnNew = await RemoteDevicePairing.reveal(NEW_DEVICE, USER, REQUEST, row.approverNonce);
    const wrong = ((Number(shownOnNew) + 1) % 1_000_000).toString().padStart(6, '0');

    await expect(
      RemoteDevicePairing.approve(OLD_DEVICE, USER, row.requesterNonce, wrong, payload)
    ).rejects.toBeInstanceOf(RemotePairingCheckError);
    expect(row.status).toBe('denied');
    expect(mockCalls.some((c) => c.action === 'approve')).toBe(false);

    // One try per request: the approver state is gone, even with the right value now.
    await expect(
      RemoteDevicePairing.approve(OLD_DEVICE, USER, row.requesterNonce, shownOnNew, payload)
    ).rejects.toThrow('No pairing request is being approved');
  });

  it('catches a server that swaps in its own key', async () => {
    // The real new device talks to the server; the old device is shown the attacker's key.
    const row = honestRelay();
    await RemoteDevicePairing.createRequest(NEW_DEVICE);

    const attackerKey = MessageEncryption.bytesToBase64(MessageEncryption.generateEphemeralKeyPair().publicKey);
    const attackerNonce = random32();
    const attackerCommitment = remotePairingCommitment(attackerKey, attackerNonce);

    mockHandler = ({ action, payload: p }) => {
      if (action === 'challenge') {
        row.approverNonce = p.approverNonce;
        return { ok: true };
      }
      if (action === 'reveal') {
        row.requesterNonce = p.requesterNonce;
        return { ok: true };
      }
      if (action === 'deny') {
        row.status = 'denied';
        return { ok: true };
      }
      if (action === 'approve') throw new Error('must not be reached');
      return { ok: true };
    };

    await RemoteDevicePairing.challenge(OLD_DEVICE, {
      requestId: REQUEST,
      requestingEphemeralPublicKey: attackerKey,
      requesterCommitment: attackerCommitment,
    });
    // The server forwards the old device's nonce; the new device shows its value.
    const shownOnNew = await RemoteDevicePairing.reveal(NEW_DEVICE, USER, REQUEST, row.approverNonce);

    // The value the old device expects for the attacker's key doesn't match it.
    const oldExpects = remotePairingCheck({
      userId: USER,
      requestId: REQUEST,
      ephemeralPublicKey: attackerKey,
      approverNonce: row.approverNonce,
      requesterNonce: attackerNonce,
    });
    expect(oldExpects).not.toBe(shownOnNew);

    await expect(
      RemoteDevicePairing.approve(OLD_DEVICE, USER, attackerNonce, shownOnNew, payload)
    ).rejects.toBeInstanceOf(RemotePairingCheckError);
    expect(row.status).toBe('denied');
  });

  it('catches a nonce that does not open the commitment recorded at challenge time', async () => {
    const row = honestRelay();
    await RemoteDevicePairing.createRequest(NEW_DEVICE);
    await RemoteDevicePairing.challenge(OLD_DEVICE, {
      requestId: REQUEST,
      requestingEphemeralPublicKey: row.key,
      requesterCommitment: row.commitment,
    });

    // A server that picks a nonce after seeing Na, to make a value of its choosing.
    const chosenNonce = random32();
    const forged = remotePairingCheck({
      userId: USER,
      requestId: REQUEST,
      ephemeralPublicKey: row.key,
      approverNonce: row.approverNonce,
      requesterNonce: chosenNonce,
    });

    await expect(
      RemoteDevicePairing.approve(OLD_DEVICE, USER, chosenNonce, forged, payload)
    ).rejects.toBeInstanceOf(RemotePairingCheckError);
    expect(mockCalls.some((c) => c.action === 'approve')).toBe(false);
  });

  it('seals only to the key it challenged, whatever status says later', async () => {
    const row = honestRelay();
    await RemoteDevicePairing.createRequest(NEW_DEVICE);
    const challengedKey = row.key;
    await RemoteDevicePairing.challenge(OLD_DEVICE, {
      requestId: REQUEST,
      requestingEphemeralPublicKey: challengedKey,
      requesterCommitment: row.commitment,
    });
    const shownOnNew = await RemoteDevicePairing.reveal(NEW_DEVICE, USER, REQUEST, row.approverNonce);
    row.key = MessageEncryption.bytesToBase64(MessageEncryption.generateEphemeralKeyPair().publicKey);

    await RemoteDevicePairing.approve(OLD_DEVICE, USER, row.requesterNonce, shownOnNew, payload);
    // The real new device (holder of challengedKey) can open it.
    expect(await RemoteDevicePairing.fetchAndUnwrap(NEW_DEVICE, REQUEST)).toEqual(payload);
  });

  it('refuses to reveal for a request this device did not make', async () => {
    honestRelay();
    await RemoteDevicePairing.createRequest(NEW_DEVICE);
    await expect(RemoteDevicePairing.reveal(NEW_DEVICE, USER, 'other-request', random32())).rejects.toThrow(
      'No pairing in progress'
    );
  });
});

describe('RemotePairingCheck helpers', () => {
  const input = {
    userId: USER,
    requestId: REQUEST,
    ephemeralPublicKey: random32(),
    approverNonce: random32(),
    requesterNonce: random32(),
  };

  it('is 6 digits and changes with every input', () => {
    const base = remotePairingCheck(input);
    expect(base).toMatch(/^\d{6}$/);
    for (const k of ['ephemeralPublicKey', 'approverNonce', 'requesterNonce'] as const) {
      expect(remotePairingCheck({ ...input, [k]: random32() })).not.toBe(base);
    }
    expect(remotePairingCheck({ ...input, requestId: 'req-2' })).not.toBe(base);
    expect(remotePairingCheck({ ...input, userId: 'someone-else' })).not.toBe(base);
  });

  it('accepts the value with spaces and rejects anything else', () => {
    const value = remotePairingCheck(input);
    expect(remotePairingCheckMatches(value, `${value.slice(0, 3)} ${value.slice(3)}`)).toBe(true);
    expect(remotePairingCheckMatches(value, '')).toBe(false);
    expect(remotePairingCheckMatches(value, value.slice(0, 5))).toBe(false);
    expect(remotePairingCheckMatches(value, 'abcdef')).toBe(false);
  });

  it('rejects keys and nonces that are not 32 bytes', () => {
    expect(() => remotePairingCommitment('AAAA', random32())).toThrow('Invalid public key');
    expect(verifyRemotePairingCommitment(random32(), 'AAAA', random32())).toBe(false);
  });
});
