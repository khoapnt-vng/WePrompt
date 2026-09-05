# The film export — one file, with transitions

**Date:** 2026-08-23 · **Updated:** 2026-09-05 · **Status:** implemented
**Related:** [direction and answers §6](../prds/creative-studio/creative-studio-3-direction-and-answers.md) ·
[watching commission](creative-studio-3-watching-commission.md) ·
[bug list](../prds/creative-studio/creative-studio-3-bug-list.md)

## What this reverses, and why that is allowed now

§6 of _Direction and Answers_ originally ruled this out in terms:

> `ONE FILE · STITCHED WITH THE BED` — Not in v1. It is ffmpeg-class concat + mix + fade work with
> **no implementation owner**, so the option is hidden. V1 offers the editor folder, still, and
> on-demand script exports; **it never shows a control that fails**.

Those records explain why the control was originally absent. The one-file `film` export is now
owner-approved and implemented, superseding that earlier delivery decision.

That reversal is legitimate because **the stated reason was the absence of an owner, not a technical
veto.** Nothing in §6 argues the work is wrong; it records that nobody then owned the work.

The second half of the ruling is carried forward for known toolchain availability: the control must
not be shown when Main already knows the local encoder contract is unavailable. Runtime media, disk,
and authority failures remain explicit after invocation.

## Implemented decision record

The implementation keeps the project at schema 5 and versions the film artifact facts independently.
It does not mutate the project, initiate generation, or spend. Main captures the exact project and
catalog revisions plus source-asset/hash expectations before rendering; renders outside those locks;
fully re-proves the
same authority before publication; and publishes exactly one verified `film.mp4` stream. A stale or
cancelled render publishes nothing.

Every Shot or generated slate is normalized to MP4/H.264 High Profile Level 4.2 using a proved local
hardware encoder, BT.709 limited-range color, 24 fps, yuv420p, square pixels and
contain-with-black-padding at the project geometry. Output readback proves the container, codec,
profile, level, color, geometry, rate, pixel/sample layout, complete decode, duration, inode, size and
hash. The command contract additionally freezes a 48-frame GOP, 1/24000 video track time base, either
8 or 12 Mbps according to output size, stripped metadata/chapters, and no fast-start; those commanded
parameters are persisted as artifact facts.

Audio is AAC, 48 kHz stereo fltp at 192 kbps. Silent takes and slates receive synthesized silence.
Without a bed, take gain is 1. With a bed, take gain is 0.85, bed gain is 0.2, the bed is trimmed to
rendered duration and receives a bounded two-second triangular fade. Dissolves crossfade take audio
with triangular curves. The final mix uses a 0.95 latency-compensated limiter.

Tail detection samples the final second after authored trims at 8 fps, scales and pads to 160x90 gray,
and compares mean absolute frame deltas against 1.25. It requires at least three quiet deltas, removes
at most one second on a 24-fps boundary, preserves at least one second plus any required dissolve, and
never trims the final generated Shot even when a slate follows it. Exact source cut points, hashes,
normalized durations, transition facts, encoder facts and audio facts are persisted on the artifact.

Film probes the finalized source again before rendering. Exact video-stream ticks take precedence,
then a direct stream duration, then the WebM `DURATION` tag; the container duration remains the
compatibility fallback when a supported file exposes no video-stream endpoint. The decoded video
endpoint clamps the timeline's requested endpoint without cloning a final frame. A current
audio/container tail inside the requested interval may exceed video by at most 0.125 seconds; a larger
gap remains `invalid_media` rather than being hidden as ordinary mux skew.

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

### Artifact facts — resolved decision

`StudioExportArtifactV2` now has a discriminated `film` branch whose independently versioned Film
facts record nominal and rendered duration, exact render parameters, source facts and derived tail cut
points. Facts schema 2 keeps three Shot endpoints distinct: `sourceOutSeconds` is the requested
timeline endpoint retained in nominal duration, `effectiveSourceOutSeconds` is the decoded endpoint
used by Film, and `renderedSourceOutSeconds` is the endpoint after optional quiet-tail removal. The
renderer projection carries the safe film summary needed by the UI, and persisted schema-1 facts
remain readable. These facts live in the catalog rather than only in MP4 metadata, so each artifact
can explain its own duration without changing project schema 5.

## The export

The fourth shape beside `editor_folder` / `still` / `script` is `film`.

`nativePayloadSchemas.test.ts:2069` deliberately asserts that `stitched`, `video`
and `project` are **rejected** as shape names; `film` is not reserved. Note the renderer already binds
`const film = buildCutFilmSummary(...)` in `Cut/index.tsx:242`, so the card's local identifiers need
distinct names.

### Request — implemented contract

```ts
| { projectId: string; expectedRevision: number; expectedCatalogRevision: number;
    renderId: string;
    shape: 'film';
    transition: { kind: 'cut' } | { kind: 'dissolve'; seconds: number };
    trimTails: boolean }
```

`transition` and `trimTails` are render parameters carried on the request. They are **not persisted
to the project**. Two exports of the same revision with different transitions are two artifacts of
one film, which is exactly what the retention model already expresses.

