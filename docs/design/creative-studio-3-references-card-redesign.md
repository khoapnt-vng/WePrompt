# References card redesign — the picture is the subject

**Date:** 2026-08-25 · **Status:** owner design direction, not started
**Related:** [reference scope ruling](../prds/creative-studio/creative-studio-3-reference-scope-ruling.md) ·
[spend governance ruling](../prds/creative-studio/creative-studio-3-spend-governance-ruling.md) ·
[bug list](../prds/creative-studio/creative-studio-3-bug-list.md)

## What is wrong today

The card shows a small image above a full paragraph of generation prompt, then two buttons. The
prompt is permanently on screen and takes more vertical space than the picture it describes; cards
of differing prompt length have ragged heights; and one card renders a large empty region where its
image does not fill the frame.

The prompt is not the subject. The picture is. The prompt is only interesting at the moment you want
a different picture.

## The redesign

**One image per reference, shown large.** A character sheet already contains several angles and a
gesture inside that single image — front, three-quarter, profile, hand pose — so one picture per
character is the whole content, not a compromise. Give it the card.

**The prompt leaves the card.** It reappears only inside the regenerate flow, where it is
actionable.

**Hover reveals three actions on the image:**

1. **View full screen** — reuse `FullscreenMediaFrame.tsx`, which already exists and is already used
   by Table and the Beat panel. References simply does not use it yet.
2. **Regenerate** — opens the prompt review below.
3. **Choose from generated images** — a list of every image generated for this reference.

**Regenerate proposes a prompt the user can review and edit.** Creative Studio composes the proposed
prompt; the user may accept it or change it before anything is generated. This is the plan decision
made concrete and visible at the point of use.

## What already exists

- **The image history is already stored.** `StudioProjectReferenceV2` carries `candidateAssetId`,
  `approvedAssetId` and `supersededAssetIds`. "Choose from generated images" surfaces records that
  are already retained; it needs no model change.
- **Fullscreen is already built.** `FullscreenMediaFrame.tsx` is used elsewhere in Studio.

## What is new

- Editable prompt review before regeneration. `regenerate(referenceId)` currently takes only an id
  and no prompt, so a proposed-and-editable prompt is a new request shape.
- Hover affordances and the large-thumbnail layout.

## The removal of Approve, and what it costs

**Owner direction: the user does not approve here.** The explicit approval step goes.

This is more than a button. `approvedAssetId` is read at five enforcement points, three of them in
main:

| Site | What it enforces |
| --- | --- |
| `pricing/estimate.ts:1089` | character-first gate — background generation refused until characters are approved |
| `validation.ts:1731` | a Shot binding to an unapproved reference is invalid |
| `validation.ts:672` | invariant: `candidateAssetId !== approvedAssetId` |
| `studioServer.ts:1122` | the Director MCP requires approved character references |
| `directorCommandContracts.ts:294` | `approve_reference` is `operation_not_permitted` for the Director |

Deleting the concept would remove the input to the character-first gate and to binding validation.
That is not what this direction asks for.

**Ruled 2026-08-25: keep the field, make the act implicit.** The newest generated image is
the reference's current image, and the current image is the approved image. Rejection stops being
"withhold approval" and becomes "regenerate" — which the redesign makes a first-class hover action
with an editable prompt. Choosing an older image from the list re-points the same field.

This preserves the human-only boundary that the plan ratifies. The Director cannot start a
generation; a human confirms the spend that produces one. That confirmation is the human act, and
requiring a second approval afterwards for the same decision is the redundancy being removed here.

**The consequence, and how to take it.** `validation.ts:672` asserts `candidateAssetId === null ||
candidateAssetId !== approvedAssetId`. Under an implicit model those converge: every candidate is
current the moment it exists, so `candidateAssetId` has no state of its own left to hold.

**Collapse to one pointer rather than relaxing the invariant.** Keeping both fields and permitting
them to be equal leaves a vestigial `candidateAssetId` that always equals `approvedAssetId` — dead
weight that every future reader has to reason about and that invites the two to drift apart again.
The reference becomes: one current image, plus `supersededAssetIds` holding everything previously
generated.

Do this now. The clean schema-5 cutover was justified on there being zero users and no production
data to migrate, and that argument is still live today. The same collapse after a user base exists
is a migration; today it is an edit.

Retain `supersededAssetIds` exactly as it is — it is what makes "choose from generated images" and a
free revert possible, and it is the reason rejection can safely become regeneration.

**What must not change:** the character-first ordering, the refusal to bind unapproved references,
and the rule that the Director cannot cause approval on its own.
