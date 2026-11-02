import { useState } from 'react';
import { ScrollView } from 'react-native';
import { Redirect } from 'expo-router';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { BenchResult, runCryptoBench } from '@/utility/securedMessage/bench/cryptoBench';

/*
  Crypto timings on this phone, with the same cases as `npm run bench:crypto`.
  Off in normal release builds. Dev builds always have it, but they run
  unminified JS, so for numbers worth writing down build a release APK with
  EXPO_PUBLIC_PERF_BENCH=1.

  Runs entirely on-device against a throwaway key; the account's own identity
  key is never touched.
*/
export const CRYPTO_BENCH_ENABLED = __DEV__ || process.env.EXPO_PUBLIC_PERF_BENCH === '1';

export default function CryptoBench() {
    const [results, setResults] = useState<BenchResult[]>([]);
    const [running, setRunning] = useState(false);
    const [error, setError] = useState('');

    if (!CRYPTO_BENCH_ENABLED) {
        return <Redirect href="/tabs/managekeys/ManageKeys" />;
    }

    const run = async () => {
        setResults([]);
        setError('');
        setRunning(true);
        try {
            // Rows appear as each case finishes; the 10 MB and scrypt cases take a while.
            await runCryptoBench((result) => setResults((prev) => [...prev, result]));
        } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
        } finally {
            setRunning(false);
        }
    };

    return (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Box className="mb-4 rounded-2xl border border-gray-200 p-4">
                <Text>
                    Times each encryption step on this device. Keep the screen on and the app in the
                    foreground until it finishes.
                </Text>
            </Box>

            <Button onPress={run} isDisabled={running} size="md" action="primary" className="bg-blue-500 mb-4">
                {running ? <Spinner color="white" /> : <ButtonText className="text-white">Run benchmark</ButtonText>}
            </Button>

            {error !== '' && <Text className="mb-4 text-red-500">{error}</Text>}

            {results.map((r) => (
                <Box key={r.name} className="mb-2 rounded-xl border border-gray-200 p-3">
                    <Text className="font-bold">{r.name}</Text>
                    <Text className="text-sm">
                        mean {r.meanMs.toFixed(2)} ms · p95 {r.p95Ms.toFixed(2)} ms · {r.opsPerSec.toFixed(1)} ops/s ·{' '}
                        {r.iterations} runs
                    </Text>
                </Box>
            ))}
        </ScrollView>
    );
}
