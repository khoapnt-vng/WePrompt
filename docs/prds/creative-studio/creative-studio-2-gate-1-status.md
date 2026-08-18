# Creative Studio 2 — Gate 1 Status

- **Recorded:** 2026-08-18
- **Branch:** `codex/creative-studio-table-board-ui-design`
- **PR:** #26
- **Gate status:** Complete locally for the reviewed non-cut scope
- **Reviewed code head:** `12a8d7fe77823ac826db6a1812d5538057686477`

## Published task boundary

The remote branch remains intentionally published only through Task 5:

| Task                                | Commit      | Remote state |
| ----------------------------------- | ----------- | ------------ |
| Task 3 — schema-2 storage isolation | `201c6c141` | Pushed       |
| Task 4 — clip-owned operations      | `9c0088602` | Pushed       |
| Task 5 — versioned Director records | `00cac2a08` | Pushed       |

Gate 1 reviewed the Task 1–5 freeze `00cac2a08a1010a37319963f922c9b6a4f62df3d`
against frozen baseline `21bf87ae1674598bd42ea88c5f13c74e8389b3c0`, then reviewed every
Gate 1 fix through the final local code head above. Gate 1 fixes and this status update have not been
pushed.

## Scope and outcome

The independent process/schema, security/spend, publication, and integrity reviews found no Critical
issues and six Important issues in the reviewed scope. All six are fixed in separately attributable
local commits and have clean independent re-reviews.

Per user direction, this continuation did not investigate, fix, or include findings scoped exclusively
to `cuts.ts` or cut-clip validation. No cut source or cut-clip validation file changed in the Gate 1 fix
commits. This completion statement therefore applies to the reviewed non-cut Task 1–5 scope.

V2 remains unregistered from the runtime, renderer bridge, preload/IPC path, and builtin server. The
free V2 mutation path does not reach provider, job, render, adapter, retry, cancel, or other paid
boundaries.

| ID    | Important finding                                                                                                                            | Resolution                                                                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| G1-01 | Applied V2 receipts accepted an unsafe successor when `expectedRevision` was `Number.MAX_SAFE_INTEGER`.                                      | Fixed in `debc912a6`; applied revisions now satisfy the revision contract before successor equality.                                                      |
| G1-02 | `validateStudioProjectV2` could throw on hostile accessors/Proxies and unsafely narrow a Proxy after validating a descriptor snapshot.       | Fixed in `bf6b6043d`; validation is a total descriptor-only graph walk and rejects Proxy sources without invoking traps.                                  |
| G1-03 | Oversized schema-1 manifests were capped before schema attribution and could be quarantined instead of classified read-only unsupported.     | Fixed in `d563d5f98`; a bounded, no-follow streaming JSON classifier preserves schema-1 no-touch while rejecting malformed/oversized schema-2 records.    |
| G1-04 | A pending command could be deleted or surfaced terminal by a same-name receipt carrying a different `expectedRevision`.                      | Fixed in `b87f32b6a`; destructive cleanup and status paths correlate pending, receipt, slot, lease, project, and directory authority.                     |
| G1-05 | Durable malformed/future V2 rejections could leave pending + slot + receipt indefinitely, blocking the single-slot queue.                    | Fixed in `4a59294de`; exact attributable invalid records are repaired while V1, mismatched, raced, and replacement records remain fail-closed/no-touch.   |
| G1-06 | Descriptor snapshots could validate an object whose inherited or hidden serialization behavior changed the original bytes written afterward. | Fixed in `12a8d7fe7`; records reject custom prototypes, and own/prototype serialization hooks, Proxies, Symbols, and hidden persisted fields fail closed. |

## Final verification evidence

- `bun run test`: 657 files passed, 10,052 tests passed; 3 files/24 tests skipped.
- `bun run test:coverage`: 657 files passed, 10,052 tests passed; repository aggregate coverage was
  70.61% lines and 65.91% branches.
- `bunx vitest run --config vitest.creative-studio-coverage.config.ts --coverage`: 657 files passed,
  10,052 tests passed; tracked aggregate coverage was 92.22% lines and 84.26% branches.
- The tracked manifest, executable production diff, and coverage report match exactly at 28 files.
  Every tracked file meets the per-file 80% line and branch ratchet; the minimums are 88.24% lines and
  81.01% branches.
- `bunx tsc --noEmit`, `bun run lint --quiet`, `bun run format:check`, plain `git diff --check`, and the
  frozen-baseline diff check passed. Lint reported zero errors.
- Directory ratchets passed. Existing oversized directories did not grow, and the new directories
  remain within the required 2–10 direct-child range.
- The frozen reference remains 3,720,487 bytes with SHA-256
  `875258f85ad4717fd3b1019ae3096db3394325c81ae1787f1d07b448b2ebe366`.
- Runtime, IPC/preload, renderer, and bridge activation blobs remain unchanged. The V1
  `registerStudioTools` body is byte-identical to the baseline, production `main()` still calls it,
  and no production V2 registration callsite exists.
- Fresh exact-head process/schema, security/spend, and integrity reviews are clean for the stated
  non-cut scope.

## Local Gate 1 commits

- `debc912a6 fix(studio): reject unsafe applied receipt revisions`
- `bf6b6043d fix(studio): make schema 2 validation total`
- `d563d5f98 fix(studio): classify oversized schema 1 manifests`
- `b87f32b6a fix(studio): correlate director command receipts`
- `4a59294de fix(studio): repair malformed director commands`
- `12a8d7fe7 fix(studio): reject inherited schema serialization`

These commits are local and unpushed. Task 6 has not started.

## Gate 1 exit checklist

- [x] Independently review and separately commit every in-scope Critical/Important fix.
- [x] Rerun the focused schema/store/receipt/race suites.
- [x] Run `bun run test`.
- [x] Run `bun run test:coverage` to completion.
- [x] Run tracked Creative Studio coverage and verify every file remains at or above 80% lines and branches.
- [x] Run lint, format, TypeScript, diff, directory-ratchet, registration-isolation, and frozen-reference checks.
- [x] Obtain fresh independent process/schema, security/spend, and integrity clean verdicts on the exact final code head.
- [x] Record the user-directed exclusion of `cuts.ts` and cut-clip validation findings.
- [x] Mark Gate 1 complete before starting Task 6.
