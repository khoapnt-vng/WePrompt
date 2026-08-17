# Creative Studio 2 — Table, Board, and Director Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the schema-1 scene/phase prototype with an honest schema-2 Section → Clip → Take
workspace whose Table and Board share one revisioned state, whose Director never covers the
workspace at wide or medium widths, and whose paid generation remains behind reviewed human
confirmation.

**Architecture:** Land a clean, additive schema-2 foundation first, then atomically switch the
runtime, bridge, and renderer to it. One pure reducer in main owns every free renderer and Director
mutation. The project store remains the only durable writer. Table and Board consume the same
sanitized projection and page-private workspace controller. Director placement moves one persistent
conversation owner between docked, split, and narrow full-screen presentations without remounting
it. Schema-1 manifests and sidecars are read-only unsupported prototype data: they are never
migrated, repaired, replayed, quarantined as corrupt, or used to start provider work.

**Tech Stack:** TypeScript, Electron main/renderer separation, React 19, Arco Design, Icon Park,
CSS Modules and UnoCSS, native bridge schemas, MCP SDK, Vitest, Testing Library/jsdom, Playwright,
i18next across 12 locales, repository-managed media URLs.

**Spec:**
[creative-studio-2-table-board-design.md](./creative-studio-2-table-board-design.md), SHA-256
`c298cbc3196954afe8385a5c076530f5735ea7694c0b0ccd339a909013f84d99`; frozen visual reference
SHA-256 `875258f85ad4717fd3b1019ae3096db3394325c81ae1787f1d07b448b2ebe366`.

**Planning baseline:** `78de04291c7f76dac5173b6121cbe1df61214b3e`, whose parent is the approved
integration baseline `21bf87ae1674598bd42ea88c5f13c74e8389b3c0`. The plan/spec commit is
documentation-only; execution must verify that exact ancestry and a clean worktree before Task 1.

**Authorization boundary:** This document is an implementation plan, not implementation, merge,
default-enablement, release, profile-deletion, provider-run, or customer-migration authorization.

---

## Global constraints

1. **Clean cutover, no migration.** Do not write a V1→V2 converter, a compatibility projection, a
   reset button, or startup cleanup. `schemaVersion: 1` returns
   `unsupported_prototype_schema` and its complete project tree remains byte-for-byte unchanged.
2. **No unsupported-profile side effects.** Before summary repair, `.part` cleanup, proposal or
   reference reaping, command mailbox creation, watchers, job recovery, resolver access, adapter
   access, polling, or protocol installation, classify the project as supported V2 or unsupported
   V1. Poison every forbidden dependency in tests.
3. **Temporary additive staging is not product compatibility.** Tasks 1–5 may introduce explicitly
   named V2 types and unregistered V2 seams while the V1 UI still compiles. They must not project V1
   as V2 or expose two user-selectable contracts. Task 6 switches all public paths atomically and
   deletes the legacy scene providers/types/tests before Gate 2 review.
4. **One free mutation authority.** Renderer free-authoring IPC and Director processing call the
   same pure ordered reducer inside the store queue. The reducer imports no filesystem, IPC,
   renderer, job manager, provider resolver, adapter registry, polling, retry, cancel, or render
   code. Existing user-controlled image/video engine selection stays a separate renderer-only,
   catalog-validated configuration seam and is never exposed to Director.
5. **Reviewed spend only.** The only paid boundary remains the existing reviewed submission path.
   Director reference requests are queued for human review. Director does not create take-generation
   requests in this slice. No Director path may submit, retry, cancel, download, render, resolve
   routes/providers, or invoke adapters.
6. **One revision, no replay.** Each successful free batch writes one project revision and one
   durable result. Any operation failure rolls back the entire batch. Stale and ambiguous outcomes
   never auto-retry.
7. **No hidden legacy UI.** Final source has Table and Board only. Delete the scene-based Write,
   Produce, Review/Cut, Export, and auto-submit UI instead of leaving them compiled but unreachable.
8. **Directory ratchet.** Add no peer under directories already above ten children. Replace
   `PhaseShell`/`Shell` with `Workspace`, group hooks/tests, and keep every new directory at two to
   ten direct children. Re-audit counts at every delivery gate.
9. **Visible copy lands atomically.** Every renderer-visible string added by a task lands in all 12
   configured `conversation.json` locales under `creativeStudio.workspace.*`, with placeholder and
   plural parity. Persian uses logical CSS and bidi isolation.
10. **Strict TDD.** For each behavior: write the smallest failing test, run it and record the exact
    failure, implement the minimum production change, rerun focused tests, kill at least one risky
    mutation, restore, then run the task gate. Never weaken a timeout or assertion to obtain green.
11. **Independent reviews.** After Tasks 1–5, Tasks 6–8, Tasks 9–10, Task 11, and Tasks 12–13,
    freeze an exact commit and obtain read-only diff review. Critical/Important findings block the
    next gate.
12. **Feature/release boundary.** Preserve `AIONUI_ENABLE_CREATIVE_STUDIO`; do not enable Studio by
    default, remove the flag, claim packaged acceptance, or launch a provider as part of this plan.
13. **Changed-runtime coverage ratchet.** At every delivery gate, retain the aggregate coverage run
    and record per-file line and branch coverage for every Studio production `.ts`/`.tsx` file changed
    from the frozen baseline. Each changed runtime file must be at least 80% for both measures. A
    tracked include-only `vitest.creative-studio-coverage.config.ts` must collect executable helpers
    under `common/types/**` explicitly, because the repository-wide configuration excludes that tree;
    pure type-only files remain exempt. Update the include manifest as each task lands and never
    satisfy the ratchet by excluding an executable changed file.

---

## Frozen schema-2 contract

Task 1 implements these names exactly. Later tasks may not rename or reinterpret them without a
spec amendment and a new independent contract review.

### Limits and text bounds

```ts
export const STUDIO_PROJECT_SCHEMA_VERSION = 2 as const;
export const STUDIO_MAX_SECTIONS = 24;
export const STUDIO_MAX_CLIPS_PER_SECTION = 8;
export const STUDIO_MAX_CLIPS_PER_PROJECT = 96;
export const STUDIO_MAX_SHELF_ITEMS = 120;
export const STUDIO_MAX_SHELF_SECTION_ITEMS = 24;
export const STUDIO_MAX_SHELF_TAKE_ALIASES = 96;
export const STUDIO_MAX_GENERATION_CLIPS_PER_REQUEST = 24;
export const STUDIO_MAX_REFERENCE_REQUEST_CLIPS = 24;
export const STUDIO_MAX_CUT_PLACEMENT_CLIPS = 96;
export const STUDIO_MAX_DIRTY_CLIPS_REPORTED = 96;
export const STUDIO_MAX_MCP_AVAILABLE_TAKE_IDS_PER_CLIP = 24;
export const STUDIO_MIN_VIDEO_CLIP_SECONDS = 4;
export const STUDIO_MAX_VIDEO_CLIP_SECONDS = 15;
export const STUDIO_MAX_MUTATION_OPERATIONS = 32;
```

- IDs match the existing safe-ID contract: 1–256 ASCII letters, digits, `_`, or `-`.
- Project name 256; brief 16 KiB.
- Section title 256; story line 4 KiB; inherited visual prompt 8 KiB.
- Clip shot prompt 8 KiB; narration 4 KiB; on-screen text 1 KiB.
- Video duration is an integer 4–15 seconds. Image duration remains an integer 1–60 seconds.
- Persisted provider job IDs reuse the neutral common `isValidProviderJobId` predicate: 1–512
  URL-unreserved opaque characters; URLs, paths, queries, fragments, whitespace, controls, and
  longer values are rejected. Adapter modules re-export the predicate but do not own its definition.
- `referenceAssetId` remains singular and nullable in Phase 2B. Multi-reference provider input is a
  separate provider/model capability and is not introduced by this UI slice.
- Shelf capacity is 120 total identities, independently bounded by
  `STUDIO_MAX_SHELF_SECTION_ITEMS` at 24 parked sections and `STUDIO_MAX_SHELF_TAKE_ALIASES` at 96
  take aliases. Both per-kind maxima are enforced, not only the total. The section limit also follows
  from `STUDIO_MAX_SECTIONS`, but the take-alias limit is an independent shelf contract. Shelf bounds
  are UI/project bounds, independent from asset-ledger retention.
- Asset `durationSeconds` is a finite number greater than `0` and at most `Number.MAX_SAFE_INTEGER`,
  the bound the schema-1 validator already applies. `Number.MAX_VALUE` is not a bound: it admits
  `1e308` and makes every cut trim comparison against the asset duration vacuously true.

Generation, reference-request, cut-placement, dirty-report, and MCP projection limits remain
independently named even when values coincide, and each validator consumes the constant named for
its own contract. Cut placement uses `STUDIO_MAX_CUT_PLACEMENT_CLIPS`, never
`STUDIO_MAX_CLIPS_PER_PROJECT`, even while both are 96. `STUDIO_PROJECT_SCHEMA_VERSION` is the only
source of the persisted version literal in validators and factories.

### Validator totality and lookup rules

`validateStudioProjectV2` is a total function. Every input, including a corrupt or hostile persisted
record, returns `true` or `false`. It never throws: callers read `false` as "quarantine this record",
and an exception escaping a declared type guard bypasses that path entirely.

- Resolve every record entry by own key. `project.clips[id]`, `project.assets[id]`, and
  `project.jobs[id]` inherit `Object.prototype` members, so an ID of `constructor`, `toString`, or
  `__proto__` — each of which satisfies the safe-ID contract — resolves to an inherited value that is
  not `undefined`. A shared own-value helper must call `Object.hasOwn(record, id)` before reading;
  neither `=== undefined` nor an identity-only recheck is sufficient after prototype pollution.
- Create every ID-indexed record with null-prototype/from-entries semantics, or insert with
  `Object.defineProperty`. Direct assignment of `record['__proto__']` on `{}` mutates the prototype
  instead of creating an own entry. Valid own entries named `constructor`, `toString`, and
  `__proto__` must survive mutation, serialization, restart, and validation.
- Walk the retry graph iteratively with an explicit stack. Job count is unbounded by this contract,
  so validation must be O(entities + reference edges): precompute clip asset membership and job
  positions rather than calling `includes`/`indexOf` per asset or job. A valid acyclic 20,000-link
  chain returns `true`; the same graph with a back-edge returns `false`; neither throws.
- Hoist every key set to module scope. A per-item `new Set([...])` inside a validator allocates once
  per shelf entry on every project read and write.

**Amendment 1 — post-Task-1 contract review.** The provider-job, shelf, duration, totality,
prototype-safe read/write, linear retry, and per-contract constant rules above amend this frozen
contract under the review rule at the top of this section. They name behaviour Task 1 head
`bd2cc4824252ec58976f8597648c8e39612f95f8` does not have; they rename and reinterpret nothing.
Task 1 Fix Round 1 implements the complete amendment, and Gate 1 independently reviews its exact
head before Task 2.

### Persisted entities

```ts
export type StudioSection = {
  id: string;
  title: string;
  storyLine: string;
  visualPrompt: string;
  clipOrder: string[];
};

export type StudioClip = {
  id: string;
  shotPrompt: string;
  narration: string;
  onScreenText: string;
  mediaKind: StudioMediaKind;
  durationSeconds: number;
  referenceAssetId: string | null;
  selectedAssetId: string | null;
  assetIds: string[];
  jobIds: string[];
};

export type StudioShelfItem = { kind: 'section'; sectionId: string } | { kind: 'asset'; assetId: string };
```

`StudioClip` deliberately has no `sectionId`: the unique owning `StudioSection.clipOrder` is the
single ownership authority. Validators build an ownership index and reject missing, duplicate, or
cross-owned clip IDs. `StudioAsset.clipId` is nullable only for project-level Cast/Look imports;
generated takes, thumbnails, reference plates, jobs, cuts, retry lineage, posters, and generation
routes use `clipId`. Clip readiness/review state and every section aggregate are derived rather than
persisted.

