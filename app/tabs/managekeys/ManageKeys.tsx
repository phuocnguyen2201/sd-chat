import { useState, useEffect, useContext, useRef } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { SnapShot } from '@/utility/localstorage/snapshot';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import QRCode from 'react-native-qrcode-svg';
import { Button, ButtonText } from '@/components/ui/button';
import { router } from 'expo-router';

export default function ManageKeys() {

    const insets = useSafeAreaInsets();
    const [keysAsString, setKeysAsString] = useState('');


    const verifyKeys = async (conversationId: string) => {
        const data: Uint8Array | null = await ConversationKeyManager.getKey(conversationId);
        return data !== null && data !== undefined && data instanceof Uint8Array ? data : null;
    }
    
    
    const getKeysAsString = async () => {
        const keys = await SnapShot.getMessagesSnapshot();
        for (const snapshot of keys) {
            const hasKey = await verifyKeys(snapshot.conversation_id);
            if (hasKey) {
                setKeysAsString(previous => previous + snapshot.conversation_id + ';\n' + hasKey + ';\n');
            }
        }
    };

    useEffect(() => {
        if (keysAsString == '') {
            getKeysAsString();
        }
    }, [keysAsString]);

    return (
        <ScrollView className="flex-1 px-4 md:px-6 lg:px-8" contentContainerStyle={{ paddingTop: insets.top }}>
            <Box className="items-center mb-6 border border-gray-200">
                <Text>Scan QR Code to manage your keys. This feature allows you to securely share and manage your encryption keys with others by scanning a QR code.</Text>
            </Box>
            <Box className="items-center mb-6 mt-6 border border-gray-200">
                {(keysAsString !== '') ? <QRCode value={keysAsString} size={200} /> : <Text>No keys available to generate QR code.</Text>}
            </Box>
            <Box className="items-center mb-6 mt-6 border border-gray-200">
                <Text>Note: Ensure that you only share your keys with trusted parties. Sharing your keys with untrusted individuals may compromise the security of your encrypted messages.</Text>  
            </Box>
            <Button onPress={() => {router.push({pathname:'/tabs/managekeys/ScanningKeys'});}}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Scan QR</ButtonText>
            </Button>
            <Button onPress={() => {}}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Regenerate QR</ButtonText>
            </Button>
        </ScrollView>
    )

}