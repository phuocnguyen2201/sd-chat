
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { useState, useEffect } from 'react';
import { supabase } from '../utility/connection';
import { Session } from '@supabase/supabase-js';
import { Box } from '@/components/ui/box';
import { FormControl} from '@/components/ui/form-control';
import { VStack } from '@/components/ui/vstack';
import { Input, InputField } from '@/components/ui/input';
import { Button, ButtonText } from '@/components/ui/button';
import { authAPI, profileAPI } from '@/utility/messages';
import { router } from 'expo-router';
import { Divider } from '@/components/ui/divider';
import { UserProfile } from '@/utility/types/supabse';
import { Pressable } from 'react-native';
export default function CompleteProfile() {

  const [session, setSession] = useState<Session | null>(null)
  const [displayName, setDisplayName] = useState<string>('');
  const AVATARS = ['😀', '😎', '🤩', '😊', '🥳', '😇', '🤗', '😋', '😜', '🤔'];
  const [selectedIcon, setSelectedIcon] = useState<string>(AVATARS[0]);

  async function updateAvatar(icon: string) {

      try {
        setSelectedIcon(icon);

      } catch (e) {

        console.warn(e);
      } finally {

      }
    }
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
    supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    console.log(session);
  }, [])
  return (
    <Box className="flex-1 bg-background-900 h-[100vh]">
      <Box className="absolute h-[500px] w-[500px] lg:w-[700px] lg:h-[700px]">

        </Box>
         <Box className="flex flex-1 items-center mx-5 lg:my-24 lg:mx-32 py-safe">
                  <Box className="flex-1 justify-center items-center h-auto w-[300px] lg:h-auto lg:w-[400px]">
         <FormControl className="p-4 border border-outline-200 rounded-lg w-full mb-6">
            <Heading className="text-typography-900 mb-2 text-white" size="lg">Complete the profile</Heading>
            <VStack className="gap-4">
              <VStack space="lg">
                <Text className="text-typography-500">Display Name</Text>
                <Input>
                  <InputField type="text" className="text-white" value={displayName} onChangeText={setDisplayName} />
                </Input>
                <Box className="flex-row flex-wrap justify-between gap-2 mt-4">
                  {AVATARS.map((avatar) => (
                    <Pressable
                      key={avatar}
                      onPress={() => updateAvatar(avatar)}
                      className={`p-3 rounded-full border-2 ${selectedIcon === avatar ? 'bg-blue-500 border-blue-600' : 'bg-gray-100 border-gray-200'}`}
                    >
                      <Text className="text-3xl">{avatar}</Text>
                    </Pressable>
                  ))}
                </Box>
              </VStack>
           
              <VStack>
                <Button className="p-0" size='xl'  
                    onPress={async () => {
                      const profile = {
                        displayname: displayName,
                        avatar_url: selectedIcon
                      };

                      (await profileAPI.updateProfile(session?.user.id as string, profile));
                       router.replace({
                         pathname: '/tabs/(tabs)/Chat',
                         params: { email: session?.user?.email || '' },
                       })
                    }}>
                <ButtonText>Save</ButtonText>
              </Button></VStack>

              <Divider className="my-0.5 mb-4" />

              <VStack>
                <Button className="p-0" size='xl'  
                    onPress={() => {
                       router.push('/');
                    }}>
                <ButtonText>Back to Home</ButtonText>
              </Button></VStack>
            </VStack>
          </FormControl>
        {/* </ScrollView> */}
        </Box>
      </Box>
    </Box>
  );
}
