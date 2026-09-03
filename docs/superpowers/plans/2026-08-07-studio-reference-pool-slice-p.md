# Creative Studio Slice P — Reference Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generated reference images live in a shared project-level pool, produced through the existing paid-generation flow (`outputRole: 'reference'`), and any scene can point at any pool reference.

**Architecture:** One enum threaded confirm → submit → job → completion. Reference jobs route to the image role regardless of the scene's media kind, commit as pool assets (`sceneId: null`, new collection `references`) that never touch takes or review state, and set the requesting scene's `referenceAssetId`. Two ownership validators widen from scene-owned to scene-owned-or-pool. UI is a Generate-reference dialog and a pool picker in `SceneInspector`.

**Tech Stack:** TypeScript strict, zod payload schemas, Vitest 4 (`--project node` for main, `--project dom` for renderer), the `e2eFakeAdapter` for integration, i18n ×12.

**Design of record:** `docs/design/creative-studio-script-level-v1-design.md` §3 (committed on Projects `sprint2`).

---

## Execution context (read first)

- **Repo:** the Documents clone — `/Users/lap16603/Documents/WePrompt`. Base branch **`creative-suite-sprint2`**, working branch `codex/studio-slice-p` in a fresh worktree (superpowers:using-git-worktrees; run `bun install` in the worktree before believing any red gate).
- **Independent of Slice A** — no shared files. Either slice lands first.
- **Gates:** `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format`; i18n changes add `bun run i18n:types && node scripts/check-i18n.js`. Push only via `just push`. BUG-025 gate policy: a full-suite failure on exactly `StudioPage.dom.test.tsx` "fits 18 seconds…" → rerun the file in isolation, record, proceed.
- **Spend safety is inherited, not rebuilt:** reference generation rides `GenerationReviewModal`, the image `FifoSemaphore`, the per-project cap and the release flag. Nothing in this plan may add a path around them.

### Measured facts this plan is built on

| Fact | Where |
| --- | --- |
| Route gate #1: `route.kind !== scene.mediaKind` → `invalid_route` | `jobManager.ts:514` |
| Route gate #2: constraints check; `referenceAssetId !== null && !supportsFirstFrame` → `invalid_route` | `jobManager.ts:530-538` |
| Request build: `prompt = scene.visualPrompt.trim()`, `mediaKind = scene.mediaKind`; `firstFrame` resolved when `scene.referenceAssetId !== null`, requiring the asset scene-owned + image + byte-capped | `jobManager.ts:555-581` |
| Success commit: requires `scene.mediaKind === input.mediaKind`, then `assetIds.push`, **`selectedAssetId = asset.id`**, `reviewState = 'complete'`, `job.outputAssetIds = [asset.id]`, `reconcilePersistedStudioCuts` | `mediaStore.ts:1387-1413` (`commitProviderJobAsset`) |
| Write plans carry `collection`; provider job writes plan `collection: 'assets'`; plan type union is `'assets' \| 'thumbnails'` | `mediaStore.ts:1033`, `:1121` |
| Pool-asset precedent: `persistProjectOutput` → `persistManagedOutputWithPlan({...input, sceneId: null, ...}, plan, sidecar)` | `mediaStore.ts:1370-1385` |
| Collection unions to widen: type `'assets' \| 'imports' \| 'thumbnails'`; store `ASSET_COLLECTIONS` set; plan union | `creativeStudioTypes.ts:56`, `store.ts:129`, `mediaStore.ts:1033` |
| Ownership validator #1 (store): `assets[scene.referenceAssetId]?.sceneId === sceneId` | `store.ts:1027-1029` |
| Ownership validator #2 (submit): `reference.sceneId !== scene.id \|\| reference.mediaKind !== 'image'` → `invalid_route`; byte cap after | `jobManager.ts:567-581` |
| Job records are key-whitelisted: `JOB_KEYS` set + `Object.keys(value).every(key => JOB_KEYS.has(key))` | `store.ts:109`, `:811` |
| Submit IPC schema: strict zod — projectId, expectedRevision, `mode: 'single'\|'batch'`, sceneIds 1..24, catalogVersion, routes exactly matching sceneIds | `payloadSchemas.ts:344-371` (`studioSubmitScenesSchema`) |
| Duplicate-charge lineage: per-submission `lineage` carries `duplicateChargeAcknowledged`; predicate throws `duplicate_charge_acknowledgement_required` | `jobManager.ts:1088-1126`, `:1226` |
| Renderer submit path: `buildSingleSceneReviewRequest` (`GenerationControls.tsx:138`) → `GenerationReviewModal` (`scenes: GenerationReviewScene[]` prop) → `useStudioJobs.ts:369` `submitScenes.invoke` | measured |
| Renderer asset projection: `toRendererProject` maps every `project.assets` entry via `toRendererAsset` — pool assets flow, but verify `collection` is projected (the G1 trap: field-by-field projection silently drops new fields) | `creativeStudioService.ts` (`toRendererProject`) |
| `referenceAssetId` is renderer-editable (in the `StudioEditableScene` pick) — the picker writes through the existing draft/save path | `creativeStudioTypes.ts:152-163` |
| Fake adapter for integration: `e2eFakeAdapter.ts`; lifecycle test to extend: `tests/integration/creative-studio/generationLifecycle.integration.test.ts` | measured |

