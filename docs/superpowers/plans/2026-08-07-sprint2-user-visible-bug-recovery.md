# Sprint 2 User-Visible Bug Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce independently reviewed local candidates for BUG-019 and BUG-016, a bounded BUG-018 chat-error candidate, and BUG-032 only after its Creative Studio ownership dependency clears.

**Architecture:** A Controller freezes one current remote Sprint 2 base, creates one isolated worktree per bug, and runs independent TDD lanes. Focused work may run concurrently, but repository-wide tests and exact-head reviews are serialized. Every candidate stops at a local reviewed commit; this plan performs no push, merge request, merge, packaging, release, or feature activation.

**Tech Stack:** Electron, React, TypeScript strict mode, Vitest 4, React Testing Library, i18next, Git worktrees, Oxfmt, Oxlint.

## Global Constraints

- Fetch immediately before execution and use the literal `origin/sprint2` commit, never the ahead local `sprint2` checkout.
- Preserve `codex/bug016-thinking-fallback@5bc32216d`, `codex/bug018-provider-failure-contract@343b725c4`, and `codex/epic002-template-creation-r-02ee3f8d6@a1754a13e` unchanged.
- Use one branch, one worktree, one path owner, and one atomic commit chain per bug.
- Session names are `S2-R1-CONTROLLER`, `S2-R1-BUG019-WORKER`, `S2-R1-BUG016-WORKER`, `S2-R1-BUG018-WP`, `S2-R1-BUG032-WORKER`, and `S2-R1-REVIEWER`.
- Session status is one of `ACTIVE`, `WAITING_DEPENDENCY`, `READY_FOR_INTEGRATION`, `PAUSED`, or `DONE`; review verdict is separately `ACCEPT` or `BLOCK`.
- BUG-032 must not edit the 12 conversation locale files or `studioI18n.test.ts` until the Creative Studio owner supplies an immutable accepted/frozen head or integrates its work.
- BUG-018 owns chat-error normalization only. It must not change provider health, model eligibility, Model Settings, provider storage, AionCore, AionRS, bundled backends, or retry-delay contracts.
- New or changed renderer behavior must not import Node.js or main-process APIs.
- No new module is allowed unless the architecture check proves an existing seam cannot hold the change and the direct-child limit remains at most 10.
- New or changed user-facing copy must use the existing i18n system and pass type generation plus `scripts/check-i18n.js`.
- Treat provider narration, provider bodies, paths, and secrets as untrusted; never expose raw thinking content or new raw backend detail.
- Use focused RED-to-GREEN tests, then TypeScript, changed-file lint/format, i18n gates, `git diff --check`, and a serialized full `bun run test` before each commit.
- `bun run test:coverage` is deferred to a later PR/integration authorization; this wave creates no PR.
- Do not raise timeouts, weaken assertions, skip failures, clean unrelated files, or mutate remote state.
- The autonomous window is four to six elapsed hours. BUG-018 gets at most 90 minutes for contract/RED proof plus two hours for implementation.

## Plan Bundle

