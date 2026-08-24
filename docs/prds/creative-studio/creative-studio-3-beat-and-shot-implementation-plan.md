# Creative Studio 3 Story and Shooting Script Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Action, Look, Line, Narration, on-screen text, and Line derivation with exactly one
Beat Story and one Shot Shooting script; implement the approved character-first References flow;
show intelligible Director proposals; and make prompt readout and provider dispatch share one frozen
composition.

**Architecture:** This is a clean pre-user schema-5 cutover. There are zero users and no production
project data to preserve, so schema 1–4 projects and old sidecars remain unsupported. Main is the
only durable writer, reference resolver, prompt composer, pricing authority, and provider dispatcher.
The renderer receives sanitized Story, Shooting script, reference, proposal-review, and generation
readout projections; it never constructs provider prompts or supplies conditioning asset ids.

**Tech Stack:** TypeScript strict mode, Electron main/preload/renderer separation, React 18, Arco
Design, Icon Park, CSS Modules and UnoCSS, Zod 4 MCP schemas, Vitest 4, Testing Library/jsdom,
Playwright, i18next across 12 locales, and the existing atomic Creative Studio store.

**Spec:** [creative-studio-3-direction-and-answers.md](./creative-studio-3-direction-and-answers.md)
§14–§15, SHA-256 `c22ea186653ad5e10717aa03a52081addc45ed65b94a75112a875329b5d6421f`.
Reference implementation tasks are in
[creative-studio-3-mvp-plan.md](./creative-studio-3-mvp-plan.md) §6.

**Code-inspection baseline:** `98dd405e914c019e35a3e1564780de3b3cf6e237` on
`codex/creative-studio-table-board-ui-design`.

**Product assumption approved 2026-08-24:** Creative Studio still has zero users. Do not build a
v4-to-v5 data migration, legacy archive, old-draft recovery, sidecar settlement, migration journal,
or legacy-job dispatch path. Prototype projects may be recreated.

## Global Constraints

- Read `CONTRIBUTING.md`, `.claude/skills/architecture/SKILL.md`,
  `.claude/skills/testing/SKILL.md`, and `.claude/skills/i18n/SKILL.md` before implementation.
- Preserve process boundaries: filesystem, validation, prompt composition, reference resolution,
  pricing, confirmation, and provider dispatch stay in main. Renderer code uses `ipcBridge` only.
- Use Arco components for interaction, Icon Park icons, semantic color tokens, and i18n keys for all
  changed user-facing text. Do not add raw interactive HTML.
- Do not add a direct child under `service/schema2/` or `Workspace/`; each is already at ten. New
  proposal-review code goes under `schema2/mutations/`. The three new generation modules in the two
  plans—`composition.ts`, `referenceRequest.ts`, and `referenceBinding.ts`—bring
  `schema2/generation/` to exactly ten direct children.
- Keep the two authored prose fields exact. Do not retain compatibility Action/Look/Line/Narration
  fields, a hidden editable prompt, a renderer-only source of truth, or prose parsing.
- Story and Shooting script may be empty during free authoring. Generation rejects only an empty or
  over-bound final composed prompt.
- Schema 1–4 projects remain `unsupported_prototype_schema` and byte-identical. Do not add a v4
  reader, converter, backup, recovery prompt, or automatic deletion. A fresh project is the recovery
  path during this zero-user phase.
- Old schema-4 proposals, commands, reference requests, drafts, jobs, and export records are not
  actionable under schema 5. No compatibility reader is required.
- Give project content, Director commands/proposals, semantic reference requests, media manifests,
  and export records explicit version constants rather than deriving every protocol from the project
  constant.
- Director-authored Beat/Shot prose is proposal-only. `set_reference_plan` and
  `set_shot_reference_binding` are typed Director-direct operations. `approve_reference` is a
  renderer-only human action. Chat text alone never bypasses a proposal or spend gate.
