import { useEffect, useState, useRef } from 'react';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { useLocalSearchParams, Link, useRouter, useNavigation } from 'expo-router';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { supabase } from '@/utility/connection';
import { ScrollView, KeyboardAvoidingView, Platform, Pressable, Alert, Image, View, Keyboard } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { storageAPIs, utilityFunction, filesAPI } from '@/utility/handleStorage';
import ZoomImage from '@/components/ZoomImage';
import { LinkText } from '@/components/ui/link';
import { ArrowBigDown, ForwardIcon,
  MoveRightIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { useSession } from '@/utility/session/SessionProvider';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { resolveConversationKey } from '@/utility/securedMessage/ConversationKeyResolver';
import { Picker } from 'emoji-mart-native';
import { automationLocatorsDataState } from '@/constants/automationLocatorsDataState';
import { conversationAPI, messageAPI, reactionAPI } from '@/utility/messages';
import {
  Popover,
  PopoverBackdrop,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
} from '@/components/ui/popover';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Button, ButtonText } from '@/components/ui/button';
import { Heading } from '@/components/ui/heading';
import { MessageAction } from '@/components/MessageAction';
import ForwardMessage from '@/components/ForwardMessage';
import { Files, Message } from '@/utility/types/supabse';

/**
 * Chat Room Screen
 * 
 * Uses SessionProvider for conversation key management.
 * No conversationKey passed through navigation params.
 */
