> **SUPERSEDED — read `creative-studio-4-block-grammar-v2.html.txt` instead.**
>
> The designer re-issued the whole table as revision 2, which folds in the eleven
> corrections these notes prompted, the sound rows, and Ruling 2's fixed vocabulary.
> Its own changelog reads: *"This supersedes the delivered table. Build from this one."*
>
> These notes are kept because they record what was found in revision 1 and why —
> including the status-vocabulary problem that became Ruling 2. Do not build from
> revision 1.
>
> Two defects were found in the first cut of revision 2 — it retired `RUNNING` and then
> still used the word in three places, and it stated the region-4 gate two ways, with the
> diagram omitting `NEEDS BUDGET`. **Both are fixed in the corrected re-delivery now
> committed.** The diagram reads "present only while GENERATING, PROPOSED or NEEDS BUDGET",
> the chip rule lists `QUEUED`, `GENERATING` and `RENDERING`, and the only surviving mention
> of `RUNNING` is the sentence recording its retirement.

# CS4 block grammar — engineering notes on the delivered spec

**Date:** 2026-08-30 · **About:**
[the block grammar](./creative-studio-4-block-grammar.html.txt), delivered in answer to
[the commission](./creative-studio-4-block-grammar-commission.md)
**Status:** accepted. These are implementation notes, not objections
**Updated 2026-08-31:** CS4 is a clean cutover; the four views are removed when the canvas ships

## What it settles

Six kinds, not ten: `stills` · `motion` · `document` · `board` · `sound` · `cut`. A photograph is a
stills set of one; cast and places are stills with captions.

**A proposal is a status, not a kind.** This is the load-bearing decision. `PROPOSED` is available to
every kind, with a judgement footer, and there is no separate proposal component. It is the only
formulation in which rendering a proposal twice is _impossible_ rather than merely discouraged — which
is what [BUG-160](./creative-studio-3-bug-list.md) and **BUG-187** are about, and what "one home for
the decision" actually requires.

**Six container regions, of which exactly one varies by kind.** Handle · meta · status · conditions
strip · body · footer. Only the body is per-kind, so a person learns the canvas once.

**The conditions strip is the only visible provenance, and only while `RUNNING`, `PROPOSED` or
`NEEDS BUDGET`.** It disappears on completion, after which provenance lives solely behind the stale
popover. That is the A-surface disclosure rule expressed as layout rather than prose.

**Two testable invariants for the re-hosting hazard**, from §5:

> No block may render a scrollbar of its own except a board row, and no block may render a progress
> bar that is not a member's.

Both are reliable tells that a view came along for the ride. **Write these as tests.** They are the
difference between re-hosting and stapling four views into a column.

**Density is canvas-wide, in three steps** — generous at 1–3 blocks, default at 4–8, quiet at 9+ —
with one invariant: _density may quieten satisfied work; it may never quieten a decision._

**Pilot 1's UI is fully specified by this document.** One photograph is a `stills` block of one
member at the 1–3 density: grid centred, 900px max content width, 15% vertical padding, chip shown,
footer always visible.

## The status vocabulary needs one deliberate decision before any block is built

§4 says the existing vocabulary is "reused verbatim". That is true of the words and **not** of the
keys, and the gap will cost twelve locales of mess if it is discovered during implementation.

**The words mostly ship.** `Rendered`, `Stale`, `Failed`, `Imported`, `Current` all exist.
`PARTIAL`, `PROPOSED`, `STILLED` and `DRAFTED` do not, and are genuinely new.

**But `RUNNING` is not what the product says.** It ships as **"Generating"**
(`creativeStudio.jobs.status.running`, `creativeStudio.scene.status.generating`,
`creativeStudio.workspace.referenceWorkflow.status.running`) and as **"Rendering"** on shot tiles
(`creativeStudio.workspace.shotStatus.rendering`). One key,
`workspace.referenceWorkflow.panel.tag.running`, does read "Running".

**And the existing keys are view-scoped and already duplicated**, because they were built for four
views:

| Word        | Keys that produce it                                                                                                                      |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Stale`     | `table.panel.status.stale` · `table.state.stale` · `board.panel.status.stale` · `board.shot.stale`                                        |
| `Rendered`  | `shotStatus.rendered` · `beatPanel.coverage.segmentState.rendered` · `beatPanel.firstFrames.status.rendered`                              |
| `Rendering` | `shotStatus.rendering` · `table.state.rendering` · `beatPanel.coverage.segmentState.rendering` · `beatPanel.firstFrames.status.rendering` |
| `Failed`    | seven keys across Studio and the wider app                                                                                                |

**So do not "reuse the existing keys".** There is no single existing key set to reuse — there are four
view-scoped ones that happen to agree in English today.

**Do this instead: give the canvas one status namespace of its own**, e.g.
`creativeStudio.canvas.status.*`, holding exactly the grammar's vocabulary, and translate it once in
all twelve locales. Reasons:

1. The grammar's whole premise is one vocabulary across six kinds. Inheriting four view-scoped sets
   reproduces the fragmentation the canvas exists to remove.
2. The views are removed at cutover (owner decision, 2026-08-31: CS4 is a clean cutover, not an
   additive surface). Their key sets are deleted with them, so a canvas namespace inherits nothing and
   leaves nothing behind — no migration, no shared key to untangle later.
3. This repository has already been bitten by the inverse: **four distinct keys all read "Report
   Issue" in `en-US` and diverge in `de-DE`.** Two keys that agree in English are not one string.

**The trap to avoid explicitly:** an implementer reads `RUNNING` in the grammar and adds a key that
renders "Running" beside the existing "Generating". The product then says two different words for one
state, in twelve languages, and no test catches it because both keys exist and both are translated.

**Casing is already correct and needs no work.** Status strings are stored in sentence case and
uppercased in CSS — this is the shipped practice, asserted at
`tests/unit/pages/studio/Shell/WorkspaceChrome.test.ts:90` — which is why German `ABGELAUFEN` needs no
new string and simply wraps the header.

## The three decisions the designer flagged for overrule

1. **A proposal is a status, not a component.** Accept. It is the cheapest guarantee of one home, and
   the cost — every kind implementing a judgement footer — is real but bounded and shared.
2. **`RENDERED` goes silent above eight blocks.** Accept, with a note: "nothing is wrong" is also
   information on a canvas you have just returned to. It is one constant, so it is cheap to revisit
   with real use rather than by argument.
3. **Selection exists and drives exactly one bulk act (delete).** Accept. The reasoning — anything
   more and the canvas becomes a file manager — is the right instinct.

## Not settled here

The grammar assumes the canvas renders `PROPOSED` as a status on a block. The **proposal ledger stays
exactly as it is**: a CAS-guarded record with its own lifecycle and schema version. "A proposal is not
a kind" is a statement about rendering, not about storage. Anyone reading it as licence to remove the
proposal record would lose the fencing that makes acceptance safe.
