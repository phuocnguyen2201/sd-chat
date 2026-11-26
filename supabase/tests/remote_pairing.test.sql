-- Security #23: remote pairing schema (commit-then-reveal check value).
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

select has_column('public', 'device_pairing_requests', 'requester_commitment', 'requester_commitment exists');
select has_column('public', 'device_pairing_requests', 'approver_nonce', 'approver_nonce exists');
select has_column('public', 'device_pairing_requests', 'requester_nonce', 'requester_nonce exists');
select has_column('public', 'device_pairing_requests', 'challenged_by_device_id', 'challenged_by_device_id exists');

-- Clients have no direct access; only the device-pairing function (service role).
select ok(
  not has_table_privilege('authenticated', 'public.device_pairing_requests', 'select')
  and not has_table_privilege('authenticated', 'public.device_pairing_requests', 'update')
  and not has_table_privilege('anon', 'public.device_pairing_requests', 'select'),
  'clients cannot touch device_pairing_requests');
select ok(
  not has_table_privilege('authenticated', 'public.local_pairing_codes', 'select')
  and not has_table_privilege('anon', 'public.local_pairing_codes', 'select'),
  'clients cannot touch local_pairing_codes');

-- Fixtures: one account with two devices.
insert into auth.users (id, email) values ('a2311111-1111-1111-1111-111111111111', 'rp@test.local');
insert into public.devices (id, user_id, device_id, device_name) values
  ('d2300000-0000-0000-0000-00000000000a', 'a2311111-1111-1111-1111-111111111111', 'old', 'Old phone'),
  ('d2300000-0000-0000-0000-00000000000b', 'a2311111-1111-1111-1111-111111111111', 'new', 'New phone');

insert into public.device_pairing_requests (id, user_id, requesting_device_id, requesting_ephemeral_public_key, requester_commitment)
values ('e2300000-0000-0000-0000-000000000001', 'a2311111-1111-1111-1111-111111111111',
        'd2300000-0000-0000-0000-00000000000b', 'K', 'C');

select lives_ok(
  $$ update public.device_pairing_requests
        set status = 'challenged', approver_nonce = 'Na', challenged_by_device_id = 'd2300000-0000-0000-0000-00000000000a'
      where id = 'e2300000-0000-0000-0000-000000000001' $$,
  'challenged is a valid status');

-- A second request while one is challenged breaks the one-active rule.
select throws_ok(
  $$ insert into public.device_pairing_requests (user_id, requesting_device_id, requesting_ephemeral_public_key)
     values ('a2311111-1111-1111-1111-111111111111', 'd2300000-0000-0000-0000-00000000000b', 'K2') $$,
  '23505', null, 'only one request in flight per account, including challenged');

select lives_ok(
  $$ update public.device_pairing_requests set status = 'revealed', requester_nonce = 'Nn'
      where id = 'e2300000-0000-0000-0000-000000000001' $$,
  'revealed is a valid status');

select throws_ok(
  $$ update public.device_pairing_requests set status = 'bogus'
      where id = 'e2300000-0000-0000-0000-000000000001' $$,
  '23514', null, 'unknown statuses are refused');

select * from finish();
rollback;
