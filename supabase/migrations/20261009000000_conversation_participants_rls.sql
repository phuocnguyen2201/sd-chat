-- Security #9: conversation_participants RLS.
--
-- Before this migration every verb on this table was `true` for the
-- authenticated role. Any signed-up user could INSERT themselves into any
-- conversation, and a member's device then backfilled the conversation key
-- for them. UPDATE and DELETE were open the same way.
--
-- After:
--   SELECT  members of the conversation only.
--   INSERT  no policy and no grant. Rows come only from the creation RPCs
--           (create_dm_conversation, create_conversation_with_participants),
--           which run as postgres and bypass RLS.
--   UPDATE  key columns only (column grant). A user can always update their
--           own row. They can update another member's row only while that
--           row's wrapped_key is still empty, which is what the backfill and
--           the group creator need. Overwriting an existing key is refused.
--   DELETE  own row only (leave a conversation).

-- Membership check. SECURITY DEFINER so the policies can call it without
-- recursing into this table's own RLS. search_path is pinned (see #14).
create or replace function public.is_conversation_member(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants
    where conversation_id = p_conversation_id
      and user_id = auth.uid()
  );
$$;

revoke all on function public.is_conversation_member(uuid) from public;
revoke all on function public.is_conversation_member(uuid) from anon;
grant execute on function public.is_conversation_member(uuid) to authenticated;

alter table public.conversation_participants enable row level security;

-- Drop every existing policy by name. The names come from the live database
-- (checked 2026-10-09).
drop policy if exists "Enable select for authenticated users only - select" on public.conversation_participants;
drop policy if exists "Enable insert for authenticated users only" on public.conversation_participants;
drop policy if exists "Enable update for authenticated users only" on public.conversation_participants;
drop policy if exists "Enable delete for authenticated users only" on public.conversation_participants;
drop policy if exists "Enable delete for users based on user_id" on public.conversation_participants;
-- Re-runnable on top of the baseline, which already has these.
drop policy if exists "participants_select_members" on public.conversation_participants;
drop policy if exists "participants_update_key_columns" on public.conversation_participants;
drop policy if exists "participants_delete_own" on public.conversation_participants;

create policy "participants_select_members"
  on public.conversation_participants
  for select
  to authenticated
  using (public.is_conversation_member(conversation_id));

create policy "participants_update_key_columns"
  on public.conversation_participants
  for update
  to authenticated
  using (
    user_id = auth.uid()
    or (public.is_conversation_member(conversation_id) and wrapped_key is null)
  )
  with check (public.is_conversation_member(conversation_id));

create policy "participants_delete_own"
  on public.conversation_participants
  for delete
  to authenticated
  using (user_id = auth.uid());

-- Column-level grants as well as policies, so even a permitted UPDATE can only
-- touch the three key columns. conversation_id and user_id can never change.
revoke insert, update, delete on public.conversation_participants from anon, authenticated;
grant select on public.conversation_participants to authenticated;
grant delete on public.conversation_participants to authenticated;
grant update (wrapped_key, key_nonce, other_party_pub_key)
  on public.conversation_participants to authenticated;
