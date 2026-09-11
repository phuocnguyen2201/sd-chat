import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text } from '@/components/ui/text';
import QRCode from 'react-native-qrcode-svg';
import { Button, ButtonText } from '@/components/ui/button';
import { router } from 'expo-router';
import { useSession } from '@/utility/session/SessionProvider';
import { DevicePairing, isPairInitPayload } from '@/utility/securedMessage/DevicePairing';
import { buildKeySyncPayload } from '@/utility/securedMessage/KeySyncPayload';
import { QrScannerView } from '@/components/QrScannerView';

type Phase = 'idle' | 'scan_peer' | 'show_sealed';

const QR_TTL_SECONDS = 30;

export default function ManageKeys() {

    const insets = useSafeAreaInsets();
    const { user } = useSession();

    const [phase, setPhase] = useState<Phase>('idle');
    const [sealedQr, setSealedQr] = useState('');
    const [timeLeft, setTimeLeft] = useState(QR_TTL_SECONDS);
    const sealingRef = useRef(false);

    const onScannedPeerCode = async (raw: string) => {
        if (sealingRef.current) {
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            Alert.alert('Error', 'That QR code is not a valid pairing code');
            setPhase('idle');
            return;
        }

        if (!isPairInitPayload(parsed)) {
            Alert.alert('Error', 'That QR code is not a valid pairing code');
            setPhase('idle');
            return;
        }

        if (!Number.isFinite(parsed.expiresAt) || Date.now() > parsed.expiresAt) {
            Alert.alert('Error', 'That pairing code expired, ask the other device to generate a new one');
            setPhase('idle');
            return;
        }

        if (parsed.userId && user?.id && parsed.userId !== user.id) {
            Alert.alert('Error', 'Please log in the same account on both devices to sync keys');
            setPhase('idle');
            return;
        }

        sealingRef.current = true;
        try {
            const keyPayload = await buildKeySyncPayload(user?.id);
            if (!keyPayload) {
                Alert.alert('Error', 'No keys available to share yet');
                setPhase('idle');
                return;
            }

            const sealed = await DevicePairing.sealForPeer(parsed.ephemeralPublicKey, keyPayload);
            setSealedQr(JSON.stringify(sealed));
            setTimeLeft(QR_TTL_SECONDS);
            setPhase('show_sealed');
        } catch {
            Alert.alert('Error', 'Failed to prepare keys for the other device');
            setPhase('idle');
        } finally {
            sealingRef.current = false;
        }
    };

    const startSharing = () => {
        setSealedQr('');
        setPhase('scan_peer');
    };

    const cancel = () => {
        setSealedQr('');
        setPhase('idle');
    };

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
                    To sync your encryption keys to another device, open this screen on the OTHER device first
                    and tap &quot;Receive Keys&quot; there, then come back here and tap &quot;Share Keys&quot;
                    to scan its code. Your keys are encrypted end-to-end for that device only - nobody who
                    scans a QR code shown on screen can read them.
                </Text>
            </Box>

            {phase === 'idle' && (
                <Button onPress={startSharing} size="md" action="primary" className="bg-blue-500 mb-4">
                    <ButtonText className="text-white">Share Keys</ButtonText>
                </Button>
            )}

            {phase === 'scan_peer' && (
                <Box className="items-center mb-6 rounded-2xl border border-gray-200 p-4">
                    <Text className="mb-4 text-center">Scan the code shown on your other device</Text>
                    <QrScannerView active={phase === 'scan_peer'} onScanned={onScannedPeerCode} />
                    <Button onPress={cancel} size="md" action="secondary" className="mt-4">
                        <ButtonText>Cancel</ButtonText>
                    </Button>
                </Box>
            )}

            {phase === 'show_sealed' && (
                <>
                    <Box className="items-center mb-6 rounded-2xl border border-gray-200 p-4">
                        {sealedQr !== '' ? <QRCode value={sealedQr} size={200} /> : <Text>No keys available to generate QR code.</Text>}
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
                <Text>Note: Only pair with devices that are physically in your possession. Anyone who can complete both scans of the pairing handshake gets your keys.</Text>
            </Box>
            <Button onPress={() => { router.push({ pathname: '/tabs/managekeys/ScanningKeys' }); }}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Receive Keys</ButtonText>
            </Button>
        </ScrollView>
    )

}
