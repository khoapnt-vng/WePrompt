# Creative Studio 2 — programme plan

A reply to _Creative Studio 2 — Transition Plan_, grounded against `feat/creative-studio-2` and
written after phase 1 began landing. It corrects four facts in the Transition Plan, places one
prerequisite it does not mention, splits one phase that is really two, and argues that the critical
path is no longer engineering.

Read §1 and §6 if you read nothing else.

---

## 1. The headline: engineering is not the critical path any more

Phase 1's plan estimated its remaining Tasks 4–13 at **20–26 engineer-days**. Three of those ten
tasks landed the same evening the first three did — `078aa8c77` 19:11 through `338478ee8` 20:50, and
18 commits by 22:03. Six of thirteen tasks in under three hours.

So estimates in this document come in two columns, and the second is the one to schedule against:

|                    | hand-coding days | observed rate |
| ------------------ | ---------------- | ------------- |
| Phase 1 (13 tasks) | 24–30            | ~1 day        |

The hand-coding column is kept for organisational planning parity, not because anyone will spend it.

**What compresses:** module code, store plumbing, IPC commands, tests, and translation — which is
generation, not a vendor engagement.

**What does not compress at all:** the human gates in §6. Phase 3's acceptance criterion is
literally _"judged by eye, on a real project, by someone who did not write it."_ No execution speed
touches that. Plan the programme around those gates and treat the engineering as fill.

---

## 2. Four corrections to the Transition Plan

**A three-minute piece is not representable today.** Phase 2's premise — _"a three-minute piece is
8–10 sections"_ — fails validation before any of it is built. `targetDurationSeconds` is validated
`5..60` **seconds** in `validateProject` (`store.ts:1027`) and twice more in `payloadSchemas.ts`
(`:267` create, `:468` update), with the same bound enforced at nine sites in all. 180 seconds is
rejected. Raising the caps is phase 2's first commit, not a detail — and the bound must be extracted
to shared constants rather than edited at nine call sites.

**"The engine caps around ten seconds" is wrong in both directions.** The live route
(`bytedance/seedance-2.0`) runs **4–15 seconds**. The ceiling being 15 is minor. The **4-second floor
is undocumented and load-bearing**: there is no such thing as a two-second beat _as a clip_. Any
shorter beat is a trim of a longer generation or a held still. A shot added in the current app
defaults to 5s, which is safe. The gap is the accepted **range**, not the default: `isValidDuration`
takes `1..60` (`useStoryboardEditor.ts:261`) and the store agrees (`store.ts:393`, `:645`), so a
user can type 1, 2 or 3 seconds and it validates, persists and survives a reload — failing only at
render, after the spend. Raising the floor to 4 at those three sites needs a migration first:
projects may already hold sub-4s scenes, and tightening the validator ahead of migrating them
quarantines those projects.

**The 24-record cap is exceeded by the new model, not approached.** `MAX_SCENES = 24`
(`useStoryboardEditor.ts:20`, enforced `:1344`, `:1622`, plus service `:1826`, `:1893` and
`payloadSchemas.ts:351-369`). Eight to ten sections of three to four clips is 24–40 clips. The cap is
in roughly twelve places.

**Two different things will be called "clip".** `StudioCutClip` already exists and means an assembly
segment (`creativeStudioTypes.ts:215-223`) — carrying exactly the `crop` and `filters` phase 4 wants
deleted. `reconcileCut` (`store.ts:831`) mints its ids and bakes in one-cut-clip-per-scene — it skips any scene that already has a clip (`:851`).
Introducing a generation-level Clip beside it needs a rename, not a comment.

---

## 3. Phase 1: the boundary was decided by building it

Phase 1 promises the brief _"loads into every director turn"_ **and** _"no changes to the MCP
surface."_ Those cannot both hold. `pinned_context` appears nowhere in aioncore's 688 Rust files on
either live branch; `SendMessageData` carries exactly `content`, `msg_id`, `turn_id`, `files`,
`inject_skills`; and `deny_unknown_fields` is applied only to team types, so the pin the desktop
sends is **silently dropped**. Nothing injects per turn. The only working route from project state to
the model is the MCP tool surface, which the boundary forbids.

The implementing session resolved this the right way — by taking the MCP surface. `read_storyboard`
now carries the rules and the gate is in `jobManager`. **Amend the boundary sentence** to read:
_"brief storage, prompt assembly, a check step in the render path, and an additive read-only
extension of the MCP surface. No changes to the scene model."_ The scene model is the thing that must
not move in phase 1, and it hasn't.

**Two consequences to state rather than absorb:**

_Phase 1 does not deliver "loaded into every director turn"._ Nothing does. The Director sees the
brief and rules when it calls `read_storyboard`. Do not let this claim survive into an MR or a demo.

