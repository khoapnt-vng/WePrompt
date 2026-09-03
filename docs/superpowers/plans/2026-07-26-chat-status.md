# Chat Status Indicators Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every conversation sidebar row an accurate status glyph, so that "the agent is blocked waiting on you" and "the run failed" are unmistakably different at a glance.

**Architecture:** All status logic moves into one pure module (`conversationStatus.ts`) with no IPC and no state, making it directly unit-testable. `useConversationListSync` keeps three timestamp maps instead of one, populated by routing the `turnCompleted` wire event through a pure classifier. `ConversationRow` switches on the resolved mark and renders one glyph per state, and stops replacing the chat name with a pill.

**Tech Stack:** React 18, TypeScript strict, `@arco-design/web-react`, `@icon-park/react`, UnoCSS + CSS Modules, Vitest 4 (dual node/jsdom projects), react-i18next.

**Spec:** `docs/superpowers/specs/2026-07-26-chat-status-design.md`

**Branch:** `feat/chat-status` (already created from `sprint1`)

---

## Background an implementer needs

Read this before Task 1. Three facts about the existing code are counterintuitive:

1. **`renderConversationStatus()` returns `null` for ordinary idle rows** (`ConversationRow.tsx:169`). The leading slot is an empty fixed-width box most of the time. The repeated agent logo has already largely been removed.

2. **`markRecentCompletion()` is a misnomer.** It fires *only* when `event.state === 'ai_waiting_input'` (`useConversationListSync.ts:375-377`) — meaning "the agent asked the user a question," not "the run finished." This plan repurposes that map and gives genuine completion its own trigger. Do not assume the existing name reflects the existing behavior.

3. **There is no `error` member on `TConversationRuntimeStateKind`.** Failure arrives only on the `turnCompleted` wire event's `state` field. We deliberately do not extend the runtime type — failure is a property of the last completed turn, not of live runtime.

Terminology: a "mark" is the resolved visual state (`idle`/`running`/`needs_you`/`done`/`failed`). "Wire state" is the raw `event.state` string from IPC.

### Commands you will need

```bash
bun run test                       # all tests, both projects
bunx vitest run <path>             # single file
bunx tsc --noEmit                  # typecheck
bun run lint:fix                   # oxlint autofix
bun run format                     # oxfmt
bun run i18n:types                 # regenerate i18n key types
node scripts/check-i18n.js         # validate locale parity
```

### Conventions that will fail review if missed

- Every new file starts with the license header shown in Task 1.
- Single quotes, trailing commas in multi-line literals (oxfmt).
- `type`, never `interface`. No `any`.
- No raw interactive HTML. Icons from `@icon-park/react`.
- Colors from `iconColors` in `@/renderer/styles/colors` — never hardcoded hex.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `GroupedHistory/utils/conversationStatus.ts` | **New.** Pure status logic: mark type, wire-state classifier, approval predicate, main resolver. No React, no IPC, no state. |
| `GroupedHistory/utils/conversationStatus.test.ts` | **New.** Node-project unit tests for the above. |
| `GroupedHistory/ConversationRow.module.css` | **New.** Pulse keyframes + reduced-motion guard. |
| `GroupedHistory/ConversationRow.tsx` | **Modify.** Switch on mark; delete the name-replacing `Tag`; import shared predicate. |
| `GroupedHistory/hooks/useConversationListSync.ts` | **Modify.** Three timestamp maps; route `turnCompleted`; clear on new turn; export failure-clear. |
| `GroupedHistory/types.ts` | **Modify.** Two new optional row props. |
| `GroupedHistory/index.tsx` | **Modify.** Thread new props; clear failure mark on row open. |
| `services/i18n/locales/*/conversation.json` | **Modify.** Three keys × 12 locales. |
| `tests/unit/conversation/ConversationRow.dom.test.tsx` | **New.** jsdom per-state render tests. |

`conversationRuntimeViewStore.ts` is **not** touched — it passes `pending_confirmations` through to a view model but does not derive the approval boolean, so it is not a duplication site.

Task order is dependency-driven: the pure module first (nothing depends on it yet, so it is safe and fully testable), then i18n and CSS (leaf assets), then the data layer, then the view, then view tests.

---

## Task 1: Pure status module

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.ts`
- Test: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.test.ts`

This task is pure TDD: the module has no dependencies beyond a type import, so tests run instantly and cover every branch.

- [ ] **Step 1: Write the failing test**

