# INV-017 SQLite Access Investigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reproduce and classify AionCore SQLite code 14 safely, prove generic access loss cannot trigger destructive recovery, and produce a bounded evidence-backed follow-up only if a durable cause is found.

**Architecture:** First lock in the non-destructive classification boundary with unit tests. Then run a disposable-profile matrix that records sanitized filesystem/backend metadata. Product behavior changes are conditional on a deterministic reproduction and use restart/retry before any corruption-specific path.

**Tech Stack:** Electron/AionCore startup lifecycle, SQLite WAL, Vitest 4, disposable packaged profiles, macOS/Windows platform smoke testing.

## Global Constraints

- This is an investigation (`INV-017`), not a confirmed corruption fix. Keep `Needs reproduction` until a deterministic cause is demonstrated.
- Total time box is one engineer-day; stop any single matrix axis after 90 minutes and stop the entire matrix when the day expires.
- Use only synthetic databases and disposable profile copies. Never lock, chmod, rename, remove, or open a live user database for testing.
- SQLite code 14 (`unable to open database file`) is an access/path/permission symptom, not proof of corruption.
- Generic code 14 must never call `recoverCorruptedDatabaseAfterUserConfirmation`, start AionCore recovery mode, delete a database, or rebuild data.
- Collect only OS/arch, app/backend version, phase, structured boundary code/stage, SQLite code, timestamps/durations, file existence/type/mode, WAL/SHM presence, and a randomized case ID. Do not collect DB content, prompts, raw logs, API keys, usernames, credentials, or full paths.
- Stop immediately if reproduction would require real user data, disabling platform protections, or an unbounded destructive operation.

---

### Task 1: Lock in the non-destructive safety boundary

**Files:**

- Modify: `packages/desktop/src/process/startup/backendStartupFailure.ts`
- Modify: `packages/desktop/src/process/startup/recoverCorruptedDatabase.ts`
- Modify if a new diagnostic reason is required: `packages/desktop/src/common/types/platform/electron.ts`
- Modify: `tests/unit/process/startup/backendStartupFailure.test.ts`
- Modify: `tests/unit/bootstrap/backendStartupFailure.test.ts`
- Modify: `tests/unit/bootstrap/recoverCorruptedDatabase.test.ts`
- Modify: `tests/unit/bootstrap/recoverCorruptedDatabasePreload.test.ts`

- [ ] Write failing/guard tests for code 14 in message, stdout, stderr, and structured boundary details; assert it never classifies as `backend_recoverable_database_corruption` without the existing explicit corruption boundary.
- [ ] Test code 14 combined with valid `PRAGMA quick_check`, missing parent directory, read-only parent, locked DB, and missing WAL/SHM. All remain non-destructive access/startup failures.
- [ ] Test that the recovery bridge rejects every code-14 classification and performs zero calls to stop, recovery-start, mark-ready, reload, delete, or rename dependencies.
- [ ] If the current classifier already passes these cases, keep the task test-only. Add a new `backend_local_data_access_unavailable` reason only when a stable structured backend boundary distinguishes it; do not parse generic provider/HTTP messages.
- [ ] Run:

```bash
bunx vitest run tests/unit/process/startup/backendStartupFailure.test.ts tests/unit/bootstrap/backendStartupFailure.test.ts tests/unit/bootstrap/recoverCorruptedDatabase.test.ts tests/unit/bootstrap/recoverCorruptedDatabasePreload.test.ts
bun run test
```

- [ ] Commit `test(startup): keep sqlite code 14 non-destructive` if new regressions were added; do not create a no-op production change.

### Task 2: Build a disposable reproduction harness

**Files:**

- Create: `tests/integration/sqliteAccess/sqliteAccessMatrix.integration.test.ts`
- Create: `tests/integration/sqliteAccess/fixtures.ts`
- Create: `docs/design/sqlite-code14-investigation.md`

**Case result:**

