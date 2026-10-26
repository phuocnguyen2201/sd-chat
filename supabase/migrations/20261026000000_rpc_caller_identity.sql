-- RPCs act as the signed-in caller (#11, #30). Tested by supabase/tests/rpc_auth.test.sql.
--
--   create_conversation_with_participants  creator is auth.uid(), not p_user_id (anyone,
--                                          even anon, could create groups "owned" by any user)
--   create_dm_conversation                 already used auth.uid(); now refuses a null caller
--   mark_messages_as_read                  SECURITY DEFINER, so it can update other members'
--                                          messages (read receipts did nothing under "update
--                                          own messages only"); members only, uses auth.uid(),
--                                          touches only read_by
--
-- Signatures are unchanged so the app's calls keep working; p_user_id is ignored.
-- All three get a pinned search_path (#14) and lose EXECUTE for anon.

create or replace function public.create_conversation_with_participants(p_name text, p_user_id uuid, p_group_users uuid[])
  returns table(conversation_id uuid, conversation_name text, owner_id uuid)
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  insert into public.conversations (id, name, is_group, created_by, created_at)
  values (gen_random_uuid(), p_name, true, v_caller, now())
  returning id into v_conv_id;

  insert into public.conversation_participants (conversation_id, user_id, joined_at)
  select distinct v_conv_id, u, now()
  from unnest(coalesce(p_group_users, '{}') || v_caller) as u
  where u is not null;

  conversation_id := v_conv_id;
  conversation_name := p_name;
  owner_id := v_caller;
  return next;
end;
$$;

create or replace function public.create_dm_conversation(other_user_id uuid)
  returns uuid
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
  v_conv_id uuid;
begin
  if v_caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;

  select c.id into v_conv_id
  from public.conversations c
  join public.conversation_participants cp1 on c.id = cp1.conversation_id
  join public.conversation_participants cp2 on c.id = cp2.conversation_id
  where c.is_group = false
    and cp1.user_id = v_caller
    and cp2.user_id = other_user_id;

  if v_conv_id is not null then
    return v_conv_id;
  end if;

  insert into public.conversations (is_group, created_by)
  values (false, v_caller)
  returning id into v_conv_id;

  insert into public.conversation_participants (conversation_id, user_id)
  values (v_conv_id, v_caller), (v_conv_id, other_user_id);

  return v_conv_id;
end;
$$;

create or replace function public.mark_messages_as_read(p_conversation_id uuid, p_user_id uuid)
  returns void
  language plpgsql security definer
  set search_path = ''
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null or not public.is_conversation_member(p_conversation_id) then
    raise exception 'not a member of this conversation' using errcode = '42501';
  end if;

  update public.messages
  set read_by = array_append(coalesce(read_by, '{}'), v_caller)
  where conversation_id = p_conversation_id
    and not (coalesce(read_by, '{}') @> array[v_caller]);
end;
$$;

-- Functions are executable by PUBLIC by default, so revoke that as well as anon.
revoke execute on function public.create_conversation_with_participants(text, uuid, uuid[]) from public, anon;
revoke execute on function public.create_dm_conversation(uuid) from public, anon;
revoke execute on function public.mark_messages_as_read(uuid, uuid) from public, anon;
grant execute on function public.create_conversation_with_participants(text, uuid, uuid[]) to authenticated, service_role;
grant execute on function public.create_dm_conversation(uuid) to authenticated, service_role;
grant execute on function public.mark_messages_as_read(uuid, uuid) to authenticated, service_role;
