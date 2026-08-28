# Creative Studio 3 — a commission: the Beat panel's three bands should be one timeline

**For:** the designer of the Beat and Shot prototype
**From:** engineering, 2026-08-28
**About:** the Beat panel's Shot bands — [BUG-171](./creative-studio-3-bug-list.md) and the owner's review of 2026-08-28
**Needs:** a drawing, and answers to the four questions in _What we are asking_

## The short version

The Beat panel currently stacks **three parallel bands that each enumerate the same Shots**. The owner
asked, looking at it: _"the two band for Shot — do we really need both?"_ and _"do we need the band of
time? what is a more standardised design for movie editing?"_

Our answer to the first is no. Our answer to the second is that the standard is **one clip track under
one time ruler**, which is what every editor the owner has ever used does — Premiere, Resolve, Final
Cut, Avid. We could collapse the bands ourselves, but there is a reason they were split, and
collapsing them naively would destroy it. That reason is money, and it is the actual design problem.
So we are commissioning rather than improvising.

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
defensible instinct and it is why we are not just deleting two rows. **The question is how one track
can make a paid drag feel different from a free drag at the moment of the gesture** — before the money
is spent, not after.

## What we are asking

1. **One track or two?** Our position is one clip track under one ruler, with each Shot a block whose
   **width is its duration**. Do you agree, or does the chain model justify keeping a structural row
   separate from a temporal one? If one track: what happens to the `×` boundary control — does it live
   at the block seam, and what does it look like when the join is chained versus a hard cut?

2. **How does the track distinguish a free drag from a paid one?** This is the real commission. Edge
   trim is free, boundary drag costs a re-render. Both are horizontal drags on the same block, a few
   pixels apart. We need a treatment that makes the difference legible **before** the drag commits —
   cursor, handle shape, colour, a confirm step, something else. Note the product's rule: **the cut has
   no undo, ever**, so a mistaken paid drag cannot be taken back, only paid for again.

3. **Does `plan` versus `source` survive as two numbers?** In an NLE this distinction is not two rows;
   it is one clip whose trimmed extent is shown against its untrimmed source at the handles.
   `6s source / 6s plan` is a clip trimmed to its own edges. Can we express both with one block plus
   trim handles, or is there a reason the owner needs the planned duration stated as its own text?

4. **What does the ruler measure?** Beat-relative (`0s … 31s`) or film-relative (this Beat starts at
   1:47)? The Beat panel is entered from the Board, so the owner arrives with film context and may
   want to keep it.

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
- Not the cut editor on the Cut view. That is its own surface.

## For reference

The owner's words, in full, on seeing the current panel: _"the two band for Shot??? do we really need
both?"_ and _"do we need the band of time? what is a more standardised design for movie editing?"_

Related entries in the bug list: **BUG-171** (every view wraps itself in a card repeating its own
name — the Beat panel is not exempt), **BUG-175** and **BUG-176** (the Board's Beat cards, whose
treatment should agree with whatever the track does), and **BUG-165** (why a chained re-render is
expensive in more than money).
