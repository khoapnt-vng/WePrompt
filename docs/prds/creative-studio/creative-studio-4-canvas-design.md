# Creative Studio 4 — the canvas

**Date:** 2026-08-30 · **Revision 2** · **Status:** contract amendment, for owner review
**Supersedes:** the four-view workspace IA · **Amends:** revision 1 (`f541b4647`) after review
**Grounded in:** two agent surveys of the product, each area independently checked

> **Revision 2 exists because revision 1 was not implementation-ready.** A review found ten blocking
> gaps. All ten were verified against the code and all ten were correct. The three that mattered
> most: readiness was film-only and could never describe a standalone photo; pending paid work had no
> durable owner in the design; and the words `Artifact` and `Composition` were already taken by
> shipped concepts. Revision 1's claim that "provenance remains unchanged" was true only as an
> invariant, not as a set of contracts.

---

## What this is

CS4 changes what Creative Studio _is on screen_, and what it _is for_.

Today it is a film tool: a workspace of four views over a Beat and Shot model, where every generated
thing must hang off a Shot. CS4 is a **multi-modal studio** — photo, sound, video — where the unit is
a **named artifact** produced by a **capability**, and a film is one composition over artifacts
rather than the container everything lives inside.

Two pivots, one architecture:

1. **The workspace becomes a canvas of named blocks.** Each block holds finished work and carries a
   `#` handle. Nothing on the canvas is an empty container. The Director presents only what is ready
   for review.
2. **Creation is composable capability blocks.** A Director invokes capabilities and names their
   outputs, rather than driving a fixed pipeline.

**Standalone artifacts are first-class.** A person can make one photo. That is the load-bearing
requirement: if a photo needs a film scaffolded around it, nothing else in this document works.

---

## Why: the diagnosis, measured

The owner's complaint was "many screens with no content, and no clear call to action — will the
Director do this, or do I click something?". The survey confirms it exactly, and the numbers are
worse than the complaint.

A newly created project has `beatOrder: []`, `beats: {}`, `shots: {}`, `references: {}`,
`referenceOrder: []`, `referencePlanStatus: 'unplanned'`, `bin: []`, `imageRouteId: null`,
`videoRouteId: null`. Every one of the four readiness stages therefore derives `not_started`, so
**all four views are locked at the moment a person first arrives.**

What they see is one paragraph:

> **The Director starts here**
> The Director will draft the first plan from your brief. Review it here when it arrives.

And the four locked views, if addressed directly, say:

| View       | Copy                                                           |
| ---------- | -------------------------------------------------------------- |
| References | "Nothing to review until the Director plans references."       |
| Table      | "Nothing to arrange until the Director drafts the storyboard." |
| Board      | "Nothing to produce until the Table is set."                   |
| Cut        | "Nothing to cut until Shots are produced."                     |

**Every one of those sentences says the Director will do it, and offers the person no action.** That
is the confusion, in the product's own words. Meanwhile the only enabled control in the app bar —
`Render…` — answers an empty project with _"Nothing is ready to render yet"_.

This is not a copy problem. The screens are empty because the model requires a film to exist before
anything can. The canvas is the fix because it inverts the relationship: blocks exist because
something was made, so there is no state in which the app shows you a container for work you have
not done.

---

## Pilot 1

Deliberately narrow, and it sets the scope of everything below.

> From an empty project with **zero Beats and zero Shots**: create or import **one standalone photo**;
> review and confirm any cost; observe progress or failure; receive a named piece; rename it; reload
> it with stable identity and exact provenance; export it.

No video, no film, no sound. **This removes ffmpeg from the critical path entirely** — a photo needs
no probe, no decode and no encoder — so the largest blocker is deferred rather than solved early. If
video enters Pilot 1 that reverses immediately, and the editor-folder export does **not** rescue it: a
take discarded during ingestion was never persisted, so there is nothing for a folder export to copy.
Revision 1 claimed otherwise and was wrong.

