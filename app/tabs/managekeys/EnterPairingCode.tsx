import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { Input, InputField } from '@/components/ui/input';
import { router, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/utility/session/SessionProvider';
import { DeviceIdentity } from '@/utility/securedMessage/DeviceIdentity';
import { LocalPairingCode } from '@/utility/securedMessage/LocalPairingCode';
import { DevicePairing } from '@/utility/securedMessage/DevicePairing';
import { LocalKeyTransfer } from '@/utility/securedMessage/LocalKeyTransfer';

/**
 * New-device counterpart to PairingCode.tsx. Sends the code together with the
 * public half of a one-time key pair (the secret stays in DevicePairing's
 * memory); the other device seals its key QR to it. On a correct code, hands
 * off to ScanningKeys, which opens that QR with the secret.
 */
export default function EnterPairingCode() {
    const insets = useSafeAreaInsets();
    const { user } = useSession();
    // Set by the key guard: this device has no usable key and sits outside the tabs.
    const { recovery } = useLocalSearchParams<{ recovery?: string }>();
    const isRecovery = recovery === '1';

    const deviceRowIdRef = useRef<string | null>(null);
    // Once verified, ScanningKeys needs the one-time key: don't wipe it on unmount.
    const verifiedRef = useRef(false);
    const [digits, setDigits] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState('');
    const [lockedUntil, setLockedUntil] = useState<number | null>(null);
    const [lockCountdown, setLockCountdown] = useState(0);

    useEffect(() => {
        if (!user?.id) {
            return;
        }
        let mounted = true;

        (async () => {
            try {
                const deviceRowId = await DeviceIdentity.registerCurrentDevice(user.id);
                if (mounted) {
                    deviceRowIdRef.current = deviceRowId;
                }
            } catch {
                if (mounted) {
                    Alert.alert('Error', 'Failed to prepare this device');
                }
            }
        })();

        return () => {
            mounted = false;
        };
    }, [user?.id]);

    useEffect(() => {
        return () => {
            if (!verifiedRef.current) {
                DevicePairing.reset();
            }
        };
    }, []);

    useEffect(() => {
        if (!lockedUntil) {
            return;
        }

        const tick = () => {
            const remaining = Math.max(Math.ceil((lockedUntil - Date.now()) / 1000), 0);
            setLockCountdown(remaining);
            if (remaining === 0) {
                setLockedUntil(null);
                setStatusMessage('');
            }
        };

        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [lockedUntil]);

    const locked = !!lockedUntil && lockCountdown > 0;

    const submit = async () => {
        const deviceRowId = deviceRowIdRef.current;
        if (!deviceRowId || digits.length !== 4 || locked) {
            return;
        }

        setSubmitting(true);
        setStatusMessage('');
        try {
            if (!user?.id) {
                return;
            }
            // One key pair per visit, kept across wrong attempts.
            if (!DevicePairing.isPairing()) {
                DevicePairing.startPairing(user.id);
            }
            const ephemeralPublicKey = DevicePairing.publicKey()!;
            const keyProof = LocalKeyTransfer.computeKeyProof(user.id, digits, ephemeralPublicKey);

            const result = await LocalPairingCode.verify(deviceRowId, digits, ephemeralPublicKey, keyProof);

            if (result.verified) {
                verifiedRef.current = true;
                router.replace({
                    pathname: '/tabs/managekeys/ScanningKeys',
                    params: isRecovery ? { recovery: '1' } : {},
                });
                return;
            }

            if (result.locked) {
                setLockedUntil(Date.now() + result.retryAfterSeconds * 1000);
                setStatusMessage('Too many attempts. Try again once the timer runs out.');
            } else {
                const remaining = result.attemptsRemaining;
                setStatusMessage(`Incorrect code. ${remaining} attempt${remaining === 1 ? '' : 's'} left.`);
            }
            setDigits('');
        } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Failed to verify code');
            setDigits('');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <ScrollView
            // Otherwise the first tap on Verify only closes the number pad.
            keyboardShouldPersistTaps="handled"
            className="flex-1 px-4 bg-white dark:bg-black"
            contentContainerStyle={{
                flexGrow: 1,
                justifyContent: 'center',
                alignItems: 'center',
                paddingTop: insets.top,
            }}
        >
            <Box className="items-center mb-6 rounded-2xl border border-gray-200 p-6" style={{ width: '100%', maxWidth: 360 }}>
                <Text className="mb-4 text-center">Enter the 4-digit code shown on your other device</Text>

                <Input className="rounded-lg border border-gray-300" style={{ width: 160 }}>
                    <InputField
                        keyboardType="number-pad"
                        maxLength={4}
                        value={digits}
                        editable={!locked && !submitting}
                        onChangeText={(text) => setDigits(text.replace(/\D/g, '').slice(0, 4))}
                        onSubmitEditing={submit}
                        className="text-center text-3xl tracking-widest"
                        placeholder="0000"
                    />
                </Input>

                {statusMessage !== '' && (
                    <Text className="mt-4 text-center text-red-500">
                        {statusMessage}
                        {locked ? ` (${lockCountdown}s)` : ''}
                    </Text>
                )}

                <Button
                    onPress={submit}
                    size="md"
                    action="primary"
                    className="bg-blue-500 mt-6"
                    style={{ width: '100%' }}
                    disabled={submitting || locked || digits.length !== 4}
                >
                    <ButtonText className="text-white">{submitting ? 'Checking…' : 'Verify'}</ButtonText>
                </Button>
            </Box>

            {isRecovery ? (
                /*
                  Recovery users can't reach Settings. ScanningKeys (with no
                  pairing in progress) holds the other ways out: restore from
                  backup, or delete the account.
                */
                <Button
                    onPress={() => router.replace({ pathname: '/tabs/managekeys/ScanningKeys', params: { recovery: '1' } })}
                    size="md"
                    action="secondary"
                    style={{ width: '100%', maxWidth: 360 }}
                >
                    <ButtonText>No other device?</ButtonText>
                </Button>
            ) : (
                <Button onPress={() => router.replace('/tabs/(tabs)/Settings')} size="md" action="secondary" style={{ width: '100%', maxWidth: 360 }}>
                    <ButtonText>Cancel</ButtonText>
                </Button>
            )}
        </ScrollView>
    );
}
