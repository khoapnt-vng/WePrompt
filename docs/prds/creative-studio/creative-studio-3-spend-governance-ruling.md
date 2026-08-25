# Spend governance ruling — inform, don't gate

**Date:** 2026-08-25 · **Status:** owner ruling, binding on the autonomy pieces
**Related:** [reference scope ruling](creative-studio-3-reference-scope-ruling.md) ·
[beat and shot implementation plan](creative-studio-3-beat-and-shot-implementation-plan.md) ·
[bug list](creative-studio-3-bug-list.md)

This governs Piece 1 (production recovery) and every later autonomy piece.

## The rule

> Creative Studio acts without asking when the action is **reversible** and **within the authorized
> budget**. Before any spend it **shows** what will be made, what it is conditioned on, what it
> costs, and what it invalidates. It asks only for **money beyond the envelope** and for **changes
> that cannot be undone**.

Two gates. Everything else is information.

Free deterministic recovery does **not** require confirmation. A product that asks permission to do
something free and reversible is not careful, it is tiring, and it makes an autopilot impossible.

## Why not a third gate on conditioning inputs

An earlier draft of this ruling proposed asking before anything that changes what conditions a paid
generation — first frames, continuity frames, bindings — citing the 2×2 grid incident that ruined
four of thirty Shots.

That was the wrong instrument. Run the counterfactual: had Studio asked _"use this image as the
first frame?"_, the answer would have been yes. The dialog saves nobody.

What would have caught it is **seeing the picture**. A human recognises a 2×2 grid instantly. The
first frame was never displayed anywhere before it conditioned three paid renders. That is an
information gap, not a permission gap.

The mechanism is still live — `workspaceProjection.ts:339`, `effectiveSeedStillId` silently adopts
the newest eligible shot-owned image when nothing is pinned.

## The change this ruling actually asks for

**Put the conditioning frame in the spend review as a rendered image** — the actual picture beside
the Shot it will condition, not a filename or an asset id.

It costs nothing, adds no click, and it is the single change that would have prevented the grid
incident. It also lowers the urgency of an automated seed-still detector, which is deferred for want
of a calibrated corpus: a visible thumbnail is a better detector than a hand-tuned pixel threshold.

## Downstream cost is a number, not a stop sign

Some free operations cause paid work. Trimming a Shot's tail costs nothing locally, but changes the
conditioning input of the next Shot, which `chain.ts:296` marks `continuity_stale`, requiring a paid
re-render of every downstream Shot in that continuous segment.

Do not gate this. **Price it and show it**: _"trimming this re-renders 6 downstream Shots · $1.20"_.
The size of the consequence is more useful than a confirmation that one exists.

Estimates must therefore include the cost of what an action invalidates, not only the cost of the
action.

## The spend review is a budget statement, not a consent form

It stops being a permission dialog and becomes a preview: what this run costs, what remains in the
envelope, what is at risk. Rows collapse to shared facts (route, duration, unit price stated once,
group subtotals) rather than one line per generation.

## Consequence for the sequence

**Piece 3 (budget envelope) moves up beside Piece 2 (autopilot controller).** The envelope is the
mechanism that replaces the click. Without it, "asks for money" means every generation halts, and a
controller that stops at each spend is not autonomous. Authorize a capped production budget once,
then let the controller work inside it and report as it goes.

## Two notes on Piece 1

**BUG-122 is not recovery, it is a missing capability.** Nothing failed; the product cannot append a
background to an approved reference plan. Filing it under recovery invites a recovery-shaped fix for
a design gap. It also always hits the money gate — a new background reference is a paid generation —
so it never exercises the automatic path.

**The cancel constraint is narrower than an earlier draft of this ruling claimed.** That draft said
the bounded "Cancel and review rejoin" recovery was blocked outright by `jobManager.ts:479`:

```ts
export const canCancelJobV2 = (job: StudioJobV2): boolean => {
  if (job.spendReceipt !== null) return false;
```

That reading was too broad and is withdrawn. A receipt is written when a job reaches the provider,
so it gates **dispatched** work. Waiting work that has been authorized but never submitted carries
no receipt and cancels normally — which is exactly the state BUG-123 describes, and exactly what its
recorded recovery exercised: cancelling Shot 2's waiting job moved it to `cancelled`, marked
downstream Shot 3 `dependency_failed`, and a reviewed **Rejoin · 2 required generations · $0.40**
path then completed all three Shots.

The real constraint stands only for a job already running at the provider: money is committed, so
recovery there means superseding the authorization, never cancelling the job. Autonomy pieces should
treat "authorized but not yet dispatched" as freely recoverable and "dispatched" as spend that has
already left.
