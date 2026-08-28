# Creative Studio 3 — a commission: the Beat panel's three bands should be one timeline

**For:** the designer of the Beat and Shot prototype
**From:** engineering, 2026-08-28
**About:** the Beat panel's Shot bands — [BUG-171](./creative-studio-3-bug-list.md) and the owner's review of 2026-08-28
**Needs:** a drawing. All five decisions are settled — this is a visual commission, not an open question

## The short version

The Beat panel currently stacks **three parallel bands that each enumerate the same Shots**. The owner
asked, looking at it: _"the two band for Shot — do we really need both?"_ and _"do we need the band of
time? what is a more standardised design for movie editing?"_

Our answer to the first is no. Our answer to the second is that the standard is **one clip track under
one time ruler**, which is what every editor the owner has ever used does — Premiere, Resolve, Final
Cut, Avid.

The bands were split for a reason — money, explained below — and collapsing them naively would have
destroyed that safeguard. The owner has since cut the knot: **the rail will not trim**. That removes
the hard part, and what we are commissioning is now the simple version: a track that shows the Beat
and moves through it, with every mutating action stated explicitly rather than dragged.

## What is there now

Three rows, top to bottom, for a Beat of six Shots:

| Band       | Content                                                          | Its legend                                  |
| ---------- | ---------------------------------------------------------------- | ------------------------------------------- |
| Chip row   | `Shot 1 … Shot 6`, each `RENDERED`, with `×` controls between    | `BOUNDARY · COSTS A RE-RENDER`              |
| Rail       | `Shot 1 RENDERED 6s source`, join thumbnails, playhead, scrubber | `EDGE · TRIM · FREE` / `RAIL · SEEK · FREE` |
| Plan strip | `6s plan  5s plan  4s plan  5s plan  6s plan  5s plan`           | —                                           |

Every Shot's name appears three times and its duration twice. The three legends exist to tell the
owner which band does what, which is itself the symptom: a layout needs a caption per row only when
the rows are not self-evident.

## Why the bands are not arbitrary — read this before redrawing

**The bands are split by cost, not by task.** That is the constraint that makes this interesting.

- Dragging a Shot's **edge** (trim) is **free** — it changes in/out points on footage we already have.
- Dragging a **boundary** between two chained Shots **costs a re-render**, because each Shot begins on
  the last frame of the one before. Move the join and the next Shot's start frame changes, so it must
  be generated again — real money, and at present a chained re-render succeeds about a third of the
  time ([BUG-165](./creative-studio-3-bug-list.md)).
- **Seeking** is free.

So the current design put free actions and paid actions on separate rows and captioned them. It is a
defensible instinct and it is why we are not just deleting two rows.

## The decision that simplifies this: no trimming on the rail

**The owner's direction, 2026-08-28: the rail does not trim. Keep it simple first.**

This is a deliberate reduction of scope and it changes the shape of the answer, so please read it
before drawing. Direct manipulation of duration — dragging a Shot's edge to change its in or out
point — is **out** of this version. The rail is for reading the Beat and moving through it, not for
editing its lengths by hand.

That removes the ambiguity the three bands were built to manage. With no trim gesture there is no
free drag sitting a few pixels from a paid one, so the track no longer has to teach the difference
mid-gesture. What remains is a track that **shows** structure and time, and **seeks**. Any change to
duration or structure happens through an explicit, named action — the Director, or a control that
says what it will do and what it costs — rather than by dragging.

## The five decisions, all settled — not open for redesign

1 and 2 were answered directly by the owner; 4 likewise. 3 and 5 were decided by engineering on the
reasoning given. They are constraints, not options. If any of them looks wrong to you, say so before
drawing rather than drawing around it.

1. **One track.** One clip track under one ruler. Each Shot is a block whose **width is its duration**.
   The chip row and the plan strip go away; their content is carried by the block and the ruler.

2. **Seek and select, nothing else.** That is the track's entire interactive vocabulary. No trimming,
   no dragging of any kind, no reordering by hand. A block can be selected and the playhead can be
   moved. Everything that changes the film happens elsewhere, through a named action.

