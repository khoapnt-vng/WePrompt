# The Director draws the board — implementation plan

**Date:** 2026-08-23 · **Status:** plan, not started
**Design:** `Director Storyboard - Hi-fi (standalone).html` + the designer's handoff notes
**Related:** [bug list](../prds/creative-studio/creative-studio-3-bug-list.md) ·
[film export](creative-studio-3-film-export.md) ·
[direction and answers](../prds/creative-studio/creative-studio-3-direction-and-answers.md)

The design is good and most of it is buildable. Three of its load-bearing sentences are false against
this codebase, and one of those is dangerous. Everything below is ordered around that.

## Three claims the build cannot honour as written

### 1. "Redraw and replace are free and silent"

There is no free path that produces new pixels. `spendMath.ts:48` refuses any quote item outright:

```ts
if (!Number.isSafeInteger(item.rateMinorUnits) || item.rateMinorUnits <= 0 || item.generationCount !== 1) return null;
```

and `calculateStudioQuoteTotals` nulls the **whole quote** when any single item returns null. Above
that, every route that yields an image goes through `selectionGateDraft` → the spend gate → a
`spendReceipt` written at the one site that writes them.

A board still is an image generation at a provider. It costs real money. Thirty of them at the
current image rate is thirty times three minor units — small, but not nothing, and not zero.

**What is actually negotiable is whether drawing is _gated_, not whether it is _free_.** The design's
"one paid gesture" instinct is right; the honest form of it is _one gate for the whole board_, not
_no gate_. The copy has to say what it costs.

### 2. "Board stills are separate from the first frame the chain consumes"

Today the opposite is automatic. `workspaceProjection.ts:318`:

```ts
const effectiveSeedStillId = (project, shot) => {
  const explicit = validExplicitSeedStillId(project, shot);
  if (explicit !== null) return explicit;
  const candidates = shot.assetIds.flatMap(…isEligibleImageTake…);
  candidates.sort(…)      // newest first, id as tiebreak
```

**Any shot-owned image with no explicit pin becomes that shot's first frame.** Drawing thirty board
stills would silently repoint thirty chain heads at storyboard art, and the next render would
condition every video on a drawing.

This is not hypothetical. It is the mechanism behind the thing the designer already saw and wrote
down — _"a 2×2 grid sitting as a seed still"_. That grid became a first frame by exactly this
fallback, and it cost four ruined Shots in the paper-boat film.

**So the enforcement point is not a validator on promotion. It is this function.** Blocking
multi-panel images from the first-frame slot treats the symptom; the disease is that the slot fills
itself.

### 3. "The Director draws the board"

The Director cannot draw, and cannot see.

- **No tool starts any generation.** All seven Studio MCP tools either read, or write a record into a
  pending directory for a human to approve (`studioServer.ts`). None can cause an image to exist.
- **No image can ever reach it.** `StudioToolResult` is `content: Array<{ type: 'text'; text: string }>`
  (`studioServer.ts:83`). `read_storyboard` projects a shot's picture state as `hasSeedStill: boolean`.
  The Director cannot look at what it supposedly drew, cannot judge it, cannot redraw it on merit.
- **`set_seed_still` is `operation_not_permitted`** (`directorCommandContracts.ts:298`), so it cannot
  bind a still either.

The honest reframing: **the app draws the board; the Director decides what goes in it.** That is still
most of the design's value — the interview, the style choice, the coverage proposal — and it needs no
new Director capability at all. Making the Director genuinely able to draw and inspect is a separate,
much larger piece of work (image results across the MCP boundary) and should not be smuggled into
this one.

## What already exists — more than expected

| The design needs                        | Already there                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| "propose four shots for the empty beat" | `apply_coverage` is **proposal-capable** (`directorCommandContracts.ts:296`) and already renders as a real review card with per-shot durations |
| a new Table column                      | columns are a declarative list; `<colgroup>` with fixed `inlineSize` — a 96px column is one entry                                              |
| real accessibility                      | native `<table>` with `role='grid'`, `aria-colcount`, roving cell focus                                                                        |
| staleness                               | two causes, computed in `chain.ts`, already surfaced per shot                                                                                  |
| cast / look references                  | role vocabulary exists (`'cast'` / `'look'`), import + detach + per-shot picker all built                                                      |
| a gate shape for promotion              | the two-line/two-price continuity gate is exactly this shape already                                                                           |

## What does not exist

**Assets.** The managed-collection union is closed at four members and duplicated in `validation.ts`
rather than imported. There is **no tier discriminator** on `StudioAssetV2` — a take and a throwaway
are distinguished only by structural inference. There is **no eviction, TTL or replace-in-place**, so
"throwaway" and "redrawable" have no storage meaning today. There is **no way to delete a shot-owned
asset at all** — the only two delete paths are for `shotId === null`.

**The purpose union.** `'seed_still' | 'video_take'` is an inlined literal repeated in nine type
declarations with no named alias, and roughly ninety production references. Three traps sit on it:

- eight ternaries of the form `purpose === 'seed_still' ? 'image' : 'video'` **fail open into video** —
  an unrecognised purpose would be routed to the video adapter and priced per second
