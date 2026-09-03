# Creative Studio — Single-Director Re-scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the two capabilities the single-Creative-Director design is blocked on — `outputRole: take | reference` (so a video scene can own a generated supporting image) and `builtin-mcp-studio` (so the Director can read the project and propose changes without ever writing it).

**Architecture:** Two existing plans already cover ~90% of this work and are **co-located in this directory**. This document is a *re-scope*, not a replacement: it gives a per-task verdict against both, supplies complete replacement content wherever the design changed, and adds the three genuinely new tasks. Slices P and A can be **built** in parallel; a third short slice joins them.

⚠️ **CORRECTION (2026-08-11): the slices are NOT file-independent.** Both source plans claim "no shared files" and this document repeated it. Measured after both slices were built, `feat/studio-slice-p` and `feat/studio-slice-a` touch **26 of the same files**: `creativeStudioTypes.ts`, `store.ts`, `creativeStudioService.ts`, `payloadSchemas.ts`, `StudioPage.tsx`, `WritePhase.tsx`, `PhaseShell/types.ts`, **all 12 locale `conversation.json` files**, and six shared test files. Parallel *development* was still fine — no lost work — but **integration will conflict**. Merge on an integration branch off `sprint3`, one slice at a time, full suite after each merge (the AGENTS.md slice-merge rule). **Resolve the locale JSON files semantically — a union of keys, never "take one side"** — and run `bun run i18n:types && node scripts/check-i18n.js` afterwards, since a silently dropped key is invisible to the test suite.

**Tech Stack:** TypeScript, Electron main/renderer split, Vitest 4, Arco, zod payload schemas, stdio MCP subprocess.

---

## Execution context (read first)

- **Repo/branch:** this worktree — `/Users/lap16603/Projects/WePrompt/.worktrees/sprint3-base`, base branch **`sprint3`**. Create a working branch per slice via superpowers:using-git-worktrees. **Run `bun install` in any fresh worktree before believing a red gate.**
- **The two source plans are in this directory** and are required reading for every KEEP task:
  - `2026-08-07-studio-reference-pool-slice-p.md` (9 tasks)
  - `2026-08-07-studio-brief-conversation-slice-a.md` (13 tasks)
  They were written against `creative-suite-sprint2` in the Documents clone. **Ignore their "Execution context" repo/branch lines and use this one instead**; every other measured fact in them was re-verified on 2026-08-10 and still holds.
- **Gates:** `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format`; i18n changes also run `bun run i18n:types && node scripts/check-i18n.js`. Push only via `just push`. Never add AI signatures to commits.
- **Push target is GitHub — `ghk`, not GitLab (decided 2026-08-11).** This repo has three remotes and mixed tracking: `ghk` = `github.com/khoapnt-vng/WePrompt`, `origin` = `code.vng.vn/dto/weprompt` (GitLab), `upstream` = `github.com/iOfficeAI/AionUi` (the fork source — **never push there**). `sprint3` already tracks `ghk`, but `sprint2` and `main` track `origin`, and neither feature branch has an upstream yet. So a bare `git push` is ambiguous. **When asked to push, always name it explicitly the first time:**

  ```
  just push -u ghk feat/studio-slice-p      # or feat/studio-slice-a
  ```

  The `-u` sets the upstream so later pushes on that branch need no argument. Do not set `remote.pushDefault`; it would silently redirect `main` and `sprint2` to GitHub as well, which is not what was decided.
- **Spend safety is inherited, not rebuilt.** Reference generation rides `GenerationReviewModal`, the image `FifoSemaphore`, the per-project cap and the release flag. Nothing here may add a path around them.

### What changed in the design on 2026-08-11

Creative Studio is now built around **one Creative Director agent** across Brief + Write, not a four-role crew. The consequences that touch these slices:

1. **References are scene-owned, not pooled.** Every scene carries exactly one supporting image, which becomes the **first frame** of its video. There is no project-level pool of loose references in v1.
2. **A scene cannot be produced without a plate**, so Produce has one path: image-to-video. **Amended 2026-08-11 (post-design-review): there is no separate "approved" state on the plate.** Existing ≡ producible. The earlier version of this plan said "approved," mirroring an early draft of the Write commission that has since been corrected — see that commission's amendment note. The concern that language was protecting (a bad plate spent on an expensive video without anyone looking at it) is met by Produce's own pre-generation batch review showing the plates at review size, not by a second gate in Write. Nothing in this plan's tasks implements a plate-approval flag; do not add one.
3. **Scene state is the legibility surface** — written → plated → produced → selected. A reference commit must therefore *never* mark a scene complete. ("Plated" means the plate exists, full stop — not that anyone marked it reviewed.)
4. **The Director may request plates for several scenes at once**, so references are not single-submit-only.

### Design decisions taken in-house 2026-08-11 — do not wait for the designer

The designer has delivered Brief and Write and we are not commissioning another round. The following were open in their drawing; they are decided here. Treat this section as the answer, not as an opinion to re-open.

1. **Keep "made from an older visual" (the stale plate).** It was going to be cut as uncomputable; P1b + P5a make it computable, so it stays as drawn. **Staleness is derived at read time** — `asset.sourceVisualPrompt !== scene.visualPrompt.trim()` — and only when the field is present. Absent means unknown provenance and renders as an ordinary ready plate.