_The acceptance criterion needs measuring, not asserting._ _"A second session opens with a proposal
instead of an interview"_ depends entirely on the Director calling `read_storyboard` on turn one,
which is a property of the tool description — the only model-facing prompt surface Studio has. Make
it behavioural: ten consecutive fresh Director sessions on a project with a brief and a rule, pass
rate recorded. If it fails, the description is the lever and iterating it is hours.

**One gap, already raised with the implementing session.** The Transition Plan's second cross-cutting
rule is that director edits are undoable _from the first phase onward_. Phase 1's plan mentions undo
zero times in 4,259 lines, and `StudioSetBriefRulesRequest` (`creativeStudioTypes.ts:613-616`)
carries the whole rule list, so `setBriefRules` replaces rather than patches and deleting a rule is
unrecoverable. Single-step undo of the last rule-list write, applied as a new forward write under a
fresh guard because the revision bumps on every persist. ~1–1.5 hand-days.

**Correction to that item, from grounding it since:** it does _not_ build "the operation-log
primitive phase 2 needs anyway," as this document first claimed. The store makes a coarse pre-image
almost free to keep — `updateProjectInsideQueue` already materializes the prior body, and handing it
back to the mutator lands as a new forward revision — but a coarse revert **fails open** once it
reaches beyond one field: job transitions move the revision counter unguarded (`mutateJob` takes
`expectedRevision` as optional), and a restored body predating a submission is internally
self-consistent, so `validateProject` accepts it and silently drops the `providerJobId` of work
already paid for. Nor can it reach the rendered cut, which is a sidecar, or the write-once proposal
decision ledger.

The rules estimate survives because rules are one array on the project record and touch no job
state. What does not survive is the generalisation: the safe coarse form costs **2–3 hand-days** and
earns a scoped _"revert this proposal"_, not Undo. Phase 2's per-edit undo still needs
`apply_script_changes` and its inverses; there is no cheap substitute, only a cheap narrower thing.

**A second gap, found in the same grounding, in the surface phase 1 just extended.**
`read_storyboard` projects a scene's reference as a boolean — `hasReference` — while
`propose_storyboard`'s schema requires `referenceAssetId` as a concrete id or `null`, and
`referenceAssetId` is one of `EDITABLE_SCENE_FIELDS`. A Director told only that a reference exists
therefore has no id to send, must send `null`, and **drops the reference on every re-proposal**. Not
silent — the diff records the field as changed — but unavoidable from the Director's side.

The fix is to project the id, three lines in `studioServer.ts`, and it belongs in phase 1's
territory rather than phase 2's. It is deliberately **not** being handed to the phase-1 session
mid-flight: that session was told to finish Tasks 7–13 and expand nothing, and contradicting that
within the hour costs more than the defect. Do it immediately after Task 13, in parallel with the
skeleton's S1, which touches no MCP surface.

---

## 4. Phase 1.5: the Engine Strip. Unscheduled, and phase 3 cannot ship without it

The Transition Plan does not mention media-engine selection. Phase 3 requires an image route **and** a
video route live on one project by construction, and today binding two models of one media kind leaves
`routing[kind]` null with no in-app cure — the only picker lives in `GenerationControls`, which is
never rendered. This was hit in normal use, not found by probing.

Specified in `creative-studio-2-engine-strip.md` with ten drawn states in
`creative-studio-2-engine-strip-wireframes.html`. **8–12 hand-days**, which prices the demolition and
not just the component: `StudioModelBar`'s single mount and 148-line test, `GenerationControls`' 393-line
test, `resolveSoleRouteAdoptions` wired through `useStudioModels.ts:221`, ~57 new keys across 12
locales, and a four-site rewrite of a 674-line e2e spec that currently _asserts_ the broken behaviour.

Two blocking contract changes, both small, both prerequisites for phase 3 as well: an integration label
on `StudioRouteCatalogEntry` (two bindings of one model render identically without it), and
`explainRouteSupport` as a reason-returning sibling to `routeSupportsScene` (`routeSupport.ts:32-44`) —
phase 3's entire capability-honesty story depends on it.

**Ship it standalone between phases 1 and 2.** It fixes a live blocker, it is independent of the model
change, and folding it into phase 2 buries a user-visible fix inside a three-month restructure.

---

## 5. Phase 3 is two mechanisms wearing one name, and only one needs phase 2

This is the most useful thing in this document, because it rescues the Transition Plan's own bet.

**Phase 3a — the still stage. Buildable on today's flat model. 12–17 hand-days.**
Cast and look references as project-level data with an import surface; multi-reference image input; the
still used as a clip's first frame; capability honesty when a route lacks the image role. None of this
needs sections. It also needs `outputRole` to reach the renderer through `toRendererJob`
(`creativeStudioService.ts:669`) **and** `sanitizeJob` (`useStudioJobs.ts:124`) in one change — both are
exhaustive whitelists.

**Phase 3b — the last-frame link. Needs sections. 11–13 hand-days.**
Frame extraction, chain ordering head to tail, staleness as a first-class state. The chain is only
meaningful within a group with a boundary, and a section is that group. On a flat model you would have
to invent a per-scene "start fresh" flag — the control wireframe 9b already draws — which works but
duplicates what sections give you for free.

