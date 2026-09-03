# CS4 parity audit — what the cutover left behind

**Date:** 2026-09-03. **Baseline:** `958478ded` (tip of `codex/creative-studio-4-pilot`),
re-checked against `codex/creative-studio-4-phase-6` (Wave 1).
**Method:** 24 agents across two adversarial passes — capability traces through nine layers,
five independent sweep lenses, skeptic verification of every trace, and a completeness critic.
Claims below are **[verified]** (re-read directly) or **[audit]** (agent-reported with
file:line, not all independently re-read).

This audit was commissioned to check whether video's silent narrowing had happened to sound,
References and export. It had — and to far more than those three.

---

## The finding

**CS4 is not a narrowed version of the old Studio. It is a different, much smaller product.**

The shipped Pilot is a flat, append-only grid of independent photographs. No sequence, no
editing, no deletion, no reordering, no undo beyond rename, no audio, no video, no project
settings, and a Director reduced to five tools.

**49 distinct capabilities** were measured as present in the shipped Board/Cut Studio and absent
from the Pilot. They fall into three classes that need different responses.

---

## Class 1 — Deliberately out of scope

Documented decisions for Pilot 1. Not defects; the plan said so.

Video and moving image · sound and the music bed · film export and the editor folder · Beats
and Shots as narrative structure · the four-view workspace (References, Table, Board, Cut) ·
storyboard panels · trim and hard-cut control.

`docs/prds/creative-studio/creative-studio-4-canvas-design.md:36` — *"No video, film, Assembly,
sound, reference workflow, or ffmpeg dependency belongs to Pilot 1"* — with sound and video
named in the same sentence, at :44, :436 and :508. **[audit]**

> A correction to an earlier claim of mine: I wrote that sound's removal was documented where
> video's was not. That is false. They were excluded together, with equal explicitness. What
> separates them is prior machinery — video had a live rate-card kind, live adapters and a real
> generation purpose; sound had none.

---

## Class 2 — Shipped but unreachable *(the dangerous class)*

Code that exists, is live, is on the mounted path, and has **no entry point**. Nobody decided
these. They fell out of the cutover the way video did, and no gate catches them.

### Project rules — every layer live, no way to set one **[audit, critic-verified]**

`set_rules` is a live member of the schema-6 mutation union
(`creativeStudioTypes.ts:2064`), admitted by the live IPC validator
(`payloadSchemas.ts:1189`, enforced at `common/adapter/main.ts:97`), with a real handler on the
mounted path (`schema2/mutations/pieceCatalogV3.ts:405-416`). Rules **materially change paid
output** — `pilot/prepare.ts:269` and `pilot/confirmation.ts:230` pass `project.rules` into
composition, which renders them into the provider prompt at `schema2/generation/composition.ts:564`.

But `rules: []` is hardcoded at project birth (`schema2/factories.ts:122`), `set_rules` has
**zero renderer call sites**, and no Director tool produces it. So `inputs.rules.length` is
provably always `0` in production, and the prompt branch that consumes rules is dead at runtime
inside a live function.

A user cannot write "always shot on 35mm" or a forbidden-terms guardrail. The feature is built,
paid for, and unreachable.

### Reference conditioning — nine layers live, blocked at the tenth

Covered in `creative-studio-4-wave-2-scope.md` §0. Live on eight of nine layers including a
shipping reference picker in `PilotCanvas.tsx:1379-1415`; every renderer *create* call is
rejected because the IPC schema omits `referencePieceIds`. **[verified]**

Related, and unresolved: conditioning capacity is **fail-closed to a single hardcoded
provider+model tuple** in production (`common/utils/imageModelAllowlist.ts:69-74`). The
admission check is correct; the admitted set is one. **[audit]**

### Per-Piece export — behind an off-by-default flag

Fully wired end to end, but every export command short-circuits unless
`AIONUI_ENABLE_CREATIVE_STUDIO === '1'`. Also: reveal-in-Finder opens the app's internal store
root rather than the user's chosen destination. And eight orphaned export IPC channels remain
declared at `ipcBridge.ts:1432-1457` with no provider, two of them still invoked by a surviving
renderer hook. **[audit]**

