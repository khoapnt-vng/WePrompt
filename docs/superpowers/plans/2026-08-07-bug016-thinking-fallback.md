# BUG-016 Subjectless Thinking Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep thinking activity visible when its subject is missing or unsafe, without exposing raw reasoning or changing the turn recap.

**Architecture:** Continue treating provider narration as untrusted. Every thinking message becomes a display-only journal row using either its sanitized subject or the existing localized running/completed fallback; every thinking row is excluded before `buildTurnWorkRecap`, while plan narration and tools retain their current recap behavior.

**Tech Stack:** React, TypeScript strict mode, Vitest 4, React Testing Library, i18next.

## Global Constraints

- Execute only in the Controller-created `codex/bug016-thinking-fallback-r-${S2_SHORT}` worktree at the recorded `S2_BASE`.
- Owned source path: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx`.
- Owned test path: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`.
- Do not modify `MessageList`, `buildTurnWorkRecap`, `buildTurnClose`, persistence, or locale files.
- Use only existing `conversation.thinking.label` and `conversation.thinking.complete` keys.
- Never render `message.content.content`; never weaken `getSafeProviderNarration`.
- Preserve the stale `codex/bug016-thinking-fallback@5bc32216d` branch unchanged.
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
test "$PLAN_PATH" = "/Users/lap16603/Projects/WePrompt/docs/superpowers/plans/2026-08-07-bug016-thinking-fallback.md"
test "$(shasum -a 256 "$PLAN_PATH" | awk '{print $1}')" = "$PLAN_SHA"
```

Expected: every check exits 0. This branch-scoped metadata is the durable Controller handoff; do not rely on shell variables from another task.

---

### Task 1: Prove display fallback and raw-content safety

**Files:**

- Modify: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx:463-487`
- Modify: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx:688-744`

**Interfaces:**

- Consumes: a `WorkJournalSourceMessage` with `type: 'thinking'`, optional `subject`, private `content`, and `status: 'thinking' | 'done'`.
- Produces: DOM regressions for running fallback, completed fallback, unsafe-subject fallback, and raw-content absence.

- [ ] **Step 1: Add reusable message factories at module scope**

Place both factories after the imports and before the first `describe`, so every sibling test block can use them:

```typescript
const thinkingStep = (
  id: string,
  subject: string | undefined,
  status: 'thinking' | 'done',
  raw = 'RAW_THINKING_SENTINEL'
): WorkJournalSourceMessage =>
  ({
    id,
    conversation_id: 'conv-1',
    type: 'thinking',
    position: 'left',
    content: { subject, content: raw, status },
  }) as WorkJournalSourceMessage;

const toolGroupStep = (id: string, statuses: Array<'Success' | 'Error'>): WorkJournalSourceMessage =>
  ({
    id,
    conversation_id: 'conv-1',
    type: 'tool_group',
    position: 'left',
    content: statuses.map((status, index) => ({
      call_id: `${id}-${index}`,
      name: 'ExecCommand',
      status,
    })),
  }) as WorkJournalSourceMessage;
