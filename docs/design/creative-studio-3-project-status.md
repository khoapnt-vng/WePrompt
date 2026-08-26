# Creative Studio 3 — Project status: one truth about where a film is

> Owner direction, 2026-08-27: *"Can we build some kind of status so that Directors can look into
> and act?"* This document designs that status. It is the companion to
> [the Director as first responder](creative-studio-3-director-troubleshooting.md) — the charter
> says what the Director may do; this says what it looks at first.

## Why — eight stuck moments, one missing surface

On 2026-08-26 the owner drove four films and was stopped by "why is this not moving?" **eight
times**. Every answer was derivable from store state that an operator read by hand. A project
status would have answered seven of the eight in place:

| Stuck moment | What status would have said |
| --- | --- |
| Sunday Kitchen — Director asking for a phantom approval | `references: complete — nothing awaits approval` |
| "The engine list has not loaded yet" on 15 shots | `engines: complete — image ready · video ready` (the dialog's snapshot was stale, not the routes) |
| "Kitchen Wakes Up" — Shot 3 `NEVER DISPATCHED` | `production: blocked — shot_lny_prep_03 start frame failed to extract · fix is free` |
| French table beat dead after shot 2 | `production: blocked — shot_table_02 engine failure, followers dependency_failed · re-render $2.40` |
| Trim beat `provider_unavailable` | `production: blocked — shot_pot_trim_02 provider refused, nothing charged · re-render $0.60` |
| VNG piece "not running" | `production: not started — nothing has been submitted` |
| Trung Thu — Director refusing to author | `storyboard: not started — 0 beats` (and the Director *can* author; BUG-139) |
| Black thumbnails read as "still rendering" | `production: 4 of 5 shots have current takes` (the black poster is BUG-135, not progress) |

The eighth (the quarantined-runtime day-opener) is owner-level by design — a project status cannot
describe a project the runtime refuses to load.

## What exists, and why none of it is this

Three rollups already ship, each computed separately, none naming a blocker:

- **`StudioBarStats`** (renderer, `workspaceProjection.ts:1572`) — beat/shot/ready counts and film
  seconds. Says `0 READY` without saying why.
- **The library card line** — `complete` / `partial` ("All/Some Shots have current pictures").
  True, coarse, and silent about what is in the way.
- **`projectStudioWorkspaceStatusV2`** (main, `workspaceStatus.ts:789`) — the real per-entity
  authority: stale causes, cascade progress. Feeds the workspace; invisible above it.

The design below is a **fourth computation that replaces the first two and is fed by the third** —
one authority, several renderings — not a fourth ad-hoc rollup.

## The model

### Derived, never stored

`projectStudioStatusV2(project, routeCatalog)` is a **pure function** served over IPC. No status
field is persisted. A stored status is a staleness bug factory and a BUG-136-class migration
hazard; a derived one is correct the moment it is read. (Same storage decision as reference
handles: derived, never stored.)

### Stages, in pipeline order

Each stage reports `not_started | in_progress | complete | blocked`, a one-line summary, and a
`blockers[]` list. Stages, with their completion tests, all already computable from the record:

| Stage | Complete when |
| --- | --- |
| `brief` | `brief.md` is non-empty (true at create) |
| `engines` | both routes selected and reporting `ready` for this project |
| `references` | every planned reference has an `approvedAssetId`; characters-before-backgrounds ordering satisfied |
| `storyboard` | ≥1 beat, every shot has a script and a duration; planned seconds vs `targetDurationSeconds` reported (a mismatch is `in_progress` with a note, not `blocked` — the 18s-vs-30s case) |
| `bindings` | every active shot's binding `status === 'ready'` and within `maxConditioningImages` |
| `production` | every active shot has a current take; chain heads seeded; extractions ready where a follower needs them |
| `cut` | film assembled to target; playable |

`boards` is deliberately **not a stage** — The Potter shipped 30 shots with zero board stills.
It is reported as an advisory count only.

### Blockers carry their remedy

A blocker is never a bare label — the error-class lesson (BUG-126/127/128) applied prospectively:

    { cause: <bounded code>,            e.g. 'extraction_failed', 'content_rejected',
      where: <shotId | referenceId | routeKind>,
      remedy: { kind: 'free_fix', op: 'retry_conditioning_frame', target: … }
            | { kind: 'proposal', prepare: <quote shape>, estMinorUnits: … }
            | { kind: 'owner_only', reason: <bounded code> } }

The `remedy.kind` values are exactly the charter's three lanes, so the Director's loop is
mechanical: **read status → free fixes it performs → costed fixes it proposes with the number →
owner-only items it explains.** The same `blockers[]` renders in the UI as a "what's next" panel.

### Truthfulness rules — the day's lessons as invariants

1. **Waiting is not waiting-forever.** A follower behind a healthy in-flight predecessor is
   `in_progress`; one behind a failed/exhausted extraction is `blocked` with a `free_fix`. The
   status must never present a dead chain as a queue (BUG-133/137).
2. **Computed on read, never cached across state changes.** The "engine list has not loaded"
   dialog was gating on a stale snapshot while main said ready (BUG-130). Consumers re-read; the
   function is cheap.
3. **Causes are bounded codes, remedies are named.** "The generation request is invalid" cost a
   diagnosis session (BUG-126); no blocker may ship with a generic cause.
4. **Optional things never block.** Boards, refs beyond the budget, the inert end slot — advisory,
   never `blocked`.

## Consumers

1. **The Director** — via the charter's read tool, which this design **absorbs**:
   `studio_get_project_status` returns the stage rollup plus, on request, the per-shot detail the
   charter's item 1 specified (`studio_get_generation_state`'s payload becomes this tool's
   `detail: true` mode). One tool, two granularities.
2. **The library card** — stage summary replaces the binary complete/partial line
   ("Production · 23 of 25 shots · 1 blocker").
3. **The app bar** — `StudioBarStats` gains the blocker count; `0 READY` finally says why.

## What this is not

Not a job queue view (that is the workspace), not telemetry, not persisted history, and not a new
permission surface — it grants no operation the charter does not grant. A Director reading status
can still spend nothing.
