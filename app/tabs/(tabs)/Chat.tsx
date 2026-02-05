import { Avatar, AvatarBadge, AvatarFallbackText, AvatarImage } from '@/components/ui/avatar';
import { Box } from '@/components/ui/box';
import { Heading } from '@/components/ui/heading';
import { HStack } from '@/components/ui/hstack';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text } from '@/components/ui/text';
import { conversationAPI, profileAPI, realtimeAPI } from '@/utility/messages';
import { VStack } from '@/components/ui/vstack';
import { Pressable, ScrollView, Alert } from 'react-native';
import { Input, InputField } from '@/components/ui/input';
import { useSession } from '@/utility/session/SessionProvider';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { ConversationKeyManager } from '../../../utility/securedMessage/ConversationKeyManagement';
import * as Notifications from 'expo-notifications';
import { PlusCircleIcon } from 'lucide-react-native';
import { Icon } from '@/components/ui/icon';
import CreateGroupChat from '@/components/CreateGroupChat';

/**
 * Chat Tab Screen
 * 
 * Displays list of conversations and users.
 * Uses SessionProvider for conversation key management.
 * No push notification logic - handled by Bootstrap.
 */
export default function Chat() {
  const { user, profile, setCurrentConversation } = useSession();
  const userId = user?.id ?? '';

  const [listUser, setListUser] = useState<any>(null);
  const [listChatRooms, setListChatRooms] = useState<any>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [filteredChatRooms, setFilteredChatRooms] = useState<any>([]);
  const [filteredUsers, setFilteredUsers] = useState<any>([]);
  const [newChat, setNewChat] = useState<string>('');

  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false);

  const fetchUsers = async () => {
    try {
      const { data } = await profileAPI.getAllProfiles();
      setListUser(data || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const fetchChatRooms = async () => {
    try {
      const { data } = await conversationAPI.getConversations();
      setListChatRooms(data || []);
    } catch (error) {
      console.error('Error fetching chat rooms:', error);
    }
  };

  // Create a new group chat
  const createGroupChat = async (name: string, recipientIds: string[]) => {
    try {

      // create group conversation ID
      const { data, error } = await conversationAPI.createGroupConversation(name , userId, recipientIds);

      // Generate group conversation key
      const conversationKey = await MessageEncryption.createConversationKey();

      // Retrieve public keys for all recipients
      const { data: publicKeys, error: storeKeyError } = await profileAPI.getParticipantsPublicKey(recipientIds);

      // Get group creator public key
      const groupCreatorPublicKey = profile?.public_key || publicKeys?.find((pk: any) => pk.id === userId)?.public_key || null;
      
      // Error handling

      if (error) {
        throw new Error(error.message || 'Failed to create group chat');
      }

      if (!data || !data.conversation_id) {
        throw new Error('Invalid conversation data received');
      }

      if (storeKeyError) {
        throw new Error(storeKeyError.message || 'Failed to retrieve public keys for recipients');
      }

      if (!publicKeys) {
        throw new Error('No public keys found for the selected recipients');
      }

      if (!groupCreatorPublicKey) {
        throw new Error('Group creator public key not found');
      }

      // Wrap and store the conversation key for each recipient
      for (const pkEntry of publicKeys || []) {
        const recipientId = pkEntry.id;
        const public_key = pkEntry.public_key;

        if (!public_key) {
          console.warn(`Public key not found for user ${recipientId}, skipping key storage.`);
          continue;
        }

        /*  Wrap the conversation key for each participant
          for example:
          Current user also the creator of the group chat:
          - User A (creator): private_key_A + public_key_A
          - User B: private_key_A + public_key_B
          - User C: private_key_A + public_key_C
        */ 

        const wrappedKeyForEachParticipants = await MessageEncryption.wrapConversationKey(
          conversationKey,
          MessageEncryption.base64ToBytes(public_key || '')
        );

        if (wrappedKeyForEachParticipants) {
          // Store the wrapped key and nonce to the database for current user
          await conversationAPI.storeConversationKey(
            data.conversation_id,
            recipientId,
            MessageEncryption.bytesToBase64(wrappedKeyForEachParticipants.wrappedKey),
            MessageEncryption.bytesToBase64(wrappedKeyForEachParticipants.nonce),
            recipientId === userId ? groupCreatorPublicKey : public_key,
          );
        }
      }

      // Store the conversation key for the current user
      await ConversationKeyManager.setConversationKey(data.conversation_id, conversationKey);

      router.push({
        pathname: '../msg/[room_id]',
        params: {
          conversation_id: data.conversation_id,
          displayName: name || 'Group Chat',
          conversationKey: MessageEncryption.bytesToBase64(conversationKey)
        },
      });

      return data;
    } catch (error) {
      console.error('Error creating group chat:', error);
      return null;
    }
  };

  const getConversationKeyForOtherParticipants = async (
    public_key: string,
    conversationId: string
  ): Promise<Uint8Array | null> => {
    try {
      // Check cache first
      const cached = await ConversationKeyManager.getKey(conversationId);
      if (cached) {
        return cached;
      }

      // Convert public key
      const publicKey = MessageEncryption.base64ToBytes(public_key);

      const getWrappedKey = await conversationAPI.getWrappedKeyCurrent(conversationId, userId);

      if (!getWrappedKey.data?.[0]?.wrapped_key || !getWrappedKey.data?.[0]?.key_nonce) {
        console.error('Missing wrapped key data');
        return null;
      }

      const wrapped = MessageEncryption.base64ToBytes(getWrappedKey.data[0].wrapped_key);
      const key_nonce = MessageEncryption.base64ToBytes(getWrappedKey.data[0].key_nonce);

      const conversationKey = await MessageEncryption.unwrapConversationKey(
        wrapped,
        key_nonce,
        publicKey
      );

      // Store in cache and secure storage
      await ConversationKeyManager.setConversationKey(conversationId, conversationKey);
      return conversationKey;
    } catch (error) {
      console.error('Error getting conversation key:', error);
      return null;
    }
  };

  useEffect(() => {    
    const notificationListener = Notifications.addNotificationReceivedListener((notification) => {
        //console.log('Notification received in Chat tab:', notification.request.content.data);
      fetchChatRooms();
    });

    const responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data;
      const conversationId = data?.conversation_id as string;
      const displayName = data?.displayname as string;
      const public_key = data?.public_key as string;

      if (conversationId && user?.id) {
        router.push({
          pathname: '/tabs/msg/[room_id]',
          params: {
            conversation_id: conversationId,
            displayName: displayName || 'Chat',
            public_key: public_key || '',
            room_id: conversationId,
          },
        });
      }
    });

    return () => {
        notificationListener.remove();
        responseListener.remove();
    }


    }, []);

  // Load data on mount
  useEffect(() => {
    if (!userId) return;

    fetchChatRooms();
    fetchUsers();

    const subscription = realtimeAPI.subscribeToConversations(userId, (newConversation) => {
      setListChatRooms((prevRooms: any) => [newConversation, ...prevRooms]);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [userId]);

  // Refresh list chat if new conversation has been created
  useEffect(() => {
    if (newChat !== '') {
      //fetchChatRooms();
    }
  }, [newChat]);

  // Update filtered lists when search query, users, chat rooms or userId change
  useEffect(() => {
    // Users: exclude current user and optionally filter by displayname
    if (listUser && Array.isArray(listUser)) {
      if (searchQuery === '' || searchQuery.trim() === '') {
        setFilteredUsers(listUser.filter((u: any) => u.id !== userId));
      } else {
        const q = searchQuery.toLowerCase();
        setFilteredUsers(
          listUser.filter(
            (u: any) => u.id !== userId && (u.displayname || '').toLowerCase().includes(q)
          )
        );
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
        setFilteredChatRooms(
          listChatRooms.filter((room: any) => {
            const p0 = room.conversation_participants?.[0]?.profiles?.displayname || '';
            const p1 = room.conversation_participants?.[1]?.profiles?.displayname || '';
            const participantName =
              room.conversation_participants?.[1]?.profiles?.id == userId ? p0 : p1;
            const lastMsg =
              room.messages?.length > 0 ? room.messages[room.messages.length - 1].content : '';
            return (
              participantName.toLowerCase().includes(q) ||
              (lastMsg || '').toLowerCase().includes(q)
            );
          })
        );
      }
    } else {
      setFilteredChatRooms([]);
    }
  }, [searchQuery, listUser, listChatRooms, userId]);

  const handleUserPress = async (users: any) => {
    if (!userId || !profile) {
      Alert.alert('Error', 'User session not available');
      return;
    }

    try {
      const existing = await conversationAPI.verifyDMConversation(users.id);
      const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      let conversationId: string = '';

      //console.log('Existing conversation check:', existing);
      if (existing.data?.conversation_id && guidRegex.test(existing.data?.conversation_id)) {
        // Use existing conversation
        conversationId = existing.data.conversation_id;
        // Fetch and cache the key
        const key = await getConversationKeyForOtherParticipants(users.public_key, conversationId);
        if (key) {
          await setCurrentConversation(conversationId, key);
        }
      } else {
        // Create new conversation
        const newConversation = await conversationAPI.getOrCreateDM(users.id);
        //setNewChat(newConversation.data?.conversationId ?? '');

        if (
          newConversation.data?.conversationId &&
          guidRegex.test(newConversation.data.conversationId)
        ) {
          conversationId = newConversation.data.conversationId;

          // Check if both users have valid public keys
          if (!users.public_key || !profile.public_key) {
            Alert.alert(
              'Error',
              'Encryption keys not found. Please complete your profile setup.'
            );
            return;
          }

          // Validate key sizes
          const recipientKeyBytes = MessageEncryption.base64ToBytes(users.public_key);

          if (recipientKeyBytes.length !== 32) {
            Alert.alert('Error', 'Invalid encryption keys detected. Please contact support.');
            return;
          }

          // Create and store the conversation key
          const conversationKey = await MessageEncryption.createConversationKey();

          // Wrap the conversation key for the recipient
          const wrappedKeyDataRecipient = await MessageEncryption.wrapConversationKey(
            conversationKey,
            recipientKeyBytes
          );

          if (wrappedKeyDataRecipient) {
            // Save the wrapped key and nonce to the database
            await conversationAPI.storeConversationKey(
              conversationId,
              users.id,
              MessageEncryption.bytesToBase64(wrappedKeyDataRecipient.wrappedKey),
              MessageEncryption.bytesToBase64(wrappedKeyDataRecipient.nonce),
              profile.public_key
            );
          }
          // Store in cache and secure storage via SessionProvider
          await setCurrentConversation(conversationId, conversationKey);
        } else {
          Alert.alert('Error', 'Failed to create or retrieve conversation');
          return;
        }
      }

      // Navigate to chat room (key is now in session context)
      router.push({
        pathname: '../msg/[room_id]',
        params: {
          conversation_id: conversationId,
          displayName: users.displayname || 'User',
        },
      });
    } catch (error) {
      console.error('Error handling user press:', error);
      Alert.alert('Error', 'Failed to start conversation');
    }
  };

  const handleConversationPress = async (room: any) => {
    if (!userId) {
      Alert.alert('Error', 'User session not available');
      return;
    }

    try {
      const isGroup = room.is_group || false;
      const data = room.conversation_participants || [];
      const groupChatName = room?.name??'';
      const groupChatCreatorId = room?.created_by || '';
      let otherPublicKey = null;

      if(isGroup) {
        // For group chat, we may need to handle differently in future
        otherPublicKey = data?.filter((participant: any) => participant.profiles?.id === groupChatCreatorId)?.[0]?.profiles?.public_key || null;
      }
      else{
        otherPublicKey = 
            data?.[1]?.profiles?.id == userId
            ? data?.[0]?.profiles?.public_key
            : data?.[1]?.profiles?.public_key;
      }
      const conversationKeyBytes = await getConversationKeyForOtherParticipants(
          otherPublicKey,
          room.id
        );

     //console.log('Other participant public key:', otherPublicKey);
      if (!otherPublicKey) {
        Alert.alert('Error', 'Unable to load conversation key');
        return;
      }
      
      //console.log('Failed here');
      if (!conversationKeyBytes) {
        Alert.alert('Error', 'Failed to retrieve conversation key');
        return;
      }

      // Set in session context
      await setCurrentConversation(room.id, conversationKeyBytes);

      const participantNames =
        room.conversation_participants?.[1]?.profiles?.id == userId
          ? room.conversation_participants?.[0]?.profiles?.displayname
          : room.conversation_participants?.[1]?.profiles?.displayname;

      // Navigate to chat room (key is now in session context)
      router.push({
        pathname: '../msg/[room_id]',
        params: {
          conversation_id: room.id,
          displayName: groupChatName !='' ? groupChatName : participantNames || 'Chat',
        },
      });
    } catch (error) {
      console.error('Error handling conversation press:', error);
      Alert.alert('Error', 'Failed to open conversation');
    }
  };

  if (!userId) {
    return (
      <Box className="flex-1 bg-white items-center justify-center">
        <Text className="text-gray-400">Please log in to view chats</Text>
      </Box>
    );
  }

  return (
    <Box className="flex-1 bg-white pt-safe px-4 md:px-6 lg:px-8">
      {/* Header */}
      <Box className="bg-white border-b border-gray-200 pt-4 px-4 pb-3">
        <HStack className="justify-between items-center mb-4">
          <Heading size="xl" className="font-bold text-typography-900">
            Chats
          </Heading>
          <Pressable 
            onPress={() => setShowCreateGroupModal(true)}>
            <Icon
              as={PlusCircleIcon}
              size="lg"
              className="mt-0.5 text-info-600 text-black"/>
          </Pressable>
        </HStack>

        {/* Create group modal */}
        {showCreateGroupModal && (
          <CreateGroupChat
            isOpen={showCreateGroupModal}
            onClose={() => setShowCreateGroupModal(false)}
            onCreate={async (name, recipientIds) => {
              // After creating group chat, refresh chat rooms
              //console.log('Creating group chat with name:', name, 'and recipients:', recipientIds);
              createGroupChat(name, recipientIds);
            }}
          />
        )}

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
      <Box className="flex-1">
        <Box className="bg-white border-b border-gray-100 py-3">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <HStack space="md" className="mr-4">
              {filteredUsers &&
                filteredUsers.map((users: any, index: number) => (
                  <Pressable
                    className="pr-4 items-center"
                    key={`${users.id}-${index}` || `user-${index}`}
                    onPress={() => handleUserPress(users)}
                  >
                    <Avatar size="lg" className="mb-2">
                      <AvatarFallbackText>
                        {(users.displayname || 'U').slice(0, 2)}
                      </AvatarFallbackText>
                      <AvatarImage
                        source={{ uri: users.avatar_url || undefined }}
                        style={{ width: 40, height: 40 }}
                      />
                      <AvatarBadge className="bg-green-500" />
                    </Avatar>
                    <Text className="text-xs text-center max-w-[70px]" numberOfLines={1}>
                      {users.displayname || 'U'}
                    </Text>
                  </Pressable>
                ))}
            </HStack>
          </ScrollView>
        </Box>

        {/* Conversations List */}
        <Box className="flex-1">
          <ScrollView
            showsVerticalScrollIndicator={true}
            contentContainerStyle={{ flexGrow: 1 }}
          >
            <VStack space="xs" className="pb-6">
              {filteredChatRooms && filteredChatRooms.length > 0 ? (
                filteredChatRooms.map((room: any, index: number) => {

                  // if group chat, show group name
                  const groupChatName = room?.name??'';

                  const groupAvatar = room?.avatar_url?? '';

                  // Determine participant info
                  const participantNames =
                    room.conversation_participants?.[1]?.profiles?.id == userId
                      ? room.conversation_participants?.[0]?.profiles?.displayname
                      : room.conversation_participants?.[1]?.profiles?.displayname;

                  // if group chat, show group avatar
                  const participantAvatar =
                    room.conversation_participants?.[1]?.profiles?.id == userId
                      ? room.conversation_participants?.[0]?.profiles?.avatar_url
                      : room.conversation_participants?.[1]?.profiles?.avatar_url;

                  // Get last message info
                  const lastMsg =
                    room.messages?.length > 0
                      ? room.messages[room.messages.length - 1].content
                      : 'No messages yet';

                  // Get message type
                  const msg_type = room.messages?.[0]?.message_type ?? 'Text';

                  // Format time
                  const time = room.updated_at
                    ? new Date(room.updated_at).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '';

                  return (
                    <Pressable
                      key={`${room.id}-${index}` || room.conversation_id || `room-${index}`}
                      onPress={() => handleConversationPress(room)}
                      className="flex-row items-center px-4 py-3 border-b border-gray-100 bg-white"
                    >
                      <Box className="relative">
                        <Avatar size="lg" className="mr-3">
                          <AvatarFallbackText>
                            {(groupChatName != ''? groupChatName : room.conversation_participants?.[1]?.profiles?.displayname || 'U').slice(
                              0,
                              2
                            )}
                          </AvatarFallbackText>
                          <AvatarImage source={{ uri: groupChatName != ''? groupAvatar : participantAvatar || undefined }} />
                        </Avatar>
                        <Box className="absolute bottom-0 right-3 w-3.5 h-3.5 bg-green-500 rounded-full border-2 border-white" />
                      </Box>

                      <Box className="flex-1">
                        <HStack className="justify-between items-center mb-1">
                          <Text className="font-semibold text-typography-900 text-base">
                            {groupChatName != '' ? groupChatName : participantNames}
                          </Text>
                          <Text className="text-xs text-gray-500">{time}</Text>
                        </HStack>
                        <Text className="text-sm text-gray-600" numberOfLines={1}>
                          {msg_type == 'image'
                            ? 'Image'
                            : msg_type == 'file'
                            ? 'Download'
                            : lastMsg}
                        </Text>
                      </Box>
                    </Pressable>
                  );
                })
              ) : (
                <Box className="items-center mt-12">
                  <Text className="text-gray-400 text-center">No conversations yet.</Text>
                  <Text className="text-gray-400 text-center">
                    Start chatting by selecting a user above!
                  </Text>
                </Box>
              )}
            </VStack>
          </ScrollView>
        </Box>
      </Box>
    </Box>
  );
}
