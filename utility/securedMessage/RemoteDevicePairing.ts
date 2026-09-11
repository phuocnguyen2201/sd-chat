import { supabase } from '@/utility/connection';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { KeyObject } from '@/utility/types/user';

// Domain-separation string for this transport. Deliberately distinct from
// the local QR flow's 'sd-chat-device-pairing-v1' (DevicePairing.ts) even
// though both are ECDH+HKDF+AEAD over fresh ephemeral keys - keeps the two
// flows' derived keys unambiguous from each other in case either is ever
// extended to accept cross-transport payloads.
const PAIRING_INFO = 'sd-chat-remote-device-pairing-v1';

export type PairingStatus =
    | { active: false }
    | {
          active: true;
          requestId: string;
          status: 'pending' | 'code_issued' | 'approved';
          requestingDeviceId: string;
          requestingDeviceName: string;
          requestingEphemeralPublicKey: string;
          isMine?: boolean;
          expiresAt: string;
      };

// The new device's ephemeral secret key lives only here, in memory, for
// the duration of one pairing attempt - never persisted, never sent
// anywhere. Cleared on completion, cancel, or error.
let ephemeralKeyPair: { publicKey: Uint8Array; secretKey: Uint8Array } | null = null;

function resetPairingState(): void {
    if (ephemeralKeyPair) {
        ephemeralKeyPair.secretKey.fill(0);
        ephemeralKeyPair = null;
    }
}

async function invoke<T>(action: string, payload: Record<string, unknown>): Promise<T> {
    const { data, error } = await supabase.functions.invoke('device-pairing', {
        body: { action, ...payload },
    });

    if (error) {
        let message = error.message ?? 'Request failed';
        const context = (error as { context?: { json?: () => Promise<{ error?: string }> } }).context;
        if (context?.json) {
            try {
                const body = await context.json();
                if (body?.error) {
                    message = body.error;
                }
            } catch {
                // fall back to error.message below
            }
        }
        throw new Error(message);
    }

    if (data && typeof data === 'object' && 'error' in data && data.error) {
        throw new Error(String((data as { error: unknown }).error));
    }

    return data as T;
}

export const RemoteDevicePairing = {
    /**
     * NEW DEVICE: register a pairing request. Generates and holds an
     * ephemeral key pair in memory for the lifetime of this attempt.
     */
    async createRequest(deviceRowId: string): Promise<{ requestId: string; expiresAt: string }> {
        resetPairingState();
        ephemeralKeyPair = MessageEncryption.generateEphemeralKeyPair();

        return invoke('create', {
            deviceId: deviceRowId,
            ephemeralPublicKey: MessageEncryption.bytesToBase64(ephemeralKeyPair.publicKey),
        });
    },

    /** Either device: poll for the account's current in-flight request, if any. */
    async status(deviceRowId: string): Promise<PairingStatus> {
        return invoke('status', { deviceId: deviceRowId });
    },

    /**
     * OLD DEVICE: approve a pending request. Seals `payload` to the
     * requester's ephemeral public key locally before it ever leaves this
     * device, then asks the server for a one-time code to display.
     */
    async approve(
        deviceRowId: string,
        requesterEphemeralPublicKeyBase64: string,
        payload: KeyObject
    ): Promise<{ requestId: string; code: string; expiresAt: string }> {
        const senderEphemeral = MessageEncryption.generateEphemeralKeyPair();
        try {
            const plaintext = new TextEncoder().encode(JSON.stringify(payload));
            const peerPublicKey = MessageEncryption.base64ToBytes(requesterEphemeralPublicKeyBase64);

            const { ciphertext, nonce } = await MessageEncryption.ecdhSeal(
                plaintext,
                peerPublicKey,
                senderEphemeral.secretKey,
                PAIRING_INFO
            );

            return await invoke('approve', {
                deviceId: deviceRowId,
                senderEphemeralPublicKey: MessageEncryption.bytesToBase64(senderEphemeral.publicKey),
                ciphertext: MessageEncryption.bytesToBase64(ciphertext),
                nonce: MessageEncryption.bytesToBase64(nonce),
            });
        } finally {
            senderEphemeral.secretKey.fill(0);
        }
    },

    /**
     * NEW DEVICE: submit the code read off the old device. This is a
     * single-shot check server-side - a wrong code ends the request and a
     * fresh one must be created.
     */
    async confirm(deviceRowId: string, requestId: string, code: string): Promise<{ status: 'approved' | 'denied' }> {
        return invoke('confirm', { deviceId: deviceRowId, requestId, code });
    },

    /**
     * NEW DEVICE: once status is 'approved', fetch the sealed key material
     * (single-use - the server deletes it on read) and unwrap it locally.
     */
    async fetchAndUnwrap(deviceRowId: string, requestId: string): Promise<KeyObject> {
        if (!ephemeralKeyPair) {
            throw new Error('No pairing in progress on this device');
        }

        try {
            const { senderEphemeralPublicKey, ciphertext, nonce } = await invoke<{
                senderEphemeralPublicKey: string;
                ciphertext: string;
                nonce: string;
            }>('fetch-key', { deviceId: deviceRowId, requestId });

            const plaintextBytes = await MessageEncryption.ecdhOpen(
                MessageEncryption.base64ToBytes(ciphertext),
                MessageEncryption.base64ToBytes(nonce),
                MessageEncryption.base64ToBytes(senderEphemeralPublicKey),
                ephemeralKeyPair.secretKey,
                PAIRING_INFO
            );

            return JSON.parse(new TextDecoder().decode(plaintextBytes)) as KeyObject;
        } finally {
            resetPairingState();
        }
    },

    /** NEW DEVICE: abandon an in-flight request (e.g. user navigates away). */
    async cancel(deviceRowId: string, requestId: string): Promise<void> {
        try {
            await invoke('cancel', { deviceId: deviceRowId, requestId });
        } finally {
            resetPairingState();
        }
    },

    reset: resetPairingState,
};
