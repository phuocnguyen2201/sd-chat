-- Storage RLS tests (#10, storage half): everyone signed in can read app objects,
-- but only add to their own avatar folder or a conversation they're in, and only
-- change or delete what they uploaded. Same users as ownership_rls.test.sql:
-- A and B share DM C1 and group G; O shares only DM C2 with A.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

create schema tests;
grant usage on schema tests to authenticated;

create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

create function tests.rows(q text) returns int language plpgsql as $$
declare n int;
begin
  execute format('with r as (%s) select count(*)::int from r', q) into n;
  return n;
exception when insufficient_privilege then
  return 0;
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
  ('c1000000-0000-0000-0000-000000000000', false, '11111111-1111-1111-1111-111111111111', null),
  ('c2000000-0000-0000-0000-000000000000', false, '11111111-1111-1111-1111-111111111111', null),
  ('d1000000-0000-0000-0000-000000000000', true,  '11111111-1111-1111-1111-111111111111', 'G');
insert into public.conversation_participants (conversation_id, user_id, wrapped_key) values
  ('c1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'kA'),
  ('c1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'kB'),
  ('c2000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'kA2'),
  ('c2000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'kO'),
  ('d1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'kGA'),
  ('d1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'kGB');

insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', false), ('chat-files', 'chat-files', false), ('storage-msg', 'storage-msg', false)
  on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner_id) values
  ('avatars',     'avatars/11111111-1111-1111-1111-111111111111/a.jpg',          '11111111-1111-1111-1111-111111111111'),
  ('avatars',     'avatars/22222222-2222-2222-2222-222222222222/b.jpg',          '22222222-2222-2222-2222-222222222222'),
  ('avatars',     'avatars/d1000000-0000-0000-0000-000000000000/g.jpg',          '11111111-1111-1111-1111-111111111111'),
  ('storage-msg', 'storage-msg/c1000000-0000-0000-0000-000000000000/img-a',      '11111111-1111-1111-1111-111111111111'),
  ('chat-files',  'chat-files/c1000000-0000-0000-0000-000000000000/file-b',      '22222222-2222-2222-2222-222222222222');

-- SELECT: everyone signed in sees the app's objects -------------------------------
select tests.login('33333333-3333-3333-3333-333333333333');
select is(tests.rows($$select 1 from storage.objects where bucket_id = 'avatars'$$), 3, 'select: O can see every avatar');
select is(tests.rows($$select 1 from storage.objects where bucket_id in ('storage-msg', 'chat-files')$$), 2, 'select: O can see attachments of other chats');

-- INSERT ------------------------------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', 'avatars/11111111-1111-1111-1111-111111111111/a2.jpg', '11111111-1111-1111-1111-111111111111') returning 1$$), 1, 'insert: A can upload into their own avatar folder');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', 'avatars/22222222-2222-2222-2222-222222222222/x.jpg', '11111111-1111-1111-1111-111111111111') returning 1$$), 0, 'insert: A cannot upload into B''s avatar folder');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', 'avatars/d1000000-0000-0000-0000-000000000000/g2.jpg', '11111111-1111-1111-1111-111111111111') returning 1$$), 1, 'insert: A can upload a group avatar for G');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('storage-msg', 'storage-msg/c1000000-0000-0000-0000-000000000000/img-a2', '11111111-1111-1111-1111-111111111111') returning 1$$), 1, 'insert: A can upload an image into C1');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('chat-files', 'chat-files/c1000000-0000-0000-0000-000000000000/file-a2', '11111111-1111-1111-1111-111111111111') returning 1$$), 1, 'insert: A can upload a file into C1');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('storage-msg', 'not-a-folder/c1000000-0000-0000-0000-000000000000/x', '11111111-1111-1111-1111-111111111111') returning 1$$), 0, 'insert: the first folder must be the bucket');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('storage-msg', 'storage-msg/not-a-uuid/x', '11111111-1111-1111-1111-111111111111') returning 1$$), 0, 'insert: a malformed folder is refused, not an error');
select tests.login('33333333-3333-3333-3333-333333333333');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('storage-msg', 'storage-msg/c1000000-0000-0000-0000-000000000000/evil', '33333333-3333-3333-3333-333333333333') returning 1$$), 0, 'insert: O cannot upload into C1');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('chat-files', 'chat-files/c1000000-0000-0000-0000-000000000000/evil', '33333333-3333-3333-3333-333333333333') returning 1$$), 0, 'insert: O cannot upload a file into C1');
select is(tests.rows($$insert into storage.objects (bucket_id, name, owner_id) values ('avatars', 'avatars/d1000000-0000-0000-0000-000000000000/evil.jpg', '33333333-3333-3333-3333-333333333333') returning 1$$), 0, 'insert: O cannot replace G''s avatar');

-- UPDATE ------------------------------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$update storage.objects set metadata = '{}' where name = 'avatars/11111111-1111-1111-1111-111111111111/a.jpg' returning 1$$), 1, 'update: A can update their own avatar');
select is(tests.rows($$update storage.objects set metadata = '{}' where name = 'avatars/22222222-2222-2222-2222-222222222222/b.jpg' returning 1$$), 0, 'update: A cannot update B''s avatar');
select is(tests.rows($$update storage.objects set metadata = '{}' where name = 'chat-files/c1000000-0000-0000-0000-000000000000/file-b' returning 1$$), 0, 'update: A cannot update B''s file, even in a shared chat');
select is(tests.rows($$update storage.objects set name = 'storage-msg/c2000000-0000-0000-0000-000000000000/img-a' where name = 'storage-msg/c1000000-0000-0000-0000-000000000000/img-a' returning 1$$), 1, 'update: A can move their own image to another chat they are in');
select is(tests.rows($$update storage.objects set name = 'avatars/22222222-2222-2222-2222-222222222222/a.jpg' where name = 'avatars/11111111-1111-1111-1111-111111111111/a.jpg' returning 1$$), 0, 'update: A cannot move their avatar into B''s folder');

-- DELETE ------------------------------------------------------------------------
-- storage.protect_delete refuses direct deletes with 42501 unless this is set (the
-- Storage API sets it), which tests.rows would count as "refused by RLS".
select set_config('storage.allow_delete_query', 'true', true);
select is(tests.rows($$delete from storage.objects where name = 'avatars/22222222-2222-2222-2222-222222222222/b.jpg' returning 1$$), 0, 'delete: A cannot delete B''s avatar');
select is(tests.rows($$delete from storage.objects where name = 'chat-files/c1000000-0000-0000-0000-000000000000/file-b' returning 1$$), 0, 'delete: A cannot delete B''s file');
select is(tests.rows($$delete from storage.objects where name = 'avatars/11111111-1111-1111-1111-111111111111/a.jpg' returning 1$$), 1, 'delete: A can delete their own avatar');

select * from finish();
rollback;
