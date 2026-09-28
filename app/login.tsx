import React, { useState, useEffect } from 'react';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Button, ButtonText } from '@/components/ui/button';
import { useRouter } from 'expo-router';
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
              <AlertDialogBody className="mt-3 mb-4">
                <Text size="sm">{message}</Text>
              </AlertDialogBody>
              <AlertDialogFooter className="">
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
            </VStack>
          </FormControl>
        </Box>
      </Box>
    </Box>
  );
}
