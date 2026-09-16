
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { useRef, useState } from 'react';
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
import { QrScannerView } from '@/components/QrScannerView';

type Phase = 'scan' | 'done';

export default function ScanningKeys() {

    const [phase, setPhase] = useState<Phase>('scan');
    const { user } = useSession();
    const importingRef = useRef(false);

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

        if (!Number.isFinite(payload.validTime) || Date.now() > payload.validTime) {
            Alert.alert('Error', 'That QR code expired, ask the other device to generate a new one');
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

    const onScannedCode = async (raw: string) => {
        if (importingRef.current) {
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            Alert.alert('Error', 'That QR code is not a valid key payload');
            return;
        }

        if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as KeyObject).list)) {
            Alert.alert('Error', 'That QR code is not a valid key payload');
            return;
        }

        importingRef.current = true;
        try {
            importKeysToNewDevice(parsed as KeyObject);
        } finally {
            importingRef.current = false;
        }
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

                {phase === 'scan' && (
                    <>
                        <Text className="mb-4 text-center">
                            On your other device, tap &quot;Share Keys&quot; and scan the code it shows.
                        </Text>
                        <QrScannerView active={phase === 'scan'} onScanned={onScannedCode} />
                    </>
                )}

                {phase === 'done' && (
                    <Box style={{ width: '100%' }}>
                        <AlertDialog isOpen={phase === 'done'} onClose={() => setPhase('scan')}>
                            <AlertDialogBackdrop />
                            <AlertDialogContent>
                            <AlertDialogHeader>
                                <Heading size="lg">
                                    Scan completed
                                </Heading>
                                <AlertDialogCloseButton onPress={() => setPhase('scan')}>
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
