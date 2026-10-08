# Testing

## Overview
The project has two layers of tests:

| Layer | Tool | What it covers | Where |
|---|---|---|---|
| Unit | Jest (`jest-expo` preset) | Encryption, key handling, and upload code in `utility/`, with Supabase and native modules mocked | `utility/**/__tests__/*.test.ts` |
| End-to-end | Maestro | The real release APK on an Android emulator, against the real Supabase project | `maestro/*.yaml` |

Almost every unit suite guards one item from the security hardening work. The header comment in each file names its item (`security #N`).

## Running the tests

```bash
npx jest --watchAll=false        # all unit suites, once
npx jest PeerKeyPins             # one suite, matched by file name
npm test                         # watch mode
```

Jest config is the `"jest"` block in `package.json`. Packages that ship untranspiled code must be listed in `transformIgnorePatterns`. Otherwise the suites fail to load with `SyntaxError: Unexpected token`. That list already includes `react-native-css-interop` and `nativewind`.

**Mocking `react-native`:** don't replace the whole module with `jest.mock('react-native', () => ({ Alert }))`. jest-expo's setup needs the real `Platform` and `Appearance`. Spy on the single API you need instead, for example `jest.spyOn(Alert, 'alert')`.

## Unit test suites

### `utility/__tests__/handleStorage.test.ts`: attachment upload (security #5)
Checks that `storageAPIs.uploadImageToSupabase` never sends the real filename or file bytes to Supabase. The upload must contain only:
- the encrypted file, stored under a random UUID name with a generic MIME type;
- a descriptor (name, MIME type, per-file key) encrypted with the conversation key.

### `securedMessage/__tests__/AttachmentEncryption.test.ts`: attachment encryption (security #5)
**File content encryption**
- A large binary file and an empty file both decrypt back to the original.
- Decryption is rejected when the ciphertext or nonce has been tampered with, or when the key is wrong, the wrong size, or paired with a wrong-size nonce.

**Attachment descriptor**
- Opens only with the conversation key it was encrypted with.
- When a message is forwarded, the descriptor is re-encrypted for the target conversation and the plaintext is never exposed along the way.

### `securedMessage/__tests__/Hkdf.test.ts`: HKDF hardening (security #8b)
The old key derivation (plain SHA-512, no HMAC, no salt) was replaced with RFC 5869 HKDF from `@noble/hashes`. Keys already in the database used the old derivation, so the code writes only with the new one but can still read both.
- `hkdfSha512` gives the same output as `@noble/hashes` HKDF, and a different output from the old derivation.
- `unwrapConversationKey` and `ecdhOpen`:
  - open data made with the new derivation **and** data made with the old one;
  - still throw for a wrong key;
  - only ever write using the new derivation;
  - throw their documented error when a payload opens under neither derivation.

### `securedMessage/__tests__/ScanningKeysImport.test.ts`: scanned-key verification (security #8a)
Before a scanned identity key replaces the one already on the device, `verifyScannedIdentityKey` must check it:
- A key of the wrong length is rejected without any lookup.
- It is accepted if it matches the account's advertised public key, or if the account has no advertised key yet.
- It is rejected if it belongs to a different identity.
- A failed lookup is reported as an error, not silently accepted.
- `MessageEncryption.publicKeyFromSecret` derives the same public key as `nacl.box.keyPair.fromSecretKey`.

### `securedMessage/__tests__/ImportScannedIdentityKey.test.ts`: key import check (security #8a)
Tests `verifyAndImportIdentityKey`, the function `ScanningKeys.tsx` calls before saving a scanned key. The previous suite tests the check itself. This one tests that the caller obeys it: the key is saved only when the check returns `ok`. On a mismatch or a failed lookup, nothing is saved.

### `securedMessage/__tests__/LocalKeyTransfer.test.ts`: encrypted key-transfer QR (security #4)
When a user moves their keys to a new device, the old device shows a QR code. Only the device that entered the pairing code may be able to use it.

**Encrypted QR code**
- It opens only on the device that created the one-time key. It doesn't open on another device (for example, from a photo of the screen) or when no pairing is in progress.
- It is rejected if tampered with, if expired, or if `expiresAt` is missing or `NaN`. It is also rejected if it decrypts correctly but doesn't contain valid JSON.
- Starting a new pairing discards the previous one-time key.

