# Creative Studio — Stream 2: Navigation & Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retire the navigation lock's three known silent-blocking defects by making navigation *safe* instead of *blocked*, and close the standing main-process hardening items from the MVP/phase-shell reviews that the UI-fidelity stream does not touch.

**Architecture:** The navigation fix inverts the approach: instead of fighting HashRouter for control of history (provably unwinnable — window popstate listeners fire in registration order), drafts become durable across unmount (session-scoped persistence + restore), the window-close path becomes an explicit main-process handshake with a native dialog, and every remaining block gets visible UI. The hardening tasks are surgical main-process changes with tests.

**Tech stack:** Electron (main + renderer), React + Arco, react-i18next (12 locales), Vitest 4.

**Working directory:** `/Users/lap16603/Documents/WePrompt/.worktrees/creative-studio-phase-shell` (branch `codex/studio-phase-shell`).

**Ground rules:** stage exact paths, never `git add -A`; full gate before each commit (`bunx tsc --noEmit && bun run test <touched suites>` + `bun run i18n:types && node scripts/check-i18n.js` when locales change + `bun run lint:fix && bun run format` before a task's final commit); do not push unless asked; tasks are independently mergeable commits.

**Coordination with the UI-fidelity stream:** Tasks 2–7 touch disjoint files and can run in parallel worktrees immediately. **Task 1 touches `StudioPage.tsx` and `useStoryboardEditor.ts`, which UI-stream Task 3 also rewrites — land Task 1 AFTER UI Task 3 merges (or give both to one owner).** Line anchors below are from the 2026-08-04 review of `8c937af3f`; re-locate by symbol after merges.

---

### Task 1: Navigation safety — draft persistence, visible blocks, close handshake

Replaces `StudioNavigationLock` entirely. Three defects to retire (review findings): history-back destroys a failed save's renderer-only drafts; non-rail navigation is silently no-op'd; `beforeunload` silently prevents Electron window close whenever `navigationLocked` — which today includes merely having a modal open.

**Files:**
- Delete: `packages/desktop/src/renderer/pages/studio/components/StudioNavigationLock.tsx` (+ its dom test)
- Create: `packages/desktop/src/renderer/pages/studio/hooks/useDraftPersistence.ts`
- Modify: `packages/desktop/src/renderer/pages/studio/hooks/useStoryboardEditor.ts` (draft snapshot/restore hooks), `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (`navigationLocked` expression at ~:709-737, lock render at ~:839), `packages/desktop/src/index.ts` (window `close` handler), `packages/desktop/src/process/bridge/creativeStudioBridge.ts` or the window-lifecycle bridge (one new query channel), `packages/desktop/src/common/adapter/native/constants.ts` + `payloadSchemas.ts` (channel + schema)
- Test: `tests/unit/pages/studio/hooks/useDraftPersistence.dom.test.ts`, `useStoryboardEditor.dom.test.ts` additions, `tests/unit/process/bridge/` for the new channel

- [ ] **Step 1: Write the failing draft-persistence tests**

```ts
it('restores unsaved drafts after unmount and remount of the same project', async () => {
  const first = renderEditor({ projectId });
  await first.typeIntoScene(sceneId, 'narration', 'half-typed thought');
  first.unmount();                              // simulates history-back unmounting the shell
  const second = renderEditor({ projectId });
  expect(second.sceneDraft(sceneId).narration).toBe('half-typed thought');
  expect(second.sceneDirty(sceneId)).toBe(true); // restored as dirty, save machinery re-engages
});

it('drops persisted drafts once the scene saves cleanly', async () => {
  const editor = renderEditor({ projectId });
  await editor.typeIntoScene(sceneId, 'narration', 'text');
  await editor.flushAll();
  expect(sessionStorage.getItem(draftKey(projectId))).toBeNull();
});

it('ignores persisted drafts from a stale revision after a conflict', async () => {
  seedPersistedDraft(projectId, { revision: 3 });
  const editor = renderEditor({ projectId, projectRevision: 7 });
  expect(editor.sceneDirty(sceneId)).toBe(false); // stale snapshot discarded, surfaced as info not applied
});
```

(Build on the suite's existing `renderEditor`/fake-IPC helpers. jsdom gotcha from project memory: do not `vi.spyOn(window.sessionStorage, ...)` — Storage is a Proxy and spies silently no-op; assert through real storage contents or mock the module via `vi.hoisted`.)

- [ ] **Step 2: Implement `useDraftPersistence`** — a small hook the editor calls with `(projectId, dirtyDrafts, projectRevision)`:

```ts
const draftKey = (projectId: string) => `weprompt.studio.drafts.${projectId}`;

export type PersistedDrafts = { revision: number; scenes: Record<string, Partial<StudioSceneDraftFields>> };

export const persistDrafts = (projectId: string, revision: number, scenes: PersistedDrafts['scenes']): void => {
  if (Object.keys(scenes).length === 0) { sessionStorage.removeItem(draftKey(projectId)); return; }
  sessionStorage.setItem(draftKey(projectId), JSON.stringify({ revision, scenes } satisfies PersistedDrafts));
};

export const takePersistedDrafts = (projectId: string, currentRevision: number): PersistedDrafts['scenes'] | null => {
  const raw = sessionStorage.getItem(draftKey(projectId));
  sessionStorage.removeItem(draftKey(projectId));
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedDrafts;
    return parsed.revision === currentRevision ? parsed.scenes : null;
  } catch {
    return null;
  }
};
```

Editor integration: write-through on every draft change (the dirty-map already exists — serialize only dirty fields), clear on clean flush, restore-on-mount before the first render of rows (`useStoryboardEditor` init), marking restored fields dirty so the existing autosave/flush machinery takes over. Session-scoped (`sessionStorage`) is deliberate: survives in-app navigation and reload, not app restarts — recovery across restarts is the store's job, not the draft layer's.

- [ ] **Step 3: Delete the lock; make remaining blocks visible.** Remove `<StudioNavigationLock …>` from StudioPage and delete the component. Navigation away is now always allowed (drafts survive via Step 2). Narrow what used to be `navigationLocked`: open modals and the 450ms debounce no longer factor anywhere; in-flight mutations don't block navigation either (they complete against the store regardless of what screen is showing — verify with the existing serialized-queue tests). The phase rail keeps its save-then-navigate flow from the UI stream.

- [ ] **Step 4: Window-close handshake (failing test first).** New query channel `creative-studio.has-unsaved-work` (strict schema, no payload → `{ dirtySceneCount: number }` from the renderer's dirty map — renderer answers, main asks):

Main (`index.ts` window close handler):

```ts
let closeConfirmed = false;
mainWindow.on('close', (event) => {
  if (closeConfirmed || !studioRendererMounted()) return;
  event.preventDefault();
  void (async () => {
    const { dirtySceneCount } = await askRenderer(mainWindow, 'creative-studio.has-unsaved-work');
    if (dirtySceneCount === 0) { closeConfirmed = true; mainWindow.close(); return; }
    const choice = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: [t('studio.close.saveAndClose'), t('studio.close.discard'), t('studio.close.cancel')],
      defaultId: 0, cancelId: 2,
      message: t('studio.close.unsavedMessage', { count: dirtySceneCount }),
    });
    if (choice.response === 2) return;
    if (choice.response === 0) await askRenderer(mainWindow, 'creative-studio.flush-unsaved-work');
    closeConfirmed = true;
    mainWindow.close();
  })();
});
```

(Adapt to the codebase's actual main↔renderer query mechanism and i18n access in main — follow whatever the existing quit-cleanup/dialog code uses; the two channels are renderer-answered queries, so wire them through the same envelope the bridge already validates. `beforeunload` in the renderer goes away entirely.) Add a 3-second timeout on the renderer query — an unresponsive renderer must never make the window unclosable; on timeout, show the discard/cancel dialog without the save option.

- [ ] **Step 5: Tests** — bridge test for the two channels (schema parity test updates via the manifest `satisfies`); dom test that a dirty editor answers the query with the right count and that `flush-unsaved-work` drains the queue; the three Step-1 persistence tests green.

- [ ] **Step 6: i18n** (close-dialog strings ×12 locales, ru/uk plural forms for the count), gate, commit —

```bash
git commit -m "feat(studio): replace the navigation lock with durable drafts and a close handshake"
```

---

### Task 2: `updateProject` whitelist

The service's one raw spread (`const { projectId, expectedRevision, ...update } = input` then `{ ...project, ...update }`, `creativeStudioService.ts` ~:897) lets any schema-passing request key into the persisted project — the MVP review's #1 finding, and the write path the Later-tier assistant proposals would inherit.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`
- Test: `tests/unit/process/creative-studio/creativeStudioService.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it('applies only whitelisted fields from updateProject', async () => {
  const project = await seedProject();
  const updated = await service.updateProject({
    projectId: project.id, expectedRevision: project.revision,
    name: 'renamed',
    routing: { storyboard: null, image: { providerId: 'p1', adapterId: 'a', model: 'm' }, video: null },
  } as never);
  expect(updated.name).toBe('renamed');
  expect(updated.routing).toEqual(project.routing); // routing only changes via updateModelSelection
});

it('never persists unknown top-level keys', async () => {
  const project = await seedProject();
  await service.updateProject({ projectId: project.id, expectedRevision: project.revision, name: 'x', providerMetadata: { junk: true } } as never);
  const raw = await readRawProjectFile(project.id); // suite helper reads project.json
  expect(raw).not.toHaveProperty('providerMetadata');
});
```

