# The end-to-end suite: measured baseline and how to reproduce it

**Measured:** 2026-09-01, on `claude/e2e-baseline` (branched from the shared CS3 base).
**Scope:** measurement and documentation only. No spec was fixed, no production assertion changed.

Before this, every statement about the e2e suite was static analysis, including mine. The suite runs in
no automatically-triggered job, so no baseline existed anywhere. This is the first one.

**Headline: 135 pass, 171 fail, 112 skip of 418** on the first run; 142/158/117 on an identical second
run, with 96.7% of tests returning the same status. Roughly **157 failures are deterministic**. The prevailing description of this
suite ("stale selectors that need updating") describes a real problem that is a small minority of what
is actually wrong.

**Two distinct problems are tangled together**, and separating them took a second measurement pass
after the first draft of this document got it wrong. There are roughly 170 genuine failures, _and_
there is cross-test contamination that both manufactures additional failures and disguises the cause of
real ones. In a sample of four files, **31 in-suite failures fell to 21 when the files were run alone**
— so about a third of failures in that sample are induced by the suite itself. See
[Isolated versus in-suite](#isolated-versus-in-suite), which is the section to read before triaging
anything from full-suite output.

---

## Baseline A — the whole suite, default environment

`bunx playwright test --config playwright.config.ts`, no environment variables set.

| Status    |   Count |
| --------- | ------: |
| passed    |     135 |
| failed    |     170 |
| timed out |       1 |
| skipped   |     112 |
| **total** | **418** |

79 minutes of serial test time. The suite is serial by design: `playwright.config.ts` sets
`workers: 1` and `fullyParallel: false`, because Electron tests share one app instance. Per-test
timeout is 60s, `expect` timeout 10s, and retries are 0 locally (`process.env.CI ? 1 : 0`).

### The failures, bucketed by root cause

| Count | Bucket                                                                      | What it means                                                                                   |
| ----: | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
|    56 | 60s test timeout                                                            | wedged or waiting on something that never arrives                                               |
|    55 | `Failed to resolve main renderer window (non-DevTools)`                     | harness-level: the app launched, no renderer window resolved within 30s (`fixtures.ts:141-162`) |
|    24 | `page.evaluate: Error invoking remote method … Native IPC request rejected` | the bridge gate refused the call — see the diagnosis below                                      |
|    19 | selector matched nothing                                                    | the dead-selector class                                                                         |
|     9 | assertion failures                                                          | genuinely wrong expectations                                                                    |
|     8 | other (ENOENT, dynamic import, missing cron fixture, …)                     | assorted                                                                                        |

**Only 28 of 171 failures — 16% — are the "stale test" category.**

Do **not** read the remaining 143 as "tests that would pass if the harness were fixed". That was this
document's first conclusion and it is wrong. The window-resolution and timeout buckets are a mixture of
genuinely broken tests whose cause is misreported and tests that are fine and fail only because of what
ran before them. The next section measures the split.

### Files with the most failures

| Failures | File                                                              |
| -------: | ----------------------------------------------------------------- |
|       22 | `specs/ext-ipc-queries.e2e.ts`                                    |
|       15 | `specs/assistant-settings-crud.e2e.ts`                            |
|       11 | `specs/conversation-full-cycle.e2e.ts`                            |
|       10 | `features/assistants-user-data/assistant-user-data.e2e.ts`        |
|        6 | `features/assistants/ui-states.e2e.ts`                            |
|        6 | `specs/assistant-settings-conversation-defaults.e2e.ts`           |
|        6 | `specs/ext-lifecycle.e2e.ts`                                      |
|        6 | `specs/ext-permissions.e2e.ts`                                    |
|        6 | `specs/extension-contributed.e2e.ts`                              |
|        5 | `features/builtin-skill-migration/builtin-skill-migration.e2e.ts` |

---

## Diagnosis: the largest single cause is a missing route table, not rotted tests

The worst file, `ext-ipc-queries.e2e.ts`, fails **22 of 22 in isolation**, so this is not an
order-dependent cascade from earlier tests. Run alone it produces:

```
Error: page.evaluate: Error invoking remote method 'office-ai-bridge-adapter':
Error: [adapter] Native IPC request rejected: operation is not allowed
    at helpers/bridge/invoke.ts:94
```

That message is thrown at `packages/desktop/src/common/adapter/main.ts:90-93`, where
`getNativeBridgeProviderKey(parsed.name)` returns null for any name outside the frozen
`NATIVE_BRIDGE_PROVIDER_KEYS` allowlist.

The ten keys the extension helpers invoke are **all absent from that allowlist**:

```
channel.get-plugin-status                extensions.get-mcp-servers
extensions.get-acp-adapters              extensions.get-settings-tabs
extensions.get-agents                    extensions.get-skills
extensions.get-assistants                extensions.get-themes
extensions.get-loaded-extensions         extensions.get-webui-contributions
```

**This is test rot, not a production defect.** Production does not use the native bridge for these at
all — `common/adapter/ipcBridge.ts:2407` reads
`getLoadedExtensions: httpGet<IExtensionInfo[], void>('/api/extensions')`. The renderer goes over HTTP.

The e2e helper `invokeBridge` (`tests/e2e/helpers/bridge/invoke.ts`) checks its `HTTP_ROUTES` table
first and falls back to the generic preload IPC protocol for anything not listed.
`tests/e2e/helpers/bridge/routes.ts` has **no `extensions.*` entries**, so every one of those calls
takes the fallback and is rejected by the allowlist.

**The fix is in the route table, not in the specs** — but it is out of scope here and must be verified
by a run, not by reasoning. Roughly 40 failures across four files share this single cause.

---

## Baseline B — the Creative Studio spec, with its environment gates set

`tests/e2e/features/workspaces/creative-studio.e2e.ts` is gated on three variables that **no recipe
sets**. Measured both ways:

| Run | Environment                                                                  | Result                            |
| --- | ---------------------------------------------------------------------------- | --------------------------------- |
| A   | none set                                                                     | **12 skipped**, 0 executed        |
| B   | `AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 AIONUI_ENABLE_CREATIVE_STUDIO=1` | **7 failed, 5 skipped, 0 passed** |

Both halves of the earlier hypothesis are confirmed simultaneously. The gates genuinely are why the
tests skip — that part is environmental. And the tests underneath are genuinely broken — that part is
not. Failures are `expect(locator).toBeVisible()` and repeated
`TimeoutError: locator.fill: Timeout 30000ms exceeded`.

**The Studio e2e spec currently has zero passing tests.** Five remain skipped even with all three gates
set, on a second guard inside the file.

This is the file a Phase 5 renderer E2E would most naturally extend.

---

## Isolated versus in-suite

The suite is serial and shares one Electron instance, so tests contaminate each other. Four files were
re-run alone and compared against their results in the full run.

| File                                   | Alone                | In the full suite                        | Reading                                                              |
| -------------------------------------- | -------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `specs/assistant-settings-crud.e2e.ts` | 15 failed            | 15 failed (13 of them window-resolution) | **No recovery.** Genuinely broken; in-suite the cause is misreported |
| `specs/conversation-full-cycle.e2e.ts` | 6 failed, 15 skipped | 11 failed, 10 skipped                    | Partial — 5 recovered                                                |
| `specs/ext-channels.e2e.ts`            | 6 passed, 1 skipped  | 4 passed, 2 failed, 1 skipped            | Partial — 2 recovered                                                |
| `specs/dropdown-search.e2e.ts`         | **3 passed**         | **3 failed**                             | **Full recovery.** Nothing wrong with these tests at all             |
| **total**                              | **21 failed**        | **31 failed**                            | ~⅓ of failures in this sample are induced by the suite               |

Two things follow, and they pull in opposite directions.

**Cross-test contamination is real and it manufactures failures.** `dropdown-search` passes 3 of 3
alone and fails 3 of 3 in the suite. Anyone "fixing" those tests would be repairing something that was
never broken.

**But most failures are genuine, and the suite misreports their cause.**
`assistant-settings-crud` fails 15 either way. In the suite, 13 of those surface as
`Failed to resolve main renderer window`; alone, none do. The window-resolution message is therefore a
**masking symptom** on that file, not the defect. The same pattern holds for
`specs/ext-ipc-queries.e2e.ts`: 11 window failures in the suite, but run alone it fails 22 of 22 at the
IPC gate instead — same brokenness, different story depending on what preceded it.

**The practical consequence:** triaging from full-suite output will send you after phantom
window-resolution problems on tests whose real defect is elsewhere, and will also have you repair tests
that are fine. Reproduce any failure in isolation before believing its error message.

**Sample size, stated plainly:** four of the fourteen files that showed window-resolution failures. The
one-third figure is from those four and should not be extrapolated to the whole suite. Two earlier
generalisations in this document were each drawn from a single file and were each wrong; the honest
position is that the split varies per file and has to be measured per file.

---

## The repeat run: what is deterministic

The suite was run a second time under identical conditions — same worktree, same unpinned backend
binary (sha256 `4a584bf58da5…`), no environment gates, dev mode. Only the run differs.

|           | Run A | Run C |
| --------- | ----: | ----: |
| passed    |   135 |   142 |
| failed    |   170 |   158 |
| timed out |     1 |     1 |
| skipped   |   112 |   117 |

**404 of 418 tests — 96.7% — returned the same status.** Fourteen moved: eight failed→passed, five
failed→skipped, one passed→failed. So the headline is stable and roughly **157 failures are
deterministic**, with about a dozen tests that are state- or timing-dependent.

### The repeat validated the isolation method

The four files measured in isolation predicted their own behaviour across the two runs, which is the
most useful result here:

| File                                   | Isolated  | Run A              | Run C         |
| -------------------------------------- | --------- | ------------------ | ------------- |
| `specs/dropdown-search.e2e.ts`         | 3 passed  | 3 failed           | **3 passed**  |
| `specs/ext-channels.e2e.ts`            | 6 passed  | 2 failed, 4 passed | **6 passed**  |
| `specs/assistant-settings-crud.e2e.ts` | 15 failed | 15 failed          | **15 failed** |
| `specs/ext-ipc-queries.e2e.ts`         | 22 failed | 22 failed          | **22 failed** |

Every file that recovers in isolation also **moved between runs**. Every file that fails in isolation
is **bit-stable across both**. That gives a classifier for the whole suite that costs two runs instead
of 418 isolated ones:

> **Run the suite twice. What moves is contamination. What holds is a real defect.**

It also means the contamination is _deterministic enough to trace_ — the same tests recover, rather
than a different random set each time — so it is a findable leak between specific specs, not
irreducible timing noise. That is the cheaper of the two possible worlds.

**One test regressed:** `specs/window-controls.e2e.ts` "maximize and unmaximize round-trip through the
bridge" passed in A and failed in C. Worth knowing, because that file is recommended above as the
smoke check — it is a good smoke because it is fast and needs no UI, not because it is perfectly
stable.

---

## Reproducing this

```bash
# 1. Build. This is electron-vite only -- no electron-builder, ~33 MB into out/.
bun run package

# 2. Whole suite, default environment. Serial, one worker, roughly 80 minutes.
PLAYWRIGHT_JSON_OUTPUT_NAME=/tmp/e2e-baseline.json \
  bunx playwright test --config playwright.config.ts --reporter=json

# 3. One file, for a fast loop.
bunx playwright test --config playwright.config.ts tests/e2e/specs/window-controls.e2e.ts --reporter=line

# 4. The Creative Studio spec needs all three gates or it silently skips all twelve.
AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 AIONUI_ENABLE_CREATIVE_STUDIO=1 \
  bunx playwright test --config playwright.config.ts \
  tests/e2e/features/workspaces/creative-studio.e2e.ts --reporter=line
```

A two-test smoke that proves the harness itself works before committing to a long run —
`window-controls.e2e.ts` drives real IPC with no UI, and passes in 18 seconds:

```bash
bunx playwright test --config playwright.config.ts tests/e2e/specs/window-controls.e2e.ts
```

### Things that will mislead you

**`just e2e-test` runs in dev mode, not packaged.** `shouldUsePackaged()` (`fixtures.ts:198-201`)
returns true only under `E2E_PACKAGED=1` or `CI`. `resolvePackagedApp` looks for
`WePrompt.app/Contents/MacOS/WePrompt`, which is electron-builder output that `bun run package`
(electron-vite) does not produce. So locally it silently falls back to dev mode, and any assertion
depending on packaged behaviour is untested.

**The backend is whatever is in `~/.cargo/bin`.** Every run logs
`[E2E] Using DEV backend: /Users/<you>/.cargo/bin/aioncore`. That is an unpinned local install, not
the `aioncoreVersion` pinned in `package.json`. **These numbers were produced against that local
binary**, and some share of the harness failures may be version skew rather than suite rot. Anyone
reproducing this should record which binary they used.

**The three Studio gates are set by no recipe** — not by `justfile`, not by `package.json`. They must
be exported by hand, or twelve tests skip and the run still reports success.

**The suite is serial and slow because of the failures, not despite them.** 56 timeouts at 60s each is
most of the 79 minutes, and the app relaunches roughly every three tests. Fixing the timeouts would
shorten the suite more than any parallelism change, which is not available anyway — `workers: 1` is
load-bearing, because the tests share one Electron instance.

---

## What this means for Phase 5

Phase 5's stated deliverable includes "the actual renderer E2E", and it lands in this suite.

As measured today, a new acceptance spec would arrive in a harness where **55 tests cannot resolve a
renderer window and 24 cannot invoke IPC** — and it would sit in a file whose twelve existing tests
include zero passes. A genuine phase-5 failure would be indistinguishable from the surrounding noise,
and a genuine phase-5 pass would be difficult to trust.

The suite is not beyond repair. The largest single cause is a missing route table, which is a
contained change. But it should be measured again after any fix, because nothing here was established
by reading code — the whole point of this document is that reading code got the answer wrong.

---

## What this baseline does not cover

Nothing was fixed and nothing was retried. `retries` is 0 locally, so **no failure here has been shown
to be deterministic except the one file I re-ran in isolation** (`ext-ipc-queries`, 22/22 both times).
Some share of the 56 timeouts may be flake under a machine that was also running other work; a second
full run would separate that, and has not been done.

The run used dev mode against an unpinned local `aioncore`. It was executed once, on macOS, on one
machine. Windows and packaged-mode behaviour are unmeasured. The 112 skips were not individually
audited — some are deliberate platform guards, and this document does not distinguish those from the
environment-gated ones beyond the Creative Studio file.
