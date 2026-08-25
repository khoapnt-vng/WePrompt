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
2. **Beat target leaves the panel.**
3. **Save Beat, Reset Beat and Ask Director to re-split move into the existing `⋮` menu.**
4. **Planned duration leaves the panel.**
5. **First frames and Current picture consolidate** into one compact region instead of two stacked
   boxes each with its own heading, caption and thumbnail.

## Two of these remove the only editor for durable data

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

**Recommended: move it into the `⋮` menu rather than deleting it.** It leaves the layout, which is
the point, and it stays reachable when it is the thing standing between a person and an export.
Alternatively keep it out entirely and make the export's `duration_pending` refusal name the Beat and
offer to set it — but do one of the two deliberately.

### Planned duration — safer, but it is a creative control

`shot.durationSeconds` is never null and always bounded to 4–15 seconds, so there is no stuck state.
The Director can set it (`directorCommandContracts.ts:332–336`), and the timeline strip at the foot
of the panel already **shows** each Shot's plan and source length, which is what makes the input feel
redundant.

Removing it makes Shot length a Director-owned parameter, adjustable only by asking. That is
coherent with the two-tier model, and it is a real reduction in direct control — worth naming as a
decision rather than discovering later. If it should stay reachable, the `⋮` menu is the same answer
as above.

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
