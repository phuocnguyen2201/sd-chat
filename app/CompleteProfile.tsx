
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
import { Spinner } from '@/components/ui/spinner';

import { Avatar, AvatarFallbackText, AvatarImage, AvatarBadge } from '@/components/ui/avatar';
import { handleDeviceFilePath, storageAPIs } from '@/utility/handleStorage';
import {
  Actionsheet,
  ActionsheetContent,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
} from '@/components/ui/actionsheet';

export default function CompleteProfile() {

  const [session, setSession] = useState<Session | null>(null)
  const [displayName, setDisplayName] = useState<string>('');
  
  const [avatar, setAvatar] = useState<string>('');

  const [showActionsheet, setShowActionsheet] = useState<boolean>(false);

  async function pickImage() {
    const result = await handleDeviceFilePath.pickImageFromAlbumOrGallery();
    if (result != null)
    { 

      storageAPIs.uploadAvatarToSupabase(result.uri, result.fileName, (await supabase.auth.getUser()).data.user?.id || '')
      .finally(async () => {
        setShowActionsheet(false);
        const response = await authAPI.getProfileUser();
        setAvatar(response.data?.avatar_url || '');
      });
    }
    
  }

  async function takePicture() {
    const result =  await handleDeviceFilePath.takePicture();
    if (result != null)
    { 

      storageAPIs.uploadAvatarToSupabase(result.uri, result.fileName, (await supabase.auth.getUser()).data.user?.id || '')
      .finally(async () => {
        const response = await authAPI.getProfileUser();
        setAvatar(response.data?.avatar_url || '');
      });
    }
    setShowActionsheet(false);    
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
    })
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

                <Pressable onPress={() => setShowActionsheet(true)}>
              <Avatar size="xl" className='bg-background-200'>
                <AvatarFallbackText>{displayName}</AvatarFallbackText>
                <AvatarImage
                  source={{
                    uri: `${avatar}`,
                  }}
                />
                <AvatarBadge />
              </Avatar>
            </Pressable>

                </Box>
              </VStack>
           
              <VStack>
                <Button className="p-0" size='xl'  
                    onPress={async () => {
                      const profile: Partial<Pick<UserProfile, 'id' | 'username' | 'displayname' | 'avatar_url'>> = {
                        id: session?.user.id as string,
                        username: session?.user.email?.split('@')[0] as string || '',
                        displayname: displayName
                      };

                      const response = await profileAPI.updateProfile(profile);
                      if (response.error) {
                        console.error('Error creating profile:', response.error);
                        return;
                      }
                      else {
                        router.replace({
                          pathname: '/tabs/(tabs)/Chat',
                        });
                      }

                     
                    }}>
                <ButtonText>Save</ButtonText>
              </Button></VStack>

              <Divider className="my-0.5 mb-4" />

              <VStack>
                <Button className="p-0" size='xl'  
                    onPress={async () => {
                      await supabase.auth.signOut();
                       router.push('/');
                    }}>
                <ButtonText>Back to Home</ButtonText>
              </Button></VStack>
            </VStack>
          </FormControl>
         {/* <AlertDialogBackdrop /> */}
      <Actionsheet isOpen={showActionsheet} onClose={() => setShowActionsheet(false)}>
        <ActionsheetBackdrop />
        <ActionsheetContent>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          <ActionsheetItem onPress={takePicture}>
            <ActionsheetItemText>Take Photo</ActionsheetItemText>
          </ActionsheetItem>
          <ActionsheetItem onPress={pickImage}>
            <ActionsheetItemText>Select from album</ActionsheetItemText>
          </ActionsheetItem>
        </ActionsheetContent>
      </Actionsheet>
        </Box>
      </Box>
    </Box>
  );
}
