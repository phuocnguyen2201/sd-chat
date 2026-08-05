
import { Heading } from '@/components/ui/heading';
import { ScrollView } from "@/components/ui/scroll-view";
import { Button, ButtonText } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { AlertDialog, AlertDialogBody, AlertDialogContent, AlertDialogFooter, AlertDialogHeader } from "@/components/ui/alert-dialog";
import { useState } from "react";
import { View, Alert } from 'react-native';
import AsyncStorage from "@react-native-async-storage/async-storage";

export default function EnableBiometric() {
    const [showManageKeysDialog, setShowManageKeysDialog] = useState(false);

    const enableBiometric = async () => {
        const bio_status = await AsyncStorage.getItem('biometricEnabled');
        if (bio_status === 'true') {
            Alert.alert('Biometric authentication is already enabled.');
            setShowManageKeysDialog(false);
            return;
        }

        await AsyncStorage.setItem('biometricEnabled', 'true');

        setShowManageKeysDialog(false);
    };

    return (
        <ScrollView className="flex-1 bg-white dark:bg-black" contentContainerStyle={{ alignItems: 'center' }}>
            <View className="w-full max-w-md mt-8 px-6">
                <View className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 shadow-md">
                    <Heading className="font-semibold text-2xl text-gray-900 dark:text-gray-100 mb-2">Enable Biometric</Heading>
                    <Text className="text-gray-700 dark:text-gray-300">To enable biometric authentication, please follow the instructions below.</Text>

                    <View className="mt-6 space-y-3 pb-4">
                        <Button onPress={() => setShowManageKeysDialog(true)}
                            size="md"
                            action="primary"
                            className="bg-blue-500 mb-4">
                            <ButtonText className="text-white">Enable Biometric</ButtonText>
                        </Button>

                        <Button size="md"
                            action="primary"
                            className="bg-blue-500" onPress={() => {
                        }}>
                            <ButtonText className="dark:text-gray-300">Skip</ButtonText>
                        </Button>
                    </View>
                </View>

                {/* Manage Keys Dialog */}
                <AlertDialog isOpen={showManageKeysDialog} onClose={() => setShowManageKeysDialog(false)} size="md">
                    <AlertDialogContent>
                        <AlertDialogHeader>
                            <Heading className="font-semibold text-xl text-gray-900 dark:text-gray-100">Notification</Heading>
                        </AlertDialogHeader>
                        <AlertDialogBody className="mt-3 mb-4">
                            <Text size="sm" className="text-gray-700 dark:text-gray-300">
                                Allow biometric authentication to secure your keys and enhance security.
                            </Text>
                        </AlertDialogBody>
                        <AlertDialogFooter className="flex-row space-x-3">
                            <Button size="sm" onPress={enableBiometric} className="bg-blue-600 dark:bg-blue-500 rounded-md py-2 px-4">
                                <ButtonText className="text-white">Allow</ButtonText>
                            </Button>
                            <Button
                                variant="outline"
                                action="secondary"
                                onPress={() => setShowManageKeysDialog(false)}
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