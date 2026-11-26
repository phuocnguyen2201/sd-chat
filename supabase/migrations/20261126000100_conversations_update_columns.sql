-- Security #31: members may rename a conversation or change its avatar, nothing else.
--
-- The UPDATE policy "Allow users update own conversations" only checks
-- membership, and the baseline gave `authenticated` (and `anon`) GRANT ALL on
-- the table. So any member could rewrite created_by (still trusted by the
-- key-wrapper fallback in ConversationKeyResolver.findKeyWrapperPeerId and by
-- delete-account), flip is_group, or change epoch / meta_data.
--
-- The app only ever updates `name` (ChatRoomEditing.tsx) and `avatar_url`
-- (conversationAPI.updateGroupAvatarForGroupChat). Conversations are created by
-- the SECURITY DEFINER RPCs create_conversation_with_participants and
-- create_dm_conversation, and deleted only by delete-account (service role).
-- There are no INSERT or DELETE policies, so RLS already blocked those for
-- clients; the grants are removed too so the table privileges say the same.
--
-- The membership check in the UPDATE policy stays as it is (for UPDATE, a
-- missing WITH CHECK reuses USING, so the new row must still belong to a
-- conversation the caller is in).

revoke all on table public.conversations from anon;
revoke all on table public.conversations from authenticated;

grant select on table public.conversations to authenticated;
grant update (name, avatar_url) on table public.conversations to authenticated;
