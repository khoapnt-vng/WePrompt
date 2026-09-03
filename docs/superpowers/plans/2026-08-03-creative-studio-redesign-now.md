# Creative Studio Redesign — "Now" Tier Implementation Plan (rev 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the agreed "Now" tier of the Creative Studio redesign — the interface-only deletions and the bug-fix prerequisites — on branch `codex/creative-studio-mvp`, leaving the app fully working after every task.

**Architecture:** All changes ride the existing MVP implementation. No phase split, no vocabulary rename in this tier (those are the "Next"/"Later" plans — see Roadmap). One new IPC operation (`retimeScenes`) is added for atomic multi-shot retiming; everything else is gate-deletion or surgical behavior fixes with tests.

**Tech Stack:** Electron (main `packages/desktop/src/process/`, renderer `packages/desktop/src/renderer/`), React + Arco Design + UnoCSS, react-i18next (12 locales), Vitest 4, Bun.

**Working directory:** `/Users/lap16603/Documents/WePrompt/.worktrees/creative-studio-mvp` (branch `codex/creative-studio-mvp`).

**Rev 2 changes (from plan review):** Task "auto-select newest take" REMOVED (already implemented — `mediaStore.ts` sets `scene.selectedAssetId = asset.id` in the atomic commit; do not re-add). Merge task rewritten for a dirty tree and real conflict breadth. Timing-gate removal covers all five gate sites. Fit-to-goal is route-aware, skips rendered shots, reports unreachable explicitly, and applies atomically. Cancellation is a per-job capability. Poll deadline includes a per-attempt timeout. Download budget adds a stall watchdog and handles unknown size. Duration bounds come from the shot's own route `constraints`. i18n covers ru/uk plural forms with behavior tests.

**Ground rules (every task):**
- **Never `git add -A` / `git add .`** — stage exact paths only. The worktree contains work not owned by this plan (e.g. `docs/README.md` modifications, `docs/guides/creative-studio-user-flow.md`); leave anything you didn't change strictly alone.
- Full gate before every commit: `bunx tsc --noEmit && bun run test <touched suites>`; before the final commit of each task also `bun run lint:fix && bun run format`, and when locales/renderer changed: `bun run i18n:types && node scripts/check-i18n.js`.
- Tasks 2–8 are independently mergeable; keep them as separate commits (separate MRs if the team wants them split).
- Run the full `bun run test` on a quiet machine — concurrent sessions inflate durations 15–150× and fake timeouts.

---

## Roadmap (this plan = Tier 1 only)

| Tier | Scope | Plan |
| --- | --- | --- |
| **Now (this plan)** | sprint1 reconciliation · timing gate removal + Fit to goal · cancel-while-rendering (per-job capability) + poll deadline · download budgets · route-aware duration stepper · copy/plural fixes | Tasks 1–7 below |
| **Next** | Phase split (Brief / Script / Produce routes), engine setup at Produce's door, activity tray, scaled batch confirm, price table + spent-this-session ledger, reference contract extension (gateway spec first — longest lead time) | separate plan, write before execution |
| **Later** | Chat thread + assistant dock (proposal store, ops applier, undo — requires the `updateProject` whitelist fix first), Review player (requires the media re-hash fix), reference roles + project look, engine picker | separate plan per stream |
| **Cut from v1** | Stitched draft, share link | — |

**Open design items (blockers for Next/Later, not for this plan):** engine-picker screen; per-shot engine override; prototype shows Cancel on rendering cards while the confirm says Seedance can't cancel — Task 4's `canCancel` contract is the backend for resolving that.

---

### Task 1: Clean-worktree sprint1 reconciliation

`origin/sprint1` is a moving target (it advanced twice on 2026-08-03 alone). A merge simulation shows content conflicts beyond the two known hazard files — expect ~10 conflicted paths plus modify/delete intersections from this branch's renames.

**Files:** merge commit; conflict resolution concentrated in
- `packages/desktop/src/process/services/update/autoUpdaterService.ts` + `tests/unit/process/services/autoUpdaterService.test.ts`, `cdnUpdateFeed.test.ts` (rename vs sprint1 security hardening)
- `packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent/index.tsx` (rename vs sprint1 rewrite)
- `packages/desktop/src/common/platform/index.ts`, `packages/desktop/src/index.ts`, `packages/desktop/src/process/bridge/index.ts`, `updateBridge.ts`, `configureChromium.ts`, `tests/e2e/fixtures.ts`
- `packages/desktop/src/renderer/services/i18n/locales/**` (semantic merge — union of keys, never take-one-side)

- [ ] **Step 1: Confirm a clean starting state for the merge**

```bash
cd /Users/lap16603/Documents/WePrompt/.worktrees/creative-studio-mvp
git status --porcelain
```

If anything is modified or untracked that this plan does not own (currently `docs/README.md`, `docs/guides/creative-studio-user-flow.md`): stop and ask the owner, or stash — do NOT commit it into the merge:

```bash
git stash push --include-untracked -m "pre-sprint1-merge stash (not this plan's work)" -- docs/README.md docs/guides/creative-studio-user-flow.md
```

- [ ] **Step 2: Fetch and simulate before merging**

```bash
git fetch origin sprint1
git merge-tree --write-tree --name-only HEAD origin/sprint1 | head -40
```

Read the conflict list. Note it in the merge commit body so the resolution is reviewable.

- [ ] **Step 3: Merge and resolve**

```bash
git merge origin/sprint1
```

Resolution rules:
- **Locale JSON:** union of both sides' keys; when both sides changed the same key, keep sprint1's translation unless the key belongs to Studio.
- **ModelModalContent:** sprint1's rewritten content (AppOperations model card, API-mode tags, per-model configure, `model_settings` cleanup on delete) goes INSIDE the branch's directory layout, with the branch's additions (refresh token, `StudioMediaModelsSection`, description) appended.
- **Renamed process files:** apply sprint1's edits at the branch's new paths.

