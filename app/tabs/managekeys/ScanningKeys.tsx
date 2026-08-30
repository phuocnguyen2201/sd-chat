
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { router } from 'expo-router';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import { useSession } from '@/utility/session/SessionProvider';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogCloseButton,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Heading } from '@/components/ui/heading';
import { Icon, CloseIcon } from '@/components/ui/icon';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { KeyObject } from '@/utility/types/user';

type LegacyReceivedPair = [string, Uint8Array];

export default function ScanningKeys() {

    const [permission, requestPermission] = useCameraPermissions();
    const [scanningActive, setScanningActive] = useState(true);
    const { user } = useSession();

    const parseScannedData = (rawData: string): KeyObject | null => {
        try {
            const parsed = JSON.parse(rawData) as Partial<KeyObject>;
            if (
                parsed &&
                typeof parsed === 'object' &&
                Array.isArray(parsed.list) &&
                parsed.req == 'sync_key'
            ) {
                return {
                    req: typeof parsed.req === 'string' ? parsed.req : '',
                    private_key: typeof parsed.private_key === 'string' ? parsed.private_key : '',
                    list: parsed.list
                        .filter((item): item is { id: string; key: string } => !!item && typeof item.id === 'string' && typeof item.key === 'string')
                        .map((item) => ({ id: item.id, key: item.key })),
                };
            }

        } catch {
            // fall through to legacy format parsing below
        }

        const parts = rawData
            .split(';')
            .map(item => item.trim())
            .filter(item => item.length > 0);

        const legacyPairs: LegacyReceivedPair[] = [];
        for (let i = 0; i + 1 < parts.length; i += 2) {
            const textValue = parts[i];
            const binaryValue = MessageEncryption.base64ToBytes(parts[i + 1]);
            legacyPairs.push([textValue, binaryValue]);
        }

        if (legacyPairs.length === 0) {
            return null;
        }

        const convertedList = legacyPairs.map(([id, keyBytes]) => ({
            id,
            key: MessageEncryption.bytesToBase64(keyBytes),
        }));

        const privateKeyEntry = convertedList[0];
        return {
            req: 'sync_key',
            private_key: privateKeyEntry ? privateKeyEntry.key : '',
            list: convertedList.slice(1),
        };
    };

    const importKeysToNewDevice = (payload: KeyObject) => {
        if (!payload || !Array.isArray(payload.list)) {
            Alert.alert('Error', 'Invalid key payload');
            return;
        }

        if (!user?.id && payload.req !== 'sync_key') {
            Alert.alert('Error', 'Session not ready');
            return;
        }

        if(user?.id !== payload.userId){
            Alert.alert('Error', 'Please login the same account to sync keys');
            return;
        }

        if (payload.private_key) {
            MessageEncryption.setPrivateKey(MessageEncryption.base64ToBytes(payload.private_key));
        }

        const importTasks = payload.list.map(async (item) => {
            if (!item?.id || !item?.key) {
                return;
            }

            const existingKey = await ConversationKeyManager.getKey(item.id);
            if (existingKey == null) {
                await ConversationKeyManager.setConversationKey(item.id, MessageEncryption.base64ToBytes(item.key));
            }
        });

        Promise.all(importTasks)
            .then(() => setScanningActive(false))
            .catch(() => {
                Alert.alert('Error', 'Failed to import one or more keys');
                setScanningActive(false);
            });
    };

    const renderCamera = () => {
        if (!permission?.granted) {
            return (
                <Box>
                    <Text>We need your permission to show the camera</Text>
                    <Button onPress={requestPermission}>
                        <ButtonText className="text-white">Grant Permission</ButtonText>
                    </Button>
                </Box>
            );
        }
    };

    useEffect(() => {
        renderCamera();
    }, []);

    useEffect(() => {
        renderCamera();
    }, [permission]);

    return(
        <ScrollView
            className="flex-1 px-4 md:px-6 lg:px-8 bg-white dark:bg-black"
            contentContainerStyle={{
                flexGrow: 1,
                alignItems: 'center',
                justifyContent: 'center',
                paddingVertical: 24,
            }}
        >
            <Box style={{ width: '100%', maxWidth: 420, alignItems: 'center' }}>
                {scanningActive && (
                    <CameraView
                        style={{
                            width: 360,
                            height: 360,
                            borderRadius: 16,
                            overflow: 'hidden',
                            alignSelf: 'center',
                        }}
                        facing={'back'}
                        barcodeScannerSettings={{
                            barcodeTypes: ['qr'],
                        }}
                        onBarcodeScanned={(data) => {
                            if (data?.data) {
                                const scannedPayload = parseScannedData(data.data);
                                if (scannedPayload) {
                                    importKeysToNewDevice(scannedPayload);
                                }
                            }
                        }}
                    />
                )}

                {!permission?.granted ? (
                    <Button
                        onPress={requestPermission}
                        size="md"
                        action="primary"
                        className="bg-blue-500 mt-6"
                        style={{ width: '100%', maxHeight: 250 }}
                    >
                        <ButtonText className="text-white">Grant permission</ButtonText>
                    </Button>
                ) : (
                    !scanningActive && (
                        <Box style={{ width: '100%' }}>
                            <AlertDialog isOpen={!scanningActive} onClose={() => setScanningActive(true)}>
                                <AlertDialogBackdrop />
                                <AlertDialogContent>
                                <AlertDialogHeader>
                                    <Heading size="lg">
                                        Scan completed
                                    </Heading>
                                    <AlertDialogCloseButton onPress={() => setScanningActive(true)}>
                                        <Icon as={CloseIcon} />
                                    </AlertDialogCloseButton>
                                </AlertDialogHeader>
                                 <AlertDialogFooter>
                                    <Button
                                    variant="outline"
                                    action="secondary"
                                    onPress={() => router.replace({pathname:'/tabs/(tabs)/Settings'})}
                                    >
                                    <ButtonText>Ok</ButtonText>
                                    </Button>
                                 </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </Box>
                    )
                )}

              
            </Box>
        </ScrollView>
    )
}