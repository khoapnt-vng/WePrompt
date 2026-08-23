# The film export — one file, with transitions

**Date:** 2026-08-23 · **Updated:** 2026-08-24 · **Status:** proposed; seekable-FD prerequisite complete
**Related:** [direction and answers §6](../prds/creative-studio/creative-studio-3-direction-and-answers.md) ·
[watching commission](creative-studio-3-watching-commission.md) ·
[bug list](../prds/creative-studio/creative-studio-3-bug-list.md)

## What this reverses, and why that is allowed now

§6 of _Direction and Answers_ ruled this out in terms:

> `ONE FILE · STITCHED WITH THE BED` — Not in v1. It is ffmpeg-class concat + mix + fade work with
> **no implementation owner**, so the option is hidden. V1 offers the editor folder, still, and
> on-demand script exports; **it never shows a control that fails**.

The MVP plan repeats it under "Explicitly out, and why", the watching commission states it to the
designer as a hard constraint, and the acceptance checklist requires the control be **absent**, not
disabled. This document proposes building it anyway.

That is legitimate for one reason and one reason only: **the stated reason was the absence of an
owner, not a technical veto.** Nothing in §6 argues the work is wrong; it argues nobody was going to
do it. That has changed.

The second half of the ruling is not reversed and is carried forward as a constraint: **the control
must never be present and failing.** Section _"When ffmpeg is missing"_ below is how that is honoured.

## What was asked for, and what was measured

Three assemblies of the same six-Shot cartoon were produced by hand and compared:

|                         | duration  | assembly                                        |
| ----------------------- | --------- | ----------------------------------------------- |
| raw                     | 24.4s     | six clips butt-joined, untouched                |
| trimmed                 | 22.4s     | dead tails cut, straight cuts                   |
| **trimmed + dissolved** | **20.6s** | 0.35s cross-dissolve at each of five boundaries |

The third was chosen. Both mechanisms are therefore in scope: **tail trimming and transitions.**

The pause that prompted this is not a playback defect. Motion measured as mean frame-to-frame pixel
change shows every clip decelerating to a near-still final frame — `gull_returns` ends at **0.14**
against a mid-clip **1.37**, and the tail is the lowest-motion segment in all six clips. The model
eases out; unchained Shots then cut hard from stillness to motion.

## The finding that determines the architecture

**A transition must never enter the project model.**

Every duration in Studio is butt-joined: the film is the arithmetic sum of Beat durations, a Beat is
the sum of its Shots' played durations. A cross-dissolve overlaps two clips, so the assembled length
stops equalling that sum — verified precisely: six clips totalling 22.33s with five 0.35s dissolves
predicted 20.58s and produced **20.59s**.

Studio checks that sum in at least four places with **bare `!==` and no epsilon**, and each one
**fails closed by returning `null`**:

```ts
coverageGeometry.ts:258      if (geometry.playbackTotalSeconds !== laneTotalSeconds) return null;
playbackSequence.ts:258      if (beatCursor !== beat.actualSeconds || beatCursor !== cutBeat.durationSeconds) return null;
playbackSequence.ts:269      projection.cut.filmDurationSeconds !== filmCursor
beatPlaybackSequence.ts:217  beat.actualSeconds !== beatCursor
```

Returning `null` means the Cut player, the Beat player and the coverage editor render **nothing** —
no error, no explanation. `CoverageBar.tsx:699` additionally disables the seek head on a disagreement
of more than 8 ULP, and `filmstrip.ts:32` fails the entire strip closed on one unusable Beat length.

So a `transitionSeconds` field on Shot or Beat would silently disable playback across the product.

**Therefore: transitions are a parameter of the render, not a property of the film.** The project's
arithmetic stays butt-joined and untouched. The exported file is shorter than the film's nominal
duration. That difference must become an export artifact fact rather than being reconciled against
`targetDurationSeconds`. Every gate above keeps passing because nothing upstream of them changes.

This also disposes of the delta-pill problem cleanly: the Cut keeps comparing the authored film
against its target, because that comparison is about the film, not about one exported rendering of it.

### Artifact facts — blocking decision

The current `StudioExportArtifactV2` and renderer projection carry shape, source revision, byte/count
facts and creation time. They carry **no duration or render parameters**. The sentence above is not
implementable until the catalog contract answers this explicitly.

Before `film` joins the shape union, define and version a discriminated film artifact that records at
least nominal duration, rendered duration and the exact render parameters. The later tail slice must
also preserve its derived cut points, or an artifact cannot explain or reproduce its own duration.
Existing three-shape catalogs must continue to exact-key parse after that change. Storing these facts
only inside MP4 metadata is insufficient because the current renderer catalog projection cannot read
them. If the catalog is not extended, delete the claim that the duration is stated on the artifact.

