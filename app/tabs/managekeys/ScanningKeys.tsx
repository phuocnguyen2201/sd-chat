
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

type ReceivedPair = [string, Uint8Array];

export default function ScanningKeys() {

    const [permission, requestPermission] = useCameraPermissions();
    const [listReceived, SetListReceived] = useState<ReceivedPair[]>([]);
    const [scanningActive, setScanningActive] = useState(true);
    const [lastScanText, setLastScanText] = useState<string | null>(null);

    const parseScannedData = (rawData: string): ReceivedPair[] => {
        const parts = rawData
            .split(';')
            .map(item => item.trim())
            .filter(item => item.length > 0);

        const pairs: ReceivedPair[] = [];
        for (let i = 0; i + 1 < parts.length; i += 2) {
            const textValue = parts[i];
            const binaryValue = new TextEncoder().encode(parts[i + 1]);
            pairs.push([textValue, binaryValue]);
        }
        return pairs;
    };

    const pairEquals = (a: ReceivedPair, b: ReceivedPair) => {
        if (a[0] !== b[0]) return false;
        if (a[1].length !== b[1].length) return false;
        return a[1].every((byte, index) => byte === b[1][index]);
    };

    const appendNewPairs = (newPairs: ReceivedPair[]) => {
        SetListReceived(prev => {
            const next = [...prev];
            newPairs.forEach(pair => {
                const exists = prev.some(existing => pairEquals(existing, pair));
                if (!exists) {
                    next.push(pair);
                }
            });
            return next;
        });
    };

    const stopScanning = (scannedText: string) => {
        setScanningActive(false);
        setLastScanText(scannedText);
    };

    const restartScanning = () => {
        setScanningActive(true);
        setLastScanText(null);
    };

    const renderCamera = () => {
        if (!permission || !permission?.granted) {
            return (
                <Box>
                    <Text>We need your permission to show the camera</Text>
                    <Button onPress={requestPermission}>
                        <ButtonText className="text-white">Grant Permission</ButtonText>
                    </Button>
                </Box>
            );
        }
    };

    useEffect(() => {
        renderCamera();
    }, []);

    useEffect(() => {
        renderCamera();
    }, [permission]);

    useEffect(() => {
        if (listReceived.length > 0) {
            console.log('Received pairs:', listReceived);
        }
    }, [listReceived]);

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
                {scanningActive && (
                    <CameraView
                        style={{
                            width: 360,
                            height: 360,
                            borderRadius: 16,
                            overflow: 'hidden',
                            alignSelf: 'center',
                        }}
                        facing={'back'}
                        barcodeScannerSettings={{
                            barcodeTypes: ['qr'],
                        }}
                        onBarcodeScanned={(data) => {
                            if (data?.data) {
                                const scannedPairs = parseScannedData(data.data);
                                if (scannedPairs.length > 0) {
                                    appendNewPairs(scannedPairs);
                                    stopScanning(data.data);
                                }
                            }
                        }}
                    />
                )}

                {!permission || !permission?.granted ? (
                    <Button
                        onPress={requestPermission}
                        size="md"
                        action="primary"
                        className="bg-blue-500 mt-6"
                        style={{ width: '100%', maxHeight: 250 }}
                    >
                        <ButtonText className="text-white">Grant permission</ButtonText>
                    </Button>
                ) : (
                    !scanningActive && (
                        <Box style={{ width: '100%' }}>
                            <Text className="mb-4 text-center text-sm text-gray-600 dark:text-gray-300">
                                Scanning stopped after successful scan:
                                {' '}
                                {lastScanText ?? 'No data'}
                            </Text>
                            <Button
                                onPress={restartScanning}
                                size="md"
                                action="primary"
                                className="bg-blue-500 mt-2"
                                style={{ width: '100%' }}
                            >
                                <ButtonText className="text-white">Scan again</ButtonText>
                            </Button>
                        </Box>
                    )
                )}

              
            </Box>
        </ScrollView>
    )
}