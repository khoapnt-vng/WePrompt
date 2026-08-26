# Reference binding belongs on the Shot, not in References

**Date:** 2026-08-25 · **Status:** implemented 2026-08-26
**Related:** [References card redesign](creative-studio-3-references-card-redesign.md) ·
[spend governance ruling](../prds/creative-studio/creative-studio-3-spend-governance-ruling.md)

## What is wrong today

The References view holds two unrelated jobs. The first is managing reference images — characters
and recurring backgrounds — which is what its name promises. The second is a **per-Shot binding
form, repeated once for every Shot in the film**: each entry shows the Beat title, the Shot position,
its Shooting script, a multi-select of characters, a single-select of background, a capacity warning
against `maxConditioningImages`, and a save action (`References/index.tsx:140–200`).

So a fifteen-Shot film puts fifteen Shot forms inside a view about pictures, and the one thing a
person needs in order to answer _"who is in this Shot?"_ — the Shot's own drawn panel — is not on
screen.

## The direction

**Bind on the Shot panel.** The Board panel strip inside the Table's expanded Beat detail
(`Table/index.tsx:729–780`) already shows each Shot as a picture with its ordinal, duration,
staleness and a redraw action. That is where the person is already looking at the Shot, so that is
where they should say which references it uses.

References keeps only what it is named for: the reference images themselves, their prompts, their
history, and adding a background.

## Why this is the right split

- **Binding is a per-Shot creative decision, and the picture is its context.** Choosing between two
  characters is far easier beside the frame they appear in than beside a Shooting script excerpt in
  a list.
- **It scales with the film.** The current arrangement grows a list inside References in proportion
  to Shot count; binding on the panel grows nothing, because the panels already exist per Beat.
- **It matches the References redesign.** That view is becoming a small set of large images with
  hover actions. A film-length column of dropdowns does not belong in it.

## What moves, and what does not

**Moves:** the per-Shot character multi-select, background single-select, the
`maxConditioningImages` capacity warning, the unassigned and invalid states, and the save action.

**Stays in References:** the reference images, their prompts and history, Add background, and the
character-first ordering.

**Unchanged in main:** `StudioShotReferenceBindingV2` keeps its shape, and
`generation/referenceBinding.ts:34` keeps refusing to generate a Shot whose binding is not `ready`.
This is a relocation of the control surface, not a change to the contract it writes.

## Ruled 2026-08-25 — readiness is a state, not a door

**References currently owns the handoff out of the phase.** Its footer carries a
**Continue to Table** button enabled only when `readyForTable` — every Shot bound, nothing pending,
gate unlocked (`References/index.tsx:576–584`). If binding moves to the Table, a button whose whole
job is to send you to the Table in order to finish binding no longer makes sense.

**Ruled: retire the phase handoff.** The Table already
surfaces per-Shot blockers, and `referenceBinding.ts:34` already refuses generation on an unbound
Shot, so an unbound Shot cannot silently cost money wherever the person happens to be. That is the
same principle as the spend governance ruling — carry the discipline with information and a refusal
at the point of spend, rather than with a gate between rooms.

Where progress is worth stating, state it as progress — "3 of 10 Shots bound" — never as a locked
door.

## Implementation evidence

- References now owns only semantic reference images, prompt/history controls, and Add background.
- The Table's expanded Beat detail owns the exact per-Shot character/background binding editor,
  unassigned/invalid state, route-capacity refusal, and save action beside the Board panel.
- Generation-remedy focus opens and highlights the exact Shot in Table; reference/asset review focus
  remains in References.
- The Table strip reports durable bound-Shot progress. The obsolete Continue to Table action and its
  readiness-door copy are removed.
- Focused DOM coverage pins relocation, exact save payloads, capacity failure, progress, and focus;
  the Ming/Mei/dai-pai-dong E2E path now verifies bindings in the expanded Table panels.
