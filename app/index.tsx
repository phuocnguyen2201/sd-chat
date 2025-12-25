import React, { use, useEffect, useState } from 'react';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField, InputIcon, InputSlot } from '@/components/ui/input';
import { Button, ButtonText } from '@/components/ui/button';
import { useRouter } from 'expo-router';
import { FormControl} from '@/components/ui/form-control';
import { VStack } from '@/components/ui/vstack';
import { Heading } from '@/components/ui/heading';
import { EyeIcon, EyeOffIcon } from '@/components/ui/icon';
import { authAPI }  from '../utility/messages';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogBody,
  AlertDialogBackdrop,
} from '@/components/ui/alert-dialog';
import { Divider } from '@/components/ui/divider';
import { useUser } from '@/utility/session/UserContext';

export default function Home() {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [message, setMessage] = useState<string>('');
  const [showPassword, setShowPassword] = useState(false);
  const [showAlertDialog, setShowAlertDialog] = useState(false);
  const router = useRouter();
  const { user, profile, refreshProfile } = useUser();
  const handleClose = () => setShowAlertDialog(false);
    const handleState = () => {
      setShowPassword((showState) => {
        return !showState;
      });
    };

    useEffect(() => {
      if (message) {
        setShowAlertDialog(true);
      }
    }, [message]);
 
  return (
    <Box className="flex-1 bg-background-900 h-[100vh]">
        <Box className="absolute lg:w-[700px] lg:h-[700px]">

        </Box>
      {/* <ScrollView
        style={{ height: '100%' }}
        contentContainerStyle={{ flexGrow: 1 }}
      > */}
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
                  <Text size="sm">
                    {message}
                  </Text>
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
            <Heading className="text-typography-900 mb-2 text-white" size="lg">Authentication</Heading>
            <VStack className="gap-4">
              <VStack space="lg">
                <Text className="text-typography-500">Email</Text>
                <Input>
                  <InputField type="text" className="text-white" value={email} onChangeText={setEmail} />
                </Input>
              </VStack>
              <VStack space="lg">
                <Text className="text-typography-500">Password</Text>
                <Input>
                  <InputField type={showPassword ? 'text' : 'password'} className="text-white" value={password} onChangeText={setPassword} />
                  <InputSlot className="pr-3" onPress={handleState}>
                    <InputIcon as={showPassword ? EyeIcon : EyeOffIcon} />
                  </InputSlot>
                </Input>
              </VStack>
           
              <VStack>
                <Button className="p-0" size='xl'  
                    onPress={async () => {
                      
                        const msg = await authAPI.signIn(email, password);
                        if(msg?.error){
                          setMessage(msg.error.message);
                        }
                        else if(msg.data?.user) {
                          const data = await authAPI.getProfileUser( msg.data.user.id);
                          if (!data?.data?.displayname) {
                            router.replace('/CompleteProfile');
                          }
                          else{
                            router.replace({
                              pathname: '/tabs/(tabs)/Chat',
                            })
                          }
                        }
                      }}>
                <ButtonText>Login</ButtonText>
              </Button></VStack>
                <Divider className="my-0.5 mb-4" />
              <VStack>
                <Button className="p-0" size='xl'  
                    onPress={async () => {
                        const msg = await authAPI.signUp(email, password,'');
                        if(msg?.error){
                          setMessage(msg.error.message);
                        }
                        else if(msg.data?.user){
                          setMessage('Registration successful! Please check your email to verify your account.');
                        }
                      }}>
                <ButtonText>Register</ButtonText>
              </Button></VStack>
                            

            </VStack>
          </FormControl>
          </Box>
        </Box>
      {/* </ScrollView> */}
    </Box>
  );
}
