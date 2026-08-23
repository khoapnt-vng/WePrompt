# Removing takes — one Shot, one picture

**Date:** 2026-08-23 · **Status:** proposed, not started
**Related:** [bug list](../prds/creative-studio/creative-studio-3-bug-list.md) ·
[Beat panel model](../prds/creative-studio/creative-studio-3-beat-panel-model.md) ·
[chain handoff review](creative-studio-3-chain-handoff-review.md)

## The decision

A Shot has one picture. Generating again replaces it. There is no gallery, no selection, no
generation count.

## Why — the evidence

Takes have never been used. Across **10 projects with shots, not one Shot has ever held more than
one video take**, and all **58 spend receipts ever written carry `generationCount: 1`**. The gallery,
the selection pointer, the count control and the recovery affordances have carried zero load since
they were built.

That alone would argue for deletion on cost grounds. The stronger argument is that the take model
**permits an illegal state**, and that state has already cost us a day.

Today a Shot's picture is two separate facts:

| Fact                                | Where it lives              |
| ----------------------------------- | --------------------------- |
| this Shot has rendered assets       | `StudioShot.assetIds`       |
| this Shot has a picture in the film | `StudioShot.selectedTakeId` |

They can disagree, and on 2026-08-23 they did — for eight Shots at once. Each held a finished,
hashed, on-disk MP4 while `selectedTakeId` was `null`. The coverage bar read `RENDERED · 1 TAKE` for
every one of them, because [`segmentState.ts`](../../packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/segmentState.ts)
derives `rendered` from **take count**, never from whether a canonical take is selected. The only
signal that a Shot was not in the film was a two-character difference in an adjacent label:

```
Shot 3   4s source   RENDERED · 1 TAKE     ← in the film
Shot 4   4s plan     RENDERED · 1 TAKE     ← not in the film; the Cut cannot play it
```

Collapsing the two facts into one makes that state **unrepresentable**, which is the point of this
change. Everything else is a consequence.

## The model

```ts
export type StudioShot = {
  // …unchanged fields…
  seedStillId: string | null;
  videoAssetId: string | null; // replaces selectedTakeId — the Shot's picture
  supersededVideoAssetIds: string[]; // retained on disk, surfaced nowhere in v1
  assetIds: string[];
  jobIds: string[];
};
```

**The invariant, and the whole reason for the change:** a `video_take` job that succeeds sets
`videoAssetId` **in the same mutation that registers the asset**. One write. There is no second step
in which a rendered Shot waits to be pointed at.

`videoAssetId: null` therefore means exactly one thing — nothing has rendered yet. It can no longer
mean "something rendered and nobody selected it."

### Regeneration

`regenerate_shot_video` on a Shot that already has a picture:

1. the current `videoAssetId` moves to `supersededVideoAssetIds`
2. the new job runs; on success it sets `videoAssetId` to the new asset
3. downstream Shots in the same chain segment go stale — the existing mechanism, unchanged

**The superseded file is not deleted.** This is the one place where the simplification is
deliberately incomplete, and the reason is specific to the chain.

Conditioning frames are extracted from a Shot's picture. Regenerate Shot 2 of an eight-Shot Beat and
Shots 3–8 all go stale. If the previous file still exists, reverting is a pointer flip and costs
nothing. If it has been unlinked, reverting costs **a re-render of Shot 2 plus the entire downstream
chain** — seven paid generations to undo one click. That is a worse failure than anything takes
currently cause, and it collides with the CS2 rule that director edits are undoable from phase 1.

Retention is close to free: takes are already exempt from eviction, so this is a decision _not_ to
unlink. Whether a superseded file ever gets a button is a separate, later question. **In v1 it gets
none.**

## What comes out

### Model and service

| Removed                                          | Note                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `StudioShot.selectedTakeId`                      | → `videoAssetId`                                                                                                                                           |
| `select_take`, `park_take` mutations             | [`mutations/index.ts`](../../packages/desktop/src/process/services/creative-studio/service/schema2/mutations/index.ts) lines 125, 129, 497, 500, 1697–1723 |
| `StudioBinItem` `{ kind: 'take' }`               | the bin keeps `beat` and `shot` lifts                                                                                                                      |
| `'alternate'` bin reason                         | only reachable through take parking                                                                                                                        |
| `StudioJobV2.generationIndex`                    | always 0 once a submission is one generation; fold into `authorizationItemId` for idempotency                                                              |
| `STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION` | [`creativeStudioTypes.ts:119`](../../packages/desktop/src/common/types/project/creativeStudioTypes.ts)                                                     |

`StudioFrameExtraction.takeAssetId` → `videoAssetId`. Rename only; semantics are identical.

### Projection

`rendered` stops carrying `takeCount` and `selectedTakeNumber`. It becomes a single fact: this Shot
has a picture. `activeVideoTakeCount` and `visibleVideoTakeCount` leave
`WorkspaceShotSegmentStateInput` entirely.

`4s plan` versus `4s source` **stays** — planned duration and actual rendered duration are genuinely
different quantities and both are worth showing. What changes is that it stops being load-bearing.
`RENDERED` will mean "in the film", so the duration label no longer has to carry that signal alone.

### Spend gate

