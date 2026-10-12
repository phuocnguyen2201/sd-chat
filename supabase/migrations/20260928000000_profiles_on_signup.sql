-- Create the profile row server-side when an auth user is created.
--
-- With "Confirm email" on, supabase.auth.signUp returns no session, so the app
-- can no longer insert into profiles itself (RLS: auth.uid() = id). The app now
-- passes its public key as sign-up metadata and this trigger files it.
--
-- raw_user_meta_data is caller-controlled, so only the public key is read from
-- it and only when it looks like a base64 X25519 key (32 bytes -> 44 chars).
-- Anything else is stored as null rather than failing the sign-up, so users
-- created from the dashboard still get a profile.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_key text := new.raw_user_meta_data ->> 'public_key';
  v_username text := coalesce(nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user');
begin
  if v_public_key is null or v_public_key !~ '^[A-Za-z0-9+/]{43}=$' then
    v_public_key := null;
  end if;

  /*
    username is UNIQUE and comes from the email's local part, so john@a.com and
    john@b.com collide. A collision must not fail the sign-up (that would also
    tell the caller the name is taken): fall back to a suffix from the user id.
  */
  if exists (select 1 from public.profiles where username = v_username) then
    v_username := v_username || '_' || left(replace(new.id::text, '-', ''), 8);
  end if;

  begin
    insert into public.profiles (id, username, public_key, created_at)
    values (new.id, v_username, v_public_key, now())
    on conflict (id) do nothing;
  exception when unique_violation then
    -- Lost a race for the same username: the full id is unique by definition.
    insert into public.profiles (id, username, public_key, created_at)
    values (new.id, v_username || '_' || replace(new.id::text, '-', ''), v_public_key, now())
    on conflict (id) do nothing;
  end;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
