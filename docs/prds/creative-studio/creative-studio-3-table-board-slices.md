# Creative Studio 3 — Table and Board: delivery slices

**Status:** owner-directed 2026-08-27. Rulings recorded in §2 are settled; do not re-open them from
the pixels.
**Design:** `Creative Studio 3 - Table and Board (standalone).html` and its handoff.
**Baseline:** branch `codex/creative-studio-table-board-ui-design` @ `0c3d541a3`.

---

## 1. The brief, in the owner's words

> **Problem to solve:** Table and Board are doing the same job; I cannot plan the story efficiently
> over Table, and the Director actually skips using the table; I cannot monitor what shot is going
> where.
>
> **Table:** Once References and Storyboard are approved, the Director will draft the storyboard.
> This is not optional.
>
> **Board:** Once Table is set, users can start generating and monitor through Board.

Call these **Rule A** (the Director drafts) and **Rule B** (generate and monitor on the Board).

---

## 2. Rulings

**R1 — Money is governed by the gate, not by the view.** The handoff's §2.8 rule ("money exists in
exactly two places") is retired. It was already false: reference-image generation spends from the
References view and from the Director's own cards, and references are a hard prerequisite for any
shot generation — so the rule as written outlawed a step the product requires. Replacing it:

> **Any view may start paid work. Every paid action goes through the same spend gate, which names
> the amount and requires an explicit Confirm. No view spends silently.**

This is what the engine already enforces (`prepareSubmission` is a free pure read; only
`confirmSubmission` spends), so it costs nothing to adopt and removes a constraint that would have
generated busywork. Slice 11 is rescoped accordingly: **job recovery** moves to the Board because
that is where the user is watching; **spend does not have to move.**

**R2 — Structure after the Board becomes monitoring.** `reorderBeats` moves to the Table, because
ordering beats is a story decision. The **Bin stays on the Board**, below the tiles, along with
`restoreBeat`, `restoreShot` and `reorderBin`; moving it costs work and buys nothing. `parkBeat`
already has a home in the Beat panel.

---

## 3. The diagnosis, corrected

**The Table and the Board do not do the same job — the cut is on the wrong axis.** Their action
surfaces are already disjoint: the Board owns structure (`reorderBeats`, `parkBeat`, `restoreBeat`,
`restoreShot`, `reorderBin`, the Bin) and spends nothing; the Table owns every panel-still spend,
all four job-recovery controls, and the only editing affordance in either view. What makes them
_look_ redundant is that they share one derivation (`WorkspaceBeatProjection.displayState`) and
declare `STATE_KEYS` twice — `Views/Table/index.tsx:47-58` and `Views/Board/index.tsx:26-37`.

So today's cut is **structure vs spend**. The design's cut is **story vs monitoring**. Those are
orthogonal, which means this is a redraw of both views rather than a move of controls between them.

**Three facts, each verified by grep against this baseline, decide the whole sequence.**

1. **The Table never reads `shootingScript`.** Zero occurrences in `Views/Table/index.tsx`. It shows
   `beat.story`, whose median length across the owner's 63 beats is **0 characters**. The Table
   literally cannot show what a shot depicts. Problem #2 is therefore a **grain** problem, and the
   fix is renderer-only — `shootingScript` is already on `WorkspaceShotProjection:108`.
2. **The Board renders zero per-shot tiles.** One card per beat. "Monitor what shot is going where"
   has no surface at all. Every fact it needs is already projected (`segmentHead`, `frameBoundary`,
   `segmentState`, `dirtyCauses`).
3. **There is no renderer call site for `add_beat` or `add_shot`.** `grep -rn` across
   `packages/desktop/src/renderer` returns four hits, all in `i18n-keys.d.ts` and `locales/`. The
   operation kinds, reducer, undo patch, validator and renderer type all exist; only the UI is
   missing. **Rule A does not create a dependency on the Director — it removes the pretence that an
   alternative ever existed**, and today every Director failure is therefore terminal.

**On `coverageGapBeatIds`:** it is computed on every render (`workspaceProjection.ts:246, :1683`) and
consumed by nothing outside its own file. The gap detection Rule A needs already exists and is dead.

---

## 4. Blockers — these make Rule A unsafe to state until they land

|        | Blocker                                                | Why it blocks Rule A                                                                                                                                                                                     | Fixed by                                      |
| ------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| **B1** | No user-side Add Shot / Add Beat                       | Every Director failure is terminal; mandating the Director with no fallback deadlocks the product                                                                                                        | Slice 4                                       |
| **B2** | **BUG-160** — proposals destroyed by ordinary use      | The mandated path destroys its own output. Worse, Rule A's happy path _is_ the self-invalidating turn: approving references moves the revision, which stales a proposal made in the same turn            | Slice 5                                       |
| **B3** | `preset_rules` frozen at first attach                  | A Director instruction change reaches **no project already in flight**                                                                                                                                   | Slice 6                                       |
| **B4** | **BUG-161** — fixed-ness invisible to the Director     | `read_storyboard` exposes 3 of 7 fixed reasons, so `expectedFixed` is uncomputable on any beat that has touched generation                                                                               | Slice 7                                       |
| **B5** | Take removal half-landed                               | `remove_video_take` nulls `videoAssetId` while keeping the asset, so a rendered shot reads NOT READY on a per-shot tile                                                                                  | Slice 9                                       |
| **B6** | No queue ordinal exists                                | The queue bar can count QUEUED; it can never say "3rd in line". `activeGenerationJob` is gated on exactly one active job, so a shot with a seed _and_ a video in flight reports `null`                   | Slice 10                                      |
| **B7** | Board fixtures compile while missing projection fields | `tsc --noEmit` covers only `packages/desktop/src`; `BoardView.dom.test.tsx`'s `makeShot`/`makeProjection` already omit required fields. Adding fields produces no type error, just `undefined` at render | every projection slice must name its fixtures |

