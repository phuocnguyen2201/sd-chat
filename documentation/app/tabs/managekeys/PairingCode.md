# Pairing Code Screen

**Source:** [`app/tabs/managekeys/PairingCode.tsx`](../../../../app/tabs/managekeys/PairingCode.tsx)

`PairingCode` is the "old device" (already has the keys) half of the local, same-room pairing-code gate. It sits between `ManageKeys`'s `Share Keys` button and the QR-sharing step, proving the two devices are physically together before any key material is prepared. Added 2026-09-15 (commit `3104094`).

## Flow

1. On mount, registers this install as a `devices` row (`DeviceIdentity.registerCurrentDevice(user.id)`) if it isn't already, then requests a fresh 4-digit code (`LocalPairingCode.create()`).
2. **Showing** – displays the code and a countdown driven off the server's `expiresAt` (not a local guess), so client clock drift can't extend it.
3. Polls `LocalPairingCode.status()` every 2s while showing. Once the other device verifies the code (`status === 'verified'`), navigates to `/tabs/managekeys/ManageKeys?autoShare=1`, which skips straight into QR generation (see `ManageKeys.md`).
4. **Expired** – once the countdown hits 0, offers `Generate a new code` (calls `generateCode()` again).
5. `Cancel` calls `LocalPairingCode.cancel()` (best-effort — the code expires on its own regardless) and returns to Settings.

## Related

- `app/tabs/managekeys/EnterPairingCode.tsx` — the new-device counterpart that submits the code shown here.
- `utility/securedMessage/LocalPairingCode.ts` — client for the `local-code-*` Edge Function actions.
- `utility/securedMessage/DeviceIdentity.ts` — per-install device registration.
- `documentation/supabase/README.md` — server-side code generation, TTL, and lockout rules (`local-code-create` / `local-code-status`).