## The export

A fourth shape beside `editor_folder` / `still` / `script`.

**Name it `film`.** `nativePayloadSchemas.test.ts:2069` deliberately asserts that `stitched`, `video`
and `project` are **rejected** as shape names; `film` is not reserved. Note the renderer already binds
`const film = buildCutFilmSummary(...)` in `Cut/index.tsx:242`, so the card's local identifiers need
distinct names.

### Request — final target

```ts
| { projectId: string; expectedRevision: number; expectedCatalogRevision: number;
    shape: 'film';
    transition: { kind: 'cut' } | { kind: 'dissolve'; seconds: number };
    trimTails: boolean }
```

`transition` and `trimTails` are render parameters carried on the request. They are **not persisted
to the project**. Two exports of the same revision with different transitions are two artifacts of
one film, which is exactly what the retention model already expresses.

This is the final target, not the first slice's public contract. Strict request boundaries must expose
only behavior that exists:

- the base film slice accepts exact `{ projectId, expectedRevision, expectedCatalogRevision,
shape: 'film' }`
- the dissolve slice adds `transition`
- the tail slice adds `trimTails`

Until those later slices land, their keys and values are rejected rather than accepted and ignored.
When both exist, their defaults are `{ kind: 'cut' }` and `false`.

### Coverage

Reuse `editor_folder`'s **classification**, not its payload:

- a Beat with exactly **zero active Shots** contributes a slate for its non-null target seconds
  (`editorFolder.ts:232`, `createStudioBlackSlatePngV2`)
- a nonempty Beat with any active Shot whose canonical selected video is absent fails the whole export
  `coverage_incomplete` (`editorFolder.ts:247`)

Therefore only a structurally empty Beat can stand in. A planned Beat whose Shots have not been
generated cannot render as a slate. The existing slate payload is one PNG; a film renderer must turn
it into a timed, normalized video segment and define its audio track. This distinction is
load-bearing for both availability copy and the render graph.

### Audio contract — blocking decision

The proposal starts by reversing `ONE FILE · STITCHED WITH THE BED` and says coverage should mirror
`editor_folder`, whose timeline includes the selected bed and its end fade. The old non-goal that
declined to decide how take audio and bed combine contradicted that promise.

Before any film graph is implemented, choose one deterministic export-time rule for:

- whether take audio is preserved or muted
- whether the selected bed is included, and its gain/mix rule
- silence synthesis for silent takes and slates
- output sample rate, channel layout and codec
- whether a dissolve crossfades take audio
- bed trim and fade against the **rendered** duration, which can be shorter than the nominal film

This does not pull narration, ducking controls or the wider audio lane into scope. It owns only the
media already present in the film being exported. Until this rule is settled, neither cut nor dissolve
has a complete output contract.

### The ffmpeg graph — blocking decision

Thirty measured clips were h264 720p24 / AAC 44.1 stereo. That is useful evidence about one sample,
not an accepted-media contract. `StudioAssetV2` persists no codec/profile, frame rate, pixel format,
time base or audio-stream facts; managed video accepts MP4 and WebM, and valid provider routes return
both silent and audible takes. Authored `sourceInSeconds` / `sourceOutSeconds` trims must also be
honored.

Raw concat-demuxer `-c copy` therefore cannot be the general straight-cut graph:

- it cannot combine the generated PNG slate with video streams
- it cannot guarantee frame-accurate non-keyframe source trims
- it cannot safely concatenate heterogeneous codec, geometry, timing or audio layouts

Before implementation, choose between:

1. normalize every Shot and slate to one explicit A/V segment contract, then concatenate those
   segments; or
2. define a narrow, probe-proved stream-copy eligibility contract, exact trim behavior and honest
   omission/refusal rules for slates and incompatible media.

The intended general film feature requires the first answer. It also requires a real, shippable
encoder capability; the 30-clip measurement does not supply one. The normalized contract still has
to freeze its container and codecs, encoder/profile, geometry and scaling policy, frame rate and time
base, pixel format and color behavior, keyframe policy and muxing flags.

Dissolves still need `xfade` (video) and, if the audio contract calls for it, `acrossfade` (audio).
ffmpeg 8.1.2 on the build host was measured to carry `xfade` (58 transition types), `acrossfade`,
`fade` and `afade`. Chained pairwise, the proposed offset for boundary _k_ is
`Σd₀..dₖ − (k+1)·D`, but the graph must first normalize dimensions, frame rate, time base and pixel
format, synthesize any required silent tracks, and prove `0 < D` and `D` is shorter than each adjacent
post-trim segment. Only `dissolve` should be offered initially; the other 57 modes are a menu, not a
feature.

