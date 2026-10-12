-- RLS ownership tests: what one user can read and change of another user's data.
-- Runs on a throwaway local database (`supabase db start && supabase test db`),
-- inside a transaction that is rolled back. Users: A and B share DM C1 and group G;
-- O is an outsider who shares only DM C2 with A.
begin;
create extension if not exists pgtap with schema extensions;
select plan(55);

-- Helpers (rolled back with everything else).
create schema tests;
grant usage on schema tests to authenticated;

-- Act as a signed-in user, like the app's session does. `reset role` goes back to postgres.
create function tests.login(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $$;

-- Rows the statement returned or touched. A permission error counts as 0: RLS
-- refuses a write either by matching no rows or by raising 42501.
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

insert into public.messages (id, conversation_id, sender_id, message_type, content) values
  ('e1000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'text', 'a'),
  ('e2000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'text', 'b');

insert into public.files (id, message_id, bucket_name, filepath, filename, original_name, mime_type) values
  ('f1000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000000', 'storage-msg', 'p', 'f', '', 'application/octet-stream');
insert into public.files_profiles (id, profile_id, bucket_name, filepath, filename, original_name, mime_type) values
  ('fa000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'avatars', 'pa', 'a.jpg', '', 'image/jpeg'),
  ('fb000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'avatars', 'pb', 'b.jpg', '', 'image/jpeg');
insert into public.files_group (id, conversation_id, bucket_name, filepath, filename, original_name, mime_type) values
  ('f9000000-0000-0000-0000-000000000000', 'd1000000-0000-0000-0000-000000000000', 'avatars', 'pg', 'g.jpg', '', 'image/jpeg');

insert into public.reactions (id, message_id, sender_id, sender_username, emoji) values
  ('a2000000-0000-0000-0000-000000000000', 'e1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'B', '👍');
insert into public.push_notification_tokens (profile_id, token, is_active) values
  ('11111111-1111-1111-1111-111111111111', 'tokA', true),
  ('22222222-2222-2222-2222-222222222222', 'tokB', true);

-- conversation_participants -------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$select 1 from conversation_participants$$), 6, 'participants: A sees all rows of C1, C2 and G, including other members');
select tests.login('22222222-2222-2222-2222-222222222222');
select is(tests.rows($$select 1 from conversation_participants$$), 4, 'participants: B sees only C1 and G');
select tests.login('33333333-3333-3333-3333-333333333333');
select is(tests.rows($$select 1 from conversation_participants$$), 2, 'participants: O sees only C2');
select is(tests.rows($$select 1 from conversation_participants where conversation_id = 'c1000000-0000-0000-0000-000000000000'$$), 0, 'participants: O sees nothing of C1');
select is(tests.rows($$insert into conversation_participants (conversation_id, user_id) values ('c1000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333') returning 1$$), 0, 'participants: O cannot add themselves to C1');
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$update conversation_participants set wrapped_key = 'evil' where conversation_id = 'c1000000-0000-0000-0000-000000000000' and user_id = '22222222-2222-2222-2222-222222222222' returning 1$$), 0, 'participants: A cannot overwrite B''s existing key');
select is(tests.rows($$delete from conversation_participants where conversation_id = 'c1000000-0000-0000-0000-000000000000' and user_id = '22222222-2222-2222-2222-222222222222' returning 1$$), 0, 'participants: A cannot remove B');
select is(tests.rows($$update conversation_participants set wrapped_key = 'kA-new' where conversation_id = 'c1000000-0000-0000-0000-000000000000' and user_id = '11111111-1111-1111-1111-111111111111' returning 1$$), 1, 'participants: A can update their own row');
reset role;
select is((select wrapped_key from conversation_participants where conversation_id = 'c1000000-0000-0000-0000-000000000000' and user_id = '22222222-2222-2222-2222-222222222222'), 'kB', 'participants: B''s key is unchanged');

-- profiles -------------------------------------------------------------------
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$select 1 from profiles where id = '22222222-2222-2222-2222-222222222222'$$), 1, 'profiles: A can read B''s profile');
select is(tests.rows($$update profiles set displayname = 'A2' where id = '11111111-1111-1111-1111-111111111111' returning 1$$), 1, 'profiles: A can update their own profile');
select is(tests.rows($$update profiles set displayname = 'hacked' where id = '22222222-2222-2222-2222-222222222222' returning 1$$), 0, 'profiles: A cannot update B''s profile');
select is(tests.rows($$delete from profiles where id = '22222222-2222-2222-2222-222222222222' returning 1$$), 0, 'profiles: A cannot delete B''s profile');

