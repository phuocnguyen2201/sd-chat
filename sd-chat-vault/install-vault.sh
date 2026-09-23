#!/bin/sh
# Writes the whole vault stack into the current directory. Generated from the
# repo, so it cannot drift from what was reviewed and tested.
#
# On the Pi:
#   cd ~/clouflared
#   sh install-vault.sh
#   cp .env.example .env   # then fill it in, if there is no .env yet
#   docker compose up -d --build
#
# It overwrites the files it writes and touches nothing else - your existing
# .env is safe, and so is anything else in the directory.

set -e

mkdir -p vault-service/src

echo '  docker-compose.yml'
cat > docker-compose.yml <<'SDCHAT_EOF'
# SD Chat key vault, as it runs on the Pi.
#
# Note what is NOT here: any `ports:` mapping. The vault is unreachable from the
# Pi's LAN and from the internet. The only route in is the outbound connection
# cloudflared makes to Cloudflare's edge, and the only path that route carries
# is /backup/*. Adding a `ports:` line to "make testing easier" would undo that;
# test with `docker compose exec cloudflared ...` instead.

# Pinned so the volume and network are named after the project, not after the
# directory this file happens to sit in (~/clouflared on the Pi). Without it the
# volume would be `clouflared_vault-data`, and it would silently become a
# different, empty volume if the directory were ever renamed.
name: sd-chat-vault

services:
  vault-service:
    build: ./vault-service
    container_name: sd-chat-vault
    restart: unless-stopped
    env_file: .env
    volumes:
      - vault-data:/opt/sd-chat-vault
    # No ports exposed to the host at all — cloudflared reaches it over the
    # Docker network by service name, nothing else can.

  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: cloudflared
    restart: unless-stopped
    # The dashboard ingress for this tunnel must point at
    # http://vault-service:8443 — the compose service name. 127.0.0.1 there
    # would mean cloudflared itself.
    command: tunnel --no-autoupdate run
    environment:
      - TUNNEL_TOKEN=${CF_TUNNEL_TOKEN}
    depends_on:
      - vault-service

  # Keeps the cached Supabase public keys fresh. Not needed while the project
  # signs HS256, but running it now means promoting ES256 later is a dashboard
  # click and a restart rather than a scramble. A failed fetch leaves the
  # existing cache untouched, which is the behaviour that matters in an outage.
  jwks-refresh:
    build: ./vault-service
    container_name: sd-chat-vault-jwks
    restart: unless-stopped
    env_file: .env
    volumes:
      - vault-data:/opt/sd-chat-vault
    # No surrounding quotes: the entrypoint is exec-form, so this whole string
    # is handed to `sh -c` as one argument. Wrapping it in quotes made sh treat
    # the entire loop as the *name* of a command to run, and the container
    # crash-looped with "command not found" - never writing a JWKS cache.
    entrypoint: ["/bin/sh", "-c"]
    command: while true; do node dist/jwks-refresh.js || echo "jwks refresh failed, keeping cache"; sleep 43200; done

volumes:
  # Named volume, which on a stock Pi means the SD card. Nothing here is
  # replicated: if that card dies, every backup dies with it. The blobs are
  # client-encrypted, so syncing them anywhere — S3, another box, a USB disk —
  # leaks nothing and is the obvious fix when this stops being a prototype.
  vault-data:
SDCHAT_EOF

echo '  .env.example'
cat > .env.example <<'SDCHAT_EOF'
# Copy to .env next to docker-compose.yml on the Pi — currently
# /home/<user>/clouflared/.env — NOT into vault-service/.
# Both the vault and the JWKS refresher read it via `env_file:`, and compose
# itself reads CF_TUNNEL_TOKEN from it to fill in the tunnel container.
#
# The paths below are paths INSIDE the container. They have nothing to do with
# where this file lives on the Pi, and they must stay under the volume's mount
# point (/opt/sd-chat-vault) or backups land in the container's writable layer
# and vanish on the next `docker compose up`.
#
# Never commit the filled-in version: while the project signs HS256, the JWT
# secret below is as powerful as the service-role key.

