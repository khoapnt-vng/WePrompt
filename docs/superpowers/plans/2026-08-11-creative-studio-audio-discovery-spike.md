# Creative Studio Audio Track Discovery Spike Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to execute this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine whether Creative Studio can safely support one optional project-level background-music track, and select a waveform, preview-synchronization, and final-mix approach without integrating an audio feature into the product.

**Architecture:** Run all executable experiments in an isolated `spikes/creative-studio-audio/` harness that is excluded from production imports and packaging. Treat the existing Studio cut render as the immutable base-video input, evaluate a streaming FFmpeg peak extractor plus WaveSurfer.js for display, native Web Audio for preview synchronization, and a second FFmpeg pass for export mixing. Record bounded evidence and a `GO`, `CONDITIONAL_GO`, or `NO_GO` decision in one findings document.

**Tech Stack:** Bun, TypeScript, React 19, Vite, Playwright/Chromium, WaveSurfer.js `7.12.6`, native Web Audio API, system FFmpeg/ffprobe, Vitest 4.

## Global Constraints

- This is discovery only. Do not modify `packages/`, `resources/`, production tests, the Creative Studio schema, IPC, media storage, renderer UI, render service, root `package.json`, or root lockfile.
- Do not merge, ship, enable, or package the spike harness. Prototype commits may exist only on the bounded investigation branch; the findings document is the only candidate durable output.
- Keep the current Sprint 3 Slice A conversational Brief and Slice P reference-pool plans unchanged. Audio is not a third delivery lane.
- The v1 question is one optional background-music track. Narration, sound effects, recording, generated speech/music, beat detection, automatic ducking, keyframe automation, unlimited tracks, and collaborative editing are out of scope.
- Treat existing source-video audio as an implicit immutable base-audio bus. The spike may mix against it but may not redesign per-segment normalization or concatenation.
- Use only generated synthetic audio/video fixtures. Do not read user workspaces, media libraries, conversations, credentials, or provider output.
- Generate fixtures beneath a fresh temporary directory. Cap total fixture bytes at 750 MiB and remove only that exact temporary directory after evidence extraction.
- The spike may resolve FFmpeg from `FFMPEG_PATH` or `PATH`; it must not download or bundle an FFmpeg binary.
- Pin every investigated dependency and record its exact version, license, repository URL, and retrieved package integrity. A dependency with unclear commercial terms is a failed candidate.
- Time box: three engineer-days total. Stop any single candidate after four hours if a hard gate fails. Stop executable work at the end of day three even if the result is inconclusive.
- A crash, timeout, unavailable browser, unavailable FFmpeg, or unsupported platform is `UNVERIFIED`, never a pass.
- No network calls are allowed while fixtures or measurements are running. The spike UI must load all scripts and media from localhost.

---

## Questions and decision gates

| ID | Question | Pass gate |
| --- | --- | --- |
| Q1 | Can Studio represent a soundtrack without widening `StudioMediaKind` or disturbing generated-take ownership? | A separate audio-asset/track/clip sketch accounts for import, trim, start, gain, fades, mute, missing assets, revision conflicts, and deletion without changing existing image/video asset semantics. |
| Q2 | Can waveform peaks be produced without decoding a long track in the renderer? | FFmpeg PCM is consumed as a bounded stream; peak extraction RSS stays below 128 MiB above baseline for every fixture and produces at most 4,000 min/max bins per channel. |
| Q3 | Is WaveSurfer.js suitable as a view rather than project authority? | A 30-minute precomputed waveform becomes interactive within 2 seconds, adds less than 100 MiB renderer RSS, supports seek and a bounded region, and can be recreated from persisted spike data with identical timing. |
| Q4 | Can preview remain synchronized using native Web Audio? | During a real-time 10-minute run, p95 absolute skew is at most 50 ms and maximum skew is at most 100 ms; after play, pause, and three seeks, skew returns below 100 ms within 250 ms. |
| Q5 | Can a second FFmpeg pass produce a safe deterministic mix? | Output duration differs from video by at most one 30 fps frame; output has H.264 video plus AAC 48 kHz stereo; no sample peak exceeds -1 dBFS; cancellation leaves no output and cleanup removes only the exact spike temp directory. |
| Q6 | Is the dependency and packaging boundary acceptable? | Legal review has an explicit license result for WaveSurfer.js and the existing system-FFmpeg model; no commercial or copyleft ambiguity is silently accepted. |