---

## 5. Slices

Ordering rule: each slice leaves the product shippable. Smallest real value first.

**Required:** 1 → 11. **Conditional:** 12. **Optional:** 13, 14.

### Slice 1 — Make failure legible _(REQUIRED, ~half a day)_

**Goal:** a beat or panel that FAILED must not read more neutral than one that is merely STALE.

**Why independently shippable:** it is the cheapest correction to problem #4 that exists, it fixes a live defect on today's UI, and nothing else in this plan depends on it. If slice 2 never lands, the app is still strictly better at showing failure.

**Files touched**

- `packages/desktop/src/renderer/pages/studio/components/Workspace/Views/Board/Board.module.css` — add `.state[data-state='needs_attention']`; I verified there is no such rule today (the Board's only `data-state` rules are at `:254-276`, covering nine of ten values), so `needs_attention` falls through to `.state`'s `var(--color-text-2)`.
- `.../Views/Table/Table.module.css` — same gap at `:232-254`.
- `tests/unit/pages/studio/workspace/TableView.dom.test.tsx:1290-1310` — the enumeration covers nine of ten states; add `needs_attention`.
- `tests/unit/pages/studio/workspace/BoardView.dom.test.tsx` — same.

**Classification:** renderer-only.

**Acceptance**

- Both stylesheets define a rule for all ten `WorkspaceBeatDisplayState` values; a test asserts the tenth (extend the existing `.dom.test.tsx` enumeration, which is already index-driven).
- **LIVE:** jsdom does not compute CSS-module styles, so the colour must be confirmed in the running renderer on a project with a `needs_attention` beat. Force one by cancelling a video take mid-flight. Confirm `needs_attention` reads as danger and is visually distinct from `stale`.

**Risk:** none of consequence. No locale keys, no exact-key sets, no schema. The only trap is the repo's `uno.config.ts` border-utility shadowing — use the `--color-danger-*` tokens the file already uses at `Board.module.css:268-271`, do not invent a utility class.

---

### Slice 2 — Table shot sub-rows carrying the shooting script _(REQUIRED — this is the fix for problem #2)_

**Goal:** the Table can answer "is the story right?" — expanding a beat shows its shots as vertical sub-rows aligned to the beat columns, each carrying its shooting script, its seconds, and its chain position.

**Why independently shippable:** it is the single largest value delivery in this plan and it needs nothing from any other slice. `shootingScript` is already on `WorkspaceShotProjection:108`; `segmentHead` at `:119`; `durationSeconds` at `:109`. No projection change, no model change, no Director change, no spend surface moves, no Board work. If slice 3 never lands, story planning already works.

**Files touched**

- `.../Views/Table/index.tsx` — replace the `colSpan={columnCount}` detail row (`:852-1016`) and its horizontal 180px card strip with real `<tr>` sub-rows. The ARIA arithmetic at `:644` (`aria-rowcount={beats.length + 1 + (openBoardBeatIndex < 0 ? 0 : 1)}`) and `:698` (`beatAriaRowIndex = row + 2 + …`) goes from "+1 for at most one open detail" to "+k for the open beat's shot count". Keep the row body → Beat panel behaviour at `:822-830` untouched; it is already correct.
- `.../Views/Table/Table.module.css` — kill `.detailPanels`'s `overflow-x: auto` flex strip (`:398-412`); add a two-line clamp on the script cell. **There is currently no truncation CSS for `.cell` anywhere in this file** — `.panelStatus` (`:473-479`) is the file's only `text-overflow: ellipsis`, and `:1322-1324` actively forbids clamping `.durationFact`, so add the clamp on a new class, not on `.cell`.
- `tests/unit/pages/studio/workspace/TableView.dom.test.tsx:463-505` — pins the exact rowcount/rowindex sequence and `expect(onOpenBeat).not.toHaveBeenCalled()` (`:486`). Update the geometry; keep the "expanding never opens the Beat panel" assertion.
- Locale: one key for the expand/collapse label per shot, in all 12 locales **in the same commit**.

**Classification:** renderer-only.

**Acceptance**

- Expanding a 6-shot beat produces 6 `role='row'` sub-rows, `aria-rowindex` contiguous with the beat rows, `aria-rowcount` equal to `beats.length + 1 + openShotCount`.
- Each sub-row shows the shot's script clamped to two lines, its seconds, and either CHAIN HEAD or its predecessor's beat-relative number (derive from the map's confirmed rule: `segmentHead === false` at index `i` ⇒ conditioned by index `i-1`, 1-based number `i`).
- **LIVE:** jsdom computes no layout, so the clamp is unverifiable by unit test. Open project `748ae58b_386f_452c_b4b1_6c3819fb02ed` (36 shots, scripts 422–593 chars, median ~458) at the real pane width with the Director rail open, and confirm a 6-shot beat fits on one screen and the full text is reachable. The unclamped version renders ~7 lines per shot; the whole point is that the measurement is visual.
- **LIVE, same-day probe before writing any of this:** drop `shot.shootingScript` into the existing 180px detail card and look at it. It will not fit. That five-minute demonstration is the argument for the grain change and costs nothing if it is wrong.

**Risk:** the tests pinning ARIA geometry are the whole risk surface and they are load-bearing — do not weaken them, re-derive them. `TableView.dom.test.tsx:1313-1325` asserts `.grid { min-inline-size: <n>px }`; that floor (1040px today, from 46+176+100+68+96+96 fixed + a ≥458px STORY) does not change in this slice but the test reads the compiled CSS, so any stylesheet edit near it can trip it. No exact-key sets, no schema version, no locale key deletions.

---

### Slice 3 — Table LENGTH becomes SUM _(REQUIRED, small)_

**Goal:** stop render state leaking into the Table's duration column.

**Why independently shippable:** two lines of projection plus a cell change. It fixes a real correctness defect on its own: today's LENGTH column silently switches from _authored seconds_ to _measured render seconds_ the moment a take lands, because `beat.actualSeconds` sums `studioShotPlayedDurationV2` (`workspaceProjection.ts:732-747`), which returns the trimmed rendered duration whenever `videoAssetId !== null` (`common/types/project/creativeStudioProjectSummary.ts:128-170`). That is render state in the view that is supposed to have none.

**Files touched**

- `.../Workspace/workspaceProjection.ts` — add `sumSeconds` to `WorkspaceBeatProjection` (`:141-150`). The value already exists: `studioPlanningShotBoundariesV2` is already called at `:1123` and `:1532`, and the last boundary's `endSeconds` _is_ the authored sum.
- `.../Views/Table/index.tsx:699-713, :798-806` — render `sumSeconds` when the beat has coverage; keep `targetSeconds` for empty beats.
- Locale: rename the `table.columns.length` value (key stays), 12 locales, same commit.
- Fixtures: `tests/unit/pages/studio/workspace/{TableView,BoardView,BeatPanel,CutView,Bin}.dom.test.tsx` — see **B9**; adding a projection field produces no type error in these files.

**Classification:** renderer + projection.

**Acceptance**

- A beat whose shots are authored at 6+6+5s reads `17s` before and after any take renders. Assert exactly that in `TableView.dom.test.tsx` with a fixture that flips `videoAssetId` and trims between the two reads — that is the regression this slice exists to prevent.
- **LIVE:** render one shot in a beat and confirm the Table number does not move.

**Risk:** locale — `studioI18n.test.ts:1467` asserts `expect(Object.keys(leaves).toSorted()).toEqual(expectedLeaves.toSorted())` (exact set equality) and `:1950` repeats it per locale across all 12. Changing a _value_ is free; adding or removing a _key_ requires editing `expectedLeaves` in the same commit. Keep the key `table.columns.length` and change only the string, or pay the key-set edit knowingly. No stored-shape change, no `SHOT_KEYS`, no schema version.

---

### Slice 4 — Coverage-gap banner and a user-side Add Shot / Add Beat _(REQUIRED — the recoverability floor for Rule A)_

**Goal:** the Table names its own gaps and offers two exits — ask the Director, or author it yourself.

**Why independently shippable:** it revives dead code and adds the missing call site for operations that already exist end to end. On its own it converts every Director failure mode from terminal to merely annoying. If Rule A is never enforced, this is still the fix for "I have an empty beat and no way forward."

**Files touched**

- `.../Workspace/workspaceProjection.ts:246, :1683` — `coverageGapBeatIds` is computed every render and, I verified, has **zero consumers** in `packages/desktop/src` (only four test fixtures). Light it up. Add `unscriptedShotIds` next to it (active shots with `shootingScript.trim().length === 0`) — this is the one clause of "the Table is set" that is genuinely new.
- `.../Views/Table/index.tsx` — a gap banner ("4 of 6 Beats have no Shots"), an **Ask the Director** action, and an **Add Shot** / **Add Beat** control. Promote `requestResplit` → `focusDirectorForReviewedRequest` (`StudioPage.tsx:1947` → `:1357-1361`) from an error-styled hint to a first-class affordance.
- `packages/desktop/src/renderer/pages/studio/StudioPage.tsx` — the missing `applyAuthoringBatch` call sites. Both operations are already permitted by `StudioRendererAuthoringOperationV2` (`creativeStudioTypes.ts:847-877`), both reducers exist (`mutations/index.ts:1630` for `add_shot`), and the undo labels are already translated (`locales/*/conversation.json`, `controls.undoLabel.add_shot` / `add_beat`).
- Locale: banner copy, 12 locales, same commit.

**Classification:** renderer + projection.

**Acceptance**

- A project with an empty beat shows the banner; **Add Shot** creates a shot; undo reverses it using the existing `add_shot` undo label.
- A shot with an empty script is counted in `unscriptedShotIds` and surfaced.
- **LIVE:** create a fresh project, never talk to the Director, author a beat and a shot by hand, and confirm the Beat panel opens on it and the reference-binding editor works. This exercises exactly the recovery path that does not exist today; a unit test cannot prove the IPC round trip. Note that `applyAuthoringBatch` failures surface as a _hang_, not an error (main throws are swallowed by `bridge.invoke` — a known trap in this codebase), so check the store on disk, not just the UI.
- New shots are born `referenceBinding: { status: 'unassigned' }` (`mutations/index.ts:1653-1658`) — the banner must say so, or the user will hand-author a shot and find it unpayable.

**Risk:** no schema change — these are existing operation kinds with existing validators and undo patches. The projection additions hit **B9** (five fixture files, no type error). Locale key-set: two new keys × 12 locales + `expectedLeaves` in `studioI18n.test.ts`, all one commit.

---

### Slice 5 — A durable proposal surface (BUG-160) _(REQUIRED before Rule A)_

**Goal:** a Director proposal survives the next Director message, and a stale one can be re-proposed instead of vanishing.

**Why independently shippable:** it fixes a bug the owner has already hit, with the Director drafting _optionally_. It makes the current flow usable whether or not Rule A is ever stated.

**Files touched**

- `packages/desktop/src/renderer/pages/studio/StudioPage.tsx:3683-3685` — stop silently filtering `actionableProposals` to `baseRevision === project.revision`; keep stale ones and mark them.
- `:3375-3378` — replace the `pending.length !== 1` refusal (`chatMultiplePending`) with disambiguation.
- `:3697` / `:3286` — `blockMutationProposalAcceptance={closeDirtyDraftCount > 0}` disables Accept whenever _any_ unsaved workspace draft exists; say which draft, and offer to save it.
- `.../Views/Table/index.tsx` or `.../Views/WorkspaceControls.tsx` — a workspace-level pending-proposal region. The Table is the natural home: it is the thing being proposed against.
- `packages/desktop/src/renderer/pages/studio/components/Shell/DirectorProposalCard/index.tsx:158, :195-204` — the card must render in both places.
- Locale: stale + re-propose copy, 12 locales, same commit.

**Classification:** renderer-only.

**Acceptance**

- Accept one of two sibling proposals; the other is still visible, labelled stale, with a re-propose action.
- Send three more Director messages; the pending proposal is still reachable without scrolling the transcript.
- **LIVE, non-negotiable:** drive the Director through an actual 6-beat draft in the running app, approve a reference generation in the same turn (the revision-moving action that causes the self-invalidating turn), and confirm the proposal is recoverable. This is a multi-turn agent interaction; no unit test reproduces it. Use the renderer CDP endpoint on port 9230, and remember assistant replies live in a shadow root — `document.body.innerText` cannot see them.

**Risk:** renderer-only, no stored shape. The one real hazard is that `proposalReview.ts:285-287` already returns `status: 'stale'` for these — do not re-derive staleness, consume it. Locale key-set contract applies as always.

---

### Slice 6 — Director drafting as a numbered step, and `preset_rules` that reach existing projects _(REQUIRED for Rule A)_

**Goal:** the Director is _told_ to draft, is told how to batch it, and the telling reaches projects that already exist.

**Why independently shippable:** with slices 4 and 5 in, this makes Rule A a strong default. It is still valuable if slice 7 never lands — the Director will draft correctly on empty beats, which is the fresh-project case.

**Files touched**

- `.../Workspace/DirectorRail/openingTurn.ts:66-110` (`DIRECTOR_PRESET_RULES`) — today the only ordered procedure is the eight-step reference workflow, whose step 8 binds references "for each active Shot" that no step creates. Add drafting as a numbered phase _before_ it. State the batching shape explicitly: **one `propose_storyboard` containing `add_beat` then `apply_coverage` per beat — 12 operations for a 6×6 film, one proposal, one click** — not one `add_shot` per shot (42 ops, over `STUDIO_MAX_MUTATION_OPERATIONS = 32`, and the split is what BUG-160 destroys). State the BUG-161 rule the Director cannot infer: `apply_coverage` fills empty coverage and never rewrites an existing script. Give line 74's absolute brake (`'Do not call studio_apply_edits or propose_storyboard until the person has agreed a direction'`) a stated exit condition; an agent with an unbounded brake and a one-clause accelerator (`'then build it'`) will keep asking questions.
- `.../Workspace/DirectorRail/index.tsx:615, :722, :832-851, :1046` — re-provision `preset_rules` on re-attach to a bound conversation, not only at `createDirectorConversation`.
- `packages/desktop/src/common/types/project/creativeStudioTypes.ts:1635-1646` (`studioDirectorCapabilityRulesV2`) — the permission language is triggered by "when the person asks you to make the film"; retune it to the new procedure.

**Classification:** renderer + prompt. No model change.

**Acceptance**

- On a project created _before_ this ships, re-attaching the Director carries the new rules (check the persisted `extra` in `storage.ts`, field commented "System rules injected at initialization" at `:487`).
- **LIVE, non-negotiable:** three fresh projects, three different briefs. In each, after references are approved, the Director drafts a full storyboard **in one proposal** without being asked twice. Count the operations in the proposal — if it is 42, the batching instruction did not take. Prompt behaviour cannot be unit-tested.
- **LIVE prerequisite:** the map's claim that `add_beat` followed by `apply_coverage` on the _same new beat_ succeeds inside one batch is read off the reducer's sequential draft semantics (`mutations/index.ts:1533-1554`, `:1786-1790`); no test exercises that pairing. **Write that reducer test before writing it into the Director's rules.**

**Risk:** the prompt is merged into `system_prompt` inside aioncore, outside this repo — how it is positioned relative to the model's own system prompt is unverified. Budget for a second tuning pass. No schema, no locale key-set (these are prompt constants, not i18n).

---

### Slice 7 — `read_storyboard` reports fixed-ness, and refusals say why (BUG-161) _(REQUIRED for Rule A on non-empty beats)_

**Goal:** the Director can choose a viable operation instead of burning a turn, and a refused proposal becomes a detour rather than a dead end.

**Why independently shippable:** it is a read, not a power. It improves Director reliability on any project with existing work, whether or not Rule A is enforced.

**Files touched**

- `packages/desktop/src/process/resources/builtinMcp/studioServer.ts:945-961` — add `fixedReasons` per shot to the read-back view. Of the seven in `FIXED_REASON_ORDER` (`mutations/index.ts:1031-1039`), only three are currently derivable by the Director; `owned_asset`, `owned_job`, `conditioning_frame`, `conditioning_input` are invisible, which is why `expectedFixed` is uncomputable on any beat that has touched generation.
- `.../Workspace/... proposalReview.ts:328-331` — `deriveStudioProposalReviewV2` collapses every reducer throw into `{ status: 'unavailable', reason: 'reducer_rejected' }`. Carry the reducer's actual code and subject.
- `components/Shell/DirectorProposalCard/index.tsx:158, :202-204` — replace the generic `reviewUnavailable` ("This proposal contains an unsupported change") with the specific reason, plus an "edit these Shots directly" action, which is reachable today via the Beat panel's `saveShot`.
- Locale: specific refusal strings, 12 locales, same commit.

**Classification:** main (read-only additive to an MCP tool result) + renderer. No stored shape, no migration.

**Acceptance**

- `read_storyboard` on a shot with a rendered take reports `owned_asset` and `owned_job`.
- A refused `apply_coverage` names the shots and the reason.
- **LIVE:** ask the Director to re-cover a beat that already has scripts. It should either decline with a correct explanation or propose `edit_shot` instead — the observable is that it _stops_ emitting a doomed `apply_coverage`.

**Risk:** the MCP tool result shape is not a persisted record, so no exact-key set and no schema version. Do **not** widen the tool's _input_ schemas (`studioServer.ts:147, :164-170, :288`) in this slice — those mirror `StudioEditableShot` and touching them pulls in the model. Locale key-set contract applies.

---

### Slice 8 — One owned status vocabulary _(REQUIRED before Slice 10)_

**Goal:** the six status words exist once, in a module that owns them, before a fourth consumer is built.

**Why independently shippable:** it is a pure refactor with a visible payoff — the duplicated `STATE_KEYS` map disappears and the Board stops pointing at `table.state.*`. It ships with zero behaviour change and makes slice 10 additive instead of divergent.

**Why this slice exists at all:** the six words are not new. `ShotComposerStatus` at `.../Workspace/BeatPanel/index.tsx:231` is already `'notReady' | 'ready' | 'queued' | 'rendering' | 'rendered' | 'failed'`, with copy that matches key for key ("Not ready", "Ready to render", "Queued", "Rendering", "Rendered", "Failed"). Building them again on the Board would make a **fourth** parallel vocabulary alongside `WorkspaceBeatDisplayState` (10 values), `WorkspaceShotSegmentState` (12 kinds) and `ShotComposerStatus`. The precedent for how that decays is in the repo already: the last time two views needed the same words, the answer was to duplicate the map — and the result is `needs_attention` with no colour rule in either stylesheet (Slice 1).

**Files touched**

- New module under `.../Workspace/` (e.g. `shotStatus.ts`) — lift `shotComposerStatus` (`BeatPanel/index.tsx:233-255`) out verbatim, and add the branch it is missing: it has **no case for `segmentState.kind === 'stale'` or `'needs_rerender'`**, both of which currently fall through to `rendered` because `currentPicture !== null`. That is already the qualifier semantics the design wants; make it explicit and return `{ word, stale }` rather than a seventh word.
- `.../Workspace/BeatPanel/index.tsx:231, :709-712` — consume the module.
- `.../Views/Board/index.tsx:26-37` and `.../Views/Table/index.tsx:47-58` — delete one of the two `STATE_KEYS` maps; both must import the same one. Note `.../Views/Cut/index.tsx:26-35` and `.../Views/Board/Bin.tsx:411` are the other two consumers of `displayState`.
- Locale: move the six status keys to a namespace that is not `table.*`. **This is a key rename across 12 locales plus `expectedLeaves`** — see Risk.

**Classification:** renderer + projection (the stale qualifier is derived, not stored).

**Acceptance**

- Exactly one definition of the six words exists; a grep for a second `satisfies Record<…displayState, string>` returns nothing.
- The Beat panel's rendered `data-composer-status-word` values are byte-identical before and after.
- The stale qualifier is returned alongside `rendered`, and is not a seventh word.
- **LIVE:** open a beat with a stale shot; the composer still reads "Rendered" and now also carries the stale mark.

**Risk — the highest locale risk in this plan.** `studioI18n.test.ts:1467` asserts exact key-set equality and `:1950` repeats it per locale across 12. A rename is a delete _and_ an add, in `expectedLeaves` and in all 12 files, in one commit. Separately: **`WorkspaceBeatDisplayState.stale` and `WorkspaceBoardPanelFreshness.stale` are not touched by this slice.** Say so out loud in the commit message. If "STALE is a qualifier" is done only for the new tiles, `buildStudioBarStats`'s `readyCount` (`workspaceProjection.ts:1727-1741`, which counts _beats_ with `displayState === 'ready'` and drives the top bar's "N READY") silently changes meaning while the Cut and the Bin keep the old semantics. That is the three-months-from-now regret, and this slice is where it is either prevented or created.

---

### Slice 9 — Finish take removal _(REQUIRED before Slice 10)_

**Goal:** `videoAssetId === null` means exactly one thing — nothing has rendered yet.

**Why independently shippable:** it closes an illegal state that exists today, on today's UI. The take-removal spec at `docs/design/creative-studio-3-take-removal.md` already committed to this; it is half-landed.

**Files touched**

- `packages/desktop/src/process/services/creative-studio/service/schema2/mutations/index.ts:1966-1989` (`select_video_take`) and `:1992-2010` (`remove_video_take`) — delete. I read the second: it writes `videoAssetId: null` alongside `supersededVideoAssetIds: successfulVideoAssetIds(draft, shot)`, i.e. a shot with a finished MP4 on disk reading as never rendered. `select_video_take` sets `videoAssetId` from a superseded asset in a second, separate write — the two-step the spec's invariant forbids.
- `creativeStudioTypes.ts:1574-1575, :863-864` — union members; `mutations/index.ts:128-129, :564-565` — key sets and dispatch; `studioServer.ts:466-476, :557-558`; `StudioPage.tsx:1638-1653`.
- `.../Workspace/BeatPanel/FirstFrames/index.tsx:122-123, :247, :253, :398, :542, :584-588, :633` — the take gallery. Replace with a single current-picture card and one **Generate again** action.
- `.../Workspace/workspaceProjection.ts:75, :127, :622-646` — `WorkspaceVideoTakeProjection` and `videoTakes` leave the projection with it.
- Locale: delete `beatPanel.firstFrames.menu.previousTakes`, `.removeTake`, `viewer.take`, `viewer.useTake` (`en-US/conversation.json:1841, 1842, 1847, 1850`). **Keep** `gate.purpose.video_take` (`:2268`) — it is a purpose id, not vocabulary. **Reword, do not delete,** `gate.promotion.*` (`:2240-2256`, nine strings) to say "picture" instead of "take".

**Classification:** renderer + projection, plus a model-**vocabulary** deletion with **no stored-shape change** — these are operation kinds, not persisted fields; nothing on disk names them.

**Acceptance**

- No code path can produce a shot with a non-empty `supersededVideoAssetIds` and `videoAssetId === null`.
- The Beat panel shows one picture and one action.
- **LIVE:** render a shot twice and confirm the second replaces the first with no gallery, and that the Cut and the beat length both follow the new picture.

**Risk:** deleting _operation kinds_ is safe — they are not in `SHOT_KEYS` and not in any stored record. Do **not** rename `takeAssetId` in this slice (`creativeStudioTypes.ts:404, :480`, exact-key sets `validation.ts:305, :311`): those live inside **frozen job snapshots on disk**, so the spec's "rename only" line understates it — that is a `hasExactKeys` failure, i.e. BUG-136 project quarantine. Locale: four deletions + nine rewordings, `expectedLeaves` edited, all 12 locales, one commit.

---

### Slice 10 — Board shot tiles, read-only _(REQUIRED — this is the fix for problem #4)_

**Goal:** the Board answers "what shot is going where" — one tile per shot under its beat header, with status, chain position, and why it is blocked.

**Why independently shippable:** the Board gains nothing paid in this slice, so it cannot break spend. It ships as a pure monitoring wall while all generation stays on the Table. If slice 11 never lands, the owner can still watch the film arrive.

**Files touched**

- `.../Views/Board/index.tsx:241-463` — a full redraw. Today it renders one card per beat with the cover picked as `beat.shots.find(shot => shot.coverAssetId !== null)?.coverAssetId` (`:89-90`), so a beat whose shots 2–5 failed still shows shot 1's picture. Every fact the tiles need is already on `beat.shots[]`: `segmentHead` (`:1549`), `frameBoundary`, `segmentState`, `dirtyCauses`, `attentionJobs`, `videoGenerationInFlight` / `seedGenerationInFlight`, `currentPicture`.
- `.../Views/Board/Board.module.css` — one tile size. The removed "Card size" control's absence is test-guarded (`BoardView.dom.test.tsx:403-404`); keep it removed.
- `.../Workspace/workspaceProjection.ts` — beat header counts (`n of m rendered`, stale count). Optionally surface `predecessorShotNumber`, currently computed at `:1159` / `:1558` but consumed only into `firstFrames[].sourceShotNumber` (`:617`).
- `StudioPage.tsx:677-705` — `beatPanelReviewGraphs` is already computed **film-wide** for every shot in `projection.activeShotIds`, each carrying `block: { item, reason: StudioGenerationBlockV2 }`, with ready i18n messages (`Gate/generationBlockers.ts:105-138`) and repair actions (`:140-157`). It is currently passed only to `BeatPanel` (`WorkspaceControls.tsx:390`). Pass it to the Board — this is the complete, already-computed "why is this shot not ready" table.
- `.../Views/WorkspaceControls.tsx:347-359` — widen the Board's props.

**Classification:** renderer + projection.

**Acceptance**

- Every active shot has exactly one tile; a beat whose shot 3 failed shows a failed tile, not shot 1's picture.
- Tiles carry one of the six words from Slice 8's module, plus a stale qualifier, plus CHAIN HEAD or AFTER _n.m_.
- The queue bar shows **counts, never ordinals** (B6), and aggregates off `videoGenerationInFlight` / `seedGenerationInFlight`, **never** off `activeGenerationJob` or `generationProgressPercent` — both are `null` when two jobs are in flight on one shot.
- A blocked shot shows its `StudioGenerationBlockV2` reason. **State explicitly in the tile that `reference_binding` is cleared on the Table** — its remedy action `openReferenceFocus({ shotIds })` navigates to `'table'` (`StudioPage.tsx:444-449`), and since both `apply_coverage` (`mutations/index.ts:1856-1868`) and `add_shot` (`:1653-1658`) mint shots `unassigned`, **every Director-drafted shot hits this on day one**. If the tile does not say where to go, QA will find it.
- **LIVE:** with two jobs in flight on one shot, confirm the queue bar counts it. Confirm on a project with an intentionally-parked beat that the Bin still works (ruling **R2**: the Bin stays on the Board).

**Risk:** **B9** — the fixtures compile with missing fields. List `BoardView.dom.test.tsx`'s `makeShot` (`:234-262`) and `makeProjection` (`:290-310`) as files touched, and add an explicit fixture-completeness assertion; otherwise the tests pass while the tiles render `undefined`. No stored shape, no schema. Locale: a substantial new key block × 12 locales + `expectedLeaves`, one commit — do **not** batch i18n at the end of this slice; a repo test requires every referenced key in all 12 locales, so batching designs in a red window.

---

### Slice 11 — Move job recovery to the Board _(REQUIRED for Rule B)_

**Goal:** job recovery lives where the user is watching.

**Rescoped by ruling R1.** The original slice moved _spend_ off the Table as well. Under R1 spend is
governed by the gate rather than by the view, so **panel-still generation may stay on the Table if
moving it is not otherwise worthwhile** — the required part is that the four job-recovery controls
and the render-state strip leave the Table, because the Table must not report render state. Treat
the spend relocation below as optional, and take it only if it falls out cheaply.

**Why independently shippable:** it is the last step of Rule B and depends on slice 10 having a place to put the controls. Until it lands, slice 10's Board is a read-only monitor and the Table still works exactly as today.

**Files touched**

- `.../Views/Table/index.tsx` — remove the `<section role='region' aria-label='Director Board controls'>` strip (`:578-639`, including the `<progress>` element and `{{drawn}} of {{total}} panels drawn`), `drawBeat`/`redrawBeat` (`:882-906`), `redrawShot` (`:991-1006`), `promotePanel` (`:974-990`), and `BoardPanelRecoveryControls` (`:154-218`). **Keep `ShotReferenceBindingEditor` (`:249-354`) on the Table** — it is the remedy for the one blocker that is genuinely about "is the story right", and slice 10's tiles point here.
- `.../Views/Board/index.tsx` — receive them. Note that `drawNext`/`drawBeat`/`redrawBeat`/`redrawShot` all draw **`board_still` panels** (`spendGate.ts:597, :640`) batched under `STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24`, whereas video takes come from the Beat panel and the top bar. Two generation economies, one word "board". A per-shot-tile design has no natural home for a 24-shot batch — decide whether the batch control lives on the beat header or is dropped, and say which.
- `StudioPage.tsx:2055-2181` — the action owners move with the callers. `TableBoardActions.setStyle` (`Table/index.tsx:222`, implemented `StudioPage.tsx:2055-2065`) is **already dead** — never called, its UI removed — yet `boardStyle === null` still hard-locks all generation at `Table/index.tsx:454`. Delete it and its four orphan locale keys (`table.board.style.*`, `table.board.styleRequired`, pinned at `studioI18n.test.ts:369-372, :377` and again in `localizedBoardKeys` ~`:1172-1185`); `boardStyle` defaults to `'grey_tone'` at `factories.ts:46`, so the lock is unreachable in practice.
- Locale: the whole `table.board.*` block moves namespace.

**Classification:** renderer-only.

**Acceptance**

- `TableBoardActions` no longer contains any spending or job-recovery member; a grep of `Views/Table/` for `openBoardSpendGate` returns nothing.
- Retry-with-duplicate-charge acknowledgement (`Popconfirm`, today `Table/index.tsx:177-191`) works from the Board and still warns.
- **LIVE, with money:** run one paid draw from the Board end to end, cancel one, and retry one, on a real provider. The `duplicate_charge_acknowledgement_required` path (`creativeStudioTypes.ts:2043`) cannot be exercised in jsdom. **Also note the unresolved question from the GATING map:** whether an ordinary `retryJob` re-charges or replays under the existing authorization is unverified (`v2Service.ts:3884-3892` delegates to `jobManager.retryJobV2`, unread). Resolve that before shipping recovery to a more prominent surface.
- Confirm ruling **R1** is reflected: no view spends silently, and every paid action still passes the confirm gate that names the amount. References and Director-card spend stay where they are.

**Risk:** locale namespace move = delete + add across 12 locales + `expectedLeaves`, one commit. Watch two known Arco traps that jsdom cannot catch: `.arco-btn-text:not(.arco-btn-disabled)` outranks a bare CSS-module class, so a background on a text Button silently does nothing; and Arco moves your `className` onto a wrapper `<span>` when a Button is disabled, so `:disabled` rules go dead. The Board's new disabled tiles will hit both.

---

### Slice 12 — Refuse to render an unscripted shot, in main _(CONDITIONAL — required only if "the Table is set" must be a hard precondition)_

**Goal:** one lock, in one place, that holds for the top bar, the Beat panel, the Board tile, and the Director alike.

**Why independently shippable:** it is a single new refusal reason. Slices 4 and 10 already deliver the user-facing behaviour (the gap is named and the tile says why); this is defence in depth.

**Files touched**

- `packages/desktop/src/common/types/project/creativeStudioTypes.ts:566-578` — add one member to `STUDIO_PRICING_REFUSAL_REASONS_V2`. I read the array; it currently has nine.
- `packages/desktop/src/process/services/creative-studio/service/schema2/pricing/estimate.ts:549-606` (`createChoiceTemplate`) — raise it. Today an unscripted shot is **fully payable**: `shootingScript` is validated for length only (`validation.ts:640`), and `composition.ts:161-172` throws only when brief _and_ story _and_ script are all empty after trim.
- `packages/desktop/src/process/bridge/creativeStudioBridge.ts:54, :109-112` — message key mapping.
- Locale: one refusal string, 12 locales, same commit.

**Classification:** main + renderer wire enum. **No stored shape, no migration** — this is an error classification, not a persisted field.

**Acceptance**

- A quote for a shot with an empty script is refused with the new reason from every entry point.
- **LIVE:** author a shot by hand (Slice 4), leave the script empty, and try to render it from the Board, the Beat panel and the top bar. All three refuse with the same words.

**Risk:** `STUDIO_PRICING_REFUSAL_REASONS_V2` crosses IPC but is not persisted, so `hasExactKeys` and the schema version are untouched. Confirm no stored job snapshot carries a refusal reason before shipping. Locale key-set contract as always.

---

### Slice 13 — Drop the Table STATE column _(OPTIONAL)_

Natural only after Slice 11, when the Table has no generation left. **It frees nothing:** the ten `table.state.*` keys are shared with the Board (`Views/Board/index.tsx:26-37`), the Cut (`Views/Cut/index.tsx:26-35`), the Bin (`Board/Bin.tsx:411`) and the top bar's READY count (`workspaceProjection.ts:1727-1741`), so only `table.columns.state` can be removed. Cost: `columnCount` 7→6, which moves `aria-colcount` (`Table/index.tsx:642`), the detail row's `colSpan` (`:861-863`) and the `End` key target (`:567-569`); plus four test blocks that hard-code column index `6` (`TableView.dom.test.tsx:274-297, :1097-1115, :1290-1310, :1313-1325`). Do it for coherence, not for value. Marked optional deliberately.

### Slice 14 — Stop showing and editing beat targets _(OPTIONAL)_

Once Rule A holds, a beat without shots is transient. Hiding the target field is pure renderer (`Views/Table/index.tsx:699-713`, `Views/Board/index.tsx:267-269`, `BeatPanel`) and satisfies "beats must not carry targets" as a user-facing statement at zero migration cost. **Do not remove `StudioBeat.targetSeconds` from the model** — see below.

---

## What this plan deliberately does not do

**It does not split `shootingScript` into `shortLine` / `fullPrompt`.** The owner's problem is grain, not length: the Table shows `beat.story` (median 0 chars, max 81 across 63 beats) and never reads `shootingScript` at all. Slice 2 solves the planning problem; the 458-char median then becomes a _layout_ problem whose fix is a clamp. The split, by contrast, drags in the worst item on the board: recording _which_ prompt was sent means touching `COMPOSITION_SHOT_SOURCE_KEYS` (`validation.ts:298`), which `validateComposition` checks by **re-derivation** (`generation/composition.ts:263-271`) — that invalidates every stored job, quarantines every project containing one, and BUG-136 explicitly forbids the rewrite workaround. **Fixing composition-by-recomputation is a hard prerequisite, not a related cleanup.** And "editing shortLine stales fullPrompt" has no home: under the split the recomposed request bytes are identical, so nothing marks stale and the rule silently does not fire.

Separately, I do not accept the strongest evidence offered for the split. The ~230-char byte-identical `STYLE:` tail in all 36 scripts is not proof that a shot needs two prompts — `composePrompt` (`composition.ts:157-206`) already prepends `PROJECT BRIEF` to **every** generation plus a `BOARD STYLE` section. The Director is duplicating project-level art direction into 36 per-shot fields that already receive it. That is a Director-prompt or brief-authoring defect worth roughly half the "scripts are too long" problem, it costs a prompt change rather than a migration, and it should be fixed and re-measured before any schema budget is spent. If the split ships eventually: keep `shootingScript` as storage, add only an **optional nullable** `fullPrompt` via a new `SHOT_OPTIONAL_KEYS` with `hasKeys` (`validation.ts:487-497` — the pattern `ASSET_OPTIONAL_KEYS` / `JOB_OPTIONAL_KEYS` already prove in the same file). Absent key ⇒ `canonicalJson` unchanged ⇒ no BUG-151 ⇒ none of the 44 inline-literal test files touched. Never introduce a literally-named required `shortLine`.

**It does not store a `storyboardApproved` flag.** Three of the four clauses are already free: `coverageGapBeatIds` is computed every render and read by nobody; `referenceBinding.status === 'ready'` is already stored and already enforced by pricing; shot seconds 4–15 are already refused at authoring time in six layers (`mutations/index.ts:341-345` onward). Only script-emptiness is new, and Slice 4 derives it. Against a flag stands this repo's own record: one stored bit (`referencePlanStatus`) needed fifteen enforcement sites, a validator key-list entry, a dedicated undo-patch shape, and shipped as a one-way latch with no inverse — and the last three schema changes here ended in project quarantine (BUG-136), permanently unverifiable undo digests (BUG-151), and "no migration: existing projects wiped" (the take-removal spec's own answer). A flag is also semantically wrong: accepting a proposal that adds an empty beat, or a `direct` `delete_shot` emptying a beat, invalidates it silently — the same revision-skew class as BUG-160. Every existing gate rides `project.revision`; derive it and ride that too. For "I meant beat 4 to be empty", use the mechanism that already exists: park it to the Bin.

