import React, { useEffect, useState, useRef } from 'react';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField, InputSlot } from '@/components/ui/input';
import { Button, ButtonText } from '@/components/ui/button';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Avatar, AvatarFallbackText } from '@/components/ui/avatar';
import { Heading } from '@/components/ui/heading';
import { supabase } from '@/utility/connection';
import { ScrollView, KeyboardAvoidingView, Platform, Pressable, Alert } from 'react-native';
import { ChevronLeftIcon, Icon } from '@/components/ui/icon';
import { useNavigation } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { MediaType } from 'expo-image-picker';
import { uploadImageToSupabase, uploadFileToSupabase } from '@/utility/handleStorage';
import { authAPI } from '@/utility/messages';
type Message = {
  id: string;
  room_id: string;
  sender_id: string | null;
  content: string;
  created_at: string;
}

export default function ChatScreen() {
  const { conversation_id, displayName, userId } = useLocalSearchParams() as { conversation_id?: string, displayName?: string, userId?: string };
  const [messages, setMessages] = useState<Message[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);


  useEffect(() => {
    if (!conversation_id || !displayName) return;

    let isMounted = true;

      async function loadMessages() {
        const { data, error } = await supabase
          .from('messages')
          .select('*')
          .eq('conversation_id', conversation_id)
          .order('created_at', { ascending: true }).limit(50);
        
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
    debugger;
    if (!newMessage.trim() || !conversation_id) return;
    setLoading(true);

    let sender: string | null = null;
    try {
      sender = await supabase.auth.getUser().then(({ data }) => data.user?.id) ?? null;
    } catch (e) {
      sender = null;
    }

    const { data, error } = await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: sender, content: newMessage }])
      .select()
      .single();

    if (error) console.warn('Error sending message', error);
    else if (data) {
      //setMessages((prev) => [...prev, data as Message]);
    }

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
      const response = await uploadImageToSupabase(uri, fileName, conversation_id, userId ?? null);
      setLoading(false);
      if (response.success) {
        Alert.alert('Success', response.message);
      } else {
        Alert.alert('Error', response.error);
      }
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
        const response = await uploadFileToSupabase(file.uri, file.name, conversation_id, userId ?? null);
        setLoading(false);
        if (response.success) {
          Alert.alert('Success', response.message);
        } else {
          Alert.alert('Error', response.error);
        }
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
              return (
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
                    <Text
                      className={`text-sm ${
                        isCurrentUser ? 'text-white font-semibold' : 'text-black'
                      }`}
                    >
                      {m.content}
                    </Text>
                  </Box>
                </Box>
              );
            })}
          </VStack>
        </ScrollView>

        {/* Input Bar - Fixed above keyboard */}
        <Box className="absolute left-0 right-0 bottom-5 p-3 bg-white border-t border-gray-200">
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
