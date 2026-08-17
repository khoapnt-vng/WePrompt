# S1.5 Engine Strip plan — review

Reviewed against `feat/creative-studio-2` @ `215a5649e`. Every claim below was checked against the
tree; where I could not verify something it says so.

**Verdict: approve after one reordering, one path fix, and one change to the test rule.** The plan is
accurate — the directory fan-out counts, the file map, the routing shape, every helper symbol and
every test path check out. The problems are all in sequencing and gates, not in understanding.

---

## 1. Blocking — Task 3 leaves the product with no way to select an engine

There are exactly **two** writers of project routing in the renderer today:

- `StudioPage.tsx:1467` — `onSelectStoryboardModel`, role `storyboard` only. Not a shot engine.
- `useStudioModels.ts:242` — **the auto-adoption effect**, for `image` and `video`.

`StudioModelBar` renders `EngineBar`, and `EngineBar`'s only control is a "Change engines" button
that opens Settings. Settings binds engines **workspace-wide**; it never writes project `routing`.

So auto-adoption is the _sole_ writer of image/video routing. Task 3 deletes it, and the Engine Strip
that replaces it does not exist until Task 5. **The commits ending Tasks 3 and 4 leave every project
without pre-existing persisted routing permanently ungeneratable, with no in-app cure.**

The suite stays green throughout — Task 3's own tests assert that no writes occur, which is exactly
the new intended behaviour — and the plan forbids running `bun run dev`, so nothing would surface it.

**Fix:** land Task 5 before Task 3, or fold Task 3's deletion into Task 5's commit. "Selection is
always explicit" only becomes true once something can select. Everything else in Task 3 —
`selectionIssue`, the focus refresh, separating catalog errors from selection errors — can stay where
it is; it is only the deletion that must not precede the replacement.

## 2. Path error — Task 7

Task 7 lists `packages/desktop/src/renderer/pages/studio/components/PhaseShell/phases/produce/ProducePhase.tsx`.

The file is `.../PhaseShell/phases/ProducePhase.tsx`. The `produce/` subdirectory holds `EngineBar`,
`ShotCard`, `ShotGrid` and `ConnectEngineCard`, not the phase. Task 6 has the correct path, so this
is a slip rather than a misunderstanding — but a `git add` of the wrong path fails silently in a
plan that stages explicit file lists.

## 3. The explicit `git add` lists contradict the task text

Task 1 Step 6 says update "every affected test factory". Step 8 then stages eleven named files.
`WritePhase.dom.test.tsx` and `StudioBriefDrawer.dom.test.tsx` both plausibly construct catalog
fixtures and are not in that list. If either needs touching, the change is left uncommitted and the
_next_ task's gate fails somewhere unrelated and confusing.

**Fix:** after each commit, assert `git status --porcelain` is empty. Keep the explicit list as the
intent; let the check catch the omission.

## 4. The full-suite rule is right per task and wrong at the merge

Global constraints say never run the full `bun run test`, and Task 9's gate stays inside the studio
directories. That is correct for per-task speed and wrong as final acceptance.

`AGENTS.md` requires the whole suite at a **slice merge**, because repo-wide invariant tests — the
kind asserting two files agree with each other — live outside the slice. The rule exists because a
parity test sat red on an integration branch for four slices; the net worked and nobody ran it.

**Fix:** reword to "not per task; mandatory once before the slice merges." Hold **641 files / 8,639
tests passed, 19 skipped** as the baseline, and treat counts as the signal — durations on this
machine inflate several-fold under concurrent sessions.

---

## What is right, and worth keeping exactly as written

**The "Grounded corrections" section is the strongest part of the plan.** It contradicts its own spec
six times with reasons, which is the behaviour this project needs from an implementer. Two of those
are not obvious and are correct:

- refusing to ship `coherenceOn` / `coherenceOff*`, because the last-frame chain is Phase 3b and the
  strip would otherwise claim continuity the product does not have;
- refusing to manufacture an unavailable state for `supportsFirstFrame: false` to match a stale row
  in the spec's cause table.

**Task 1's `selectionIssue` is a genuine prerequisite the roadmap missed.** `providerResolver`
discards unusable bindings before `creativeStudioService` projects the catalog, so the five-cause
promise is not implementable without preserving diagnostics. Correctly identified, correctly scoped
to main-only types with no credentials crossing IPC.

**The spend discipline is exactly right** and should not be softened during implementation: every
existing disabled term preserved verbatim, batch intent built from **exact eligible `sceneIds`**
rather than the global ready count, review IDs equal to submitted IDs, "Close and set engines"
closing and focusing without mutating routing, and the Director's queued-reference auto-submit path
explicitly untouched.

**Task 9 Step 4's manual diff inspection is the right final gate**, and pinning the base at
`215a5649e` makes it reproducible.

---

## One addition

**Look at the app after Task 6**, the mount task. Not as a formality: the two defects in this epic
that no code review caught were both visible within seconds on screen — a pair of "Continue" buttons
that were the old stepper surviving in the top bar, and a Board heading that announced the engine
instead of the view. Task 6 is the first commit where the strip is visible in all three places, and
it is the cheapest moment to find that something reads wrong.

The plan forbids `bun run dev` for the implementer, which is correct for a sandboxed agent that
cannot bind sockets. This is a request to the human running the slice, not to the agent.

---

## Two things S1.5 explicitly does not close, stated so they are not assumed

- The **sub-4s authoring migration**. The plan is right to keep `1..60` acceptance out of scope, and
  right that Engine Strip copy must report actual catalog bounds and never present storage bounds as
  engine bounds. The gap itself remains open.
- The **stale Director snapshot**. Task 5 discloses staleness after a selection; it does not mutate
  the frozen MCP snapshot, and should not try to.
