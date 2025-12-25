import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase } from '../../utility/connection';
import { User, Profile, UserContextType } from '../types/user';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Create context with default values
const UserContext = createContext<UserContextType>({
  user: null,
  profile: null,
  loading: true,
  refreshProfile: async () => {},
  logout: async () => {},
});

interface UserProviderProps {
  children: ReactNode;
}

export const UserProvider: React.FC<UserProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User>(null);
  const [profile, setProfile] = useState<Profile>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Fetch user profile from database
  const fetchProfile = async (): Promise<void> => {
      try {
        const { data: user, error } = await supabase.auth.getUser()
        const { data: profileData, error: profileError } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', user.user?.id)
          .single()
  
        if (error || profileError) throw error

        setProfile(profileData);

      } catch (error) {
         return Promise.reject(error);
      }
  };

  // Refresh profile data
  const refreshProfile = async (): Promise<void> => {
    if (user) {
      await fetchProfile;
    }
  };

  // Logout function
  const logout = async (): Promise<void> => {
    try {
      await supabase.auth.signOut();
      setUser(null);
      setProfile(null);
      await AsyncStorage.removeItem('profile');
      await AsyncStorage.removeItem('user');
      router.replace('/');
    } catch (error) {
      console.error('Error logging out:', error);
    }
  };

  useEffect(() => {
    user ? 
    AsyncStorage.setItem('user', JSON.stringify(user)).catch((err)=>{ console.warn('Failed to store user:', err)})
    :
    AsyncStorage.removeItem('user').catch(err => console.warn('Failed to remove user:', err));
  }, [user]);

  useEffect(() => {
    profile? AsyncStorage.setItem('profile', JSON.stringify(profile)).catch((err)=>{ console.warn('Failed to store profile:', err)})
    :
    AsyncStorage.setItem('profile', JSON.stringify(profile)).catch((err)=>{ console.warn('Failed to remove profile:', err)})
  }, [profile]);

  useEffect(() => {
    // Check initial session ONCE
    const checkSession = async (): Promise<void> => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        
        if (session?.user) {
          setUser(session.user);
          await fetchProfile();
      
          // Check if profile is complete
          const { data: profileData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();
          setProfile(profileData);

          if (!profileData?.displayname) {
            router.replace('/CompleteProfile');
          }
          else {
            router.push({
              pathname: '/tabs/(tabs)/Chat'
            });
          }
        }
      } catch (error) {
        console.error('Error checking session:', error);
      } finally {
        setLoading(false);
      }
    };

    checkSession();

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          await fetchProfile;
        } else {
          setUser(null);
          setProfile(null);
        }
        setLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);
  
  const value: UserContextType = {
    user,
    profile,
    loading,
    refreshProfile,
    logout,
  };

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
};

// Custom hook for using the user context
export const useUser = (): UserContextType => {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
};