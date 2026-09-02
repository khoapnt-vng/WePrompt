# Two rulings Phase 6 needs before anything is drawn or built

> **STATUS — Ruling 1 is SIGNED, both halves, 2026-09-02.** Approved terms recorded verbatim
> below. Ruling 2 has been superseded by
> [`creative-studio-4-ruling-2-status-vocabulary.md`](./creative-studio-4-ruling-2-status-vocabulary.md);
> the revised Ruling 2 is **SIGNED IN FULL, 2026-09-02**, and the Ruling 2 section in this
> document is kept only as the record of the first draft.
> **Nothing owner-side remains open before the Phase 6 schema freeze.**

Both are owner decisions, not design work. Neither can be settled by the designer, and the
Phase 6 commission cannot be written against an unanswered Ruling 1.

---

## Signed — Ruling 1, both halves (2026-09-02)

Recorded verbatim as approved.

**Ruling 1a — who reorders, and through what affordance**

> Director-primary typed reorder; human fallback is `Alt+↑/↓` on focused members, announced
> through `aria-live`; no visible reorder chrome; ordered bodies only.

**Ruling 1b — which reorderings are free**

> Beat reorder is free; intra-Beat Shot reorder is priced and warned; existing media becomes
> playable stale work with Re-render chain / Keep; no silent spend or substitution.

**Audio exception**

> Audio reorder is always free and never chain-stale. Script edits produce words-stale with
> Keep only.

Two consequences that follow and are now binding:

- **Canvas block order is nobody's to edit — not a person's, and not the Director's.** A run is
  derived from adjacency in canvas order, so hand-editable adjacency would collapse the
  derivation into a group field by another name.
- **BUG-174's acceptance evidence now has a specified affordance to assert against**: no
  always-visible move controls on any Beat or Shot block, the typed Director operation
  preserved as primary with a deterministic result, and the `Alt+↑/↓` path covered by keyboard
  and screen-reader evidence. BUG-174 can be claimed.

---

## Ruling 1 — Who reorders, and is reordering free

### Why this needs a ruling

Four documents answer this, and the two newest contradict each other inside a single
delivered spec.

**The delivered block grammar** states the placement rule plainly: free and reversible
actions are links on the block, everything else is said in the rail. It then applies that
rule in opposite directions on two rows:

- the set/storyboard row puts **`reorder members`** on the block, beside `rename` and
  "Still a Beat (priced but shown — it is pennies and reversible)";
- the `cut` row puts **"reordering the film; hard cuts and joins"** in the **rail**.

**CS3 priced the same two operations the other way round**
(`creative-studio-3-direction-and-answers.md` §3):

> "Chains are strictly beat-scoped. Freeze it as an invariant."
> "Reordering shots inside a beat rewrites the chain, so it invalidates downstream frames,
> so reorder inside a beat is not free. Reordering _beats_ is free. These are different
> operations and the UI must not make them look alike."

So the grammar makes member reordering free-and-on-block where CS3 makes it priced, and
makes film reordering rail-only where CS3 makes it free. Whichever way this resolves, one
of the two rows is wrong, and the block grammar's own placement rule cannot be applied
until the cost model is fixed.

**It is a four-way disagreement, not a two-way one.** Beyond the grammar and CS3's prose, the
CS3 Table & Board prototype **ships permanent reorder chrome in two places** — "drag a row to
reorder" on the Board and "drag a shot to reorder" in the Cut. The row drag agrees with CS3's
prose; the shot drag **spans the chain and is offered free and unwarned**, which contradicts
the very cost model the prose states.

**BUG-174** already sets the ownership envelope and is destined here
(`creative-studio-3-bug-list.md`, CS4 triage, **Destination: Phase 6 — Assembly and
film-structure interaction**, currently **Unclaimed**):

> "Reordering remains a Director-owned capability and must not reappear as permanent
> per-row chrome; any human alternative must remain keyboard accessible."

with acceptance evidence requiring "no always-visible move controls on every Beat or Shot
block, while Director reorder tests preserve the typed operation and deterministic result."

### What is actually being decided

Two separable questions. Please answer both.

**1a. Is reordering a Director capability, a human affordance, or both?**

- _Director only_ — simplest, matches BUG-174's default reading, no block chrome at all.
  Cost: reordering a film requires a sentence to the Director.
- _Both, Director-primary_ — BUG-174 permits this ("any human alternative"), but then the
  human path must be keyboard accessible and must not become permanent per-row chrome.
