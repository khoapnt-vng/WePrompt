# Implementation brief — the Beat panel: segment state, then the wider frame

**Date:** 2026-08-23 · **For:** Codex · **Owner of `BeatPanel/` for this work:** Codex
**Design sources:** `Creative Studio 3 Beat and Shot v2.html` (the frame),
`Creative Studio 3 Chain Sequence.html` (the states)
**Reads with:** [chain handoff review](creative-studio-3-chain-handoff-review.md) ·
[watching commission](creative-studio-3-watching-commission.md) ·
[bug list](../prds/creative-studio/creative-studio-3-bug-list.md)

## The work, and the order it goes in

Two halves. **Do A before B.**

**A · the segment state layer** — the coverage bar says what each Shot is doing.
**B · the 1100px frame** — the shell widens and the inspector stops stacking.

A first, because widening a bar that says nothing only produces a wider empty bar. The storyboard is
explicit that _"the bar is the subject"_, and B is what gives the bar room for what A puts in it.

Every label in A is already pinned by the storyboard, so A needs nothing further from the designer.
B is fully specified by v2, measured below.

---

## A · The segment state layer

### What already exists — do not rebuild it

- **Beat-level state is already rich.** `WorkspaceBeatDisplayState` carries `duration_pending`,
  `no_coverage`, `part_done`, `needs_attention`, `rendering`, `stale`, `seed_pending`,
  `status_pending`.
- **Job state is already rich.** `StudioJobStatus` is an exactly-validated set of eighteen values
  including `waiting_for_conditioning`, `needs_attention`, `submission_unknown`.
- **Extraction state already exists separately** — `StudioFrameExtraction` with
  `pending | extracting | ready | failed`. The handoff's request for a new `StudioJobStatus` value
  has been withdrawn; do not add one.
- **The waiting reasons already distinguish what A4 asks for** — `conditioning_frame`
  ("Preparing the continuity frame") is a different reason from `upstream_running`. A4's
  WAITING ON THE FRAME vs QUEUED split is a presentation of facts that already exist.
- **The bar already has** trim handles, boundary handles, the seek rail, RTL and keyboard support.

### What is missing — measured, 2026-08-23

- `CoverageBar.tsx` contains **zero** references to `displayState`, progress or percentage, and
  **zero** references to a frame asset or boundary chip.
- `WorkspaceShotDisplayState` is **four values** — `draft | seed_ready | takes_available |
selected_take` — all of which describe whether Takes _exist_. None describes a run.
- The `beatPanel.coverage.*` locale block has labels for trim, boundary and seek only. There is no
  per-segment state copy at all.

**So the state model exists one level too high.** The Beat knows it is part-done; the Shot segment
that failed cannot say so. That is the gap, and it is the whole of half A.

### The vocabulary the storyboard draws

Reproduce these as states, not as strings to paste — the wording is the designer's and should live in
i18n, but the _set_ is the contract:

| Group          | Drawn labels                                                    |
| -------------- | --------------------------------------------------------------- |
| Nothing yet    | `NO TAKE`                                                       |
| Queued         | `QUEUED`, `NEXT UP`, `WAITING ON 01`, `WAITING ON THE FRAME`    |
| In flight      | `RENDERING`, `RENDERING · 40%`, `RENDERING · SHOWING THE STILL` |
| Done           | `RENDERED`, `RENDERED · 1 TAKE`, `2 TAKES · T2 IN THE CUT`      |
| Cascade states | `UNTOUCHED`, `NEEDS A RE-RENDER`, `STALE · STILL PLAYS`         |
| Part done      | `FAILED · NOT BILLED`, `NEVER DISPATCHED`, `SHOT 01 · KEPT`     |

Three rules the storyboard states as invariants:

1. **`WAITING ON THE FRAME` is not `QUEUED`.** The Shot immediately behind a completed one is waiting
   on a specific extraction, and must say which. The reason codes to distinguish them already exist.
2. **Progress is the provider's, passed through.** If reporting stops, the state stays `RENDERING`
   rather than inventing a number.
3. **Stale is not invalid.** A stale Shot keeps playing its old Take. Only the marker after the
   edited Shot goes red.

### The boundary marker

