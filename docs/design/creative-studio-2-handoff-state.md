# Creative Studio 2 — state of play

Written 2026-08-14. What is shipped, what is in flight, and what is open. Facts here were checked
against the tree; where something is unverified it says so.

New here? Read `docs/contributing/creative-studio-2-agent-onboarding.md` first — it is the traps, not
the architecture. Then `creative-studio-2-design-handoff.md` for the reasoning behind the design.

---

## Where the code is

**`feat/creative-studio-2` on `ghk` (github.com/khoapnt-vng/WePrompt).** `origin` is the GitLab
mirror and is **not** where Studio work goes.

This file does not pin a tip SHA on purpose: the first version of it named one and was stale inside
twenty minutes. Run `git log --oneline -1` and `git status` — those are always true, and this file
never will be.

The S1.5 delivery gate passed **641 test files, with 8,709 tests passed and 19 skipped**; tsc, lint,
format and `check-i18n` were clean. The first full-suite attempt was not a product signal because the
sandbox denied localhost listeners; the unrestricted rerun and the guarded push both passed. Treat
counts as the signal — durations on this machine inflate several-fold under concurrent sessions,
and a slow run is not a failing one.

### Shipped

**Phase 1 — the Brief with enforced rules.** Prose is context; pinned rules are predicates checked in
`jobManager` **before** money is spent. Includes one-step undo of the last rule-list write. The gate
record is `creative-studio-2-phase-1-gate.md`.

**S1 — the view switch.** The Brief/Write/Produce/Review rail is gone. Table · Board · Cut, routed at
`/studio/:id/<view>`, with Brief as a header drawer beside Rules. Then, in order: the two
"Continue" progression buttons deleted; the view vocabulary reduced to one shared constant; Board
given a heading that names the view; the single paid control moved to the top bar; the state readout
added. See `creative-studio-2-s1-plan.md`.

**S1.5 — the Engine Strip — is delivered through Task 9 and the final review fix.** New
projects keep image and video choices explicit instead of adopting a sole route. The strip exposes
those choices in Brief, Table and Board, and the paid review distinguishes integrations when two
routes share a provider and model. The fake journey covers one image route and two same-model video
routes with different integrations, but it has only passed Playwright compile/discovery via
`--list`; no live journey was run. The focused Studio slice and full suite passed. S1.5 was committed
directly on the long-lived `feat/creative-studio-2` integration branch, so delivery was a
fast-forward of that branch rather than a separate slice merge commit.

### In flight

S2 — Table's dedicated Length and State columns — merged and pushed shortly after this file was
first written. Its twelve locale files auto-merged with no conflict, because it was told to **only
add keys** under `phase.write.*` and never to reorder or rename. Keep that discipline: it is the
difference between a clean merge and resolving twelve JSON files by hand.

---

## Open, in rough priority order

**Nobody has looked at C5 in the running app.** The paid control now sits permanently beside Brief
and Rules on every view. Whether that reads as convenient or as dangerous is the one question tests
cannot answer, and a live walkthrough has caught three defects that three rounds of code review read
straight past.

**One spend path has no per-spend confirm.** `submitScenes` is the only spend, and it has five entry
points — the top-bar control, per-shot Render on `ShotCard`, `onGenerateReference` in Table,
`StagePreview`, and the Director's **auto-submitted queued reference requests**, which submit
without a confirmation modal. The code's own comment calls it "a paid path with no spend ceiling
behind it".

It is not unguarded, and the distinction matters before anyone "fixes" it: rules are enforced first
— a breach opens the review with `rules.autoSubmitBlocked` so the user sees which rule blocked which
shot — a scene that cannot be described also diverts to the review, and requests are de-duplicated
and consumed _before_ paying, because the effect re-runs on every job poll and dismissing after the
submit would let the next mount charge again with no human in the loop.

So: every spend is rule-gated, and every spend a _user_ initiates is confirmed by name. This one
proceeds on the authority of the user having accepted the proposal that queued it. Whether that is
enough is a designer question, not an engineering one.

**`read_storyboard` still projects a scene's reference as a boolean** (`hasReference`, still at
`studioServer.ts:155`) while `propose_storyboard` requires the concrete `referenceAssetId`, which is
an editable scene field. A Director told only _that_ a reference exists must send `null`, so **every
re-proposal drops the reference**. Not silent — the diff records the field — but unavoidable from the
Director's side. Roughly three lines to fix.

