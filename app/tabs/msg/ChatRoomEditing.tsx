// chat room can edit room name and avatar and 2 panels to display images and files
import React, { useContext, useEffect, useState } from 'react';
import { TextInput, TouchableOpacity, Text, Image, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Box } from '@/components/ui/box';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/utility/connection';
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
import { Spinner } from '@/components/ui/spinner';
import { conversationAPI, messageAPI, filesAPI} from '@/utility/messages';
import { Conversation, Files, Message } from '@/utility/types/supabse';
import { Grid, GridItem } from '@/components/ui/grid';
import { Link } from 'expo-router';
import { LinkText } from '@/components/ui/link';
import { Icon } from '@/components/ui/icon';
import {
  ArrowBigDown
} from 'lucide-react-native';
import { Card } from '@/components/ui/card';
import { Heading } from '@/components/ui/heading';
import ZoomImage from '@/components/ZoomImage';
import { useSession } from '@/utility/session/SessionProvider';

export default function ChatRoomEditing() {
  const { user } = useSession();
  const router = useRouter();
  const { conversation_id, displayName } = useLocalSearchParams<{
    conversation_id?: string;
    displayName?: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [message, setMessages] = useState<Message[]>([]);
  const [name, setName] = useState(displayName || '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [showActionSheet, setShowActionsheet] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [activeImageUrl, setActiveImageUrl] = useState<string>('');
  const [isGroup, setIsGroup] = useState(false);
  const pickImage = async () => {
    handleDeviceFilePath.pickImageFromAlbumOrGallery().then((result) => {
      if (result != null)
      {
        setLoading(true);
        storageAPIs.resizedImage(result).then((data) => {

          storageAPIs.uploadAvatarToSupabase(data, conversation_id || '')
          .then((data) => {
            if(data.msg?.success)
              setAvatarUri(data.msg?.avatar_url || '');

            if(data.msg.data) {
               let avatar: Files = data.msg?.data;
              avatar.conversation_id = conversation_id;

              filesAPI.selectFileGroup(conversation_id ?? '').then((data) => {
                if(data && data.data && data.data.id){

                  avatar.id = data.data.id;
                  filesAPI.updateFileGroup(avatar);
                }
                else
                  filesAPI.insertFileGroup(avatar);
              })
            }

          })
          .finally(async () => {
            setShowActionsheet(false);
            setLoading(false);
          });
        });
       
      }});
  };
  const takePicture = async ()=> {
    handleDeviceFilePath.takePicture().then((result) => {
      if (result != null)
      {
        setLoading(true);
        storageAPIs.resizedImage(result).then((data) => {
          //last parameter to updateload to group
          storageAPIs.uploadAvatarToSupabase(data, conversation_id || '').then((data) => {

            if(data.msg?.success)
              setAvatarUri(data.msg?.avatar_url || '');

            if(data.msg.data) {
               let avatar: Files = data.msg?.data;
              avatar.conversation_id = conversation_id;

              filesAPI.selectFileGroup(conversation_id ?? '').then((data) => {
                if(data && data.data && data.data.id){

                  avatar.id = data.data.id;
                  filesAPI.updateFileGroup(avatar);
                }
                else
                  filesAPI.insertFileGroup(avatar);
              })
            }
          })
          .finally(async () => {
            setShowActionsheet(false);
            setLoading(false);
          });
        })

      }});
  }

  const handleSave = async () => {

    if(!name) return;

    const { data, error} = await supabase
    .from('conversations')
    .update({name: name})
    .eq('id', conversation_id)

    if(error) throw error?.message
    router.back();
  };

  const loadAvatar = async () => {
    const avatarRes = await conversationAPI.getCurrentConversation(conversation_id || '');
    if(avatarRes && avatarRes.data){

      const convertedData = avatarRes.data;

      setIsGroup(convertedData?.is_group)

      if(convertedData?.is_group) {
        const avatar = utilityFunction.buildFileUrl(convertedData.files_group?.[0]);
        setAvatarUri(avatar)
      }
      else{
         const participantAvatar =
                    convertedData.conversation_participants?.[1]?.profiles?.id == user?.id
                      ?  convertedData.conversation_participants?.[0]?.profiles.files_profiles?.[0]
                      : convertedData.conversation_participants?.[1]?.profiles.files_profiles?.[0];
          const buildURL = utilityFunction.buildFileUrl(participantAvatar || null);
        setAvatarUri(buildURL)
      }
    }
  }

  const loadFilesAndImages = async () => {
    const fileAndImage = await filesAPI.getFilesAndImagesOnly({conversation_id: conversation_id})
    if(fileAndImage && fileAndImage.data && fileAndImage.data.length > 0){
         
        setMessages(fileAndImage.data)
    }
  }

  useEffect(() =>{
    if( avatarUri != null || message.length > 0 ) return;

    loadAvatar();
    loadFilesAndImages();

  },[avatarUri, message])

  return (
    <ScrollView className='bg-white' contentContainerStyle={{ padding: 16 }}>
      <Box className="items-center mb-6 border border-gray-200">
        <TouchableOpacity onPress={() => setShowActionsheet(true)}>
          {avatarUri ? (
            <Image source={{ uri: avatarUri }} style={{ width: 100, height: 100, borderRadius: 50 }} />
          ) : (
            <Box className="w-24 h-24 bg-gray-300 rounded-full items-center justify-center">
              <Text>Select Avatar</Text>
            </Box>
          )}
        </TouchableOpacity>
        </Box>
        <Box className="mb-4">
            { isGroup ? (
              <>
                <Text className="mb-2 text-lg text-black font-semibold">Group Name</Text>
                  <TextInput
                    value={name}
                    onChangeText={setName}
                    placeholder="Enter room name"
                    className="border border-gray-300 rounded px-3 py-2"
                  />
                <TouchableOpacity
                onPress={handleSave}
                  className="bg-blue-500 rounded px-4 py-2 items-center mt-2"
                  >
                  <Text className="text-white">Save</Text>
              </TouchableOpacity>
              </>
            ) : (
              <Heading>{name}</Heading>
            )}
        </Box>

       

        <Card size="md" variant="elevated" className="m-3">
            <Heading size="md" className="mb-1">
                Images & Files
            </Heading>
        </Card>

        <Grid
            className="gap-4"
            _extra={{
                className: 'grid-cols-8',
            }}
        >

        {message && message.length > 0? message.map((m, index) => {
            const msg_type = m && m.message_type? m.message_type : '';
            const url = utilityFunction.buildFileUrl(m?.files?.[0] || null);
            return(
                
                <GridItem 
                    key={`${m.id}-${m.conversation_id}`}
                    className="bg-background-50 p-4 rounded-md text-center"
                    _extra={{
                    className: 'col-span-4',
                    }}
                >   
                    {msg_type.includes('image') ?
                        <TouchableOpacity
                            onPress={() => {
                                setActiveImageUrl(url);
                                setModalVisible(true);
                            }}
                        >
                            <Image
                                source={{ uri: url }}
                                className="w-42 h-48 rounded-lg"
                                alt="image"
                            />
                        </TouchableOpacity>
                       : msg_type.includes('file')?

                        <Link
                            href={url as '/'}
                            target="_blank"
                            rel="noopener noreferrer"
                            >
                            <LinkText className="text-black text-xl">{m && m?.files?.[0]?.filename || ''}</LinkText>
                        <Icon
                            as={ArrowBigDown}
                            size="lg"
                            className="mt-0.5 text-info-600 text-black"
                        /></Link> : null}
                </GridItem>
                
            )
        }):
          <GridItem  
          className="bg-background-50 p-6 rounded-md"
          _extra={{ className: 'col-span-8' }}>
            <Text className="text-gray-400 text-center">No images and files yet.</Text>
          </GridItem>}
        </Grid>

        {/* ZoomImage Modal - Rendered at top level */}
        <ZoomImage
            image={activeImageUrl}
            visible={modalVisible}
            onClose={() => setModalVisible(false)}
        />

        {/* <AlertDialogBackdrop /> */}
        <Actionsheet isOpen={showActionSheet} onClose={() => setShowActionsheet(false)}>
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
    </ScrollView>
  );
}