3. **The paid action lives on the selected Shot, not at the seam.** Decided by engineering, and the
   reason is that the data model already agrees: the chain is stored as `chainBreak` **on the Shot**,
   not as a separate join entity, and the Board's Shot tiles already say `Chain head` or `After 2.1`.
   So a join is already expressed as the downstream Shot's start condition, and the control should
   read the same way — _how does this Shot start?_ — in the selected Shot's own detail area, using the
   same two words the Board uses. Two further reasons it is not at the seam: at a 4s minimum in a
   track narrowed by the Director rail, seams are a few pixels apart, and we have just filed
   [BUG-176](./creative-studio-3-bug-list.md) for a 19px click target on this very screen; and the cut
   has **no undo**, so a mis-click at a seam would spend money with no way back. Please still draw how
   a chained join versus a hard cut **reads** at the seam — the seam should show the state, it just
   should not be the control.

4. **`plan` is reference only.** The owner's answer: the planned length is not authoritative, so it
   must not be what the eye reads first. Block width comes from the **actual** footage length, since
   that is what will really play. One caveat for the drawing: an unrendered Shot has no actual length
   yet, only a plan — so a block's width comes from its actual duration where one exists and its plan
   where it does not, and the block has to make clear which of the two it is currently showing.
   Where both exist and disagree, that is worth seeing but is not an error and should not be dressed
   as one.

5. **The ruler is Beat-relative, with the film position stated once in the header.** Decided by
   engineering. Ticks run `0s … 31s`, because the owner's stated job for this track is reading the
   rhythm _inside_ a ~30-second Beat, and rhythm is far easier to read from a ruler that starts at
   zero than from one running 1:47 to 2:18. The film context is not lost: state it once as text near
   the Beat's name — something of the form `Beat 3 · 1:47-2:18 of 3:04` — rather than pushing timecode
   into every tick.

## What we are asking you to draw

Draw the plainest thing that satisfies the five. The track is a **reading instrument**: its job is to
let someone see the shape of a 30-second Beat at a glance and move around inside it.

With every decision settled the commission is narrow and entirely visual. We need **one narrow track
drawn well**, which is the part we would get wrong on our own:

- **The block at realistic size.** Six blocks of 4-6s each, in a track narrowed by the permanent
  Director rail. Each block still has to carry a name, a status word and a thumbnail. That is the hard
  problem: it is a lot of information in very little width, and it is why we are asking rather than
  improvising.
- **The ruler and its relationship to the blocks** — tick density at ~30s, and how the playhead reads
  across both.
- **Selection.** What a selected block looks like, given selection is now one of only two gestures and
  is the route to every action on a Shot.
- **The seam.** How a chained join reads differently from a hard cut, as a state rather than a control.
- **Status inside the block**, including the two-part case `RENDERED · LATEST ATTEMPT FAILED`, which is
  long and has to survive at block width.
- **The plan-versus-actual distinction** from decision 4, including the unrendered case where only a
  plan exists.
- **The empty and partial states.** A Beat whose Shots are not yet rendered still has a track; show
  what it looks like with nothing, and with some, generated.

## Constraints the drawing has to live within

- **Shot length is 4–15 seconds**, and a Beat holds **up to 8 Shots**. Typical is 5–6 Shots of 4–6s, so
  a Beat is ~30s. The track must not assume long clips; at 4s minimum, six blocks in one row are
  narrow, and each still needs a name, a status and a thumbnail.
- **The Director rail is permanent** and takes horizontal space from the left of the workspace, exactly
  as in the app bar question. The track cannot assume full window width.
- **The chain is the product's central mechanism.** Each Shot starts on the previous Shot's last frame.
  Whatever replaces the `×` must express that a join is _chained_ — and that breaking it is a real
  structural act, not a cosmetic one.
- **`RENDERED`, `FAILED`, `STALE` and the rest are a fixed vocabulary** already used on the Board's
  Shot tiles. The track should use the same words for the same states so the two views agree.
- Status is a qualifier, not a replacement: a Shot with footage whose last attempt failed reads
  `RENDERED · LATEST ATTEMPT FAILED`.

## What we are not asking

- Not a new colour system, and not new typography. The prototype's tokens stand.
- Not the Board or the Table. This is the Beat panel only, though if your answer implies a change to
  how Shot status reads, say so and we will reconcile the two.
