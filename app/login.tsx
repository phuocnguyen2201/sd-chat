import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Pressable } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Button, ButtonText } from '@/components/ui/button';
import { useFocusEffect, useRouter } from 'expo-router';
import { FormControl } from '@/components/ui/form-control';
import { VStack } from '@/components/ui/vstack';
import { Heading } from '@/components/ui/heading';
import { EyeIcon, EyeOffIcon } from '@/components/ui/icon';
import { authAPI } from '../utility/messages';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogBody,
} from '@/components/ui/alert-dialog';
import { Divider } from '@/components/ui/divider';
import { useSession } from '@/utility/session/SessionProvider';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { automationLocatorsDataState } from '@/constants/automationLocatorsDataState';
import { inputFocusClassName } from '@/constants/inputStyles';
import { supabase } from '@/utility/connection';
import { RememberedAccounts, type AccountCard } from '@/utility/auth/RememberedAccounts';
import { useConfirmIdentity } from '@/utility/auth/ConfirmIdentityProvider';
import { usePushNotifications } from '@/utility/push-notification/push-Notification';
import { RememberedAccountsPanel } from '@/components/RememberedAccountsPanel';
const EMAIL_NOT_CONFIRMED = 'email_not_confirmed';
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Only enforced on sign-up; older accounts may have weaker passwords. Mirrors
// the project's Auth policy (length + lower/upper/digit/symbol) so users get a
// readable message instead of the server's character list.
const MIN_PASSWORD_LENGTH = 8;
const RESEND_COOLDOWN_SECONDS = 60;
const SIGN_UP_SENT_MESSAGE =
  "Registration received! If this email can be registered, we've sent a confirmation link to it. Open the link, then come back and log in.";
const PASSWORD_RULES: { test: RegExp; label: string }[] = [
  { test: /[a-z]/, label: 'a lowercase letter' },
  { test: /[A-Z]/, label: 'an uppercase letter' },
  { test: /[0-9]/, label: 'a number' },
  { test: /[^A-Za-z0-9]/, label: 'a symbol' },
];

function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  const missing = PASSWORD_RULES.filter((rule) => !rule.test.test(password)).map((rule) => rule.label);
  return missing.length ? `Password must include ${missing.join(', ')}` : null;
}

/**
 * Login Screen
 * 
 * This screen only handles UI and authentication.
 * Navigation is handled by Bootstrap screen after successful login.
 */
