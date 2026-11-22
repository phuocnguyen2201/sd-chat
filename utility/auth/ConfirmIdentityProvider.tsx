import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, Platform } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Button, ButtonText } from '@/components/ui/button';
import { Input, InputField } from '@/components/ui/input';
import { HStack } from '@/components/ui/hstack';
import { VStack } from '@/components/ui/vstack';
import { useSession } from '@/utility/session/SessionProvider';
import { AppPin, isValidPin, MAX_ATTEMPTS, type PinLength } from './AppPin';
import { biometricCheck, hasChosenBiometrics } from './biometricCheck';
import { verifyAccountPassword } from './verifyAccountPassword';

/*
  "Confirm it's you" before a sensitive action (security #21).

  Order: Face ID / fingerprint if the user turned them on (EnableBiometric);
  if that fails, isn't available, or the user taps "Use app PIN", the app PIN
  wall appears; with no PIN yet, the account password (which then offers to
  set up a PIN). Cancelling the wall itself refuses the action. Nothing here is a server-side check: it guards
  against someone holding the unlocked phone, not against a stolen session
  used outside the app.
*/

export type ConfirmOptions = {
  /** Shown in the biometric prompt and the dialog. */
  reason: string;
  /** Ignore the short grace window and always ask. */
  fresh?: boolean;
};

type ConfirmIdentityApi = {
  confirmIdentity: (options: ConfirmOptions) => Promise<boolean>;
  /** Set up a PIN, or change the existing one (asks for the old one first). */
  managePin: () => Promise<boolean>;
};

type Step = 'pin' | 'password' | 'newPin';

type Session = {
  step: Step;
  reason: string;
  // On the new-PIN step: true means skipping it refuses (managing the PIN),
  // false means the user is already confirmed and may skip it.
  newPinRequired: boolean;
  // Why the wall is showing instead of Face ID / fingerprint, if it is.
  notice: string;
  resolve: (ok: boolean) => void;
};

// Passing a check covers the next one for this long, so opening Manage Keys
// and then Share Keys does not ask twice in a row.
const GRACE_MS = 60_000;

const ConfirmIdentityContext = createContext<ConfirmIdentityApi | null>(null);

export function useConfirmIdentity(): ConfirmIdentityApi {
  const api = useContext(ConfirmIdentityContext);
  if (!api) {
    throw new Error('useConfirmIdentity must be used inside ConfirmIdentityProvider');
  }
  return api;
}

