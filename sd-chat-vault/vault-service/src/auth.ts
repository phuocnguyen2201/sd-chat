// Local verification of Supabase session JWTs.
//
// Deliberately makes no call to Supabase at request time: a recovery is most
// likely to be attempted precisely when things are going badly, and the vault
// should not inherit anyone else's downtime.
//
// Both signing schemes are accepted, chosen per token by its `alg` header:
//
//   ES256 - verified against a cached JWKS (public keys, refreshed out of band)
//   HS256 - verified against the project's legacy shared JWT secret
//
// This project currently signs HS256 with ES256 in standby, so both are live.
// Once ES256 is promoted to the current key, drop SUPABASE_JWT_SECRET from the
// environment and this service keeps working untouched.
//
// Worth being clear about why that promotion matters: the HS256 secret is
// symmetric, so whatever can verify with it can also mint with it - including a
// token claiming `role: service_role`, which bypasses RLS across the whole
// project. While that secret is deployed here, this machine is as sensitive as
// the service key itself. Under ES256 it holds only public keys and a full
// compromise of it yields nothing but ciphertext.

import { jwtVerify, createLocalJWKSet, decodeProtectedHeader, type JWTPayload } from 'jose';
import { readFile } from 'fs/promises';

const JWKS_CACHE_PATH = process.env.JWKS_CACHE_PATH ?? '/opt/sd-chat-vault/jwks-cache.json';
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

export class AuthError extends Error {}

/** Re-read rather than cached in memory, so a JWKS refresh is picked up without a restart. */
async function loadJwks() {
  let cached: string;
  try {
    cached = await readFile(JWKS_CACHE_PATH, 'utf-8');
  } catch {
    throw new AuthError(
      `no JWKS cache at ${JWKS_CACHE_PATH} - run the refresh once while Supabase is reachable`
    );
  }
  return createLocalJWKSet(JSON.parse(cached));
}

const verifyOptions = {
  audience: 'authenticated',
  ...(SUPABASE_URL ? { issuer: `${SUPABASE_URL}/auth/v1` } : {}),
};

export async function verifySessionToken(token: string): Promise<JWTPayload> {
  if (!token) throw new AuthError('missing token');

  let alg: string | undefined;
  try {
    alg = decodeProtectedHeader(token).alg;
  } catch {
    throw new AuthError('malformed token');
  }

  try {
    if (alg?.startsWith('HS')) {
      if (!SUPABASE_JWT_SECRET) {
        throw new AuthError('token is HS-signed but no shared secret is configured');
      }
      const secret = new TextEncoder().encode(SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, verifyOptions);
      return payload;
    }

    const { payload } = await jwtVerify(token, await loadJwks(), verifyOptions);
    return payload;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    // Signature, expiry, issuer and audience failures all land here. The caller
    // gets one undifferentiated 401: which check failed is the vault's business.
    throw new AuthError('token rejected');
  }
}

/** Verifies the bearer token and confirms it belongs to `expectedUserId`. */
export async function requireOwner(authHeader: string | undefined, expectedUserId: string) {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) throw new AuthError('missing Authorization header');

  const payload = await verifySessionToken(token);
  if (!payload.sub || payload.sub !== expectedUserId) {
    throw new AuthError('token does not match the requested account');
  }
  return payload;
}