export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const { conversation_id, displayName, public_key } = useLocalSearchParams<{
    conversation_id?: string;
    displayName?: string;
    public_key?: string;
  }>();

  const {
    user,
    profile,
    isDarkMode,
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

  // Message whose action menu (react / edit / forward / delete) is open.
  const [activeMessage, setActiveMessage] = useState<string>('');
  // Message being edited in the composer. Kept apart from activeMessage so that
  // closing a menu or dialog can never turn the next send into an edit.
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [activeReaction, setActiveReaction] = useState<string>('');
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

  // Close the action menu and drop the selected message.
  const closeMessageActions = () => {
    setShowReaction(false);
    setActiveMessage('');
  };

  const cancelEditing = () => {
    setEditingMessageId(null);
    setNewMessage('');
  };

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
          return;
        }

        /*
          Not held locally, so unwrap it from this user's participant row. The
          row records the public key that wrapped it; the `public_key` param is
          only set when this screen is reached from a notification, so it is
          passed as a fallback candidate rather than relied on.
        */
        const lookup = await resolveConversationKey(conversation_id, userId, [public_key]);

        if (lookup.status === 'found') {
          await setCurrentConversation(conversation_id, lookup.key);
          setKeyError(null);
          return;
        }

        setKeyError(
          lookup.status === 'absent'
            ? 'No conversation key is stored for this account yet. Open the chat from the list, or sync your keys from your other device.'
            : 'Failed to unwrap conversation key. Please go back and try again.'
        );
      } catch (error) {
        console.error('Error loading conversation key:', error);
        setKeyError('Failed to load conversation key.');
      }
    };

    loadKey();
  }, [conversation_id, userId, currentConversationId, conversationKey, getConversationKey, setCurrentConversation]);

  /*
    Decryption runs inside render, so an unreadable message would otherwise take
    the whole chat screen down instead of just that one bubble. A message that
    will not open means this device holds a different conversation key than the
    sender used, so fail soft and keep the rest of the conversation usable.
  */
  function safeDecrypt(
    message: {
      content?: string | null;
      nonce?: string | null;
      wrapped_key?: string | null;
      key_nonce?: string | null;
    },
    key: Uint8Array | null
  ): string {
    if (!key) {
      return '';
    }

    try {
      return MessageEncryption.decryptMessage(
        {
          ciphertext: message.content ?? '',
          nonce: message.nonce ?? '',
          wrappedKey: message.wrapped_key ?? '',
          keyNonce: message.key_nonce ?? '',
        },
        key
      );
    } catch (error) {
      console.error('Unable to decrypt message:', error);
      return 'Message cannot be decrypted on this device';
    }
  }
  const headerOptions = () => {
    if (displayName) {
        navigation.setOptions({ headerTitle: displayName });
        // set button to edit chat room
        navigation.setOptions({
          headerRight: () => (
            <Pressable
              testID={automationLocatorsDataState.chatScreen.editChatRoomButton}
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
    }
  // Set navigation header
  useEffect(() => {
    headerOptions();
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
            if(newMsg?.data){
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
        channel.unsubscribe();
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
    if(conversation_id && messages?.length && messageToDelete) {
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

  //Forward text message with encryption
  const forwardTextMessage = async (messageToForward: Message, forwardConversationId: string) => {
    /*
      `content` is this room's ciphertext, so open it with this room's key before
      re-encrypting for the target. Not safeDecrypt: its fallback text would be
      forwarded as if it were the message.
    */
    if (!conversationKey) throw new Error('No conversation key for this room');
    const plainText = MessageEncryption.decryptMessage(
      {
        ciphertext: messageToForward.content ?? '',
        nonce: messageToForward.nonce ?? '',
        wrappedKey: messageToForward.wrapped_key ?? '',
        keyNonce: messageToForward.key_nonce ?? '',
      },
      conversationKey
    );

    // The target chat may never have been opened on this device, so fall back
    // to unwrapping its key from this user's participant row. Never mint one here.
    let forwardPartyKey = await getConversationKey(forwardConversationId);
    if (!forwardPartyKey && userId) {
      const lookup = await resolveConversationKey(forwardConversationId, userId);
      if (lookup.status === 'found') forwardPartyKey = lookup.key;
    }
    if (!forwardPartyKey) throw new Error('No conversation key for forward target');

    // Encrypt and send the forwarded message
    const encryptedMessage = MessageEncryption.encryptMessage(plainText, forwardPartyKey);
    const msg: Message = {
      conversation_id: forwardConversationId as string || '',
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
  };

  //Forward file or image message with file reference
  const forwardFileOrImageMessage = async (messageToForward: Message, forwardConversationId: string) => {
    //Forward the message first and get the id for the new conversation.
    const newFwdMessage: Message = {
      sender_id: userId,
      conversation_id: forwardConversationId as string || '',
      message_type: messageToForward?.message_type,
      content: messageToForward?.content,
      is_forward: true
    }
    // insert new message first
    const { data: dataFwdMsg, error: fwdError } = await messageAPI.forwardMessage(newFwdMessage)

    if (fwdError) throw fwdError;

    // Retrieve the files or images information to create reference in table files for new conversation.
    const {data: msg, error: msgError} = await messageAPI.getMessageWithFileOrImage(messageToForward?.id || '', conversation_id || '');

    if (msgError) throw msgError;

    if (msg?.files) {
      
      
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
        created_at: new Date().toISOString(),
        expiry_date: new Date(Date.now() + 60 * 60 * 24 * 365 * 1000).toISOString(), // 1 year
        status: true
      
      }

      //Insert a new message to new conversation.
      const { error: fwdFileError} = await filesAPI.insertFilesMessages(newFwdFileOrImage);
      

      if (fwdFileError) {
        console.warn('Error forwarding message', fwdFileError?.message);
        Alert.alert('Error', 'Failed to forward message to some recipients');
      }
    }
  };

  //Render message content based on type
  const renderMessageContent = (m: Message, url: string, data: Files | null, isCurrentUser: boolean) => {
    // Image message
    if (m?.message_type?.includes('image')) {
      if (url !== 'INACTIVE') {
        return (
          <Pressable
            onPress={() => {
              setActiveImageUrl(url);
              setModalVisible(true);
            }}
            onLongPress={() => {
              setShowReaction(true);
              setActiveMessage(m.id ?? '');
            }}
          >
            <Image
              source={{ uri: url }}
              className="w-48 h-48 rounded-lg"
              alt="image"
              onError={(e) => console.log('Image error:', e.nativeEvent.error)}
            />
          </Pressable>
        );
      }
      return <Text>File/ image not available</Text>;
    }

    // File message
    if (m?.message_type?.includes('file')) {
      return (
        <Link
          href={url as '/'}
          target="_blank"
          rel="noopener noreferrer"
        >
          <LinkText className={`${isCurrentUser ? 'text-white' : 'text-black'} text-xl`}>
            {data?.filename || ''}
          </LinkText>
          <Icon
            as={ArrowBigDown}
            size="lg"
            className={`mt-0.5 text-info-600 ${isCurrentUser ? 'text-white' : 'text-black'}`}
          />
        </Link>
      );
    }

    // Text message
    return (
      <Text
        className={`text-lg ${isCurrentUser ? 'text-white' : 'text-black'} font-semibold`}
      >
        {m?.message_type === 'text' ? safeDecrypt(m, conversationKey) : null}
      </Text>
    );
  };

  //Handle forward message
  const handleForwardMessage = async (recipientId: Array<string>) => {

    const messageToForward = messages.find((msg) => 
      msg.id === activeMessage && msg.conversation_id === conversation_id
    )

    if (!messageToForward?.id || !messageToForward.content || !recipientId) {
      Alert.alert('Error', 'Message or Recipient ID not available');
      return;
    }
    try {
      // Await every recipient so failures reach the catch below and the dialog
      // stays open (showing "Forwarding...") until the work is actually done.
      await Promise.all(recipientId.map(async (recipient) => {
        // get the conversation ID
        const conversation = await conversationAPI.verifyDMConversation(recipient);

        if (conversation?.data?.conversation_id) {
          if (messageToForward?.message_type === 'text') {
            await forwardTextMessage(messageToForward, conversation.data.conversation_id);
          } else {
            await forwardFileOrImageMessage(messageToForward, conversation.data.conversation_id);
          }
        }
      }));

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
      const encryptedMSG = MessageEncryption.encryptMessage(newMessage, conversationKey);
      // Check if editing or new message
      if(editingMessageId) {
        const { error } = await supabase
        .from('messages')
        .update({ 
          content: encryptedMSG.ciphertext, 
          nonce: encryptedMSG.nonce, 
          key_nonce: encryptedMSG.keyNonce, 
          wrapped_key: encryptedMSG.wrappedKey })
        .eq('id', editingMessageId)
        .eq('sender_id', userId);
        

        if (error) {
          console.warn('Error editing message', error.message);
          Alert.alert('Error', 'Failed to edit message');
        } else {
          setNewMessage('');
          setEditingMessageId(null);
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
      closeMessageActions();
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

  //Get decrypted message text or empty string
  const getDecryptedMessageText = (message: Message): string => {
    if (message.message_type === 'text') {
      return safeDecrypt(message, conversationKey);
    }
    return '';
  };

  //Get message preview for forwarding
  const getMessagePreview = (): string => {
    const activeMsg = messages.find((msg) => msg.id === activeMessage);
    
    if (activeMsg?.message_type === 'text') {
      return safeDecrypt(activeMsg, conversationKey);
    }
    
    return activeMsg?.content?.toUpperCase() || '';
  };

  return (
    <KeyboardAvoidingView
      behavior={'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 80}
      style={{ flex: 1 }}
    >
      <Box className={`relative flex-1 px-4 md:px-6 lg:px-8`} style={{ paddingTop: insets.top }}>
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
              const isSameSenderAsPrevious = previousMessage?.sender_id === m.sender_id;
              // Only show username if it's not the current user and sender is different from previous message
              const shouldShowUsername = !isCurrentUser && !isSameSenderAsPrevious;
              //console.log('Rendering message from:', m.displayname);
              let url: string = '';
              const data = m.files?.[0] ?? null;
          
              if(m?.files  && (m?.message_type?.includes('image')|| m?.message_type?.includes('file'))){
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
                  
                  {/* active message want to reaction or delete */}
                  {showReaction && activeMessage == m.id && (
                        <View onStartShouldSetResponder={() => true}
                              onResponderTerminationRequest={() => false}
                              onTouchEnd={(e) => { e.stopPropagation() }}>
                        <MessageAction 
                          messageId = {m.id}
                          msg_type = {m?.message_type || ''}
                          onReaction = {handleReaction}
                          isDarkMode = {isDarkMode === 'dark'}
                          onEdit={() => {
                            setNewMessage(getDecryptedMessageText(m));
                            setEditingMessageId(m?.id ?? null);
                            closeMessageActions();
                          }}
                          onForward={() => {
                            // An open keyboard swallows the first tap on a recipient
                            // and leaves stale padding on the input bar when it closes.
                            Keyboard.dismiss();
                            setShowReaction(false);
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
                          : 'bg-gray-200 rounded-bl-none'
                      }`}> 
                      {m.is_forward ? <Text><Icon as={ForwardIcon} size="md" className={`${isCurrentUser? 'text-white': 'text-gray-700'}`} /></Text> : null}
                      {renderMessageContent(m, url, data, isCurrentUser)}
                    </Box>
                  </Box>
                  {/*Reaction loading*/}
                  <Box
                    className={`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                  >
                    {m?.reactions?.map((r) => (
                        <Box key={r.id} className='z-40 mx-1'>
                          <Popover
                            isOpen = {activeReaction === m.id}
                            onClose = {() => setActiveReaction('')}
                            onOpen = {() => setActiveReaction(m.id ?? '')}
                            placement = "top"
                            size = "md"
                            trigger = {(triggerProps) => {
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
                                <Text>{r.sender_username}</Text>
                              </PopoverBody>
                            </PopoverContent>
                          </Popover>
                          
                        </Box>
                        
                      ))}
                  </Box>
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
        <AlertDialog
          isOpen={showDeleteDialog}
          onClose={() => {
            setShowDeleteDialog(false);
            setMessageToDelete(null);
            closeMessageActions();
          }}
          size="md">
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
                testID={automationLocatorsDataState.chatScreen.cancelDeleteMessageButton}
                variant="outline"
                action="secondary"
                onPress={() => {
                    setShowDeleteDialog(false)
                    setMessageToDelete(null);
                    closeMessageActions();
                  }}
                size="sm"
              >
                <ButtonText>Cancel</ButtonText>
              </Button>
              <Button testID={automationLocatorsDataState.chatScreen.confirmDeleteMessageButton} size="sm" onPress={() => {
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
            closeMessageActions();
          }}
          onForward = {(_message, recipientIds) => handleForwardMessage(recipientIds)}
          messagePreview = {getMessagePreview()}
        /> 
        {/* Input Bar - Fixed above keyboard */}
        <Box className={`absolute left-0 right-0 bottom-5 p-3 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} border-t `}>
          {showPicker && (
            <Picker
              native
              onSelect={(emo) => {
                setNewMessage((prev) => prev + emo.native);
              }}
              showPreview={false}
            />
          )}
          {editingMessageId && (
            <HStack space="sm" className="items-center justify-between mb-2 px-2">
              <Text className={`text-xs ${isDarkMode == "dark" ? 'text-gray-300' : 'text-gray-500'}`}>Editing message</Text>
              <Pressable testID={automationLocatorsDataState.chatScreen.cancelEditMessageButton} onPress={cancelEditing}>
                <Text className="text-xs text-blue-500">Cancel</Text>
              </Pressable>
            </HStack>
          )}
          <HStack space="sm" className="items-center">
            {/* Image Upload Button */}
            <Pressable testID={automationLocatorsDataState.chatScreen.picturePickerButton} onPress={pickImage} className="p-2 rounded-full bg-gray-100">
              <Text className="text-lg">🖼️</Text>
            </Pressable>

            {/* File Upload Button */}
            <Pressable testID={automationLocatorsDataState.chatScreen.filesPickerButton} onPress={pickFile} className="p-2 rounded-full bg-gray-100">
              <Text className="text-lg">📎</Text>
            </Pressable>

            <Input className="flex-1 rounded-full bg-gray-100 border border-gray-200">
              <InputField
                testID={automationLocatorsDataState.chatScreen.messageInput}
                className="text-black px-4"
                value={newMessage}
                onChangeText={setNewMessage}
                placeholder="Aa"
                placeholderTextColor="#9CA3AF"
              />
            </Input>

            <Pressable testID={automationLocatorsDataState.chatScreen.emojiPickerButton} onPress={() => setShowPicker(!showPicker)}>
              <Text style={{ fontSize: 20 }}>😀</Text>
            </Pressable>

            <Pressable
              testID={automationLocatorsDataState.chatScreen.sendButton}
              onPress={handleSend}
              disabled={!newMessage.trim() || loading || !conversationKey}
              className={`p-2 rounded-full ${
                newMessage.trim() && !loading && conversationKey
                  ? 'bg-blue-500'
                  : 'bg-gray-300'
              }`}
            >
              <Text className={`text-lg ${isDarkMode == "dark" ? 'text-black': 'text-white'}  font-bold`}>{loading ? '...' : '➤'}</Text>
            </Pressable>
          </HStack>
        </Box>
      </Box>
    </KeyboardAvoidingView>
  );
}
