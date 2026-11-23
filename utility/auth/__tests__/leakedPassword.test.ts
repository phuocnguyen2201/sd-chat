/**
 * Security #14: new passwords are checked against Have I Been Pwned without
 * the password, or its full hash, leaving the phone.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { checkLeakedPassword, hashParts, rangeContains } from '../leakedPassword';
import { newPasswordProblem, passwordProblem } from '../passwordPolicy';

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD_SUFFIX = '1E4C9B93F3F0682250B6CF8331B7EE68FD8';

const fetchMock = jest.fn<typeof fetch>();
const reply = (body: string, ok = true) =>
  fetchMock.mockResolvedValue({ ok, text: async () => body } as Response);

beforeEach(() => {
  fetchMock.mockReset();
  (globalThis as { fetch: unknown }).fetch = fetchMock;
});
afterEach(() => {
  jest.useRealTimers();
});

describe('hashParts', () => {
  it('splits the upper-case SHA-1 into a 5-character prefix and the rest', () => {
    expect(hashParts('password')).toEqual({ prefix: '5BAA6', suffix: PASSWORD_SUFFIX });
  });

  it('hashes the UTF-8 bytes', () => {
    // SHA-1 of the UTF-8 bytes of "mật khẩu"
    const { prefix, suffix } = hashParts('mật khẩu');
    expect(prefix + suffix).toHaveLength(40);
    expect(prefix).toMatch(/^[0-9A-F]{5}$/);
  });
});

describe('rangeContains', () => {
  it('finds the suffix, ignoring case and CRLF line ends', () => {
    expect(rangeContains(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n${PASSWORD_SUFFIX.toLowerCase()}:9659365\r\n`, PASSWORD_SUFFIX)).toBe(true);
  });

  it('ignores padding entries (count 0)', () => {
    expect(rangeContains(`${PASSWORD_SUFFIX}:0\r\n`, PASSWORD_SUFFIX)).toBe(false);
  });

  it('does not match a missing suffix', () => {
    expect(rangeContains('0018A45C4D1DEF81644B54AB7F969B88D65:1', PASSWORD_SUFFIX)).toBe(false);
  });
});

describe('checkLeakedPassword', () => {
  it('sends only the 5-character prefix, with padding asked for', async () => {
    reply('');
    await checkLeakedPassword('password');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.pwnedpasswords.com/range/5BAA6');
    expect(String(url)).not.toContain(PASSWORD_SUFFIX);
    expect((init?.headers as Record<string, string>)['Add-Padding']).toBe('true');
  });

  it('reports a leaked password', async () => {
    reply(`${PASSWORD_SUFFIX}:9659365`);
    expect(await checkLeakedPassword('password')).toBe('leaked');
  });

  it('reports a password not on the list', async () => {
    reply('0018A45C4D1DEF81644B54AB7F969B88D65:1');
    expect(await checkLeakedPassword('password')).toBe('not_found');
  });

  it('is unavailable when offline or when the service fails, never leaked', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    expect(await checkLeakedPassword('password')).toBe('unavailable');
    reply('', false);
    expect(await checkLeakedPassword('password')).toBe('unavailable');
  });

  it('gives up after 5 seconds', async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        )
    );
    const result = checkLeakedPassword('password');
    jest.advanceTimersByTime(5000);
    expect(await result).toBe('unavailable');
  });
});

describe('newPasswordProblem', () => {
  it('reports the rules first, without a lookup', async () => {
    expect(await newPasswordProblem('short')).toBe('Password must be at least 8 characters');
    expect(await newPasswordProblem('alllowercase1!')).toBe('Password must include an uppercase letter');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a password that meets the rules but is leaked', async () => {
    const { suffix } = hashParts('Password1!');
    reply(`${suffix}:12345`);
    expect(await newPasswordProblem('Password1!')).toMatch(/data breach/);
  });

  it('accepts a good password, and one the lookup could not check', async () => {
    reply('');
    expect(await newPasswordProblem('Gx7#qLm2vTz!')).toBeNull();
    fetchMock.mockRejectedValue(new Error('offline'));
    expect(await newPasswordProblem('Gx7#qLm2vTz!')).toBeNull();
  });

  it('keeps the sign-up rules', () => {
    expect(passwordProblem('Abcdefg1')).toBe('Password must include a symbol');
    expect(passwordProblem('Abcdef1!')).toBeNull();
  });
});
