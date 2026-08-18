# Creative Studio 3 — Beat and Shot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schema-1 scene/phase prototype with a Beat → Shot → Take workspace whose
Table, Board, and beat panel share one revisioned state; whose beats own their own cut; whose
first-frame chain is explicit, quoted, and recoverable; and whose paid generation stays behind a
reviewed human confirmation that shows what it will cost.

**Architecture:** Land a clean, additive schema-2 foundation first, then atomically switch the
runtime, bridge, and renderer to it. One pure reducer in main owns every free renderer and Director
mutation. The project store remains the only durable writer. Table, Board, and the beat panel consume
the same sanitized projection. The Director is one persistent conversation in a collapsible docked
rail — it is not the workspace's centre. Schema-1 manifests and sidecars are read-only unsupported
prototype data: never migrated, repaired, replayed, quarantined as corrupt, or used to start provider
work.

**Tech Stack:** TypeScript, Electron main/renderer separation, React 18, Arco Design, Icon Park,
CSS Modules and UnoCSS, native bridge schemas, MCP SDK, Vitest, Testing Library/jsdom, Playwright,
i18next across 12 locales, repository-managed media URLs.

**Spec:**
[creative-studio-3-direction-and-answers.md](./creative-studio-3-direction-and-answers.md) (§1–§11),
SHA-256 `c5ed4f533f0f354208fb38df21b036fbaa3cf95151501e5c9cacc7fc33c3ff4e`; frozen visual reference
[creative-studio-3-beat-and-shot-reference.html.txt](./creative-studio-3-beat-and-shot-reference.html.txt),
SHA-256 `642c8b16a56c2799d119c6077c7282969c1d612bd9aca606e39da51c710846ee`. The reference is the
offline bundle of the prototype the review was conducted against; the direction document refers to
it by its authoring name, `Creative Studio 3 - Beat and Shot.dc.html`.

> **Authority record.** The direction document was originally transcribed into the repository rather
> than exported from its authoring copy. On 2026-08-18 the product owner explicitly approved the
> repository text as authoritative, including the parked-shot amendment recorded at its top. That
> approval supersedes the earlier authoring-copy comparison requirement for this revision. Any later
> semantic edit still requires explicit product approval, an independent contract review, and a new
> pin. A hash is only an anchor if it names the file everyone approved.

**Execution baseline:** `7176e3f6b` on `codex/creative-studio-table-board-ui-design` — CS2 Tasks 1–5
complete and Gate 1 closed after the independent review/fix sequence through `12a8d7fe7`. The three
CS3 documentation commits were transplanted onto that lineage before this amendment; do not begin
implementation from the divergent pre-review docs fork. Verify `7176e3f6b` is an ancestor and the
worktree is clean before Task 1A. The rename below touches roughly a thousand lines across
thirty-odd files and 18,874 lines of tests, and a red baseline makes rename breakage
indistinguishable from new breakage.

**Authorization boundary:** This document is an implementation plan, not implementation, merge,
default-enablement, release, profile-deletion, provider-run, or customer-migration authorization.

---

## Relationship to CS2 — what is salvaged, what is rewritten

CS2 completed Tasks 1–5. CS3 is not a new product; it is CS2's model corrected on vocabulary, on
where the cut lives, and on the division of labour between director and human. This plan supersedes
`creative-studio-2-table-board-implementation-plan.md`.

**The pivot is a rename, not a rewrite — measured, not estimated.** Across the whole CS2 schema-2
effort (12,824 production lines, 18,874 test lines), the CS3 vocabulary touches roughly **6%**. In
the 10,224 production lines of Tasks 4–5, only about 400 carry any renamed identifier: `clipId` on
218 lines, `sectionId` on 70, `shelf` on 6, `cut` on 17, `scene` on 12, `Cut` on none. Fixture IDs
such as `clip_1` are opaque safe IDs and need no change. Everything else — the Director command
mailbox, processor and spend fences, the four MCP record writers, `v2Service`, `jobManager`,
`mediaStore`, the store's schema sniff and quarantine path — is vocabulary-independent and carries
over untouched.

**Nothing built so far is UI.** CS2 never reached its cutover task, so the IPC bridge, the native
payload schemas and manifest, and the renderer have never seen the Section/Clip vocabulary. That is
the expensive, hard-to-unwind surface, and it is still unwritten. Gate 1's check that V2 code remains
unregistered from the renderer bridge is what certifies this.

**The only genuine write-off is the cut machinery** — `cuts.ts` (227 lines) and `cuts.test.ts` (400)
— and it is a CS3 _design_ cost, not a pivot cost: collapsing the Cut into `bedAssetId` and
`matchToShotId` deletes that code whenever CS3 is adopted, so finishing CS2 first would not save a
line of it.

| CS2 artefact                                                                                     | Fate in CS3                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Task 1 types (`StudioSection`, `StudioClip`, `StudioShelfItem`)                                  | **Renamed** to Beat/Shot/Bin and extended. Same file, same schema version.                                                                                                                                                                                                                      |
| Task 1 `schema2/validation.ts` (795 lines)                                                       | **Renamed and extended.** Structure, exactness, and roughly half the file (assets, jobs, provider, rules, timestamps) are untouched by the rename.                                                                                                                                              |
| Task 1 **Fix Round 1** (`0191d0216`) — `ownValue`, iterative retry walk, per-kind shelf maxima   | **Carried as code.** These are totality fixes, not schema; they transfer to a Beat/Shot validator directly. Nine of ten review findings closed here.                                                                                                                                            |
| CS2 **Amendment 1** (validator totality and lookup rules)                                        | **Carried verbatim.** Schema-independent; see the frozen contract below.                                                                                                                                                                                                                        |
| Task 2 reducer `mutations.ts` (674 lines)                                                        | **Renamed and extended**, not rewritten. Its batch machinery — ordered application, later-op visibility, immutability, rollback, capacity precedence, collision rejection, permutation checks, created-ID ordering — is vocabulary-independent. CS3 keeps analogues of all 15 ops and adds ~12. |
| Task 2 `cuts.ts` (227) + `cuts.test.ts` (400)                                                    | **Deleted.** The Cut collapses into project fields; cut-clip identity, `orderMode` reconciliation, and clamping have no home. The only genuine write-off.                                                                                                                                       |
| Task 3 store inspection, schema sniff, V1 no-touch guarantees, quarantine path, CAS, fsync facts | **Carried.** Only the seam type signatures change.                                                                                                                                                                                                                                              |
| Task 4 `jobManager`, `mediaStore`, `renderService`, `v2Service` (4,358 production lines)         | **Renamed.** `clipId` → `shotId` over logic that stays valid: idempotency, submission ambiguity, download recovery, cancellation policy, retry lineage. Chain sequencing is **additive on top**, not a replacement.                                                                             |
| Task 5 Director mailbox, processor, spend fences, MCP record writers (6,212 production lines)    | **Renamed.** `studioServer.ts` already exposes `studio_apply_edits` over a `mutation_batch` — the "every hand gesture as an MCP op" surface exists; CS3 renames it and adds to it. `requiredAction` appears zero times, so dropping required actions costs nothing.                             |
| CS2 Task 6 atomic cutover                                                                        | **Never started.** No bridge, manifest, or renderer work exists — the pivot happens before the expensive surface.                                                                                                                                                                               |
| CS2 Task 8 Director layout system (docked/split/narrow without remounting)                       | **Never started, and now cancelled.** Replaced by one collapsible docked rail.                                                                                                                                                                                                                  |
| CS2 Cut UI removal                                                                               | **Reversed.** CS3 has a Cut, narrowed to film-level work.                                                                                                                                                                                                                                       |

**Schema version: CS3 claims `schemaVersion: 2`.** No user has ever persisted a schema-2 record —
the cutover never happened, and Studio is behind `AIONUI_ENABLE_CREATIVE_STUDIO`, off by default.
There is no version 3, no third sniff branch, and no second unsupported state. Internal
`Forge-Dev-2` profiles holding CS2-shaped schema-2 records will fail validation into the existing
loud quarantine path, which is correct and already specified.

---

## Global constraints

1. **Clean cutover, no migration.** Do not write a V1→V2 converter, a compatibility projection, a
   reset button, or startup cleanup. `schemaVersion: 1` returns `unsupported_prototype_schema` and
   its complete project tree remains byte-for-byte unchanged.
2. **No unsupported-profile side effects.** Before summary repair, `.part` cleanup, proposal or
   reference reaping, command mailbox creation, watchers, job recovery, resolver access, adapter
   access, polling, or protocol installation, classify the project as supported V2 or unsupported
   V1. Poison every forbidden dependency in tests.
3. **Temporary additive staging is not product compatibility.** Tasks 1–6 may introduce V2 types and
   unregistered V2 seams while the V1 UI still compiles. They must not project V1 as V2 or expose two
   user-selectable contracts. Task 7 switches all public paths atomically and deletes the legacy
   scene providers/types/tests before Gate 2 review.
4. **One free mutation authority.** Renderer free-authoring IPC and Director processing call the same
   pure ordered reducer inside the store queue. The reducer imports no filesystem, IPC, renderer, job
   manager, provider resolver, adapter registry, polling, retry, cancel, or render code.
5. **Reviewed spend only.** The only paid boundary is main's `prepare` → human `confirm` protocol.
   Director reference/generation requests are queued for human review. Accepting a proposal may
   populate a gate but never confirms it. No Director path may submit, retry, cancel, download,
   render, resolve routes/providers, invoke adapters, or mint a spend authorization.
6. **Free operations may create future spend, and must say so.** New in CS3. Tail-trimming a
   non-final shot and reordering shots inside a beat are free at the moment they happen but mark
   downstream frames stale. Any surface that performs one must show the staleness it created, and the
   render gate must quote the cascade as a distinct priced option — never fold it into a flat total.
7. **Nothing authored or paid for is destroyed.** Park, do not delete. Beats, shots, and takes are
   removed from the film by lifting them to the Bin. Authored text that is replaced goes to the
   beat's line history. A shot that has takes cannot be deleted at all.
8. **One revision, no replay.** Each successful free batch writes one project revision and one
   durable result. Any operation failure rolls back the entire batch. Stale and ambiguous outcomes
   never auto-retry.
9. **Film words for what the user authors; machine words for what the machine consumes.** Beat, shot,
   take, cut, coverage, continuity are film words and appear in the UI. Prompt, seed, route, first
   frame, render are machine words and stay in the code and the technical readouts. Do not dress
   "prompt" up as "direction".
10. **The director acts before the picture exists; the human decides after it does.** Director scope
    is anything derivable from text or stills. Motion judgements — whether a cut works, which take is
    good, rhythm — are the human's and are never automated.
11. **No hidden legacy UI.** Final source has Table, Board, beat panel, and Cut only. Delete the
    scene-based Write, Produce, Review, Export, and auto-submit UI rather than leaving it compiled
    but unreachable.
12. **Directory ratchet.** Add no peer under directories already above ten children. Keep every new
    directory at two to ten direct children. Re-audit counts at every delivery gate.
13. **Keys land with the string; translation is deferred on purpose.** Every renderer-visible string
    added by a task ships as an i18n key under `creativeStudio.workspace.*` with `en-US` authored,
    placeholder and plural parity included. Hardcoded strings are a hard blocker per AGENTS.md, and
    `i18n-keys.d.ts` is generated, so keys are compile-time checked — skipping them means an
    extraction retrofit across the whole UI later, and it makes every upstream AionUi locale merge
    worse. The other eleven locales are **explicitly deferred to one named pass before release**:
    `check-i18n.js` reports missing non-reference keys as a warning rather than an error, and
    `i18n-config.json` sets `fallbackLanguage: "en-US"` with the loader doing
    `mergeWithFallback`, so an untranslated key renders English rather than a key or a crash.
    Persian uses logical CSS and bidi isolation regardless, since layout is not translation.

    **Budget that deferred pass as design work, not translation.** The film vocabulary is
    load-bearing — Beat, Shot, Look, Action, Coverage, Slate, Bin, Lifted, hard cut versus continuity
    break — and several strings are themselves the explanation ("Reading order is play order"). A
    literal translation can break the model the same way "Clip" broke it in English, so that pass
    needs a designer in the room with the translator.

