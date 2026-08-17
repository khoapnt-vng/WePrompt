# Creative Studio 2 — Gate 1 Status

- **Recorded:** 2026-08-18
- **Branch:** `codex/creative-studio-table-board-ui-design`
- **PR:** #26
- **Gate status:** Blocked pending review fixes and final re-verification

## Published task boundary

The remote branch is intentionally published only through Task 5:

| Task                                | Commit      | Remote state |
| ----------------------------------- | ----------- | ------------ |
| Task 3 — schema-2 storage isolation | `201c6c141` | Pushed       |
| Task 4 — clip-owned operations      | `9c0088602` | Pushed       |
| Task 5 — versioned Director records | `00cac2a08` | Pushed       |

Gate 1 reviewed the exact Task 1–5 head `00cac2a08a1010a37319963f922c9b6a4f62df3d`
against frozen baseline `21bf87ae1674598bd42ea88c5f13c74e8389b3c0`.

Gate 1 fix commits and unfinished work are local and have not been pushed.

## Review outcome

The independent process/schema and security/spend reviews found no Critical issues and five Important
issues. V2 remains unregistered from the runtime, renderer bridge, and builtin server. The free mutation
path does not reach provider, job, render, adapter, retry, cancel, or other paid boundaries.

| ID    | Important finding                                                                                                                                                                                  | Current state                                                                                                                                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1-01 | Applied V2 receipts accepted an unsafe `appliedRevision` when `expectedRevision` was `Number.MAX_SAFE_INTEGER`.                                                                                    | Fixed and committed locally as `debc912a6`; focused contracts tests passed 85/85.                                                                                                                                          |
| G1-02 | `validateStudioProjectV2` was not total for hostile accessors and Proxies, and could unsafely narrow a Proxy after validating a descriptor snapshot.                                               | Fixed and committed locally as `bf6b6043d`; final schema-2 suite passed 197/197 and independent re-review was clean.                                                                                                       |
| G1-03 | The V2 store applied the 64 MiB record cap before schema sniffing, so an oversized schema-1 manifest was quarantined instead of classified read-only unsupported.                                  | Implemented but not committed. The fixed-memory streaming sniff, no-follow identity checks, >64 MiB no-touch test, and symlink-race test pass in the 316/316 store/cutover suite. Independent re-review is still required. |
| G1-04 | A valid pending record could be deleted or surfaced as terminal by a same-name valid receipt carrying a different `expectedRevision`.                                                              | RED mailbox and writer tests are drafted; production correlation is not implemented yet. Receipt-first recovery with no pending must remain supported.                                                                     |
| G1-05 | The processor could write a durable `malformed_record` rejection, but real mailbox `finish()` refused the invalid V2 pending, permanently leaving pending + slot + receipt and blocking the queue. | Not implemented. The fix must clean only exact V2-attributable malformed/future records under receipt, slot, lease, inode, project, and directory authority while preserving every V1 or mismatched replacement.           |

G1-04 and G1-05 touch the same mailbox authority path and must be implemented sequentially, tested with
the real mailbox/processor boundary, and committed as separately attributable Gate 1 fixes.

## Verification evidence at the Task 5 freeze

- `bun run test`: 657 files passed, 9,965 tests passed, 3 files/24 tests skipped.
- Tracked Studio coverage: 657 files passed, 9,965 tests passed; aggregate branch coverage was 84.63%.
- The tracked coverage manifest exactly matched all 28 executable production files changed from the
  frozen baseline, and every tracked file met the 80% line and branch ratchet.
- `bunx tsc --noEmit`, `bun run lint --quiet`, `bun run format:check`, and baseline `git diff --check`
  passed.
- Frozen reference SHA-256 remained
  `875258f85ad4717fd3b1019ae3096db3394325c81ae1787f1d07b448b2ebe366`.
- Publication/quarantine review was clean for authoritative final links. Portable path-only Node APIs
  can still leave non-authoritative temporary residue under an adversarial parent-directory swap;
  eliminating that residual limitation requires dirfd/openat-style native operations.

`bun run test:coverage` was started on the exact Task 5 freeze but emitted no result after about eleven
minutes and was terminated so the confirmed Gate 1 fixes could begin. It must be rerun on the final
review-fix head and is not counted as passed.

## Local worktree at capture time

- Local commits ahead of the published Task 5 head:
  - `debc912a6 fix(studio): reject unsafe applied receipt revisions`
  - `bf6b6043d fix(studio): make schema 2 validation total`
- Uncommitted G1-03 implementation:
  - `packages/desktop/src/process/services/creative-studio/store.ts`
  - `tests/unit/process/creative-studio/store.test.ts`
- Uncommitted G1-04 RED tests:
  - `tests/unit/process/creative-studio/service/directorCommandMailbox.test.ts`
  - `tests/unit/process/creative-studio/service/studioDirectorCommandWriter.test.ts`

## Gate 1 exit checklist

- [ ] Independently review and commit G1-03.
- [ ] Implement, test, independently review, and separately commit G1-04.
- [ ] Implement, test, independently review, and separately commit G1-05.
- [ ] Rerun the exact Task 1–5 focused suites and receipt/store race regressions.
- [ ] Run `bun run test`.
- [ ] Run `bun run test:coverage` to completion.
- [ ] Run `bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage` and verify every tracked file remains at or above 80% lines and branches.
- [ ] Run lint, format, TypeScript, baseline diff, directory-ratchet, registration-isolation, and frozen-reference checks.
- [ ] Obtain fresh independent process/schema and security/spend clean verdicts on the exact final head.
- [ ] Mark Gate 1 complete in the implementation plan before starting Task 6.