- Prepared quotes freeze the exact composition and resolved references. Confirmation re-derives and
  exact-compares them under the project queue before durable commit and provider dispatch.
- This exact-field cutover is one implementation tranche: main and renderer consumers will not all
  compile at intermediate checkpoints. Run focused tests for each seam, but do not claim a green
  typecheck, commit, push, review handoff, or build until Task 7's complete gate passes.
- Begin each task by confirming `git status --short` contains only preceding planned work. Preserve
  and stop on unrelated changes before broad formatting or staging.
- Do not enable Creative Studio by default, launch paid providers, delete project directories, or
  release a package as part of this plan.

---

## Canonical Contracts

### Authoring state

```ts
export const STUDIO_PROJECT_SCHEMA_VERSION = 5 as const;
export const STUDIO_MAX_STORY_LENGTH = 4 * 1024;
export const STUDIO_MAX_SHOOTING_SCRIPT_LENGTH = 24 * 1024;

export type StudioBeat = {
  id: string;
  title: string;
  story: string;
  targetSeconds: number | null;
  shotOrder: string[];
};

export type StudioShot = {
  id: string;
  shootingScript: string;
  durationSeconds: number;
  trimInSeconds: number | null;
  trimOutSeconds: number | null;
  chainBreak: 'none' | 'hard_cut';
  seedStillId: string | null;
  boardAssetId: string | null;
  supersededBoardAssetIds: string[];
  videoAssetId: string | null;
  supersededVideoAssetIds: string[];
  referenceBinding: StudioShotReferenceBindingV2;
  assetIds: string[];
  jobIds: string[];
};

export type StudioEditableBeat = Pick<StudioBeat, 'title' | 'story' | 'targetSeconds'>;
export type StudioEditableShot = Pick<StudioShot, 'shootingScript' | 'durationSeconds'>;
```

Adopt the reference catalogue, generation target, and Shot-binding contracts in the Reference Plan
§6. New projects start with an unplanned empty catalogue; new Shots start `unassigned`.

Remove `STUDIO_LOOK_SOFT_WORD_LIMIT`, `actionRevision`, `lineHistory`, `derivation`,
`derivedFromActionRevision`, `redetach_line`, `rederive_line`, and `restore_line`. Replace the fixed
coverage reasons `narration` and `on_screen_text` with `shooting_script` whenever nonempty authored
Shot prose must be protected.

### Frozen generation composition

```ts
export type StudioGenerationCompositionInputSnapshotV2 = {
  schemaVersion: 1;
  projectRevision: number;
  brief: string;
  rules: StudioBriefRule[];
  source:
    | { kind: 'shot'; beatId: string; story: string; shotId: string; shootingScript: string }
    | {
        kind: 'project_reference';
        referenceId: string;
        referenceKind: StudioReferenceKindV2;
        prompt: string;
      };
  purpose: StudioJobPurpose;
  referenceInputs: StudioGenerationReferenceInputSnapshot[];
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  route: StudioMediaModelRef;
  boardStyle: StudioBoardStyleV2 | null;
  instructionProfile: string;
};

export type StudioGenerationCompositionV2 = {
  inputs: StudioGenerationCompositionInputSnapshotV2;
  prompt: string;
};
```

Every new request snapshot and job has a nonnull composition. Every Board, seed, video, and
reference-image request uses the same main-owned composer. Quote readout projects this frozen value;
adapters receive its exact prompt from the committed job.

Every `StudioJobV2`, quoted generation, renderer quote, and prepare choice uses
`target: StudioGenerationTargetV2`. Request snapshots use only plural ordered semantic
`referenceInputs`; there is no singular or legacy field. Generated assets persist
`projectReferenceId`, ordered `generationReferenceAssetIds`, `producerJobId`, and
`compositionDigest`. Imports and extracted frames use null ownership/digest fields and an empty
generation-reference list. Remove `sourceLook`.

