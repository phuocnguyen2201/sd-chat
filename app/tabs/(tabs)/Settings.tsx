import React, { useState, useEffect } from 'react';
import { Heading } from '@/components/ui/heading';
import { Text } from '@/components/ui/text';
import { Image } from '@/components/ui/image';
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
import { storageAPIs } from '@/utility/handleStorage';

const AVATARS = ['😀', '😎', '🤩', '😊', '🥳', '😇', '🤗', '😋', '😜', '🤔'];

export default function Settings() {
  const router = useRouter();
  const [avatar, setAvatar] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState<string>(AVATARS[0]);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showDisplayNameDialog, setShowDisplayNameDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [showIconDialog, setShowIconDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showActionsheet, setShowActionsheet] = useState(false);
  
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');

  useEffect(() => {
    getCurrentUserProfile();
  }, []);



  async function getCurrentUserProfile(): Promise<void> {
    try
    { 
      const response = await authAPI.getProfileUser();
      if (response.data) {
        console.log('Profile data:', response.data.avatar_url);
          setAvatar(response.data.avatar_url || '');
          setDisplayName(response.data.displayname || '');
          setSelectedIcon(response.data.avatar_url || AVATARS[0]);
      }
    } catch (e) {
      Alert.alert('Error', 'Failed to fetch account information');
      console.warn(e);
    }
  };

  async function updateProfile(): Promise<void> {
    setLoading(true);
    supabase.auth.getSession()
    .then(async ({ data: { session } }) => {
    if (session) {
      const response = await profileAPI.updateProfile({
      id: session.user.id,
      displayname: displayName,
      avatar_url: selectedIcon
    });
    if (!response) {
      Alert.alert('Error', 'Failed to fetch account information');
      throw new Error('Profile update failed');
    }

    }}).finally(() => {
      setLoading(false);
      setShowDisplayNameDialog(false);
      setShowIconDialog(false);
      setSuccessMessage('Profile updated successfully');
      setTimeout(() => setSuccessMessage(''), 3000);
    });
  }

  async function updatePassword(password: string, confirmPassword: string): Promise<void> {
    try{   
      setLoading(true);
      if (password !== confirmPassword) {
        Alert.alert('Error', 'Passwords do not match');
        setLoading(false);
        return;
      }
      const response = await authAPI.updatePassword(password);
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
  async function pickImageFromAlbumOrGallery() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need permission to access your photo library.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const fileName = uri.split('/').pop() || 'image.jpg';
      setLoading(true);
      await storageAPIs.uploadAvatarToSupabase(uri, fileName, (await supabase.auth.getUser()).data.user?.id || '');
      setLoading(false);
    }
    setShowActionsheet(false);
  }

  async function takePicture() {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    
    if (status !== 'granted') {
      Alert.alert('Permission Denied', 'We need permission to access your camera.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 1,
    });

    if (!result.canceled && result.assets.length > 0) {
      const uri = result.assets[0].uri;
      const fileName = uri.split('/').pop() || 'image.jpg';
      console.log('Captured image URI:', uri);
      console.log('Captured image file name:', fileName);
      setLoading(true);
      await storageAPIs.uploadAvatarToSupabase(uri, fileName, (await supabase.auth.getUser()).data.user?.id || '');
      setLoading(false);
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

      {/* Icon Picker Dialog */}
      <AlertDialog isOpen={showIconDialog} onClose={() => setShowIconDialog(false)}>
        <AlertDialogBackdrop />
        <AlertDialogContent>
          <AlertDialogHeader>
            <Heading size="lg">Choose Avatar</Heading>
            <AlertDialogCloseButton onPress={() => setShowIconDialog(false)}>
              <Icon as={CloseIcon} />
            </AlertDialogCloseButton>
          </AlertDialogHeader>
          <AlertDialogBody>
            <Box className="flex-row flex-wrap justify-between gap-2 mt-4">
              {AVATARS.map((avatar) => (
                <Pressable
                  key={avatar}
                  onPress={() => {
                    setSelectedIcon(avatar);
                  }}
                  className={`p-3 rounded-full ${selectedIcon === avatar ? 'bg-blue-500' : 'bg-gray-100'}`}
                >
                  <Text className="text-3xl">{avatar}</Text>
                </Pressable>
              ))}

            </Box>
            <Button
              variant="outline"
              action="primary"
              onPress={() => updateProfile()}
            >
              <ButtonText>Save</ButtonText>
            </Button>
          </AlertDialogBody>
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
          <ActionsheetItem onPress={pickImageFromAlbumOrGallery}>
            <ActionsheetItemText>Select from album</ActionsheetItemText>
          </ActionsheetItem>
        </ActionsheetContent>
      </Actionsheet>
    </ScrollView>
  );
}
