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
        <CameraView
            style={{ width: 320, height: 320, borderRadius: 16, overflow: 'hidden', alignSelf: 'center' }}
            facing={'back'}
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={(result) => {
                if (result?.data && !hasScannedRef.current) {
                    hasScannedRef.current = true;
                    onScanned(result.data);
                }
            }}
        />
    );
}
