-- RPC caller-identity tests (#11, #30): the conversation and read-receipt RPCs act as
-- the signed-in caller, ignore the user id the client passes, and refuse anon.
-- Same users as ownership_rls.test.sql: A and B share DM C1; O is an outsider.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

create schema tests;
grant usage on schema tests to authenticated;

create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Fixtures, as postgres (bypasses RLS).
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'rls-a@test.local'),
  ('22222222-2222-2222-2222-222222222222', 'rls-b@test.local'),
  ('33333333-3333-3333-3333-333333333333', 'rls-o@test.local');
insert into public.profiles (id, username, displayname) values
  ('11111111-1111-1111-1111-111111111111', 'rls_a', 'A'),
  ('22222222-2222-2222-2222-222222222222', 'rls_b', 'B'),
  ('33333333-3333-3333-3333-333333333333', 'rls_o', 'O')
  on conflict (id) do nothing;
insert into public.conversations (id, is_group, created_by, name) values
  ('c1000000-0000-0000-0000-000000000000', false, '11111111-1111-1111-1111-111111111111', null);
insert into public.conversation_participants (conversation_id, user_id, wrapped_key) values
  ('c1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'kA'),
  ('c1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'kB');
insert into public.messages (id, conversation_id, sender_id, message_type, content) values
  ('e1000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'text', 'a');

-- Grants -----------------------------------------------------------------------
select ok(not has_function_privilege('anon', 'public.create_conversation_with_participants(text, uuid, uuid[])', 'execute'), 'grants: anon cannot create groups');
select ok(not has_function_privilege('anon', 'public.create_dm_conversation(uuid)', 'execute'), 'grants: anon cannot create DMs');
select ok(not has_function_privilege('anon', 'public.mark_messages_as_read(uuid, uuid)', 'execute'), 'grants: anon cannot mark messages read');

-- create_conversation_with_participants (#11) ----------------------------------
-- A passes O as p_user_id: the group must still be A's, and O must not be in it.
select tests.login('11111111-1111-1111-1111-111111111111');
select is(
  (select owner_id from public.create_conversation_with_participants('rpc-g', '33333333-3333-3333-3333-333333333333', array['22222222-2222-2222-2222-222222222222']::uuid[])),
  '11111111-1111-1111-1111-111111111111'::uuid, 'group: owner returned is the caller, not p_user_id');
reset role;
select is((select created_by from public.conversations where name = 'rpc-g'), '11111111-1111-1111-1111-111111111111'::uuid, 'group: created_by is the caller');
select is(
  (select array_agg(cp.user_id order by cp.user_id) from public.conversation_participants cp join public.conversations c on c.id = cp.conversation_id where c.name = 'rpc-g'),
  array['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']::uuid[], 'group: members are the caller and the invited users, not p_user_id');

-- No signed-in user (a JWT without sub) ------------------------------------------
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.create_conversation_with_participants('x', '11111111-1111-1111-1111-111111111111', null)$$, '42501', null, 'no caller: cannot create a group');
select throws_ok($$select public.create_dm_conversation('11111111-1111-1111-1111-111111111111')$$, '42501', null, 'no caller: cannot create a DM');
select throws_ok($$select public.mark_messages_as_read('c1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111')$$, '42501', null, 'no caller: cannot mark messages read');

-- create_dm_conversation --------------------------------------------------------
select tests.login('22222222-2222-2222-2222-222222222222');
select lives_ok($$select public.create_dm_conversation('33333333-3333-3333-3333-333333333333')$$, 'dm: B can start a DM with O');
reset role;
select is((select count(*)::int from public.conversations where is_group = false and created_by = '22222222-2222-2222-2222-222222222222'), 1, 'dm: created_by is the caller');

-- mark_messages_as_read (#30) ---------------------------------------------------
-- B passes O as p_user_id: B, not O, is recorded, and on A's message (not B's own).
select tests.login('22222222-2222-2222-2222-222222222222');
select lives_ok($$select public.mark_messages_as_read('c1000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333')$$, 'read: B can mark C1 read');
select public.mark_messages_as_read('c1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222');
reset role;
select is((select read_by from public.messages where id = 'e1000000-0000-0000-0000-000000000000'), array['22222222-2222-2222-2222-222222222222']::uuid[], 'read: A''s message is marked read by B, once');

select tests.login('33333333-3333-3333-3333-333333333333');
select throws_ok($$select public.mark_messages_as_read('c1000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333')$$, '42501', null, 'read: outsider O cannot mark C1 read');
reset role;
select is((select read_by from public.messages where id = 'e1000000-0000-0000-0000-000000000000'), array['22222222-2222-2222-2222-222222222222']::uuid[], 'read: O''s attempt changed nothing');

-- Deleting a group's creator (#12) -----------------------------------------------
-- What delete-account does for A, who created rpc-g while B is still in it.
select lives_ok($$
  delete from public.conversation_participants where user_id = '11111111-1111-1111-1111-111111111111';
  delete from public.profiles where id = '11111111-1111-1111-1111-111111111111'
$$, 'delete account: a group creator''s profile can be deleted while members remain');
select is((select created_by from public.conversations where name = 'rpc-g'), '11111111-1111-1111-1111-111111111111'::uuid, 'delete account: the group keeps its creator id, so members can still unwrap and pin');
select is(
  (select array_agg(cp.user_id) from public.conversation_participants cp join public.conversations c on c.id = cp.conversation_id where c.name = 'rpc-g'),
  array['22222222-2222-2222-2222-222222222222']::uuid[], 'delete account: B is still in the group');

select * from finish();
rollback;
