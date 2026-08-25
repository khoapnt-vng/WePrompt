# Beat panel density — give the screen back to the picture

**Date:** 2026-08-25 · **Status:** owner design direction, not started
**Related:** [References card redesign](creative-studio-3-references-card-redesign.md) ·
[binding belongs on the Shot](creative-studio-3-binding-belongs-on-the-shot.md) ·
[spend governance ruling](../prds/creative-studio/creative-studio-3-spend-governance-ruling.md)

## The problem

The Beat panel is where a person judges a Beat, and almost none of it is given to the pictures. A
Story textarea, a Beat target field, three buttons, a Shooting-script textarea, a Planned-duration
field, a First-frames box and a Current-picture box compete above the timeline, so the frames are
small and the reading order is cluttered.

Same principle as the References redesign: **the picture is the subject; the text is how you change
it.**

## The direction

1. **Story collapses to an icon.** Hover to read. It is context for this screen, not the work of it.
2. **Beat target leaves the layout and moves into the `⋮` menu.**
3. **Save Beat, Reset Beat and Ask Director to re-split move into the existing `⋮` menu.**
4. **Planned duration leaves the layout and moves into the `⋮` menu.**
5. **First frames and Current picture consolidate** into one compact region instead of two stacked
   boxes each with its own heading, caption and thumbnail.

## Ruled 2026-08-25 — both durable fields move to the menu, neither is deleted

Both fields are edited **nowhere else in the product**. `BeatPanel/index.tsx:99–101` owns the only
draft keys for them: `beat.<id>.targetSeconds` and `shot.<id>.durationSeconds`.

### Beat target — this one has a trap

`editorFolder.ts:259` fails the whole export with `duration_pending` when a Beat with no Shots has
`targetSeconds === null`, and validation permits null. So a null target is a reachable state that
blocks export, and after this change **no human control would exist to clear it**.

The Director can set it — `studioServer.ts:141,155,160` carry `targetSeconds` in the Beat changes
schema — so the capability does not vanish. But the recovery path becomes "ask the Director", and if
the Director is unavailable or the conversation is lost, the project cannot be exported and nothing
on screen explains why.

**Ruled: it moves into the `⋮` menu.** It leaves the layout, which is the point, and it stays
reachable when it is the one thing standing between a person and an export. The Beat's `⋮` menu is
the right home because a null target is a property of the Beat, not of any Shot in it.

### Planned duration — safer, but it is a creative control

`shot.durationSeconds` is never null and always bounded to 4–15 seconds, so there is no stuck state.
The Director can set it (`directorCommandContracts.ts:332–336`), and the timeline strip at the foot
of the panel already **shows** each Shot's plan and source length, which is what makes the input feel
redundant.

**Ruled: it moves into the per-Shot `⋮` menu**, beside the Shot's other overflow actions — not the
Beat's, since duration is a property of one Shot. Shot length stays directly adjustable without
asking the Director, and the panel still loses the field.

Keep the bound stated where it is edited: the menu control must hold 4–15 seconds
(`STUDIO_MIN_SHOT_SECONDS`/`STUDIO_MAX_SHOT_SECONDS`), the same range the Director is held to.

## Consolidating First frames and Current picture

These are one idea shown twice: what the Shot starts from, and what it currently is. Show them as a
single pair of thumbnails side by side under one heading, with each thumbnail carrying its own
actions — fullscreen on both, **Pin as first frame** on the frame, **Generate again** on the picture.
Both already use `FullscreenMediaFrame`, so the actions are named and keyboard-reachable and stay
that way.

Caption text drops to what distinguishes them: which is the first frame, and the picture's source
length.

## What must not change

- The timeline strip keeps its edge/boundary/rail semantics and its statement of what a trim costs.
- Nothing here weakens the authorization lock behaviour that BUG-123 fixed: an incompatible imported
  candidate must still refuse to claim it is current, and **Pin** must stay hidden or disabled while
  a waiting authorization has frozen the seed.
- Story stays editable. Collapsing it to an icon hides it; it does not make it read-only.
