
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
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
import { Spinner } from '@/components/ui/spinner';
import { VStack } from '@/components/ui/vstack';
import { AlertDialogBody } from '@/components/ui/alert-dialog';
import { deleteAccountAndLocalData } from '@/utility/account/deleteAccount';
import { DevicePairing, isPairDataPayload } from '@/utility/securedMessage/DevicePairing';
import { LocalKeyTransfer, isLegacyPlaintextPayload } from '@/utility/securedMessage/LocalKeyTransfer';
import { verifyScannedIdentityKey } from '@/utility/securedMessage/ScannedKeyVerification';

type Phase = 'scan' | 'done';

export default function ScanningKeys() {

    const [phase, setPhase] = useState<Phase>('scan');
    const { user, profile } = useSession();
    const importingRef = useRef(false);

    /*
      Set by the Bootstrap guard when this device has no usable key for the
      account. This screen sits outside the tabs, so someone sent here cannot
      reach Settings - without an exit they are stuck on a scanner they may have
      no second device for.
    */
    const { recovery } = useLocalSearchParams<{ recovery?: string }>();
    const isRecovery = recovery === '1';

    /*
      The QR from the other device is sealed to the one-time key made in
      EnterPairingCode. Without it (app restarted, or arrived here some other
      way) nothing could be opened, so ask for the pairing code first.
    */
    const [pairingKey] = useState(() => DevicePairing.publicKey());
    const pairingCheck = pairingKey ? LocalKeyTransfer.pairingCheck(pairingKey) : null;

    useEffect(() => {
        return () => DevicePairing.reset();
    }, []);

    const [showDeleteDialog, setShowDeleteDialog] = useState(false);
    const [deletingAccount, setDeletingAccount] = useState(false);

    const handleDeleteAccount = async () => {
        setShowDeleteDialog(false);
        setDeletingAccount(true);

        const deleted = await deleteAccountAndLocalData(user?.id || '', !!profile?.avatar_url);

        if (!deleted) {
            setDeletingAccount(false);
            Alert.alert('Error', 'Failed to delete account');
            return;
        }

        // Same as Settings: leave first, and let the native alert follow them home.
        router.replace('/');
        Alert.alert('Account deleted', 'Your account and everything on this device have been removed.');
    };

    const importKeysToNewDevice = async (payload: KeyObject) => {
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
            const scannedKey = MessageEncryption.base64ToBytes(payload.private_key);
            const check = await verifyScannedIdentityKey(user.id, scannedKey);

            if (check !== 'ok') {
                scannedKey.fill(0);
                if (check === 'mismatch') {
                    Alert.alert(
                        'This key does not match this account',
                        'The scanned key belongs to a different identity, so it was not installed. Nothing on this device was changed.'
                    );
                } else if (check === 'invalid') {
                    Alert.alert('Error', 'That QR code contains an invalid key');
                } else {
                    Alert.alert('Error', 'Could not verify this key against your account. Try again.');
                }
                return;
            }

            MessageEncryption.setPrivateKey(user.id, scannedKey);
        }

        const importTasks = payload.list.map(async (item) => {
            if (!item?.id || !item?.key) {
                return;
            }

            const existingKey = await ConversationKeyManager.getKey(user.id, item.id);
            if (existingKey == null) {
                await ConversationKeyManager.setConversationKey(user.id, item.id, MessageEncryption.base64ToBytes(item.key));
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

        if (isLegacyPlaintextPayload(parsed)) {
            Alert.alert(
                'Update needed',
                'This code is from an older version of SD Chat. Update the app on your other device, then share again.'
            );
            return;
        }

        if (!isPairDataPayload(parsed)) {
            Alert.alert('Error', 'That QR code is not a valid key payload');
            return;
        }

        importingRef.current = true;
        let payload: KeyObject;
        try {
            payload = await DevicePairing.openFromPeer(parsed);
        } catch (error) {
            importingRef.current = false;
            const expired = error instanceof Error && /expired/i.test(error.message);
            Alert.alert(
                'Error',
                expired
                    ? 'That QR code expired. Enter a new pairing code to try again.'
                    : 'That QR code was made for a different device. Make sure you entered the code on this device.'
            );
            if (expired) {
                router.replace({ pathname: '/tabs/managekeys/EnterPairingCode', params: isRecovery ? { recovery: '1' } : {} });
            }
            return;
        }

        try {
            await importKeysToNewDevice(payload);
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
                        {pairingKey ? (
                            <>
                                <Text className="mb-4 text-center">
                                    On your other device, tap &quot;Share Keys&quot; and scan the code it shows.
                                </Text>
                                <QrScannerView active={phase === 'scan'} onScanned={onScannedCode} />
                                <Text className="mt-4 text-center text-sm">
                                    Pairing check: <Text className="font-bold">{pairingCheck}</Text>
                                </Text>
                                <Text className="mt-1 text-center text-xs text-gray-500">
                                    The other device shows the same check under its code.
                                </Text>
                            </>
                        ) : (
                            <>
                                <Text className="mb-4 text-center">
                                    Enter the pairing code from your other device first. The key code it shows can only be opened by the device that entered it.
                                </Text>
                                <Button
                                    action="primary"
                                    size="md"
                                    className="bg-blue-500"
                                    onPress={() =>
                                        router.replace({
                                            pathname: '/tabs/managekeys/EnterPairingCode',
                                            params: isRecovery ? { recovery: '1' } : {},
                                        })
                                    }
                                >
                                    <ButtonText className="text-white">Enter pairing code</ButtonText>
                                </Button>
                            </>
                        )}

                        <Box className="mt-8 w-full items-center">
                            <Text className="mb-3 text-center text-xs text-gray-500">
                                No other device to scan from?
                            </Text>
                            <Button
                                action="primary"
                                variant="outline"
                                size="sm"
                                onPress={() => router.push('/tabs/managekeys/RecoverKey')}
                            >
                                <ButtonText>Recover from backup</ButtonText>
                            </Button>
                        </Box>

                        {isRecovery && (
                            <Box className="mt-8 w-full items-center">
                                <Text className="mb-3 text-center text-xs text-gray-500">
                                    No backup either? This account&apos;s messages cannot be
                                    recovered without its key.
                                </Text>
                                <Button
                                    action="negative"
                                    variant="outline"
                                    size="sm"
                                    onPress={() => setShowDeleteDialog(true)}
                                >
                                    <ButtonText>Delete this account</ButtonText>
                                </Button>
                            </Box>
                        )}
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

            <AlertDialog isOpen={showDeleteDialog} onClose={() => setShowDeleteDialog(false)}>
                <AlertDialogBackdrop />
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <Heading size="md">Delete this account</Heading>
                    </AlertDialogHeader>
                    <AlertDialogBody className="mt-3 mb-4">
                        <Text size="sm">
                            This cannot be undone. Your profile and your messages are removed;
                            conversations you shared with other people stay with them.
                        </Text>
                    </AlertDialogBody>
                    <AlertDialogFooter>
                        <Button
                            variant="outline"
                            action="secondary"
                            size="sm"
                            onPress={() => setShowDeleteDialog(false)}
                        >
                            <ButtonText>Cancel</ButtonText>
                        </Button>
                        <Button size="sm" action="negative" onPress={handleDeleteAccount}>
                            <ButtonText>Delete</ButtonText>
                        </Button>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>

            <Modal visible={deletingAccount} transparent animationType="fade" statusBarTranslucent>
                <Box
                    className="flex-1 items-center justify-center"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                >
                    <VStack space="md" className="items-center rounded-2xl bg-white px-10 py-8 dark:bg-black">
                        <Spinner size="large" color="grey" />
                        <Text className="text-base font-semibold">Deleting your account</Text>
                        <Text className="text-xs text-gray-500">This can take a moment</Text>
                    </VStack>
                </Box>
            </Modal>
        </ScrollView>
    )
}
