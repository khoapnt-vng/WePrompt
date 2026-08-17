# Creative Studio 2 — the walking skeleton

A revision of `creative-studio-2-programme-plan.md` against one goal: **see the whole flow run
on the new navigation, happy case only, then refine.**

The programme plan answers "what is the right order to build all of Creative Studio 2." That is
a different question, and its answer puts the new navigation **fourth**. This document puts it
first and argues the price is much lower than phase 2's estimate implies — because the three
views the redesign asks for already exist as components, and the seam they hang from is already
view-agnostic.

---

## 1. What I got wrong in the programme plan

**Sequence.** I sequenced 1 → 1.5 → 3a → 2 → 3b → 4 and defended deferring phase 2 as "the right
phase to defer." That holds if the objective is shipping value in stages. It is wrong if the
objective is _learning whether the navigation is right_, because under that sequence you do not
see the new shell until three phases of work have been built against the old one.

**Pricing.** I carried phase 2 at 60–80 hand-days without separating its two halves. Phase 2 is
a **navigation change** and a **model change** (scene → section → clip → take), and I priced them
as one thing. The model change is most of that number. The navigation change, on its own, over
today's flat model, is a fraction of it — and it is the half you asked to see.

---

## 2. Why the navigation change is cheap — seven facts, each checked

> Citations below name **symbols**, not line numbers. Phase 1 is merging into this branch while
> this document is being read: three citations in the first draft went stale within the hour
> (`types.ts` by 2 lines, `studioI18n.test.ts` by 1, `store.ts` by 15) because Tasks 6 and 8 landed
> after it was committed. Symbols survive that; line numbers do not.

**The controller seam is already view-agnostic.** `StudioPhaseControllers`
(`PhaseShell/types.ts`) is one flat bag — project, readiness, editor, models, jobs, render, export,
proposals — and every phase controller is a `Pick<>` of it (`WritePhaseController`,
`ProducePhaseController`, `ReviewPhaseController`). The render is documented as _"held at project
scope so it stays observable from any phase."_ New views are new `Pick<>`s. **No controller
rework.**

**Table already exists.** `phases/write/ScriptTable.tsx` is a four-column table — shot, script,
visual, output — with dnd-kit drag-to-reorder, conflict retry/discard, and the scene
limit notice. `ScriptRow.tsx` is 21 KB of per-row editing already built.

**Board already exists.** `phases/produce/ShotGrid.tsx` + `ShotCard.tsx` render an ordered grid
of cards with takes, per-scene status, cancel and single-shot review. `ShotGridProps` is
already a pure prop interface — `ProducePhase.tsx` is a 145-line composition over it, not an
owner.

**Cut already exists.** `ReviewPhase.tsx` mounts `ReviewCut` and `useCutEditor`, and holds
render progress, missing-slate counting and the export entry.

**The Table's two missing columns are already computed.** Length is `scene.durationSeconds`;
state is `readiness.sceneStatuses`. `StudioReadinessSummary` (`studioReadiness.ts`) already
returns `totalSceneCount`, `readySceneIds`, `selectedAssetCount` and `durationDeltaSeconds` —
which is the state readout (`9 sections · 2:58 · 2 ready`) with no new logic.

**Every command the flow needs already exists.** `createProject`, `proposeStoryboard`,
`acceptProposal`, `updateScene`, `reorderScenes`, `submitScenes`, `selectAsset`,
`placeCutScenes`, `updateCut`, `renderCut`, `chooseAndExportAssets`, `getLatestRender`
(the `creativeStudio` provider block in `ipcBridge.ts`). **Zero new IPC commands. Zero migrations.**

**Correction — it is _not_ zero main-process work, and the exception is a data-loss path.**
`STUDIO_ROUTE_PATTERN` in `creativeStudioBridge.ts` hardcodes `brief|write|produce|review` and gates
`isCreativeStudioRendererUrl`, which gates `createCreativeStudioCloseHandshake` — the unsaved-scene-drafts
preflight on window close and app quit. Rename the route segments without it and closing WePrompt from
`/studio/:id/table` **discards unsaved drafts with no prompt**. Worse, nothing catches it: the bridge test
defaults `getCurrentUrl` to `#/studio/project_1/write`, which still matches the old regex, so the suite
stays green while production loses work. One regex, in main, and it must land in the same commit as the
route change.

