# Chat Journal Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the per-turn chat journal read like the assistant talking to a person — surfacing the agent's real plan/thinking live, closing with a warm template summary, and never firing a red alarm for a failure the agent recovered from.

**Architecture:** Renderer-only, no LLM, no main-process or IPC changes. The agent already streams plan/thinking/tool messages; today they are hidden behind "Technical details" while an enum+count recap shows on top. We invert that (narration becomes the visible content), replace the count recap with a pure template close (`buildTurnClose`), and delete the per-step red-alarm pipeline so error tone is calm and turn-level.

**Tech Stack:** React 18 + TypeScript (strict), Arco Design + `@icon-park/react`, UnoCSS, i18next, Vitest 4 + Testing Library. Package manager: `bun`.

**Conventions:** Follow `AGENTS.md`. Conventional-commit messages. **No AI signatures.** For any i18n change, follow the `i18n` skill (`.claude/skills/i18n/SKILL.md`) and mirror keys across every locale in `packages/desktop/src/renderer/services/i18n/locales/*/messages.json`.

---

## File Structure

**New files:**
- `packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose.ts` — pure function: `(recap, subject) => TurnClose | null`. Picks a warm, status-appropriate closing line (i18n key + tone) with deterministic variety. No React, no i18n import.
- `tests/unit/chat/buildTurnClose.test.ts` — unit tests for the above.

**Modified files:**
- `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx` — narration rows become the visible content; render the close; drop the enum headline/activity/outcome block. `buildTurnWorkRecap` stays but only feeds the close + tone.
- `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx` — delete the `work_error` red-alarm pipeline (type, emitter, filter, render branch, helper branches).
- `packages/desktop/src/renderer/services/i18n/locales/*/messages.json` — add `toolActivity.close.*`; warm `toolActivity.generic.*`; retire `toolActivity.recap.headline.*`, `toolActivity.recap.activity`, `toolActivity.recap.outcome.*`, `toolActivity.recap.subject`, `toolActivity.recap.overflow`, `toolActivity.recap.category.*`, all `*.failedTitle`, and `toolActivity.error.suggestion`.
- `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx` — extend for narration-first rendering + close; drop assertions on retired strings.

**Deleted files:**
- `packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/ToolActivityError.tsx` — the red banner; no longer rendered.

**Deliberately unchanged:** `resolveToolAction.ts` (category logic is fine; only its i18n display strings change), `buildTurnWorkRecap.ts` (kept as the input to the close), `normalizeToolCall.ts`, `coalesceToolCalls.ts`.

---

## Task 1: `buildTurnClose` — the warm template close

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose.ts`
- Test: `tests/unit/chat/buildTurnClose.test.ts`
- Modify (i18n): `packages/desktop/src/renderer/services/i18n/locales/en-US/messages.json`

The close is a pure function returning an i18n **key + tone** (not resolved text), so it is testable without React or i18next. The "what happened" specifics live in the visible narration rows (Task 2); the close is the warm sign-off, tinted `attention` (amber) when the turn needs a human eye.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/chat/buildTurnClose.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { buildTurnClose } from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose';
import type { TurnWorkRecap } from '@/renderer/pages/conversation/Messages/components/toolActivity/buildTurnWorkRecap';

const recap = (over: Partial<TurnWorkRecap>): TurnWorkRecap => ({
  status: 'completed',
  total: 3,
  completed: 3,
  failed: 0,
  pending: 0,
  canceled: 0,
  unfinished: 0,
  retries: 0,
  categories: [],
  ...over,
});

describe('buildTurnClose', () => {
  it('returns null while the turn is still active', () => {
    expect(buildTurnClose(recap({ status: 'active', pending: 1 }))).toBeNull();
  });

  it('returns null for a trivial single-action turn with nothing notable', () => {
    expect(buildTurnClose(recap({ status: 'completed', total: 1, completed: 1 }))).toBeNull();
  });

  it('produces a neutral completed close for a real turn', () => {
    const close = buildTurnClose(recap({ status: 'completed', total: 3, completed: 3 }));
    expect(close).not.toBeNull();
    expect(close!.tone).toBe('neutral');
    expect(close!.key).toMatch(/^messages\.toolActivity\.close\.completed\.v\d$/);
  });

  it('marks partial and failed closes as attention', () => {
    expect(buildTurnClose(recap({ status: 'partial', completed: 2, failed: 1 }))!.tone).toBe('attention');
    expect(buildTurnClose(recap({ status: 'failed', completed: 0, failed: 2 }))!.tone).toBe('attention');
  });

  it('is deterministic: same recap shape yields the same variant', () => {
    const a = buildTurnClose(recap({ status: 'completed', total: 4 }));
    const b = buildTurnClose(recap({ status: 'completed', total: 4 }));
    expect(a!.key).toBe(b!.key);
  });

  it('a single failed action is notable enough to close (not trivial)', () => {
    const close = buildTurnClose(recap({ status: 'failed', total: 1, completed: 0, failed: 1 }));
    expect(close).not.toBeNull();
    expect(close!.tone).toBe('attention');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/unit/chat/buildTurnClose.test.ts`