- [ ] **Step 4: Verify the two hazards explicitly**

```bash
grep -n "ContainedElectronHttpExecutor" packages/desktop/src/process/services/update/autoUpdaterService.ts
grep -n "disableDifferentialDownload" packages/desktop/src/process/services/update/autoUpdaterService.ts
grep -rn "AppOperationsModelCard\|appOperations" packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent/ | head
```

Expected: all present. If the updater greps fail, port sprint1's containment commits into the renamed file before continuing.

- [ ] **Step 5: Full baseline gate, then commit the merge**

```bash
bun install
bunx tsc --noEmit && bun run test
bun run i18n:types && node scripts/check-i18n.js
git commit  # merge commit; list the conflicted paths and resolution choices in the body
```

If stashed in Step 1: `git stash pop` afterwards.

---

### Task 2: Remove the exact-match timing gate — all five sites

The gate lives in five places across three files; removing only one produces an enabled button whose handlers still refuse.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx:341` (handler guard), `:362` (memo deps), `:370` (review-request guard), `:429` (effect deps), `:870-877` (props to GenerationControls)
- Modify: `packages/desktop/src/renderer/pages/studio/components/StudioHeader.tsx:71-84` (header blocker text/state)
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationControls.tsx` (`batchDisabled`/`batchDisabledReasonKey` props become `pacingDeltaSeconds`)
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json` (advisory keys; delete orphaned mismatch keys)
- Test: `tests/unit/pages/studio/StudioPage.dom.test.tsx`, `tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx`, `tests/unit/pages/studio/StudioHeader.dom.test.tsx`

- [ ] **Step 1: Enumerate the gate sites and their tests**

```bash
grep -rn "durationDelta" packages/desktop/src/renderer packages/desktop/tests tests/unit 2>/dev/null | grep -v studioReadiness
```

Every non-`studioReadiness` hit must be either removed (blocking logic) or converted (advisory display). List them before editing; existing specs asserting disabled-on-mismatch get inverted, not deleted.

- [ ] **Step 2: Write the failing tests**

In `GenerationControls.dom.test.tsx` (using the suite's `renderControls` helper and key-echo i18n mock):

```tsx
it('keeps batch render enabled when total duration differs from the goal', () => {
  renderControls({ batchSceneCount: 2, pacingDeltaSeconds: 3 });
  expect(screen.getByRole('button', { name: /generate/i })).not.toBeDisabled();
});

it('shows the pacing delta as a note, not a blocker', () => {
  renderControls({ batchSceneCount: 2, pacingDeltaSeconds: 3 });
  expect(screen.getByText('conversation.creativeStudio.generation.pacingOverGoal')).toBeInTheDocument();
});
```

In `StudioPage.dom.test.tsx`: a spec that, with scenes totalling 18s vs a 15s target, opening the batch review and submitting reaches the IPC bridge (assert the mocked `creative-studio.submit-scenes` binding is called — this pins the *handler* gates at :341/:370, not just the button).

In `StudioHeader.dom.test.tsx`: invert any mismatch-blocker spec — the header shows the ready-count status, not a timing blocker, when only the duration differs.

- [ ] **Step 3: Run to verify failures**

```bash
bun run test tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx tests/unit/pages/studio/StudioPage.dom.test.tsx tests/unit/pages/studio/StudioHeader.dom.test.tsx
```

- [ ] **Step 4: Implement**

`GenerationControls.tsx`: replace the `batchDisabled`/`batchDisabledReasonKey` prop pair with `pacingDeltaSeconds?: number`; the batch button's `disabled` drops the gate term:

```tsx
<Button disabled={disabled || batchSceneCount < 1 || catalogLoading} onClick={openBatchReview}>
```

and render the note when non-zero:

```tsx
{pacingDeltaSeconds !== undefined && pacingDeltaSeconds !== 0 && (
  <span className='text-t-secondary text-12px'>
    {t(pacingDeltaSeconds > 0
      ? 'conversation.creativeStudio.generation.pacingOverGoal'
      : 'conversation.creativeStudio.generation.pacingUnderGoal',
      { seconds: Math.abs(pacingDeltaSeconds) })}
  </span>
)}
```

`StudioPage.tsx`: delete the `durationDeltaSeconds !== 0` terms from the guards at :341 and :370 (and their memo/effect dep entries at :362/:429); pass `pacingDeltaSeconds={readiness?.durationDeltaSeconds ?? 0}` at :870.

`StudioHeader.tsx`: remove the mismatch condition from the blocker chain at :71-84 so the remaining statuses render one at a time.

- [ ] **Step 5: i18n** — add under `creativeStudio.generation` in en-US:

```json
"pacingOverGoal": "{{seconds}}s over your goal",
"pacingUnderGoal": "{{seconds}}s under your goal"
```

Translate in all 11 other locales (real translations). Delete the now-orphaned mismatch-blocker keys everywhere (find them via the Step 1 grep's key references).

- [ ] **Step 6: Gate + commit**

```bash
bun run test tests/unit/pages/studio/ && bunx tsc --noEmit
bun run i18n:types && node scripts/check-i18n.js && bun run lint:fix && bun run format
grep -rn "batchDisabledReasonKey\|durationDeltaSeconds !== 0" packages/desktop/src/renderer | grep -v studioReadiness   # expect: empty
git add packages/desktop/src/renderer/pages/studio/StudioPage.tsx \
        packages/desktop/src/renderer/pages/studio/components/StudioHeader.tsx \
        packages/desktop/src/renderer/pages/studio/components/Generation/GenerationControls.tsx \
        packages/desktop/src/renderer/services/i18n/locales tests/unit/pages/studio \
        packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