- `createStudioQuotedGenerationId` **throws a raw `TypeError`** for an unknown purpose instead of
  returning a pricing refusal
- `spendMath` rejects it, nulling the whole quote

**References-as-designed.** No numbering, no ordinal, no permanence, no default, no subject entity, no
multi-angle sheet. A "cast reference" is one image with a role. Detach **deletes the asset outright**
with no tombstone, so _"numbers are permanent, removing one never renumbers the rest"_ is not
expressible without a new record type. The cap of six is the **provider's** `maxConditioningImages`
ceiling, not a product choice.

**Table expansion.** No `aria-expanded`, no disclosure, no nested rows anywhere in Studio.

**A structured question surface.** The Director rail is a plain chat; there is no elicitation/form
card primitive. The design's "form card in the rail" is new UI.

## Two naming collisions, one of them in the main process

**`BOARD`** is already a view (`STUDIO_VIEWS = ['table','board','cut']`) — and that constant is
**shared with the main process**, because a main-process regex gates the unsaved-work close dialog.
It is not a renderer-local name.

**`PANEL`** is already the Beat detail modal — component directory `BeatPanel/`, i18n subtree
`beatPanel.*`.

The designer flagged the first and sidestepped it by never using the word in the column direction.
That works for the column; it does not work for the app bar, which still has both. **Pick the words
before any code**, because both are load-bearing identifiers, not labels.

## The rename: copy is free, identifiers are not

`Seed still → First frame` splits cleanly in two:

- **Copy** — free. The four strings the design names, plus the rest of the `beatPanel.seeds.*` subtree
  (13 keys, 10 carrying the word), plus ~17 more keys with "seed" in the value. Four of them are
  authored in all 11 deferred locales and pinned by an exact-equality inventory test, so translations
  move in the same commit.
- **Identifiers** — a data-destroying migration. `validateStudioProjectV2` uses exact key sets, so
  renaming `seedStillId` on disk rejects every existing project; bumping the schema version to dodge
  that marks them all `unsupported_prototype_schema`. `seed_still` is also on the Director MCP wire
  in two forms, and the IPC channel `creative-studio.import-seed-still` is triple-declared.

**Recommendation: rename the copy, keep the identifiers.** The user-facing concept becomes "first
frame"; `seedStillId` stays what it is called in the store. That is a normal and defensible split.

## Slices

**Slice 1 — the first-frame slot stops filling itself.** Make `effectiveSeedStillId` return only an
explicit pin, and surface "no first frame" as a real state with an action. Rename the copy in the same
change. **This ships alone, fixes the 2×2 grid class of bug, and is a prerequisite for any new
per-shot image.** Nothing else on this list is safe before it.

**Slice 2 — a board-still tier.** A discriminator on the asset (not a fifth collection — the union is
duplicated in `validation.ts` and the null-shot law is enforced in four places), plus replace-in-place
so a redraw does not accumulate. Board stills excluded from `isEligibleImageTake` by construction.

**Slice 3 — drawing.** A `board_still` purpose: a named `StudioJobPurpose` alias first, then the nine
declaration sites, the eight fail-open ternaries, the id minter, the rate card, `spendMath`. One gate
for the whole board, priced honestly. Note `STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24 < 30`, so a
thirty-shot film is **two** gates unless that cap is raised — the same arithmetic that produced
BUG-114.

**Slice 4 — the Table column and expansion.** The column is easy; the expansion is not. `aria-rowcount`
and the roving-focus matrix are both indexed by **beat index**, not DOM row, so injected rows corrupt
the announced grid geometry and the arrow-key model. The whole `<tr>` currently opens the Beat panel
modal, so a thumb click needs its own target. And a 64×36 thumb roughly doubles a row whose cell
padding is 11px at 13px/1.35 — the "no row grows" promise needs measuring before it is believed.

**Slice 5 — promotion.** The two-line/two-price gate, reusing the continuity gate's shape. Small, once
slices 1–3 exist.

**Slice 6 — cast sheets and numbered references.** The largest model change on the list: a subject
entity, permanent ordinals with tombstones, a default, and multi-angle sheets — plus generated (not
just imported) references. **Separable, and worth separating.**

## What I would cut from a first release

- **The 3-angle cast sheet.** A new entity with generated angles, when a cast reference is one image
  today. Enormous next to the panel column.
- **Permanent numbering.** Requires tombstones for detached references purely to keep numbers stable.
- **The contact sheet export.** Lovely, and entirely additive — it can follow.
- **"Free."** Not a cut so much as a correction: say what a redraw costs.

## Open questions the design already lists, with my read

- **Can a Look cite two references?** The provider ceiling is six conditioning images, so multiple
  citations are technically fine. The reason to say no is comprehension, not capability.
- **Does the Director cite references when it writes the Look?** It cannot see them, so any citation
  would be by label alone. Until images cross the MCP boundary, prefer no.
- **Is the interview the entry point, or is the constants sheet enough?** The constants sheet is
  enough for v1 and needs no new elicitation primitive.
- **Does `BOARD` collide?** Yes, and in the main process. Settle it first.
