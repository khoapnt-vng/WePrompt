# Commission — draw how a person watches and judges

**Date:** 2026-08-22 · **For:** the Creative Studio designer
**Why now:** both remaining redesign bugs have collapsed into one question. The Cut and the Beat panel
each hold their data and their controls; neither lets a person move through what they are judging.
**Related:** [bug list](../prds/creative-studio/creative-studio-3-bug-list.md) ·
[direction and answers](../prds/creative-studio/creative-studio-3-direction-and-answers.md) ·
[Beat panel model](../prds/creative-studio/creative-studio-3-beat-panel-model.md)

## The ask

Draw **navigation and judgement** at two scales: one Beat inside the Beat panel, and the whole film in
the Cut. Concretely, three things:

1. **A way to move through time.** Both surfaces can now play from the start and stop. Neither can seek.
2. **A playhead the filmstrip shows.** The Cut's filmstrip is a proportional map of the film that has no
   idea where playback is; clicking a segment selects it for reordering, nothing more.
3. **A resolution of the drawn Cut's audio row**, which the product cannot honour as drawn. See §4.

Almost everything else in both drawings is now built. Section 3 lists it so you do not redraw it.

## First, a disagreement to settle

Your §12.4 says, in terms: _"The Cut does not need redrawing. It composes against 1158px, and preview
versus side panel is not a real competition at that width."_

Engineering filed the opposite — that the Cut was a settings form where the drawing is a playback
editor. Both were true when written: the Cut has since grown a real player, so the gap has narrowed to
navigation. We are not asking you to reverse §12.4. We are asking whether **seeking** was always
implied by the drawn transport, or whether play-from-start is the intended behaviour and we should stop
calling its absence a defect.

## What is already built, and must not be redrawn

Landed 2026-08-22, verified in the running app.

**The Cut**

- A real 16:9 picture player that plays actual media, with the `Beat 01 · Cold open` badge overlaid
  exactly as drawn.
- A transport row: play/pause, a live `m:ss / m:ss` clock, and the standing `picture only` note.
- Auto-advance across the entire film, Beat to Beat, in authoritative order.
- Slates as a first-class picture state — an uncovered Beat shows `Slate · No coverage` and how long it
  holds — so the film is watchable end to end before anything has been rendered.
- Poster frames before a segment decodes, and a visible, non-silent failed state when media will not
  play.
- The film summary: clock, `of 3:00 target`, a delta pill, and the `9 Beats · 16 Shots · 1 Slate` counts.

**The Beat panel**

- The authoring band with Action and Look, and a live word counter.
- The coverage editor with trim handles, and the cost hints `EDGE · TRIM · FREE` and
  `BOUNDARY · COSTS A RE-RENDER` beside it.
- Shot provenance, with chain state separated from the authored hard-cut control, per your §13.1.
- A video element, poster, Takes row, seed import, line detach and re-derive.

## What the drawn Cut asks for that we cannot build

This is the part we most need you to look at. Four elements of the drawn audio row have no path:

| Drawn                         | Why not                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| An audible bed under playback | The preview is muted **by contract** — there is no audio element in it at all. Picture only is a decision, not an oversight. |
| A bed waveform strip          | No waveform rendering exists anywhere in Creative Studio.                                                                    |
| `bed-season4.wav` as a label  | Nothing stored carries a bed **filename**; the projection holds an asset id, position and duration.                          |
| `AUTO-DUCKED`                 | Your own §5 already rules this out: _"there is nothing to duck for. It returns with voice."_                                 |

We would rather you redrew that row against what exists than have us quietly ship something that
resembles it. If the row is aspirational — a picture of where the audio lane lands later — say so and we
will mark it that way rather than treat it as a gap.

## Constraints that are real

- **The Cut composes at 1158px** (collapsed rail); the Beat panel keeps an **852px** shell. Engineering
  read "full-bleed" as describing the editor composition rather than the shell — tell us if that reading
  is wrong.
- **There is no stitched film file.** Playback is a sequence of separate clips, so any transport must
  survive the seams between files rather than assume one continuous asset.
- **The filmstrip is one segment per Beat**, sized by duration. There is no shot-level timeline and no
  thumbnails in it.
- **A chain segment never crosses a Beat**, which is what makes the Beat the unit of parallelism — and
  what makes a Beat-scoped transport the natural one.
- **Money:** preparing an estimate is free; confirming commits it. Prices are local estimates, not
  provider quotes. Any control you draw that spends must be reachable only through that gate.
- **A Beat with no coverage plays as a slate for its target seconds.** This is a gift to the design: the
  timeline is never empty, and a person can watch a film that does not exist yet.

## What we are NOT asking for

Narration and voice (your §5 sequences the audio lane separately), the stitched single file (§6, spiked
out), a colour pipeline behind `MATCH TO` (§6, deferred), undo, and route selection. All are known gaps
with owners; none belongs in this drawing.

## One small divergence to confirm

The delta pill reads `0:02 under` where the drawing reads `2s UNDER`. We changed it so the film total,
the target and the gap between them are all clocks — three quantities of one kind in one sentence
previously used two formats. If `2s UNDER` was deliberate, we will change it back.

## What we can show you

The running application with a real film in it, measurements from it rather than from the prototype, and
the bug list with every entry's evidence. Ask and we will drive it while you watch.
