-- Security #22: conversation_participants.wrapped_by records who wrote the
-- wrapped key, set by the database and never by the client.
begin;
create extension if not exists pgtap with schema extensions;
select plan(11);

create schema tests;
grant usage on schema tests to authenticated;
create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

select has_column('public', 'conversation_participants', 'wrapped_by', 'wrapped_by exists');
select has_trigger('public', 'conversation_participants', 'conversation_participants_set_wrapped_by', 'the wrapped_by trigger exists');
select ok(
  not has_column_privilege('authenticated', 'public.conversation_participants', 'wrapped_by', 'update'),
  'clients cannot write wrapped_by directly');
select ok(
  not has_function_privilege('authenticated', 'public.set_conversation_participant_wrapped_by()', 'execute'),
  'clients cannot call the trigger function');

-- Fixtures: group G created by C, with members C, M and R. The rows start empty.
insert into auth.users (id, email) values
  ('81111111-1111-1111-1111-111111111111', 'wb-c@test.local'),
  ('82222222-2222-2222-2222-222222222222', 'wb-m@test.local'),
  ('83333333-3333-3333-3333-333333333333', 'wb-r@test.local');
insert into public.conversations (id, is_group, created_by) values
  ('c8000000-0000-0000-0000-000000000000', true, '81111111-1111-1111-1111-111111111111');
insert into public.conversation_participants (conversation_id, user_id) values
  ('c8000000-0000-0000-0000-000000000000', '81111111-1111-1111-1111-111111111111'),
  ('c8000000-0000-0000-0000-000000000000', '82222222-2222-2222-2222-222222222222'),
  ('c8000000-0000-0000-0000-000000000000', '83333333-3333-3333-3333-333333333333');

-- M (not the creator) backfills R's empty row.
select tests.login('82222222-2222-2222-2222-222222222222');
update public.conversation_participants
   set wrapped_key = 'kR', key_nonce = 'nR', other_party_pub_key = 'pubM'
 where conversation_id = 'c8000000-0000-0000-0000-000000000000'
   and user_id = '83333333-3333-3333-3333-333333333333';
select is(
  (select wrapped_by from public.conversation_participants
    where conversation_id = 'c8000000-0000-0000-0000-000000000000' and user_id = '83333333-3333-3333-3333-333333333333'),
  '82222222-2222-2222-2222-222222222222'::uuid, 'a backfilled row records the member who wrapped it');
select throws_ok(
  $$update public.conversation_participants set wrapped_by = '81111111-1111-1111-1111-111111111111'
     where conversation_id = 'c8000000-0000-0000-0000-000000000000' and user_id = '82222222-2222-2222-2222-222222222222'$$,
  '42501', null, 'setting wrapped_by directly is refused');
reset role;

-- R corrects only other_party_pub_key on their own row: wrapped_by stays M.
select tests.login('83333333-3333-3333-3333-333333333333');
update public.conversation_participants
   set wrapped_key = 'kR', key_nonce = 'nR', other_party_pub_key = 'pubM-corrected'
 where conversation_id = 'c8000000-0000-0000-0000-000000000000'
   and user_id = '83333333-3333-3333-3333-333333333333';
select is(
  (select wrapped_by from public.conversation_participants
    where conversation_id = 'c8000000-0000-0000-0000-000000000000' and user_id = '83333333-3333-3333-3333-333333333333'),
  '82222222-2222-2222-2222-222222222222'::uuid, 'correcting other_party_pub_key keeps wrapped_by');

-- R re-wraps their own row: now R wrapped it.
update public.conversation_participants
   set wrapped_key = 'kR2', key_nonce = 'nR2', other_party_pub_key = 'pubR'
 where conversation_id = 'c8000000-0000-0000-0000-000000000000'
   and user_id = '83333333-3333-3333-3333-333333333333';
select is(
  (select wrapped_by from public.conversation_participants
    where conversation_id = 'c8000000-0000-0000-0000-000000000000' and user_id = '83333333-3333-3333-3333-333333333333'),
  '83333333-3333-3333-3333-333333333333'::uuid, 'a new wrapped key records the new writer');

-- Clearing the key clears wrapped_by.
update public.conversation_participants
   set wrapped_key = null, key_nonce = null
 where conversation_id = 'c8000000-0000-0000-0000-000000000000'
   and user_id = '83333333-3333-3333-3333-333333333333';
select is(
  (select wrapped_by from public.conversation_participants
    where conversation_id = 'c8000000-0000-0000-0000-000000000000' and user_id = '83333333-3333-3333-3333-333333333333'),
  null, 'an emptied row has no wrapped_by');
reset role;

-- No signed-in user (service role, SQL editor): wrapped_by stays null, even
-- if the statement tries to set it. `reset role` keeps the JWT claims for
-- the rest of the transaction, so they are cleared explicitly.
select set_config('request.jwt.claims', '', true);
update public.conversation_participants
   set wrapped_key = 'kC', key_nonce = 'nC', wrapped_by = '82222222-2222-2222-2222-222222222222'
 where conversation_id = 'c8000000-0000-0000-0000-000000000000'
   and user_id = '81111111-1111-1111-1111-111111111111';
select is(
  (select wrapped_by from public.conversation_participants
    where conversation_id = 'c8000000-0000-0000-0000-000000000000' and user_id = '81111111-1111-1111-1111-111111111111'),
  null, 'a write without a signed-in user leaves wrapped_by null');

-- Members can read it, which the app needs.
select tests.login('81111111-1111-1111-1111-111111111111');
select is(
  (select count(*)::int from public.conversation_participants
    where conversation_id = 'c8000000-0000-0000-0000-000000000000' and wrapped_by is not distinct from null),
  3, 'members can read wrapped_by');
reset role;

select * from finish();
rollback;