14. **Strict TDD.** For each behavior: write the smallest failing test, run it and record the exact
    failure, implement the minimum production change, rerun focused tests, kill at least one risky
    mutation, restore, then run the task gate. Never weaken a timeout or assertion to obtain green.
15. **Independent reviews.** After each delivery gate, freeze an exact commit and obtain read-only
    diff review. Critical/Important findings block the next gate.
16. **Feature/release boundary.** Preserve `AIONUI_ENABLE_CREATIVE_STUDIO`; do not enable Studio by
    default, remove the flag, claim packaged acceptance, or launch a provider as part of this plan.
17. **Per-file coverage ratchet.** Keep
    `vitest.creative-studio-coverage.config.ts` equal to the executable production diff for each
    delivery head. Every listed file must remain at least 80% lines and 80% branches; a root
    aggregate percentage is not a substitute.

---

## Frozen schema-2 contract

Task 1C implements these names exactly. Later tasks may not rename or reinterpret them without a spec
amendment and a new independent contract review.

### Limits and text bounds

```ts
export const STUDIO_PROJECT_SCHEMA_VERSION = 2 as const;
export const STUDIO_MAX_BEATS = 24;
export const STUDIO_MAX_SHOTS_PER_BEAT = 8;
export const STUDIO_MAX_SHOTS_PER_PROJECT = 96;
export const STUDIO_MAX_BIN_BEAT_ITEMS = 24;
export const STUDIO_MAX_BIN_SHOT_ITEMS = 96;
export const STUDIO_MAX_BIN_TAKE_ITEMS = 96;
export const STUDIO_MAX_LINE_HISTORY_PER_BEAT = 20;
export const STUDIO_MAX_UNDO_ENTRIES = 20;
export const STUDIO_MIN_SHOT_SECONDS = 4;
export const STUDIO_MAX_SHOT_SECONDS = 15;
export const STUDIO_MAX_GENERATIONS_PER_SHOT_PER_SUBMISSION = 4;
export const STUDIO_LOOK_SOFT_WORD_LIMIT = 25;
export const STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24;
export const STUDIO_MAX_REFERENCE_REQUEST_SHOTS = 24;
export const STUDIO_MAX_DIRTY_SHOTS_REPORTED = 96;
export const STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_SHOT = 24;
export const STUDIO_MAX_MUTATION_OPERATIONS = 32;
```

- IDs match the existing safe-ID contract: 1–256 ASCII letters, digits, `_`, or `-`.
- Project name 256; brief 16 KiB.
- Beat title 256; **action** 4 KiB; **look** 8 KiB.
- Shot **line** 8 KiB; narration 4 KiB; on-screen text 1 KiB.
- Shot duration is an integer **4–15 seconds**. There is no image-duration branch: every shot is
  video, and stills are takes on the image route.
- **Project `targetDurationSeconds` is an integer 5–1440 seconds.** CS2's 5–60 bound was already
  wrong — 96 shots at 15s is 24 minutes — and a three-minute film makes it visible. Widen it in the
  validator _and_ in the summary schema; the two must agree.
- **Bin capacity is enforced per kind, and only per kind.** There is no independently meaningful
  total. This replaces CS2's arrangement, where a 120-item total was enforced and the per-kind
  maximum that mattered was not.
- **The 25-word Look limit is soft.** The counter warns; word 26 is allowed. Rules are hard;
  guidance is soft, and the Look is guidance.
- Asset `durationSeconds` is a finite number greater than `0` and at most `Number.MAX_SAFE_INTEGER`.
  `Number.MAX_VALUE` is not a bound: it admits `1e308` and makes trim comparisons vacuously true.

Generation, reference-request, dirty-report, and MCP projection limits remain independently named
even when values coincide, and **each validator consumes the constant named for its own contract**.
`STUDIO_PROJECT_SCHEMA_VERSION` is the only source of the persisted version literal in validators and
factories. Every constant added must have at least one consumer by the end of its owning task; an
unreferenced limit is not centralized.

### Persisted entities

```ts
export type StudioBeat = {
  id: string;
  title: string;
  action: string; // the one thing you write
  look: string; // conditioning inherited by every shot
  actionRevision: number; // bumped on every action edit; derivation staleness anchor
  targetSeconds: number | null; // authored intent, never a constraint
  shotOrder: string[];
  lineHistory: StudioLineHistoryEntry[];
};

export type StudioLineHistoryEntry = {
  id: string;
  shotOrdinal: number; // historical 1..8 provenance; may exceed the current shot count
  text: string;
  capturedAt: string;
};

export type StudioShot = {
  id: string;
  line: string;
  derivation: 'derived' | 'detached';
  derivedFromActionRevision: number | null; // null when detached
  narration: string;
  onScreenText: string;
  durationSeconds: number; // 4–15, what it generates
  trimInSeconds: number | null; // head trim, what it plays
  trimOutSeconds: number | null; // tail trim, what it plays
  chainBreak: 'none' | 'hard_cut'; // author-chosen; never system-set
  seedStillId: string | null; // explicit image-take pin; null derives latest or seed-pending
  selectedTakeId: string | null; // selected video take only
  assetIds: string[];
  jobIds: string[];
};

export type StudioBinItem =
  | { kind: 'beat'; beatId: string; reason: 'lifted' | 'alternate' }
  | { kind: 'shot'; beatId: string; shotId: string; reason: 'lifted' }
  | { kind: 'take'; assetId: string; reason: 'lifted' | 'alternate' };

export type StudioProposedShot = {
  shotId: string; // an existing ID to preserve, or a safe caller-minted new ID
  line: string;
  narration: string;
  onScreenText: string;
  durationSeconds: number;
  chainBreak: 'none' | 'hard_cut';
};

export type StudioCoverageApplyResult = {
  beatId: string;
  createdShotIds: string[];
  retainedShotIds: string[];
  removedShotIds: string[];
  fixedShotIds: string[];
};

export type StudioConditioningInputSnapshot =
  | { kind: 'seed_still'; assetId: string }
  | {
      kind: 'predecessor_frame';
      predecessorShotId: string;
      takeAssetId: string;
      frameAssetId: string;
      endpointSeconds: number;
    };

export type StudioFrameExtraction = {
  id: string;
  shotId: string;
  takeAssetId: string;
  endpointSeconds: number;
  frameAssetId: string | null;
  status: 'pending' | 'extracting' | 'ready' | 'failed';
  errorCode: 'decode_failed' | 'source_missing' | 'storage_error' | null;
};

export type StudioSpendPolicy = {
  currency: string;
  maxPerBatchMinorUnits: number;
};

export type StudioQuotedGeneration = {
  id: string;
  shotId: string;
  purpose: 'seed_still' | 'video_take';
  routeId: string;
  generationCount: number;
  durationSeconds: number | null; // null for per-generation image pricing
  conditioningInput: StudioConditioningInputSnapshot | null; // null for seed stills
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
};

export type StudioSubmissionQuote = {
  id: string;
  projectId: string;
  projectRevision: number;
  rateCardDigest: string;
  currency: string;
  baseItems: StudioQuotedGeneration[];
  cascadeItems: StudioQuotedGeneration[];
  lowerMinorUnits: number;
  upperMinorUnits: number;
  expiresAt: string;
};

export type StudioSpendAuthorization = StudioSubmissionQuote & {
  confirmedAt: string;
  idempotencyKeys: { itemId: string; generationIndex: number; key: string }[];
};

export type StudioSpendReceipt = {
  authorizationId: string;
  itemId: string;
  jobId: string;
  purpose: 'seed_still' | 'video_take';
  routeId: string;
  currency: string;
  rateUnit: 'generation' | 'second';
  rateMinorUnits: number;
  durationSeconds: number | null;
  generationIndex: number;
  generationCount: number;
  totalMinorUnits: number;
};

export type StudioUndoPatch =
  | {
      kind: 'project_fields';
      before: {
        brief: string;
        beatOrder: string[];
        imageRouteId: string | null;
        videoRouteId: string | null;
        spendPolicy: StudioSpendPolicy | null;
        bedAssetId: string | null;
        matchToShotId: string | null;
      };
      afterDigest: string;
    }
  | {
      kind: 'beat_fields';
      beatId: string;
      before: StudioBeat | null;
      afterDigest: string;
    }
  | {
      kind: 'shot_fields';
      shotId: string;
      before: Omit<StudioShot, 'assetIds' | 'jobIds'> | null;
      beforeBeatId: string | null;
      beforeIndex: number | null;
      afterDigest: string;
    }
  | { kind: 'bin'; before: StudioBinItem[]; afterDigest: string };

export type StudioUndoEntry = {
  id: string;
  sourceRevision: number;
  label: string;
  patches: StudioUndoPatch[];
};
```

**`StudioBinItem` is reference-only and has exactly three kinds: `beat`, `shot`, and `take`.** Every
kind names an existing record. Beat and take entries may be `lifted` or `alternate`; a shot entry is
`lifted` only because there is no add-alternate-shot product path. Authored text never enters the Bin
— it goes to the owning beat's `lineHistory`.

Beat and shot IDs are immutable and unique within a project. Every beat is either in `beatOrder` or
in one beat Bin item, exactly once. Every shot is either in exactly one beat's `shotOrder` or in
exactly one shot Bin item, never both and never neither. A shot Bin item stores the `beatId` of the
shot's owner at park time; that beat must still exist, may itself be active or binned, and is the only
beat into which the shot may be restored. The reducer records this ownership edge while the shot is
active, and validation treats the persisted `beatId` as the parked shot's authoritative owner. A take
Bin alias points to a canonical, non-selected take owned by exactly one shot and cannot name a current
seed or conditioning input. Every shot-owned asset, job, receipt, frame, and take relation continues
to resolve to that shot while it is binned. Validation rejects orphaned, duplicated, cross-owned, or
active-and-binned identities.

`StudioAsset.mediaKind` is widened to `'image' | 'video' | 'audio'`. Audio is imported managed
media only in this plan; `bedAssetId` must resolve to a canonical project-owned audio asset.
`StudioAsset.shotId` is nullable only for project-owned audio/exports; canonical image/video takes,
posters, and conditioning frames remain shot-owned. Image seed stills and video takes remain
distinct by media kind even though both are shot-owned. Video generation jobs
persist `purpose: 'video_take'`, `authorizationId`, `generationIndex`, and the exact
`StudioConditioningInputSnapshot`; image generation jobs persist `purpose: 'seed_still'` with the
same authorization link. Conditioning-frame extraction is represented by
`StudioFrameExtraction`, not by a provider job status.

The project persists `spendPolicy`, `spendAuthorizations`, `frameExtractions`, and a capped
`undoHistory`. Prepared quotes live only in a bounded main-process cache and expire; restart requires
a new prepare and cannot spend an old UI payload. Confirm copies the re-derived quote by value into
`spendAuthorizations` in the same revision as its jobs. A successful free authoring batch writes its
inverse in the same project revision. Paid lifecycle bookkeeping and local recovery maintenance do
not create undo entries; undo never reverses external spend.

### Duration: authored target, derived actual

- **`actual`** = the sum of a beat's shots' _played_ duration (`durationSeconds` minus trims).
  Derived, never persisted as a competing author-editable value.
- **`targetSeconds`** = nullable authored intent. Never constrains shot durations; the engine never
  has to satisfy it. It is what the director works toward when proposing coverage.
- **A beat with no coverage and a non-null target contributes `targetSeconds` to the film**, because
  it exports as a slate of that length. A no-coverage/null-target beat is `duration_pending`: valid
  authoring state, but not renderable.
- The film-duration projection is therefore `{ knownSeconds, unresolvedBeatIds }`, where
  `knownSeconds = Σ (actual if covered else target when present)`. The under/over readout and film
  render are available only when `unresolvedBeatIds` is empty; no code coerces null to zero.