```

- [ ] **Step 2: Add the active subjectless regression**

```typescript
it('shows the localized running fallback for active subjectless thinking', () => {
  render(<MessageToolGroupSummary isActive messages={[thinkingStep('thinking-running', undefined, 'thinking')]} />);

  expect(screen.getByText('conversation.thinking.label')).toBeVisible();
  expect(document.body).not.toHaveTextContent('RAW_THINKING_SENTINEL');
});
```

- [ ] **Step 3: Add the completed subjectless regression**

```typescript
it('keeps completed subjectless thinking in Technical Details', () => {
  render(<MessageToolGroupSummary messages={[thinkingStep('thinking-done', undefined, 'done')]} />);

  expect(screen.queryByText('conversation.thinking.complete')).not.toBeInTheDocument();
  expect(within(expandTechnicalDetails()).getByText('conversation.thinking.complete')).toBeVisible();
  expect(document.body).not.toHaveTextContent('RAW_THINKING_SENTINEL');
});
```

- [ ] **Step 4: Strengthen the unsafe-subject test with a positive fallback assertion**

Render command-, path-, and diagnostic-shaped subjects as active thinking rows and add:

```typescript
expect(screen.getByText('conversation.thinking.label')).toBeVisible();
expect(document.body).not.toHaveTextContent('RAW_THINKING_SENTINEL');
expect(document.querySelector('[title*="RAW_THINKING_SENTINEL"]')).toBeNull();
expect(document.querySelector('[aria-label*="RAW_THINKING_SENTINEL"]')).toBeNull();
expect(document.querySelector('[aria-description*="RAW_THINKING_SENTINEL"]')).toBeNull();
```

- [ ] **Step 5: Prove consecutive thinking events remain distinct rows**

```typescript
it('keeps consecutive subjectless thinking messages as separate detail rows', () => {
  render(
    <MessageToolGroupSummary
      messages={[
        thinkingStep('thinking-one', undefined, 'done'),
        thinkingStep('thinking-two', undefined, 'done'),
      ]}
    />
  );

  expect(within(expandTechnicalDetails()).getAllByText('conversation.thinking.complete')).toHaveLength(2);
});
```

- [ ] **Step 6: Run the display tests and verify RED**

Run:

```bash
bunx vitest run --project dom tests/unit/chat/MessageToolGroupSummary.dom.test.tsx -t "thinking"
```

Expected: the new positive fallback assertions and consecutive-row test fail because the current component drops subjectless and unsafe thinking rows.

### Task 2: Prove thinking cannot alter recap/close semantics

**Files:**

- Modify: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx:1529-1620`

**Interfaces:**

- Consumes: mixed tool and thinking rows.
- Produces: regressions proving that safe and fallback thinking are display-only and never contribute recap attempts, completion counts, failures, or safe subjects.

- [ ] **Step 1: Add the failed-turn invariant**