The surface is an **automatically laid-out, keyboard-accessible board** — not an infinite spatial
canvas. Freeform positioning, film, video and sound all follow.

---

## The vocabulary

Revision 1 introduced `Artifact` and `Composition`. Both are already taken, and so is `Block`.

| Word          | Occurrences today               | Existing meaning                                                                                           |
| ------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `Artifact`    | 811, across 5 live meanings     | Studio export payload, Office document subsystem, aioncore conversation card, presentation-template scrape |
| `Composition` | `StudioGenerationCompositionV2` | **Frozen generation-request provenance**                                                                   |
| `Block`       | 11 `Studio*Block*` types        | **Blocker** — a reason something cannot proceed                                                            |

Qualifying them does not survive grep or review. The amendment therefore uses three new words, each
with zero existing occurrences anywhere in the tree:

- **Piece** (`StudioPieceV2`) — the first-class thing a capability produces. What a person names.
- **Assembly** (`StudioAssemblyV2`) — an ordered arrangement of Pieces that makes a larger work.
  **Does not exist until phase 6.** Pilot 1 needs no Assembly.
- **Job** — unchanged. See below.

### `StudioGenerationCompositionV2` is retained, untouched, and is not the Assembly

It is **frozen generation-request provenance**: the brief, rules, story, shooting script and exact
reference assets with sha256 that a generation was conditioned on. It has nothing to do with the CS4
ordered-arrangement concept beyond an unfortunate shared English word.

**It must not be renamed, redesigned, or deleted as part of CS4.** Its schema version stays at 1, and
`validation.ts` requires exact equality on every persisted job at load — a mismatch **quarantines the
project**. This paragraph exists because revision 1's careless reuse of the word put it one confident
refactor away from data loss.

---

## Pending work: no new record, one new owner

The review asked for a durable `CapabilityRun`. Grounding the code says the record already exists and
the requirement is already met.

`StudioJobV2` is persisted inside the project document. It is minted **inside the confirm CAS commit,
atomically with the spend authorization**, so paid work has a durable owner before dispatch. Dispatch
itself is best-effort and swallows errors, leaving the job in `queued_local` for crash recovery. The
finished asset is created **only** inside a single CAS commit that simultaneously validates the bytes,
registers the asset, appends it to its owner and flips the job to `succeeded` — the one place
`succeeded` is ever assigned. `spendReceipt` is written exactly once, at provider success; money is
not modelled as a status.

**So the amendment adds no new record.** It adds a third owner kind.

### Correcting revision 1 and the review

The nine durable job statuses are `waiting_for_conditioning`, `queued_local`, `submitting`,
`queued_remote`, `running`, `needs_attention`, `succeeded`, `failed`, `cancelled`.

`awaiting_spend`, `partially_failed` and `dismissed` are **not job states**. They belong to
`StudioRendererReferenceGenerationHandoffV2`, a derived, non-persisted aggregate over a _set_ of jobs.
Revision 1 and the commission both described them as job states. For Pilot 1 — one photo, one job —
`partially_failed` has no meaning at the run level at all.

Adding a status or a field to the job record is a **persisted-schema change**: `validateJob` requires
an exact key set of 24 required and exactly two optional keys. And every new state needs an explicit
arm in `resumePendingJobsV2`, which is the whole of crash recovery and skips anything it does not
recognise.

### The real barrier to a standalone photo

Not the job model. A shot-less job is already legal: `activeOwnerForJobV2`'s reference branch never
consults Beats or Shots, so a `reference_image` job in a project with zero of both passes every
structural check today.

The barriers are two, and both are typed:

1. **The asset validator, which is stricter than the job model.** A shot-less image **must** carry a
   `projectReferenceId`; a shot-less non-image, non-bed-audio asset is **rejected outright**; and
   ownership is an exclusive XOR between shot and reference.
