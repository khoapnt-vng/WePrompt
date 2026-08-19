# Creative Studio 3 — Gate 1 status

Frozen head: **`84ca904ff`** on `codex/creative-studio-table-board-ui-design`.
Recorded 2026-08-19. Tasks 1A, 1B, the atomic 1C–5 tranche, and Task 6 are complete.

Gate 1 defines four obligations. **Items 1 and 3 below were executed and pass. Item 2 is
deliberately deferred and remains open.** This document exists because the plan's 267 steps carry
no ticks, so gate execution is otherwise unrecorded — and because item 1 cannot be reproduced after
Task 7.

---

## 1. V2 is unregistered from every renderer-reachable surface — PASS

**This measurement expires at Task 7**, which is the commit that deliberately registers V2. It is
recorded here because it is the factual basis for the pivot cost analysis: the Beat/Shot vocabulary
never reached the bridge, the manifest, or the renderer, which is why the CS2→CS3 rename touched
roughly 6% of the code rather than the renderer and twelve locales.

Reference count for `schema2|StudioBeat|StudioShot|StudioBinItem|applyMutations|getProjectV2`:

| Surface                                       | V2 references |
| --------------------------------------------- | ------------: |
| `process/bridge/creativeStudioBridge.ts`      |             0 |
| `common/adapter/ipcBridge.ts`                 |             0 |
| `common/adapter/native/constants.ts`          |             0 |
| `common/adapter/native/payloadSchemas.ts`     |             0 |
| `preload/main.ts`                             |             0 |
| `process/services/creative-studio/runtime.ts` |             0 |
| entire `packages/desktop/src/renderer/` tree  |             0 |

The renderer result was verified by grep **exit code**, not by empty output — an empty pipeline
result and a genuine no-match are indistinguishable when a later stage resets the status.

Supporting tests, run together: `schema2Cutover.integration.test.ts` (V1 profile byte-for-byte
no-touch) and `nativePayloadSchemas.test.ts` (manifest/schema parity) — **2 files, 594 tests, all
passing**.

## 2. Independent process/schema and security/spend review — DEFERRED, OPEN

Not executed. The unreviewed surface is **19,573 production lines and 24,905 test lines** across the
tranche, including a money subsystem no independent reader has seen: `pricing/estimate.ts` (862
lines), `pricing/authorization.ts` (287), `preparedSubmissionCache.ts` (400), `pricing/rateCard.ts`
(120), plus the `prepare` → `confirm` protocol and the pre-dispatch budget predicate.

Test coverage over that code is strong (see item 3), which is the argument for accepting the
deferral. The argument against is that coverage demonstrates the code does what its author intended,
not that the intent is right — which is the specific thing a spend review checks. **Decide before
Task 7**, because the cutover diff will bury this surface.

## 3. Mechanical gate commands — PASS

| Command                 | Result                                             |
| ----------------------- | -------------------------------------------------- |
| `bun run test`          | 671 files, **10,109 tests, 0 failures**, 1 skipped |
| `bunx tsc --noEmit`     | clean¹                                             |
| `bun run lint --quiet`  | **0 errors** (1,366 pre-existing warnings)         |
| `bun run format:check`  | clean, 2,579 files                                 |
| `git diff --check`      | clean                                              |
| `bun run test:coverage` | exit 0 — see the caveat below                      |

¹ The only diagnostics are worktree-setup artifacts: an unbuilt `@aionui/web-host` workspace package
and the generated, untracked `i18n-keys.d.ts`. No studio source file reports an error.

### Coverage — two gates exist, and the one that matters is unwired

`bun run test:coverage` reports **70.27% statements / 67.45% branches / 66.83% functions / 72.01%
lines** and exits 0. That looks like a failure against AGENTS.md's "≥ 80%" but is not: the enforced
thresholds in `vitest.config.ts` are **54 / 50 / 50**. The 80% figure is a target, not a gate.

A second config, `vitest.creative-studio-coverage.config.ts`, carries **real 80% thresholds** scoped
to a studio runtime manifest. It had **no `package.json` script**, so it had never run in any
pipeline, `just push` included; this commit adds `test:coverage:creative-studio`. Verified passing at
this head — **exit code 0**, 671 files, 10,109 tests, no threshold violation reported.

Note for whoever runs it: the coverage `include` scopes which files are **measured**, not which tests
**execute**, so this script runs the whole suite. It is a second full-suite runner, not a cheap
studio-only check — do not run it alongside `bun run test`, and read its **command** exit code rather
than a pipeline's.

Measured coverage over the studio manifest:

| Area                 | Statements |  Lines |
| -------------------- | ---------: | -----: |
| `service/schema2`    |     90.69% | 95.53% |
| `schema2/generation` |     91.57% | 96.79% |
| `schema2/pricing`    |     89.54% | 95.78% |

`factories.ts`, `mutations/identity.ts`, `generation/index.ts` and `conditioningFrame.ts` are at
100%. **The coverage is good; the gate protecting it is not connected.** Wiring a script is a
one-line change and should land before Task 7, when the studio surface changes most.

---

## Carry-over into Task 7

- Item 1's evidence above is the last reproducible proof of the pre-cutover state.
- `service/schema2/` and its mirrored test directory sit at **exactly 10** direct children. Any new
  peer violates the cap; group into a subdirectory of two or more files instead.
- The `schema2` import fence is now **recursive**. It previously walked only the top level, so a
  module moved into a subdirectory was silently exempted.
- `nativePayloadSchemas.test.ts` must move in the same commit as any provider registration change.
- Full-suite results are only trustworthy without a second test runner on the host. A rotating
  failure set is contention; a set that recurs identically is a defect.