`StudioProject` has `schemaVersion: 2`, `sectionOrder`, `sections`, `clips`, and `shelf`; it retains
the existing brief/rules/rule-list undo, project settings, assets, jobs, cuts, timestamps, and
revision fields. Its routing value is exactly `{ image: StudioMediaModelRef | null, video:
StudioMediaModelRef | null }`; schema 2 has no storyboard/planner role. New projects seed
`sectionOrder: []`, `sections: {}`, `clips: {}`, `shelf: []`, and no cuts. The UI empty state creates
a section plus its first clip atomically.
That first section/clip persists empty authored strings, `mediaKind: 'image'`,
`durationSeconds: 5`, null reference/selection, and empty asset/job IDs; localized “Untitled” copy is
presentation-only and never persisted.

`StudioCutClip` uses `clipId`. `StudioProjectSummary` exposes `sectionCount`, `clipCount`,
`selectedAssetCount`, and an optional poster `{ sectionId, clipId, assetId, sectionPosition,
clipPosition }`. Unsupported V1 entries are returned separately as IDs; they are never summarized.

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

`unsupported_prototype_schema` is a new store/service/bridge error/state, distinct from provider/job
`unsupported`. V1 is not corrupt. Unknown/malformed V2 is corrupt and follows the existing loud
storage/quarantine path. The store uses the same status discriminants but returns main-owned
`StudioProject`; only the service converts a supported result to `StudioRendererProject`.

### Mutation vocabulary

```ts
export type StudioMutationOperationV2 =
  | { kind: 'set_brief'; brief: string }
  | {
      kind: 'add_section';
      sectionId: string;
      section: Pick<StudioSection, 'title' | 'storyLine' | 'visualPrompt'>;
      firstClipId: string;
      firstClip: StudioEditableClip;
      beforeSectionId: string | null;
    }
  | { kind: 'edit_section'; sectionId: string; changes: StudioEditableSectionChanges }
  | { kind: 'reorder_sections'; sectionOrder: string[] }
  | { kind: 'park_section'; sectionId: string }
  | { kind: 'restore_section'; sectionId: string; beforeSectionId: string | null }
  | {
      kind: 'add_clip';
      sectionId: string;
      clipId: string;
      clip: StudioEditableClip;
      beforeClipId: string | null;
    }
  | { kind: 'edit_clip'; clipId: string; changes: StudioEditableClipChanges }
  | { kind: 'delete_clip'; clipId: string }
  | { kind: 'reorder_clips'; sectionId: string; clipOrder: string[] }
  | { kind: 'park_take'; clipId: string; assetId: string }
  | { kind: 'select_shelved_take'; clipId: string; assetId: string }
  | { kind: 'remove_shelf_alias'; assetId: string }
  | { kind: 'reorder_shelf'; shelf: StudioShelfItem[] }
  | { kind: 'select_take'; clipId: string; assetId: string };

export type StudioMutationBatchV2 = {
  schemaVersion: 2;
  projectId: string;
  expectedRevision: number;
  operations: StudioMutationOperationV2[]; // 1–32
};

export type StudioMutationBatchResultV2 = {
  project: StudioRendererProject;
  createdSectionIds: string[];
  createdClipIds: string[];
};
```

The pure reducer returns the same ID arrays with a main-owned `StudioProject`; the service performs
the renderer-safe projection only after the durable commit.

Editable section/clip change objects are exact-key, nonempty partials of authored fields only.
Callers mint safe IDs so immutable Director records are deterministic; main rejects collisions and
returns created IDs in operation order. `reorder_*` inputs are exact permutations. `park_section`
appends a section shelf item; `restore_section` removes it and inserts before the named active
section or appends when null. Take aliases append. `reorder_shelf` is an exact permutation of the
complete shelf.

Bounded mutation reasons are `section_capacity_reached`, `section_clip_capacity_reached`,
`project_clip_capacity_reached`, `invalid_clip_duration`, `dependency_blocked`,
`identity_collision`, `invalid_operation`, and `validation_failed`. Store `stale_project`,
`not_found`, `busy`, `storage_error`, and `unsupported_prototype_schema` remain distinct and are not
collapsed into prose matching.

Director commands, slots, leases, receipts, proposals, decisions, and reference requests become
schema version 2 and carry only Section/Clip identities. An applied receipt returns both created ID
arrays. A V1 sidecar is reported as unsupported and remains untouched indefinitely; it does not
produce a receipt or release/delete its V1 slot.

The V2 proposal payload is exactly
`{ kind: 'mutation_batch', operations: StudioMutationOperationV2[] }` or the existing exact
`{ kind: 'pin_rule', rule }` shape under a schema-2 proposal envelope. A V2 reference request is
exactly `{ clipIds: string[] }` under its schema-2 envelope, with 1–24 unique active clip IDs in the
requested order and the `STUDIO_MAX_REFERENCE_REQUEST_CLIPS` bound. Proposal acceptance delegates to
the same reducer; reference requests never submit work.

`derivePayableClipIds` walks selected active sections in `sectionOrder`, then their `clipOrder`, and
stable-deduplicates IDs. A clip is payable only when the section has a nonempty title and inherited
visual prompt, the clip has a nonempty shot prompt, the clip is valid for its media kind, there is
no active job, no canonical generated take of the same kind, and the latest job is neither failed
nor needs-attention. Route/catalog checks remain part of reviewed submission. Narration, story line,
and on-screen text are optional authored fields, not readiness gates.

---

## Target file structure

The final renderer shape replaces old directories; it does not add peers beside them:

```text
packages/desktop/src/renderer/pages/studio/
├── components/
│   ├── EngineStrip/
│   ├── Generation/
│   ├── Library/
│   ├── Preview/
│   ├── Rules/
│   ├── Workspace/
│   │   ├── index.tsx
│   │   ├── types.ts
│   │   ├── WorkspaceShell/
│   │   ├── DirectorLayout/
│   │   │   ├── index.tsx
│   │   │   ├── DirectorLayout.module.css
│   │   │   ├── useDirectorLayout.ts
│   │   │   ├── Conversation/
│   │   │   └── Proposals/
│   │   ├── TableView/
│   │   ├── BoardView/
│   │   ├── SectionInspector/
│   │   ├── SelectionBar/
│   │   └── Brief/
│   └── index.ts
├── hooks/
│   ├── workspace/
│   ├── index.ts
│   ├── useManagedVideo.ts
│   ├── useStudioJobs.ts
│   ├── useStudioModels.ts
│   └── useStudioVideoPosterCapture.ts
├── StudioPage.tsx
├── StudioPage.module.css
├── StudioTypography.module.css
├── index.tsx
├── studioRoute.ts
├── studioReadiness.ts
└── studioRouteConstraints.ts
```

Delete `components/PhaseShell`, `components/Shell`, `components/Storyboard`, root
`SceneTimeline.*`, CutEditor/ReviewCut/export UI, `hooks/useCutEditor.ts`, the public Cut render hook,
and their scene/Cut tests after their reusable Director, Brief, preview, and orchestration pieces
have moved. The main-process render service remains internal only to preserve and test the approved
clip-aware cut projection; no renderer bridge route can invoke it in Phase 2B.

The final test tree is count-compliant and contains no single-file directory:

```text
tests/unit/pages/studio/                 # 7 direct children
├── EngineStrip/
├── Generation/
├── Settings/
├── Workspace/                          # 6 direct children
│   ├── DirectorLayout/
│   ├── State/
│   ├── Shell/
│   ├── TableView/
│   ├── BoardView/
│   └── SectionInspector/
├── StudioLibrary.dom.test.tsx
├── StudioPage.dom.test.tsx
└── studioI18n.test.ts
```

Task 6 performs the exact moves/deletes that establish this tree before adding new tests. Every gate
records `find <dir> -mindepth 1 -maxdepth 1 | wc -l` for touched source/test directories and fails
if a new directory has fewer than two or more than ten direct children.

---

## Delivery Gate 1 — schema and mutation foundation

### Task 1 — Add exact schema-2 contracts and pure validation

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/index.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/factories.test.ts`
- Modify: `tests/unit/process/creative-studio/types/canonicalTake.test.ts`
- Create: `tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`

**Steps**

- [ ] Add exact V2 types and independently named constants from the frozen contract while retaining
      the current V1 public aliases only as an unexposed staging seam. Every constant added must have
      at least one consumer by the end of its owning task; an unreferenced limit is not centralized.
      Task 1 declares `STUDIO_MAX_MUTATION_OPERATIONS`, and Task 2 owns its first consumer because no
      mutation batch parser or reducer exists before Task 2.
- [ ] RED: reject unknown keys, duplicate ownership, orphan assets/jobs/cuts, active+shelf section
      overlap, invalid shelf aliases, 25 sections, 9 clips in one section, 97 clips, 25 parked shelf
      sections, 97 take aliases, shelf item 121, video 3/16 seconds, and unsafe provider job IDs;
      accept every exact boundary, including 24 parked sections, 96 take aliases, and 120 total shelf
      identities. Build the accepted 120-item shelf fixture with 24 parked sections plus 96 aliases;
      the former 23-plus-97 fixture asserted the wrong contract.
- [ ] RED totality, per the validator totality and lookup rules: an asset `clipId`, job `clipId`,
      shelf `assetId`, `selectedAssetId`, or `referenceAssetId` of `constructor`, `toString`, or
      `__proto__`; a 20,000-link retry graph; and an asset `durationSeconds` of `1e308`. Invalid
      inherited references and a long graph with a back-edge return `false`; a valid acyclic 20,000-
      link chain returns `true`; none throws. Positive cases prove own record entries named
      `constructor`, `toString`, and `__proto__` remain valid IDs.
- [ ] Implement dependency-free exact validators and `createEmptyStudioProjectV2()` with empty
      Section/Clip/shelf/cut state. Resolve every record entry by own key, walk the retry graph
      iteratively in linear time with precomputed per-clip membership and job-position indexes, reuse
      the neutral common provider-job-ID predicate, and consume the constant named for each contract.
- [ ] Convert canonical-take and summary projection helpers to explicit V2 variants; test stable
      active Section→Clip poster ordering and exclusion of parked sections.
- [ ] Mutation proof: remove unique clip-ownership validation and prove the cross-section duplicate
      test fails; restore it.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/service/schema2 tests/unit/process/creative-studio/types/canonicalTake.test.ts tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): define schema 2 section and clip contracts`.

### Task 1 Fix Round 1 — satisfy Amendment 1 before Task 2

Independent reviews of `bd2cc4824252ec58976f8597648c8e39612f95f8` found the contract gaps Amendment 1
names. The original tests pass without covering them. Task 2 does not start until the complete round
below is green and independently re-reviewed.

