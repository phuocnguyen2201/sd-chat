-- Security #14 (database half): no function in public may resolve names through
-- the caller's search_path, and nothing clients have no use for stays callable.
-- The leaked-password half can't be turned on on the Free plan; the app checks
-- new passwords against Have I Been Pwned instead (utility/auth/leakedPassword.ts).

-- 1. messages_notify_new: a SECURITY DEFINER trigger function from an older
--    realtime design. No trigger uses it (messages has only push_notification),
--    yet authenticated could EXECUTE it. Nothing to pin; it goes.
drop function if exists public.messages_notify_new();

-- 2. get_conversation_between_users named its table without a schema, so it is
--    rewritten with public. before pinning. It runs as the caller, so RLS on
--    conversation_participants still decides what it can see.
create or replace function public.get_conversation_between_users(_user_a uuid, _user_b uuid)
returns table(conversation_id uuid)
language sql
stable
set search_path = ''
as $$
  select cp.conversation_id
  from public.conversation_participants cp
  where cp.user_id in (_user_a, _user_b)
  group by cp.conversation_id
  having count(distinct cp.user_id) = 2;
$$;

-- 3. The rest already name every table with its schema (now() is pg_catalog,
--    which is always searched), so pinning them changes nothing they do.
alter function public.get_messages_with_reactions(uuid) set search_path = '';
alter function public.set_updated_at() set search_path = '';
alter function public.set_key_backups_updated_at() set search_path = '';
-- Was pinned to 'public', which a SECURITY DEFINER function should not need.
alter function public.is_conversation_member(uuid) set search_path = '';

-- 4. Who may call what. Signed-out clients have no business with any of these.
--    The trigger helpers are never called directly: a trigger fires without
--    checking EXECUTE on its function, so revoking it from clients is safe.
revoke execute on function public.get_conversation_between_users(uuid, uuid) from public, anon;
revoke execute on function public.get_messages_with_reactions(uuid) from public, anon;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_key_backups_updated_at() from public, anon, authenticated;
revoke execute on function public.is_conversation_member(uuid) from public, anon;

grant execute on function public.get_conversation_between_users(uuid, uuid) to authenticated, service_role;
grant execute on function public.get_messages_with_reactions(uuid) to authenticated, service_role;
grant execute on function public.is_conversation_member(uuid) to authenticated, service_role;
grant execute on function public.set_updated_at() to service_role;
grant execute on function public.set_key_backups_updated_at() to service_role;