---

### Task 1: types, schema, collection unions — the foundation (no behaviour change)

**Files:**
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts`
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (`ASSET_COLLECTIONS`, `JOB_KEYS`, job validator)
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts` (plan `collection` union)
- Test: `tests/unit/process/creative-studio/store.test.ts` (extend)

- [ ] **Step 1: Failing store tests** — (a) an asset record with `managedAsset.collection: 'references'` and `sceneId: null` validates; (b) a job record carrying `outputRole: 'reference'` validates and one carrying `outputRole: 'poster'` is rejected; (c) an asset with an unknown collection still rejects.

- [ ] **Step 2: Types.** In `creativeStudioTypes.ts`:

```typescript
export type StudioOutputRole = 'take' | 'reference';
```

- `collection: 'assets' | 'imports' | 'thumbnails' | 'references'` (line 56).
- `StudioJob` gains `outputRole?: StudioOutputRole` — **optional**, absent ≡ `'take'`, because every pre-existing job record lacks it and must keep validating; never rewrite old jobs. Readers use a `jobOutputRole(job)` accessor (one place) rather than sprinkling `?? 'take'`.
- `StudioSubmitScenesRequest` / `StudioResolvedSubmitScenesRequest` gain `outputRole?: StudioOutputRole` and `referencePrompt?: string`.

- [ ] **Step 3: Schema.** In `studioSubmitScenesSchema` (keep `.strict()`):

```typescript
outputRole: z.enum(['take', 'reference']).optional(),
referencePrompt: z.string().min(1).max(4096).optional(),
```

Extend the existing `superRefine`: `outputRole === 'reference'` requires `mode === 'single'` (batch stays take-only in v1) and permits `referencePrompt`; `referencePrompt` without `outputRole: 'reference'` is an issue.

- [ ] **Step 4: Store.** Add `'references'` to `ASSET_COLLECTIONS` (`store.ts:129`); add `'outputRole'` to `JOB_KEYS` (`store.ts:109`); in the job validator (used at `store.ts:811`), accept `outputRole` absent or one of the two values. Widen the `ManagedWritePlan` collection union (`mediaStore.ts:1033`) to include `'references'`.

- [ ] **Step 5: Run** — `bunx vitest run --project node tests/unit/process/creative-studio/store.test.ts && bunx tsc --noEmit` · Expected: pass, clean.

- [ ] **Step 6: Commit** — `feat(creative-studio): add the outputRole and references-collection contracts`

---

### Task 2: jobManager — role-aware routing, request build, lineage

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts`
- Test: `tests/unit/process/creative-studio/jobManager.test.ts` (extend)

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'a reference job on a video scene resolves an image route' — scene.mediaKind 'video',
//    submit with outputRole 'reference' + an image route snapshot → resolves; the provider
//    request carries mediaKind 'image' and prompt === referencePrompt.
// 2. 'a take job still requires the route kind to match the scene' — regression: video scene,
//    image route, outputRole absent → invalid_route.
// 3. 'a reference job ignores scene.referenceAssetId' — scene has a reference set, the chosen
//    image route has supportsFirstFrame false → still resolves (gate #2 is take-only), and the
//    provider request has NO firstFrame.
// 4. 'a reference job without referencePrompt is rejected' — invalid_route (or a typed
//    invalid_payload — match the manager's existing error vocabulary).
// 5. 'reference lineage does not cross-fire take lineage' — a scene with a prior take job does
//    NOT demand duplicate-charge acknowledgement for its first reference job, and vice versa.
//    (Read the predicate that throws at jobManager.ts:1226 and key it by (sceneId, outputRole).)
```

