
import { supabase } from './connection';
import { ApiResponse, Conversation, Database, Message, UserProfile } from './types/supabse';
import { createClient } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { get } from 'node:http';

// 1. Authentication with displayname

export const authAPI = {
  async signUp(
    email: string, 
    password: string,
    public_key: string
  ): Promise<ApiResponse<{ user: any }>> {
    try {
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password
      })
      
    if (authError) throw authError
    if (!authData.user) {
      throw new Error('User creation failed - no user returned')
    }
    const { error: profileError } = await supabase
      .from('profiles')
      .insert({
        id: authData.user.id, // Use the same ID from auth
        public_key: public_key,
        username: email?.split('@')[0] as string || '',
        created_at: new Date().toISOString()
      })
    if (profileError) throw profileError
      return { data: { user: authData.user }, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async signIn(email: string, password: string): Promise<ApiResponse<{ user: any }>> {
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password
      })
      
      if (error) throw error
      return { data: { user: data.user }, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async signOut(): Promise<ApiResponse<void>> {
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      await AsyncStorage.removeItem('user');
      await AsyncStorage.removeItem('profile');
      return { data: null, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async getCurrentUser(): Promise<ApiResponse<{ user: any }>> {
    try {
      const { data, error } = await supabase.auth.getUser()
      if (error) throw error
      return { data: { user: data.user }, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
   async getProfileUser(userId: string): Promise<ApiResponse<UserProfile>> {
    try {
      const user = await AsyncStorage.getItem('user').then(data => data ? JSON.parse(data) : null);

      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user?.id?? userId)
        .single()

      const userProfile: UserProfile = {
        id: user?.id || '',
        email: user?.email || '',
        username: user?.user_metadata?.username || '',
        displayname: profileData?.displayname || null,
        avatar_url: profileData?.avatar_url || null,
        public_key: profileData?.public_key || null,
        created_at: user?.created_at || ''
      }

      return { data: userProfile, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async updatePassword(newPassword: string): Promise<ApiResponse<void>> {
    try {
      const { data, error } = await supabase.auth.updateUser({
        password: newPassword
      })
      if (error) throw error
      return { data: null, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
    },
    async deleteAccount(): Promise<boolean> {
    try {
        const user = await AsyncStorage.getItem('user').then(data => data ? JSON.parse(data) : null);
        if (!user) {
            throw new Error('User not authenticated')
        }

      const { data: dataConversation, error } = await supabase
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', user.id)

      if (error) throw error;
      const conversation_id = dataConversation?.map(item => item.conversation_id) || [];

      const supabaseAdmin = createClient(
        process.env.EXPO_PUBLIC_SUPABASE_URL!,
        process.env.EXPO_PUBLIC_SUPABASE_SERVICE_KEY! // NOT the anon key
      )
      for (const conversa_id of conversation_id) {
      const { error: deleteMessages } = await supabaseAdmin
        .from('messages')
        .delete()
        .eq('conversation_id', conversa_id)

      if (deleteMessages) throw deleteMessages;
      const { error: deleteConversation_participant } = await supabaseAdmin
        .from('conversation_participants')
        .delete()
        .eq('conversation_id', conversa_id)
      
      if (deleteConversation_participant) throw deleteConversation_participant;
      const { error: deleteConversation } = await supabaseAdmin
        .from('conversations')
        .delete()
        .eq('id', conversa_id)

      if (deleteConversation) throw deleteConversation;
      }




      const { error: deleteError } = await supabaseAdmin.auth.admin.deleteUser(user.id)
      if (deleteError) throw deleteError

      const { error: profileError } = await supabase
        .from('profiles')
        .delete()
        .eq('id', user.id)  

      if (profileError) throw profileError
      await supabase.auth.signOut()
      return true
    } catch (error) {
      console.error('Error deleting account:', error)
        return false
    }
  }
}

// 2. User Profiles
export const profileAPI = {
  async getProfile(userId: string): Promise<ApiResponse<UserProfile>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async createProfile(profile: Partial<Pick<UserProfile, 'id' | 'username' | 'displayname' | 'avatar_url'>>): Promise<ApiResponse<UserProfile>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .insert(profile)
        .select()
        .single()
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async updateProfile(
    updates: Partial<Pick<UserProfile, 'id' |'username' | 'displayname' | 'avatar_url'>>
  ): Promise<ApiResponse<UserProfile>> {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .update(updates)
        .eq('id', updates.id)
        .select()
        .maybeSingle()
      
      if (error) throw error

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async getAllProfiles(): Promise<ApiResponse<UserProfile[]>> {
    try {
      const user = await AsyncStorage.getItem('user').then(data => data ? JSON.parse(data) : null);
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .neq('id', user?.id || '')
        .order('username')
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }
}
// 3. Conversations
export const conversationAPI = {
  async getOrCreateDM(otherUserId: string): Promise<ApiResponse<{ conversationId: string }>> {
    try {
      const { data, error } = await supabase.rpc('create_dm_conversation', {
        other_user_id: otherUserId
      })
      
      if (error) throw error
      return { data: { conversationId: data }, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async verifyDMConversation(otherUserId: string): Promise<ApiResponse<{ conversation_id: string | null }>> {
    try {
      const user = await AsyncStorage.getItem('user').then(data => data ? JSON.parse(data) : null);
const { data, error } = await supabase.rpc('get_conversation_between_users', {
        _user_a: otherUserId,
        _user_b: user?.id || ''
      })
      if (error) throw error
      return { data: data?.[0] , error: null }
    }
    catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async getConversations(): Promise<ApiResponse<Conversation[]>> {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(`
          *,
          conversation_participants!inner(
            profiles(id, username, displayname, avatar_url)
          ),
          messages(
            id,
            content,
            created_at,
            sender_id
          )
        `)
        .order('created_at', { foreignTable: 'messages', ascending: false })
        .limit(1, { foreignTable: 'messages' })
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async createGroupConversation(
    name: string,
    participantIds: string[]
  ): Promise<ApiResponse<Conversation>> {
    try {
      const user = await AsyncStorage.getItem('user').then(data => data ? JSON.parse(data) : null);
      if (!user) throw new Error('User not authenticated')
      
      // Create conversation
      const { data: conversation, error: convError } = await supabase
        .from('conversations')
        .insert({
          name,
          is_group: true,
          created_by: user.id
        })
        .select()
        .single()
      
      if (convError) throw convError
      
      // Add participants
      const participants = [
        { conversation_id: conversation.id, user_id: user.id },
        ...participantIds.map(id => ({ 
          conversation_id: conversation.id, 
          user_id: id 
        }))
      ]
      
      const { error: partError } = await supabase
        .from('conversation_participants')
        .insert(participants)
      
      if (partError) throw partError
      
      return { data: conversation, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },
  async storeConversationKey(conversationId: string, userId: string, wrappedKey: string, nonce: string, other_Public_Key: string): Promise<ApiResponse<void>> {
    try {
      // Implementation depends on how you want to store the key
      const { data, error } = await supabase
        .from('conversation_participants')
        .update({
          wrapped_key: wrappedKey,
          key_nonce: nonce,
          other_party_pub_key: other_Public_Key
        }).eq('conversation_id', conversationId)
        .eq('user_id', userId)
      
      if (error) throw error
      return { data: data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }
}



// 4. Messages
export const messageAPI = {
  async sendMessage(
    conversationId: string,
    content: string,
    messageType: string = 'text',
    metadata?: any
  ): Promise<ApiResponse<Message>> {
    try {
      const user = await AsyncStorage.getItem('user').then(data => data ? JSON.parse(data) : null);
      if (!user) throw new Error('User not authenticated')
      
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: conversationId,
          content,
          sender_id: user.id,
          message_type: messageType,
          metadata
        })
        .select()
        .single()
      
      if (error) throw error

      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async getMessages(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<ApiResponse<Message[]>> {
    try {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)
      
      if (error) throw error
      return { data, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  },

  async markMessagesAsRead(
    conversationId: string,
    userId: string
  ): Promise<ApiResponse<void>> {
    try {
      const { error } = await supabase.rpc('mark_messages_as_read', {
        p_conversation_id: conversationId,
        p_user_id: userId
      })
      
      if (error) throw error
      return { data: null, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }
}

// 5. Real-time Subscriptions
export const realtimeAPI = {
  subscribeToMessages(
    conversationId: string,
    callback: (message: Message) => void
  ) {
    return supabase
      .channel(`messages:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`
        },
        (payload) => callback(payload.new as Message)
      )
      .subscribe()
  },

  subscribeToConversations(
    userId: string,
    callback: (conversation: Conversation) => void
  ) {
    return supabase
      .channel(`user-conversations:${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${userId}`
        },
        async (payload) => {
          if (payload.eventType === 'INSERT') {
            const { data } = await supabase
              .from('conversations')
              .select(`
                *,
                conversation_participants!inner(
                  profiles(id, username, displayname, avatar_url)
                )
              `)
              .eq('id', payload.new.conversation_id)
              .single()
            
            if (data) callback(data)
          }
        }
      )
      .subscribe()
  }
}
// 6. Utility Functions
export const channelsAndUsersAPI = {
  async getChannelsAndUsers(): Promise<ApiResponse<{ channels: Conversation[]; users: UserProfile[] }>> {
    try {
      const [channelsRes, usersRes] = await Promise.all([
        conversationAPI.getConversations(),
        profileAPI.getAllProfiles()
      ])
      if (channelsRes.error) throw channelsRes.error
      if (usersRes.error) throw usersRes.error
      return { data: { channels: channelsRes.data || [], users: usersRes.data || [] }, error: null }
    } catch (error) {
      return { data: null, error: error as Error }
    }
  }
}

// Helper function to get user's display name
export function getUserDisplayName(
  profile: Pick<UserProfile, 'displayname' | 'username'> | null | undefined
): string {
  if (!profile) return 'Unknown User'
  return profile.displayname || profile.username || 'Unknown User'
}