2. **Reference is a typed film-craft slot, not a container.** `StudioReferenceKindV2` is
   `'character' | 'background'` — there is no generic kind — and a biconditional binds
   `purpose === 'reference_image'` to `target.kind === 'reference'` in three separate validators plus
   the confirm builder, which throws `'Invalid Studio project-reference job ownership'`.

A person's named standalone photo cannot honestly occupy a character look-sheet. **The amendment adds
a third owner kind — the Piece — as a first-class map beside `beats`, `shots` and `references`**, with
an id, a label, an ordered `jobIds` array, `assetIds`, and a current-asset pointer with a superseded
list. That same id serves the new arm of `StudioGenerationTargetV2` and the new asset-ownership
pointer.

---

## Which contracts version, and which do not

Revision 1 said provenance is unchanged. That is true as an **invariant** — exact prompts, hashes,
resolved inputs, routes, receipts and producer linkage are all preserved — and false as a statement
about **contracts**, several of which must change to admit a shot-less owner.

**These move:**

| Contract                               | Change | Why                                                |
| -------------------------------------- | ------ | -------------------------------------------------- |
| `STUDIO_MUTATION_BATCH_SCHEMA_VERSION` | 5 → 6  | New standalone create / rename / delete operations |
| `STUDIO_EXPORT_SCHEMA_VERSION_V2`      | 2 → 3  | Export of a shot-less item                         |

**These explicitly stay:**

`STUDIO_PROJECT_SCHEMA_VERSION` stays at **5**, following the decode-time defaulting precedent
already used for the brief sidecar. `STUDIO_GENERATION_COMPOSITION_SCHEMA_VERSION` stays at **1** —
exact equality is required at load and a mismatch quarantines the project.
`STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2` (10), `STUDIO_PROPOSAL_SCHEMA_VERSION_V2` (6),
`STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION` (5) and `STUDIO_FILM_EXPORT_FACTS_SCHEMA_VERSION` (1) are
all untouched.

> **"schema2" is a subsystem name, not a version.** Revision 1 wrote "Schema 2 already records…" and
> was wrong: the persisted project schema is **5**.

---

## The three projections

Revision 1 claimed the canvas could be driven entirely by `projectStudioStatusV2`. **That was the
single load-bearing claim of the cheap estimate, and it is false.** Its seven stages — `brief ·
engines · references · storyboard · bindings · production · cut` — are film-only. A standalone photo
can never complete them, so a canvas driven by that projection would report a one-photo project as
permanently incomplete.

Three Main-owned projections replace it:

1. **Canvas inventory** — what Pieces exist, their labels, current asset, and whether each is current
   or superseded. Independent of any film.
2. **Capability activity** — what is in flight, what needs attention, what failed, and what it will
   cost or has cost. Derived over Jobs.
3. **Film composition status** — `projectStudioStatusV2`, unchanged, scoped to projects that have a
   film. Not consulted when no Assembly exists.

The existing typed blockers — `{cause, where, remedy}` with remedies already classed free / proposal /
paid — are reused by the first two rather than reinvented.

---

## Authority and spend

| Actor                | May                                                            |
| -------------------- | -------------------------------------------------------------- |
| **Director**         | Draft, name, and select inputs                                 |
| **Main**             | Resolve ids, hashes, eligibility, routes, quotes and revisions |
| **Human (renderer)** | Confirm spend, approval, and irreversible change               |

Confirmation **rederives and rejects stale state**. Mutable `#` handles are **never** resolved at
dispatch time — a handle is a label for people, and an immutable id is what a contract carries. That
separation is the whole reason a renameable handle is safe.

### The budget readout is not derivable, and is omitted from the first tranche

Revision 1 recommended a currency envelope drawn down by summing receipts. That is wrong: summing
receipts gives **recorded spend**, not remaining budget. Authorized-but-not-yet-billed commitments are
not represented anywhere, and `maxPerBatchMinorUnits` is a per-batch ceiling, not a total envelope.