Create `packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { TConversationRuntimeSummary } from '@/common/config/storage';
import {
  COMPLETION_MARK_DURATION_MS,
  isConversationAwaitingApproval,
  resolveConversationStatusMark,
  resolveTurnCompletedMark,
} from '@/renderer/pages/conversation/GroupedHistory/utils/conversationStatus';

const NOW = 1_700_000_000_000;

const runtime = (overrides: Partial<TConversationRuntimeSummary> = {}): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: false,
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
  ...overrides,
});

const input = (overrides: Partial<Parameters<typeof resolveConversationStatusMark>[0]> = {}) => ({
  runtime: runtime(),
  isGenerating: false,
  now: NOW,
  ...overrides,
});

describe('isConversationAwaitingApproval', () => {
  it('is true when runtime state is waiting_confirmation', () => {
    expect(isConversationAwaitingApproval(runtime({ state: 'waiting_confirmation' }))).toBe(true);
  });

  it('is true when confirmations are pending even while running', () => {
    expect(isConversationAwaitingApproval(runtime({ state: 'running', pending_confirmations: 2 }))).toBe(true);
  });

  it('is false for an idle runtime', () => {
    expect(isConversationAwaitingApproval(runtime())).toBe(false);
  });

  it('is false when runtime is undefined', () => {
    expect(isConversationAwaitingApproval(undefined)).toBe(false);
  });
});

describe('resolveTurnCompletedMark', () => {
  it('maps ai_waiting_input to awaiting_input', () => {
    expect(resolveTurnCompletedMark('ai_waiting_input')).toBe('awaiting_input');
  });

  it('maps error to failed', () => {
    expect(resolveTurnCompletedMark('error')).toBe('failed');
  });

  it('maps stopped to completed', () => {
    expect(resolveTurnCompletedMark('stopped')).toBe('completed');
  });

  it('maps unknown to completed', () => {
    expect(resolveTurnCompletedMark('unknown')).toBe('completed');
  });

  it('returns null for states already represented by live runtime', () => {
    expect(resolveTurnCompletedMark('ai_waiting_confirmation')).toBeNull();
    expect(resolveTurnCompletedMark('ai_generating')).toBeNull();
    expect(resolveTurnCompletedMark('initializing')).toBeNull();
  });
});

describe('resolveConversationStatusMark', () => {
  it('returns idle for a resting conversation', () => {
    expect(resolveConversationStatusMark(input())).toBe('idle');
  });

  it('returns running while generating', () => {
    expect(resolveConversationStatusMark(input({ isGenerating: true }))).toBe('running');
  });

  it('returns running for starting, running and cancelling runtime states', () => {
    expect(resolveConversationStatusMark(input({ runtime: runtime({ state: 'starting' }) }))).toBe('running');
    expect(resolveConversationStatusMark(input({ runtime: runtime({ state: 'running' }) }))).toBe('running');
    expect(resolveConversationStatusMark(input({ runtime: runtime({ state: 'cancelling' }) }))).toBe('running');
  });

  it('returns needs_you when awaiting approval', () => {
    expect(resolveConversationStatusMark(input({ runtime: runtime({ state: 'waiting_confirmation' }) }))).toBe(
      'needs_you'
    );
  });

  it('returns needs_you when the agent asked a question', () => {
    expect(resolveConversationStatusMark(input({ awaitingInputAt: NOW - 5_000 }))).toBe('needs_you');
  });

  it('returns failed when a failure is recorded', () => {
    expect(resolveConversationStatusMark(input({ recentFailureAt: NOW - 5_000 }))).toBe('failed');
  });

  it('returns done inside the completion window', () => {
    expect(resolveConversationStatusMark(input({ recentCompletionAt: NOW - 1_000 }))).toBe('done');
  });

  // Priority: needs_you > failed > running > done > idle.
  it('prefers needs_you over failed', () => {
    expect(
      resolveConversationStatusMark(input({ awaitingInputAt: NOW, recentFailureAt: NOW }))
    ).toBe('needs_you');
  });

  it('prefers failed over running so a retry does not hide a prior failure', () => {
    expect(resolveConversationStatusMark(input({ recentFailureAt: NOW, isGenerating: true }))).toBe('failed');
  });

  it('prefers running over done', () => {
    expect(
      resolveConversationStatusMark(input({ isGenerating: true, recentCompletionAt: NOW - 1_000 }))
    ).toBe('running');
  });

  it('decays done to idle exactly at the window boundary', () => {
    expect(
      resolveConversationStatusMark(input({ recentCompletionAt: NOW - COMPLETION_MARK_DURATION_MS }))
    ).toBe('idle');
    expect(
      resolveConversationStatusMark(input({ recentCompletionAt: NOW - COMPLETION_MARK_DURATION_MS + 1 }))
    ).toBe('done');
  });

  it('treats a missing runtime as resting rather than throwing', () => {
    expect(resolveConversationStatusMark(input({ runtime: undefined }))).toBe('idle');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
bunx vitest run packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.test.ts
```

Expected: FAIL — `Failed to resolve import ".../conversationStatus"`. The module does not exist yet.

- [ ] **Step 3: Write the implementation**

