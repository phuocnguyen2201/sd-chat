import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import { scryptAsync } from '@noble/hashes/scrypt';
import * as Crypto from 'expo-crypto';
import * as nacl from 'tweetnacl';
import { supabase } from '@/utility/connection';
import { MessageEncryption } from '@/utility/securedMessage/secured';
import { DeviceIdentity } from '@/utility/securedMessage/DeviceIdentity';

/*
  The "doomsday vault": a second recovery path for the identity private key,
  for the case the live device-to-device pairing flow cannot cover - every
  device lost, wiped, or reinstalled, with nothing left online to pair with.

  It is zero-knowledge. The key is sealed on this device with a passphrase
  that is never transmitted and never stored, and only the ciphertext leaves.
  The vault holds an opaque blob and authenticates the caller; it cannot read
  what it stores. A forgotten passphrase means an unrecoverable backup, by
  design - the same trust model as the rest of the app's E2EE.

  What is backed up is the identity key only, not conversation keys: those are
  re-derived after recovery from each `conversation_participants.wrapped_key`
  row (see ConversationKeyResolver). Conversations where this user has no
  wrapped key of their own - the ones this device minted and never wrapped for
  itself - stay unreadable. That gap is accepted, not solved here.
*/

const VAULT_URL = process.env.EXPO_PUBLIC_VAULT_URL;

/*
  scrypt rather than Argon2id: it is pure JS through @noble/hashes, so it needs
  no native module and no rebuild of the dev client. N=2^15 (32 MiB) is the
  usual interactive figure. The parameters are stored per backup rather than
  assumed, so they can be lowered later - on a slow device, say - without
  stranding backups written under the old ones.
*/
const SCRYPT_PARAMS = {
    N: 1 << 15,
    r: 8,
    p: 1,
    dkLen: 32,
} as const;

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const BLOB_VERSION = 1;

/** No backup exists for this account - nothing to recover from. */
export class NoBackupFoundError extends Error {}
/** The blob exists but would not open: wrong passphrase, or damaged bytes. */
export class WrongPassphraseError extends Error {}
/** The vault itself could not be reached or refused the request. */
export class VaultUnreachableError extends Error {}
/**
 * The blob opened, but the key inside belongs to a different identity than the
 * one this account advertises. Restoring it would replace a recoverable state
 * with an unrecoverable one, so recovery stops here instead.
 */
export class IdentityMismatchError extends Error {}

type BackupMetadata = {
    kdf: string;
    kdf_salt: string;
    kdf_n: number;
    kdf_r: number;
    kdf_p: number;
    nonce: string;
    blob_version: number;
};

function vaultEndpoint(userId: string): string {
    if (!VAULT_URL) {
        throw new VaultUnreachableError(
            'EXPO_PUBLIC_VAULT_URL is not set, so there is no vault to talk to'
        );
    }
    return `${VAULT_URL.replace(/\/+$/, '')}/backup/${userId}`;
}

/**
 * The passphrase is stretched into the sealing key, and the account id is bound
 * in as associated data so a blob can never be opened under a different user.
 */
async function deriveSealingKey(
    passphrase: string,
    salt: Uint8Array,
    params: { N: number; r: number; p: number }
): Promise<Uint8Array> {
    return scryptAsync(passphrase.normalize('NFKC'), salt, {
        N: params.N,
        r: params.r,
        p: params.p,
        dkLen: SCRYPT_PARAMS.dkLen,
    });
}

/** The current session's access token, which is what the vault authenticates. */
async function requireAccessToken(): Promise<{ accessToken: string; userId: string }> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
        throw new Error('A signed-in session is required to reach the vault');
    }
    return { accessToken: data.session.access_token, userId: data.session.user.id };
}

/**
 * The vault answers a refusal with `{ error: "..." }` naming the reason, and
 * that reason is the only diagnostic a user in the field can hand back. A bare
 * status code sends them looking at the wrong thing: "401" reads as a bad
 * passphrase, when it is always a token or configuration problem.
 *
 * A response that is not the vault's JSON gets reported as such, because that
 * is itself the answer - something in front of the tunnel is intercepting.
 */
