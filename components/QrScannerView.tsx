import { useEffect, useRef } from 'react';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Button, ButtonText } from '@/components/ui/button';

type Props = {
    active: boolean;
    onScanned: (data: string) => void;
};

export function QrScannerView({ active, onScanned }: Props) {
    const [permission, requestPermission] = useCameraPermissions();
    // onBarcodeScanned keeps firing for the same code while the camera is
    // active; latch after the first hit so callers don't get re-entered.
    const hasScannedRef = useRef(false);

    useEffect(() => {
        if (active) {
            hasScannedRef.current = false;
        }
    }, [active]);

    if (!permission?.granted) {
        return (
            <Box style={{ width: '100%', alignItems: 'center' }}>
                <Text>We need your permission to show the camera</Text>
                <Button onPress={requestPermission} size="md" action="primary" className="bg-blue-500 mt-4">
                    <ButtonText className="text-white">Grant Permission</ButtonText>
                </Button>
            </Box>
        );
    }

    if (!active) {
        return null;
    }

    return (
        <Box className="self-center rounded-2xl border-2 border-gray-300 bg-white p-1 dark:border-gray-600 dark:bg-black">
            <CameraView
                style={{ width: 320, height: 320, borderRadius: 12, overflow: 'hidden' }}
                facing={'back'}
                autofocus="on"
                barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
                onBarcodeScanned={(result) => {
                    if (result?.data && !hasScannedRef.current) {
                        hasScannedRef.current = true;
                        onScanned(result.data);
                    }
                }}
            />
        </Box>
    );
}
