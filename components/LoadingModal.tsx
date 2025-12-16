import { Spinner } from '@/components/ui/spinner';
import { Modal, Text } from 'react-native';
import { Box } from './ui/box';

export default function LoadingModal({ visible }: { visible: boolean }) {
  return (
    <Modal transparent={true} animationType="fade" visible={visible}>
      <Box className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
        <Box className="bg-white p-6 rounded-lg flex flex-col items-center">
           <Spinner size="large" />
          <Text className="mt-4 text-gray-700">Loading...</Text>
        </Box>
      </Box>
    </Modal>
  );
}