export function ConfirmIdentityProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? '';
  const email = user?.email ?? '';

  const lastConfirmedRef = useRef<{ userId: string; at: number } | null>(null);
  const sessionRef = useRef<Session | null>(null);

  const [session, setSession] = useState<Session | null>(null);
  const [pinLength, setPinLength] = useState<PinLength>(4);
  const [value, setValue] = useState('');
  const [repeat, setRepeat] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const resetFields = () => {
    setValue('');
    setRepeat('');
    setError('');
    setBusy(false);
  };

  const finish = useCallback((ok: boolean) => {
    const current = sessionRef.current;
    sessionRef.current = null;
    setSession(null);
    resetFields();
    if (ok && userId) {
      lastConfirmedRef.current = { userId, at: Date.now() };
    }
    current?.resolve(ok);
  }, [userId]);

  const openDialog = useCallback(
    (step: Step, reason: string, newPinRequired: boolean, notice = ''): Promise<boolean> => {
      if (sessionRef.current) {
        // One dialog at a time; a second request while one is open is refused.
        return Promise.resolve(false);
      }
      return new Promise<boolean>((resolve) => {
        const next: Session = { step, reason, newPinRequired, notice, resolve };
        sessionRef.current = next;
        resetFields();
        setSession(next);
      });
    },
    []
  );

  const goTo = (step: Step) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = { ...current, step };
    sessionRef.current = next;
    resetFields();
    setSession(next);
  };

  const confirmIdentity = useCallback(
    async ({ reason, fresh }: ConfirmOptions): Promise<boolean> => {
      if (!userId) return false;

      const last = lastConfirmedRef.current;
      if (!fresh && last && last.userId === userId && Date.now() - last.at < GRACE_MS) {
        return true;
      }

      const chosen = await hasChosenBiometrics(userId);
      if (chosen && (await biometricCheck(reason)) === 'ok') {
        lastConfirmedRef.current = { userId, at: Date.now() };
        return true;
      }

      const length = await AppPin.getLength(userId);
      if (length) setPinLength(length);
      const notice = chosen ? 'Face ID / fingerprint did not work.' : '';
      return openDialog(length ? 'pin' : 'password', reason, false, notice);
    },
    [userId, openDialog]
  );

  const managePin = useCallback(async (): Promise<boolean> => {
    if (!userId) return false;
    const reason = 'Change your app PIN';
    const length = await AppPin.getLength(userId);

    if (!length) {
      setPinLength(4);
      return openDialog('password', 'Set up an app PIN', true);
    }

    setPinLength(length);
    const chosen = await hasChosenBiometrics(userId);
    if (chosen && (await biometricCheck(reason)) === 'ok') {
      return openDialog('newPin', reason, true);
    }
    return openDialog('pin', reason, true, chosen ? 'Face ID / fingerprint did not work.' : '');
  }, [userId, openDialog]);

  const submitPin = async () => {
    const current = sessionRef.current;
    if (!current || busy) return;
    if (!isValidPin(value, pinLength)) {
      setError(`Enter your ${pinLength}-digit PIN.`);
      return;
    }
    setBusy(true);
    const result = await AppPin.verifyPin(userId, value);
    if (result.ok) {
      if (current.newPinRequired) {
        goTo('newPin');
      } else {
        finish(true);
      }
      return;
    }
    if ('locked' in result) {
      goTo('password');
      setError(`Wrong PIN ${MAX_ATTEMPTS} times. The PIN was removed - enter your account password to set a new one.`);
      return;
    }
    setBusy(false);
    setValue('');
    setError(
      result.attemptsLeft === 1
        ? 'Wrong PIN. 1 try left before the PIN is removed.'
        : `Wrong PIN. ${result.attemptsLeft} tries left.`
    );
  };

  const submitPassword = async () => {
    if (!sessionRef.current || busy) return;
    setBusy(true);
    const result = await verifyAccountPassword(email, value);
    if (!result.ok) {
      setBusy(false);
      setError(result.message);
      return;
    }
    goTo('newPin');
  };

  const submitNewPin = async () => {
    if (!sessionRef.current || busy) return;
    if (!isValidPin(value, pinLength)) {
      setError(`The PIN must be exactly ${pinLength} digits.`);
      return;
    }
    if (value !== repeat) {
      setError('The two PINs do not match.');
      return;
    }
    setBusy(true);
    try {
      await AppPin.setPin(userId, value, pinLength);
      finish(true);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : 'Could not save the PIN.');
    }
  };

  const api = useMemo(() => ({ confirmIdentity, managePin }), [confirmIdentity, managePin]);

  const step = session?.step;
  const title = step === 'newPin' ? 'Set up an app PIN' : "Confirm it's you";

  return (
    <ConfirmIdentityContext.Provider value={api}>
      {children}
      <Modal visible={session !== null} transparent animationType="fade" onRequestClose={() => finish(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
          <Box className="flex-1 items-center justify-center px-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
            <VStack space="md" className="w-full max-w-md rounded-2xl bg-white p-6 dark:bg-gray-900">
              <Heading className="text-xl font-semibold text-gray-900 dark:text-gray-100">{title}</Heading>
              {session && <Text className="text-gray-700 dark:text-gray-300">{session.reason}</Text>}
              {session?.notice && step !== 'newPin' ? (
                // red-700 on white and red-400 on gray-900 both clear 4.5:1 (WCAG AA).
                <Text className="text-base font-bold text-red-700 dark:text-red-400">
                  {session.notice} {step === 'pin' ? 'Use your app PIN instead.' : 'Use your account password instead.'}
                </Text>
              ) : null}

              {step === 'pin' && (
                <>
                  <Text className="text-sm text-gray-500">Enter your {pinLength}-digit app PIN.</Text>
                  <Input>
                    <InputField
                      testID="confirm-identity-pin"
                      value={value}
                      onChangeText={(t) => setValue(t.replace(/\D/g, '').slice(0, pinLength))}
                      placeholder="App PIN"
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={pinLength}
                      onSubmitEditing={submitPin}
                    />
                  </Input>
                </>
              )}

              {step === 'password' && (
                <>
                  <Text className="text-sm text-gray-500">Enter your account password.</Text>
                  <Input>
                    <InputField
                      testID="confirm-identity-password"
                      value={value}
                      onChangeText={setValue}
                      placeholder="Account password"
                      secureTextEntry
                      autoCapitalize="none"
                      autoCorrect={false}
                      onSubmitEditing={submitPassword}
                    />
                  </Input>
                </>
              )}

              {step === 'newPin' && (
                <>
                  <Text className="text-sm text-gray-500">
                    Used when Face ID or fingerprint is not available. After {MAX_ATTEMPTS} wrong
                    tries it is removed and your password is needed again.
                  </Text>
                  <HStack space="sm">
                    {([4, 6] as const).map((len) => (
                      <Button
                        key={len}
                        size="sm"
                        variant={pinLength === len ? 'solid' : 'outline'}
                        action={pinLength === len ? 'primary' : 'secondary'}
                        className={pinLength === len ? 'bg-blue-500' : ''}
                        onPress={() => {
                          setPinLength(len);
                          setValue('');
                          setRepeat('');
                          setError('');
                        }}
                      >
                        <ButtonText>{len} digits</ButtonText>
                      </Button>
                    ))}
                  </HStack>
                  <Input>
                    <InputField
                      testID="confirm-identity-new-pin"
                      value={value}
                      onChangeText={(t) => setValue(t.replace(/\D/g, '').slice(0, pinLength))}
                      placeholder="New PIN"
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={pinLength}
                    />
                  </Input>
                  <Input>
                    <InputField
                      testID="confirm-identity-repeat-pin"
                      value={repeat}
                      onChangeText={(t) => setRepeat(t.replace(/\D/g, '').slice(0, pinLength))}
                      placeholder="Repeat new PIN"
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={pinLength}
                      onSubmitEditing={submitNewPin}
                    />
                  </Input>
                </>
              )}

              {error !== '' && <Text className="text-sm text-red-500">{error}</Text>}

              <HStack space="sm" className="justify-end">
                <Button
                  variant="outline"
                  action="secondary"
                  size="sm"
                  onPress={() => finish(step === 'newPin' && !session?.newPinRequired)}
                >
                  <ButtonText>{step === 'newPin' && !session?.newPinRequired ? 'Not now' : 'Cancel'}</ButtonText>
                </Button>
                <Button
                  size="sm"
                  className="bg-blue-500"
                  isDisabled={busy}
                  onPress={step === 'pin' ? submitPin : step === 'password' ? submitPassword : submitNewPin}
                >
                  <ButtonText className="text-white">
                    {busy ? 'Checking…' : step === 'newPin' ? 'Save PIN' : 'Continue'}
                  </ButtonText>
                </Button>
              </HStack>

              {step === 'pin' && (
                <Button variant="link" size="sm" onPress={() => goTo('password')}>
                  <ButtonText>Forgot PIN? Use password</ButtonText>
                </Button>
              )}
            </VStack>
          </Box>
        </KeyboardAvoidingView>
      </Modal>
    </ConfirmIdentityContext.Provider>
  );
}
