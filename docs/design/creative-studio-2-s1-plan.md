# S1 — the view switch. Implementation plan

Replaces the four-step Brief/Write/Produce/Review rail with a three-view switch (**Table · Board ·
Cut**), Brief as a drawer, a state readout, and one money control in the top bar.

Branch `feat/studio-s1-view-switch`, from the green phase-1 tip `73b6e9873`.
**Baseline to hold: 641 files / 8,589 tests passed, 19 skipped.** Counts are the signal; duration is
not — this machine inflates vitest 15–150× under concurrent load.

Grounded by four read-only agents over the real tree. Citations name symbols; line numbers drift.

---

## Decisions this plan makes, so implementation does not have to

**Views stay routable.** `/studio/:id/table`. Keeps deep links, reload recovery and the library's
card-open path working unchanged. Non-routable local state would break all three for no gain.

**New localStorage key, no migration map.** `…:last-view:<projectId>` rather than reusing
`…:last-phase:`. `parseStudioPhase` returning null already self-heals — `StudioPage` redirects
`replace: true` to the resolved entry view — so an unmapped old value costs one redirect, not an
error. A migration map (`produce→board`) is nicer and is explicitly deferred; it is a one-time
landing difference, not a defect.

**Rename the transition property `phase` → `view`.** It ripples into four `Pick<>` unions, six call
sites and ~nine test files — but every one of those tests is being rewritten anyway, so the marginal
cost is small and `{ phase: 'table' }` would be a permanent lie.

**Keep `data-studio-phase-shell` and `data-studio-phase-heading`.** They are test hooks, not user
copy. Keeping both names leaves four e2e selectors and three focus-contract tests untouched. **But
keeping the name is not sufficient**: those e2e selectors use the direct-child combinator
(`> header`), so the switch and readout must not be inserted between the shell root and its header.

**Brief is demoted in its own commit, after the switch lands.** The switch and the demotion are
independent, and bundling them is what would make a commit leave the app broken.

---

## C1 — `durationTotalSeconds` on the readiness summary (prep, no UI change)

`deriveStudioReadiness` computes a total, subtracts the target, and exposes only
`durationDeltaSeconds` — the total is thrown away. The readout's "2:58" needs it.

- **Modify** `studioReadiness.ts`: add `durationTotalSeconds` to `StudioReadinessSummary` and return
  the value already computed. Do not recompute — reuse the local.
- **Test** `tests/unit/pages/studio/studioReadiness.test.ts`: assert the total, and assert it
  excludes duplicate scene ids exactly as `canonicalScenes` already does. Two existing recomputations
  elsewhere in the tree disagree on duplicates; this one is canonical and the others are not in scope.
- Every controller fixture that builds a summary literal must gain the field — tsc will name them.

Verify: `bun run test tests/unit/pages/studio/studioReadiness.test.ts` then `bunx tsc --noEmit`.

---

## C2 — Fix the pre-existing e2e staleness (prep, no S1 content)

**This is already broken on the phase-1 tip.** `phaseCtas` declares write→"Continue to Produce" and
produce→"Review cut", but en-US renders **"Continue"** for both, so `phaseCtaPattern` matches nothing
and `expectStudioPhase` cannot pass today.

Fix it _before_ touching the harness, in its own commit, so the S1 rewrite is not blamed for it and
so the harness is honest when S1 starts editing it.

Verify: `bunx playwright test --list tests/e2e/features/workspaces/creative-studio.e2e.ts`.

---

## C3 — The switch, with Brief still a view

Four views for one commit: `table`, `board`, `cut`, `brief`. This is the large commit; it is atomic
because the rail and the shell are interlocked.

**Renderer**

- `studioPhaseRoute.ts` → `STUDIO_VIEWS`, `parseStudioView`, `studioViewPath`, `defaultStudioView`,
  `readLastStudioView`, `rememberStudioView`, `resolveStudioEntryView`. `defaultStudioPhase`'s
  `sceneCount` argument loses its only consumer — drop it, and drop it from both call sites.
- `StudioPage.tsx`: the `:phase` param read, the entry redirect effect, the `activePhase` derivation,
  `requestTransition`, the transition-commit effect, `closeExportAndOpenProduce`, and advisory
  anchoring. Seven sites.
- `StudioPhaseShell.tsx`: render the switch in place of the rail. **Do not wrap the header.**
- **Delete** `StudioPhaseNav.tsx`, `studioPhaseCompletion.ts`, the rail block in
  `StudioPhaseShell.module.css`, and `data-studio-phase-marker`.
- `StudioLibrary.tsx`: create-project landing and card open.
- The three phase→phase transitions inside view bodies (`ProducePhase` → Write with focus intent,
  `ReviewPhase` → Produce recovery, `BriefPhase` → Write).

**Main process — same commit, non-negotiable**

- `creativeStudioBridge.ts`: `STUDIO_ROUTE_PATTERN` hardcodes `brief|write|produce|review` and gates
  `createCreativeStudioCloseHandshake`. **Miss it and quitting from `/studio/:id/table` discards
  unsaved scene drafts with no prompt** — and the suite stays green, because
  `creativeStudioBridge.test.ts` defaults `getCurrentUrl` to `#/studio/project_1/write`, which still
  matches the old regex. Update the regex **and** the fixture, and add a case asserting a _new_ view
  URL is recognised.

