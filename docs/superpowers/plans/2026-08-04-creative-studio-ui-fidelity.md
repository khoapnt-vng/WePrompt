# Creative Studio — UI Fidelity Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the four Studio phases' presentation and add the library home to match the approved prototype ("Creative Studio - Prototype with project list.html", 2026-08-04), keeping the shipped behavior layer (hooks, controllers, services) intact, and folding in the four behavior fixes that touch the same surfaces.

**Architecture:** Presentation-only rebuild over existing controllers (`useStudioProject`, `useStoryboardEditor`, `useStudioJobs`, `useStudioModels`, phase controllers in `PhaseShell/types.ts`). One main-process performance fix (media verification cache — a hard prerequisite for library thumbnails) and one main-process deletion (the `timing_mismatch` enforcement). Each task is independently mergeable behind the existing `/studio/:id/:phase?` routes.

**Product decisions (2026-08-04, user):**
1. **The composer stores the raw sentence** — no structured brief card fields (audience/message/tone/placement) in this stream. The sentence lands in the existing `project.description`-equivalent intent field; no schema change.
2. **Brief remains a phase** (rail stays four steps). Keep it simple now — the existing form fields, restyled into one card with one CTA — improve later.

**Tech stack:** Electron, React + Arco + UnoCSS (semantic tokens only), react-i18next (12 locales; ru/uk need `_one/_few/_many/_other`), Vitest 4.

**Working directory:** `/Users/lap16603/Documents/WePrompt/.worktrees/creative-studio-phase-shell` (branch `codex/studio-phase-shell`).

**Ground rules (every task):** stage exact paths, never `git add -A`; full gate before each commit (`bunx tsc --noEmit && bun run test <touched suites>`, plus `bun run i18n:types && node scripts/check-i18n.js` when locales change, plus `bun run lint:fix && bun run format` before the final commit of a task); the visual source of truth is the prototype file — when a layout question isn't answered there, check the redesign standalone file, then ask, never invent; no vocabulary rename (scene/variation stay); do not push unless asked.

**Out of scope:** navigation-lock rework (separate stream), assistant thread/proposals, pricing/ledger UI (contract-blocked), stitched draft / share link (cut).

---

### Task 1: Media verification cache (prerequisite for thumbnails and playback)

> **AMENDMENT (2026-08-04, applied during execution):** Task 1's cache needs **no** `dispose()` hook and **no** delete-site invalidation — the stat (size+mtime) check makes entries self-validating, and a deleted file fails its own stat path. Invalidate only inside mediaStore's own finalize paths, and bound the map at 256 entries with oldest-insertion eviction. `runtime.ts` must not be touched. (Original spec referenced hooks that do not exist on `StudioMediaStore`.)


Today every `weprompt-studio:` range request runs TWO full-file SHA-256 passes (`resolveAsset` at `mediaStore.ts:749-770`, then `openVerifiedReadStream` with `expected` at `:267-330`; both invoked per request by `mediaProtocol.ts:143,166`). The library grid (Task 6) requests N poster images at once — unusable without this fix.

**Files:**
- Modify: `packages/desktop/src/process/services/creative-studio/mediaStore.ts`
- Test: `tests/unit/process/creative-studio/mediaStore.test.ts`, `tests/unit/process/creative-studio/mediaProtocol.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it('verifies a file once and serves subsequent range requests without re-hashing', async () => {
  const { store, hashSpy } = await storeWithHashCounter(); // wrap the suite's hash helper with a call counter
  await serveRange(store, assetId, '0-1023');
  const callsAfterFirst = hashSpy.calls;
  await serveRange(store, assetId, '1024-2047');
  await serveRange(store, assetId, '2048-4095');
  expect(hashSpy.calls).toBe(callsAfterFirst); // no additional full-file passes
});

it('re-verifies when the file changes on disk (size or mtime)', async () => {
  const { store, hashSpy } = await storeWithHashCounter();
  await serveRange(store, assetId, '0-1023');
  await tamperWithFile(assetPath); // append a byte, bump mtime
  await expect(serveRange(store, assetId, '0-1023')).rejects.toMatchObject({ code: 'integrity' });
});
```

