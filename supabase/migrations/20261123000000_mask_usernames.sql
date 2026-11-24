-- Security #18: profiles.username was the email's local part in full, and every
-- signed-in user can read every profile, so anyone could list everyone's email
-- prefixes. The username is now stored masked, keeping only the ends:
--
--   length 1-2   first char + **            ab          -> a**
--   length 3-5   first + ** + last          alice       -> a**e
--   length 6-9   first 2 + ** + last 2      johnsmith   -> jo**th
--   length 10+   first 3 + ** + last 3      phuocnguyen -> phu**yen
--
-- Always exactly two stars, so the mask does not give away the length.
--
-- The mask is applied in the database, not in the app: the app could only hide
-- it on screen, while the table itself stays readable through the API.
--
-- Masked names collide far more often than real ones (john@ and jordan@ both
-- become j**n), and nothing in the app looks a profile up by username: it is
-- shown only as a label next to the display name. So the UNIQUE constraint is
-- dropped rather than papered over with id suffixes. That also removes the
-- "is this name taken?" signal the old collision fallback had to work around.

create or replace function public.mask_email_local(p_local text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when n = 0 then 'user'
    when n <= 2 then left(p_local, 1) || '**'
    when n <= 5 then left(p_local, 1) || '**' || right(p_local, 1)
    when n <= 9 then left(p_local, 2) || '**' || right(p_local, 2)
    else left(p_local, 3) || '**' || right(p_local, 3)
  end
  from (select coalesce(char_length(p_local), 0) as n) s
$$;

revoke execute on function public.mask_email_local(text) from public, anon;
grant execute on function public.mask_email_local(text) to authenticated, service_role;

alter table public.profiles drop constraint if exists profiles_username_key;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_key text := new.raw_user_meta_data ->> 'public_key';
  v_username text := public.mask_email_local(split_part(coalesce(new.email, ''), '@', 1));
begin
  if v_public_key is null or v_public_key !~ '^[A-Za-z0-9+/]{43}=$' then
    v_public_key := null;
  end if;

  insert into public.profiles (id, username, public_key, created_at)
  values (new.id, v_username, v_public_key, now())
  on conflict (id) do nothing;

  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Existing rows. The email is the source, not the current username: older rows
-- may carry a collision suffix (john_1a2b3c4d) that would otherwise leak into
-- the mask. Every profile has an auth user (profiles_id_fkey), so this covers
-- them all.
update public.profiles p
set username = public.mask_email_local(split_part(coalesce(u.email, ''), '@', 1))
from auth.users u
where u.id = p.id;