Create `packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TConversationRuntimeSummary } from '@/common/config/storage';

/** How long a finished conversation keeps its completion mark before going quiet. */
export const COMPLETION_MARK_DURATION_MS = 60_000;

/** Resolved visual status for a sidebar row. */
export type TConversationStatusMark = 'idle' | 'running' | 'needs_you' | 'done' | 'failed';

/** The `state` field carried by IConversationTurnCompletedEvent. */
export type TTurnCompletedWireState =
  | 'ai_generating'
  | 'ai_waiting_input'
  | 'ai_waiting_confirmation'
  | 'initializing'
  | 'stopped'
  | 'error'
  | 'unknown';

/** Which timestamp map a turnCompleted event should populate, if any. */
export type TTurnCompletedMark = 'awaiting_input' | 'failed' | 'completed';

/**
 * Shared predicate for "the agent is blocked on a user confirmation".
 * Previously inlined in both ConversationRow and useConversationListSync.
 */
export const isConversationAwaitingApproval = (runtime?: TConversationRuntimeSummary): boolean =>
  runtime?.state === 'waiting_confirmation' || (runtime?.pending_confirmations ?? 0) > 0;

/**
 * Classify a completed turn.
 *
 * Returns null for states that live runtime already represents, so we never
 * write a stale `done` timestamp that would surface once the live state clears.
 *
 * Anything not explicitly listed falls through to `completed`: it is not yet
 * confirmed which wire state a cleanly-finished turn reports, so the safe
 * default is "this turn ended" rather than "ignore it".
 */
export const resolveTurnCompletedMark = (state: TTurnCompletedWireState): TTurnCompletedMark | null => {
  switch (state) {
    case 'ai_waiting_input':
      return 'awaiting_input';
    case 'error':
      return 'failed';
    case 'ai_waiting_confirmation':
    case 'ai_generating':
    case 'initializing':
      return null;
    default:
      return 'completed';
  }
};

export type TConversationStatusInput = {
  runtime?: TConversationRuntimeSummary;
  isGenerating: boolean;
  awaitingInputAt?: number;
  recentFailureAt?: number;
  recentCompletionAt?: number;
  /** Injected so the decay boundary is testable without fake timers. */
  now: number;
};

/**
 * Resolve the single mark for a row. First match wins.
 *
 * needs_you outranks everything because it is the only state that blocks the
 * user. failed outranks running so an in-flight retry does not conceal the
 * failure that prompted it until the new turn actually streams.
 */
export const resolveConversationStatusMark = (input: TConversationStatusInput): TConversationStatusMark => {
  const { runtime, isGenerating, awaitingInputAt, recentFailureAt, recentCompletionAt, now } = input;

  if (isConversationAwaitingApproval(runtime) || awaitingInputAt !== undefined) {
    return 'needs_you';
  }

  if (recentFailureAt !== undefined) {
    return 'failed';
  }

  if (isGenerating || runtime?.state === 'starting' || runtime?.state === 'running' || runtime?.state === 'cancelling') {
    return 'running';
  }

  if (recentCompletionAt !== undefined && now - recentCompletionAt < COMPLETION_MARK_DURATION_MS) {
    return 'done';
  }

  return 'idle';
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
bunx vitest run packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.test.ts
```

Expected: PASS, 21 tests.

- [ ] **Step 5: Typecheck and format**

```bash
bunx tsc --noEmit && bun run format && bun run lint:fix
```

Expected: no type errors. If `tsc` complains that `TConversationRuntimeSummary` is not exported from `@/common/config/storage`, confirm the export name with `grep -n "TConversationRuntimeSummary" packages/desktop/src/common/config/storage.ts` and fix the import path rather than widening the type.

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.ts \
        packages/desktop/src/renderer/pages/conversation/GroupedHistory/utils/conversationStatus.test.ts
git commit -m "feat(conversation): add pure conversation status derivation"
```

---

## Task 2: i18n keys

**Files:**
- Modify: `packages/desktop/src/renderer/services/i18n/locales/<locale>/conversation.json` (12 locales)

The `status` object currently contains only `waitingApproval`. Add three siblings. `waitingApproval` is reused verbatim for the `needs_you` mark, so no existing translation is invalidated.

- [ ] **Step 1: Add the three keys to every locale**

In each file, locate the `"status"` object and add `running`, `done`, `failed` alongside the existing `waitingApproval`. For example, `en-US/conversation.json` becomes:

```json
  "status": {
    "waitingApproval": "Awaiting approval",
    "running": "Working",
    "done": "Finished",
    "failed": "Failed"
  }
```

Use these values:

| Locale | `running` | `done` | `failed` |
| --- | --- | --- | --- |
| `en-US` | Working | Finished | Failed |
| `de-DE` | Arbeitet | Fertig | Fehlgeschlagen |
| `es-ES` | Trabajando | Finalizado | Fallido |
| `fa-IR` | در حال کار | پایان یافت | ناموفق |
| `ja-JP` | 実行中 | 完了 | 失敗 |
| `ko-KR` | 작업 중 | 완료 | 실패 |
| `pt-BR` | Trabalhando | Concluído | Falhou |
| `ru-RU` | Работает | Завершено | Ошибка |
| `tr-TR` | Çalışıyor | Tamamlandı | Başarısız |
| `uk-UA` | Працює | Завершено | Помилка |
| `zh-CN` | 处理中 | 已完成 | 失败 |
| `zh-TW` | 處理中 | 已完成 | 失敗 |

`fa-IR` is right-to-left; the values above are the correct RTL strings and need no directional markup — the app handles direction at the layout level.

- [ ] **Step 2: Regenerate types and validate parity**

```bash
bun run i18n:types && node scripts/check-i18n.js
```

Expected: `check-i18n.js` reports no missing keys. If it reports a locale missing one of the three, that file was skipped — add it.

- [ ] **Step 3: Verify the generated key type includes the new keys**

```bash
grep -rn "conversation.status.failed" packages/desktop/src/renderer/services/i18n/ | head
```

Expected: at least one hit in the generated types file. This confirms Task 5's `t('conversation.status.failed')` will typecheck.

- [ ] **Step 4: Commit**

```bash
git add packages/desktop/src/renderer/services/i18n/
git commit -m "chore(i18n): add conversation status keys across all locales"
```

---

## Task 3: Pulse stylesheet

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.module.css`