- Bundle root: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans`
- BUG-019: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug019-project-home.md`
- BUG-016: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug016-thinking-fallback.md`
- BUG-018: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug018-provider-chat-errors.md`
- BUG-032: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug032-studio-copy.md`

These files are intentionally ignored and will not exist inside fresh Sprint worktrees. The Controller records each absolute path and its SHA-256 in branch-scoped Git configuration; every worker verifies both before acting.

---

### Task 1: Freeze the execution base and ownership map

**Files:**

- Read: `AGENTS.md`
- Read: `CONTRIBUTING.md`
- Read: `docs/superpowers/specs/2026-08-07-sprint2-user-visible-bug-recovery-design.md`
- Read: `TASKS.md`
- Modify: none

**Interfaces:**

- Consumes: the latest remote `origin/sprint2` ref and current worktree registry.
- Produces: immutable `S2_BASE`, `S2_SHORT`, clean-base evidence, and a recorded Creative Studio donor/dependency state.

- [ ] **Step 1: Refresh the accepted Sprint 2 ref**

Run:

```bash
git fetch origin sprint2
```

Expected: exit 0. This changes only remote-tracking refs.

- [ ] **Step 2: Record the literal base without switching the shared checkout**

Run:

```bash
S2_BASE="$(git rev-parse origin/sprint2)"
S2_SHORT="$(git rev-parse --short=9 "$S2_BASE")"
git update-ref refs/codex/s2-user-bug-recovery-20260807/base "$S2_BASE"
git show -s --format='%H %cI %s' "$S2_BASE"
git merge-base --is-ancestor "$S2_BASE" origin/sprint2
test "$(git rev-parse refs/codex/s2-user-bug-recovery-20260807/base)" = "$S2_BASE"
```

Expected: the printed hash equals `S2_BASE`; the ancestry command exits 0; the namespaced local ref durably freezes the base across later shells without changing a remote.

- [ ] **Step 3: Prove that the shared checkout will not be used as a base**

Run:

```bash
git status --short --branch
git rev-parse HEAD sprint2 origin/sprint2
```

Expected: record all three hashes and all existing untracked files. Do not modify or clean them.

- [ ] **Step 4: Record all worktrees and overlapping owners**

Run:

```bash
git worktree list --porcelain
git -C /Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2 status --short --branch
git -C /Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2 rev-parse HEAD
git -C /Users/lap16603/Documents/WePrompt/.worktrees/creative-suite-sprint2 diff --name-only origin/sprint2...HEAD -- packages/desktop/src/renderer/services/i18n/locales tests/unit/pages/studio/studioI18n.test.ts
```

Expected: BUG-032 is `WAITING_DEPENDENCY` whenever those locale/test paths are present or the donor worktree is dirty.

- [ ] **Step 5: Verify committed, staged, unstaged, and untracked ownership for every lane path**

Run this loop against every registered worktree:

```bash
owned_paths=(
  packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx
  tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx
  packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx
  tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
  packages/desktop/src/common/chat/chatLib.ts
  packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpSendBox.tsx
  packages/desktop/src/renderer/pages/conversation/platforms/acp/buildSendFailureError.ts
  packages/desktop/src/renderer/pages/conversation/platforms/acp/errorDiagnostics.ts
  packages/desktop/src/renderer/pages/conversation/platforms/acp/useAcpInitialMessage.ts
  packages/desktop/src/renderer/pages/conversation/Messages/hooks.ts
  tests/unit/common/chatLib.test.ts
  tests/unit/renderer/buildSendFailureError.test.ts
  tests/unit/renderer/conversation/AcpSendBox.dom.test.tsx
  tests/unit/renderer/conversation/useAcpInitialMessage.dom.test.tsx
  tests/unit/renderer/errorDiagnostics.test.ts
  tests/unit/renderer/normalizeDbMessage.test.ts
  tests/unit/feedback/MessageTipsFeedback.dom.test.tsx
  packages/desktop/src/renderer/services/i18n/locales
  tests/unit/pages/studio/studioI18n.test.ts
)
git worktree list --porcelain | awk '/^worktree / { sub(/^worktree /, ""); print }' | while IFS= read -r active_wt; do
  git -C "$active_wt" rev-parse --show-toplevel
  git -C "$active_wt" status --short --branch
  git -C "$active_wt" symbolic-ref --short -q HEAD || git -C "$active_wt" rev-parse HEAD
  git -C "$active_wt" diff --name-only origin/sprint2...HEAD -- "${owned_paths[@]}"
  git -C "$active_wt" diff --name-only -- "${owned_paths[@]}"
  git -C "$active_wt" diff --cached --name-only -- "${owned_paths[@]}"
  git -C "$active_wt" ls-files --others --exclude-standard -- "${owned_paths[@]}"
done
```

Expected: every intersection is attributed to a printed worktree/branch. The clean worktree `codex/bug016-thinking-fallback@5bc32216d` is a preserved immutable donor and does not own the new lane; any different head or dirty/staged/untracked intersection on that worktree is an active conflict. Apply the same exact-head-and-clean exception to the other preserved branches named in Global Constraints. Any unclassified intersection marks only that lane `WAITING_DEPENDENCY`; continue the others.

### Task 2: Create isolated controller and worker worktrees

**Files:**

- Create through Git: `.worktrees/s2-user-bug-recovery-r-${S2_SHORT}/`
- Create through Git: `.worktrees/bug019-project-home-r-${S2_SHORT}/`
- Create through Git: `.worktrees/bug016-thinking-fallback-r-${S2_SHORT}/`
- Create later: `.worktrees/bug018-provider-errors-ui-r-${S2_SHORT}/`
- Create only after dependency: `.worktrees/bug032-studio-copy-r-${DONOR_SHORT}/`

**Interfaces:**

- Consumes: immutable `S2_BASE` and `S2_SHORT` from Task 1.
- Produces: clean isolated worktrees whose `HEAD` and merge-base both equal the recorded base.

- [ ] **Step 1: Read the worktree execution skill before creating directories**

Required sub-skill: `superpowers:using-git-worktrees`.

- [ ] **Step 2: Create the Controller, BUG-019, and BUG-016 worktrees in one shell**

Run:

```bash
S2_BASE="$(git rev-parse refs/codex/s2-user-bug-recovery-20260807/base)"
S2_SHORT="$(git rev-parse --short=9 "$S2_BASE")"
PLAN_ROOT=/Users/lap16603/Projects/WePrompt/docs/superpowers/plans
CONTROLLER_BRANCH="codex/s2-user-bug-recovery-r-$S2_SHORT"
BUG019_BRANCH="codex/bug019-project-home-r-$S2_SHORT"
BUG016_BRANCH="codex/bug016-thinking-fallback-r-$S2_SHORT"
CONTROLLER_WT=".worktrees/s2-user-bug-recovery-r-$S2_SHORT"
BUG019_WT=".worktrees/bug019-project-home-r-$S2_SHORT"
BUG016_WT=".worktrees/bug016-thinking-fallback-r-$S2_SHORT"

