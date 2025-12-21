import { Box } from '@/components/ui/box';
import React, { useEffect } from 'react';
import { Text } from '@/components/ui/text';
import { Image } from '@/components/ui/image';
import { Button } from './ui/button';
import { Modal } from 'react-native';
import ImageViewer from 'react-native-image-zoom-viewer';

export default function ZoomImage({ image, visible, onClose }: { image: string; visible: boolean; onClose?: () => void }) {

    return (
        <Modal transparent={true} animationType="fade" visible={visible} onRequestClose={onClose}>
           <ImageViewer
                imageUrls={[{ url: image }]}
                enableImageZoom={true}
                enableSwipeDown={true}
                onSwipeDown={onClose}
                onCancel={onClose}
                backgroundColor="rgba(0,0,0,0.9)"
                renderHeader={() => (
                <Box className="absolute top-10 right-10 z-50">
                    <Button onPress={onClose} className="bg-gray-800 rounded-full p-2">
                    <Text className="text-white text-lg font-bold">✕</Text>
                    </Button>
                </Box>
                )}
            />
        </Modal>

    );
}