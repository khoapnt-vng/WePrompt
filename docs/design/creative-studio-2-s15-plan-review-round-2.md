# S1.5 plan — review round 2

Reviewed against `feat/creative-studio-2` @ `731db8666`.

**Verdict: approved to implement.** All four round-1 findings are fixed correctly, and the fixes are
better than what I asked for in two places. One new finding below — not blocking, but it invalidates
a safety assumption the plan states explicitly, and the four files it affects should be named rather
than discovered.

---

## Round-1 findings — all closed

**The blocking one is fixed properly.** Task 3 no longer deletes the writer; Task 5 Step 7 deletes
adoption in the same staged commit that introduces `EngineStrip`, and says so in as many words:
_"there is no commit in which adoption is gone and image/video selection is unreachable."_ The
adoption tests are retained in Task 3 and replaced in Task 5 Step 2 alongside the component that
makes explicit writes reachable. That is the correct shape.

The Task 7 path is corrected to `phases/ProducePhase.tsx`. The `git status --porcelain` check is
added, with the right instruction — amend only when the file belongs to that task, never repair the
check with a broad `git add`. Task 6 Step 7 adds the human three-mount checkpoint.

**Two improvements on what I asked for.** The conditional merge gate (Task 9 Step 4) is better than
my wording: I said hold 641 / 8,639 as the baseline, which is wrong once S1.5 adds tests — the plan
correctly says to use it to investigate an _unexplained decrease_ rather than to require an exact
match. And Task 9 Step 5 re-pins the diff base to `731db8666`, which is right now that the review is
committed.

---

## New finding — `tsc` does not typecheck tests, so it cannot catch a stale fixture

Task 1 Step 6 says the fixture edits land with the DTO change _"so the branch remains **type**- and
test-clean between tasks."_ The type half is not true.

`tsconfig.json` includes exactly:

```
packages/desktop/src/**/*, uno.config.ts, packages/desktop/electron.vite.config.ts,
playwright.config.ts, packages/desktop/src/renderer/types.d.ts
```

**No test file is in scope.** `bunx tsc --noEmit` will never flag a fixture missing
`integrationLabelKey` or `selectionIssue`. The only thing that catches a stale fixture is a runtime
assertion — a `toEqual` over the whole object, or code that reads the missing field. Anything using
`toMatchObject`, or reading only other fields, **passes green with an incomplete fixture**.

Why this matters beyond pedantry: an unfixed fixture does not fail in Task 1. It fails in **Task 5**,
where `EngineStrip` reads `integrationLabelKey` to render the integration label and gets `undefined` —
several commits away from the change that caused it, in a task with its own large surface.

### The files to name — corrected

I got this list wrong twice before checking it properly, so here is how it was derived. A grep for
the **type names** misses fixtures built as plain object literals without the annotation — three real
ones do exactly that. The reliable signature is the **shape**: a file containing both `selectedRoute`
and `options:`.

```bash
grep -rl "selectedRoute" tests/ | while read -r f; do grep -q "options:" "$f" && echo "$f"; done | sort
```

**Fifteen** files match. Task 1's staged list covers eleven of them. The four missing are:

- `tests/unit/pages/studio/StudioAccessibleCopy.dom.test.tsx`
- `tests/unit/pages/studio/StudioExport.dom.test.tsx`
- `tests/unit/pages/studio/StudioLibrary.dom.test.tsx`
- `tests/unit/process/creative-studio/jobManager.test.ts`

All four sit inside Task 1's gate directories, so its test run exercises them — but only a runtime
assertion will fail, and only where one exists.

Two corrections to my round-1 review, in case they were acted on:
`StoryboardDraftModal.dom.test.tsx` uses `StudioRouteCatalog['storyboard']` — the **text-model**
catalog, not a media route — and needs nothing. `store.test.ts` builds no catalog at all. Conversely
`WritePhase.dom.test.tsx`, which I guessed at in round 1 and the plan duly added, **is** genuinely
required; it builds the shape without importing the type.

`tests/e2e/features/workspaces/creative-studio.e2e.ts` also constructs a catalog. It is Task 9's, and
it is likewise not typechecked — `playwright.config.ts` is in scope but the spec files are not, so
`playwright test --list` remains the only compile signal for it.

---

## Nothing else changed my assessment

The spend discipline, the `selectionIssue` prerequisite, the six grounded corrections, and Task 9
Step 5's manual diff inspection all stand as reviewed. Task 5 is now the largest commit in the plan —
it absorbed the adoption deletion, which was necessary — so it is the concentration of risk and the
right place to slow down.
