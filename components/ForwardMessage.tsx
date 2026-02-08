import React, { useState, useEffect } from 'react';
import { Pressable, PressableProps, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Input, InputField } from '@/components/ui/input';
import { HStack } from '@/components/ui/hstack';
import { Button, ButtonText } from '@/components/ui/button';
import { profileAPI } from '@/utility/messages';
import { Scroll } from 'lucide-react-native';

type ForwardMessageProps = {
  isOpen: boolean;
  messagePreview?: string; // decrypted/plaintext message preview
  onClose: () => void;
  onForward: (message: string, recipientIds: string[]) => Promise<void> | void;
};

type UserProfile = {
  id: string;
  username?: string;
  displayname?: string;
  avatar_url?: string | null;
};

export default function ForwardMessage({
  isOpen,
  messagePreview = '',
  onClose,
  onForward,
}: ForwardMessageProps) {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    };
    load();
    return () => {
      mounted = false;
      setProfiles([]);
      setSelected([]);
    };
  }, [isOpen]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]));
  };

  const handleForward = async () => {
    if (selected.length === 0) {
      setError('Please select at least one recipient');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onForward(messagePreview, selected);
      onClose();
    } catch (e) {
      setError('Failed to forward message');
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

      <Box className="absolute left-4 right-4 bottom-28 bg-white rounded-lg shadow-lg z-50 p-4">
        <Text className="text-lg font-semibold mb-2">Forward Message</Text>

        {/* Message preview */}
        <Box className="mb-3 p-3 bg-gray-50 rounded">
          <Text className="text-sm text-gray-800">{messagePreview || '—'}</Text>
        </Box>

        <Text className="text-sm text-gray-600 mb-2">Choose recipients</Text>
        <Box>
            <ScrollView style={{ maxHeight: 150 }} className="mb-3" horizontal>
                <HStack space="sm" className="mb-3">
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
                </HStack>
            </ScrollView>
        </Box>

        {error && <Text className="text-red-500 mb-2">{error}</Text>}

        <HStack space="sm" className="justify-end">
          <Button variant="outline" action="secondary" size="sm" onPress={onClose}>
            <ButtonText>Cancel</ButtonText>
          </Button>
          <Button size="sm" onPress={handleForward} disabled={submitting || selected.length === 0}>
            <ButtonText>{submitting ? 'Forwarding...' : `Forward (${selected.length})`}</ButtonText>
          </Button>
        </HStack>
      </Box>
    </>
  );
}
