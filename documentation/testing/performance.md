# Performance testing

Covers the app only. Backend load testing is out of scope while the project is on the Supabase free tier.

| Layer | Tool | Where | Run |
|---|---|---|---|
| Crypto timing (Node) | Jest + shared timing runner | `utility/securedMessage/bench/cryptoBench.ts`, `utility/securedMessage/__bench__/crypto.bench.ts` | `npm run bench:crypto` |
| Crypto timing (phone) | Dev-only screen | `app/tabs/managekeys/CryptoBench.tsx` | Manage Keys → "Crypto benchmark (dev)" |
| Render regressions | [Reassure](https://callstack.github.io/reassure/) | `perf/render/*.perf-test.tsx` | `npm run perf:render:baseline`, then `npm run perf:render` |
| Runtime: FPS, CPU, RAM (Android) | [Flashlight](https://docs.flashlight.dev/) + Maestro | `perf/flashlight/` | `perf/flashlight/run.sh [scenario] [iterations]` |
| Bundle size | [expo-atlas](https://github.com/expo/atlas) | — | `EXPO_ATLAS=true npx expo export --platform android`, then `npx expo-atlas` |
| Deep dives | Android Studio Profiler / Perfetto, Xcode Instruments, React Native DevTools profiler | — | Manual, see below |

None of these run as part of `npx jest`. The bench and perf files use their own file patterns (`*.bench.ts`, `*.perf-test.tsx`).

## CI
`.github/workflows/maestro-e2e.yml` runs the perf checks after the build and before the Maestro suite:

```
build ──┬── unit-test ──┐
        └── perf ───────┴── e2e: install APK → set up account → Flashlight → Maestro suite → tear down
```

| Where | What it reports | Output |
|---|---|---|
| `perf` job | Crypto bench table; Reassure compared against the previous commit; APK and JS bundle size from the APK that e2e installs | Job summary, `perf-results` artifact |
| `e2e` job, in `.github/scripts/run-maestro.sh` | Flashlight `cold-start` and `search-typing`, 3 iterations each, on the emulator with the freshly signed-in CI account | `maestro-results` artifact, `flashlight/*.json`; open them with `flashlight report` |

**Report only.** A worse number never blocks e2e. Only a crash in the `perf` job does, the same way a failing unit test does. A failed Flashlight scenario prints a warning, and the suite runs anyway. `scroll-chat` and `send-image` don't run in CI: the "Android Simulator" DM doesn't exist yet at that point, and the image picker needs gallery files.

Emulator numbers (swiftshader GPU, shared runner) only show trends. Compare runs with each other, not with a real phone. On PRs, `perf-render.yml` runs Reassure alone, because PRs don't run the E2E workflow.

## Crypto timing

`buildCryptoCases()` in `cryptoBench.ts` defines the cases, and `runBenchCase()` times them: one warm-up call, then N timed calls, reporting mean, p95 and ops/s. Jest and the phone screen run the same cases with the same runner, so their tables line up row for row. tinybench was considered and dropped: it is ESM-only and would need another Jest transform exception.

The wrap/unwrap cases store a throwaway identity key under the user id `crypto-bench-user` and delete it afterwards. The account's real key is never read or changed. Nothing touches the network.

**The phone screen** appears in dev builds, and in release builds made with `EXPO_PUBLIC_PERF_BENCH=1`. Use the release build for numbers you want to keep: dev builds run unminified JS and are much slower. In normal release builds the route redirects to Manage Keys.

### Baseline (Node 26, M-series Mac, 2026-11-02)

| Case | mean ms | p95 ms |
|---|---|---|
| encryptMessage (short / 4 KB) | 0.08 / 0.33 | 0.12 / 0.40 |
| decryptMessage (short) | 0.03 | 0.04 |
| encrypt / decryptAttachment 1 MB | 18.7 / 19.2 | 19.0 / 19.2 |
| encrypt / decryptAttachment 10 MB | 206 / 214 | 234 / 245 |
| wrapConversationKey | 23.7 | 30.4 |
| unwrapConversationKey (HKDF / legacy fallback) | 21.1 / 23.1 | 25.8 / 29.0 |
| ecdhSeal / ecdhOpen (2.9 KB) | 20.0 / 19.6 | 22.3 / 21.1 |
| Vault scrypt (N=2^15, r=8) | 149 | 160 |

Phone numbers: not recorded yet. Expect Hermes to be several times slower than Node.

What stands out:
- **X25519 costs about 20 ms per call even in Node** (tweetnacl `box.before`). Each wrap or unwrap pays it once. Creating a group pays it once per member, and backfill pays it once per row, all on the JS thread.
- **A 10 MB attachment takes about 200 ms each way** in Node, also on the JS thread. On a phone the UI will likely freeze for that long.
- The legacy HKDF fallback adds only about 2 ms, so keeping "read both" costs almost nothing.

## Render regressions (Reassure)

`perf/render/*.perf-test.tsx` render the real screens with Supabase, the session, the router and native pickers mocked. Messages are real ciphertext, so decryption cost is part of what's measured. The test files live outside `app/` because expo-router treats every file under `app/` as a route.

```bash
npm run perf:render:baseline   # on the commit to compare against
npm run perf:render            # on your change; writes .reassure/output.md
```

`@testing-library/react-native` 14 makes `fireEvent` async. Always `await` it, or later runs fail with "overlapping act() calls".

**CI:** `.github/workflows/perf-render.yml` runs on PRs that touch `app/`, `components/`, `utility/`, `perf/render/` or the package files. It measures the base branch, then the PR, and posts `output.md` to the job summary. It only reports and never blocks a PR: two runs of the same commit already differ by up to ~15% in duration. **Changes in render count are exact, so act on those first.**

### Baseline (2026-11-02)

| Scenario | Mean render time | Renders | Redundant |
|---|---|---|---|
| Room: first render, 30 messages | 44 ms | 4 | 0 |
| Room: first render, 200 messages | 204 ms | 4 | 0 |
| Room: typing 10 characters, 30 messages | 337 ms | 24 | 10 |
| Chat list: first render, 50 conversations | 158 ms | 4 | 0 |
| Chat list: typing a 6-character search, 50 conversations | 1482 ms | 16 | 5 |

What stands out:
- **Chat list search costs about 250 ms per keystroke** with 50 conversations. The filter runs in an effect that copies results into `filteredUsers`/`filteredChatRooms` state, so each keystroke renders twice, and each render rebuilds every row.
- **Each keystroke in the room re-renders the whole screen twice** and decrypts every message again: `safeDecrypt` runs inside render, and the composer text is screen-level state.
- Room render time grows roughly linearly with message count, because `messages.map` inside a `ScrollView` has no virtualization. Realtime inserts keep growing a long session past the 30-message page.

## Runtime (Flashlight)

Flashlight reads FPS, CPU per thread and RAM from the device over adb while a Maestro flow drives the app. It reports a 0–100 score per run.

**Setup (once):**
1. Install the CLI: `curl https://get.flashlight.dev | bash` (macOS/Linux).
2. Build and install a **release** APK (`npx expo run:android --variant release`, or the `maestro-e2e.yml` build). Debug builds load JS from Metro, so their numbers mean nothing.
3. Sign in once (`maestro test maestro/login.yaml` with `MAESTRO_EMAIL`/`MAESTRO_PASSWORD`). The account needs the "Android Simulator" conversation that the other flows use, ideally with a long history.

**Scenarios** (`perf/flashlight/flows/`):

| Scenario | What it does |
|---|---|
| `cold-start` | Launches the app cold and waits for a usable chat list |
| `scroll-chat` | Opens the "Android Simulator" room and swipes through the message list |
| `search-typing` | Types into the chat list search box, then clears it |
| `send-image` | Runs `maestro/send-images.yaml`: pick, encrypt, upload |

```bash
perf/flashlight/run.sh                      # all scenarios, 5 iterations each
perf/flashlight/run.sh scroll-chat 3        # one scenario
flashlight report perf/reports/A.json perf/reports/B.json   # compare runs side by side
```

Reports are written to `perf/reports/<date>-<scenario>.json`. They are gitignored because they are large. Copy the score, average FPS, JS-thread CPU and peak RAM into the table below instead.

There are no local baseline numbers yet. CI runs `cold-start` and `search-typing` on every E2E run (see [CI](#ci)). Set `REPORTS_DIR` to write reports somewhere other than `perf/reports/`.

| Date | Scenario | Score | Avg FPS | JS thread CPU | Peak RAM | Build |
|---|---|---|---|---|---|---|
| | | | | | | |

### Manual deep dives
- **Android jank:** Android Studio → Profiler → CPU, or record a Perfetto trace (`adb shell perfetto …`, open it at ui.perfetto.dev). Look for long `mqt_js` (JS thread) slices.
- **iOS:** Xcode → Product → Profile → Time Profiler for CPU, Allocations for memory. Use a release build on a real device.
- **React renders on a device:** React Native DevTools (press `j` in Metro) → Profiler tab → record while typing or scrolling.

## Bundle size (expo-atlas)

```bash
EXPO_ATLAS=true npx expo export --platform android --output-dir /tmp/sd-export
npx expo-atlas      # opens .expo/atlas.jsonl in the browser
```

`expo-atlas` is pinned to `~0.4` because Expo SDK 56's CLI asks for `^0.4.0`. With 0.5 installed, `expo export` tries to reinstall it and fails.

### Baseline (2026-11-02)
Android Hermes bundle: **11.7 MB** (4,280 modules, 16 MB of source).

| Package | Source size | Why it is there |
|---|---|---|
| lucide-react-native | 3.1 MB (1,598 modules) | Imported through the barrel (`from 'lucide-react-native'`), so every icon is bundled, though the app uses a handful |
| react-native-css-interop | 1.8 MB | NativeWind runtime |
| react-native-reanimated | 1.5 MB | |
| emoji-mart-native | 0.9 MB | Emoji picker. It is listed under devDependencies but still ends up in the bundle |
| css-tree + mdn-data | 0.6 MB | Pulled in by `react-native-svg/src/css/css.tsx` (SVG CSS support) |
| tailwindcss | 0.1 MB | Pulled in at runtime by `@gluestack-ui/utils` (tailwind-plugin, use-break-point-value) |

Bundle size mostly affects cold start (bytecode loading). Compare against Flashlight's `cold-start` scenario before and after any change.
