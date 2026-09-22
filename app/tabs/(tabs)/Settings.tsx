import { useState, useEffect } from 'react';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { Spinner } from '@/components/ui/spinner';
import { Box } from '@/components/ui/box';
import { VStack } from '@/components/ui/vstack';
import { HStack } from '@/components/ui/hstack';
import { Button, ButtonText } from '@/components/ui/button';
import { Input, InputField } from '@/components/ui/input';
import { Avatar, AvatarFallbackText, AvatarImage, AvatarBadge } from '@/components/ui/avatar';
import { supabase } from '@/utility/connection';
import { ScrollView, Pressable, Alert, Modal } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import {
  AlertDialog,
  AlertDialogBackdrop,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogCloseButton,
  AlertDialogBody,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Icon, CloseIcon, SunIcon, MoonIcon } from '@/components/ui/icon';
import { authAPI, profileAPI }  from '@/utility/messages';
import {
  Actionsheet,
  ActionsheetContent,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
} from '@/components/ui/actionsheet';
import { handleDeviceFilePath, storageAPIs, utilityFunction, filesAPI } from '@/utility/handleStorage';
import { useSession } from '@/utility/session/SessionProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { deleteAccountAndLocalData } from '@/utility/account/deleteAccount';
import { Files } from '@/utility/types/supabse';
import { Switch } from '@/components/ui/switch';
import { automationLocatorsDataState } from '@/constants/automationLocatorsDataState';