**Files**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/adapters/types.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`

**Steps**

- [ ] RED provider job IDs at 512/513 and URL/path/query/fragment/whitespace/control boundaries. Move
      the single pure predicate to the common contract, re-export it from adapter types, and import it
      directly from common in both schema validators. The schema2 directory imports no adapter code.
- [ ] RED 24/25 parked sections, 96/97 take aliases, 120/121 total shelf identities, asset duration at
      `Number.MAX_SAFE_INTEGER`/`1e308`, and a cut trim of `1e300` against a safely bounded asset.
- [ ] RED every reference-derived clip/asset/job/cut/provenance/output/snapshot/retry/shelf lookup with
      inherited `constructor`, `toString`, and `__proto__` values. Each invalid case returns `false`
      without throwing. Positive fixtures built with `Object.fromEntries` prove valid own records using
      all three names are accepted; prototype-polluted valid-looking inherited records are rejected.
- [ ] RED a valid acyclic 20,000-job retry chain as `true`, the same chain with a back-edge as `false`,
      plus self-cycle, missing predecessor, reversed order, and converging-chain cases. Keep the normal
      test timeout; do not replace total validation with a depth cap or catch-and-return-false.
- [ ] Implement one own-value helper, iterative three-colour retry traversal, and precomputed per-clip
      asset-membership/job-position indexes so validation is linear in entities and links.
- [ ] Consume the shelf, cut-placement, and schema-version constants named for their contracts. Bound
      asset duration at `Number.MAX_SAFE_INTEGER`; hoist every key set. The mutation-operation constant
      remains deliberately declaration-only until Task 2 introduces the batch boundary.
- [ ] Mutation proofs: reintroduce a bare inherited lookup and prove the matching totality test fails;
      restore recursive retry traversal and prove the reversed 20,000-chain test fails; restore both.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/service/schema2 tests/unit/process/creative-studio/types tests/unit/process/creative-studio/providerAdapters.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Obtain independent re-review of this round against Amendment 1 before Task 2.
- [ ] Commit: `fix(studio): enforce exact schema 2 validation contract`.

### Task 2 — Implement the shared ordered reducer and clip-aware cuts

**Files**

- Rename: `packages/desktop/src/process/services/creative-studio/service/mutationHelpers.ts` →
  `packages/desktop/src/process/services/creative-studio/service/projectMutations.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/schema2/cuts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/index.ts`
- Rename: `tests/unit/process/creative-studio/service/mutationHelpers.test.ts` →
  `tests/unit/process/creative-studio/service/projectMutations.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/mutations.test.ts`
- Create: `tests/unit/process/creative-studio/service/schema2/cuts.test.ts`

**Steps**

- [ ] Preserve the current V1 helper behavior under its renamed file only until Task 6 removes it;
      do not mix V1 and V2 branches in one reducer.
- [ ] RED every V2 operation, ordered later-op visibility, input immutability, late-op rollback,
      1/32/33 operation boundaries, capacity precedence, collision rejection, exact permutations, and
      created-ID ordering.
- [ ] RED dependency-free clip deletion, park/restore, asset alias constraints, selected/cut take
      refusal, select-shelved atomicity, and shelf focus identity inputs.
- [ ] Implement `applyStudioMutationBatchV2(project, batch)` as a pure draft reducer returning the
      next project plus created IDs. Preserve jobs/assets/routing/rules/rule-list undo unless an
      exact operation owns a field. Enforce the nonempty batch boundary with
      `STUDIO_MAX_MUTATION_OPERATIONS`; do not duplicate the literal. Insert IDs with
      own-property/null-prototype semantics; RED
      add-section/add-clip IDs of `constructor`, `toString`, and `__proto__`, then serialize, parse,
      validate, and apply a later mutation to the same identities.
- [ ] Implement clip-aware cut reconciliation: storyboard ordering, dormant parked entries, complete
      manual order, trim clamping, no new manual entry, and no cut-linked deletion.
- [ ] Static fence the schema2 directory from filesystem, IPC, job manager, resolver, adapter,
      polling, retry, cancel, and render imports.
- [ ] Mutation proofs: persist after each operation and prove the one-revision/rollback tests fail;
      delete the dormant-cut branch and prove park/restore tests fail; restore both.
- [ ] Run: `bunx vitest run tests/unit/process/creative-studio/service/schema2` and
      `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add atomic section and clip mutations`.

### Task 3 — Add schema-aware store inspection without touching V1

**Files**

- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/index.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Create: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`
- Modify: `docs/contributing/development.md`

**Steps**

- [ ] Add a bounded schema sniff before V2 parsing and return supported, unsupported V1, not-found,
      and malformed-V2 states explicitly. Do not call `migrateSchemaV1Project` on the V2 path.
- [ ] Add V2 create/read/list/summary/update-batch/delete store seams used only by V2 tests until Task 6.
      Keep rename+directory-fsync commit facts, one-revision CAS, and commit tags unchanged. V2 owns a
      separate root `projects-v2.json` index with `schemaVersion: 2`; no V2 read, repair, create,
      delete, or commit path reads or writes the prototype `projects.json` index.
- [ ] RED a complete V1 profile tree containing `project.json`, `projects.json`, `.part`, proposal,
      decision, reference request, command, slot, lease, and receipt. First test the V1-only profile;
      then place that same tree beside a valid V2 project whose normal lifecycle is allowed to run.
      Call get/list/start-facing inspection and assert the V1 tree has an identical path set, bytes,
      metadata hashes, zero mkdir/write/rename/rm, and no quarantine in both cases.
- [ ] RED malformed schema 2 separately and prove it remains a loud storage/quarantine failure.
- [ ] RED fresh empty V2 create/restart, V2 delete, mixed V1+V2 listing, poster summary, batch rollback,
      stale CAS, and exactly one revision/observer fact. V2 delete removes only the resolved supported
      project tree and updates only `projects-v2.json`; an unsupported V1 ID returns
      `unsupported_prototype_schema` without touching its tree or `projects.json`. Expose an
      unregistered, side-effect-free supported-V2 ID inventory that refreshes after create/delete and
      always excludes V1. Task 3 owns no runtime activation: it does not start cleanup, watchers,
      protocol, mailbox processing, or recovery. Task 6 owns activation and proves that every
      lifecycle consumer uses this inventory.
- [ ] Update `docs/contributing/development.md` with accurate `Forge-Dev`/`Forge-Dev-2`, a fresh named
      profile workflow, and manual profile removal only while the app is stopped. Add no app reset
      command.
- [ ] Mutation proof: route V1 through the old migrator and prove the no-touch integration test
      fails; restore it.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/store.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): isolate schema 2 project storage`.

### Task 4 — Convert operational ownership to clips behind the V2 service seam

**Files**

- Modify/finalize: `packages/desktop/src/common/types/project/creativeStudioOutputRole.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/index.ts`
- Create: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/renderService.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/unit/process/creative-studio/jobManager.test.ts`
- Modify: `tests/unit/process/creative-studio/mediaStore.test.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts`
- Modify: `tests/integration/creative-studio/renderService.integration.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`

**Steps**

- [x] Add V2 service methods beside the unregistered V1 service surface: load/list/create/delete V2,
      `applyMutations`, clip-owned media attachment, clip-owned route/readiness projection, and
      `submitClips`. Do not expose them through IPC yet.
- [x] Add a schema-2 operational store callback and verified-directory seam that share Task 3's
      per-project queue, CAS, one-revision commit, observer, validator, and `projects-v2.json` repair.
      They classify schema 1 before invoking callbacks or returning a path and never call the schema-1
      migrator, `projects.json`, or a schema-blind writable-root helper.
- [x] Add explicitly named V2-only cleanup, recovery, resume, submit, retry, retry-download, cancel,
      attachment, and render-projection entrypoints in job manager/media store/render service. Convert
      `creativeStudioOutputRole.ts` to accept both explicitly named job contracts without weakening the
      output-role default. Keep the existing singleton V1 methods wired and behaviourally unchanged
      through Gate 1; Task 6C switches runtime ownership and Task 6D removes the unreachable V1
      entrypoints.
- [x] Convert V2 asset/job/reference/poster/output/retry/cancel/recovery checks to `clipId`; keep
      project-level Cast/Look assets at `clipId: null`. Preserve provider identity, idempotency,
      submission ambiguity, download recovery, cancellation policy, and rule enforcement.
- [x] Replace the implicit legacy cut with V2 clip-aware persisted and active render projections.
      Rendering filters dormant entries; persistence never deletes them merely because a section is
      parked.
- [x] Replace generation input with ordered unique `clipIds` and route entries keyed by `clipId`.
      Process rechecks active ownership, authored readiness, 1–24 count, catalog/revision, and
      routes immediately before the sole `jobManager.submitClips` boundary.
- [x] RED foreign-clip output, wrong-kind selection, poster lineage, retry recovery, dormant cuts,
      manual order, stale catalog, ambiguous submit, and unsupported-project recovery exclusion.
- [x] Extend the dynamic paid fence with submit/retry/retryDownload/cancel/render/resolver/adapter
      poisons around every free V2 operation.
- [x] Mutation proof: permit a foreign-clip output attachment and prove media tests fail; move V2
      revision checking after job preparation and prove the zero-spend stale test fails; restore.
- [x] Run:
      `bunx vitest run tests/unit/process/creative-studio/mediaStore.test.ts tests/unit/process/creative-studio/jobManager.test.ts tests/unit/process/creative-studio/service/index.test.ts tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts tests/integration/creative-studio/renderService.integration.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts tests/integration/creative-studio/projectRecovery.integration.test.ts`
      and `bunx tsc --noEmit`.
- [x] Commit: `refactor(studio): make operations clip owned`.

### Task 5 — Version Director, proposal, reference, and MCP records

**Files**

- Create: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandMailbox.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandContracts.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandService.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts`
- Modify: `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Modify/stage V2 fixtures: `tests/integration/creative-studio/directorCommandLatency.integration.test.ts`

**Steps**

- [ ] Add exact schema-2 command/slot/lease/receipt/proposal/decision/reference shapes and all V2
      operations. Preserve existing record byte, timing, lease, cursor, retention, and immutable-I/O
      constants.
- [ ] Keep the current V1 writer/server exports registered through Gate 1. Add explicitly named V2
      writer/tool-definition entry points in the same existing files and test them directly; do not
      switch the builtin server, mailbox coordinator, runtime, or descriptor until Task 6.
- [ ] Make V1 sidecars an explicit read-only unsupported result. A V1 pending record must not call
      `completeTerminal`, write a receipt, delete pending, remove a slot/lease, or create a mailbox
      directory.
- [ ] Delegate Director application to `applyStudioMutationBatchV2` inside the existing correlated
      store callback. Preserve CAS-before-callback, deadline, unsupported/capacity/semantic
      precedence, one revision, commit attribution, receipt-first cleanup, restart ambiguity, and
      exactly-once notification.
- [ ] Update `read_storyboard`, `studio_apply_edits`, `studio_get_command_status`, proposal, and
      reference tools to Section/Clip V2. `tools/list` must serialize nonempty exact schemas with a
      canonical V2 example; do not carry legacy `scene*` names.
- [ ] Instantiate a real `McpServer` over paired in-memory transports and assert `tools/list` exposes
      required `expectedRevision`/`operations`, every operation alternative and nested field, strict
      unknown-key rejection, and the canonical V2 batch. Prove add+reorder rejection happens before
      handler execution or ID minting.
- [ ] Bound available-take projection to 24 per clip in deterministic clip asset order; selected
      take remains visible even when it would otherwise fall beyond the slice.
- [ ] Add the tracked include-only Studio coverage configuration. Its explicit manifest covers every
      executable production file changed since the frozen baseline, including runtime helpers under
      `common/types/**`, and enforces per-file line and branch thresholds of 80%. Later tasks update the
      manifest whenever they add or change executable production files.
- [ ] RED every operation, created-ID arrays, reference-request 0/24/25 and duplicate clip IDs, V1
      no-touch, malformed V2, lease races, cursor recovery, restart receipt repair, and no paid
      dependency. Preserve existing writer/mailbox mutation tests.