git commit -m "feat(studio): make the duration goal advisory instead of a generation gate"
```

---

### Task 3: `Fit to goal` — route-aware helper + atomic `retimeScenes` operation

Fit skips shots that already have a rendered take (retiming them would orphan paid takes), respects each shot's own route bounds, reports unreachable targets explicitly, and applies as ONE revision-guarded mutation via a new `retimeScenes` service op.

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/utils/fitDurationsToTarget.ts`
- Test: `tests/unit/pages/studio/fitDurationsToTarget.test.ts`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (request type), `packages/desktop/src/common/adapter/native/constants.ts` (channel key), `packages/desktop/src/common/adapter/native/payloadSchemas.ts` (schema), `packages/desktop/src/common/adapter/ipcBridge.ts` (binding), `packages/desktop/src/process/bridge/creativeStudioBridge.ts` (wiring), `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts` (op)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (button + handler)
- Test: `tests/unit/process/creative-studio/creativeStudioService.test.ts`, `tests/unit/process/bridge/nativePayloadSchemas.test.ts` (parity test updates itself via the manifest), `tests/unit/pages/studio/StudioPage.dom.test.tsx`

- [ ] **Step 1: Write the failing helper tests**

```ts
import { describe, expect, it } from 'vitest';
import { fitDurationsToTarget } from '@renderer/pages/studio/utils/fitDurationsToTarget';

const shot = (seconds: number, opts: Partial<{ min: number; max: number; locked: boolean }> = {}) => ({
  seconds, min: opts.min ?? 1, max: opts.max ?? 60, locked: opts.locked ?? false,
});

describe('fitDurationsToTarget', () => {
  it('redistributes unlocked shots proportionally to hit the target exactly', () => {
    const result = fitDurationsToTarget([shot(3), shot(5), shot(5), shot(5)], 15);
    expect(result.kind).toBe('fitted');
    if (result.kind === 'fitted') expect(result.durations.reduce((a, b) => a + b, 0)).toBe(15);
  });
  it('keeps locked (rendered) shots at their current duration', () => {
    const result = fitDurationsToTarget([shot(5, { locked: true }), shot(5), shot(5)], 12);
    expect(result).toMatchObject({ kind: 'fitted' });
    if (result.kind === 'fitted') {
      expect(result.durations[0]).toBe(5);
      expect(result.durations.reduce((a, b) => a + b, 0)).toBe(12);
    }
  });
  it('respects per-shot route bounds', () => {
    const result = fitDurationsToTarget([shot(10, { min: 4, max: 12 }), shot(10, { min: 2, max: 12 })], 8);
    expect(result.kind).toBe('fitted');
    if (result.kind === 'fitted') {
      expect(result.durations[0]).toBeGreaterThanOrEqual(4);
      expect(result.durations.reduce((a, b) => a + b, 0)).toBe(8);
    }
  });
  it('reports an unreachable target instead of silently approximating', () => {
    expect(fitDurationsToTarget([shot(5, { min: 3 }), shot(5, { min: 3 })], 4)).toEqual({ kind: 'unreachable' });
    expect(fitDurationsToTarget([shot(5, { locked: true }), shot(5, { min: 2 })], 4)).toEqual({ kind: 'unreachable' });
  });
  it('returns fitted with unchanged durations when already on target', () => {
    const result = fitDurationsToTarget([shot(5), shot(5), shot(5)], 15);
    expect(result).toEqual({ kind: 'fitted', durations: [5, 5, 5] });
  });
});
```

- [ ] **Step 2: Run to verify failure** — `bun run test tests/unit/pages/studio/fitDurationsToTarget.test.ts` → module not found.

- [ ] **Step 3: Implement the helper**

```ts
export type FitShot = { seconds: number; min: number; max: number; locked: boolean };
export type FitResult = { kind: 'fitted'; durations: number[] } | { kind: 'unreachable' };

/** Redistributes unlocked integer durations to make the total hit targetSeconds. Locked shots are untouched. */
export const fitDurationsToTarget = (shots: FitShot[], targetSeconds: number): FitResult => {
  const total = shots.reduce((a, s) => a + s.seconds, 0);
  if (total === targetSeconds) return { kind: 'fitted', durations: shots.map((s) => s.seconds) };

  const lockedTotal = shots.filter((s) => s.locked).reduce((a, s) => a + s.seconds, 0);
  const open = shots.map((s, i) => ({ ...s, i })).filter((s) => !s.locked);
  const openTarget = targetSeconds - lockedTotal;
  const minSum = open.reduce((a, s) => a + s.min, 0);
  const maxSum = open.reduce((a, s) => a + s.max, 0);
  if (open.length === 0 || openTarget < minSum || openTarget > maxSum) return { kind: 'unreachable' };

  const openTotal = open.reduce((a, s) => a + s.seconds, 0);
  const scaled = open.map((s) => (openTotal === 0 ? openTarget / open.length : (s.seconds * openTarget) / openTotal));
  const fitted = open.map((s, k) => Math.min(s.max, Math.max(s.min, Math.floor(scaled[k]))));
  let remainder = openTarget - fitted.reduce((a, b) => a + b, 0);
  const order = scaled
    .map((v, k) => ({ k, fraction: v - Math.floor(v) }))
    .sort((a, b) => b.fraction - a.fraction);
  let guard = open.reduce((a, s) => a + (s.max - s.min), 0) + 1;
  while (remainder !== 0 && guard-- > 0) {
    for (const { k } of order) {
      if (remainder > 0 && fitted[k] < open[k].max) { fitted[k] += 1; remainder -= 1; }
      else if (remainder < 0 && fitted[k] > open[k].min) { fitted[k] -= 1; remainder += 1; }
      if (remainder === 0) break;
    }
  }
  const durations = shots.map((s) => s.seconds);
  open.forEach((s, k) => { durations[s.i] = fitted[k]; });
  return { kind: 'fitted', durations };
};
```

