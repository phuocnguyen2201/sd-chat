
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { useState, useEffect } from 'react';
import { supabase } from '../utility/connection';
import { Box } from '@/components/ui/box';
import { FormControl} from '@/components/ui/form-control';
import { VStack } from '@/components/ui/vstack';
import { Input, InputField } from '@/components/ui/input';
import { Button, ButtonText } from '@/components/ui/button';
import { filesAPI, profileAPI } from '@/utility/messages';
import { router } from 'expo-router';
import { Divider } from '@/components/ui/divider';
import { Files, UserProfile } from '@/utility/types/supabse';
import { Pressable } from 'react-native';
import { Spinner } from '@/components/ui/spinner';

import { Avatar, AvatarFallbackText, AvatarImage, AvatarBadge } from '@/components/ui/avatar';
import { handleDeviceFilePath, storageAPIs, utilityFunction } from '@/utility/handleStorage';
import {
  Actionsheet,
  ActionsheetContent,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
} from '@/components/ui/actionsheet';
import { useSession } from '@/utility/session/SessionProvider';

export default function CompleteProfile() {

  const { user, profile, refreshProfile } = useSession();

  const [displayName, setDisplayName] = useState<string>('');

  const [ loading, setLoading ] = useState<boolean>(false);
  
  const [avatar, setAvatar] = useState<string>('');

  const [showActionsheet, setShowActionsheet] = useState<boolean>(false);

  function pickImage() {
    handleDeviceFilePath.pickImageFromAlbumOrGallery().then((result) => {
      if (result != null)
      {
        setLoading(true);
        storageAPIs.resizedImage(result).then((data) => {

          storageAPIs.uploadAvatarToSupabase(data, user?.id || '')
          .then((data) => {
            if (data.msg?.success)
              setAvatar(data.msg?.avatar_url || '');

            if (data.msg?.data) {
              const avatar: Files = data.msg?.data;
              avatar.profile_id = user?.id || '';
              
              filesAPI.insertFileProfile(avatar);
            }
          })
          .finally(async () => {
            setShowActionsheet(false);
            setLoading(false);
          });
        });
       
      }});
  }

  function takePicture() {
    handleDeviceFilePath.takePicture().then((result) => {
      if (result != null)
      {
        setLoading(true);
        storageAPIs.resizedImage(result).then((data) => {
          
          storageAPIs.uploadAvatarToSupabase(data, user?.id || '')
          .then((data) => {

            if(data.msg?.success)
              setAvatar(data.msg?.avatar_url || '');

            if(data.msg?.data) {
              let avatar: Files = data.msg?.data;
              avatar.profile_id = user?.id;
              filesAPI.insertFileProfile(avatar);
            }
              
          })
          .finally(async () => {
            setShowActionsheet(false);
            setLoading(false);
          });
        })

      }});
    }   
    const updateProfile = async () => {
      const profile: Partial<Pick<UserProfile, 'id'| 'displayname'>> = {
        id: user?.id as string,
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
    };

    useEffect(() => {
      if(profile && profile.files_profiles) {
        const avatar = utilityFunction.buildFileUrl(profile.files_profiles[0])
        setAvatar(avatar)
      }

      refreshProfile();
    },[])

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

                <Pressable onPress={() => {
                  setShowActionsheet(true);

                }
              }>
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
                    onPress={updateProfile}>
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
            {loading ? <Spinner size="large" color="grey"/> : null}
          </ActionsheetItem>
        </ActionsheetContent>
      </Actionsheet>
        </Box>
      </Box>
    </Box>
  );
}
