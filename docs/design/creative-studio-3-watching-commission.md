# Commission — draw how a person watches and judges

**Date:** 2026-08-22 · **For:** the Creative Studio designer
**Why now:** the Cut and the Beat panel have both been built out far enough that what remains is one
theme — a person can author and pay, but cannot yet _watch_ and _judge_.
**Related:** [bug list](../prds/creative-studio/creative-studio-3-bug-list.md) ·
[direction and answers](../prds/creative-studio/creative-studio-3-direction-and-answers.md) ·
[Beat panel model](../prds/creative-studio/creative-studio-3-beat-panel-model.md)

## The ask, in one line each

**The Cut** is close. It needs a way to move through time, a playhead its filmstrip can show, and a
decision about four drawn audio elements the product cannot honour.

**The Beat panel** needs more: it has no preview and no transport at all, its coverage strip never says
what state a Shot is in, and the Look — the thing every Shot inherits — is a bare textarea where the
drawing makes it a binding surface with references, cast and a model chip.

## First, a disagreement to settle

Your §12.4 says in terms: _"The Cut does not need redrawing. It composes against 1158px, and preview
versus side panel is not a real competition at that width."_

Engineering filed the opposite. Both were true when written — the Cut has since grown a real player, so
the gap has narrowed to navigation. We are not asking you to reverse §12.4. We are asking one thing:
**was seeking always implied by the drawn transport**, or is play-from-start the intended behaviour and
we should stop calling its absence a defect?

## What is already built — please do not redraw it

Verified in the running application, 2026-08-22.

**The Cut** — a 16:9 picture player that plays real media, with the drawn `Beat 01 · Cold open` badge;
play/pause and a live `m:ss / m:ss` clock; auto-advance across the whole film; slates as a first-class
picture state (`Slate · No coverage`, `Holds 0:24 in the Cut`); poster frames before decode; a visible
failed-media state; the film summary with clock, target and delta; the numbered proportional filmstrip;
Beat reordering by drag, keyboard **and** explicit buttons, with focus restored and each outcome
announced; the audio-bed panel with import, selection and fade status; Match To with the drawn
`Beat 03 · Shot 01 is the reference` line; the three-card export grid; a 560px assets drawer; and
container queries already tuned to the drawn breakpoints.

**Note:** the film-wide **Render** action lives in the app bar, above both panes. The Cut hosts no paid
generation by design. Please do not draw a Render control into it.

**The Beat panel** — Action and Look side by side in a 1.25fr:1fr grid under their mono rules, with the
live `N / 25 words` counter; the Beat meta row with target and Save/Reset/Ask Director; the persistent
`Edge · Trim · Free` and `Boundary · Costs a re-render` guidance, wired as the accessible description of
the very sliders they describe; a two-lane coverage editor with real trim and boundary sliders (pointer,
keyboard and RTL); Shot provenance stating `Head of the chain · Starts from the still` or
`Continues from NN`; line-derivation state with detach, re-derive and staleness; rich Takes with image
and video previews; seed-still pinning; Beat-to-Beat navigation; Popconfirm-guarded Lift; and a
part-done recovery section.

## What the Beat panel is missing

1. **A preview and a transport.** Nothing in the panel plays the Beat's assembled coverage. No
   `0:00 / 0:31` clock, no play/pause, no `LOOP`, no `JOIN ◂ / JOIN ▸`, no playhead.
2. **Per-segment state on the coverage strip.** The drawing labels each segment `RENDERED · 2 TAKES`,
   `RENDERING · 40%`, `NO TAKE · READY`, `SLATE · NO TAKE YET`. The built strip shows none of it, so a
   Shot mid-render looks like an idle one.
3. **The Look as a binding surface.** Drawn with reference thumbnails, `CAST · THE STRIKER` and
   `SEEDANCE-2.0 · 16:9`. Built as a plain textarea. This is the largest single gap in the panel.
4. **Money in the panel.** `Boundary · Costs a re-render` is true but numberless — no estimate, no
   cascade range. Should a drag ever show a price before it is taken?
5. **Shot state at a glance**, and **target versus actual for the Beat** — it shows the editable target
   but never what the Beat currently runs to.
6. **The composition itself.** The shell is deliberately a centred **852px** modal, one scrolling
   column, roughly seven stacked bands per Shot. We read "full-bleed" as describing the editor
   composition rather than the shell. Tell us if that reading is wrong — it is the assumption everything
   above rests on.

## What the drawn Cut asks for that we cannot build

The part we most need you to look at. Four elements of the audio row have no path:

| Drawn                         | Why not                                                                                                    |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| An audible bed under playback | The preview is muted **by contract** — there is no audio element in it at all. Picture-only is a decision. |
| A bed waveform strip          | No waveform rendering exists anywhere in Creative Studio.                                                  |
| `bed-season4.wav` as a label  | Nothing stores a bed **filename**; the projection holds an asset id, position and duration.                |
| `AUTO-DUCKED`                 | Your own §5 already withdrew it: _"there is nothing to duck for. It returns with voice."_                  |

We would rather you redrew that row against what exists than have us ship something that resembles it.
If it is aspirational — a picture of where the audio lane lands later — say so and we will mark it that
way instead of tracking it as a gap.

## Constraints that are real

- **Widths:** the Cut composes at 1158px with the rail collapsed; the Beat panel shell is 852px.
- **There is no stitched film file.** Playback is a sequence of separate clips and each segment mounts
  its own video element, so a transport must survive hard swaps at every seam.
- **The filmstrip is one segment per Beat**, sized by duration. No shot-level timeline, no thumbnails.
- **The preview is all-or-nothing.** If any active Shot lacks a selected canonical take, the whole
  sequence refuses rather than playing a shorter film. There is no partial-film preview today.
- **A chain segment never crosses a Beat** — which is what makes a Beat-scoped transport the natural
  unit, and why your §13.5 reading of it was right.
- **Trim is free; moving a boundary is free to do but invalidates the take.** Trim-out is chain-coupled,
  trim-in is not.
- **An uncovered Beat is a slate lasting exactly its target seconds** — so a film is watchable end to
  end before anything is rendered. That is a gift to the design, not a limitation.
- **Money:** estimating is free, confirming commits. Prices are local estimates, not provider quotes.

## What we are NOT asking for

Narration and voice (§5 sequences the audio lane separately), the stitched single file (§6, spiked out),
a colour pipeline behind `MATCH TO` (§6, deferred), undo, and route selection. All are known, owned, and
out of this drawing.

## One divergence to confirm

The delta pill reads `0:02 under` where the drawing reads `2s UNDER`. We changed it so the film total,
the target and the gap between them are all clocks — the same sentence previously used two formats for
three quantities of one kind. If `2s UNDER` was deliberate, we will change it back.

## What we can show you

The running application with a real film in it, measurements taken from it rather than from the
prototype, and the bug list with every entry's evidence. Ask and we will drive it while you watch.
