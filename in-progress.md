# In Progress / Open Items

## Remote (server-relayed) device pairing — built but not wired to UI
`supabase/functions/device-pairing`, `RemoteDevicePairing.ts`, and `DeviceIdentity.ts` are fully implemented and callable, but no screen calls them yet. Still needed:
- Login/Bootstrap flow: detect "no local private key" and offer this as an option (currently only the local QR flow in `ManageKeys`/`ScanningKeys` is reachable from the UI).
- An "old device" approval screen: list incoming pairing requests, show the one-time code, call `RemoteDevicePairing.approve()`.
- A "new device" screen: call `createRequest()`, poll `status()`, enter the code via `confirm()`, then `fetchAndUnwrap()`.

## Known critical issue — deferred by user request
`utility/connection.ts` exports `supabaseAdmin` from `EXPO_PUBLIC_SUPABASE_SERVICE_KEY`. Because Expo inlines `EXPO_PUBLIC_*` vars into the client bundle, the Supabase service-role key (bypasses RLS) ships inside the compiled app and is extractable from it. Actively used client-side in `utility/messages.ts` for account deletion (`supabaseAdmin.auth.admin.deleteUser`) and message/conversation deletion. Needs to move into server-side Edge Functions (same pattern as `push` / `device-pairing`), then the key should be rotated. User explicitly asked to leave this alone for now ("we'll handle later") — do not touch without being asked again.

## Schema not tracked in-repo
The `devices`, `device_pairing_requests`, and now `local_pairing_codes` tables (and their RLS) were applied by hand-running SQL directly against the Supabase project. There's no `supabase/migrations/` entry for any of them, so a fresh environment/CI wouldn't get this schema automatically. Worth adding migration files for traceability if/when convenient.

## Local pairing-code gate — implemented, needs on-device testing
Just built (2026-09-15), not yet run in the app: `PairingCode.tsx` / `EnterPairingCode.tsx` + the `local-code-*` Edge Function actions, sitting in front of the existing local QR handshake (see progress.md for the full file list). Before considering this done:
- Run through the full flow on two real devices: Settings → Biometric → Share Keys → code shown → other device → Receive Keys → enter code → confirm the existing QR exchange still completes correctly.
- Exercise the failure paths: wrong code (attempts-remaining message), 5 wrong attempts (lockout countdown), code expiry (regenerate button), Cancel on both screens.
- `.expo/types/router.d.ts` was hand-patched to add the two new routes so `tsc` would pass without a running dev server — once `expo start` runs normally it'll regenerate that file properly; just confirm it doesn't collide with the manual patch (it shouldn't, since that file is gitignored and fully regenerated, not merged).
- `BiometricAuthentication.tsx` was deliberately left unchanged (still routes to `ManageKeys`, which now gates both directions via the two new screens) — flag if a different entry point was actually intended.