async function describeRefusal(res: Response): Promise<string> {
    let raw: string;
    try {
        raw = await res.text();
    } catch {
        return `${res.status}`;
    }

    try {
        const parsed = JSON.parse(raw) as { error?: string };
        if (parsed?.error) return `${res.status} - ${parsed.error}`;
    } catch {
        // Not JSON: an HTML error page means something other than the vault
        // answered, which is worth saying out loud rather than swallowing.
        if (raw.trim().startsWith('<')) {
            return `${res.status} - answered by something other than the vault (not JSON)`;
        }
    }

    return raw ? `${res.status} - ${raw.slice(0, 200)}` : `${res.status}`;
}

/*
  Ciphertext travels as base64 in JSON rather than as a raw binary body.
  React Native's fetch is an XHR polyfill whose binary support varies by
  platform and version; for a payload this small the encoding overhead is
  meaningless next to not having to trust that.
*/
async function putBlob(userId: string, accessToken: string, ciphertext: string): Promise<void> {
    let res: Response;
    try {
        res = await fetch(vaultEndpoint(userId), {
            method: 'PUT',
            headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ciphertext }),
        });
    } catch (cause) {
        throw new VaultUnreachableError(
            `Could not reach the vault: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }

    if (!res.ok) {
        throw new VaultUnreachableError(`Vault rejected the upload: ${await describeRefusal(res)}`);
    }
}

async function getBlob(userId: string, accessToken: string): Promise<string> {
    let res: Response;
    try {
        res = await fetch(vaultEndpoint(userId), {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    } catch (cause) {
        throw new VaultUnreachableError(
            `Could not reach the vault: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }

    if (res.status === 404) {
        throw new NoBackupFoundError('The vault holds no backup for this account');
    }
    if (!res.ok) {
        throw new VaultUnreachableError(`Vault refused the request: ${await describeRefusal(res)}`);
    }

    const body = (await res.json()) as { ciphertext?: string };
    if (!body?.ciphertext) {
        throw new NoBackupFoundError('The vault returned an empty backup');
    }
    return body.ciphertext;
}

/** Whether this account has a usable backup, for deciding what to offer in the UI. */
export async function hasVaultBackup(userId: string): Promise<boolean> {
    const { data, error } = await supabase
        .from('key_backups')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

    return !error && !!data;
}

/**
 * Seal this device's identity private key with `passphrase` and upload only the
 * ciphertext, recording the (non-secret) KDF parameters and nonce in Supabase.
 *
 * Re-running this replaces the previous backup, so the caller is responsible
 * for having the user confirm the passphrase first: a mistyped one silently
 * destroys a working backup.
 */
export async function backupIdentityKey(userId: string, passphrase: string): Promise<void> {
    if (!passphrase) {
        throw new Error('A recovery passphrase is required');
    }

    const { accessToken } = await requireAccessToken();

    const privateKeyBase64 = MessageEncryption.getPrivateKey(userId);
    if (!privateKeyBase64) {
        throw new Error('This device holds no identity key to back up');
    }
    const privateKey = MessageEncryption.base64ToBytes(privateKeyBase64);

    const salt = Crypto.getRandomBytes(SALT_BYTES);
    const nonce = Crypto.getRandomBytes(NONCE_BYTES);
    const sealingKey = await deriveSealingKey(passphrase, salt, SCRYPT_PARAMS);

    const aead = new ChaCha20Poly1305(sealingKey);
    const ciphertext = aead.seal(nonce, privateKey, new TextEncoder().encode(userId));
    sealingKey.fill(0);

    // The blob goes up first: metadata pointing at a blob that was never stored
    // would make the UI promise a backup that cannot be fetched.
    await putBlob(userId, accessToken, MessageEncryption.bytesToBase64(ciphertext));

    const { error } = await supabase.from('key_backups').upsert({
        user_id: userId,
        kdf: 'scrypt',
        kdf_salt: MessageEncryption.bytesToBase64(salt),
        kdf_n: SCRYPT_PARAMS.N,
        kdf_r: SCRYPT_PARAMS.r,
        kdf_p: SCRYPT_PARAMS.p,
        nonce: MessageEncryption.bytesToBase64(nonce),
        vault_ref: userId,
        blob_version: BLOB_VERSION,
    });

    if (error) {
        throw new Error(`The backup was stored but its parameters were not: ${error.message}`);
    }
}

