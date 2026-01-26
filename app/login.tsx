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
  AlertDialogBackdrop,
} from '@/components/ui/alert-dialog';
import { Divider } from '@/components/ui/divider';
import { useSession } from '@/utility/session/SessionProvider';
import { MessageEncryption } from '@/utility/securedMessage/secured';

/**
 * Login Screen (Dumb Component)
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
  const router = useRouter();
  const { refreshProfile } = useSession();

  const handleClose = () => setShowAlertDialog(false);

  const handleState = () => {
    setShowPassword((showState) => {
      return !showState;
    });
  };

  const getPublicKey = async (): Promise<string> => {
    const masterKey = await MessageEncryption.generateKeyPair();
    return masterKey.publicKey;
  };

  const signInAsync = async () => {
    if (!email.trim() || !password.trim()) {
      setMessage('Please enter both email and password');
      return;
    }

    setIsLoading(true);
    try {
      const msg = await authAPI.signIn(email, password);
      if (msg?.error) {
        setMessage(msg.error.message);
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
    if (!email.trim() || !password.trim()) {
      setMessage('Please enter both email and password');
      return;
    }

    setIsLoading(true);
    try {
      const public_key = await getPublicKey();
      const msg = await authAPI.signUp(email, password, public_key);
      if (msg?.error) {
        setMessage(msg.error.message);
        MessageEncryption.deletePrivateKey();
      } else if (msg.data?.user) {
        setMessage('Registration successful! Please check your email to verify your account.');
      }
    } catch (error) {
      setMessage('An error occurred during registration. Please try again.');
      MessageEncryption.deletePrivateKey();
      console.error('Registration error:', error);
    } finally {
      setIsLoading(false);
    }
  };

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
          <AlertDialog isOpen={showAlertDialog} onClose={handleClose} size="md">
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
                <Button size="sm" onPress={handleClose}>
                  <ButtonText>Okay</ButtonText>
                </Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <FormControl className="p-4 border border-outline-200 rounded-lg w-full mb-6">
            <Heading className="text-typography-900 mb-2 text-white" size="lg">
              Authentication
            </Heading>
            <VStack className="gap-4">
              <VStack space="lg">
                <Text className="text-typography-500">Email</Text>
                <Input>
                  <InputField
                    type="text"
                    className="text-white"
                    value={email}
                    onChangeText={setEmail}
                    editable={!isLoading}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </Input>
              </VStack>
              <VStack space="lg">
                <Text className="text-typography-500">Password</Text>
                <Input>
                  <InputField
                    type={showPassword ? 'text' : 'password'}
                    className="text-white"
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
                  className="p-0"
                  size="xl"
                  onPress={signUpAsync}
                  disabled={isLoading}
                >
                  <ButtonText>{isLoading ? 'Loading...' : 'Register'}</ButtonText>
                </Button>
              </VStack>
            </VStack>
          </FormControl>
        </Box>
      </Box>
    </Box>
  );
}
