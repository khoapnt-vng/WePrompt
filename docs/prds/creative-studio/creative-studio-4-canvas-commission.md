# Creative Studio 4 — Pilot 1 canvas brief

**For:** product design and implementation
**From:** engineering, 2026-08-30
**Revision:** 3 · **Status:** owner-approved, binding
**Primary contract:** [Creative Studio 4 — the canvas](./creative-studio-4-canvas-design.md)

> The existing nine-plate wireframe is design evidence, not a literal Pilot 1 specification. This
> brief records the contract changes that followed its review.

## Outcome

From a clean schema-6 project with zero Beats and zero Shots, a person can create or import one
standalone photo, understand any cost before spend, observe progress or failure, receive a durable
named Piece, rename it, reload it with stable identity and exact provenance, and export it.

Pilot 1 contains exactly two creation actions:

- **Create photo**
- **Import photo**

Do not show shooting script, video, sound, film, Reference, or Assembly actions. An unavailable
future capability is absent, not a disabled promise.

## First run

The automatically laid-out board and Director relationship are visible immediately. One composer may
collect the Create-photo description. It must not compete with another prompt input, and arbitrary
typed words such as “go” are never interpreted as spend authorization.

The two actions are human-started. The Director may help draft wording and a name, but the screen
must never leave the person waiting for an invisible Director action.

Pilot 1 has no Director proposal card or proposal-producing operation. Director preparation and
Piece rename use the same typed direct Main operations as their renderer paths; the provisional quote
block is the review surface for paid work.

The current app bar is not fixed. Remove the four-view navigation and film-only Render control for
Pilot 1. Retain only project naming and project-menu actions that still apply. Update the Director's
workspace description together with the visible IA.

One retained menu action is **Spending limit**. It is human-only and edits or clears the real
per-batch amount and currency; it is not a film-settings dialog and never presents a wallet or
remaining balance.

## Quote block is not a Piece

Create photo has two visibly distinct stages:

1. **Provisional quote block.** Main reserves the future Piece id and freezes wording, settings,
   route, revision, provenance, currency, and exact cost. Preparing or displaying it creates
   no Piece, Job, authorization, or empty inventory record. It is not a Director proposal card.
2. **Durable Piece block.** When the spend rule permits work, Main atomically creates Piece +
   authorization + queued Job. The block may now show running, failure, cancellation, attention, or
   completion. Provider success later publishes the validated current asset atomically.

The quote block occupies the future Piece's board position so the layout does not jump, but its
label and status must make provisional intent unmistakable. Decline, expiry, invalidation, or stale
rederivation removes it without leaving a Piece. Duplicate confirmation cannot duplicate work or
spend.

Import photo skips the quote. After media validation, Main atomically creates the Piece, imported
asset, and exact hash/import provenance. A failed import leaves none of those records behind.

## Spend presentation

Always show the exact price and currency before paid work begins.

Pilot 1 uses fixed-price single-image routes: the quote's lower and upper amounts must be equal. A
paid retry requires a new quote; it is never hidden inside the earlier authorization.

- With an active human-authorized per-batch cap in the same currency, a fresh quote at or below the
  cap may proceed automatically. Say that the active cap authorized the work; do not hide the cost.
- With no cap, a currency mismatch, a quote above the cap, or an irreversible action, require one
  explicit bounded human action.
- A retry after an unknown provider submission always shows a duplicate-charge warning and requires
  explicit human acknowledgement, even under the cap; persist that acknowledgement with the Job.
- Rederive immediately before authorization and reject stale state.

Never draw credits, a wallet, an envelope drawdown, “remaining”, or “left”. The per-batch cap is a
ceiling, not a balance. A recorded-spend fact may be labelled only as recorded spend.

## The Piece block

A Piece is purposeful durable work, not necessarily finished work. Its block supports:

- Main-issued immutable identity and one mutable handle;
- running, needs-attention, failed, cancelled, and current Piece presentation;
- progress that does not imply output exists early;
- bounded retry or cancellation only when the persisted Job permits it;
- current image plus retained Job/authorization attempt history;
- rename with undo;
- provenance disclosure;
- export of the exact current photo and sidecar.

Pilot 1 has no create/delete Piece control outside atomic confirm/import, and no deletion control.
Removal, provenance retention, and byte deletion require a later ruling.

Retry appears only on an incomplete generated Piece in a persisted retryable state. It shows a fresh
exact quote and appends a new authorization/Job to the same Piece using the prior words/settings. It
cannot create a sibling accidentally, change the handle/order, edit the request, replace completed
work, or generate over an imported Piece. Persist the exact predecessor and one of the schema-6
reasons `provider_failure | submission_unknown | variation_grid | cancelled`; cancellation must not
masquerade as provider failure.

## Naming across twelve locales

Handles are Unicode human-facing names, not ASCII slugs. Preserve usable letters, marks, and numbers
from Vietnamese, Persian, Cyrillic, CJK, and every other supported script. Reject unsafe invisible
or control characters and resolve collisions across current names and bounded aliases.

