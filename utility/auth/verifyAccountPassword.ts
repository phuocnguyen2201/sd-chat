import { supabase } from '@/utility/connection';

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/**
 * Check the signed-in account's password by signing in again with it.
 *
 * Supabase has no "check password" call, and a fresh sign-in is also what
 * `secure_password_change` looks for before it accepts a new password. The
 * session it returns replaces the current one for the same user, so nothing
 * else in the app has to change.
 */
export async function verifyAccountPassword(email: string, password: string): Promise<PasswordCheck> {
  if (!email) {
    return { ok: false, message: 'No email on this session. Sign out and back in.' };
  }
  if (!password) {
    return { ok: false, message: 'Enter your account password.' };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (!error) {
    return { ok: true };
  }
  if (error.code === 'invalid_credentials' || /invalid login credentials/i.test(error.message)) {
    return { ok: false, message: 'That password is not correct.' };
  }
  if (error.status === 429) {
    return { ok: false, message: 'Too many attempts. Wait a minute and try again.' };
  }
  return { ok: false, message: error.message || 'Could not check the password.' };
}