**`StudioRulesDrawer` has no `role="dialog"`** and Arco's default close control renders as an
unnamed, unfocusable `<span>` — verified live, and still true. `StudioBriefDrawer` does this
correctly; copy from Brief, not Rules.

**The rewritten Studio e2e journey still has no live acceptance evidence.** It now explicitly
selects the image route and one of two same-provider/model video routes by integration, but the only
current result is `playwright test --list`, which proves compile/discovery rather than a running
journey. Do not treat it as a product gate until the fake journey runs end to end.

**Two design artefacts are still missing from the repo** — _Table and Board (hi-fi)_ and _Board and
Cut — Wireframes_. The hi-fi matters most: phase 2 builds Table and Board properly, and the hi-fi is
the specification. Drop them in `docs/design/`; the engine-strip wireframes are already committed as
precedent.

**The Engine Strip implementation is complete and approved for delivery.** Projects now require
explicit image and video choices, including when only one route exists. The strip supplies the
in-app selection surface for missing or replaceable choices and truthfully diagnoses unhealthy
choices without offering an action that cannot cure provider health. Verify the branch and remote
directly for current delivery state rather than treating this handoff as a tip-SHA ledger.

One manual-acceptance finding is deliberately deferred to the planned redesign of this section: in
compact Table, an open engine menu can let its footer actions overlap the following Script content.
Do not patch that layout as an S1.5 follow-up or treat the deferral as a settled menu design.

**Caps unchanged, deliberately.** `targetDurationSeconds` is validated `5..60` and `MAX_SCENES` is 24. A three-minute piece — the design's own target — **fails validation today**. Raising them is
phase 2's first commit, and the bound must be extracted to shared constants rather than edited at
nine call sites.

---

## Known load-sensitive tests on this branch

Two tests have failed in a full suite and passed in isolation at the same commit. Neither is caused
by S1 or S2 — both were reached by branches that cannot touch their code — but both will cost the
next person twenty minutes if they are not written down.

| test                                                                                                                                                   | failure                                                         | isolated                                           |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------- | -------------------------------------------------- |
| `tests/unit/process/services/presentation-template/grants/PresentationSourceGrantStore.test.ts` — "enforces 16 grants per owner and 64 grants per app" | `Test timed out in 10000ms`, observed at **10,463 ms**          | passes; the whole 33-test file runs in ~12 s       |
| `tests/integration/creative-studio/renderService.integration.test.ts`                                                                                  | real `ffmpeg` subprocess returns nonzero under `requireSuccess` | passes in ~14.8 s; took ~28 s in the failing suite |

The grants one is the more interesting: it sits within roughly **half a second** of its own 10-second
timeout on an idle machine, so any concurrent load tips it over. That is a test-design problem, not a
product one — but until its budget is raised it will keep reporting as a random red.

**Pass-isolated plus fail-under-load proves the failure is load-sensitive. It does not prove load is
the cause** — this repo has already had one case (BUG-039) where load merely exposed a genuine timing
assertion. Treat a red here as unclassified until someone looks, not as automatically benign.

**Capture the exit code; do not read a piped tail.** Both `bun run test | tail` and `codex exec | tail`
report the pipeline's status, not the command's, so a run can print a plausible summary while having
failed. Run `bun run test > log 2>&1; echo "EXIT=$?"` and judge by that. The red tip above was found
exactly this way, after several `| tail` runs had looked fine.

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

## Provider gate completed before Phase 3a Task 1

**The still→clip admission gate passed for one real OpenRouter route.** The completed control used
integration/provider `d1ff983b`, adapter `openrouter-video-v1`, `bytedance/seedance-2.0`, 5 seconds,
16:9, 720p and an inline managed JPEG first frame for scene `pitch_action`, **On the Pitch**. Both the
original and fresh controlled 1280x720 H.264 clips (24 fps, 121 decoded frames, AAC, approximately
5.04 seconds) visibly preserved the shared reference composition and first-frame identity. Q1 SSIM
was `0.898096` from reference to original frame 0, `0.898209` from reference to controlled frame 0,
and `0.985962` between the clips' frame 0s. The human Q2 owner verdict was:
**“different but feel like the same for sure”**

This is a same-film coherence pass for the OpenRouter route.

Phase 3a Task 1 is admitted. The result remains route-specific: both clips reused the same action
prompt, silhouetted subjects show role/world continuity rather than exact face/cast identity, and
sampled frames/endpoint metrics do not prove flawless motion or physics. It disproves an HTTPS
publisher requirement for this OpenRouter inline-first-frame route, but does not transfer to BytePlus
or prove multi-image conditioning.