# --- Supabase ---
# Project URL, no trailing slash. Used to fetch the JWKS and to check the `iss`
# claim on every token.
SUPABASE_URL=https://kblseanmnntpxqzgmsho.supabase.co

# Legacy shared JWT secret: Dashboard -> Project Settings -> JWT Keys.
# Required only while HS256 is the current signing key. Once ES256 is promoted,
# delete this line and restart — the verifier picks the scheme per token, so
# nothing else changes.
SUPABASE_JWT_SECRET=

# --- Paths inside the container (must sit under the mounted volume) ---
VAULT_DIR=/opt/sd-chat-vault/backups
JWKS_CACHE_PATH=/opt/sd-chat-vault/jwks-cache.json

# --- Bind ---
# 0.0.0.0 is correct here and is NOT an exposure: compose publishes no ports, so
# this is only reachable from the Docker network. Setting 127.0.0.1 would make
# the service unreachable from cloudflared and every request would 502.
HOST=0.0.0.0
PORT=8443

# --- Cloudflare ---
# Zero Trust -> Networks -> Tunnels -> your tunnel -> the token from the install
# command. Read by docker-compose.yml, not by the service.
CF_TUNNEL_TOKEN=
SDCHAT_EOF

echo '  vault-service/package.json'
cat > vault-service/package.json <<'SDCHAT_EOF'
{
  "name": "sd-chat-vault-service",
  "version": "1.0.0",
  "private": true,
  "description": "Doomsday key-backup vault service for SD Chat, running on a Raspberry Pi behind Cloudflare Tunnel.",
  "type": "module",
  "scripts": {
    "build": "tsc -p .",
    "start": "node dist/index.js",
    "jwks:refresh": "node dist/jwks-refresh.js",
    "dev": "tsx src/index.ts"
  },
  "dependencies": {
    "fastify": "^5.0.0",
    "jose": "^5.9.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "tsx": "^4.19.0",
    "@types/node": "^22.7.0"
  }
}
SDCHAT_EOF

echo '  vault-service/tsconfig.json'
cat > vault-service/tsconfig.json <<'SDCHAT_EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src/**/*.ts"]
}
SDCHAT_EOF

echo '  vault-service/Dockerfile'
cat > vault-service/Dockerfile <<'SDCHAT_EOF'
# Build and run the vault service. Two stages so the shipped image carries no
# TypeScript toolchain and no dev dependencies.

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json tsconfig.json ./
RUN npm install
COPY src ./src
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Blobs and the JWKS cache live on a mounted volume, never in the image layer.
# The path matches the compose file's mount point.
VOLUME /opt/sd-chat-vault

# The directory has to exist in the image, owned by `node`, BEFORE the volume is
# mounted over it. Docker copies the image's ownership onto a named volume when
# it first creates it; with no directory here the volume would be created owned
# by root and this unprivileged process could not write a single backup.
RUN mkdir -p /opt/sd-chat-vault/backups && chown -R node:node /opt/sd-chat-vault

# Unprivileged: this process only ever reads and writes that one directory.
USER node

EXPOSE 8443
CMD ["node", "dist/index.js"]
SDCHAT_EOF

echo '  vault-service/src/index.ts'
cat > vault-service/src/index.ts <<'SDCHAT_EOF'
// SD Chat key vault - stores opaque, client-encrypted identity-key backups.
//
// This service never sees plaintext key material and performs no cryptography
// on anyone's behalf. It is a blob store that checks who is asking.
//
// It runs as a container with no published ports, reachable only through the
// Cloudflare Tunnel that sits beside it on a private compose network. Nothing
// on the LAN and nothing on the internet can address it directly, so binding
// 0.0.0.0 here is the container's loopback, not an exposure.
//
// Blobs arrive as base64 inside JSON rather than as raw bodies: the client is
// React Native, whose fetch is an XHR polyfill with uneven binary support, and
// a few dozen bytes of encoding overhead is not worth a compatibility bug in
// the one code path that only ever runs when a user has already lost
// everything else.

import Fastify from 'fastify';
import { mkdir, readFile, writeFile, rename, unlink, stat } from 'fs/promises';
import path from 'path';
import { requireOwner, AuthError } from './auth.js';

