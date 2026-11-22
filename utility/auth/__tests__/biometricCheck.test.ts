/**
 * When Face ID / fingerprint doesn't work - failed match, locked out, nothing
 * enrolled, or the user taps "Use app PIN" - the result is 'fallback', and the
 * caller shows the app PIN wall. Only a real success skips the wall.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockLocalAuth = {
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async (): Promise<{ success: boolean; error?: string }> => ({ success: true })),
};
// Delegates, because the import below is hoisted above `mockLocalAuth`.
jest.mock('expo-local-authentication', () => ({
  hasHardwareAsync: () => mockLocalAuth.hasHardwareAsync(),
  isEnrolledAsync: () => mockLocalAuth.isEnrolledAsync(),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticateAsync: (options: any) => (mockLocalAuth.authenticateAsync as any)(options),
}));

const mockAsyncStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (key: string) => mockAsyncStorage.get(key) ?? null,
}));

import { biometricCheck, hasChosenBiometrics } from '../biometricCheck';

describe('biometricCheck', () => {
  beforeEach(() => {
    mockLocalAuth.hasHardwareAsync.mockResolvedValue(true);
    mockLocalAuth.isEnrolledAsync.mockResolvedValue(true);
    mockLocalAuth.authenticateAsync.mockResolvedValue({ success: true });
  });

  it('passes on success, with the app PIN (not the device passcode) as the fallback', async () => {
    expect(await biometricCheck('Open Manage Keys')).toBe('ok');
    expect(mockLocalAuth.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: 'Open Manage Keys',
        disableDeviceFallback: true,
        fallbackLabel: 'Use app PIN',
      })
    );
  });

  it.each(['user_cancel', 'user_fallback', 'system_cancel', 'app_cancel', 'authentication_failed', 'lockout', 'not_enrolled'])(
    'falls back to the PIN on %s',
    async (error) => {
      mockLocalAuth.authenticateAsync.mockResolvedValue({ success: false, error });
      expect(await biometricCheck('x')).toBe('fallback');
    }
  );

  it('falls back without hardware, and does not prompt', async () => {
    mockLocalAuth.authenticateAsync.mockClear();
    mockLocalAuth.hasHardwareAsync.mockResolvedValue(false);
    expect(await biometricCheck('x')).toBe('fallback');
    expect(mockLocalAuth.authenticateAsync).not.toHaveBeenCalled();
  });

  it('falls back with nothing enrolled', async () => {
    mockLocalAuth.isEnrolledAsync.mockResolvedValue(false);
    expect(await biometricCheck('x')).toBe('fallback');
  });

  it('falls back if the native module throws', async () => {
    mockLocalAuth.authenticateAsync.mockRejectedValue(new Error('boom'));
    expect(await biometricCheck('x')).toBe('fallback');
  });
});

describe('hasChosenBiometrics', () => {
  beforeEach(() => mockAsyncStorage.clear());

  it('is false when the user skipped Touch ID and Face ID', async () => {
    expect(await hasChosenBiometrics('u1')).toBe(false);
  });

  it('is true when either was turned on, for that account only', async () => {
    mockAsyncStorage.set('touchIDEnabledu1', 'true');
    expect(await hasChosenBiometrics('u1')).toBe(true);
    expect(await hasChosenBiometrics('u2')).toBe(false);
    mockAsyncStorage.set('faceIDEnabledu2', 'true');
    expect(await hasChosenBiometrics('u2')).toBe(true);
  });

  it('is false without a user id', async () => {
    expect(await hasChosenBiometrics('')).toBe(false);
  });
});