Staleness is whole-project-revision based. Identical inputs at the same revision compose
byte-identically; any project revision change invalidates a prepared confirmation, even if the new
prompt text would match.

---

## Cross-plan Delivery Order

Execute both plans in this order, keeping one uncommitted working tree until Task 7:

| Delivery                 | Execute together                                  |
| ------------------------ | ------------------------------------------------- |
| A — clean schema         | This plan Task 1 plus Reference Plan Task 1       |
| B — reference authoring  | Reference Plan Task 2                             |
| C — Director contract    | This plan Task 2 plus Reference Plan Task 3       |
| D — generation authority | This plan Task 3 plus Reference Plan Tasks 4–6    |
| E — workspace experience | This plan Tasks 4–6 plus Reference Plan Tasks 7–8 |
| F — acceptance           | This plan Task 7 plus Reference Plan Task 9       |

Mark duplicate steps complete; do not replay them or make the per-task commits retained in the older
Reference Plan. Task 7 creates the first buildable feature commit.

---

## Task 1: Cut every durable contract cleanly to schema 5

**Files:**

- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioManagedAssetCollections.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/factories.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/validation.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/index.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/exports/catalog.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/exports/editorFolder.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/factories.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/validation.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/mutations/index.test.ts`
- Modify: `tests/unit/process/creative-studio/store.test.ts`
- Modify: `tests/unit/process/creative-studio/mediaStore.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/exports/catalog.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/exports/editorFolder.test.ts`
- Modify: `tests/integration/creative-studio/schema2Cutover.integration.test.ts`

- [ ] **Step 1: Write the clean-cutover failures.**

  Assert a new project is exact schema 5 with Story, Shooting script, reference catalogue, Shot
  binding, target, plural reference, composition, job, and asset provenance fields. Assert all old
  authoring/generation keys fail exact validation. Assert schema 1–4 returns
  `unsupported_prototype_schema`, preserves bytes, creates no backup/journal, and cannot be mutated.
  New operational undo starts empty because there is no data to convert.

- [ ] **Step 2: Run the red contract boundary.**

  ```bash
  bunx vitest run tests/unit/process/creative-studio/service/schema2/factories.test.ts tests/unit/process/creative-studio/service/schema2/validation.test.ts tests/unit/process/creative-studio/service/schema2/mutations/index.test.ts tests/unit/process/creative-studio/store.test.ts tests/unit/process/creative-studio/mediaStore.test.ts tests/unit/process/creative-studio/service/schema2/exports/catalog.test.ts tests/unit/process/creative-studio/service/schema2/exports/editorFolder.test.ts tests/integration/creative-studio/schema2Cutover.integration.test.ts
  ```

  Expected: FAIL on schema version 4 and missing final fields.

- [ ] **Step 3: Replace current types and factories.**

  Apply the canonical contracts above plus Reference Plan Task 1. Give each persisted protocol an
  explicit literal version-5 constant. Do not add unions with schema-4 records or make required fields
  optional. Seed an empty reference catalogue, unassigned Shot bindings, plural empty reference
  inputs, and structured null/import provenance in every creation path.

- [ ] **Step 4: Replace exact validation and reducer operations.**

  `edit_beat` writes Story without touching Shots. `edit_shot` writes Shooting script using normal
  undo. `add_shot` and `apply_coverage` accept the new script field. Remove Line derivation operations
  and validators. Preserve deterministic duration, continuity, Takes, bin, reference, spend, and
  ownership rules.

- [ ] **Step 5: Keep old prototypes unsupported.**

  Leave the store's non-current-version branch as the only behavior for schema 1–4. Delete any
  migration code introduced during implementation. Opening an old prototype must not rewrite,
  quarantine, back up, or delete it.

- [ ] **Step 6: Re-run the focused tests and hold.**

  Run the Step 2 command. Expected: focused contract tests pass. Run `git diff --check`; do not
  typecheck, stage, or commit until Task 7.

## Task 2: Give the Director Story/script authority with intelligible review

**Files:**

- Modify: `packages/desktop/src/process/resources/builtinMcp/studioServer.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioDirectorCommandWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandService.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/directorCommandProcessor.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Add: `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/proposalReview.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/DirectorRail/openingTurn.ts`
- Add: `tests/unit/process/creative-studio/service/schema2/mutations/proposalReview.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandContracts.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandService.test.ts`
- Modify: `tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts`
- Modify: `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`
- Modify: `tests/unit/process/creative-studio/service/index.test.ts`
- Modify: `tests/unit/pages/studio/workspace/DirectorOpeningTurn.test.ts`
- Modify: `tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts`

