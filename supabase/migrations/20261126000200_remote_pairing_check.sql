-- Security #23: remote pairing needs a check value the user confirms on the
-- old device, so a new device only gets keys after the user typed what that
-- device shows. Commit-then-reveal (see utility/securedMessage/RemotePairingCheck.ts):
--
--   pending     new device sent its one-time key and a commitment H(K || Nn)
--   challenged  an old device sent its nonce Na, bound to that key and commitment
--   revealed    the new device sent Nn, which opens the commitment
--   approved    the challenging device uploaded the key sealed to K
--
-- This replaces the server-issued 6-character code (status 'code_issued',
-- action 'confirm'). The server knew that code, so it proved nothing against
-- the server. No released screen uses remote pairing yet, so no data needs
-- moving. code_hash, code_issued_by_device_id and attempts are left in place
-- (unused) so the function deployed today keeps working until it's replaced.

alter table public.device_pairing_requests
  add column if not exists requester_commitment text,
  add column if not exists approver_nonce text,
  add column if not exists requester_nonce text,
  add column if not exists challenged_by_device_id uuid
    references public.devices(id) on delete cascade;

alter table public.device_pairing_requests
  drop constraint if exists device_pairing_requests_status_check;
alter table public.device_pairing_requests
  add constraint device_pairing_requests_status_check check (status = any (array[
    'pending', 'challenged', 'revealed', 'approved',
    'code_issued', -- only rows made by the old function; it expires in 2 minutes
    'denied', 'expired', 'completed'
  ]));

-- One request in flight per account, across all the steps before approval.
drop index if exists public.device_pairing_requests_one_active_idx;
create unique index device_pairing_requests_one_active_idx
  on public.device_pairing_requests (user_id)
  where status = any (array['pending', 'challenged', 'revealed', 'code_issued']);

-- Both tables are used only by the device-pairing function (service role).
-- RLS is on with no policies, so clients were already blocked; drop the
-- baseline GRANT ALL as well so the privileges say the same.
revoke all on table public.device_pairing_requests from anon, authenticated;
revoke all on table public.local_pairing_codes from anon, authenticated;