**Settled: no credit ledger and no credit counter** (owner, 2026-08-30), which keeps D3 intact and
means Pilot 1 ships no such readout. See decision 1.

---

## The first-run journey

Revision 1 diagnosed "do I wait for the Director, or click something?" and then said only that either
party may invoke a capability — which reproduces the same ambiguity on a blank canvas.

**Pilot 1 answers it explicitly.** An empty canvas offers exactly two named actions, both the
person's: **create a photo** (describe it) and **import a photo**. The Director does not act first and
does not act alone. It may draft and name and propose inputs; the person confirms spend. There is no
state in which a person is waiting for a Director that is waiting for them.

---

## Migration, and what "no migration" does not license

**No migration.** All existing projects are test data. CS4 uses a **clean new project schema**;
protocol and sidecar versions stay independent. Anyone holding work in a CS3 project loses it — an
accepted cost.

**But deleting quarantine is not licensed by it.** There is no migration code in the studio subsystem
at all — a grep for `migrat` returns zero hits. What exists is two separable things:

- **Legacy-schema detection** — deletable under this ruling.
- **Corruption machinery** — files get corrupted regardless of migration, and this is **retained**:
  `scanProjectsV2`'s classify-and-continue, bounded validation and traversal caps, transactional
  crash-safe writes with startup replay, and per-project isolation.

Per-project isolation is not theoretical: **BUG-179** was a P1 fixed on 2026-08-30 where exactly this
failed — one unreadable project degraded the entire runtime graph because a sweep passed
`tolerateProjectErrors: false`. The containment pattern must survive the new schema.

Two consequences the current guards force, both to be resolved in phase 1: a project lacking a brief
sidecar is quarantined today, so a standalone-photo project must still have a brief; and a quarantined
project can currently be **neither opened nor deleted**, which is a dead end that must not survive
into the pilot.

---

## The work, in six phases

Revision 1's task zero bundled contract design, fixtures, two major refactors, compatibility deletion
and test retirement — and left the composition concept owned by nobody. Replaced by an ordered
sequence, with parallelism starting only after the contract is frozen.

1. **Owner decisions and versioned contracts.** The four decisions below; the Piece owner kind; the
   two versions that move; the quarantine seam. Not split.
2. **Runtime fixtures plus behaviour-neutral extraction.** Fixtures captured from a running backend,
   never hand-built from types. The `store.ts` (9,684 lines) and `StudioPage.tsx` (4,507 lines) carve
   happens here, and must be provably behaviour-neutral — kept separate from phase 1 so the phase
   that must be trustworthy carries no refactor risk.
3. **Hidden Piece and Job storage, and the Main projections.** No UI.
4. **Standalone-photo fake-adapter E2E.** The Pilot 1 journey, end to end, against a fake generation
   adapter. This is the acceptance gate for the contract.
5. **Canvas UI and Director integration.**
6. **Assembly, film composition, and later modalities.** Video, sound, ffmpeg bundling.

Two lanes may run in parallel **from phase 3**, split on the seam frozen in phase 1: one behind it
(storage, projections, capabilities, spend), one in front (canvas, Director presentation). Not before.

---

## Completion gates

Every phase. Run from the worktree root, in order:

1. `bun run i18n:types` — regenerates the untracked `i18n-keys.d.ts`
2. `bunx tsc --noEmit`
3. `bun run lint -- --quiet` — errors only; ~1,300 pre-existing warnings are not failures
4. `bun run format` — **oxfmt, never prettier**
5. `node scripts/check-i18n.js`
6. Focused tests for the changed area
7. **Coverage manifest updated** — every new or changed runtime file appended to
   `creativeStudioRuntimeManifest` in `vitest.creative-studio-coverage.config.ts` (116 paths today,
   per-file 80% lines and branches). It is unguarded, so this is a named task, not a checklist
   afterthought.