- [ ] **Step 1: Write failing MCP, disposition, and review tests.**

  `read_storyboard` returns Story/Shooting script, reference catalogue, and Shot bindings with no old
  authoring fields. Director add/edit Beat, add/edit Shot, add-binned Beat, and coverage are
  proposal-only. `set_reference_plan` and `set_shot_reference_binding` remain typed direct;
  `approve_reference` is forbidden to the Director. Renderer reducer calls remain direct.

  Apply an ordered proposal to its exact base project with the shared reducer and return grouped,
  renderer-safe before/after Story and Shooting-script rows. Cover Brief, add-then-edit, coverage,
  metadata, delete/reorder labels, stale revision, and reducer rejection. Raw operation names are
  never the only explanation.

- [ ] **Step 2: Run the red Director boundary.**

  ```bash
  bunx vitest run tests/unit/process/creative-studio/service/schema2/mutations/proposalReview.test.ts tests/unit/process/creative-studio/service/directorCommandContracts.test.ts tests/unit/process/creative-studio/service/directorCommandService.test.ts tests/unit/process/creative-studio/service/directorCommandProcessor.test.ts tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts tests/unit/process/creative-studio/service/index.test.ts tests/unit/pages/studio/workspace/DirectorOpeningTurn.test.ts tests/integration/creative-studio/directorCommandLifecycle.integration.test.ts
  ```

- [ ] **Step 3: Replace MCP contracts and instructions.**

  Teach one free-form `story` and one free-form `shootingScript`. Explain that location, lighting,
  camera, sound, dialogue, and voice are optional labels inside the script, never app fields. Give
  changed Director/proposal/reference protocols explicit version-5 constants. No v4 readers.

- [ ] **Step 4: Derive proposal review in main.**

  Do not persist a handwritten diff. On list/read, require current revision to equal `baseRevision`,
  apply the shared reducer to a clone using proposal id/time as deterministic context, and diff the
  base and candidate. Acceptance repeats the same reducer under CAS.

- [ ] **Step 5: Re-run the focused tests and hold.**

  Run the Step 2 command. Expected: PASS. Run `git diff --check`; do not commit.

## Task 3: Make composition, references, quote readout, and dispatch one path

This task is the same delivery seam as Reference Plan Tasks 4–6. Execute it once after Reference Plan
Task 3; do not create a Story-only compositor first.

**Files:**

- Add: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/composition.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/generationRequest.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/boardRequest.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/generation/submissionIdentity.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/authorization.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/schema2/chain.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/service/v2Service.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Add: `tests/unit/process/creative-studio/service/schema2/generation/composition.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/generation/boardRequest.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/generation/submissionIdentity.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/pricing/preparedSubmissionCache.test.ts`
- Modify: `tests/unit/process/creative-studio/service/schema2/chain.test.ts`
- Modify: `tests/unit/process/creative-studio/jobManager.test.ts`
- Modify: `tests/unit/process/creative-studio/mediaStore.test.ts`
- Modify: `tests/integration/creative-studio/generationLifecycle.integration.test.ts`