-- files_profiles -------------------------------------------------------------
select is(tests.rows($$select 1 from files_profiles where profile_id = '22222222-2222-2222-2222-222222222222'$$), 1, 'files_profiles: A can read B''s avatar row');
select is(tests.rows($$update files_profiles set filename = 'a2.jpg' where profile_id = '11111111-1111-1111-1111-111111111111' returning 1$$), 1, 'files_profiles: A can update their own avatar');
select is(tests.rows($$update files_profiles set filename = 'x' where profile_id = '22222222-2222-2222-2222-222222222222' returning 1$$), 0, 'files_profiles: A cannot update B''s avatar');
select is(tests.rows($$insert into files_profiles (profile_id, bucket_name, filepath, filename, original_name, mime_type) values ('22222222-2222-2222-2222-222222222222', 'avatars', 'x', 'x', '', 'image/jpeg') returning 1$$), 0, 'files_profiles: A cannot add an avatar for B');
select is(tests.rows($$delete from files_profiles where profile_id = '22222222-2222-2222-2222-222222222222' returning 1$$), 0, 'files_profiles: A cannot delete B''s avatar');

-- files_group ----------------------------------------------------------------
select tests.login('22222222-2222-2222-2222-222222222222');
select is(tests.rows($$select 1 from files_group where conversation_id = 'd1000000-0000-0000-0000-000000000000'$$), 1, 'files_group: member B sees the group avatar');
select is(tests.rows($$update files_group set filename = 'g2.jpg' where conversation_id = 'd1000000-0000-0000-0000-000000000000' returning 1$$), 1, 'files_group: member B can change the group avatar');
select tests.login('33333333-3333-3333-3333-333333333333');
select is(tests.rows($$select 1 from files_group where conversation_id = 'd1000000-0000-0000-0000-000000000000'$$), 0, 'files_group: outsider O sees nothing');
select is(tests.rows($$update files_group set filename = 'x' where conversation_id = 'd1000000-0000-0000-0000-000000000000' returning 1$$), 0, 'files_group: O cannot change the group avatar');
select is(tests.rows($$insert into files_group (conversation_id, bucket_name, filepath, filename, original_name, mime_type) values ('d1000000-0000-0000-0000-000000000000', 'avatars', 'x', 'x', '', 'image/jpeg') returning 1$$), 0, 'files_group: O cannot add a group avatar');
select is(tests.rows($$delete from files_group where conversation_id = 'd1000000-0000-0000-0000-000000000000' returning 1$$), 0, 'files_group: O cannot delete the group avatar');

-- files (attachments, owned through messages.sender_id) ------------------------
select tests.login('22222222-2222-2222-2222-222222222222');
select is(tests.rows($$select 1 from files where id = 'f1000000-0000-0000-0000-000000000000'$$), 1, 'files: member B sees A''s attachment');
select is(tests.rows($$update files set filename = 'x' where id = 'f1000000-0000-0000-0000-000000000000' returning 1$$), 0, 'files: B cannot change A''s attachment');
select is(tests.rows($$delete from files where id = 'f1000000-0000-0000-0000-000000000000' returning 1$$), 0, 'files: B cannot delete A''s attachment');
select is(tests.rows($$insert into files (message_id, bucket_name, filepath, filename, original_name, mime_type) values ('e1000000-0000-0000-0000-000000000000', 'storage-msg', 'x', 'x', '', 'x') returning 1$$), 0, 'files: B cannot attach a file to A''s message');
select tests.login('33333333-3333-3333-3333-333333333333');
select is(tests.rows($$select 1 from files where id = 'f1000000-0000-0000-0000-000000000000'$$), 0, 'files: outsider O sees nothing');
select is(tests.rows($$update files set filename = 'x' where id = 'f1000000-0000-0000-0000-000000000000' returning 1$$), 0, 'files: O cannot change the attachment');
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$update files set filename = 'f2' where id = 'f1000000-0000-0000-0000-000000000000' returning 1$$), 1, 'files: A can update their own attachment');
select is(tests.rows($$insert into files (message_id, bucket_name, filepath, filename, original_name, mime_type) values ('e1000000-0000-0000-0000-000000000000', 'storage-msg', 'p2', 'f2', '', 'x') returning 1$$), 1, 'files: A can attach a file to their own message');