Decision rules:

- `GO`: Q1-Q6 pass on macOS ARM and the design contains no unresolved data-loss or licensing boundary.
- `CONDITIONAL_GO`: Q1, Q2, Q3, and Q5 pass, while Q4, Q6, or cross-platform evidence is bounded by a named owner and concrete follow-up gate; background-music-only scope remains viable but implementation is not yet admitted.
- `NO_GO`: Q1 or Q5 fails, WaveSurfer requires renderer-side full decode for the target case, licensing is unacceptable, or safe cancellation/cleanup cannot be demonstrated.
- `INCONCLUSIVE`: the three-day time box expires without enough evidence. This is not authorization to implement.

---

### Task 1: Freeze the baseline and evidence contract

**Files:**

- Create: `docs/design/creative-studio-audio-discovery.md`
- Create: `spikes/creative-studio-audio/README.md`
- Create: `spikes/creative-studio-audio/package.json`
- Create: `spikes/creative-studio-audio/tsconfig.json`
- Create: `spikes/creative-studio-audio/vitest.config.ts`
- Create: `spikes/creative-studio-audio/src/evidence.ts`
- Test: `spikes/creative-studio-audio/tests/evidence.test.ts`

**Interfaces:**

- Produces: `AudioSpikeCaseResult`, `AudioSpikeEnvironment`, and `writeEvidenceRow()` used by every later task.

```ts
type AudioSpikeStatus = 'PASS' | 'FAIL' | 'UNVERIFIED';

type AudioSpikeCaseResult = {
  caseId: string;
  questionId: 'Q2' | 'Q3' | 'Q4' | 'Q5';
  fixtureId: string;
  status: AudioSpikeStatus;
  durationMs: number;
  metrics: Record<string, number | string | boolean>;
  failureCode?: string;
};

type AudioSpikeEnvironment = {
  baselineSha: string;
  os: string;
  arch: string;
  bunVersion: string;
  chromiumVersion: string;
  ffmpegVersion: string;
  ffprobeVersion: string;
  wavesurferVersion: '7.12.6';
};

declare function writeEvidenceRow(result: AudioSpikeCaseResult): Promise<void>;
```

- [ ] Record the literal baseline SHA, branch, dirty paths, date, OS/architecture, Bun version, FFmpeg/ffprobe version, and the failed/successful remote-refresh result at the top of `docs/design/creative-studio-audio-discovery.md`. Do not clean or alter unrelated worktree files.
- [ ] Add sections to the findings document for scope, current audio behavior, candidate inventory, Q1-Q6 results, raw metric tables, failures, decision, proposed production boundary, estimated delivery size, and unresolved human/legal gates.
- [ ] Make the spike `package.json` private and pin `wavesurfer.js` to exactly `7.12.6`; use existing root-compatible versions of React, Vite, Vitest, and Playwright without modifying the root manifests.
- [ ] Implement `writeEvidenceRow()` to accept only the declared fields and append JSON Lines beneath `spikes/creative-studio-audio/results/`. Reject absolute paths, filenames supplied by a user, free-form logs, and unknown keys.
- [ ] Test that evidence accepts bounded numeric/string metrics and rejects `/Users/example/file.mp3`, `C:\\Users\\example\\file.mp3`, unknown properties, and values longer than 256 characters.
- [ ] Run:

```bash
bun install --cwd spikes/creative-studio-audio
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/evidence.test.ts
```