2. **Drop "Check with the provider"** from the may-have-been-charged cell. No action was ever defined for it, and we are not inventing an integration to justify a button. The sentence stands alone.

3. **Drop "Copy shot 03's."** Reusing another shot's image needs a copy-asset path that does not exist and is not scheduled. The other three ways to get an image — generate, import, retry — cover the need.

4. **The failure cell's two buckets are fixed by this mapping.** Twelve codes, two cells; anything not listed is "may have been charged", because assuming we were not charged is the expensive direction to be wrong in.

   | Certainly not charged | May have been charged |
   | --- | --- |
   | `invalid_request` · `auth` · `quota` · `rate_limited` · `provider_unavailable` · `unsupported` | `timeout` · `poll_deadline` · `no_output` · `submission_unknown` · `download_failed` · `unknown` |

   Put this in one exported helper with a test, not inline in a component — Review and Produce will both need it.

5. **The warm-red token belongs to whichever task first renders the failed cell** (Slice P Task 7). Add it to the semantic set; do not inline a hex value, and do not reuse the brand orange, which already means "primary action".

6. **The two-state OUTPUT cell and the wider Write table redesign are out of these three slices.** They are UI work on top of the contracts these slices deliver, and nothing here blocks on them. Do not drift into them.

### Facts re-verified 2026-08-10 (cite these, don't re-derive)

| Fact | Where |
| --- | --- |
| Route gate: `route.kind !== scene.mediaKind` → rejected, so a video scene cannot request the image route | `jobManager.ts:514` |
| Commit gate: rejects output whose kind differs from the scene's | `mediaStore.ts:1099`, `:1110` |
| Success commit sets the take unconditionally: `scene.selectedAssetId = asset.id` | `mediaStore.ts:1423` |
| Job records are key-whitelisted; unlisted fields are silently dropped | `store.ts:109`, `:811` |
| A reference must already be an image | `jobManager.ts:573` |
| Image-gen auto-attaches to **every** conversation while globally enabled — **now live** | `useGuidSend.ts:571` |

---

## Slice P — `outputRole` (do this first; it is the only true blocker)

Per-task verdict against `2026-08-07-studio-reference-pool-slice-p.md`:

| Task | Verdict | Note |
| --- | --- | --- |
| 1 — types, schema, collection unions | **KEEP, one amendment** | see Task P1a below |
| 2 — jobManager role-aware routing | **KEEP as written** | this is the `:514` gate; unchanged by the re-scope |
| 3 — mediaStore commit | **REPLACE** | see Task P3′ below — scene-owned, not pooled |
| 4 — the two ownership widenings | **DROP** | they widen ownership to pool assets; we *want* the existing scene-ownership requirement |
| 5 — renderer projection | **KEEP, amended** | see Task P5a — it must also project `sourceVisualPrompt`, or P1b is inert |
| 6 — integration lifecycle | **KEEP, assertions amended** | assert the reference lands on `scene.referenceAssetId`, not in a pool |
| 7 — Generate-reference dialog + review-modal tag | **KEEP, amended** | the dialog stands; its **default prompt must change** — see Task P7a |
| 8 — the pool picker | **DROP** | no pool exists to pick from |
| 9 — i18n, gates, live acceptance | **KEEP, amended** | it inherits pool-era keys and acceptance steps — see Task P9a |

### Task P1a: amend Slice P Task 1 — allow batch references

Execute Slice P Task 1 exactly as written, with **one change to Step 3**. The original constrains references to single submissions; the Director requests plates for several scenes at once.

**Files:**
- Modify: `packages/desktop/src/common/adapter/native/payloadSchemas.ts`
- Test: `tests/unit/common/adapter/native/payloadSchemas.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('accepts a batch reference submission', () => {
  const result = studioSubmitScenesSchema.safeParse({
    projectId: 'p1',
    expectedRevision: 3,
    mode: 'batch',
    sceneIds: ['s1', 's2'],
    catalogVersion: 'v1',
    outputRole: 'reference',
    routes: [
      { sceneId: 's1', choiceId: 'c1', kind: 'image' },
      { sceneId: 's2', choiceId: 'c1', kind: 'image' },
    ],
  });
  expect(result.success).toBe(true);
});

it('rejects referencePrompt without outputRole reference', () => {
  const result = studioSubmitScenesSchema.safeParse({
    projectId: 'p1',
    expectedRevision: 3,
    mode: 'single',
    sceneIds: ['s1'],
    catalogVersion: 'v1',
    referencePrompt: 'a plate',
    routes: [{ sceneId: 's1', choiceId: 'c1', kind: 'image' }],
  });
  expect(result.success).toBe(false);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run --project node tests/unit/common/adapter/native/payloadSchemas.test.ts`
Expected: FAIL — the first test fails because the `superRefine` currently requires `mode === 'single'` for references.

- [ ] **Step 3: Implement**

In `studioSubmitScenesSchema`'s `superRefine`, **delete the rule requiring `mode === 'single'` when `outputRole === 'reference'`**. Keep the rule that `referencePrompt` is only permitted alongside `outputRole: 'reference'`.

- [ ] **Step 4: Run it and watch it pass**

Run: `bunx vitest run --project node tests/unit/common/adapter/native/payloadSchemas.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/adapter/native/payloadSchemas.ts tests/unit/common/adapter/native/payloadSchemas.test.ts
git commit -m "feat(creative-studio): allow batch reference submissions"
```

