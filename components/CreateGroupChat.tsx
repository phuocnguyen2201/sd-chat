import React, { useState, useEffect, use } from 'react';
import { Pressable, PressableProps, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Button, ButtonText } from '@/components/ui/button';
import { profileAPI } from '@/utility/messages';
import { SessionProvider, useSession } from '@/utility/session/SessionProvider';

type CreateGroupChat = {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (name: string, recipientIds: string[]) => Promise<void> | void;
};

type UserProfile = {
  id: string;
  username?: string;
  displayname?: string;
  avatar_url?: string | null;
};

export default function ForwardMessage({
  isOpen,
  onClose,
  onCreate,
}: CreateGroupChat) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupChatName, setGroupChatName] = useState<string[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { user , profile}  = useSession();
  useEffect(() => {
    if (!isOpen) return;
    let mounted = true;
    const load = async () => {
      setLoadingProfiles(true);
      const { data, error } = await profileAPI.getAllProfiles();
      if (!mounted) return;
      if (error) {
        setError('Failed to load users');
        setProfiles([]);
      } else {
        setProfiles(data as UserProfile[] || []);
      }
      setLoadingProfiles(false);
      // Auto-select current user
      if (profile && profile.id) {
        setSelected([profile.id]);
        setGroupChatName([profile.displayname || profile.username || '']);
      }
    };
    load();
    return () => {
        mounted = false;
        setProfiles([]);
        setSelected([]);
        setGroupChatName([]);
    };
  }, [isOpen, profile]);
  
  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
    setGroupChatName(prev => {
      const profile = profiles.find(p => p.id === id);
      if (profile) {
        return [...prev, profile.displayname || profile.username || ''];
      }
      return prev;
    });
  };

  const handleForward = async () => {
    if (selected.length === 0) {
      setError('Please select at least one recipient');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
    await onCreate(groupChatName.join(', ') || 'My Group Chat', selected);
      onClose();
    } catch (e) {
      setError('Failed to create group chat');
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <Pressable
        className="absolute inset-0 z-40"
        onPress={onClose}
        style={{ pointerEvents: 'auto' }}
      />

      <Box className="absolute left-4 right-4 top-20 bg-white rounded-lg shadow-lg z-50 p-4">
        <Text className="text-lg font-semibold mb-2">Create Group Chat</Text>

        <Text className="text-sm text-gray-600 mb-2">Choose recipients</Text>
        <Box>
            <ScrollView style={{ maxHeight: 150 }} className="mb-4">
                <VStack space="sm" className="mb-3">
                    {loadingProfiles ? (
                        <Text>Loading...</Text>
                    ) : (
                        profiles.map((p) => {
                        const isSelected = selected.includes(p.id);
                        return (
                            <Pressable
                                key={p.id}
                                onPress={() => toggleSelect(p.id)}
                                className={`p-2 rounded-lg ${isSelected ? 'bg-blue-100' : 'bg-white'}`}
                                >
                                <Text className="text-sm font-medium">{p.displayname || p.username}</Text>
                                <Text className="text-xs text-gray-500">@{p.username}</Text>
                            </Pressable>
                        );
                        })
                    )}
                </VStack>
            </ScrollView>
        </Box>

        {error && <Text className="text-red-500 mb-2">{error}</Text>}

        <HStack space="sm" className="justify-end">
          <Button variant="outline" action="secondary" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button size="sm" onPress={handleForward} disabled={submitting || selected.length === 0}>
            <ButtonText>{submitting ? 'Creating...' : `Create Group (${selected.length})`}</ButtonText>
          </Button>
        </HStack>
      </Box>
    </>
  );
}