- [ ] **Step 4: Run helper tests** — expected PASS (the feasibility check makes the fill loop guaranteed to converge).

- [ ] **Step 5: Add the `retimeScenes` operation (failing service test first)**

In `creativeStudioService.test.ts`, following the suite's existing mutation-test pattern:

```ts
it('retimes multiple scenes in one guarded mutation', async () => {
  const project = await seedProjectWithScenes([3, 5, 5]);
  const updated = await service.retimeScenes({
    projectId: project.id,
    expectedRevision: project.revision,
    changes: [
      { sceneId: project.sceneOrder[1], durationSeconds: 4 },
      { sceneId: project.sceneOrder[2], durationSeconds: 4 },
    ],
  });
  expect(updated.scenes[project.sceneOrder[1]].durationSeconds).toBe(4);
  expect(updated.scenes[project.sceneOrder[2]].durationSeconds).toBe(4);
});

it('rejects a retime against a stale revision', async () => {
  const project = await seedProjectWithScenes([3, 5]);
  await expect(service.retimeScenes({
    projectId: project.id,
    expectedRevision: project.revision - 1,
    changes: [{ sceneId: project.sceneOrder[0], durationSeconds: 2 }],
  })).rejects.toMatchObject({ code: 'revision_conflict' });
});
```

Implement in `creativeStudioService.ts` next to `updateModelSelection` — field-by-field, NOT via a spread (that bug class is documented):

```ts
async retimeScenes(input: StudioRetimeScenesRequest): Promise<StudioRendererProject> {
  return toRendererProject(await store.updateProject(input.projectId, (current) => {
    for (const change of input.changes) {
      const scene = current.scenes[change.sceneId];
      if (!scene) throw new CreativeStudioServiceError('invalid_payload');
      scene.durationSeconds = change.durationSeconds;
    }
    return current;
  }, input.expectedRevision));
}
```

(Adapt the wrapper/return conventions to the neighbouring methods — same error type, same renderer projection helper, same queue.)

- [ ] **Step 6: Wire the channel** — add `creative-studio.retime-scenes` to `NATIVE_BRIDGE_PROVIDER_KEYS` (constants.ts); add the strict schema (payloadSchemas.ts) mirroring the neighbouring scene schemas:

```ts
const studioRetimeScenesSchema = z.object({
  projectId: safeIdSchema,
  expectedRevision: z.number().int().nonnegative(),
  changes: z.array(z.object({
    sceneId: safeIdSchema,
    durationSeconds: z.number().int().min(1).max(60),
  })).min(1).max(24),
}).strict();
```

Add the request type to `creativeStudioTypes.ts`:

```ts
export type StudioRetimeScenesRequest = StudioProjectRequest & {
  expectedRevision: number;
  changes: Array<{ sceneId: string; durationSeconds: number }>;
};
```

Register the provider in `ipcBridge.ts` and the handler in `creativeStudioBridge.ts` exactly like the adjacent scene mutations. The `satisfies Record<NativeBridgeProviderKey, ...>` check and the manifest-parity test will fail compilation/tests until all pieces exist — that is the checklist.

- [ ] **Step 7: Renderer button** — beside the Task 2 pacing note in `StudioPage.tsx`:

```tsx
{(readiness?.durationDeltaSeconds ?? 0) !== 0 && (
  <Button size='mini' disabled={fitUnreachable} onClick={() => void handleFitToGoal()}>
    {t('conversation.creativeStudio.generation.fitToGoal', { seconds: project.targetDurationSeconds })}
  </Button>
)}
```

`handleFitToGoal` builds `FitShot[]` from ordered scenes — `locked: scene.selectedAssetId !== null`, `min`/`max` from the scene's route constraints (see Task 6's `routeBoundsForScene` helper; video routes for video scenes, image routes for stills; fall back to 1/60 when no route) — calls `fitDurationsToTarget`, and on `fitted` sends ONE `retimeScenes` IPC call with the changed scenes and current revision. On `unreachable`, the button is disabled with a tooltip key `fitToGoalUnreachable` ("Rendered shots hold {{seconds}}s — raise the goal or re-render"). On `revision_conflict`, surface the existing conflict recovery (same handling as other mutations in this page).

i18n keys: `fitToGoal: "Fit to {{seconds}}s"`, `fitToGoalUnreachable` (+ 11 translations each).

- [ ] **Step 8: DOM test** — with scenes [3,5,5,5], target 15, none rendered: clicking fit issues one `creative-studio.retime-scenes` bridge call whose durations sum to 15. With scene 1 rendered (selectedAssetId set): the call's changes exclude scene 1.

- [ ] **Step 9: Gate + commit (exact paths)**

```bash
bun run test tests/unit/pages/studio/ tests/unit/process/creative-studio/creativeStudioService.test.ts tests/unit/process/bridge/ && bunx tsc --noEmit
bun run i18n:types && node scripts/check-i18n.js && bun run lint:fix && bun run format
git add packages/desktop/src/renderer/pages/studio/utils/fitDurationsToTarget.ts \
        tests/unit/pages/studio/fitDurationsToTarget.test.ts \
        packages/desktop/src/common/types/project/creativeStudioTypes.ts \
        packages/desktop/src/common/adapter/native/constants.ts \
        packages/desktop/src/common/adapter/native/payloadSchemas.ts \
        packages/desktop/src/common/adapter/ipcBridge.ts \
        packages/desktop/src/process/bridge/creativeStudioBridge.ts \
        packages/desktop/src/process/services/creative-studio/creativeStudioService.ts \
        packages/desktop/src/renderer/pages/studio/StudioPage.tsx \
        packages/desktop/src/renderer/services/i18n/locales \
        packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts \
        tests/unit/process/creative-studio/creativeStudioService.test.ts \
        tests/unit/pages/studio/StudioPage.dom.test.tsx
git commit -m "feat(studio): add atomic route-aware Fit to goal retiming"
```

