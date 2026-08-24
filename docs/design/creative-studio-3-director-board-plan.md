# The Director draws the board — implementation plan

**Date:** 2026-08-23 · **Status:** Slices 1–5 implemented; Slice 6 deferred
**Design:** `Director Storyboard - Hi-fi (standalone).html` + the designer's handoff notes
**Related:** [bug list](../prds/creative-studio/creative-studio-3-bug-list.md) ·
[film export](creative-studio-3-film-export.md) ·
[direction and answers](../prds/creative-studio/creative-studio-3-direction-and-answers.md)

The design is good and most of it is buildable. Three of its load-bearing sentences are false against
this codebase, and one of those is dangerous. Everything below is ordered around that.

## Settled implementation decisions

The hi-fi was reviewed against the live project, pricing, job, media, and Table contracts on
2026-08-24. Where the visual prototype and product authority diverge, these decisions control the
implementation:

- **Redraw is paid.** Any action that asks a provider to create new pixels uses a fresh quote and
  confirmation. Promoting an existing panel without generating pixels may remain free.
- **The existing 24-Shot request ceiling remains.** Draw/Resume selects the next missing panels in
  film order, up to 24. A 30-panel board therefore needs two explicit paid confirmations (24 + 6);
  the UI must not imply that the first confirmation authorizes all 30.
- **Board authority uses schema v4 with no migration.** Creative Studio has no retained production
  data yet, so valid v3 projects are reported unsupported and remain byte-for-byte untouched. New v4
  projects carry the current board pointer, ordered superseded-board history, and project board style.
  Redraw publishes a new immutable asset and swaps the pointer atomically. Superseded assets, jobs,
  authorizations, receipts, and bytes stay durable but disappear from the current-board surface; this
  release does not delete paid history.
- **The Table keeps `Status`.** Add the 96px `Panel` column without removing the existing status
  surface. The hi-fi's combined `Action · Look` compression is not part of this change.
- **Stop is bounded cancellation, not a refund.** It cancels work that has not started and requests
  cancellation for running jobs whose provider policy permits it. Completed panels and durable spend
  receipts remain. Copy must not promise a refund or the cancellation of an already billable call.

The primary v1 surface is the Table's Panel column and one-at-a-time inline Beat expansion. Docked
Band, contact-sheet export, generated cast sheets, permanent reference numbering, and image-aware
Director capabilities remain later slices.

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

**What is actually negotiable is how drawing is _gated_, not whether it is _free_.** The design's
"one paid gesture" instinct becomes one honest confirmation per legal batch: with the retained
24-Shot ceiling, the thirty-panel fixture is confirmed as 24 + 6 rather than silently widening spend
authority. The copy has to say what each batch costs and what remains afterward.

### 2. "Board stills are separate from the first frame the chain consumes"

Today the opposite is automatic. `workspaceProjection.ts:318`:

```ts
const effectiveSeedStillId = (project, shot) => {
  const explicit = validExplicitSeedStillId(project, shot);
  if (explicit !== null) return explicit;
  const candidates = shot.assetIds.flatMap(…isEligibleImageTake…);
  candidates.sort(…)      // newest first, id as tiebreak
```

**Any eligible shot-owned image with no explicit pin becomes that shot's first frame.** That fallback
is intentional authority for real first-frame media: the owner decision makes the latest unpinned
still the default, and a reviewed sever pins the exact effective still that the user confirmed.
Drawing thirty board stills into an eligible collection would nevertheless repoint thirty chain heads
at storyboard art, and the next render would condition every video on a drawing.

The designer's _"2×2 grid sitting as a seed still"_ is related but not the same class of failure. The
fallback made an unpinned grid effective on that path, but removing the fallback would not reject a
grid that is explicitly pinned or otherwise selected. The one-picture authority deliberately defers
that detector until provider validation or a calibrated corpus exists. Board-tier isolation and
variation-grid rejection therefore remain separate controls.

**The clean fix already has a precedent in the codebase.** `eligibleSeed` (`chain.ts:84`) admits only
assets in the `'assets'` or `'imports'` collections, which is why video **posters** — shot-owned
images sitting in `shot.assetIds` since `mediaStore.ts:3529` — are structurally invisible to the
first-frame fallback. A board still in a collection the fallback does not admit is ineligible by
construction, with no change to how real seed stills behave.

One visible gate is `validation.ts:1529`, which requires a job's **primary** output to live in
`'assets'`:

```ts
primary.managedAsset.collection !== 'assets' || …  → invalid
```

Posters escape it only because they are not primary outputs. A board collection is a bounded design,
but `validation.ts:1529` is not the whole implementation: the output loop at `validation.ts:1516`
also closes the collection set, as do `StudioManagedAssetRefV2`, the managed-collection registry, and
the provider write-plan union and routing. The new purpose must exist before validation can constrain
the new collection to board images while keeping `seed_still` and `video_take` primaries in
`'assets'`.

### 3. "The Director draws the board"

The Director cannot draw, and cannot see.

- **No tool starts any generation.** All seven Studio MCP tools either read, or write a record into a
  pending directory for a human to approve (`studioServer.ts`). None can cause an image to exist.
- **No image can ever reach it.** `StudioToolResult` is `content: Array<{ type: 'text'; text: string }>`
  (`studioServer.ts:83`). `read_storyboard` does hand back a real `videoAssetId` (`studioServer.ts:840`),
  so the Director can name a picture — but it can never see one, so it cannot judge what it drew or
  redraw it on merit.
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
| staleness (for shots that have video)   | two causes, computed in `chain.ts`, already surfaced per shot                                                                                  |
| cast / look references                  | role vocabulary exists (`'cast'` / `'look'`), import + detach + per-shot picker all built                                                      |
| a gate shape for promotion              | the two-line/two-price continuity gate is exactly this shape already                                                                           |

