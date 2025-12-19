
import { supabase } from './connection';
import { authAPI, profileAPI } from './messages';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';

export const STORAGE_BUCKETS = {
  MESSAGES: 'storage-msg',
  FILES: 'chat-files',
  AVATARS: 'avatars',
};

export const storageAPIs = {
  async uploadImageToSupabase(
  imageUri: string,
  fileName: string,
  conversation_id: string,
  userId: string | null
) {
  try {
    const response = await fetch(imageUri);
    const arrayBuffer = await response.arrayBuffer();
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.MESSAGES)
      .upload(`images/${Date.now()}-${fileName}`, arrayBuffer, {
        contentType: 'image/jpeg',
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage.from(STORAGE_BUCKETS.MESSAGES).createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days

    if (urlError) throw urlError;
    
    // Send message with image URL
    await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: userId, content: `${publicUrl.signedUrl}` }])
      .select()
      .single();

    return { success: true, message: 'Image uploaded and sent!' };
  } catch (e) {
    console.warn('Image upload error:', e);
    return { success: false, error: 'Failed to upload image' };
  }
},
  async uploadFileToSupabase(
  fileUri: string,
  fileName: string,
  conversation_id: string,
  userId: string | null
) {
  try {
    const response = await fetch(fileUri);
    const arrayBuffer = await response.arrayBuffer();
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.FILES)
      .upload(`files/${Date.now()}-${fileName}`, arrayBuffer);

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage.from('chat-files').createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days

    if (urlError) throw urlError;

    // Send message with file URL
    await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: userId, content: `${publicUrl.signedUrl}` }])
      .select()
      .single();

    return { success: true, message: 'File uploaded and sent!' };
  } catch (e) {
    console.warn('File upload error:', e);
    return { success: false, error: 'Failed to upload file' };
  }
},
  async uploadAvatarToSupabase(
  imageUri: string,
  fileName: string,
  userId: string
) {
  try {
    const response = await fetch(imageUri);
    const arrayBuffer = await response.arrayBuffer();
    const { data: profileUser, error: profileError } = await authAPI.getProfileUser();

    // Check for existing avatar and delete it
    if (profileError) {
      throw profileError;
    }
    if (profileUser?.avatar_url) {
      // Extract path from existing avatar URL
      const url = new URL(profileUser.avatar_url);
      const path = url.pathname.replace('/storage/v1/object/sign/avatars/', '');
      // Delete existing avatar
      const { error: deleteError } = await supabase.storage.from(STORAGE_BUCKETS.AVATARS).remove([path]);
      if (deleteError) {
        console.warn('Error deleting existing avatar:', deleteError);
      }
    }

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.AVATARS)
      .upload(`avatars/${userId}/${Date.now()}-${fileName}`, arrayBuffer, {
        contentType: 'image/jpeg',
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage.from(STORAGE_BUCKETS.AVATARS).createSignedUrl(data.path, 60 * 60 * 24 * 365); // 365 days

    if (urlError) throw urlError;
    
    // Update user's avatar URL
    //console.log('New avatar URL:', publicUrl.signedUrl);
    await profileAPI.updateProfile({ id: userId, avatar_url: publicUrl.signedUrl });

    return { success: true, message: 'Avatar uploaded and updated!' };
  } catch (e) {
    console.warn('Avatar upload error:', e);
    return { success: false, error: 'Failed to upload avatar' };
  }
  }
};

export const handleDeviceFilePath = {
    async pickImageFromAlbumOrGallery() {
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
      return { uri, fileName};
    
    }
    else 
      return null;
  },

  async takePicture() {
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
      return { uri, fileName};

    }
    else
      return null;

  }
}


