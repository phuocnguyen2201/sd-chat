
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { ConversationKeyManager } from '@/utility/securedMessage/ConversationKeyManagement';
import { useSession } from '@/utility/session/SessionProvider';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogCloseButton,
  AlertDialogBody,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Heading } from '@/components/ui/heading';
import { Icon, CloseIcon } from '@/components/ui/icon';
import { MessageEncryption } from '@/utility/securedMessage/secured';

type ReceivedPair = [string, Uint8Array];

export default function ScanningKeys() {

    const [permission, requestPermission] = useCameraPermissions();
    const [scanningActive, setScanningActive] = useState(true);
    const {user} = useSession();
    const param = useLocalSearchParams();

    const parseScannedData = (rawData: string): ReceivedPair[] => {
        const parts = rawData
            .split(';')
            .map(item => item.trim())
            .filter(item => item.length > 0);

        const pairs: ReceivedPair[] = [];
        for (let i = 0; i + 1 < parts.length; i += 2) {
            const textValue = parts[i];
            const binaryValue = MessageEncryption.base64ToBytes(parts[i + 1]);
            pairs.push([textValue, binaryValue]);
        }
        return pairs;
    };

    const importKeysToNewDevice = (newPairs: ReceivedPair[]) => {

        if(user?.id === newPairs[0][0]){
            //import account private key
            MessageEncryption.setPrivateKey(newPairs[0][1]);
        }
        newPairs.forEach((item, index) => {
            ConversationKeyManager.getKey(item[0]).then((conversationId)=>{
                if (conversationId == null) {
                    ConversationKeyManager.setConversationKey(item[0], item[1])
                }
            })
            .finally(()=>{
                setScanningActive(false)
            })
        })
    }

    const stopScanning = (scannedText: string) => {
        setScanningActive(false);
    };

    const restartScanning = () => {
        setScanningActive(true);
    };

    const renderCamera = () => {
        if (!permission || !permission?.granted) {
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
                                const scannedPairs = parseScannedData(data.data);
                                if (scannedPairs.length > 0) {
                                    importKeysToNewDevice(scannedPairs);
                                }
                            }
                            

                        }}
                    />
                )}

                {!permission || !permission?.granted ? (
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