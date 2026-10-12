-- Let the Maestro seed check read the two seed profiles with the publishable key,
-- without signing in. Policies are OR'ed, so this only adds visibility for these rows.
--
-- Before applying, check the grants: this policy limits rows, not columns. If anon
-- has SELECT on public.profiles, every column of these two rows is readable.
--
--   select grantee, privilege_type
--   from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'profiles';

drop policy if exists "profiles_seed_users_select" on public.profiles;

create policy "profiles_seed_users_select"
  on public.profiles
  for select
  to anon, authenticated
  using (displayname in ('Testing', 'Android Simulator'));