**The Engine Strip is not on this path.** `resolveSoleRouteAdoptions`
(`studioRouteDefaults.ts`) adopts a route automatically when a role has exactly one
compatible option. The live blocker fires only when **two** bindings of one media kind exist.
One image model + one video model bound → both roles adopt themselves. 8–12 days deferred, at
the cost of one stated precondition.

---

## 3. Six things I would cut, and what each costs you

| Cut                                                                             | Buys                                                                                                                                       | Costs                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Keep the flat scene model** — one scene renders as a section holding one clip | the entire model change, the biggest single item in the programme                                                                          | Table and Board get re-touched when sections land. The handoff already defines this exact shape as the migration target ("existing scenes migrate to sections holding one clip each"), so it is the degenerate case of the target model, not a throwaway. |
| **Keep `propose_storyboard` whole-script replace**                              | `apply_script_changes`, inverse ops, revision-aware undo — the item the handoff calls "the one contract change that gates everything else" | The Director stays proposal-based, which costs the skeleton nothing: the navigation is exercised identically either way. See §5.                                                                                                                          |
| **No proposal-record versioning**                                               | a versioning pass                                                                                                                          | Nothing: the model does not move, so there is nothing to version. This item was always downstream of the model change.                                                                                                                                    |
| **No shelf, one card size**                                                     | a parking surface and two more card renderers                                                                                              | Deleting a section destroys it. Acceptable in a happy path; not acceptable in a release.                                                                                                                                                                  |
| **Do not raise the duration or scene caps**                                     | nine edit sites for `targetDurationSeconds` (validated `5..60` in `validateProject`, `store.ts`) and ~twelve for `MAX_SCENES = 24`         | The skeleton runs at ≤60s and ≤24 scenes. A 3-minute piece is out of scope until phase 2 proper.                                                                                                                                                          |
| **Defer the Engine Strip**                                                      | 8–12 hand-days                                                                                                                             | A precondition, not a defect-free state: exactly one image model and one video model bound in Model Settings. Bind two video engines and generation blocks with no in-app cure — the live bug, unchanged.                                                 |

---

## 4. The skeleton — the flow, end to end

**Navigation.** The four-step rail (`STUDIO_PHASES` in `studioPhaseRoute.ts`) becomes a
three-view switch: **Table · Board · Cut**. Brief becomes a drawer, not a step — it is an object,
not a stage. Completion markers go; the state readout takes their place. One money control in the
top bar.

**The run:**

1. **Create** a project → Brief drawer opens: name, intent, duration, aspect.
2. **Brief** — talk to the Director, accept its proposed spine. Rules from phase 1 pin here and
   are enforced at render.
3. **Table** — read down the script. Edit a line, rewrite a visual prompt, retime, reorder.
4. **Board** — same order, as pictures. Drag to reorder. Read state per card.
5. **Generate** — one money control, one confirm that names what will run and what it costs.
6. **Board** — takes arrive per card; pick one per shot.
7. **Cut** — play the assembly, trim, reorder, then render.
8. **Export** — the file.

Nothing in that list needs a model change, a new command, or a new engine surface.

---

## 5. What the skeleton is not asked to answer

**The Director stays proposal-based by scope, not by constraint.** An earlier draft of this
document said the skeleton has no undo and _therefore_ the Director must stay proposal-based. That
causality is wrong twice.

Wrong on mechanism: the handoff's _per-edit_ undo means undo across a batch of granular
operations, which is exactly what `apply_script_changes` and its inverses are for. Today's writes
are coarse, and main already materializes the whole prior body inside every write —
`updateProjectInsideQueue` reads `current`, passes a clone to an arbitrary mutator, refuses only an
identity change, and force-overwrites `revision` and `updatedAt` — then discards it. Handing that
mutator a previously-observed body therefore lands as a new forward revision. **Storing a coarse
pre-image is a few dozen lines.** Deferring `apply_script_changes` defers _per-edit_ undo; it does
not imply no undo.

One correction to an earlier draft of this paragraph, which claimed the renderer already holds a
usable pre-image. **It does not.** `StudioRendererProject` is
`Omit<StudioProject, 'jobs' | 'routing'>` re-widened with _renderer-shaped_ jobs and routing
(`creativeStudioTypes.ts`), and `validateJob` rejects that shape on both its exact-key check and
`isSafeId(idempotencyKey)`. Any pre-image has to be captured in main.

