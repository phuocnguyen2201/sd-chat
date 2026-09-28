# Confirm page (`confirm-page/`)

A static, framework-free web page that finishes email confirmation in the browser. The "Confirm signup" email (`supabase/templates/confirmation.html`) links to it as `https://<host>/?token_hash=…&type=email`. The app never receives a redirect: the user taps the button here, then goes back to SD Chat and logs in.

## Files
| File | Purpose |
| --- | --- |
| `index.html` | Markup, plus CSP and `no-referrer` / `noindex` meta tags. No inline script or style. |
| `confirm.js` | The flow (below). |
| `config.js` | Public values only: project URL and **publishable** key. Never a secret key. |
| `vendor/supabase-2.89.0.js` | supabase-js UMD build copied from `node_modules` (no CDN, so the CSP stays `script-src 'self'`). |
| `style.css` | Light and dark styling. |
| `_headers` | Real response headers on Cloudflare Pages / Netlify: CSP, `frame-ancestors 'none'`, `X-Frame-Options`, `nosniff`, HSTS, `no-store`. |

## Flow (`confirm.js`)
1. On load:
   - Read `token_hash` and `type`, then `history.replaceState` removes them from the address bar and history.
   - A malformed or missing token, or a `type` other than `email`/`signup`, shows "link is incomplete".
2. **Nothing is sent on load.** Mail scanners that prefetch links would otherwise use up the single-use token.
3. On **Confirm my email**:
   - `verifyOtp({ token_hash, type: 'email' })` on a client with `persistSession: false`.
   - On success, `signOut({ scope: 'local' })` revokes the session that verification created.
   - Shows "confirmed, go back to the app".
4. Any failure shows one generic "invalid or expired, request a new one from the app" message. Server error text is never rendered.

## Deploying / updating
- Host it on a domain you'll keep. Site URL and the single Redirect URL in Supabase must be exactly this URL (`need-action.md`).
- When upgrading supabase-js, copy the new UMD build into `vendor/` under a new versioned name and update the `<script>` tag.
- Don't add analytics, fonts or other third-party resources: the URL carries a one-time token.
- The same verify-and-revoke steps are used by Maestro in `maestro/scripts/confirm-email.js`.

Threat model: `security-scan.md`, pass 3 (R1–R9).