Derived handles may safely fold/truncate and use locale-independent `piece`; an explicit rename must
refuse unsafe, empty, over-bound, or colliding text instead of silently changing it. Import derives
its initial handle from the Unicode filename basename in Main, never from a renderer-supplied path.

Aliases are never silently evicted. Once the alias bound is reached, refuse another rename unless
the person is returning to a retained alias; rename-back swaps current and prior handles without
growing the alias list. Concurrent prepared photos reserve distinct normalized handles, and Main
rechecks the namespace at confirmation.

Render the complete `#handle` in a bidi-isolated element with `dir="auto"`. Do not force the handle
left-to-right. Immutable ids, never handles, cross process boundaries.

## Photo settings and provenance

Photo aspect ratio and resolution are chosen for the invocation. They do not come from hidden film
settings. The quote and generation composition freeze the request-scoped settings, exact prompt,
route/model revision, rate, quote revision, authorization, producer linkage, and receipt facts.
Create photo is text-to-image only; Import photo creates a Piece but does not condition generation in
Pilot 1.

Create photo uses generation-composition schema 2 with purpose `piece_image` and matching Piece
source/target. It must not masquerade as a Shot seed or character/background Reference.

## Layout and components

Reuse the wireframe's useful visual findings:

- automatic dependency order rather than freeform positioning;
- Arco cards, inputs, tags, progress, popovers, typography, and semantic tokens;
- disclosure anchored to the affected Piece;
- stable Create-photo replacement of quote block by Piece block, and retry activity anchored to the
  existing Piece;
- responsive grid behavior, light/dark, and logical properties.

Do not copy these wireframe elements into Pilot 1:

- script or sound offers;
- two competing composers;
- reference-conditioned or photo-to-photo generation;
- film, Shot, Reference, video, or audio blocks;
- credit or remaining-budget readouts;
- `dir="ltr"` handles;
- natural-language approval as a substitute for deterministic authorization.

## Required states to draw and test

1. Empty schema-6 project with Create photo and Import photo.
2. Create-photo draft before quote.
3. Fresh quote within a matching active cap, with visible cost and automatic authorization copy.
4. Quote requiring explicit action because no cap exists.
5. Quote above cap and quote with currency mismatch.
6. Stale/expired Create-photo quote removed without a Piece; stale retry quote leaves its Piece and
   lineage unchanged.
7. Durable Piece queued/running after atomic confirmation.
8. Failed and needs-attention Piece, with bounded remedies.
9. Fresh retry quote targeting that same incomplete Piece, without a new handle or canvas position.
10. Unknown-submission retry with a duplicate-charge warning and explicit acknowledgement despite a
    matching cap.
11. Completed generated Piece with provenance disclosure and no replacement action.
12. Completed imported Piece with import provenance and no generation action.
13. Rename and undo with a non-Latin handle.
14. Reload preserving identity, current asset, history, Job, and authorization.
15. Exact-photo export plus provenance sidecar.
16. Corrupt or unsupported project isolated without disabling other projects, with deletion available.

For state 16, Main supplies an opaque, expiring deletion claim because no decoded revision is
trustworthy. The human confirms the exact library entry; Main reclassifies it under lock and refuses
a changed, healthy, expired, or replayed target. No path crosses into the renderer.

## Accessibility and localization

- Keyboard access to every action and stable focus across quote → Piece replacement.
- Live-region announcements for meaningful lifecycle transitions, not every percentage tick.
- Names and descriptions for quote action, import, rename, retry/cancel, provenance, and export.
- Full copy in all twelve locales in the same tranche.
- Persian and mixed-script names tested with bidi isolation and `dir="auto"`.
- Text expansion wraps; status never relies on color alone.

## Delivery order

1. Contract amendment, full backlog triage, and pre-CS4 stabilization.
2. Exact schema-6/Piece/composition-2 contracts and compiling harness.
3. Behavior-neutral extraction behind real-backend fixtures.
4. Headless create/import/runtime/export behind an isolated CS4 Main entry point.
5. Fake-adapter lifecycle integration with zero Beats and Shots.
6. Atomic production switch to the Pilot canvas and CS4 Main path, plus actual renderer-to-Main E2E.
7. Assembly and later modalities only after Pilot acceptance.

The headless fake-adapter gate precedes the UI journey. An end-to-end user journey cannot be claimed
before the renderer surface exists.

## Out of scope

Assembly, film, Beats/Shots, References, video, sound, voice, ffmpeg, freeform layout, hand ordering,
Piece deletion, migration, compatibility defaults, credits, and a remaining-balance display.

## Implementation handoff

The 2026-08-30 owner approval makes the project-schema cutover, generation-composition version, quote-to-Piece
transaction, Main identity, Unicode handle policy, exact owner cross-links, request-scoped photo
settings, spend rules, and phase order binding. A later design may choose spacing and visual
hierarchy; it may not replace those approved contracts.
