import { useState, useEffect } from 'react';
import { ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import { SnapShot } from '@/utility/localstorage/snapshot';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import QRCode from 'react-native-qrcode-svg';
import { Button, ButtonText } from '@/components/ui/button';
import { router } from 'expo-router';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { useSession } from '@/utility/session/SessionProvider';
import {KeyObject} from '@/utility/types/user'

export default function ManageKeys() {

    const insets = useSafeAreaInsets();
    const [keysAsString, setKeysAsString] = useState('');
    const [timeLeft, setTimeLeft] = useState(30);
    const {user} = useSession();

    const verifyKeys = async (conversationId: string) => {
        const data: Uint8Array | null = await ConversationKeyManager.getKey(conversationId);
        return data !== null && data !== undefined && data instanceof Uint8Array ? data : null;
    }
    const data: KeyObject = {
        req: '',
        userId: user?.id,
        validTime: Date.now() + 30000,
        private_key: '',
        list: [],
    };
    const getKeysAsString = async () => {
        const keys = await SnapShot.getMessagesSnapshot();
        const privKey = MessageEncryption.getPrivateKey();

        if (user?.id && privKey !== '') {
            data.req = 'sync_key';
            data.private_key = privKey;
        }

        for (const snapshot of keys) {
            const hasKey = await verifyKeys(snapshot.conversation_id);

            if (hasKey) {
                const keyInString =
                    MessageEncryption.bytesToBase64(hasKey);

                (data.list).push({
                    id: snapshot.conversation_id,
                    key: keyInString,
                });
            }
        }
        setKeysAsString(JSON.stringify(data))
    };

    useEffect(() => {
        if (keysAsString == '' && timeLeft > 0) {
            getKeysAsString();
        }
    }, [keysAsString]);

    useEffect(() => {
        if (timeLeft === 0) {
            setKeysAsString('');
            return;
        }

        const timer = setInterval(() => {
            setTimeLeft((currentTime) => Math.max(currentTime - 1, 0));
        }, 1000);

        return () => clearInterval(timer);
    }, [timeLeft]);

    const regenerateQrCode = () => {
        if(timeLeft === 0) {
            setTimeLeft(30);
            setKeysAsString('');
        }
    };

    return (
        <ScrollView className="flex-1 px-4 md:px-6 lg:px-8" contentContainerStyle={{ paddingTop: insets.top }}>
            <Box className="items-center mb-6 rounded-2xl border border-gray-200 p-4">
                <Text>Scan QR Code to manage your keys. This feature allows you to securely share and manage your encryption keys with others by scanning a QR code.</Text>
            </Box>
            <Box className="items-center mb-6 mt-6 rounded-2xl border border-gray-200 p-4">
                {(keysAsString !== '') ? <QRCode value={keysAsString} size={200} /> : <Text>No keys available to generate QR code.</Text>}
            </Box>
            <Text className="mt-4 self-center text-center text-xl font-bold">
                {timeLeft > 0 ? `${timeLeft}s` : 'QR expired'}
            </Text>
            <Box className="items-center mb-6 mt-6 rounded-2xl border border-gray-200 p-4">
                <Text>Note: Ensure that you only share your keys with trusted parties. Sharing your keys with untrusted individuals may compromise the security of your encrypted messages.</Text>  
            </Box>
            <Button onPress={() => { router.push({ pathname:'/tabs/managekeys/ScanningKeys'} ); }}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Scan QR</ButtonText>
            </Button>
            <Button onPress={regenerateQrCode}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Regenerate QR</ButtonText>
            </Button>
        </ScrollView>
    )

}