The landed strict request boundary requires every key shown above; unknown, missing and unsupported
values are rejected rather than accepted or defaulted. The renderer dialog initializes its controls
to `{ kind: 'cut' }` and `trimTails: false` before sending the exact request.

### Coverage

Reuse `editor_folder`'s authoritative **classification**, not its payload:

- every active Shot with a canonical selected video contributes that trimmed video
- every uncovered active Shot whose `videoAssetId` is null contributes its own timed slate using the
  Shot duration
- a Beat with exactly **zero active Shots** contributes a timed slate for its non-null target seconds

Corrupt, unverifiable, stale or noncanonical selected media fails closed instead of being reclassified
as uncovered. The shared editor-folder slate payload is one PNG; the film renderer turns each slate
entry into a timed, normalized video segment with synthesized silence. Slate coverage is therefore not
limited to structurally empty Beats.

### Audio contract — resolved decision

The approved export reverses `ONE FILE · STITCHED WITH THE BED` and mirrors `editor_folder` coverage,
whose timeline includes the selected bed and its end fade. The old non-goal that declined to decide
how take audio and bed combine contradicted that promise.

The implementation freezes one deterministic export-time rule for:

- whether take audio is preserved or muted
- whether the selected bed is included, and its gain/mix rule
- silence synthesis for silent takes and slates
- output sample rate, channel layout and codec
- whether a dissolve crossfades take audio
- bed trim and fade against the **rendered** duration, which can be shorter than the nominal film

This does not pull narration, ducking controls or the wider audio lane into scope. It owns only the
media already present in the film being exported; the exact values are recorded above and on each
artifact.

### The ffmpeg graph — resolved decision

Thirty measured clips were h264 720p24 / AAC 44.1 stereo. That is useful evidence about one sample,
not an accepted-media contract. `StudioAssetV2` persists no codec/profile, frame rate, pixel format,
time base or audio-stream facts; managed video accepts MP4 and WebM, and valid provider routes return
both silent and audible takes. Authored `sourceInSeconds` / `sourceOutSeconds` trims must also be
honored.

Raw concat-demuxer `-c copy` therefore cannot be the general straight-cut graph:

- it cannot combine the generated PNG slate with video streams
- it cannot guarantee frame-accurate non-keyframe source trims
- it cannot safely concatenate heterogeneous codec, geometry, timing or audio layouts

The design considered:

1. normalize every Shot and slate to one explicit A/V segment contract, then concatenate those
   segments; or
2. define a narrow, probe-proved stream-copy eligibility contract, exact trim behavior and honest
   omission/refusal rules for slates and incompatible media.

The implementation chooses the first answer and proves a supported hardware encoder before exposing
the action. The normalized contract freezes the container and codecs, encoder, geometry and scaling
policy, frame rate and time base, pixel format, keyframe policy and muxing flags listed above.

Dissolves still need `xfade` (video) and, if the audio contract calls for it, `acrossfade` (audio).
ffmpeg 8.1.2 on the build host was measured to carry `xfade` (58 transition types), `acrossfade`,
`fade` and `afade`. The landed graph normalizes every segment and synthesizes required silence before
chaining pairwise at offset `Σd₀..dₖ − (k+1)·D`; it proves `0 < D` and that `D` is shorter than each
adjacent post-trim segment. Only `dissolve` is exposed; the other transition modes remain out of scope.

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

The landed detector samples the final second and cuts back to where mean frame-to-frame difference
rises above the frozen floor. Tests cover:

- decoded frame format and scale, sample cadence, numeric metric and threshold
- maximum removable tail and minimum remaining segment duration
- timestamp and output-time-base rounding
- application after the Shot's authored trim-in/trim-out
- interaction with dissolve duration and boundary eligibility
- the meaning of "final Shot" when the final film segment is a slate, including whether the last
  generated Shot before it is protected

The derived cut points and rendered duration are artifact facts. `curl_happy` — the measured ending —
settles deliberately, so the rule remains bounded and never trims the protected final Shot.

## When ffmpeg is missing

The §6 availability constraint remains load-bearing. Binary resolution is centralized, missing tools
have typed unavailable results, and capability discovery inventories every required graph component
before the Film action is shown.

A resolved executable is not enough evidence to show the Film card. Main probes the exact
ffmpeg/ffprobe pair and the protocols, demuxers, muxers, filters and encoders selected by the settled
render contract. It then executes a small encoder/container/basic-A/V smoke and strictly reads back
that output; the complete filter graph is proved by an actual render. The UI consumes this capability
result and keeps the card absent whenever the proof fails; `createExport` rechecks it and returns a
typed unavailable or unsupported-capability error so a binary replacement between discovery and
invocation is not misreported as bad media.

### Landed prerequisite

Commit `c7d74e1a6` fixed the seekable-input prerequisite independently: all three inherited
ffprobe/ffmpeg inputs in `mediaStore.ts` now use descriptor 3 through `-fd 3 -i fd:`, matching
`conditioningFrame.ts`, with exact regression coverage. The ffmpeg progress channel on descriptor 1
remains a pipe intentionally. This work is complete and is not part of the film implementation
slices below.