## Tail trimming — and a correction

**Trim is free only for the trimmed Shot.** The `Edge · Trim · Free` copy is true in the Beat panel's
local sense and misleading if reused here: trimming a Shot's **tail** invalidates the next Shot's
conditioning frame, marking it `continuity_stale` and requiring a **paid re-render of every downstream
Shot in that continuous segment**.

That is why the hand-trim of the cartoon cost nothing — six one-Shot Beats have no chain to
invalidate — and why the same operation on the paper-boat film would have triggered a cascade.

`trimTails` therefore operates **at render time on the exported copy only**. It never writes
`trim_shot`, never touches the project, and never invalidates a chain. A person who wants the trim
to be part of the film still does it in the Beat panel and pays what the chain costs.

The proposed detector samples the final second and cuts back to where mean frame-to-frame difference
rises above a floor. The measured separation is useful — 0.14–1.0 in dead tails against 3–30
mid-clip — but it does not yet define an algorithm.

Before `trimTails` enters the request, freeze and test all of these:

- decoded frame format and scale, sample cadence, numeric metric and threshold
- maximum removable tail and minimum remaining segment duration
- timestamp and output-time-base rounding
- application after the Shot's authored trim-in/trim-out
- interaction with dissolve duration and boundary eligibility
- the meaning of "final Shot" when the final film segment is a slate, including whether the last
  generated Shot before it is protected

The derived cut points and rendered duration must be artifact facts. `curl_happy` — the measured
ending — settles deliberately, so the rule remains bounded and never trims the protected final Shot.
Until the details above are settled, `trimTails` is absent from IPC and UI rather than accepted as a
no-op.

## When ffmpeg is missing

The §6 constraint that the product "never shows a control that fails" is load-bearing here, and the
remaining substrate cannot yet honour it:

- ffmpeg is used in exactly **four** places, all frame extraction or probing. There is **no concat,
  mux or encode path anywhere**.
- There is **no presence check, no readiness probe, and no typed `ffmpeg_unavailable` error**.
- Resolution is two ad-hoc functions in `mediaStore.ts` plus a third divergent default in
  `conditioningFrame.ts` — no resolver module.
- A missing binary is **misdiagnosed as bad media**: ENOENT surfaces as `decode_failed` on the frame
  path and `invalid_media` on the probe paths.

A resolved executable is not enough evidence to show the Film card. Main must probe the exact
ffmpeg/ffprobe pair and the protocols, demuxers, muxers, filters and encoders selected by the settled
render contract. The current build-host measurement is insufficient: the measured ffmpeg 8.1.2 has the
required filters, but the convenient prebuilt distributions and the LGPL/no-software-H.264 build do
not expose the same encoder set, and the Windows fallback is unmeasured. The UI consumes this
capability result and keeps the card absent; `createExport` rechecks it and returns a typed unavailable
or unsupported-capability error so a binary replacement between discovery and invocation is not
misreported as bad media.

### Landed prerequisite

Commit `c7d74e1a6` fixed the seekable-input prerequisite independently: all three inherited
ffprobe/ffmpeg inputs in `mediaStore.ts` now use descriptor 3 through `-fd 3 -i fd:`, matching
`conditioningFrame.ts`, with exact regression coverage. The ffmpeg progress channel on descriptor 1
remains a pipe intentionally. This work is complete and is not part of the film implementation
slices below.

### Remaining spawn defect

`conditioningFrame.ts` still has no timeout, process termination or `AbortSignal`. A stalled decoder
can hold its descriptors indefinitely, and a film render is a much longer-running child. Before a
render job ships, the existing media callers and the new renderer need one supervised-child contract:
bounded stderr/progress capture, timeout, cancellation, process-tree termination and deterministic
settlement of every inherited descriptor.

## Render ownership, authority and temporary output — blocking decision

`createExport` currently keeps its `withProjectAuthorityV2` callback open through payload construction
and catalogue publication; the catalogue store takes its own lock only during publication. That is
appropriate for the current short, in-memory builders. Placing a long ffmpeg spawn in the payload
builder would hold project authority for the duration of an external process, even before the
catalogue lock is needed.

The film path therefore needs a main-owned, cancellable local job with a private temporary workspace.
Its contract must preserve the frozen authority rules in this order:

