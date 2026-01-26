import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback } from 'react';
import { supabase } from '../connection';
import { User, Profile } from '../types/user';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConversationKeyManager } from '../securedMessage/ConversationKeyManagement';

export interface SessionState {
  user: User;
  profile: Profile;
  conversationKey: Uint8Array | null; // Current conversation key
  currentConversationId: string | null;
  loading: boolean;
  initialized: boolean;
}

export interface SessionContextType extends SessionState {
  // Session management
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
  setCurrentConversation: (conversationId: string, key: Uint8Array | null) => Promise<void>;
  getConversationKey: (conversationId: string) => Promise<Uint8Array | null>;
  clearCurrentConversation: () => void;
}

const SessionContext = createContext<SessionContextType | undefined>(undefined);

interface SessionProviderProps {
  children: ReactNode;
}

export const SessionProvider: React.FC<SessionProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [conversationKey, setConversationKey] = useState<Uint8Array | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [initialized, setInitialized] = useState<boolean>(false);
  const isInitializing = useRef(false);

  // Fetch user profile from database
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .limit(1)

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        return null;
      }

      setProfile(profileData[0]);
      return profileData[0];
    } catch (error) {
      console.error('Error in fetchProfile:', error);
      return null;
    }
  }, []);

  // Refresh profile data
  const refreshProfile = useCallback(async (): Promise<void> => {
    if (user?.id) {
      await fetchProfile(user.id);
    }
  }, [user, fetchProfile]);

  // Set current conversation and load its key
  const setCurrentConversation = useCallback(async (
    conversationId: string,
    key: Uint8Array | null
  ): Promise<void> => {
    if (key) {
      // Store key in manager and set in state
      await ConversationKeyManager.setConversationKey(conversationId, key);
      setConversationKey(key);
      setCurrentConversationId(conversationId);
    } else {
      // Try to load from cache/storage
      const cachedKey = await ConversationKeyManager.getKey(conversationId);
      setConversationKey(cachedKey);
      setCurrentConversationId(conversationId);
    }
  }, []);

  // Get conversation key for a specific conversation
  const getConversationKey = useCallback(async (conversationId: string): Promise<Uint8Array | null> => {
    // If it's the current conversation, return cached key
    if (conversationId === currentConversationId && conversationKey) {
      return conversationKey;
    }
    
    // Otherwise, get from manager
    return await ConversationKeyManager.getKey(conversationId);
  }, [currentConversationId, conversationKey]);

  // Clear current conversation
  const clearCurrentConversation = useCallback(() => {
    setConversationKey(null);
    setCurrentConversationId(null);
  }, []);

  // Logout function
  const logout = useCallback(async (): Promise<void> => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      setConversationKey(null);
      setCurrentConversationId(null);
      await AsyncStorage.removeItem('profile');
      await AsyncStorage.removeItem('user');
      ConversationKeyManager.clear(); // Clear all conversation keys
    } catch (error) {
      console.error('Error logging out:', error);
    }
  }, []);

  // Initialize session on mount
  useEffect(() => {
    if (isInitializing.current) return;
    isInitializing.current = true;

    const initializeSession = async () => {
      setLoading(true);
      
      try {
        // Check for existing session
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          setLoading(false);
          setInitialized(true);
          return;
        }

        if (session?.user) {
          setUser(session.user);
          const profileData = await fetchProfile(session.user.id);
          if (profileData) {
            // Session restored successfully
          }
        }
      } catch (error) {
        console.error('Error initializing session:', error);
      } finally {
        setLoading(false);
        setInitialized(true);
        isInitializing.current = false;
      }
    };

    initializeSession();
  }, [fetchProfile]);

  // Listen for auth state changes
  useEffect(() => {
    if (!initialized) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          await fetchProfile(session.user.id);
        } else {
          setUser(null);
          setProfile(null);
          setConversationKey(null);
          setCurrentConversationId(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [initialized, fetchProfile]);

  // Persist user to AsyncStorage
  useEffect(() => {
    if (user) {
      AsyncStorage.setItem('user', JSON.stringify(user)).catch((err) => {
        console.warn('Failed to store user:', err);
      });
    } else {
      AsyncStorage.removeItem('user').catch((err) => {
        console.warn('Failed to remove user:', err);
      });
    }
  }, [user]);

  // Persist profile to AsyncStorage
  useEffect(() => {
    if (profile) {
      AsyncStorage.setItem('profile', JSON.stringify(profile)).catch((err) => {
        console.warn('Failed to store profile:', err);
      });
    } else {
      AsyncStorage.removeItem('profile').catch((err) => {
        console.warn('Failed to remove profile:', err);
      });
    }
  }, [profile]);

  const value: SessionContextType = {
    user,
    profile,
    conversationKey,
    currentConversationId,
    loading,
    initialized,
    refreshProfile,
    logout,
    setCurrentConversation,
    getConversationKey,
    clearCurrentConversation,
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
};

// Custom hook for using the session context
export const useSession = (): SessionContextType => {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};
