# Creative Studio 3 — feedback to design

> Questions and inconsistencies found while capturing the Creative Studio handoffs, recorded so the
> reasoning survives the conversation that produced it. Each entry states what the source files say,
> what was built, and why. **None of these blocked implementation** — where a handoff was ambiguous
> we chose and shipped, and each entry names the choice so design can confirm or correct it.
>
> Relayed to design 2026-08-27 by the owner.

## 1 · Beat panel composer — the panel prototype contradicts its own README

**Status: relayed 2026-08-27. Built to six.**

`Beat Panel Composer (standalone).html` carries a margin annotation reading:

> SHOT STATUS · FOUR WORDS — Not ready. Ready to render. Rendering. Rendered. Nothing else appears
> in the slots.

Its README states the opposite (`creative-studio-3-beat-panel-composer-handoff.md:141`):

> **Six status words only**: not ready, ready to render, queued, rendering, rendered, failed.

and `Shot Composer States (standalone).html` renders all eight cards against the six, including
`QUEUED` (state 07) and `FAILED` (state 08).

**Assessment.** The four-word annotation is almost certainly carried over from the earlier
**First Frames Panel** handoff, which did specify four — that panel's assignment has since been
marked superseded on exactly this point. The README and the states board are the newer artefacts and
they agree.

**What was built:** six. Design is asked to delete the stale annotation so the prototype stops
contradicting its own specification.

## 2 · References panel — "same status vocabulary" is not accurate

**Status: relayed 2026-08-27. Built the three.**

`creative-studio-3-references-panel-handoff.md:22` claims:

> It shares its design language with the beat panel composer handoff — same card shape, same status
> vocabulary, same accent. Build them as one family.

The same README then specifies three status words of its own (line 99) — `NO PHOTO`,
`CURRENT SET`, `GENERATING` — which have **zero overlap** with the composer's six.

**Assessment.** The three words are right and the claim is wrong. A reference is not a Shot: it has
no queue, no chain and no predecessor, so `QUEUED` and `FAILED` have nothing to describe on it. The
card shape and accent genuinely are shared; only the sentence overreaches.

**What was built:** the three. Suggested correction — *"same card shape and accent; its own three
status words."*

## 3 · Open question — where does the rendered take live in the composer?

**Status: open, awaiting design.** This one is a genuine gap, not a wording slip.

The composer card is defined as eight rows of **inputs**: identity, frames row, three slots
(start / end / refs), prompt, action row. There is no region for the Shot's **output**.

That conflicts with an owner ruling already made against the First Frames panel (ruling 3, recorded
in [the First Frames doc](creative-studio-3-first-frames-panel.md)): *the current picture gets its
own full-screen view, and it is where take history lives* — its filmstrip navigating takes rather
than frames. That ruling is still binding and still wanted; it simply has nowhere to attach in the
new layout.

Two shapes seem plausible, and this is design's call:

1. **A current-picture region on the card**, mirroring the old First Frames panel — the Shot's
   output beside its inputs, with the full-screen view reachable from it.
2. **Output lives only in the shot strip / Cut**, and the card stays purely a composer — in which
   case the full-screen take history needs a defined entry point, and ruling 3 should be
   re-confirmed against the new shape rather than silently dropped.

Related and already ruled, so design need not re-decide: the `⋯` menu contents are unspecified in
the composer README, and the owner's ruling 4 from the First Frames handoff supplies them.