Only the `needs_you` badge animates, and never simultaneously with the spinner (`needs_you` outranks `running`). The animation is opacity-only — no transform, so it cannot cause layout work.

- [ ] **Step 1: Create the stylesheet**

```css
/**
 * Status mark animation for conversation sidebar rows.
 * Only the "needs you" badge pulses; motion signals a live-but-blocked agent.
 */

.statusPulse {
  animation: conversation-status-pulse 2s ease-in-out infinite;
}

@keyframes conversation-status-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.55;
  }
}

@media (prefers-reduced-motion: reduce) {
  .statusPulse {
    animation: none;
    opacity: 1;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.module.css
git commit -m "style(conversation): add status mark pulse animation"
```

---

## Task 4: Timestamp maps in the sync hook

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts`

This is the only task with real behavioral risk, because the module holds singleton state. The logic being added is deliberately thin — all decisions were already extracted into `resolveTurnCompletedMark` and tested in Task 1, so this task is wiring only.

Read the existing `markRecentCompletion` / `clearRecentCompletionState` pair (around lines 256-274) first. Every new helper copies that exact shape: rebuild the `Map`, reassign the module-level `let`, call `emitStoreChange()`.

- [ ] **Step 1: Import the shared helpers**

Add to the existing import block at the top of the file:

```ts
import {
  isConversationAwaitingApproval,
  resolveTurnCompletedMark,
} from '@/renderer/pages/conversation/GroupedHistory/utils/conversationStatus';
```

- [ ] **Step 2: Extend the snapshot type and module state**

Change the snapshot type (currently around line 96):

```ts
type ConversationListSyncSnapshot = {
  conversations: TChatConversation[];
  generatingConversationIds: Set<string>;
  recentCompletionAtByConversationId: Map<string, number>;
  awaitingInputAtByConversationId: Map<string, number>;
  recentFailureAtByConversationId: Map<string, number>;
};
```

Add two module-level `let`s next to `recentCompletionAtByConversationIdState`:

```ts
let awaitingInputAtByConversationIdState = new Map<string, number>();
let recentFailureAtByConversationIdState = new Map<string, number>();
```

Add both to the initial `snapshotState` literal **and** to `emitStoreChange`, so the two stay in sync:

```ts
const emitStoreChange = () => {
  snapshotState = {
    conversations: conversationsState,
    generatingConversationIds: generatingConversationIdsState,
    recentCompletionAtByConversationId: recentCompletionAtByConversationIdState,
    awaitingInputAtByConversationId: awaitingInputAtByConversationIdState,
    recentFailureAtByConversationId: recentFailureAtByConversationIdState,
  };
  listeners.forEach((listener) => listener());
};
```

- [ ] **Step 3: Add the four mark/clear helpers**

Place these directly after the existing `clearRecentCompletionState`:

```ts
const markAwaitingInput = (conversation_id: string) => {
  awaitingInputAtByConversationIdState = new Map(awaitingInputAtByConversationIdState).set(conversation_id, Date.now());
  emitStoreChange();
};

const clearAwaitingInput = (conversation_id: string) => {
  if (!awaitingInputAtByConversationIdState.has(conversation_id)) {
    return;
  }

  const next = new Map(awaitingInputAtByConversationIdState);
  next.delete(conversation_id);
  awaitingInputAtByConversationIdState = next;
  emitStoreChange();
};

const markRecentFailure = (conversation_id: string) => {
  recentFailureAtByConversationIdState = new Map(recentFailureAtByConversationIdState).set(conversation_id, Date.now());
  emitStoreChange();
};

const clearRecentFailure = (conversation_id: string) => {
  if (!recentFailureAtByConversationIdState.has(conversation_id)) {
    return;
  }

  const next = new Map(recentFailureAtByConversationIdState);
  next.delete(conversation_id);
  recentFailureAtByConversationIdState = next;
  emitStoreChange();
};
```

- [ ] **Step 4: Clear all three marks when a new turn starts**

Replace the existing `markGenerating` (around line 190) with:

```ts
const markGenerating = (conversation_id: string) => {
  // A new turn invalidates every terminal mark from the previous one. These run
  // before the early return so a re-entrant call still clears stale marks.
  clearAwaitingInput(conversation_id);
  clearRecentFailure(conversation_id);
  clearRecentCompletionState(conversation_id);

  if (generatingConversationIdsState.has(conversation_id)) {
    return;
  }

  generatingConversationIdsState = new Set(generatingConversationIdsState).add(conversation_id);
  emitStoreChange();
};
```

The ordering matters and is the reason for the comment: putting the clears after the early return would leave a stale `failed` glyph on a row that is already generating.

- [ ] **Step 5: Route the turnCompleted event**

Replace the existing handler (around line 372):

```ts
  ipcBridge.conversation.turnCompleted.on((event) => {
    advanceConversationRuntimeRequest(event.session_id);
    applyConversationRuntime(event.session_id, event.runtime);

    const completedMark = resolveTurnCompletedMark(event.state);
    if (completedMark === 'awaiting_input') {
      markAwaitingInput(event.session_id);
    } else if (completedMark === 'failed') {
      markRecentFailure(event.session_id);
    } else if (completedMark === 'completed') {
      markRecentCompletion(event.session_id);
    }

    markCompleted(event.session_id);
    clearGenerating(event.session_id);
    refreshConversations();
  });
