import { checkLeakedPassword, LEAKED_PASSWORD_MESSAGE } from './leakedPassword';

/*
  The rules a new password must meet: at sign-up and on Change Password.
  Mirrors the project's Auth policy (length + lower/upper/digit/symbol,
  supabase/config.toml) so users get a readable message instead of the server's
  character list, then checks the password against known breaches.
  Only new passwords are checked; older accounts may have weaker ones.
*/

export const MIN_PASSWORD_LENGTH = 8;

const PASSWORD_RULES: { test: RegExp; label: string }[] = [
  { test: /[a-z]/, label: 'a lowercase letter' },
  { test: /[A-Z]/, label: 'an uppercase letter' },
  { test: /[0-9]/, label: 'a number' },
  { test: /[^A-Za-z0-9]/, label: 'a symbol' },
];

/** The first rule the password breaks, as a sentence, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  const missing = PASSWORD_RULES.filter((rule) => !rule.test.test(password)).map((rule) => rule.label);
  return missing.length ? `Password must include ${missing.join(', ')}` : null;
}

/**
 * The rules, then the breach list. Returns the message to show, or null when
 * the password may be used. The breach lookup only runs once the rules pass,
 * and a lookup that can't be made does not block the password.
 */
export async function newPasswordProblem(password: string): Promise<string | null> {
  const problem = passwordProblem(password);
  if (problem) {
    return problem;
  }
  return (await checkLeakedPassword(password)) === 'leaked' ? LEAKED_PASSWORD_MESSAGE : null;
}