- [ ] **Step 1: Write failing canonical-composition tests.**

  Assert ordered `PROJECT BRIEF`, rules, `STORY`, `SHOOTING SCRIPT`, and purpose-specific `OUTPUT`
  sections; distinct character/background reference instructions; Board style; route/model/profile
  facts; plural ordered references; bounds; and rejection of an empty complete source. Board, seed,
  video, and reference generation all call the same entry.

- [ ] **Step 2: Write freeze, staleness, dispatch, and provenance failures.**

  Any project revision change stales confirmation. The same inputs at the same revision stay
  byte-equal. Technical readout prompt byte-equals the fake adapter prompt. Jobs always have a
  nonnull composition; generated assets preserve producer/digest/reference provenance after later
  edits. Cover reference target, three ordered inputs, route capacity, retry, cancellation, and
  durable commit before dispatch.

- [ ] **Step 3: Run the red generation boundary.**

  ```bash
  bunx vitest run tests/unit/process/creative-studio/service/schema2/generation/composition.test.ts tests/unit/process/creative-studio/service/schema2/generation/generationRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/boardRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/submissionIdentity.test.ts tests/unit/process/creative-studio/service/schema2/pricing/authorization.test.ts tests/unit/process/creative-studio/service/schema2/pricing/estimate.test.ts tests/unit/process/creative-studio/service/schema2/pricing/preparedSubmissionCache.test.ts tests/unit/process/creative-studio/service/schema2/chain.test.ts tests/unit/process/creative-studio/jobManager.test.ts tests/unit/process/creative-studio/mediaStore.test.ts tests/integration/creative-studio/generationLifecycle.integration.test.ts
  ```

- [ ] **Step 4: Implement one pure composition result.**

  Build the canonical contract above. `instructionProfile` is a versioned allow-listed key derived
  from adapter, purpose, and `source.referenceKind` for reference targets. The frozen kind selects the
  character-sheet or background-environment output instruction; do not infer it from prompt prose.
  Keep credentials and raw provider responses out of snapshots and logs.

- [ ] **Step 5: Freeze it through prepare, confirm, job, and asset.**

  Main resolves semantic bindings, validates capacity, composes, prices, and freezes ordered asset
  ids/hashes. Confirmation re-resolves and exact-compares under the queue. Adapters consume only the
  committed prompt and conditioning inputs. Generated assets receive exact structured provenance;
  imports do not.

- [ ] **Step 6: Remove retired readiness and renderer authority.**

  Remove Look/Line readiness issues and renderer-selected reference asset ids. Empty prose remains
  editable; the canonical composer and binding resolver own final refusal.

- [ ] **Step 7: Re-run focused tests and hold.**

  Run the Step 3 command. Expected: PASS. Run `git diff --check`; do not commit.

## Task 4: Replace the Beat panel with one Story and one Shooting script

**Files:**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/workspaceProjection.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/useWorkspaceDrafts.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/BeatPanel.module.css`
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx`
- Modify: `tests/unit/pages/studio/workspace/WorkspaceProjection.test.ts`
- Modify: `tests/unit/pages/studio/workspace/BeatPanel.dom.test.tsx`
- Modify: `tests/unit/pages/studio/StudioPage.dom.test.tsx`

- [ ] **Step 1: Make the two-textbox DOM contract fail.**

  Assert exactly one Beat textbox named Story and one selected-Shot textbox named
  `Shooting script for Shot N`; retain Beat target and Shot duration. Assert absence of Action, Look,
  Line, Narration, on-screen text, inherit, detach, re-derive, restore, history, and the Look counter.
  Preserve continuity, references, Takes, preview, generation, spend lock, stale revision, reset,
  Shot switching, and concurrent-save behavior.

- [ ] **Step 2: Write projection and clean draft-version failures.**

  Project only `story` and `shootingScript`. Draft keys become `beat.<id>.story` and
  `shot.<id>.shootingScript`; the string bound becomes the canonical script bound. Bump the envelope
  to version 3. Because there are zero users, reject and remove version-2 envelopes without recovery
  UI or conversion. Retain valid version-3 selection and settings behavior.