```typescript
it('keeps a failed tool turn failed when safe-subject thinking is present', () => {
  render(
    <MessageToolGroupSummary
      messages={[
        toolGroupStep('failed-tool', ['Error']),
        thinkingStep('safe-thinking', 'Reviewing the failed operation', 'done'),
      ]}
    />
  );

  expect(screen.getByText(/wasn't able to finish|didn't go through/i)).toHaveClass('text-warning');
  expect(screen.queryByText(/got most of this done|Good progress/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Add the single-tool invariant**

```typescript
it('keeps one successful tool trivial when thinking is present', () => {
  render(
    <MessageToolGroupSummary
      messages={[
        toolGroupStep('single-tool', ['Success']),
        thinkingStep('safe-thinking', 'Reviewing the successful operation', 'done'),
      ]}
    />
  );

  expect(screen.queryByText(/done|finished|came together/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 3: Add the multi-tool invariant**

```typescript
it('keeps the completed close for multiple successful tools when thinking is present', () => {
  render(
    <MessageToolGroupSummary
      messages={[
        toolGroupStep('multi-tool', ['Success', 'Success']),
        thinkingStep('safe-thinking', 'Reviewing the completed operations', 'done'),
      ]}
    />
  );

  expect(screen.getByText(/done|finished|came together/i)).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the recap tests and verify RED**

Run:

```bash
bunx vitest run --project dom tests/unit/chat/MessageToolGroupSummary.dom.test.tsx -t "when thinking is present"
```

Expected: the failed-turn and single-tool tests fail because current safe thinking is mapped into `buildTurnWorkRecap` as generic completed work. The multi-tool case pins the unchanged successful-close behavior.

### Task 3: Always create a display-only thinking row

**Files:**

- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:32-47`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:145-219`
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx:469-498`

**Interfaces:**

- Consumes: sanitized optional narration plus localized plan/thinking fallbacks.
- Produces: `JournalRow` narration records with an explicit `includeInRecap` discriminator.

- [ ] **Step 1: Add the recap discriminator to narration rows**

Use this narration variant:

```typescript
type JournalRow =
  | {
      key: string;
      kind: 'narration';
      label: string;
      status: NormalizedToolStatus;
      includeInRecap: boolean;
      isFallback?: boolean;
      collapseDuplicateFallback?: boolean;
      fallbackDoneLabel?: string;
    }
  | { key: string; kind: 'tool'; step: CoalescedStep; status: NormalizedToolStatus };
```

- [ ] **Step 2: Pass separate plan and thinking fallbacks**

Change `buildJournalRows` to accept:

```typescript
fallback: {
  plan: {
    running: string;
    done: string;
  }
  thinking: {
    running: string;
    done: string;
  }
}
```

Plan rows use `fallback.plan`, set `includeInRecap: true`, set `collapseDuplicateFallback: narration === undefined`, and otherwise retain their existing behavior.

- [ ] **Step 3: Always push one thinking row without reading raw content**

Replace the current conditional thinking block with:

```typescript
const status = message.content.status === 'done' ? 'completed' : 'running';
const subject = getSafeProviderNarration(message.content.subject);
pushNarration({
  key: `thinking-${message.id}`,
  kind: 'narration',
  label: subject ?? (status === 'completed' ? fallback.thinking.done : fallback.thinking.running),
  status,
  includeInRecap: false,
  isFallback: subject === undefined,
  fallbackDoneLabel: subject === undefined ? fallback.thinking.done : undefined,
});
```

Do not reference `message.content.content` anywhere in this block.

- [ ] **Step 4: Restrict duplicate-fallback collapse to plan rows**

Change `pushNarration` so it collapses a row only when both the current and previous narration rows set `collapseDuplicateFallback: true`. Thinking rows omit that flag, so two source thinking messages always remain two journal rows even when both use the same localized fallback.

- [ ] **Step 5: Supply existing localized thinking fallbacks**

Use:

```typescript
buildJournalRows(messages, {
  plan: {
    running: t('messages.toolActivity.generic.running'),
    done: t('messages.toolActivity.generic.done'),
  },
  thinking: {
    running: t('conversation.thinking.label'),
    done: t('conversation.thinking.complete'),
  },
});
```

- [ ] **Step 6: Exclude every thinking row before recap construction**

Change the recap input to:

```typescript
rows
  .filter((row) => row.kind === 'tool' || row.includeInRecap)
  .map((row) =>
    row.kind === 'tool'
      ? {
          category: row.step.action.category,
          status: row.status,
          attempts: row.step.attempts,
          hadError: row.step.hadError,
        }
      : {
          category: 'generic',
          status: row.status,
          safeSubject: row.isFallback ? undefined : row.label,
        }
  );
```

- [ ] **Step 7: Run the focused component and grouping matrix**

Run:

```bash
bunx vitest run --project dom \
  tests/unit/chat/MessageToolGroupSummary.dom.test.tsx \
  tests/unit/renderer/messageList.dom.test.tsx
```

Expected: all tests pass. Existing safe-subject, command/path filter, source-order, and disclosure tests remain green.

- [ ] **Step 8: Format and statically verify the exact files**

Run:

```bash
bunx oxfmt --write \
  packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx \
  tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
bunx oxfmt --check \
  packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx \
  tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
bunx oxlint \
  packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx \
  tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
bunx tsc --noEmit
bun run i18n:types
node scripts/check-i18n.js
git diff --check
```

Expected: every command exits 0 and no locale/generated-file diff remains.

- [ ] **Step 9: Hand the focused/static-green candidate to the Controller**

Report branch, literal base, dirty paths, focused totals, and static results. Wait for the serialized full-suite token.

- [ ] **Step 10: Run the full suite when authorized**

Run:

```bash
bun run test
```

Expected: exit 0. Record passed/skipped totals.

- [ ] **Step 11: Stage exactly two files and commit**

Run:

```bash
git add \
  packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx \
  tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
git diff --cached --check
git commit -m "fix(conversation): show subjectless thinking activity"
```

Expected: one atomic commit and clean tracked status.

- [ ] **Step 12: Freeze the exact head for review**

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