**Other checks**
- `isPairInitPayload` accepts only a well-formed `pair_init` message.
- The key proof (an HMAC over the pairing code) verifies only with the same user, code and key.
- The pairing check is 4 hex characters and stays the same for a given key.
- The issued pairing code can be read only once, and `clearIssuedCode` discards it.
- The old unencrypted QR format is still recognised, so `ScanningKeys` can refuse it.

### `securedMessage/__tests__/PeerKeyPins.test.ts`: trust on first use for contacts' keys (security #7)
The first public key the device sees for a contact is saved ("pinned"). If the contact's key in the database changes later, the device doesn't accept the new key automatically.

- **`PeerKeyPins.checkPeerKey`:** pins the first key, confirms it matches on later checks, flags a change, and keeps pins separate for each local user. It throws if a user ID or contact ID is empty.
- **`resolveConversationKey`:**
  - Pins a first-seen key. If the key differs from the pin, returns `peer_key_changed` and neither caches nor saves the conversation key.
  - Skips the check for keys this device wrapped for itself.
  - Once the user has trusted a changed key, resolves normally.
  - Finds the contact from the conversation when no wrapper is given, and refuses when a changed key can't be traced to any contact.
  - In group chats, treats the creator as a contact only when someone else created the group.
  - If the recorded public key fails to unwrap, tries the wrapper hint and fixes the stored row.
- **`confirmPeerKeyChange`:** shows an alert that can't be dismissed without a choice. Returns `true` when the user trusts the new key and `false` when they cancel.
- **`resolveConversationKeyInteractive`:** if the key hasn't changed, returns the result as is. If it has, asks the user: on confirm it trusts the key and retries, on decline it returns `untrusted`.
- **`backfillMissingWrappedKeys`:** skips contacts whose key changed, and wraps keys normally for pinned or new contacts. Does nothing when no contact is missing a key, or when this device doesn't hold the key the profile advertises.

## End-to-end tests (Maestro)
Flows live in `maestro/`. `.github/scripts/run-maestro.sh` runs them in a fixed order against the release APK. The flows share state (the signed-in account and the open chat), so the order matters.

Each run:
1. Creates a temporary mail.tm inbox so the sign-up confirmation email can be read.
2. Signs up with `maestro/ci/setup-account.yaml`.
3. Runs the flows below. Every flow runs even if an earlier one fails.
4. Always deletes the account with `maestro/ci/teardown-account.yaml`.

The chat flows need two seeded users in the database, **"Android Simulator"** and **"Testing"**. `search-bar` needs a user whose name matches "iphone".

**Run in CI, in this order:** `send-messages`, `send-emojies`, `send-reaction`, `edit-message`, `forward-message`, `forward-cancel-then-send`, `delete-message`, `interactive-users`, `search-bar`, `toggle-darkmode`, `change-display-name`, `change-password`.

**Run by hand only:**

| Flow | Why it isn't in CI |
|---|---|
| `login`, `login-ios` | Need a dev-client build and an account whose keys are already on the device |
| `send-images`, `send-files`, `create-account-with-picture` | Pick specific files from the device gallery |
| `create-account-without-picutre-enable-biometric-authentication` | Needs an enrolled fingerprint |
| `signup-unconfirmed`, `delete-account` | Create extra temporary accounts |
| `backup-key`, `recover-key-from-backup`, `pairing-code-verify`, `pairing-code-cancel`, `pairing-code-lockout`, `create-group-chat`, `rename-group-chat`, `delete-chat`, `change-password-mismatch`, `login-errors`, `sign-out` | Not added to `run-maestro.sh` yet |

Results (JUnit XML, screenshots, `logcat.txt`) are written to `maestro-results/`. CI uploads that folder as the `maestro-results` artifact.

## CI
`.github/workflows/maestro-e2e.yml` runs on pushes to `main` (except doc-only changes) and can also be started by hand. It has three jobs:

| Job | What it does |
|---|---|
| `build` | Runs `expo prebuild` and builds the x86_64 release APK, then uploads it as an artifact |
| `unit-test` | Runs `npx jest --ci` on the source code. Doesn't use the APK |
| `e2e` | Waits for both jobs above, then installs the APK on an emulator and runs `run-maestro.sh` |

A failing unit test stops `e2e` from running.
