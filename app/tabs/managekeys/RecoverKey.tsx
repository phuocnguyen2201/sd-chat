import { useState } from 'react';
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
import {
    recoverIdentityKey,
    NoBackupFoundError,
    WrongPassphraseError,
    VaultUnreachableError,
    IdentityMismatchError,
} from '@/utility/securedMessage/VaultBackup';

/*
  The other way back in, for a device with no key and no second device to pair
  with. Reached from the scanner when Bootstrap has sent someone there with
  nothing to scan.

  Each failure gets its own message, because they call for completely different
  responses from the user: a wrong passphrase is worth another attempt, an
  unreachable vault is worth waiting out, and no backup at all means there is
  nothing here for them and they should stop trying.
*/

export default function RecoverKey() {
    const [passphrase, setPassphrase] = useState('');
    const [working, setWorking] = useState(false);

    const describe = (error: unknown): { title: string; message: string } => {
        if (error instanceof WrongPassphraseError) {
            return {
                title: 'That passphrase did not work',
                message:
                    'The backup could not be opened. Check for typos - it is the passphrase you chose when backing up, not your login password.',
            };
        }
        if (error instanceof NoBackupFoundError) {
            return {
                title: 'No backup found',
                message:
                    'This account has no key backup, so there is nothing to recover from here. Your messages can only come back from a device that still holds the key.',
            };
        }
        if (error instanceof VaultUnreachableError) {
            return {
                title: 'Backup service unreachable',
                message:
                    'The backup could not be fetched right now. Your backup is not lost - try again in a few minutes.',
            };
        }
        if (error instanceof IdentityMismatchError) {
            return {
                title: 'This backup does not match this account',
                message:
                    'The recovered key belongs to a different identity, so it was not installed. Nothing on this device was changed.',
            };
        }
        return {
            title: 'Recovery failed',
            message: error instanceof Error ? error.message : 'Could not recover the key',
        };
    };

    const submit = async () => {
        setWorking(true);
        try {
            await recoverIdentityKey(passphrase);
            setPassphrase('');
            router.replace({ pathname: '/tabs/(tabs)/Settings' });
            Alert.alert(
                'Key recovered',
                'This device can read your messages again. Conversations open as you visit them.'
            );
        } catch (error) {
            const { title, message } = describe(error);
            Alert.alert(title, message);
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
                    Recover from backup
                </Heading>
                <Text className="text-gray-700 dark:text-gray-300">
                    Enter the recovery passphrase you chose when you backed up your key. It is
                    checked on this device - it is never sent anywhere.
                </Text>

                <Input className="mt-6">
                    <InputField
                        value={passphrase}
                        onChangeText={setPassphrase}
                        placeholder="Recovery passphrase"
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                    />
                </Input>

                <Button
                    onPress={submit}
                    isDisabled={passphrase.length === 0 || working}
                    size="md"
                    action="primary"
                    className="mt-6 bg-blue-500"
                >
                    <ButtonText className="text-white">Recover my key</ButtonText>
                </Button>

                <Box className="mt-6 rounded-lg border border-gray-200 p-4 dark:border-white">
                    <Text className="text-sm">
                        Conversations come back as their keys are unwrapped, which happens as you
                        open them. A conversation whose key was only ever held on a lost device
                        cannot be restored this way.
                    </Text>
                </Box>

                <Button
                    onPress={() => router.back()}
                    size="md"
                    action="secondary"
                    variant="outline"
                    className="mt-4"
                >
                    <ButtonText>Back</ButtonText>
                </Button>
            </Box>

            <Modal visible={working} transparent animationType="fade" statusBarTranslucent>
                <Box
                    className="flex-1 items-center justify-center"
                    style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
                >
                    <VStack space="md" className="items-center rounded-2xl bg-white px-10 py-8 dark:bg-black">
                        <Spinner size="large" color="grey" />
                        <Text className="text-base font-semibold">Opening your backup</Text>
                        <Text className="text-xs text-gray-500">This takes a few seconds</Text>
                    </VStack>
                </Box>
            </Modal>
        </ScrollView>
    );
}