### Supervised child lifecycle

All Creative Studio ffmpeg/ffprobe children now use bounded diagnostics, finite deadlines,
process-tree termination and deterministic settlement of every inherited descriptor. The
conditioning-frame extractor and film renderer additionally accept `AbortSignal` cancellation because
they are user-cancellable jobs; the short import/probe helpers are deadline-bounded but are not exposed
as cancellable jobs. A timeout, abort, stream error or child error remains a failure even if a later
process close event reports success.

Verified-stream acquisition and iterator release are settlement fences: cancellation does not abandon
an opener or lease that Main cannot yet prove closed, so a stalled provider can delay the public
result. Publishing itself is non-cancellable once catalog authority is entered. These choices prevent
descriptor leaks and half-published artifacts rather than silently substituting a timeout result.

## Render ownership, authority and temporary output — resolved decision

`createExport` currently keeps its `withProjectAuthorityV2` callback open through payload construction
and catalogue publication; the catalogue store takes its own lock only during publication. That is
appropriate for the current short, in-memory builders. Placing a long ffmpeg spawn in the payload
builder would hold project authority for the duration of an external process, even before the
catalogue lock is needed.

The film path uses a main-owned, cancellable local job with a private temporary workspace. Its
contract preserves the frozen authority rules in this order:

1. Capture project/catalog revisions and exact source expectations under project authority.
2. Resolve and stage verified streams, then render outside project/catalogue locks.
3. Enforce output-size, disk, time, cancellation and disposal bounds while the job is alive.
4. Prove the completed output is a no-follow regular, single-link inode and record its size and SHA-256.
5. Re-enter the project queue and then the catalogue lock; reprove the active project/revision, source
   media expectations, catalogue compare-and-swap state and retained-capacity bounds.
6. Publish the exact proved bytes or classify the job as stale and clean up without changing the
   catalogue.
7. Delete only the same owned temporary inode; if the path has been replaced, preserve the
   replacement and report cleanup failure.

The job API freezes progress and bounded child-process cancellation; the settlement fences above may
delay completion. Project or catalog change makes the result stale and prevents publication.
`verified_stream` is the catalogue ingress shape, backed by this ownership and lifecycle contract.

## Export plumbing — the inventory

The landed `STUDIO_EXPORT_SHAPES` inventory includes `film` as its strict fourth member and is reused
across native types, service/catalog validation, bridge validation, renderer validation, retention and
capacity arithmetic. `StudioExportPayloadFilePlanV2` admits `verified_stream`:
`{ relativePath, byteSize, sha256, openVerifiedStream: () => Promise<AsyncIterable<Uint8Array>> }`.
The film enters through that existing plan kind after the temporary-file lifecycle above proves its
exact descriptor, size and digest; the opener never re-resolves an attacker-replaceable path.

`studioI18n.test.ts:924` asserts **exact set equality** of the en-US workspace key inventory, so the
Film-card keys landed with the code that references them rather than as later cleanup.

## Landed slices

0. **Seekable inherited inputs — complete.** Commit `c7d74e1a6` moved the three `mediaStore.ts`
   descriptor-3 inputs to seekable `fd:` URLs and added regressions. It stays an independent repair.
1. **Resolver and capability readiness — complete.** ffmpeg/ffprobe resolution is centralized and the
   exact protocols, demuxers, muxers, filters and hardware encoder are probed before the UI is shown.
2. **Supervised child lifecycle — complete.** Existing media calls and film rendering share bounded
   deadlines, diagnostics, tree termination and descriptor settlement; cancellable jobs also carry an
   `AbortSignal`, as described above.
3. **Private render job and temporary lease — complete.** Authority capture, full source reproof,
   progress, cancellation, resource bounds and exact-inode cleanup are enforced in Main. A bounded
   in-memory terminal map supports renderer remount/reload until explicit acknowledgement (one result
   per project, at most 32 projects); app/Main restart preserves published catalog artifacts but not
   failed or cancelled terminal notifications.
4. **Base `film`, straight cuts — complete.** `film` is a strict fourth export shape with one normalized
   MP4 file and versioned artifact facts.
5. **Dissolve — complete.** The request admits only cut or the bounded dissolve, with paired video and
   audio transitions and exact rendered-duration facts.
6. **`trimTails` — complete.** Tail trimming is deterministic, artifact-recorded, render-time only and
   never mutates or invalidates the project.

## Non-goals

- **No transition state in the project.** Stated above and load-bearing.
- **No reconciliation with `targetDurationSeconds`.** A dissolved export is shorter by design; the
  delta pill keeps describing the authored film.
- **No transition menu.** Dissolve or cut.
- **No audio-lane expansion.** Narration, voice generation, user-authored gains and ducking remain
  separate. The film export owns only its deterministic rule for existing take audio and the selected
  bed.
- **The Cut keeps its clip-by-clip player.** A rendered film is a snapshot; the Cut is derived live
  from the projection and must stay that way, or every edit would invalidate the thing being watched.
  BUG-118's prefetch fix is still the right fix for playback smoothness.