Expected: FAIL — cannot resolve module `buildTurnClose`.

- [ ] **Step 3: Implement `buildTurnClose`**

Create `packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TurnWorkRecap, TurnWorkRecapStatus } from './buildTurnWorkRecap';

export type TurnCloseTone = 'neutral' | 'attention';

export type TurnClose = {
  // i18n key under messages.*; resolved by the component with useTranslation().
  key: string;
  tone: TurnCloseTone;
};

// Multiple variants per status keep the close from feeling same-y over time.
const CLOSE_VARIANTS: Record<Exclude<TurnWorkRecapStatus, 'active'>, string[]> = {
  completed: ['completed.v1', 'completed.v2', 'completed.v3'],
  recovered: ['recovered.v1', 'recovered.v2'],
  partial: ['partial.v1', 'partial.v2'],
  failed: ['failed.v1', 'failed.v2'],
  canceled: ['canceled.v1'],
};

const CLOSE_TONE: Record<Exclude<TurnWorkRecapStatus, 'active'>, TurnCloseTone> = {
  completed: 'neutral',
  recovered: 'neutral',
  partial: 'attention',
  failed: 'attention',
  canceled: 'neutral',
};

// Small deterministic hash so re-renders of the same turn pick the same variant.
const stableHash = (seed: string): number => {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash * 31 + seed.charCodeAt(index)) | 0;
  }
  return Math.abs(hash);
};

export const buildTurnClose = (recap: TurnWorkRecap, subject?: string): TurnClose | null => {
  // No sign-off while the work is still streaming.
  if (recap.status === 'active') return null;

  // A single successful action needs no recap — the agent's own reply already says it.
  // Anything with a snag (failed/canceled) or a stated focus is worth closing.
  const isTrivial = recap.total <= 1 && recap.failed === 0 && recap.canceled === 0 && !subject;
  if (isTrivial && recap.status === 'completed') return null;

  const variants = CLOSE_VARIANTS[recap.status];
  const seed = `${recap.status}:${recap.total}:${subject ?? ''}`;
  const variant = variants[stableHash(seed) % variants.length];

  return { key: `messages.toolActivity.close.${variant}`, tone: CLOSE_TONE[recap.status] };
};
```

- [ ] **Step 4: Add the close strings to en-US i18n**

In `packages/desktop/src/renderer/services/i18n/locales/en-US/messages.json`, under `messages.toolActivity`, add a `close` object (place it near the existing `recap` block):

```json
"close": {
  "completed": {
    "v1": "All done — everything went through as planned. Tell me what you'd like to do next.",
    "v2": "That's finished and working. Let me know where you'd like to go from here.",
    "v3": "Done — it all came together. I'm ready for the next thing whenever you are."
  },
  "recovered": {
    "v1": "Done — one step needed a second try, but it's all sorted now.",
    "v2": "Finished — it took a quick retry along the way, but everything's in place."
  },
  "partial": {
    "v1": "I got most of this done. A couple of things still need another pass — the details are just below.",
    "v2": "Good progress — most of it is done, though a bit still needs another go. You'll find the specifics below."
  },
  "failed": {
    "v1": "I wasn't able to finish this one. The details are below, and you can ask me to try again whenever you're ready.",
    "v2": "This didn't go through. Take a look at the details below, or just tell me to give it another try."
  },
  "canceled": {
    "v1": "Stopped here. Let me know if you'd like me to pick it back up."
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bunx vitest run tests/unit/chat/buildTurnClose.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/buildTurnClose.ts tests/unit/chat/buildTurnClose.test.ts packages/desktop/src/renderer/services/i18n/locales/en-US/messages.json
git commit -m "feat(chat): add pure template close builder for the work journal"
```

---

## Task 2: Narration-first rendering + close in `MessageToolGroupSummary`

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx`
- Modify (i18n): `packages/desktop/src/renderer/services/i18n/locales/en-US/messages.json`
- Test: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`