Expected: the local spike lock resolves exact versions, the evidence test passes, and neither root manifest nor root lockfile changes.

- [ ] Commit only the spike scaffold and empty findings structure as `test(studio): scaffold bounded audio discovery` on the investigation branch.

### Task 2: Model the product boundary without editing the product schema

**Files:**

- Modify: `docs/design/creative-studio-audio-discovery.md`
- Create: `spikes/creative-studio-audio/src/model.ts`
- Test: `spikes/creative-studio-audio/tests/model.test.ts`

**Interfaces:**

- Produces: a disposable model used to prove invariants, not a proposed production API.

```ts
type SpikeAudioAsset = {
  id: string;
  mimeType: 'audio/mpeg' | 'audio/mp4' | 'audio/wav';
  byteSize: number;
  durationSeconds: number;
  sha256: string;
};

type SpikeAudioClip = {
  id: string;
  assetId: string;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
};

type SpikeAudioTrack = {
  id: string;
  role: 'music';
  muted: boolean;
  clip: SpikeAudioClip | null;
};
```

- [ ] Write model tests proving one music clip cannot reference a missing asset, exceed its source duration, start before zero, have negative fades, have fades longer than the placed clip, or use non-finite gain/timing values.
- [ ] Add tests for missing-on-reload, replace, mute, and delete behavior. A missing asset must preserve the project decision as a recoverable broken reference; it must not silently clear or substitute music.
- [ ] Add a revision-conflict example showing that a stale audio edit is rejected without changing either the existing cut or soundtrack decision.
- [ ] Compare two production shapes in the findings document: widening `StudioMediaKind` versus adding a separate audio asset boundary. Mark widening `StudioMediaKind` rejected for v1 if it would enter image/video generation routing, take selection, poster, reference, or render-output assumptions.
- [ ] Run:

```bash
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/model.test.ts
```

Expected: all invariants pass without importing any module from `packages/desktop/src`.

- [ ] Record Q1 as `PASS`, `FAIL`, or `UNVERIFIED` with the exact rejected alternatives; commit as `docs(studio): define audio spike ownership boundary`.

### Task 3: Generate bounded synthetic fixtures

**Files:**

- Create: `spikes/creative-studio-audio/scripts/generate-fixtures.ts`
- Create: `spikes/creative-studio-audio/src/fixtures.ts`
- Test: `spikes/creative-studio-audio/tests/fixtures.test.ts`

**Interfaces:**

- Produces: `AudioFixtureManifest` with randomized relative names, hashes, probed stream facts, and expected durations.

```ts
type AudioFixtureManifest = {
  rootCaseId: string;
  fixtures: Array<{
    fixtureId: string;
    relativeName: string;
    container: 'mp3' | 'm4a' | 'wav' | 'mp4';
    durationSeconds: number;
    byteSize: number;
    sha256: string;
    hasBaseAudio: boolean;
  }>;
};
```

- [ ] Generate deterministic tone-plus-pulse audio at 48 kHz for 30 seconds, 3 minutes, 10 minutes, and 30 minutes. Produce compressed MP3 and M4A for every duration and WAV only for 30 seconds and 10 minutes so total fixture size stays below 750 MiB.
- [ ] Generate 30-second and 10-minute H.264/AAC base videos with a pulse at every whole second, equivalent silent base videos, a malformed `.mp3`, and a valid file whose extension disagrees with its probed container.
- [ ] Probe every valid fixture using ffprobe and reject the manifest if codec, channel count, sample rate, duration tolerance, hash, or total byte cap differs from the declared facts.
- [ ] Ensure cleanup accepts only the exact randomized root returned by the fixture factory, refuses symlink roots, and runs from `finally` after success, failure, timeout, and cancellation.
- [ ] Run:

```bash
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/fixtures.test.ts
bunx tsx spikes/creative-studio-audio/scripts/generate-fixtures.ts --verify-only
```

