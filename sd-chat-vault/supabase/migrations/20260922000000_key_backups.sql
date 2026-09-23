-- Key-recovery vault: parameters only.
--
-- The sealed identity key never touches this table. It lives as an opaque blob
-- on the vault service, which is reached over the Cloudflare Tunnel. What is
-- here is what a client needs in order to re-derive the sealing key and find
-- the blob - none of it is secret on its own, and none of it is any use
-- without the passphrase, which is stored nowhere at all.

create table key_backups (
  user_id         uuid primary key references profiles(id) on delete cascade,

  -- scrypt parameters for turning the user's recovery passphrase into the
  -- ChaCha20-Poly1305 sealing key. Stored per backup rather than assumed, so
  -- the cost can be tuned later without stranding existing backups.
  kdf             text  not null default 'scrypt',
  kdf_salt        text  not null,  -- base64, 16 bytes
  kdf_n           int4  not null,  -- cost, a power of two (currently 2^15)
  kdf_r           int4  not null,  -- block size (8)
  kdf_p           int4  not null,  -- parallelism (1)

  -- Nonce for the seal. Public: it has to be unique, not secret.
  nonce           text  not null,  -- base64, 12 bytes

  -- Pointer to the blob on the vault. Currently equal to user_id, kept
  -- separate so the two can be decoupled without a migration.
  vault_ref       text  not null,

  -- Format of the sealed payload, so a future change of what goes in the blob
  -- can be recognised rather than guessed at.
  blob_version    int4  not null default 1,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table key_backups enable row level security;

create policy "key_backups_select_own" on key_backups
  for select using (auth.uid() = user_id);

create policy "key_backups_insert_own" on key_backups
  for insert with check (auth.uid() = user_id);

create policy "key_backups_update_own" on key_backups
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "key_backups_delete_own" on key_backups
  for delete using (auth.uid() = user_id);

create or replace function set_key_backups_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_key_backups_updated_at
  before update on key_backups
  for each row execute function set_key_backups_updated_at();