const VAULT_DIR = process.env.VAULT_DIR ?? '/opt/sd-chat-vault/backups';
const PORT = Number(process.env.PORT ?? 8443);
const HOST = process.env.HOST ?? '0.0.0.0';

// An identity key sealed with ChaCha20-Poly1305 is 48 bytes, 64 in base64.
// The ceiling is here to stop the vault being used as free storage, not
// because anything legitimate comes close to it.
const MAX_CIPHERTEXT_CHARS = 4096;

const app = Fastify({
  logger: true,
  // Nothing of value is carried in a body here, and what is carried is
  // ciphertext; keep it out of the logs regardless.
  disableRequestLogging: false,
});

function blobPath(userId: string) {
  // The id is taken from a verified `sub` claim, so it is already a UUID - but
  // it becomes a filename, and that is not a place to rely on an assumption
  // holding forever.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('invalid userId format');
  }
  return path.join(VAULT_DIR, `${userId}.b64`);
}

/**
 * Wraps the shared 401 handling so each route reads as its own logic.
 *
 * The reason is logged as well as returned. A 401 here is never the user's
 * fault - it is a token or configuration problem - and the person who can fix
 * it is reading the Pi's logs, not the phone's screen.
 */
async function authorize(
  req: {
    headers: { authorization?: string };
    log: { warn: (obj: unknown, msg: string) => void };
  },
  reply: { code: (n: number) => { send: (body: unknown) => unknown } },
  userId: string
): Promise<boolean> {
  try {
    await requireOwner(req.headers.authorization, userId);
    return true;
  } catch (err) {
    if (err instanceof AuthError) {
      req.log.warn({ reason: err.message, userId }, 'auth rejected');
      reply.code(401).send({ error: err.message });
      return false;
    }
    throw err;
  }
}

app.put('/backup/:userId', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  if (!(await authorize(req, reply, userId))) return;

  const body = req.body as { ciphertext?: unknown } | undefined;
  const ciphertext = body?.ciphertext;

  if (typeof ciphertext !== 'string' || ciphertext.length === 0) {
    return reply.code(400).send({ error: 'ciphertext must be a non-empty base64 string' });
  }
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) {
    return reply.code(413).send({ error: 'ciphertext too large' });
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext)) {
    return reply.code(400).send({ error: 'ciphertext is not base64' });
  }

  await mkdir(VAULT_DIR, { recursive: true });

  // Write-then-rename, so a crash or a pulled plug midway leaves the previous
  // backup intact rather than a half-written file where a key used to be.
  const target = blobPath(userId);
  const temp = `${target}.tmp`;
  await writeFile(temp, ciphertext, 'utf-8');
  await rename(temp, target);

  return reply.code(204).send();
});

app.get('/backup/:userId', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  if (!(await authorize(req, reply, userId))) return;

  const target = blobPath(userId);
  try {
    await stat(target);
  } catch {
    return reply.code(404).send({ error: 'no backup found' });
  }

  const ciphertext = await readFile(target, 'utf-8');
  return reply.send({ ciphertext });
});

app.delete('/backup/:userId', async (req, reply) => {
  const { userId } = req.params as { userId: string };
  if (!(await authorize(req, reply, userId))) return;

  try {
    await unlink(blobPath(userId));
  } catch {
    // Already gone is the state being asked for.
    return reply.code(404).send({ error: 'no backup found' });
  }

  return reply.code(204).send();
});

app.get('/healthz', async () => ({ ok: true }));

app.listen({ port: PORT, host: HOST }, (err, address) => {
  if (err) {
    app.log.error(err);
    process.exit(1);
  }
  app.log.info(`vault service listening on ${address}`);
});
SDCHAT_EOF

echo '  vault-service/src/auth.ts'
cat > vault-service/src/auth.ts <<'SDCHAT_EOF'
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
SDCHAT_EOF

echo '  vault-service/src/jwks-refresh.ts'
cat > vault-service/src/jwks-refresh.ts <<'SDCHAT_EOF'
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
SDCHAT_EOF

echo
echo 'Next: cp .env.example .env (if you have no .env yet), fill it in, then:'
echo '  docker compose config -q && docker compose up -d --build'
