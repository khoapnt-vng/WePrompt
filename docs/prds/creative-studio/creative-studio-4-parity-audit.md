# CS4 parity audit — what the cutover left behind

**Date:** 2026-09-03. **Baseline:** `958478ded` (tip of `codex/creative-studio-4-pilot`),
re-checked against `codex/creative-studio-4-phase-6` (Wave 1).
**Method:** 24 agents across two adversarial passes — capability traces through nine layers,
five independent sweep lenses, skeptic verification of every trace, and a completeness critic.
Claims are **[verified]** (re-read directly) or **[audit]** (agent-reported with file:line, not
all independently re-read).

Commissioned to check whether video's silent narrowing had also happened to sound, References
and export. It had — and to more than those three.

---

## The finding, sized honestly

**CS4 is not a narrowed version of the old Studio. It is a different, smaller product** — a
flat, append-only grid of independent photographs.

**Roughly 22 distinct capability families** were present in the shipped Board/Cut Studio and are
absent from the Pilot.

> **A correction to this document's first revision**, which said 49. That figure came from
> deduplicating five sweep lenses by name string, and the lenses described the same capabilities
> in different words — References appeared three times, deletion four, proposal review four,
> audio three. 49 counts descriptions, not capabilities. It also conflated the Director's tool
> surface with the product's feature surface; those are separated below.

**Almost none of this is a rebuild.** Where a genuine rebuild is needed, the old implementation
survives as dead code and can be read — the ffmpeg audio mix is still at
`service/filmExporter.ts:1182`, the reference workflow at
`renderer/pages/studio/StudioPage/referenceViewAdapter.ts`.

---

## Cost tiers — the decision-useful cut

| Tier | Families | What the work actually is |
|---|---|---|
| **A — built, needs connecting** | 3 | An IPC field, a composer input, an env flag. Currently pure sunk waste. |
| **B — small additions to an existing spine** | 8 | Mutation-union member + handler + control. The pattern is established. |
| **C — medium** | 4 | Real features, no new subsystems. |
| **D — large, and deliberately deferred** | 7 | The "what is CS4" question. Decisions already written down. |

### Tier A — built, live, unreachable *(the only emergency)*

**1. Project rules.** The most consequential single finding. `set_rules` is a live member of the
schema-6 mutation union (`creativeStudioTypes.ts:2064`), admitted by the live IPC validator
(`payloadSchemas.ts:1189`, enforced at `common/adapter/main.ts:97`), with a real handler on the
mounted path (`schema2/mutations/pieceCatalogV3.ts:405-416`). Rules **materially change paid
output**: `pilot/prepare.ts:269` and `pilot/confirmation.ts:230` pass `project.rules` into
composition, which renders them into the provider prompt at
`schema2/generation/composition.ts:564`.

But `rules: []` is hardcoded at project birth (`schema2/factories.ts:122`), `set_rules` has
**zero renderer call sites**, and no Director tool emits it. `inputs.rules.length` is provably
always `0` in production — the prompt branch consuming rules is dead at runtime inside a live
function. **[audit, critic-verified]**

This is worse than missing. Anyone reading `composition.ts:564` sees guardrails being rendered
into the prompt and reasonably concludes they work. No test would notice.

**2. Reference conditioning.** Live on eight of nine layers including a shipping reference
picker (`PilotCanvas.tsx:1379-1415`); every renderer *create* call is refused because the IPC
schema omits `referencePieceIds`. Detail in `creative-studio-4-wave-2-scope.md` §0. **[verified]**

Unresolved alongside it: conditioning capacity is **fail-closed to one hardcoded
provider+model tuple** (`common/utils/imageModelAllowlist.ts:69-74`). The admission check is
correct; the admitted set is one. **[audit]**

**3. Per-Piece export.** Wired end to end, but every command short-circuits unless
`AIONUI_ENABLE_CREATIVE_STUDIO === '1'`. Reveal-in-Finder opens the app's internal store root
rather than the user's chosen destination. Eight orphaned export IPC channels remain declared at
`ipcBridge.ts:1432-1457` with no provider, two still invoked by a surviving renderer hook.
**[audit]**

### Tier B — small additions

| Capability | Evidence |
|---|---|
| Delete / park / reorder a Piece | Absent from the live six-member mutation union (`creativeStudioTypes.ts:2061-2066`); exists only in dead V2 vocabulary |
| In-place revision — a Piece is write-once | Once it holds an asset, every further generation path on it is refused |
| Edit the brief | Only reachable writer is `PilotLibrary.tsx:179 createProjectV3` — yet the brief is prepended to every paid generation |
| Rename a project | `edit_project` has zero renderer callers; the canvas header prints the name as static text |
| Undo beyond rename | `pieceCatalogV3.ts:437` builds an entry only `if (renameBefore !== null)`; the UI says `canvas.actions.undoRename` |
| Full-size image viewing | A 1080p result is viewable only at grid-tile size |
| Project thumbnails | The library is a text list |
| Export history | A one-shot banner; dismiss it and the record is gone |

