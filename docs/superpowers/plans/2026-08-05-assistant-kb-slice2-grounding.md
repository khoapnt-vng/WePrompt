# Assistant KB Slice 2 — Grounding Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface whether an office artifact was actually grounded in the assistant's knowledge base, and withhold automatic delivery when the assistant declares its KB authoritative but nothing was consulted.

**Architecture:** A pure renderer-side evaluator derives a four-state verdict from the `tool_call` messages the renderer already holds, scoped by `turn_id`. The verdict renders as a distinct artifact completion state. When the assistant's local binding is flagged authoritative and the verdict is `none`, the renderer withholds auto-delivery and offers an explicit *deliver anyway* action whose use is recorded. `OfficeArtifactService` is untouched — main keeps answering "is this file valid," the renderer answers "is this artifact grounded."

**Tech Stack:** TypeScript (strict, `strictNullChecks` off), React, Arco Design, Vitest 4, i18next.

**Design of record:** `docs/design/assistant-knowledge-base-design.md` — *Slice 2 — Grounding evidence*.

**Prerequisite:** Slice 1 Units A–C merged. This plan extends Slice 1's binding record and reuses its `KnowledgeCitationTarget` and frozen-descriptor scope resolution.

## Why this is small

The evidence already exists: `messages` rows carry `type='tool_call'` with content
`{call_id, name, status, input, output}`, plus a `turn_id` column. No new instrumentation, no
schema change, no backend migration. The work is one pure function, one binding field, one
checkbox, and one completion-state surface.

## The trap this plan exists to avoid

`messages` has `hidden INTEGER NOT NULL DEFAULT 0`, and this project uses a visible/hidden
dual-persist model — compacted messages are **hidden, not deleted**. An evaluator that reads only
visible messages will report `none` for a genuinely grounded artifact after any compaction. Task 1
tests this explicitly; treat a failure there as a release blocker, not a nicety.

---

### Task 0: Branch and confirm the prerequisite

- [ ] **Step 1: Branch from a base that already contains Slice 1**

```bash
git fetch origin && git checkout -b feat/assistant-kb-grounding origin/sprint2
bun install
```

- [ ] **Step 2: Verify Slice 1 landed and the baseline is green**

```bash
ls packages/desktop/src/common/knowledge/assistantKbBinding.ts packages/desktop/src/common/knowledge/scope.ts
bun run test 2>&1 | tail -5
```

Expected: both files exist (Slice 1 Unit A) and tests pass. If the binding module is missing, stop — this plan has nothing to extend.

- [ ] **Step 3: Confirm the tool-call message shape in the running app's data**

```bash
sqlite3 ~/.aionui/aionui-backend.db "SELECT DISTINCT je.key FROM messages m, json_each(m.content) je WHERE m.type='tool_call' LIMIT 10;"
sqlite3 ~/.aionui/aionui-backend.db "SELECT COUNT(*) FROM pragma_table_info('messages') WHERE name IN ('turn_id','hidden');"
```

Expected: keys include `call_id`, `name`, `status`, `output`; the second query returns `2`. If `turn_id` or `hidden` is absent on the target build, stop and re-verify the design's feasibility claim before writing code.

---

### Task 1: The pure grounding evaluator