---

### Task 4: Cancellation as a per-job capability (`canCancel`)

The job's engine can differ from the project's current route, so the UI must not infer cancellability from the active catalog entry. Main computes it per job; the renderer only reads it.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts:1056` (entry gate) and the renderer-job projection (where `StudioRendererJob` is built — locate via `grep -n "StudioRendererJob" packages/desktop/src/process/services/creative-studio/*.ts`)
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (`StudioRendererJob` gains `canCancel: boolean`)
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationControls.tsx:490` (Cancel visibility)
- Test: `tests/unit/process/creative-studio/jobManager.test.ts`, `tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx`

- [ ] **Step 1: Write the failing jobManager tests** (adapt to the suite's fake-adapter and fake-timer helpers; the suite's existing "refuses cancellation for running jobs" spec at `jobManager.test.ts:1219` gets INVERTED for adapters with cancel support):

```ts
it('cancels a running remote job when the adapter supports cancellation', async () => {
  const job = await driveJobTo('running');           // suite helper
  fakeAdapter.cancel.mockResolvedValue({ kind: 'cancelled' });
  const cancelled = await manager.cancelJob({ projectId, jobId: job.id });
  expect(cancelled.status).toBe('cancelled');
});

it('still refuses when the adapter has no cancel', async () => {
  const job = await driveJobTo('running', { adapter: adapterWithoutCancel });
  await expect(manager.cancelJob({ projectId, jobId: job.id }))
    .rejects.toMatchObject({ code: 'cancellation_refused' });
});

it('exposes canCancel on renderer jobs from adapter support and status', async () => {
  const job = await driveJobTo('running');
  expect(rendererProjection(job).canCancel).toBe(true);
  const done = await driveJobTo('succeeded');
  expect(rendererProjection(done).canCancel).toBe(false);
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Entry gate** — jobManager.ts:1056, change:

```ts
if (current.status !== 'queued_remote' || !current.providerJobId) {
```

to:

```ts
if ((current.status !== 'queued_remote' && current.status !== 'running') || !current.providerJobId) {
```

(The downstream mutation already accepts `queued_remote | running`; adapters without `cancel` still throw `cancellation_refused` — including BytePlus once its provider refuses a running task, which surfaces as the same typed refusal.)

- [ ] **Step 4: `canCancel` projection** — in the renderer-job projection, compute:

```ts
canCancel:
  job.status === 'queued_local' ||
  (Boolean(adapterForJob(job)?.cancel) &&
    (job.status === 'queued_remote' || job.status === 'running') &&
    job.providerJobId !== null),
```

using whatever adapter-resolution helper the projection site already has access to (the runtime knows each job's adapter id; if the projection is a pure function without adapter access, pass a `supportsCancel: (job) => boolean` predicate in from the service that owns both). Add `canCancel: boolean` to `StudioRendererJob` and to its zod schema if the renderer projection is schema-checked.

- [ ] **Step 5: UI** — GenerationControls.tsx:490, the per-job Cancel renders only when `job.canCancel` — never a dead Cancel (prototype/degraded-states rule). DOM test: a running job with `canCancel: false` renders no Cancel button; with `true` it renders and fires `onCancelJob`.

- [ ] **Step 6: Gate + commit (exact paths: the four source files + two test files + types)**

```bash
bun run test tests/unit/process/creative-studio/jobManager.test.ts tests/unit/pages/studio/Generation/ && bunx tsc --noEmit && bun run lint:fix && bun run format
git add packages/desktop/src/process/services/creative-studio/jobManager.ts \
        packages/desktop/src/process/services/creative-studio/creativeStudioService.ts \
        packages/desktop/src/common/types/project/creativeStudioTypes.ts \
        packages/desktop/src/renderer/pages/studio/components/Generation/GenerationControls.tsx \
        tests/unit/process/creative-studio/jobManager.test.ts \
        tests/unit/pages/studio/Generation/GenerationControls.dom.test.tsx
git commit -m "fix(studio): allow cancelling running renders via a per-job capability"
```

---

### Task 5: Poll lifecycle — per-attempt timeout + overall deadline

Two bounds, because they fail differently: a *hung* poll call needs a per-attempt abort (a deadline checked between iterations never fires if `adapter.poll` never returns); a *lively but never-terminal* provider needs an overall deadline.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts:739-745` (`pollRemote`) and the constants block near `MAX_POLL_DELAY_MS`
- Modify: `packages/desktop/src/common/types/project/creativeStudioTypes.ts` (job error-code union gains `'poll_timeout'` — locate the union via `grep -n "submission_unknown" creativeStudioTypes.ts` and extend it; mirror in any zod schema for job errors)
- Modify: renderer error-key mapping (follow `submission_unknown`'s path to its i18n key) + locales
- Test: `tests/unit/process/creative-studio/jobManager.test.ts`

- [ ] **Step 1: Failing tests** (fake timers via the suite's injected `sleep` dep — deps already expose `sleep`/`jitterMs` at jobManager.ts:53-54, and the module has a `now()` in scope, used at :383/:885):

```ts
it('aborts a poll attempt that hangs longer than the attempt budget', async () => {
  fakeAdapter.poll.mockImplementation((_id, _p, signal) => neverResolves(signal)); // resolves only on abort
  const job = await submitAndReachRemote();
  await advanceThroughOneAttemptBudget();
  expect((await getJob(job.id)).status).toBe('needs_attention');
});

it('marks a never-terminal job needs_attention with poll_timeout after the overall deadline', async () => {
  fakeAdapter.poll.mockResolvedValue({ kind: 'running' });
  const job = await submitAndReachRemote();
  await advanceTimersBy(REMOTE_POLL_DEADLINE_MS + 60_000);
  const stored = await getJob(job.id);
  expect(stored.status).toBe('needs_attention');
  expect(stored.error?.code).toBe('poll_timeout');
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement** — constants:

```ts
const REMOTE_POLL_DEADLINE_MS = 30 * 60_000;
const POLL_ATTEMPT_TIMEOUT_MS = 60_000;
```

`pollRemote` loop (jobManager.ts:739): capture `const pollStartedAt = now();` before the loop; each iteration:

```ts
for (let attempt = 0; !signal.aborted; attempt += 1) {
  if (now() - pollStartedAt > REMOTE_POLL_DEADLINE_MS) {
    await transitionFailure(context.projectId, context.jobId, 'needs_attention', 'poll_timeout');
    return;
  }
  const baseDelay = pollBaseDelay(attempt);
  await sleep(Math.min(MAX_POLL_DELAY_MS, Math.max(0, jitterMs(baseDelay, attempt))), signal);
  const attemptSignal = AbortSignal.any([signal, AbortSignal.timeout(POLL_ATTEMPT_TIMEOUT_MS)]);
  const snapshot = await context.adapter.poll(providerJobId, context.provider, attemptSignal);
  if ((await handleRemoteSnapshot(context, snapshot, signal)) === 'terminal') return;
}
```

The timed-out attempt rejects (adapters honor their signal); the existing poll-error catch path already routes to `needs_attention` — verify which error code that path uses and keep it. Note for the fake-timer tests: `AbortSignal.timeout` uses real timers — if the suite runs fake timers, inject the attempt-signal factory through deps like `sleep` is (add `attemptSignal?: (parent: AbortSignal) => AbortSignal` to the deps type at :53 with the `AbortSignal.any` default) so tests can substitute it. `poll_timeout` preserves `providerJobId`, so `retryJob` and the existing needs-attention recovery still work — the provider may still be charging; this is "stop watching", not "declare failed".

- [ ] **Step 4: Error surface** — add `'poll_timeout'` to the job error-code union (+ schema); map it to a new key in the renderer's job-error message mapping: `pollTimeout: "The engine stopped reporting progress. Check with the provider or retry."` (+ 11 translations).

- [ ] **Step 5: Gate + commit (exact paths as in Task 4's pattern; include locale files and the error-mapping file).**

```bash
bun run test tests/unit/process/creative-studio/jobManager.test.ts && bunx tsc --noEmit
bun run i18n:types && node scripts/check-i18n.js && bun run lint:fix && bun run format
git commit -m "fix(studio): bound remote polling with attempt and overall deadlines"
```

---

### Task 6: Download budgets — stall watchdog + size-aware overall cap

Seedance supplies no output size, so size-scaling alone changes nothing in the worst case. Split the budget: an **idle watchdog** (no bytes for N seconds → abort) plus an **overall cap** scaled by size when known, with a generous video default when unknown.

**Files:**
- Modify: `packages/desktop/src/process/services/remote-media/remoteMediaDownloader.ts` (`:66` deps — new `idleTimeoutMs`; `:141` `request.setTimeout` uses it; `:422/:470` overall deadline unchanged mechanics)
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts:642-666` (output download call passes both budgets from `output.byteSize` and the job's mediaKind)
- Test: `tests/unit/process/remote-media/remoteMediaDownloader.test.ts`, `tests/unit/process/creative-studio/jobManager.test.ts`

- [ ] **Step 1: Failing tests**

Downloader (the suite already injects `setTimer` and fake requests):

```ts
it('aborts when the socket stalls longer than idleTimeoutMs even under a long overall budget', async () => {
  // fake request that sends headers then no body bytes
  await expect(download({ timeoutMs: 3_600_000, idleTimeoutMs: 5_000 })).rejects.toMatchObject({ code: 'remote_timeout' });
});
```

Budget helper:

```ts
import { resolveRemoteMediaBudget } from '@process/services/remote-media/remoteMediaDownloader';

describe('resolveRemoteMediaBudget', () => {
  it('scales the overall cap by declared size at the floor rate', () => {
    expect(resolveRemoteMediaBudget({ byteSize: 512 * 1024 * 1024, mediaKind: 'video' }).timeoutMs)
      .toBe(120_000 + 1_024_000);
  });
  it('uses a generous video default when size is unknown', () => {
    expect(resolveRemoteMediaBudget({ byteSize: null, mediaKind: 'video' }).timeoutMs).toBe(900_000);
  });
  it('keeps the base budget for images', () => {
    expect(resolveRemoteMediaBudget({ byteSize: null, mediaKind: 'image' }).timeoutMs).toBe(120_000);
  });
  it('caps at 30 minutes and always sets the idle watchdog', () => {
    const budget = resolveRemoteMediaBudget({ byteSize: Number.MAX_SAFE_INTEGER, mediaKind: 'video' });
    expect(budget.timeoutMs).toBe(1_800_000);
    expect(budget.idleTimeoutMs).toBe(120_000);
  });
});
```

- [ ] **Step 2: Run to verify failures.**

- [ ] **Step 3: Implement**

```ts
const REMOTE_MEDIA_MIN_RATE_BYTES_PER_SEC = 512 * 1024;
const REMOTE_MEDIA_MAX_TIMEOUT_MS = 30 * 60_000;
const REMOTE_MEDIA_VIDEO_DEFAULT_TIMEOUT_MS = 15 * 60_000;
const REMOTE_MEDIA_IDLE_TIMEOUT_MS = 120_000;

export type RemoteMediaBudget = { timeoutMs: number; idleTimeoutMs: number };

/** Overall cap scales with declared size; unknown-size videos get a generous default; idle watchdog catches stalls. */
export const resolveRemoteMediaBudget = (input: { byteSize: number | null; mediaKind: 'image' | 'video' }): RemoteMediaBudget => {
  const idleTimeoutMs = REMOTE_MEDIA_IDLE_TIMEOUT_MS;
  if (input.byteSize !== null && Number.isFinite(input.byteSize) && input.byteSize > 0) {
    const transferMs = Math.ceil(input.byteSize / REMOTE_MEDIA_MIN_RATE_BYTES_PER_SEC) * 1000;
    return { timeoutMs: Math.min(REMOTE_MEDIA_MAX_TIMEOUT_MS, REMOTE_MEDIA_DEFAULT_TIMEOUT_MS + transferMs), idleTimeoutMs };
  }
  return {
    timeoutMs: input.mediaKind === 'video' ? REMOTE_MEDIA_VIDEO_DEFAULT_TIMEOUT_MS : REMOTE_MEDIA_DEFAULT_TIMEOUT_MS,
    idleTimeoutMs,
  };
};
```

Deps gain `idleTimeoutMs?: number`; the `request.setTimeout(...)` at :141 switches from the overall `timeoutMs` to `idleTimeoutMs ?? timeoutMs` (socket idle semantics — resets on activity, which is exactly the watchdog). The overall deadline at :422/:470 keeps using `timeoutMs`.

`jobManager.ts:642-666`: the output download call passes `...resolveRemoteMediaBudget({ byteSize: output.byteSize ?? null, mediaKind: job.mediaKind })` (adapter outputs carry optional `byteSize` — adapters/types.ts:63; `declaredByteSize` is the *store-plan* field, a different layer — don't conflate them). `retryDownload` flows through the same call site, so retries inherit the budgets.

- [ ] **Step 4: Gate + commit (exact paths: the two source files + two test files).**

```bash
bun run test tests/unit/process/remote-media/ tests/unit/process/creative-studio/jobManager.test.ts && bunx tsc --noEmit && bun run lint:fix && bun run format
git commit -m "fix(studio): split download budgets into stall watchdog and size-aware cap"
```

---### Task 7: Duration stepper bound by the shot's own route

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/utils/routeBoundsForScene.ts`
- Test: `tests/unit/pages/studio/routeBoundsForScene.test.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/components/Storyboard/SceneInspector.tsx:181-193` (InputNumber → bounded stepper)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (resolve bounds per selected scene, pass down)
- Test: `tests/unit/pages/studio/Storyboard/SceneInspector.dom.test.tsx`

