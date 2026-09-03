# BUG-019 Project Home Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a user creates a project, open that project's Home page instead of immediately opening a new chat.

**Architecture:** Keep creation, refresh, and modal-close behavior unchanged. Change only the parent completion callback to reuse the existing encoded Project Home route builder; retain the existing `/guid` helper for explicit **New chat** actions.

**Tech Stack:** React, React Router, TypeScript, Vitest 4, React Testing Library.

## Global Constraints

- Execute only in the Controller-created `codex/bug019-project-home-r-${S2_SHORT}` worktree at the recorded `S2_BASE`.
- Owned source path: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx`.
- Owned test path: `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx`.
- Do not change `ProjectCreateModal`, route registration, storage, IPC, locale files, or explicit project **New chat** behavior.
- Preserve all unrelated tracked and untracked files.
- Stop before push, merge request, merge, packaging, release, or `TASKS.md` reconciliation.

### Worker bootstrap guard

Before reading or editing source, run:

```bash
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
PLAN_PATH="$(git config --get "branch.$BRANCH.codexPlanPath")"
PLAN_SHA="$(git config --get "branch.$BRANCH.codexPlanSha256")"
test -n "$RECORDED_BASE"
test "$(git rev-parse HEAD)" = "$RECORDED_BASE"
test -z "$(git status --porcelain)"
test "$PLAN_PATH" = "/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug019-project-home.md"
test "$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')" = "$PLAN_SHA"
```

Expected: every check exits 0. This branch-scoped metadata is the durable Controller handoff; do not rely on shell variables from another task.

---

### Task 1: Add the project-creation navigation regression

**Files:**

- Modify: `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx:9-15`
- Modify: `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx:102-104`
- Modify: `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx:194-201`
- Modify: `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx:234-241`

**Interfaces:**

- Consumes: `ProjectCreateModalProps.onCreated(project: ForgeProject)` and the existing `navigateMock`.
- Produces: a regression proving creation opens the encoded Home route while explicit **New chat** still opens `/guid`.

- [ ] **Step 1: Add a hoisted creation harness**

Change the testing-library import to include `act`, then add this beside `conversationsHarness`:

```typescript
const projectCreateHarness = vi.hoisted(() => ({
  onCreated: undefined as ((project: ForgeProject) => void) | undefined,
  refreshProjects: vi.fn(),
}));
```

- [ ] **Step 2: Replace the modal with a callback-capturing test double**

Add this mock before importing `WorkspaceGroupedHistory`:

```typescript
vi.mock('@/renderer/pages/conversation/projects/ProjectCreateModal', () => ({
  ProjectCreateModal: ({ onCreated }: { onCreated: (project: ForgeProject) => void }) => {
    projectCreateHarness.onCreated = onCreated;
    return null;
  },
}));
```

- [ ] **Step 3: Reuse the stable refresh spy**

Change the `useProjects` mock to:

```typescript
vi.mock('@/renderer/pages/conversation/projects/useProjects', () => ({
  useProjects: () => ({ projects: [project], refreshProjects: projectCreateHarness.refreshProjects }),
}));
```

Reset both harness fields in `beforeEach`:

```typescript
projectCreateHarness.onCreated = undefined;
projectCreateHarness.refreshProjects.mockReset();
```

- [ ] **Step 4: Add the failing creation-completion test**

Add this test beside the existing navigation tests:

```typescript
it('opens the encoded Project Home route after project creation completes', () => {
  renderSidebar();

  act(() => {
    projectCreateHarness.onCreated?.({
      ...project,
      id: 'created/project',
      name: 'Created Project',
      workspace: '/w/created',
    });
  });

  expect(projectCreateHarness.refreshProjects).toHaveBeenCalledOnce();
  expect(navigateMock).toHaveBeenCalledExactlyOnceWith('/project/created%2Fproject');
});
```

- [ ] **Step 5: Run the new test and verify RED**

Run:

```bash
bunx vitest run tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx -t "opens the encoded Project Home route after project creation completes"
```

Expected: FAIL because the current callback calls `navigate('/guid', { state: ... })`.

### Task 2: Route only creation completion to Project Home

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:15-17`
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:559-563`
- Test: `tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx`

**Interfaces:**

- Consumes: `buildProjectHomePath(projectId: string): string` from `projectNavigation.ts`.
- Produces: an encoded Home navigation call from project creation; the existing `navigateToProjectChat(workspace, projectId)` remains available to explicit **New chat** actions.

- [ ] **Step 1: Import the existing route builder**

Replace the project-navigation import with:

```typescript
import {
  buildProjectHomePath,
  resolveProjectClickTarget,
} from '@/renderer/pages/conversation/projects/projectNavigation';
```

- [ ] **Step 2: Change only the successful creation callback**

Use this callback:

```typescript
onCreated={(project) => {
  refreshProjects();
  setProjectCreateVisible(false);
  void navigate(buildProjectHomePath(project.id));
}}
```

Do not change either call to `navigateToProjectChat` used by project **New chat** actions.

- [ ] **Step 3: Run the focused navigation matrix**

Run:

```bash
bunx vitest run \
  tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx \
  tests/unit/renderer/projects/ProjectCreateModal.dom.test.tsx \
  tests/unit/pages/conversation/projects/projectNavigation.test.ts
```

Expected: all tests pass, including both the new creation test and the existing `/guid` New-chat regression.

- [ ] **Step 4: Format and statically verify the exact files**

Run:

```bash
bunx oxfmt --write \
  packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx \
  tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx
bunx oxfmt --check \
  packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx \
  tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx
bunx oxlint \
  packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx \
  tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx
bunx tsc --noEmit
bun run i18n:types
node scripts/check-i18n.js
git diff --check
```

Expected: every command exits 0. `i18n:types` must not create an unrelated generated diff.

- [ ] **Step 5: Hand the focused/static-green candidate to the Controller**

Report branch, literal base, current dirty paths, focused totals, and static results. Wait for the serialized full-suite token.

- [ ] **Step 6: Run the full suite when authorized by the Controller**

Run:

```bash
bun run test
```

Expected: exit 0. Record passed/skipped totals.

- [ ] **Step 7: Stage exactly two files and commit**

Run:

```bash
git add \
  packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx \
  tests/unit/renderer/sidebarProjectRowActions.dom.test.tsx
git diff --cached --check
git commit -m "fix(conversation): open project home after creation"
```

Expected: one atomic commit and clean tracked status.

- [ ] **Step 8: Freeze the exact head for review**

Run:

```bash
git status --short
git rev-parse HEAD
BRANCH="$(git branch --show-current)"
RECORDED_BASE="$(git config --get "branch.$BRANCH.codexBase")"
test -n "$RECORDED_BASE"
test "$(git merge-base "$RECORDED_BASE" HEAD)" = "$RECORDED_BASE"
git diff --name-status "$RECORDED_BASE"...HEAD
```

Expected: only the two owned files differ from `RECORDED_BASE`. Do not modify the branch after reporting the head.
