// chat room can edit room name and avatar and 2 panels to display images and files
import React, { useEffect, useState } from 'react';
import { View, TextInput, TouchableOpacity, Text, Image, ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Box } from '@/components/ui/box';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/utility/connection';
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
import { Spinner } from '@/components/ui/spinner';
import { conversationAPI, messageAPI } from '@/utility/messages';
import { Message } from '@/utility/types/supabse';
import { Grid, GridItem } from '@/components/ui/grid';
import { Link } from 'expo-router';
import { LinkText } from '@/components/ui/link';
import { Icon } from '@/components/ui/icon';
import {
  ArrowBigDown
} from 'lucide-react-native';

export default function ChatRoomEditing() {
  const router = useRouter();
  const { conversation_id, displayName, public_key } = useLocalSearchParams<{
    conversation_id?: string;
    displayName?: string;
    public_key?: string;
  }>();
  const [loading, setLoading] = useState(false);
  const [message, setMessages] = useState<Message[]>([]);
  const [name, setName] = useState(displayName || '');
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [showActionSheet, setShowActionsheet] = useState(false);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [1, 1],
      quality: 1,
    });
    if (result && result.assets && result.assets[0])
      {
        setLoading(true);
        storageAPIs.resizedImage(result.assets[0].uri).then((data) => {

          storageAPIs.uploadAvatarToSupabase(data.uri, result?.assets[0]?.fileName ?? 'inage.jpg', conversation_id || '', 'group')
          .then((data) => {
            if(data.msg?.success)
              setAvatarUri(data.msg?.avatar_url || '');
          })
          .finally(async () => {
            setShowActionsheet(false);
            setLoading(false);
          });
        });
       
      }
    if (!result.canceled) {
      setAvatarUri(result.assets[0].uri);
    }
  };
    const takePicture = async ()=> {
      handleDeviceFilePath.takePicture().then((result) => {
        if (result != null)
        {
          setLoading(true);
          storageAPIs.resizedImage(result.uri).then((data) => {
            //last parameter to updateload ro group
            storageAPIs.uploadAvatarToSupabase(data.uri, result.fileName, conversation_id || '', 'group').then((data) => {
              if(data.msg?.success)
                setAvatarUri(data.msg?.avatar_url || '');
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

    const error = await supabase
    .from('conversations')
    .update({name: name})
    .eq('conversation_id',conversation_id)

    if(error) throw error
    router.back();
  };

  if (loading) {
    return <Text>Loading...</Text>;
  }

  const loadConversation = async () => {
    const conversation = await conversationAPI.getConversationById({id: conversation_id});
    if(conversation && conversation.data){
        setAvatarUri(conversation.data?.avatar_url)
    }
  }

  const loadFilesAndImages = async () => {
    const fileAndImage = await messageAPI.getFilesAndImagesOnly({conversation_id: conversation_id})
    if(fileAndImage && fileAndImage.data && fileAndImage.data.length > 0){
        setMessages(fileAndImage.data)
    }
  }

  useEffect(() =>{
    if( !avatarUri || !message) return;

    loadConversation();
    loadFilesAndImages();
  },[])

  useEffect(() =>{
    if( !avatarUri ) return;
  },[avatarUri])

  return (
    <ScrollView className='bg-white' contentContainerStyle={{ padding: 16 }}>
      <Box className="items-center mb-6">
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
            <Text className="mb-2">Group Name</Text>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Enter room name"
              className="border border-gray-300 rounded px-3 py-2"
            />
        </Box>
        <TouchableOpacity
          onPress={handleSave}
            className="bg-blue-500 rounded px-4 py-2 items-center"
            >
            <Text className="text-white">Save</Text>
        </TouchableOpacity>

        <Box>
            <Grid className="gap-4" _extra={{ className: 'grid-cols-10' }}>
                {message.map((m, index) => {
                    const msg_type = m.message_type;
                    return(
                        
                        <GridItem
                            className="bg-background-50 p-6 rounded-md"
                            _extra={{ className: 'col-span-3' }}
                        >   
                            {msg_type == 'image'?
                                <Image
                                    source={{ uri: m.content }}
                                    className="w-48 h-48 rounded-lg"
                                    alt="image"
                                />:

                                (<Link
                                    href={`${m.content}` as '/'}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    >
                                <LinkText className="text-black text-xl">Download file</LinkText>
                                <Icon
                                    as={ArrowBigDown}
                                    size="lg"
                                    className="mt-0.5 text-info-600 text-black"
                                /></Link>)}
                        </GridItem>
                        
                    )
                })}
            </Grid>
        </Box>

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