/**
 * Fetch this account's backup, open it with `passphrase`, and install the key
 * in this device's secure storage - leaving the device in the same state a
 * successful pairing would.
 *
 * The recovered key is checked against `profiles.public_key` before anything is
 * written, so a blob belonging to another identity is refused rather than
 * cementing a mismatch that only ever surfaces later, on the peer's device.
 */
export async function recoverIdentityKey(passphrase: string): Promise<void> {
    if (!passphrase) {
        throw new Error('A recovery passphrase is required');
    }

    const { accessToken, userId } = await requireAccessToken();

    const { data: meta, error: metaError } = await supabase
        .from('key_backups')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

    if (metaError) {
        throw new VaultUnreachableError(`Could not read the backup parameters: ${metaError.message}`);
    }
    if (!meta) {
        throw new NoBackupFoundError('No backup has been made for this account');
    }

    const metadata = meta as BackupMetadata;
    if (metadata.kdf !== 'scrypt') {
        throw new Error(`This backup uses an unsupported KDF: ${metadata.kdf}`);
    }

    const ciphertext = MessageEncryption.base64ToBytes(await getBlob(userId, accessToken));
    const salt = MessageEncryption.base64ToBytes(metadata.kdf_salt);
    const nonce = MessageEncryption.base64ToBytes(metadata.nonce);

    const sealingKey = await deriveSealingKey(passphrase, salt, {
        N: metadata.kdf_n,
        r: metadata.kdf_r,
        p: metadata.kdf_p,
    });

    const aead = new ChaCha20Poly1305(sealingKey);
    const privateKey = aead.open(nonce, ciphertext, new TextEncoder().encode(userId));
    sealingKey.fill(0);

    if (!privateKey) {
        throw new WrongPassphraseError('That passphrase did not open the backup');
    }
    if (privateKey.length !== nacl.box.secretKeyLength) {
        throw new WrongPassphraseError('The backup opened but does not contain an identity key');
    }

    const recoveredPublicKey = MessageEncryption.bytesToBase64(
        nacl.box.keyPair.fromSecretKey(privateKey).publicKey
    );

    const { data: profile } = await supabase
        .from('profiles')
        .select('public_key')
        .eq('id', userId)
        .maybeSingle();

    // An account with no advertised public key has nothing to contradict, so the
    // recovered key is taken as authoritative. Anything else has to agree.
    const advertisedPublicKey = (profile as { public_key?: string | null } | null)?.public_key;
    if (advertisedPublicKey && advertisedPublicKey !== recoveredPublicKey) {
        privateKey.fill(0);
        throw new IdentityMismatchError(
            'The recovered key does not match the public key this account advertises'
        );
    }

    MessageEncryption.setPrivateKey(userId, privateKey);
    privateKey.fill(0);

    // Same bookkeeping the pairing flow does once a device holds the key.
    try {
        const deviceRowId = await DeviceIdentity.registerCurrentDevice(userId);
        await DeviceIdentity.markKeySynced(deviceRowId);
    } catch (error) {
        // The key is already in place and usable; failing to record the device
        // is not worth undoing that for.
        console.error('Key recovered, but registering this device failed:', error);
    }
}

/**
 * Remove an account's backup, blob and parameters both.
 *
 * Must run while the session is still valid - the vault authenticates every
 * request - which in the deletion flow means before the account is deleted and
 * the user signed out. The `key_backups` row would cascade away with the
 * profile anyway; the blob on the vault would not, and nothing else would ever
 * come to collect it.
 */
export async function deleteVaultBackup(userId: string): Promise<void> {
    const { accessToken } = await requireAccessToken();

    let res: Response;
    try {
        res = await fetch(vaultEndpoint(userId), {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
        });
    } catch (cause) {
        throw new VaultUnreachableError(
            `Could not reach the vault: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }

    // A vault with nothing stored is the state being asked for.
    if (!res.ok && res.status !== 404) {
        throw new VaultUnreachableError(`Vault refused to delete the backup: ${await describeRefusal(res)}`);
    }

    await supabase.from('key_backups').delete().eq('user_id', userId);
}
