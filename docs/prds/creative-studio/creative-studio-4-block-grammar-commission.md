# Creative Studio 4 — a commission: the block grammar

**For:** the designer of the CS4 canvas
**From:** engineering, 2026-08-30
**About:** the systematic layer under
[the canvas wireframe](./creative-studio-4-canvas-wireframe.html.txt)
**Needs:** a specification, not scenarios. Smaller than the last one, and more mechanical

## The short version

The canvas wireframe is right and we are building it. This asks for the layer beneath it.

The scenarios prove the idea: a person makes a photograph, replaces a face, gets a three-minute film,
and never meets a locked door. What they cannot do is tell two developers how to build **eight
different block kinds that look like one product**. For that we need the grammar — what every block
has in common, and what each kind is allowed to differ in.

There is a reason this is worth doing properly rather than deciding eight times as we go, and it is
below.

## What changed since the last commission

> **Superseded 2026-08-31.** This section briefly said the four views would survive alongside the
> canvas. That is no longer true and the grammar you delivered is unaffected — but the reasoning
> below was sent to you, so it is corrected here rather than quietly deleted.
>
> **CS4 is a clean cutover.** References, Table, Board and Cut are removed when the canvas ships.
> Coexistence was considered and withdrawn: the CS4 project schema does not carry the film
> collections those views read, so running both would have meant either a compatibility reader or two
> production readers — a contract change, not a scheduling one.
>
> The design consequence for you is _smaller_ than what you were told, not larger. The canvas does not
> have to out-compete a surviving alternative; it only has to be right. Everything in the grammar
> stands, and the parts written to make the canvas earn its place — one grammar across kinds, density
> that never quietens a decision — are good design rather than competitive necessity.

## Why a grammar, and not more drawings

Almost every block you drew already exists in the product, built for a view rather than for a canvas:

| Your block              | What renders it today                           | Size        |
| ----------------------- | ----------------------------------------------- | ----------- |
| `#beat_2_clips`         | the Board's Shot tile grid                      | 2,457 lines |
| `#cast`, `#places`      | the References view's character and place cards | 1,709 lines |
| `#final_video`          | the Cut player                                  | 3,199 lines |
| clip rows, first frames | the Beat panel                                  | 7,161 lines |

So the work is **build a container and re-host what exists** — which is much cheaper than building
eight new components, and carries one specific hazard. Each of those components assumes its view:
Board's tile assumes a Board around it, the References card assumes a page header and a progress bar,
CutPlayer assumes a transport. Re-parent them naively and every block arrives wearing view-shaped
chrome, and the canvas reads as four views stapled into a column.

The grammar is what prevents that. It tells us what to strip from each component and what the
container supplies instead.

## What we are asking you to specify

**One table. One row per block kind. These columns:**

- **Header** — exactly what appears, in what order. The handle, the kind, the count or duration, the
  status. Which of these are always present, and which are per-kind.
- **Statuses it can hold** — from the shared vocabulary, plus any it needs that the vocabulary lacks.
- **Actions on the block** versus **actions in the rail**. Your rule so far is that free and reversible
  things are links on the block and everything else is said in the rail; we need that made explicit
  per kind, because it is the decision we will otherwise get wrong eight times.
- **Measure** — how many of the twelve columns it claims, and why. You have said a script wants seven,
  a turnaround set five, a clip row eight.
- **Both rail extremes** — what it sheds first at rail 720 / canvas 640, and what it must never shed.

**The kinds, from your own scenarios:**

`photograph` · `video` · `sound` · `document` (script) · `storyboard` · `character set` ·
`place set` · `clip set` · `cut` · `proposal`

Add or merge kinds if that list is wrong. Merging is welcome — fewer kinds is a better grammar.

**And the cross-cutting part, which matters more than any single row:** what is true of _every_ block,
so that a person learns the canvas once. Header anatomy, where status sits, what a handle looks like
named versus derived, what hover and focus do, what the selected state is if there is one, and what a
block looks like with nothing in it yet versus partially filled.

## Constraints

- **Arco components only**, per your own Plate 09 mapping. Nothing bespoke.
- **Status chips uppercase in CSS, never in the translated string** — this is already how the product
  does it, and it is why German `ABGELAUFEN` can be 60% longer than `STALE` without a new string.
- **Twelve columns, halving to six under 720px.** Never a single stack; sets shed tiles per row.
- **Both rail extremes are real**: 280–720px of rail, so the canvas is 640–1080px and changes while a
  person works.
- **Twelve locales including RTL Persian.** Logical properties throughout; handles never mirror.
- **One block must look right, and forty must look right.** Pilot 1 is a single photograph on an
  otherwise empty canvas; Scenario C is a script, a storyboard, five clip sets and a cut. A container
  tuned for one is desolate at forty; tuned for forty it is bureaucratic at one.

## What we are not asking

- **Not more scenarios.** The three you drew are enough and we are building from them.
- **Not the first-run plate again** — Plate 01 settled it.
- **Not the disclosure popover again** — Plate 07 settled it. We need to know which _kinds_ can be
  stale, not what stale looks like.
- **Not visual design of the blocks themselves.** Where a component already exists, we are re-hosting
  it, not redrawing it. Tell us what to strip and what the container supplies; do not redesign the
  Board tile.
- **Not the Director rail, the app bar, or the composer.**

## For reference

- [The canvas wireframe](./creative-studio-4-canvas-wireframe.html.txt) — the three scenarios and nine
  plates this sits under. Plate 09 already maps every element to an Arco component.
- [The first canvas commission](./creative-studio-4-canvas-commission.md) — the three hard problems,
  all of which you answered.
- [The CS4 design, revision 2](./creative-studio-4-canvas-design.md) — the model, and what the
  wireframe settled.
- [The Beat timeline commission](./creative-studio-3-beat-timeline-commission.md) — the house format,
  and the settled rulings on chained joins and hard cuts.
