# Reference scope ruling — the app owns the nouns, the Director owns the judgment

**Date:** 2026-08-24 · **Status:** owner ruling, binding on the reference implementation
**Related:** [beat and shot implementation plan](creative-studio-3-beat-and-shot-implementation-plan.md) ·
[direction and answers §15.6](creative-studio-3-direction-and-answers.md) ·
[MVP plan](creative-studio-3-mvp-plan.md)

The question was raised whether reference images should be handled by app mechanism at all, or
delegated to Director skills. The answer is the split the plan already draws — and this document
exists to keep the implementation from growing past it.

## The test

For every reference decision during implementation:

> **If it touches money, identity, or approval, it is app mechanism. If it is deciding what to
> want, it is the Director's judgment.**

## Why the app side cannot be a skill

- **The Director is blind.** Studio tool results are text-only; no image crosses the MCP boundary.
  An agent cannot manage what it cannot see. Do not smuggle image transport across the MCP boundary
  into this work — that is a separate, larger decision.
- **References condition paid chains.** The reference itself costs cents; the videos it conditions
  do not. The seed-still grid incident (4 of 30 Shots ruined, every gate green) is the case study
  for why eligibility, identity hashes, and the frozen composition are structural, not judgment.
- **Approval is reserved to the human.** `approve_reference` is renderer-only. A skill cannot hold
  an authority the plan explicitly denies the Director.
- **Staleness is derived over typed state.** "Change a reference and dependents go dirty" is only
  computable if bindings are durable records. There is no derivation over agent behaviour.

## What must stay minimal — the noun layer

The app's reference entity is exactly: **one image, a role, an approved content hash, and its Shot
bindings.** Nothing else in v1. Explicitly out:

- **No permanent ordinals, no tombstones.** Detach may renumber; nobody has numbers memorised in a
  zero-user product.
- **No multi-angle cast sheets.** A cast reference is one image.
- **No generated references beyond what the plan already specifies.** Anything more is a later
  slice.
- **No eviction/TTL/tier machinery for reference assets.**

Where a richer behaviour is wanted — sequencing (characters before backgrounds), reference prompt
wording, whether a binding still fits the story — that is Director conversation and proposal flow,
not schema.

## What the Director owns

Planning which references to request, composing their prompts, ordering the work, proposing
bindings (`set_reference_plan`, `set_shot_reference_binding` as typed Director-direct operations per
the plan), and the conversational refinement loop. Judgment over text — the one thing the Director
can actually see.
