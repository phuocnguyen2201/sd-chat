import { DocumentPickerAsset } from 'expo-document-picker';
import { supabase } from './connection';
import { Alert } from 'react-native';

async function uploadImageToSupabase(
  imageUri: string,
  fileName: string,
  conversation_id: string,
  userId: string | null,
  bucket: string = 'storage-msg'
) {
  try {
    const response = await fetch(imageUri);
    const arrayBuffer = await response.arrayBuffer();
    
    const { data, error } = await supabase.storage
      .from(bucket)
      .upload(`images/${Date.now()}-${fileName}`, arrayBuffer, {
        contentType: 'image/jpeg',
      });

    if (error) throw error;

    const { data: publicUrl, error: urlError } = await supabase.storage.from(bucket).createSignedUrl(data.path, 60 * 60 * 24 * 7); // 7 days

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
}

async function uploadFileToSupabase(
  fileUri: string,
  fileName: string,
  conversation_id: string,
  userId: string | null
) {
  try {
    const response = await fetch(fileUri);
    const arrayBuffer = await response.arrayBuffer();
    
    const { data, error } = await supabase.storage
      .from('chat-files')
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
}

export { uploadImageToSupabase, uploadFileToSupabase };