git worktree add -b "$CONTROLLER_BRANCH" "$CONTROLLER_WT" "$S2_BASE"
git worktree add -b "$BUG019_BRANCH" "$BUG019_WT" "$S2_BASE"
git worktree add -b "$BUG016_BRANCH" "$BUG016_WT" "$S2_BASE"

git config "branch.$CONTROLLER_BRANCH.codexBase" "$S2_BASE"
git config "branch.$BUG019_BRANCH.codexBase" "$S2_BASE"
git config "branch.$BUG016_BRANCH.codexBase" "$S2_BASE"
git config "branch.$BUG019_BRANCH.codexPlanPath" "$PLAN_ROOT/2026-08-07-bug019-project-home.md"
git config "branch.$BUG016_BRANCH.codexPlanPath" "$PLAN_ROOT/2026-08-07-bug016-thinking-fallback.md"
git config "branch.$BUG019_BRANCH.codexPlanSha256" \
  "$(shasum -a 256 "$PLAN_ROOT/2026-08-07-bug019-project-home.md" | awk '{print $1}')"
git config "branch.$BUG016_BRANCH.codexPlanSha256" \
  "$(shasum -a 256 "$PLAN_ROOT/2026-08-07-bug016-thinking-fallback.md" | awk '{print $1}')"
```

Expected: all three branches are new, all worktrees are clean, and branch-scoped metadata persists across shell and worker boundaries.

- [ ] **Step 3: Prove exact base identity and worker-plan availability**

Run:

```bash
S2_BASE="$(git rev-parse refs/codex/s2-user-bug-recovery-20260807/base)"
S2_SHORT="$(git rev-parse --short=9 "$S2_BASE")"
CONTROLLER_WT=".worktrees/s2-user-bug-recovery-r-$S2_SHORT"
BUG019_WT=".worktrees/bug019-project-home-r-$S2_SHORT"
BUG016_WT=".worktrees/bug016-thinking-fallback-r-$S2_SHORT"
for wt in \
  "$CONTROLLER_WT" \
  "$BUG019_WT" \
  "$BUG016_WT"; do
  git -C "$wt" status --short
  test "$(git -C "$wt" rev-parse HEAD)" = "$S2_BASE"
  test "$(git -C "$wt" merge-base HEAD "$S2_BASE")" = "$S2_BASE"
done

for wt in "$BUG019_WT" "$BUG016_WT"; do
  branch="$(git -C "$wt" branch --show-current)"
  plan_path="$(git config --get "branch.$branch.codexPlanPath")"
  plan_sha="$(git config --get "branch.$branch.codexPlanSha256")"
  test -f "$plan_path"
  test "$(shasum -a 256 "$plan_path" | awk '{print $1}')" = "$plan_sha"
done
```

Expected: no status output and every equality check exits 0.

### Task 3: Run the first two implementation lanes concurrently

**Files:**

- Follow: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug019-project-home.md`
- Follow: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug016-thinking-fallback.md`

**Interfaces:**

- Consumes: the two current-base worker worktrees.
- Produces: one focused/static-green candidate per lane, each waiting for the serialized full-suite token.

- [ ] **Step 1: Dispatch BUG-019**

Assign `S2-R1-BUG019-WORKER` only the BUG-019 worktree. Supply the absolute plan path and recorded SHA from branch metadata. Require the worker to run the plan's bootstrap guard, stop before the full suite, and report its branch, base, dirty paths, focused totals, and static-gate results.

- [ ] **Step 2: Dispatch BUG-016**

Assign `S2-R1-BUG016-WORKER` only the BUG-016 worktree. Supply the absolute plan path and recorded SHA from branch metadata. Require the worker to run the plan's bootstrap guard, stop before the full suite, and report its branch, base, dirty paths, focused totals, and static-gate results.

- [ ] **Step 3: Keep the Controller read-only while both workers edit**

Run only status checks from the Controller worktree. Do not edit either worker's files or run a broad suite concurrently.

### Task 4: Start BUG-018 after the first worker slot frees

**Files:**

- Follow: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug018-provider-chat-errors.md`

