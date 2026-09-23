# Deploying the key vault on the Pi

Written against the compose file already running on the Pi: the stack lives in
`/home/<user>/clouflared/`, with service names `vault-service` and
`cloudflared`, a `vault-data` volume mounted at `/opt/sd-chat-vault`, a
token-managed tunnel, and one `.env` beside `docker-compose.yml`. The repo's
`docker-compose.yml` now matches that, plus a `jwks-refresh` service.

Two paths that are easy to confuse, because they look alike and are unrelated:

| Path | What it is |
| --- | --- |
| `/home/<user>/clouflared/` | the stack's directory **on the Pi** — compose file, `.env`, and the `vault-service/` source it builds from |
| `/opt/sd-chat-vault/` | the mount point **inside the container**, where the volume holds blobs and the JWKS cache |

Renaming the Pi directory is safe: `docker-compose.yml` pins `name:
sd-chat-vault`, so the volume stays `sd-chat-vault_vault-data` rather than being
derived from the folder.

Nothing publishes a port. The only route in is the outbound connection
cloudflared makes to Cloudflare's edge, and the only path it carries is
`/backup/*`.

---

## 1. Get the source onto the Pi

**Stop the old stack first, from the Pi, while the old compose file is still
there:**

```sh
cd ~/clouflared
docker compose down
```

This matters because the services use fixed `container_name`s. Compose derived
the old project name from the directory (`clouflared`); the new file pins it to
`sd-chat-vault`. Bringing the new one up while containers named `cloudflared`
and `sd-chat-vault` are still running from the old project fails with *container
name is already in use*, and `docker compose down` from the new project will not
find them to stop. If that has already happened: `docker rm -f cloudflared
sd-chat-vault`.

Nothing is lost by this — the vault has never stored a blob. If the old project
created a `clouflared_vault-data` volume, it is empty and can go:
`docker volume rm clouflared_vault-data`.

`sd-chat-vault/` is **not tracked in git** — it will not arrive by `git pull`.

**Simplest path**, no file copying at all — pipe the installer over ssh and run
it in the right directory:

```sh
ssh pi@<pi-host> 'mkdir -p ~/clouflared && cd ~/clouflared && sh -s' \
  < ~/sd-chat/sd-chat-vault/install-vault.sh
```

`install-vault.sh` is generated from the repo, so it cannot drift from what was
reviewed. It writes `docker-compose.yml`, `.env.example` and the whole
`vault-service/` source tree, overwrites only those files, and leaves an
existing `.env` alone.

**Or copy the tree from the Mac:**

```sh
rsync -av --exclude node_modules --exclude dist --exclude .env \
  ~/sd-chat/sd-chat-vault/ pi@<pi-host>:~/clouflared/
```

The trailing slashes matter: that copies the *contents* into `~/clouflared/`, so
the compose file lands beside the existing `.env` and `build: ./vault-service`
resolves.

Whichever route, the Pi builds the image itself and needs all five of
`vault-service/Dockerfile`, `package.json`, `tsconfig.json` and `src/`. A
missing `Dockerfile` fails with *failed to read dockerfile*; a missing `src/`
fails a step later on `COPY src ./src`. Check before building:

```sh
ls -la ~/clouflared/vault-service ~/clouflared/vault-service/src
```

`docker-compose.yml` is meant to **replace** whatever is on the Pi, not be
appended to it. YAML allows one top-level `services:` and one `volumes:`; a file
holding two of each fails to parse with `mapping key "services" already
defined`. Validate before bringing anything up:

```sh
docker compose config -q     # silent means it parses
```

Check the architecture before the first build:

```sh
uname -m
```

`aarch64` is fine — `node:22-alpine` has an arm64 image. `armv7l` (an older Pi
or a 32-bit OS) does not, and the build will fail on the base image pull; swap
both `FROM` lines in `vault-service/Dockerfile` to `node:22-bullseye-slim`.

## 2. Apply the migration

Paste `supabase/migrations/20260922000000_key_backups.sql` into the Supabase SQL
editor and run it. This repo has no `supabase/migrations/` of its own —
`devices`, `device_pairing_requests` and `local_pairing_codes` were all hand-run
— so this matches how the rest of the schema got there.

Confirm afterwards that RLS is on and the four policies exist; without them the
table is readable by any authenticated user. The parameters in it are not
secret, but there is no reason to hand them out.

## 3. Configure the tunnel's ingress

Zero Trust → Networks → Tunnels → your tunnel → **Public Hostnames**.

| Field    | Value                       |
| -------- | --------------------------- |
| Subdomain / Domain | your vault hostname |
| Path     | `backup/.*`                 |
| Service  | `http://vault-service:8443` |

Two things to get right:

- **`vault-service`, not `127.0.0.1`.** Inside the cloudflared container,
  `127.0.0.1` is cloudflared itself. The service name resolves over the compose
  network.
- **The Path field is a regex and takes no leading slash.** If a valid request
  comes back 404 in step 6, this is the first thing to check.

Add a second rule for `healthz` only if you want the health check reachable from
outside; it is not needed. Anything matching no rule falls through to the
tunnel's catch-all and is refused at the edge, before it reaches the Pi.

## 4. Fill in `.env`

`cp .env.example .env` in `~/clouflared`, beside `docker-compose.yml` — not in
`vault-service/` — then fill in `SUPABASE_URL`, `SUPABASE_JWT_SECRET` and
`CF_TUNNEL_TOKEN`.

**If an older `.env` is already there, check two values:**

