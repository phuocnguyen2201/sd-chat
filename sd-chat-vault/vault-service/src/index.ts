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