Expected: valid fixtures probe successfully; malformed/mismatched cases are classified; the byte cap and cleanup guards pass.

- [ ] Commit as `test(studio): add synthetic audio spike fixtures`.

### Task 4: Test streaming peak extraction and waveform UI

**Files:**

- Create: `spikes/creative-studio-audio/src/peaks/extractPeaks.ts`
- Create: `spikes/creative-studio-audio/src/peaks/types.ts`
- Create: `spikes/creative-studio-audio/src/ui/WaveformHarness.tsx`
- Create: `spikes/creative-studio-audio/src/ui/main.tsx`
- Create: `spikes/creative-studio-audio/index.html`
- Create: `spikes/creative-studio-audio/vite.config.ts`
- Create: `spikes/creative-studio-audio/playwright.config.ts`
- Create: `spikes/creative-studio-audio/scripts/measure-waveform.ts`
- Test: `spikes/creative-studio-audio/tests/extractPeaks.test.ts`
- Test: `spikes/creative-studio-audio/tests/waveform.e2e.ts`

**Interfaces:**

```ts
type AudioPeaks = {
  durationSeconds: number;
  sampleRate: 8_000;
  channels: Array<{ min: number[]; max: number[] }>;
};

declare function extractPeaks(inputPath: string, options: {
  ffmpegPath: string;
  maxBinsPerChannel: 4_000;
  timeoutMs: number;
}): Promise<AudioPeaks>;
```

- [ ] Implement the spike extractor by spawning FFmpeg to emit mono signed 16-bit PCM at 8 kHz to stdout and reducing chunks incrementally into min/max bins. Never accumulate the PCM stream in a single `Buffer` or decode it in the browser.
- [ ] Test exact bin count, min/max bounds, deterministic output hash, malformed input, timeout, killed process, and 30-minute input. Sample process RSS before extraction and at 100 ms intervals; record peak delta.
- [ ] Render WaveSurfer.js using only `AudioPeaks` plus declared duration. Add one draggable region representing the music source trim and emit bounded seek/region-change events without storing WaveSurfer objects in project state.
- [ ] Run Chromium measurements for 3-, 10-, and 30-minute MP3/M4A fixtures. Record peak-extraction wall time/RSS, first-interactive time, renderer RSS delta, region timing, seek timing, and whether reloading persisted spike JSON recreates the same region to within 1 ms.
- [ ] If the 30-minute case misses either Q2 or Q3, spend at most four hours on one comparison: Peaks.js with precomputed data or a minimal Canvas min/max renderer. Do not evaluate a full editor framework.
- [ ] Run:

```bash
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/extractPeaks.test.ts
bunx playwright test --config spikes/creative-studio-audio/playwright.config.ts spikes/creative-studio-audio/tests/waveform.e2e.ts --reporter=list
bunx tsx spikes/creative-studio-audio/scripts/measure-waveform.ts
```

Expected: each case writes one bounded Q2/Q3 row; threshold misses are `FAIL`, not warnings.

- [ ] Record Q2/Q3 and the WaveSurfer license/package-integrity evidence; commit as `test(studio): measure bounded audio waveform path`.

### Task 5: Measure media-element plus Web Audio preview synchronization

**Files:**

- Create: `spikes/creative-studio-audio/src/preview/AudioPreviewClock.ts`
- Create: `spikes/creative-studio-audio/src/ui/SyncHarness.tsx`
- Create: `spikes/creative-studio-audio/scripts/measure-sync.ts`
- Test: `spikes/creative-studio-audio/tests/previewClock.test.ts`
- Test: `spikes/creative-studio-audio/tests/sync.e2e.ts`

**Interfaces:**

```ts
type PreviewClockState = 'idle' | 'playing' | 'paused';

interface AudioPreviewClock {
  play(videoTimeSeconds: number): Promise<void>;
  pause(videoTimeSeconds: number): void;
  seek(videoTimeSeconds: number): void;
  setGainDb(gainDb: number): void;
  getExpectedTrackTime(videoTimeSeconds: number): number | null;
  dispose(): Promise<void>;
}
```