- [ ] **Step 1: Failing helper test**

```ts
import { routeBoundsForScene } from '@renderer/pages/studio/utils/routeBoundsForScene';

it('uses the video route constraints for video scenes', () => {
  expect(routeBoundsForScene({ mediaKind: 'video' }, catalogWith({ video: { minDurationSeconds: 4, maxDurationSeconds: 12 } })))
    .toEqual({ min: 4, max: 12 });
});
it('uses the image route constraints for stills', () => {
  expect(routeBoundsForScene({ mediaKind: 'image' }, catalogWith({ image: { minDurationSeconds: 1, maxDurationSeconds: 60 } })))
    .toEqual({ min: 1, max: 60 });
});
it('falls back to schema bounds when the scene has no configured route', () => {
  expect(routeBoundsForScene({ mediaKind: 'video' }, emptyCatalog())).toEqual({ min: 1, max: 60 });
});
```

(Shape the `catalogWith` fixture on the real `useStudioModels` catalog entry type — routes carry `constraints: StudioRouteConstraints` with **required** `minDurationSeconds`/`maxDurationSeconds`; creativeStudioTypes.ts:249,266-267. Not `capabilities` — that's the connection-level object.)

- [ ] **Step 2: Implement**

```ts
import type { StudioMediaKind } from '@/common/types/project/creativeStudioTypes';

export type DurationBounds = { min: number; max: number };
const SCHEMA_BOUNDS: DurationBounds = { min: 1, max: 60 };

export const routeBoundsForScene = (
  scene: { mediaKind: StudioMediaKind },
  routes: { image?: { constraints?: { minDurationSeconds: number; maxDurationSeconds: number } } | null;
            video?: { constraints?: { minDurationSeconds: number; maxDurationSeconds: number } } | null }
): DurationBounds => {
  const route = scene.mediaKind === 'video' ? routes.video : routes.image;
  if (!route?.constraints) return SCHEMA_BOUNDS;
  return {
    min: Math.max(SCHEMA_BOUNDS.min, route.constraints.minDurationSeconds),
    max: Math.min(SCHEMA_BOUNDS.max, route.constraints.maxDurationSeconds),
  };
};
```

(Adapt the `routes` parameter type to the actual catalog entry type exported from `useStudioModels` — import it rather than re-declaring if it exists.)

- [ ] **Step 3: Stepper** — `SceneInspector` gains `durationBounds: DurationBounds`; the InputNumber at :181 becomes:

```tsx
<InputNumber
  id={durationId}
  aria-label={t('conversation.creativeStudio.inspector.durationLabel')}
  mode='button'
  min={durationBounds.min}
  max={durationBounds.max}
  step={1}
  precision={0}
  value={sceneDraft.durationSeconds}
  ...
/>
```

Keep the existing `durationInvalid` handling for out-of-bounds drafts loaded from disk. `StudioPage.tsx` computes `routeBoundsForScene(selectedScene, studioModels.catalogRoutes)` for the selected scene and passes it down. DOM test: with a video route max of 12, the stepper's max is 12 (assert via Arco's rendered attributes or by stepping past it).

