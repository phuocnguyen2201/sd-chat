// Run this on a schedule WHILE Supabase is reachable.
// It refreshes the local JWKS cache the vault service verifies against, so
// request-time verification never needs to call Supabase itself.
//
// Signing keys rotate rarely and only when you trigger it manually from the
// dashboard, so a daily refresh is more than enough headroom. A stale cache
// only becomes a problem if you rotate keys *during* a Supabase outage,
// which can't happen since rotation itself requires the dashboard to be up.
//
// Runs as a compose service on a loop (see docker-compose.yml): every 6-24h.
// If the fetch fails (Supabase down), this script just leaves the existing
// cache file untouched and exits non-zero for monitoring/alerting purposes.

import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const SUPABASE_URL = process.env.SUPABASE_URL!;
const JWKS_CACHE_PATH = process.env.JWKS_CACHE_PATH ?? '/opt/sd-chat-vault/jwks-cache.json';

async function main() {
  const url = `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`;
  const res = await fetch(url);
  if (!res.ok) {
    console.error(`JWKS refresh failed: ${res.status} ${res.statusText}. Keeping existing cache.`);
    process.exit(1);
  }
  const jwks = await res.json();

  await mkdir(path.dirname(JWKS_CACHE_PATH), { recursive: true });
  await writeFile(JWKS_CACHE_PATH, JSON.stringify(jwks));
  console.log(`JWKS cache refreshed at ${JWKS_CACHE_PATH}`);
}

main().catch((err) => {
  console.error('JWKS refresh error:', err);
  process.exit(1);
});
