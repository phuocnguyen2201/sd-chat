# Enter Pairing Code Screen

**Source:** [`app/tabs/managekeys/EnterPairingCode.tsx`](../../../../app/tabs/managekeys/EnterPairingCode.tsx)

`EnterPairingCode` is the "new device" half of the local pairing-code gate — the counterpart to `PairingCode.tsx`. It sits between `ManageKeys`'s `Receive Keys` button and `ScanningKeys`. Added 2026-09-15 (commit `3104094`).

## Flow

1. On mount, registers this install as a `devices` row via `DeviceIdentity.registerCurrentDevice(user.id)`.
2. User types the 4-digit code shown on the other device and taps `Verify` (also submittable from the keyboard).
3. On submit it creates a one-time X25519 key pair (`DevicePairing.startPairing`, once per visit and kept across wrong attempts) and computes `keyProof` (`LocalKeyTransfer.computeKeyProof(userId, digits, publicKey)`). `LocalPairingCode.verify(deviceRowId, digits, publicKey, keyProof)` is a single server round trip that returns one of three outcomes:
   - `verified: true` → navigates to `/tabs/managekeys/ScanningKeys` (passing `recovery` through). The one-time key stays in memory for the scanner. Leaving without verifying wipes it.
   - `locked: true` → shows a lockout message with a live countdown (`retryAfterSeconds`) during which the input stays disabled.
   - otherwise → shows "Incorrect code. N attempt(s) left." and clears the input for another try.
4. `Cancel` returns to Settings without submitting anything. In recovery mode (`?recovery=1`, set by the key guard in `IdentityKeyGuard.ts`) Settings is out of reach, so the button becomes "No other device?" and opens `ScanningKeys`, which holds the backup and delete-account exits.

The ScrollView uses `keyboardShouldPersistTaps="handled"`, so the first tap on Verify submits instead of only closing the number pad.

Lockout state is entirely server-driven (`lockedUntil` timestamp from the response), not inferred client-side, so it survives the screen being closed and reopened.

## Related

- `app/tabs/managekeys/PairingCode.tsx` — generates the code entered here.
- `utility/securedMessage/LocalPairingCode.ts` — client for the `local-code-*` Edge Function actions.
- `documentation/supabase/README.md` — server-side attempt limit (5) and lockout window (5 min), and why the code TTL (3 min) is deliberately shorter than the lockout so a lockout clearing never grants a second batch of guesses against the same code.
