import { useEffect, useState } from 'react';
import { Alert, Modal } from 'react-native';
import { ScrollView } from '@/components/ui/scroll-view';
import { Box } from '@/components/ui/box';
import { Text } from '@/components/ui/text';
import { Heading } from '@/components/ui/heading';
import { Button, ButtonText } from '@/components/ui/button';
import { Input, InputField } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { VStack } from '@/components/ui/vstack';
import { router } from 'expo-router';
import { useSession } from '@/utility/session/SessionProvider';
import { backupIdentityKey, hasVaultBackup } from '@/utility/securedMessage/VaultBackup';

/*
  Sealing the key behind a passphrase and sending it to the vault.

  Two things drive the shape of this screen. The passphrase is never recorded
  anywhere, so a typo here is indistinguishable from a forgotten passphrase
  later - hence the confirmation field. And a second backup replaces the first,
  so someone rotating their passphrase can destroy a working backup without
  ever being told; that is what the warning above the button is for.
*/

const MIN_PASSPHRASE_LENGTH = 10;

export default function BackupKey() {
    const { user } = useSession();

    const [passphrase, setPassphrase] = useState('');
    const [confirmation, setConfirmation] = useState('');
    const [working, setWorking] = useState(false);
    const [replacingExisting, setReplacingExisting] = useState(false);

    useEffect(() => {
        if (!user?.id) return;
        hasVaultBackup(user.id)
            .then(setReplacingExisting)
            .catch(() => {
                // Only decides which warning to show; the backup itself is
                // unaffected, so a failure here is not worth interrupting for.
            });
    }, [user?.id]);

    const canSubmit =
        passphrase.length >= MIN_PASSPHRASE_LENGTH && passphrase === confirmation && !working;

    const submit = async () => {
        if (!user?.id) {
            Alert.alert('Error', 'Session not ready');
            return;
        }
        if (passphrase !== confirmation) {
            Alert.alert('Error', 'The two passphrases do not match');
            return;
        }

        setWorking(true);
        try {
            await backupIdentityKey(user.id, passphrase);
            // Nothing keeps the passphrase past this point, here or anywhere else.
            setPassphrase('');
            setConfirmation('');
            router.replace({ pathname: '/tabs/(tabs)/Settings' });
            Alert.alert(
                'Backup saved',
                'Your key is stored encrypted. You will need this passphrase to recover it - nobody can reset it for you.'
            );
        } catch (error) {
            Alert.alert(
                'Backup failed',
                error instanceof Error ? error.message : 'Could not store the backup'
            );
        } finally {
            setWorking(false);
        }
    };

    return (
        <ScrollView
            className="flex-1 bg-white dark:bg-black"
            contentContainerStyle={{ flexGrow: 1, paddingBottom: 24 }}
        >
            <Box className="w-full max-w-md self-center px-6 pt-6">
                <Heading className="mb-2 text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    Back up your key
                </Heading>
                <Text className="text-gray-700 dark:text-gray-300">
                    Your key is encrypted on this device with a passphrase you choose, and only the
                    encrypted result is stored. It is what lets you read your messages again if you
                    lose every device you own.
                </Text>

                <Box className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-white">
                    <Text className="font-semibold">Choose a recovery passphrase</Text>
                    <Text className="mt-1 text-xs text-gray-500">
                        At least {MIN_PASSPHRASE_LENGTH} characters. Different from your login
                        password, and worth keeping in a password manager.
                    </Text>

                    <Input className="mt-3">
                        <InputField
                            value={passphrase}
                            onChangeText={setPassphrase}
                            placeholder="Recovery passphrase"
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </Input>

                    <Input className="mt-3">
                        <InputField
                            value={confirmation}
                            onChangeText={setConfirmation}
                            placeholder="Type it again"
                            secureTextEntry
                            autoCapitalize="none"
                            autoCorrect={false}
                        />
                    </Input>

                    {confirmation.length > 0 && passphrase !== confirmation && (
                        <Text className="mt-2 text-xs text-red-500">
                            These do not match yet.
                        </Text>
                    )}
                </Box>

                <Box className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-white">
                    <Text className="text-sm">
                        If you forget this passphrase, the backup cannot be opened - not by us, not
                        by anyone. There is no reset and no recovery email. That is the same reason
                        nobody else can read your messages.
                    </Text>
                    {replacingExisting && (
                        <Text className="mt-3 text-sm font-semibold text-red-500">
                            This account already has a backup. Saving a new one replaces it, and the
                            old passphrase stops working.
                        </Text>
                    )}
                </Box>

                <Button
                    onPress={submit}
                    isDisabled={!canSubmit}
                    size="md"
                    action="primary"
                    className="mt-6 bg-blue-500"
                >
                    <ButtonText className="text-white">
                        {replacingExisting ? 'Replace my backup' : 'Back up my key'}
                    </ButtonText>
                </Button>
            </Box>

            <Modal visible={working} transparent animationType="fade" statusBarTranslucent>
                <Box
                    className="flex-1 items-center justify-center"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                >
                    <VStack space="md" className="items-center rounded-2xl bg-white px-10 py-8 dark:bg-black">
                        <Spinner size="large" color="grey" />
                        <Text className="text-base font-semibold">Sealing your key</Text>
                        <Text className="text-xs text-gray-500">This takes a few seconds</Text>
                    </VStack>
                </Box>
            </Modal>
        </ScrollView>
    );
}
