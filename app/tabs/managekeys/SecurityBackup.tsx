import { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Button, ButtonText } from '@/components/ui/button';
import { useSession } from '@/utility/session/SessionProvider';
import { useConfirmIdentity } from '@/utility/auth/ConfirmIdentityProvider';
import { AppPin } from '@/utility/auth/AppPin';
import { automationLocatorsDataState } from '@/constants/automationLocatorsDataState';

/*
  Security & Backup, opened from Settings: key management (share, receive,
  back up), biometrics and the app PIN, kept off the main Settings screen.
*/
export default function SecurityBackup() {
  const router = useRouter();
  const { user, isDarkMode } = useSession();
  const { managePin } = useConfirmIdentity();
  const [hasAppPin, setHasAppPin] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    if (!user?.id) return;
    AppPin.hasPin(user.id).then(setHasAppPin).catch(() => setHasAppPin(false));
  }, [user?.id]);

  async function handleManagePin(): Promise<void> {
    const changed = await managePin();
    if (user?.id) {
      setHasAppPin(await AppPin.hasPin(user.id));
    }
    if (changed) {
      setSuccessMessage('App PIN saved');
      setTimeout(() => setSuccessMessage(''), 3000);
    }
  }

  const cardClass = `mb-6 p-4 ${isDarkMode == 'dark' ? 'bg-black border-white' : 'bg-white border-gray-200'} rounded-lg border`;

  return (
    <ScrollView className="flex-1 px-4 md:px-6 lg:px-8">
      <Box className="p-6">
        <Text className="text-gray-500 mb-6">Protect your account and the keys that unlock your chats</Text>

        {successMessage ? (
          <Box className="bg-green-100 p-3 rounded-lg mb-4">
            <Text className="text-green-700">{successMessage}</Text>
          </Box>
        ) : null}

        {/* Key management */}
        <Box className={cardClass}>
          <HStack className="justify-between items-center">
            <VStack className="flex-1 pr-3">
              <Text className="text-lg font-semibold">Key Management</Text>
              <Text className="text-xs text-gray-500">Share, receive and back up your keys</Text>
            </VStack>
            <Button
              testID={automationLocatorsDataState.settingsScreen.manageKeysButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => router.push({ pathname: '/tabs/managekeys/ManageKeys' })}
            >
              <ButtonText>Manage Keys</ButtonText>
            </Button>
          </HStack>
        </Box>

        {/* Biometric authentication */}
        <Box className={cardClass}>
          <HStack className="justify-between items-center">
            <VStack className="flex-1 pr-3">
              <Text className="text-lg font-semibold">Biometric Authentication</Text>
              <Text className="text-xs text-gray-500">Face ID or fingerprint</Text>
            </VStack>
            <Button
              testID={automationLocatorsDataState.settingsScreen.manageBiometricsButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() =>
                router.push({
                  pathname: '/tabs/managekeys/EnableBiometric',
                  params: { previousScreen: 'setting' },
                })
              }
            >
              <ButtonText>Manage Biometrics</ButtonText>
            </Button>
          </HStack>
        </Box>

        {/* App PIN: the fallback when Face ID / fingerprint is not available */}
        <Box className={cardClass}>
          <HStack className="justify-between items-center">
            <VStack className="flex-1 pr-3">
              <Text className="text-lg font-semibold">App PIN</Text>
              <Text className="text-xs text-gray-500">{hasAppPin ? 'Set' : 'Not set'}</Text>
            </VStack>
            <Button
              testID={automationLocatorsDataState.settingsScreen.manageAppPinButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={handleManagePin}
            >
              <ButtonText>{hasAppPin ? 'Change PIN' : 'Set up PIN'}</ButtonText>
            </Button>
          </HStack>
        </Box>
      </Box>
    </ScrollView>
  );
}