- [ ] Mutation proofs: send a V1 record through terminal cleanup and prove the byte-tree test fails;
      bypass the shared reducer and prove reducer-parity tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/creative-studio/service/directorCommandService.test.ts tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts tests/unit/process/creative-studio/service/index.test.ts tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): version director commands for schema 2`.

### Gate 1 review checkpoint

- [ ] Freeze the exact Task 1–5 head and obtain independent process/schema and security/spend review.
- [ ] Verify V2 code is still unregistered from the renderer bridge, current V1 UI behavior is
      unchanged, and no V1 profile tree changed during tests.
- [ ] Run `bun run test`, `bun run test:coverage`,
      `bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage`,
      `bun run lint --quiet`,
      `bun run format:check`, `bunx tsc --noEmit`, and
      `git diff --check 21bf87ae1674598bd42ea88c5f13c74e8389b3c0...HEAD -- . ':(exclude)docs/prds/creative-studio/creative-studio-2-table-board-reference.html.txt'`.
      Verify the excluded frozen reference separately against its required SHA-256.
- [ ] Resolve every Critical/Important finding in separate commits and re-review before Task 6.

---

## Delivery Gate 2 — atomic cutover, workspace shell, and Director layout

### Task 6 — Atomically switch runtime, bridge, routes, and renderer ownership to V2

**Files**

- Modify: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify/finalize: `packages/desktop/src/common/types/project/creativeStudioCanonicalTake.ts`
- Modify/finalize: `packages/desktop/src/common/types/project/creativeStudioProjectSummary.ts`
- Modify/finalize: `packages/desktop/src/common/types/project/creativeStudioManagedAssetCollections.ts`
- Modify/finalize: `packages/desktop/src/common/types/project/creativeStudioOutputRole.ts`
- Delete/replace: `packages/desktop/src/common/types/project/creativeStudioProposalDiff.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/common/adapter/native/constants.ts`
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/runtime.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/renderService.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Delete after 6C switch: `packages/desktop/src/process/services/creative-studio/service/projectMutations.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/service/directorCommandMailbox.ts`
- Modify/finalize: `packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts`
- Modify/finalize: `packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts`
- Modify/finalize: `packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts`
- Modify/finalize: `packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts`
- Modify/finalize: `packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts`
- Modify/finalize: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Delete: `packages/desktop/src/process/services/creative-studio/planning/index.ts`
- Delete: `packages/desktop/src/process/services/creative-studio/planning/storyboardPlanner.ts`
- Delete: `packages/desktop/src/process/services/creative-studio/planning/storyboardPrompt.ts`
- Delete: `packages/desktop/src/process/services/creative-studio/planning/fitStoryboardDurations.ts`
- Delete: `tests/unit/process/creative-studio/planning/storyboardPlanner.test.ts`
- Delete: `tests/unit/process/creative-studio/planning/storyboardPrompt.test.ts`
- Delete: `tests/unit/process/creative-studio/planning/fitStoryboardDurations.test.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/index.ts`
- Rename: `packages/desktop/src/renderer/pages/studio/studioPhaseRoute.ts` →
  `packages/desktop/src/renderer/pages/studio/studioRoute.ts`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/types.ts`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/WorkspaceShell.module.css`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/StudioShell.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/index.tsx`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/StudioShell.module.css` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/DirectorLayout.module.css`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/useStudioPanes.ts` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/useStudioPanes.ts`
