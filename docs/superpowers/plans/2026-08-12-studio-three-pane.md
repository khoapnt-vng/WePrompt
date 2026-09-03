# Creative Studio — three-pane shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Creative Studio as three collapsible panes — side menu · always-on Director conversation · work panel hosting all four phases — with the Director able to decide when to make an image, without gaining a private channel to the provider.

**Architecture:** The Director conversation moves from a per-phase component to a **single shell-level pane** mounted once and never unmounted, which removes the multi-mount risk entirely. The work panel becomes one application hosting all four phases, with the phase rail and project identity moving into it from the app header. Collapse is user-driven and persisted, with width-driven collapse acting as a presentation override that never overwrites the stored preference.

**Tech Stack:** React 19, TypeScript strict, Arco Design, CSS Modules + UnoCSS, Vitest 4 (`--project dom` renderer, `--project node` main), i18n ×12 locales.

**Design of record:** `docs/design/creative-studio-three-pane-design.md` (committed). **Source of truth for visuals:** the clickthrough `Creative Studio - Write (Clickthrough).dc.html`. Where this plan and the design doc disagree, the design doc wins; where the design doc and the clickthrough disagree, the clickthrough wins.

---

## Execution context — read first

- **Base:** `integration/studio-director` @ `51adcc02f` or later. Branch per slice via `superpowers:using-git-worktrees`.
- ⚠️ **`docs/superpowers/` is gitignored.** This plan does not travel with a worktree. **Copy it into any worktree before starting**, and never `git add` it. Plans have been lost to worktree pruning here before.
- **`bun install` in any fresh worktree** before believing a red gate.
- **Push target is `ghk` (GitHub), not `origin` (GitLab).** Use `just push`, never `git push`. Do not push unless asked.
- **`sprint3` is a protected branch** — it takes merges by PR only.
- Conventional Commits, one task per commit. **Never add AI signatures.**

### Hazards specific to this codebase

1. 🚨 **`bun run lint:fix` can emit type-breaking autofixes.** It rewrote typed arrays to `Set` without changing the annotation, breaking `tsc` in three files three times. If `tsc` fails in a file you did not touch, check `git diff` before assuming your change caused it.
2. 🚨 **CSS is invisible to the test suite.** `tsc` does not check CSS module specifiers and jsdom mocks CSS modules — a `composes:` path one level short once shipped a completely dead phase with 8,000+ tests green. When you add a `composes: … from '…'`, count the `../` and verify the target exists on disk.
3. 🚨 **Cross-slice contract tests are owned by nobody and break constantly.** `tests/unit/pages/studio/studioI18n.test.ts`, `StudioAccessibleCopy.dom.test.tsx` and `StudioPage.dom.test.tsx` assert copy and keys that individual changes move. All three went red during the last batch. **If you delete an i18n key or change user-facing copy, update these in the same commit.**
4. **Load-sensitive test:** `tests/unit/process/app-operations/broker.test.ts` gates on `vi.waitFor`, whose default 1s window fails under concurrent suites. Rerun in isolation before believing it.
5. **Known flake (BUG-025):** a full-suite failure on exactly `StudioPage.dom.test.tsx` "fits 18 seconds…" → rerun that file in isolation, record, proceed.

### Gates

`bunx tsc --noEmit` · `bun run lint:fix` · `bun run format`. Anything touching `renderer/`, locales or i18n config also runs `bun run i18n:types && node scripts/check-i18n.js`. Full `bun run test` at the end of each slice — **not per task**, and never trust a focused run to prove a slice is safe.

---

## File structure

| Path | Responsibility |
|---|---|
| `renderer/pages/studio/components/Shell/StudioShell.tsx` | **new** — three-pane frame, owns collapse |
| `renderer/pages/studio/components/Shell/useStudioPanes.ts` | **new** — collapse preference + effective state |
| `renderer/pages/studio/components/Shell/DirectorPane.tsx` | **new** — header, transcript, cards, composer |
| `renderer/pages/studio/components/Shell/*.module.css` | **new** — pane chrome |
| `renderer/pages/studio/components/PhaseShell/StudioPhaseShell.tsx` | modify — becomes the work panel; loses the app-header rail |
| `renderer/pages/studio/components/PhaseShell/StudioPhaseHeader.tsx` | modify — becomes breadcrumb + `SAVED` chip |
| `renderer/pages/studio/components/PhaseShell/phases/brief/BriefPhase.tsx` | modify — **remove** conversation + proposal card |
| `renderer/pages/studio/components/PhaseShell/phases/WritePhase.tsx` | modify — **remove** the AssistantDock mount |
| `renderer/pages/studio/components/PhaseShell/phases/brief/BriefProposalCard.tsx` | move → `Shell/`, extended |
| `renderer/pages/studio/components/PhaseShell/phases/write/write.module.css` | modify — fixed columns |
| `process/resources/builtinMcp/studioServer.ts` | modify — the image tool |
| `common/types/project/creativeStudioTypes.ts` | modify — proposal rationale field |