export default function Login() {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [showAlertDialog, setShowAlertDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Email waiting for confirmation; shows the resend button.
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);
  const router = useRouter();
  const { refreshProfile } = useSession();
  const { confirmIdentity } = useConfirmIdentity();

  // Remembered accounts. The form is hidden while there are any, until the
  // user asks for it with "Sign in to another account" / "Create account".
  const [accounts, setAccounts] = useState<AccountCard[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [busyUserId, setBusyUserId] = useState<string | null>(null);
  // The card whose session is gone: the password box, email filled in.
  const [passwordFor, setPasswordFor] = useState<AccountCard | null>(null);
  const [cardPassword, setCardPassword] = useState('');
  const [cardError, setCardError] = useState('');
  const [cardBusy, setCardBusy] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      setAccounts(await RememberedAccounts.list());
    } catch (error) {
      console.warn('Could not load remembered accounts:', error);
      setAccounts([]);
    } finally {
      setAccountsLoaded(true);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadAccounts();
    }, [loadAccounts])
  );

  const formVisible = accountsLoaded && (accounts.length === 0 || showForm);

  const currentUserId = async (): Promise<string | null> =>
    (await supabase.auth.getSession()).data.session?.user?.id ?? null;

  /*
    Before another account takes over this device, stop the current one's
    pushes here (needs its session, so it has to come first).
  */
  const releaseCurrentAccount = async (nextUserId: string): Promise<string | null> => {
    const current = await currentUserId();
    if (current && current !== nextUserId) {
      await usePushNotifications.deactivateThisDevice(current);
      return current;
    }
    return null;
  };

  const goIn = async () => {
    await refreshProfile();
    router.replace('/Bootstrap');
  };

  const openPasswordBox = (account: AccountCard) => {
    setCardPassword('');
    setCardError('');
    setPasswordFor(account);
  };

  /*
    Tapping a card. With a saved session: the account's Face ID / fingerprint,
    else its app PIN (password as the last resort), then straight in - no
    password. Without one (signed out, or the session was rejected): the
    password box with the email filled in.
  */
  const selectAccount = async (account: AccountCard) => {
    if (busyUserId) return;
    setBusyUserId(account.userId);
    let released: string | null = null;
    let signedIn = false;
    try {
      const active = await currentUserId();
      if (!account.hasSession && active !== account.userId) {
        openPasswordBox(account);
        return;
      }

      released = await releaseCurrentAccount(account.userId);
      const confirmed = await confirmIdentity({
        reason: `Sign in as ${account.displayName || account.email}`,
        fresh: true,
        account: { userId: account.userId, email: account.email },
      });
      if (!confirmed) return;

      // The password fallback inside the wall may have signed it in already.
      if ((await currentUserId()) === account.userId) {
        signedIn = true;
        await goIn();
        return;
      }

      const result = await RememberedAccounts.restore(account.userId);
      if (result === 'ok') {
        signedIn = true;
        await goIn();
      } else if (result === 'needs_password') {
        openPasswordBox({ ...account, hasSession: false });
      } else {
        setMessage("You're offline. Check the connection and try again.");
      }
    } catch (error) {
      console.warn('Could not open the account:', error);
      setMessage('Could not sign in to this account. Please try again.');
    } finally {
      if (released && !signedIn && (await currentUserId()) === released) {
        // Still the previous account: give it its pushes back.
        await usePushNotifications.reactivateThisDevice(released);
      }
      setBusyUserId(null);
      loadAccounts();
    }
  };

  const submitCardPassword = async () => {
    if (!passwordFor || cardBusy) return;
    if (!cardPassword) {
      setCardError('Enter your password.');
      return;
    }
    setCardBusy(true);
    setCardError('');
    const released = await releaseCurrentAccount(passwordFor.userId);
    try {
      const msg = await authAPI.signIn(passwordFor.email, cardPassword);
      if (msg?.error) {
        setCardError(
          (msg.error as { code?: string }).code === EMAIL_NOT_CONFIRMED
            ? 'Please confirm your email first, then try again.'
            : msg.error.message
        );
        if (released) await usePushNotifications.reactivateThisDevice(released);
        return;
      }
      setPasswordFor(null);
      setCardPassword('');
      await goIn();
    } finally {
      setCardBusy(false);
    }
  };

  const removeAccount = async (account: AccountCard) => {
    await RememberedAccounts.remove(account.userId);
    await loadAccounts();
  };

  /*
    No theme branching on this screen. gluestack's scales are mirrored - what
    `typography-100` and `background-900` resolve to in one theme is what the
    other resolves to in the other - so the pairing used below reads correctly
    in both without being told which one is active.
  */
  const inputClassName = ['my-1', inputFocusClassName].join(' ');

  const handleClose = () => setShowAlertDialog(false);

  const handleState = () => {
    setShowPassword((showState) => {
      return !showState;
    });
  };

  const signInAsync = async () => {
    if (!email.trim() || !password.trim()) {
      setMessage('Please enter both email and password');
      return;
    }

    setIsLoading(true);
    try {
      const active = await currentUserId();
      if (active) await usePushNotifications.deactivateThisDevice(active);
      const msg = await authAPI.signIn(email.trim(), password);
      if (msg?.error) {
        if ((msg.error as { code?: string }).code === EMAIL_NOT_CONFIRMED) {
          setPendingEmail(email.trim());
          setMessage(
            'Please confirm your email first. Open the link we sent you, then log in again. You can request a new link below.'
          );
        } else {
          setMessage(msg.error.message);
        }
      } else if (msg.data?.user) {
        // Refresh profile to update session state
        await refreshProfile();
        // Navigate to Bootstrap which will handle routing based on profile completion
        router.replace('/Bootstrap');
      }
    } catch (error) {
      setMessage('An error occurred during login. Please try again.');
      console.error('Login error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const signUpAsync = async () => {
    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password.trim()) {
      setMessage('Please enter both email and password');
      return;
    }
    if (!EMAIL_PATTERN.test(trimmedEmail)) {
      setMessage('Please enter a valid email address');
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      setMessage(problem);
      return;
    }

    setIsLoading(true);
    try {
      const masterKey = await MessageEncryption.generateKeyPair();
      const msg = await authAPI.signUp(trimmedEmail, password, masterKey.publicKey);
      if (msg?.error) {
        setMessage(msg.error.message);
      } else if (msg.data?.user) {
        /*
          The account exists now, so the private key finally has a user id to be
          filed under. Nothing is persisted before this point, which is why a
          failed sign-up no longer has to clean a key up. An already-registered
          email comes back as a fake user (isNewUser false): no key for that id.
          Registering again before confirming returns the same real user, whose
          profile already holds the first public key - keep the first private key.
        */
        if (msg.data.isNewUser && !MessageEncryption.getPrivateKey(msg.data.user.id)) {
          MessageEncryption.setPrivateKey(
            msg.data.user.id,
            MessageEncryption.base64ToBytes(masterKey.privateKey)
          );
        }
        if (msg.data.hasSession) {
          // Email confirmation is off: already signed in.
          await refreshProfile();
          router.replace('/Bootstrap');
          return;
        }
        /*
          Same wording whether or not the email was already registered, so the
          form can't be used to find out who has an account.
        */
        setPendingEmail(trimmedEmail);
        startResendCooldown();
        setMessage(SIGN_UP_SENT_MESSAGE);
      }
    } catch (error) {
      setMessage('An error occurred during registration. Please try again.');
      console.error('Registration error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const startResendCooldown = () => setResendCooldown(RESEND_COOLDOWN_SECONDS);

  const resendAsync = async () => {
    if (!pendingEmail || resendCooldown > 0) return;

    setIsLoading(true);
    try {
      const result = await authAPI.resendConfirmation(pendingEmail);
      startResendCooldown();
      setMessage(
        result.error
          ? 'Could not send a new link right now. Please wait a moment and try again.'
          : 'If this email is waiting for confirmation, a new link is on its way.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  useEffect(() => {
    if (message) {
      setShowAlertDialog(true);
    }
  }, [message]);

  return (
    <Box className="flex-1 bg-background-900 h-[100vh]">
      <Box className="absolute lg:w-[700px] lg:h-[700px]"></Box>
      <Box className="flex flex-1 items-center mx-5 lg:my-24 lg:mx-32 py-safe">
        <Box className="flex-1 justify-center items-center h-auto w-[300px] lg:h-auto lg:w-[400px]">
          <AlertDialog testID={automationLocatorsDataState.loginScreen.notificationDialog} isOpen={showAlertDialog} onClose={handleClose} size="md">
            <AlertDialogContent>
              <AlertDialogHeader>
                <Heading className="text-typography-950 font-semibold" size="md">
                  Notification
                </Heading>
              </AlertDialogHeader>
              <AlertDialogBody>
                <Text size="sm">{message}</Text>
              </AlertDialogBody>
              <AlertDialogFooter>
                <Button
                  variant="outline"
                  action="secondary"
                  onPress={handleClose}
                  size="sm"
                >
                  <ButtonText>Cancel</ButtonText>
                </Button>
                <Button testID={automationLocatorsDataState.loginScreen.acceptButton} size="sm" onPress={handleClose}>
                  <ButtonText>Okay</ButtonText>
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          {accountsLoaded && accounts.length > 0 && !showForm && (
            <RememberedAccountsPanel
              accounts={accounts}
              busyUserId={busyUserId}
              onSelect={selectAccount}
              onRemove={removeAccount}
              onSignIn={() => setShowForm(true)}
              onSignUp={() => setShowForm(true)}
            />
          )}

          {formVisible && (
          <FormControl className="p-4 border border-outline-200 rounded-lg w-full mb-6">
            <Heading className="text-typography-100" size="lg">
              Authentication
            </Heading>
            <VStack className="gap-4">
              <VStack space="lg">
                <Text className="text-typography-100">Email</Text>

                <Input className={inputClassName}>
                  <InputField
                    accessibilityLabel="email input field"
                    testID={automationLocatorsDataState.loginScreen.emailInput}
                    type="text"
                    placeholder="Enter your email"
                    className="text-typography-100"
                    value={email}
                    onChangeText={setEmail}
                    editable={!isLoading}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </Input>
              </VStack>
              <VStack space="lg">
                <Text className="text-typography-100">Password</Text>
                <Input className={inputClassName}>
                  <InputField
                    testID={automationLocatorsDataState.loginScreen.passwordInput}
                    accessibilityLabel="password input field"
                    placeholder="Enter your password"
                    type={showPassword ? 'text' : 'password'}
                    className="text-typography-100"
                    value={password}
                    onChangeText={setPassword}
                    editable={!isLoading}
                    secureTextEntry={!showPassword}
                  />
                  <InputSlot className="pr-3" onPress={handleState}>
                    <InputIcon as={showPassword ? EyeIcon : EyeOffIcon} />
                  </InputSlot>
                </Input>
              </VStack>

              <VStack>
                <Button
                  testID={automationLocatorsDataState.loginScreen.signInButton}
                  className="p-0"
                  size="xl"
                  onPress={signInAsync}
                  disabled={isLoading}
                >
                  <ButtonText>{isLoading ? 'Loading...' : 'Login'}</ButtonText>
                </Button>
              </VStack>
              <Divider className="my-0.5 mb-4" />
              <VStack>
                <Button
                  testID={automationLocatorsDataState.loginScreen.registerButton}
                  className="p-0"
                  size="xl"
                  onPress={signUpAsync}
                  disabled={isLoading}
                >
                  <ButtonText>{isLoading ? 'Loading...' : 'Register'}</ButtonText>
                </Button>
              </VStack>
              {pendingEmail && (
                <VStack>
                  <Button
                    testID={automationLocatorsDataState.loginScreen.resendButton}
                    className="p-0"
                    size="md"
                    variant="outline"
                    onPress={resendAsync}
                    disabled={isLoading || resendCooldown > 0}
                  >
                    <ButtonText>
                      {resendCooldown > 0
                        ? `Resend confirmation email (${resendCooldown}s)`
                        : 'Resend confirmation email'}
                    </ButtonText>
                  </Button>
                </VStack>
              )}
              {accounts.length > 0 && (
                <Pressable
                  testID={automationLocatorsDataState.loginScreen.backToAccountsLink}
                  onPress={() => setShowForm(false)}
                  hitSlop={8}
                  className="items-center"
                >
                  <Text className="text-typography-100 font-semibold">Back to saved accounts</Text>
                </Pressable>
              )}
            </VStack>
          </FormControl>
          )}

          <Modal visible={passwordFor !== null} transparent animationType="fade" onRequestClose={() => setPasswordFor(null)}>
            <Box className="flex-1 items-center justify-center px-6" style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
              <VStack space="md" className="w-full max-w-md rounded-2xl bg-background-0 p-6">
                <Heading className="text-typography-950 font-semibold" size="md">
                  {passwordFor?.displayName || 'Sign in'}
                </Heading>
                <Text size="sm">Your session ended. Enter the password for {passwordFor?.email}.</Text>
                <Input>
                  <InputField
                    testID={automationLocatorsDataState.loginScreen.accountPasswordInput}
                    placeholder="Password"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    value={cardPassword}
                    onChangeText={setCardPassword}
                    onSubmitEditing={submitCardPassword}
                  />
                </Input>
                {cardError !== '' && <Text className="text-sm text-red-500">{cardError}</Text>}
                <VStack className="mt-0 flex-row justify-end" style={{ gap: 8 }}>
                  <Button variant="outline" action="secondary" size="sm" onPress={() => setPasswordFor(null)}>
                    <ButtonText>Cancel</ButtonText>
                  </Button>
                  <Button
                    testID={automationLocatorsDataState.loginScreen.accountPasswordSubmit}
                    size="sm"
                    onPress={submitCardPassword}
                    isDisabled={cardBusy}
                  >
                    <ButtonText>{cardBusy ? 'Signing in…' : 'Login'}</ButtonText>
                  </Button>
                </VStack>
              </VStack>
            </Box>
          </Modal>
        </Box>
      </Box>
    </Box>
  );
}