### Task P1b: record what visual prompt an image was made from

**Added 2026-08-11, after the designer's Brief+Write drawing.** The drawing includes a plate state — `READY · MADE FROM AN OLDER VISUAL` — for an image whose scene's visual line has changed since it was generated. It matters because that image is the **first frame** of the video: a stale plate means paying to generate a clip that opens on the wrong shot. Today it cannot be detected, because `StudioAsset` records nothing about the prompt it came from. This task adds the one field, now, while Task P3′ is already rewriting the commit path — later it is a migration plus every existing image having unknown provenance.

**Files:**
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (`StudioAsset`)
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (`ASSET_KEYS`, `store.ts:91`)
- Test: `tests/unit/process/creative-studio/store.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

`validateAsset` is module-private (`store.ts:556`, not exported), so asset validation is exercised **through `store.updateProject`**, which rejects with `{ code: 'invalid_payload' }`. Follow the existing pattern in this file (see the asset-rejection test around `store.test.ts:889`) rather than calling the validator directly.

```typescript
const writeAsset = (store: CreativeStudioStore, projectId: string, extra: Record<string, unknown>) =>
  store.updateProject(projectId, (current) => {
    const next = addScene(current, 'scene_1');
    next.assets.asset_1 = {
      id: 'asset_1',
      projectId: next.id,
      sceneId: 'scene_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'references', fileName: 'asset_1.png' },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      createdAt: next.createdAt,
      ...extra,
    } as StudioAsset;
    next.scenes.scene_1.referenceAssetId = 'asset_1';
    return next;
  });

it('accepts an asset carrying the visual prompt it was generated from', async () => {
  const project = await store.createProject(makeInput());
  await expect(
    writeAsset(store, project.id, { sourceVisualPrompt: 'Aerial, drifting. Smoke columns.' })
  ).resolves.toBeDefined();
});

it('accepts an asset with no provenance — every pre-existing asset lacks it', async () => {
  const project = await store.createProject(makeInput());
  await expect(writeAsset(store, project.id, {})).resolves.toBeDefined();
});