- Target and actual **must render distinctly** (`~24s target` versus `24s`). Rendering them
  identically is the defect this split exists to prevent.

### The chain

- **Chains are strictly beat-scoped.** Beats are therefore the unit of parallelism: a project at the
  cap is 24 parallelisable groups, never one long series. Freeze this as an invariant.
- The **head of a chain segment** conditions on a still (`seedStillId`); every other shot conditions
  on the previous shot's trim-aware conditioning frame. A shot heads a segment if it is first in
  `shotOrder` **or** its `chainBreak` is `hard_cut`. `seedStillId` is an explicit pin; when null, the
  effective seed is the eligible completed image take with greatest `createdAt`, breaking ties by
  lexical asset ID. A head with neither pin nor eligible take is valid `seed_pending` authoring state
  and blocks video submission rather than persistence.
- **`hard_cut` is author-chosen; continuity break is system-detected.** They are different things and
  must never share a name or a visual treatment. A continuity break means the frame a shot was
  generated from no longer exists — upstream was re-rendered or tail-trimmed.
- **Re-rendering shot N marks N+1…end stale, not invalid.** Stale shots still play. Cascade is opt-in
  and must be separately priced at the gate.
- **Trim asymmetry:** head trims are always free and never break continuity. Tail trims break
  continuity unless the shot is last in its chain segment.
- **Reordering shots inside a beat rewrites the chain and is not free.** Reordering beats is free.
  The UI must not make the two look alike.
- **No chain advance without the exact frame asset on disk.** Each video job stores its immutable
  conditioning snapshot. Staleness is a pure comparison between that snapshot and the current
  predecessor/selected-take/trim endpoint or selected seed; no process-local flag is authoritative.

### Derivation

- Shot lines are `derived` from the beat's action, or `detached`. Editing a line detaches it.
- **Detach is reversible.** Re-deriving writes the hand-written line to the beat's `lineHistory`,
  never to nothing.
- Editing the action bumps `actionRevision`, leaves detached lines untouched, and marks derived lines
  stale by comparison against `derivedFromActionRevision`.
- Derived text is **stored, not recomputed** — it must survive offline and be diffable. It is
  readable as `script.md`, which is an **on-demand export shape**, not a file kept at the project
  root. Nothing is written to disk that looks editable but silently discards edits: this repo's
  `Knowledge Base/` folder trained users that a visible file is the source of truth, and a generated
  `script.md` sitting beside it would read as the same contract while being the opposite. It is also
  why `script.md` is never ingested — the reducer stays the only writer.
- **Re-splitting coverage may only change dependency-free shot boundaries.** Shots with any asset,
  job, selected/seed media, conditioning-frame dependency, match target, or other persisted
  reference are fixed points. `StudioProposedShot` is the complete ordered result. Its
  existing IDs preserve identity; new safe IDs are caller-minted. The reducer derives the fixed set,
  requires the proposal's `fixedShotIds` to match it, and requires every fixed shot's cumulative
  start/end boundary to remain unchanged. Removed dependency-free detached lines enter beat-scoped
  history. The apply result returns ordered `createdShotIds`, `retainedShotIds`, `removedShotIds`,
  and `fixedShotIds`.
  Created, retained, and fixed IDs follow proposal order; removed IDs follow the prior `shotOrder`.

### The Cut

The Cut is film-level only: beat order, one bed, match-to, export. It cannot reach inside a beat.
Trims, retiming, and take selection live in the beat panel.

**The Cut is not a record.** `cuts` and `activeCutId` do not exist. Because the Cut only reorders
beats and the project already has a beat order, that order _is_ the film. The project carries
`bedAssetId: string | null` and `matchToShotId: string | null` and nothing else. This deletes the
cut-clip record, its validator, and the dormancy rule that kept binned beats' cut entries alive.

- `MATCH TO` in v1 is **prompt-level**, therefore a re-render, therefore costed, and the UI must say
  so. A real colour pipeline is a separate later decision.
- The bed **fades out at the cut's end**. Never extend, never hard-truncate.
- **`AUTO-DUCKED` must not ship.** There is no voice track to duck for until TTS lands. `narration`
  and `onScreenText` are retained as authored fields with no downstream consumer.
- Export retention keeps the last **5 per shape**, oldest evicted, listed in the assets drawer with
  its size. The existing `projectMaxBytes` write-admission cap remains a fail-before-mutation safety
  bound for every managed write; it is not a user budget and never authorizes eviction of authored
  or paid media.
- **Retention reaches exports only — never takes, never conditioning frames.** "A missing frame is
  always re-derivable" holds only while the take video survives; eviction that reaches takes turns
  recovery into a re-render that charges.

### The conditioning frame is not the poster

The Board poster is representative artwork in `thumbnails`. The conditioning frame is chain input
in `conditioningFrames`, keyed by the selected immutable take and its played endpoint. They have
different provenance and retention authority and may not alias merely because an untrimmed provider
output happens to contain the same pixels.

The endpoint is exactly `take.durationSeconds - (trimOutSeconds ?? 0)`; head trim is irrelevant.
Extraction identity is the stable digest of canonical `{ shotId, takeAssetId, endpointSeconds }`, so
restart and duplicate scheduling converge on one record. A ready record is authoritative only when
its managed frame inode/bytes and all three provenance fields still match.

- **Read outputs by role, never by position.** `jobManager` already filters
  `outputs.filter((o) => o.role === 'poster')`. The fragile code is `canonicalVideoPosterV2` reading
  `outputAssetIds[1]`; fix that instead of constraining output count. This replaces any
  "exactly two outputs" rule — with role-addressed reads, a third output is harmless.
- **Extraction is a named local lifecycle, not a provider job.** An untrimmed take may adopt a
  provider-returned last frame after proving exact take provenance. Every other route/endpoint is
  decoded by main. The durable extraction state is `pending | extracting | ready | failed`; it has
  no provider route, adapter, receipt, retry charge, or `StudioJobStatus` value.
- **No chain advance without the frame asset on disk.** Because takes are immutable and on disk, a
  missing frame is always re-derivable, so closing the window mid-chain stalls the chain rather than
  losing it, and recovery asks "is the exact selected-take/endpoint frame there?" rather than
  re-rendering. Tail trim or take selection creates a new extraction key before downstream work.
- Conditioning frames are ineligible for take selection, seed selection, and the Bin by collection.
- **Storage:** flat `fileName`, location encoded by the collection. `isSafeFileName` rejects path
  separators, and the store quarantines any record carrying a path-shaped key at any depth, so a
  take-relative path may never appear in the record.
- Mid-chain failure keeps the partial, bills only completed generations, and resumes from the break.

### Money

- **Price source is a config rate card** — per route, with explicit currency and unit, owned by
  whoever owns route bindings. Video routes are per second; image routes are per generation. Not a
  provider API in v1. The UI must say the number comes from our rate card, not from the provider.
- **The estimate is a range, not a point**, once takes are in play. Quote the first pass and state
  that revisions are extra. In v1 the lower bound is one generation per shot and the upper bound is
  the user-requested 1–4 generations per shot; work beyond that authorization requires a new quote.
- All three numbers in a gate — headline cost, generation count, button label — come from **one set
  of shots**. In-flight work is context, never billed again.
- **No reconciliation.** Actual computed from the same table as the estimate can only differ by a
  generation count known before dispatch. Instead, persist a **receipt** per take on the **job**:
  authorization ID, purpose, route, currency, rate unit/value, seconds when applicable, generation
  index/count, and integer total — stored by value, never as a card reference, so a card update
  cannot rewrite history.
- **Budget cap is a pinned brief rule in the user's mental model and a separate mechanism in the
  code.** It persists as `StudioSpendPolicy`, not a `StudioRulePredicate`. Scope in v1 is per batch;
  the quote's upper bound in one explicit currency must fit `maxPerBatchMinorUnits`.
- **Prepare never spends.** It snapshots revision, exact ordered shot/cascade sets, conditioning
  inputs, routes, generation counts, rate-card digest/value, currency, bounds, and expiry into a
  `StudioSubmissionQuote`.
- **Confirm is the only spend authority.** Inside the project queue it re-derives the quote; any
  mismatch is stale. Success durably stores a `StudioSpendAuthorization` and idempotent jobs before
  the first provider call. Quote expiry governs confirmation only; once confirmed, recovery finishes
  the authorized jobs regardless of the old quote expiry. Restart may dispatch only authorized jobs;
  accepting a Director proposal cannot manufacture or confirm authorization.

### Validator totality and lookup rules

Carried verbatim from CS2 Amendment 1. Schema-independent; it cost three confirmed defects to learn.

`validateStudioProjectV2` is a total function. Every input, including a corrupt or hostile persisted
record, returns `true` or `false`. It never throws: callers read `false` as "quarantine this record",
and an exception escaping a declared type guard bypasses that path entirely.

- **Resolve every record entry by own key.** `project.shots[id]`, `project.assets[id]`, and
  `project.jobs[id]` inherit `Object.prototype` members, so an ID of `constructor`, `toString`, or
  `__proto__` — each of which satisfies the safe-ID contract — resolves to an inherited value that is
  not `undefined`. Guard with `Object.hasOwn(record, id)`, or re-check identity with
  `resolved?.id === id`. A bare `=== undefined` guard is not sufficient, and reading a field through
  it throws.
- **Walk every graph iteratively with an explicit stack.** Job count is unbounded by this contract,
  so a recursive retry-lineage walk raises `RangeError` on a long chain instead of returning `false`.
  The shot chain has the same shape and the same exposure.
- **Hoist every key set to module scope.** A per-item `new Set([...])` inside a validator allocates
  once per Bin entry on every project read and write.

### Load and error states

```ts
export type StudioProjectLoadResult =
  | { status: 'supported'; project: StudioRendererProject }
  | { status: 'unsupported_prototype_schema'; projectId: string }
  | { status: 'not_found'; projectId: string };

export type StudioProjectListResult = {
  projects: StudioProjectSummary[];
  unsupportedProjectIds: string[];
  quarantinedProjectIds: string[]; // malformed schema-2 only
};
```

V1 is not corrupt. Unknown or malformed V2 is corrupt and follows the existing loud
storage/quarantine path.

### Mutation vocabulary

```ts
export type StudioMutationOperation =
  | { kind: 'set_brief'; brief: string }
  | {
      kind: 'add_beat';
      beatId: string;
      beat: StudioEditableBeat;
      firstShotId: string;
      firstShot: StudioEditableShot;
      beforeBeatId: string | null;
    }
  | { kind: 'edit_beat'; beatId: string; changes: StudioEditableBeatChanges }
  | { kind: 'reorder_beats'; beatOrder: string[] }
  | { kind: 'park_beat'; beatId: string }
  | { kind: 'restore_beat'; beatId: string; beforeBeatId: string | null }
  | {
      kind: 'add_binned_beat';
      beatId: string;
      beat: StudioEditableBeat;
      firstShotId: string;
      firstShot: StudioEditableShot;
    }
  | { kind: 'add_shot'; beatId: string; shotId: string; shot: StudioEditableShot; beforeShotId: string | null }
  | { kind: 'edit_shot'; shotId: string; changes: StudioEditableShotChanges }
  | { kind: 'delete_shot'; shotId: string } // dependency-free only
  | { kind: 'park_shot'; shotId: string }
  | { kind: 'restore_shot'; shotId: string; beforeShotId: string | null }
  | { kind: 'reorder_shots'; beatId: string; shotOrder: string[] } // rewrites the chain
  | {
      kind: 'apply_coverage';
      beatId: string;
      shots: StudioProposedShot[];
      fixedShotIds: string[];
    }
  | { kind: 'set_hard_cut'; shotId: string; hardCut: boolean }
  | { kind: 'set_seed_still'; shotId: string; assetId: string | null }
  | { kind: 'trim_shot'; shotId: string; trimInSeconds: number | null; trimOutSeconds: number | null }
  | { kind: 'redetach_line'; shotId: string; line: string }
  | { kind: 'rederive_line'; shotId: string }
  | { kind: 'restore_line'; shotId: string; historyEntryId: string }
  | { kind: 'park_take'; shotId: string; assetId: string }
  | { kind: 'add_alternate_take'; shotId: string; assetId: string }
  | { kind: 'restore_take'; shotId: string; assetId: string }
  | { kind: 'reorder_bin'; bin: StudioBinItem[] }
  | { kind: 'select_take'; shotId: string; assetId: string }
  | { kind: 'set_routes'; imageRouteId: string | null; videoRouteId: string | null }
  | { kind: 'set_spend_policy'; policy: StudioSpendPolicy | null }
  | { kind: 'set_match_to'; shotId: string | null }
  | { kind: 'set_bed'; assetId: string | null }
  | { kind: 'undo_last'; entryId: string };
```

