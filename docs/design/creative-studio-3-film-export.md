# The film export — one file, with transitions

**Date:** 2026-08-23 · **Status:** proposed, not started
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
duration, and that is a fact stated on the artifact rather than reconciled against
`targetDurationSeconds`. Every gate above keeps passing because nothing upstream of them changes.

This also disposes of the delta-pill problem cleanly: the Cut keeps comparing the authored film
against its target, because that comparison is about the film, not about one exported rendering of it.

## The export

A fourth shape beside `editor_folder` / `still` / `script`.

**Name it `film`.** `nativePayloadSchemas.test.ts:2072` deliberately asserts that `stitched`, `video`
and `project` are **rejected** as shape names; `film` is not reserved. Note the renderer already binds
`const film = buildCutFilmSummary(...)` in `Cut/index.tsx:242`, so the card's local identifiers need
distinct names.

### Request

```ts
| { projectId: string; expectedRevision: number; expectedCatalogRevision: number;
    shape: 'film';
    transition: { kind: 'cut' } | { kind: 'dissolve'; seconds: number };
    trimTails: boolean }
```

`transition` and `trimTails` are render parameters carried on the request. They are **not persisted
to the project**. Two exports of the same revision with different transitions are two artifacts of
one film, which is exactly what the retention model already expresses.

Default `{ kind: 'cut' }` and `trimTails: false`, so the first release changes nothing about how a
film reads unless asked.

### Coverage

Mirror `editor_folder` exactly, because the rule is already right there:

- a Beat with **zero Shots** contributes a black slate for its target seconds
  (`editorFolder.ts:237`, `createStudioBlackSlatePngV2`)
- a covered Shot with `videoAssetId === null` fails the whole export `coverage_incomplete`
  (`editorFolder.ts:247`)

This means a film can be rendered before everything is generated, with slates standing in — which
matches the commission's line that an uncovered Beat is a slate lasting exactly its target seconds.

### The ffmpeg graph

Straight cuts use the concat demuxer with `-c copy`. Verified on 30 real clips: all takes are
h264 720p24 / AAC 44.1 stereo, so a stream copy is exact and costs no re-encode.

Dissolves need `xfade` (video) and `acrossfade` (audio), which forces a re-encode. Chained pairwise,
the offset for boundary _k_ is `Σd₀..dₖ − (k+1)·D`. ffmpeg 8.1.2 on the build host carries `xfade`
(58 transition types), `acrossfade`, `fade` and `afade`.

Only `dissolve` should be offered in v1. The other 57 `xfade` modes are a menu, not a feature.

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

Detection is mechanical: sample frames across the final second, compute mean frame-to-frame
difference, and cut back to where motion rises above a floor. The measured separation is wide —
0.14–1.0 in dead tails against 3–30 mid-clip.

**It must be bounded and it must not touch the last Shot.** `curl_happy` — the ending — settles
deliberately, and an aggressive trimmer would eat the resolution of the story.

## When ffmpeg is missing

The §6 constraint that the product "never shows a control that fails" is load-bearing here, and the
current substrate cannot honour it:

- ffmpeg is used in exactly **four** places, all frame extraction or probing. There is **no concat,
  mux or encode path anywhere**.
- There is **no presence check, no readiness probe, and no typed `ffmpeg_unavailable` error**.
- Resolution is two ad-hoc functions in `mediaStore.ts` plus a third divergent default in
  `conditioningFrame.ts` — no resolver module.
- A missing binary is **misdiagnosed as bad media**: ENOENT surfaces as `decode_failed` on the frame
  path and `invalid_media` on the probe paths.

So slice 1 is not the film — it is a resolver with a typed unavailable error, and a Film card that is
**absent** when ffmpeg cannot be resolved.

### Two live defects found while surveying, worth fixing first

**The BUG-104 `pipe:` trap is only half fixed.** `conditioningFrame.ts:267` uses the seekable
`-fd 3 -i fd:` form, but `mediaStore.ts:1052`, `:1105` and `:1190` still pass `pipe:3`. Same class of
bug, same failure mode on an MP4 whose `moov` follows its `mdat`.

**A hung ffmpeg hangs a chain forever.** `conditioningFrame.ts` has no timeout, no `kill()`, and no
`AbortSignal` — grep finds none. A stalled decoder holds its descriptors indefinitely. A film render
is a much longer-running spawn than a frame extraction, so this must be fixed before shipping one.

## Export plumbing — the inventory

The shape union is a bare 3-member string literal (`creativeStudioTypes.ts:854`) with no const array
and no exhaustiveness helper, so it is **duplicated as literals in six independent places**. Adding a
member requires touching all of them; the type will not catch a miss.

Three specific traps:

- `STUDIO_MAX_EXPORTS_PER_SHAPE * 3` appears in **three** validators (`exports/catalog.ts:424`,
  `creativeStudioBridge.ts:598`, `useStudioProject.ts:100`). A fourth shape makes every one of them
  wrong by a factor.
- The retention loop at `exports/catalog.ts:528` iterates a **literal array** independent of the union.
  Adding a shape to the type without adding it there evicts incorrectly.
- **The payload plan already supports this** — verified against
  `exports/catalog.ts:128`. `StudioExportPayloadFilePlanV2` admits `verified_stream`:
  `{ relativePath, byteSize, sha256, openVerifiedStream: () => Promise<AsyncIterable<Uint8Array>> }`.
  A rendered film fits it exactly: produce to a temp path, hash, hand back a stream opener. No new
  plan kind is needed. (An earlier draft of this document claimed otherwise and added a slice for it;
  that slice is deleted.)

`studioI18n.test.ts:904` asserts **exact set equality** of the en-US workspace key inventory, so the
new card's keys move with the code that references them, never as a later cleanup.

## Slices

1. **ffmpeg substrate.** A resolver module, a typed `ffmpeg_unavailable`, timeouts and kill on every
   spawn, and the `pipe:` → `-fd` fix in `mediaStore.ts`. No user-visible change except that a
   missing binary stops being reported as corrupt media.
2. **`film` shape, straight cuts only.** Concat demuxer, `-c copy`, staged to a temp path and handed
   to the catalogue as a `verified_stream` plan with cleanup on every exit path. Slate rule mirrored
   from `editor_folder`. Card absent when ffmpeg is unresolvable. **This slice alone delivers "the
   user gets one video file."**
3. **Dissolve.** `transition` on the request, `xfade` + `acrossfade`, re-encode path, dissolve only.
4. **`trimTails`.** Render-time only, bounded, never the final Shot, never writes to the project.

## Non-goals

- **No transition state in the project.** Stated above and load-bearing.
- **No reconciliation with `targetDurationSeconds`.** A dissolved export is shorter by design; the
  delta pill keeps describing the authored film.
- **No transition menu.** Dissolve or cut.
- **No audio mixing beyond crossfade.** Nothing in the codebase currently decides how take audio and
  the bed combine; that is a separate decision and this document does not pre-empt it.
- **The Cut keeps its clip-by-clip player.** A rendered film is a snapshot; the Cut is derived live
  from the projection and must stay that way, or every edit would invalidate the thing being watched.
  BUG-118's prefetch fix is still the right fix for playback smoothness.
