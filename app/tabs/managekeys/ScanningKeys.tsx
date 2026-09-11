
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';
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
import QRCode from 'react-native-qrcode-svg';
import { DevicePairing, isPairDataPayload } from '@/utility/securedMessage/DevicePairing';
import { QrScannerView } from '@/components/QrScannerView';

type Phase = 'show_own_code' | 'scan_sealed' | 'done';

const QR_TTL_SECONDS = 60;

export default function ScanningKeys() {

    const [phase, setPhase] = useState<Phase>('show_own_code');
    const [ownCodeQr, setOwnCodeQr] = useState('');
    const [timeLeft, setTimeLeft] = useState(QR_TTL_SECONDS);
    const [scanningActive, setScanningActive] = useState(false);
    const { user } = useSession();
    const importingRef = useRef(false);

    const generateOwnCode = () => {
        const payload = DevicePairing.startPairing(user?.id);
        setOwnCodeQr(JSON.stringify(payload));
        setTimeLeft(QR_TTL_SECONDS);
        setPhase('show_own_code');
        setScanningActive(false);
    };

    useEffect(() => {
        generateOwnCode();
        return () => DevicePairing.reset();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        if (phase !== 'show_own_code') {
            return;
        }
        if (timeLeft === 0) {
            return;
        }
        const timer = setInterval(() => {
            setTimeLeft((currentTime) => Math.max(currentTime - 1, 0));
        }, 1000);
        return () => clearInterval(timer);
    }, [phase, timeLeft]);

    const importKeysToNewDevice = (payload: KeyObject) => {
        if (!payload || !Array.isArray(payload.list)) {
            Alert.alert('Error', 'Invalid key payload');
            return;
        }

        if (!user?.id) {
            Alert.alert('Error', 'Session not ready');
            return;
        }

        if (user.id !== payload.userId) {
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
            .then(() => setPhase('done'))
            .catch(() => {
                Alert.alert('Error', 'Failed to import one or more keys');
                setPhase('done');
            });
    };

    const onScannedSealedCode = async (raw: string) => {
        if (importingRef.current) {
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            Alert.alert('Error', 'That QR code is not a valid pairing reply');
            return;
        }

        if (!isPairDataPayload(parsed)) {
            Alert.alert('Error', 'That QR code is not a valid pairing reply');
            return;
        }

        importingRef.current = true;
        try {
            const keyPayload = await DevicePairing.openFromPeer(parsed);
            importKeysToNewDevice(keyPayload);
        } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Failed to decrypt the received keys');
            generateOwnCode();
        } finally {
            importingRef.current = false;
        }
    };

    const goToScanStep = () => {
        setPhase('scan_sealed');
        setScanningActive(true);
    };

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

                {phase === 'show_own_code' && (
                    <>
                        <Text className="mb-4 text-center">
                            On your other device, tap &quot;Share Keys&quot; and scan this code.
                        </Text>
                        {timeLeft > 0 ? (
                            <>
                                <Box className="items-center mb-4 rounded-2xl border border-gray-200 p-4">
                                    <QRCode value={ownCodeQr} size={200} />
                                </Box>
                                <Text className="mb-4 text-center text-xl font-bold">{timeLeft}s</Text>
                                <Button onPress={goToScanStep} size="md" action="primary" className="bg-blue-500 mt-2" style={{ width: '100%' }}>
                                    <ButtonText className="text-white">Next: Scan the reply code</ButtonText>
                                </Button>
                            </>
                        ) : (
                            <>
                                <Text className="mb-4 text-center">Code expired.</Text>
                                <Button onPress={generateOwnCode} size="md" action="primary" className="bg-blue-500 mt-2" style={{ width: '100%' }}>
                                    <ButtonText className="text-white">Generate a new code</ButtonText>
                                </Button>
                            </>
                        )}
                    </>
                )}

                {phase === 'scan_sealed' && (
                    <>
                        <Text className="mb-4 text-center">Now scan the code shown on your other device</Text>
                        <QrScannerView active={scanningActive} onScanned={onScannedSealedCode} />
                        <Button onPress={generateOwnCode} size="md" action="secondary" className="mt-4" style={{ width: '100%' }}>
                            <ButtonText>Back</ButtonText>
                        </Button>
                    </>
                )}

                {phase === 'done' && (
                    <Box style={{ width: '100%' }}>
                        <AlertDialog isOpen={phase === 'done'} onClose={() => generateOwnCode()}>
                            <AlertDialogBackdrop />
                            <AlertDialogContent>
                            <AlertDialogHeader>
                                <Heading size="lg">
                                    Scan completed
                                </Heading>
                                <AlertDialogCloseButton onPress={() => generateOwnCode()}>
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
                )}

            </Box>
        </ScrollView>
    )
}