**It does not remove `StudioBeat.targetSeconds`.** A removed key fails `hasExactKeys` (`validation.ts:499-500`) identically to an added one, and the field is not a redundant duplicate of the shot sum — it is the length of the slate that stands in for an uncovered beat in the Cut (`Views/Cut/playbackSequence.ts:194-215`, which returns `null` for the whole sequence if the numbers disagree) and in the export (`schema2/exports/editorFolder.ts:257-270`), and the only trigger for `unresolvedBeatIds` (`creativeStudioProjectSummary.ts:191-198`). Rule A arguably makes the uncovered beat transient, but that is a product decision the owner has not made; Slice 14 stops displaying it at zero cost and defers the removal until the slate question is answered.

**It does not rename `takeAssetId`.** `creativeStudioTypes.ts:404, :480`, exact-key sets `validation.ts:305, :311` — these live inside **frozen job snapshots on disk**. The take-removal spec calls it "rename only, semantics identical"; that is wrong about the cost. Same prerequisite as the two-prompt split.

**It does not raise `STUDIO_MAX_MUTATION_OPERATIONS`.** At 6 beats × 6 shots, `add_beat` + `apply_coverage` is 12 operations, comfortably inside the 32 cap — the cap is not the binding constraint, the _shape_ is, and Slice 6 fixes the shape. It would bind again at 24 beats × 8 shots (48 ops); that is a later lever, not this quarter's.

**It does not enforce either rule as a navigation lock.** Rule A ships as a strong default with two exits (Ask the Director, or author it yourself). Rule B ships by _reachability_ — the paid affordances simply live on the Board, and a blocked tile is disabled _with its reason_ rather than the view being unreachable. A disabled tile that says why is recoverable; an unreachable view is not, and the previous phase-shell round already produced a nav-lock that had to be walked back.