**Files:**
- Create: `packages/desktop/src/common/knowledge/grounding.ts`
- Create: `packages/desktop/src/common/knowledge/grounding.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { evaluateGrounding, type GroundingMessage } from './grounding';

const scopes = [{ kind: 'assistant' as const, id: 'a1' }];

const kbCall = (overrides: Partial<GroundingMessage> = {}): GroundingMessage => ({
  type: 'tool_call',
  turnId: 't2',
  hidden: false,
  name: 'search_assistant_knowledge',
  status: 'finish',
  output: '[1] standard.docx — Scope\nThe business case must state…',
  ...overrides,
});

describe('evaluateGrounding', () => {
  it('reports grounded_turn when a successful KB search shares the artifact turn', () => {
    const verdict = evaluateGrounding({ messages: [kbCall()], artifactTurnId: 't2', sessionScopes: scopes });
    expect(verdict.kind).toBe('grounded_turn');
  });

  it('reports grounded_earlier with the turn distance when evidence predates the artifact turn', () => {
    const messages = [kbCall({ turnId: 't1' })];
    const verdict = evaluateGrounding({ messages, artifactTurnId: 't3', sessionScopes: scopes, turnOrder: ['t1', 't2', 't3'] });
    expect(verdict).toMatchObject({ kind: 'grounded_earlier', turnsAgo: 2 });
  });

  // THE COMPACTION TRAP: compacted messages are hidden, not deleted.
  it('counts hidden (compacted) evidence', () => {
    const verdict = evaluateGrounding({ messages: [kbCall({ hidden: true })], artifactTurnId: 't2', sessionScopes: scopes });
    expect(verdict.kind).toBe('grounded_turn');
  });

  it('reports not_applicable when the conversation has no KB scopes attached', () => {
    expect(evaluateGrounding({ messages: [], artifactTurnId: 't2', sessionScopes: [] }).kind).toBe('not_applicable');
  });

  it('reports none when scopes exist but nothing was consulted', () => {
    expect(evaluateGrounding({ messages: [], artifactTurnId: 't2', sessionScopes: scopes }).kind).toBe('none');
  });

  it('excludes errored searches and empty-result searches', () => {
    const errored = kbCall({ status: 'error' });
    const empty = kbCall({ output: 'No relevant passages found in the project knowledge base for "x".' });
    expect(evaluateGrounding({ messages: [errored, empty], artifactTurnId: 't2', sessionScopes: scopes }).kind).toBe('none');
  });

  it('counts the whole-document read tool as grounding', () => {
    const read = kbCall({ name: 'read_assistant_knowledge_source', output: '{"text":"The business case must…"}' });
    expect(evaluateGrounding({ messages: [read], artifactTurnId: 't2', sessionScopes: scopes }).kind).toBe('grounded_turn');
  });

  it('ignores non-KB tool calls', () => {
    const write = kbCall({ name: 'Write', output: 'wrote file' });
    expect(evaluateGrounding({ messages: [write], artifactTurnId: 't2', sessionScopes: scopes }).kind).toBe('none');
  });

  it('prefers same-turn evidence over earlier evidence', () => {
    const messages = [kbCall({ turnId: 't1' }), kbCall({ turnId: 't2' })];
    const verdict = evaluateGrounding({ messages, artifactTurnId: 't2', sessionScopes: scopes, turnOrder: ['t1', 't2'] });
    expect(verdict.kind).toBe('grounded_turn');
  });

  it('reports the cited source file names', () => {
    const verdict = evaluateGrounding({ messages: [kbCall()], artifactTurnId: 't2', sessionScopes: scopes });
    expect(verdict.kind === 'grounded_turn' && verdict.sources.map((s) => s.fileName)).toContain('standard.docx');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run packages/desktop/src/common/knowledge/grounding.test.ts`
Expected: FAIL — cannot resolve `./grounding`.

- [ ] **Step 3: Implement**

