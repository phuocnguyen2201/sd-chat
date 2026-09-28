import { invokeDevicePairing } from '@/utility/securedMessage/DevicePairingFunctionClient';

/**
 * Client for the local (same-room) pairing code gate: a short 4-digit
 * code, shown on the old device after biometric auth and entered on the
 * new device, that must be confirmed before the key QR (ManageKeys /
 * ScanningKeys) is shown. It also carries the new device's one-time public
 * key, which that QR is sealed to (LocalKeyTransfer.ts) - never a secret. See
 * the `local-code-*` actions in supabase/functions/device-pairing.
 */

export type LocalCodeStatus =
    | { active: false }
    | {
          active: true;
          codeId: string;
          status: 'pending' | 'verified';
          expiresAt: string;
          lockedUntil: string | null;
          attempts: number;
          verifiedByDeviceName: string | null;
          /** Set once verified: the new device's one-time public key and its code-bound HMAC (base64). */
          requesterEphemeralPublicKey: string | null;
          requesterKeyProof: string | null;
      };

export type LocalCodeVerifyResult =
    | { verified: true }
    | { verified: false; locked: true; retryAfterSeconds: number }
    | { verified: false; locked?: false; attemptsRemaining: number };

export const LocalPairingCode = {
    /** OLD DEVICE: generate a fresh 4-digit code to display. */
    async create(deviceRowId: string): Promise<{ codeId: string; code: string; expiresAt: string }> {
        return invokeDevicePairing('local-code-create', { deviceId: deviceRowId });
    },

    /** Either device: poll the account's current code state (e.g. the old device watching for verification). */
    async status(): Promise<LocalCodeStatus> {
        return invokeDevicePairing('local-code-status', {});
    },

    /**
     * NEW DEVICE: submit the digits read off the old device's screen, with the
     * public half of this device's one-time pairing key and the proof binding
     * it to those digits (LocalKeyTransfer.computeKeyProof). The old device
     * seals the key QR to that key.
     */
    async verify(
        deviceRowId: string,
        code: string,
        ephemeralPublicKey: string,
        keyProof: string
    ): Promise<LocalCodeVerifyResult> {
        return invokeDevicePairing('local-code-verify', { deviceId: deviceRowId, code, ephemeralPublicKey, keyProof });
    },

    /** OLD DEVICE: Cancel button - invalidate the code immediately. */
    async cancel(deviceRowId: string): Promise<void> {
        await invokeDevicePairing('local-code-cancel', { deviceId: deviceRowId });
    },
};