-- messages -------------------------------------------------------------------
select is(tests.rows($$select 1 from messages where conversation_id = 'c1000000-0000-0000-0000-000000000000'$$), 2, 'messages: A sees both messages in C1, including B''s');
select is(tests.rows($$insert into messages (id, conversation_id, sender_id, message_type, content) values ('e3000000-0000-0000-0000-000000000000', 'c1000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'text', 'c') returning 1$$), 1, 'messages: A can send as themselves');
select is(tests.rows($$insert into messages (conversation_id, sender_id, message_type, content) values ('c1000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'text', 'fake') returning 1$$), 0, 'messages: A cannot send as B');
select is(tests.rows($$update messages set content = 'edited' where id = 'e1000000-0000-0000-0000-000000000000' returning 1$$), 1, 'messages: A can edit their own message');
select is(tests.rows($$update messages set content = 'hacked' where id = 'e2000000-0000-0000-0000-000000000000' returning 1$$), 0, 'messages: A cannot edit B''s message');
select is(tests.rows($$delete from messages where id = 'e2000000-0000-0000-0000-000000000000' returning 1$$), 0, 'messages: A cannot delete B''s message');
select is(tests.rows($$delete from messages where id = 'e3000000-0000-0000-0000-000000000000' returning 1$$), 1, 'messages: A can delete their own message');
select tests.login('33333333-3333-3333-3333-333333333333');
select is(tests.rows($$select 1 from messages where conversation_id = 'c1000000-0000-0000-0000-000000000000'$$), 0, 'messages: outsider O sees nothing in C1');
select is(tests.rows($$insert into messages (conversation_id, sender_id, message_type, content) values ('c1000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'text', 'spam') returning 1$$), 0, 'messages: O cannot post into C1');

-- reactions ------------------------------------------------------------------
select is(tests.rows($$select 1 from reactions where id = 'a2000000-0000-0000-0000-000000000000'$$), 0, 'reactions: outsider O sees nothing');
select is(tests.rows($$insert into reactions (message_id, sender_id, sender_username, emoji) values ('e1000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333', 'O', 'x') returning 1$$), 0, 'reactions: O cannot react in C1');
select tests.login('11111111-1111-1111-1111-111111111111');
select is(tests.rows($$select 1 from reactions where id = 'a2000000-0000-0000-0000-000000000000'$$), 1, 'reactions: member A sees B''s reaction');
select is(tests.rows($$insert into reactions (id, message_id, sender_id, sender_username, emoji) values ('a1000000-0000-0000-0000-000000000000', 'e2000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111', 'A', '❤') returning 1$$), 1, 'reactions: A can react as themselves');
select is(tests.rows($$insert into reactions (message_id, sender_id, sender_username, emoji) values ('e2000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222', 'B', 'x') returning 1$$), 0, 'reactions: A cannot react as B');
select is(tests.rows($$update reactions set emoji = '😂' where id = 'a1000000-0000-0000-0000-000000000000' returning 1$$), 1, 'reactions: A can change their own reaction');
select is(tests.rows($$update reactions set emoji = 'x' where id = 'a2000000-0000-0000-0000-000000000000' returning 1$$), 0, 'reactions: A cannot change B''s reaction');
select is(tests.rows($$delete from reactions where id = 'a2000000-0000-0000-0000-000000000000' returning 1$$), 0, 'reactions: A cannot delete B''s reaction');

-- push_notification_tokens ---------------------------------------------------
select is(tests.rows($$select 1 from push_notification_tokens where token = 'tokA'$$), 1, 'tokens: A sees their own token');
select is(tests.rows($$select 1 from push_notification_tokens where token = 'tokB'$$), 0, 'tokens: A cannot see B''s token');
select is(tests.rows($$insert into push_notification_tokens (profile_id, token, is_active) values ('22222222-2222-2222-2222-222222222222', 'evil', true) returning 1$$), 0, 'tokens: A cannot add a token for B');
select is(tests.rows($$update push_notification_tokens set is_active = false where token = 'tokB' returning 1$$), 0, 'tokens: A cannot deactivate B''s token');
select is(tests.rows($$update push_notification_tokens set is_active = false where token = 'tokA' returning 1$$), 1, 'tokens: A can update their own token');
select is(tests.rows($$delete from push_notification_tokens where token = 'tokB' returning 1$$), 0, 'tokens: A cannot delete B''s token');

reset role;
select * from finish();
rollback;