- [ ] **Step 2: Implement.** The changes, at the measured sites:

- `:514` — `const requestedKind = input.outputRole === 'reference' ? 'image' : scene.mediaKind;` gate becomes `route.kind !== requestedKind`.
- `:530-538` — the `referenceAssetId/supportsFirstFrame` clause applies only when `outputRole !== 'reference'`; duration constraints for a reference job validate against the image route exactly as an image take would.
- `:555+` — `baseRequest.mediaKind = requestedKind`; `prompt = outputRole === 'reference' ? referencePrompt.trim() : scene.visualPrompt.trim()` (empty → the same error as an empty prompt today); the `firstFrame` block (`:567`) is skipped entirely for reference jobs.
- Job creation (`:1088+`) stamps `outputRole` on the record; the duplicate-charge predicate keys by role.
- Thread `outputRole`/`referencePrompt` from `submitScenes(input)` (`:1171`) through `resolveProvider`.

- [ ] **Step 3: Run** — `bunx vitest run --project node tests/unit/process/creative-studio/jobManager.test.ts` · Expected: all pass including the 118 existing.

- [ ] **Step 4: Commit** — `feat(creative-studio): route reference jobs to the image role`

---

### Task 3: mediaStore — pool write plan and role-aware commit

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Test: `tests/unit/process/creative-studio/mediaStore.test.ts` (extend; find the exact file with `grep -rln "commitProviderJobAsset\|persistProviderOutputForJob" tests/`)

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'a reference output commits to the pool and the pointer, never the takes' — job with
//    outputRole 'reference' on a video scene, image output → asset persisted with sceneId null
//    + collection 'references'; scene.referenceAssetId === asset.id; scene.assetIds unchanged;
//    scene.selectedAssetId unchanged; scene.reviewState unchanged; job.status 'succeeded'
//    with outputAssetIds [asset.id].
// 2. 'a take output is byte-identical to today' — regression on the existing commit path.
// 3. 'a reference output that is not an image is rejected' — video bytes → invalid_media.
// 4. 'a reference never yields a clip' — after commit, the derived pristine cut contains no
//    clip for the pool asset (reconcilePersistedStudioCuts ran; assert cuts untouched).
```

- [ ] **Step 2: Implement.**

- `prepareProviderJobWrite` (plans `collection: 'assets'` at `:1121`): when the job's `outputRole === 'reference'`, plan `collection: 'references'`, byte cap `imageOutputMaxBytes`, and expected media kind `image` (the `scene.mediaKind` comparisons in `validateProviderOutputMetadata`/`prepareProviderJobWrite` compare against the **requested output kind**, not the scene's).
- `commitProviderJobAsset` (`:1387`): branch on the job's `outputRole`. Reference branch: asset enters `current.assets` with `sceneId: null` (follow `persistProjectOutput`'s `{...input, sceneId: null}` pattern at `:1372`); `scene.referenceAssetId = asset.id`; **no** `assetIds.push`, **no** `selectedAssetId`, **no** `reviewState` change; job fields update exactly as the take branch does. The `scene.mediaKind !== input.mediaKind` guard becomes role-aware.
- Ensure the `references/` managed directory is created by the same `ensureManagedDirectory` mechanism the other collections use.

- [ ] **Step 3: Run** — the mediaStore suite + `bunx tsc --noEmit` · Expected: pass, clean.

- [ ] **Step 4: Commit** — `feat(creative-studio): commit reference outputs to the project pool`

---

### Task 4: the two ownership widenings

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts:1027-1029`
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts:567-581`
- Test: extend both suites

- [ ] **Step 1: Failing tests**

```typescript
// Store validator: a scene pointing at a pool reference (sceneId null + collection 'references')
//   validates; pointing at another scene's asset REJECTS; pointing at a render output
//   (sceneId null + collection 'assets') REJECTS.
// Submit path: a take job whose scene points at a pool reference resolves firstFrame from it
//   (byte cap still enforced); the same three rejections hold at submit time.
```

- [ ] **Step 2: Implement.** Both sites widen identically — scene-owned **or** pool, nothing else:

```typescript
// store.ts:1027 —
scene.referenceAssetId === null ||
  (typedAssets[scene.referenceAssetId]?.projectId === projectId &&
    (typedAssets[scene.referenceAssetId]?.sceneId === sceneId ||
      (typedAssets[scene.referenceAssetId]?.sceneId === null &&
        typedAssets[scene.referenceAssetId]?.managedAsset.collection === 'references')));

