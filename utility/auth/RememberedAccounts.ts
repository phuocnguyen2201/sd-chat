import { Directory, File, Paths } from 'expo-file-system';
import { isAuthApiError, isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { supabase } from '@/utility/connection';
import { SecureSessionStorage } from './SecureSessionStorage';

/*
  Accounts remembered on this device, for the login screen's account cards.

  Each card holds what the login screen shows while nobody is signed in
  (name, email, a saved copy of the avatar) and, separately, that account's
  latest session. Both go through SecureSessionStorage, so they are sealed
  with a device-only key and never readable from a backup (security #25).

  A card without a session is still shown: tapping it asks for the password
  with the email filled in. Removing a card deletes all three.
*/

export type RememberedAccount = {
  userId: string;
  email: string;
  displayName: string;
  /** file:// uri of the saved avatar, or '' to show initials. */
  avatarUri: string;
  /** The URL the saved avatar was downloaded from, to skip re-downloading it. */
  avatarSource: string;
  lastUsedAt: number;
};

export type AccountCard = RememberedAccount & { hasSession: boolean };

export type RestoreResult = 'ok' | 'needs_password' | 'offline';

type StoredSession = { access_token: string; refresh_token: string };

const LIST_KEY = 'remembered_accounts_v1';
const sessionKey = (userId: string) => `remembered_session_${userId}`;
const avatarDir = () => new Directory(Paths.document, 'remembered-avatars');

async function readList(): Promise<RememberedAccount[]> {
  const raw = await SecureSessionStorage.getItem(LIST_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((a) => a && typeof a.userId === 'string') : [];
  } catch {
    return [];
  }
}

async function writeList(list: RememberedAccount[]): Promise<void> {
  await SecureSessionStorage.setItem(LIST_KEY, JSON.stringify(list));
}

async function saveAvatar(userId: string, url: string): Promise<string> {
  try {
    const dir = avatarDir();
    dir.create({ intermediates: true, idempotent: true });
    const target = new File(dir, `${userId}.img`);
    if (target.exists) target.delete();
    const downloaded = await File.downloadFileAsync(url, target);
    return downloaded.uri;
  } catch {
    // A missing avatar only means the card shows initials.
    return '';
  }
}

function deleteAvatar(userId: string): void {
  try {
    const file = new File(avatarDir(), `${userId}.img`);
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}

/** Split into pages of `size` for the swipeable card grid. */
export function paginate<T>(items: T[], size = 4): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

export function initials(name: string, email: string): string {
  const source = (name || email || '?').trim();
  const parts = source.split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : source.slice(0, 2);
  return letters.toUpperCase();
}

export const RememberedAccounts = {
  async list(): Promise<AccountCard[]> {
    const list = await readList();
    const withSession = await Promise.all(
      list.map(async (account) => ({
        ...account,
        hasSession: (await SecureSessionStorage.getItem(sessionKey(account.userId))) !== null,
      }))
    );
    return withSession.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
  },

  /** Add or refresh this account's card. Called whenever its profile loads. */
  async upsert(input: { userId: string; email: string; displayName: string; avatarUrl?: string }): Promise<void> {
    if (!input.userId) return;
    const list = await readList();
    const existing = list.find((a) => a.userId === input.userId);
    const avatarUrl = input.avatarUrl && input.avatarUrl !== 'INACTIVE' ? input.avatarUrl : '';

    let avatarUri = existing?.avatarUri ?? '';
    let avatarSource = existing?.avatarSource ?? '';
    if (!avatarUrl) {
      if (avatarUri) deleteAvatar(input.userId);
      avatarUri = '';
      avatarSource = '';
    } else if (avatarUrl !== avatarSource || !avatarUri) {
      avatarUri = await saveAvatar(input.userId, avatarUrl);
      avatarSource = avatarUri ? avatarUrl : '';
    }

    const next: RememberedAccount = {
      userId: input.userId,
      email: input.email || existing?.email || '',
      displayName: input.displayName || existing?.displayName || '',
      avatarUri,
      avatarSource,
      lastUsedAt: Date.now(),
    };
    await writeList([next, ...list.filter((a) => a.userId !== input.userId)]);
  },

  /** Keep this account's newest tokens. Called on every sign-in and refresh. */
  async saveSession(session: Session | null): Promise<void> {
    const userId = session?.user?.id;
    if (!userId || !session.refresh_token) return;
    const stored: StoredSession = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    };
    await SecureSessionStorage.setItem(sessionKey(userId), JSON.stringify(stored));
  },

  /** Sign Out: keep the card, drop the session, so the next tap asks for the password. */
  async forgetSession(userId: string): Promise<void> {
    if (!userId) return;
    await SecureSessionStorage.removeItem(sessionKey(userId));
  },

  /** The ⋯ menu's "Remove from this device": card, session and avatar. */
  async remove(userId: string): Promise<void> {
    if (!userId) return;
    await SecureSessionStorage.removeItem(sessionKey(userId));
    deleteAvatar(userId);
    await writeList((await readList()).filter((a) => a.userId !== userId));
  },

  /**
   * Make this account the signed-in one from its saved session, with no
   * password. Never revokes the account that was signed in before: its
   * session stays saved for its own card.
   */
  async restore(userId: string): Promise<RestoreResult> {
    const raw = await SecureSessionStorage.getItem(sessionKey(userId));
    if (!raw) return 'needs_password';

    let stored: StoredSession;
    try {
      stored = JSON.parse(raw);
    } catch {
      await RememberedAccounts.forgetSession(userId);
      return 'needs_password';
    }

    const { data, error } = await supabase.auth.setSession(stored);
    if (error) {
      if (isAuthRetryableFetchError(error)) return 'offline';
      if (isAuthApiError(error) || error.name === 'AuthSessionMissingError') {
        // Refresh token rejected (revoked, already used, account gone).
        await RememberedAccounts.forgetSession(userId);
        return 'needs_password';
      }
      return 'offline';
    }
    if (data.session?.user?.id !== userId) {
      return 'needs_password';
    }
    await RememberedAccounts.saveSession(data.session);
    return 'ok';
  },
};