`delete_shot` remains an active-shot, dependency-free operation for ungenerated coverage.
`park_shot` is the non-destructive path for a shot with paid lineage: it removes the shot ID from its
current owner's `shotOrder`, appends exactly
`{ kind: 'shot', beatId: owner.id, shotId, reason: 'lifted' }`, and leaves the shot plus every owned
asset, terminal job, receipt, authorization, selected/seed take, and completed/failed frame record
unchanged. It refuses while the shot has a nonterminal job or a pending/extracting frame operation.
It also derives inbound references from current active project and chain state and fails closed for a
current `matchToShotId` or a nonterminal downstream job/extraction actively consuming the shot or its
take/frame lineage. Historical terminal downstream conditioning snapshots and receipts are retained
lineage, not blockers; parking makes the affected active downstream chain stale. The author must
clear or repoint Match To, or wait for/cancel the active consumer through its existing reviewed
lifecycle, before retrying. Parking never cancels, rewrites, or silently detaches it.

`restore_shot` consumes the one matching shot Bin item and inserts the same shot ID into that item's
recorded `beatId` before `beforeShotId` (or at the end for `null`). The recorded beat may itself be
active or binned, but must still exist; the anchor must belong to it and the eight-shot active
capacity must hold. Restore never reparents the shot and never rewrites paid lineage. `park_beat`,
`park_shot`, and `park_take` create `lifted` entries; `add_binned_beat` and `add_alternate_take` create
`alternate` entries. There is no add-alternate-shot operation and no generic `remove_bin_item` that
may orphan a referent. `apply_coverage` reads and replaces only the named beat's active `shotOrder`;
it never edits or deletes a binned shot or its lineage.

Editable change objects are exact-key, nonempty partials of authored fields only. Callers mint safe
IDs; main rejects collisions and returns created IDs in operation order. `reorder_*` inputs are exact
permutations. Batches are 1–32 operations. `undo_last` must be the only operation in its batch and
must name the current top entry in the bounded persisted undo journal. Undo patches are internal
validated before-fragments, never accepted from renderer, IPC, MCP, or a proposal. Each patch's
`afterDigest` must still match the current authored fragment. Shot patches never overwrite
`assetIds`/`jobIds`; removing a beat/shot created by the undone edit is refused if it gained a
persisted dependency. Any mismatch returns `undo_conflict`, consumes no entry, and changes no bytes.

---

## Decisions closed on 2026-08-18

These decisions were inferences this plan drew rather than rulings it received. All are now closed and
folded into the contract above. Recorded so a later reader can tell a ruling from an assumption.

1. **Shot media model — confirmed as drafted.** Shots carry no `mediaKind`; every shot is video.
   `mediaKind` lives only on the asset, so stills are image takes on the image route. A segment head
   may persist with `seedStillId: null`; that is seed-pending and blocks video submission. A hard cut
   establishes a new segment and therefore needs a selected or newly generated seed before video.
2. **The Cut collapses into project fields.** `cuts` and `activeCutId` are deleted; the project
   carries `bedAssetId` and `matchToShotId`. There are no alternate named cuts in CS3.
3. **Conditioning extraction is a durable local lifecycle, not a provider job.** It is keyed by
   selected take plus played endpoint and stored separately from Board posters. See _The
   conditioning frame is not the poster_.
4. **`RESET` is a renderer draft discard.** It uses the existing `useDraftPersistence`, is not a
   reducer operation, and never reaches main. This is what makes "RESET cannot lose writing" true; it
   is why RESET is absent from the mutation vocabulary.
5. **`script.md` is an on-demand export shape**, not a file kept at the project root and never
   ingested.
6. **Storage has a safety cap, not an eviction budget.** Preserve fail-before-mutation write
   admission; only exports participate in count-based retention.
7. **Seedance's last frame is an optimization, not universal provenance.** It can satisfy an
   untrimmed exact-take conditioning request; a trimmed endpoint is decoded locally.
8. **The Bin has exactly three reference kinds.** Beats and takes may be `lifted` or `alternate`;
   shots are `lifted` only and retain their original `beatId` ownership for exact restoration.
9. **Paid work uses prepare/confirm.** Quotes and authorizations are main-owned durable records;
   proposal acceptance and Director paths cannot dispatch.

### Blocker closure ledger

| Former blocker                                      | Closed contract / owning task                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Docs fork did not contain green Gate 1              | Execute only with `7176e3f6b` as ancestor; CS3 docs were transplanted onto that lineage.                                                          |
| No valid pre-seed authoring state                   | Null pin derives latest still or projects `seed_pending`; Task 5 owns reviewed seed jobs and the video readiness gate.                            |
| Full-video poster could not represent a tail trim   | Conditioning frame is distinct, keyed by selected take plus played endpoint; Tasks 1C/5 own provenance, extraction, recovery, and the 10s→8s RED. |
| Bin had two versus three incompatible kinds         | Exactly `beat \| shot \| take`; a shot reference is lifted-only, preserves its original beat and paid lineage, and has no generic removal.        |
| Ever-rendered shots could never leave coverage      | `park_shot`/`restore_shot` move the exact shot reference across the active/Bin XOR; Tasks 1C/2/5 own lineage and fail-closed dependency proofs.   |
| Coverage proposal/result type was undefined         | `StudioProposedShot` and ordered `StudioCoverageApplyResult` are frozen above; Task 2 owns fixed-boundary enforcement.                            |
| Re-split invalidated historical line ordinals       | Ordinal is historical 1–8 provenance, independent of current shot count; Task 1C owns shrink/restart REDs.                                        |
| Native names landed before atomic cutover           | Tasks 1B/6 keep native/manifest/bridge byte-identical; all public names move together in Task 7.                                                  |
| Runtime activation and rollback were unspecified    | Task 7 owns the five-state single-flight controller, mixed-root filtering, rollback, retry, and shutdown races.                                   |
| Proposal/reference ownership stopped at publication | Task 6 owns V2 list/watch/decision/reap, commit attribution, restart repair, and reviewed reference handoff.                                      |
| Pricing types were detached from dispatch authority | Tasks 4/5 own exact-unit rate cards, cached quotes, persisted authorization/jobs-before-provider, receipts, budget, and recovery.                 |
| Undo was only a label                               | Tasks 1C/2/14 own bounded before-fragment journal, post-edit digests, conflict rules, CAS, and paid-state exclusion.                              |
| Gates 2–4 were not executable                       | Each gate now names focused suites, full suite, per-file 80/80 coverage, Playwright/visual evidence, static checks, and independent reviews.      |

---

## Delivery Gate 1 — schema, reducer, store, money

> **Task 1 is three passes, deliberately.** The rename and the schema extension have different risk
> profiles and different proofs, and bundling them destroys both. Pass 1A cannot change behaviour, so
> the whole suite must stay green with no assertion touched — that proof is available exactly once
> and only if nothing else rides along. Pass 1B changes names that cross a boundary, so expectations
> move but logic does not. Pass 1C is the only pass that adds meaning. Run them as three commits with
> three reviews; a red test then names its own cause.

### Task 1A — Rename internal identifiers only

Zero behaviour change. Nothing in this pass may alter a byte that is serialized, sent over IPC, or
named in an MCP schema.

**Rename:** type names (`StudioSection` → `StudioBeat`, `StudioClip` → `StudioShot`,
`StudioShelfItem` → `StudioBinItem`), function names (`validateSection` → `validateBeat`), local
variables and parameters (`clipOwners` → `shotOwners`), constant identifiers
(`STUDIO_MAX_CLIPS_PER_SECTION` → `STUDIO_MAX_SHOTS_PER_BEAT`), and test helper names (`makeClip` →
`makeShot`).

**Do not touch:** any string literal, and any property name on a persisted or wire-facing type.
`sections`, `clips`, `shelf`, `clipId`, and `sectionId` are serialized keys — renaming them is a
contract change and belongs to 1B. The temptation on a find-and-replace is to sweep `'add_section'`
and `clipId` along with everything else; that silently converts a provably safe pass into a
contract-breaking one.

**Steps**

- [ ] Confirm both spec pins still match the committed files (`shasum -a 256`) and the approved
      authority record is present in the direction document. Stop on either mismatch. The inference
      decisions are already closed — see _Decisions closed_.
- [ ] Confirm Gate 1 is green before starting. A rename entered from a red baseline is unverifiable.
- [ ] Perform the identifier rename across `packages/` and `tests/`.
- [ ] **Gate — the free proof:** `bun run test` fully green, and `git diff` contains **no change to
      any assertion, expectation, or fixture value**. If an expectation moved, something in the pass
      crossed a contract boundary; find it and move it to 1B rather than updating the test.
- [ ] Run `bunx tsc --noEmit` and `bun run lint --quiet`.
- [ ] Commit: `refactor(studio): rename internal identifiers to beat and shot`.

### Task 1B — Rename wire and persisted names

Behaviour changes; semantics do not. Expectations and fixtures move in this pass, and that is the
signal that distinguishes it from 1A.

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: the schema-2 store seams and every affected test

**Steps**

- [ ] Rename persisted property names: `sections` → `beats`, `clips` → `shots`, `shelf` → `bin`,
      `sectionOrder` → `beatOrder`, `clipOrder` → `shotOrder`, `clipId` → `shotId`, `sectionId` →
      `beatId`, `storyLine` → `action`, `visualPrompt` → `look`, `shotPrompt` → `line`,
      `selectedAssetId` → `selectedTakeId`. Rename every schema-2 singular, plural, and compound wire
      form with them — including `sectionIds`/`clipIds`, `createdSectionIds`/`createdClipIds`,
      `payableClipIds`, `firstClipId`, `beforeSectionId`/`beforeClipId`, and capacity/projection keys.
      Move the validator's key Sets with them.
- [ ] Rename the MCP operation names carried in `studio_apply_edits`' `mutation_batch` —
      `add_section` → `add_beat`, `edit_section` → `edit_beat`, `reorder_sections` → `reorder_beats`,
      `park_section` → `park_beat`, `restore_section` → `restore_beat`, `add_clip` → `add_shot`,
      `edit_clip` → `edit_shot`, `delete_clip` → `delete_shot`, `reorder_clips` → `reorder_shots`,
      `select_shelved_take` → `restore_take`, `remove_shelf_alias` → `remove_bin_item`, and
      `reorder_shelf` → `reorder_bin`. `remove_bin_item` is a rename-only transitional variant; Task
      1C removes it when it installs the frozen no-generic-removal vocabulary. These are persisted and
      **unregistered MCP** contract changes only.
- [ ] Assert the native constants, payload schemas, provider inventory, manifest, bridge, preload,
      runtime, and renderer are byte-identical to the green Gate 1 baseline and contain no Beat/Shot
      provider vocabulary. Native/public work belongs to Task 7's atomic cutover.
- [ ] **Gate:** the whole suite green. Run everything, not the changed files; also run the native
      parity test as an absence oracle proving no V2 provider was staged early.
- [ ] **Review the diff for logic changes.** This pass should contain renames, moved expectations,
      and nothing else. Any conditional, bound, or branch that changed belongs in 1C.