(The zod layer may already reject the second case at the bridge — these tests pin the SERVICE contract so the protection doesn't depend on every future caller going through the bridge.)

- [ ] **Step 2: Implement** — replace the spread with an explicit field map:

```ts
const UPDATABLE_PROJECT_FIELDS = ['name', 'description', 'targetDurationSeconds', 'aspectRatio'] as const;

async updateProject(input: StudioUpdateProjectRequest): Promise<StudioRendererProject> {
  return toRendererProject(await store.updateProject(input.projectId, (project) => {
    for (const field of UPDATABLE_PROJECT_FIELDS) {
      if (input[field] !== undefined) (project as Record<string, unknown>)[field] = input[field];
    }
    return project;
  }, input.expectedRevision));
}
```

(Match the exact updatable set to the current zod schema for this request — enumerate it from `payloadSchemas.ts` rather than guessing; routing/scenes/jobs/assets/connections must NOT be in the list, each has its dedicated op.)

- [ ] **Step 3: Gate + commit** — `git commit -m "fix(studio): whitelist updateProject fields instead of spreading the request"`

---

### Task 3: Store durability — fsync + per-project quarantine

> **AMENDMENT (2026-08-04, applied during execution):** `listProjects()` **keeps** its existing `Promise<StudioProjectSummary[]>` contract — do not change it to `{projects, quarantined}` (that would ripple through every consumer and DTO). Corrupt manifests are skipped via `Promise.allSettled` and logged; quarantined ids are exposed through a new `listQuarantinedProjectIds(): Promise<string[]>` sharing the same internal sweep. UI surfacing of the quarantine count is deferred. fsync requirement unchanged.


One power-loss-truncated `project.json` currently blanks the entire library (`writeJsonAtomic` has no fsync, `store.ts` ~:805; `readAllProjects` is a fail-loud `Promise.all`, ~:851).

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/store.ts` (+ the listing DTO if quarantine is surfaced), renderer library empty-state copy if surfaced
- Test: `tests/unit/process/creative-studio/store.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it('lists healthy projects even when one manifest is corrupt', async () => {
  await seedProjects(['a', 'b', 'c']);
  await fs.writeFile(manifestPath('b'), '{ truncated');
  const listing = await store.listProjects();
  expect(listing.projects.map((p) => p.id).sort()).toEqual(['a', 'c']);
  expect(listing.quarantined).toEqual(['b']);
});

it('fsyncs the temp file before rename', async () => {
  const fsyncSpy = trackFsync(); // suite injects fs deps; count fsync on the temp fd and the directory fd
  await store.updateProject('a', (p) => p);
  expect(fsyncSpy.fileSyncs).toBeGreaterThan(0);
  expect(fsyncSpy.dirSyncs).toBeGreaterThan(0);
});
```

(The store suite runs against the real filesystem with injected fs where needed — follow its existing injection pattern; if fs isn't injectable today, add the seam in this task.)

- [ ] **Step 2: Implement** — in `writeJsonAtomic`: open the temp file, write, `fh.sync()`, close, `rename`, then `open(dir)` + `dirHandle.sync()` + close. In `readAllProjects`: `Promise.allSettled`; rejected manifests go to a `quarantined: string[]` on the listing result (existing fail-loud single-project `getProject` behavior unchanged — quarantine is for the *listing* blast radius only). Log each quarantined id with the parse error. Surfacing in the library UI is a one-line count ("1 project couldn't be read") — keep minimal.

- [ ] **Step 3: Gate + commit** — `git commit -m "fix(studio): fsync atomic writes and quarantine corrupt manifests in listings"`

---

### Task 4: `validateConnection` deadline

The service calls `adapter.validateConnection(..., new AbortController().signal)` with a discarded controller and no timeout (`creativeStudioService.ts` ~:685) — a gateway that accepts TCP and never responds pins the settings spinner forever. The deadline helper already exists (`runWithProviderDeadline`, `adapters/types.ts:131` — used by polling since the Now tier).

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/creativeStudioService.ts`
- Test: `tests/unit/process/creative-studio/creativeStudioService.test.ts`

- [ ] **Step 1: Failing test** — a fake adapter whose `validateConnection` never resolves: `saveConnection`/`validateConnection` rejects with the typed timeout error after the deadline (fake timers through the existing deps seam).
- [ ] **Step 2: Implement** — wrap the call in `runWithProviderDeadline` with a 30s budget and a real controller aborted on timeout; map the deadline rejection to the existing validation-failure error surface (the settings UI already renders it — no new i18n needed unless a distinct "timed out" message is wanted; add `settings.mediaModels.validationTimeout` ×12 locales, since "Connection validation failed" for a timeout was already flagged as misleading).
- [ ] **Step 3: Gate + commit** — `git commit -m "fix(studio): bound connection validation with the provider deadline"`

---

### Task 5: Provider-row skew hardening

`provider.api_key.trim()` assumes presence (`providerResolver.ts` ~:79, also the service's catalog path ~:233); this repo has a documented aioncore version-skew class where typed-required fields arrive absent — one skewed row currently throws and kills every route/catalog listing.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/providerResolver.ts` (+ the service catalog site)
- Test: `tests/unit/process/creative-studio/providerResolver.test.ts`

- [ ] **Step 1: Failing test** — provider list containing one row with `api_key: undefined` (cast past the type, simulating skew): `available()`/route listing returns the healthy rows and skips the skewed one; nothing throws.
- [ ] **Step 2: Implement** — normalize at the boundary: `const apiKey = typeof provider.api_key === 'string' ? provider.api_key.trim() : '';` and treat empty as not-configured (existing path). Apply the same guard to any sibling field read the same way (`base_url`) — enumerate with `grep -n "provider\.\(api_key\|base_url\)" packages/desktop/src/process/services/creative-studio/*.ts`.
- [ ] **Step 3: Gate + commit** — `git commit -m "fix(studio): tolerate skewed provider rows in route resolution"`

---

### Task 6: Single source of truth for `canCancelJob`

The predicate is duplicated in `creativeStudioService.ts` ~:435 and `jobManager.ts` ~:332 (identical today; silent desync would make the DTO's `canCancel` lie about the manager's actual entry gate).

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/jobManager.ts` (export the predicate), `creativeStudioService.ts` (consume it)
- Test: `tests/unit/process/creative-studio/creativeStudioService.test.ts`

- [ ] **Step 1: Failing test** — a table-driven spec asserting `toRendererJob(job).canCancel === jobManager.canCancelJob(job)` across the status × policy matrix (reuse the manager suite's matrix fixtures).
- [ ] **Step 2: Implement** — export `canCancelJob` from jobManager (or a shared module if import direction forbids), delete the service copy, consume the export.
- [ ] **Step 3: Gate + commit** — `git commit -m "refactor(studio): single canCancelJob predicate shared by manager and DTO"`

---

### Task 7: Consistency sweep (review leftovers)

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/studioReadiness.ts` (or `ReviewCut.tsx` mapping), `StudioPage.tsx` (~:808, ~:878), `packages/desktop/src/process/services/creative-studio/mediaStore.ts` (~:1215 export naming)
- Test: mirror suites

- [ ] **Step 1: Review-phase status precedence.** In Review only, a scene whose selected take is in the cut displays as in-cut even while another variation renders (today `generating` wins and the filmstrip contradicts the handoff count). Implement as a display mapping in `ReviewCut` (readiness derivation itself stays untouched — Produce should keep showing `generating`). Test: scene with `selectedAssetId` + one running job → filmstrip badge `In cut`, handoff count unchanged.
- [ ] **Step 2: Export slugs.** `scene-01-cold-open.mp4`: slugify the scene title (lowercase, ascii-fold, `[^a-z0-9]+ → -`, trim, cap ~40 chars, empty title → number only). Numbering by `sceneOrder` index stays (holes stay honest). Test: unicode title, empty title, collision of identical titles (numbers already disambiguate).
- [ ] **Step 3: Defensive lookups.** Replace `project.scenes[sceneId]!` (`StudioPage.tsx:878`) and `readiness: readiness!` (:808) with the codebase's canonical guarded patterns (skip missing ids, early-return null) — degrade, don't crash, matching `canonicalScenes` everywhere else.
- [ ] **Step 4: Gate + commit** — `git commit -m "fix(studio): review status precedence, export slugs, defensive scene lookups"`

---

## Final verification (whole stream)

- [ ] `bun run test` full suite on a quiet machine; `bunx tsc --noEmit`; `check-i18n`; lint/format.
- [ ] Manual smoke: type into a scene → press the browser/mouse back button → return to the project → the half-typed text is still there and saves. Close the window with unsaved edits → native three-button dialog; "Save and close" persists (verify by reopening); an unresponsive renderer can't wedge the close (kill the renderer's event loop in devtools and close). Corrupt one dev project.json manually → library lists the rest + shows the quarantine count.
- [ ] Confirm no `beforeunload` remains: `grep -rn "beforeunload" packages/desktop/src/renderer/pages/studio` → empty.
- [ ] Do NOT push; separate commits/MRs per task.

## Self-review notes

- Task 1 is the only task with UI-stream file overlap (`StudioPage.tsx`, `useStoryboardEditor.ts`) — sequence it after UI Task 3, per the coordination note. Tasks 2–7 are disjoint from the UI stream and from each other except Tasks 2/4/5 sharing `creativeStudioService.ts` (merge-trivial, different methods).
- The draft-persistence design deliberately does NOT try to block history navigation — that fight was lost twice (MVP + phase-shell). Durable drafts + visible dialogs is the whole strategy; if product later wants a confirm-before-back, it requires migrating to a data router (`createHashRouter`) and is out of scope here.
- Type/name consistency: `PersistedDrafts` (T1) is renderer-only; `canCancelJob` (T6) keeps the jobManager's existing name; `quarantined` (T3) is additive to the listing DTO and needs its zod schema updated in the same commit.