```

Note what changed: previously `markRecentCompletion` fired on `ai_waiting_input`. That trigger now routes to `markAwaitingInput`, and `markRecentCompletion` gains the genuine-completion case it never had.

- [ ] **Step 6: Deduplicate the approval predicate**

Replace lines 335-337 (the inlined `wasWaitingApproval`):

```ts
    const wasWaitingApproval = isConversationAwaitingApproval(conversation?.runtime);
```

- [ ] **Step 7: Export a public failure clear**

Add near the other exported module functions:

```ts
/** Clears the failure glyph once the user has actually looked at the conversation. */
export const clearConversationFailureMark = (conversation_id: string) => {
  clearRecentFailure(conversation_id);
};
```

- [ ] **Step 8: Expose the two new getters from the hook**

Update the `useSyncExternalStore` destructure and add getters mirroring the existing `getRecentCompletionAt`:

```ts
  const {
    conversations,
    generatingConversationIds,
    recentCompletionAtByConversationId,
    awaitingInputAtByConversationId,
    recentFailureAtByConversationId,
  } = useSyncExternalStore(
    subscribeConversationListSync,
    getConversationListSyncSnapshot,
    getConversationListSyncSnapshot
  );
```

```ts
  const getAwaitingInputAt = useCallback(
    (conversation_id: string) => {
      return awaitingInputAtByConversationId.get(conversation_id);
    },
    [awaitingInputAtByConversationId]
  );

  const getRecentFailureAt = useCallback(
    (conversation_id: string) => {
      return recentFailureAtByConversationId.get(conversation_id);
    },
    [recentFailureAtByConversationId]
  );
```

And add both to the returned object:

```ts
  return {
    conversations,
    isConversationGenerating,
    getRecentCompletionAt,
    getAwaitingInputAt,
    getRecentFailureAt,
    refreshConversationRuntime,
  };
```

- [ ] **Step 9: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: no errors. A "property does not exist on type" error here almost always means the snapshot type, the initial `snapshotState` literal, and `emitStoreChange` have drifted apart — all three must list the same five fields.

- [ ] **Step 10: Run the full suite to confirm nothing regressed**

```bash
bun run test
```

Expected: PASS. No existing test covers this file, so this step is guarding against import cycles and typecheck-invisible breakage elsewhere.

- [ ] **Step 11: Format, lint, commit**

```bash
bun run format && bun run lint:fix
git add packages/desktop/src/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync.ts
git commit -m "feat(conversation): track awaiting-input and failure marks separately"
```

---

## Task 5: Row props and threading

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/types.ts:46-67`
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx:209-232`

- [ ] **Step 1: Add the two props to `ConversationRowProps`**

In `types.ts`, immediately after the existing `recentCompletionAt?: number;`:

```ts
  recentCompletionAt?: number;
  /** Set when the agent finished a turn by asking the user a question. */
  awaitingInputAt?: number;
  /** Set when the agent's last turn ended in an error. Cleared when the user opens the chat. */
  recentFailureAt?: number;
```

- [ ] **Step 2: Consume the new getters in `index.tsx`**

Find where `getRecentCompletionAt` is destructured from `useConversationListSync` and add the two new getters alongside it:

```ts
  const {
    conversations,
    isConversationGenerating,
    getRecentCompletionAt,
    getAwaitingInputAt,
    getRecentFailureAt,
    refreshConversationRuntime,
  } = useConversationListSync();
```

If the existing destructure omits some of these names, keep whatever it already lists and add only `getAwaitingInputAt` and `getRecentFailureAt`.

- [ ] **Step 3: Add the failure-clearing click wrapper**

Add above `getConversationRowProps` (around line 209):

```ts
  // Opening a conversation counts as acknowledging its failure, so the glyph
  // stops shouting. Wrapped here rather than inside the click hook to keep the
  // sidebar's status bookkeeping in one place.
  const handleConversationClickWithStatusReset = useCallback(
    (conversation: TChatConversation) => {
      clearConversationFailureMark(conversation.id);
      handleConversationClick(conversation);
    },
    [handleConversationClick]
  );
```

Import the function:

```ts
import { clearConversationFailureMark } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
```

If `useConversationListSync` is already imported in this file, add `clearConversationFailureMark` to that existing import rather than adding a second statement.

- [ ] **Step 4: Thread the props**

In `getConversationRowProps`, change the completion line and the click handler:

```ts
      recentCompletionAt: getRecentCompletionAt(conversation.id),
      awaitingInputAt: getAwaitingInputAt(conversation.id),
      recentFailureAt: getRecentFailureAt(conversation.id),