Every choice is one generation. `generationCount` leaves `StudioGenerationChoice`; the gate's total
becomes a count of choices. This is a small edit in practice — [`spendGate.ts`](../../packages/desktop/src/renderer/pages/studio/components/Workspace/spendGate.ts)
already hard-codes `generationCount: 1` at every construction site (lines 306, 310, 632, 693).

### Beat panel

The takes section is replaced by a single card showing the Shot's current picture, with one action:
**Generate again**. No gallery, no `Select Take`, no `Use Beat N, Shot M, Take K`.

**This answers the open question about the Review-generation footer:** with the count gone, the
footer's only surviving control is the seed-still reference picker. A video-only submission shows the
button and nothing else. A submission that includes a seed still shows one reference dropdown. The
per-row `Generation count for Beat N, Shot M · video Take` label — which no one could identify on
sight — disappears along with its duplicated `aria-label`.

### i18n

| Group                    | Keys                              |
| ------------------------ | --------------------------------- |
| `beatPanel.takes.*`      | 23                                |
| `beatPanel.recovery.*`   | 18                                |
| `beatPanel.generation.*` | 10                                |
| **total**                | **51 × 12 locales = 612 entries** |

Not all 51 die — the recovery group still needs its part-done and failure copy, and the generation
group keeps the reference picker. Expect roughly two thirds removed.

**Locale keys must move with the code that references them.** A repo test requires every referenced
key to exist in all twelve locales, so removals ship in the same commits as their call sites, never
as a cleanup pass afterward.

## Folded in: the seed-still guard

Filed the same day and belonging here, because it is the failure this change does **not** fix.

Two of the film's eight seed stills came back from the image provider as **2×2 grids** — one
1408×768 file holding four separate pictures. Studio accepted each as a single still and handed it to
the video model as a first frame, which animated all four panels. The two are not even the same kind
of artefact: Open Sea's is four variations of one scene between bright dividers, Storm Drain's is
four _different_ journey locations between dark ones.

In Open Sea it propagated down the whole chain:

```
seed still (grid) → sea_01 (grid) → continuity frame (grid) → sea_02 (grid) → … → sea_03 (grid)
```

Storm Drain's did not propagate past its head Shot. **Four of the film's thirty Shots are ruined**,
three of them the whole closing Beat, and **every gate, status and test passed**. Nothing in the
system asks whether a picture is a picture.

Takes would not have helped — the _first_ still was the bad one, so there was nothing better to
select. What is missing is a check before a still becomes three paid videos.

**The guard, and a warning about how to build it.** On rejection the seed-still job should fail with a
new `StudioJobErrorV2` code and **no video dispatched** — that part is settled, and it is already the
chain's rule: _a Beat whose still fails never dispatches a video generation; the cheap failure is the
right one._

What is **not** settled is the detector, and the first attempt at one is instructive. Measuring
centre-line brightness against its neighbours separates Open Sea's grid from clean stills by two
orders of magnitude (+191/+208 against ≤ +9) and looks decisive. It is not: it scores Storm Drain's
grid at −16/−53, because that divider is dark rather than bright, so a threshold tuned on the first
example misses the second entirely. Cross-seam correlation has the mirror flaw — it catches Storm
Drain, whose panels are different scenes, and misses Open Sea, whose panels are near-identical.
Divider uniformity does best of the three, but Storm Drain still lands between the populations
(0.49/0.54) rather than outside them.

**Do not ship a hand-tuned pixel threshold derived from this sample.** Two positives is not a corpus.
Prefer constraining the request and validating the response with the provider; if a pixel check is
used at all, calibrate it against a real body of generations and treat it as advisory — quarantining
the still for review rather than trusted to decide alone.

## Non-goals

- **No migration.** Existing projects are wiped. The schema version bumps and refuses anything older;
  there is no fold-forward code and no migration tests. The 29 project files are snapshotted at
  `~/Downloads/cs-project-snapshots` (860 KB) should a fixture ever be wanted.
- **No undo UI.** Files are retained; no affordance reads them in v1.
- **No take gallery in any form**, including a collapsed or "advanced" one.

## Scope

30 non-test source files, 37 test files. Concentration:

```
BeatPanel/index.tsx          26 refs
workspaceProjection.ts       21
pricing/estimate.ts          16
schema2/validation.ts        15
creativeStudioProjectSummary 13
spendGate.ts                 11
v2Service.ts                 11
schema2/mutations/index.ts    9
```

Mostly deletion.

## Slices

Each slice ships its own locale changes and leaves the suite green.

1. **Model and mutations** — `videoAssetId`, the one-write invariant, `select_take`/`park_take` out,
   schema version bump.
2. **Projection and segment state** — `rendered` collapses; take counts leave the input type.
3. **Beat panel** — takes section → single picture card; footer reduced to the reference picker.
4. **Gate and pricing** — `generationCount` out; totals become choice counts.
5. **Seed-still guard** — panel-seam check, new error code, no dispatch on rejection.

## What this closes

- `RENDERED` on a Shot with no picture — structurally impossible
- `4s plan` versus `4s source` as the only signal of playability
- the eight manual selections that finished the paper-boat film, and the largest single contributor
  to BUG-115's interaction cost
- `Select Take` / `Use Beat N…` and their intermittent disappearance under the revision race
- the generation-count control nobody could identify
- one bad seed still silently costing an entire Beat