8. **Twelve locales, in the same change** — `studioI18n.test.ts` asserts exact key sets in both
   directions for `en-US` and each of the eleven others. i18n cannot be batched at the end without
   designing in a red window.
9. **Accessibility** — extend `StudioAccessibleCopy.dom.test.tsx` with role and label assertions for
   every new surface. There is no other a11y infrastructure.
10. `just push` — the full gate: lint-strict → fmt-check → typecheck → i18n-check → the reviewed
    coverage suite
11. **Source audit** — read the diff for anything the gate cannot see
12. **Fake-adapter E2E** for the Pilot 1 journey

> **"Wire-fixture replay" as the review worded it does not exist yet.** There is no response
> record/replay anywhere in this repository. Phase 2 must build the capture, or the item must be
> honestly restated as a Pilot 1 photo-lifecycle integration test against a fake adapter. It cannot be
> listed as though the capability were already there.

> If any phase changes a gate leg, `releasePackagingConfig.test.ts` must change with it — it pins the
> push recipe's shape deliberately.

---

## The backlog is triaged, and the triage is the contract

Revision 1 said "the nine open CS3 bug entries stay with the other agent". That was wrong twice: the
backlog has **30** open entries, not nine — nine was one agent's remaining subset from a verification
pass — and no such handoff was ever agreed.

Replaced by a committed triage in the bug list. Every open entry now carries a disposition, a
rationale, a destination phase where applicable, and a claimant. **4 fix-before-CS4 · 25 absorb · 1
superseded-by-cutover · 0 defer.** Nothing was closed by it.

An adversarial pass overturned **eleven** of thirty, nearly all from _superseded_ to _absorb_. The
decisive example is BUG-182: the cutover deletes the **fix**, not the defect, because `carriesPicture`
and its only regression test both live inside `FirstFrames/`. Closing it at cutover would tick the
entry at the exact moment the product regresses.

**This is blocking.** Parallel implementation does not start until it is committed, because otherwise
the other agent keeps fixing UI the cutover deletes.

---

## Decisions — all four settled

Settled by the owner on 2026-08-30. Kept with their reasoning, because two were re-scoped by Pilot 1
rather than answered on their own terms, and because the reasoning is what a later reader will need in
order not to reopen them by accident.

### 1. No credit ledger, no credit counter, D3 kept — **decided**

The reference app shows `✦ 412 Renew` in the corner. Decision D3 (2026-08-12) says: _"No credit
ledger — out of scope. Cost is not priced in credits; any mock text showing credits is illustrative
only and must not be transcribed into the build."_

There is also no data source. No balance, wallet, or spent-to-date value exists anywhere in the
store, main, or the renderer — only `StudioSpendPolicy.maxPerBatchMinorUnits`, a per-batch ceiling
with no drawdown, and per-job `spendReceipt` rows.

**Revision 1 recommended a currency envelope drawn down by summing receipts. That is not derivable.**
Summing receipts gives _recorded spend_, not remaining budget: authorized-but-unbilled commitments are
represented nowhere, and `maxPerBatchMinorUnits` is a per-batch ceiling, not a total envelope.

**Decision (owner, 2026-08-30): no credit ledger and no credit counter. D3 stands unamended.**

So the reference app's `✦ 412` is the one element of its design language CS4 does not adopt, and the
designer is told so rather than left to draw something that will not be built.

Cost still appears where it is owed — at the moment of spend, in currency, from our own rate card,
which is what the spend ruling asked for. What is not built is a ledger, or anything that accumulates
into a balance of credits.

> Scoped to what was actually decided. A draft of this line said "no corner readout of any kind",
> which was wider than the ruling — mine, not the owner's. A plain **recorded spend by currency**
> line would break neither D3 nor this decision and remains available if it is ever wanted. What is
> settled is that nothing counts credits and nothing accumulates into a balance.

### 2. ffmpeg gates four capabilities, not one

BUG-144 describes film export. The survey found the dependency is far wider:

