
import { Avatar, AvatarBadge, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { supabase } from '@/utility/connection';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from '@/components/ui/text';
import { authAPI }  from '../../../utility/messages';
import { VStack } from '@/components/ui/vstack';
import { Pressable, ScrollView } from 'react-native';
import { Input, InputField } from '@/components/ui/input';

export default function Tab2() {

  const [ displayName, setDisplayName] = useState<string>('');
  const [ userId, setUserId ] = useState<string>('');
  const [ listUser, setListUser ] = useState<any>(null);
  const [ listChatRooms, setListChatRooms ] = useState<any>(null);
  const [ searchQuery, setSearchQuery ] = useState<string>('');

  useEffect(() => {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if(session && session.user){
          setUserId(session.user.id);
          authAPI.getCurrentUser().then(data => {
            if (data) {
              setDisplayName(data.data?.user?.displayname || 'Unknown User');
            }
            else{
              setDisplayName('Unknown User');
            }
          });

        }
      });
  }, []);

  return (
    <Box className="flex-1 bg-white pt-safe px-4 md:px-6 lg:px-8">
      {/* Header */}
      <Box className="bg-white border-b border-gray-200 pt-4 px-4 pb-3">
        <HStack className="justify-between items-center mb-4">
          <Heading size="xl" className="font-bold text-typography-900">Chats</Heading>
        </HStack>

        {/* Search Bar */}
        <Input className="rounded-full bg-gray-100 border-0">
          <InputField
            placeholder="Search Messenger"
            value={searchQuery}
            onChangeText={setSearchQuery}
            className="text-gray-700 px-4"
            placeholderTextColor="#9CA3AF"
          />
        </Input>
      </Box>

      {/* Users Horizontal Scroll */}
        <Box className="bg-white border-b border-gray-100 py-3">
          <HStack space="md" className="px-4">
            {listUser && listUser.map((user: any, index: number) => (
              <Pressable
                key={`${user.id}-${index}` || `user-${index}`}
                onPress={() => {}}
                className="items-center"
              >
                <Avatar size="lg" className="mb-2">
                  <AvatarFallbackText>{(user.display_name || 'U').slice(0,2)}</AvatarFallbackText>
                  <AvatarBadge className="bg-green-500" />
                </Avatar>
                <Text className="text-xs text-center max-w-[70px]" numberOfLines={1}>{user.display_name}</Text>
              </Pressable>
            ))}
          </HStack>
        </Box>

      {/* Conversations List */}
      <ScrollView className="flex-1 bg-background-50">
        <VStack space="xs" className="pb-6">
          {listChatRooms && listChatRooms.length > 0 ? (
            listChatRooms.map((room: any, index: number) => {
              const lastMsg = room.last_message || 'No messages yet';
              const time = room.updated_at ? new Date(room.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
              return (
                <Pressable
                  key={`${room.id}-${index}` || room.room_id || `room-${index}`}
                  onPress={() => {
                    router.push({
                      pathname: '../msg/[room_id]',
                      params: { room_id: room.room_id ?? room.id, displayName: room.display_name, userId: userId },
                    });
                  }}
                  className="flex-row items-center px-4 py-3 border-b border-gray-100 bg-white"
                >
                  <Box className="relative">
                    <Avatar size="lg" className="mr-3">
                      <AvatarFallbackText>{(room.display_name || 'U').slice(0,2)}</AvatarFallbackText>
                    </Avatar>
                    <Box className="absolute bottom-0 right-3 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />
                  </Box>

                  <Box className="flex-1">
                    <HStack className="justify-between items-center mb-1">
                      <Text className="font-semibold text-typography-900 text-base">{room.display_name}</Text>
                      <Text className="text-xs text-gray-500">{time}</Text>
                    </HStack>
                    <Text className="text-sm text-gray-600" numberOfLines={1}>{lastMsg}</Text>
                  </Box>
                </Pressable>
              );
            })
          ) : (
            <Box className="items-center mt-12">
              <Text className="text-gray-400 text-center">No conversations yet.</Text>
              <Text className="text-gray-400 text-center">Start chatting by selecting a user above!</Text>
            </Box>
          )}
        </VStack>
      </ScrollView>
    </Box>
  );
}
