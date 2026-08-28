# Creative Studio 3 — a commission: the Beat panel's three bands should be one timeline

**For:** the designer of the Beat and Shot prototype
**From:** engineering, 2026-08-28
**About:** the Beat panel's Shot bands — [BUG-171](./creative-studio-3-bug-list.md) and the owner's review of 2026-08-28
**Needs:** a drawing. Two of the five questions are already settled by the owner; three remain

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

## Settled by the owner, 2026-08-28 — not open for redesign

These two were the structural questions, and the owner answered them directly. They are given here as
constraints, not as options.

1. **One track.** One clip track under one ruler. Each Shot is a block whose **width is its duration**.
   The chip row and the plan strip go away; their content is carried by the block and the ruler.

2. **Seek and select, nothing else.** That is the track's entire interactive vocabulary. No trimming,
   no dragging of any kind, no reordering by hand. A block can be selected and the playhead can be
   moved. Everything that changes the film happens elsewhere, through a named action.

Please draw the plainest thing that satisfies those two. The track is a **reading instrument**, and
its job is to let someone see the shape of a 30-second Beat at a glance and move around inside it.

## What we are still asking

3. **Where does a paid action live, now that it is off the track?** Breaking or moving a join re-renders the
   next Shot and costs money. With dragging gone it must become an explicit, labelled control. Should
   it sit on the selected Shot, at the seam between blocks, or outside the track entirely? It needs to
   state its consequence before it is taken, not after — and since selection is now one of only two
   gestures, the selected block is the obvious host unless you see better.

4. **How should `plan` and `source` read without trim handles?** In an NLE these are one clip and its
   trimmed extent, expressed at the handles — but we no longer have handles. Are two numbers still
   warranted, or does the block simply show its duration? If a Shot's planned length and its actual
   footage length can differ, the track has to show that they differ; how, without implying the owner
   can drag to fix it?

5. **What does the ruler measure?** Beat-relative (`0s … 31s`) or film-relative (this Beat starts at
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
- Not trimming. Direct manipulation of duration is deliberately out of this version (see _The decision
  that simplifies this_). If your drawing implies trim handles, we will not build them, so please draw
  the version without.
- Not the cut editor on the Cut view. That is its own surface.

## For reference

The owner's words, in full, on seeing the current panel: _"the two band for Shot??? do we really need
both?"_ and _"do we need the band of time? what is a more standardised design for movie editing?"_

Related entries in the bug list: **BUG-171** (every view wraps itself in a card repeating its own
name — the Beat panel is not exempt), **BUG-175** and **BUG-176** (the Board's Beat cards, whose
treatment should agree with whatever the track does), and **BUG-165** (why a chained re-render is
expensive in more than money).
