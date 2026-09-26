-- Let a user delete only the messages they sent.
--
-- messageAPI.deleteMessage used to run with the service role and delete any
-- message by id. It now uses the caller's session, so this policy is what
-- decides which deletes succeed.
--
-- Before applying, check what is already there - policies are OR'ed, so a
-- broader DELETE policy would still let anyone delete anything:
--
--   select policyname, cmd, roles, qual
--   from pg_policies
--   where schemaname = 'public' and tablename = 'messages';
--
--   select relrowsecurity from pg_class where oid = 'public.messages'::regclass;
--
-- Drop any other DELETE policy on messages, and make sure RLS is enabled.
-- Enabling it is left out here on purpose: if it was off, the select/insert
-- policies need to exist first or the app stops working.

drop policy if exists "messages_delete_own" on public.messages;

create policy "messages_delete_own"
  on public.messages
  for delete
  to authenticated
  using (sender_id = (select auth.uid()));
