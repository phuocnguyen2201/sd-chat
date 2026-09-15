import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView } from 'react-native';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { router } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '@/utility/session/SessionProvider';
import { DeviceIdentity } from '@/utility/securedMessage/DeviceIdentity';
import { LocalPairingCode } from '@/utility/securedMessage/LocalPairingCode';

type Phase = 'loading' | 'showing' | 'expired';

const POLL_INTERVAL_MS = 2000;

/**
 * Sits between biometric auth and the existing QR "Share Keys" flow
 * (ManageKeys). Proves the two devices are physically together before
 * that flow is allowed to start - see local_pairing_codes_schema.sql and
 * the `local-code-*` device-pairing Edge Function actions.
 */
export default function PairingCode() {
    const insets = useSafeAreaInsets();
    const { user } = useSession();

    const [phase, setPhase] = useState<Phase>('loading');
    const [code, setCode] = useState('');
    const [timeLeft, setTimeLeft] = useState(0);
    const [expiresAt, setExpiresAt] = useState<number | null>(null);
    const deviceRowIdRef = useRef<string | null>(null);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const navigatedRef = useRef(false);

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
        }
    };

    const generateCode = async () => {
        const deviceRowId = deviceRowIdRef.current;
        if (!deviceRowId) {
            return;
        }

        setPhase('loading');
        try {
            const result = await LocalPairingCode.create(deviceRowId);
            setCode(result.code);
            setExpiresAt(new Date(result.expiresAt).getTime());
            setPhase('showing');
        } catch (error) {
            Alert.alert('Error', error instanceof Error ? error.message : 'Failed to generate a pairing code');
            router.replace('/tabs/(tabs)/Settings');
        }
    };

    useEffect(() => {
        if (!user?.id) {
            return;
        }
        let mounted = true;

        (async () => {
            try {
                const deviceRowId = await DeviceIdentity.registerCurrentDevice(user.id);
                if (!mounted) return;
                deviceRowIdRef.current = deviceRowId;
                await generateCode();
            } catch {
                if (mounted) {
                    Alert.alert('Error', 'Failed to start pairing');
                    router.replace('/tabs/(tabs)/Settings');
                }
            }
        })();

        return () => {
            mounted = false;
            stopPolling();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.id]);

    // Countdown, driven off the server's expiresAt (not a local guess).
    useEffect(() => {
        if (phase !== 'showing' || !expiresAt) {
            return;
        }

        const tick = () => {
            const remaining = Math.max(Math.ceil((expiresAt - Date.now()) / 1000), 0);
            setTimeLeft(remaining);
            if (remaining === 0) {
                stopPolling();
                setPhase('expired');
            }
        };

        tick();
        const timer = setInterval(tick, 1000);
        return () => clearInterval(timer);
    }, [phase, expiresAt]);

    // Poll for the other device entering the code correctly, then hand off
    // to the existing (unchanged) QR-sharing flow.
    useEffect(() => {
        if (phase !== 'showing') {
            return;
        }

        pollRef.current = setInterval(async () => {
            try {
                const status = await LocalPairingCode.status();
                if (status.active && status.status === 'verified' && !navigatedRef.current) {
                    navigatedRef.current = true;
                    stopPolling();
                    router.replace({ pathname: '/tabs/managekeys/ManageKeys', params: { autoShare: '1' } });
                }
            } catch {
                // Transient network error - just retry on the next tick.
            }
        }, POLL_INTERVAL_MS);

        return () => stopPolling();
    }, [phase]);

    const cancel = async () => {
        stopPolling();
        const deviceRowId = deviceRowIdRef.current;
        if (deviceRowId) {
            try {
                await LocalPairingCode.cancel(deviceRowId);
            } catch {
                // best effort - the code will expire on its own regardless
            }
        }
        router.replace('/tabs/(tabs)/Settings');
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
                <Text className="mb-4 text-center">
                    On your other device, tap &quot;Receive Keys&quot; and enter this code.
                </Text>

                {phase === 'loading' && <Text className="text-lg">Generating code…</Text>}

                {phase === 'showing' && (
                    <>
                        <Text className="text-5xl font-bold tracking-widest mb-4">{code}</Text>
                        <Text className="text-gray-500">{timeLeft}s</Text>
                    </>
                )}

                {phase === 'expired' && (
                    <>
                        <Text className="mb-4 text-center">Code expired.</Text>
                        <Button onPress={generateCode} size="md" action="primary" className="bg-blue-500" style={{ width: '100%' }}>
                            <ButtonText className="text-white">Generate a new code</ButtonText>
                        </Button>
                    </>
                )}
            </Box>

            <Button onPress={cancel} size="md" action="secondary" style={{ width: '100%', maxWidth: 360 }}>
                <ButtonText>Cancel</ButtonText>
            </Button>
        </ScrollView>
    );
}