(Adapt helper names to the suite's existing real-filesystem fixtures — it already has tamper/integrity cases; extend them with the call-count assertion.)

- [ ] **Step 2: Run to verify failure** — `bun run test tests/unit/process/creative-studio/mediaStore.test.ts` (first spec fails: hash runs per request).

- [ ] **Step 3: Implement** — module-level cache in mediaStore keyed by absolute path:

```ts
type VerifiedIdentity = { size: number; mtimeMs: number; sha256: string };
const verifiedFiles = new Map<string, VerifiedIdentity>();
```

In the resolve/open path: `stat` the file first; if a cache entry exists and `size`/`mtimeMs` match, skip hashing and stream directly (path confinement checks stay — they are cheap and load-bearing). On mismatch or no entry: hash once as today, then store the entry. Invalidate on every write path (`commitProviderJobAsset`, import, delete — one `verifiedFiles.delete(absolutePath)` per mutation site) and clear the map in `dispose()`. Keep the second verification pass (`expected` in `openVerifiedReadStream`) only for the first, uncached read.

- [ ] **Step 4: Run both suites** — mediaStore + mediaProtocol green; the existing tamper/symlink/integrity specs must still pass unchanged (they prove the cache doesn't bypass confinement).

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/process/services/creative-studio/mediaStore.ts \
        tests/unit/process/creative-studio/mediaStore.test.ts tests/unit/process/creative-studio/mediaProtocol.test.ts
git commit -m "perf(studio): cache verified media identity to stop per-request re-hashing"
```

---

### Task 2: Remove the exact-match timing gate — renderer AND main

The conformance audit enumerated every live site. This task deletes the gate and replaces it with the advisory + existing `Fit to goal`; it also reverts the branch's main-process enforcement (commit `12211a4fb`).

**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx:344` (`openBatchReview` early-return), `:373` (`openHeaderBatchReview` early-return)
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx:88` (disabled term)
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/ProducePhase.tsx:188` (`batchDisabled` prop)
- Modify: `packages/desktop/src/renderer/pages/studio/components/Generation/GenerationControls.tsx:258,:335` (handler guard + disabled term)
- Modify (main): the `timing_mismatch` validation in `creativeStudioService.ts` submit path + the error-code union member in `creativeStudioTypes.ts` + its schema/store validation and i18n mapping (locate all with `grep -rn "timing_mismatch" packages/desktop/src`)
- Modify: `useStoryboardEditor.ts:1099-1104,:1360` — `addScene`/`canAddScene` stop refusing when the target is full (advise instead; max-24 stays)
- Test: invert the gate-asserting specs found via `grep -rln "durationDelta\|timing_mismatch" tests/`

- [ ] **Step 1: Enumerate** — `grep -rn "durationDeltaSeconds !== 0\|timing_mismatch" packages/desktop/src tests | grep -v studioReadiness` and classify every hit (block → delete; advisory display → keep, but ONE per screen — Task 3 owns placement).
- [ ] **Step 2: Write/invert the tests** — batch review opens and submits with an 18s total against a 15s target (DOM test pins the *handler* via the mocked submit binding, not just the button); main-process service test: `submitScenes` accepts a mismatched total; `addScene` succeeds at-target (count < 24).
- [ ] **Step 3: Implement the deletions** (renderer guards, disabled terms, main validation, error-code member + mapping + locale entries for the dead code).
- [ ] **Step 4: Verify nothing is left** — the Step 1 grep returns only the advisory-display sites and `studioReadiness`.
- [ ] **Step 5: Gate + commit** — `git commit -m "feat(studio): make the duration goal advisory everywhere, including main"`

---

### Task 3: Shell, header, and rail (+ one-blocker rule + transition-save race)

> **AMENDMENT (2026-08-04, applied during execution):** Task 3's file list was too narrow. Also in scope: `PhaseShell/StudioPhaseHeader.tsx` (the real owner of breadcrumb/title/action), `PhaseShell/types.ts` (to carry `advisory: StudioPhaseAdvisory | null` on the controller contract), `PhaseShell/phases/ProducePhase.tsx` (consume the advisory at the `batch` anchor; remove its duplicate in-phase Review-cut CTA), `i18n-keys.d.ts` (regenerated by the mandated gate), and the other phase files **only** to supply their `advisory` value. **Rail checkmark semantics (decided):** content predicates, not route position — Brief complete when the brief text is non-empty; Write when ≥1 shot and every shot has a visual; Produce when ≥1 scene has a selected generated asset; Review never shows a checkmark. Implement as a unit-tested pure helper (`studioPhaseCompletion.ts`).


**Files:**
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx`, `StudioPhaseNav.tsx`, `StudioPhaseShell.module.css` (or sibling module)
- Modify: `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` (`shellIssueMessageKey` routing, `requestTransition`), `hooks/useStoryboardEditor.ts` (`flushAllSceneDrafts` result shape)
- Modify: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/BriefPhase.tsx` (drop the duplicate save alert; single CTA)
- Test: `tests/unit/pages/studio/PhaseShell/*.dom.test.tsx` (follow existing suite locations), `useStoryboardEditor.dom.test.ts`

- [ ] **Step 1: Rail + header to prototype layout.** One header row: breadcrumb (`Back to project library / <name>`) · title + aspect chip · saved state · ONE phase CTA right-aligned (`Start writing → / Continue to Produce → / Review the cut → / Hand off`). Rail: compact centered steps `✓ Brief · ② Write · ③ Produce · ④ Review` (checkmark = phase behind the furthest completed), Arco components, tokens only — no full-width segmented pill. Delete the second header action where a phase renders its own footer CTA (Brief keeps the footer button only — decision 2's "simple now").
- [ ] **Step 2: One blocker, structurally.** The shell renders at most one advisory slot; phases pass `advisory: { messageKey, anchor } | null` up through their controller instead of rendering their own alerts alongside the shell's. Concretely: Brief's save error renders ONLY in BriefPhase (shell suppresses `update_project` errors when the active phase owns them); the timing advisory renders ONLY next to the batch control (delete the copies at `StudioPhaseShell.tsx:96-104`). DOM test: force a save failure on Brief → exactly one `[role=alert]` in the document.
- [ ] **Step 3: Transition-save race.** Change `flushAllSceneDrafts` to return `{ failed: string[]; dirtied: string[] }` instead of boolean (`useStoryboardEditor.ts:775-788`): `failed` = flush attempts that errored; `dirtied` = scenes that became dirty *during* the flush. In `requestTransition` (`StudioPage.tsx:709-737`): on `failed.length > 0` keep today's stay-and-focus-alert behavior; on only-`dirtied`, re-flush (bounded, 3 rounds) and proceed; if still dirty after 3 rounds, keep the user on-page WITH a visible message (`transition.savingBlocked` key: "Still saving your edits — try again in a moment"), never a silent no-op. Test: type-during-flush (deferred IPC promise) → transition completes after re-flush; persistent failure → alert visible, rail click not swallowed silently.
- [ ] **Step 4: Restore phase memory on route-driven navigation** (regression from `8cfdf7e37`): re-add `rememberStudioPhase(project.id, routePhase)` in the route effect (`StudioPage.tsx:176-182`). Test: deep-link to `/review`, reload → lands on review.
- [ ] **Step 5: i18n** (new keys ×12 locales), gate, commit — `git commit -m "feat(studio): rebuild the phase header and rail with a single-advisory shell"`

---

### Task 4: Write phase — script table, docked assistant, pacing bar

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/write/` (new dir, ≤10 children: `ScriptTable.tsx`, `ScriptRow.tsx`, `PacingBar.tsx`, `write.module.css`, `index.ts`)
- Modify: `WritePhase.tsx` (compose: brief line · script table · pacing bar · docked `AssistantDock`), `WriteSceneRow.tsx` content folds into `ScriptRow` (keep the editor-binding logic verbatim — it is tested and correct), `AssistantDock` docks right at ≥1120px (`useStudioLayoutMode` already provides `inline/drawer/compact`)
- Test: mirror suites under `tests/unit/pages/studio/`

- [ ] **Step 1: Script table.** One row per shot, four zones per the prototype: `01 + [duration stepper]` · title + narration · visual (placeholder "Describe what we see…" + `Suggest a visual` when empty) · output-type select + readiness dot+word. Reuse the existing field bindings from `WriteSceneRow` unchanged (per-field dirty tracking is load-bearing); this is a re-layout, not a rewrite. Reference slots collapse behind an `Add reference` affordance shown on row hover/focus.
- [ ] **Step 2: Scene-title validation (review finding).** `maxLength={256}` on the title input + local required check surfacing the field error (reuse BriefPhase's pattern) so a cleared title never reaches the zod throw / fake `storage_error`.
- [ ] **Step 3: Seeded placeholders, not stored literals.** `addScene` stops persisting the localized "Untitled scene" (`useStoryboardEditor.ts:1106`): persist an empty title; `ScriptRow` renders position-based placeholder copy (`write.placeholder.opening` / `.middle` / `.closing` — display-only). The title schema currently requires min(1) — relax to allow empty-with-`needs_prompt` readiness, or persist a single space? No: relax `studioSceneSchema.title` to `min(0)` and treat empty as needs-title in readiness. Verify store tests.
- [ ] **Step 4: Pacing bar.** `PacingBar` renders blocks with `flexGrow: durationSeconds` (same technique as `SceneTimeline`), goal marker positioned at `target/total`, total-vs-goal advisory text, and the existing `Fit to goal` button (Task 2 made it the only timing control). Clicking a block selects the row.
- [ ] **Step 5: Dock.** At `inline` layout the assistant renders as a fixed right column (352px) beside the table (grid, not floating button); `drawer/compact` keep the existing behavior. Keep `AssistantDock` content as-is.
- [ ] **Step 6: DOM tests** — row renders all four zones from a seeded project; empty visual shows the suggest affordance; pacing blocks proportional (assert flexGrow); one advisory max. Gate, i18n ×12, commit — `git commit -m "feat(studio): rebuild Write as script table with pacing bar and docked assistant"`

---

### Task 5: Produce phase — connect card, engine bar, shot grid, tray column

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/produce/` (`EngineBar.tsx`, `ConnectEngineCard.tsx`, `ShotGrid.tsx`, `ShotCard.tsx`, `produce.module.css`, `index.ts`)
- Modify: `ProducePhase.tsx` (compose: engine bar · shot grid · activity column), `StudioModelBar.tsx` content becomes `EngineBar` + the settings dropdowns move behind its "Change engines" affordance (opens the existing Model Settings surface — no new picker)
- Test: mirror suites

- [ ] **Step 1: The door.** When no compatible route exists: render `ConnectEngineCard` as the page's single content ("Connect an engine — about a minute, once for the whole workspace" + `Open Model Settings` + `Ask a teammate` mailto/copy affordance), NOT the three-dropdown panel with stacked warnings. When routes exist: `EngineBar` one-liner — `Rendering with — <model> · <kind> · up to <constraints.maxDurationSeconds>s` (+ stills engine when bound) + `Change engines`. No cost figures (contract has none; never invent).
- [ ] **Step 2: Shot grid.** 16:9 canvas cards from the prototype: selected-take poster (via `weprompt-studio:` — cheap after Task 1) or `NO VISUAL YET` / write-the-visual affordance; inline determinate progress + Cancel (only when `job.canCancel`); take count (`Take 2 / 3`); status dot+word; `Render another · <n/a>`-style per-shot action wired to the existing single-scene review flow. The giant `StagePreview` empty stage goes; preview opens from a card.
- [ ] **Step 3: Activity column.** Existing `GenerationJobList` restyled as the right column (290px at `inline` layout), batch button pinned at its foot with the single timing advisory (from Task 2) attached there and nowhere else.
- [ ] **Step 4: DOM tests** — zero-route renders exactly the connect card (no dropdown panel, ≤1 advisory); with routes, bar shows real `constraints` numbers; cancel visibility follows `canCancel`; batch button enabled with mismatched total (Task 2 regression guard here too). Gate, i18n ×12, commit — `git commit -m "feat(studio): rebuild Produce as engine bar, shot grid, and activity column"`

---

### Task 6: Library home (new design)

**Files:**
- Create: `packages/desktop/src/renderer/pages/studio/components/Library/` additions (`Composer.tsx`, `ProjectCard.tsx`, `ShapeTemplates.tsx`) — respect the ≤10-children ratchet (the dir has 9; consolidate `StudioEmptyState` into the grid file if needed)
- Modify: `StudioLibrary.tsx` (compose: composer · shapes · grid; retire the create-modal), the sidebar `SiderStudioEntry`/recents list, main-process `listProjects` renderer projection (+ poster reference)
- Test: `StudioLibrary.dom.test.tsx`, service test for the projection

- [ ] **Step 1: Poster projection (main).** Extend the library listing DTO with `poster: { assetId, sceneNumber, takeNumber } | null` — the first scene (by `sceneOrder`) with a selected asset; renderer builds the `weprompt-studio:` URL exactly as existing previews do. Field-by-field projection (no spreads); zod schema updated; service test: project with/without rendered takes.
- [ ] **Step 2: Composer.** "What are we making?" textarea (one-line feel), chips `16:9 ▾` / `About 18s ▾` (guess defaults — 18s per the new prototype), `Attach a brief doc` (existing import affordance if present, else omit — do not build new upload plumbing), primary `Read my brief →` (⌘↵). Submit: creates the project with the sentence stored as the intent field and the chip guesses (decision 1 — raw sentence, no card), then navigates to **Brief** (decision 2 — Brief stays a phase; it opens pre-filled for confirmation). Empty submit: inline validation "One sentence is enough — say what we are making."
- [ ] **Step 3: Shapes + grid.** Three shape chips (shot count + length only — create + seed N empty scenes with even durations, land on Write). Grid: poster or `SCRIPT ONLY` placeholder with badge, name, status line with dot (red `x of y shots rendered` / green `Handed off · Ns` / grey `n shots written, none rendered` — all derivable from the existing readiness/listing data), meta `n shots · Ns · <relative time>` via an i18n-aware relative formatter (`Intl.RelativeTimeFormat` with the active locale).
- [ ] **Step 4: Sidebar.** 3 most-recent projects + `ALL` → library; replace any credits slot with the note pair: `NO MEDIA CREDITS HERE / No media-generation credits are spent in Brief or Write. Asking the assistant may incur text-model provider charges.`
- [ ] **Step 5: DOM tests** — composer creates-and-navigates with sentence + guesses; empty-submit shows the validation line; card shows poster URL for rendered project and `SCRIPT ONLY` otherwise; relative time uses the i18n formatter (assert non-English locale). Gate, i18n ×12 (ru/uk plural sets for `n shots`/`n projects`), commit — `git commit -m "feat(studio): add the library home with composer and project grid"`

---

### Task 7: Review polish

**Files:**
- Modify: `ReviewPhase.tsx` / `ReviewCut.tsx` / `AssetStrip.tsx` / `StudioExportModal.tsx`
- Test: mirror suites

- [ ] **Step 1: Layout to prototype** — stage (selected take or slate card) · proportional filmstrip below · takes column · handoff panel right. Mostly restyling existing components into the grid.
- [ ] **Step 2: Two review findings** — visible `In cut` badge on the takes strip (not just `aria-current`, `AssetStrip.tsx:73`); gap warning inside the export confirm when `missing > 0` ("Shot 03 is still a slate — it won't be included. Export N shots?"), reusing the side panel's existing counts (`StudioExportModal.tsx:78-100`). Remove the dead `void onOpenProduce;` statement.
- [ ] **Step 3: DOM tests** — in-cut badge visible on the selected take; confirm dialog shows the gap line when slates exist and not when complete. Gate, i18n ×12, commit — `git commit -m "feat(studio): align Review layout with the design and warn about gaps at export"`

---

## Final verification (whole stream)

- [ ] `bun run test` full suite on a quiet machine; `bunx tsc --noEmit`; `check-i18n`; lint/format.
- [ ] Visual pass against the prototype: drive the dev app (CDP) through library → brief → write → produce → review and screenshot each; compare side-by-side with the prototype screens. The four "off" symptoms from the 2026-08-04 audit must be gone: no full-width pill rail, no stacked warnings (≤1 advisory per screen), no gate copy anywhere, no floating assistant button at desktop width.
- [ ] Sweep dead i18n keys (the audit's list: `phase.write.*` orphans incl. `fitToGoal`, `phase.brief.invalidDuration` with wrong bounds, `phase.produce.batchTimingBlocker`, `modelsTitle`, `modelsHelp`, `openModelSettings`, `jobs.title`, `jobs.noJobs`) — delete from all locales + regenerate types.
- [ ] Do NOT push; keep tasks as separate commits/MRs.

## Self-review notes

- Decisions 1 & 2 are encoded in Task 6 Step 2 (raw sentence, land on Brief) and Task 3 Step 1 (four-step rail, Brief keeps its simple form). If the designer later collapses Brief, only those two steps change.
- Task order is a dependency chain: 1 (perf) before 6 (thumbnails); 2 (gate) before 3/4/5 (their advisories assume gate-free); 3 (shell) before 4/5/6/7 (they render inside it).
- Line anchors are from the 2026-08-04 review/audit of `8c937af3f`; re-locate by symbol after any merge.
- Not duplicated from the Now-tier plan: cancellation, poll deadlines, download budgets, plural fixes — all verified DONE on this branch by the conformance audit.
