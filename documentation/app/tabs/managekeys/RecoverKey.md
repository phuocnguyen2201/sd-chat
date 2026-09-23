# Recover From Backup Screen

**Source:** [`app/tabs/managekeys/RecoverKey.tsx`](../../../../app/tabs/managekeys/RecoverKey.tsx)

`RecoverKey` fetches this account's sealed key from the vault, opens it with the user's recovery passphrase, and installs it in this device's Secure Store — leaving the device in the same state a successful QR pairing would. It is the fallback for the case pairing cannot cover: every device lost, wiped, or reinstalled, with nothing left online to scan.

Reached from `ScanningKeys` ("Recover from backup"), which is where `Bootstrap` already sends a device that holds no usable key for the signed-in account. Unlike `BackupKey`, it is **not** behind the biometric gate — a device in this state has no key to protect yet, and the gate would only lock out the person it exists to help.

## Flow

1. The user enters their recovery passphrase. It never leaves the device.
2. `recoverIdentityKey(passphrase)` reads the scrypt parameters and nonce from `key_backups`, fetches the ciphertext from the vault, derives the sealing key, and opens the blob.
3. The recovered secret key is derived back to a public key and compared against `profiles.public_key` **before anything is written**. A mismatch aborts.
4. On success, `MessageEncryption.setPrivateKey()` installs the key, this install is registered in `devices` and marked `synced_key` via `DeviceIdentity`, and the user is sent to Settings.

A full-screen modal covers step 2, which takes a few seconds — scrypt is slow by design.

## Failure messages are deliberately distinct

`VaultBackup.ts` throws four typed errors, and this screen maps each to its own alert, because each calls for a completely different response from the user:

| Error | What it means | What the user should do |
| --- | --- | --- |
| `WrongPassphraseError` | The blob would not open | Try again — likely a typo |
| `NoBackupFoundError` | No backup was ever made | Stop; nothing here can help them |
| `VaultUnreachableError` | Network or vault problem | Wait and retry; the backup is not lost |
| `IdentityMismatchError` | The key belongs to another identity | Nothing was changed; this is a bug or a wrong account |

Collapsing these into one "recovery failed" message would leave someone retrying a passphrase against a vault that is simply offline, or retrying forever against a backup that does not exist.

## What recovery does and does not restore

It restores the **identity private key only**. Conversation keys are not in the blob — they come back through `resolveConversationKey()` (`utility/securedMessage/ConversationKeyResolver.ts`), which unwraps each conversation's key from that user's `conversation_participants.wrapped_key` row using the recovered identity key. This happens lazily, as conversations are opened, which is why the success alert says messages come back as the user visits them.

The gap: a conversation where this user has **no wrapped key of their own** cannot be recovered this way. Those are conversations whose key a device minted and never wrapped for its own row (`resolveConversationKey` returns `absent`). QR pairing does not have this gap, because `buildKeySyncPayload()` ships every conversation key the sharing device holds. This is an accepted limitation — see `in-progress.md`.

## Relationship to the pairing flow

Both paths end at the same place: a private key in Secure Store and a `devices` row marked `synced_key`. They differ in what they require.

| | QR pairing | Vault recovery |
| --- | --- | --- |
| Needs a second working device | Yes | No |
| Needs Supabase reachable | Yes | Yes |
| Needs the user to remember something | No | Yes, the passphrase |
| Restores conversation keys directly | Yes | No — re-derived lazily |

Vault recovery still requires a live session, because every vault request carries a Supabase JWT. The vault verifies that token locally rather than calling Supabase, so recovery survives Supabase's API going down *part way through* — it does not let someone recover while unable to log in at all.

## Related

- `app/tabs/managekeys/BackupKey.tsx` — the writing half; see `BackupKey.md`.
- `app/tabs/managekeys/ScanningKeys.tsx` — where this screen is reached from.
- `utility/securedMessage/VaultBackup.ts` — all of the crypto and networking.
- `utility/securedMessage/ConversationKeyResolver.ts` — how conversation keys come back afterwards.
