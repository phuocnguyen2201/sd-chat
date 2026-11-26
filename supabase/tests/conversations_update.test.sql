-- Security #31: a member can rename a conversation and change its avatar, but
-- can't change created_by, is_group, epoch or meta_data. Outsiders and anon
-- can't change anything.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

create schema tests;
grant usage on schema tests to authenticated, anon;
create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Table privileges.
select ok(
  has_column_privilege('authenticated', 'public.conversations', 'name', 'update'),
  'authenticated can update name');
select ok(
  has_column_privilege('authenticated', 'public.conversations', 'avatar_url', 'update'),
  'authenticated can update avatar_url');
select ok(
  not has_column_privilege('authenticated', 'public.conversations', 'created_by', 'update'),
  'authenticated cannot update created_by');
select ok(
  not has_column_privilege('authenticated', 'public.conversations', 'is_group', 'update'),
  'authenticated cannot update is_group');
select ok(
  not has_column_privilege('authenticated', 'public.conversations', 'epoch', 'update'),
  'authenticated cannot update epoch');
select ok(
  not has_table_privilege('authenticated', 'public.conversations', 'insert'),
  'authenticated cannot insert directly (the RPCs do it)');
select ok(
  not has_table_privilege('authenticated', 'public.conversations', 'delete'),
  'authenticated cannot delete');
select ok(
  not has_table_privilege('anon', 'public.conversations', 'select')
  and not has_table_privilege('anon', 'public.conversations', 'update'),
  'anon has no access');

-- Fixtures: group G created by C with member M. O is not in it.
insert into auth.users (id, email) values
  ('91111111-1111-1111-1111-111111111111', 'cu-c@test.local'),
  ('92222222-2222-2222-2222-222222222222', 'cu-m@test.local'),
  ('93333333-3333-3333-3333-333333333333', 'cu-o@test.local');
insert into public.conversations (id, name, is_group, created_by) values
  ('c9000000-0000-0000-0000-000000000000', 'Old name', true, '91111111-1111-1111-1111-111111111111');
insert into public.conversation_participants (conversation_id, user_id) values
  ('c9000000-0000-0000-0000-000000000000', '91111111-1111-1111-1111-111111111111'),
  ('c9000000-0000-0000-0000-000000000000', '92222222-2222-2222-2222-222222222222');

-- M (not the creator) renames the group and changes its avatar.
select tests.login('92222222-2222-2222-2222-222222222222');
select lives_ok(
  $$ update public.conversations set name = 'New name'
      where id = 'c9000000-0000-0000-0000-000000000000' $$,
  'a member can rename the group');
select lives_ok(
  $$ update public.conversations set avatar_url = 'avatars/g.png'
      where id = 'c9000000-0000-0000-0000-000000000000' $$,
  'a member can change the group avatar');
select is(
  (select name || '|' || avatar_url from public.conversations
    where id = 'c9000000-0000-0000-0000-000000000000'),
  'New name|avatars/g.png', 'the rename and avatar change are saved');

-- M tries to take over created_by or turn the group into a DM.
select throws_ok(
  $$ update public.conversations set created_by = '92222222-2222-2222-2222-222222222222'
      where id = 'c9000000-0000-0000-0000-000000000000' $$,
  '42501', null, 'a member cannot change created_by');
select throws_ok(
  $$ update public.conversations set is_group = false
      where id = 'c9000000-0000-0000-0000-000000000000' $$,
  '42501', null, 'a member cannot change is_group');
select throws_ok(
  $$ delete from public.conversations where id = 'c9000000-0000-0000-0000-000000000000' $$,
  '42501', null, 'a member cannot delete the conversation');
reset role;

-- O (outsider) can't rename it: RLS filters the row, so nothing changes.
select tests.login('93333333-3333-3333-3333-333333333333');
update public.conversations set name = 'Hijacked'
 where id = 'c9000000-0000-0000-0000-000000000000';
reset role;
select is(
  (select name from public.conversations where id = 'c9000000-0000-0000-0000-000000000000'),
  'New name', 'an outsider cannot rename the group');
select is(
  (select created_by::text || '|' || is_group::text from public.conversations
    where id = 'c9000000-0000-0000-0000-000000000000'),
  '91111111-1111-1111-1111-111111111111|true', 'created_by and is_group are unchanged');

select * from finish();
rollback;
