# Review — the chain sequence and the wider beat frame

**Date:** 2026-08-22 · **For:** the Creative Studio designer and whoever estimates this
**Reviewing:** `Creative Studio 3 — Handoff: the chain sequence and the wider beat frame`, with
`Creative Studio 3 · Sequence` (the annotated storyboard)
**Related:** [watching commission](creative-studio-3-watching-commission.md) ·
[bug list](../prds/creative-studio/creative-studio-3-bug-list.md)

## Verdict

Build-ready, and unusually so. The states are named and ordered, the invariants are stated as
invariants, and the document flags its own §14.5 amendment rather than leaving someone to find it.
Every contract note in §1.3 was checked against the code rather than taken on trust. Four things
need to go back, and only the first is blocking.

## 1. The one claim the scheduler cannot keep

**F1 asserts "WORST CASE IS THE LONGEST CHAIN · NOT 11 GENERATIONS ADDED UP" and draws four chains
running side by side. Today it is exactly the opposite.**

`jobManager.ts:455` holds `semaphores = { image: new FifoSemaphore(2), video: new FifoSemaphore(1) }`.
There is also a per-project cap of two paid jobs in flight (`jobManager.ts:95`), and **both** must be
acquired before a submission. The job manager is a single app-wide instance held by the runtime's
active graph, so that video semaphore is global.

**One video generation at a time, across every beat, every project, the whole application.**

§1.3's own wording — "nine chains is not nine simultaneous provider calls" — is right in spirit and
understates the size of it. Nine chains is _one_ call. Worst case is precisely eleven generations
added up, which is what the panel says it is not.

For scale, measured rather than assumed: the video in the 2026-08-22 end-to-end run took roughly
thirty-two minutes of wall clock. Eleven generations serialised is about five hours, against the
ninety minutes a longest-chain reading implies.

The question to answer before anyone estimates F1: is `FifoSemaphore(1)` a deliberate cost or
rate-limit guard that the drawing must reflect, or a default nobody has revisited? Filed as
**BUG-109**.

## 2. A contradiction inside the handoff

§1.3 asks that **frame extraction get its own `StudioJobStatus` value**, on the grounds that the set
is closed and exactly validated. The preamble says **"Nothing here changes the schema."**

Both cannot hold. `StudioJobStatus` is a closed, exactly-validated set of eighteen values; adding one
is a schema change.

It is also unnecessary, because the concern it protects against is already solved a better way.
Extraction is not a job. It is `StudioFrameExtraction` — its own record with its own enum,
`pending | extracting | ready | failed` (`creativeStudioTypes.ts:408`). Nothing is smuggled into a
job status today. **Recommend deleting the sentence** rather than having someone implement it.

## 3. Item 1 is much smaller than "one job kind and one asset"

Verified present in the current build:

| §1.3 contract note                                     | State today                                                                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Frames live in a fifth collection, not `thumbnails`    | **Built** — `conditioningFrames` is its own managed collection               |
| The frame asset is per take, not per shot              | **Built** — extraction id keys on `{shotId, takeAssetId, endpointSeconds}`   |
| The render job keeps exactly two outputs               | **Built** — `outputAssetIdsByRole: { primary, poster }`                      |
| Source order: provider frame, then main-process decode | **Built** — `allowProviderLastFrame`, then `runLocalDecode`                  |
| ...then renderer canvas capture                        | **Not built** as an extraction fallback                                      |
| No chain advance without the frame asset on disk       | **Built and enforced** — the file is re-hashed before the chain advances     |
| A4's WAITING ON THE FRAME vs QUEUED                    | **Built** — `conditioning_frame` and `upstream_running` are distinct reasons |
| B1's tail trims stale, head trims do not               | **Built** — "Tail trim breaks downstream continuity."                        |
| Takes and conditioning frames exempt from eviction     | **True by absence** — see §5                                                 |

What is genuinely new in item 1 is mostly presentation: the boundary marker carrying a picture, the
queue labels, and PART DONE and resume as visible states. Estimating it as new plumbing would be
estimating work that exists.

## 4. Two things the drawn gate depends on that are deferred

A2 and B2 both rest on **estimate ranges** (`$1.24 – $1.60`) and on **a budget rule pinned in the
brief, checked pre-dispatch per batch**. Both were explicitly deferred out of the MVP on the owner's
instruction to make it work first: no rate-card display, no ranges, no budget cap. The gate as drawn
cannot be built without reopening that decision. This is a scope collision to decide, not an error.

Separately, B2's two priced lines are nearly there but presented differently. The gate today toggles
between `Selected anchors` and `Selected anchors and continuation`, so both totals exist but the
second requires switching to see. B2's actual argument — that a single total hides the real choice —
is only half-honoured by a toggle.

## 5. One smaller note

A8's "Takes and conditioning frames are exempt from eviction — retention reaches exports only"
describes an **absence**, not a rule. There is no retention or eviction system for takes at all; the
only eviction in the codebase is a prepared-submission cache and export artifacts. Worth rewording so
that nobody builds a retention system in order to exempt things from it.

## What we agree with and are not re-arguing

The 852 → 1100px case is made on measured grounds — density tiers computed from real bar width, and
the eight-shot limit landing on NARROW at the old width. The variant rationale for 1d, and the
reasons given for rejecting 1b, 1c and 1e, are sound. The reserved alert slot from 1e is worth taking
for exactly the reason given: a warning appearing mid-drag currently moves the bar under the cursor.