```

```ts
      onConversationClick: handleConversationClickWithStatusReset,
```

Add `getAwaitingInputAt`, `getRecentFailureAt`, and `handleConversationClickWithStatusReset` to the `useCallback` dependency array, and remove `handleConversationClick` from it if it is no longer referenced directly.

- [ ] **Step 5: Typecheck**

```bash
bunx tsc --noEmit
```

Expected: no errors. An exhaustive-deps lint warning on the `useCallback` means a dependency was missed — fix it rather than suppressing.

- [ ] **Step 6: Commit**

```bash
bun run format && bun run lint:fix
git add packages/desktop/src/renderer/pages/conversation/GroupedHistory/types.ts \
        packages/desktop/src/renderer/pages/conversation/GroupedHistory/index.tsx
git commit -m "feat(conversation): thread status marks into sidebar rows"
```

---

## Task 6: Render one glyph per state

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx`

This task deletes the name-replacing pill, which is the user-visible bug fix. Task 7 adds the regression test that keeps it deleted.

- [ ] **Step 1: Update imports**

Remove `Tag` from the Arco import (it becomes unused):

```ts
import { Checkbox, Dropdown, Menu, Spin, Tooltip } from '@arco-design/web-react';
```

Add the two new icons to the icon-park import, keeping alphabetical order:

```ts
import { Attention, CheckOne, CloseOne, DeleteOne, EditOne, Export, MessageOne, MoreOne, Pushpin, Robot } from '@icon-park/react';
```

Add the module stylesheet and the status helpers:

```ts
import styles from './ConversationRow.module.css';
import {
  COMPLETION_MARK_DURATION_MS,
  resolveConversationStatusMark,
  type TConversationStatusMark,
} from './utils/conversationStatus';
```

- [ ] **Step 2: Delete the local constant now owned by the util**

Remove line 24:

```ts
const COMPLETION_MARK_DURATION_MS = 60_000;
```

It is now imported from `conversationStatus.ts`, so there is a single definition.

- [ ] **Step 3: Add the label lookup**

Add at module scope, below the imports:

```ts
/** i18n key per non-idle mark. `needs_you` reuses the pre-existing approval string. */
const STATUS_LABEL_KEY: Record<Exclude<TConversationStatusMark, 'idle'>, string> = {
  needs_you: 'conversation.status.waitingApproval',
  running: 'conversation.status.running',
  done: 'conversation.status.done',
  failed: 'conversation.status.failed',
};
```

- [ ] **Step 4: Replace the derivation block**

Delete the `isWaitingApproval` assignment (lines 60-61) and the `showRecentCompletion` line (line 74). Keep the `completionExpiresAt`, `expiredCompletionAt` state and the decay `useEffect` exactly as they are — they are what forces a re-render when the window lapses.

Then, after the existing `useEffect`, add:

```ts
  // The decay effect above is what re-renders us at expiry; gating the timestamp
  // here means the resolver never has to be re-invoked on a timer.
  const completionStillFresh = completionExpiresAt > Date.now() && expiredCompletionAt !== completionExpiresAt;

  const statusMark = resolveConversationStatusMark({
    runtime: conversation.runtime,
    isGenerating,
    awaitingInputAt,
    recentFailureAt,
    recentCompletionAt: completionStillFresh ? recentCompletionAt : undefined,
    now: Date.now(),
  });

  const statusLabel = statusMark === 'idle' ? null : t(STATUS_LABEL_KEY[statusMark]);
```

Add `awaitingInputAt` and `recentFailureAt` to the props destructure at the top of the component, next to `recentCompletionAt`.

- [ ] **Step 5: Show status in the tooltip for every non-idle state**

Replace the `rowTooltipContent` block (lines 63-71). Previously this only showed a status line when collapsed *and* awaiting approval:

```ts
  const rowTooltipContent = statusLabel ? (
    <div className='flex flex-col gap-2px'>
      <span className='font-500'>{conversationName}</span>
      <span className='text-12px opacity-80'>{statusLabel}</span>
    </div>
  ) : (
    conversationName
  );
```

- [ ] **Step 6: Rewrite `renderConversationStatus`**

Replace the whole function (lines 131-170):

```ts
  const renderConversationStatus = () => {
    // Scheduled chats keep their dedicated job indicator, and batch mode keeps
    // the agent icon next to the checkbox.
    if (cronStatus !== 'none' || batchMode) {
      return renderLeadingIcon();
    }

    if (statusMark === 'idle') {
      return null;
    }

    const statusClass = classNames('conversation-status-mark flex-center', pinnedHoverFade);
    const commonProps = {
      'aria-label': `${conversationName} ${statusLabel ?? ''}`.trim(),
      'data-testid': `conversation-status-${statusMark}-${conversation.id}`,
      className: statusClass,
    };

    if (statusMark === 'needs_you') {
      return (
        <span {...commonProps}>
          <Attention
            theme='filled'
            size='16'
            fill={iconColors.brand}
            className={classNames('line-height-0 flex-shrink-0', styles.statusPulse)}
          />
        </span>
      );
    }

    if (statusMark === 'failed') {
      return (
        <span {...commonProps}>
          <CloseOne theme='filled' size='16' fill={iconColors.danger} className='line-height-0 flex-shrink-0' />
        </span>
      );
    }

    if (statusMark === 'running') {
      return (
        <span {...commonProps}>
          <Spin size={16} />
        </span>
      );
    }

    return (
      <span {...commonProps}>
        <CheckOne theme='filled' size='16' fill={iconColors.success} className='line-height-0 flex-shrink-0' />
      </span>
    );
  };
```

