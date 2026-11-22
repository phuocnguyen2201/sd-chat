/**
 * Remembered accounts on the login screen: cards, their saved sessions, and
 * signing in from a card without a password.
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockStore = new Map<string, string>();
jest.mock('../SecureSessionStorage', () => ({
  SecureSessionStorage: {
    getItem: async (k: string) => mockStore.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      mockStore.set(k, v);
    },
    removeItem: async (k: string) => {
      mockStore.delete(k);
    },
  },
}));

const mockFiles = new Set<string>();
jest.mock('expo-file-system', () => {
  class Directory {
    uri: string;
    constructor(_base: unknown, name: string) {
      this.uri = `file:///doc/${name}`;
    }
    create() {}
  }
  class File {
    uri: string;
    constructor(dir: { uri: string }, name: string) {
      this.uri = `${dir.uri}/${name}`;
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    static downloadFileAsync = async (_url: string, target: { uri: string }) => {
      mockFiles.add(target.uri);
      return target;
    };
  }
  return { Directory, File, Paths: { document: {} } };
});

const mockSetSession = jest.fn<(...args: unknown[]) => Promise<{ data: { session: unknown }; error: unknown }>>();
jest.mock('@/utility/connection', () => ({
  supabase: { auth: { setSession: (...args: unknown[]) => mockSetSession(...args) } },
}));

jest.mock('@supabase/supabase-js', () => ({
  isAuthApiError: (e: { __isAuthError?: boolean; status?: number }) => !!e?.__isAuthError && (e.status ?? 0) >= 400,
  isAuthRetryableFetchError: (e: { retryable?: boolean }) => !!e?.retryable,
}));

import { initials, paginate, RememberedAccounts } from '../RememberedAccounts';

const session = (userId: string, refresh = `rt-${userId}`) =>
  ({ access_token: `at-${userId}`, refresh_token: refresh, user: { id: userId } }) as never;

describe('paginate', () => {
  it('splits cards into pages of 4', () => {
    expect(paginate([1, 2, 3, 4, 5, 6, 7, 8, 9]).map((p) => p.length)).toEqual([4, 4, 1]);
    expect(paginate([1, 2, 3, 4])).toEqual([[1, 2, 3, 4]]);
    expect(paginate([])).toEqual([]);
  });
});

describe('initials', () => {
  it('uses the first and last name, or the email', () => {
    expect(initials('Phuoc Nguyen Van', '')).toBe('PV');
    expect(initials('', 'anna@example.com')).toBe('AN');
  });
});

describe('RememberedAccounts', () => {
  beforeEach(() => {
    mockStore.clear();
    mockFiles.clear();
    mockSetSession.mockReset();
  });

  it('lists the most recently used account first, with whether it has a session', async () => {
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna' });
    await new Promise((r) => setTimeout(r, 2));
    await RememberedAccounts.upsert({ userId: 'b', email: 'b@x.com', displayName: 'Ben' });
    await RememberedAccounts.saveSession(session('a'));

    const list = await RememberedAccounts.list();
    expect(list.map((a) => [a.userId, a.hasSession])).toEqual([
      ['b', false],
      ['a', true],
    ]);
  });

  it('does not duplicate an account that signs in again', async () => {
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna' });
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna N' });
    const list = await RememberedAccounts.list();
    expect(list).toHaveLength(1);
    expect(list[0].displayName).toBe('Anna N');
  });

  it('saves the avatar locally and downloads it again only when it changes', async () => {
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna', avatarUrl: 'https://x/1.jpg' });
    const [first] = await RememberedAccounts.list();
    expect(first.avatarUri).toBe('file:///doc/remembered-avatars/a.img');

    const spy = jest.spyOn(jest.requireMock<{ File: { downloadFileAsync: () => unknown } }>('expo-file-system').File, 'downloadFileAsync');
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna', avatarUrl: 'https://x/1.jpg' });
    expect(spy).not.toHaveBeenCalled();
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna', avatarUrl: 'https://x/2.jpg' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows initials when the avatar link is inactive', async () => {
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna', avatarUrl: 'INACTIVE' });
    expect((await RememberedAccounts.list())[0].avatarUri).toBe('');
  });

  it('Sign Out keeps the card but forgets the session', async () => {
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna' });
    await RememberedAccounts.saveSession(session('a'));
    await RememberedAccounts.forgetSession('a');
    const list = await RememberedAccounts.list();
    expect(list).toHaveLength(1);
    expect(list[0].hasSession).toBe(false);
  });

  it('Remove deletes the card, its session and its avatar', async () => {
    await RememberedAccounts.upsert({ userId: 'a', email: 'a@x.com', displayName: 'Anna', avatarUrl: 'https://x/1.jpg' });
    await RememberedAccounts.saveSession(session('a'));
    await RememberedAccounts.remove('a');
    expect(await RememberedAccounts.list()).toEqual([]);
    expect(mockStore.has('remembered_session_a')).toBe(false);
    expect(mockFiles.size).toBe(0);
  });

  describe('restore', () => {
    it('needs the password when there is no saved session', async () => {
      expect(await RememberedAccounts.restore('a')).toBe('needs_password');
      expect(mockSetSession).not.toHaveBeenCalled();
    });

    it('signs in from the saved session and keeps the new tokens', async () => {
      await RememberedAccounts.saveSession(session('a'));
      mockSetSession.mockResolvedValue({ data: { session: session('a', 'rt-new') }, error: null });
      expect(await RememberedAccounts.restore('a')).toBe('ok');
      expect(mockSetSession).toHaveBeenCalledWith({ access_token: 'at-a', refresh_token: 'rt-a' });
      expect(JSON.parse(mockStore.get('remembered_session_a')!).refresh_token).toBe('rt-new');
    });

    it('forgets a session the server rejected, and asks for the password', async () => {
      await RememberedAccounts.saveSession(session('a'));
      mockSetSession.mockResolvedValue({
        data: { session: null },
        error: { __isAuthError: true, status: 400, message: 'Invalid Refresh Token' },
      });
      expect(await RememberedAccounts.restore('a')).toBe('needs_password');
      expect(mockStore.has('remembered_session_a')).toBe(false);
    });

    it('keeps the session when offline', async () => {
      await RememberedAccounts.saveSession(session('a'));
      mockSetSession.mockResolvedValue({ data: { session: null }, error: { retryable: true, message: 'Network' } });
      expect(await RememberedAccounts.restore('a')).toBe('offline');
      expect(mockStore.has('remembered_session_a')).toBe(true);
    });

    it('refuses a saved session that belongs to someone else', async () => {
      await RememberedAccounts.saveSession(session('a'));
      mockSetSession.mockResolvedValue({ data: { session: session('b') }, error: null });
      expect(await RememberedAccounts.restore('a')).toBe('needs_password');
    });
  });
});
