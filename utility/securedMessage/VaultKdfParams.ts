/*
  Security #24: the scrypt settings for a key backup come back from the
  `key_backups` row, and the row is data, not code. Fed straight into scrypt, a
  huge N (or r, or p) written to that row makes recovery allocate gigabytes or
  run for hours, which hangs or kills the app on exactly the screen someone
  reaches when they have lost every other device.

  So recovery only accepts settings this app could have written itself, with
  some room either side: backups are written at N=2^15, r=8, p=1 (32 MiB).

  - N must be a power of two (scrypt requires it) between 2^14 and 2^17.
  - r between 1 and 16, p between 1 and 4.
  - The memory scrypt needs (128 * N * r bytes) must stay at or under 64 MiB,
    twice what backups use today, so a later raise still fits on a phone.
  - The salt must be 16 bytes and the nonce 12, as written.

  The floor matters less than the ceiling - weaker settings than the backup was
  sealed with simply fail to open it - but anything below it is not a row this
  app wrote, so it is refused rather than tried.
*/

export const KDF_LIMITS = {
    minLogN: 14,
    maxLogN: 17,
    maxR: 16,
    maxP: 4,
    maxMemoryBytes: 64 * 1024 * 1024,
    saltBytes: 16,
    nonceBytes: 12,
} as const;

/** The backup's settings are outside what this app accepts, so it was not opened. */
export class UnsupportedBackupError extends Error {}

export type KdfParams = { N: number; r: number; p: number };

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * Returns the settings when they are safe to run, and throws
 * UnsupportedBackupError otherwise. Nothing expensive happens before this check.
 */
export function checkKdfParams(row: {
    kdf?: unknown;
    kdf_n?: unknown;
    kdf_r?: unknown;
    kdf_p?: unknown;
}): KdfParams {
    if (row.kdf !== 'scrypt') {
        throw new UnsupportedBackupError(`This backup uses an unsupported KDF: ${String(row.kdf)}`);
    }

    const { kdf_n: N, kdf_r: r, kdf_p: p } = row;
    if (!isInt(N) || !isInt(r) || !isInt(p)) {
        throw new UnsupportedBackupError('The backup settings are not whole numbers');
    }

    const isPowerOfTwo = N > 0 && (N & (N - 1)) === 0;
    if (!isPowerOfTwo || N < 2 ** KDF_LIMITS.minLogN || N > 2 ** KDF_LIMITS.maxLogN) {
        throw new UnsupportedBackupError(`The backup setting N=${N} is outside the accepted range`);
    }
    if (r < 1 || r > KDF_LIMITS.maxR) {
        throw new UnsupportedBackupError(`The backup setting r=${r} is outside the accepted range`);
    }
    if (p < 1 || p > KDF_LIMITS.maxP) {
        throw new UnsupportedBackupError(`The backup setting p=${p} is outside the accepted range`);
    }
    if (128 * N * r > KDF_LIMITS.maxMemoryBytes) {
        throw new UnsupportedBackupError('The backup settings need more memory than this app allows');
    }

    return { N, r, p };
}

/** The salt and nonce must have the lengths backups are written with. */
export function checkSaltAndNonce(salt: Uint8Array, nonce: Uint8Array): void {
    if (salt.length !== KDF_LIMITS.saltBytes) {
        throw new UnsupportedBackupError('The backup salt has the wrong length');
    }
    if (nonce.length !== KDF_LIMITS.nonceBytes) {
        throw new UnsupportedBackupError('The backup nonce has the wrong length');
    }
}