- [ ] **Step 3: Run the red UI boundary.**

  ```bash
  bunx vitest run tests/unit/pages/studio/workspace/WorkspaceProjection.test.ts tests/unit/pages/studio/workspace/BeatPanel.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx
  ```

- [ ] **Step 4: Implement the simplified editor.**

  Delete line-specific actions/callbacks. Story and Shooting script call `edit_beat` and `edit_shot`.
  Retain the draft registry and all deterministic controls. Use one prose row for Beat and one for
  the selected Shot; remove derivation/history/counter styles.

- [ ] **Step 5: Re-run focused tests and hold.**

  Run the Step 3 command. Expected: PASS. Run `git diff --check`; do not commit.

## Task 5: Make Table, Board, Bin, and Cut speak the same model

**Files:**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Table/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Table/Table.module.css`
- Delete: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Table/lookFold.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/WorkspaceControls.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/beatPlaybackSequence.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/BeatPanel/BeatPlayer.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Board/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Board/Bin.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Cut/playbackSequence.ts`
- Modify: `tests/unit/pages/studio/workspace/TableView.dom.test.tsx`
- Modify: `tests/unit/pages/studio/workspace/BoardView.dom.test.tsx`
- Modify: `tests/unit/pages/studio/workspace/Bin.dom.test.tsx`
- Modify: `tests/unit/pages/studio/workspace/CutView.dom.test.tsx`
- Modify: `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx`

- [ ] **Step 1: Write the Table and residual-surface failures.**

  Require `# | Panel | Beat | Story | Shots | Length | State`, one Story cell per Beat, no Look fold,
  and unchanged grid navigation/selection/thumbnails/state. Board, Bin, Cut, playback, and workspace
  controls may show Story/Shooting script or a neutral Shot label, but no retired authoring concept.

- [ ] **Step 2: Run the red surface tests.**

  ```bash
  bunx vitest run tests/unit/pages/studio/workspace/TableView.dom.test.tsx tests/unit/pages/studio/workspace/BoardView.dom.test.tsx tests/unit/pages/studio/workspace/Bin.dom.test.tsx tests/unit/pages/studio/workspace/CutView.dom.test.tsx tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx
  ```

- [ ] **Step 3: Implement the seven-column Table and remaining displays.**

  Remove ResizeObserver Look folding, focus remaps, folded grid templates, and `lookFold.ts`. Keep
  horizontal containment for narrow windows. Use Shooting script only where Shot prose is needed;
  do not parse labels or reintroduce narration/line affordances.

- [ ] **Step 4: Re-run focused tests and hold.**

  Run the Step 2 command. Expected: PASS. Run `git diff --check`; do not commit.

## Task 6: Show actual proposal text and the exact rendered prompt

**Files:**

- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposals.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Gate/index.tsx`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Workspace/Gate/SpendGateModal.module.css`
- Modify: `tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx`
- Modify: `tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx`
- Modify: `tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx`

- [ ] **Step 1: Write proposal-card failures from the reported bug.**

  New Beats show title/full Story; new Shots show full Shooting script; edits show before/after; Brief
  changes show before/after; coverage groups by Beat/Shot; non-prose changes use human labels. Raw
  operation names are absent. Stale/invalid review disables Accept and explains why.

- [ ] **Step 2: Write collapsed `Renders as` failures.**

  Spend review is concise by default. Expanded Technical details shows exact prompt, source revision,
  Beat/Shot or reference, route/model, and reference ids from the frozen quote composition. It is
  read-only.

- [ ] **Step 3: Run the red reviewed-output tests.**

  ```bash
  bunx vitest run tests/unit/pages/studio/Shell/DirectorProposalCard.dom.test.tsx tests/unit/pages/studio/Shell/DirectorProposals.dom.test.tsx tests/unit/pages/studio/workspace/SpendGate.dom.test.tsx
  ```