Between two Shots sits a marker carrying the handed-forward frame, in three states — **empty**
(no frame yet, chain waits), **on disk** (chain may advance), **gone** (continuity break). The
underlying facts exist already: `frameExtractions` carries the status, and the chain refuses to
advance until the file is verified. This is presentation of existing truth, not new bookkeeping.

---

## B · The 1100px frame

Measured directly from v2 rather than transcribed:

| Element        | v2                                                                                                    |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| Shell          | `max-width: 1100px`, radius 16, border `1px solid #DFD5C4`, overlay `rgba(30,22,10,0.34)`, padding 22 |
| Working row    | `display: flex`, `gap: 18px`, `align-items: flex-start`                                               |
| Preview column | `width: 404px; flex: none`, gap 7, inner `aspect-ratio: 16/9`                                         |
| Inspector      | **`flex: 1`**                                                                                         |
| Coverage bar   | `height: 88px`, radius 11, border `1px solid #E4D9C6`, background `#FBF7F0`                           |

Current shell for comparison: `inline-size: min(852px, calc(100vw - 32px)); max-inline-size: 852px`.

**Do not hard-code 634.** The handoff reads "Inspector goes 400 → 634", which sounds authored. It is
not: the only two occurrences of `634` in v2 are inside font URLs. The inspector is `flex: 1` and 634
is the computed remainder of 1056 − 404 − 18. Hard-coding it breaks the moment any other number moves.

**The inspector reflow**, from §2.2: the prompt label moves up into the Shot header, the textarea
drops to two rows, and the Takes row and the three Shot actions share one line. Row gaps 13 → 18,
body padding 15/17 → 18/22.

**A note on the density argument.** §2.1 justifies the width by the coverage bar's tiers. Those tiers
are computed on the **narrowest** segment — `< 88px` narrow, `88–150` medium, `> 150` wide. With
equal-length Shots the handoff's table does not reproduce: WIDE holds to 5 Shots at 818px (not 4) and
7 at 1056px (not 6), and an eight-Shot Beat is MEDIUM at **both** widths. The gain is real — six
equal Shots move medium → wide — but do not treat the table's cells as a spec; the code is the spec.

---

## Repo constraints that will bite on this specific task

**Colour.** The design gives hex values. This repo forbids them: colours must use semantic tokens.
`BeatPanel.module.css` currently uses **zero** raw hex and eleven distinct `var(--color-*)` /
`var(--font-*)` tokens, so the precedent is set — map the drawn palette onto existing tokens, and only
add a token when nothing fits. Four of the six main storyboard colours (`#FBF7F0`, `#E4D9C6`,
`#2E7D5B`, `#FDFAF2`) have no token today, so this needs a deliberate mapping rather than a paste.

**i18n cannot be a final task.** A repo test requires every referenced key in all twelve locales, so
each task ships its own translated keys. Half A adds a lot of copy — budget for it.

**Two leaf inventories, not one.** `tests/unit/pages/studio/studioI18n.test.ts` pins an exact list.
New `beatPanel.*` keys must be added to `expectedLeaves`, and anything under `cut.preview` also to
`localizedCutPreviewKeys`. Missing either fails the gate — it caught exactly this on 2026-08-22.

**The coverage manifest — now enforced on push.** `vitest.creative-studio-coverage.config.ts` lists
executable Studio files under an 80% per-file threshold. As of 2026-08-23 (BUG-108) that gate is
green and wired into both `just push` and the CI PR gate, and it runs the whole suite as well as
measuring coverage. **Any new runtime file must be added to the manifest, with tests that clear 80%
lines and branches, or the push fails.** Half A adds at least one new module, so plan for it rather
than discovering it at push time. The command is `bun run test:coverage:creative-studio`.

**The usual:** Arco components only (no raw interactive HTML), `bunx oxfmt` on touched files, never
`bun run lint:fix` (it rewrites unrelated files repo-wide), `just push` rather than `git push`, and no
AI signatures in commits.

---

## Out of scope — do not guess at these

- **Money and time at the gate.** Under active discussion with the designer: whether the gate shows a
  single exact total, a range, or nothing, and whether it gains a card about elapsed time. Leave the
  gate as it is.
- **BUG-109 — video generation is globally serialised at one.** The storyboard's film-scale panel
  depends on parallelism that does not exist. Unresolved; not this task.
- **HARD CUT as a permanent control**, **RENDERS AS attribution**, and **resume UI beyond the
  storyboard** — all named as open by the handoff's §3.
