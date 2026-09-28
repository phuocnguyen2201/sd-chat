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
import { DevicePairing } from '@/utility/securedMessage/DevicePairing';
import { LocalKeyTransfer } from '@/utility/securedMessage/LocalKeyTransfer';
import { LocalPairingCode } from '@/utility/securedMessage/LocalPairingCode';

type Phase = 'idle' | 'show_sealed';

const QR_TTL_SECONDS = 30;
// Byte-mode capacity of the largest QR at error-correction level L is 2953.
const MAX_QR_CHARS = 2900;

export default function ManageKeys() {

    const insets = useSafeAreaInsets();
    const { user } = useSession();
    const { autoShare } = useLocalSearchParams<{ autoShare?: string }>();

    const [phase, setPhase] = useState<Phase>('idle');
    const [sealedQr, setSealedQr] = useState('');
    const [pairingCheck, setPairingCheck] = useState('');
    const [timeLeft, setTimeLeft] = useState(QR_TTL_SECONDS);
    const autoStartedRef = useRef(false);

    /*
      Seals the key payload to the one-time key the other device sent with the
      pairing code, so the QR only holds ciphertext (security #4). The key is
      used only if its proof matches the code this device displayed.
    */
    const shareKeys = async () => {
        setSealedQr('');
        setPairingCheck('');
        const code = LocalKeyTransfer.takeIssuedCode();
        try {
            if (!user?.id || !code) {
                Alert.alert('Start again', 'Tap "Share Keys" to show a new pairing code.');
                setPhase('idle');
                return;
            }

            const status = await LocalPairingCode.status();
            const peerKey = status.active ? status.requesterEphemeralPublicKey : null;
            const peerProof = status.active ? status.requesterKeyProof : null;
            if (!status.active || status.status !== 'verified' || !peerKey || !peerProof) {
                Alert.alert('Start again', 'The other device has not entered the pairing code, or it has expired.');
                setPhase('idle');
                return;
            }

            if (!LocalKeyTransfer.verifyKeyProof(user.id, code, peerKey, peerProof)) {
                Alert.alert('Pairing failed', 'The other device could not be verified with this code. Nothing was shared. Start again.');
                setPhase('idle');
                return;
            }

            const keyPayload = await buildKeySyncPayload(user.id);
            if (!keyPayload) {
                Alert.alert('Error', 'No keys available to share yet');
                setPhase('idle');
                return;
            }

            const qr = JSON.stringify(await DevicePairing.sealForPeer(peerKey, keyPayload));
            if (qr.length > MAX_QR_CHARS) {
                Alert.alert(
                    'Too many keys for one code',
                    'This device has too many conversations to fit in one QR code. Use "Back up my key" on this device and "Recover from backup" on the other one instead.'
                );
                setPhase('idle');
                return;
            }

            setSealedQr(qr);
            setPairingCheck(LocalKeyTransfer.pairingCheck(peerKey));
            setTimeLeft(QR_TTL_SECONDS);
            setPhase('show_sealed');
        } catch {
            Alert.alert('Error', 'Failed to prepare keys for the other device');
            setPhase('idle');
        }
    };

    const cancel = () => {
        setSealedQr('');
        setPairingCheck('');
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
            setPairingCheck('');
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
                        {sealedQr !== '' ? <QRCode value={sealedQr} size={260} quietZone={16} ecl="L" /> : <Text>No keys available to generate QR code.</Text>}
                    </Box>
                    <Text className="self-center text-center text-sm">
                        Pairing check: <Text className="font-bold">{pairingCheck}</Text>
                    </Text>
                    <Text className="mt-1 self-center text-center text-xs text-gray-500">
                        The other device should show the same check. If it doesn&apos;t, tap Done and start again.
                    </Text>
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
                <Text>Note: The key code is encrypted for the device that entered your pairing code, so a photo of it is useless to anyone else. Still, only pair with devices that are physically in your possession.</Text>
            </Box>
            <Button onPress={() => { router.push('/tabs/managekeys/EnterPairingCode'); }}
                size="md"
                action="primary"
                className="bg-blue-500 mb-4">
                <ButtonText className="text-white">Receive Keys</ButtonText>
            </Button>

            {/*
              The other recovery path: pairing needs a second device that is
              still working, and this covers the case where there isn't one.
            */}
            <Box className="items-center mb-6 mt-6 rounded-2xl border border-gray-200 p-4">
                <Text>
                    Back up your key to recover it on a new device even if every device you own is
                    lost or wiped. It is encrypted with a passphrase you choose before it leaves
                    this device.
                </Text>
            </Box>
            <Button onPress={() => { router.push('/tabs/managekeys/BackupKey'); }}
                size="md"
                action="primary"
                className="bg-blue-500 mb-8">
                <ButtonText className="text-white">Back up my key</ButtonText>
            </Button>
        </ScrollView>
    )

}
