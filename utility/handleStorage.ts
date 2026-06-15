
import { supabase } from './connection';
import { profileAPI } from './messages';
import * as ImagePicker from 'expo-image-picker';
import { Alert } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator'
import { ApiResponse, Files, Message } from './types/supabse';
import 'react-native-get-random-values';
import { DocumentPickerAsset } from 'expo-document-picker';
import { Constants } from '../constants/Constants';

export const storageAPIs = {
  async uploadImageToSupabase(
  image: ImagePicker.ImagePickerAsset,
  conversation_id: string,
  userId: string | null
) {
  try {
    const response = await fetch(image.uri);
    const arrayBuffer = await response.arrayBuffer();

    const fileToStore = `${Date.now()}-${image.fileName}`;
    const filePath = `${Constants.STORAGE_BUCKETS.MESSAGES}/${conversation_id}/${fileToStore}`;

    const { data, error } = await supabase.storage
      .from(Constants.STORAGE_BUCKETS.MESSAGES)
      .upload(filePath, arrayBuffer, {
        contentType: image.mimeType,
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage
    .from(Constants.STORAGE_BUCKETS.MESSAGES)
    .createSignedUrl(data.path, 60 * 60 * 24 * 365); // 365 days

    if (urlError) throw urlError;

    const token = await utilityFunction.getToken(publicUrl.signedUrl);

    // Send message with image URL
    const {data: newImage, error: errorImage} = await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: userId, message_type: 'image', content: image.fileName }])
      .select()
      .single();
    if(errorImage) throw errorImage

    const fileData: Files = {
      filepath: filePath,
      filename: fileToStore,
      mime_type: image.mimeType || 'unknown',
      original_name: image.fileName|| 'image.jpg',
      token: token,
      bucket_name: Constants.STORAGE_BUCKETS.MESSAGES,
      created_at: new Date().toISOString(),
      expires_date: new Date(Date.now() + 60 * 60 * 24 * 365 * 1000).toISOString(), // 1 year
      status: true,
      message_id: newImage.id,
    }

    await filesAPI.insertFilesMessages(fileData);
    
    //Update to Files table
    return { success: true, message: 'Image uploaded and sent!' };
  } catch (e) {
    console.warn('Image upload error:', e);
    return { success: false, error: 'Failed to upload image' };
  }
},
  async uploadFileToSupabase(
  file: DocumentPickerAsset,
  conversation_id: string,
  userId: string | null
) {
  try {
    const response = await fetch(file.uri);
    const arrayBuffer = await response.arrayBuffer();

    const fileToStore = `${Date.now()}-${file.name}`;
    const filePath = `${Constants.STORAGE_BUCKETS.FILES}/${conversation_id}/${fileToStore}`;
    
    const { data, error } = await supabase.storage
      .from(Constants.STORAGE_BUCKETS.FILES)
      .upload(filePath, arrayBuffer);

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage
    .from(Constants.STORAGE_BUCKETS.FILES)
    .createSignedUrl(data.path, 60 * 60 * 24 * 365); // 365 days

    if (urlError) throw urlError;

    const token = await utilityFunction.getToken(publicUrl.signedUrl);

    // Send message with file URL
    const {data: newFile, error: fileError } = await supabase
      .from('messages')
      .insert([{ conversation_id: conversation_id, sender_id: userId, message_type: 'file', content: file.name }])
      .select()
      .single();

    if(fileError) throw fileError

     const fileData: Files = {
      filepath: filePath,
      filename: fileToStore,
      mime_type: file.mimeType || 'unknown',
      original_name: file.name,
      token: token,
      bucket_name: Constants.STORAGE_BUCKETS.FILES,
      created_at: new Date().toISOString(),
      expires_date: new Date(Date.now() + 60 * 60 * 24 * 365 * 1000).toISOString(), // 1 year
      status: true,
      message_id: newFile.id,
      file_size: file.size || 0
    }
    await filesAPI.insertFilesMessages(fileData);
    return { success: true, message: 'File uploaded and sent!' };
  } catch (e) {
    console.warn('File upload error:', e);
    return { success: false, error: 'Failed to upload file' };
  }
},
  async uploadAvatarToSupabase(
  image: ImagePicker.ImagePickerAsset,
  userId: string
) {
  try {
    const response = await fetch(image.uri);
    const arrayBuffer = await response.arrayBuffer();
    await storageAPIs.deleteAvatarFromSupabase(userId); // Delete existing avatar if any

    const fileToStore = `${Date.now()}-${image.fileName}`;
    const filepath = `${Constants.STORAGE_BUCKETS.AVATARS}/${userId}/${fileToStore}`;
    
    const { data, error } = await supabase.storage
      .from(Constants.STORAGE_BUCKETS.AVATARS)
      .upload(filepath, arrayBuffer, {
        contentType: image.mimeType,
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage
    .from(Constants.STORAGE_BUCKETS.AVATARS)
    .createSignedUrl(data.path, 60 * 60 * 24 * 365); // 365 days

    if (urlError) throw urlError;
    
    // Update user's avatar URL
    //console.log('New avatar URL:', publicUrl.signedUrl);
    const token = utilityFunction.getToken(publicUrl.signedUrl);

    //Update or insert avatar for profile. Files and Images in messages no need to replace.
    
    const fileData: Files = {
      filepath: filepath,
      filename: fileToStore,
      mime_type: image.type || '',
      original_name: image.fileName || '',
      token: token,
      file_size: image.fileSize || 0,
      bucket_name: Constants.STORAGE_BUCKETS.AVATARS,
      created_at: new Date().toISOString(),
      expires_date: new Date(Date.now() + 60 * 60 * 24 * 365 * 1000).toISOString(), // 1 year
      status: true
    }

    return { msg: { success: true, avatar_url: publicUrl.signedUrl, data: fileData }, message: 'Avatar uploaded and updated!' };
  } catch (e) {
    console.warn('Avatar upload error:', e);
    return { msg: { success: false, avatar_url: null}, error: 'Failed to upload avatar' };
  }
  },
  async resizedImage(image: ImagePicker.ImagePickerAsset){
    const resized = await ImageManipulator.manipulateAsync(
      image.uri,
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
    return {
      ...image,
      uri: resized.uri,
      width: resized.width,
      height: resized.height
    }
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
        const { error: deleteError } = await supabase.storage.from(Constants.STORAGE_BUCKETS.AVATARS).remove([avatar.filepath]);
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
      return result.assets[0]
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
      return result.assets[0];
    }
    else
      return null;

  }
}

export const utilityFunction = {
  getToken(url: string){
    const params = new URL(url).searchParams;
    return params.get('token');
  },
  // Build a safe string URL from Files record (defensive: avoid passing objects to Image.uri)
  buildFileUrl(file: Files | null): string{
      if (!file) return '';
      try {
        const bucket = typeof file.bucket_name === 'string' ? file.bucket_name : String(file.bucket_name ?? '');
        const filepath = typeof file.filepath === 'string' ? file.filepath : (file.filepath && typeof file.filepath === 'object' ? String((file.filepath as any).path ?? (file.filepath as any).uri ?? JSON.stringify(file.filepath)) : String(file.filepath ?? ''));
        const token = typeof file.token === 'string' ? file.token : String(file.token ?? '');
        if (!bucket || !filepath) return '';
        const publicURLCombined = file.status === true ? `${process.env.EXPO_PUBLIC_SUPABASE_URL}/${process.env.EXPO_PUBLIC_PREPATH_STORAGE}/${bucket}/${filepath}?token=${token}` : 'INACTIVE';

        return publicURLCombined;
      } catch (e) {
        console.error('Error building file url:', e, file);
        return '';
      }
  }
}

// 5. Files and images
  
export const filesAPI = {
  async getFilesAndImagesOnly(select: Partial<Pick<Files, 'conversation_id'>>): Promise<ApiResponse<Message[]>>{
    try {
      const { data, error} = await supabase
      .from('messages')
      .select(`*, files!inner(*)`)
      .eq('conversation_id', select.conversation_id)
      .in('message_type',['image','file'])

      if (error) throw error
      return { data: data , error: null};
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async insertFilesMessages(insert: Files) : Promise<ApiResponse<Files>>{
    try {
      const {data, error} = await supabase
      .from('files')
      .insert(insert)
      .select()
      .single()
      
      if(error) throw error;

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async selectFileProfile(profile_id: string) : Promise<ApiResponse<Files>>{
    try {
      const {data, error} = await supabase
      .from('files_profiles')
      .select('*')
      .eq('profile_id', profile_id)
      .eq('bucket_name', Constants.STORAGE_BUCKETS.AVATARS)
      
      if(error) throw(error.message);

      return { data: data?.[0], error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
    async insertFileProfile(upsert: Files) : Promise<ApiResponse<Files>>{
    try {
      const {data, error} = await supabase
      .from('files_profiles')
      .insert(upsert)
      .select()
      .single()
      
      if(error) throw(error.message);

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async updateFileProfile(update: Files): Promise<ApiResponse<Files>>{
    try {
        const {data, error} = await supabase
      .from('files_profiles')
      .update(update)
      .eq('id', update.id)
      
      if(error) throw(error.message);

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
    async selectFileGroup(group_id: string) : Promise<ApiResponse<Files>>{
    try {
      const {data, error} = await supabase
      .from('files_group')
      .select('*')
      .eq('conversation_id', group_id)
      .eq('bucket_name', Constants.STORAGE_BUCKETS.AVATARS)
      
      if(error) throw(error.message);

      return { data: data?.[0], error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
    async insertFileGroup(upsert: Files) : Promise<ApiResponse<Files>>{
    try {
      const {data, error} = await supabase
      .from('files_group')
      .insert(upsert)
      .select()
      .single()
      
      if(error) throw(error.message);

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
    async updateFileGroup(update: Files) : Promise<ApiResponse<Files>>{
    try {
      const {data, error} = await supabase
      .from('files_group')
      .upsert(update)
      .select()
      .single()
      
      if(error) throw error;

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
}