// jobManager.ts:570 — the reference lookup accepts
//   reference.sceneId === scene.id  OR  (reference.sceneId === null &&
//   reference.managedAsset.collection === 'references');
// mediaKind === 'image' and the byte cap stay exactly as they are.
```

- [ ] **Step 3: Run both suites.** Expected: pass.

- [ ] **Step 4: Commit** — `feat(creative-studio): accept pool references where scene ownership was required`

---

### Task 5: renderer projection — the G1 trap test

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (`toRendererAsset`)
- Test: the service suite (find with `grep -rln "toRendererProject" tests/unit/process/creative-studio/`)

- [ ] **Step 1: Failing test** — a project holding a pool reference: the renderer projection contains that asset with `sceneId: null` **and its collection** (or an equivalent `isReference` discriminator). This is the trap named in the design (`toRendererProject` projects field-by-field, so a new field silently drops).

- [ ] **Step 2: Implement** — extend `toRendererAsset` with the collection (mirror its existing field style). If the renderer asset type omits `managedAsset`, add a flat `collection` field to the renderer-side type rather than exposing the whole managed record.

- [ ] **Step 3: Run + typecheck.** Expected: pass, clean.

- [ ] **Step 4: Commit** — `feat(creative-studio): project pool references to the renderer`

---

### Task 6: integration — the reference lifecycle end-to-end

**Files:**
- Test: `tests/integration/creative-studio/generationLifecycle.integration.test.ts` (extend)

- [ ] **Step 1: Write the test** — through the real store + jobManager + mediaStore with `e2eFakeAdapter`: submit `outputRole: 'reference'` with a `referencePrompt` on a **video** scene → job succeeds → assert the pool asset (sceneId null, collection `references`), the pointer, untouched takes/review state, and that a subsequent **take** submission on the same scene resolves `firstFrame` from the pool asset. One test, the whole story.

- [ ] **Step 2: Run** — `bunx vitest run --project node tests/integration/creative-studio/generationLifecycle.integration.test.ts` · Expected: pass.

- [ ] **Step 3: Commit** — `test(creative-studio): cover the reference pool lifecycle end-to-end`

---

### Task 7: Generate-reference dialog + review-modal tag

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/Storyboard/SceneInspector.tsx` (beside the import-reference control at `:241-267`)
- Create: `packages/desktop/src/renderer/pages/studio/components/Generation/referencePrompt.ts` (the product-sheet template helper)
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationControls.tsx` (`buildSingleSceneReviewRequest` carries `outputRole`/`referencePrompt`)
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationReviewModal.tsx` (`GenerationReviewScene` gains `outputRole`; the line renders a reference tag)
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/useStudioJobs.ts:369` region (pass-through)
- Test: `tests/unit/pages/studio/Generation/` (extend the modal/controls suites) + a new inspector test

- [ ] **Step 1: The template helper first** (pure function, its own micro-test):

```typescript
export const buildProductSheetPrompt = (visualPrompt: string): string =>
  `Product reference sheet. Pure white catalog background with thin labeled dividers.
[SECTION 1]: Three-view turnaround — straight-on, 3/4 angle, side profile.
[SECTION 2]: In-context scale reference.
[SECTION 3]: Macro close-ups of material and texture.
[SECTION 4]: A flat color swatch.
Identical geometry, placement, and material finish in every section.
Subject: ${visualPrompt.trim()}`;
```

- [ ] **Step 2: Failing dom tests**

```typescript
// 1. 'Generate reference opens prefilled from visualPrompt through the sheet template' —
//    dialog textarea value === buildProductSheetPrompt(scene.visualPrompt); editing it does
//    NOT touch the scene draft (the reference prompt travels with the request, never writes
//    the scene).
// 2. 'confirming routes through the review modal with a visible reference tag and the honest-cost
//    line intact' — assert the tag text and that the existing charge-disclosure copy renders.
// 3. 'submit carries outputRole reference and the prompt' — assert the submitScenes.invoke payload.
// 4. 'the control is absent when no image role is ready' — reuse the availability the inspector
//    already derives for import/generation; do not invent a new readiness source (BUG-024's
//    vocabulary work is separate).
```

- [ ] **Step 3: Implement.** The dialog needs an image route for the scene — reuse the same route-snapshot machinery `buildSingleSceneReviewRequest` uses, but select the **image** role's route regardless of `scene.mediaKind` (this mirrors Task 2's `requestedKind`). Keep the modal's existing totals/consent behaviour untouched; the tag is presentation only.

- [ ] **Step 4: Run** — the Generation + inspector dom suites. Expected: pass.

- [ ] **Step 5: Commit** — `feat(creative-studio): generate pool references from the scene inspector`

---

### Task 8: the pool picker

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/Storyboard/SceneInspector.tsx`
- Test: extend the inspector suite