And storage was never the expensive part. **A coarse revert fails open.** Job transitions go
through `mutateJob` with `expectedRevision` optional, so the revision counter moves unguarded; a
restored body that predates a submission is internally self-consistent, so `validateProject`
accepts it and silently drops the `providerJobId` of work already paid for. It also cannot reach
the rendered cut, which is a sidecar, or the write-once proposal decision ledger. Done fail-closed
— gated on the recorded post-write revision rather than a plain CAS, restoring only
`scenes`/`sceneOrder`/`rules`/`brief`/settings, and routed through cut reconciliation — it is
**2–3 hand-days**, and what it earns is a scoped _"revert this proposal"_, not Undo.

Wrong on scope, which matters more: **demonstrating the navigation does not require the Director
to edit directly at all.** The run in §4 contains exactly one Director write — step 2's spine
acceptance. Making it direct would _remove_ the review card rather than add a surface. Worse, it
would confound the very thing under evaluation: `DirectorPane` mounts at page scope, so a
direct-editing Director writes concurrently with the 450 ms scene autosave
(`SCENE_SAVE_DEBOUNCE_MS`), injecting write collision into the navigation being assessed, on a run
declared happy-case. It would also cost §2's "zero new IPC commands" — the claim that justifies
sequencing the navigation first.

So direct edits and undo are out of the skeleton deliberately, and open question 4 — _"will users
trust a director that edits directly"_ — is not on trial here. Do not read a good skeleton
walkthrough as evidence either way on it.

**One thing the skeleton will expose that the old shell hid**: with Produce gone as a step, the
money control sits next to the authoring views permanently. Whether that reads as convenient or
as dangerous is a real finding, and worth watching in the walkthrough.

---

## 6. Four slices

Each slice ends green and runnable. Sizes are hand-days; the observed rate on phase 1 was ~1 day
for what was estimated at 20–26, so schedule against sessions, not the column.

|        | Slice                                                                                                                                                                                                     | Hand-days |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **S1** | The view switch: `STUDIO_VIEWS = ['table','board','cut']`, route, persisted-view migration, `StudioViewSwitch` replacing `StudioPhaseNav`, state readout, money control in the top bar, Brief as a drawer | 3–4       |
| **S2** | Table view: `ScriptTable` re-mounted as a view, plus the length and state columns                                                                                                                         | 1–2       |
| **S3** | Board view: `ShotGrid` re-mounted as a view, plus drag-to-reorder (copy `ScriptTable`'s dnd-kit block)                                                                                                    | 1–2       |
| **S4** | Cut view: `ReviewPhase` re-mounted as a view; export stays where it is                                                                                                                                    | 1         |

**Known test surface**, which is where the real work sits: 24 studio unit tests reference phases;
`studioI18n.test.ts` hardcodes an exact `phase.*` key list including `phase.nav.brief|write|
produce|review`; `StudioAccessibleCopy`, `StudioPage.dom` and `StudioPhaseHeader.dom` assert phase
copy. The 674-line e2e spec is cheaper than it looks — it couples to
`[data-studio-phase-shell]` at four selector sites, and **keeping that attribute name** costs
nothing because it is a test hook, not user-facing copy.

---

## 7. The one thing not to cut: translation

Skipping the other locales looks like the obvious saving and is not one — though not for the
reason I would have guessed. `scripts/check-i18n.js` only **warns** on missing keys and empty
values (`logWarning`, and only `hasErrors` exits non-zero), so the script would let English-only
through. The hard gate is a test: `studioI18n.test.ts`'s _"keeps every configured locale exactly in parity"_ asserts every configured locale is in
**exact parity**, non-empty, placeholder-compatible, carries **zero** copied new full-sentence
keys, and leaves at most `max(4, 5% of keys)` English strings anywhere. `just push` runs the
suite, so that is a red gate.

Which means the choice is not "translate or don't" — it is "translate, or argue for an exemption
against a test written specifically to refuse one." Translation is generation and costs an agent
minutes. Do the twelve.

New keys land under `view.*`; the retired `phase.*` keys come out of all twelve in the same
commit as the code that stops reading them, and out of `studioI18n.test.ts`'s list in that
commit too — that file is a cross-slice contract no slice owns, so whichever slice moves a key
owns the list.
