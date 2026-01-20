// types/supabase.ts
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string
          username: string
          displayname: string | null
          avatar_url: string | null
          created_at: string
        }
        Insert: {
          id: string
          username: string
          displayname?: string | null
          avatar_url?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          username?: string
          displayname?: string | null
          avatar_url?: string | null
          created_at?: string
        }
      }
      conversations: {
        Row: {
          id: string
          name: string | null
          is_group: boolean
          created_at: string
          created_by: string
        }
        Insert: {
          id?: string
          name?: string | null
          is_group?: boolean
          created_at?: string
          created_by: string
        }
        Update: {
          id?: string
          name?: string | null
          is_group?: boolean
          created_at?: string
          created_by?: string
        }
      }
      conversation_participants: {
        Row: {
          conversation_id: string
          user_id: string
          joined_at: string
        }
        Insert: {
          conversation_id: string
          user_id: string
          joined_at?: string
        }
        Update: {
          conversation_id?: string
          user_id?: string
          joined_at?: string
        }
      }
      messages: {
        Row: {
          id: string
          conversation_id: string
          sender_id: string
          content: string
          message_type: string
          metadata: Json | null
          created_at: string
          read_by: string[]
        }
        Insert: {
          id?: string
          conversation_id: string
          sender_id: string
          content: string
          message_type?: string
          metadata?: Json | null
          created_at?: string
          read_by?: string[]
        }
        Update: {
          id?: string
          conversation_id?: string
          sender_id?: string
          content?: string
          message_type?: string
          metadata?: Json | null
          created_at?: string
          read_by?: string[]
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      create_dm_conversation: {
        Args: { other_user_id: string }
        Returns: string
      }
      mark_messages_as_read: {
        Args: { p_conversation_id: string; p_user_id: string }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
  }
}

// types/auth.ts
export interface UserProfile {
  id: string
  email: string
  username: string
  displayname: string | null
  avatar_url: string | null
  public_key: string | null
  created_at: string
}

export interface Conversation {
  id: string
  name: string | null
  is_group: boolean
  created_at: string
  created_by: string
  participants: Array<{
    profiles: Pick<UserProfile, 'id' | 'username' | 'displayname'>
  }>
  messages?: Message[]
}

export interface Message {
  id: string
  conversation_id: string
  sender_id: string
  content: string
  message_type: string
  metadata: Json | null
  created_at: string
  read_by: string[]
}

export interface Reaction {
  id: string
  sender_id: string
  sender_username: string
  emoji: string
  message_id: string
}

export interface ApiResponse<T> {
  data: T | null
  error: Error | null
}