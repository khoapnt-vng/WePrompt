# CS4 parity audit — what the cutover left behind

**Date:** 2026-09-03. **Baseline:** `958478ded`, re-checked against
`codex/creative-studio-4-phase-6` (Wave 1) and `e9baa8be1`.
**Method:** 24 agents across two adversarial passes — nine-layer capability traces, five
independent sweep lenses, a skeptic against every trace, and a completeness critic. Then an
independent review pass by Codex, whose corrections are folded in and marked **[codex]**.

Claims are **[verified]** (re-read directly), **[audit]** (agent-reported with file:line, not
all independently re-read), or **[codex]** (from the review pass, re-verified here).

---

## Status of this document

It is **not** backlog authority on its own. Two rounds of correction have moved items between
tiers, and the corrections mattered more than the original findings in three cases. Read the
tier assignments as reviewed; read any un-marked claim as audit-grade.

Revision history worth knowing:

- **rev 1** said 49 capabilities. That counted five sweep lenses' *wordings*, not capabilities
  (References appeared 3×, deletion 4×, proposal review 4×), and folded the Director's tool gap
  into the feature count.
- **rev 2** collapsed it to ~22 families and tiered by cost.
- **rev 3** (this one) applies Codex's independent pass: one item is fixed, three were
  deliberate exclusions misfiled as gaps, two move *up* a tier, and the rules finding is worse
  than first reported.

---

## The finding

**CS4 is not a narrowed version of the old Studio. It is a different, smaller product** — a
flat grid of independent photographs.

Roughly **18 capability families** remain genuinely open after Codex's reclassification, plus a
separate Director tool gap of 7. Almost none is a rebuild; where one is needed, the old
implementation survives as dead code to read (ffmpeg audio mix at `service/filmExporter.ts:1182`,
reference workflow at `StudioPage/referenceViewAdapter.ts`).

---

## Tier A — built, live, unreachable

### 1. Project rules — genuine drift, and worse than first reported

Confirmed as drift by the review pass. **[codex]**

The machinery is live: `set_rules` is in the schema-6 mutation union
(`creativeStudioTypes.ts:2064`), admitted by the live IPC validator
(`payloadSchemas.ts:1189`, enforced at `common/adapter/main.ts:97`), with a handler on the
mounted path (`pieceCatalogV3.ts:405-416`). `pilot/prepare.ts:269` and
`pilot/confirmation.ts:230` pass `project.rules` into composition, which renders them into the
provider prompt at `schema2/generation/composition.ts:564`.

But `rules: []` is hardcoded at project birth (`schema2/factories.ts:122`), `set_rules` has
**zero live renderer callers**, and no Director tool emits it — so `inputs.rules.length` is
provably always `0` in production. **[audit, critic-verified]**

**The correction that matters: composition only *renders* rules; it does not enforce them.**
There is no `rule_breach` evaluation anywhere on the Pilot's prepare/confirm path — the
`rule_breach` failure mode (`jobManager.ts:160`) and the forbidden-term predicate system
(`director/contracts.ts:1667`, `schema2/mutations/index.ts:378`) are not reached from it.
**[verified]**

So a Rules UI wired without enforcement would ship a guardrail that *looks* binding and is
only advisory prompt text — it could not refuse a breaching paid render. **This is a
spend-safety issue, not a feature gap.**

Agreed shape **[codex]**: keep the schema and composition contract; **restore Main-side
enforcement before quote and confirmation first**; then add a **human-only** Rules surface. No
Director setter.

### 2. Brief editing and project rename — built, not absent

Reclassified up from Tier B. **[codex]** Both are implemented in Main —
`schema2/mutations/index.ts:120-121` and the handlers at `:464-467`, `:1208`, `:1234` — and
unreachable from the mounted UI: the only renderer references live in dead trees
(`StudioPage/draftCommands.ts`, which has no importers, and `components/Workspace/Views/*`).
**[verified]**

The brief is prepended to every paid generation, so write-once is not cosmetic.

Agreed shape **[codex]**: port to schema 7 and expose, as a Project Details surface covering
name + brief.

### 3. ~~Reference conditioning~~ — **FIXED**

Closed at `e9baa8be1` *"fix(studio): admit conditioned photo creates over IPC"* —
`referencePieceIds` added to the create branch at `payloadSchemas.ts:1154`, with 71 lines of
fixture hardening. **[verified]**

The fixture change addresses the underlying defect, not just the symptom: the payload fixtures
were hand-written beside the schema and so agreed with it by construction, which is what let a
nine-layer feature miss its tenth layer.

---

## Tier B — small, genuinely open