- Not audio. Sound is planned separately (see
  [the sound and progressive-workspace plan](./creative-studio-3-sound-and-progressive-workspace.md))
  and no waveform or audio track is wanted here yet. If your track has an obvious place for one later,
  a note is welcome; a drawn audio lane is not.
- Not trimming. Direct manipulation of duration is deliberately out of this version (see _The decision
  that simplifies this_). If your drawing implies trim handles, we will not build them, so please draw
  the version without.
- Not the cut editor on the Cut view. That is its own surface.

## Decided after the designer's response, 2026-08-28

The drawing answers every question it was asked and is buildable as drawn. Three things it did not
cover are decided here rather than sent back, because they turn on how the product already stores
status rather than on how it should look.

**The gap.** The spec's status note reads _"FAILED is one word from the fixed vocabulary — Rendered,
Queued, Rendering, Failed — so it holds at 4s width without wrapping."_ That is a four-word
vocabulary. Ours is six, and it carries two qualifiers on top. Measured from `en-US`:

| Label                   | Chars | Fits ~78px? |
| ----------------------- | ----- | ----------- |
| `Queued` / `Failed`     | 6     | yes         |
| `Rendered`              | 8     | yes         |
| `Not ready`/`Rendering` | 9     | yes         |
| `Ready to render`       | 15    | **no**      |
| `Latest attempt failed` | 21    | **no**      |

At the drawing's own tightest case — six 4s Shots at ~78px each — roughly 13 characters of the
prototype's 9.5px mono survive. So exactly two strings overflow, and `RENDERED · LATEST ATTEMPT
FAILED` (30 characters) never had a chance.

**6 — the qualifiers are marks on the block, never appended text.** This is not a model change. The
vocabulary module already separates them:

```ts
type WorkspaceShotStatus = { word: WorkspaceShotStatusWord; stale: boolean; latestAttemptFailed: boolean };
```

`stale` and `latestAttemptFailed` are booleans beside the word, each with its own i18n key. The
Board's `RENDERED · LATEST ATTEMPT FAILED` is that structure concatenated for a surface with room;
it is a rendering choice, not the shape of the data. The track renders `word` as text and the two
booleans as marks, so both views read the same structure and neither invents a state. The full
sentence belongs in the selected Shot's detail panel — where the action it warns about already lives
— and in the block's accessible name. This also matches the drawing's own grammar: `ACTUAL ≠ PLAN`
is already expressed as a dashed line plus prose elsewhere, on the stated principle that it is
_"worth seeing, not an error"_. A failed retry over good footage is the same kind of fact.

**7 — `Ready to render` becomes `Ready`.** It is the only word that overflows, and the fix is the
shared label rather than a track-only abbreviation. A compact variant would give the two views
different words for one state, which the commission explicitly ruled out. `Not ready` / `Ready` is
also the more natural pair, and the current phrasing is the odd one of the six. This edits an
existing value in all twelve locales; it adds no key, so the exact-key-set contract test is
unaffected, but it does need twelve real translations rather than an English string copied across.

**8 — the block omits the word when the Shot is `rendered`.** The drawing already distinguishes
footage from intent by fill: solid with a thumbnail means it will play, hatched with a dashed edge
and `PLAN` means it will not yet. For a rendered Shot the word therefore repeats what the fill has
already said, and it is the overwhelmingly common case — 30 of 36 Shots on the live `Plateau`
project. Dropping it leaves the usual block carrying id, duration and thumbnail, and reserves text
for the five states that genuinely need saying, of which `queued` and `rendering` are the ones an
owner is actually watching for. Absence is safe here only because fill already encodes it; do not
extend this to any other word.

## For reference

The owner's words, in full, on seeing the current panel: _"the two band for Shot??? do we really need
both?"_ and _"do we need the band of time? what is a more standardised design for movie editing?"_

Related entries in the bug list: **BUG-171** (every view wraps itself in a card repeating its own
name — the Beat panel is not exempt), **BUG-175** and **BUG-176** (the Board's Beat cards, whose
treatment should agree with whatever the track does), and **BUG-165** (why a chained re-render is
expensive in more than money).