Today (`MessageToolGroupSummary.tsx:551-606`) the visible block is the enum headline + `subject` + `activity` + `outcome`, and the narration `rows` + raw `tools` sit inside the collapsed "Technical details" body. We invert: the narration `rows` become visible, the close renders beneath them, and only the raw `tools` detail stays behind "Technical details".

- [ ] **Step 1: Write the failing DOM test**

Add to `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx` a new `describe` block (reuse the file's existing `useRealMessages` helper and `enUsMessages` import):

```tsx
describe('MessageToolGroupSummary narration-first journal', () => {
  beforeEach(async () => {
    await useRealMessages('en-US', enUsMessages.messages as Record<string, unknown>);
  });

  const planMessage = (): WorkJournalSourceMessage =>
    ({
      id: 'plan-1',
      conversation_id: 'conv-1',
      type: 'plan',
      position: 'left',
      created_at: 1,
      content: {
        entries: [
          { content: 'Enable the Google Drive API', status: 'completed' },
          { content: 'Verify authentication', status: 'completed' },
        ],
      },
    }) as unknown as WorkJournalSourceMessage;

  it('shows the plan narration without expanding Technical details', () => {
    render(<MessageToolGroupSummary messages={[planMessage()]} isActive={false} />);
    expect(screen.getByText('Enable the Google Drive API')).toBeInTheDocument();
    expect(screen.getByText('Verify authentication')).toBeInTheDocument();
  });

  it('renders a warm close and none of the retired count/headline copy', () => {
    render(<MessageToolGroupSummary messages={[planMessage()]} isActive={false} />);
    // A close line is present (any completed-variant copy contains "done").
    expect(screen.getByText(/done|finished|came together/i)).toBeInTheDocument();
    // Retired strings must be gone.
    expect(screen.queryByText(/Work completed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/This turn covered/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Completed: \d+ of \d+/i)).not.toBeInTheDocument();
  });

  it('shows no close while the turn is active', () => {
    const active: WorkJournalSourceMessage = {
      ...(planMessage() as any),
      content: { entries: [{ content: 'Enable the Google Drive API', status: 'in_progress' }] },
    } as unknown as WorkJournalSourceMessage;
    render(<MessageToolGroupSummary messages={[active]} isActive={true} />);
    expect(screen.queryByText(/done|finished|came together/i)).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `bunx vitest run tests/unit/chat/MessageToolGroupSummary.dom.test.tsx -t "narration-first"`
Expected: FAIL — narration text is hidden behind "Technical details"; retired copy still present.

- [ ] **Step 3: Add the close import and compute it**

In `MessageToolGroupSummary.tsx`, add the import beside the existing `buildTurnWorkRecap` import (line 19):

```tsx
import { buildTurnClose } from './toolActivity/buildTurnClose';
```

Then, right after the `outcome` `useMemo` (ends at line 546) and before `const [showDetails, setShowDetails] = useState(false);` (line 547), add:

```tsx
  const close = useMemo(() => (isActive ? null : buildTurnClose(recap, recap.safeSubject)), [isActive, recap]);
```

- [ ] **Step 4: Replace the visible header block with narration + close**

Replace the header `<div className='flex flex-col gap-2px'>…</div>` block (lines 553-571 — the one containing the `recap.headline`, `recap.subject`, `recap.activity`, and `outcome`) with the narration rows and the close:

```tsx
        <div className='flex flex-col gap-4px'>
          {rows.map((row) => {
            if (row.status === 'error') return null;
            return (
              <StepRow
                key={row.key}
                label={row.kind === 'tool' ? action.label(row.step) : row.label}
                status={row.status}
              />
            );
          })}
          {close && (
            <div
              className={
                'text-13px m-t-4px ' + (close.tone === 'attention' ? 'text-t-warning' : 'text-t-primary')
              }
              role={recap.status === 'active' ? undefined : 'status'}
            >
              {t(close.key)}
            </div>
          )}
        </div>
```

- [ ] **Step 5: Remove the now-dead recap plumbing and keep Technical details for raw tools only**

Delete these now-unused pieces from `MessageToolGroupSummary.tsx`:
- the `outcome` `useMemo` (lines 516-546)
- the `categorySummary` `useMemo` (lines 512-515)
- the `formatCategorySummary` helper (lines 457-471)
- the `locale` line (line 511) if no longer referenced, and the now-unused imports it required (`DEFAULT_LANGUAGE`, `normalizeLanguageCode` on line 14) — remove only if unused.

In the collapsed body, change it to render **only** the raw tool detail (the `rows.map(StepRow)` moved up in Step 4). Replace the `{showDetails && (…)}` body (lines 588-604) with:

```tsx
      {showDetails && (
        <div className='tool-group-summary__body'>
          {tools.map((item) => (
            <ToolItemDetail key={item.key} item={item} />
          ))}
        </div>
      )}
```

Guard the "Technical details" toggle on there being raw tools to show — change the `{rows.length > 0 && (` condition wrapping the toggle button (line 572) to `{tools.length > 0 && (`.

- [ ] **Step 6: Warm the generic labels used by the narration floor**

In `en-US/messages.json`, warm the two dev-flavored generic strings so a fallback narration row reads naturally for a non-technical reader:

```json
"generic": {
  "running": "Working on the next step.",
  "done": "Finished the next step.",
  "failedTitle": "I couldn't complete this step"
}
```

(Leave `messages.toolActivity.categories.*` as-is for this task; they already read acceptably. `failedTitle` is removed entirely in Task 4.)

- [ ] **Step 7: Run the narration tests and the existing suite for this file**

Run: `bunx vitest run tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`
Expected: PASS. If pre-existing tests assert on retired copy (`Work completed`, `This turn covered`, `Completed: N of M`, `Focus:`), update those assertions to the new narration/close behavior — those strings are intentionally gone.

- [ ] **Step 8: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. Fix any unused-import errors created by Step 5.

- [ ] **Step 9: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/Messages/components/MessageToolGroupSummary.tsx packages/desktop/src/renderer/services/i18n/locales/en-US/messages.json tests/unit/chat/MessageToolGroupSummary.dom.test.tsx
git commit -m "feat(chat): show live plan narration and a warm close instead of count recap"
```

---

## Task 3: Retire the red-alarm error pipeline

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/Messages/MessageList.tsx`
- Delete: `packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/ToolActivityError.tsx`
- Test: `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`

A failed step no longer produces a standalone red banner. Recovered/partial failures fold into the narration (Task 2 already renders recovered steps via `action.label`), and a turn that ends failed is carried by the `attention`-toned close (Task 2). This task removes the whole `work_error` path.

- [ ] **Step 1: Write the failing DOM test (no alarm for a recovered step)**

Add to the narration-first `describe` in `tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`:

```tsx
  it('does not show the red failure banner for a recovered step', () => {
    const recovered: WorkJournalSourceMessage = {
      id: 'tg-1',
      conversation_id: 'conv-1',
      type: 'tool_group',
      position: 'left',
      created_at: 1,
      content: [
        {
          callId: 'c1',
          name: 'ExecCommand',
          status: 'success',
          startTime: 1,
        },
      ],
    } as unknown as WorkJournalSourceMessage;
    render(<MessageToolGroupSummary messages={[recovered]} isActive={false} />);
    expect(screen.queryByText(/I couldn't complete the project step/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/error details are available below/i)).not.toBeInTheDocument();
  });
```

Note: `MessageToolGroupSummary` never rendered the banner itself (that was `MessageList`), so this test should pass immediately for the summary — it is a regression guard. The behavioral removal is verified by typecheck + the app; assert-by-absence keeps it honest.

- [ ] **Step 2: Delete `work_error` from the `IMessageVO` union**

In `MessageList.tsx`, remove the `work_error` member of `IMessageVO` (lines 60-66), leaving `TMessage | file_summary | work_summary`.

- [ ] **Step 3: Delete the emitter and its state**

Remove:
- `pendingWorkErrorIdByCallKey` and `supersededWorkErrorIds` declarations (lines 317-318)
- the entire `pushWorkErrors` function (lines 353-374)
- the three `pushWorkErrors(message);` calls inside the `tool_group` / `acp_tool_call` / `tool_call` branches (lines 421, 429, 437)
- in the final `return`, simplify the filter (line 468) from `result.filter((item) => item.type !== 'work_error' || !supersededWorkErrorIds.has(item.id))` to just `result`.

- [ ] **Step 4: Delete the render + helper branches**

Remove:
- the `work_error` render branch in `renderItem` (lines 789-799)
- the `ToolActivityError` import (line 47)
- the `work_error` branch in `getProcessedItemSourceMessageIds` (lines 89-91)
- the `work_error` branch in `getProcessedItemAnchorId` (line 106)
- `'work_error'` from the `includes([...])` array (line 112) and from the `activeWorkSummaryId` skip (line 492: change `item.type === 'file_summary' || item.type === 'work_error'` to `item.type === 'file_summary'`)
- any remaining `work_error` reference around lines 519-520.
- If `CoalescedStep` is now an unused import in `MessageList.tsx`, remove it.

- [ ] **Step 5: Delete the component file**

```bash
git rm packages/desktop/src/renderer/pages/conversation/Messages/components/toolActivity/ToolActivityError.tsx
```

- [ ] **Step 6: Grep for stragglers**

Run: `grep -rn "work_error\|ToolActivityError" packages/desktop/src tests`
Expected: no matches (except this plan). Fix any that remain.

- [ ] **Step 7: Typecheck + run the file's tests**

Run: `bunx tsc --noEmit && bunx vitest run tests/unit/chat/MessageToolGroupSummary.dom.test.tsx`
Expected: no type errors; tests PASS.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(chat): remove per-step red failure banner in favor of calm turn-level close"
```

---

## Task 4: Retire the count-recap i18n keys + full validation gate

**Files:**
- Modify: `packages/desktop/src/renderer/services/i18n/locales/*/messages.json` (all locales)
- Reference: `.claude/skills/i18n/SKILL.md`

The retired keys are no longer referenced in code after Tasks 2-3. Remove them everywhere and mirror the new `close.*` keys across locales.

- [ ] **Step 1: Confirm the retired keys are unreferenced in code**

Run:
```bash
grep -rnE "toolActivity\.recap\.(headline|activity|outcome|subject|overflow|category)|toolActivity\.(generic|categories|tools)\.[a-zA-Z_]+\.failedTitle|toolActivity\.error\.suggestion" packages/desktop/src --include=*.ts --include=*.tsx | grep -v locales
```
Expected: no matches (all usages removed in Tasks 2-3). If any remain, resolve before deleting keys.

- [ ] **Step 2: Remove the retired keys from every locale**

In each `packages/desktop/src/renderer/services/i18n/locales/<locale>/messages.json`, under `messages.toolActivity`, delete: `recap.headline`, `recap.activity`, `recap.outcome`, `recap.subject`, `recap.overflow`, `recap.category`, every `*.failedTitle` (`generic.failedTitle`, `categories.*.failedTitle`, `tools.*.failedTitle`), and `error.suggestion`. Keep `recap` only if a sub-key survives; otherwise remove the empty `recap` object. Keep `status.*`, `attempt`, `categories.*.running/done`, `tools.*.running/done`, and `generic.running/done`.

- [ ] **Step 3: Mirror the `close.*` keys into every non-English locale**

Add the `messages.toolActivity.close` object (from Task 1 Step 4) to each locale. Translate where you can; otherwise copy the English string so key parity holds (the i18n skill documents this fallback). Also mirror the warmed `generic.running`/`generic.done` values.

- [ ] **Step 4: Regenerate i18n types and validate parity**

Run:
```bash
bun run i18n:types
node scripts/check-i18n.js
```
Expected: types regenerate cleanly; `check-i18n.js` reports no missing/extra keys across locales.

- [ ] **Step 5: Full gate**

Run:
```bash
bunx tsc --noEmit
bun run lint:fix
bun run test
```
Expected: no type errors; lint exits 0 (pre-existing warnings are fine — judge by exit code); all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(i18n): retire count-recap and failure-banner strings, add close copy"
```

---

## Self-Review

**Spec coverage:**
- Live plain narration surfaced → Task 2 (rows made visible; generic labels warmed).
- Warm two-beat close, no LLM → Task 1 (`buildTurnClose` + copy) rendered in Task 2.
- Three-tier errors (retry hidden / recovered folded / blocking calm) → recovered & partial fold via narration + `attention` close (Task 2); the red alarm is deleted (Task 3). Tier-3 specificity ("the one action") is intentionally generic under Option B — the bespoke action line is the deferred Option A (spec "Future work"); this plan delivers the calm tone, not per-error advice.
- `buildTurnWorkRecap` demoted, counts not rendered → Task 2 removes `outcome`/`activity`/`categorySummary`; recap now only feeds the close.
- i18n retire + parity → Task 4.
- Tests for close builder, narration render, error absence, labels → Tasks 1-3.

**Placeholder scan:** No TBD/TODO; every code step carries complete code or an exact edit target. The one judgment call (updating any pre-existing dom-test assertions that referenced retired strings) is called out explicitly in Task 2 Step 7 with the exact strings to remove.

**Type consistency:** `TurnClose { key, tone }` and `TurnCloseTone` defined in Task 1 and consumed in Task 2. `buildTurnClose(recap, recap.safeSubject)` matches the `(recap: TurnWorkRecap, subject?: string)` signature. `TurnWorkRecapStatus` reused from `buildTurnWorkRecap.ts` (already exported). `IMessageVO` narrowing after removing `work_error` stays valid — no remaining code branches on it after Task 3.

**Line-number caveat:** Line references reflect the files as read on 2026-07-22; if they have drifted, anchor on the named function/`useMemo`/JSX block instead.