- [ ] **Step 1: Failing tests**

```typescript
// 1. 'the picker lists pool references with thumbnails and marks the current one' —
//    project.assets filtered to collection 'references' (plus the scene's own imported
//    reference if set — imported stays scene-owned and valid).
// 2. 'picking writes referenceAssetId through the editor draft path' — assert
//    editor.updateSceneDraft (or the existing scene-field update call the inspector already
//    uses for other fields) received { referenceAssetId: <poolAssetId> }; no direct IPC.
// 3. 'clearing the reference sets null'.
```

- [ ] **Step 2: Implement** — an Arco Select/popover beside the reference preview; thumbnails via the existing `weprompt-studio://` asset URL helper the inspector already uses for the current reference preview. Write through the existing editable-scene path only (`referenceAssetId` is already in the `StudioEditableScene` pick).

- [ ] **Step 3: Run.** Expected: pass.

- [ ] **Step 4: Commit** — `feat(creative-studio): pick any pool reference for a scene`

---

### Task 9: i18n, gates, live acceptance

- [ ] **Step 1: i18n** — follow `.claude/skills/i18n/SKILL.md` for all new strings (en-US values; real translations ×12):

```text
conversation.creativeStudio.reference.generate        = "Generate reference"
conversation.creativeStudio.reference.dialogTitle     = "Generate a reference image"
conversation.creativeStudio.reference.promptLabel     = "Reference prompt"
conversation.creativeStudio.reference.reviewTag       = "Reference"
conversation.creativeStudio.reference.pickerLabel     = "Project references"
conversation.creativeStudio.reference.pickerEmpty     = "No references yet. Generate one, or import from disk."
conversation.creativeStudio.reference.clear           = "Remove reference"
```

Run `bun run i18n:types && node scripts/check-i18n.js` — clean.

- [ ] **Step 2: Full gates in a quiet window** — `bunx tsc --noEmit && bun run lint:fix && bun run format && bun run test` · Expected: green (BUG-025 policy applies).

- [ ] **Step 3: Live acceptance (real spend, minimal):**
  1. Video scene with a written `visualPrompt` → Generate reference → dialog prefilled with the sheet template → review modal shows the Reference tag + charge disclosure → confirm.
  2. Job completes → the reference appears on the scene and in the pool; takes and review state untouched; the asset on disk sits under `references/` with a `sceneId: null` record.
  3. Point a second scene at the same reference via the picker.
  4. Generate a take on that second scene through a `supportsFirstFrame` route → the provider request carries the pool reference as `firstFrame` (verify in logs) — the same-product-in-every-shot story, proven.
  5. Render the cut → the pool reference is in no clip.

- [ ] **Step 4: Push** — `just push -u origin codex/studio-slice-p`; verify by ref equality.

---

## Explicitly out of scope

Batch reference generation (`mode: 'batch'` stays take-only); agent-proposed references (a later payload kind); reference deletion/GC of the pool; BUG-024's readiness vocabulary; any change to semaphores, caps, or the release flag.

## Risk register

1. **The duplicate-charge predicate** (Task 2) — its exact shape at `jobManager.ts:1226` was not read; the contract (keyed by scene **and** role) is fixed, the implementation follows the code found there.
2. **Renderer route selection for the dialog** (Task 7) — selecting an image route for a video scene is new renderer territory; the `requestedKind` rule from Task 2 is the single source of truth, and test 4 pins the unavailable case.
3. **Old job records** — `outputRole` must validate as absent-means-take (Task 1), or every pre-existing project fails job validation on load.