- [ ] Commit: `refactor(studio): rename persisted and wire names to beat and shot`.

### Task 1C — Beat and Shot contracts and pure validation

The only pass that adds meaning.

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Delete: `packages/desktop/src/process/services/creative-studio/service/schema2/cuts.ts`
- Delete: `tests/unit/process/creative-studio/service/schema2/cuts.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/factories.test.ts`
- Modify: `tests/unit/process/creative-studio/types/canonicalTake.test.ts`
- Modify: `tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`

**Steps**

- [ ] Add the new persisted fields from the frozen contract: `actionRevision`, `targetSeconds`,
      `lineHistory`, `derivation`, `derivedFromActionRevision`, `chainBreak`, `seedStillId`,
      `trimInSeconds`, `trimOutSeconds`, `spendPolicy`, `spendAuthorizations`, `frameExtractions`, and
      `undoHistory`. Add and exact-validate every supporting proposed-shot, conditioning, extraction,
      quote/authorization, receipt, and undo type shown in the frozen contract; factories start all
      collections empty and policies/routes null.
- [ ] Delete `cuts` and `activeCutId` and the `cuts.ts` module; add `bedAssetId` and `matchToShotId`
      to the project. Widen `targetDurationSeconds` to 5–1440 in the validator **and** the summary
      schema together. Add managed `conditioningFrames` and widen assets to canonical imported
      audio; `bedAssetId` accepts audio only.
- [ ] Change `canonicalVideoPosterV2` to resolve the poster **by output role**, not by
      `outputAssetIds[1]`. RED that a job with a third output still resolves its cover.
- [ ] RED: unknown keys; duplicate ownership; orphan assets/jobs; beat or shot active-and-binned
      overlap; invalid Bin items of each kind; 25 beats; 9 active shots in one beat; 97 total unique
      shot records across active orders and shot Bin membership; each beat/shot/take Bin maximum at
      exactly N and N+1; shot duration 3 and 16; line history at 20 and 21. A shot Bin item adds no
      second project-shot budget: `STUDIO_MAX_SHOTS_PER_PROJECT` counts its referenced record once,
      while `STUDIO_MAX_BIN_SHOT_ITEMS` independently bounds the number of shot Bin entries. Accept
      every exact boundary.
- [ ] RED totality per the validator rules: an asset `shotId`, job `shotId`, Bin `assetId`,
      `selectedTakeId`, `seedStillId`, or `matchToShotId` of `constructor`, `toString`, or
      `__proto__`; a 20,000-link retry chain; a 20,000-link shot chain; an asset `durationSeconds` of
      `1e308`. Assert `toBe(false)` on each, never `toThrow`.
- [ ] RED asset ownership/media compatibility: project-owned audio accepted only for bed/import;
      shot-owned audio rejected; project-owned image/video rejected as takes; canonical image seed,
      video take, poster, conditioning frame, and export ownership each exact.
- [ ] RED the chain invariants: a segment head with no seed remains valid but projects
      `seed_pending` and cannot submit video; null pin plus completed image takes derives the latest
      deterministic seed; an explicit pin wins; a non-heading shot carrying a pin; a chain edge
      crossing a beat boundary; `chainBreak` set by anything but an author operation; and a
      conditioning snapshot whose recorded shot/take/frame IDs, ownership, or endpoint do not resolve
      to its exact immutable historical provenance. Equality with the **current** active predecessor,
      selected take, trim endpoint, or extraction key is not a schema-validity predicate; Task 2
      compares those values to project staleness.
- [ ] RED extraction state exactness: pending/extracting have no frame/error; ready has one canonical
      managed frame and no error; failed has no frame and one frozen error code; IDs are the stable
      canonical-input digest and duplicate inputs cannot create two records.
- [ ] RED the derivation invariants: `derived` with a null `derivedFromActionRevision`; `detached`
      with a non-null one; history ordinal 0 and 9 rejected, while ordinal 8 remains valid after the
      beat shrinks to one shot and survives restart.
- [ ] RED trim numeric bounds: finite nonnegative values only, each less than source duration, and
      `trimInSeconds + trimOutSeconds < durationSeconds`. Reject NaN, infinity, negative zero policy
      drift, and an empty played interval.
- [ ] RED all three reference-only Bin kinds and no fourth: exact beat/shot/take maxima, no generic
      removal, beat/take `lifted | alternate` reasons, shot `lifted` only, and take aliases cannot name
      selected, seed, or conditioning media. For shots, prove exact active-or-binned XOR, one unique
      Bin item, a safe existing `shotId`, a safe existing authoritative `beatId`, no other beat's
      `shotOrder` membership, and rejection of missing, duplicated, cross-owned, or magic IDs.
- [ ] RED a binned shot retaining canonical selected/seed takes, terminal jobs, receipts,
      authorizations, and completed/failed frame lineage. Every relation must still resolve to that
      shot; no ownership field is nulled or reparented. Reject a binned shot with a nonterminal job or
      pending/extracting frame operation, and reject any nonterminal downstream job/extraction that
      consumes the binned shot or its take/frame lineage. Positively validate a terminal downstream
      snapshot with exact immutable historical provenance after its predecessor is binned even though
      it no longer equals the current active chain; Task 2 must project that accepted state as stale.
- [ ] RED `StudioProposedShot`: exact keys, safe supplied IDs, fixed-ID preservation, and ordered
      created/retained/removed/fixed result IDs.
- [ ] Implement the exact validators and `createEmptyStudioProject()` with empty
      beat/shot/Bin/history state. Resolve every record entry by own key, walk both graphs
      iteratively, and consume the constant named for each contract.
- [ ] Convert canonical-take and summary projection helpers to Beat/Shot. The summary is active-only
      and the film-duration projection returns known seconds plus unresolved beat IDs; test target,
      null-target, covered, binned-beat, and binned-shot cases without null-to-zero coercion. Binned
      shots and their retained assets/jobs contribute zero active shot, duration, and readiness count.
- [ ] Mutation proof: restore a bare `=== undefined` guard at one lookup site and prove the matching
      totality test fails; lower each per-kind Bin maximum by one in turn and prove the exact
      beat/shot/take N-boundary test fails; remove the shot active-or-binned XOR and prove its ownership
      test fails; restore all mutations.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio` and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): define beat and shot contracts`.

### Task 2 — The ordered reducer

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/chain.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/index.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/mutations.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/chain.test.ts`

**Steps**

- [ ] RED every operation, ordered later-op visibility, input immutability, late-op rollback,
      capacity precedence, collision rejection, exact permutations, and created-ID ordering.
- [ ] RED the removal rules: `delete_shot` is active-only and refused for every persisted dependency;
      `park_take` clears an eligible take from selection and creates an exact lifted alias; and
      `park_shot` moves the exact active membership to one lifted shot Bin item without changing the
      shot or any paid-lineage record. Refuse an already-binned/missing shot, Bin overflow, any
      nonterminal job, any pending/extracting frame operation, a current `matchToShotId`, and every
      nonterminal downstream job/extraction actively consuming that shot or its take/frame lineage.
      Prove each refusal is pre-mutation and leaves the whole batch unchanged; prove historical
      terminal downstream conditioning snapshots do not block and instead become stale.
- [ ] RED `restore_shot`: consume exactly one lifted shot item, use only its recorded original beat,
      validate the current `beforeShotId` anchor and per-beat capacity, and restore the same shot ID
      with byte-identical asset/job/receipt/authorization/frame lineage. Cover a recorded beat that is
      itself binned, wrong-owner anchors, duplicate/active membership, later-op visibility, and
      late-operation rollback. No operation reparents a shot or creates an alternate shot item.
- [ ] RED `apply_coverage` against the exact `StudioProposedShot` wire shape. It must derive and
      report the fixed set, reject a caller's mismatched `fixedShotIds`, preserve every fixed shot's
      cumulative start/end boundary, reuse requested current IDs, create requested new IDs in order,
      and move every removed detached line to beat history without invalidating an ordinal that no
      longer exists in current coverage. Its input and fixed-set derivation are active-order only;
      prove that a previously parked rendered shot is absent from coverage and remains byte-identical
      through re-split, while every remaining active dependent shot stays fixed.
- [ ] RED derivation: edit detaches; `rederive_line` writes the previous line to history and restores
      derivation; editing the action bumps `actionRevision` and marks derived lines stale while
      leaving detached lines untouched; history evicts oldest at 20.
- [ ] Implement staleness as a pure derivation in `chain.ts`: which shots are stale, from which
      cause, and what a cascade would cost in generations. Compare each video job's persisted
      conditioning snapshot with current seed/predecessor/take/frame/endpoint state. Cover
      tail-versus-head trim asymmetry, selected-take replacement, `reorder_shots` invalidating
      downstream, `park_shot`/`restore_shot` invalidating the affected downstream active chain,
      `hard_cut` starting a fresh seed-pending segment, and beat reorder changing nothing. Add one
      pure inbound-reference derivation used by `park_shot`; current match-to and nonterminal
      downstream jobs/extractions consuming its shot/take/frame lineage block, while historical
      terminal conditioning snapshots and receipts do not and instead project staleness.
- [ ] Implement `applyStudioMutationBatch(project, batch)` as a pure draft reducer returning the next
      project plus ordered created/retained/removed/fixed IDs. Every successful free authoring batch
      appends one bounded entry containing canonical before-fragments for exactly the project/beat/
      shot/Bin records it touched in the same revision; `undo_last` must be sole-op, CAS-aware, apply
      only those internal patches, revalidate the full result, and remain unable to alter provider
      jobs, receipts, or authorizations. Park/restore patches capture only the owning beat membership
      and Bin before-fragment; the shot and its paid arrays are never snapshotted or overwritten.
- [ ] Static fence the `schema2` directory from filesystem, IPC, job manager, resolver, adapter,
      polling, retry, cancel, and render imports.
- [ ] Mutation proofs: allow `apply_coverage` to move an active shot with takes and prove the
      fixed-point test fails; make `park_shot` reject terminal paid lineage or drop a retained record
      and prove the park/re-split test fails; bypass either current Match To or one nonterminal
      downstream consumer and prove the fail-closed test fails; incorrectly block a historical
      terminal conditioning snapshot and prove the staleness test fails; make `reorder_shots`
      non-invalidating and prove the staleness test fails; restore all mutations.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio/service/schema2` and
      `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add beat and shot mutations`.

### Task 3 — Schema-aware store inspection

Carries CS2 Task 3 almost intact. Only the seam type signatures change.

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/index.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`
- Modify: `docs/contributing/development.md`

**Steps**

- [ ] Add a bounded schema sniff before V2 parsing returning supported, unsupported V1, not-found,
      and malformed-V2 explicitly. Do not call `migrateSchemaV1Project` on the V2 path.
- [ ] Add V2 create/read/list/summary/update-batch store seams used only by V2 tests until Task 7.
      Keep rename+directory-fsync commit facts, one-revision CAS, summary-repair isolation, and
      commit tags unchanged.
- [ ] RED a complete V1 profile tree and assert identical path set, bytes, metadata hashes, zero
      mkdir/write/rename/rm, and no quarantine.
- [ ] RED malformed schema 2 separately and prove it remains a loud quarantine failure — including a
      **CS2-shaped** schema-2 record, which is now malformed by construction and is what internal
      `Forge-Dev-2` profiles contain.
- [ ] RED fresh empty V2 create/restart, mixed V1+V2 listing, summary totals, batch rollback, stale
      CAS, and exactly one revision/observer fact.
- [ ] RED a store round trip with one lifted shot whose original beat is active and one whose original
      beat is binned. Preserve the shot and every asset/job/receipt/authorization/frame byte across
      update, atomic rename, index repair, and restart; summaries count neither lifted shot. RED stale
      CAS and a late invalid anchor/reference as zero-write rollbacks, and quarantine malformed
      active-and-binned, missing-owner, duplicate-shot-item, and in-flight-binned records loudly.
- [ ] Update `docs/contributing/development.md` with the fresh named profile workflow and manual
      profile removal only while the app is stopped. Add no app reset command.
- [ ] Mutation proof: route V1 through the old migrator and prove the no-touch test fails; restore.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/store.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): isolate beat and shot storage`.

