import { Heading } from '@/components/ui/heading';
import { ScrollView } from "@/components/ui/scroll-view";
import { Button, ButtonText } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useState } from "react";
import { View, Alert } from 'react-native';
import { Constants } from '@/constants/Constants';
import { router, useLocalSearchParams } from 'expo-router';
import { checkBiometricAvailability } from '@/utility/biometricsSecurity/biometricSecurity';
import { Fingerprint, ScanFace } from 'lucide-react-native';

export default function BiometricAuthentication() {

    const isBiometricAuthenValid = async () => {
        try {
            const result = await checkBiometricAvailability();
            
            if (result?.success) {
               router.push({pathname:'/tabs/managekeys/ManageKeys'})
            } else {
                const raw = result?.error ?? 'Unknown error';
                const msg = typeof raw === 'string' ? raw : JSON.stringify(raw);
                Alert.alert('Authentication Failed:', msg);
            }
        } catch (error) {
            Alert.alert('Error', 'Failed to check biometric availability');
            return { success: false, error: error };
        }
    }

    return(
        <ScrollView className="flex-1 bg-white dark:bg-black" contentContainerStyle={{ alignItems: 'center' }}>
            <View className="w-full max-w-md mt-8 px-6">
                <View className="bg-gray-50 dark:bg-gray-900 rounded-lg p-6 shadow-md">
                    <Heading className="font-semibold text-2xl text-gray-900 dark:text-gray-100 mb-2">Enable Biometric</Heading>
                    <Text className="text-gray-700 dark:text-gray-300">Select biometric authentication methods below.</Text>

                    <View className="mt-6 space-y-3 pb-4">
                        
                        <Button onPress={() => {isBiometricAuthenValid()}}
                            size="md"
                            action="primary"
                            className="bg-blue-500 mb-4">
                            <ButtonText className="text-white"><Fingerprint color="white" size={18} /> Touch ID</ButtonText>
                        </Button>

                        <Button onPress={() => {isBiometricAuthenValid()}}
                            size="md"
                            action="primary"
                            className="bg-blue-500 mb-4">
                            <ButtonText className="text-white"><ScanFace color="white" size={18}/> Face ID</ButtonText>
                        </Button>

                        <Button size="md"
                            action="primary"
                            className="bg-blue-500" onPress={() => router.push('/tabs/(tabs)/Settings')}>
                            <ButtonText className="dark:text-gray-300">Back</ButtonText>
                        </Button>
                    </View>
                </View>
            </View>
        </ScrollView>
    )
}