- **Video ingestion.** Every downloaded take is probed for duration, and a probe failure **discards
  an already-paid result**. On a stock machine a pilot user pays for a clip and is told the provider
  returned nothing.
- **Continuity frames.** The last frame is decoded locally except on one BytePlus path at an
  untrimmed endpoint.
- **Audio bed import.** Requires ffprobe _and_ a full decode; failure surfaces as `invalid_media`,
  which reads as "your file is broken".
- **Film export.** Also requires 20 named filters, 5 demuxers, 2 muxers, the aac encoder, and a
  hardware encoder — there is no software x264 fallback, so a VM gets no film even with ffmpeg
  installed.

The resolver is already bundle-ready and the electron-builder hook exists. **This is a packaging
decision — pin, download and sign LGPL binaries — not a mechanism to build.**

**Pilot 1 defers this entirely.** A standalone photo needs no probe, decode or encoder, so the
decision is owed at **phase 6**, not now. It becomes blocking the moment video enters scope.

**Revision 1 called the editor-folder export the fallback deliverable. It is not**, for the case that
matters: a take discarded during ingestion was never persisted, so a folder export has nothing to
copy. It rescues only takes that survived probing.

### 3. CS4 supersedes progressive workspace readiness — **decided**

Progressive workspace readiness landed on 2026-08-30 as the answer to the same four-empty-rooms
complaint, and the four-view order is an owner-approved product amendment from 2026-08-24. **CS4
supersedes both, by explicit owner decision on 2026-08-30**, so this is a recorded reversal rather
than a silent overwrite.

What is superseded is the _answer_, not the _diagnosis_. Gating told a person what they could not do;
the canvas has to tell them what they can. And the underlying stage derivation is not discarded — it
becomes the third of the three projections, scoped to projects that actually have a film.

### 4. What a pilot user must be able to finish — **decided**

Pilot 1, above: one standalone photo, created or imported, cost confirmed, progress observed, named,
renamed, reloaded with stable identity and exact provenance, exported. Recorded here because it is
what re-scoped decisions 1 and 2, and because it is the reason the remaining decisions are owed later
rather than now.

---

## Traps

- **`STUDIO_VIEWS` is a two-process contract.** Changing it without the main-process route pattern
  loses unsaved drafts silently.
- **The Director's rules now name the UI.** `DIRECTOR_PRESET_RULES` was given a map of the workspace
  on 2026-08-30 — the four views, the Render button, the Project menu, the proposal card and its
  buttons — with a test asserting every name exists in the shipped locale bundle. **A canvas rewrite
  invalidates that map and will fail that test.** That is the test working as designed: update the
  map in the same change.
- **In-flight work is not finished work**, and its states are not where revision 1 said. The nine
  durable job statuses are `waiting_for_conditioning`, `queued_local`, `submitting`, `queued_remote`,
  `running`, `needs_attention`, `succeeded`, `failed`, `cancelled`. `awaiting_spend`,
  `partially_failed` and `dismissed` belong to a derived aggregate over a _set_ of jobs, not to a job.
  A canvas whose rule is "blocks hold finished work" must still say where in-flight work appears.
- **`toRendererJob` strips `requestSnapshot`.** Main records per-clip conditioning durably, but the
  renderer never receives it. Disclosure later is not free: it needs an IPC change.
- **Two sessionStorage draft stores** hold real unsaved user work, keyed by a field vocabulary tied
  to today's forms.
- **The film export action must vanish, not fail,** when the local encoder contract is unavailable —
  a carried-forward ruling that it never shows a control that fails.

---

## Out of scope

Voice generation. Sound and video generation, and the Assembly concept — all phase 6.
`strictNullChecks`. Any change to the ~98.6% upstream surface. Migration of existing projects.

**Not the CS3 backlog.** Every open entry is triaged in the bug list against this programme, with a
disposition, a rationale, a destination phase and a claimant. Four of them block the CS4 base.
