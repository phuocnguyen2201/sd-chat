
import { Avatar, AvatarBadge, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from '@/components/ui/text';
import { authAPI, conversationAPI, profileAPI, realtimeAPI }  from '@/utility/messages';
import { VStack } from '@/components/ui/vstack';
import { Pressable, ScrollView, StatusBar } from 'react-native';
import { Input, InputField } from '@/components/ui/input';
import { useUser } from '@/utility/session/UserContext';
import { usePushNotifications } from '@/utility/push-notification/push-Notification';
import * as Notifications from 'expo-notifications';
import { MessageEncryption } from '@/utility/securedMessage/secured';


export default function Tab2() {

  const [ userId, setUserId ] = useState<string>('');
  const [ listUser, setListUser ] = useState<any>(null);
  const [ listChatRooms, setListChatRooms ] = useState<any>(null);

  const [ searchQuery, setSearchQuery ] = useState<string>('');
  const { user, profile, refreshProfile } = useUser();

  const [ pushNoficationUser, setPushNotificationUser ] = useState<any>(null);

  const [ filteredChatRooms, setFilteredChatRooms ] = useState<any>([]);
  const [ filteredUsers, setFilteredUsers ] = useState<any>([]);

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
  const fetchUsers = async () => {
    const { data } = await profileAPI.getAllProfiles();
    setListUser(data || []);
  };
  const fetchChatRooms = async () => {
    const { data } = await conversationAPI.getConversations();
    setListChatRooms(data || []);
  };
  const fetchUserProfile = async () => {
    if(user) {
      setUserId(user.id);
    }
  }
  const handlePushNotification = async () => {

    if(profile?.fcm_token) {
      //console.log('Push token already exists:', profile.fcm_token);
      return;
    }

    const token = await usePushNotifications.registerForPushNotificationsAsync();
    //console.log('Push Notification Token:', token);
    if (token) {
      await usePushNotifications.savePushTokenToDatabase(token);
      //console.log('Push token saved to database');
    }
  };

  useEffect(() => {

    handlePushNotification();
    fetchChatRooms();
    fetchUsers();
    fetchUserProfile();


    const subscription = realtimeAPI.subscribeToConversations(userId, (newConversation) => {
      setListChatRooms((prevRooms: any) => [newConversation, ...prevRooms]);
    });

    const notificationListener = Notifications.addNotificationReceivedListener(notification => {

      fetchChatRooms();

    });

    const responseListener = Notifications.addNotificationResponseReceivedListener(response => {
      //console.log('Notification response received:', response.notification.request.content.data);
     // console.log('message', response.notification.request.content.body);
      router.push({
        pathname: '../msg/[room_id]',
        params: { conversation_id: response.notification.request.content.data.conversation_id as string, 
          displayName: response.notification.request.content.data.displayname as string,
          userId: userId
           },
      });
    });

    return () => {
      subscription.unsubscribe();
      notificationListener.remove();
      responseListener.remove();
    }
  }, []);
  
  useEffect(() => {
    if (!profile?.avatar_url || !profile?.displayname || !profile?.public_key) {
      refreshProfile();
    }
  }, [profile]);

  // Update filtered lists when search query, users, chat rooms or userId change
  useEffect(() => {
    // Users: exclude current user and optionally filter by displayname
    if (listUser && Array.isArray(listUser)) {
      if (searchQuery === '' || searchQuery.trim() === '') {
        setFilteredUsers(listUser.filter((u: any) => u.id !== userId));
      } else {
        const q = searchQuery.toLowerCase();
        setFilteredUsers(listUser.filter((u: any) => u.id !== userId && (u.displayname || '').toLowerCase().includes(q)));
      }
    } else {
      setFilteredUsers([]);
    }

    // Chat rooms: filter by participant name or last message
    if (listChatRooms && Array.isArray(listChatRooms)) {
      if (searchQuery === '' || searchQuery.trim() === '') {
        setFilteredChatRooms(listChatRooms);
      } else {
        const q = searchQuery.toLowerCase();
        setFilteredChatRooms(listChatRooms.filter((room: any) => {
          const p0 = room.conversation_participants?.[0]?.profiles?.displayname || '';
          const p1 = room.conversation_participants?.[1]?.profiles?.displayname || '';
          const participantName = (room.conversation_participants?.[1]?.profiles?.id == userId) ? p0 : p1;
          const lastMsg = room.messages?.length > 0 ? room.messages[room.messages.length - 1].content : '';
          return participantName.toLowerCase().includes(q) || (lastMsg || '').toLowerCase().includes(q);
        }));
      }
    } else {
      setFilteredChatRooms([]);
    }
  }, [searchQuery, listUser, listChatRooms, userId]);

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
      
        <Box className='flex-1'>
          <Box className="bg-white border-b border-gray-100 py-3">
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <HStack space="md" className="px-4">
              {filteredUsers && filteredUsers.map((user: any, index: number) => (
                <Pressable className="pr-4 items-center"
                  key={`${user.id}-${index}` || `user-${index}`}
                  onPress={async () => {

                    const existing = await conversationAPI.verifyDMConversation(user.id);
                    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
                    let conversationId: string = '';
                    
                    if (existing.data?.conversationId && guidRegex.test(existing.data?.conversationId[0]?.conversation_id)) {
                      // Use existing conversation
                      conversationId = existing.data?.conversationId[0]?.conversation_id;
                    } else {
                      // Create new conversation
                      console.log('Do they still get in')
                      const newConversation = await conversationAPI.getOrCreateDM(user.id);
                      
                      if (newConversation.data?.conversationId && guidRegex.test(newConversation.data.conversationId)) {
                        conversationId = newConversation.data.conversationId;
                        
                        // Check if both users have valid public keys
                        if (!user.public_key || !profile?.public_key) {
                          console.error('Missing public keys:', { userKey: !!user.public_key, profileKey: !!profile?.public_key });
                          alert('Encryption keys not found. Please complete your profile setup.');

                          return;
                        }

                        // Validate key sizes
                        const recipientKeyBytes = MessageEncryption.base64ToBytes(user.public_key);
                        //const currnetUserKeyBytes = MessageEncryption.base64ToBytes(profile.public_key)
                        
                        if (recipientKeyBytes.length !== 32) {
                          console.error('Invalid key sizes:', { 
                            recipient: recipientKeyBytes.length, 
                                                  
                          });
                          alert('Invalid encryption keys detected. Please contact support.');
                          return;
                        }
                        
                        // Prepare encryption keys for the new conversation
                        const conversationKey = await MessageEncryption.createConversationKey();

                        // Wrap the conversation key for both participants
                        const wrappedKeyDataRecipient = await MessageEncryption.wrapConversationKey(
                          conversationKey,
                          recipientKeyBytes
                        );

                        if (wrappedKeyDataRecipient) {
                          // Save the wrapped key and nonce to the database
                          await conversationAPI.storeConversationKey(
                            conversationId,
                            user.id,
                            MessageEncryption.bytesToBase64(wrappedKeyDataRecipient.wrappedKey),
                            MessageEncryption.bytesToBase64(wrappedKeyDataRecipient.nonce),
                            profile?.public_key
                          );
                        }

                    }
                  }
                  
                    router.push({
                      pathname: '../msg/[room_id]',
                      params: { conversation_id: conversationId, 
                        displayName: user.displayname,
                        public_key: user.public_key,
                        userId: user.id },
                    });
                  }}
                >
                  <Avatar size="lg" className="mb-2">
                    <AvatarFallbackText>{(user.displayname || 'U').slice(0,2)}</AvatarFallbackText>
                    <AvatarImage source={{ uri: user.avatar_url || undefined }} />
                    <AvatarBadge className="bg-green-500" />
                  </Avatar>
                  <Text className="text-xs text-center max-w-[70px]" numberOfLines={1}>{user.displayname}</Text>
                </Pressable>
              ))}
            </HStack>
          </ScrollView>
        </Box>
      
      {/* Conversations List */}
      <Box className='flex-1'>
        <ScrollView showsVerticalScrollIndicator={true} contentContainerStyle={{ flexGrow: 1 }}>
          <VStack space="xs" className="pb-6">
            {filteredChatRooms && filteredChatRooms.length > 0 ? (
              filteredChatRooms.map((room: any, index: number) => {
                const participantNames = room.conversation_participants[1]?.profiles.id == userId ? room.conversation_participants[0]?.profiles.displayname : room.conversation_participants[1]?.profiles.displayname;
                const participantAvatar = room.conversation_participants[1]?.profiles.id == userId ? room.conversation_participants[0]?.profiles.avatar_url : room.conversation_participants[1]?.profiles.avatar_url;
                const lastMsg = room.messages?.length > 0 ? room.messages[room.messages.length - 1].content : 'No messages yet';
                const time = room.updated_at ? new Date(room.updated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
                
                return (
                  <Pressable
                    key={`${room.id}-${index}` || room.conversation_id || `room-${index}`}
                    onPress={() => {
                      router.push({
                        pathname: '../msg/[room_id]',
                        params: { conversation_id: room.id, displayName: participantNames, userId: userId },
                      });
                    }}
                    className="flex-row items-center px-4 py-3 border-b border-gray-100 bg-white"
                  >
                    <Box className="relative">
                      <Avatar size="lg" className="mr-3">
                        <AvatarFallbackText>{(room.conversation_participants[1]?.profiles.displayname || 'U').slice(0,2)}</AvatarFallbackText>
                        <AvatarImage source={{ uri: participantAvatar || undefined }} />
                      </Avatar>
                      <Box className="absolute bottom-0 right-3 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />
                    </Box>

                    <Box className="flex-1">
                      <HStack className="justify-between items-center mb-1">
                        <Text className="font-semibold text-typography-900 text-base">{participantNames}</Text>
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
      </Box>
      
      
    </Box>
  );
}