| Capability | Note |
|---|---|
| **Full-size image viewing** | Confirmed a genuine gap **[codex]**. A 1080p result is viewable only at grid-tile size. |
| **Bin UI** | The Lift to Bin / Put back contracts exist (`creativeStudioTypes.ts`, `schema2/mutations/presentationV4.ts`) but no surface drives them **[verified]**. |
| **Export reveal destination** | Reveal opens the app's internal store root, not the user's chosen destination. P2 **[codex]**. |
| **Export history** | One-shot banner; dismiss it and the record is gone. P2 **[codex]**. |
| **In-place revision of a Piece** | A Piece is write-once; every further generation path on it is refused. |

---

## Deliberate exclusions — not gaps

Corrections from the review pass. These were misfiled in earlier revisions of this document.

- **Permanent Piece deletion and top-level reordering were explicitly excluded** by design. The
  intended mechanism is **Lift to Bin / Put back**, not deletion **[codex]**. Only the Bin *UI*
  is open (Tier B above).
- **Project-level settings and model/route choice were deliberately excluded** **[codex]**.
  Previously filed as Tier C.
- **Rename-only undo was intentional for Pilot 1** **[codex]**. My earlier framing — that it
  contradicts the standing CS2 rule requiring director edits to be undoable from phase 1 — is
  withdrawn for Pilot 1. **The open item is narrower and still real**: Phase 6 Director reorder
  needs either real undo or an explicit superseding ruling.
- **The single conditioning provider+model tuple** (`common/utils/imageModelAllowlist.ts:69-74`)
  is **intentional fail-closed policy**, not a defect, and should not be broadened without paid
  evidence **[codex]**. Previously flagged here as an unresolved narrowing.
- **Per-Piece export is reachable whenever Studio is enabled.** My earlier framing —
  "behind an off-by-default flag" — was misleading: `AIONUI_ENABLE_CREATIVE_STUDIO` gates the
  whole of Studio, not export specifically **[codex]**.

Also deliberate, and documented at
`docs/prds/creative-studio/creative-studio-4-canvas-design.md:36/44/436/508`: video, audio,
film export, Beats/Shots, the four-view workspace, board panels, trim/cut. **[audit]**

> Sound and video are named in the **same sentences** there. An earlier claim of mine — that
> sound's removal was documented where video's was not — is withdrawn. What separates them is
> prior machinery: video had a live rate-card kind, live adapters and a real generation purpose;
> sound had none.

---

## The Director's tool surface — a separate count

`scripts/build-mcp-servers.js:52` builds `builtin-mcp-studio.js` from `pilotStudioServer.ts`,
so that is what ships; `studioServer.ts` is dead, surviving only in the coverage config.
**[verified]**

**Shipping:** `get_project_status`, `prepare_photo`, `rename_piece`, `get_command_status`, and
Wave 1's `propose_board`.

**Declared in the dead server, absent from the Pilot:** `studio_request_reference_images`,
`studio_apply_edits`, `studio_apply_free_fix`, `studio_get_conditioning_frame`,
`studio_list_routes`, `studio_propose_paid_recovery`, `studio_get_proposal`.

Two behavioural losses beyond the list: the Director **cannot see any image**, so it cannot
critique the photograph it just made; and proposal review — propose a change, user accepts or
rejects a diff — does not exist on the shipped path.

Note that the agreed Rules shape is **human-only**, so `set_rules` is deliberately *not* a
Director tool. Not every absence here is a gap.

---

## Agreed sequence

1. **Pilot essentials** — Rules enforcement then Rules UI; Project Details for name + brief;
   Bin UI; full-size viewer.
2. **Wave 2** — motion end to end.
3. **Independent P2** — export reveal destination, export history.

### Ownership

- **Codex:** Rules and Main-side enforcement, schema-7 metadata, Bin wiring, motion.
- **Claude:** this document, and the accessible full-size viewer.

---

## Method note

Five failure modes, each paid for once here:

1. **Counting literals measures nothing.** A count of `'image'` literals was simultaneously too
   high (16 of 17 in one file were already-video-safe branching) and too low (~10 real hardcodes
   in the same file uncounted).
2. **Dead code looks alive.** `v2Service.ts` is 4,506 fully-featured lines that run nowhere.
   Prove reachability before citing anything.
3. **Trace the vertical slice.** Nine layers each looked locally reasonable while the tenth
   silently rejected every call.
4. **Deduplicate by concept, not wording.** Independent lenses name the same capability
   differently; counting their outputs inflated this document's headline by more than double, in
   the direction of alarm.
5. **An absence is not a defect until you check whether it was chosen.** Four items here were
   deliberate exclusions with a documented substitute, and only a reviewer who held the original
   decisions could say so. An audit can find what is missing; it cannot tell you what was meant.
