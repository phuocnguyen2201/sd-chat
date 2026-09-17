import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import QRCode from 'react-native-qrcode-svg';
import { Button, ButtonText } from '@/components/ui/button';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/utility/session/SessionProvider';
import { buildKeySyncPayload } from '@/utility/securedMessage/KeySyncPayload';

type Phase = 'idle' | 'show_sealed';

const QR_TTL_SECONDS = 30;

export default function ManageKeys() {

    const insets = useSafeAreaInsets();
    const { user } = useSession();
    const { autoShare } = useLocalSearchParams<{ autoShare?: string }>();

    const [phase, setPhase] = useState<Phase>('idle');
    const [sealedQr, setSealedQr] = useState('');
    const [timeLeft, setTimeLeft] = useState(QR_TTL_SECONDS);
    const autoStartedRef = useRef(false);

    const shareKeys = async () => {
        setSealedQr('');
        try {
            const keyPayload = await buildKeySyncPayload(user?.id);
            if (!keyPayload) {
                Alert.alert('Error', 'No keys available to share yet');
                setPhase('idle');
                return;
            }

            setSealedQr(JSON.stringify(keyPayload));
            setTimeLeft(QR_TTL_SECONDS);
            setPhase('show_sealed');
        } catch {
            Alert.alert('Error', 'Failed to prepare keys for the other device');
            setPhase('idle');
        }
    };

    const cancel = () => {
        setSealedQr('');
        setPhase('idle');
    };

    // Reached after PairingCode.tsx verifies the other device's 4-digit
    // code - skip straight into generating the QR instead of requiring
    // another tap.
    useEffect(() => {
        if (autoShare === '1' && !autoStartedRef.current) {
            autoStartedRef.current = true;
            shareKeys();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoShare]);

    useEffect(() => {
        if (phase !== 'show_sealed') {
            return;
        }
        if (timeLeft === 0) {
            setSealedQr('');
            setPhase('idle');
            return;
        }

        const timer = setInterval(() => {
            setTimeLeft((currentTime) => Math.max(currentTime - 1, 0));
        }, 1000);

        return () => clearInterval(timer);
    }, [phase, timeLeft]);

    return (
        <ScrollView className="flex-1 px-4 md:px-6 lg:px-8" contentContainerStyle={{ paddingTop: insets.top }}>
            <Box className="items-center mb-6 rounded-2xl border border-gray-200 p-4">
                <Text>
                    To sync your encryption keys to another device, tap &quot;Receive Keys&quot; on the OTHER
                    device first, then come back here and tap &quot;Share Keys&quot;. You&apos;ll enter a
                    4-digit code shown on this device to prove the two devices are together, then a QR code
                    appears here for the other device to scan.
                </Text>
            </Box>

            {phase === 'idle' && (
                <Button
                    onPress={() => router.push('/tabs/managekeys/PairingCode')}
                    size="md"
                    action="primary"
                    className="bg-blue-500 mb-4"
                >
                    <ButtonText className="text-white">Share Keys</ButtonText>
                </Button>
            )}

            {phase === 'show_sealed' && (
                <>
                    <Box className="items-center mb-6 rounded-2xl border border-gray-200 bg-white p-4">
                        {sealedQr !== '' ? <QRCode value={sealedQr} size={260} quietZone={16} /> : <Text>No keys available to generate QR code.</Text>}
                    </Box>
                    <Text className="mt-4 self-center text-center text-xl font-bold">
                        {timeLeft > 0 ? `${timeLeft}s` : 'QR expired'}
                    </Text>
                    <Text className="mt-4 self-center text-center">Now scan this on the other device to finish syncing.</Text>
                    <Button onPress={cancel} size="md" action="secondary" className="mt-4 mb-4">
                        <ButtonText>Done</ButtonText>
                    </Button>
                </>
            )}

            <Box className="items-center mb-6 mt-6 rounded-2xl border border-gray-200 p-4">
                <Text>Note: Only pair with devices that are physically in your possession. This QR code contains your private key in the clear - anyone who scans or photographs it can read your messages. Do not share it or leave it on screen.</Text>
            </Box>
            <Button onPress={() => { router.push('/tabs/managekeys/EnterPairingCode'); }}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Receive Keys</ButtonText>
            </Button>
        </ScrollView>
    )

}
