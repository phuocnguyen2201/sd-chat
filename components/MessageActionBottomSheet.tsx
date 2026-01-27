import React from 'react';
import { Pressable, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { Box } from '@/components/ui/box';

type MessageActionBottomSheetProps = {
  isOpen: boolean;
  onClose: () => void;
  onEdit: () => void;
  onForward: () => void;
  onDelete: () => void;
};

const MessageActionBottomSheet: React.FC<MessageActionBottomSheetProps> = ({
  isOpen,
  onClose,
  onEdit,
  onForward,
  onDelete,
}) => {
  if (!isOpen) return null;

  const handleEdit = () => {
    onEdit();
    onClose();
  };

  const handleForward = () => {
    onForward();
    onClose();
  };

  const handleDelete = () => {
    onDelete();
    onClose();
  };

  return (
    <View className="absolute top-0 left-0 right-0 bottom-0 z-50 flex">
      {/* Transparent backdrop */}
      <Pressable 
        className="flex-1" 
        onPress={onClose} 
      />
      
      {/* Menu popup - positioned above input */}
      <Box className="bg-white rounded-t-lg shadow-lg mx-0 overflow-hidden border-t border-gray-200 w-full">
        <Pressable 
          onPress={handleEdit}
          className="px-4 py-3 border-b border-gray-200"
        >
          <Text className="text-base text-gray-800">Edit Message</Text>
        </Pressable>

        <Pressable 
          onPress={handleForward}
          className="px-4 py-3 border-b border-gray-200"
        >
          <Text className="text-base text-gray-800">Forward Message</Text>
        </Pressable>

        <Pressable 
          onPress={handleDelete}
          className="px-4 py-3"
        >
          <Text className="text-base text-red-500 font-semibold">Delete Message</Text>
        </Pressable>
      </Box>
    </View>
  );
};

export default MessageActionBottomSheet;