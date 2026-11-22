import { beforeEach, describe, expect, it, jest } from '@jest/globals';

const mockSignIn = jest.fn(
  async (_: { email: string; password: string }): Promise<{ error: null | { code?: string; status?: number; message: string } }> => ({ error: null })
);
jest.mock('@/utility/connection', () => ({
  supabase: { auth: { signInWithPassword: (args: { email: string; password: string }) => mockSignIn(args) } },
}));

import { verifyAccountPassword } from '../verifyAccountPassword';

describe('verifyAccountPassword', () => {
  beforeEach(() => {
    mockSignIn.mockReset();
    mockSignIn.mockResolvedValue({ error: null });
  });

  it('signs in again with the session email', async () => {
    expect(await verifyAccountPassword('a@example.com', 'Secret-123')).toEqual({ ok: true });
    expect(mockSignIn).toHaveBeenCalledWith({ email: 'a@example.com', password: 'Secret-123' });
  });

  it('does not call the server without an email or a password', async () => {
    expect((await verifyAccountPassword('', 'x')).ok).toBe(false);
    expect((await verifyAccountPassword('a@example.com', '')).ok).toBe(false);
    expect(mockSignIn).not.toHaveBeenCalled();
  });

  it('says so on a wrong password', async () => {
    mockSignIn.mockResolvedValue({ error: { code: 'invalid_credentials', message: 'Invalid login credentials' } });
    expect(await verifyAccountPassword('a@example.com', 'nope')).toEqual({
      ok: false,
      message: 'That password is not correct.',
    });
  });

  it('reports rate limiting', async () => {
    mockSignIn.mockResolvedValue({ error: { status: 429, message: 'rate limited' } });
    const result = await verifyAccountPassword('a@example.com', 'x');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/Too many attempts/);
  });
});
