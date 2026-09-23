# Back Up Key Screen

**Source:** [`app/tabs/managekeys/BackupKey.tsx`](../../../../app/tabs/managekeys/BackupKey.tsx)

`BackupKey` seals this device's identity private key behind a passphrase the user chooses and uploads only the ciphertext to the key vault. It is the *writing* half of the second recovery path — the one that works when no other device is online to pair with. The reading half is `RecoverKey.md`.

Reached from `ManageKeys` ("Back up my key"), so it sits behind the same `BiometricAuthentication` gate as the rest of key management. That ordering is deliberate rather than incidental: there is nothing to back up unless this device already holds the key.

## Flow

1. On mount, `hasVaultBackup(user.id)` checks whether this account already has a backup. It only decides which warning to show, so a failure is swallowed.
2. The user enters a passphrase and types it again. Submit stays disabled until it is at least 10 characters and the two fields match.
3. `backupIdentityKey(userId, passphrase)` (see `documentation/utility/README.md`) derives a sealing key with scrypt, seals the private key, uploads the ciphertext, and records the scrypt parameters and nonce in `key_backups`.
4. On success both fields are cleared, the user is sent to Settings, and an alert states that nobody can reset the passphrase for them.

A full-screen modal covers steps 3–4. scrypt at N=2¹⁵ is deliberately slow — a few seconds on a phone — and without the modal the screen looks frozen.

## Why the confirmation field exists

The passphrase is stored nowhere. Not on the device, not in Supabase, not on the vault. That means a typo at this screen is indistinguishable from a forgotten passphrase months later: the backup simply never opens, and there is no way to tell the user which of the two happened. The second field is the only check that will ever be made against what they meant to type.

## Why the "already have a backup" warning exists

`backupIdentityKey` upserts. A second backup replaces the first, and the old passphrase stops working the moment the new blob lands. Someone rotating their passphrase who mistypes it — consistently, in both fields — has destroyed a working backup and will not find out until the day they need it.

The chosen behaviour is still to overwrite (see `in-progress.md`), so this warning and the confirmation field are what stand in for versioning.

## Related

- `app/tabs/managekeys/RecoverKey.tsx` — the other half; see `RecoverKey.md`.
- `utility/securedMessage/VaultBackup.ts` — all of the crypto and networking.
- `sd-chat-vault/DEPLOY.md` — the vault service this uploads to.
