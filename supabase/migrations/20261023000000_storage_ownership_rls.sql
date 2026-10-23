-- Ownership RLS for the storage buckets (#10, storage half). Tested by
-- supabase/tests/storage_rls.test.sql.
--
-- Object names are `<bucket>/<id>/<file>` (utility/handleStorage.ts):
--   avatars       <id> = the user's own id, or a group's conversation id
--   storage-msg   <id> = conversation id (images)
--   chat-files    <id> = conversation id (files)
--
--   SELECT  every signed-in user (avatars and attachments are shown to others;
--           attachments are end-to-end encrypted ciphertext since #5)
--   INSERT  only into your own avatar folder, or the folder of a conversation you're in
--   UPDATE  only objects you uploaded, and only to a name you could insert
--   DELETE  only objects you uploaded
--
-- Owner checks use storage's `owner_id`, which the Storage API sets from the caller's
-- JWT. Objects without one (uploaded with the service key) can't be changed by clients.
--
-- The old live policies only checked bucket_id. Policies are OR'ed, so they are
-- dropped by their live names first (read from pg_policies on 2026-10-23).

drop policy if exists "Basic role for users for avatars 1oj01fe_0" on storage.objects;
drop policy if exists "Basic role for users for avatars 1oj01fe_1" on storage.objects;
drop policy if exists "Basic role for users for avatars 1oj01fe_2" on storage.objects;
drop policy if exists "Basic role for users for avatars 1oj01fe_3" on storage.objects;
drop policy if exists "Basic role for users for chat-files pdeh8i_0" on storage.objects;
drop policy if exists "Basic role for users for chat-files pdeh8i_1" on storage.objects;
drop policy if exists "Basic role for users for chat-files pdeh8i_2" on storage.objects;
drop policy if exists "Basic role for users for chat-files pdeh8i_3" on storage.objects;
drop policy if exists "Basic role for users for msg 1oj01fe_0" on storage.objects;
drop policy if exists "Basic role for users for msg 1oj01fe_1" on storage.objects;
drop policy if exists "Basic role for users for msg 1oj01fe_2" on storage.objects;
drop policy if exists "Basic role for users for msg 1oj01fe_3" on storage.objects;

drop policy if exists "app_objects_select" on storage.objects;
drop policy if exists "app_objects_insert" on storage.objects;
drop policy if exists "app_objects_update_own" on storage.objects;
drop policy if exists "app_objects_delete_own" on storage.objects;

create policy "app_objects_select"
  on storage.objects for select to authenticated
  using (bucket_id in ('avatars', 'chat-files', 'storage-msg'));

-- CASE keeps the uuid cast from running on a malformed folder name.
create policy "app_objects_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id in ('avatars', 'chat-files', 'storage-msg')
    and (storage.foldername(name))[1] = bucket_id
    and case
      when (storage.foldername(name))[2] !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' then false
      when bucket_id = 'avatars' and (storage.foldername(name))[2] = (select auth.uid())::text then true
      else public.is_conversation_member(((storage.foldername(name))[2])::uuid)
    end
  );

create policy "app_objects_update_own"
  on storage.objects for update to authenticated
  using (
    bucket_id in ('avatars', 'chat-files', 'storage-msg')
    and owner_id = (select auth.uid())::text
  )
  with check (
    bucket_id in ('avatars', 'chat-files', 'storage-msg')
    and owner_id = (select auth.uid())::text
    and (storage.foldername(name))[1] = bucket_id
    and case
      when (storage.foldername(name))[2] !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' then false
      when bucket_id = 'avatars' and (storage.foldername(name))[2] = (select auth.uid())::text then true
      else public.is_conversation_member(((storage.foldername(name))[2])::uuid)
    end
  );

create policy "app_objects_delete_own"
  on storage.objects for delete to authenticated
  using (
    bucket_id in ('avatars', 'chat-files', 'storage-msg')
    and owner_id = (select auth.uid())::text
  );