---

## Class 3 — Simply absent

Nobody wrote these down as out of scope, and nothing implements them.

| Capability | Evidence |
|---|---|
| **A Piece can never be deleted, parked or reordered** | No `delete`/`reorder` in the live six-member mutation union (`creativeStudioTypes.ts:2061-2066`); they exist only in dead V2 vocabulary |
| **A Piece is write-once** | Once it holds an asset, every further generation path on it is categorically refused — no regenerate, no iterate |
| **The brief is write-once** | Only reachable writer is `PilotLibrary.tsx:179 createProjectV3`; yet the brief is prepended to every paid generation |
| **A project cannot be renamed** | `edit_project` has zero renderer callers; the canvas header prints the name as static text |
| **Undo works only for rename** | `pieceCatalogV3.ts:437` builds an undo entry only `if (renameBefore !== null)`; the UI literally says `canvas.actions.undoRename` |
| **No project settings** | No aspect ratio, resolution, target duration or style at project level |
| **No model/route choice** | The user cannot see or pin which model renders their work |
| **No batch authorization** | Every image is its own priced request and its own confirmation click |
| **No full-screen viewing** | A 1080p result is viewable only at grid-tile size |
| **No project thumbnails** | The library is a text list |
| **No export history** | A one-shot banner; dismiss it and the record is gone |

**The undo narrowing contradicts a standing ruling.** The CS2 transition plan requires director
edits to be undoable from phase 1. Shipped undo covers rename only — while `i18n-keys.d.ts`
still carries undo labels for `set_brief`, `set_rules`, `set_spend_policy` and `edit_project`,
which is the residue of the intent. **[audit]**

### The Director lost most of its job

Five tools ship (`get_project_status`, `prepare_photo`, `rename_piece`, `get_command_status`,
and Wave 1's `propose_board`). The dead `studioServer.ts` declares seven more. **[verified]**

The Director **cannot see any image** — it cannot critique the photograph it just made. It
cannot revise an existing Piece ("same photo, but make the jacket red" is inexpressible). It
cannot retry a failure. It has no visibility into models, routes or price. And proposal
review — propose a change, user accepts or rejects a diff — no longer exists on the shipped
path.

---

## What this means

**The over-engineering worry was aimed at the wrong risk.** CS4 is not over-built. It is
under-scoped relative to what it replaced, and the gap was never measured until now.

**Class 2 is the actionable emergency.** Three features are built, live and unreachable. That is
pure waste already paid for, and each is small to connect: an IPC field, a composer input, an
env flag. Nothing about Class 2 requires a wave.

**Class 1 is a product decision, not a bug list.** Those capabilities were deliberately deferred.
The question is whether Pilot 1 was ever meant to become the product, or to prove one.

**Class 3 is the credibility risk.** "You cannot delete a photo you generated" and "you cannot
fix a typo in your brief" are not roadmap items — they are the things a pilot user hits in the
first ten minutes.

### Recommended order

1. **Fix the reference-conditioning IPC omission.** It blocks new-Piece creation from the UI today.
2. **Connect or delete the rules feature.** It is rendered into every paid prompt and always empty.
3. **Decide Class 3 minimums before pilot users touch it** — at minimum: delete a Piece, edit the
   brief, rename a project, view an image full-size.
4. **Then** decide Class 1 scope, which is the real "what is CS4" question.

---

## Method note

The three defects this audit corrected in its own first pass are worth recording, because they
are the failure modes of auditing this codebase:

1. **Counting literals measures nothing.** A count of `'image'` literals was simultaneously too
   high (16 of 17 in one file were already-video-safe branching) and too low (~10 real hardcodes
   in that same file went uncounted).
2. **Dead code looks alive.** `v2Service.ts` is 4,506 fully-featured lines that run nowhere.
   Prove reachability — a registration, a mount, a build entry point — before citing anything.
3. **Trace the vertical slice.** Nine layers each looked locally reasonable while the tenth
   silently rejected every call.
