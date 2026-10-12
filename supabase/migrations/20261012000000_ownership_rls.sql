-- Ownership RLS for files*, messages INSERT and reactions (#10 table half, #13, and
-- message impersonation). Tested by supabase/tests/ownership_rls.test.sql.
--
--   files_profiles  everyone reads (avatars are shown to all); write only your own
--   files_group     members of the group read and write (any member may change the avatar)
--   files           members of the message's conversation read; only its sender writes
--   messages        INSERT now also requires sender_id = you (it only checked membership,
--                   so a member could post as another member)
--   reactions       members of the message's conversation read; react only as yourself,
--                   only in conversations you're in
--
-- Policies are OR'ed, so the old permissive ones are dropped by their live names first.
-- Check the live names before applying:
--
--   select tablename, policyname, cmd, qual, with_check from pg_policies
--   where schemaname = 'public'
--     and tablename in ('files', 'files_group', 'files_profiles', 'messages', 'reactions');
--
-- Not covered: storage bucket policies (#10's other half).

-- files_profiles ---------------------------------------------------------------
drop policy if exists "Enable insert for authenticated users only" on public.files_profiles;
drop policy if exists "files_profiles_select_all" on public.files_profiles;
drop policy if exists "files_profiles_write_own" on public.files_profiles;

create policy "files_profiles_select_all"
  on public.files_profiles for select to authenticated
  using (true);

create policy "files_profiles_write_own"
  on public.files_profiles for all to authenticated
  using (profile_id = (select auth.uid()))
  with check (profile_id = (select auth.uid()));

-- files_group ------------------------------------------------------------------
drop policy if exists "Enable insert for authenticated users only" on public.files_group;
drop policy if exists "files_group_members" on public.files_group;

create policy "files_group_members"
  on public.files_group for all to authenticated
  using (public.is_conversation_member(conversation_id))
  with check (public.is_conversation_member(conversation_id));

-- files (attachments, linked only through message_id) ---------------------------
drop policy if exists "Enable insert for authenticated users only" on public.files;
drop policy if exists "files_select_members" on public.files;
drop policy if exists "files_write_sender" on public.files;

create policy "files_select_members"
  on public.files for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = files.message_id and public.is_conversation_member(m.conversation_id)
  ));

create policy "files_write_sender"
  on public.files for all to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = files.message_id and m.sender_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.messages m
    where m.id = files.message_id and m.sender_id = (select auth.uid())
  ));

-- messages INSERT ---------------------------------------------------------------
drop policy if exists "Users can send messages to conversations they're in" on public.messages;
drop policy if exists "messages_insert_own" on public.messages;

create policy "messages_insert_own"
  on public.messages for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and public.is_conversation_member(conversation_id)
  );

-- reactions -----------------------------------------------------------------------
drop policy if exists "reactions_select_authenticated" on public.reactions;
drop policy if exists "reactions_insert_owner" on public.reactions;
drop policy if exists "reactions_select_members" on public.reactions;
drop policy if exists "reactions_insert_member" on public.reactions;

create policy "reactions_select_members"
  on public.reactions for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = reactions.message_id and public.is_conversation_member(m.conversation_id)
  ));

create policy "reactions_insert_member"
  on public.reactions for insert to authenticated
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1 from public.messages m
      where m.id = reactions.message_id and public.is_conversation_member(m.conversation_id)
    )
  );
