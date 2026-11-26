import * as Crypto from 'expo-crypto';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { KeyObject } from '@/utility/types/user';
import { invokeDevicePairing } from '@/utility/securedMessage/DevicePairingFunctionClient';
import {
    REMOTE_PAIRING_NONCE_BYTES,
    remotePairingCheck,
    remotePairingCheckMatches,
    remotePairingCommitment,
    verifyRemotePairingCommitment,
} from '@/utility/securedMessage/RemotePairingCheck';

// Domain-separation string for this transport. Deliberately distinct from
// the local QR flow's 'sd-chat-device-pairing-v1' (DevicePairing.ts) even
// though both are ECDH+HKDF+AEAD over fresh ephemeral keys - keeps the two
// flows' derived keys unambiguous from each other in case either is ever
// extended to accept cross-transport payloads.
const PAIRING_INFO = 'sd-chat-remote-device-pairing-v1';

/**
 * Remote (server-relayed) pairing, with the check value from security #23
 * (see RemotePairingCheck.ts):
 *
 *   NEW DEVICE                      server            OLD DEVICE
 *   createRequest  (K, H(K||Nn)) ->  pending
 *                                    challenged  <-  challenge (Na)   [after the identity check]
 *   reveal (Nn)                  ->  revealed
 *   shows check(K, Na, Nn)                           user types it -> approve (sealed to K)
 *   fetchAndUnwrap               <-  approved
 *
 * The old device only seals to the key it saw when it challenged, and only
 * after the commitment opens and the typed value matches. A mismatch denies
 * the request, so each request gets a single try.
 */

export type RemotePairingState = 'pending' | 'challenged' | 'revealed' | 'approved';

export type PairingStatus =
    | { active: false }
    | {
          active: true;
          requestId: string;
          status: RemotePairingState;
          requestingDeviceId: string;
          requestingDeviceName: string;
          requestingEphemeralPublicKey: string;
          /** H(K || Nn) from the new device, fixed at create. */
          requesterCommitment: string;
          /** Set once an old device has challenged the request. */
          approverNonce: string | null;
          /** Set once the new device has revealed its nonce. */
          requesterNonce: string | null;
          /** This device made the request. */
          isMine?: boolean;
          /** This device challenged the request (it's the one that may approve). */
          isChallenger?: boolean;
          expiresAt: string;
      };

/** The typed value didn't match, or the server's data didn't add up. The request has been denied. */
export class RemotePairingCheckError extends Error {
    constructor(message = "The codes don't match. Start pairing again on the new device.") {
        super(message);
        this.name = 'RemotePairingCheckError';
    }
}

function randomNonce(): string {
    return MessageEncryption.bytesToBase64(Crypto.getRandomBytes(REMOTE_PAIRING_NONCE_BYTES));
}

// NEW DEVICE: the one-time key pair and the committed nonce, in memory only
// for one attempt. Cleared on completion, cancel, or error.
let requester: {
    requestId: string | null;
    keyPair: { publicKey: Uint8Array; secretKey: Uint8Array };
    nonce: string;
} | null = null;

// OLD DEVICE: what it saw and sent when it challenged. It seals only to this key.
let approver: {
    requestId: string;
    ephemeralPublicKey: string;
    commitment: string;
    nonce: string;
} | null = null;

function resetRequester(): void {
    if (requester) {
        requester.keyPair.secretKey.fill(0);
        requester = null;
    }
}

function resetApprover(): void {
    approver = null;
}

function resetPairingState(): void {
    resetRequester();
    resetApprover();
}

