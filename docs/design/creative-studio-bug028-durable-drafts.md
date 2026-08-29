# Creative Studio — BUG-028: paid drafts survive concurrent revisions

**Status:** ⚠️ **SUPERSEDED 2026-08-29 — the architecture this describes no longer exists.** `creativeStudioService.ts`, `StoryboardDraftModal`, `applyProposalPayload`, `replace_storyboard`, `StudioEditableScene` and `sceneOrder` all return zero files; only `recordProposal` survives. Its remedy shipped by accident — a draft is now recorded as a pending proposal rather than written directly — so the failure below cannot occur as written. **What is live is this note's own §7**, the paragraph marked _recorded, not scoped_: proposals do go perpetually stale under running jobs, reproduced 2026-08-29. See `TASKS.md` BUG-028 for the reproduction and the sized fix. Read the rest as history: §3's exclusion of operational fields is still the right predicate, and is the part worth carrying forward.

**Original status:** agreed design (option C), ready to implement · **Date:** 2026-08-07 · **Code branch:** `creative-suite-sprint2`
**Fixes:** `TASKS.md` BUG-028 · **Consumes:** the proposal ledger (live on the branch) and Slice A3's proposal cards ([EPIC-006 backlog](creative-studio-sprint3-backlog.md))

## 1. The verified failure

`creativeStudioService.ts:1121-1184`: the service checks `project.revision` against the renderer's `expectedRevision`, performs the **paid** planner call (tens of seconds), then CAS-writes with the revision captured **before** the call. Any bump during drafting → `stale_project` → the paid result is thrown away and the user pays again to regenerate.

The race is common, not exotic: job-pipeline commits call `updateProject` with **no expectedRevision** (`mediaStore.ts:1388`, `jobManager.ts:437`) — every poll, status transition and asset commit bumps the revision. A redraft while any generation runs loses almost every time. A test currently codifies the discard sequence; this design flips it.

## 2. The decision — option C: region-guarded merge, proposal fallback

Two mechanisms, each doing only what it is good at:

1. **Common case (revision noise): commit anyway.** The post-call CAS is replaced by a **semantic guard inside the update function**, which runs atomically in the store's per-project queue. It compares the _authored script_ against a capture taken at draft start; if unchanged, the merge proceeds exactly as today's spread does, preserving jobs, assets and cuts.
2. **True conflict (someone changed the inputs or the script mid-draft): keep the work.** Instead of throwing the result away, the service records it as a **pending proposal** — `replace_storyboard`, the ledger's one payload kind — and returns a typed outcome the renderer phrases as _"the project changed while drafting; your draft is saved as a proposal."_ The user accepts from the Slice A3 card (fresh CAS at accept time) or rejects it.

Nothing paid is ever discarded; nobody's edits are ever clobbered.

## 3. The guard, precisely

**Captured at draft start:**

- the planner's inputs — `brief`, `aspectRatio`, `targetDurationSeconds` (`creativeStudioService.ts:1145-1149`);
- the authored script region — `sceneOrder` plus each scene's **editable projection only** (`StudioEditableScene` fields).

**The conflict predicate**, evaluated inside the update fn against `current`:

- any captured input differs, **or**
- the authored script region differs, **or**
- any scene being replaced carries a **non-terminal job**.

**Operational fields never participate** — `assetIds`, `jobIds`, `selectedAssetId`, `reviewState` change on every job commit, live inside `scenes`, and comparing them would collapse the design straight back into the bug. This exclusion is the load-bearing line of the whole note.

The active-jobs clause exists because the merge replaces `scenes` wholesale: under the old CAS a job bump blocked the commit, so a running job could never be orphaned by a raced replace. The guard keeps that property by routing active-work overlap to the fallback instead of committing over it.

## 4. Mechanics and one trap

- **Pre-flight is unchanged.** The `expectedRevision` check _before_ the paid call stays — it stops the user paying on a view that is already known stale. Only post-call handling changes.
- The commit calls `updateProject(projectId, guardedMerge)` with **no expectedRevision** (the parameter is already optional); atomicity comes from the guard running inside the serialised queue.
- **The update fn must not call store methods** — `recordProposal` enqueues on the same per-project queue and would deadlock. The fn throws a private sentinel; the service catches exactly that sentinel, reads the project once for a fresh revision, and calls `store.recordProposal` as its own queued operation. This makes the one-shot path **`recordProposal`'s first caller** — a pleasing symmetry: the main-process producer uses the main-process method, while Slice A's subprocess uses the file contract.
- The fallback proposal's payload is the drafted scenes' **editable projections** keyed by their allocated ids, plus the drafted `sceneOrder` — exactly what the payload validator accepts.
- The IPC result becomes a discriminated outcome: `committed { project }` | `recorded_as_proposal { proposalId }`. The renderer shows a notice for the second variant; the card itself arrives through the existing `proposalUpdated` subscription (`useStudioProject.ts:146`).

## 5. An accepted asymmetry, recorded

A raced draft that lands via proposal **acceptance** flows through `applyProposalPayload`, which preserves scenes carrying assets or jobs; a clean direct replace does not (the user confirmed wholesale replacement in the modal). The racy path is therefore _more_ conservative than the clean path. That is the right direction for the surprising case, and it is recorded here so nobody reads the difference as a bug.

## 6. Verification

- A **job bump mid-draft commits anyway** — fails on today's code, the heart of the fix.
- A **brief edit mid-draft records a proposal** and leaves the project byte-for-byte unchanged; the returned outcome names the proposal id.
- A scene with a **running job** in the replaced set routes to the fallback, never orphans the job.
- The **empty-project path is byte-identical to today** (capture is trivially empty; guard passes; no behaviour change).
- The update fn **never touches the store** (the deadlock trap) — asserted structurally via the sentinel pattern.
- The existing discard-codifying test is inverted, with a comment naming this document.

## 7. Sequencing and non-scope

Implement **after Slice A3** — the fallback needs the card UI to be visible. Independent of Slice P and the scene assist.

**Recorded, not scoped:** the ledger's own `acceptProposal` CAS's on whole-project `baseRevision` and has the same coarseness. Brief conversations mostly precede generation, so v1 wears it; if proposals ever go perpetually stale under running jobs, the §3 predicate is the fix and this note is its precedent. Also out: any change to `StoryboardDraftModal`'s confirm-before-generate flow, the planner, or ledger store machinery — `recordProposal` is consumed as-is.
