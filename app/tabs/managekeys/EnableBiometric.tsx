
import { Heading } from '@/components/ui/heading';
import { ScrollView } from "@/components/ui/scroll-view";
import { Button, ButtonText } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { View, Alert } from 'react-native';
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Constants } from '@/constants/Constants';
import { router, useLocalSearchParams } from 'expo-router';
import { useSession } from '@/utility/session/SessionProvider';


export default function EnableBiometric() {
    const { user } = useSession();
    const param = useLocalSearchParams()
    const Const = Constants.ASYNC_STORAGE_KEYS;
    const [activeDialog, setActiveDialog] = useState<'touchID' | 'faceID' | null>(null);

    const enableBiometric = async () => {
        const bio_status = await AsyncStorage.getItem(Const.TOUCH_ID+user?.id);
        if (bio_status === 'true') {
            Alert.alert('Touch ID authentication is already enabled.');
            setActiveDialog(null);
            return;
        }

        await AsyncStorage.setItem(Const.TOUCH_ID+user?.id, 'true');
        setActiveDialog(null);

        if(param?.previousScreen !== '' && param?.previousScreen !== null && param?.previousScreen === 'completeProfile')
            router.replace('/tabs/(tabs)/Chat')
    };

    const enableFaceID = async () => {
        const bio_status = await AsyncStorage.getItem(Const.FACE_ID+user?.id);
        if (bio_status === 'true') {
            Alert.alert('Face ID authentication is already enabled.');
            setActiveDialog(null);
            return;
        }

        await AsyncStorage.setItem(Const.FACE_ID+user?.id, 'true');
        setActiveDialog(null);

        if(param?.previousScreen !== '' && param?.previousScreen !== null && param?.previousScreen === 'completeProfile')
            router.replace('/tabs/(tabs)/Chat')
    }
    const handleSkip = async () => {
        const skip = await AsyncStorage.getItem(Const.SKIP+user?.id)
        if(skip !== 'true'){
            await AsyncStorage.setItem(Const.SKIP+user?.id, 'true')
        }
        router.push({pathname: '/tabs/(tabs)/Chat'})
    }

    const dialogRef = {
        touchID: {
            title: 'Enable Touch ID',
            message: 'Allow Touch ID authentication to secure your keys and enhance security.',
            onConfirm: enableBiometric,
        },
        faceID: {
            title: 'Enable Face ID',
            message: 'Allow Face ID authentication to secure your keys and enhance security.',
            onConfirm: enableFaceID,
        },
    } as const;

    const activeDialogData = activeDialog ? dialogRef[activeDialog] : null;

    return (
        <ScrollView className="flex-1 bg-white dark:bg-black" contentContainerStyle={{ alignItems: 'center' }}>
            <View className="w-full max-w-md mt-8 px-6">
                <View className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 shadow-md">
                    <Heading className="font-semibold text-2xl text-gray-900 dark:text-gray-100 mb-2">Enable Biometric</Heading>
                    <Text className="text-gray-700 dark:text-gray-300">To enable biometric authentication, please follow the instructions below.</Text>

                    <View className="mt-6 space-y-3 pb-4">
                        <Button onPress={() => setActiveDialog('touchID')}
                            size="md"
                            action="primary"
                            className="bg-blue-500 mb-4">
                            <ButtonText className="text-white">Enable Touch ID</ButtonText>
                        </Button>

                        <Button onPress={() => setActiveDialog('faceID')}
                            size="md"
                            action="primary"
                            className="bg-blue-500 mb-4">
                            <ButtonText className="text-white">Enable Face ID</ButtonText>
                        </Button>

                        <Button size="md"
                            action="primary"
                            className="bg-blue-500" onPress={() => handleSkip()}>
                            <ButtonText className="dark:text-gray-300">Skip</ButtonText>
                        </Button>
                    </View>
                </View>

                {/* Manage Keys Dialog */}
                <AlertDialog isOpen={activeDialog !== null} onClose={() => setActiveDialog(null)} size="md">
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <Heading className="font-semibold text-xl text-gray-900 dark:text-gray-100">{activeDialogData?.title ?? 'Notification'}</Heading>
                        </AlertDialogHeader>
                        <AlertDialogBody className="mt-3 mb-4">
                            <Text size="sm" className="text-gray-700 dark:text-gray-300">
                                {activeDialogData?.message ?? 'Allow biometric authentication to secure your keys and enhance security.'}
                            </Text>
                        </AlertDialogBody>
                        <AlertDialogFooter className="flex-row space-x-3">
                            <Button size="sm" onPress={activeDialogData?.onConfirm} className="bg-blue-600 dark:bg-blue-500 rounded-md py-2 px-4">
                                <ButtonText className="text-white">Allow</ButtonText>
                            </Button>
                            <Button
                                variant="outline"
                                action="secondary"
                                onPress={() => setActiveDialog(null)}
                                size="sm"
                                className="border border-gray-300 dark:border-gray-700 rounded-md py-2 px-4"
                            >
                                <ButtonText>Cancel</ButtonText>
                            </Button>

                        </AlertDialogFooter>
                    </AlertDialogContent>
                </AlertDialog>
            </View>
        </ScrollView>
    );
}