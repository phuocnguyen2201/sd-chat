import { Files } from "./supabse";

export type User = {
  id: string;
  email?: string;
  user_metadata?: {
    [key: string]: any;
  };
  app_metadata?: {
    [key: string]: any;
  };
  created_at?: string;
  updated_at?: string;
} | null;

export type Profile = {
  id: string;
  email?: string;
  username?: string;
  displayname?: string;
  fcm_token?: string;
  public_key?: string;
  avatar_url?: string;
  bio?: string;
  created_at?: string;
  updated_at?: string;
  files_profiles?: Files[];
  // Add other profile fields as needed
} | null;

export type UserContextType = {
  user: User;
  profile: Profile;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
};