### Task 4 — The rate card, estimates, and receipts

**Files**

- Create: `packages/desktop/src/process/services/creative-studio/service/pricing/rateCard.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/pricing/estimate.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/pricing/authorization.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/pricing/index.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Create: `tests/unit/process/creative-studio/pricing/rateCard.test.ts`
- Create: `tests/unit/process/creative-studio/pricing/estimate.test.ts`
- Move: the three existing adapter/resolver tests into
  `tests/unit/process/creative-studio/adapters/` before adding `pricing/`; this reduces the existing
  over-limit test directory to ten direct children. Moves are byte-identical and happen in their own
  commit before pricing assertions change.

**Steps**

- [ ] Define the rate card: safe route ID, ISO currency, stable digest over canonical values, and an
      exact rate union — image routes use integer minor units per generation; video routes use
      integer minor units per second. Load it as config; it is never a provider API call in v1. A
      quote may contain exactly one currency and the route kind must match the job purpose.
- [ ] RED the estimate as a **range** over one set of shots, with in-flight work counted as context
      and never billed again, and with the cascade priced as a **separate** line from the base set.
      Lower is one generation per shot; upper is the requested 1–4 generations per shot. Reject
      mixed currencies, unsafe integer totals, missing rates, and overlapping base/cascade sets.
- [ ] Derive every quote from active beat/shot membership. A lifted shot and its retained jobs,
      receipts, takes, and frames are historical context only: they appear in neither base nor cascade
      items and are never billed again. RED active → park and park → restore quote invalidation under
      exact revision comparison.
- [ ] RED that the headline cost, the generation count, and the button label are all derived from the
      same shot set — a test that fails if any is computed independently.
- [ ] Implement the receipt: persisted on the job, recording route, seconds, generation count, and
      the complete frozen `StudioSpendReceipt` by value. RED image/per-generation and
      video/per-second totals, safe integer bounds, authorization/item/job correlation, and that a
      rate-card change does not alter an existing receipt.
- [ ] Implement the budget predicate as its own pre-dispatch mechanism, scoped per batch, with its
      own breach shape. It is not a `forbidden_terms` variant and does not run per prompt. Compare
      the quote's upper minor-unit bound to the persisted same-currency `StudioSpendPolicy`.
- [ ] Implement pure quote derivation and confirmation comparison. The quote freezes project
      revision, exact ordered base/cascade sets, route IDs, generation counts, conditioning inputs,
      rate-card digest/values, currency, totals, and expiry. Confirmation accepts only a byte-equal
      re-derivation; no tolerant or subset comparison.
- [ ] RED quote tampering, expiry, revision change, route/rate/seed/predecessor/trim/take/order change,
      and budget change. Every refusal creates zero authorization/job records and reaches zero
      resolver, adapter, or provider calls.
- [ ] Mutation proof: make the receipt store a card reference instead of a value and prove the
      card-change test fails; restore.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio/pricing` plus the moved adapter tests,
      then `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add rate card estimates and receipts`.

### Task 5 — Shot ownership, chain sequencing, and the conditioning frame

**Files**

> **This task is a rename plus an addition, not a build.** `v2Service.ts` (815 lines), the clip-owned
> `jobManager` and `mediaStore` conversions, and their ~5,600 lines of tests already exist from CS2
> Task 4 and are CS3-valid. Rename `clipId` → `shotId` (≈218 production lines, ≈334 test lines), then
> add the seed-still purpose, chain, trim-aware extraction, and spend authorization on top. Do not
> re-derive the idempotency, submission
> ambiguity, download recovery, cancellation, or retry-lineage logic — it is done and tested.

- Modify: `packages/desktop/src/process/services/creative-studio/service/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Create: `packages/desktop/src/process/services/creative-studio/adapters/conditioningFrame.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/renderService.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/unit/process/creative-studio/jobManager.test.ts`
- Modify: `tests/unit/process/creative-studio/adapters/providerAdapters.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`

**Steps**

- [ ] Convert V2 asset/job/take/poster/output/retry/cancel/recovery checks to `shotId`. Preserve
      provider identity, idempotency, submission ambiguity, download recovery, cancellation policy,
      and rule enforcement.
- [ ] Treat active-or-binned membership as authoring state, not media ownership. Media resolution and
      historical terminal job/receipt/frame lineage continue to resolve through a lifted shot, but
      readiness, quote, submit, retry, seed/take selection, and chain scheduling accept active shots
      only. RED every forbidden binned-shot entrypoint before resolver/adapter/provider access. Because
      `park_shot` refuses nonterminal jobs and pending/extracting frames, recovery must never discover
      an admitted in-flight binned record; malformed persisted input fails validation rather than
      being repaired or dispatched.
- [ ] RED that the poster resolves **by role** and that a job carrying a third output still yields a
      cover — the inverse of the old positional assumption.
- [ ] Add explicit job purposes. A reviewed `seed_still` job uses the selected image route and creates
      an image take; a `video_take` job uses the selected video route and persists its exact
      conditioning snapshot. The newest completed still becomes the default seed only while the user
      has not pinned another; generation completion never replaces a pinned seed or selected video
      take.
- [ ] Implement trim-aware local extraction in `conditioningFrame.ts`. RED an untrimmed exact
      Seedance take adopting its provider last frame; all other routes locally decoding; and a 10s
      selected take trimmed to 8s producing an 8s conditioning frame rather than reusing the 10s
      poster. Poster and conditioning-frame IDs, collections, and retention remain distinct.
- [ ] RED the recovery invariant: with the frame asset deleted from disk, recovery re-derives it and
      **never** re-renders. RED that the window closing mid-extraction or mid-chain stalls and resumes
      from the durable extraction/authorization record.
- [ ] Implement chain sequencing: a shot is submitted only once its predecessor has succeeded and its
      exact selected-take/endpoint frame exists. Segment heads require a current selected seed. RED
      seed-pending authoring accepted but video submission refused; mid-chain failure keeps the
      partial, records receipts only for completed generations, and resumes from the break.
- [ ] Implement unregistered `prepareSubmissionV2` and `confirmSubmissionV2` service seams. Confirm
      runs quote re-derivation under the project queue and durably commits the authorization plus all
      idempotent jobs before dispatch. A close after authorization may resume only that exact ordered
      base/cascade set; a merely stale downstream shot without authorization never auto-dispatches.
- [ ] RED every confirm race: project/route/rate/budget/order/seed/take/trim/frame change, expiry,
      duplicate confirm, close immediately before/after durable authorization, and provider throw.
      No refusal reaches resolver/adapter/provider; no dispatched job lacks authorization.
- [ ] RED that retention cannot reach takes, seed stills, or conditioning frames, and that the
      existing project write-admission cap refuses a new large write without evicting anything. Add a
      lifted shot with terminal paid lineage and prove retention, cleanup, and restart leave every
      referenced byte and record untouched.
- [ ] Mutation proof: allow submission without the predecessor's frame asset and prove the
      sequencing test fails; restore.
- [ ] Run the studio unit and integration suites and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): own generation by shot with a first-frame chain`.

### Task 6 — Director, proposals, and the full MCP operation surface

> **Also a rename plus an addition.** CS2 Task 5 already built the Director command mailbox,
> processor, spend fences, the four MCP record writers, and `studio_apply_edits` carrying a
> `mutation_batch` — 6,212 production lines and ~7,500 test lines, of which only a few hundred
> reference the renamed vocabulary. The "every hand gesture as an MCP op" surface exists; this task
> renames its ops and adds the ~12 CS3 introduces. `requiredAction` appears zero times in that code,
> so dropping required actions is free.

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify the Director command service, mailbox, processor, writer, and spend-fence modules and their
  tests as the V1 equivalents are versioned.
- Modify: the builtin Studio MCP server and its tool definitions.
- Modify: proposal/reference store, service, MCP, and integration tests; add restart/race cases to
  `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`.

**Steps**

- [ ] Rename the Director, proposal, and reference record vocabulary to Beat/Shot. Preserve the
      mailbox, processor, latency, and spend-fence behaviour — it is built and tested.
- [ ] Extend the unregistered MCP direct-edit and proposal schemas with only the CS3 operations their
      policy permits, routed through the same reducer as renderer edits. Human-only reducer
      operations remain absent from MCP schemas even though Task 2 implements them for later native
      handlers.
- [ ] Freeze Director policy in schemas, not prose. `studio_apply_edits` exposes only direct-safe
      text/pre-picture operations. Structural or staleness-producing operations exist only in the
      proposal writer. Motion/take decisions (`select_take`, take park/restore), Cut choices, undo,
      lifted-shot park/restore, and paid confirmation are omitted from every Director-callable schema.
      A re-split proposal may report an active shot as fixed but may not bundle `park_shot`; lifting
      paid coverage remains an explicit human-native action. There is no registered but disabled tool
      state. RED exact absence from direct, proposal, parser, projection, and writer surfaces.
- [ ] RED the spend fence against the new surface, including operations that are free but create
      staleness: the director may create staleness only through a reviewed proposal, never silently.
- [ ] Finish schema-2 store ownership for proposals: list/watch/accept/reject/expire/reap exact V2
      records and decisions. Acceptance applies a mutation proposal through the reducer inside the
      same project queue, commits once, writes one durable decision, and releases only the matching
      slot. Accepted retry is idempotent and never reapplies or re-notifies. V1 sidecars remain
      byte-identical unsupported data.
- [ ] Attribute an accepted mutation commit with the proposal ID and resulting revision/created IDs.
      If decision publication fails after the project commit, restart repairs the decision from that
      exact commit fact before cleanup/notification; it never invokes the reducer again. A stale or
      mismatched commit fact leaves project, proposal, decision, and slot untouched and loud.
- [ ] Finish schema-2 reference-request ownership with the same list/watch/decision discipline.
      Acceptance may import an author-chosen reference or populate a reviewed seed-generation gate;
      it never auto-submits. Persist a decision/receipt so restart cannot repeat the handoff.
- [ ] RED that proposal cards and reference requests survive restart, stale CAS, decision-write
      ambiguity, duplicate watchers, and receipt-first repair; required actions are absent, their
      product cases represented by the render and chain gates.
- [ ] Account for each operation as a reducer op, unregistered MCP schema/parser variant, proposal
      acceptance case, exact projection, and test. **Do not** add native constants, payload schemas,
      manifest entries, bridge providers, or renderer types in Task 6; those land together in Task 7.
      Human-only `park_shot`/`restore_shot` are accounted for by explicit MCP/proposal absence tests,
      not by callable variants.
- [ ] Mutation proof: let a director path create staleness outside a proposal and prove the fence
      test fails; restore.