```ts
type SqliteAccessCaseResult = {
  caseId: string;
  axis: string;
  cycle: number;
  platform: string;
  appVersion: string;
  backendVersion: string;
  startupPhase: string;
  boundaryCode?: string;
  boundaryStage?: string;
  sqliteCode?: number;
  recoveredAfterRestart: boolean;
  integrity: 'ok' | 'failed' | 'not_run';
  durationMs: number;
};
```

- [ ] Create a synthetic disposable profile factory in a temporary directory. Copy fixtures per case; never reuse a mutated case directory.
- [ ] Redact paths to randomized case IDs at collection time, not after logging. Reject unexpected fields before writing evidence.
- [ ] Add harness cases for normal restart, upgrade/restart, concurrent lock holder, WAL/SHM mismatch, read-only DB, read-only/missing parent, and path rename/removal. Restore permissions/handles in `finally` blocks.
- [ ] Make each automated case assert no recovery-mode invocation and no deletion/rebuild. A restart may be attempted only after the first failure evidence is captured.
- [ ] Run the integration test against disposable fixtures and record command/version prerequisites in the investigation document.
- [ ] Commit `test(startup): add disposable sqlite access matrix` only if the harness is deterministic and safe on the development platform.

### Task 3: Execute the one-day platform matrix

Run 20 cycles per feasible axis until reproduction or the time box is reached:

| Axis | Required observation |
| --- | --- |
| Upgrade then restart | First/second startup, migration boundary, integrity, synthetic record preservation |
| Normal restart | Clean quit/relaunch and abrupt-process-exit relaunch |
| Sleep/wake | Backend health before sleep, after wake, and after full restart |
| File lock | Lock owner lifecycle and whether restart alone restores access |
| WAL/SHM mismatch | Main DB integrity and behavior with disposable companion-file variants |
| Path/permission | DB and parent availability/mode changes with guaranteed restoration |

- [ ] Run on macOS ARM, macOS Intel, and Windows with the same packaged app/backend hashes.
- [ ] Store only the bounded `SqliteAccessCaseResult` rows plus reproduction steps and aggregate counts in `docs/design/sqlite-code14-investigation.md`.
- [ ] Stop an axis as soon as a deterministic reproduction occurs; rerun that exact case five times to establish repeatability instead of continuing broad mutation.
- [ ] Stop the entire investigation after one engineer-day even if no reproduction occurs.

### Task 4: Apply the evidence decision gate

- [ ] **No reproduction:** make no product behavior change. Record the negative matrix, keep INV-017 open/Needs reproduction, and add the safe support checklist: fully quit, restart, capture bounded diagnostics, preserve data.
- [ ] **Reproduced transient access loss with integrity OK:** write a separate implementation plan for typed local-data-access status, one safe backend restart/retry, bounded diagnostics, and localized recovery copy. Keep corruption recovery inaccessible.
- [ ] **Reproduced startup path/permission defect:** write a focused fix against the exact path-preparation or permission owner, with the failing matrix case as regression coverage.
- [ ] **Confirmed corruption with explicit structured boundary:** reuse the existing explicit user-confirmed backup/rebuild path; do not broaden it to code 14. Add fixture-based proof that integrity failure, not message text, authorizes it.
- [ ] **Requires real data or remains ambiguous:** stop, redact evidence, and request a support-approved diagnostic protocol rather than expanding collection.

### Task 5: Verify and report honestly

- [ ] Run `just check`, `bun run test`, and `bun run test:coverage` only if repository files changed.
- [ ] Report cycle counts, platforms, exact app/backend hashes, reproduced/non-reproduced axes, integrity results, and stop condition.
- [ ] Do not close INV-017 on safety tests alone. Close it only when a reproduced cause and verified recovery behavior meet the issue acceptance criteria.

## Final Acceptance

- Generic SQLite code 14 is proven non-destructive at unit and integration boundaries.
- The matrix uses only disposable synthetic data and bounded sanitized evidence.
- A reproduced transient failure prefers restart/retry and preserves the database.
- Corruption recovery remains gated by explicit confirmed-corruption evidence and user consent.
- No-reproduction is reported as a valid bounded investigation outcome, not misrepresented as a fix.

