-- Security #22: record who wrapped each conversation-key row.
--
-- The reader checks the key that opened its row against a pin for "the
-- wrapper". For a group that used to mean conversations.created_by, but
-- any member's device can fill an empty row (backfillMissingWrappedKeys),
-- and then the creator's pin is compared with another member's key: a
-- false "Security key changed" dialog, or, on first use, the other member's
-- key pinned under the creator's id.
--
-- wrapped_by is set by the database, never by the client:
--   - a trigger sets it to auth.uid() whenever wrapped_key or key_nonce is
--     written, and keeps the old value on any other update (e.g. the
--     reader correcting other_party_pub_key);
--   - authenticated has no UPDATE grant on the column, so it can't be set
--     directly either.
-- Writes without a signed-in user (service role, SQL editor) leave it null,
-- and the app then falls back to created_by / the other DM participant.

alter table public.conversation_participants
  add column if not exists wrapped_by uuid
  references public.profiles(id) on delete set null;

-- Existing rows: other_party_pub_key is the wrapper's public key, so the
-- profile holding that key wrapped the row. Only an unambiguous match is
-- used (checked live 2026-11-24: no public key is shared by two profiles).
-- Runs before the trigger exists, which would otherwise keep the null.
update public.conversation_participants cp
set wrapped_by = p.id
from public.profiles p
where cp.wrapped_by is null
  and cp.wrapped_key is not null
  and cp.other_party_pub_key is not null
  and p.public_key = cp.other_party_pub_key
  and (select count(*) from public.profiles p2 where p2.public_key = cp.other_party_pub_key) = 1;

create or replace function public.set_conversation_participant_wrapped_by()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT'
     or new.wrapped_key is distinct from old.wrapped_key
     or new.key_nonce is distinct from old.key_nonce then
    new.wrapped_by := case when new.wrapped_key is null then null else auth.uid() end;
  else
    new.wrapped_by := old.wrapped_by;
  end if;
  return new;
end;
$$;

-- A trigger fires without checking EXECUTE, so clients need none (#14).
revoke execute on function public.set_conversation_participant_wrapped_by() from public, anon, authenticated;
grant execute on function public.set_conversation_participant_wrapped_by() to service_role;

drop trigger if exists conversation_participants_set_wrapped_by on public.conversation_participants;
create trigger conversation_participants_set_wrapped_by
  before insert or update on public.conversation_participants
  for each row execute function public.set_conversation_participant_wrapped_by();

-- Readable like the rest of the row: the table-level SELECT grant and
-- participants_select_members cover it. The UPDATE column grant is not
-- widened; it stays (wrapped_key, key_nonce, other_party_pub_key).
