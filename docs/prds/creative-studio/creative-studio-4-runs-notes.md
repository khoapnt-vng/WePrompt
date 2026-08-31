# CS4 runs — engineering notes, and one input Phase 3 needs

**Date:** 2026-08-31 · **About:** [the runs board](./creative-studio-4-runs.html.txt), answering
[the iteration commission](./creative-studio-4-iteration-canvas-commission.md)
**Status:** accepted. No Phase 1 change required — see below

## What it settles

**A run is a derived rendering, not an object.** Consecutive same-kind Pieces whose handles share a
stem render as one bordered container with one header, each attempt still a first-class block inside
it. The run has no id, nothing writes to it, and it dissolves the moment its members stop being
adjacent and same-stemmed. Every Piece keeps its own handle, status and actions.

**The `_n` suffix is the grouping signal.** This is the part worth calling out: we asked whether there
was a free shape for "these are the same subject", believing the machine-appended suffix was a
legibility defect. It is the answer. No group field, no parent, no caption — the grouping already
exists in data we were treating as noise.

**Inside a run the differing clause replaces the handle as the identifier**, diffed from the
originating words the Piece already carries, with the handle demoted to the footer. Newest is largest
because it is the one being judged; older attempts recede but never disappear, because nothing is
deletable and nothing should pretend to be gone.

**Quiet density needs no exception**, only arithmetic: a run counts as **one block** toward the
1–3 / 4–8 / 9+ steps. The existing invariant — _density may quieten satisfied work; it may never
quieten a decision_ — already covers it.

**No comparison mode, lightbox or chooser.** Two attempts at 7 and 5 of twelve, side by side at real
size, are what a chooser would have provided.

**The 96 ceiling is stated, never metered.** `14 of 96 pieces` as plain grey text, becoming a sentence
from the Director only in the last ten and only once. _"A count that is merely stated reads as scale;
a count with a bar reads as a fuel gauge."_

## The defect: the derivation rule breaks on ordinary prompts

The board states the rule for implementation:

> Two or more adjacent in canvas order, same kind, same handle stem after stripping a trailing `_n`.

That rule cannot be satisfied by the current handle contract, because **suffixing truncates the
stem**. `truncateStudioPieceHandleV3` shortens the base to make room for the suffix within
`STUDIO_MAX_PIECE_HANDLE_SCALARS_V3 = 48`, so siblings of a long handle do not share one.

Run against the real logic, using the board's own example — _"a salt flat at dawn, one figure walking
away from camera"_, which normalizes to 55 scalars:

| Attempt | Handle                                             | Stem after stripping `_n` |
| ------- | -------------------------------------------------- | ------------------------- |
| 1       | `a_salt_flat_at_dawn_one_figure_walking_away_from` | `…away_from`              |
| 2       | `a_salt_flat_at_dawn_one_figure_walking_away_fr_2` | `…away_fr`                |
| 10      | `a_salt_flat_at_dawn_one_figure_walking_away_f_10` | `…away_f`                 |

Three stems, therefore **three separate runs** — and the stem shifts again at `_10` when the suffix
grows a digit, fragmenting a run mid-sequence. The photograph used throughout the wireframe, the
grammar and this board is the case that fails.

It bites whenever the normalized words exceed 48 scalars. That is a 55-character phrase: an ordinary
prompt, not a pathological one. Below the bound the rule works exactly as drawn.

### Where this actually lands: Phase 3, not Phase 1

**Do not make the renderer parse handles.** Reversing `_n` off a string to recover a grouping key is
precisely the kind of rule the board itself warns against — it rejected word similarity as _"too
clever to debug"_, and stem-by-regex is the same class of cleverness one layer down.

**Recommended: `derive` returns the stem alongside the handle, and the Piece persists it.**

- One field on the Piece, set at creation, never edited, never shown.
- The renderer groups by equality on a stored value instead of by string surgery.
- Renaming a Piece does not silently move it between runs, which stem-parsing would allow.
- It survives any future change to the suffix format, which the board asks for in one place.

**Acceptable alternative if a field is refused:** truncate the base once to
`48 − maxSuffixWidth` — 3 scalars at a 96-piece ceiling, so 45 — for **every** member of a
potential run including the first, so all siblings share one stem by construction. Cheaper, but it
shortens every long handle whether or not it is ever iterated, and it still leaves the renderer
parsing.

**This is not a Phase 1 reopening, and an earlier draft of this note wrongly said it was.**
`deriveStudioPieceHandleV3` currently has **no caller**: it exists only in its own file, and the V3
mutation set is `edit_project`, `set_brief`, `set_rules`, `set_spend_policy`, `rename_piece`,
`undo_last` — there is no `create_piece`. A Piece is minted inside the confirm transaction, which is
Phase 3. So Phase 1 froze the handle **format and bounds**; it did not freeze **how creation picks a
handle**, because creation is not written yet.

**Which means a larger question is still open, and it is Phase 3's to answer.** The board assumes
iterations share a stem — `a_salt_flat_at_dawn`, `_2`, `_3`. That only happens if creation derives the
handle from something stable across attempts. If it derives from each attempt's own words — _"no water
on the crust"_, _"low sun, no figure"_ — the handles never collide, no suffix is ever appended, and
**runs never form at all**. The truncation defect above is real, but it is the second problem; the
first is deciding what a sibling's handle derives from.

Both are inputs to Phase 3's confirm path rather than corrections to a frozen contract.

## Two things the board asks us to argue with

1. **Runs depend on adjacency, so a Piece made between two iterations splits a run.** Accept. The
   board's reasoning is right — order is what the person did — and any cleverer rule reintroduces the
   guessing it correctly refused.
2. **Demoting the handle inside a run contradicts the grammar's firmest rule.** Accept, scoped exactly
   as written: inside a run only, and nowhere else. The handle stays addressable in region 6, which
   keeps it copyable and keeps it what the Director says.

## Not settled here

The board assumes iteration is the dominant Pilot 1 behaviour, which follows from the model — no
variation, no replacement, no regeneration, _different words create a sibling Piece_. If the
**96-piece product ruling** later admits archival or replacement, runs still work, but "nothing is
deletable and nothing should pretend to be gone" stops being true and the receding-strip treatment
should be revisited with it.
