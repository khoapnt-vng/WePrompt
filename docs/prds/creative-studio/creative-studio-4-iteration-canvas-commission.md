# Creative Studio 4 — a commission: the canvas when it is all one thing

**For:** the designer of the CS4 canvas
**From:** engineering, 2026-08-31
**About:** a case the [block grammar](./creative-studio-4-block-grammar.html.txt) does not cover, and
that Pilot 1 will produce on its first day
**Needs:** one answer, and probably one drawing. Much smaller than the grammar

## First, a correction we owe you

The block grammar commission told you _"the canvas now has to win"_ against surviving views, because
we had decided to ship it alongside References, Table, Board and Cut.

**That decision was reversed.** CS4 is a clean cutover: the four views are removed when the canvas
ships. The reasoning was ours and it was wrong in an interesting way — the CS4 project schema does not
carry the film collections those views read, so coexistence was never a scheduling choice, it was a
contract change nobody had scoped.

Nothing in your grammar changes, and the consequence is _smaller_ than what you were told: the canvas
does not have to out-compete an alternative, it only has to be right. The parts you wrote to make it
earn its place — one vocabulary across six kinds, density that never quietens a decision — are good
design rather than competitive necessity.

## The short version

Every canvas in the wireframe and the grammar is **heterogeneous**: a script, a cast, some places, a
clip row, a cut. Six kinds, each present once or twice, each visually distinct.

**Pilot 1 will not look like that.** It produces one kind, repeatedly.

Three rules in the built contract compose into it:

- A person iterates by **making another Piece**. The model offers no variation, no replacement, and
  no regeneration of completed work — _"different words create a sibling Piece."_
- **Nothing can be deleted.** There is no delete operation, and a completed Piece is frozen forever.
- The project holds **96 Pieces**, and no slot can ever be freed.

So the realistic first session is not a script beside a cast beside a cut. It is **fourteen
photographs of a salt flat at dawn**, differing by one clause of prompt, all `stills`, all
`RENDERED`, all present at once and permanently.

## Why this is a design problem and not just a lot of blocks

Three of the grammar's own rules point the wrong way in this case — each correct for a varied canvas,
each inverted here.

**The handle stops distinguishing.** Handles derive from the words, and iterations differ by one
clause, so the machine appends a suffix: `a_salt_flat_at_dawn`, then `a_salt_flat_at_dawn_2`, and
onward. The grammar puts the handle first in every header, always, as the thing a person identifies a
block by — and it degrades into a numbered series exactly when it matters most.

**Quiet density hides the only difference.** At 9+ blocks the grammar silences `RENDERED` and
`IMPORTED`, showing chips only for states that need a person. Correct when blocks differ by kind. But
when every block is a rendered photograph, _what was rendered_ is the entire distinction, and the
canvas goes quiet about the one thing being compared.

**The crowding remedy is per-block, and this crowding is per-canvas.** A stills set caps at two rows
with a "+12 more" member — but fourteen iterations are fourteen separate **blocks**, not fourteen
members of one. The cap never fires.

## What we are asking

**One question, answered however you like — prose is fine, a drawing if it helps:**

> What does the canvas look like when a person has made fourteen attempts at the same photograph, all
> finished, none deletable?

Things we would find useful in an answer, none of them required:

- **Does repetition get its own treatment**, or does the grammar already have the answer and we have
  read it wrongly? A run of same-kind blocks is a legible thing in its own right, and it may want to
  read as a series rather than as fourteen unrelated cards.
- **What distinguishes two blocks whose handles are one character apart?** The thumbnail is the honest
  answer; if so, say what else must go so the thumbnail can be large enough to compare.
- **Does the quiet density rule need an exception**, or does its invariant already cover it — "density
  may quieten satisfied work; it may never quieten a decision" — on the reading that comparing
  attempts _is_ a decision?
- **Is there a shape for "these are the same subject"** that costs nothing in the data model? We
  cannot give you grouping — there is no group field and the contract is being frozen — but the
  Pieces do carry their originating words, their order, and their timestamps.

## Constraints

- **No grouping, captions, or per-member aspect exist.** Each iteration is an independent Piece with a
  handle, an image, an order and a timestamp. Anything that requires a parent, a set id or a caption
  is out of reach for Pilot 1.
- **Nothing can be deleted or hidden by the person.** Whatever you draw must remain true when the
  count only ever goes up.
- **The ceiling is 96 and the refusal is graceful** — the ninety-seventh attempt is refused before any
  money is spent, with an explanation. You do not need to design that refusal, but the canvas should
  not feel like it is heading somewhere bad.
- Everything from the grammar still holds: Arco only, six regions, twelve locales, both rail extremes.

## What we are not asking

- **Not a redesign of the grammar.** It is accepted and being built; this is a case it did not cover.
- **Not deletion, archiving, or a bin.** Those need schema work that is not in Pilot 1.
- **Not a comparison mode, a lightbox, or a chooser** unless you think one is unavoidable — and if you
  do, say so plainly, because that is a scope conversation rather than a drawing.
- **Not the first-run plate.** Unchanged, except that Pilot 1 offers two actions rather than three.

## For reference

- [The block grammar](./creative-studio-4-block-grammar.html.txt) — six kinds, six regions, the
  density steps, and the shedding order.
- [Engineering notes on the grammar](./creative-studio-4-block-grammar-notes.md) — what it settles,
  and the status-vocabulary correction.
- [The canvas wireframe](./creative-studio-4-canvas-wireframe.html.txt) — the three scenarios, all of
  which are heterogeneous, which is how we missed this.
