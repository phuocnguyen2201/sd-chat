# SD Chat — Doomsday Key-Backup Vault: Design Handoff

## What this is

A **second, independent** private-key recovery path for SD Chat, alongside
the existing `devices` / `device_pairing_requests` live device-to-device
pairing flow. This one covers the case where **no device is online** —
all devices lost, wiped, or the app reinstalled with nothing to pair with.

It is a "doomsday vault": a Raspberry Pi on Tailscale, exposed publicly
*only* via a Cloudflare Tunnel scoped to `/backup/*`, storing **zero-knowledge
ciphertext** of each account's Ed25519 private key seed.

## Core design decisions (already made — don't relitigate these)

1. **Zero-knowledge**: the private key is encrypted *client-side*, before
   anything is uploaded. The Pi never sees plaintext key material and never
   performs any crypto operation on the user's behalf — it's a dumb,
   authenticated blob store.
2. **Recovery passphrase is separate from the login password** and never
   transmitted or stored anywhere except in the user's head / password
   manager. If lost, the backup is unrecoverable by design — same trust
   model as the app's E2EE.
3. **Auth is local JWT verification on the Pi**, not a live call to
   Supabase — this specifically survives Supabase being down (see
   `vault-service/src/auth.ts` and `jwks-refresh.ts`). Confirmed as
   sufficient: we are NOT building client-side token caching for a full
   Supabase blackout (that would additionally require caching the last
   session JWT on-device and skipping login entirely — out of scope).
4. **No Tailscale/VPN required on the recovering device.** Exposure is via
   Cloudflare Tunnel (outbound-only from the Pi, no inbound port opened),
   scoped tightly to `/backup/*`, because a locked-out user recovering on a
   brand-new device won't have Tailscale installed.
5. **Separate metadata vs. secret data**: `key_backups` table in Supabase
   holds only non-secret KDF params + nonce (RLS-protected, owner-only).
   The actual ciphertext blob lives only on the Pi.

## What's in this handoff

```
supabase/migrations/20260922000000_key_backups.sql   -- metadata table + RLS
vault-service/                                        -- Node/Fastify service for the Pi
  src/index.ts        -- PUT/GET/DELETE /backup/:userId
  src/auth.ts         -- local JWT verification, HS256 and ES256 together
  src/jwks-refresh.ts -- refreshes the cached JWKS
  Dockerfile          -- two-stage build, runs unprivileged
docker-compose.yml                                    -- vault + cloudflared + jwks refresher
.env.example                                          -- what the Pi needs configured
DEPLOY.md                                             -- setup, verification, ES256 promotion
cloudflared/config.yml                                -- only for a config-file tunnel
systemd/                                              -- UNUSED: assumes host processes, kept
                                                         only for reference
```

The client half now lives in the app, not here:

```
utility/securedMessage/VaultBackup.ts   -- seal/upload, fetch/open/install, delete
app/tabs/managekeys/BackupKey.tsx       -- passphrase + confirmation
app/tabs/managekeys/RecoverKey.tsx      -- passphrase, then recovery
```

`client/backupPrivateKey.ts` and `client/recoverPrivateKey.ts` are the original
sketches and are **superseded** by `VaultBackup.ts`. They are left in place only
so the two can be compared; nothing imports them.

## What changed when this met the actual repo

- **The key is not Ed25519.** It is a tweetnacl `nacl.box` X25519 secret key,
  32 bytes, base64, at `user_encryption_key_${userId}` (`secured.ts`). The
  sketch wrote to `ed25519_private_key_seed`, which nothing in the app reads -
  recovery would have reported success and left the user keyless.
- **scrypt instead of Argon2id**, via `@noble/hashes`. Pure JS, so no native
  module and no rebuild of the dev client. Parameters are stored per backup, so
  the cost can be tuned later without stranding existing backups.
- **Base64 in JSON rather than raw binary bodies.** React Native's fetch is an
  XHR polyfill with uneven binary support, and this is the one code path that
  only runs when a user has already lost everything else.
- **The account id is bound in as associated data**, so a blob cannot be opened
  under a different account even with the right passphrase.
- **The recovered key is checked against `profiles.public_key` before it is
  written.** A blob from another identity is refused rather than cementing a
  mismatch that only ever surfaces later, on the peer's device.
- **Both signing schemes are verified**, chosen per token by its `alg`, because
  the project signs HS256 today with ES256 in standby.
- **systemd became Docker**, since the Pi runs containers. Consequence: the
  service binds `0.0.0.0` inside its container and the compose file publishes
  no ports at all - the isolation is the absent port mapping, not a loopback
  bind.

## Still open

- **Promote ES256.** Until then the Pi holds a symmetric secret that can mint
  `service_role` tokens, which makes it as sensitive as the service key. The
  verifier already handles the switch; see DEPLOY.md.
- **Nothing on device has been run yet.** scrypt at N=2^15 takes ~140ms on
  Node; Hermes will be several times slower and needs measuring on a real
  phone. If it is unbearable on low-end Android, drop N to 2^14 - old backups
  still open, since the parameters travel with them.
- **Blob durability.** The volume is the SD card, and nothing replicates it.
- **Rate limiting.** A Cloudflare WAF rule on the hostname, as abuse
  protection rather than access control.
- **Conversations with no wrapped key for this user** stay unreadable after
  recovery - the ones a device minted and never wrapped for itself. Accepted
  for now; worth measuring how often it actually happens.