- _Human primary_ — contradicts BUG-174 and would need that triage reopened.

**1b. Which reorderings are free?** The grammar and CS3 disagree. The honest constraint is
that beat-scoped chaining makes intra-Beat reordering destructive of downstream frames,
which is a real cost regardless of how it is presented.

### Recommendation

**1a: Director-primary with a bounded, keyboard-accessible human path.** It satisfies
BUG-174 as written and keeps the canvas from becoming a file manager — the same instinct
the designer already applied to selection ("exactly one bulk act").

**Canvas block order is nobody's to edit — not a person's, and not the Director's.** This
sentence is missing from every document and the designer has asked for it explicitly. The
reason is not tidiness: **a run is derived from adjacency in canvas order**, so Phase 1's ban
on hand reordering is the only thing keeping a run honest. If either a person or the Director
may reorder blocks on the canvas, runs become hand-formable and hand-breakable and the
derivation collapses into a group field by another name.

**1b: adopt CS3's split verbatim** — intra-Beat reorder is priced and warned, Beat-scale
reorder is free — and treat the grammar's two rows as needing correction, not the ruling.
CS3's version is the one grounded in the chaining invariant; the grammar's placement was
derived from a general rule rather than from this cost.

### What changes once ruled

The Phase 6 commission can state the cost model as a constraint instead of asking about it,
and BUG-174 gets a claimant.

---

## Ruling 2 — The canvas status vocabulary

### Why this needs a ruling

The delivered grammar says the existing status vocabulary is "reused verbatim". The
engineering notes (`creative-studio-4-block-grammar-notes.md`) establish that this is true
of the **words** and not of the **keys**:

- `Rendered`, `Stale`, `Failed`, `Imported`, `Current` all exist.
- `PARTIAL`, `PROPOSED`, `STILLED`, `DRAFTED` are genuinely new.
- **`RUNNING` is not what the product says.** It ships as **"Generating"**
  (`creativeStudio.jobs.status.running`, `creativeStudio.scene.status.generating`) and as
  **"Rendering"** on shot tiles (`creativeStudio.workspace.shotStatus.rendering`). Exactly
  one key reads "Running".
- The existing keys are **view-scoped and already duplicated**, because they were built for
  the four views that Phase 5 deleted.

The notes' own framing: this "will cost twelve locales of mess if it is discovered during
implementation."

That cost is not hypothetical here. A repo test requires every referenced key to exist in
all twelve locales, so the vocabulary cannot be reconciled at the end of Phase 6 — every
task that introduces a status ships its translations with it. Phase 6 then adds video and
sound statuses on top of an already-inconsistent set.

### What is actually being decided

**2a. One canvas-scoped vocabulary, or per-kind keys?** The four view-scoped duplicates
lose their views at cutover, so this is the moment they can be collapsed at no migration
cost.

**2b. What is the running state called?** "Generating", "Rendering" and "Running" all ship
today. Video makes this worse, because rendering a film and generating a clip are
genuinely different operations that a single word will have to cover or distinguish.

**2c. Do the four new statuses survive contact with video and sound?** `PARTIAL` and
`STILLED` were coined for stills sets. Whether a partially-rendered film is `PARTIAL` or
something else is cheaper to decide now than after twelve locales exist.

### Recommendation

**Collapse to one canvas-scoped vocabulary now**, during the cutover, and settle the
running word as **"Generating"** for provider work and reserve **"Rendering"** for local
ffmpeg composition — they are different operations and Phase 6 makes both visible at once.
Then define the four new statuses against video and sound before any of them is
implemented, so no key is written twice.

### What changes once ruled

The Phase 6 commission can hand the designer a fixed status list instead of a moving one,
and the twelve-locale cost is paid once, deliberately, rather than discovered.

---

## Sequencing

Ruling 1 gates the commission — **question 2** of it ("Assembly ordering against the canvas's
own order") cannot be specified while the cost model is undecided.

Ruling 2 also gates the commission, not only implementation: **question 1** asks which statuses
the quote block can hold, and that is Ruling 2's list. It gates a third of the commission.
It is in any case cheapest to settle during the cutover, while the deleted views' keys are
still uncommitted.

_(Both corrections are the designer's, from the Phase 6 grammar-extension delivery. The
original text cited a non-existent "question 4" and claimed Ruling 2 gated nothing.)_