```typescript
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { parseCitationHeader } from './citationFormat';
import type { KnowledgeCitationTarget } from './types';
import type { KnowledgeScope } from './scope';

/** The subset of a persisted message this evaluator needs. */
export type GroundingMessage = {
  type: string;
  turnId: string | null;
  /** Compacted messages are hidden, not deleted — they still count as evidence. */
  hidden: boolean;
  name?: string;
  status?: string;
  output?: string;
};

export type GroundingVerdict =
  | { kind: 'grounded_turn'; sources: KnowledgeCitationTarget[] }
  | { kind: 'grounded_earlier'; sources: KnowledgeCitationTarget[]; turnsAgo: number }
  | { kind: 'none' }
  | { kind: 'not_applicable' };

/** Every tool whose successful use constitutes grounding. A full read is stronger than a search. */
const KB_TOOLS: ReadonlySet<string> = new Set([
  'search_project_knowledge',
  'search_assistant_knowledge',
  'read_assistant_knowledge_source',
]);

/** searchCore's empty-result sentence. A search that found nothing is not grounding. */
const EMPTY_RESULT_MARKER = 'No relevant passages found';

const isEvidence = (message: GroundingMessage): boolean =>
  message.type === 'tool_call' &&
  Boolean(message.name && KB_TOOLS.has(message.name)) &&
  message.status !== 'error' &&
  message.status !== 'pending' &&
  Boolean(message.output) &&
  !message.output!.includes(EMPTY_RESULT_MARKER);

/**
 * Best-effort source extraction for display. Citation headers are the documented
 * output format; anything unparseable is simply omitted rather than guessed at.
 */
const sourcesOf = (messages: GroundingMessage[]): KnowledgeCitationTarget[] => {
  const seen = new Map<string, KnowledgeCitationTarget>();
  for (const message of messages) {
    for (const line of (message.output ?? '').split('\n')) {
      const parsed = parseCitationHeader(line);
      if (parsed && !seen.has(parsed.fileName)) {
        seen.set(parsed.fileName, parsed as unknown as KnowledgeCitationTarget);
      }
    }
  }
  return [...seen.values()];
};

/**
 * Two-tier verdict. Same-turn evidence is the strong signal; earlier evidence in the
 * same conversation is reported separately rather than collapsed, because the common
 * pattern (retrieve a standard, then generate after feedback) spans turns and must not
 * read as a failure. Reads hidden messages so compaction cannot erase evidence.
 */
export function evaluateGrounding(params: {
  messages: GroundingMessage[];
  artifactTurnId: string | null;
  sessionScopes: KnowledgeScope[];
  /** Turn ids oldest-first, used only to compute distance. */
  turnOrder?: string[];
}): GroundingVerdict {
  const { messages, artifactTurnId, sessionScopes, turnOrder } = params;
  if (sessionScopes.length === 0) return { kind: 'not_applicable' };

  const evidence = messages.filter(isEvidence);
  if (evidence.length === 0) return { kind: 'none' };

  const sameTurn = evidence.filter((message) => message.turnId === artifactTurnId);
  if (sameTurn.length > 0) return { kind: 'grounded_turn', sources: sourcesOf(sameTurn) };

  const order = turnOrder ?? [];
  const artifactIndex = order.indexOf(artifactTurnId ?? '');
  const distances = evidence
    .map((message) => order.indexOf(message.turnId ?? ''))
    .filter((index) => index >= 0 && artifactIndex >= 0)
    .map((index) => artifactIndex - index)
    .filter((distance) => distance > 0);

  return {
    kind: 'grounded_earlier',
    sources: sourcesOf(evidence),
    turnsAgo: distances.length > 0 ? Math.min(...distances) : 1,
  };
}
```

If `parseCitationHeader` is not exported from `citationFormat.ts`, export the existing internal parser rather than writing a second one — a duplicate would drift from the format Slice 1's carrier produces.

- [ ] **Step 4: Run to verify it passes**

```bash
bunx vitest run packages/desktop/src/common/knowledge/grounding.test.ts
bunx tsc --noEmit
```

