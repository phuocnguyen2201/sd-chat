# Needs action (manual steps, in order)

## #9 and #12 (2026-10-09): written and tested, not applied to the live project
Nothing below has been run against production yet. Do these in order.
1. **Decide the group-creator case in `delete-account`** (see security-scan.md, 2026-10-09). Until decided, deleting an account that created a group with members still in it returns 409, and the app shows a generic failure.
2. **Apply the RLS migration** `supabase/migrations/20261009000000_conversation_participants_rls.sql`. It's safe to apply first: the client paths were checked against it, and the tests ran in a rolled-back transaction. After applying, re-run `select policyname, cmd from pg_policies where tablename='conversation_participants';`. Expect three policies (`participants_select_members`, `participants_update_key_columns`, `participants_delete_own`) and no `true` conditions.
3. **Smoke test on two devices** (both on the current build):
   - Create a DM, send a message, and check that the other person still reads it.
   - Create a group and check that each member can open it. The creator's own row should now have a `wrapped_key`.
   - Leave a conversation with "Delete chat" and check the others still have it.
   - Force a backfill: the other person's row is empty, and opening the chat fills it.
4. **Deploy `delete-account`** after step 1: `supabase functions deploy delete-account`. Then test deleting a throwaway account that is in a shared DM and a shared group. The other members must keep the conversation.
5. **Migrations are gitignored.** `.gitignore` line 47 ignores `/supabase/migrations`, so new migrations don't get committed. Decide whether to remove that line before committing this migration.

## Security #5, #7, #8a, #8b (2026-09-29) - three unmerged branches, not pushed

Each is a separate local branch off `main`, not pushed to GitHub, not merged:
`security/attachment-encryption`, `security/peer-key-pinning`, `security/key-import-and-hkdf`.
All three have unit tests passing (`npx jest utility/securedMessage --watchAll=false`).
None of this has been checked against the live Supabase project or on a device yet.

1. **Review and merge the three branches** (in any order - they touch mostly
   disjoint files; `[room_id].tsx` and `secured.ts` are the only overlaps, both
   small). Merge `security/attachment-encryption` last if conflicts show up,
   since it's the largest diff.
2. **`security/attachment-encryption` needs a dev-client rebuild before it can be
   tested at all**: it adds `expo-sharing`, a new native dependency (`expo-file-system`
   was already available). Run `npx expo prebuild` / rebuild the dev client
   for both platforms, then:
   - Upload an image and a file in a chat; confirm in the Supabase dashboard
     that the storage object is opaque bytes and `messages.content` is not the
     filename.
   - Confirm the image renders and zooms, and the file opens via the OS share
     sheet.
   - Forward an image/file to another conversation and confirm the recipient
     can open it.
   - Open the "Images & Files" gallery (chat room editing screen) and confirm
     it still renders.
   - Open a chat with attachments sent *before* this change and confirm they
     still work (legacy fallback path).
3. **`security/peer-key-pinning`:** on a test project, change a test peer's
   `profiles.public_key` (or `other_party_pub_key` on a conversation row),
   clear that conversation's locally cached key, then open the chat - confirm
   the "Security key changed" dialog appears, Cancel leaves no access and no
   DB write, and "Trust new key" restores access and updates the pin.
4. **`security/key-import-and-hkdf`:**
   - Scan a QR with a private key that doesn't match the signed-in account's
     `profiles.public_key` and confirm it's rejected with nothing changed.
   - Open an existing chat on a device with its local conversation-key cache
     cleared (exercises the legacy-HKDF fallback path) and confirm it still
     opens.
   - Create a brand-new chat between two up-to-date devices and confirm it
     works on the new HKDF path.
5. **#8c (no per-sender authentication) is deferred**, not fixed - see
   `security-scan.md`. No action needed now; it's tracked as a future item.

## Sealed key-sharing QR (security #4, 2026-09-28)
Order matters: the new function writes the new columns, and new app builds need the new function.
1. Apply `supabase/migrations/20260928000100_local_pairing_ephemeral_key.sql`.
2. `supabase functions deploy device-pairing`. From then on, older app builds can't enter a pairing code ("Update SD Chat"), which is intended.
3. Two-device test (two simulators or phones on the new build):
   - Share Keys on A, then Receive Keys on B and enter the code. The QR appears on A with a pairing check that matches B's. Scan it on B: chats open and decrypt.
   - Photograph A's QR and scan it from a third device (or from B after restarting the app on B): it must fail ("Enter the pairing code first" / "made for a different device").
   - Recovery: sign in on a device with no key. The guard should land on the code screen; "No other device?" should show the backup and delete exits.
4. Ship both platforms together. Pairing only works when both devices are on this build.
5. **Fix #12 next:** `delete-account` is live and wipes shared conversations for everyone.

## Done (2026-09-28): everything in the "Email confirmation" list below was reported done by the user and checked live where SQL allows.

## Email confirmation (2026-09-28)
1. **Fix `.env` (security #15, critical).** Set `EXPO_PUBLIC_SUPABASE_KEY` to the publishable key (`sb_publishable_…`, the same value as in `eas.json`), not the `sb_secret_…` key. Then rotate the secret key (Dashboard → Project Settings → API Keys) and delete old locally built APKs. Check that the GitHub secret `EXPO_PUBLIC_SUPABASE_KEY` is the publishable one.
2. **Apply the migration** `supabase/migrations/20260928000000_profiles_on_signup.sql` (sign-up is broken until this is applied). Then run the security advisors.
3. **Host `confirm-page/`** as a static site on a domain you'll keep:
   - Cloudflare Pages: set the build output to `confirm-page/`. `_headers` applies the CSP and other security headers.
   - GitHub Pages works too; the meta tags carry the CSP and referrer policy.
   - Don't add analytics or any third-party script.
4. **Supabase Dashboard → Authentication → URL Configuration:**
   - Site URL = the page's exact https URL, e.g. `https://confirm.example.com/`.
   - Redirect URLs = that exact URL only. No wildcards, no localhost.
5. **Dashboard → Authentication → Email Templates → Confirm signup:**
   - Subject `Confirm your SD Chat account`.
   - Body: paste `supabase/templates/confirmation.html`. The link must be `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email`.
6. **Dashboard → Authentication → Settings:**
   - Minimum password length 8 (character classes already enforced).
   - Email resend interval 60 s.
   - Leaked-password protection on, if your plan allows it.
7. Replace `CONFIRM_PAGE_HOST` in `supabase/config.toml` with the real host.
8. Delete the two probe users `sdchat-e2e-probe-1790581369@uberip.com` and `sdchat-e2e-probe-1790581442@uberip.com` (Dashboard → Authentication → Users).
9. **Test on a dev build:**
   - Register, open the email in a real mail app, tap the link, tap "Confirm my email", then log in.
   - Log in before confirming → "confirm your email first", then Resend (cooldown).
   - Re-open a used link → "invalid or has expired".
10. **Maestro:**
    - Locally: `maestro test maestro/signup-unconfirmed.yaml -e MAESTRO_PASSWORD=… -e MAESTRO_SUPABASE_URL=https://kblseanmnntpxqzgmsho.supabase.co -e MAESTRO_SUPABASE_KEY=sb_publishable_…`. `MAESTRO_PASSWORD` must meet the password policy.
    - CI needs no new secrets. It reuses `EXPO_PUBLIC_SUPABASE_URL` / `EXPO_PUBLIC_SUPABASE_KEY` and needs `jq` (preinstalled on ubuntu-latest).