- [ ] Implement a spike-only controller with an `HTMLVideoElement` as the authoritative cut clock and an `HTMLAudioElement` connected through `MediaElementAudioSourceNode` and `GainNode`. Set the audio element's source offset on play/seek, correct drift only when the measured threshold is exceeded, and never decode the complete music file into an `AudioBuffer` or use `setTimeout` as the playback clock.
- [ ] Unit-test play, pause, resume, seek before/inside/after the music interval, gain changes, source end, threshold-based drift correction, repeated disposal, and browser autoplay refusal before user gesture.
- [ ] In Chromium, compare expected music position against video `currentTime` every 250 ms during a real-time 10-minute run. Exercise play at zero, pause/resume near 120 seconds, and seeks to 30, 300, and 590 seconds.
- [ ] Record p50, p95, and maximum absolute skew plus recovery time after every control action. Repeat three times on AC power with the app foregrounded; do not average away a failed run.
- [ ] If the media-element controller fails Q4, spend at most four hours repeating the identical harness with Tone.js Transport. Reject Tone.js for the target case if it requires complete 10- or 30-minute renderer-side decode; adopt it as the spike recommendation only if all three repeated runs pass the same memory and skew gates and the additional dependency/license/bundle cost is recorded.
- [ ] Run:

```bash
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/previewClock.test.ts
bunx playwright test --config spikes/creative-studio-audio/playwright.config.ts spikes/creative-studio-audio/tests/sync.e2e.ts --reporter=list
bunx tsx spikes/creative-studio-audio/scripts/measure-sync.ts --duration-seconds 600 --runs 3
```

Expected: three distinct Q4 evidence rows; backgrounded, throttled, interrupted, or shortened runs are `UNVERIFIED`.

- [ ] Record Q4 and whether Tone.js was needed; commit as `test(studio): measure audio preview synchronization`.

### Task 6: Prove the second-pass FFmpeg mix boundary

**Files:**

- Create: `spikes/creative-studio-audio/src/mix/buildMixArgs.ts`
- Create: `spikes/creative-studio-audio/src/mix/runMix.ts`
- Create: `spikes/creative-studio-audio/scripts/measure-mix.ts`
- Test: `spikes/creative-studio-audio/tests/buildMixArgs.test.ts`
- Test: `spikes/creative-studio-audio/tests/mix.integration.test.ts`

**Interfaces:**

```ts
type SpikeMixRequest = {
  baseVideoPath: string;
  musicPath: string;
  timelineStartSeconds: number;
  sourceInSeconds: number;
  sourceOutSeconds: number;
  gainDb: number;
  fadeInSeconds: number;
  fadeOutSeconds: number;
  outputPath: string;
};

type SpikeMixResult = {
  status: 'rendered' | 'cancelled';
  elapsedMs: number;
  outputPath?: string;
};
```

- [ ] Generate arguments as an array passed to `spawn`, never a shell string. Use a second pass over the already-concatenated base video; copy its video stream when compatible and create one final AAC 48 kHz stereo stream.
- [ ] Apply source trim, PTS reset, timeline delay, fade-in/out, user gain, and `amix` with output duration bound to the base video. Compare fixed-gain plus final limiter against two-pass `loudnorm`; record render factor, integrated loudness, loudness range, and true/sample peak.
- [ ] Cover the matrix: base with audio, silent base, music shorter than video, music longer than video, delayed music, trimmed music, muted music, zero-length intersection, malformed input, extension/container mismatch, cancellation, timeout, and output-path collision.
- [ ] Assert output duration within `1/30` second of the base video, exactly one video and one audio stream, AAC 48 kHz stereo, sample peak at or below -1 dBFS, no overwrite of an existing output, and no partial output after cancel/failure.
- [ ] Test cleanup with a neighboring sentinel file and directory. Cleanup must remove only the exact randomized spike directory and preserve both sentinels.
- [ ] Run:

