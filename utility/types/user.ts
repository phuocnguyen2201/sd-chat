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
  push_notification_tokens: Push_Tokens[];
  // Add other profile fields as needed
} | null;

export type Push_Tokens = {
  id?: string;
  profile_id?: string;
  token: string;
  platform?: string;
  provider?: string;
  is_active?: boolean;
  created_at?: string;
  updated_at?: string;
}

export type UserContextType = {
  user: User;
  profile: Profile;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  logout: () => Promise<void>;
};
export type KeyObject = {
  req: string;
  userId?: string;
  validTime: number;
  private_key:string;
  list: list[]
}
type list = {id:string, key:string}

// Step 1 of device pairing: the receiving device shows this QR containing
// only an ephemeral public key - useless to a bystander on its own.
export type PairInitPayload = {
  req: 'pair_init';
  ephemeralPublicKey: string; // base64
  userId?: string;
  expiresAt: number;
};

// Step 2: the sending device shows this QR containing the actual key
// material sealed (ECDH + AEAD) to the ephemeral public key from step 1.
// A bystander who scans it gets ciphertext they cannot open.
export type PairDataPayload = {
  req: 'pair_data';
  senderEphemeralPublicKey: string; // base64
  ciphertext: string; // base64
  nonce: string; // base64
  expiresAt: number;
};