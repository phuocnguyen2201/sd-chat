/**
 * Crypto timing in Node. Run with `npm run bench:crypto`. Not part of
 * `npx jest`'s default match, so the normal test run stays fast.
 *
 * The numbers are relative: Node's JIT is much faster than Hermes, so use this
 * table to spot a regression between commits, and the CryptoBench screen on a
 * phone for absolute numbers.
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('expo-crypto', () => ({
  getRandomBytes: (n: number) => new Uint8Array(require('crypto').randomBytes(n)),
}));
const mockSecureStoreData = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItem: (key: string) => mockSecureStoreData.get(key) ?? null,
  setItem: (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  },
  getItemAsync: async (key: string) => mockSecureStoreData.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    mockSecureStoreData.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    mockSecureStoreData.delete(key);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 0,
}));

import { runCryptoBench } from '../bench/cryptoBench';

describe('crypto bench', () => {
  it('times every case and cleans up the bench key', async () => {
    const results = await runCryptoBench();

    console.table(
      results.map((r) => ({
        case: r.name,
        runs: r.iterations,
        'mean ms': r.meanMs.toFixed(3),
        'p95 ms': r.p95Ms.toFixed(3),
        'ops/s': r.opsPerSec.toFixed(1),
      }))
    );

    // CI sets BENCH_MARKDOWN and appends the file to the job summary.
    const markdownPath = process.env.BENCH_MARKDOWN;
    if (markdownPath) {
      const rows = results.map(
        (r) => `| ${r.name} | ${r.iterations} | ${r.meanMs.toFixed(3)} | ${r.p95Ms.toFixed(3)} | ${r.opsPerSec.toFixed(1)} |`
      );
      require('fs').writeFileSync(
        markdownPath,
        ['## Crypto bench (Node)', '', '| Case | Runs | Mean ms | p95 ms | ops/s |', '|---|---|---|---|---|', ...rows, ''].join('\n')
      );
    }

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => Number.isFinite(r.meanMs))).toBe(true);
    expect(mockSecureStoreData.size).toBe(0);
  }, 300_000);
});
