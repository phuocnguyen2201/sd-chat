import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { Input, InputField } from '@/components/ui/input';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/utility/session/SessionProvider';
import { DeviceIdentity } from '@/utility/securedMessage/DeviceIdentity';
import { LocalPairingCode } from '@/utility/securedMessage/LocalPairingCode';

/**
 * New-device counterpart to PairingCode.tsx. On a correct code, hands off
 * to the existing (unchanged) QR-receiving flow (ScanningKeys).
 */
export default function EnterPairingCode() {
    const insets = useSafeAreaInsets();
    const { user } = useSession();

    const deviceRowIdRef = useRef<string | null>(null);
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
            const result = await LocalPairingCode.verify(deviceRowId, digits);

            if (result.verified) {
                router.replace('/tabs/managekeys/ScanningKeys');
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

            <Button onPress={() => router.replace('/tabs/(tabs)/Settings')} size="md" action="secondary" style={{ width: '100%', maxWidth: 360 }}>
                <ButtonText>Cancel</ButtonText>
            </Button>
        </ScrollView>
    );
}
