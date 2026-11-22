import React, { createContext, useContext, useState, useEffect, ReactNode, useRef, useCallback, useMemo } from 'react';
import { supabase } from '../connection';
import { User, Profile } from '../types/user';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { ConversationKeyManager } from '../securedMessage/ConversationKeyManagement';
import { isAuthApiError } from '@supabase/supabase-js';
import { setSnapshotUser } from '../localstorage/snapshot';
import { RememberedAccounts } from '../auth/RememberedAccounts';
import { signOutThisDevice } from '../auth/signOutThisDevice';
import { utilityFunction } from '../handleStorage';

export interface SessionState {
  user: User;
  profile: Profile;
  isDarkMode: string;
  conversationKey: Uint8Array | null; // Current conversation key
  currentConversationId: string | null;
  loading: boolean;
  initialized: boolean;
}

export interface SessionContextType extends SessionState {
  // Session management
  refreshProfile: () => Promise<void>;
  fetchThemeMode: () => Promise<void>;
  setDarkMode: (mode: 'light' | 'dark') => Promise<void>;
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
  const [user, setUserState] = useState<User>(null);
  const userIdRef = useRef<string | null>(null);

  /*
    Every change of account goes through here, so the message cache points at
    the right account's file before any screen reads it (security #26).
  */
  const setUser = useCallback((next: User) => {
    userIdRef.current = next?.id ?? null;
    setSnapshotUser(next?.id ?? null);
    setUserState(next);
  }, []);
  const [profile, setProfile] = useState<Profile>(null);
  const [conversationKey, setConversationKey] = useState<Uint8Array | null>(null);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [initialized, setInitialized] = useState<boolean>(false);
  const [isDarkMode, setIsDarkMode] = useState<string>('light');

  const isInitializing = useRef(false);

  // Fetch user profile from database
  const fetchProfile = useCallback(async (userId: string): Promise<Profile | null> => {
    try {
      const { data: profileData, error: profileError } = await supabase
        .from('profiles')
        .select('*, files_profiles(*), push_notification_tokens(*)')
        .eq('id', userId)

      if (profileError) {
        console.error('Error fetching profile:', profileError);
        return null;
      }
      setProfile(profileData?.[0]);
      return profileData?.[0] || [];
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
      await ConversationKeyManager.setConversationKey(user?.id ?? '', conversationId, key);
      setConversationKey(key);
      setCurrentConversationId(conversationId);
    } else {
      // Try to load from cache/storage
      const cachedKey = await ConversationKeyManager.getKey(user?.id ?? '', conversationId);
      setConversationKey(cachedKey);
      setCurrentConversationId(conversationId);
    }
  }, [user]);

  // Get conversation key for a specific conversation
  const getConversationKey = useCallback(async (conversationId: string): Promise<Uint8Array | null> => {
    // If it's the current conversation, return cached key
    if (conversationId === currentConversationId && conversationKey) {
      return conversationKey;
    }
    
    // Otherwise, get from manager
    return await ConversationKeyManager.getKey(user?.id ?? '', conversationId);
  }, [user, currentConversationId, conversationKey]);

  // Clear current conversation
  const clearCurrentConversation = useCallback(() => {
    setConversationKey(null);
    setCurrentConversationId(null);
  }, []);

  // Logout function
  const logout = useCallback(async (): Promise<void> => {
    try {
      await signOutThisDevice(userIdRef.current ?? undefined);
      setUser(null);
      setProfile(null);
      setConversationKey(null);
      setCurrentConversationId(null);
      ConversationKeyManager.clear(); // Clear all conversation keys
    } catch (error) {
      console.error('Error logging out:', error);
    }
  }, [setUser]);

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
          /*
            A refresh token the server rejected (revoked, already used, or the
            account is gone) is an expected way for a session to end, not a
            crash: start signed out, and the account's card asks for the
            password. Only a non-auth error (offline) is worth a warning.
          */
          if (isAuthApiError(error)) {
            await supabase.auth.signOut({ scope: 'local' }).catch(() => {});
          } else {
            console.warn('Could not restore the session:', error.message);
          }
          setUser(null);
          return;
        }

        if (session?.user) {
          setUser(session.user);
          RememberedAccounts.saveSession(session).catch(() => {});
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
  }, [fetchProfile, setUser]);

  // Listen for auth state changes
  useEffect(() => {
    if (!initialized) return;

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          // Keep this account's newest tokens for its card on the login screen.
          RememberedAccounts.saveSession(session).catch(() => {});

          if (session.user.id !== userIdRef.current) {
            /*
              A different account (a card tap or another sign-in). Drop the
              previous account's state first and hold `loading`, so Bootstrap
              never routes the new user with the old user's profile.
            */
            setProfile(null);
            setConversationKey(null);
            setCurrentConversationId(null);
            setLoading(true);
            setUser(session.user);
            try {
              await fetchProfile(session.user.id);
            } finally {
              setLoading(false);
            }
            return;
          }

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
  }, [initialized, fetchProfile, setUser]);

  // Keep this account's card (name, email, avatar) current for the login screen.
  useEffect(() => {
    if (!user?.id || !profile || profile.id !== user.id || !profile.displayname) return;
    RememberedAccounts.upsert({
      userId: user.id,
      email: user.email ?? '',
      displayName: profile.displayname,
      avatarUrl: profile.files_profiles?.[0] ? utilityFunction.buildFileUrl(profile.files_profiles[0]) : '',
    }).catch((error) => console.warn('Could not save the account card:', error));
  }, [user?.id, user?.email, profile]);

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

  // Fetch theme mode from persistent storage
  const fetchThemeMode = useCallback(async () => {
    try {
      const updated = await AsyncStorage.getItem('darkmode');
      setIsDarkMode(updated === 'dark' ? 'dark' : 'light');
    } catch (error) {
      console.warn('Error fetching dark mode setting:', error);
      setIsDarkMode('light');
    }
  }, []);

  // Set theme mode in state and persist it
  const setDarkMode = useCallback(async (mode: 'light' | 'dark') => {
    try {
      setIsDarkMode(mode);
      await AsyncStorage.setItem('darkmode', mode);
    } catch (error) {
      console.warn('Error setting dark mode:', error);
    }
  }, []);

  useEffect(() => {
    fetchThemeMode();
  }, [fetchThemeMode]);

  const value: SessionContextType = useMemo(() => ({
    user,
    profile,
    isDarkMode,
    conversationKey,
    currentConversationId,
    loading,
    initialized,
    refreshProfile,
    fetchThemeMode,
    setDarkMode,
    logout,
    setCurrentConversation,
    getConversationKey,
    clearCurrentConversation,
  }), [
    user,
    profile,
    isDarkMode,
    conversationKey,
    currentConversationId,
    loading,
    initialized,
    refreshProfile,
    fetchThemeMode,
    setDarkMode,
    logout,
    setCurrentConversation,
    getConversationKey,
    clearCurrentConversation,
  ]);

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

export default React.memo(SessionProvider);