- [ ] **Step 4: Render main-derived review and composition.**

  Cards consume semantic rows, not raw operations. Use `<bdi>`/`dir='auto'` for ids/authored prose.
  Keep Accept/Reject as the deterministic proposal action surface; a chat message does not mutate it.

- [ ] **Step 5: Re-run focused tests and hold.**

  Run the Step 3 command. Expected: PASS. Run `git diff --check`; do not commit.

## Task 7: Complete i18n, exact boundaries, full acceptance, and the first commit

Complete the final tranche in this exact order:

1. execute Reference Plan Tasks 7–8;
2. execute this task Steps 1–3;
3. execute Reference Plan Task 9 Steps 1–3;
4. execute this task Steps 4–7, which also satisfy Reference Plan Task 9 Steps 4–7;
5. request the Reference Plan Task 9 Step 8 code review; and
6. execute this task Step 8 only after explicit owner authorization, satisfying Reference Plan Task
   9 Step 9.

This order makes the persistent References workspace and Story UI land together and leaves exactly
one final typecheck, full suite, audit, commit, and optional push.

**Files:**

- Modify: `packages/desktop/src/renderer/services/i18n/locales/{zh-CN,en-US,ja-JP,zh-TW,ko-KR,tr-TR,ru-RU,uk-UA,pt-BR,de-DE,es-ES,fa-IR}/conversation.json`
- Generate: `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`
- Modify: `packages/desktop/src/common/adapter/ipcBridge.ts`
- Modify: `packages/desktop/src/process/bridge/creativeStudioBridge.ts`
- Modify: `tests/unit/process/bridge/nativePayloadSchemas.test.ts`
- Modify: `tests/unit/pages/studio/studioI18n.test.ts`
- Modify: `tests/unit/process/creative-studio/runtime.test.ts`
- Modify: `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`
- Modify: `tests/e2e/features/workspaces/creative-studio.e2e.ts`
- Mechanically update old authoring fixtures in `tests/unit/process/creative-studio/`,
  `tests/integration/creative-studio/`, and `tests/unit/pages/studio/` without weakening assertions.

- [ ] **Step 1: Complete all 12 locales.**

  Add keys for Story, Shooting script, Shooting script for Shot, proposal before/after/group labels,
  stale review, References states/actions, Renders as, and source facts. Remove retired normal-surface
  keys only after `rg` proves no use. Maintain placeholder/plural parity without English fallback.

- [ ] **Step 2: Regenerate and validate i18n.**

  ```bash
  bun run i18n:types
  node scripts/check-i18n.js
  bunx vitest run tests/unit/pages/studio/studioI18n.test.ts tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx
  ```

- [ ] **Step 3: Update exact IPC/MCP/native payload boundaries and fixtures.**

  Reject old authoring, singular-reference, and Shot-only generation keys. Accept exact schema-5
  shapes. There are no legacy parsers. Update fixtures to semantic assertions rather than optional
  compatibility fields.

- [ ] **Step 4: Run the full repository gate.**

  ```bash
  bun run format
  bun run lint
  bunx tsc --noEmit
  bun run i18n:types
  node scripts/check-i18n.js
  bun run test
  ```

  Expected: every command exits 0. Judge lint by exit code; existing warnings are not failures.

- [ ] **Step 5: Run the end-to-end acceptance.**

  ```bash
  bun run test:e2e -- tests/e2e/features/workspaces/creative-studio.e2e.ts --reporter=list
  ```

  The scenario creates a fresh schema-5 project; agrees Story direction; plans/generates/approves
  characters before backgrounds; binds every Shot; continues to Table after required approvals;
  verifies one Story and one Shooting script; reviews actual Director text; prepares a quote; proves
  expanded prompt equals fake-adapter input; edits Story; and proves confirmation is stale before any
  second dispatch. No migration fixture is required.