1. Capture the project revision and exact source expectations under project authority.
2. Open verified source descriptors and render outside project/catalogue locks.
3. Enforce output-size, disk, time, cancellation and disposal bounds while the job is alive.
4. Prove the completed output is a no-follow regular, single-link inode and record its size and SHA-256.
5. Re-enter the project queue and then the catalogue lock; reprove the active project/revision, source
   media expectations, catalogue compare-and-swap state and retained-capacity bounds.
6. Publish the exact proved bytes or classify the job as stale and clean up without changing the
   catalogue.
7. Delete only the same owned temporary inode; if the path has been replaced, preserve the
   replacement and report cleanup failure.

Before implementation, freeze the job API (including progress and cancellation) and the stale-result
policy when the project or catalogue changes during rendering. `verified_stream` is a useful catalogue
ingress shape, not a substitute for this ownership and lifecycle contract.

## Export plumbing — the inventory

The shape union is a bare 3-member string literal (`creativeStudioTypes.ts:861`) with no const array
and no exhaustiveness helper. The same literals and the number three are repeated across the native
types, service/catalogue validation, bridge validation, renderer validation and UI. Adding a member
requires an explicit inventory; the type alone will not catch a missed boundary.

Three specific traps:

- `STUDIO_MAX_EXPORTS_PER_SHAPE * 3` appears in **three** validators (`exports/catalog.ts:425`,
  `creativeStudioBridge.ts:598`, `useStudioProject.ts:122`). A fourth shape makes every one of them
  wrong by a factor.
- The retention loop at `exports/catalog.ts:529` iterates a **literal array** independent of the union.
  Adding a shape to the type without adding it there evicts incorrectly.
- **The payload plan already supports this** — verified against
  `exports/catalog.ts:137`. `StudioExportPayloadFilePlanV2` admits `verified_stream`:
  `{ relativePath, byteSize, sha256, openVerifiedStream: () => Promise<AsyncIterable<Uint8Array>> }`.
  No new plan kind appears necessary. A rendered film can enter through it only after the temporary
  file lifecycle above is settled: the opener must not re-resolve an attacker-replaceable path, and
  catalogue ingestion must verify the exact output descriptor against the proved size and digest.

`studioI18n.test.ts:924` asserts **exact set equality** of the en-US workspace key inventory, so the
new card's keys move with the code that references them, never as a later cleanup.

## Slices

0. **Seekable inherited inputs — complete.** Commit `c7d74e1a6` moved the three `mediaStore.ts`
   descriptor-3 inputs to seekable `fd:` URLs and added regressions. It stays an independent repair.
1. **Resolver and capability readiness.** Centralize ffmpeg/ffprobe resolution, probe the exact
   required capabilities and give existing callers typed unavailable/capability failures. No Film
   card yet.
2. **Supervised child lifecycle.** Add timeout, cancellation, bounded diagnostics, process-tree
   termination and descriptor settlement to existing media calls before introducing a long render.
3. **Private render job and temporary lease.** Implement the authority/reproof, progress,
   cancellation, resource-bound and exact-inode cleanup contract with no public `film` shape yet.
4. **Base `film`, straight cuts.** Add the exact base request shape and all boundary/catalogue/i18n
   updates. Normalize every eligible take and generated slate to the settled video and audio contract,
   encode one MP4, record the settled artifact facts, and expose the card only when the capability
   probe passes.
5. **Dissolve.** Add `transition` to the request, the normalized `xfade`/audio transition graph and its
   duration/artifact facts. Do not widen the base slice implicitly.
6. **`trimTails`.** Add the request member and derived cut facts only after the bounded algorithm and
   final-segment policy are frozen. It remains render-time only and never mutates the project.

Slices 1 and 2 can proceed independently. Slices 3–6 are blocked until the normalized render, audio,
artifact-fact and job-lifecycle contracts called out above are decided; each slice remains one
irreducible behavior change.

## Non-goals

- **No transition state in the project.** Stated above and load-bearing.
- **No reconciliation with `targetDurationSeconds`.** A dissolved export is shorter by design; the
  delta pill keeps describing the authored film.
- **No transition menu.** Dissolve or cut.
- **No audio-lane expansion.** Narration, voice generation, user-authored gains and ducking remain
  separate. This plan must still own one deterministic export rule for existing take audio and the
  selected bed.
- **The Cut keeps its clip-by-clip player.** A rendered film is a snapshot; the Cut is derived live
  from the projection and must stay that way, or every edit would invalidate the thing being watched.
  BUG-118's prefetch fix is still the right fix for playback smoothness.
