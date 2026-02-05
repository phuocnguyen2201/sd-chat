
import { supabase } from './connection';
import { authAPI, conversationAPI, messageAPI, profileAPI } from './messages';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator'
import { Files } from './types/supabse';
import 'react-native-get-random-values';
import { v4 as uuidv4 } from 'uuid';

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

    const fileToStore = `${Date.now()}-${fileName}`;
    const filePath = `${STORAGE_BUCKETS.MESSAGES}/${fileToStore}`;

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.MESSAGES)
      .upload(filePath, arrayBuffer, {
        contentType: 'image/jpeg',
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage
    .from(STORAGE_BUCKETS.MESSAGES)
    .createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days

    if (urlError) throw urlError;

    const token = await utilityFunction.getToken(publicUrl.signedUrl);

    // Send message with image URL
    const {data: newImage, error: errorImage}=await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: userId, message_type: 'image', content: fileName }])
      .select()
      .single();
    if(errorImage) throw errorImage

    const fileData: Files = {
      filepath: filePath,
      filename: fileToStore,
      mime_type: 'image/jpeg',
      original_name: fileName,
      token: token,
      bucket_name: STORAGE_BUCKETS.FILES,
      created_at: new Date().toISOString(),
      message_id: newImage.id
    }

    //Update to Files table
    await messageAPI.upsertFileAndImage(fileData);
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

    const fileToStore = `${Date.now()}-${fileName}`;
    const filePath = `${STORAGE_BUCKETS.FILES}/${fileToStore}`;
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.FILES)
      .upload(filePath, arrayBuffer);

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage
    .from(STORAGE_BUCKETS.FILES)
    .createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days

    if (urlError) throw urlError;

    const token = await utilityFunction.getToken(publicUrl.signedUrl);

    // Send message with file URL
    const {data: newFile, error: fileError } = await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: userId, message_type: 'file', content: fileName }])
      .select()
      .single();

    if(fileError) throw fileError

     const fileData: Files = {
      filepath: filePath,
      filename: fileToStore,
      mime_type: 'image/jpeg',
      original_name: fileName,
      token: token,
      bucket_name: STORAGE_BUCKETS.FILES,
      created_at: new Date().toISOString(),
      message_id: newFile.id
    }

    //Update to Files table
    await messageAPI.upsertFileAndImage(fileData);

    return { success: true, message: 'File uploaded and sent!' };
  } catch (e) {
    console.warn('File upload error:', e);
    return { success: false, error: 'Failed to upload file' };
  }
},
  async uploadAvatarToSupabase(
  imageUri: string,
  fileName: string,
  userId: string,
  groupOrIndividual: string = 'individual'
) {
  try {
    const response = await fetch(imageUri);
    const arrayBuffer = await response.arrayBuffer();
    await storageAPIs.deleteAvatarFromSupabase(userId); // Delete existing avatar if any

    const fileToStore = `${Date.now()}-${fileName}`;
    const filepath = `${STORAGE_BUCKETS.AVATARS}/${userId}/${fileToStore}`;
    
    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKETS.AVATARS)
      .upload(filepath, arrayBuffer, {
        contentType: 'image/jpeg',
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage
    .from(STORAGE_BUCKETS.AVATARS)
    .createSignedUrl(data.path, 60 * 60 * 24 * 365); // 365 days

    if (urlError) throw urlError;
    
    // Update user's avatar URL
    //console.log('New avatar URL:', publicUrl.signedUrl);
    const token = await utilityFunction.getToken(publicUrl.signedUrl)

    //Update or insert avatar for profile. Files and Images in messages no need to replace.
    const existed = 
      groupOrIndividual == 'group'?
      await profileAPI.getImagesbyGroup(userId): 
      await profileAPI.getImagesbyProfile(userId);

    const fileData: Files = {
      id: existed.data?.id || uuidv4(),
      filepath: filepath,
      filename: fileToStore,
      mime_type: 'image/jpeg',
      original_name: fileName,
      token: token,
      bucket_name: STORAGE_BUCKETS.AVATARS,
      created_at: new Date().toISOString(),
      conversation_id: groupOrIndividual == 'group'? userId : null,
      profile_id: groupOrIndividual == 'individual'? userId : null,
    }

    await messageAPI.upsertFileAndImage(fileData);

    return { msg: { success: true, avatar_url: publicUrl.signedUrl}, message: 'Avatar uploaded and updated!' };
  } catch (e) {
    console.warn('Avatar upload error:', e);
    return { msg: { success: false, avatar_url: null}, error: 'Failed to upload avatar' };
  }
  },
  async resizedImage(uri: string){
    const resized = await ImageManipulator.manipulateAsync(
      uri,
      [
        {
          resize: {width: 128}
        }
      ],
      {
        compress: 0.7,
        format:ImageManipulator.SaveFormat.JPEG
      }
    )
    return resized
  },
  async deleteAvatarFromSupabase(
  userId: string
) {
    try {
      const { data: avatar, error: avatarError } = await profileAPI.getImagesbyProfile(userId);
      // Check for existing avatar and delete it
     // console.log('User data for avatar deletion:', avatar);
      if (avatarError) {
        console.log('Error',avatarError);
        return;
      }

      if (avatar && avatar?.filepath) {
        // const filePath = `${STORAGE_BUCKET.AVATARS}/${user.id}/${fileName}`;
        const { error: deleteError } = await supabase.storage.from(STORAGE_BUCKETS.AVATARS).remove([avatar.filepath]);
        if (deleteError) {
          console.warn('Error deleting existing avatar:', deleteError);
          return { success: false, error: 'Failed to delete avatar' };
        }
        return { success: true, message: 'Avatar deleted successfully' };
      }

      return { success: false, error: 'No avatar to delete' };
    } catch (e) {
      console.warn('Avatar deletion error:', e);
      return { success: false, error: 'Failed to delete avatar' };
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

export const utilityFunction ={
  async getToken(url: string){
    const params = new URL(url).searchParams;
    return params.get('token');
  },
  async getImageOrFileStorageURL(file: Files){
    return `${process.env.EXPO_PUBLIC_SUPABASE_URL}/${process.env.EXPO_PUBLIC_PREPATH_STORAGE}/${file.bucket_name}/${file.filepath}?token=${file.token}`
  },
}


