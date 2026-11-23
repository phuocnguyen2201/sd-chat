-- Security #14 (database half): every function in public pins its search_path,
-- the unused SECURITY DEFINER trigger function is gone, signed-out clients can't
-- call the RPCs, and the RPCs and triggers still work for a signed-in user.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- What the Supabase advisor checks: no function without a pinned search_path.
select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prokind = 'f'
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')),
  '', 'every public/private function pins search_path');

select is(
  (select coalesce(string_agg(p.oid::regprocedure::text, ', '), '')
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not ('search_path=""' = any(coalesce(p.proconfig, '{}')))),
  '', 'every SECURITY DEFINER function in public uses an empty search_path');

select hasnt_function('public', 'messages_notify_new', 'messages_notify_new is dropped');

select ok(not has_function_privilege('anon', 'public.get_conversation_between_users(uuid, uuid)', 'execute'), 'anon cannot call get_conversation_between_users');
select ok(not has_function_privilege('anon', 'public.get_messages_with_reactions(uuid)', 'execute'), 'anon cannot call get_messages_with_reactions');
select ok(not has_function_privilege('anon', 'public.is_conversation_member(uuid)', 'execute'), 'anon cannot call is_conversation_member');
select ok(not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'), 'clients cannot call set_updated_at');

-- Fixtures: A and B share DM C1, O is outside it.
insert into auth.users (id, email) values
  ('71111111-1111-1111-1111-111111111111', 'sp-a@test.local'),
  ('72222222-2222-2222-2222-222222222222', 'sp-b@test.local'),
  ('73333333-3333-3333-3333-333333333333', 'sp-o@test.local');
insert into public.conversations (id, is_group, created_by) values
  ('c7000000-0000-0000-0000-000000000000', false, '71111111-1111-1111-1111-111111111111');
insert into public.conversation_participants (conversation_id, user_id, wrapped_key) values
  ('c7000000-0000-0000-0000-000000000000', '71111111-1111-1111-1111-111111111111', 'kA'),
  ('c7000000-0000-0000-0000-000000000000', '72222222-2222-2222-2222-222222222222', 'kB');
insert into public.messages (conversation_id, sender_id, message_type, content) values
  ('c7000000-0000-0000-0000-000000000000', '71111111-1111-1111-1111-111111111111', 'text', 'hello');

-- The RPCs still work for a member after the rewrite and pinning.
select tests.login('71111111-1111-1111-1111-111111111111');
select is(
  (select conversation_id from public.get_conversation_between_users('71111111-1111-1111-1111-111111111111', '72222222-2222-2222-2222-222222222222')),
  'c7000000-0000-0000-0000-000000000000'::uuid, 'get_conversation_between_users finds the DM');
select is(
  (select count(*)::int from public.get_messages_with_reactions('c7000000-0000-0000-0000-000000000000')),
  1, 'get_messages_with_reactions returns the member''s messages');
reset role;

-- An outsider still sees nothing (RLS applies, the functions run as the caller).
select tests.login('73333333-3333-3333-3333-333333333333');
select is(
  (select count(*)::int from public.get_messages_with_reactions('c7000000-0000-0000-0000-000000000000')),
  0, 'an outsider gets no messages');
reset role;

-- The timestamp triggers still fire for a signed-in user although clients can
-- no longer call the trigger functions directly.
select tests.login('71111111-1111-1111-1111-111111111111');
insert into public.key_backups (user_id, kdf_salt, kdf_n, kdf_r, kdf_p, nonce, vault_ref)
  values ('71111111-1111-1111-1111-111111111111', 's', 32768, 8, 1, 'n', 'v');
reset role;
update public.key_backups set updated_at = '2000-01-01' where user_id = '71111111-1111-1111-1111-111111111111';
select tests.login('71111111-1111-1111-1111-111111111111');
select lives_ok(
  $$update public.key_backups set kdf_p = 1 where user_id = '71111111-1111-1111-1111-111111111111'$$,
  'a user can update their own backup row');
reset role;
select ok(
  (select updated_at > '2000-01-02' from public.key_backups where user_id = '71111111-1111-1111-1111-111111111111'),
  'set_key_backups_updated_at still fires');

select * from finish();
rollback;