- [ ] **Step 7: Delete the name-replacing pill**

Replace the `Tooltip` children block (lines 242-258) so the name always renders:

```tsx
            <div className='chat-history__item-name overflow-hidden text-ellipsis block w-full text-14px font-[500] lh-24px whitespace-nowrap min-w-0 text-t-primary'>
              <span className='block overflow-hidden text-ellipsis whitespace-nowrap'>{conversation.name}</span>
            </div>
```

- [ ] **Step 8: Simplify the selected-row background**

In the root `classNames` call, replace:

```ts
            '!bg-fill-3': selected && (collapsed || !isWaitingApproval),
```

with:

```ts
            '!bg-fill-3': selected,
```

That condition existed only to compensate for the pill, which no longer exists.

- [ ] **Step 9: Typecheck and confirm no dead references**

```bash
bunx tsc --noEmit && grep -n "isWaitingApproval\|showRecentCompletion\|Tag" packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx
```

Expected: no type errors, and the `grep` returns nothing. Any hit is a leftover from a step above.

- [ ] **Step 10: Run the suite, format, commit**

```bash
bun run test && bun run format && bun run lint:fix
git add packages/desktop/src/renderer/pages/conversation/GroupedHistory/ConversationRow.tsx
git commit -m "feat(conversation): render distinct status glyph per chat state"
```

---

## Task 7: Row render tests

**Files:**
- Create: `tests/unit/conversation/ConversationRow.dom.test.tsx`

`vitest.config.ts` matches jsdom tests only under `tests/unit/**/*.dom.test.tsx`, so this cannot be colocated with the component. `ConversationRow` pulls in agent logos, preset assistant info, layout context and cron indicators, none of which are relevant here — mock them all so the test isolates status rendering.

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConfigProvider } from '@arco-design/web-react';
import type { TChatConversation, TConversationRuntimeSummary } from '@/common/config/storage';
import type { ConversationRowProps } from '@/renderer/pages/conversation/GroupedHistory/types';
import ConversationRow from '@/renderer/pages/conversation/GroupedHistory/ConversationRow';

// Vitest hoists vi.mock above the imports, so the static import of
// ConversationRow above still receives these mocked dependencies.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/utils/model/agentLogo', () => ({
  useAgentLogos: () => ({}),
}));

vi.mock('@/renderer/hooks/agent/usePresetAssistantInfo', () => ({
  usePresetAssistantInfo: () => ({ info: undefined }),
}));

vi.mock('@/renderer/hooks/context/LayoutContext', () => ({
  useLayoutContext: () => ({ isMobile: false }),
}));

vi.mock('@/renderer/pages/cron', () => ({
  CronJobIndicator: () => <span data-testid='cron-indicator' />,
}));

const runtime = (overrides: Partial<TConversationRuntimeSummary> = {}): TConversationRuntimeSummary => ({
  state: 'idle',
  can_send_message: true,
  has_task: false,
  is_processing: false,
  pending_confirmations: 0,
  turn_id: null,
  ...overrides,
});

const conversation = (overrides: Partial<TChatConversation> = {}) =>
  ({
    id: 'chat-1',
    name: 'Reconciling AR ledger',
    runtime: runtime(),
    ...overrides,
  }) as TChatConversation;

const props = (overrides: Partial<ConversationRowProps> = {}): ConversationRowProps =>
  ({
    conversation: conversation(),
    isGenerating: false,
    collapsed: false,
    tooltipEnabled: false,
    batchMode: false,
    checked: false,
    selected: false,
    menuVisible: false,
    onToggleChecked: vi.fn(),
    onConversationClick: vi.fn(),
    onOpenMenu: vi.fn(),
    onMenuVisibleChange: vi.fn(),
    onEditStart: vi.fn(),
    onDelete: vi.fn(),
    onTogglePin: vi.fn(),
    getJobStatus: () => 'none',
    ...overrides,
  }) as ConversationRowProps;

const renderRow = (overrides: Partial<ConversationRowProps> = {}) =>
  render(
    <ConfigProvider>
      <ConversationRow {...props(overrides)} />
    </ConfigProvider>
  );