Expected: 10 passed, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/knowledge/grounding.*
git commit -m "feat(knowledge): pure grounding evidence evaluator"
```

---

### Task 2: The authoritative flag on the binding

**Files:**
- Modify: `packages/desktop/src/common/knowledge/assistantKbBinding.ts`
- Modify: `packages/desktop/src/common/knowledge/assistantKbBinding.test.ts`

- [ ] **Step 1: Write the failing tests** (append)

```typescript
describe('authoritative flag', () => {
  it('defaults to false when absent and round-trips when set', async () => {
    await setBindingState('a1', 'enabled');
    expect(readBindings().a1.authoritative).toBeFalsy();
    await setAuthoritative('a1', true);
    expect(readBindings().a1.authoritative).toBe(true);
  });

  it('preserves the lifecycle state when toggling authoritative', async () => {
    await setBindingState('a1', 'enabled');
    await setAuthoritative('a1', true);
    expect(readBindings().a1.state).toBe('enabled');
  });

  it('rolls back on a failed persist', async () => {
    await setBindingState('a1', 'enabled');
    set.mockRejectedValueOnce(new Error('backend down'));
    await expect(setAuthoritative('a1', true)).rejects.toThrow('backend down');
    expect(readBindings().a1.authoritative).toBeFalsy();
  });

  it('drops a non-boolean authoritative value rather than trusting it', () => {
    expect(validateBindings({ a1: { state: 'enabled', authoritative: 'yes' } })).toEqual({
      a1: { state: 'enabled' },
    });
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Extend the type to `{ state: AssistantKbState; authoritative?: boolean }`. In `validateBindings`, copy `authoritative` only when `typeof value.authoritative === 'boolean'`. Add `setAuthoritative(assistantId, value)` using the same snapshot-write-restore transaction as `setBindingState`, preserving the existing `state`.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run packages/desktop/src/common/knowledge/assistantKbBinding.test.ts
git add packages/desktop/src/common/knowledge/assistantKbBinding.*
git commit -m "feat(knowledge): authoritative flag on the assistant KB binding"
```

---

### Task 3: The requirement checkbox in `KnowledgeSection`

**Files:**
- Modify: `packages/desktop/src/renderer/pages/settings/AssistantSettings/editor/KnowledgeSection.tsx`
- Modify: `tests/unit/assistants/KnowledgeSection.dom.test.tsx`

- [ ] **Step 1: Write the failing tests** (append)

```tsx
describe('grounding requirement', () => {
  it('offers the requirement checkbox only when the KB is enabled', () => {
    bindings.a1 = { state: 'disabled' };
    const { rerender } = render(<KnowledgeSection assistantId='a1' source='user' />);
    expect(screen.queryByTestId('knowledge-require-grounding')).toBeNull();
    bindings.a1 = { state: 'enabled' };
    rerender(<KnowledgeSection assistantId='a1' source='user' />);
    expect(screen.getByTestId('knowledge-require-grounding')).toBeTruthy();
  });

  it('persists the flag through setAuthoritative', async () => {
    bindings.a1 = { state: 'enabled' };
    render(<KnowledgeSection assistantId='a1' source='user' />);
    await userEvent.click(screen.getByTestId('knowledge-require-grounding'));
    expect(setAuthoritative).toHaveBeenCalledWith('a1', true);
  });

  it('leaves the checkbox unchecked when persistence fails', async () => {
    bindings.a1 = { state: 'enabled' };
    setAuthoritative.mockRejectedValueOnce(new Error('backend down'));
    render(<KnowledgeSection assistantId='a1' source='user' />);
    await userEvent.click(screen.getByTestId('knowledge-require-grounding'));
    expect(screen.getByTestId('knowledge-require-grounding')).not.toBeChecked();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

Add an Arco `Checkbox` with `data-testid='knowledge-require-grounding'`, rendered only when the
binding state is `enabled`, labelled from i18n
(`settings.assistantKnowledge.requireGrounding`) with helper copy explaining that documents will not
be delivered automatically without a knowledge consultation. On change call `setAuthoritative`; on
rejection leave the control unchanged (the transactional helper guarantees the binding did not move).

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run tests/unit/assistants/KnowledgeSection.dom.test.tsx
git commit -am "feat(assistants): require-grounding option in the knowledge section"
```

---

### Task 4: Grounding state on the artifact completion surface

**Files:**
- Create: `packages/desktop/src/renderer/components/knowledge/GroundingState.tsx`
- Create: `tests/unit/renderer/knowledge/GroundingState.dom.test.tsx`
- Modify: `packages/desktop/src/renderer/components/knowledge/index.ts`

- [ ] **Step 1: Write the failing test**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import GroundingState from '@/renderer/components/knowledge/GroundingState';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const source = { scope: { kind: 'assistant' as const, id: 'a1' }, sourceId: 's1', fileName: 'standard.docx' };

describe('GroundingState', () => {
  it('shows the grounded-this-turn state with source names', () => {
    render(<GroundingState verdict={{ kind: 'grounded_turn', sources: [source] }} authoritative onDeliverAnyway={vi.fn()} />);
    expect(screen.getByText('conversation.grounding.groundedTurn')).toBeTruthy();
    expect(screen.getByText('standard.docx')).toBeTruthy();
  });

  it('distinguishes grounded-earlier', () => {
    render(<GroundingState verdict={{ kind: 'grounded_earlier', sources: [source], turnsAgo: 3 }} authoritative onDeliverAnyway={vi.fn()} />);
    expect(screen.getByText('conversation.grounding.groundedEarlier')).toBeTruthy();
  });

  it('renders nothing for not_applicable — absence of a KB is not a defect', () => {
    const { container } = render(<GroundingState verdict={{ kind: 'not_applicable' }} authoritative={false} onDeliverAnyway={vi.fn()} />);
    expect(container.textContent).toBe('');
  });

  it('reports without an action when none but not authoritative', () => {
    render(<GroundingState verdict={{ kind: 'none' }} authoritative={false} onDeliverAnyway={vi.fn()} />);
    expect(screen.getByText('conversation.grounding.none')).toBeTruthy();
    expect(screen.queryByText('conversation.grounding.deliverAnyway')).toBeNull();
  });

  it('offers deliver-anyway when none and authoritative', async () => {
    const onDeliverAnyway = vi.fn();
    render(<GroundingState verdict={{ kind: 'none' }} authoritative onDeliverAnyway={onDeliverAnyway} />);
    expect(screen.getByText('conversation.grounding.withheld')).toBeTruthy();
    await userEvent.click(screen.getByText('conversation.grounding.deliverAnyway'));
    expect(onDeliverAnyway).toHaveBeenCalledOnce();
  });

  it('shows the override once used and offers it no longer', () => {
    render(<GroundingState verdict={{ kind: 'none' }} authoritative overridden onDeliverAnyway={vi.fn()} />);
    expect(screen.getByText('conversation.grounding.overridden')).toBeTruthy();
    expect(screen.queryByText('conversation.grounding.deliverAnyway')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */
import { Button, Tag } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { GroundingVerdict } from '@/common/knowledge/grounding';

const K = 'conversation.grounding';

/**
 * One distinct completion state, never folded into a generic success line. A
 * conversation with no knowledge base renders nothing at all: absence of a KB is
 * not a defect and must not read as one.
 */
const GroundingState: React.FC<{
  verdict: GroundingVerdict;
  authoritative: boolean;
  overridden?: boolean;
  onDeliverAnyway: () => void;
}> = ({ verdict, authoritative, overridden, onDeliverAnyway }) => {
  const { t } = useTranslation();
  if (verdict.kind === 'not_applicable') return null;

  if (verdict.kind === 'grounded_turn' || verdict.kind === 'grounded_earlier') {
    const key = verdict.kind === 'grounded_turn' ? 'groundedTurn' : 'groundedEarlier';
    return (
      <div data-testid='grounding-state' className='flex flex-wrap items-center gap-8px text-12px'>
        <Tag size='small' color='green'>
          {t(`${K}.${key}`)}
        </Tag>
        {verdict.sources.map((source) => (
          <span key={source.sourceId} className='text-t-secondary'>
            {source.fileName}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div data-testid='grounding-state' className='flex flex-wrap items-center gap-8px text-12px'>
      <Tag size='small'>{t(authoritative ? `${K}.withheld` : `${K}.none`)}</Tag>
      {overridden && <span className='text-t-secondary'>{t(`${K}.overridden`)}</span>}
      {authoritative && !overridden && (
        <Button size='mini' onClick={onDeliverAnyway}>
          {t(`${K}.deliverAnyway`)}
        </Button>
      )}
    </div>
  );
};

export default GroundingState;
```

Verify `text-t-secondary` and `Button size='mini'` match this project's tokens and Arco usage; substitute the real token names if they differ, and never hardcode colours.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run tests/unit/renderer/knowledge/GroundingState.dom.test.tsx
git add packages/desktop/src/renderer/components/knowledge/ tests/unit/renderer/knowledge/
git commit -m "feat(knowledge): grounding completion state with deliver-anyway"
```

---

### Task 5: Wire the verdict and the withholding behavior

**Files:**
- Create: `packages/desktop/src/renderer/hooks/knowledge/useArtifactGrounding.ts`
- Create: `tests/unit/renderer/hooks/useArtifactGrounding.dom.test.ts`
- Modify: the artifact completion component that presents a produced office artifact
- Modify: its test file

- [ ] **Step 1: Write the failing hook test**

```typescript
describe('useArtifactGrounding', () => {
  it('computes the verdict from loaded messages including hidden ones', () => {
    const { result } = renderHook(() => useArtifactGrounding({ conversationId: 'c1', artifactTurnId: 't2' }));
    expect(result.current.verdict.kind).toBe('grounded_turn');
  });

  it('reads authoritative from the selected assistant binding', () => {
    bindings.a1 = { state: 'enabled', authoritative: true };
    const { result } = renderHook(() => useArtifactGrounding({ conversationId: 'c1', artifactTurnId: 't9' }));
    expect(result.current.authoritative).toBe(true);
  });

  it('withholds when authoritative and the verdict is none, and releases after override', async () => {
    bindings.a1 = { state: 'enabled', authoritative: true };
    const { result } = renderHook(() => useArtifactGrounding({ conversationId: 'c1', artifactTurnId: 't9' }));
    expect(result.current.withheld).toBe(true);
    await act(async () => result.current.deliverAnyway());
    expect(result.current.withheld).toBe(false);
    expect(result.current.overridden).toBe(true);
  });

  it('never withholds when the assistant is not authoritative', () => {
    bindings.a1 = { state: 'enabled' };
    const { result } = renderHook(() => useArtifactGrounding({ conversationId: 'c1', artifactTurnId: 't9' }));
    expect(result.current.withheld).toBe(false);
  });

  it('derives session scopes from the conversation\'s frozen descriptors, not current bindings', () => {
    bindings.a1 = { state: 'disabled' };  // disabled after the fact
    const { result } = renderHook(() => useArtifactGrounding({ conversationId: 'c1', artifactTurnId: 't2' }));
    expect(result.current.verdict.kind).not.toBe('not_applicable');
  });
});
```

- [ ] **Step 2: Run to verify failure, then implement**

The hook reads the conversation's message list (including hidden messages), maps rows to
`GroundingMessage`, derives `sessionScopes` from the conversation's **frozen** `session_mcp_servers`
snapshot (reuse the Slice 1 helper that already does this for citations — do not read current
binding state), calls `evaluateGrounding`, and returns
`{ verdict, authoritative, withheld, overridden, deliverAnyway }`. `withheld` is
`authoritative && verdict.kind === 'none' && !overridden`. `deliverAnyway()` records the override
against the artifact's completion state and flips `overridden`.

In the artifact completion component, render `<GroundingState … />` and, while `withheld` is true,
suppress the automatic delivery/open action that would otherwise fire — the file remains on disk and
is reachable through the override, never deleted.

- [ ] **Step 3: Verify and commit**

```bash
bunx vitest run tests/unit/renderer/hooks/useArtifactGrounding.dom.test.ts
bunx tsc --noEmit
git add packages/desktop/src/renderer/ tests/
git commit -m "feat(knowledge): withhold ungrounded artifacts for KB-authoritative assistants"
```

---

### Task 6: i18n, gates, and the two scenarios that matter

- [ ] **Step 1: Add strings**

Under `conversation.grounding.*`: `groundedTurn` ("Grounded in knowledge base"), `groundedEarlier`
("Knowledge base consulted earlier in this chat"), `none` ("No knowledge base consulted"),
`withheld` ("Not delivered — no knowledge base consulted"), `deliverAnyway` ("Deliver anyway"),
`overridden` ("Delivered without knowledge grounding"). Under
`settings.assistantKnowledge.requireGrounding` plus its helper text. Mirror into every language per
the `i18n` skill.

```bash
bun run i18n:types && node scripts/check-i18n.js
```

- [ ] **Step 2: Full gates**

```bash
bun run lint:fix && bun run format
bunx tsc --noEmit
bun run test
```

Expected: green. Lint warnings are pre-existing — judge by exit code.

- [ ] **Step 3: Manual smoke — the two scenarios this slice exists for**

Using the Slice 1 PMO assistant with a BC standard indexed, and **Require grounding** checked:

1. **The failure it prevents.** Ask for a new BC via a Template Gallery document template, but phrase
   the request so the model has no reason to search ("write a business case for Project X using the
   template"). If it produces the document without consulting the KB, confirm the artifact is
   **withheld** with "No knowledge base consulted" and a *Deliver anyway* action. Use the override
   and confirm the completion then reads "Delivered without knowledge grounding."
2. **The success path.** Ask again, this time expecting grounding ("…following our BC standard").
   Confirm the state reads "Grounded in knowledge base" and names the standard document.
3. **The compaction case.** Continue the conversation until a compaction occurs, then produce another
   artifact. Confirm previously-hidden KB evidence still yields a grounded verdict rather than
   flipping to "No knowledge base consulted."
4. **The no-KB case.** In a chat with an assistant that has no KB, produce an office artifact and
   confirm **no grounding line appears at all**.
5. **Report-only.** Uncheck *Require grounding*, repeat scenario 1, and confirm the artifact delivers
   normally while still reporting "No knowledge base consulted."

- [ ] **Step 4: Record results and stop**

```bash
git status  # everything committed
```

Do **not** push — pushing is `just push`, and only when explicitly asked.

---

## Out of scope for this plan

Per-claim traceability between artifact sentences and retrieved passages; HTML artifact coverage
(no delivery hook — matches the artifact-quality epic's office-only scoping); model-attested
exemptions (rejected: self-attestation about the behavior being checked); any change to
`OfficeArtifactService` or its BUG-003 corruption gate; grounding for team, scheduled, or
channel-created conversations (Slice 4 territory).
