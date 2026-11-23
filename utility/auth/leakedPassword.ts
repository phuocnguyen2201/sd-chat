import { sha1 } from '@noble/hashes/legacy';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';

/*
  Security #14 (leaked-password half). Supabase's "Prevent use of leaked
  passwords" needs the Pro plan, so the app does the same check itself, against
  the same list: Have I Been Pwned's Pwned Passwords.

  The password never leaves the phone. Only the first 5 hex characters of its
  SHA-1 go out (k-anonymity); the service answers with every leaked hash that
  starts with them, and the rest is compared here. `Add-Padding` makes the
  service pad every answer with fake entries (count 0) so its size gives nothing
  away either.

  It only guards people using the app: a client calling Supabase directly can
  still set any password the server's own rules allow. That is the point of the
  check anyway, which protects a user from picking a known-bad password.
*/

const RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 5000;

export type LeakCheck = 'leaked' | 'not_found' | 'unavailable';

/** The SHA-1 split the way the range API wants it: 5-char prefix, 35-char rest. */
export function hashParts(password: string): { prefix: string; suffix: string } {
  const hex = bytesToHex(sha1(utf8ToBytes(password))).toUpperCase();
  return { prefix: hex.slice(0, 5), suffix: hex.slice(5) };
}

/** Whether `suffix` is in a range response with a real (non-padding) count. */
export function rangeContains(body: string, suffix: string): boolean {
  for (const line of body.split('\n')) {
    const [rest, count] = line.trim().split(':');
    if (rest?.toUpperCase() === suffix && Number(count) > 0) {
      return true;
    }
  }
  return false;
}

/**
 * Looks the password up. 'unavailable' (offline, timeout, the service down)
 * lets the caller go ahead: a missing check must not block sign-up.
 */
export async function checkLeakedPassword(password: string): Promise<LeakCheck> {
  const { prefix, suffix } = hashParts(password);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(RANGE_URL + prefix, {
      headers: { 'Add-Padding': 'true' },
      signal: controller.signal,
    });
    if (!response.ok) {
      return 'unavailable';
    }
    return rangeContains(await response.text(), suffix) ? 'leaked' : 'not_found';
  } catch {
    return 'unavailable';
  } finally {
    clearTimeout(timer);
  }
}

export const LEAKED_PASSWORD_MESSAGE =
  'This password has appeared in a data breach, so it is easy to guess. Choose a different one.';