describe('ConversationRow status marks', () => {
  it('renders no status glyph when idle', () => {
    renderRow();
    expect(screen.queryByTestId(/^conversation-status-/)).toBeNull();
  });

  it('renders the running glyph while generating', () => {
    renderRow({ isGenerating: true });
    expect(screen.getByTestId('conversation-status-running-chat-1')).toBeInTheDocument();
  });

  it('renders the needs_you glyph when awaiting approval', () => {
    renderRow({ conversation: conversation({ runtime: runtime({ state: 'waiting_confirmation' }) }) });
    expect(screen.getByTestId('conversation-status-needs_you-chat-1')).toBeInTheDocument();
  });

  it('renders the failed glyph when the last turn errored', () => {
    renderRow({ recentFailureAt: Date.now() });
    expect(screen.getByTestId('conversation-status-failed-chat-1')).toBeInTheDocument();
  });

  it('renders the done glyph inside the completion window', () => {
    renderRow({ recentCompletionAt: Date.now() });
    expect(screen.getByTestId('conversation-status-done-chat-1')).toBeInTheDocument();
  });

  // Regression guard: awaiting-approval used to replace the name with a pill,
  // making it impossible to tell which chat was blocked.
  it('keeps the chat name visible while awaiting approval', () => {
    renderRow({ conversation: conversation({ runtime: runtime({ state: 'waiting_confirmation' }) }) });
    expect(screen.getByText('Reconciling AR ledger')).toBeInTheDocument();
  });

  it('keeps the chat name visible in every status', () => {
    renderRow({ recentFailureAt: Date.now() });
    expect(screen.getByText('Reconciling AR ledger')).toBeInTheDocument();
  });

  it('shows the cron indicator instead of a status mark for scheduled chats', () => {
    renderRow({ getJobStatus: () => 'active', isGenerating: true });
    expect(screen.getByTestId('cron-indicator')).toBeInTheDocument();
    expect(screen.queryByTestId(/^conversation-status-/)).toBeNull();
  });

  it('shows no status mark in batch mode', () => {
    renderRow({ batchMode: true, isGenerating: true });
    expect(screen.queryByTestId(/^conversation-status-/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test**

```bash
bunx vitest run tests/unit/conversation/ConversationRow.dom.test.tsx
```

Expected: PASS, 9 tests. Task 6 already implemented the behavior, so these should pass immediately — they are regression guards, not drivers.

If a test fails with a module-resolution or context error, the cause is a dependency of `ConversationRow` that is not yet mocked. Read the error's import trail and add a `vi.mock` for that module in the block above; do not change the component to make the test pass.

- [ ] **Step 3: Commit**

```bash
bun run format && bun run lint:fix
git add tests/unit/conversation/ConversationRow.dom.test.tsx
git commit -m "test(conversation): cover status glyph rendering per state"
```

---

## Task 8: Full verification

**Files:** none — this task only runs checks.

Do not skip this and do not report success from partial output. Paste actual command output when reporting.

- [ ] **Step 1: Run the whole gate**

```bash
bun run lint:fix && bun run format && bunx tsc --noEmit && bun run test
```

Expected: exit 0. Per `AGENTS.md`, the project has many pre-existing lint *warnings* that do not indicate failure — judge by exit code, not output volume.

- [ ] **Step 2: Validate i18n**

```bash
bun run i18n:types && node scripts/check-i18n.js
```

Expected: no missing keys across all 12 locales.

- [ ] **Step 3: Confirm the working tree is clean**

```bash
git status
```

Expected: clean. If `i18n:types` regenerated a file, commit it:

```bash
git add -A && git commit -m "chore(i18n): regenerate conversation status key types"
```

- [ ] **Step 4: Manual check in the running app**

Launch the app and confirm each state visually. The two that cannot be verified by tests are the pulse animation and the color distinction:

1. Start a chat that triggers a tool permission prompt → row shows a **brand-colored pulsing `!`**, and the chat name is still readable.
2. Let a chat finish → row shows a **green check** that disappears after 60 seconds.
3. Confirm a failed run shows a **red `×`** distinct from the approval badge, and that opening the chat clears it.
4. Toggle OS "reduce motion" and confirm the badge stops pulsing but stays fully opaque.

Report what you actually observed. If a state cannot be reproduced, say so explicitly rather than assuming it works.

- [ ] **Step 5: Do not push**

Per `AGENTS.md`, agents must not push unless explicitly asked. Stop here and report. When the user does ask, use `just push` — never `git push`.

---

## Self-review notes

**Spec coverage.** Every spec section maps to a task: state model → Task 1; event plumbing → Task 4; visual vocabulary → Tasks 3 and 6; row rendering changes → Task 6; accessibility → Task 6 (labels, testids) and Task 3 (reduced motion); i18n → Task 2; testing → Tasks 1 and 7. The spec's "verify which wire state a finished turn reports" step is handled structurally instead — `resolveTurnCompletedMark` defaults to `completed`, so it is correct without needing the answer, and Task 8 Step 4.2 observes it in practice.

**Deferred deliberately.** The spec listed sync-hook tests. They are not in this plan: `useConversationListSync` is a module-level singleton with IPC subscriptions, so testing it requires either mocking `ipcBridge` and accepting order-dependent state, or a refactor beyond this change's scope. All the *decisions* in that file were extracted into `resolveTurnCompletedMark` and `isConversationAwaitingApproval` and are fully covered by Task 1; what remains in Task 4 is map bookkeeping. This is a real coverage gap and is called out rather than hidden.

**Known risk.** Task 4 Step 4 changes `markGenerating`, which is on the hot path for every streaming message. The clears are `Map.has` guarded and return early when there is nothing to clear, so the steady-state cost is three failed lookups per call. Worth watching if sidebar performance regresses.