**The undo narrowing contradicts a standing ruling.** The CS2 transition plan requires director
edits to be undoable from phase 1. `i18n-keys.d.ts` still carries undo labels for `set_brief`,
`set_rules`, `set_spend_policy` and `edit_project` — the residue of that intent. **[audit]**

### Tier C — medium

Project-level settings (aspect ratio, resolution, target duration, style) · model/route choice,
including any way to bind a video provider connection · batch and ranged spend authorization,
replacing one-confirmation-per-image · cancelling a queued dependent cascade in one action.

### Tier D — large, deliberately deferred

Video (generation, timing in persistence, playback, poster frames, per-second pricing) · audio
(bed, attach/detach, shot analysis, export mix) · Beats and Shots as narrative structure · the
four-view workspace (References, Table, Board, Cut) · storyboard panels · trim and hard-cut
control · film, editor-folder and script export.

`docs/prds/creative-studio/creative-studio-4-canvas-design.md:36` — *"No video, film, Assembly,
sound, reference workflow, or ffmpeg dependency belongs to Pilot 1"* — repeated at :44, :436 and
:508. **[audit]**

> Sound and video are named in the **same sentences** there. An earlier claim of mine, that
> sound's removal was documented where video's was not, is false. What separates them is prior
> machinery: video had a live rate-card kind, live adapters and a real generation purpose; sound
> had none.

---

## The Director's tool surface — a separate count

Not part of the 22 families above; this is the assistant's authority, and it overlaps the tiers.

Five tools ship. `scripts/build-mcp-servers.js:52` builds `builtin-mcp-studio.js` from
`pilotStudioServer.ts`, so that file is what ships; `studioServer.ts` is dead, surviving only in
the coverage config. **[verified]**

**Shipping:** `get_project_status`, `prepare_photo`, `rename_piece`, `get_command_status`, and
Wave 1's `propose_board`.

**Declared in the dead server, absent from the Pilot:**

| Lost tool | What the Director can no longer do |
|---|---|
| `studio_request_reference_images` | ask for references |
| `studio_apply_edits` | edit existing work |
| `studio_apply_free_fix` | retry without charging |
| `studio_get_conditioning_frame` | use a frame as conditioning |
| `studio_list_routes` | see or choose a model route |
| `studio_propose_paid_recovery` | offer a paid recovery after failure |
| `studio_get_proposal` | read back a proposal |

Two behavioural losses beyond the tool list: the Director **cannot see any image**, so it cannot
critique the photograph it just made; and proposal review — propose a change, user accepts or
rejects a diff — no longer exists on the shipped path.

---

## What this means

**The over-engineering worry was aimed at the wrong risk.** CS4 is not over-built. It is
under-scoped relative to what it replaced, and the gap was never measured until now.

**Tier A is the emergency, and it is small.** Three features are built, live and unreachable —
already-paid-for waste, each closable with an IPC field, a composer input, or a flag. Nothing
here needs a wave.

**Tier B is the credibility risk.** "You cannot delete a photo you generated" and "you cannot
fix a typo in your brief" are not roadmap items; they are what a pilot user hits in the first
ten minutes.

**Tier D is a product decision, not a bug list.** Those capabilities were deliberately deferred.
The open question is whether Pilot 1 was meant to *prove* a product or *become* one.

### Recommended order

1. **Fix the reference-conditioning IPC omission** — it blocks new-Piece creation from the UI today.
2. **Connect or delete the rules feature** — it is in every paid prompt and provably always empty.
3. **Set a Tier B floor before pilot users arrive**: delete a Piece, edit the brief, rename a
   project, view an image full-size.
4. **Then** decide Tier D scope, which is the real "what is CS4" question.

---

## Method note

Four failure modes, each paid for once during this audit:

1. **Counting literals measures nothing.** A count of `'image'` literals was simultaneously too
   high (16 of 17 in one file were already-video-safe branching) and too low (~10 real hardcodes
   in the same file went uncounted).
2. **Dead code looks alive.** `v2Service.ts` is 4,506 fully-featured lines that run nowhere.
   Prove reachability — a registration, a mount, a build entry point — before citing anything.
3. **Trace the vertical slice.** Nine layers each looked locally reasonable while the tenth
   silently rejected every call.
4. **Deduplicate by concept, not by wording.** Independent lenses name the same capability
   differently; counting their outputs inflated this document's own headline by more than
   double, in the direction of alarm.
