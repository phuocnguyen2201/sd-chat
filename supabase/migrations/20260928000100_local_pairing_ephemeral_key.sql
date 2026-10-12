-- Security #4: the key-sync QR is sealed to a one-time X25519 key of the
-- device that entered the local pairing code. That device sends the public
-- half with the code (local-code-verify), bound to the code by an HMAC, and
-- the old device reads it back (local-code-status) before sealing.
--
-- Both values are public (a public key and a MAC over it), and the table
-- still has no client policies: only the device-pairing Edge Function
-- (service role) reads or writes it.
alter table public.local_pairing_codes
  add column if not exists requester_ephemeral_pub text,
  add column if not exists requester_key_proof text;