export default function Settings() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [avatar, setAvatar] = useState('');
  const [displayName, setDisplayName] = useState('');
  

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [activeDialog, setActiveDialog] = useState<'displayName' | 'password' | 'deleteAccount' | 'manageKeys' | null>(null);
  const [showActionsheet, setShowActionsheet] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const { user, profile, isDarkMode, setDarkMode, fetchThemeMode } = useSession();


  useEffect(() => {
    if(!avatar || !displayName) {
      getProfile();
    }
  },[avatar, displayName])

  const getProfile = async () => {
    
    if (profile?.files_profiles) {
      const avaURL = utilityFunction.buildFileUrl(profile.files_profiles[0])
      setAvatar(avaURL)
      setDisplayName(profile.displayname||'')
    }
    else {
      const data = await authAPI.getProfileUser(user?.id ?? '');
      if (data?.data?.files_profiles) {        
        const avaURL = utilityFunction.buildFileUrl(data.data.files_profiles?.[0]);

        setAvatar(avaURL || '')
      }

      if (data?.data?.displayname) {
        setDisplayName(data.data.displayname)
      }
    }
  }

  async function updateProfile(): Promise<void> {
    setLoading(true);
    if (user?.id) {

      profileAPI.updateProfile({
        id: user?.id,
        displayname: displayName,
      })
      .catch((error) => {
            if (error) {
                  Alert.alert('Error', 'Failed to fetch account information');
                  throw new Error('Profile update failed');
                }
      })
      .finally(() => {
        setLoading(false);
        setActiveDialog(null);

        setSuccessMessage('Profile updated successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setActiveDialog(null);
      });
  }}

  async function updatePassword(password: string, confirmPassword: string): Promise<void> {
    try{   
      setLoading(true);
      if (password !== confirmPassword) {
        Alert.alert('Error', 'Passwords do not match');
        setLoading(false);
        return;
      }
      
      authAPI.updatePassword(password)
      .catch((error) => {
        if (error) {
          Alert.alert('Error', 'Failed to update password');
          throw new Error('Password update failed');
        }
      })
      .finally(() => {
        setSuccessMessage('Password updated successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setActiveDialog(null);
      });
    }
    catch (e) {
      Alert.alert('Error', 'Failed to update password');
      console.warn(e);
    }
    finally {
      setLoading(false);
    }
  }

  async function handleDeleteAccount(): Promise<void> {
    /*
      Close the dialog before any work starts, so the progress overlay is the
      only thing on screen and a second tap cannot start a second deletion.
    */
    setActiveDialog(null);
    setDeletingAccount(true);

    const deleted = await deleteAccountAndLocalData(user?.id || '', !!profile?.avatar_url);

    if (!deleted) {
      setDeletingAccount(false);
      Alert.alert('Error', 'Failed to delete account');
      return;
    }

    /*
      Leave first, confirm second. Alert is a native dialog rather than part of
      this tree, so it survives the unmount and lands on top of the screen the
      user has already been moved to - no tap standing between them and a
      Settings page that belongs to an account that no longer exists.
    */
    router.replace('/');
    Alert.alert('Account deleted', 'Your account and everything on this device have been removed.');
  }

  function pickImage() {
    handleDeviceFilePath.pickImageFromAlbumOrGallery().then((result) => {
      if (result != null)
      {
        setLoading(true);
        storageAPIs.resizedImage(result).then((data) => {

          storageAPIs.uploadAvatarToSupabase(data, user?.id || '')
          .then((data) => {
            const uploadedFile = data.msg?.data;
            if (data.msg?.success && uploadedFile){
              setAvatar(data.msg?.avatar_url || '');
            
              const avatar: Files = uploadedFile;
              avatar.profile_id = user?.id;

              filesAPI.selectFileProfile(user?.id??'').then((profileData) => {
                if(profileData?.data?.id){

                  avatar.id = profileData.data.id;
                  filesAPI.updateFileProfile(avatar);
                }
                else
                  filesAPI.insertFileProfile(avatar);
              })
              
            }
          }
          )
          .finally(async () => {
            setShowActionsheet(false);
            setLoading(false);
          });
        });
       
      }});
  }

  function takePicture() {
    handleDeviceFilePath.takePicture().then((result) => {
      if (result != null) {
        setLoading(true);
        storageAPIs.resizedImage(result).then((data) => {
          storageAPIs.uploadAvatarToSupabase(data, user?.id || '')
            .then((data) => {
              const uploadedFile = data.msg?.data;
              if (data.msg?.success && uploadedFile) {
                setAvatar(data.msg?.avatar_url || '');

                const avatar: Files = uploadedFile;
                avatar.profile_id = user?.id;

                filesAPI.selectFileProfile(user?.id ?? '').then((profileData) => {
                  if (profileData?.data?.id) {
                    avatar.id = profileData.data.id;
                    filesAPI.updateFileProfile(avatar);
                  } else {
                    filesAPI.insertFileProfile(avatar);
                  }
                });
              }
            })
            .finally(async () => {
              setShowActionsheet(false);
              setLoading(false);
            });
        });
      }
    });
  }

  //Toggle dark mode
  const toggleDarkMode = async (toggle: boolean) => {
    try {
      const mode = toggle ? 'dark' : 'light';
      await setDarkMode(mode);
      // fetchThemeMode is optional as setDarkMode already updates context, but keep in sync
      await fetchThemeMode();
    } catch (error) {
      console.log('Error on toggleDarkMode', error);
    }
  };

 
  return (
    <ScrollView className="flex-1 px-4 md:px-6 lg:px-8" contentContainerStyle={{ paddingTop: insets.top }}>
      <Box className="p-6">
        <Heading className="font-bold text-3xl mb-2">Settings</Heading>
        <Text className="text-gray-500 mb-6">Manage your profile and account</Text>

        {successMessage && (
          <Box className="bg-green-100 p-3 rounded-lg mb-4">
            <Text className="text-green-700">{successMessage}</Text>
          </Box>
        )}

        {/* Avatar Section */}
        <Box className={`mb-6 p-4 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} rounded-lg border`}>
          <HStack className="justify-between items-center mb-2">
            <Pressable testID={automationLocatorsDataState.settingsScreen.avatarImage} onPress={() => setShowActionsheet(true)}>
              <Avatar size="xl">
                <AvatarFallbackText>{displayName}</AvatarFallbackText>
                <AvatarImage
                  source={{
                    uri: `${avatar}`,
                  }}
                />
                <AvatarBadge />
              </Avatar>
            </Pressable>
            {loading ? <Spinner size="large" color="grey" />:<></>}
          </HStack>
        </Box>

        {/* Key management */}
        <Box className={`mb-6 p-4 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} rounded-lg border`}>
          <HStack className="justify-between items-center mb-2">
            <VStack className="flex-1">
              <Text className="text-lg font-semibold">Key Management</Text>
            </VStack>
            <Button
              testID={automationLocatorsDataState.settingsScreen.manageKeysButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => router.push({pathname:'/tabs/managekeys/BiometricAuthentication'})}
            >
              <ButtonText>Manage Keys</ButtonText>
            </Button>
          </HStack>
        </Box>

           {/* Biometric authentication */}
        <Box className={`mb-6 p-4 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} rounded-lg border`}>
          <HStack className="justify-between items-center mb-2">
            <VStack className="flex-1">
              <Text className="text-lg font-semibold">Biometric Authentication</Text>
            </VStack>
            <Button
              testID={automationLocatorsDataState.settingsScreen.manageBiometricsButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => router.push({
                pathname:'/tabs/managekeys/EnableBiometric',
                params:{
                  previousScreen: 'setting'
                }})}
            >
              <ButtonText>Manage Biometrics</ButtonText>
            </Button>
          </HStack>
        </Box>

        {/* Dark mode Section */}
        <Box className={`mb-6 p-4 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} rounded-lg border`}>
          <HStack className="justify-between items-center mb-2">
            <VStack className="flex-1">
              <Text className="text-lg font-semibold">Dark Mode: <Icon
                /* gluestack's Icon prop type omits testID even though it reaches
                   the native view. Spread, because JSX spreads are not excess
                   property checked - keeps the automation locator on the icon
                   itself rather than moving it to a wrapper. */
                {...{ testID: isDarkMode === 'dark' ? automationLocatorsDataState.settingsScreen.assertDarkMode : automationLocatorsDataState.settingsScreen.assertLightMode }}
                as={isDarkMode === 'dark' ? MoonIcon : SunIcon} className="mt-0.5 text-info-600" size="lg"/></Text>
            </VStack>
            <Switch
              testID={automationLocatorsDataState.settingsScreen.darkModeSwitch}
              size="lg"
              trackColor={{ false: '#d4d4d4', true: '#525252' }}
              thumbColor="#fafafa"
              defaultValue={isDarkMode == 'light'}
              onValueChange={(data) => { toggleDarkMode(data) }}
            />
          </HStack>
        </Box>
        
        {/* Display Name Section */}
        <Box className={`mb-6 p-4 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} rounded-lg border`}>
          <HStack className="justify-between items-center mb-2">
            <VStack className="flex-1">
              <Text className={`text-xs uppercase font-bold mb-2`}>Display Name</Text>
              <Text className={`text-lg font-semibold`}>{displayName || 'Not set'}</Text>
            </VStack>
            <Button
              testID={automationLocatorsDataState.settingsScreen.editDisplayNameButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => setActiveDialog('displayName')}
            >
              <ButtonText>Edit</ButtonText>
            </Button>
          </HStack>
        </Box>

        {/* Password Section */}
        <Box className={`mb-6 p-4 ${isDarkMode == "dark"? 'bg-black border-white':'bg-white border-gray-200'} rounded-lg border border-gray-200`}>
          <HStack className="justify-between items-center">
            <VStack>
              <Text className={`text-xs  uppercase font-bold mb-2`}>Password</Text>
              <Text >••••••••</Text>
            </VStack>
            <Button
            testID={automationLocatorsDataState.settingsScreen.changePasswordButton}
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => setActiveDialog('password')}
            >
              <ButtonText>Change</ButtonText>
            </Button>
          </HStack>
        </Box>
        <Button
        testID={automationLocatorsDataState.settingsScreen.deleteAccountButton}
          size="lg"
          className="bg-red-500 mb-6"
          onPress={() => setActiveDialog('deleteAccount')}
        >
          <ButtonText>Delete Account</ButtonText>
        </Button>
        {/* Sign Out Button */}
        <Button
        testID={automationLocatorsDataState.settingsScreen.logoutButton}
          size="lg"
          className="bg-red-500"
          onPress={async () => {
            await supabase.auth.signOut();
            await AsyncStorage.removeItem('user');
            await AsyncStorage.removeItem('profile');
            router.replace('/');
          }}
        >
          <ButtonText>Sign Out</ButtonText>
        </Button>
      </Box>

      {/* Unified Dialogs */}
      <AlertDialog isOpen={activeDialog !== null} onClose={() => setActiveDialog(null)}>
        <AlertDialogBackdrop />
        <AlertDialogContent>
          <AlertDialogHeader>
            <Heading size="lg">
              {activeDialog === 'displayName' && 'Change Display Name'}
              {activeDialog === 'password' && 'Change Password'}
              {activeDialog === 'deleteAccount' && 'Notification'}
            </Heading>
            {activeDialog !== 'deleteAccount' && (
              <AlertDialogCloseButton onPress={() => setActiveDialog(null)}>
                <Icon as={CloseIcon} />
              </AlertDialogCloseButton>
            )}
          </AlertDialogHeader>

          {activeDialog === 'displayName' && (
            <AlertDialogBody>
              <Input className="mt-4">
                <InputField
                  placeholder="Enter new display name"
                  value={displayName}
                  onChangeText={setDisplayName}
                />
              </Input>
            </AlertDialogBody>
          )}

          {activeDialog === 'password' && (
            <AlertDialogBody>
              <VStack space="md" className="mt-4">
                <Input>
                  <InputField
                    placeholder="New Password"
                    secureTextEntry
                    value={newPassword}
                    onChangeText={setNewPassword}
                  />
                </Input>
                <Input>
                  <InputField
                    placeholder="Confirm Password"
                    secureTextEntry
                    value={confirmPassword}
                    onChangeText={setConfirmPassword}
                  />
                </Input>
              </VStack>
            </AlertDialogBody>
          )}

          {activeDialog === 'deleteAccount' && (
            <AlertDialogBody className="mt-3 mb-4">
              <Text size="sm">
                Delete the account cannot be undone. Are you sure you want to delete your account?
              </Text>
            </AlertDialogBody>
          )}
          <AlertDialogFooter>
            {activeDialog === 'displayName' && (
              <>
                <Button
                  variant="outline"
                  action="secondary"
                  onPress={() => setActiveDialog(null)}
                >
                  <ButtonText>Cancel</ButtonText>
                </Button>
                <Button
                  className="bg-blue-500"
                  onPress={() => updateProfile()}
                  disabled={loading}
                >
                  <ButtonText>{loading ? 'Saving...' : 'Save'}</ButtonText>
                </Button>
              </>
            )}

            {activeDialog === 'password' && (
              <>
                <Button
                  variant="outline"
                  action="secondary"
                  onPress={() => setActiveDialog(null)}
                >
                  <ButtonText>Cancel</ButtonText>
                </Button>
                <Button
                  className="bg-blue-500"
                  onPress={() => updatePassword(newPassword, confirmPassword)}
                  disabled={loading}
                >
                  <ButtonText>{loading ? 'Saving...' : 'Update'}</ButtonText>
                </Button>
              </>
            )}

            {activeDialog === 'deleteAccount' && (
              <>
                <Button
                  variant="outline"
                  action="secondary"
                  onPress={() => setActiveDialog(null)}
                  size="sm"
                >
                  <ButtonText>Cancel</ButtonText>
                </Button>
                <Button size="sm" onPress={handleDeleteAccount} disabled={deletingAccount}>
                  <ButtonText>{deletingAccount ? 'Deleting...' : 'Okay'}</ButtonText>
                </Button>
              </>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <Actionsheet isOpen={showActionsheet} onClose={() => setShowActionsheet(false)}>
        <ActionsheetBackdrop />
        <ActionsheetContent>
          <ActionsheetDragIndicatorWrapper>
            <ActionsheetDragIndicator />
          </ActionsheetDragIndicatorWrapper>
          <ActionsheetItem onPress={takePicture}>
            <ActionsheetItemText>Take Photo</ActionsheetItemText>
          </ActionsheetItem>
          <ActionsheetItem onPress={pickImage}>
            <ActionsheetItemText>Select from album</ActionsheetItemText>
          </ActionsheetItem>
        </ActionsheetContent>
      </Actionsheet>

      {/* Progress overlay for account deletion - a Modal so it covers the ScrollView */}
      <Modal visible={deletingAccount} transparent animationType="fade" statusBarTranslucent>
        <Box
          className="flex-1 items-center justify-center"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}
        >
          <VStack
            space="md"
            className={`items-center rounded-2xl px-10 py-8 ${isDarkMode == "dark" ? 'bg-black' : 'bg-white'}`}
          >
            <Spinner size="large" color="grey" />
            <Text className="text-base font-semibold">Deleting your account</Text>
            <Text className="text-xs text-gray-500">This can take a moment</Text>
          </VStack>
        </Box>
      </Modal>
    </ScrollView>
  );
}