export const RemoteDevicePairing = {
    /**
     * NEW DEVICE: register a pairing request with a fresh one-time key and a
     * commitment to a nonce that is revealed later.
     *
     * The server only accepts this right after THIS device passed
     * LocalPairingCode.verify (within the code's 3-minute life), and uses
     * that code up - otherwise it answers 403.
     */
    async createRequest(deviceRowId: string): Promise<{ requestId: string; expiresAt: string }> {
        resetRequester();
        const keyPair = MessageEncryption.generateEphemeralKeyPair();
        const nonce = randomNonce();
        requester = { requestId: null, keyPair, nonce };
        const ephemeralPublicKey = MessageEncryption.bytesToBase64(keyPair.publicKey);

        try {
            const result = await invokeDevicePairing<{ requestId: string; expiresAt: string }>('create', {
                deviceId: deviceRowId,
                ephemeralPublicKey,
                commitment: remotePairingCommitment(ephemeralPublicKey, nonce),
            });
            requester.requestId = result.requestId;
            return result;
        } catch (error) {
            resetRequester();
            throw error;
        }
    },

    /** Either device: poll for the account's current in-flight request, if any. */
    async status(deviceRowId: string): Promise<PairingStatus> {
        return invokeDevicePairing('status', { deviceId: deviceRowId });
    },

    /**
     * OLD DEVICE: start approving the request it was shown. Call this only
     * after the identity check (PIN / biometrics). Sends a fresh nonce. The
     * key and commitment it was shown are remembered here, before the nonce
     * leaves the device: they are the only ones approve() will accept.
     */
    async challenge(
        deviceRowId: string,
        request: { requestId: string; requestingEphemeralPublicKey: string; requesterCommitment: string }
    ): Promise<void> {
        resetApprover();
        const nonce = randomNonce();
        await invokeDevicePairing('challenge', {
            deviceId: deviceRowId,
            requestId: request.requestId,
            requesterEphemeralPublicKey: request.requestingEphemeralPublicKey,
            requesterCommitment: request.requesterCommitment,
            approverNonce: nonce,
        });
        approver = {
            requestId: request.requestId,
            ephemeralPublicKey: request.requestingEphemeralPublicKey,
            commitment: request.requesterCommitment,
            nonce,
        };
    },

    /**
     * NEW DEVICE: once the status is 'challenged', reveal the nonce and get
     * the 6-digit check value to show. The user types it on the old device.
     */
    async reveal(deviceRowId: string, userId: string, requestId: string, approverNonce: string): Promise<string> {
        if (!requester || requester.requestId !== requestId) {
            throw new Error('No pairing in progress on this device');
        }
        await invokeDevicePairing('reveal', {
            deviceId: deviceRowId,
            requestId,
            requesterNonce: requester.nonce,
        });
        return remotePairingCheck({
            userId,
            requestId,
            ephemeralPublicKey: MessageEncryption.bytesToBase64(requester.keyPair.publicKey),
            approverNonce,
            requesterNonce: requester.nonce,
        });
    },

    /**
     * OLD DEVICE: approve after the user typed the value shown on the new
     * device. `requesterNonce` comes from status (state 'revealed'). If the
     * commitment doesn't open or the value doesn't match, the request is
     * denied and RemotePairingCheckError is thrown; nothing is sealed.
     */
    async approve(
        deviceRowId: string,
        userId: string,
        requesterNonce: string,
        typedCheck: string,
        payload: KeyObject
    ): Promise<{ requestId: string; expiresAt: string }> {
        if (!approver) {
            throw new Error('No pairing request is being approved on this device');
        }
        const { requestId, ephemeralPublicKey, commitment, nonce: approverNonce } = approver;

        // The nonce must open the commitment recorded at challenge time, so the
        // new device (or a server in the middle) couldn't pick it after seeing ours.
        const commitmentOk = verifyRemotePairingCommitment(ephemeralPublicKey, requesterNonce, commitment);
        const matches =
            commitmentOk &&
            remotePairingCheckMatches(
                remotePairingCheck({ userId, requestId, ephemeralPublicKey, approverNonce, requesterNonce }),
                typedCheck
            );
        if (!matches) {
            resetApprover();
            await this.deny(deviceRowId, requestId).catch(() => undefined);
            throw new RemotePairingCheckError();
        }

        const senderEphemeral = MessageEncryption.generateEphemeralKeyPair();
        try {
            const plaintext = new TextEncoder().encode(JSON.stringify(payload));
            const { ciphertext, nonce } = await MessageEncryption.ecdhSeal(
                plaintext,
                MessageEncryption.base64ToBytes(ephemeralPublicKey),
                senderEphemeral.secretKey,
                PAIRING_INFO
            );

            return await invokeDevicePairing('approve', {
                deviceId: deviceRowId,
                requestId,
                senderEphemeralPublicKey: MessageEncryption.bytesToBase64(senderEphemeral.publicKey),
                ciphertext: MessageEncryption.bytesToBase64(ciphertext),
                nonce: MessageEncryption.bytesToBase64(nonce),
            });
        } finally {
            senderEphemeral.secretKey.fill(0);
            resetApprover();
        }
    },

    /** OLD DEVICE: Deny button, or a failed check. Ends the request. */
    async deny(deviceRowId: string, requestId: string): Promise<void> {
        try {
            await invokeDevicePairing('deny', { deviceId: deviceRowId, requestId });
        } finally {
            if (approver?.requestId === requestId) resetApprover();
        }
    },

    /**
     * NEW DEVICE: once status is 'approved', fetch the sealed key material
     * (single-use - the server deletes it on read) and unwrap it locally.
     */
    async fetchAndUnwrap(deviceRowId: string, requestId: string): Promise<KeyObject> {
        if (!requester || requester.requestId !== requestId) {
            throw new Error('No pairing in progress on this device');
        }

        try {
            const { senderEphemeralPublicKey, ciphertext, nonce } = await invokeDevicePairing<{
                senderEphemeralPublicKey: string;
                ciphertext: string;
                nonce: string;
            }>('fetch-key', { deviceId: deviceRowId, requestId });

            const plaintextBytes = await MessageEncryption.ecdhOpen(
                MessageEncryption.base64ToBytes(ciphertext),
                MessageEncryption.base64ToBytes(nonce),
                MessageEncryption.base64ToBytes(senderEphemeralPublicKey),
                requester.keyPair.secretKey,
                PAIRING_INFO
            );

            return JSON.parse(new TextDecoder().decode(plaintextBytes)) as KeyObject;
        } finally {
            resetRequester();
        }
    },

    /** NEW DEVICE: abandon an in-flight request (e.g. user navigates away). */
    async cancel(deviceRowId: string, requestId: string): Promise<void> {
        try {
            await invokeDevicePairing('cancel', { deviceId: deviceRowId, requestId });
        } finally {
            resetRequester();
        }
    },

    reset: resetPairingState,
};
