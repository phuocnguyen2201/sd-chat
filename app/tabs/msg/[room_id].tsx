import React, { useEffect, useState, useRef } from 'react';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { useLocalSearchParams, Link, useRouter } from 'expo-router';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { supabase } from '@/utility/connection';
import { ScrollView, KeyboardAvoidingView, Platform, Pressable, Alert, Image, View } from 'react-native';
import { useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { STORAGE_BUCKETS, storageAPIs, utilityFunction } from '@/utility/handleStorage';
import ZoomImage from '@/components/ZoomImage';
import { LinkText } from '@/components/ui/link';
import { ArrowBigDown } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { useSession } from '@/utility/session/SessionProvider';
import { MessageEncryption } from '../../../utility/securedMessage/secured';
import { Picker } from 'emoji-mart-native';
import { conversationAPI, filesAPI, messageAPI, reactionAPI } from '@/utility/messages';
import {
  Popover,
  PopoverBackdrop,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogCloseButton,
  AlertDialogBody,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import {
  ForwardIcon,
  MoveRightIcon
} from 'lucide-react-native';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { MessageAction } from '@/components/MessageAction';
import ForwardMessage from '@/components/ForwardMessage';
import { Files, Message } from '@/utility/types/supabse';
import { TouchableWithoutFeedback } from '@gorhom/bottom-sheet';

/**
 * Chat Room Screen
 * 
 * Uses SessionProvider for conversation key management.
 * No conversationKey passed through navigation params.
 */
export default function ChatScreen() {
  const { conversation_id, displayName, public_key } = useLocalSearchParams<{
    conversation_id?: string;
    displayName?: string;
    public_key?: string;
  }>();

  const {
    user,
    profile,
    conversationKey,
    currentConversationId,
    getConversationKey,
    setCurrentConversation,
  } = useSession();

  const userId = user?.id ?? null;

  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');

  const [showPicker, setShowPicker] = useState(false);
  const [showReaction, setShowReaction] = useState(false);

  const [activeMessage, setActiveMessage] = useState<string>('');
  const [activeReaction, setActiveReaction] = useState<string>('');
  const [activeMsgType, setActiveMsgType] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const [modalVisible, setModalVisible] = useState(false);
  const [activeImageUrl, setActiveImageUrl] = useState<string>('');

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showForwardDialog, setShowForwardDialog] = useState(false);

  const [messageToDelete, setMessageToDelete] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  const scrollRef = useRef<ScrollView | null>(null);
  const navigation = useNavigation();
  const router = useRouter();

  // Load conversation key when conversation_id changes
  useEffect(() => {
    if (!conversation_id || !userId) return;

    const loadKey = async () => {
      try {
        // Check if this is the current conversation
        if (currentConversationId === conversation_id && conversationKey) {
          // Key already loaded
          setKeyError(null);
          return;
        }

        // Try to get key from manager
        const key = await getConversationKey(conversation_id);
        if (key) {
          await setCurrentConversation(conversation_id, key);
          setKeyError(null);
        } else {
          // Key not in storage, try to unwrap from wrapped key in messages
          try {
            const getWrappedKey = await conversationAPI.getWrappedKeyCurrent(conversation_id, userId);

            if (!getWrappedKey.data?.[0]?.wrapped_key || !getWrappedKey.data?.[0]?.key_nonce) {
              console.error('Missing wrapped key data');
              return null;
            }

            // Unwrap the conversation key
            const wrappedKeyBytes = MessageEncryption.base64ToBytes(getWrappedKey.data[0].wrapped_key);
            const keyNonceBytes = MessageEncryption.base64ToBytes(getWrappedKey.data[0].key_nonce);
            const senderPublicKeyBytes = MessageEncryption.base64ToBytes(public_key??'');
            
            //console.log(wrappedKeyBytes, keyNonceBytes, senderPublicKeyBytes);
            const unwrappedKey = await MessageEncryption.unwrapConversationKey(
              wrappedKeyBytes,
              keyNonceBytes,
              senderPublicKeyBytes
            );

            // Store and set the unwrapped key
            await setCurrentConversation(conversation_id, unwrappedKey);
            setKeyError(null);
          } catch (unwrapError) {
            console.error('Error unwrapping conversation key:', unwrapError);
            setKeyError('Failed to unwrap conversation key. Please go back and try again.');
          }
        }
      } catch (error) {
        console.error('Error loading conversation key:', error);
        setKeyError('Failed to load conversation key.');
      }
    };

    loadKey();
  }, [conversation_id, userId, currentConversationId, conversationKey, getConversationKey, setCurrentConversation]);

  // Set navigation header
  useEffect(() => {
    if (displayName) {
      navigation.setOptions({ headerTitle: displayName });
      // set button to edit chat room
      navigation.setOptions({
        headerRight: () => (
          <Pressable
            onPress={() => {
               router.push({
                    pathname: '/tabs/msg/ChatRoomEditing',
                    params: {
                      conversation_id: conversation_id,
                      displayName: displayName,
                    },
                  });
             
            }}
            className="px-3 py-1 bg-blue-500 rounded-lg"
          >
            <Icon as={MoveRightIcon} size="md" className="text-white" />
          </Pressable>
        ),
      }); 
    }
  }, [navigation, displayName]);

  // Load messages
  useEffect(() => {
    if (!conversation_id) return;

    let isMounted = true;

    async function loadMessages() {
      try {
        const { data, error } = await supabase
          .rpc('get_messages_with_reactions', { convo_id: conversation_id })
          .limit(30);

        if (error) {
          console.warn('Error loading messages', error);
          return;
        }

        if (isMounted && data) {
          setMessages(data as Message[]);
        }
      } catch (error) {
        console.error('Error in loadMessages:', error);
      }
    }

    loadMessages();

    // Set up real-time subscription for new messages with INSERT, UPDATE, DELETE
    const channel = supabase
      .channel(`public:messages:conversation_id=eq.${conversation_id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation_id}`,
        },
        (payload) => {
           messageAPI.refreshMessage(payload.new.id).then((newMsg) => {
            if(newMsg && newMsg.data){
              setMessages((prev) => [...prev, newMsg.data as unknown as Message]);
            }
          });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation_id}`,
        },
        (payload) => {
          const updatedMsg = payload.new as Message;
          setMessages((prev) =>
            prev.map((msg) => (msg.id === updatedMsg.id ? updatedMsg : msg))
          );
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversation_id}`,
        },
        (payload) => {
          const deletedMsg = payload.old as Message;
          setMessages((prev) => prev.filter((msg) => msg.id !== deletedMsg.id));
        }
      )
      .subscribe();

    return () => {
      isMounted = false;
      try {
        supabase.removeChannel(channel);
      } catch (e) {
        // fallback for older client versions
        // @ts-ignore
        channel.unsubscribe && channel.unsubscribe();
      }
    };
  }, [conversation_id]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (!scrollRef.current) return;
    setTimeout(() => {
      try {
        // @ts-ignore
        scrollRef.current?.scrollToEnd({ animated: true });
      } catch (e) {
        // Ignore scroll errors
      }
    }, 50);
  }, [messages.length]);

  useEffect(() => {
    if (!messageToDelete || !conversation_id) return;
    if(conversation_id && messages && messages.length && messageToDelete) {
      //Ignore it the purpoe is to redener the messageToDelete.
    }
  }, [messages, messageToDelete, conversation_id]);
  
  //Handle delete message
  const handleDeleteMessage = async (messageId: string) => {
    if (!messageId) {
      Alert.alert('Error', 'Message ID not available');
      return;
    }

    try {
      const result = await messageAPI.deleteMessage(messageId);
      if (!result) {
        Alert.alert('Error', 'Failed to delete message');
        return;
      }

    } catch (error) {
      console.error('Error in handleDeleteMessage:', error);
      Alert.alert('Error', 'Failed to delete message');
    }
    finally {
      setMessages((prev) => prev.filter((msg) => msg.id !== messageId));
      setMessageToDelete(null);
      setActiveMessage('');
      setShowReaction(false);
      setShowDeleteDialog(false);
    }
  }

  //Handle forward message
  const handleForwardMessage = async (recipientId: Array<string>) => {

    const messageToForward = messages.find((msg) => 
      msg.id === activeMessage && msg.conversation_id === conversation_id
    )

    if (messageToForward && messageToForward.id && !messageToForward?.content || !recipientId) {
      Alert.alert('Error', 'Message or Recipient ID not available');
      return;
    }
    try {
      recipientId && recipientId.map(async (recipient) => {
        // get the conversation ID
      const conversation = await conversationAPI.verifyDMConversation(recipient!);
      
      if (conversation !== null && conversation.data?.conversation_id) {
        //For text message when fwd, must encryption the message with new receiver's public keys.
        if(messageToForward?.message_type === 'text') {
          // Find the right conversation key
          const forwardPartyKey = await getConversationKey(conversation.data.conversation_id);

          // Encrypt and send the forwarded message
          const encryptedMessage = MessageEncryption.encryptMessage(messageToForward?.content ?? '', forwardPartyKey!);
          const msg: Message = {
            conversation_id: conversation?.data?.conversation_id as string || '',
              sender_id: userId,
              content: encryptedMessage.ciphertext,
              nonce: encryptedMessage.nonce,
              key_nonce: encryptedMessage.keyNonce,
              wrapped_key: encryptedMessage.wrappedKey,
              message_type: messageToForward.message_type,
              is_forward: true
          }
          const { error } = await messageAPI.forwardMessage(msg)

          if (error) {
            console.warn('Error forwarding message', error.message);
            Alert.alert('Error', 'Failed to forward message to some recipients');
          }
        }
        else {
          //Forward type file or message. Files or Images location will remaining the same, just add a new record so the new conversation can reference to the images or files.
          //Filter the message wanted to forward
          
          //console.log(fwdMsg)
          /* When nonce, key_nonce and wrapped_key is null, which mean the msg is either file or images*/
          if(!messageToForward?.key_nonce && !messageToForward?.wrapped_key) {

            //Forward the message first and get the id for the new conversation.
            const newFwdMessage: Message = {
              sender_id: userId,
              conversation_id: conversation.data.conversation_id as string || '',
              message_type: messageToForward?.message_type,
              content: messageToForward?.content,
              is_forward: true
            }
            // insert new message first
            const { data: dataFwdMsg, error: fwdError } = await messageAPI.forwardMessage(newFwdMessage)

            if (fwdError) throw fwdError;

            // Retrieve the files or images information to create reference in table files for new conversation.
            const {data: msg, error: msgError} = await messageAPI.getMessageWithFileOrImage(messageToForward?.id || '', conversation_id || '');

            if(msgError) throw msgError;

            if(msg && msg.files) {
              
              const retrievedFileInformation = msg.files[0];

              //New Files or images information as reference for new conversation.
              const newFwdFileOrImage: Files = {
                message_id: dataFwdMsg?.id, //Upate new message id
                bucket_name: retrievedFileInformation?.bucket_name,
                filepath: retrievedFileInformation?.filepath,
                filename: retrievedFileInformation?.filename,
                file_size: retrievedFileInformation?.file_size || 0,
                original_name: retrievedFileInformation?.original_name || '',
                token: retrievedFileInformation?.token,
                mime_type: retrievedFileInformation?.mime_type,
              
              }

              //Insert a new message to new conversation.
              const { data, error: fwdFileError} = await filesAPI.insertFilesMessages(newFwdFileOrImage);
             

              if (fwdFileError) {
                console.warn('Error forwarding message', fwdFileError?.message);
                Alert.alert('Error', 'Failed to forward message to some recipients');
              }
            }
           
          }

        }
      }
      });

    } catch (error) {
      console.error('Error in handleForwardMessage:', error);
      Alert.alert('Error', 'Failed to forward message');
    }
  }

  //Handle reaction
  const handleReaction = async (messageId: string, emoji: string) => {
    if (!userId || !profile) {
      Alert.alert('Error', 'User session not available');
      return;
    }

    try {
      const verify = await reactionAPI.verifyReaction(userId, messageId);
      if (!verify.data) {
        await reactionAPI.insertReaction(userId, profile.displayname ?? '', emoji, messageId);
      } else {
        await reactionAPI.updateReaction(userId, emoji, messageId);
      }
    } catch (error) {
      console.error('Error handling reaction:', error);
      Alert.alert('Error', 'Failed to add reaction');
    }
    finally {
      setActiveMessage('');
      setShowReaction(false);

    }
  };

  


  // Handle send message
  async function handleSend() {
    if (!newMessage.trim() || !conversation_id || !conversationKey || !userId) {
      if (!conversationKey) {
        Alert.alert('Error', 'Conversation key not available. Please try again.');
      }
      return;
    }

    setLoading(true);

    try {
      const encryptedMSG = await MessageEncryption.encryptMessage(newMessage, conversationKey);
      // Check if editing or new message
      if(activeMessage !== '') {
        //console.log('Editing message:', activeMessage);
        const { error } = await supabase
        .from('messages')
        .update({ 
          content: encryptedMSG.ciphertext, 
          nonce: encryptedMSG.nonce, 
          key_nonce: encryptedMSG.keyNonce, 
          wrapped_key: encryptedMSG.wrappedKey })
        .eq('id', activeMessage)
        .eq('sender_id', userId);
        

        if (error) {
          console.warn('Error editing message', error.message);
          Alert.alert('Error', 'Failed to edit message');
        } else {
          setNewMessage('');
        }
      }
      else {
        const { error } = await supabase.from('messages').insert([
          {
            conversation_id: conversation_id,
            sender_id: userId,
            content: encryptedMSG.ciphertext,
            nonce: encryptedMSG.nonce,
            key_nonce: encryptedMSG.keyNonce,
            wrapped_key: encryptedMSG.wrappedKey,
          },
        ]);

          if (error) {
          console.warn('Error sending message', error.message);
          Alert.alert('Error', 'Failed to send message');
        } else {
          setNewMessage('');
        }
    }
       

      
    } catch (error) {
      console.error('Error in handleSend:', error);
      Alert.alert('Error', 'Failed to send message');
    } finally {
      setLoading(false);
      setShowPicker(false);
      setActiveMessage('');
    }
  }

  // Handle image picking and uploading
  async function pickImage() {
    if (!conversation_id || !userId) {
      Alert.alert('Error', 'Session not available');
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert('Permission Denied', 'We need permission to access your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 1,
    });

    if (!result.canceled && conversation_id) {
      //const uri = result.assets[0].uri;
      //const fileName = uri.split('/').pop() || 'image.jpg';
      setLoading(true);
      try {
        await storageAPIs.uploadImageToSupabase(result.assets[0], conversation_id, userId);
      } catch (error) {
        Alert.alert('Error', 'Failed to upload image');
      } finally {
        setLoading(false);
      }
    }
  }

  async function pickFile() {
    if (!conversation_id || !userId) {
      Alert.alert('Error', 'Session not available');
      return;
    }

    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
      });

      if (result.assets && result.assets.length > 0 && conversation_id) {
        const file = result.assets[0];
        
        setLoading(true);
        try {
          await storageAPIs.uploadFileToSupabase(file, conversation_id, userId);
        } catch (error) {
          Alert.alert('Error', 'Failed to upload file');
        } finally {
          setLoading(false);
        }
      }
    } catch (e) {
      Alert.alert('Permission Error', 'Unable to access files. Please check your permissions.');
      console.warn(e);
    }
  }

  // Show error if key is missing
  if (keyError) {
    return (
      <Box className="flex-1 bg-white items-center justify-center p-4">
        <Text className="text-red-500 text-center mb-4">{keyError}</Text>
        <Pressable
          onPress={() => router.back()}
          className="bg-blue-500 px-4 py-2 rounded-lg"
        >
          <Text className="text-white">Go Back</Text>
        </Pressable>
      </Box>
    );
  }

  // Show loading if key not ready
  if (!conversationKey || currentConversationId !== conversation_id) {
    return (
      <Box className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-400">Loading conversation...</Text>
      </Box>
    );
  }

  if (!userId) {
    return (
      <Box className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-400">Please log in to view messages</Text>
      </Box>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
      style={{ flex: 1 }}
    >
      <Box className="relative flex-1 bg-white pt-safe px-4 md:px-6 lg:px-8">
        <ScrollView
          ref={scrollRef}
          className="flex-1 px-4 py-3"
          contentContainerStyle={{ paddingBottom: 140 }}
          keyboardShouldPersistTaps="handled"
        >
          <VStack space="xs">
            {messages.length === 0 && (
              <Box className="items-center mt-12">
                <Text className="text-gray-400 text-center">
                  No messages yet — start a conversation!
                </Text>
              </Box>
            )}

            {messages.map((m, index) => {
              const isCurrentUser = m.sender_id === userId;
              // Check if the previous message is from the same sender
              const previousMessage = index > 0 ? messages[index - 1] : null;
              const isSameSenderAsPrevious = previousMessage && previousMessage.sender_id === m.sender_id;
              // Only show username if it's not the current user and sender is different from previous message
              const shouldShowUsername = !isCurrentUser && !isSameSenderAsPrevious;
              //console.log('Rendering message from:', m.displayname);
              let url: string = '';
              const data = m.files?.[0] ?? null;
              if(m && m.message_type && m.files  && (m.message_type.includes('image')|| m.message_type.includes('file'))){
                url = utilityFunction.buildFileUrl(data);
              }

              return (
                <Pressable
                  key={m.id}
                  onLongPress={() => {
                    setShowReaction(true);
                    setActiveMessage(m.id ?? '');
                  }}
                  onPress={() => {
                    setShowReaction(false);
                    setActiveMessage('');
                  }}
                >
                  <TouchableWithoutFeedback>
                  {/* active message want to reaction or delete */}
                  {showReaction && activeMessage == m.id && (
                        <View onStartShouldSetResponder={() => true}
                              onResponderTerminationRequest={() => false}
                              onTouchEnd={(e) => { e.stopPropagation() }}>
                        <MessageAction 
                          messageId = {m.id}
                          msg_type = {m?.message_type || ''}
                          onReaction = {handleReaction}
                          onEdit={() => {
                            setNewMessage(m.message_type == 'text' ? MessageEncryption.decryptMessage(
                              {
                                ciphertext: m?.content?? '',
                                nonce: m.nonce?? '',
                                wrappedKey: m.wrapped_key?? '',
                                keyNonce: m.key_nonce?? '',
                              },
                              conversationKey
                            ): '');
                            setActiveMessage(m?.id ?? '');
                            setShowReaction(false);
                          }}
                          onForward={() => {
                            setShowForwardDialog(true)
                          }}
                          onDelete={() => { 
                            setShowDeleteDialog(true)
                            setMessageToDelete(m.id ?? '');
                        
                          }}/>
                        </View>
                  )}
         
                  
                  {/*Display username*/}
                  { shouldShowUsername ?  
                    <Box className={'flex-row mb-2 justify-start'}> 
                      <Text className="text-xs text-gray-500">{m.displayname}</Text>
                    </Box>: <></> }
                  
                  <Box
                    className={`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                  >
                    <Box
                      className={`max-w-xs px-3 py-2 rounded-2xl ${
                        isCurrentUser
                          ? 'bg-blue-500 rounded-br-none'
                          : 'bg-gray-300 rounded-bl-none'
                      }`}> 
                      {m.is_forward ? <Text><Icon as={ForwardIcon} size="md" className="text-gray-700" /></Text> : null}
                      {m && m.message_type && m?.message_type.includes('image') ? 
                        
                        <Pressable
                          onPress={() => {
                              setActiveImageUrl(url)
                              setModalVisible(true);
                          }}
                        > 
                          <Image
                            source={{uri: url }}
                            className="w-48 h-48 rounded-lg"
                            alt="image"
                            onError={(e) => console.log('Image error:', e.nativeEvent.error)}
                          />
                        </Pressable>
                       : m && m.message_type && m.message_type.includes('file') ? 
                        <Link
                          href={url as '/'}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <LinkText className="text-black text-xl">{data?.filename|| ''}</LinkText>
                          <Icon
                            as={ArrowBigDown}
                            size="lg"
                            className="mt-0.5 text-info-600 text-black"
                          />
                        </Link>
                       : 
                        <Text
                          className={`text-lg ${
                            isCurrentUser ? 'text-white font-semibold' : 'text-black'
                          }`}
                        >
                          { m.message_type == 'text' ? MessageEncryption.decryptMessage(
                            {
                              ciphertext: m.content ?? '',
                              nonce: m.nonce ?? '',
                              wrappedKey: m.wrapped_key ?? '',
                              keyNonce: m.key_nonce ?? '',
                            },
                            conversationKey
                          ): null }
                        </Text>
                      }
                    </Box>
                  </Box>
                  {/*Reaction loading*/}
                  <Box
                    className={`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {m &&
                      m.reactions &&
                      m.reactions.map((r) => (
                        <Box key={r.id} className='z-40 mx-1'>
                          <Popover
                            isOpen={activeReaction === m.id}
                            onClose={() => setActiveReaction('')}
                            onOpen={() => setActiveReaction(m.id ?? '')}
                            placement="top"
                            size="md"
                            trigger={(triggerProps) => {
                              return (
                                <Pressable {...triggerProps}>
                                  <Text>{r.emoji}</Text>
                                </Pressable>
                              );
                            }}
                          >
                            <PopoverBackdrop />
                            <PopoverContent>
                              <PopoverArrow />
                              <PopoverBody>
                                <Text className="text-typography-900">{r.sender_username}</Text>
                              </PopoverBody>
                            </PopoverContent>
                          </Popover>
                          
                        </Box>
                        
                      ))}
                  </Box>
                  </TouchableWithoutFeedback>
                </Pressable>

              );
            })}
            
          </VStack>


        </ScrollView>

        {/* ZoomImage Modal - Rendered at top level */}
        <ZoomImage
          image={activeImageUrl}
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
        />

        {/* Delete Confirmation Dialog - Rendered globally to avoid blocking other interactions */}
        <AlertDialog isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)} size="md">
          <AlertDialogContent>
            <AlertDialogHeader>
              <Heading className="text-typography-950 font-semibold" size="md">
                <Text>Notification</Text>
              </Heading>
            </AlertDialogHeader>
            <AlertDialogBody className="mt-3 mb-4">
              <Text size="sm">
                Delete the message cannot be undone. Are you sure you want to delete the message?
              </Text>
            </AlertDialogBody>
            <AlertDialogFooter>
              <Button
                variant="outline"
                action="secondary"
                onPress={() => {
                    setShowDeleteDialog(false)
                    setShowReaction(false);
                  }}
                size="sm"
              >
                <ButtonText>Cancel</ButtonText>
              </Button>
              <Button size="sm" onPress={() => {
                if (messageToDelete) {
                  handleDeleteMessage(messageToDelete);
                }
              }}>
                <ButtonText>Okay</ButtonText>
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
              {/*Forward message*/}
        <ForwardMessage
          isOpen = {showForwardDialog}
          onClose = {() => {
            setShowForwardDialog(false)
            setShowReaction(false);
          }}
          onForward = {(message, recipientIds) => {
            handleForwardMessage(recipientIds);
          }}
          messagePreview = {
            messages.find((msg) => msg.id === activeMessage && msg.message_type == "text")
              ? MessageEncryption.decryptMessage(
                  {
                    ciphertext: messages.find((msg) => msg.id === activeMessage)?.content || '',
                    nonce: messages.find((msg) => msg.id === activeMessage)?.nonce || '',
                    wrappedKey: messages.find((msg) => msg.id === activeMessage)?.wrapped_key || '',
                    keyNonce: messages.find((msg) => msg.id === activeMessage)?.key_nonce || '',
                  },
                  conversationKey
                )
              : messages.find((msg) => msg.id === activeMessage)?.content?.toUpperCase() || ''
          }
        /> 
        {/* Input Bar - Fixed above keyboard */}
        <Box className="absolute left-0 right-0 bottom-5 p-3 bg-white border-t border-gray-200">
          {showPicker && (
            <Picker
              onSelect={(emo) => {
                setNewMessage((prev) => prev + emo.native);
              }}
              showPreview={false}
            />
          )}
          <HStack space="sm" className="items-center">
            {/* Image Upload Button */}
            <Pressable onPress={pickImage} className="p-2 rounded-full bg-gray-100">
              <Text className="text-lg">🖼️</Text>
            </Pressable>

            {/* File Upload Button */}
            <Pressable onPress={pickFile} className="p-2 rounded-full bg-gray-100">
              <Text className="text-lg">📎</Text>
            </Pressable>

            <Input className="flex-1 rounded-full bg-gray-100 border border-gray-200">
              <InputField
                className="text-black px-4"
                value={newMessage}
                onChangeText={setNewMessage}
                placeholder="Aa"
                placeholderTextColor="#9CA3AF"
              />
            </Input>

            <Pressable onPress={() => setShowPicker(!showPicker)}>
              <Text style={{ fontSize: 20 }}>😀</Text>
            </Pressable>

            <Pressable
              onPress={handleSend}
              disabled={!newMessage.trim() || loading || !conversationKey}
              className={`p-2 rounded-full ${
                newMessage.trim() && !loading && conversationKey
                  ? 'bg-blue-500'
                  : 'bg-gray-300'
              }`}
            >
              <Text className="text-white text-lg font-bold">{loading ? '...' : '➤'}</Text>
            </Pressable>
          </HStack>
        </Box>
      </Box>
    </KeyboardAvoidingView>
  );
}