it('rejects an asset whose provenance is not a string', async () => {
  const project = await store.createProject(makeInput());
  await expect(writeAsset(store, project.id, { sourceVisualPrompt: 42 })).rejects.toMatchObject({
    code: 'invalid_payload',
  });
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/store.test.ts`
Expected: FAIL — the first two tests reject, because `ASSET_KEYS` is a strict whitelist (`validateAsset` does `Object.keys(value).every((key) => ASSET_KEYS.has(key))`), so an unlisted key invalidates the whole record. The third already passes; keep it, it is the guard that the field is type-checked rather than waved through.

- [ ] **Step 3: Implement**

In `creativeStudioTypes.ts`, add to `StudioAsset`:

```typescript
  /**
   * The scene's visual prompt at the moment this asset was generated, trimmed.
   * Absent means unknown provenance — an asset written before this field existed,
   * or one that did not come from a prompt (an import). Absent is NOT stale.
   */
  sourceVisualPrompt?: string;
```

In `store.ts`, add `'sourceVisualPrompt'` to the `ASSET_KEYS` set (currently ~line 93 — find it by name, line numbers in this plan drift as the slice lands), and in `validateAsset` accept the field absent or as a string.

**Staleness is derived, never stored** — a reader compares `asset.sourceVisualPrompt` against `scene.visualPrompt.trim()`. Store the **trimmed** value, because `jobManager.ts` already trims before sending (`prompt = scene.visualPrompt.trim()`); storing the untrimmed value would make a stray trailing space read as a changed prompt. Do not add an `isStale` flag — it would go wrong the moment a scene is edited.

- [ ] **Step 4: Run them and watch them pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/store.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/types/project/creativeStudioTypes.ts packages/desktop/src/process/services/creative-studio/store.ts tests/unit/process/creative-studio/store.test.ts
git commit -m "feat(creative-studio): record the visual prompt an asset was generated from"
```

---

### Task P3′: mediaStore — commit a reference to its scene (REPLACES Slice P Task 3)

The original commits references to a project-level pool. Ours attaches the plate to its own scene and — critically — leaves the take alone, because "plated" and "produced" must remain distinguishable.

> **Correction, 2026-08-11 — an earlier draft of this task was wrong.** It asserted the plate must be **absent** from `scene.assetIds`. That is impossible: `store.ts:993` enforces `asset.sceneId === null || scenes[asset.sceneId].assetIds.includes(asset.id)` — **every** scene-owned asset must be reverse-linked, so a scene-owned plate that is missing from `assetIds` makes the whole project payload invalid and the write is rolled back. The mistake was reading `assetIds` as "the take list"; it actually means "assets owned by this scene", and imported references and posters already live there too. Weakening that invariant would let a plate become an orphan no cleanup path can reach.
>
> **So the plate joins `assetIds`, and take-ness is carried by `selectedAssetId` plus `collection === 'references'`.** This is safe because every take consumer already filters on the collection — verified at `creativeStudioCanonicalTake.ts` (`isCanonicalStudioGeneratedTake` requires `collection === 'assets'`), `AssetStrip.tsx:46` (the takes rail), `ShotGrid.tsx:58` (Produce), and `studioReadiness.ts:62-78` (readiness). A plate is therefore invisible to all of them despite being in the list. Credit to the implementing session for escalating this rather than forcing the assertion through.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts` (`commitProviderJobAsset`, around `:1387-1423`)
- Test: `tests/unit/process/creative-studio/mediaStore.test.ts` (extend)

- [ ] **Step 1: Write the failing tests**

```typescript
it('commits a reference to the scene without selecting it as the take', async () => {
  const project = await seedProjectWithVideoScene('s1');           // scene.mediaKind === 'video'
  const committed = await mediaStore.commitProviderJobAsset({
    projectId: project.id,
    sceneId: 's1',
    jobId: 'j1',
    mediaKind: 'image',          // a plate is always an image
    outputRole: 'reference',
    bytes: pngFixture,
  });

  const after = await store.getProject(project.id);
  expect(after.scenes.s1.referenceAssetId).toBe(committed.id);
  expect(after.scenes.s1.selectedAssetId).toBeNull();               // take untouched
  expect(after.scenes.s1.reviewState).not.toBe('complete');         // still unproduced
  // The plate IS in assetIds — see the correction below — so "not a take" is
  // asserted through the canonical predicate rather than through absence.
  expect(after.scenes.s1.assetIds).toContain(committed.id);
  expect(isCanonicalStudioGeneratedTake(after.assets[committed.id], project.id, after.scenes.s1)).toBe(false);
  expect(after.assets[committed.id].sceneId).toBe('s1');            // scene-owned, not pooled
  expect(after.assets[committed.id].managedAsset.collection).toBe('references');
});

it('records the visual prompt the image was generated from, trimmed', async () => {
  const project = await seedProjectWithVideoScene('s1', { visualPrompt: '  Aerial, drifting.  ' });
  const committed = await mediaStore.commitProviderJobAsset({
    projectId: project.id, sceneId: 's1', jobId: 'j1',
    mediaKind: 'image', outputRole: 'reference', bytes: pngFixture,
  });
  const after = await store.getProject(project.id);
  // Trimmed, so a stray space never reads as a changed prompt later.
  expect(after.assets[committed.id].sourceVisualPrompt).toBe('Aerial, drifting.');
});

it('still commits a take exactly as before', async () => {
  const project = await seedProjectWithVideoScene('s1');
  const committed = await mediaStore.commitProviderJobAsset({
    projectId: project.id, sceneId: 's1', jobId: 'j2',
    mediaKind: 'video', outputRole: 'take', bytes: mp4Fixture,
  });
  const after = await store.getProject(project.id);
  expect(after.scenes.s1.selectedAssetId).toBe(committed.id);
  expect(after.scenes.s1.assetIds).toContain(committed.id);
  expect(after.scenes.s1.reviewState).toBe('complete');
});

it('rejects a reference whose output is not an image', async () => {
  const project = await seedProjectWithVideoScene('s1');
  await expect(mediaStore.commitProviderJobAsset({
    projectId: project.id, sceneId: 's1', jobId: 'j3',
    mediaKind: 'video', outputRole: 'reference', bytes: mp4Fixture,
  })).rejects.toThrow(/invalid_media/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/mediaStore.test.ts`
Expected: FAIL — `outputRole` is not yet honoured, so the reference is committed as the selected take.

- [ ] **Step 3: Implement**

In `commitProviderJobAsset`, branch on the role before the existing scene mutation block:

Record provenance on the asset as it is built, for **both** roles — it is the same line either way, and doing takes now avoids a second migration when Review wants the same warning:

```typescript
// asset construction, before the role branch
asset.sourceVisualPrompt = scene.visualPrompt.trim();
```

Then branch on the role:

```typescript
const role = input.outputRole ?? 'take';

if (role === 'reference') {
  // A plate is always an image, whatever the scene's own media kind is.
  if (input.mediaKind !== 'image') throw new CreativeStudioMediaError('invalid_media');
  scene.referenceAssetId = asset.id;
  // Required by the store's reverse-link invariant (store.ts:993): every
  // scene-owned asset must appear here, or the whole payload is invalid.
  // This does NOT make it a take — take consumers filter on collection.
  scene.assetIds.push(asset.id);
  // Deliberately NOT touched: selectedAssetId, reviewState.
  // A plate must never make a scene look produced — see the scene-state model.
  job.outputAssetIds = [asset.id];
  return asset;
}

// take — unchanged behaviour below this line
if (scene.mediaKind !== input.mediaKind) throw new CreativeStudioMediaError('invalid_media');
scene.assetIds.push(asset.id);
scene.selectedAssetId = asset.id;
scene.reviewState = 'complete';
job.outputAssetIds = [asset.id];
```

Write the plan with `collection: 'references'` for the reference branch, and `'assets'` for takes.

- [ ] **Step 4: Run them and watch them pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/mediaStore.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/services/creative-studio/mediaStore.ts tests/unit/process/creative-studio/mediaStore.test.ts
git commit -m "feat(creative-studio): commit reference outputs to their scene"
```

### Task P5a: also project the provenance field (amends Slice P Task 5)

Execute Slice P Task 5 as written, **plus** this. Task 5's own step names the hazard — *"`toRendererProject` projects field-by-field, so a new field silently drops"* — and `sourceVisualPrompt` (added in P1b) is exactly such a field. Without this, the store records provenance and the renderer never sees it, so the "made from an older visual" state can never be computed and P1b is dead weight.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (`toRendererAsset`)
- Test: the service suite (find with `grep -rln "toRendererProject" tests/unit/process/creative-studio/`)

- [ ] **Step 1: Write the failing test**

```typescript
it('projects the visual prompt an asset was generated from', async () => {
  const project = await seedProjectWithReferenceAsset('s1', {
    sourceVisualPrompt: 'Aerial, drifting. Smoke columns.',
  });
  const rendererProject = toRendererProject(project);
  const asset = Object.values(rendererProject.assets).find((a) => a.sceneId === 's1');
  expect(asset?.sourceVisualPrompt).toBe('Aerial, drifting. Smoke columns.');
});

it('leaves provenance undefined for an asset that never recorded one', async () => {
  const project = await seedProjectWithReferenceAsset('s1', {});
  const rendererProject = toRendererProject(project);
  const asset = Object.values(rendererProject.assets).find((a) => a.sceneId === 's1');
  // Undefined, never an empty string — the renderer must be able to tell
  // "unknown provenance" apart from "generated from an empty prompt".
  expect(asset?.sourceVisualPrompt).toBeUndefined();
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/creativeStudioService.test.ts`
Expected: FAIL — `sourceVisualPrompt` is `undefined` on the projected asset in the first test, because `toRendererAsset` copies a fixed field list.

- [ ] **Step 3: Implement**

Add `sourceVisualPrompt` to `toRendererAsset` in the same style as its neighbouring optional fields (`width`, `height`, `durationSeconds`), and to the renderer-side asset type. Pass it through unchanged — **do not** compute staleness here. Staleness is a renderer-side comparison against the scene's current `visualPrompt`; the main process has no business deciding it, and a stored verdict would go stale the moment a scene is edited.

- [ ] **Step 4: Run them and watch them pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/creativeStudioService.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/services/creative-studio/creativeStudioService.ts packages/desktop/src/common/types/project/creativeStudioTypes.ts tests/unit/process/creative-studio/
git commit -m "feat(creative-studio): project asset provenance to the renderer"
```

---

### Task P6a: amend Slice P Task 6's assertions

Execute Slice P Task 6 as written, replacing every assertion that a reference landed in the pool (`sceneId: null`) with the scene-owned assertions from Task P3′ Step 1. The lifecycle being proven is: submit with `outputRole: 'reference'` → job succeeds → `scene.referenceAssetId` is set → the scene is still **not** complete.

---

## Slice A — `builtin-mcp-studio` (independent of P; may run in parallel)

### Task A0 (decision, 2026-08-11): where the `STUDIO_ENV` contract lives

Slice A Task 1 specifies creating `packages/desktop/src/common/studio/`, mirroring `common/knowledge/`. **Do not create that directory.** `packages/desktop/src/common/` already has **12** direct children against AGENTS.md's "prefer ≤ 10", and the ratchet rule forbids a change that worsens an existing violation. The implementing agent caught this before writing any code — correctly.

**Put the contract at `packages/desktop/src/common/types/project/creativeStudioMcpEnv.ts` instead.** That directory has 5 children, is importable by both the main process and the stdio subprocess, and already holds every other shared Studio module — `creativeStudioTypes.ts`, `creativeStudioCanonicalTake.ts`, `creativeStudioProjectSummary.ts`. Use the **`creativeStudio` prefix** to match those siblings rather than a bare `studioMcpEnv.ts`.

The KB precedent does not apply: `common/knowledge/` earns its own directory because it holds a dozen implementation modules (bm25, chunker, store, embedCore…). Slice A's Task 1 is a single env contract, so it does not need one.

**Execute `2026-08-07-studio-brief-conversation-slice-a.md` Tasks 1-13 as written.** All thirteen survive the re-scope. Two notes:

- Its Task 8 already asserts the six auto-attach ids are absent from the snapshot **and** checks the image-gen client boundary, on the explicit grounds that a snapshot assertion alone is insufficient. That is exactly right, and it matters more now than when it was written: image generation is **globally enabled as of 2026-08-10**, so `useGuidSend.ts:571` will attach that tool to any conversation created through the ordinary composer. Do not weaken this test.
- Its Task 9 mounts the conversation in `BriefPhase` only. The Write mount is deliberately **not** in scope here — the shared conversation is single-mount today (prefill has one consumer; `MessageList` uses global DOM ids), and the designer has been asked whether the design needs it live in both phases. Wait for that answer.

### Task P7a: the reference prompt is a first frame, not a product sheet (amends Slice P Task 7)

**Added 2026-08-11 after catching this in review.** Slice P Task 7 was marked "KEEP as written" in this re-scope, which was wrong: its prompt engineering was designed for the **pool** semantics we dropped.

The original builds a *product reference sheet* — white catalogue background, labelled dividers, three-view turnaround, in-context scale, macro close-ups, a flat colour swatch. That is coherent when a reference is a project-level guidance image the model consults. **It is not coherent here.** In this design the reference is scene-owned and becomes the **first frame** of that scene's video: `jobManager` resolves `firstFrame` from `scene.referenceAssetId`, the video route reports `supportsFirstFrame: true`, and the designer's plate cell is labelled "FIRST FRAME OF THE CLIP". Verified by hand on 2026-08-10 — generated plates became the literal opening frames of the seedance clips. A product sheet as the default means every clip opens on a catalogue page.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/referencePrompt.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/write/ScriptRow.tsx`
- Test: `tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
it('defaults the reference prompt to a single frame of the shot, not a reference sheet', () => {
  const prompt = buildFirstFramePrompt('Wide, low angle. Hero against a collapsing skyline.', '16:9');
  expect(prompt).toContain('Wide, low angle. Hero against a collapsing skyline.');
  expect(prompt).toContain('single cinematic frame');
  // The pool-era sheet vocabulary must not survive — it produces an unusable first frame.
  expect(prompt).not.toMatch(/turnaround|colour swatch|color swatch|SECTION|catalog/i);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run --project jsdom tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx`
Expected: FAIL — `buildFirstFramePrompt` does not exist; the module exports `buildProductSheetPrompt`.

- [ ] **Step 3: Implement**

Replace `buildProductSheetPrompt` with:

```typescript
export const buildFirstFramePrompt = (visualPrompt: string, aspectRatio: string): string =>
  `A single cinematic frame, ${aspectRatio}, no text, no labels, no collage, no split panels. ${visualPrompt.trim()}`;
```

Pass the project's actual aspect ratio from `ScriptRow`'s scene context rather than hardcoding one. **Delete `buildProductSheetPrompt` — do not keep it behind a toggle.** It belongs to a design we removed, and leaving it selectable invites someone to choose it and get an unusable first frame. Subject-consistency sheets, if ever wanted, are a separate feature with their own asset role, not a plate.

The dialog's field stays editable; only the default changes.

- [ ] **Step 4: Run it and watch it pass**

Run: `bunx vitest run --project jsdom tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/ tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx
git commit -m "feat(creative-studio): default the reference prompt to the shot's first frame"
```

---

### Task P9a: correct Task 9's keys and acceptance steps (amends Slice P Task 9)

**Added 2026-08-11.** Task 9 is the third task to inherit assumptions from the pool design. Execute it as written **except** for the corrections below. Do not treat the original's wording as authoritative where it conflicts here.

**i18n — drop two keys, keep the rest.** These two describe the pool picker, which this re-scope dropped (source Task 8):

```text
conversation.creativeStudio.reference.pickerLabel   ← DO NOT ADD
conversation.creativeStudio.reference.pickerEmpty   ← DO NOT ADD
```

Task 7 + P7a and the in-house decisions add strings the original never anticipated. Whatever the final component names are, these need keys and real translations ×12: the **two failure cells** (certainly-not-charged and may-have-been-charged, per the mapping table in "Design decisions taken in-house"), and the **blocked-scene reason** ("Needs an image before it can be produced"). Follow `.claude/skills/i18n/SKILL.md`; no hardcoded user-facing strings.

**Live acceptance — replace all three steps.** The original asserts pool semantics that are now wrong: it expects the dialog "prefilled with the sheet template" (P7a removes that), the asset written with a **`sceneId: null`** record "in the pool" (ours is scene-owned), and a third step pointing a second scene at the same reference "via the picker" (that picker does not exist, and borrowing a plate was explicitly dropped). Use these instead:

1. **Generate.** A **video** scene with a written `visualPrompt` → Generate reference → the dialog is prefilled with a **single-frame prompt of the shot**, not a sheet → the review modal shows the Reference tag and the charge disclosure → confirm.
2. **Commit shape.** The job completes and the plate lands on `scene.referenceAssetId`; the asset record is **scene-owned** (`sceneId` = that scene) with `collection: 'references'`, and carries `sourceVisualPrompt` equal to the scene's trimmed visual prompt.
3. **The scene must NOT read as produced.** `selectedAssetId` is still null, `reviewState` is not `complete`, the takes rail is empty, and readiness does not count it as ready. This is the property the whole scene-state model rests on — if it fails, stop and report rather than adjusting the assertion.
4. **First frame, end to end.** Produce that scene and confirm the generated clip **opens on the plate**. This is the only step that proves the reference is doing its actual job; it costs one video generation and is worth it.

- [ ] **Step 1: i18n** — as above; run `bun run i18n:types && node scripts/check-i18n.js` · Expected: clean.
- [ ] **Step 2: Full gates in a quiet window** — `bunx tsc --noEmit && bun run lint:fix && bun run format && bun run test` · Expected: green. BUG-025 policy applies: a failure on exactly `StudioPage.dom.test.tsx` "fits 18 seconds…" → rerun that file in isolation, record, proceed.
- [ ] **Step 3: Live acceptance** — the four steps above. The app must run from **this worktree** (`node_modules` is already installed here) with `AIONUI_ENABLE_CREATIVE_STUDIO=1`, and the aioncore binary needs prepending to `PATH` from `/Users/lap16603/Projects/WePrompt/resources/bundled-aioncore/darwin-arm64` — the bare-PATH binary is 0.1.44 and will fail the shared dev DB's migrations. Image generation must be enabled in Settings → Tools, and a video route must be bound, or steps 1 and 4 cannot run.
- [ ] **Step 4: Commit** any i18n or fixture updates the gates required.

---

### Task A14: `studio_list_routes` — let the Director read the constraints

New, and the one gap tonight exposed. The Director must learn the video route's **4-second minimum** from the product, not from a prompt that goes stale when a model changes. Without this it will keep writing 3-second beats that Produce silently cannot honour.

**Files:**
- Modify: the Studio MCP server created in Slice A Task 4
- Test: the server's test file from Slice A Task 4

- [ ] **Step 1: Write the failing test**

```typescript
it('exposes the route catalog with constraints and never mutates the project', async () => {
  const before = await readProjectBytes(projectId);
  const result = await callTool('studio_list_routes', { projectId });

  expect(result.image.options[0]).toMatchObject({ model: expect.any(String), health: expect.any(String) });
  expect(result.video.options[0].constraints).toMatchObject({
    minDurationSeconds: expect.any(Number),
    maxDurationSeconds: expect.any(Number),
    supportsFirstFrame: expect.any(Boolean),
  });
  expect(await readProjectBytes(projectId)).toEqual(before);   // byte-unchanged
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioMcpServer.test.ts`
Expected: FAIL — `unknown_tool: studio_list_routes`.

- [ ] **Step 3: Implement**

Register a read-only tool that returns the same catalog `listRoutes` serves the renderer. Its description is a live prompt surface — tool descriptions are discovered at session start and so reach existing conversations — so state the operating rule there:

```
Read the generation routes available to this project, with their constraints.
Call this before proposing scene durations: a scene shorter than the video
route's minDurationSeconds cannot be produced. Never assume a limit; read it.
```

- [ ] **Step 4: Run it and watch it pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioMcpServer.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/services/creative-studio/ tests/unit/process/creative-studio/studioMcpServer.test.ts
git commit -m "feat(creative-studio): expose route constraints to the studio assistant"
```

### Task A15: mount the same conversation in Write ("one thread, two mount points")

**Added 2026-08-11.** The designer's drawing puts the Director's conversation in **both** Brief (centred, before a script exists) and Write (docked rail), explicitly banner-labelled *"assumes the mount is fixed — one thread, two mount points."* Slice A Task 9 mounts it in Brief only, so this is the task that honours that assumption.

**Measured first, because the constraint is narrower than the commission implied.** `StudioPhaseShell.tsx:118-119` renders `{activePhase === 'brief' && <BriefPhase …/>}` and `{activePhase === 'write' && <WritePhase …/>}` — **the two phases are never mounted at the same time.** So "two mount points" is *sequential*, not simultaneous, and the known hazards do not bite as feared:

- `MessageList.tsx:208` uses `id={\`message-${message.id}\`}` — duplicate DOM ids only collide if two lists render the same conversation *simultaneously*, which the shell prevents.
- Send-box prefill (`useConversationSendBoxPrefill`) has one consumer at a time for the same reason.

**So the real risk is not collision, it is remount continuity**: switching phases unmounts the surface, and this task exists to prove nothing is lost when it comes back.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/WritePhase.tsx`
- Test: `tests/unit/pages/studio/WritePhaseConversation.dom.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```typescript
it('mounts the project conversation in Write and renders its existing history', async () => {
  seedBoundBriefConversation(projectId, [
    { role: 'user', text: 'A 20-second teaser.' },
    { role: 'assistant', text: 'Five shots, 20 seconds.' },
  ]);
  render(<WritePhase controller={controller} layoutMode="wide" />);
  await waitFor(() => expect(screen.getByText('Five shots, 20 seconds.')).toBeInTheDocument());
  // The same thread, not a new one.
  expect(screen.queryByText(/start a new conversation/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run --project jsdom tests/unit/pages/studio/WritePhaseConversation.dom.test.tsx`
Expected: FAIL — Write renders the old assistant rail, not the conversation.

- [ ] **Step 3: Implement**

Render the same conversation surface Task 9 introduced, in Write's rail position, resolving the conversation from the project binding exactly as Brief does. Do not create a second conversation and do not add a second binding — one thread, resolved the same way in both places.

- [ ] **Step 4: Run it and watch it pass**

Run: `bunx vitest run --project jsdom tests/unit/pages/studio/WritePhaseConversation.dom.test.tsx && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Dev smoke — the part a unit test cannot prove**

Slice A's own risk register already requires a dev smoke for the standalone chat mount; this is the same seam. With `AIONUI_ENABLE_CREATIVE_STUDIO=1`, in a real project:
1. Send a message in Brief, accept a script, move to Write — the thread is there, with its history.
2. Switch Brief → Write → Brief repeatedly. No duplicate-id warnings in the console, and the send box prefill lands in the box you can actually see.
3. **Switch phases while a reply is streaming**, then switch back. Record what happens: the reply must either continue and be present on return, or resume cleanly from persisted history. A dropped or duplicated message here is the failure this task exists to catch — if it happens, stop and report rather than patching around it.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/ tests/unit/pages/studio/WritePhaseConversation.dom.test.tsx
git commit -m "feat(creative-studio): mount the project conversation in Write"
```

---

## Slice J — the join (requires **both** P and A landed)

### Task J1: `studio_request_reference_images` — queue plates for approval

The Director asks for plates; the user approves the spend. The tool must **queue**, never generate.

**Files:**
- Modify: the Studio MCP server (Slice A Task 4)
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`
- Test: the server's test file

- [ ] **Step 1: Write the failing tests**

```typescript
it('queues a reference request without spending', async () => {
  const result = await callTool('studio_request_reference_images', {
    projectId, sceneIds: ['s1', 's2'],
  });
  expect(result.status).toBe('queued_for_approval');
  expect(submitScenesSpy).not.toHaveBeenCalled();      // no provider call from the tool
  expect(await listPendingReferenceRequests(projectId)).toHaveLength(2);
});

it('refuses scenes that do not exist', async () => {
  await expect(callTool('studio_request_reference_images', {
    projectId, sceneIds: ['nope'],
  })).rejects.toThrow(/unknown scene/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioMcpServer.test.ts`
Expected: FAIL — `unknown_tool: studio_request_reference_images`.

- [ ] **Step 3: Implement**

Record a pending request per scene and emit the existing `proposalUpdated`-style notification so the renderer can surface it. The tool description carries the spend rule:

```
Request a supporting reference image for one or more scenes. This does NOT
generate anything — it queues a request the user approves before any money is
spent. One image per scene; do not request a scene that already has one unless
the user asked you to replace it.
```

- [ ] **Step 4: Run them and watch them pass**

Run: `bunx vitest run --project node tests/unit/process/creative-studio/studioMcpServer.test.ts && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/services/creative-studio/ tests/unit/process/creative-studio/studioMcpServer.test.ts
git commit -m "feat(creative-studio): let the assistant queue reference requests"
```

### Task J2: route queued requests into the existing review modal

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/useStudioJobs.ts`
- Modify: the Generate-reference dialog from Slice P Task 7
- Test: `tests/unit/pages/studio/useStudioJobs.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```typescript
it('presents queued assistant requests in the review modal as one batch', async () => {
  seedPendingReferenceRequests(['s1', 's2']);
  const { result } = renderHook(() => useStudioJobs(projectId));
  await waitFor(() => expect(result.current.reviewRequest?.scenes).toHaveLength(2));
  expect(result.current.reviewRequest?.outputRole).toBe('reference');
  expect(submitScenesSpy).not.toHaveBeenCalled();       // still nothing spent
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `bunx vitest run --project jsdom tests/unit/pages/studio/useStudioJobs.dom.test.tsx`
Expected: FAIL — queued requests are not read.

- [ ] **Step 3: Implement**

Read pending requests and build a `GenerationReviewModal` request with `outputRole: 'reference'` and `mode: 'batch'`, reusing the submit path from Slice P Task 7. Approval submits; dismissal clears the queue.

- [ ] **Step 4: Run it and watch it pass**

Run: `bunx vitest run --project jsdom tests/unit/pages/studio/useStudioJobs.dom.test.tsx && bunx tsc --noEmit`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/studio/ tests/unit/pages/studio/useStudioJobs.dom.test.tsx
git commit -m "feat(creative-studio): approve assistant reference requests as a batch"
```

### Task J3: full gates and live acceptance

- [ ] **Step 1: Full suite** — `bun run test` · Expected: green. Per BUG-025 policy, a failure on exactly `StudioPage.dom.test.tsx` "fits 18 seconds…" → rerun that file in isolation, record the result, proceed.
- [ ] **Step 2: Gates** — `bunx tsc --noEmit && bun run lint:fix && bun run format && bun run i18n:types && node scripts/check-i18n.js` · Expected: clean.
- [ ] **Step 3: Live acceptance** — with `AIONUI_ENABLE_CREATIVE_STUDIO=1`, in a real project: ask the Director for a plate on a video scene; confirm the review modal appears, that approving it produces an image attached as `referenceAssetId`, and that **the scene still reads as unproduced**. Then produce that scene and confirm the plate is used as the first frame.
- [ ] **Step 4: Commit** any i18n or fixture updates the gates required.

---

## Order

1. **Slice P** (P1 + P1a + **P1b**, P2, P3′, P5 + **P5a**, P6+P6a, P7 + **P7a**, P9 + **P9a**) — the blocker, and independently shippable. **P1b must land before P3′**, since P3′ populates the field P1b adds. **P5a must land with P5**, or the field never reaches the renderer and P1b is inert. **P7a must land with P7**, or the default prompt makes every clip open on a product sheet.
2. **Slice A** (Tasks 1-13 + A14 + **A15**) — independent of P; can run in parallel with a second agent. A15 follows Task 9, since it reuses the surface Task 9 introduces.
3. **Slice J** (J1, J2, J3) — requires both.

## Explicitly out of scope

The reference pool and its picker (dropped with the design change); the audio lane; any second proposal payload kind; video generation from the Director; anything about pricing.

*(The Write mount of the conversation was listed here as out of scope pending the designer. Their drawing has since arrived and assumes it — "one thread, two mount points" — so it is now scheduled as Task A15.)*

## Risk register

1. **`commitProviderJobAsset` is shared by both roles** (Task P3′). Its take branch must stay byte-identical in behaviour — the second test in that task exists precisely to prove takes did not regress.
2. **The image-gen auto-attach is live** (`useGuidSend.ts:571`). If Slice A's snapshot test is ever weakened, the Director gains an unmetered path to the provider that bypasses the job manager, the review modal and the per-project cap.
3. **`outputRole` absent ≡ take.** Every job record written before this change lacks the field. Never backfill; use the accessor.
3a. **`sourceVisualPrompt` absent ≡ unknown provenance, NOT stale.** Every asset written before Task P1b lacks it, and imported images will never have it. If a reader treats absent as stale, every existing plate in every existing project lights up as out of date on first launch. Staleness is only ever `present && !== scene.visualPrompt.trim()`.
4. **Batch references and the FIFO semaphore.** Image concurrency is 2; a five-scene request will serialise. Expect it, and do not raise the cap to make a test faster.