- [ ] **Step 4: Gate + commit (exact paths).**

```bash
bun run test tests/unit/pages/studio/ && bunx tsc --noEmit && bun run lint:fix && bun run format
git commit -m "feat(studio): bound the shot duration stepper by its route constraints"
```

---

### Task 8: Copy — concatenation and plural fixes across locales

Defect classes: `Generate 1 ready scenes` (no plural), `Scene 1hello` (fragment gluing), `hello15 seconds` (concatenation). Russian and Ukrainian require `_one/_few/_many` forms — `_one/_other` is not enough. **No vocabulary rename in this task.**

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/**` call sites (enumerated in Step 1)
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/conversation.json`
- Test: `tests/unit/pages/studio/studioI18n.test.ts` (behavior tests through a real i18next instance)

- [ ] **Step 1: Enumerate offenders** — all three composition styles, not just `+`:

```bash
grep -rn "t(.*) *+ \|+ *t(" packages/desktop/src/renderer/pages/studio --include='*.tsx' --include='*.ts' | grep -v test
grep -rn '\${t(' packages/desktop/src/renderer/pages/studio --include='*.tsx' --include='*.ts' | grep -v test
grep -rn "{t('.*')}{" packages/desktop/src/renderer/pages/studio --include='*.tsx' | grep -v test
```

Also review JSX where `{t(...)}` is followed by a sibling expression node in the same text run (the third grep is a heuristic — eyeball the hits). List every offender before editing.

- [ ] **Step 2: Failing behavior tests** — in `studioI18n.test.ts`, build a real i18next instance per locale from the actual JSON files (the suite already loads locale JSON for its key checks):

```ts
it.each([
  ['en-US', 1, 'Generate 1 ready scene'],
  ['en-US', 2, 'Generate 2 ready scenes'],
  ['ru-RU', 1, undefined], ['ru-RU', 2, undefined], ['ru-RU', 5, undefined],
])('pluralizes generateReady for %s count %i', async (locale, count, exact) => {
  const t = await makeT(locale); // real i18next init with the locale's conversation.json
  const result = t('creativeStudio.generation.generateReady', { count });
  expect(result).not.toMatch(/\d+ ready scenes?$/u.test(result) || locale !== 'en-US' ? /^creativeStudio/ : /never/); // key must resolve
  if (exact) expect(result).toBe(exact);
  expect(result).toContain(String(count));
});
```

(Shape the helper on the suite's existing i18next usage; the essential assertions: the key resolves in every configured locale, counts 1/2/5 produce distinct correct forms in ru-RU/uk-UA, and no resolved string is the raw key.)

- [ ] **Step 3: Fix call sites and keys** — one full-sentence key per visible string, interpolation for variables, `count` for plurals:

```json
// en-US
"generateReady_one": "Generate {{count}} ready scene",
"generateReady_other": "Generate {{count}} ready scenes"
```

```json
// ru-RU (translator-provided; forms _one/_few/_many/_other as CLDR requires)
"generateReady_one": "…", "generateReady_few": "…", "generateReady_many": "…", "generateReady_other": "…"
```

uk-UA the same four forms; ja-JP/ko-KR/zh-CN/zh-TW need only the base key (single CLDR form) — follow `node scripts/check-i18n.js` output for what each locale requires. Fragment keys that only existed to be glued together get deleted after their call sites are folded into sentence keys.

- [ ] **Step 4: Gate + commit (exact paths: touched components, locale files, i18n-keys.d.ts, the test file).**

```bash
bun run test tests/unit/pages/studio/ && bun run i18n:types && node scripts/check-i18n.js && bunx tsc --noEmit && bun run lint:fix && bun run format
git commit -m "fix(studio): replace string concatenation with interpolated plural i18n keys"
```

---

## Final verification (whole tier)

- [ ] `bun run test` — full suite green on a quiet machine.
- [ ] `bunx tsc --noEmit`, `bun run lint:fix`, `bun run format`, `node scripts/check-i18n.js` — green.
- [ ] Manual smoke in dev: total ≠ target → batch renders with an advisory note; `Fit to goal` lands exactly on target and skips rendered shots; unreachable target disables the button with the tooltip; cancel a running render on a cancel-capable fake adapter; no Cancel on a capability-less job; stepper clamps to the route's min/max.
- [ ] Do NOT push — `just push` only when explicitly asked. Keep tasks as separate commits/MRs.

## Self-review notes

- The removed "auto-select newest take" task stays removed — `commitProviderJobAsset` already selects atomically; re-adding it is the tell that this plan was executed without reading it.
- Anchors re-verified 2026-08-03 evening: gate sites (StudioPage 341/362/370/429/870-872, StudioHeader 71-84), cancel entry gate (jobManager 1056), poll loop (739-745), deps (`sleep`/`jitterMs` at 53-54, module `now()`), downloader idle vs overall (141 vs 422/470), adapter output `byteSize` (adapters/types.ts:63), route `constraints` (creativeStudioTypes 249/266-267). Task 1's merge will shift line numbers — re-locate by symbol, not line.
- Type consistency: `pacingDeltaSeconds` (T2) feeds T3's button condition; `FitShot`/`FitResult` (T3) match the DOM-test usage; `resolveRemoteMediaBudget` (T6) is the only budget entry point; `DurationBounds` (T7) is produced by `routeBoundsForScene` and consumed by `SceneInspector`.