**Interfaces:**

- Consumes: the immutable Sprint base and one freed worker slot.
- Produces: either a focused/static-green chat-only candidate or an exact blocker handoff within the BUG-018 time box.

- [ ] **Step 1: Create the BUG-018 worktree from the same literal base**

Run:

```bash
CONTROLLER_BRANCH="$(git branch --show-current)"
S2_BASE="$(git config --get "branch.$CONTROLLER_BRANCH.codexBase")"
S2_SHORT="$(git rev-parse --short=9 "$S2_BASE")"
PLAN_PATH=/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug018-provider-chat-errors.md
BUG018_BRANCH="codex/bug018-provider-errors-ui-r-$S2_SHORT"
git worktree add -b "codex/bug018-provider-errors-ui-r-$S2_SHORT" ".worktrees/bug018-provider-errors-ui-r-$S2_SHORT" "$S2_BASE"
git config "branch.$BUG018_BRANCH.codexBase" "$S2_BASE"
git config "branch.$BUG018_BRANCH.codexPlanPath" "$PLAN_PATH"
git config "branch.$BUG018_BRANCH.codexPlanSha256" "$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')"
git -C ".worktrees/bug018-provider-errors-ui-r-$S2_SHORT" status --short
test "$(git -C ".worktrees/bug018-provider-errors-ui-r-$S2_SHORT" rev-parse HEAD)" = "$S2_BASE"
```

Expected: clean status and exact base equality.

- [ ] **Step 2: Dispatch the bounded plan**

Assign `S2-R1-BUG018-WP` only the BUG-018 worktree. Supply the absolute plan path and recorded SHA from branch metadata. Start a 90-minute contract/RED clock; after confirmed RED evidence, allow at most two implementation hours.

- [ ] **Step 3: Enforce the scope stop**

Stop BUG-018 immediately if its diff includes `providerApi.ts`, `storage.ts`, Model Settings, provider-health persistence, model eligibility, AionCore/AionRS, bundled backend files, or locale files still owned by Creative Studio.

### Task 5: Serialize full-suite gates and local commits

**Files:**

- Modify: only the candidate files listed in each bug plan.
- Create through Git: one atomic local commit per accepted implementation unit.

**Interfaces:**

- Consumes: focused/static-green worker handoffs.
- Produces: exact candidate heads that passed the full suite without concurrent broad jobs.

- [ ] **Step 1: Grant the full-suite token to one worker only**

Run in that candidate worktree:

```bash
bun run test
```

Expected: exit 0. Record passed/skipped totals and elapsed time.

- [ ] **Step 2: Inspect the exact candidate scope before staging**

Run:

```bash
git status --short
git diff --stat
git diff --check
git diff --name-only
```

Expected: only the plan-owned paths are present. Any extra tracked path is a scope stop.

- [ ] **Step 3: Stage exact paths and commit with the bug plan's Conventional Commit message**

Use only the explicit path list in the bug plan's `git add` command. Never use `git add -A`, `git add .`, or `git commit -am`.

- [ ] **Step 4: Freeze the exact candidate head**

Run:

```bash
git status --short
git rev-parse HEAD
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
test -n "$RECORDED_BASE"
test "$(git merge-base HEAD "$RECORDED_BASE")" = "$RECORDED_BASE"
git diff --name-status "$RECORDED_BASE"...HEAD
```

Expected: clean tracked status, merge-base equal to `RECORDED_BASE`, and only owned files in the diff.

- [ ] **Step 5: Repeat Steps 1–4 for the next focused/static-green worker**

Do not overlap `bun run test` across worktrees.

### Task 6: Obtain fresh exact-head reviews

**Files:**

- Modify: none in the reviewer context.

**Interfaces:**

- Consumes: literal base and head hashes for one frozen candidate.
- Produces: `ACCEPT` or `BLOCK` plus exact P0–P2 findings.

- [ ] **Step 1: Dispatch one read-only review**

Provide `S2-R1-REVIEWER` the absolute worktree, literal base, literal head, plan, changed paths, focused commands/results, static results, and full-suite totals.

- [ ] **Step 2: Require the reviewer to verify identity before reading the diff**

The Controller must supply literal `REVIEW_BASE` and `REVIEW_HEAD` environment values. The reviewer then runs:

```bash
test "$(git rev-parse HEAD)" = "$REVIEW_HEAD"
test "$(git merge-base "$REVIEW_BASE" HEAD)" = "$REVIEW_BASE"
git diff --name-status "$REVIEW_BASE"..."$REVIEW_HEAD"
```

Expected: both equality checks pass and the diff matches the worker's handoff.

- [ ] **Step 3: Handle an ACCEPT verdict**

Mark the candidate `READY_FOR_INTEGRATION`. Do not modify its branch after the verdict.

- [ ] **Step 4: Handle a BLOCK verdict**

Return only the exact findings to the owning worker. Permit one narrow correction cycle inside the original plan scope, rerun applicable focused/static/full gates, commit a follow-up, and re-review the new literal head. If the fix expands scope, mark the lane `PAUSED` and write a blocker handoff.

### Task 7: Resolve BUG-032 without concurrent locale edits

**Files:**

- Follow: `/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug032-studio-copy.md`

**Interfaces:**

- Consumes: an immutable accepted/frozen Creative Studio donor head or an integrated `origin/sprint2` containing it.
- Produces: either an accepted copy-only candidate or a `WAITING_DEPENDENCY` handoff.

- [ ] **Step 1: Recheck Creative Studio ownership after the other lanes stop**

Run the ownership commands from Task 1 again and record the current donor head.

- [ ] **Step 2: Select exactly one safe path**

If the Creative Studio owner will apply the copy, send that owner the BUG-032 plan and do not create a separate branch. Otherwise, create the BUG-032 branch from the owner's literal frozen head. If neither condition is true, leave BUG-032 `WAITING_DEPENDENCY`.

- [ ] **Step 3: Execute the BUG-032 plan only on the safe path**

Do not reconcile concurrent locale edits in this wave.

### Task 8: Reconcile Sprint 2 status once

**Files:**

- Modify: `TASKS.md`

**Interfaces:**

- Consumes: exact local branch/head/verdict evidence from every lane.
- Produces: one local Controller commit that accurately records integration-pending candidates and blockers.

- [ ] **Step 1: Refresh the remote ref and detect controller drift**

Run from the Controller worktree:

```bash
CONTROLLER_BRANCH="$(git branch --show-current)"
S2_BASE="$(git config --get "branch.$CONTROLLER_BRANCH.codexBase")"
test -n "$S2_BASE"
git fetch origin sprint2
git diff --name-only "$S2_BASE"...origin/sprint2 -- TASKS.md
```

Expected: no `TASKS.md` output. If it changed, stop and rebase/reconcile only after a new Controller decision; do not overwrite it.

- [ ] **Step 2: Update the existing entries without marking unintegrated work complete**

Record:

- EPIC-002: `Deferred — Foundation Partial`, with preserved accepted/blocked heads.
- Each locally accepted bug: `implementation accepted locally; integration pending`, plus branch and exact head.
- Each blocked bug: status, exact head, blocker, and resume condition.
- BUG-018: WePrompt chat slice status separately from full cross-repository BUG-018 closure.
- BUG-032: `WAITING_DEPENDENCY` if no immutable Creative Studio donor head was available.

- [ ] **Step 3: Verify the task diff**

Run:

```bash
bunx oxfmt --write TASKS.md
bunx oxfmt --check TASKS.md
git diff --check
git diff -- TASKS.md
```

Expected: only evidence/status text changes; no bug checkbox is closed before integration into `origin/sprint2`.

- [ ] **Step 4: Commit only the task file locally**

Run:

```bash
git add TASKS.md
git commit -m "docs(tasks): record user bug recovery candidates"
```

Expected: one local Controller commit. Do not push it.

### Task 9: Produce the autonomous-window handoff

**Files:**

- Modify: none.

**Interfaces:**

- Consumes: all worker, reviewer, test, and Controller evidence.
- Produces: a decision-ready report for the user.

- [ ] **Step 1: Confirm no broad job is still running**

Use the thread/process status tools available in the execution environment. Do not terminate unrelated processes.

- [ ] **Step 2: Report every lane in one table**

For each bug include: status, base, branch, exact head, changed paths, focused totals, full-suite totals, review verdict, blocker/resume condition, and whether integration is pending.

- [ ] **Step 3: State the boundaries explicitly**

Report that no push, merge request, merge, packaging, release, feature activation, AionCore/AionRS mutation, or EPIC-002 work occurred.

- [ ] **Step 4: Name the next admissible action**

The next action is a separate integration decision for each `READY_FOR_INTEGRATION` branch. Do not infer that authorization from completion of this plan.
