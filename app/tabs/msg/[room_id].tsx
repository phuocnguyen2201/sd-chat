import React, { useEffect, useState, useRef } from 'react';
import { Image } from '@/components/ui/image';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { useLocalSearchParams, Link } from 'expo-router';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { supabase } from '@/utility/connection';
import { ScrollView, KeyboardAvoidingView, Platform, Pressable, Alert } from 'react-native';
import { useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { storageAPIs } from '@/utility/handleStorage';
import ZoomImage from '@/components/ZoomImage';
import { LinkText } from '@/components/ui/link';
import { ArrowBigDown } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import { useUser } from '@/utility/session/UserContext';
import { MessageEncryption } from '../../../utility/securedMessage/secured';
import { Picker } from "emoji-mart-native";
import { EmojiReaction } from '@/components/EmojiReaction';
import { reactionAPI } from '@/utility/messages';
import {
  Popover,
  PopoverBackdrop,
  PopoverArrow,
  PopoverBody,
  PopoverContent,
} from '@/components/ui/popover';

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string | null;
  message_type: string;
  content: string;
  nonce: string;
  wrapped_key: string;
  key_nonce: string;
  reactions: Array<Reaction>;
  created_at: string;
}
type Reaction = {
  id: string,
  sender_id: string,
  sender_username: string,
  emoji: string,
  message_id: string
}