- Move: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/useStudioLayoutMode.ts` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/useStudioLayoutMode.ts`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/StudioLayoutContext.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/StudioLayoutContext.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/index.tsx`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorPane.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/DirectorPane.tsx`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorPane.module.css` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/DirectorPane.module.css`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/BriefConversationContext.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/BriefConversationContext.tsx`
- Move: `packages/desktop/src/renderer/pages/studio/components/Shell/StudioDirectorRevealContext.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/DirectorRevealContext.tsx`
- Move/rewrite: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/StudioConversationSurface.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/StudioConversationSurface.tsx`
- Move/rewrite: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/studioBriefConversation.ts` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/studioDirectorConversation.ts`
- Move/rewrite: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation.ts` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/useDirectorConversation.ts`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Proposals/index.tsx`
- Move/rewrite: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Proposals/DirectorProposalCard.tsx`
- Move/rewrite: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Proposals/DirectorProposals.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/Brief/index.tsx`
- Move/rewrite: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/BriefDrawer/StudioBriefDrawer.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/Brief/StudioBriefDrawer.tsx`
- Move: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/BriefDrawer/StudioBriefDrawer.module.css` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/Brief/StudioBriefDrawer.module.css`
- Move: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/BriefDrawer/StudioBriefReferences.tsx` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/Brief/StudioBriefReferences.tsx`
- Move: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/BriefDrawer/StudioBriefReferences.module.css` →
  `packages/desktop/src/renderer/pages/studio/components/Workspace/Brief/StudioBriefReferences.module.css`
- Delete after export rewrite: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/BriefDrawer/index.ts`
- Create in 6B: `packages/desktop/src/renderer/pages/studio/hooks/workspace/index.ts`
- Create in 6B: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceProject.ts`
- Create in 6B: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceEditor.ts`
- Create in 6B: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceDraftPersistence.ts`
- Delete in 6D: `packages/desktop/src/renderer/pages/studio/hooks/useStudioProject.ts`
- Delete in 6D: `packages/desktop/src/renderer/pages/studio/hooks/useStoryboardEditor.ts`
- Delete in 6D: `packages/desktop/src/renderer/pages/studio/hooks/useDraftPersistence.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationJobList.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Generation/generationRequests.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Generation/routeSupport.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Preview/StagePreview.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Preview/AssetStrip.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Preview/managedStudioAssets.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Preview/managedVideo.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/hooks/useStudioJobs.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/hooks/useStudioModels.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/hooks/useStudioVideoPosterCapture.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/hooks/index.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/EngineStrip/EngineStrip.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/EngineStrip/engineState.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Library/ProjectCard.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/components/Library/StudioLibrary.tsx`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/studioReadiness.ts`
- Modify for V2 compilation: `packages/desktop/src/renderer/pages/studio/studioRouteConstraints.ts`
- Delete after moves: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/`
- Delete after moves: `packages/desktop/src/renderer/pages/studio/components/Shell/`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Storyboard/`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Preview/CutEditor/`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Preview/ReviewCut.tsx`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Preview/StudioExportModal.tsx`
- Delete: `packages/desktop/src/renderer/pages/studio/components/SceneTimeline.tsx`
- Delete: `packages/desktop/src/renderer/pages/studio/components/SceneTimeline.module.css`
- Delete: `packages/desktop/src/renderer/pages/studio/hooks/useCutEditor.ts`
- Delete: `packages/desktop/src/renderer/pages/studio/hooks/useStudioRender.ts`
- Modify: `tests/unit/process/bridge/creativeStudioBridge.test.ts`
- Modify: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`
- Modify: `tests/unit/process/creative-studio/runtime.test.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/unit/process/creative-studio/jobManager.test.ts`
- Modify: `tests/unit/process/creative-studio/mediaStore.test.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandContracts.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandService.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts`
- Modify: `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`
- Delete after 6C switch: `tests/unit/process/creative-studio/service/projectMutations.test.ts`
- Modify: `tests/unit/process/creative-studio/types/canonicalTake.test.ts`
- Modify: `tests/unit/process/creative-studio/types/projectSummaryV2.test.ts`
- Delete/replace: `tests/unit/process/creative-studio/types/proposalDiff.test.ts`
- Modify: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Modify/finalize: `tests/integration/creative-studio/directorCommandLatency.integration.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/renderService.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`
- Modify: `tests/unit/pages/studio/StudioPage.dom.test.tsx`
- Move/rewrite: `tests/unit/pages/studio/Shell/StudioShell.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/DirectorLayout.dom.test.tsx`
- Move: `tests/unit/pages/studio/Shell/useStudioPanes.dom.test.ts` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/useStudioPanes.dom.test.ts`
- Move: `tests/unit/pages/studio/Shell/DirectorPane.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/Conversation/DirectorPane.dom.test.tsx`
- Move/rewrite: `tests/unit/pages/studio/Storyboard/Brief/BriefConversation.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/Conversation/DirectorConversation.dom.test.tsx`
- Move/rewrite: `tests/unit/pages/studio/Storyboard/Brief/studioBriefConversation.test.ts` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/Conversation/studioDirectorConversation.test.ts`
- Move/rewrite: `tests/unit/pages/studio/Storyboard/Brief/useBriefConversationPin.dom.test.ts` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/Conversation/useDirectorConversationPin.dom.test.ts`
- Move/rewrite: `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/Proposals/DirectorProposalCard.dom.test.tsx`
- Move/rewrite: `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/DirectorLayout/Proposals/DirectorProposals.dom.test.tsx`
- Move/rewrite: `tests/unit/pages/studio/Storyboard/Brief/StudioBriefDrawer.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/Shell/StudioBriefDrawer.dom.test.tsx`
- Move: `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/Shell/StudioAccessibleCopy.dom.test.tsx`
- Delete: `tests/unit/pages/studio/StudioDocumentActivity.dom.test.tsx`
- Delete: `tests/unit/pages/studio/StudioPhaseHeader.dom.test.tsx`
- Move/rewrite: `tests/unit/pages/studio/StudioPhaseShell.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/Shell/WorkspaceShell.dom.test.tsx`
- Move: `tests/unit/pages/studio/studioFrameLayout.test.ts` →
  `tests/unit/pages/studio/Workspace/Shell/studioFrameLayout.test.ts`
- Move: `tests/unit/pages/studio/studioStylesheetComposes.test.ts` →
  `tests/unit/pages/studio/Workspace/Shell/studioStylesheetComposes.test.ts`
- Move: `tests/unit/pages/studio/studioReadiness.test.ts` →
  `tests/unit/pages/studio/Workspace/State/studioReadiness.test.ts`
- Move: `tests/unit/pages/studio/studioRouteConstraints.test.ts` →
  `tests/unit/pages/studio/Workspace/State/studioRouteConstraints.test.ts`
- Create for the 6B V2 stubs: `tests/unit/pages/studio/Workspace/State/useWorkspaceEditor.dom.test.ts`
- Create for the 6B V2 stubs: `tests/unit/pages/studio/Workspace/State/useWorkspaceDraftPersistence.dom.test.ts`
- Delete in 6D: `tests/unit/pages/studio/Storyboard/useStoryboardEditor.dom.test.ts`
- Delete in 6D: `tests/unit/pages/studio/Storyboard/useDraftPersistence.dom.test.ts`
- Delete: `tests/unit/pages/studio/Storyboard/StoryboardDraftModal.dom.test.tsx`
- Delete: `tests/unit/pages/studio/Storyboard/WritePhase.dom.test.tsx`
- Delete: `tests/unit/pages/studio/Generation/ProducePhase.dom.test.tsx`
- Delete: `tests/unit/pages/studio/Generation/ReviewPhase.dom.test.tsx`
- Delete: `tests/unit/pages/studio/StudioExport.dom.test.tsx`
- Modify for V2: `tests/unit/pages/studio/Generation/GenerationJobList.dom.test.tsx`
- Modify for V2: `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`
- Modify for V2: `tests/unit/pages/studio/Generation/generationRequests.test.ts`
- Modify for V2: `tests/unit/pages/studio/Generation/routeSupport.test.ts`
- Modify for V2: `tests/unit/pages/studio/Generation/StagePreview.dom.test.tsx`
- Modify for V2: `tests/unit/pages/studio/Generation/managedVideo.dom.test.ts`
- Modify for V2: `tests/unit/pages/studio/Generation/useStudioJobs.dom.test.ts`
- Modify for V2: `tests/unit/pages/studio/Generation/useStudioVideoPosterCapture.dom.test.ts`
- Modify for V2: `tests/unit/pages/studio/EngineStrip/EngineStrip.dom.test.tsx`
- Modify for V2: `tests/unit/pages/studio/EngineStrip/engineState.test.ts`
- Move/rewrite for V2: `tests/unit/pages/studio/Models/useStudioModels.dom.test.ts` →
  `tests/unit/pages/studio/EngineStrip/useStudioModels.dom.test.ts`
- Move: `tests/unit/pages/studio/Rules/StudioRulesDrawer.dom.test.tsx` →
  `tests/unit/pages/studio/Workspace/Shell/StudioRulesDrawer.dom.test.tsx`
- Modify for V2: `tests/unit/pages/studio/StudioLibrary.dom.test.tsx`
- Modify: `tests/unit/e2e/creativeStudioSelectors.dom.test.tsx`
- Modify: all 12
  `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`
- Modify: `tests/e2e/features/workspaces/creative-studio.e2e.ts`

**Execution decomposition**

Task 6 preserves one atomic public contract switch, but it is not one review-sized commit. Execute
these phases serially, keep each phase compiling with its focused tests, and never expose V1 and V2
as simultaneous public choices:

- **6A — behavior-neutral relocation:** execute every Task 6 `Move` row under `PhaseShell`, `Shell`,
  Brief, and their tests as a byte/behavior-preserving move plus import/barrel rewrites. For each
  `Move/rewrite` row, 6A performs only the move; 6C owns the V2 rewrite at the destination. The three
  legacy root hooks stay at their original paths until 6D. Registered V1 bridge, runtime, routes,
  props, fixtures, and behavior remain unchanged. Run the relocated Shell/Brief/Director tests and
  `bunx tsc --noEmit`. Commit: `refactor(studio): prepare workspace ownership`.
- **6B — unregistered V2 renderer closure:** create exactly `Workspace/index.tsx`,
  `Workspace/types.ts`, `Workspace/WorkspaceShell/**`, `hooks/workspace/index.ts`,
  `hooks/workspace/useWorkspaceProject.ts`, `hooks/workspace/useWorkspaceEditor.ts`,
  `hooks/workspace/useWorkspaceDraftPersistence.ts`, and their new Workspace/State/Shell tests behind
  an unregistered V2 entrypoint. `useWorkspaceProject` may load the staged V2 service. The editor and
  draft hooks are typed read-only compilation stubs with no V1 key access, save, replay, or mutation
  behavior. Every
  active Library, Generation, Preview, EngineStrip, readiness, and route file listed as “Modify for V2
  compilation” is deferred intact to 6C—there is no implementer choice or unnamed counterpart. Run
  the new Workspace/State/Shell tests, assert no native/route/barrel registration reaches the V2
  entrypoint, and run `bunx tsc --noEmit`. Commit: `refactor(studio): prepare schema 2 renderer`.
- **6C — atomic public cutover:** modify the listed common aliases/projections, native/bridge paths,
  root `creative-studio/index.ts`, store/runtime/service/job/media/render paths, Director/MCP paths,
  `StudioPage`, Library, Generation, Preview, EngineStrip, readiness/routes, every 6A destination
  marked “rewrite”, and their listed tests/integrations/locales/E2E in one commit. Switch all public
  ownership to V2, remove reference-request auto-submit before clip submission is reachable, and
  remove public Cut/render providers. The only temporary legacy aliases permitted after the switch are
  `StudioProjectV1`, `StudioRendererProjectV1`, `StudioProjectSummaryV1`, `StudioSceneV1`,
  `StudioAssetV1`, `StudioJobV1`, `StudioCutV1`, `StudioCutClipV1`,
  `StudioUpdateSceneRequestV1`, `StudioReorderScenesRequestV1`, `StudioPlaceCutScenesRequestV1`,
  `StudioSubmitScenesRequestV1`, `StudioFitStoryboardRequestV1`, and
  `StudioDismissReferenceRequestsRequestV1`, plus Task 5's exact `StudioDirectorNewSceneV1`,
  `StudioDirectorOperationV1`, `StudioDirectorCommandRecordV1`, `StudioDirectorCommandSlotV1`,
  `StudioDirectorCommandSlotLeaseV1`, `StudioDirectorAppliedReceiptV1`,
  `StudioDirectorRejectedReceiptV1`, `StudioDirectorExpiredReceiptV1`,
  `StudioDirectorIndeterminateReceiptV1`, and `StudioDirectorCommandReceiptV1`; each may be imported
  only by a 6D deletion target.
  Before this commit only V1 is public, and after it only V2 is public. Run the complete process,
  bridge, lifecycle, StudioPage/Library/Generation/Preview/EngineStrip, route, selector, and feature-
  flag test set listed below, then `bunx tsc --noEmit`. Commit:
  `feat(studio): cut over public studio to schema 2`.
- **6D — legacy deletion and ratchet:** delete every Task 6 `Delete` row, the three original root hooks,
  V1-only tests, `projectMutations`, planner, scene phases, Storyboard, Cut/Export UI, all temporary V1
  aliases above, and all compatibility barrels. Finalize direct V2 seeds, locales, coverage manifest,
  and directory counts. Run the full Task 6 focused command, i18n, TypeScript, lint, format, and the
  retained-source legacy-symbol scan. Commit: `refactor(studio): remove legacy scene workspace`.

Use these phase gates; a later phase does not begin on a failing command:

```bash
# 6A
bunx vitest run tests/unit/pages/studio/Workspace/DirectorLayout tests/unit/pages/studio/Workspace/Shell
bunx tsc --noEmit

# 6B
bunx vitest run tests/unit/pages/studio/Workspace/State tests/unit/pages/studio/Workspace/Shell tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/process/bridge/creativeStudioBridge.test.ts
bunx tsc --noEmit

# 6C
# Run the complete focused Vitest command under Task 6 Steps, then:
bun run i18n:types
node scripts/check-i18n.js
bunx tsc --noEmit

# 6D
# Re-run the complete focused Vitest command under Task 6 Steps, then:
bun run i18n:types
node scripts/check-i18n.js
bunx tsc --noEmit
bun run lint --quiet
bun run format:check
```

**Steps**

- [ ] RED exact native provider inventory: one `apply-mutations` provider, V2 load/list/create/delete,
      one `retry-runtime-activation` provider, clip media/submit providers, one image/video-only
      model-selection provider, and manifest/schema parity. The inventory has no storyboard model,
      update-scene, reorder-scenes, select-asset, or Cut provider.
- [ ] Replace the public `StudioProject`/renderer aliases with V2; delete temporary V1 aliases and
      staging methods. Keep independent connection/adapter/prompt protocol V1 names unchanged.
- [ ] Delete schema-1 `validateProject` in `store.ts`, then delete only predicates/value sets proven
      dead by TypeScript, lint, and exact symbol-usage review. Keep boundary-local `isRecord`, safe-ID,
      provider, media, protocol, mailbox, and adapter guards that still have independent consumers;
      generic identifier-name uniqueness is not a correctness oracle. After 6D, scan the retained
      compilation closure for V1 project/scene types and obsolete validator exports, not helper names.
- [ ] Switch runtime startup to classify supported V2 projects before any mutating lifecycle action.
      Unsupported V1 bypasses cleanup, reapers, mailboxes, watchers, protocol, job recovery,
      resolvers, and adapters and returns the explicit UI state. In a mixed root, all lifecycle
      traversals receive or derive a refreshable supported-V2 ID set and leave the complete V1 tree
      and `projects.json` untouched. If startup has no V2 project, first V2 creation performs one
      idempotent activation of protocol/watchers/processor/recovery; V1-only→create-V2 and
      empty→create-V2 work without restart.
- [ ] Define first-V2 activation as a single-flight state machine. Commit and fsync the new project and
      `projects-v2.json` before activation, refresh the supported-ID inventory, then install protocol,
      watchers, processor, and recovery in a fixed order. Concurrent creates join the same activation.
      On rejection, tear down only components installed by that attempt in reverse order, clear the
      single-flight promise, retain every committed project, perform zero provider work, and allow the
      next create or explicitly named `retryStudioRuntimeActivationV2` service call to activate. A
      create whose durable commit succeeded but activation failed returns the discriminated
      `created_runtime_degraded` result with its project ID; clients must not retry creation. Shutdown
      cancels/awaits the in-flight attempt and prevents any post-shutdown install. RED concurrent
      creates, failure at each install boundary, retry after failure, and create-versus-shutdown;
      assert no project rollback/deletion, no V1 byte change, no duplicate watcher/processor, and no
      paid dependency.
- [ ] Deleting the last V2 project refreshes the supported-ID set to empty but does not tear down the
      ready global infrastructure; every traversal becomes a gated no-op, leaves any V1 tree untouched,
      and a later V2 create reuses the ready runtime without duplicate installation. RED
      create→delete-last→V1-only idle→create-again in one process.
- [ ] Expose `retryStudioRuntimeActivationV2` through the typed native bridge only for the degraded
      state. The provider stays statically registered for manifest/schema parity and returns the typed
      `already_ready` result when ready. Library renders one non-spending “Retry Studio runtime” action
      only for a degraded project; the call joins the same single-flight state machine and has no
      project/provider arguments. RED the degraded result → visible action → successful in-process
      retry path, double activation clicks, retry during shutdown, `already_ready`, and absence of the
      Library action when runtime is ready.
- [ ] Register only V2 bridge providers and remove legacy scene providers. Generic preload remains
      unchanged. Switch the builtin MCP server/writers/mailbox/runtime from the staged V1 entrypoints
      to the reviewed V2 entrypoints and then delete the V1 entrypoints.
- [ ] In the same cutover, delete the current `StudioPage` Director reference-request auto-submit and
      auto-dismiss path before any V2 clip-submit provider becomes reachable. Pending V2 Director
      reference requests remain durable and untouched—zero dismissal and zero paid submission—until
      Task 7 connects them to explicit human review. Director take-generation requests do not exist in
      this slice.
- [ ] Remove public `renderCut`, `cancelRender`, and `renderProgress` bridge/native surfaces plus
      `useStudioRender`; retain `renderService` only as an unreachable main-process cut-projection
      foundation covered by integration tests.
- [ ] Replace the routing/catalog contract with exact image/video roles. Delete the storyboard model
      role, planner factory/dependency, all four files in `planning/`, and their three tests; update
      Engine Strip, models, route support, generation requests, and their exact tests atomically.
      Preserve the existing renderer-only catalog validation for image/video engine selection as a
      configuration boundary outside the free reducer; Director imports and schemas cannot reach it.
- [ ] Reduce `STUDIO_VIEWS` to `['table', 'board']`; redirect absent/legacy `cut` routes to Table,
      preserve route-close dirty checks, and remove Cut/Export controls.
- [ ] Complete every move listed above before deleting `PhaseShell`, `Shell`, or `Storyboard`.
      Preserve proposal cards, required actions, rules, Brief, and the one conversation owner.
- [ ] Rewrite retained Library list/delete/unsupported/degraded-runtime states and summary/poster
      fields. Rewrite proposal mutation-batch rendering/editor dependencies, Director conversation
      fixtures, and Brief controller props to V2 before removing V1 aliases and phase controller
      types. Component module entry points use `index.tsx`; no moved file may import a deleted
      PhaseShell/Shell/Storyboard path.
- [ ] In 6B create a load-capable V2 `useWorkspaceProject` plus read-only, V2-typed editor and draft
      stubs. In 6C wire only those V2 paths publicly; they never read, write, or delete the V1 scene
      draft key. Task 7, not Task 6, owns the serialized mutation queue, V2 draft persistence, rebase,
      and conflict behavior.
- [ ] Delete the dormant paid storyboard planner/draft/fit providers, runtime dependency, modal, and
      tests; V2 MCP mutation proposals remain and are not routed through a second text-provider call.
- [ ] Convert every retained Generation/Preview/hook/readiness/route file in the explicit compilation
      closure to clip identities. No `StudioScene`, `sceneId`, `sceneIds`, or V1 project alias may
      remain in a persisted/wire/retained renderer contract.
- [ ] Delete old Write/Produce/Review implementations rather than projecting Sections as scenes.
      Render supported, unsupported, loading, empty, storage error, and minimal Table/Board
      placeholders from V2.
- [ ] Replace every E2E/unit seed with direct V2 Section/Clip data in isolated named profiles.
- [ ] RED startup against the full V1 byte tree with poison cleanup/reaper/protocol/job/provider
      dependencies both alone and beside a valid V2 project that runs normal lifecycle work. RED
      schema2 Table/Board route, no Cut/Export, feature-flag preservation, exact provider/selector
      inventory, V2 Generation/Preview contracts, pending Director reference request with zero
      dismiss/submit, and final directory counts.
- [ ] Mutation proof: install protocol before V2 classification and prove poison startup fails;
      re-add `cut` to `STUDIO_VIEWS` and prove route/provider inventory tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/process/bridge/creativeStudioBridge.test.ts tests/unit/process/bridge/nativePayloadSchemas.test.ts tests/unit/process/creative-studio/runtime.test.ts tests/unit/process/creative-studio/store.test.ts tests/unit/process/creative-studio/jobManager.test.ts tests/unit/process/creative-studio/mediaStore.test.ts tests/unit/process/creative-studio/service/schema2 tests/unit/process/creative-studio/service/index.test.ts tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/creative-studio/service/directorCommandService.test.ts tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts tests/unit/process/creative-studio/types tests/integration/creative-studio/schema2Cutover.integration.test.ts tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts tests/integration/creative-studio/directorCommandLatency.integration.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts tests/integration/creative-studio/renderService.integration.test.ts tests/integration/creative-studio/projectRecovery.integration.test.ts tests/unit/pages/studio/StudioLibrary.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/Workspace/State tests/unit/pages/studio/Workspace/Shell tests/unit/pages/studio/Workspace/DirectorLayout tests/unit/pages/studio/Generation tests/unit/pages/studio/EngineStrip tests/unit/pages/studio/studioI18n.test.ts tests/unit/e2e/creativeStudioSelectors.dom.test.tsx tests/unit/renderer/layout/StudioRouteVisibility.dom.test.tsx tests/unit/common-config/creativeStudioFeatureFlag.test.ts`,
      `bun run i18n:types && node scripts/check-i18n.js`, and `bunx tsc --noEmit`.
- [ ] Complete and retain the four reviewed commits specified in **Execution decomposition**; do not
      squash them into one opaque cutover commit before review.

### Task 6 review checkpoint

- [ ] Freeze the exact Task 6D head and obtain independent architecture, lifecycle/concurrency,
      security/spend, and test-quality review before Task 7.
- [ ] Prove 6A and 6B never registered V2 publicly, 6C exposed exactly one V2 contract, and 6D left no
      compiled legacy UI or V1 staging export.
- [ ] Re-run the Task 6 focused gate plus the mixed V1+V2 byte-tree integration and resolve every
      Critical/Important finding in separate commits before Task 7. Build exact HEAD with
      `bun run package`, then run the existing `creative-studio.e2e.ts` in an isolated fake profile;
      stale `out/` is not evidence. The layout E2E does not exist until Task 8 and first joins the gate
      there.

### Task 7 — Build shared workspace projection, drafts, selection, and reviewed render state

**Files**

- Modify: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/common/adapter/native/constants.ts`
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/workspace/index.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceProject.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceEditor.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceDraftPersistence.ts`
- Create: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceSelection.ts`
- Create: `packages/desktop/src/renderer/pages/studio/hooks/workspace/useWorkspaceReview.ts`
- Create: `packages/desktop/src/renderer/pages/studio/hooks/workspace/workspaceProjection.ts`
- Create: `tests/unit/pages/studio/Workspace/State/workspaceProjection.test.ts`
- Modify: `tests/unit/pages/studio/Workspace/State/useWorkspaceEditor.dom.test.ts`
- Modify: `tests/unit/pages/studio/Workspace/State/useWorkspaceDraftPersistence.dom.test.ts`
- Create: `tests/unit/pages/studio/Workspace/State/useWorkspaceSelection.dom.test.ts`
- Create: `tests/unit/pages/studio/Workspace/State/useWorkspaceReview.dom.test.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx`
- Modify: `tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx`
- Modify: `tests/unit/process/bridge/creativeStudioBridge.test.ts`
- Modify: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/unit/pages/studio/StudioPage.dom.test.tsx`

**Steps**

- [ ] Use a V2 session-storage namespace and exact versioned section/clip field records. Never read
      or delete the old scene draft key.
- [ ] Extend Task 6's read-only V2 stubs with the serialized intent queue and one `applyMutations` IPC
      call. Track dirtiness per authored section/clip field and adopt untouched canonical fields.
      Retain both values plus an explicit conflict for same-field changes; never save during adoption;
      explicit save uses newest revision; stale refetch does not replay.
- [ ] Add one shared ordered active-section selection model with stable identity anchor, pointer and
      Shift range, ready-only selection, park clearing, restore non-selection, and cross-view
      preservation.
- [ ] Add pure section aggregates, active clip order, canonical Board cover, and deterministic
      payable clip derivation in Section→Clip order with stable deduplication.
- [ ] Preserve reviewed generation semantics: zero disabled, 1–24 one reviewed request, 25+ disabled,
      no chunking/subset, and first confirmation after revision drift submits zero and rebuilds.
- [ ] Connect the durable V2 Director reference requests left queued by Task 6 to the same reviewed
      modal with a discriminated review state: ordinary take review derives current payable selection;
      Director reference review displays and submits the request's immutable ordered `clipIds` and
      derives reference output from those IDs, independent of current UI selection. Director does not
      create a take-generation request.
- [ ] Add one main-process `confirmReferenceRequestV2({ projectId, requestId, expectedRevision })`
      bridge/service operation; the renderer cannot supply replacement clip IDs. Under the project
      queue, re-read the pending request and its exact ordered clip IDs. Derive one unique bounded key
      per clip as `refv2_${sha256(requestId + "\0" + ordinal + "\0" + clipId)}` and hand the exact
      request plus those keys to `submitClips` as reference output. All local jobs and keys become
      durable in the project commit before any provider call.
- [ ] Journal the cross-file handoff in this order: project/job commit → fsynced immutable
      `StudioReferenceReviewReceiptV2` under `reference-requests/receipts/` → idempotent pending/slot
      cleanup. The exact receipt records schema/project/request ID, original and resulting revisions,
      ordered clip IDs, per-clip keys, job IDs, and timestamp. The receipt is authoritative; cleanup is
      never evidence of confirmation, and no step pretends project JSON plus sidecars share one atomic
      filesystem transaction.
- [ ] On every call, look up a valid receipt first and return it before ordinary stale-revision checks.
      If no receipt exists, read the still-pending request, derive its keys, and reconcile matching
      durable jobs before testing `expectedRevision`; the job commit itself advances the project
      revision. An exact/partial matching job set is completed idempotently and then journaled, never
      submitted again. Only a request with no matching jobs reaches the normal revision check and new
      confirmation path.
- [ ] Make confirmation retry-safe at every crash boundary. Before durable jobs, the request remains
      pending and no provider call occurred. After durable jobs/provider ambiguity but before receipt,
      replay recovers the per-clip job set and cannot duplicate submission. After receipt but before
      cleanup or IPC response, replay returns the receipt and finishes cleanup idempotently. Restart
      never confirms an unconfirmed pending request; normal recovery may resume jobs already durably
      authorized by a prior human confirmation. Closing/cancelling the modal leaves the request
      pending.
- [ ] RED unrelated-field rebase, same-field comparison, no implicit save, stale no-retry, reload of
      V2 drafts, selection parity, exact 0/24/25 payable cases, take/reference discrimination, request-
      order independence from UI selection, stale request revision, pre-confirm zero-submit, exactly-
      once confirmed submit, distinct deterministic keys for multiple clips, duplicate clip-ID
      rejection, each crash boundary, receipt/job lookup before stale rejection, receipt replay,
      unconfirmed restart with zero paid work, and recovery of only the already-authorized confirmed
      jobs.
- [ ] Mutation proofs: drop local-dirty overlay and prove conflict tests fail; chunk 25 clips and prove
      paid-boundary tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/process/bridge/creativeStudioBridge.test.ts tests/unit/process/bridge/nativePayloadSchemas.test.ts tests/unit/process/creative-studio/store.test.ts tests/unit/process/creative-studio/service/index.test.ts tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts tests/unit/pages/studio/Workspace tests/unit/pages/studio/Generation/GenerationReviewModal.dom.test.tsx tests/unit/pages/studio/Generation/useStudioJobs.dom.test.ts tests/unit/pages/studio/StudioPage.dom.test.tsx`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add shared workspace state and review`.

### Task 8 — Build the project shell and replace overlay Chat with one persistent Director layout

**Files**

- Modify: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/DirectorLayout.module.css`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/useStudioPanes.ts`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/useStudioLayoutMode.ts`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/StudioLayoutContext.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/useDirectorLayout.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/DirectorPane.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/useDirectorConversation.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Proposals/DirectorProposals.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/WorkspaceShell.module.css`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/ProjectHeader.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/WorkspaceViewSwitch.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/WorkspaceStatus.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SelectionBar/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SelectionBar/SelectionBar.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `tests/unit/pages/studio/Workspace/DirectorLayout/DirectorLayout.dom.test.tsx`
- Delete: `tests/unit/pages/studio/Workspace/DirectorLayout/useStudioPanes.dom.test.ts`
- Create: `tests/unit/pages/studio/Workspace/DirectorLayout/useDirectorLayout.dom.test.ts`
- Modify: `tests/unit/pages/studio/Workspace/DirectorLayout/Conversation/DirectorPane.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Workspace/DirectorLayout/Conversation/DirectorConversation.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Workspace/DirectorLayout/Proposals/DirectorProposalCard.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Workspace/DirectorLayout/Proposals/DirectorProposals.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Workspace/Shell/WorkspaceShell.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/Shell/ProjectHeader.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/Shell/WorkspaceStatus.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/Shell/SelectionBar.dom.test.tsx`
- Create: `tests/e2e/features/workspaces/creative-studio-layout.e2e.ts`
- Modify: all 12
  `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`

**Steps**

- [ ] Preserve exactly one portal-mounted conversation owner across all layout modes. Instrument a
      stable DOM identity in tests and prove streaming, scroll, composer draft, proposals, tool
      expansion, and selected-section scope survive every transition.
- [ ] Implement content-box `ResizeObserver` modes: `<900` mutually exclusive full-screen,
      `900–1279` 280–352px split capped at 40% with workspace ≥548px, and `>=1280` 320–352px dock
      with workspace ≥928px. If minimums do not fit, use narrow mode; never overlay.
- [ ] Keep medium collapsed by default unless explicitly opened. Preserve per-project user open
      intent and bounded width; do not open for selection, streaming, or breakpoint changes.
- [ ] Crossing into narrow keeps workspace visible unless focus was inside Director. When Director
      becomes hidden/inert, move focus to the visible Director toggle. Crossing back restores the
      user's prior explicit open/collapsed preference when geometry permits.
- [ ] Add `inert` plus `aria-hidden` to hidden presentation, a named Back to Table/Board action, and
      identity-based open/collapse/back focus return with view-switch fallback.
- [ ] Add a focusable `separator` named Director width with current/min/max values; Arrow,
      Shift+Arrow, Home, and End follow logical inline direction. Use only logical CSS properties.
- [ ] Build the project header, Table/Board navigation, activity/status, persistent overlay host, and
      sticky Selection Bar against Task 7 state. View activation focuses the matching localized
      heading and does not save, refetch, discard drafts, clear selection, or remount Director.
- [ ] RED one-mount identity, no hidden tab stops, exact narrow-focus transitions, header/view state,
      Selection Bar, open-intent transitions, keyboard resizing, and unread/streaming/required-action
      indicators.
- [ ] In Playwright, set shell content-box widths 899/900 and 1279/1280; assert Director and workspace
      bounding rectangles never intersect, minimums hold, narrow shows one region plus a named return
      action, focus never remains in a hidden region, and the prior wide/medium preference restores.
      jsdom geometry is not accepted for this assertion.
- [ ] Mutation proofs: render medium as a drawer and prove rectangle intersection fails; key the
      conversation by layout mode and prove identity/stream tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/pages/studio/Workspace/DirectorLayout tests/unit/pages/studio/Workspace/Shell tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/studioI18n.test.ts`
      then build the exact Task 8 head with `bun run package`, then run
      `AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio-layout.e2e.ts`.
- [ ] Commit: `feat(studio): keep director chat beside the workspace`.

### Gate 2 review checkpoint

- [ ] Freeze the exact Task 6–8 head and obtain independent architecture, concurrency/spend, and
      accessibility review.
- [ ] Confirm no V1 public alias/provider/route remains, unsupported V1 startup is byte-tree clean,
      and the feature flag/default remain unchanged.
- [ ] Run focused process+renderer gates, `bun run test`, `bun run test:coverage`, and
      `bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage`; the changed-file
      report must satisfy the 80% line/branch ratchet, including executable `common/types` helpers.
      Then run `bunx tsc --noEmit`, i18n generation/check, lint, and format. Build the exact Gate 2
      head with `bun run package`, then run both `creative-studio.e2e.ts` and
      `creative-studio-layout.e2e.ts` in isolated fake profiles. The diff check is
      `git diff --check 21bf87ae1674598bd42ea88c5f13c74e8389b3c0...HEAD -- . ':(exclude)docs/prds/creative-studio/creative-studio-2-table-board-reference.html.txt'`;
      verify the excluded reference by SHA-256.
- [ ] Resolve Critical/Important findings in separate commits and re-review before Task 9.

---

## Delivery Gate 3 — functional Table and shared inspector

### Task 9 — Build the functional Table

**Files**

- Modify: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/SelectionBar/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/TableView.module.css`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/SectionTable.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/SectionList.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/SectionRow.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/sectionTableModel.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `tests/unit/pages/studio/Workspace/Shell/WorkspaceShell.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Workspace/Shell/SelectionBar.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/TableView/sectionTableModel.test.ts`
- Create: `tests/unit/pages/studio/Workspace/TableView/TableView.dom.test.tsx`
- Modify: all 12 locale `conversation.json` files listed in Task 8
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`

**Steps**

- [ ] Integrate Table with Task 8's header, view heading, and Selection Bar without changing their
      shared state or paid-review ownership. Explain Table-specific selection-disabled reasons.
- [ ] Render a native `<table>` at workspace width ≥720px and a labelled list below 720px from the
      same canonical projection. Do not horizontally clip or hide authored text behind title-only
      truncation.
- [ ] Add distinct checkbox, title button, drag handle, Move earlier/later, and Add section controls.
      Add section mints safe section/first-clip IDs and sends one atomic operation.
- [ ] Implement pointer/Space/Shift selection, separately named inspector activation, pointer DnD and
      keyboard reorder through the same mutation, focus on moved section ID, and global-position live
      announcements.
- [ ] RED native semantics/list parity, long text wrapping, 719/720 presentation, ready-only range
      selection, reorder focus/announcement, atomic add, strict capacity, loading/empty/error states,
      and zero paid calls.
- [ ] Mutation proofs: render Table with div roles and prove semantics tests fail; reorder only local
      state and prove restart/canonical tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/pages/studio/Workspace/Shell tests/unit/pages/studio/Workspace/TableView tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/studioI18n.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): build the section table workspace`.

### Task 10 — Build the shared Section Inspector and field conflicts

**Files**

- Modify: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/SectionInspector.module.css`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/SectionFields.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/ClipList.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/ClipEditor.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/TakePicker.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Preview/StagePreview.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Preview/AssetStrip.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Preview/managedStudioAssets.ts`
- Create: `tests/unit/pages/studio/Workspace/SectionInspector/SectionInspector.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/SectionInspector/ClipList.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/SectionInspector/ClipEditor.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/SectionInspector/TakePicker.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Generation/StagePreview.dom.test.tsx`
- Modify: all 12 locale `conversation.json` files listed in Task 8
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`

**Steps**

- [ ] Mount one inspector owner in `Workspace`, wire Table title actions now, and expose a
      Board-compatible identity API for Task 11. Use a dialog when space permits and a full-screen
      sheet below 720px; name it, trap focus only while open, support Escape, and return focus to the
      exact invoking identity/fallback chain.
- [ ] Implement section fields, ordered Clip List, clip authored fields, singular reference,
      duration/media validation, main-derived job state, and managed Take Picker without provider IDs
      or raw paths.
- [ ] Surface local/canonical same-field conflict values with explicit Keep mine/Use latest. Closing
      dirty fields offers Keep editing or Discard and never silently flushes.
- [ ] Add clip/reorder/delete operations, strict 8/96 capacity, dependency-blocked deletion, focus to
      next/previous/Add clip, and live reorder announcements.
- [ ] Select canonical takes through shared main mutation/cut reconciliation. Managed preview URLs,
      failed media, missing media, and foreign/noncanonical assets remain safe and explicit.
- [ ] RED launch from Table, responsive presentation, focus return after identity movement,
      conflicts, no-auto-save, capacity, dependency refusal, take selection, and managed-media
      failures.
- [ ] Mutation proofs: allow deleting a cut-linked clip and prove dependency tests fail; close dirty
      inspector by flushing and prove no-implicit-save tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/pages/studio/Workspace/SectionInspector tests/unit/pages/studio/Workspace/TableView tests/unit/pages/studio/Workspace/Shell tests/unit/pages/studio/Workspace/State/useWorkspaceEditor.dom.test.ts tests/unit/pages/studio/Generation/StagePreview.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/studioI18n.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): add the shared section inspector`.

### Gate 3 review checkpoint

- [ ] Freeze the exact Task 9–10 head and obtain independent renderer, accessibility, and mutation/
      paid-boundary review.
- [ ] Compare Table at 1600×1000 and medium/narrow against the frozen reference; record every
      accessibility-driven size/contrast departure.
- [ ] Run the focused Task 9–10 tests, `bun run test`, `bun run test:coverage`,
      `bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage`,
      `bunx tsc --noEmit`, i18n generation/check, lint, and format. Require the changed-runtime
      coverage report to meet the 80% per-file line/branch ratchet.
- [ ] Build the exact Gate 3 head with `bun run package`, then run `creative-studio.e2e.ts` and
      `creative-studio-layout.e2e.ts` in separate isolated fake profiles as the composed
      Table/Inspector and persistent-layout smoke.
- [ ] Run
      `git diff --check 21bf87ae1674598bd42ea88c5f13c74e8389b3c0...HEAD -- . ':(exclude)docs/prds/creative-studio/creative-studio-2-table-board-reference.html.txt'`
      and verify the excluded frozen reference against its required SHA-256.
- [ ] Resolve Critical/Important findings and re-review before Task 11.

---

## Delivery Gate 4 — functional Board and shelf

### Task 11 — Build deterministic Board cards, reorder, and the shelf

**Files**

- Modify: `vitest.creative-studio-coverage.config.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/index.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/BoardView.module.css`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/SectionCard.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/BoardShelf.tsx`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/boardProjection.ts`
- Create: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/reorderAnnouncements.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Create: `tests/unit/pages/studio/Workspace/BoardView/boardProjection.test.ts`
- Create: `tests/unit/pages/studio/Workspace/BoardView/BoardView.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/BoardView/BoardShelf.dom.test.tsx`
- Create: `tests/unit/pages/studio/Workspace/BoardView/reorderAnnouncements.test.ts`
- Modify: `tests/unit/pages/studio/Workspace/SectionInspector/SectionInspector.dom.test.tsx`
- Modify: all 12 locale `conversation.json` files listed in Task 8
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`

**Steps**

- [ ] Derive the cover as the first clip in section order with a selected canonical generated take
      and usable managed preview. Derive aggregate state separately so the cover never hides a
      rendering, blocked, breach, missing-input, or no-clips condition.
- [ ] Render one named list whose items contain separate checkbox, title, drag handle, Move earlier/
      later, and inspector actions. CSS grid is presentation only: minimum 240px cards and one column
      below 520px.
- [ ] Reuse Table selection, Shift anchor, reorder mutation, focus, and global-position announcement.
      Table/Board switches preserve selection, drafts, inspector identity, and Director state.
- [ ] Implement a named ordered shelf list for parked sections and take aliases, with drag/keyboard
      reorder and Restore/Select take/Remove alias actions. Park clears selection; restore appends or
      inserts active state without selecting or spending; dormant cuts return.
- [ ] Wire active card titles and parked-section shelf titles to the same Task 10 inspector owner.
      Parked sections remain inspectable but never become selection/payable input until restored.
- [ ] Implement the exact focus fallback chain after park/restore/select/remove/reorder and full-
      screen inspector behavior below 720px.
- [ ] RED cover/placeholder precedence, aggregate independence, card/list semantics, 519/520 layout,
      active-card and parked-section inspector launch/focus return, shelf invariants/capacity,
      active/park exclusivity, alias rules, focus, dormant cuts, and zero submit/retry/cancel/
      provider/render calls.
- [ ] Mutation proofs: choose most recent instead of first canonical cover and prove projection tests
      fail; delete parked cuts and prove restore tests fail; restore.
- [ ] Run:
      `bunx vitest run tests/unit/pages/studio/Workspace/BoardView tests/unit/pages/studio/Workspace/State/useWorkspaceSelection.dom.test.ts tests/unit/pages/studio/Workspace/SectionInspector tests/unit/pages/studio/Workspace/Shell tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/studioI18n.test.ts`
      and `bunx tsc --noEmit`.
- [ ] Commit: `feat(studio): build the board and shelf`.

### Gate 4 review checkpoint

- [ ] Freeze Task 11 and obtain independent Board projection, accessibility/focus, and cut/spend
      review.
- [ ] Compare Board at 1600×1000 plus medium/narrow to the frozen reference and resolve all Critical/
      Important findings before hardening.
- [ ] Run the focused Task 11 tests, `bun run test`, `bun run test:coverage`,
      `bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage`,
      `bunx tsc --noEmit`, i18n generation/check, lint, and format. Require the changed-runtime
      coverage report to meet the 80% per-file line/branch ratchet.
- [ ] Build the exact Gate 4 head with `bun run package`, then run `creative-studio.e2e.ts` and
      `creative-studio-layout.e2e.ts` in separate isolated fake profiles as the composed Board/shelf,
      inspector, and persistent-layout smoke.
- [ ] Run
      `git diff --check 21bf87ae1674598bd42ea88c5f13c74e8389b3c0...HEAD -- . ':(exclude)docs/prds/creative-studio/creative-studio-2-table-board-reference.html.txt'`
      and verify the excluded frozen reference against its required SHA-256.

---

## Delivery Gate 5 — accessibility, localization, recovery, performance, and human acceptance

### Task 12 — Harden responsive geometry, accessibility, RTL, localization, and capacity performance

**Files**

- Modify: `packages/desktop/src/renderer/styles/themes/default-color-scheme.css`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioTypography.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/WorkspaceShell/WorkspaceShell.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/DirectorLayout.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorLayout/Conversation/DirectorPane.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/SelectionBar/SelectionBar.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/TableView/TableView.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/BoardView/BoardView.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/SectionInspector/SectionInspector.module.css`
- Modify: all 12 locale `conversation.json` files listed in Task 8
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`
- Modify: `tests/unit/pages/studio/Workspace/Shell/StudioAccessibleCopy.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Workspace/Shell/studioStylesheetComposes.test.ts`
- Modify: `tests/e2e/features/workspaces/creative-studio-layout.e2e.ts`
- Modify: `tests/e2e/features/workspaces/creative-studio.e2e.ts`
- Modify: `tests/e2e/fixtures.ts`
- Create: `tests/e2e/features/workspaces/creative-studio-accessibility.e2e.ts`
- Create: `tests/e2e/features/workspaces/creative-studio-capacity.e2e.ts`

**Steps**

- [ ] Extend semantic Studio tokens for warm workspace/panel surfaces, selected/ready/rendering/
      blocked/breach states, focus, borders, and placeholders. Do not copy the reference's inline CSS.
- [ ] Enforce normal-text 4.5:1, large/non-text 3:1, metadata ≥12px, body/action ≥14px, controls
      ≥28×28px, visible focus, non-color state cues, and reduced motion. Record intentional visual
      differences as accessibility corrections.
- [ ] Verify native Table/list and Board/shelf names, view navigation `aria-current`, exact focused
      localized heading, selection/progress/conflict/reorder live regions, dialog naming, Escape,
      separator values, and focus return.
- [ ] Add a named browser accessibility suite that computes effective foreground/background contrast
      from rendered styles in light and dark themes for normal text (≥4.5:1), large text and non-text
      state/focus boundaries (≥3:1), including selected, ready, rendering, blocked, breach, disabled,
      hover, and focus states. Measure every interactive bounding box at each responsive presentation
      and fail below 28×28 CSS px.
- [ ] Audit the browser accessibility tree and keyboard order for one unambiguous accessible name per
      action, native Table/list/Board/shelf semantics, dialog and separator values, live regions, and no
      hidden or duplicate tab stops. Assert each state has a text/icon/pattern cue independent of color.
      RED each oracle, then prove it catches one lowered-contrast token, one 27px hit target, one removed
      non-color cue, and one missing accessible name before restoring the implementation.
- [ ] Use logical CSS throughout. In `fa-IR`, mirror visual docking/alignment/directional icons and
      separator direction without changing canonical order; authored fields use `dir="auto"`; IDs,
      hashes, paths, and durations use LTR `bdi` isolation.
- [ ] Run i18n types/check and exact key/placeholder/plural parity across all locales. Test German
      expansion and Persian RTL at every layout boundary.
- [ ] In Playwright verify 519/520, 719/720, 899/900, and 1279/1280 content-box widths, 200% text
      zoom, reduced motion, no page horizontal overflow, visible focused control, correct Table/list,
      Board columns, inspector, and Director/workspace nonintersection.
- [ ] Add a 24-section/96-clip fake-bridge fixture and a dedicated capacity Playwright harness. Run
      5 warmups then 30 serial samples per action using `performance.now()` from input dispatch to
      the identity-specific stable DOM outcome. Selection, view switch, inspector open, and Director
      transition must each have p95 ≤250ms and max ≤500ms; durable reorder must have p95 ≤750ms and
      max ≤1,000ms. Print p50/p95/max and fail on either bound. Assert typing causes zero IPC/full-
      project serialization, explicit save emits one bounded field mutation, and Board previews are
      managed and lazy-loaded. Add an explicit `E2E_RELEASE_UNPACKAGED=1` fixture mode that launches
      the freshly compiled `out/` application with `NODE_ENV=production` while retaining
      `app.isPackaged === false`, so the test-only fake boundary remains dual-gated. Run the capacity
      harness twice on an otherwise idle release-compiled build and record both runs. `E2E_DEV=1`
      results are useful functional evidence but are not final performance evidence.
- [ ] Mutation proofs: replace logical inset with physical left and prove RTL geometry fails; remove
      `inert` and prove hidden-focus test fails; restore.
- [ ] Run:
      `bun run i18n:types && node scripts/check-i18n.js`,
      `bunx vitest run tests/unit/pages/studio/studioI18n.test.ts tests/unit/pages/studio/Workspace/Shell/StudioAccessibleCopy.dom.test.tsx tests/unit/pages/studio/Workspace/Shell/studioStylesheetComposes.test.ts`,
      `bun run package`,
      `AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_RELEASE_UNPACKAGED=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio-capacity.e2e.ts`,
      `AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_RELEASE_UNPACKAGED=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio-capacity.e2e.ts`, and
      `AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio-accessibility.e2e.ts tests/e2e/features/workspaces/creative-studio-layout.e2e.ts tests/e2e/features/workspaces/creative-studio.e2e.ts`.
      Record each command's direct exit code. Each capacity invocation must launch and log a fresh
      Electron process ID and fresh temporary profile path, assert an empty initial test profile, and
      close that process before returning; a reused process/profile is invalid evidence.
- [ ] Confirm the generated ignored `i18n-keys.d.ts` is current but do not force-add it.
- [ ] Commit: `test(studio): harden workspace accessibility and layouts`.

### Task 13 — Prove lifecycle, spend, reference fidelity, and final acceptance

**Files**

- Modify: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`
- Modify: `tests/integration/creative-studio/renderService.integration.test.ts`
- Modify: `tests/integration/creative-studio/projectRecovery.integration.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandSpendFence.test.ts`
- Modify: `tests/e2e/features/workspaces/creative-studio.e2e.ts`
- Create: `docs/prds/creative-studio/creative-studio-2-table-board-gate.md`

**Steps**

- [ ] Extend the real store/runtime integration to prove: untouched V1 tree and zero paid/provider
      work both alone and beside a lifecycle-active V2 project; fresh empty V2 create/restart;
      Table-authored mutations; Director mutation receipt; Board park/restore with dormant cuts;
      dropped-watch recovery; ambiguous receipt repair; and no duplicate revision/notification.
- [ ] Exercise reviewed generation with a fake adapter only: deterministic selected Section→Clip
      order, 24 payable clips submitted once, 25 rejected before IPC, zero rejected as nothing to
      render, no chunking, and external revision first-confirm zero-submit then second-confirm.
- [ ] Expand static and dynamic spend fences over every Director/free workspace module. Static scan
      must find no `submitClips`, `submitScenes`, `retryJob`, `retryDownload`, `cancelJob`,
      `providerResolver`, `adapterRegistry`, `.submit(`, `.poll(`, or renderer invocation in the pure
      schema2/Director apply graph except the explicitly reviewed generation module.
- [ ] Make `directorCommandSpendFence.test.ts` walk the same exact roots as the raw scan below and
      fail on any forbidden import/call token. Its only reviewed exclusion is
      `hooks/workspace/useWorkspaceReview.ts`, which owns the human-confirmed generation boundary;
      no Director, reducer, mailbox, writer, Table, Board, inspector, or selection file is
      allowlisted.
- [ ] Update E2E to create an isolated V2 project, add/edit/reorder in Table, open Inspector, switch to
      Board without state loss, select/reorder, park/restore, open/collapse/full-screen Director
      without overlap/remount, and complete reviewed generation through the fake provider only. The
      automated test clicks Confirm, asserts exactly one renderer IPC and one fake-adapter submission,
      then observes the canonical job, output asset/take, and selected result. It fails on zero,
      duplicate, automatic, or pre-confirmation submission. This automated fake-provider proof is
      separate from the non-spending owner walkthrough below.
- [ ] Copy the frozen reference to a temporary `.html` and inspect it in a network-isolated browser.
      Capture candidate Table and Board at 1600×1000 plus medium and narrow. Record hierarchy,
      density, alignment, state-language, and accessibility corrections in the tracked gate.
- [ ] After every automated gate is green, prepare the isolated fake-provider profile, screenshots,
      and walkthrough checklist, then **STOP for the owner**. Only the owner performs the human
      walkthrough and supplies the recorded PASS/FAIL: fresh profile → empty project → Table
      authoring → Inspector clips/takes → Board selection/reorder/shelf → Director free edit →
      open the reviewed Render selected modal but do not Confirm. Verify no Cut, Export, generic
      Undo, overlay Chat, provider request, or automatic paid call. An agent may not self-attest,
      infer PASS from screenshots, mark Gate 5 complete, or claim implementation complete while the
      owner decision is absent.
- [ ] Record exact final HEAD, spec/reference hashes, direct-child counts, focused/full commands,
      coverage, i18n, type, lint, format, diff, Playwright, static spend scan, screenshots, and human
      outcome in `creative-studio-2-table-board-gate.md`. Do not label release/default enablement.
- [ ] Run the final gate in this order and record direct exit codes:

  ```bash
  bunx tsc --noEmit
  bun run i18n:types
  node scripts/check-i18n.js
  bun run test
  bun run test:coverage
  bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage
  bun run package
  AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_RELEASE_UNPACKAGED=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio-capacity.e2e.ts
  AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_RELEASE_UNPACKAGED=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio-capacity.e2e.ts
  AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 bunx playwright test --config playwright.config.ts tests/e2e/features/workspaces/creative-studio.e2e.ts tests/e2e/features/workspaces/creative-studio-layout.e2e.ts tests/e2e/features/workspaces/creative-studio-accessibility.e2e.ts
  bun run lint --quiet
  bun run format:check
  git diff --check 21bf87ae1674598bd42ea88c5f13c74e8389b3c0...HEAD -- . ':(exclude)docs/prds/creative-studio/creative-studio-2-table-board-reference.html.txt'
  ```

- [ ] Verify the excluded frozen reference remains exactly
      `875258f85ad4717fd3b1019ae3096db3394325c81ae1787f1d07b448b2ebe366` with
      `shasum -a 256 docs/prds/creative-studio/creative-studio-2-table-board-reference.html.txt`.

- [ ] Run this exact static spend scan separately and record direct exit 1 with byte-empty stdout as
      the expected no-match result. Do not add `|| true`, pipe it, or otherwise mask the real exit:

  ```bash
  rg -n 'submitClips|submitScenes|retryJob|retryDownload|cancelJob|providerResolver|adapterRegistry|\.submit\(|\.poll\(|renderCut|renderService' \
    packages/desktop/src/process/services/creative-studio/service/schema2 \
    packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts \
    packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts \
    packages/desktop/src/process/services/creative-studio/service/directorCommandMailbox.ts \
    packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts \
    packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts \
    packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts \
    packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts \
    packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts \
    packages/desktop/src/process/resources/builtinMcp/studioServer.ts \
    packages/desktop/src/renderer/pages/studio/StudioPage.tsx \
    packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx \
    packages/desktop/src/renderer/pages/studio/components/Generation/generationRequests.ts \
    packages/desktop/src/renderer/pages/studio/components/Workspace \
    packages/desktop/src/renderer/pages/studio/hooks/workspace \
    --glob '!useWorkspaceReview.ts'
  ```

- [ ] Only after an explicit owner PASS, record the decision and exact evidence in the tracked gate,
      rerun its documentation assertions, and commit. On FAIL, leave the gate incomplete and return
      to the failing implementation task instead of rewriting the outcome.
- [ ] Commit: `test(studio): close table and board acceptance`.

### Gate 5 review checkpoint

- [ ] Freeze the exact Task 12–13 head and obtain final independent schema/process, renderer/UX,
      accessibility/i18n, concurrency/spend, and test-quality reviews.
- [ ] Resolve every Critical/Important finding in separate commits and rerun the proportional gate.
- [ ] Re-run the complete final gate on the exact reviewed head; update only truthful results in the
      tracked gate, then re-review any documentation fix.
- [ ] Confirm the tracked changed-runtime coverage report includes every executable Studio file changed
      since the frozen baseline—including common-type projection helpers—and meets the 80% per-file
      line and branch thresholds without exclusions added to make the gate pass.
- [ ] Report Phase 2B implementation complete only when automated evidence passes and the owner has
      explicitly supplied PASS for the human visual/workflow checkpoint. Keep default enablement,
      packaging, merge, and release as separate owner decisions.

---

## Spec-to-task crosswalk

| Design responsibility                               | Implementation tasks |
| --------------------------------------------------- | -------------------- |
| Schema-2 model, strict capacity, no migration       | 1–3, 6, 13           |
| Shared renderer/Director mutation authority         | 2, 5–7               |
| Clip-owned media/jobs/cuts and dormant parking      | 2, 4, 10–11, 13      |
| Unsupported V1 no-touch/no-provider state           | 3, 5–6, 13           |
| Table/Board-only workspace and no Cut/Export/Undo   | 6, 9–11              |
| One-mounted, never-overlay Director Chat            | 8, 12–13             |
| Draft rebase and explicit conflicts                 | 7, 10                |
| Functional Table and Inspector                      | 9–10                 |
| Functional Board and shelf                          | 11                   |
| Reviewed 0/24/25 paid boundary, no Director spend   | 4–7, 9, 11, 13       |
| Accessibility, 12 locales, RTL, responsive geometry | 8–12                 |
| Performance, complete tests, human reference review | 12–13                |

## Execution handoff

The recommended execution mode is **Subagent-Driven Development** in this isolated worktree: one
implementer per task, a separate reviewer at every delivery checkpoint, and no concurrent edits to
overlapping files. Inline execution is acceptable only if the same RED/GREEN, mutation, exact-commit
review, and gate boundaries are preserved.
