-- Security #18: usernames are stored masked, so other users never see an email's
-- full local part.
begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- The masking rule.
select is(public.mask_email_local('a'), 'a**', 'length 1');
select is(public.mask_email_local('ab'), 'a**', 'length 2');
select is(public.mask_email_local('alice'), 'a**e', 'length 5');
select is(public.mask_email_local('johnsmith'), 'jo**th', 'length 9');
select is(public.mask_email_local('phuocnguyen'), 'phu**yen', 'length 11');
select is(public.mask_email_local(''), 'user', 'empty');
select is(public.mask_email_local('nguyễnvăn'), 'ng**ăn', 'counts characters, not bytes');

-- New sign-ups get a masked username.
insert into auth.users (id, email) values
  ('51111111-1111-1111-1111-111111111111', 'johnsmith@mask.test'),
  ('52222222-2222-2222-2222-222222222222', 'johnsmith@other.test');

select is(
  (select username from public.profiles where id = '51111111-1111-1111-1111-111111111111'),
  'jo**th', 'sign-up stores the masked name');

-- Two users whose masks collide both sign up fine.
select is(
  (select count(*)::int from public.profiles where username = 'jo**th'), 2,
  'colliding masks do not fail the sign-up');

select hasnt_index('public', 'profiles', 'profiles_username_key', 'username is no longer unique');

-- Nobody's username contains a full local part any more.
select is(
  (select count(*)::int
     from public.profiles p join auth.users u on u.id = p.id
    where char_length(split_part(u.email, '@', 1)) >= 3
      and p.username = split_part(u.email, '@', 1)),
  0, 'no stored username equals the email local part');

-- anon cannot call the helper; the trigger function is not callable by clients.
select ok(not has_function_privilege('anon', 'public.mask_email_local(text)', 'execute'), 'anon cannot call mask_email_local');
select ok(not has_function_privilege('authenticated', 'public.handle_new_user()', 'execute'), 'clients cannot call handle_new_user');

select * from finish();
rollback;