**i18n**

- `phase.nav.brief|write|produce|review` retire; view labels arrive. **`phase.nav.saved` and
  `phase.nav.saving` are NOT rail keys** — they are the header save chip. A prefix-wide deletion of
  `phase.nav.*` breaks four unrelated tests.
- Any deleted key must come out of `streamFullSentenceKeys` in the same commit, or the parity test
  fails eleven confusing ways at once (`undefined === undefined` reads as "copied English").
- `studioI18n.test.ts`'s `plannedGroups` is exact-set equality — edit it in the same commit, and move
  all twelve locale files together.

**Tests** — 11 files. Two dominate: `StudioPage.dom.test.tsx` (a `selectStudioPhase` helper plus ~20
tests that click the rail) and the e2e harness (`phaseLabels`/`phaseCtas`/`expectStudioPhase`).

**Delete, do not adapt** — these assert the completion markers, which no longer exist:
`StudioAccessibleCopy` "derives phase completion…", "derives rail checkmarks…", "keeps Write
incomplete…".

**The five vacuous passes.** After this change these assert nothing and must be deleted or
re-pointed, not left green: `StudioPhaseHeader.dom.test.tsx` "header does not host a rail"
(unfalsifiable once no rail exists anywhere) and `ProducePhase.dom.test.tsx`'s absence assertion for
`phase.produce.reviewCut`, among others. A test that cannot fail is worse than one that does.

Verify: `bun run test` (expect 641/8,589 ± the deletions, each one accounted for), `bunx tsc
--noEmit`, `node scripts/check-i18n.js`, `bunx playwright test --list`.

---

## C4 — Brief becomes a drawer

Smaller than it sounds: phase 1 already evacuated `BriefPhase`. The project name went to the header,
the save readout to the header chip, the conversation to `DirectorPane`, the proposals to
`DirectorProposals` — each pinned by a negative test. What remains is three form controls (brief
textarea, duration, aspect), two paragraphs of copy, a project-update conflict alert, and "Start
writing".

Mirror `StudioRulesDrawer` — **with one structural difference that is the whole risk of this commit.**
`StudioRulesDrawer` takes no controller, because rules write through a dedicated CAS'd `setBriefRules`
command deliberately kept off the project draft. Brief's three fields **are** the project draft:
debounced, dirty-tracked per field, flushed on blur. So the Brief drawer must hold `editor`, and
**closing the drawer must flush** — the Rules template never has to.

Two things that lose their home and will be dropped silently if not named here:

- The `data-studio-phase-heading` focus target `StudioPhaseShell` focuses after every view change.
- The `activePhase === 'brief'` special case that suppresses the project-update conflict from the
  shell advisory _because BriefPhase renders it itself_. Demote Brief without moving this and the
  conflict either renders twice or not at all.

Open, and decided here: **"Start writing" goes.** With a switch there is no next step. The
zero-scene project opens on Table with the Brief drawer open.

---

## C5 — One money control in the top bar

**The cut render is not money.** `renderService` spawns a local `ffmpeg` binary with no provider. The
single spend is `studioJobs.submitScenes`.

That one spend has **five** entry points: the batch button, per-shot Render on `ShotCard`,
`onGenerateReference` in Write/Table, `StagePreview`, and the Director's auto-submitted reference
requests — **the last with no human confirm at all**. S1 consolidates the _visible_ controls into the
top bar. It does **not** touch the unconfirmed path: that is a pre-existing spend-fence hole, it is
recorded here, and it is not S1's to fix quietly.

Traps:

- `findBatchAction` in `StudioPage.dom.test.tsx` **throws** rather than failing an expect when the
  batch control leaves the `<aside>` — four opaque "must remain pinned to the activity column" errors.
- e2e asserts **zero** buttons whose accessible name matches /Generate|Render/ inside
  `[data-studio-work-panel]` on the no-engine door — and the top bar is inside that panel.
- `EngineBar` owns Produce's only `data-studio-phase-heading`. Move it and the view-transition focus
  contract breaks for every view.
- `GenerationControls` — the component whose shape S1 wants — is dead code, rendered only by its own
  393-line test. Do not revive it; take its helpers.

---

## C6 — The state readout

`9 sections · 2:58 · 2 ready`, replacing the completion markers.

Count is `totalSceneCount`. Duration is `durationTotalSeconds` from C1.

**The third term is the trap.** `readySceneIds.length` means _ready to generate_ — it counts **down
to zero** as shots are generated. The "done" number is `selectedAssetCount`. Using the obvious field
gives a readout that runs backwards.

If it renders as `role='status'`, it must not reuse the accessible names `phase.shared.activityLabel`
or `phase.shared.activityRenderingLabel`, or two existing queries start matching two elements. Any
new countable key must be registered in `pluralLogicalKeys`, or every locale is required to define
literal `_one`/`_other` suffixes and the Slavic locales fail.

---

## Out of S1

Section model, granular apply, undo, the shelf, three card sizes, the duration and scene caps, the
Engine Strip, the folder, and the unconfirmed spend path above. Each is recorded in
`creative-studio-2-walking-skeleton.md` with what it costs.