- [ ] Run the full suite and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): version director commands for beat and shot`.

### Gate 1 review checkpoint

- [ ] Freeze the exact Task 1–6 head and obtain independent process/schema and security/spend review.
- [ ] Run the focused three-kind Bin proof across validator, reducer/chain, store/restart, pricing,
      job/media lifecycle, and Director/MCP absence suites. The positive oracle is a rendered terminal
      shot parking with byte-identical paid lineage and then surviving re-split; the negative oracles
      are active-and-binned ownership, own in-flight work, current Match To, and each nonterminal
      downstream job/extraction actively consuming its lineage. Prove a historical terminal
      conditioning snapshot permits parking and becomes stale. Independently review original-beat
      restoration and the distinction between active blockers and historical lineage before
      accepting the gate.
- [ ] Verify V2 code is still unregistered from the renderer bridge, current V1 UI behavior is
      unchanged, and no V1 profile tree changed during tests. This check is what certifies the pivot
      premise: the vocabulary must never have reached the bridge, the manifest, or the renderer.
- [ ] **Verify the rename by running the whole suite, not the changed files.** Roughly a thousand
      identifiers moved across thirty-odd files and 18,874 lines of tests. A slice's own tests
      passing says nothing about what it broke elsewhere, and this repo has already carried a red
      cross-file parity test for four slices because nobody ran the repo-wide gate.
- [ ] Run `bun run test`, `bun run test:coverage`, `bun run lint --quiet`, `bun run format:check`,
      `bunx tsc --noEmit`, and `git diff --check`.
- [ ] Update `vitest.creative-studio-coverage.config.ts` to exactly the Task 1–6 executable production
      diff and run it with coverage. Record every file's line/branch result; all must be at least
      80/80. Assert native manifest/provider inventory and renderer/preload/runtime activation remain
      absent, not merely unused. Include every new shot-Bin validator, ownership, inbound-reference,
      reducer, summary, and lifecycle branch in the executable manifest.
- [ ] Resolve every Critical/Important finding in separate commits and re-review before Task 7.

---

## Delivery Gate 2 — atomic cutover and the shell

### Task 7 — Atomically switch runtime, bridge, routes, and renderer

Carries CS2 Task 6 in shape: one atomic switch, legacy deletion in the same task, no dual contract.

**Primary tests:** `tests/unit/process/creative-studio/runtime.test.ts`,
`tests/unit/process/bridge/nativePayloadSchemas.test.ts`,
`tests/integration/creative-studio/schema2Cutover.integration.test.ts`, and
`tests/e2e/features/workspaces/creative-studio.e2e.ts`.

**Steps**

- [ ] RED exact native provider inventory and manifest/schema parity, then add every Beat/Shot
      constant, payload schema, provider, and manifest entry in this task only. No Section/Clip V2
      provider survives the same commit.
- [ ] Add the human-native `park_shot` and `restore_shot` payloads/providers atomically with the
      renderer cutover. Schemas are exact (`shotId`, plus nullable `beforeShotId` for restore), both
      route through the Task 2 reducer/store queue, and neither appears in Director/MCP inventory.
      Native parity, manifest, bridge, preload, runtime, and renderer tests must fail if either side is
      missing, renamed, or registered twice.
- [ ] Replace public `StudioProject`/renderer aliases with the Beat/Shot types; delete staging seams.
- [ ] Implement one runtime activation controller with explicit
      `inactive | activating | active | degraded | disposed` state and a supported-project ID set.
      Startup classifies the root before constructing or starting any V2 watcher, timer, cleanup,
      recovery, resolver, adapter, media protocol, or mailbox. Mixed roots feed V2 IDs only.
- [ ] RED the full activation lifecycle: V1-only startup stays inactive; the first successful V2
      project commit triggers one single-flight activation; concurrent create/import events do not
      double-install; partial startup disposes everything it installed and enters degraded; the next
      inventory event retries; deleting the last V2 project stops per-project lifecycle; shutdown
      during activation disposes once. A failed project commit never activates.
- [ ] Register only V2 bridge providers; remove legacy scene providers; switch the builtin MCP server
      to the reviewed V2 entrypoints and delete the V1 entrypoints.
- [ ] Delete the `StudioPage` Director reference-request auto-submit and auto-dismiss path before any
      V2 paid provider becomes reachable. Wire the reviewed V2 proposal/reference list, watch, and
      decision APIs; accepting a paid request opens gate state and still performs zero provider work.
- [ ] Delete the schema-1 `validateProject` in `store.ts` and every predicate and value set it alone
      keeps alive, so schema 2's copies become the only definitions. Assert each name has exactly one
      definition under `creative-studio/`.
- [ ] Delete the storyboard model role and the `planning/` directory and its tests.
- [ ] Set `STUDIO_VIEWS` to `['table', 'board', 'cut']`. This is a **shared constant**: a main-process
      regex gates the unsaved-work close dialog, so it is not renderer-only.
- [ ] Delete the scene-based Write, Produce, Review, and Export implementations rather than projecting
      beats as scenes.
- [ ] Register read/free-authoring/proposal/reference V2 providers, but deliberately omit paid
      `confirm_submission` from native constants, schemas, manifest, and bridge until Task 8 lands
      the reviewed gate and provider atomically. `prepare_submission` remains read-only and may be
      exposed for gate projection.
- [ ] Run the full suite and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): cut over the workspace to beat and shot`.

### Task 8 — Workspace projection, drafts, selection, and gate state

**Tests:** create `tests/unit/pages/studio/workspace/WorkspaceProjection.test.ts` and
`tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx`; extend service/index and workspace E2E.

**Renderer structure:** create `components/Workspace/` under the currently compliant
`components/` parent. Task 8 starts it with `index.ts`, `workspaceProjection.ts`,
`useWorkspaceDrafts.ts`, `spendGate.ts`, and `Views/{index.ts,viewTypes.ts}`. Task 9 adds the shell
and `DirectorRail/`; Task 11 adds `BeatPanel/`; Table, Board, and Cut live under `Views/`. Every leaf
directory has component plus styles/tests as applicable, and `Workspace/` stays at no more than ten
direct children.

**Steps**

- [ ] Build the shared sanitized projection consumed by Table, Board, beat panel, and Cut. Project
      active shots from `shotOrder` only and project all three Bin reference kinds separately; a
      lifted shot exposes its recorded owner, authored fields, deterministic cover, take count, and
      park/restore eligibility without exposing provider credentials or mutable paid records.
- [ ] Implement draft persistence and the selection model once, shared across views.
- [ ] Put image-route and video-route selection in the Brief, using the sanitized catalog and exact
      readiness projection. Missing image route blocks seed generation only; missing video route
      blocks video generation only. No default route is silently selected by main.
- [ ] Implement the render gate's state: the shot set, the base estimate range, the cascade as a
      separate priced option, and the free alternative when a beat has no coverage.
- [ ] Implement the chain gate's state: what is stale, from which cause, and what resolving costs.
- [ ] Add the paid native boundary and UI in one commit: `prepare_submission` returns the exact quote;
      the modal renders its ordered base/cascade lines, currency, lower/upper minor-unit range,
      generation counts, budget result, and expiry; the explicit confirm action sends only `quoteId`
      plus expected revision. Main re-derives and authorizes. Close/cancel spends nothing.
- [ ] Project proposal/reference decisions into persistent cards. Accepting text/structure calls the
      reducer path; accepting a generation request pre-populates this gate; neither bypasses confirm.
- [ ] RED that switching views changes presentation only — it never saves, refetches, or discards
      drafts.
- [ ] RED with provider/resolver/adapter spies that opening, recomputing, cancelling, expiring, or
      accepting a proposal/reference card performs zero paid work; only exact confirm can dispatch.
- [ ] Commit: `feat(studio): add the shared workspace projection`.

### Task 9 — Project shell and the collapsible Director rail

**Tests:** create `tests/unit/pages/studio/workspace/DirectorRail.dom.test.tsx`; extend existing
`StudioPage`, Director proposal/card, and conversation-owner tests. Together with Tasks 8 and 10–14,
the new `workspace/` test directory has exactly ten direct children; add no peer without splitting it.

**Source:** add `WorkspaceShell.tsx`, `Workspace.module.css`, and
`DirectorRail/{index.tsx,DirectorRail.module.css}` under `components/Workspace/`.

**Steps**

- [ ] Build the workspace shell and route.
- [ ] Build **one docked collapsible Director rail** with a single persistent conversation owner.
      Do **not** build a layout system that moves the conversation between docked, split, and narrow
      presentations — that machinery existed because the conversation was the centre, and it is not.
- [ ] Preserve proposal cards, rules, the Brief, and the one conversation owner.
- [ ] Land every visible string as an `en-US` key under `creativeStudio.workspace.*`. The other
      eleven locales fall back until the deferred pass.
- [ ] Commit: `feat(studio): add the workspace shell and director rail`.

### Gate 2 review checkpoint

- [ ] Run focused node/jsdom suites for runtime activation, native parity, proposal/reference
      decisions, workspace projection, draft persistence, route readiness, gate quote/confirm, and
      Director persistence; include exact native `park_shot`/`restore_shot` schema-to-reducer parity,
      three-kind projection, active-only quote/readiness omission, and Director/MCP absence; then
      `bun run test`.
- [ ] Run `bunx playwright test tests/e2e/features/workspaces/creative-studio.e2e.ts` after replacing
      its scene-shaped fixtures/assertions with Beat/Shot lifecycle and V1 no-touch cases. Exercise a
      rendered terminal shot through native lift, verify its retained-work Bin projection and zero
      provider calls, then restore it to the recorded beat at a current anchor.
- [ ] Update and run `vitest.creative-studio-coverage.config.ts`; every executable changed file is
      present and at least 80% lines/branches. Run `bun run lint --quiet`, `bun run format:check`,
      `bunx tsc --noEmit`, i18n type/check commands, and `git diff --check`.
- [ ] Freeze the exact head; independently review activation rollback, V1 isolation, native parity,
      proposal/reference crash recovery, and paid confirmation. Resolve every Critical/Important
      before Task 10.

---

## Delivery Gate 3 — the views

### Task 10 — The Table

**Tests:** create `tests/unit/pages/studio/workspace/TableView.dom.test.tsx` and add the Table cases
to `tests/e2e/features/workspaces/creative-studio.e2e.ts`.

**Source:** create `components/Workspace/Views/Table/{index.tsx,Table.module.css}`.

- [ ] Real data-grid semantics: row and cell roles, keyboard traversal, and a visible focus ring.
- [ ] Columns per the prototype, with **target and actual visually distinct**.
- [ ] Beat states including duration pending, no coverage, seed pending, part done, rendering, and
      stale. A nullable target never renders as zero seconds.
- [ ] RED 24-beat keyboard traversal, selection shared with Board/panel, and no mutation on view
      switch.
- [ ] Commit: `feat(studio): build the table view`.

### Task 11 — The beat panel and the coverage bar

The core interaction of CS3, and the largest single task. Split it if it exceeds one reviewable diff.

**Tests:** create `tests/unit/pages/studio/workspace/BeatPanel.dom.test.tsx` and
`tests/unit/pages/studio/workspace/CoverageBar.dom.test.tsx`; extend the workspace Playwright file.

**Source:** create `components/Workspace/BeatPanel/` with `index.tsx`, `BeatPanel.module.css`,
`CoverageBar.tsx`, and pure `coverageGeometry.ts`.

- [ ] Action and Look editors, with the soft 25-word Look counter that warns and never blocks.
- [ ] The coverage bar: boundary drag changes what a shot generates; edge drag trims what it plays.
      Head trim always free; tail trim warns when it breaks continuity.
- [ ] Density tiers computed from the measured bar width, the whole bar committing to one tier taken
      from its narrowest segment. Nothing persisted, nothing chosen, **no tier label rendered**.
- [ ] Chain presentation: segment heads, seed stills, author `hard_cut` distinct in name and treatment
      from system-detected continuity break.
- [ ] Seed workflow: seed-pending is editable; imported/generated image takes are visible separately
      from video takes; latest is the default until the user pins one; clear/pin/generate all use the
      reviewed route/gate rules. Video submission is impossible without the required seed.
- [ ] Takes, human-only video-take selection, and per-shot render with its own gate. Director tools
      cannot select, park, or restore a take.
- [ ] Add an explicit human-only **Lift shot** action. Its confirmation states that authored and paid
      work is retained, names any downstream staleness, and never calls delete. Disable it with a
      specific reason for an in-flight job/extraction, current Match To, or nonterminal downstream
      job/extraction consuming its lineage; terminal downstream conditioning history becomes stale
      and does not block. Clearing or repointing Match To is a separate action. RED that cancel and
      every refusal preserve project bytes and invoke no paid boundary.
- [ ] Derivation: derived versus detached, staleness against the action, re-derive, and line history
      restore.
- [ ] `PART DONE` recovery: the resume affordance, undrawn in the prototype.
- [ ] Reorder inside a beat must not look like reordering beats, and must show the staleness it
      creates.