```bash
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/buildMixArgs.test.ts
FFMPEG_PATH="${FFMPEG_PATH:-ffmpeg}" bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts spikes/creative-studio-audio/tests/mix.integration.test.ts
bunx tsx spikes/creative-studio-audio/scripts/measure-mix.ts
```

Expected: every matrix row has probed stream/duration/peak facts; unsupported encoders or unavailable FFmpeg produce `UNVERIFIED` rather than falling through to pass.

- [ ] Record Q5 and the chosen mix policy, including why the rejected policy lost; commit as `test(studio): prove bounded soundtrack mix pass`.

### Task 7: Apply licensing, cross-platform, and decision gates

**Files:**

- Modify: `docs/design/creative-studio-audio-discovery.md`
- Modify: `spikes/creative-studio-audio/README.md`

- [ ] Record primary-source license evidence for WaveSurfer.js, any fallback candidate actually executed, Tone.js only if executed, and FFmpeg. Separate using a JavaScript library from bundling a native binary; do not infer legal approval from an SPDX identifier.
- [ ] Ask the legal/packaging owner to classify: WaveSurfer BSD-3 notices; system-FFmpeg invocation; future FFmpeg bundling; codec configuration; attribution placement. Until answered, record Q6 as `UNVERIFIED` and identify the human owner.
- [ ] Repeat the Q2/Q3/Q5 harness on Windows x64 using the same spike commit and exact dependency lock. Repeat Q4 only if a foreground 10-minute browser run is operationally feasible. Record platform absences explicitly.
- [ ] Fill every findings table cell with `PASS`, `FAIL`, `UNVERIFIED`, or `NOT_RUN_OUT_OF_SCOPE`. Remove raw logs and retain only sanitized JSONL aggregates, exact commands, environment versions, and failure codes.
- [ ] Apply the decision rules mechanically and write exactly one top-level decision: `GO`, `CONDITIONAL_GO`, `NO_GO`, or `INCONCLUSIVE`.
- [ ] If the result is `GO` or `CONDITIONAL_GO`, propose—but do not write—one later implementation slice with these boundaries: background music only; separate audio assets; one music track/clip; waveform as a projection; native Web Audio unless Q4 selected Tone.js; second-pass FFmpeg mix; feature flag retained; explicit missing-asset recovery.
- [ ] Estimate that later slice as a range with assumptions and identify independent gates for schema/storage, preview UX, render integration, accessibility/i18n, packaging/legal, and packaged cross-platform acceptance. Do not convert the estimate into a Sprint 3 commitment.
- [ ] Run final spike verification:

```bash
bunx vitest run --config spikes/creative-studio-audio/vitest.config.ts
bunx playwright test --config spikes/creative-studio-audio/playwright.config.ts --reporter=list
git diff --check
git diff --name-only -- packages resources package.json bun.lock
```

Expected: spike tests report exact outcomes; `git diff --check` is clean; the production-path diff command prints nothing.

- [ ] Commit the completed evidence as `docs(studio): conclude audio track discovery`. Do not merge the branch or open a delivery MR without a separate user decision.

## Final Acceptance

- The investigation stops within three engineer-days and reports negative or inconclusive evidence honestly.
- No production source, schema, IPC, dependency manifest, lockfile, packaged resource, or existing Studio test changes.
- The current Sprint 3 Creative Studio lanes remain unchanged.
- Q1-Q6 have an evidence-backed status and exact stop condition.
- Long-audio waveform memory, real-time preview skew, export duration/stream shape, peak safety, cancellation, cleanup, dependency license, and platform gaps are visible.
- The document contains one mechanical decision and, only if admissible, a bounded follow-up slice proposal.
- Prototype success is not described as an implemented feature, production acceptance, packaging acceptance, or release approval.