---

# Slice I — the image tool (do this first)

**Why first:** D1 is the only decision where a wrong implementation is expensive and hard to walk back. Prove the route before any UI depends on it.

### Task I1: Spike — can a Studio tool submit an image job through the job manager?

**Files:** scratch only. Produces a findings note, not a commit.

- [ ] **Step 1: Establish the existing submit path.** Read `process/services/creative-studio/jobManager.ts` and the renderer submit path used by the Generate-reference control. Write down: the exact function that enqueues an image job, what it requires (projectId, sceneId, prompt, outputRole, idempotency key), where the per-project cap is enforced, and what it returns on refusal.

- [ ] **Step 2: Establish what the subprocess can reach.** `builtin-mcp-studio` runs as a **separate stdio process** with filesystem access to the project directory and `proposals/pending/` only. It cannot call the job manager in-process. Determine the mechanism it must use — the existing durable-record pattern (write a record, main's watcher picks it up) is the strong candidate, since J1 already does exactly this for reference requests.

- [ ] **Step 3: Answer three questions in writing.**
  1. Does the cap get enforced on the main side regardless of who requested the job? (It must.)
  2. When the cap refuses, how does the refusal reach the Director as prose it can relay?
  3. Is the J1 record path reusable as-is, or does an image request need a distinct record kind?

- [ ] **Step 4: Report before building.** If the answer to (1) is anything other than an unambiguous yes, **stop and escalate** — that is the spend fence and it is not negotiable.

### Task I2: The `studio_generate_image` tool

**Files:**
- Modify: `process/resources/builtinMcp/studioServer.ts`
- Modify: whichever writer I1 identified (likely alongside `studioReferenceRequestWriter.ts`)
- Test: `tests/unit/process/creative-studio/studioServer.test.ts`

- [ ] **Step 1: Write the failing test** — the tool submits a job that main enforces the cap on, and returns a refusal the Director can read when capped.
- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement** via the mechanism I1 established. 🚨 **Do not add the image-generation MCP to the conversation's allow-list.** The curated snapshot test asserting six auto-attach ids are absent must pass **unmodified**.
- [ ] **Step 4: Run the spend-fence test explicitly and report it by name.**
- [ ] **Step 5: Commit** — `feat(creative-studio): let the Director request an image through the job manager`

### Task I3: Retire J2's batch approval

**Files:** `renderer/pages/studio/hooks/useStudioJobs.ts`, the Generate-reference dialog, and the J2 tests.

- [ ] **Step 1:** Establish what still uses the queued-request path once I2 lands. The **user-initiated** Generate-reference flow stays; only the *assistant-queued batch approval* is superseded.
- [ ] **Step 2:** Remove the superseded path and its now-dead i18n keys across 12 locales. Update hazard-3 contract tests in the same commit.
- [ ] **Step 3:** Full suite. **Commit.**

---

# Slice S — the shell

### Task S1: Collapse state with a preference that width cannot clobber

**Files:**
- Create: `components/Shell/useStudioPanes.ts`
- Test: `tests/unit/pages/studio/Shell/useStudioPanes.test.ts`

- [ ] **Step 1: Write the failing test.** The critical case is the third one:

```typescript
it('keeps the stored preference when width forces a collapse', () => {
  const { result, rerender } = renderHook(({ w }) => useStudioPanes(w), { initialProps: { w: 1400 } });
  act(() => result.current.setDirectorPreference('expanded'));
  rerender({ w: 900 });                                   // narrow: forced shut
  expect(result.current.directorEffective).toBe('collapsed');
  expect(result.current.directorPreference).toBe('expanded');   // preference survives
  rerender({ w: 1400 });                                  // widen again
  expect(result.current.directorEffective).toBe('expanded');    // and is restored
});
```

- [ ] **Step 2: Run it and watch it fail.**
- [ ] **Step 3: Implement.** Two values, never one: `preference` (persisted, user-set only) and `effective` (derived from preference **and** the width mode). Reuse `useStudioLayoutMode`'s existing `inline`/`drawer`/`compact` — do not add breakpoints. Persist with the same mechanism the app sidebar's collapse already uses; find it rather than inventing storage.
- [ ] **Step 4: Run it and watch it pass.** **Step 5: Commit.**

### Task S2: The three-pane frame

**Files:** Create `components/Shell/StudioShell.tsx` + `StudioShell.module.css`. Test: `tests/unit/pages/studio/Shell/StudioShell.dom.test.tsx`

- [ ] **Step 1:** Failing test — renders three panes; the Director pane is present at all four phase routes; collapsing it hides it without unmounting its child.
- [ ] **Step 2:** Watch it fail.
- [ ] **Step 3:** Implement to §2 of the design doc: side menu 212px, Director 352px, work panel `flex:1; min-width:0`. At `drawer`/`compact` the Director overlays via Arco `Drawer` — `AssistantDock` already does this on the same breakpoint; reuse its approach.
  ⚠️ **The pane must keep its child mounted when collapsed.** A streaming reply must survive a collapse. `AssistantDock` already gets this right — its drawer keeps children mounted when closed, verified live.
- [ ] **Step 4:** Watch it pass. **Step 5: Commit.**

### Task S3: Move the conversation to the shell

**Files:** Create `components/Shell/DirectorPane.tsx`. Modify `phases/brief/BriefPhase.tsx`, `phases/WritePhase.tsx`.

- [ ] **Step 1:** Failing test — the conversation renders once at shell level, and switching phases does not remount it.
- [ ] **Step 2:** Watch it fail.
- [ ] **Step 3:** Implement. Move `StudioConversationSurface` into `DirectorPane`; **delete** the mount in `BriefPhase.tsx` (~`:168`) and the `AssistantDock` mount in `WritePhase.tsx` (~`:270,281`). Header per design §3.1, including the `SAME CONVERSATION AS YOUR BRIEF` subtitle.
- [ ] **Step 4: Re-run the A15 smoke by hand.** Send a long reply, switch phases mid-stream, confirm no loss and no duplication. This slice is what that smoke protects; a unit test cannot prove it.
- [ ] **Step 5: Commit.**

### Task S4: Work-panel header and the rail

**Files:** `PhaseShell/StudioPhaseHeader.tsx`, `StudioPhaseShell.tsx`, `StudioPhaseShell.module.css`

- [ ] **Step 1:** Failing test — breadcrumb `Creative Studio / <project>` plus a `SAVED` chip in a 56px work-panel header; the rail renders inside the work panel.
- [ ] **Step 2:** Watch it fail.
- [ ] **Step 3:** Implement. The project title keeps its **inline rename** (`eca1c1242`) — it moves into the breadcrumb, it is not deleted. Save state becomes the `SAVED` chip. The rail moves from the app header into the work panel and stays **pure navigation**.
  ⚠️ The rail's `data-studio-phase-heading` focus target and its `aria-labelledby` pairing must survive the move. Deleting them silently breaks phase-change announcements with no test coverage — this has already happened once.
- [ ] **Step 4:** Watch it pass. Update hazard-3 contract tests. **Step 5: Commit.** Then run the **full suite** to close the slice.

---

# Slice D — the Director pane's contents

### Task D1: A rationale on proposals

**Files:** `common/types/project/creativeStudioTypes.ts`, `process/resources/builtinMcp/studioServer.ts`, the proposal card. Test: `tests/unit/pages/studio/Storyboard/Brief/BriefProposalCard.dom.test.tsx`

- [ ] **Step 1:** Failing test — a proposal carrying a rationale renders it as `Why: …`; one without it renders no empty row.
- [ ] **Step 2:** Watch it fail.
- [ ] **Step 3:** Implement. Add an **optional** `rationale` to the proposal payload and surface it in `propose_storyboard`'s schema so the Director can supply it. ⚠️ **Absent must be safe** — every existing record lacks it, and the backend is separately versioned, so newly added fields can arrive absent at runtime. Normalise at the IPC boundary.
- [ ] **Step 4:** Watch it pass. **Step 5: Commit.**

### Task D2: The stale card

**Files:** the proposal card + i18n ×12.

- [ ] **Step 1:** Failing test — a stale proposal shows the `OUT OF DATE` badge, the plain-language consequence, and an **"Ask again with my changes"** action that re-proposes against current state.
- [ ] **Step 2:** Watch it fail.
- [ ] **Step 3:** Implement per design §4. 🚨 **Per D4, do not claim who changed it or when.** Show the field and both values only. "you, just now" is not implementable and **must not be faked** — a proposal can be superseded by another accepted proposal rather than by the user.
- [ ] **Step 4:** Watch it pass. **Step 5: Commit.**

### Task D3: Outcome chips and the pending strip

- [ ] Failing test → implement → pass → commit. Applied/discarded render as compact chips with **Reopen**, not full cards (extends `3af963de7`). The pending strip sits above the composer with an inline **Accept**, so a proposal is actionable without scrolling.

### Task D4: The composer scope chip

- [ ] Failing test → implement → pass → commit. A `SHOT 03 ▾` chip binds the message to a shot; placeholder "Ask for a change, or ask for an image…". Keep the standing footnote from design §3.7 permanently visible.
- [ ] Close the slice with the **full suite**.

---

# Slice B — Brief and Write in the work panel

### Task B1: Brief keeps only the brief

**Files:** `phases/brief/BriefPhase.tsx`

- [ ] **Step 1:** Failing test — Brief renders the brief text and the constraints row, and **no** conversation surface and **no** proposal card.
- [ ] **Step 2:** Watch it fail.
- [ ] **Step 3:** Implement — this is **deletion**. Keep the brief `Input.TextArea` (~`:179`), duration `InputNumber` (~`:110`), aspect `Select` (~`:139`). Remove the conversation surface and the proposal card, both of which now live in the Director pane.
  🚫 **Do not delete duration and aspect.** The Director cannot write project settings — the only proposal payload kind is `replace_storyboard` — so removing these controls makes them permanently uneditable, and duration is a hard input to drafting (range-checked 5–60, scenes fitted to it, drafting fails outright if infeasible).
- [ ] **Step 4:** Watch it pass. **Step 5: Commit.**

### Task B2: Fixed script-table columns

- [ ] Failing test → implement → pass → commit. `write.module.css` grid becomes `56px 200px 320px 120px` per design §2.
  ⚠️ Verify against the **visual textarea's** height at the new width — the current 112px/fr layout was chosen partly to stop prompts clipping, and a narrower Visual column may reintroduce it. Measure before and after; do not assume.

### Task B3: Product-language OUTPUT states

- [ ] Failing test → implement → pass → commit. "Ready to produce" / "Needs an image before it can be produced" replace the media-kind dropdown and "Ready to generate". i18n ×12; update hazard-3 contract tests in the same commit.
- [ ] Close the slice with the **full suite**, then run the app and walk all four phases.

---

## Order and parallelism

1. **Slice I** first, alone. I1 is a spike that can invalidate I2/I3.
2. **Slice S** next — everything else sits inside it. S1 → S2 → S3 → S4 in order.
3. **Slices D and B** can run in parallel after S3: D owns `Shell/`, B owns `phases/`. They share only i18n files, where the key-level merge driver handles the overlap.

**Do not parallelise S.** Its tasks build on each other, and S3 moves code that S2 creates.

## Risk register

1. **The spend fence** (`useGuidSend.ts:571` auto-attach). I2 must never widen the conversation's allow-list. If the curated-snapshot test needs changing to make your work pass, your work is wrong.
2. **Collapse clobbering preference** (S1). The single most likely subtle bug in this plan; it is why S1 has an explicit test.
3. **Losing the phase focus target** (S4). Silent, untested, and already broken once.
4. **A15 regression** (S3). The shell-level mount should make this safer, not riskier — but it is a code move, so re-run the smoke by hand.
5. **Brief becoming uneditable** (B1). Deleting duration/aspect would strand settings the Director cannot write.
6. **Visual prompts re-clipping** (B2). Fixed 320px is narrower than today's ~450px measured.
