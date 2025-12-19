
import { supabase } from './connection';
import { authAPI, profileAPI } from './messages';

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
    const regex = /\/storage\/v1\/object\/public\/avatars\/(.+)$/;
    if (profileUser?.avatar_url && profileUser.avatar_url.match(regex)) {
      // Extract path from existing avatar URL
      const url = new URL(profileUser.avatar_url);
      const path = url.pathname.replace('/storage/v1/object/public/', '');
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

export const handleFileSelection = {
  async pickAndUploadImage(
    conversation_id: string,
    userId: string | null
  ) {
    // Implementation for picking an image from device and uploading
    // This is a placeholder function; actual implementation will depend on the platform (React Native, Expo, etc.)
  },

  async pickAndUploadFile(
    conversation_id: string,
    userId: string | null
  ) {
    // Implementation for picking a file from device and uploading
    // This is a placeholder function; actual implementation will depend on the platform (React Native, Expo, etc.)
  }
}