So _"if only two phases happen: one and three"_ survives, correctly re-priced: **phases 1 + 1.5 + 3a**
gets an enforced brief and consistent-looking output, without the restructure. 3b follows phase 2.

The still→clip admission gate is now complete for one real OpenRouter route. The **On the Pitch**
control used integration/provider `d1ff983b`, `openrouter-video-v1`,
`bytedance/seedance-2.0`, 5 seconds, 16:9, 720p and an inline managed JPEG first frame. Both the
original and fresh controlled clips preserved the shared reference composition and first-frame
identity: reference-to-original frame 0 SSIM `0.898096`, reference-to-controlled frame 0 SSIM
`0.898209`, and original-to-controlled frame 0 SSIM `0.985962`. The human Q2 owner verdict,
**“different but feel like the same for sure”**, passes same-film coherence for this route and admits
Phase 3a Task 1.

That admission is not a general provider claim. Both clips reused the same action prompt;
silhouetted subjects show role/world continuity, not exact face/cast identity; and sampled frames and
endpoint metrics do not prove flawless motion or physics. The control disproves an HTTPS-publisher
requirement for this OpenRouter inline-first-frame route, but does not transfer to BytePlus or prove
multi-image conditioning.

Also: feeding cast and look references into the plate **inverts a documented decision** —
`jobManager.ts:590` guards `output.role !== 'reference'` and `:556-557` states that a reference plate
never consumes the scene's own reference. Phase 3a changes that rule deliberately; do it explicitly.

---

## 6. The human gates — the actual critical path

Each of these has a lead time no execution speed touches. Start them now, in parallel with phase 1.

**A real VNGG project, and a person who did not write it.** Phase 3's acceptance criterion is a human
judgement on real material. Without a real project and a willing reviewer, phase 3 cannot be _finished_
however fast it is built.

**Design review of Table and Board.** Phase 2's UI half is the biggest single cost in the programme.
Review cycles on a new primary authoring view are calendar, not engineering.

**Is the project folder's readable content source or derived?** Unanswered since the engineering
response §3.4. It determines the file format, the sync story, and whether phase 4's estimate is valid
at all — the derived reading costs 6–9 days, the source reading is a parser plus conflict handling plus
a sync loop and I will not put a number on it. **Phase 4 cannot start without this answer.**

**Nine sections or forty?** The Transition Plan's own open question, and it decides whether phase 2 is
worth 60–80 hand-days. At nine, sections buy less than they cost and 3a-before-2 is clearly right.

**The aioncore ask.** Someone should ask the backend owners to honour `pinned_context` on
`POST /api/conversations/{id}/messages`. It is a small additive field. The day it lands, phase 1's
headline claim becomes true retroactively with no client change, because the pin is already written.
Until then it is dead weight that costs one effect.

---

## 7. Sequence, and what ships if it stops

|         |                           | hand-days | stops here and you have…                                                     |
| ------- | ------------------------- | --------- | ---------------------------------------------------------------------------- |
| **1**   | The brief becomes context | 24–30     | rules enforced before spend; a Director that can read them                   |
| **1.5** | Engine Strip              | 8–12      | multiple engines usable at all; a live blocker gone                          |
| **3a**  | The still stage           | 12–17     | clips that share a look — **the Transition Plan's "1 and 3" bet, delivered** |
| **2**   | Table and Board           | 60–80     | one screen, sections, granular apply with per-edit undo                      |
| **3b**  | The last-frame link       | 11–13     | clips that continue from each other; staleness                               |
| **4**   | Cut, folder, export       | 24–34     | a file someone can send, from a sentence                                     |

Phase 2 is a third of the programme and its own done-when is _"a full project can be written, selected
and rendered without touching the old phase navigation"_ — navigation, plus the model change that phase
3b and phase 4 need. It is the right phase to defer, and the wrong phase to skip: 3b and 4 both depend
on it.

Phase 4's dependency is absolute and worth stating plainly: **Review cannot be retired until the
Table/Board screen exists**, because there is nowhere else for the cut editor, the render trigger and
the export entry to live.

---

## 8. Two traps in phase 4 that will otherwise be found late

**Tightening `CUT_CLIP_KEYS` before stripping persisted `crop`/`filters` quarantines whole projects,
not just cuts.** `validateCutClip` failure bubbles through `validateCuts` to `validateProject`. The two
steps must be separated by _a release_, not a commit: migrate first, ship, then tighten.

**The `.m4a` trap.** `MIME_SIGNATURES`' `video/mp4` matcher tests `bytes[4..8] === 'ftyp'`
(`mediaStore.ts:63`), which an `.m4a` audio file also satisfies. An imported music bed will be silently
persisted as `video/mp4`. Widening `StudioMediaKind` to include `'audio'` is not the fix — it would make
`mediaKind: 'audio'` type-legal on a scene, in route capabilities and in the planner's output.
