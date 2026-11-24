-- Per-sender message signatures (security #8c).
--
-- messages.signature            Ed25519 signature by the sender over the row
--                               (id, conversation, sender, type, encrypted fields).
--                               Null on messages sent before this change.
-- profiles.signing_public_key   The account's Ed25519 public key, published by
--                               the app; readers pin it on first use.
--
-- The two columns were added by hand on the live project first, so both adds
-- are idempotent. get_messages_with_reactions has to be recreated to return
-- the signature: its return type changes, which CREATE OR REPLACE can't do.

alter table public.messages add column if not exists signature text;
alter table public.profiles add column if not exists signing_public_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_signing_public_key_format'
  ) then
    -- 32 bytes, base64 (same shape handle_new_user checks for public_key).
    alter table public.profiles
      add constraint profiles_signing_public_key_format
      check (signing_public_key is null or signing_public_key ~ '^[A-Za-z0-9+/]{43}=$');
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'messages_signature_format'
  ) then
    -- 64 bytes, base64.
    alter table public.messages
      add constraint messages_signature_format
      check (signature is null or signature ~ '^[A-Za-z0-9+/]{86}==$');
  end if;
end $$;

drop function if exists public.get_messages_with_reactions(uuid);

create function public.get_messages_with_reactions(convo_id uuid)
returns table(
  id uuid,
  conversation_id uuid,
  sender_id uuid,
  displayname text,
  content text,
  message_type text,
  metadata jsonb,
  created_at timestamp with time zone,
  read_by uuid[],
  nonce text,
  wrapped_key text,
  key_nonce text,
  is_forward boolean,
  reactions jsonb,
  files jsonb,
  signature text
)
language sql
-- Kept from 20261123000100_pin_search_path (security #14): dropping the
-- function drops that setting too. The body names every table with its schema.
set search_path = ''
as $$
  with limited_msgs as (
    select *
    from public.messages
    where conversation_id = convo_id
    order by created_at desc
    limit 25
  ), reactions_agg as (
    select
      r.message_id,
      jsonb_agg(
        to_jsonb(r) - 'message_id'
        order by r.created_at asc, r.id asc
      ) as reactions
    from public.reactions r
    where r.message_id is not null
    group by r.message_id
  ), files_agg as (
    select
      f.message_id,
      jsonb_agg(
        (to_jsonb(f) - 'message_id' - 'conversation_id')
        order by f.created_at asc, f.id asc
      ) as files
    from public.files f
    where f.message_id is not null
    group by f.message_id
  ), msgs as (
    select
      m.id,
      m.conversation_id,
      m.sender_id,
      coalesce(p.displayname, '') as displayname,
      m.content,
      m.message_type,
      m.metadata,
      m.created_at,
      m.read_by,
      m.nonce,
      m.wrapped_key,
      m.key_nonce,
      m.is_forward,
      coalesce(ra.reactions, '[]'::jsonb) as reactions,
      coalesce(fa.files, '[]'::jsonb) as files,
      m.signature
    from limited_msgs m
    left join public.profiles p on p.id = m.sender_id
    left join reactions_agg ra on ra.message_id = m.id
    left join files_agg fa on fa.message_id = m.id
  )
  select *
  from msgs
  order by created_at asc;
$$;

alter function public.get_messages_with_reactions(uuid) owner to postgres;

-- A new function is executable by PUBLIC by default; only signed-in users
-- need it (RLS on messages still applies, it is not SECURITY DEFINER).
-- Same grants as 20261123000100_pin_search_path.
revoke execute on function public.get_messages_with_reactions(uuid) from public, anon;
grant execute on function public.get_messages_with_reactions(uuid) to authenticated, service_role;