export default function ChatScreen() {
  const { conversation_id, displayName, conversationKey, userId } = useLocalSearchParams() as { 
    conversation_id?: string, displayName?: string, conversationKey?: string, userId?: string 
  };

  const [avatarUrl, setAvatarUrl] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [showReaction, setShowReaction] = useState(false);
  const [activeMessage, setActiveMessage] = useState<string>('');
  const [handleDisplayTotalReaction, setHandleDisplayTotalReaction] = useState(false);

  const [loading, setLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const { user, profile } = useUser();

  const handleReaction = async (messageId: string, emoji: string) => {
   
    setShowReaction(false);
    const verify = await reactionAPI.verifyReaction(user?.id??'', messageId);
    if(!verify.data)
      await reactionAPI.insertReaction(user?.id?? '', profile?.displayname?? '', emoji, messageId);
    else
      await reactionAPI.updateReaction(user?.id?? '', emoji, messageId);
    
  };

  useEffect(() => {
    if (!conversation_id || !displayName) return;

    let isMounted = true;

      async function loadMessages() {
        const { data, error } = await supabase
          .rpc('get_messages_with_reactions',{convo_id: conversation_id}).limit(30);
        
        if (error) {
          console.warn('Error loading messages', error);
          return;
        }

        if (isMounted && data) setMessages(data as Message[]);
      }

      loadMessages();

      const channel = supabase.channel(`public:messages:conversation_id=eq.${conversation_id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversation_id}` }, (payload) => {
          const newMsg = payload.new as Message;
          setMessages((prev) => [...prev, newMsg]);
        })
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

  useEffect(() => {
    if (!scrollRef.current) return;
    setTimeout(() => {
      try {
        // @ts-ignore
        scrollRef.current?.scrollToEnd({ animated: true });
      } catch (e) {}
    }, 50);
  }, [messages.length]);

  async function handleSend() {
    if (!newMessage.trim() || !conversation_id) return;
    setLoading(true);

    let sender: string | null = null;
    try {
      sender = await user?.id ?? null;
    } catch (e) {
      sender = null;
    }

    const encryptedMSG = await MessageEncryption.encryptMessage(
      newMessage, 
      MessageEncryption.base64ToBytes(conversationKey ?? ''));


    const { data, error } = await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, 
        sender_id: sender, 
        content: encryptedMSG.ciphertext, 
        nonce: encryptedMSG.nonce, 
        key_nonce: encryptedMSG.keyNonce,
        wrapped_key: encryptedMSG.wrappedKey
      }])
      .select()
      .single();

    if (error) console.warn('Error sending message', error);

    setNewMessage('');
    setLoading(false);
  }

  async function pickImage() {
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
      const uri = result.assets[0].uri;
      const fileName = uri.split('/').pop() || 'image.jpg';
      setLoading(true);
      await storageAPIs.uploadImageToSupabase(uri, fileName, conversation_id, userId ?? null);
      setLoading(false);
    }
  }

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
      });

      if (result.assets && result.assets.length > 0 && conversation_id) {
        const file = result.assets[0];
        setLoading(true);
        await storageAPIs.uploadFileToSupabase(file.uri, file.name, conversation_id, userId ?? null);
        setLoading(false);
      }
    } catch (e) {
      Alert.alert('Permission Error', 'Unable to access files. Please check your permissions.');
      console.warn(e);
    }
  }

  const navigation = useNavigation();

  useEffect(() => {
    navigation.setOptions({ headerTitle: displayName});
  }, [navigation]);

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
                <Text className="text-gray-400 text-center">No messages yet — start a conversation!</Text>
              </Box>
            )}

            {messages.map((m) => {
              const isCurrentUser = m.sender_id === userId;
              //console.log(m.reactions)
              return (
              <Pressable key={m.id} onLongPress={() => {
                setShowReaction(true)
                setActiveMessage(m.id)
              }}>
                {/* active message want to reaction*/}
                {showReaction && (activeMessage == m.id) &&
                  (<EmojiReaction 
                    messageId={m.id} 
                    onSelect={ handleReaction }/>
                  )}
                <Box
                  key={m.id}
                  className={`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}
                >
                  <Box
                    className={`max-w-xs px-3 py-2 rounded-2xl ${
                      isCurrentUser
                        ? 'bg-blue-500 rounded-br-none'
                        : 'bg-gray-300 rounded-bl-none'
                    }`}
                  >
                    <ZoomImage image={avatarUrl} visible={modalVisible} onClose={() => setModalVisible(false)} />
                    {(m.message_type.includes('image') && m.content.includes('/storage/v1/object/sign/storage-msg/')) ? 
                      <Pressable onPress={() => {
                        setModalVisible(true);
                        setAvatarUrl(m.content);
                      }}><Image
                        source={{ uri: m.content}}
                        className="w-48 h-48 rounded-lg"
                        alt='image'
                      /></Pressable>
                     : (m.message_type.includes('file') && m.content.includes('/storage/v1/object/sign/chat-files/')) ?
                        <Link href={`${m.content}` as "/"} target="_blank" rel="noopener noreferrer">
                            <LinkText className='text-black text-xl'>Download file</LinkText>
                            <Icon as={ArrowBigDown} size="lg" className="mt-0.5 text-info-600 text-black" />
                        </Link>
                      : 
             
                        <Text
                          className={`text-lg ${
                            isCurrentUser ? 'text-white font-semibold' : 'text-black'
                          }`}
                        >
                        { 
                        MessageEncryption.decryptMessage({
                          ciphertext: m.content,
                          nonce: m.nonce,
                          wrappedKey: m.wrapped_key,
                          keyNonce: m.key_nonce,
                        },MessageEncryption.base64ToBytes(conversationKey??''))}
                        </Text>
                      }
                   
                  </Box>
                  
                </Box>
                <Box className={`flex-row mb-2 ${isCurrentUser ? 'justify-end' : 'justify-start'}`}>
                    {m.reactions.map((r) => (
                      <Box key={r.id}>
                        
                          <Popover
                            isOpen={activeMessage === m.id}
                            onClose={() => setActiveMessage('')}
                            onOpen={() => setActiveMessage(m.id)}
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
                                <Text className="text-typography-900">
                                  {r.sender_username}
                                </Text>
                              </PopoverBody>
                            </PopoverContent>
                           
                          </Popover>
                      </Box>
                      
                    
                  ))}</Box>
                </Pressable>
              );
            })}
          </VStack>
        </ScrollView>

        {/* Input Bar - Fixed above keyboard */}
        <Box className="absolute left-0 right-0 bottom-5 p-3 bg-white border-t border-gray-200">
          { showPicker && 
            (
              <Picker
              onSelect={(emo) =>{
                setNewMessage((prev) => prev + emo.native);
              }} 
                showPreview={false}
              />
            )
          }
          <HStack space="sm" className="items-center">
            {/* Image Upload Button */}
            <Pressable
              onPress={pickImage}
              className="p-2 rounded-full bg-gray-100"
            >
              <Text className="text-lg">🖼️</Text>
            </Pressable>

            {/* File Upload Button */}
            <Pressable
              onPress={pickFile}
              className="p-2 rounded-full bg-gray-100"
            >
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
              disabled={!newMessage.trim() || loading}
              className={`p-2 rounded-full ${
                newMessage.trim() && !loading ? 'bg-blue-500' : 'bg-gray-300'
              }`}
            >
              <Text className="text-white text-lg font-bold">
                {loading ? '...' : '➤'}
              </Text>
            </Pressable>
          </HStack>
        </Box>
      </Box>
    </KeyboardAvoidingView>
  );
}