## What does not exist

**Assets.** The managed-collection union is closed at four members and duplicated in `validation.ts`
rather than imported. There is **no tier discriminator** on `StudioAssetV2` — a take and a throwaway
are distinguished only by structural inference. There is **no eviction or TTL**, and no way to delete
a shot-owned asset at all — the only two delete paths are for `shotId === null`. A redraw must not
overwrite immutable managed bytes: it needs a new asset, an atomic board-pointer swap, and only then
authority-checked retirement of the old asset.

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

**Staleness for a boarded-but-unrendered film.** This one is worse than "the wrong cause".
`deriveStudioDirtyShotsV2` opens with a hard gate (`chain.ts:257`):

```ts
const selected = selectedVideoTake(project, shot);
if (selected === null) continue;
```

**A shot with no video is never dirty, for any cause.** The design's entire premise is reading a
thirty-shot film _before any video exists_ — and in exactly that state the dirty-shot derivation
returns an empty list unconditionally. "Change a reference and the panels drawn against it go stale"
has no derivation path at all. Board staleness is new machinery, not a new cause on existing
machinery.

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

- **Copy** — free. The exact renderer scope is 32 en-US leaves: 27 values containing "seed",
  `beatPanel.seeds.latestDefault`, and four active chain/rendering labels that call the same first
  frame "the still". Twelve of those concepts are authored in every configured locale. The locale
  test pins the exact authored key set plus placeholder parity rather than the translated values, so
  the semantic translations and their explicit first-frame oracle move in the same commit.
- **Identifiers** — a data-destroying migration. `validateStudioProjectV2` uses exact key sets, so
  renaming `seedStillId` on disk rejects every existing project; bumping the schema version to dodge
  that marks them all `unsupported_prototype_schema`. `seed_still` is also on the Director MCP wire
  in two forms, and the IPC channel `creative-studio.import-seed-still` is triple-declared.

**Recommendation: rename the copy, keep the identifiers.** The user-facing concept becomes "first
frame"; `seedStillId` stays what it is called in the store. That is a normal and defensible split.

## Slices

**Slice 1 — first-frame terminology (implemented 2026-08-24).** User-facing `Seed still` copy is now
`First frame`; `seedStillId`, `seed_still`, `seed_pending`, IPC names, and the latest-unpinned fallback
remain unchanged. This is terminology cleanup. It neither detects variation grids nor isolates future
board art, and it does not claim to be a prerequisite for that isolation.

**Slice 2 — board-still authority and generation foundation (implemented 2026-08-24).** The
persisted project uses schema v4 with no migration or fold-forward; old schemas remain
unsupported/no-touch. Each Shot gains
`boardAssetId` and `supersededBoardAssetIds`; the project gains the global board style selected once
and reused. A named `StudioJobPurpose` may first land while retaining exactly the existing two values.
The behavioral change that admits `board_still` must then be atomic: add the
fifth managed collection that `eligibleSeed` does not admit, update the type and registry, both
validation gates, every purpose-sensitive router and job path (including the branches that currently
treat every non-seed purpose as video), request/write planning, the id minter, rate card and
`spendMath`. Do not let validation accept a durable board job before that exhaustive path exists.
Only a board-still image may use the board collection, while seed and video primaries remain in
`'assets'`. Model redraw as a new immutable asset plus an atomic board-pointer swap; append the prior
pointer once to superseded history and retain its immutable bytes and paid audit records. Board stills
remain ineligible for automatic fallback and generic first-frame selection **by construction**;
Slice 5's explicit promotion operation is the only path that may pin one.

**Slice 3 — drawing and spend UI (implemented 2026-08-24).** The app-owned Board generation actions
use an honestly priced gate for the next film-order batch. Keep
`STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST = 24`: Draw/Resume selects at most 24 missing panels, so the
thirty-shot hi-fi fixture requires a second six-panel confirmation. Progress and copy must show the
authorized batch separately from total board completeness. Stop uses the bounded cancellation rule
above. Redraw of one panel or one Beat builds a fresh paid board-only quote.

**Slice 4 — the Table column and expansion (implemented 2026-08-24).** The Table adds the hi-fi's
96px `Panel` column while retaining the existing `Status`, `Action`, and `Look` columns. The
expansion is not a plain extra row:
`aria-rowcount` and the roving-focus matrix are both indexed by **beat index**, not DOM row, so the
disclosure row must have an explicit accessible geometry and be skipped deliberately by Beat-cell
arrow navigation. The whole `<tr>` currently opens the Beat panel modal, so the thumbnail needs its
own button, propagation fence, `aria-expanded`/`aria-controls`, Escape behavior, and deterministic
focus return. Keep the base Beat row height stable; expanded panels occupy a separate detail row.

**Slice 5 — promotion (implemented 2026-08-24).** Only an actual segment head may promote its exact
current, fresh Board asset. The free path pins that immutable asset as the explicit first frame and
does not change `chainBreak`. The optional paid path re-renders only the segment's existing current
takes after a fresh quote and explicit confirmation; it remains unavailable when there are no current
takes, the video route is unavailable, or the legal request cap would be exceeded. Promotion is an
app-owned authoring action and is not exposed to the Director or MCP.

**Slice 6 — cast sheets and numbered references (deferred).** The largest model change on the list:
a subject entity, permanent ordinals with tombstones, a default, and multi-angle sheets — plus
generated (not just imported) references. **Separable, and worth separating.**

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
