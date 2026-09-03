# Sprint 2 Bug-Fix Wave Design

**Date:** 2026-08-08  
**Status:** Approved; implementation plan written  
**Target:** `origin/sprint2`  
**Execution model:** Sequential, one accepted MR at a time

## Goal

Reconcile the canonical bug register and land the already-prepared BUG-041,
BUG-036, and BUG-032 fixes without duplicating active work, combining unrelated
bugs, or allowing one stale slice to contaminate the next.

## Scope

This wave contains four implementation/register merge requests plus one
docs-only closeout merge request:

1. **MR !98 / register reconciliation**
2. **BUG-041 / Vietnamese template-creation intent**
3. **BUG-036 / Review accessibility and localization**
4. **BUG-032 / truthful Write-assistant copy**
5. **Wave closeout / canonical status reconciliation**

The wave stops after BUG-032 for an integrated stabilization checkpoint.
BUG-024, BUG-037, BUG-028, BUG-027, and BUG-030 are outside this wave.

## Source Candidates

| Slice | Preserved candidate | Intended content |
| --- | --- | --- |
| Register | `docs/studio-bug-wave@594c1e64b` | BUG-041 registration, Studio bug-wave decision, BUG-027 evidence |
| BUG-041 | `codex/bug041-vietnamese-intent@8a9fb286e` | Four-path intent-matching change and regression tests |
| BUG-036 | `codex/bug036-review-a11y@ebd5d3849` | First four commits: screen-reader state, focus return, plurals, localized timestamp |
| BUG-032 | `d2c2cae5b` | Final candidate commit only: truthful assistant-dock copy in all supported locales |

These commits are donors, not automatically accepted heads. Each slice is
rebased or replayed onto the newly accepted `origin/sprint2` tip before review.

## Sequence and Integration Contract

### Slice 1 — Reconcile MR !98

- Recreate the missing remote `docs/studio-bug-wave` source branch from the
  clean local candidate; MR !98 currently has no remote SHA and therefore
  reports conflicts.
- Correct two stale register statements in the same register-only MR:
  - BUG-016's subject-bearing thinking exclusion is already covered by tests.
  - Epic A A0+/3 is merged through MR !94, not "not started".
- Do not change production or test code in this slice.
- Run the repository's mandatory `just push` gate before publishing.
- Merge only after GitLab resolves a real head and reports no conflicts.

### Slice 2 — Land BUG-041

- Rebase/replay `8a9fb286e` onto the post-!98 Sprint 2 tip.
- Preserve precision-biased Vietnamese matching: accented Vietnamese phrases
  are supported; broad bare forms such as `mau` and `tao` remain rejected to
  avoid false-positive directive injection.
- Keep model-facing directive text in English; add no locale keys.
- Required behavior tests cover English compatibility, accented Vietnamese
  matches, near-miss rejection, templated-send parsing, and hook activation.
- Run renderer i18n validation because renderer files change, even though no
  translations are added.

### Slice 3 — Land BUG-036

- Use exactly the first four candidate commits through `ebd5d3849`; exclude
  BUG-032's `d2c2cae5b` from this MR.
- Preserve the four accepted outcomes:
  1. Review states are exposed through the accessibility tree.
  2. Closing the Review drawer returns focus to its opener and the dialog has
     an accessible name.
  3. Missing-render-shot copy follows real i18next plural behavior and the
     plural-key invariant covers it.
  4. Render timestamps use locale-aware formatting rather than raw ISO text.
- Validate every language listed in
  `packages/desktop/src/common/config/i18n-config.json`.

### Slice 4 — Land BUG-032

- Start from the accepted post-BUG-036 Sprint 2 tip and replay only
  `d2c2cae5b`.
- Change the Write assistant description to promise only the currently shipped
  one-shot storyboard-draft capability.
- Keep provider/model labels and charge disclosure unchanged.
- Require an exact approved mapping in all supported locales; do not accept
  merely non-empty or English-only assertions.

### Slice 5 — Close the wave register

- Start from the accepted post-BUG-032 Sprint 2 tip.
- Move BUG-041, BUG-036, and BUG-032 to Done with their exact MR and merge
  evidence; do not mark any unmerged candidate complete.
- Preserve BUG-024, BUG-037, BUG-028, BUG-027, and BUG-030 as open follow-ups.
- This is a docs-only reconciliation MR with no production or test-code change.

## Verification and Acceptance

Every slice must pass, on its exact pushed head:

1. Focused RED/GREEN tests for the changed behavior.
2. `bun run i18n:types` and `node scripts/check-i18n.js` when renderer or locale
   files change.
3. `bun run lint` with zero errors.
4. `bun run format:check`.
5. `bunx tsc --noEmit`.
6. `bun run test` — the full suite, before every slice merge.
7. `git diff --check` and a path-scope audit.
8. Review of the exact candidate head before `just push` and merge.

`just push` is the only permitted push path. A focused green run never replaces
the full-suite gate.

## Stop Conditions

Stop the wave and preserve the current branch if any slice:

- needs a force-push or destructive history rewrite;
- changes files owned by another active workstream beyond the declared paths;
- introduces a new user-facing string outside the approved locale mapping;
- fails the full suite twice for the same unresolved reason;
- requires a backend, IPC, migration, packaging, or feature-flag change; or
- reveals that a donor commit depends on an excluded later commit.

After each accepted merge, refresh `origin/sprint2` before preparing the next
slice. Do not merge all four candidates together and test only once.

## Completion Boundary

The wave is complete when MR !98, BUG-041, BUG-036, BUG-032, and the docs-only
closeout MR are individually merged into `origin/sprint2`, the post-BUG-032
full suite passes, and `TASKS.md` records their honest status. No packaging,
release, flag enablement, or Sprint 3 Studio work is authorized by this design.