- `HOST` must be `0.0.0.0`. An earlier draft of the example said `127.0.0.1`,
  which is right for a host process and wrong inside a container — it would make
  the service unreachable from cloudflared and every request would 502. It is
  not an exposure here, because nothing publishes a port.
- `AUTH_MODE` no longer exists. The verifier picks the scheme per token from its
  `alg` header. A leftover line is ignored, but delete it so it does not mislead.

`.env` is passed wholesale into the container via `env_file`, so
`CF_TUNNEL_TOKEN` ends up in the vault's environment too. Harmless, but if that
bothers you, move the Supabase values into an explicit `environment:` block and
keep `.env` for compose interpolation only.

## 5. Bring it up

```sh
cd ~/clouflared
docker compose up -d --build
docker compose ps
```

The first build on a Pi takes a few minutes.

## 6. Verify, in this order

Each step isolates one layer, so a failure tells you where the problem is.

**The volume is writable by the unprivileged user.** The container runs as
`node`, and a named volume created over a directory that does not exist in the
image would be owned by root:

```sh
docker compose exec vault-service sh -c \
  'touch /opt/sd-chat-vault/backups/.probe && echo writable && rm /opt/sd-chat-vault/backups/.probe'
```

Expect `writable`. If it says permission denied, the volume predates the
Dockerfile that creates and chowns that path — fix it once with:

```sh
docker compose run --rm --user root vault-service chown -R node:node /opt/sd-chat-vault
docker compose up -d
```

**The service is up:**

```sh
docker compose logs vault-service | tail
```

Expect `vault service listening on http://0.0.0.0:8443`.

**It is reachable across the compose network by name** — this is exactly what
cloudflared does, and the `jwks-refresh` container shares the image and has a
shell, while the cloudflared image does not:

```sh
docker compose exec jwks-refresh wget -qO- http://vault-service:8443/healthz
```

Expect `{"ok":true}`.

**The JWKS cache exists** (not needed while HS256 is current, but you want it in
place before promoting ES256):

```sh
docker compose logs jwks-refresh | tail
docker compose exec vault-service ls -l /opt/sd-chat-vault/
```

**From the outside**, on any machine:

```sh
curl -i https://<your vault hostname>/backup/00000000-0000-0000-0000-000000000000
curl -i https://<your vault hostname>/
```

Expect `401` for the first — the tunnel reached the service and the service
refused an unauthenticated request, which is both halves working. Expect `404`
for the second, refused at the edge.

A `502` means the ingress or `HOST` is wrong (step 3 or 4). A `404` on the first
URL means the Path matcher is wrong.

## 7. Point the app at it

`EXPO_PUBLIC_VAULT_URL` is already in `.env` on the Mac, but **Expo inlines
`EXPO_PUBLIC_*` at build time**. An existing APK does not know the URL and never
will — a new build is required before either screen can work.

## 8. End-to-end test, on a device

In this order, because each step depends on the last:

1. On a device that holds a key: Settings → Manage Keys → **Back up my key**.
   Watch `docker compose logs -f vault-service` — expect a `PUT` and a 204.
2. Confirm the blob landed:
   `docker compose exec vault-service ls -l /opt/sd-chat-vault/backups/`
   — one `<user-id>.b64` file, 64 bytes.
3. Confirm the row landed: `select * from key_backups;` in Supabase.
4. On a second device, or the same one after a reinstall: sign in. Bootstrap
   should route to the key screen. Tap **Recover from backup**, enter the
   passphrase.
5. Open a conversation and confirm messages decrypt.

Time how long the passphrase steps take. scrypt at N=2¹⁵ is ~140ms on a laptop
and will be several times slower on Hermes; if it is unbearable on a low-end
Android device, lower `SCRYPT_PARAMS.N` to `1 << 14` in
`utility/securedMessage/VaultBackup.ts`. Backups written under the old value
still open — the parameters travel with each one.

## 9. Promote ES256 (do this soon)

Supabase currently signs HS256 with ES256 in standby. The verifier already
handles both, chosen per token, so this needs no code change:

1. Confirm `jwks-cache.json` exists (step 6).
2. Promote the ES256 standby key to current in the dashboard.
3. Give clients time to refresh their sessions.
4. Delete `SUPABASE_JWT_SECRET` from `.env`, then `docker compose up -d`.
5. Re-run the step 8 test.

Why it matters: the HS256 secret is symmetric, so whatever can verify with it
can also *mint* with it — including a token claiming `role: service_role`, which
bypasses RLS across the whole project. While it sits on the Pi, the Pi is as
sensitive as the service key. Under ES256 it holds only public keys, and someone
who takes the whole machine gets ciphertext they cannot open.

## What is still not solved

**The blobs are not replicated.** They live in the `vault-data` volume, which on
a stock Pi is the SD card. If that card dies, every backup dies with it — and
the users who need this feature are exactly the ones who will find out the hard
way. The blobs are client-encrypted, so copying them anywhere leaks nothing:

```sh
docker run --rm -v sd-chat-vault_vault-data:/data -v $PWD:/out alpine \
  tar czf /out/vault-backup-$(date +%F).tar.gz -C /data .
```

**There is no rate limit.** The JWT check is what gates access, so a Cloudflare
WAF rule on the hostname (~10 req/min/IP) is noise reduction rather than a
control — but it is a few clicks.

**Recovery still needs Supabase to be up**, because every vault request carries
a live session JWT. Verifying that token locally means the vault survives the
Supabase API going down *mid-recovery*; it does not let someone recover while
unable to log in at all.
