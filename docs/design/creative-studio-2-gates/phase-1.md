# Creative Studio 2 — Phase 1 gate record

Phase 1 ("the Brief with enforced rules") is complete. This file records the whole-suite gate result,
because **S1 (the Table · Board · Cut navigation) branches from this tip and will be measured against
it**, and because vitest durations on this machine inflate 15–150× under concurrent sessions — an
unrecorded baseline cannot distinguish a real regression from load.

## Gate result

Measured on branch `feat/creative-studio-2`, commit `880904d42`, on 2026-08-14.

| Gate   | Command                                            | Result                                                                                        |
| ------ | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Tests  | `bun run test`                                     | **8,589 passed**, 19 skipped (8,608 total) across **641 files passed**, 1 skipped (642 total) |
| Types  | `bunx tsc --noEmit`                                | 0 errors                                                                                      |
| Format | `bun run format:check`                             | clean, 2,499 files                                                                            |
| Lint   | `bun run lint --quiet`                             | **0 errors** (1,190 pre-existing warnings — warnings are not a failure here, see AGENTS.md)   |
| i18n   | `bun run i18n:types && node scripts/check-i18n.js` | passed (warnings only)                                                                        |

**Wall duration: 142 s** (vitest self-reported 141.73 s — transform 24.11 s, setup 30.20 s,
import 404.00 s, tests 538.56 s, environment 199.19 s; the component figures are summed across
workers and exceed wall time).

## Concurrency conditions of the measurement

This matters as much as the number.

- **No concurrent vitest run and no active agent session.** Verified immediately before the run:
  `ps aux | grep vitest` returned zero live processes, and no Codex agent was executing.
- Idle Codex helper processes were resident but consumed no measurable CPU.
- Background load was this machine's steady state: Microsoft Defender and Outlook were the top CPU
  consumers. Load average **2.09 before the run**, rising to **10.96 during** it.

If a later run of the same suite is materially slower, check concurrency _before_ concluding a
regression.

## Baseline movement across phase 1

The branch point (`a8c06cfaa`) measured **637 files / 8,453 tests**. Phase 1 added **4 files and 136
tests**, with no test removed and no gate weakened.

## What this gate does and does not prove

It proves the repo is green and that phase 1's behaviour is pinned by tests that were each seen to
fail before their implementation landed.

It does **not** prove the Director receives the brief on every turn. Nothing does —
`pinned_context` is inert on the current backend. See the phase-1 plan's assumption A4 and the
Step 5.0 record. The enforceable guarantee is the main-process gate in `jobManager.resolveProvider`,
which is covered in both directions (a breaching prompt is refused; a non-matching enforced rule
still lets the render through).
