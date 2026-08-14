# Creative Studio 2 — state of play

Written 2026-08-14. What is shipped, what is in flight, and what is open. Facts here were checked
against the tree; where something is unverified it says so.

New here? Read `docs/contributing/creative-studio-2-agent-onboarding.md` first — it is the traps, not
the architecture. Then `creative-studio-2-design-handoff.md` for the reasoning behind the design.

---

## Where the code is

**`feat/creative-studio-2` on `ghk` (github.com/khoapnt-vng/WePrompt) @ `02a4c1654`.** Nothing
unpushed. `origin` is the GitLab mirror and is **not** where Studio work goes.

Gate at that commit: **641 test files / 8,630 tests passed, 19 skipped**; tsc, lint, format and
`check-i18n` clean. Treat counts as the signal — durations on this machine inflate several-fold under
concurrent sessions, and a slow run is not a failing one.

### Shipped

**Phase 1 — the Brief with enforced rules.** Prose is context; pinned rules are predicates checked in
`jobManager` **before** money is spent. Includes one-step undo of the last rule-list write. The gate
record is `creative-studio-2-phase-1-gate.md`.

**S1 — the view switch.** The Brief/Write/Produce/Review rail is gone. Table · Board · Cut, routed at
`/studio/:id/<view>`, with Brief as a header drawer beside Rules. Then, in order: the two
"Continue" progression buttons deleted; the view vocabulary reduced to one shared constant; Board
given a heading that names the view; the single paid control moved to the top bar; the state readout
added. See `creative-studio-2-s1-plan.md`.

### In flight

**S2 — Table's Length and State columns.** Committed at `058e7025d` on `feat/studio-s2-table-columns`
(worktree `.worktrees/s2`), **unpushed and unmerged**, branched from `324325e04`. It rebases cleanly:
it only adds keys under `phase.write.*` and does not rename the `phases/write/` directory. **Its full
suite has not been run against the current tip** — do that at the merge, not just its own directory.

---

## Open, in rough priority order

**Nobody has looked at C5 in the running app.** The paid control now sits permanently beside Brief
and Rules on every view. Whether that reads as convenient or as dangerous is the one question tests
cannot answer, and a live walkthrough has caught three defects that three rounds of code review read
straight past.

**One spend path has no human confirm.** `submitScenes` is the only spend, and it has five entry
points — the top-bar control, per-shot Render on `ShotCard`, `onGenerateReference` in Table,
`StagePreview`, and **the Director's auto-submitted reference requests, which pay with no modal**.
The last is pre-existing and was deliberately not touched while consolidating the visible controls.

**`read_storyboard` still projects a scene's reference as a boolean** (`hasReference`, still at
`studioServer.ts:155`) while `propose_storyboard` requires the concrete `referenceAssetId`, which is
an editable scene field. A Director told only _that_ a reference exists must send `null`, so **every
re-proposal drops the reference**. Not silent — the diff records the field — but unavoidable from the
Director's side. Roughly three lines to fix.

**`StudioRulesDrawer` has no `role="dialog"`** and Arco's default close control renders as an
unnamed, unfocusable `<span>` — verified live, and still true. `StudioBriefDrawer` does this
correctly; copy from Brief, not Rules.

**The Studio e2e spec cannot reach its assertions.** Several accessible names it clicks match no
string in the app, and the spec is conditionally skipped, so it has never gated anything.
`playwright test --list` is a compile check only. This is why a stale CTA table survived unnoticed.

**Two design artefacts are still missing from the repo** — _Table and Board (hi-fi)_ and _Board and
Cut — Wireframes_. The hi-fi matters most: phase 2 builds Table and Board properly, and the hi-fi is
the specification. Drop them in `docs/design/`; the engine-strip wireframes are already committed as
precedent.

**The Engine Strip is unbuilt.** Binding two models of one media kind leaves the project with no
route and no in-app cure. Today's precondition is exactly one image route and one video route bound,
which `resolveSoleRouteAdoptions` then adopts automatically. Specified in
`creative-studio-2-engine-strip.md` with ten drawn states; ~8–12 hand-days.

**Caps unchanged, deliberately.** `targetDurationSeconds` is validated `5..60` and `MAX_SCENES` is 24. A three-minute piece — the design's own target — **fails validation today**. Raising them is
phase 2's first commit, and the bound must be extracted to shared constants rather than edited at
nine call sites.

---

## The gates that are not engineering

From `creative-studio-2-programme-plan.md`. Each has a lead time no execution speed touches, and they
are the actual critical path now.

1. **A real VNGG project and an outside reviewer.** Phase 3's acceptance criterion is a human
   judgement on real material. Without both, phase 3 cannot be _finished_ however fast it is built.
2. **Design review of Table and Board.** Phase 2's UI half is the largest single cost in the
   programme.
3. **Is the project folder's readable content source or derived?** Unanswered. It decides the file
   format, the sync story, and whether phase 4's estimate is valid at all. **Phase 4 cannot start
   without this answer.**
4. **Nine sections or forty?** Decides whether phase 2 is worth its 60–80 hand-days.
5. **The aioncore ask** — have the backend honour `pinned_context` on the messages endpoint. It is a
   small additive field, and the day it lands phase 1's headline claim becomes true retroactively
   with no client change, because the pin is already written.

---

## One thing worth proving before committing to phase 3

**The still→clip path has never run against a real provider pair.** The only end-to-end evidence is
against `e2eFakeAdapter`. Whether a real image route produces a still that a real video engine
visibly continues from is unproven — and it is the assumption the whole coherence phase rests on. One
manual pair proves or kills it in about an hour.
