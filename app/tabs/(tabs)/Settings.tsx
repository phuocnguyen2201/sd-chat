import React, { useState, useEffect } from 'react';
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
import { ScrollView, Pressable, Alert } from 'react-native';
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
import * as ImagePicker from 'expo-image-picker';
import { Icon, CloseIcon, CheckIcon } from '@/components/ui/icon';
import { authAPI, profileAPI }  from '../../../utility/messages';
import {
  Actionsheet,
  ActionsheetContent,
  ActionsheetItem,
  ActionsheetItemText,
  ActionsheetDragIndicator,
  ActionsheetDragIndicatorWrapper,
  ActionsheetBackdrop,
} from '@/components/ui/actionsheet';
import { handleDeviceFilePath, storageAPIs } from '@/utility/handleStorage';
import { useUser } from '@/utility/session/UserContext';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ref } from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import { MessageEncryption } from '@/utility/securedMessage/secured';


export default function Settings() {
  const router = useRouter();
  const [avatar, setAvatar] = useState('');
  const [displayName, setDisplayName] = useState('');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showDisplayNameDialog, setShowDisplayNameDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);

  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showActionsheet, setShowActionsheet] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  const { user, profile, refreshProfile } = useUser();

  useEffect(() => {
    if (profile?.avatar_url && profile?.displayname) {
      setAvatar(profile.avatar_url || '');  
      setDisplayName(profile.displayname || '');
    }
    else{
      authAPI.getProfileUser(user?.id || '').then((data) => {
        if (data) {
          setAvatar(data?.data?.avatar_url || '');
          setDisplayName(data?.data?.displayname || '');
        }
      });
    }

    }, [profile]);
  
  async function updateProfile(): Promise<void> {
    setLoading(true);
    if (user?.id) {
      const response = profileAPI.updateProfile({
      id: user?.id,
      displayname: displayName,
      avatar_url: avatar
    }).finally(() => {
      setLoading(false);
      setShowDisplayNameDialog(false);

      setSuccessMessage('Profile updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    });

    if (!response) {
      Alert.alert('Error', 'Failed to fetch account information');
      throw new Error('Profile update failed');
    }
  }}

  async function updatePassword(password: string, confirmPassword: string): Promise<void> {
    try{   
      setLoading(true);
      if (password !== confirmPassword) {
        Alert.alert('Error', 'Passwords do not match');
        setLoading(false);
        return;
      }
      const response = authAPI.updatePassword(password);
      if (!response) {
        Alert.alert('Error', 'Failed to update password');
        throw new Error('Password update failed');
      }
      else {
        setSuccessMessage('Password updated successfully');
        setTimeout(() => setSuccessMessage(''), 3000);
        setShowPasswordDialog(false);
      }
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
    try {
        if (profile?.avatar_url)
          await storageAPIs.deleteAvatarFromSupabase(user?.id || '');
        await MessageEncryption.deletePrivateKey();
        const success = await authAPI.deleteAccount();
        if (success) {
          
          Alert.alert('Success', 'Account deleted successfully');
        } else {
            Alert.alert('Error', 'Failed to delete account');
        }
    } catch (e) {
        Alert.alert('Error', 'Failed to delete account');
        console.warn(e);
    }
    finally {
        setShowDeleteDialog(false);
        router.replace('/');
    }
  }

  async function pickImage() {
    const result = await handleDeviceFilePath.pickImageFromAlbumOrGallery();
    if (result != null)
    { 
      storageAPIs.uploadAvatarToSupabase(result.uri, result.fileName, user?.id || '')
      .then(() => {
        setLoading(true);
      }).finally(() => {
        setLoading(false);
      });
    }
    setShowActionsheet(false);
  }

  async function takePicture() {
    const result =  await handleDeviceFilePath.takePicture();
    if (result != null)
    { 
      storageAPIs.uploadAvatarToSupabase(result.uri, result.fileName, user?.id || '').then(() => {
        setLoading(true);
      }).finally(() => {
        setLoading(false);

      });
    }
    setShowActionsheet(false);
  }
  return (
    <ScrollView className="flex-1 bg-white pt-safe px-4 md:px-6 lg:px-8">
      <Box className="p-6">
        <Heading className="font-bold text-3xl mb-2">Settings</Heading>
        <Text className="text-gray-500 mb-6">Manage your profile and account</Text>

        {successMessage && (
          <Box className="bg-green-100 p-3 rounded-lg mb-4">
            <Text className="text-green-700">{successMessage}</Text>
          </Box>
        )}

        {/* Avatar Section */}
        <Box className="mb-6 p-4 bg-white rounded-lg border border-gray-200">
          <HStack className="justify-between items-center mb-2">
            <Pressable onPress={() => setShowActionsheet(true)}>
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
        
        {/* Display Name Section */}
        <Box className="mb-6 p-4 bg-white rounded-lg border border-gray-200">
          <HStack className="justify-between items-center mb-2">
            <VStack className="flex-1">
              <Text className="text-xs text-gray-500 uppercase font-bold mb-2">Display Name</Text>
              <Text className="text-lg text-black font-semibold">{displayName || 'Not set'}</Text>
            </VStack>
            <Button
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => setShowDisplayNameDialog(true)}
            >
              <ButtonText>Edit</ButtonText>
            </Button>
          </HStack>
        </Box>

        {/* Password Section */}
        <Box className="mb-6 p-4 bg-white rounded-lg border border-gray-200">
          <HStack className="justify-between items-center">
            <VStack>
              <Text className="text-xs text-gray-500 uppercase font-bold mb-2">Password</Text>
              <Text className="text-gray-600">••••••••</Text>
            </VStack>
            <Button
              size="sm"
              action="primary"
              className="bg-blue-500"
              onPress={() => setShowPasswordDialog(true)}
            >
              <ButtonText>Change</ButtonText>
            </Button>
          </HStack>
        </Box>
        <Button
          size="lg"
          className="bg-red-500 mb-6"
          onPress={async () => {
            setShowDeleteDialog(true);}
          }
        >
          <ButtonText>Delete Account</ButtonText>
        </Button>
        {/* Sign Out Button */}
        <Button
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

      {/* Display Name Dialog */}
      <AlertDialog isOpen={showDisplayNameDialog} onClose={() => setShowDisplayNameDialog(false)}>
        <AlertDialogBackdrop />
        <AlertDialogContent>
          <AlertDialogHeader>
            <Heading size="lg">Change Display Name</Heading>
            <AlertDialogCloseButton onPress={() => setShowDisplayNameDialog(false)}>
              <Icon as={CloseIcon} />
            </AlertDialogCloseButton>
          </AlertDialogHeader>
          <AlertDialogBody>
            <Input className="mt-4">
              <InputField
                placeholder="Enter new display name"
                value={displayName}
                onChangeText={setDisplayName}
                className="text-black"
              />
            </Input>
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button
              variant="outline"
              action="secondary"
              onPress={() => setShowDisplayNameDialog(false)}
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
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Password Dialog */}
      <AlertDialog isOpen={showPasswordDialog} onClose={() => setShowPasswordDialog(false)}>
        <AlertDialogBackdrop />
        <AlertDialogContent>
          <AlertDialogHeader>
            <Heading size="lg">Change Password</Heading>
            <AlertDialogCloseButton onPress={() => setShowPasswordDialog(false)}>
              <Icon as={CloseIcon} />
            </AlertDialogCloseButton>
          </AlertDialogHeader>
          <AlertDialogBody>
            <VStack space="md" className="mt-4">
              <Input>
                <InputField
                  placeholder="New Password"
                  secureTextEntry
                  value={newPassword}
                  onChangeText={setNewPassword}
                  className="text-black"
                />
              </Input>
              <Input>
                <InputField
                  placeholder="Confirm Password"
                  secureTextEntry
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  className="text-black"
                />
              </Input>
            </VStack>
          </AlertDialogBody>
          <AlertDialogFooter>
            <Button
              variant="outline"
              action="secondary"
              onPress={() => setShowPasswordDialog(false)}
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
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account Dialog */}
      <AlertDialog isOpen={showDeleteDialog} onClose={handleDeleteAccount} size="md">
        <AlertDialogContent>
          <AlertDialogHeader>
            <Heading className="text-typography-950 font-semibold" size="md">
              Notification
            </Heading>
          </AlertDialogHeader>
          <AlertDialogBody className="mt-3 mb-4">
            <Text size="sm">
              Delete the account cannot be undone. Are you sure you want to delete your account?
            </Text>
          </AlertDialogBody>
          <AlertDialogFooter className="">
            <Button
              variant="outline"
              action="secondary"
              onPress={() => setShowDeleteDialog(false)}
              size="sm"
            >
              <ButtonText>Cancel</ButtonText>
            </Button>
            <Button size="sm" onPress={handleDeleteAccount}>
              <ButtonText>Okay</ButtonText>
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
        
      </AlertDialog>
      {/* <AlertDialogBackdrop /> */}
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
    </ScrollView>
  );
}
