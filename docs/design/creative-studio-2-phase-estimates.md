# Phase estimates, recalibrated against what actually happened

Written 2026-08-14, after three slices shipped in one day. The programme plan estimated in
"hand-coding days" and warned that column was fiction. There is now enough evidence to say what the
real unit is.

---

## The calibration

| slice                                                  | estimated hand-days | actual elapsed               | commits |
| ------------------------------------------------------ | ------------------- | ---------------------------- | ------- |
| Phase 1 — brief and rules (13 tasks)                   | 24–30               | ~2 days across sessions      | ~30     |
| S1 — view switch, Brief drawer, money control, readout | ~8–12               | **6.5 h** (00:55 → 07:22)    | 12      |
| S2 — Table length/state columns                        | 1–2                 | **~1 h**                     | 1       |
| S1.5 — Engine Strip (9 tasks)                          | 8–12                | **~10.75 h** (11:47 → 22:33) | 20      |

**One estimated hand-day ≈ one hour of elapsed session time.** That ratio holds across four slices of
very different shape, which is more than a coincidence and enough to plan against.

Two conditions it depends on, both of which were true today:

- **A written, reviewed plan existed first.** S1.5's plan took its own cycle — drafting plus two
  review rounds — before a line was written. Budget that separately; it is not free, and it is where
  the sequencing bug and the `tsc` gap were caught rather than discovered mid-build.
- **One session owned the branch.** Parallel sessions on the same tree produced test contention
  serious enough to red the integration branch twice on load-sensitive tests. Parallelism does not
  scale this ratio linearly; it degrades it.

---

## What is left, in both units

| stage                          | hand-days | ≈ elapsed          | what actually sets the date                                                   |
| ------------------------------ | --------- | ------------------ | ----------------------------------------------------------------------------- |
| **3a — still stage**           | 12–17     | ~2 working days    | **Scope is unresolved.** See below.                                           |
| **2 — sections, clips, takes** | 60–80     | ~8–10 working days | **The hi-fi is not in the repo.** Design review is calendar, not engineering. |
| **3b — last-frame chain**      | 11–13     | ~1.5 working days  | **An unresolved design conflict**, not hours. See below.                      |
| **4 — cut, folder, export**    | 24–34     | ~3–4 working days  | **Blocked entirely** on the source-vs-derived folder answer.                  |

Engineering totals roughly **two to three working weeks** of elapsed session time for everything
remaining. That is not the schedule, and treating it as one would be the mistake this document exists
to prevent.

---

## Why three of the four numbers are not the constraint

**3a's scope is genuinely uncertain right now**, and in both directions. If Seedance 2.0's
multi-reference mode is reachable through our provider, the still stage may be unnecessary on that
route — smaller than 12–17. If we want multi-reference at all, it needs a new payload role, a scene
able to hold several references, and a capability flag we do not have (`supportsFirstFrame` is the
only one) — larger. Both branches are cheap to resolve and neither is resolvable by estimating. See
`creative-studio-2-seedance-reference-modes.md`.

**3b has a conflict to settle before it can be planned.** First/last-frame and multi-reference are
mutually exclusive per task, so a clip is chained or referenced, never both. If clip 1 establishes
the look by reference and clips 2…n inherit through the chain, cast fidelity after the first clip
rests entirely on the chain not drifting. That is a design decision with no engineering answer.

**Phase 2 is the largest number and the least engineering-bound.** Its UI half builds Table and Board
properly, and the hi-fi that specifies them is still not in the repo. It also depends on the
**nine-sections-or-forty** question, which decides whether the phase is worth 60–80 at all.

**Phase 4 cannot start.** The source-vs-derived folder question has been open since the engineering
response and determines the file format, the sync story, and whether 24–34 is even the right order of
magnitude.

---

## The estimate that matters

The four human gates have not moved all day, and none of them compresses:

1. A real VNGG project, and a reviewer who did not build it — phase 3's acceptance criterion is a
   human judgement on real material.
2. Design review of Table and Board, plus the hi-fi in the repo.
3. The source-vs-derived folder decision.
4. Nine sections or forty.

Plus one hour of provider evidence — the still→clip experiment — which gates 3a and has still not
run.

**So: the engineering is two to three weeks of elapsed time, and the programme is as long as those
five items take.** If they are answered this week, the rest is fast. If they sit, no amount of
execution speed touches the date, and the correct thing to do is not more slices.