- [ ] RED the coverage lifecycle: a rendered shot is fixed during re-split; after explicit lift it
      leaves active coverage, re-split may replace only the remaining dependency-free intervals, and
      the lifted shot plus takes remain available in the Bin. Restoring it at a current anchor
      reintroduces the same identity and shows the resulting downstream staleness/cascade before any
      paid confirmation.
- [ ] RED tail trim end to end: trimming a selected 10s take to an 8s played endpoint displays stale
      downstream state, queues the 8s conditioning extraction after confirmation, and never presents
      the full-video poster as chain authority. Head trim does not invalidate downstream.
- [ ] Commit: `feat(studio): build the beat panel and coverage bar`.

### Task 12 — The Board and the Bin

**Tests:** create `tests/unit/pages/studio/workspace/BoardView.dom.test.tsx` and
`tests/unit/pages/studio/workspace/Bin.dom.test.tsx`; extend the workspace Playwright file.

**Source:** create `components/Workspace/Views/Board/` with `index.tsx`, `Board.module.css`, and
`Bin.tsx`.

- [ ] Deterministic covers and the no-coverage placeholder.
- [ ] Three card sizes rather than zoom.
- [ ] The Bin: exactly three reference kinds, Beat, Shot, and Take. Beat/Take show lifted versus
      alternate; Shot is visibly lifted only. Each has deterministic restore behavior plus
      drag/keyboard reorder with kind-and-reason announcements. A Shot card shows its recorded owner
      beat, deterministic cover, take count, and retained-work state; it exposes no generate, retry,
      select-take, or generic-remove control while binned.
- [ ] RED canonical membership and dependency-safe restoration: a selected/seed/conditioning take
      cannot be binned separately; a binned beat is absent from the film; an active shot cannot also
      render in the Bin; and replacement races preserve every referent and alias. Restoring a shot
      uses only its recorded beat and a current anchor, works while that beat is itself binned, refuses
      a full beat or stale/wrong-owner anchor without mutation, and preserves the same paid lineage.
- [ ] Add responsive and human-acceptance coverage for a lifted rendered shot at desktop, compact,
      narrow, and RTL: the confirmation says its takes are kept, the Bin card remains understandable
      without its source panel, focus moves predictably after lift/restore, and screen-reader output
      announces owner, reason, position, and refusal cause.
- [ ] Commit: `feat(studio): build the board and bin`.

### Task 13 — The Cut

**Tests:** create `tests/unit/pages/studio/workspace/CutView.dom.test.tsx`; extend the workspace
Playwright file with imported-audio bed, match-to gate, and export cases.

**Source:** create `components/Workspace/Views/Cut/{index.tsx,Cut.module.css}`.

- [ ] Beat order, one bed fading out at the cut's end, match-to, and export.
- [ ] Import and validate managed audio for the bed. Reject image/video IDs, unsafe/missing media,
      and a bed shorter/longer than the film only according to the explicit fade-at-end playback rule;
      no paid audio-generation route is introduced.
- [ ] The Cut cannot reach inside a beat: no trims, no retiming, no take selection.
- [ ] `MATCH TO` presented as a costed re-render, never as a free grade.
- [ ] Treat current `matchToShotId` as an inbound active reference: lifting that shot is refused until
      the author clears or repoints Match To in a separate revision. RED the Cut and beat-panel error
      states and prove neither refusal nor clearing invokes generation before reviewed confirmation.
- [ ] **No `AUTO-DUCKED`.** If narration state is shown at all it says there is no voice track yet.
- [ ] Export shapes: editor folder always; a still; **`script.md` on demand**, generated at export
      time and never written to the project root or ingested. One-file stitched export is not in v1
      and its control is absent, never shown disabled or failing.
- [ ] Retention is per shape, count-based, with size shown for visibility only. RED that it can
      never evict a take or a conditioning frame.
- [ ] Commit: `feat(studio): build the cut view`.

### Gate 3 review checkpoint

- [ ] Run the five workspace jsdom files plus relevant projection/reducer tests, then `bun run test`.
- [ ] Run the workspace Playwright lifecycle at desktop (1440×900), compact (1100×760), narrow
      (760×900), and RTL. Capture Table, beat panel/coverage, Board/Bin, and Cut screenshots and
      compare structure/content against the frozen reference; intentional corrections (Director
      rail, no density label, target/actual, no AUTO-DUCKED) are asserted explicitly. At every
      viewport, lift a rendered shot, assert the retained-work confirmation/card, active-view
      disappearance, focus and screen-reader announcement, then restore the same identity to its
      recorded beat without a provider call. Include refusal UI for own in-flight work, current Match
      To, and a nonterminal downstream consumer, plus the permitted/stale terminal-history case.
- [ ] Update/run the Creative Studio coverage manifest at 80/80 per file; run lint, format, typecheck,
      i18n, and diff-check. Freeze the exact head; independently review keyboard/a11y, trim-aware
      conditioning, Bin invariants, audio bed, retention, and visual evidence. Resolve every
      Critical/Important before Task 14.

---

## Delivery Gate 4 — hardening and acceptance

### Task 14 — Undo

- [ ] Complete the `StudioUndoEntry` journal staged in Tasks 1–2. Every successful free authoring
      batch appends exactly one canonical before-fragment entry in the same project revision, capped
      at 20 oldest-first;
      paid lifecycle/recovery writes append none. A new non-undo edit after undo discards abandoned
      forward history; redo is not in v1.
- [ ] `undo_last` must be the sole operation, name the current top entry, and run through the same
      reducer/store queue under expected-revision CAS. It writes one new revision, removes the entry
      it consumed, and never retries a stale/ambiguous result. It cannot cancel/retry provider work,
      delete a receipt/authorization, or claim a refund.
- [ ] Re-prove every patch's post-edit digest immediately before apply. Preserve shot asset/job arrays
      across authoring undo; refuse `undo_conflict` if a newly created beat/shot gained dependencies,
      a touched authored fragment changed outside the journal, or any restored reference is no longer
      valid. The entry remains available after conflict.
- [ ] RED restart and exact inverse behavior for re-split, detach/rederive, beat/shot/take
      park/restore, trim, shot/beat reorder, hard cut, seed/take selection, routes, spend policy, bed,
      and match-to. Shot park/restore undo changes only the owning beat membership and Bin fragment;
      it reuses the current shot record and cannot replace, delete, or rewind any retained paid
      lineage. Director-applied free edits are undoable; proposal rejection and paid confirmation are
      not.
- [ ] Line history is the undo substrate for **text**. `RESET` is not: it discards the renderer draft
      through the existing `useDraftPersistence`, writes nothing to history, and never reaches main.
      It is deliberately absent from the mutation vocabulary — RED that no reducer operation exists
      for it, so it can never revert a committed revision and therefore can never lose writing.
- [ ] Tests: extend reducer/store/service suites and create
      `tests/unit/pages/studio/workspace/Undo.dom.test.tsx`; mutation-kill missing inverse append,
      stale entry acceptance, and paid-state rollback.
- [ ] Commit: `feat(studio): add revision-aware undo`.

### Task 15 — Accessibility, RTL, localization, and capacity

- [ ] Every control is an Arco component — no raw interactive HTML, no styled `div` acting as a
      button. The prototype has an empty accessibility tree; that is a prototype property and must
      not survive into the build.
- [ ] Body text at or above the 14px floor; the prototype's dense all-caps micro-labels are below it.
- [ ] Drag and keyboard reorder with announcements for the beat rail, the coverage bar, and the Bin.
- [ ] Persian logical CSS and bidi isolation. Layout is not translation: RTL must be correct here
      even while the other eleven locales are still falling back to `en-US`. Verify with a locale
      forced to RTL against English strings.
- [ ] Confirm `check-i18n.js` reports only warnings for the deferred locales and no errors, and that
      every new string resolves through a key rather than a literal.
- [ ] Capacity: 24 beats, 96 total unique shots across active and binned membership, and each
      24-beat/96-shot/96-take Bin boundary render and reorder without virtualization. A shot Bin item
      never doubles the project-shot count. In Playwright, after five warmups, 20 keyboard reorders
      must settle projection, focus, and announcement within 250ms p95 on the CI runner; record raw
      samples. Also assert bounded render counts so a faster machine cannot hide an accidental
      quadratic rerender.
- [ ] Commit: `feat(studio): harden accessibility and capacity`.

### Task 16 — Lifecycle, spend, and acceptance

- [ ] Prove the whole lifecycle end to end on a fresh named profile: brief, spine, coverage, render,
      reviewed seed still, video take, trim-aware chain, cut, export.
- [ ] In the same named-profile matrix, prove render → lift shot → re-split → restart → restore. The
      original shot ID, takes, jobs, receipts, authorization, and frame lineage remain exact; the
      binned interval is absent from active duration/readiness/quotes; restore uses the recorded beat
      and a current anchor; and no provider call occurs until a newly reviewed confirmation.
- [ ] Prove the spend fences: no unreviewed submission; cascade priced separately; budget cap refuses
      pre-dispatch; quote tamper/staleness/expiry refuses; authorization and jobs precede provider;
      in-flight work never billed twice; receipts written per take.
- [ ] Prove recovery: window closed after authorization and during extraction, conditioning frame
      deleted, app restarted, provider ambiguous, proposal/reference decision interrupted, and no
      authorization for a merely stale chain. Each resumes exactly once or fails closed.
- [ ] Prove a V1-only and mixed profile run creates no V2 watcher/timer/cleanup/provider side effect,
      while creating the first V2 project after startup single-flight activates the V2 lifecycle.
- [ ] Run the full Beat/Shot Playwright flow using deterministic fake image/video routes and assert
      the conditioning frame is decoded from the selected trim endpoint. A separate manual-provider
      checklist may validate real media quality but is not substituted for automated acceptance.
- [ ] Commit: `feat(studio): prove the beat and shot lifecycle`.

### Gate 4 review checkpoint

- [ ] Run all focused node/jsdom suites, `bun run test`, the complete workspace Playwright matrix,
      and `bun run test:coverage`. Update/run the Creative Studio manifest and require every changed
      executable file at 80% lines/branches. Run lint, full format-check, typecheck, i18n checks,
      diff-check, directory-ratchet audit, and frozen reference/spec hash verification.
- [ ] Make the named-profile render → lift shot → re-split → restart → restore flow a required Gate 4
      E2E oracle, not a manual checklist. Fail the gate if identity, authored fields, takes, jobs,
      receipts, authorization, frames, original-beat ownership, active-only summaries/quotes, current
      anchor restoration, or the zero-provider-before-new-confirmation assertion differs after
      restart.
- [ ] Freeze the exact head; obtain independent process/schema, security/spend, renderer/a11y, and
      recovery/publication reviews. Resolve every Critical/Important finding and re-run affected plus
      full gates; store exact commands, results, coverage summary, screenshot set, and reviewed SHA in
      a Gate 4 status document.
- [ ] Studio remains behind `AIONUI_ENABLE_CREATIVE_STUDIO` and off by default. This plan does not
      authorize enablement, packaged acceptance, or a provider launch.

---

## Deliberately not in this plan

- **Voice.** `narration` and `onScreenText` are retained as authored fields with no downstream
  consumer. TTS and the audio lane are their own sequence. This is the product's largest functional
  gap, not a cosmetic one: a three-minute feature walkthrough is a narrated format by definition, and
  without voice the tool produces a mood piece over a music bed.
- **A real colour pipeline.** `MATCH TO` is prompt-level in v1.
- **One-file stitched export.** V1 ships editor-folder, still, and on-demand script exports. Concatenation,
  audio mix, and fade need a separately owned ffmpeg sequence.
- **Multi-reference provider payloads.** V1 reference attachments inform Director/seed prompt
  authoring, but each paid image request sends at most the one explicitly selected canonical image
  reference supported by its route. The gate names that reference; it never implies all attachments
  are provider conditioning. True multi-image provider payloads need a separate route capability.
- **Project-total budget scope.** Sequenced after receipts exist.
- **Reconciliation against real provider billing.** Withdrawn until a provider returns billing data.