- [ ] **Step 6: Audit retired concepts, schema assumptions, and directory size.**

  ```bash
  rg -n "Action|Look|Line|Narration|on-screen text|inherit|deriv|detach|rederive|restore_line|redetach_line" packages/desktop/src/renderer/pages/studio packages/desktop/src/process/resources/builtinMcp/studioServer.ts
  rg -n "referenceInput|referenceAssetId|sourceLook|schemaVersion: 4|migrateStudioProjectV4" packages/desktop/src tests
  rg -n "TODO|TBD|implement later|placeholder" packages/desktop/src/common/types/project/creativeStudioTypes.ts packages/desktop/src/process/services/creative-studio packages/desktop/src/renderer/pages/studio
  find packages/desktop/src/process/services/creative-studio/service/schema2/generation -mindepth 1 -maxdepth 1 | wc -l
  find packages/desktop/src/renderer/pages/studio/components/Workspace/Views -mindepth 1 -maxdepth 1 | wc -l
  git diff --check
  ```

  Classify every match. Unrelated provider/chat concepts and CSS `line-height` are allowed; no normal
  Studio authoring label, legacy schema path, renderer-selected asset id, or unfinished marker is.
  Each counted directory must have at most ten direct children.

- [ ] **Step 7: Stage only the complete planned tranche and commit.**

  ```bash
  git status --short
  git add -u packages/desktop/src tests
  git add packages/desktop/src/process/services/creative-studio/service/schema2/mutations/proposalReview.ts packages/desktop/src/process/services/creative-studio/service/schema2/generation/composition.ts packages/desktop/src/process/services/creative-studio/service/schema2/generation/referenceRequest.ts packages/desktop/src/process/services/creative-studio/service/schema2/generation/referenceBinding.ts packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/index.tsx packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/References.module.css packages/desktop/src/renderer/pages/studio/components/Workspace/Views/References/referenceStatus.ts tests/unit/process/creative-studio/service/schema2/mutations/proposalReview.test.ts tests/unit/process/creative-studio/service/schema2/generation/composition.test.ts tests/unit/process/creative-studio/service/schema2/generation/referenceRequest.test.ts tests/unit/process/creative-studio/service/schema2/generation/referenceBinding.test.ts tests/unit/pages/studio/workspace/ReferencesView.dom.test.tsx
  git diff --cached --check
  git diff --cached --name-only
  git commit -m "feat(studio): simplify story and reference workflow"
  ```

  Before staging, every changed path must appear in this plan Tasks 1–7 or Reference Plan Tasks 1–9.
  Stop on unrelated paths.

- [ ] **Step 8: Push only after explicit owner authorization.**

  ```bash
  just push
  ```

  Never substitute raw `git push`.

---

## Acceptance Trace

| Approved outcome                                                | Proving task                                  |
| --------------------------------------------------------------- | --------------------------------------------- |
| Table shows Story, not Action/Look                              | Task 5 DOM/accessibility tests                |
| Beat panel has one Story and one Shooting script                | Task 4 DOM tests                              |
| No independent retired authoring concepts                       | Tasks 4–5 absence assertions and Task 7 audit |
| Fresh projects use exact schema 5; schemas 1–4 stay unsupported | Task 1 store/validation tests                 |
| Proposal review shows the text acceptance writes                | Task 2 main review and Task 6 card tests      |
| Readout and dispatch use the same frozen prompt                 | Task 3 integration and Task 6 readout tests   |
| Characters precede backgrounds and approvals precede Continue   | Reference Tasks 5, 7–9 and Task 7 E2E         |
| Director bindings are typed; approval stays human-only          | Task 2 and Reference Tasks 2–3                |
| Reference, continuity, spend, and provenance fail closed        | Task 3, Reference Tasks 4–6, and Task 7 E2E   |

The implementation is complete only when every row is green and the full repository gate passes.
