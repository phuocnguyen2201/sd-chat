import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import { scryptAsync } from '@noble/hashes/scrypt';
import * as nacl from 'tweetnacl';
import { MessageEncryption } from '@/utility/securedMessage/secured';

/*
  Crypto timing cases, shared by the Jest bench (Node numbers, for spotting
  regressions) and the dev-only CryptoBench screen (Hermes numbers on a real
  phone, which are the ones users feel). Same cases and same runner in both,
  so the two tables line up row for row.

  Nothing here talks to the network. The wrap/unwrap cases need an identity
  key in SecureStore, so they file one under a throwaway bench user id and
  remove it again in cleanup().
*/

export type BenchCase = {
    name: string;
    fn: () => unknown | Promise<unknown>;
    /** Timed runs. Slow cases (scrypt, 10 MB) use fewer. */
    iterations: number;
};

export type BenchResult = {
    name: string;
    iterations: number;
    meanMs: number;
    p95Ms: number;
    opsPerSec: number;
};

const BENCH_USER_ID = 'crypto-bench-user';
const WRAP_INFO = 'conversation-key-wrap';
const PAIRING_INFO = 'crypto-bench-pairing';

// Mirrors SCRYPT_PARAMS in VaultBackup.ts. Not imported from there because that
// module pulls in the Supabase client, which a bench has no use for.
const VAULT_SCRYPT = { N: 1 << 15, r: 8, p: 1, dkLen: 32 } as const;

// Node's hrtime first: jest-expo's environment only gives whole milliseconds
// from performance.now(). Hermes has no process.hrtime but a fine performance.now().
const now = (): number => {
    const hrtime = (globalThis as any).process?.hrtime?.bigint;
    if (typeof hrtime === 'function') return Number(hrtime()) / 1e6;
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
};

/** Reproduces the pre-#8b derivation, to build a row that only the legacy fallback opens. */
function legacyKdfSha512(ikm: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    const prk = nacl.hash(ikm);
    const t = nacl.hash(new Uint8Array([...prk, ...info, 0x01]));
    return t.slice(0, length);
}

function filledBytes(size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    for (let i = 0; i < size; i++) bytes[i] = i & 0xff;
    return bytes;
}

export async function buildCryptoCases(): Promise<{ cases: BenchCase[]; cleanup: () => Promise<void> }> {
    const conversationKey = await MessageEncryption.createConversationKey();
    const shortText = 'See you at 7?';
    const longText = 'x'.repeat(4000);
    const shortEnvelope = MessageEncryption.encryptMessage(shortText, conversationKey);

    const attachments = [
        { label: '1 KB', bytes: filledBytes(1024), iterations: 200 },
        { label: '1 MB', bytes: filledBytes(1024 * 1024), iterations: 20 },
        { label: '10 MB', bytes: filledBytes(10 * 1024 * 1024), iterations: 3 },
    ].map((a) => ({ ...a, sealed: MessageEncryption.encryptAttachment(a.bytes) }));

    // Identity keys for wrap/unwrap: we are the sender, `peer` the recipient.
    const self = nacl.box.keyPair();
    const peer = nacl.box.keyPair();
    MessageEncryption.setPrivateKey(BENCH_USER_ID, self.secretKey);
    const wrapped = await MessageEncryption.wrapConversationKey(conversationKey, self.publicKey, BENCH_USER_ID);

    // A row wrapped before the HKDF fix, so unwrap has to take the fallback path.
    const legacyNonce = nacl.randomBytes(12);
    const legacyKey = legacyKdfSha512(
        nacl.box.before(self.publicKey, self.secretKey),
        new TextEncoder().encode(WRAP_INFO),
        32
    );
    const legacyWrapped = new ChaCha20Poly1305(legacyKey).seal(legacyNonce, conversationKey);

    const pairingPayload = filledBytes(2900); // roughly the sealed QR's size cap
    const sealedPairing = await MessageEncryption.ecdhSeal(pairingPayload, peer.publicKey, self.secretKey, PAIRING_INFO);

    const scryptSalt = filledBytes(16);

    const cases: BenchCase[] = [
        { name: 'encryptMessage (short)', iterations: 500, fn: () => MessageEncryption.encryptMessage(shortText, conversationKey) },
        { name: 'encryptMessage (4 KB)', iterations: 200, fn: () => MessageEncryption.encryptMessage(longText, conversationKey) },
        { name: 'decryptMessage (short)', iterations: 500, fn: () => MessageEncryption.decryptMessage(shortEnvelope, conversationKey) },
        ...attachments.flatMap((a) => [
            { name: `encryptAttachment (${a.label})`, iterations: a.iterations, fn: () => MessageEncryption.encryptAttachment(a.bytes) },
            {
                name: `decryptAttachment (${a.label})`,
                iterations: a.iterations,
                fn: () => MessageEncryption.decryptAttachment(a.sealed.ciphertext, a.sealed.key, a.sealed.nonce),
            },
        ]),
        {
            name: 'wrapConversationKey',
            iterations: 100,
            fn: () => MessageEncryption.wrapConversationKey(conversationKey, peer.publicKey, BENCH_USER_ID),
        },
        {
            name: 'unwrapConversationKey (HKDF)',
            iterations: 100,
            fn: () => MessageEncryption.unwrapConversationKey(wrapped.wrappedKey, wrapped.nonce, self.publicKey, BENCH_USER_ID),
        },
        {
            name: 'unwrapConversationKey (legacy fallback)',
            iterations: 100,
            fn: () => MessageEncryption.unwrapConversationKey(legacyWrapped, legacyNonce, self.publicKey, BENCH_USER_ID),
        },
        {
            name: 'ecdhSeal (2.9 KB pairing QR)',
            iterations: 100,
            fn: () => MessageEncryption.ecdhSeal(pairingPayload, peer.publicKey, self.secretKey, PAIRING_INFO),
        },
        {
            name: 'ecdhOpen (2.9 KB pairing QR)',
            iterations: 100,
            fn: () =>
                MessageEncryption.ecdhOpen(sealedPairing.ciphertext, sealedPairing.nonce, self.publicKey, peer.secretKey, PAIRING_INFO),
        },
        {
            name: 'vault scrypt (N=2^15, r=8)',
            iterations: 3,
            fn: () => scryptAsync('correct horse battery staple', scryptSalt, VAULT_SCRYPT),
        },
    ];

    const cleanup = async () => {
        await MessageEncryption.deletePrivateKey(BENCH_USER_ID);
    };

    return { cases, cleanup };
}

/** One warm-up call, then `iterations` timed calls run one after another. */
export async function runBenchCase(benchCase: BenchCase): Promise<BenchResult> {
    await benchCase.fn();

    const samples: number[] = [];
    for (let i = 0; i < benchCase.iterations; i++) {
        const start = now();
        await benchCase.fn();
        samples.push(now() - start);
    }

    samples.sort((a, b) => a - b);
    const meanMs = samples.reduce((sum, s) => sum + s, 0) / samples.length;
    const p95Ms = samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)];

    return {
        name: benchCase.name,
        iterations: benchCase.iterations,
        meanMs,
        p95Ms,
        opsPerSec: meanMs > 0 ? 1000 / meanMs : Infinity,
    };
}

export async function runCryptoBench(onResult?: (result: BenchResult) => void): Promise<BenchResult[]> {
    const { cases, cleanup } = await buildCryptoCases();
    const results: BenchResult[] = [];
    try {
        for (const benchCase of cases) {
            const result = await runBenchCase(benchCase);
            results.push(result);
            onResult?.(result);
        }
    } finally {
        await cleanup();
    }
    return results;
}
