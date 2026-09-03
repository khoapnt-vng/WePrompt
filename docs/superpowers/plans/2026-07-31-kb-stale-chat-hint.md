# KB Stale-Chat Hint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the user, next to the composer, when the chat they are typing in cannot search the project's knowledge base — and offer a new chat that can.

**Architecture:** Entirely renderer-side, zero new IPC channels. A conversation's MCP server set is frozen at creation in `extra.session_mcp_servers`; a chat created while the project had no indexed sources therefore never receives the `aionui-project-knowledge` server. A pure predicate decides visibility from four inputs (project id, that frozen snapshot, current source readiness, dismissal), a hook supplies the two dynamic inputs (a `listSources` read refreshed on the `projectKnowledge.updated` push, plus a `localStorage` dismissal), and an Arco `Alert` renders between the message list and the composer in both platform views. The predicate fails closed: every uncertain input yields "show nothing".

**Tech Stack:** TypeScript, React 18, Arco Design (`Alert`, `Button`), UnoCSS semantic tokens, react-i18next (12 locales), Vitest (`node` + `jsdom` projects), `@testing-library/react`.

---

## Context an implementer needs before touching anything

**The bug, in one paragraph.** `useGuidSend` asks the main process for the project's knowledge MCP descriptor at conversation-create time (`packages/desktop/src/renderer/pages/guid/hooks/useGuidSend.ts:233-239`). The main process returns `null` unless the project already has a source that is both `status === 'ready'` and `chunkCount > 0` (`packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts:922-925`). The descriptor list is then persisted with the conversation and never revisited. So a chat created before any file was indexed is permanently unable to search, no matter how many documents are added later. The assistant answers "I have no knowledge of that file" while the file sits visibly in the Knowledge card.

**Verified data shape** (live dev DB, `~/.aionui-dev/aionui-backend.db`, 32 conversations). This is why the trigger is safe to build:

| conversations | `extra.session_mcp_servers` | verdict |
| --- | --- | --- |
| 10 project chats | array, 2 entries, includes `aionui-project-knowledge` | can search — never show the notice |
| `11cbb7ac` (project) | array, 1 entry, no knowledge server | **Case A target** |
| `fdb07252` (project) | `[]` | **Case A target** (created with zero ready sources) |
| 19 non-project | array | excluded by the `project_id` gate |
| 1 non-project | key **absent** | excluded by the `project_id` gate |

Two facts that follow, and that the code depends on: for project conversations the key is *always* a real array, so matching against it is meaningful; and the only observed absent-key row is non-project, so treating "not an array" as *show nothing* costs nothing real while keeping the predicate honest.

**Query to re-confirm on any machine:**

```bash
sqlite3 -readonly ~/.aionui-dev/aionui-backend.db "SELECT substr(id,1,8), json_array_length(COALESCE(json_extract(extra,'\$.session_mcp_servers'),'[]')) AS n, (extra LIKE '%aionui-project-knowledge%') AS has_kb FROM conversations WHERE json_extract(extra,'\$.project_id') IS NOT NULL ORDER BY created_at DESC;"
```

**Hard constraints.** No new `bridge.buildProvider` channels. Never `git stash` (shared stack). Root tsconfig is `noImplicitAny` only, not `strict`. Lint baseline is ~847 warnings / 0 errors — judge by **errors**. Arco components only, no raw interactive HTML, every user-facing string via i18n. The renderer **may not import from `packages/desktop/src/process/`** — it is a documented hard blocker (`AGENTS.md:58-66,83`) and the renderer tree currently has zero such imports; do not be the first.

**Coordination.** Branch is `feat/kb-stale-chat-hint` off `origin/sprint1` @ `d60397537`, which already contains the KB citation click-through merge — that stream has landed, so there is no race. The separate UI-improvements initiative (`docs/superpowers/plans/ui-improvements-streams.md`) nominally assigns `pages/conversation/**` to its Stream 3, but no Stream 2–5 branch exists yet, so nothing is in flight. Task 8 records the overlap in that doc's Escalations section.

---

## File Structure

**Modified — single-sourcing the server name (Task 1):**

- `packages/desktop/src/common/knowledge/constants.ts` — gains `BUILTIN_KNOWLEDGE_NAME`. Node-free, zero imports, already imported by both the renderer (`KnowledgeCitationsContext.tsx:9`) and the standalone knowledge subprocess (`knowledgeServer.ts:14`), which proves the move is safe on every bundle.
- `packages/desktop/src/process/resources/builtinMcp/constants.ts` — loses that one constant, keeps `BUILTIN_KNOWLEDGE_ID`/`_SCRIPT`, stays import-free.
- `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts` — import folded into its existing `@/common/knowledge/constants` line.
- `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts` — import repointed.

**New — the feature (Tasks 2, 3, 5):**

- `packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts` — the pure predicate, the dismissal-key builder, the route constant, and the hook. Directory has 1 child today, so there is room (the ≤10-children rule, `.claude/skills/architecture/references/renderer.md:76`).
- `packages/desktop/src/renderer/pages/conversation/knowledge/KbStaleChatHint.tsx` — the Arco `Alert`.

**Modified — mounting (Task 6):**

- `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx` — reads two more `extra` fields and threads them, mirroring the existing `loadedMcpStatuses` cast idiom at `:236` and `:313`.
- `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx`, `.../aionrs/AionrsChat.tsx` — accept the two props, render the notice between the message list and the composer.

**Modified — i18n (Task 4):** `packages/desktop/src/renderer/services/i18n/locales/<locale>/conversation.json` × 12, plus the regenerated `packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts`.

**New — tests:** `tests/unit/renderer/conversation/kbStaleChatHintTrigger.test.ts`, `.../useKbStaleChatHint.dom.test.ts`, `.../KbStaleChatHint.dom.test.tsx`.

**Deliberately untouched:** `ipcBridge.ts`, the knowledge service/server/retrieval, `ProjectKnowledgeCard.tsx`, `KnowledgeCitationsContext.tsx`, `SendBox/index.tsx`, `GroupedHistory/index.tsx`.

### Two design choices to preserve, not "clean up"

**1. The readiness test mirrors the server's attach predicate, not the spec's looser wording.** The spec says "≥1 `ready` source". The code additionally requires `chunkCount > 0` because that is exactly what `getSessionMcpServer` requires before it will hand a *new* chat the tool (`projectKnowledgeService.ts:922-925`). Gate on `ready` alone and a project whose only source is ready-but-empty would show a notice promising a new chat that also cannot search — a broken promise. Keep the two predicates identical.

**2. The hook is self-contained rather than reading `KnowledgeCitationsContext`.** That context already fetches the same source list and subscribes to the same event, and extending its value with a readiness flag would save one subscription. It is deliberately not done: it would couple this feature to the citation stream's file, and the extra subscription only ever exists for project chats that *lack* the tool — 2 of 12 conversations in the sample, and zero cost for the common case, because `shouldWatch` is false whenever the chat already has the server.

---

## Task 1: Single-source the knowledge server name

The renderer must match conversations against the server name. It cannot import the constant from `process/`, and inlining the literal is the exact mistake that produced the persona-label bug. So the definition moves to `common/`, which both sides may import — one definition, no duplication.

**Files:**
- Modify: `packages/desktop/src/common/knowledge/constants.ts`
- Modify: `packages/desktop/src/process/resources/builtinMcp/constants.ts:64`
- Modify: `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts:14,19`
- Modify: `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts:51`

- [ ] **Step 1: Add the constant to the shared module**

Append to `packages/desktop/src/common/knowledge/constants.ts` (after `EXTRACTED_TEXT_DIR_NAME`):

```ts
/**
 * Name of the built-in project-knowledge MCP server. Also the name persisted
 * in a conversation's frozen `extra.session_mcp_servers` snapshot, which is
 * what lets the renderer tell whether a chat was created with knowledge
 * search attached. It lives here rather than beside the other builtin-MCP
 * names in `process/resources/builtinMcp/constants.ts` because the renderer
 * may not import from `process/` — and a second copy of the literal is how
 * the persona-label bug happened.
 */
export const BUILTIN_KNOWLEDGE_NAME = 'aionui-project-knowledge';
```

- [ ] **Step 2: Remove the process-side definition, leaving a pointer**

In `packages/desktop/src/process/resources/builtinMcp/constants.ts`, replace the three-line knowledge block at `:63-65`:

```ts
export const BUILTIN_KNOWLEDGE_ID = 'builtin-project-knowledge';
export const BUILTIN_KNOWLEDGE_NAME = 'aionui-project-knowledge';
export const BUILTIN_KNOWLEDGE_SCRIPT = 'builtin-mcp-knowledge';
```

with:

```ts
export const BUILTIN_KNOWLEDGE_ID = 'builtin-project-knowledge';
// BUILTIN_KNOWLEDGE_NAME lives in `@/common/knowledge/constants`: the renderer
// matches conversations against it and may not import from `process/`.
export const BUILTIN_KNOWLEDGE_SCRIPT = 'builtin-mcp-knowledge';
```

This keeps the file's deliberate zero-import property (its header comment at `:7-8`) intact.

- [ ] **Step 3: Repoint the two consumers**

In `packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts`, fold the name into the import that already exists on line 14 and delete line 19:

```ts
import { BUILTIN_KNOWLEDGE_NAME, EXTRACTED_TEXT_DIR_NAME, KNOWLEDGE_FOLDER_NAME } from '@/common/knowledge/constants';
```

```ts
// delete this line:
import { BUILTIN_KNOWLEDGE_NAME } from './constants';
```

In `packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts:51`, replace:

```ts
import { BUILTIN_KNOWLEDGE_NAME } from '../../resources/builtinMcp/constants';
```

with:

```ts
import { BUILTIN_KNOWLEDGE_NAME } from '@/common/knowledge/constants';
```

If that file has no other `@/`-aliased import, use the equivalent relative path `'../../../common/knowledge/constants'` instead — check the file's existing import style and match it rather than introducing a new one.

- [ ] **Step 4: Verify types and that the MCP subprocess bundle still builds**

```bash
bunx tsc --noEmit && node scripts/build-mcp-servers.js && node -e "const s=require('fs').readFileSync('out/main/builtin-mcp-knowledge.js','utf8'); if(!s.includes('aionui-project-knowledge')) { console.error('FAIL: name missing from bundle'); process.exit(1); } console.log('OK: name present in knowledge bundle');"
```

Expected: no type errors, the esbuild run finishes, and `OK: name present in knowledge bundle`. This is the real risk in this task — the knowledge server runs as a standalone `node` subprocess, so the constant must survive bundling, not merely type-check.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/common/knowledge/constants.ts packages/desktop/src/process/resources/builtinMcp/constants.ts packages/desktop/src/process/resources/builtinMcp/knowledgeServer.ts packages/desktop/src/process/services/projectKnowledge/projectKnowledgeService.ts
git commit -m "refactor(knowledge): move the builtin server name to common so the renderer can match it"
```

---

## Task 2: The trigger predicate (pure, TDD)

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts`
- Test: `tests/unit/renderer/conversation/kbStaleChatHintTrigger.test.ts`

The predicate is pure and exported separately from the hook precisely so the truth table can be tested without React, jsdom, or IPC mocks.

- [ ] **Step 1: Write the failing truth-table test**

Create `tests/unit/renderer/conversation/kbStaleChatHintTrigger.test.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { BUILTIN_KNOWLEDGE_NAME } from '@/common/knowledge/constants';
import {
  kbStaleHintDismissKey,
  shouldShowKbStaleHint,
  type KbStaleChatHintTrigger,
} from '@/renderer/pages/conversation/knowledge/useKbStaleChatHint';

const KNOWLEDGE_SERVER = { id: 'project-kb-p1', name: BUILTIN_KNOWLEDGE_NAME, transport: { type: 'stdio' } };
const OTHER_SERVER = { id: 'mcp_1', name: 'greennode-idp', transport: { type: 'stdio' } };

/** The one combination that must show the notice. */
const TRIGGERING: KbStaleChatHintTrigger = {
  conversationId: 'c1',
  projectId: 'p1',
  sessionMcpServers: [OTHER_SERVER],
  hasIndexedSource: true,
  dismissed: false,
};

describe('shouldShowKbStaleHint', () => {
  it('shows the notice for a project chat that lacks the knowledge server while the project has indexed sources', () => {
    expect(shouldShowKbStaleHint(TRIGGERING)).toBe(true);
  });

  it('shows it when the frozen snapshot is empty — the zero-ready-sources case at create time', () => {
    expect(shouldShowKbStaleHint({ ...TRIGGERING, sessionMcpServers: [] })).toBe(true);
  });

  describe('truth table: exactly one of the 16 combinations shows the notice', () => {
    const dimensions = {
      project: [
        { label: 'project', value: 'p1' as string | undefined },
        { label: 'non-project', value: undefined },
      ],
      tool: [
        { label: 'lacks-tool', value: [OTHER_SERVER] as unknown },
        { label: 'has-tool', value: [OTHER_SERVER, KNOWLEDGE_SERVER] as unknown },
      ],
      ready: [
        { label: 'ready-sources', value: true },
        { label: 'no-sources', value: false },
      ],
      dismissed: [
        { label: 'not-dismissed', value: false },
        { label: 'dismissed', value: true },
      ],
    };

    const cells: Array<{ name: string; trigger: KbStaleChatHintTrigger; expected: boolean }> = [];
    for (const project of dimensions.project) {
      for (const tool of dimensions.tool) {
        for (const ready of dimensions.ready) {
          for (const dismissed of dimensions.dismissed) {
            cells.push({
              name: `${project.label} × ${tool.label} × ${ready.label} × ${dismissed.label}`,
              trigger: {
                conversationId: 'c1',
                projectId: project.value,
                sessionMcpServers: tool.value,
                hasIndexedSource: ready.value,
                dismissed: dismissed.value,
              },
              expected:
                project.label === 'project' &&
                tool.label === 'lacks-tool' &&
                ready.label === 'ready-sources' &&
                dismissed.label === 'not-dismissed',
            });
          }
        }
      }
    }

    it('covers all 16 combinations', () => {
      expect(cells).toHaveLength(16);
      expect(cells.filter((cell) => cell.expected)).toHaveLength(1);
    });

    for (const cell of cells) {
      it(`${cell.name} → ${cell.expected ? 'shows' : 'hidden'}`, () => {
        expect(shouldShowKbStaleHint(cell.trigger)).toBe(cell.expected);
      });
    }
  });

  describe('fails closed on anything uncertain', () => {
    it('hides when there is no conversation id', () => {
      expect(shouldShowKbStaleHint({ ...TRIGGERING, conversationId: undefined })).toBe(false);
    });

    it('hides when the snapshot is absent — we cannot tell what the session was given', () => {
      expect(shouldShowKbStaleHint({ ...TRIGGERING, sessionMcpServers: undefined })).toBe(false);
    });

    it('hides when the snapshot is not an array', () => {
      expect(shouldShowKbStaleHint({ ...TRIGGERING, sessionMcpServers: 'aionui-project-knowledge' })).toBe(false);
      expect(shouldShowKbStaleHint({ ...TRIGGERING, sessionMcpServers: { name: 'x' } })).toBe(false);
    });

    it('tolerates malformed entries inside the snapshot without throwing', () => {
      expect(shouldShowKbStaleHint({ ...TRIGGERING, sessionMcpServers: [null, 7, 'x', {}] })).toBe(true);
      expect(shouldShowKbStaleHint({ ...TRIGGERING, sessionMcpServers: [null, KNOWLEDGE_SERVER] })).toBe(false);
    });
  });
});

describe('kbStaleHintDismissKey', () => {
  it('namespaces the dismissal per conversation', () => {
    expect(kbStaleHintDismissKey('abc')).toBe('kb.staleHint.dismissed.abc');
    expect(kbStaleHintDismissKey('def')).not.toBe(kbStaleHintDismissKey('abc'));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
bunx vitest run tests/unit/renderer/conversation/kbStaleChatHintTrigger.test.ts
```

Expected: FAIL — cannot resolve `@/renderer/pages/conversation/knowledge/useKbStaleChatHint`.

- [ ] **Step 3: Write the predicate**

Create `packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts`:

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { BUILTIN_KNOWLEDGE_NAME } from '@/common/knowledge/constants';

/**
 * Route of the project-scoped new-chat screen, with the project carried in
 * router state. Same target as the sidebar's "new chat in project" action
 * (`GroupedHistory/index.tsx:283-288`) — reused deliberately so the hint does
 * not introduce a second way to create a project chat.
 */
export const PROJECT_CHAT_ROUTE = '/guid';

/** Dismissal is per conversation: silencing one chat must not silence another. */
export const kbStaleHintDismissKey = (conversationId: string): string => `kb.staleHint.dismissed.${conversationId}`;

export type KbStaleChatHintTrigger = {
  conversationId?: string;
  /** `extra.project_id`; absent on non-project conversations. */
  projectId?: string;
  /**
   * `extra.session_mcp_servers` — the MCP set frozen when the conversation was
   * created. Typed `unknown` on purpose: aioncore owns this blob, so it is
   * validated here rather than trusted.
   */
  sessionMcpServers?: unknown;
  /** The project has a source a new chat would actually be able to search. */
  hasIndexedSource: boolean;
  dismissed: boolean;
};

const includesKnowledgeServer = (servers: readonly unknown[]): boolean =>
  servers.some((server) => (server as { name?: unknown } | null | undefined)?.name === BUILTIN_KNOWLEDGE_NAME);

/**
 * Whether this conversation is provably unable to search its project's
 * knowledge base *and* saying so is actionable.
 *
 * Fails closed. Every uncertain input — no ids, a snapshot that is not an
 * array, sources still loading or unreadable — returns false, because a
 * wrongly shown notice contradicts a working chat and destroys trust in the
 * message, while a wrongly hidden one merely leaves today's behaviour.
 */
export const shouldShowKbStaleHint = (trigger: KbStaleChatHintTrigger): boolean => {
  const { conversationId, projectId, sessionMcpServers, hasIndexedSource, dismissed } = trigger;
  if (!conversationId || !projectId) return false;
  if (dismissed) return false;
  // Nothing to offer yet: a new chat would be no better than this one.
  if (!hasIndexedSource) return false;
  if (!Array.isArray(sessionMcpServers)) return false;
  return !includesKnowledgeServer(sessionMcpServers);
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
bunx vitest run tests/unit/renderer/conversation/kbStaleChatHintTrigger.test.ts
```

Expected: PASS, 25 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts tests/unit/renderer/conversation/kbStaleChatHintTrigger.test.ts
git commit -m "feat(knowledge): add the stale-chat hint trigger predicate"
```

---

## Task 3: The hook — readiness, live refresh, dismissal

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts`
- Test: `tests/unit/renderer/conversation/useKbStaleChatHint.dom.test.ts`

- [ ] **Step 1: Write the failing hook test**

Create `tests/unit/renderer/conversation/useKbStaleChatHint.dom.test.ts`. The `@/common` mock shape follows `tests/unit/renderer/useProjectKnowledge.dom.test.ts:19-39` (arrow thunks so the hoisted factory works; the `.on` listener captured into a module-level `let`):

```ts
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_KNOWLEDGE_NAME } from '@/common/knowledge/constants';
import { kbStaleHintDismissKey, useKbStaleChatHint } from '@/renderer/pages/conversation/knowledge/useKbStaleChatHint';

const listSourcesMock = vi.fn();
let updatedListener: ((payload: { projectId: string }) => void) | null = null;
const unsubscribeMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    projectKnowledge: {
      listSources: { invoke: (...args: unknown[]) => listSourcesMock(...args) },
      updated: {
        on: (listener: (payload: { projectId: string }) => void) => {
          updatedListener = listener;
          return unsubscribeMock;
        },
      },
    },
  },
}));

const source = (over: Partial<{ status: string; chunkCount: number }> = {}) => ({
  id: 's1',
  fileName: 'policy.pdf',
  byteSize: 10,
  status: 'ready',
  chunkCount: 4,
  vectorCount: 0,
  addedAt: 0,
  error: null,
  progress: null,
  ocr: null,
  ...over,
});

const listResult = (sources: unknown[]) => ({ sources, summary: null, folderMissing: false });

const OTHER_SERVER = { id: 'mcp_1', name: 'greennode-idp', transport: { type: 'stdio' } };
const KNOWLEDGE_SERVER = { id: 'project-kb-p1', name: BUILTIN_KNOWLEDGE_NAME, transport: { type: 'stdio' } };

const STALE = { conversationId: 'c1', projectId: 'p1', sessionMcpServers: [OTHER_SERVER] };

beforeEach(() => {
  localStorage.clear();
  listSourcesMock.mockReset().mockResolvedValue(listResult([source()]));
  unsubscribeMock.mockReset();
  updatedListener = null;
});

describe('useKbStaleChatHint', () => {
  it('becomes visible once the project reports an indexed source', async () => {
    const { result } = renderHook(() => useKbStaleChatHint(STALE));
    // Fails closed on the first render, before the fetch resolves.
    expect(result.current.visible).toBe(false);
    await waitFor(() => expect(result.current.visible).toBe(true));
    expect(listSourcesMock).toHaveBeenCalledWith({ projectId: 'p1' });
  });

  it('stays hidden for a chat that already has the knowledge server, and never queries', async () => {
    const { result } = renderHook(() =>
      useKbStaleChatHint({ ...STALE, sessionMcpServers: [OTHER_SERVER, KNOWLEDGE_SERVER] })
    );
    await waitFor(() => expect(listSourcesMock).not.toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('stays hidden for a non-project chat, and never queries', async () => {
    const { result } = renderHook(() => useKbStaleChatHint({ ...STALE, projectId: undefined }));
    await waitFor(() => expect(listSourcesMock).not.toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('requires passages, not merely a ready status — a new chat would be no better otherwise', async () => {
    listSourcesMock.mockResolvedValue(listResult([source({ chunkCount: 0 })]));
    const { result } = renderHook(() => useKbStaleChatHint(STALE));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('stays hidden while sources are only indexing', async () => {
    listSourcesMock.mockResolvedValue(listResult([source({ status: 'indexing', chunkCount: 0 })]));
    const { result } = renderHook(() => useKbStaleChatHint(STALE));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('stays hidden when the source list cannot be read', async () => {
    listSourcesMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbStaleChatHint(STALE));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    expect(result.current.visible).toBe(false);
  });

  it('appears when a file is added mid-chat, via the projectKnowledge.updated push', async () => {
    listSourcesMock.mockResolvedValue(listResult([]));
    const { result } = renderHook(() => useKbStaleChatHint(STALE));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalledTimes(1));
    expect(result.current.visible).toBe(false);

    listSourcesMock.mockResolvedValue(listResult([source()]));
    await act(async () => {
      updatedListener?.({ projectId: 'p1' });
    });
    await waitFor(() => expect(result.current.visible).toBe(true));
  });

  it('ignores updates for other projects', async () => {
    const { result } = renderHook(() => useKbStaleChatHint(STALE));
    await waitFor(() => expect(result.current.visible).toBe(true));
    await act(async () => {
      updatedListener?.({ projectId: 'other' });
    });
    expect(listSourcesMock).toHaveBeenCalledTimes(1);
  });

  it('unsubscribes on unmount', async () => {
    const { unmount } = renderHook(() => useKbStaleChatHint(STALE));
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    unmount();
    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  describe('dismissal', () => {
    it('hides the notice and persists the choice', async () => {
      const { result } = renderHook(() => useKbStaleChatHint(STALE));
      await waitFor(() => expect(result.current.visible).toBe(true));
      act(() => result.current.dismiss());
      expect(result.current.visible).toBe(false);
      expect(localStorage.getItem(kbStaleHintDismissKey('c1'))).toBe('1');
    });

    it('stays dismissed across a remount — this is what survives an app reload', async () => {
      localStorage.setItem(kbStaleHintDismissKey('c1'), '1');
      const { result } = renderHook(() => useKbStaleChatHint(STALE));
      await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
      expect(result.current.visible).toBe(false);
    });

    it('does not leak between conversations', async () => {
      localStorage.setItem(kbStaleHintDismissKey('c1'), '1');
      const { result } = renderHook(() => useKbStaleChatHint({ ...STALE, conversationId: 'c2' }));
      await waitFor(() => expect(result.current.visible).toBe(true));
      expect(localStorage.getItem(kbStaleHintDismissKey('c2'))).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
bunx vitest run tests/unit/renderer/conversation/useKbStaleChatHint.dom.test.ts
```

Expected: FAIL — `useKbStaleChatHint` is not exported.

- [ ] **Step 3: Implement the hook**

Append to `packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts`, and add the two imports at the top of the file (`import { ipcBridge } from '@/common';` and `import { useCallback, useEffect, useState } from 'react';`):

```ts
export type KbStaleChatHintState = {
  visible: boolean;
  /** Hide the notice for this conversation, permanently. */
  dismiss: () => void;
};

/**
 * Trigger for the stale-chat notice.
 *
 * Only conversations that could ever show it — project scoped, and missing the
 * knowledge server from their frozen snapshot — read the source list or
 * subscribe to updates. A chat that can already search costs nothing.
 */
export const useKbStaleChatHint = (input: {
  conversationId?: string;
  projectId?: string;
  sessionMcpServers?: unknown;
}): KbStaleChatHintState => {
  const { conversationId, projectId, sessionMcpServers } = input;

  const lacksKnowledgeServer = Array.isArray(sessionMcpServers) && !includesKnowledgeServer(sessionMcpServers);
  const shouldWatch = Boolean(conversationId && projectId && lacksKnowledgeServer);

  const [hasIndexedSource, setHasIndexedSource] = useState(false);
  // Starts dismissed so the first paint cannot flash a notice we may hide.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    setDismissed(conversationId ? localStorage.getItem(kbStaleHintDismissKey(conversationId)) === '1' : true);
  }, [conversationId]);

  useEffect(() => {
    if (!shouldWatch || !projectId) {
      setHasIndexedSource(false);
      return;
    }
    let disposed = false;
    const refetch = async () => {
      try {
        const result = await ipcBridge.projectKnowledge.listSources.invoke({ projectId });
        // Mirrors the server-side attach predicate
        // (`projectKnowledgeService.getSessionMcpServer`): a source only makes a
        // new chat better once it is ready AND has passages to search.
        const ready = result.sources.some((source) => source.status === 'ready' && source.chunkCount > 0);
        if (!disposed) setHasIndexedSource(ready);
      } catch (error) {
        console.error('Failed to load knowledge sources for the stale-chat hint:', error);
        if (!disposed) setHasIndexedSource(false);
      }
    };
    void refetch();
    // The event is global across projects, and fires on every manifest write —
    // including ingestion progress ticks.
    const unsubscribe = ipcBridge.projectKnowledge.updated.on((payload) => {
      if (payload.projectId === projectId) void refetch();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [shouldWatch, projectId]);

  const dismiss = useCallback(() => {
    if (!conversationId) return;
    localStorage.setItem(kbStaleHintDismissKey(conversationId), '1');
    setDismissed(true);
  }, [conversationId]);

  return {
    visible: shouldShowKbStaleHint({ conversationId, projectId, sessionMcpServers, hasIndexedSource, dismissed }),
    dismiss,
  };
};
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
bunx vitest run tests/unit/renderer/conversation/useKbStaleChatHint.dom.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/knowledge/useKbStaleChatHint.ts tests/unit/renderer/conversation/useKbStaleChatHint.dom.test.ts
git commit -m "feat(knowledge): track stale-chat hint readiness and dismissal"
```

---

## Task 4: i18n keys across all 12 locales

Two keys. They go in a **new top-level `staleKnowledgeHint` block appended at the end** of each `conversation.json` — deliberately not inside the `projectHome` block, whose `knowledge*` keys another stream owns. `scripts/check-i18n.js` does not detect duplicate keys and `JSON.parse` is last-wins, so a bad text-merge fails silently; a fresh, uniquely named block at a location no other stream edits is the cheapest insurance.

**Files:** `packages/desktop/src/renderer/services/i18n/locales/<locale>/conversation.json` × 12, then the regenerated `i18n-keys.d.ts`.

- [ ] **Step 1: Add the block to en-US**

Append inside the root object of `packages/desktop/src/renderer/services/i18n/locales/en-US/conversation.json` (add a comma to the previously-last block):

```json
  "staleKnowledgeHint": {
    "body": "This chat can't search the project's knowledge base — it started before files were added.",
    "action": "Start a new chat"
  }
```

- [ ] **Step 2: Add the same block to the other 11 locales**

Same position and shape in each file. Translations:

`zh-CN`:
```json
  "staleKnowledgeHint": {
    "body": "此对话无法检索项目知识库 —— 它创建于添加文件之前。",
    "action": "新建对话"
  }
```

`zh-TW`:
```json
  "staleKnowledgeHint": {
    "body": "此對話無法檢索專案知識庫 —— 它建立於新增檔案之前。",
    "action": "新建對話"
  }
```

`ja-JP`:
```json
  "staleKnowledgeHint": {
    "body": "このチャットはプロジェクトのナレッジベースを検索できません。ファイルが追加される前に開始されたためです。",
    "action": "新しいチャットを開始"
  }
```

`ko-KR`:
```json
  "staleKnowledgeHint": {
    "body": "이 대화는 프로젝트 지식 베이스를 검색할 수 없습니다. 파일이 추가되기 전에 시작되었기 때문입니다.",
    "action": "새 대화 시작"
  }
```

`de-DE`:
```json
  "staleKnowledgeHint": {
    "body": "Dieser Chat kann die Wissensdatenbank des Projekts nicht durchsuchen – er wurde begonnen, bevor Dateien hinzugefügt wurden.",
    "action": "Neuen Chat starten"
  }
```

`es-ES`:
```json
  "staleKnowledgeHint": {
    "body": "Este chat no puede buscar en la base de conocimiento del proyecto: se inició antes de que se añadieran archivos.",
    "action": "Iniciar un chat nuevo"
  }
```

`pt-BR`:
```json
  "staleKnowledgeHint": {
    "body": "Este chat não pode pesquisar a base de conhecimento do projeto — ele começou antes de os arquivos serem adicionados.",
    "action": "Iniciar um novo chat"
  }
```

`ru-RU`:
```json
  "staleKnowledgeHint": {
    "body": "Этот чат не может искать в базе знаний проекта — он был начат до добавления файлов.",
    "action": "Начать новый чат"
  }
```

`uk-UA`:
```json
  "staleKnowledgeHint": {
    "body": "Цей чат не може шукати в базі знань проєкту — його розпочато до додавання файлів.",
    "action": "Почати новий чат"
  }
```

`tr-TR`:
```json
  "staleKnowledgeHint": {
    "body": "Bu sohbet projenin bilgi tabanında arama yapamaz — dosyalar eklenmeden önce başlatıldı.",
    "action": "Yeni sohbet başlat"
  }
```

`fa-IR`:
```json
  "staleKnowledgeHint": {
    "body": "این گفتگو نمی‌تواند در پایگاه دانش پروژه جست‌وجو کند — پیش از افزودن فایل‌ها آغاز شده است.",
    "action": "شروع گفتگوی جدید"
  }
```

- [ ] **Step 3: Regenerate the key union and validate**

```bash
bun run i18n:types && node scripts/check-i18n.js
```

Expected: `i18n-keys.d.ts` is rewritten to include `conversation.staleKnowledgeHint.body` and `.action`, and check-i18n exits 0. It exits 1 if the generated file is stale, so never skip the regeneration. Confirm both keys landed:

```bash
grep -c "conversation.staleKnowledgeHint" packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
```

Expected: `2`.

- [ ] **Step 4: Verify each locale has the block exactly once**

```bash
for f in packages/desktop/src/renderer/services/i18n/locales/*/conversation.json; do n=$(grep -c '"staleKnowledgeHint"' "$f"); echo "$n $f"; done | sort | uniq -c | head
```

Expected: 12 lines, every one starting with `1`. Any `2` is the silent duplicate-key failure — fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/services/i18n/locales packages/desktop/src/renderer/services/i18n/i18n-keys.d.ts
git commit -m "i18n(conversation): add stale knowledge hint strings"
```

---

## Task 5: The notice component

**Files:**
- Create: `packages/desktop/src/renderer/pages/conversation/knowledge/KbStaleChatHint.tsx`
- Test: `tests/unit/renderer/conversation/KbStaleChatHint.dom.test.tsx`

- [ ] **Step 1: Write the failing component test**

Per the house convention (`ProjectKnowledgeCard.dom.test.tsx:34-45`), `react-i18next` is mocked to return the raw key, so assertions are on key strings.

Create `tests/unit/renderer/conversation/KbStaleChatHint.dom.test.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUILTIN_KNOWLEDGE_NAME } from '@/common/knowledge/constants';
import KbStaleChatHint from '@/renderer/pages/conversation/knowledge/KbStaleChatHint';
import { kbStaleHintDismissKey } from '@/renderer/pages/conversation/knowledge/useKbStaleChatHint';

const listSourcesMock = vi.fn();
const navigateMock = vi.fn();

vi.mock('@/common', () => ({
  ipcBridge: {
    projectKnowledge: {
      listSources: { invoke: (...args: unknown[]) => listSourcesMock(...args) },
      updated: { on: () => () => undefined },
    },
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => navigateMock,
}));

const READY_SOURCE = {
  id: 's1',
  fileName: 'policy.pdf',
  byteSize: 10,
  status: 'ready',
  chunkCount: 4,
  vectorCount: 0,
  addedAt: 0,
  error: null,
  progress: null,
  ocr: null,
};

const STALE_PROPS = {
  conversationId: 'c1',
  projectId: 'p1',
  workspace: '/tmp/project',
  sessionMcpServers: [{ id: 'mcp_1', name: 'greennode-idp', transport: { type: 'stdio' } }],
};

const BODY_KEY = 'conversation.staleKnowledgeHint.body';
const ACTION_KEY = 'conversation.staleKnowledgeHint.action';

beforeEach(() => {
  localStorage.clear();
  listSourcesMock.mockReset().mockResolvedValue({ sources: [READY_SOURCE], summary: null, folderMissing: false });
  navigateMock.mockReset();
});

describe('KbStaleChatHint', () => {
  it('explains the problem and offers a new chat', async () => {
    render(<KbStaleChatHint {...STALE_PROPS} />);
    expect(await screen.findByText(BODY_KEY)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: ACTION_KEY })).toBeInTheDocument();
  });

  it('renders nothing for a chat that already has the knowledge server', async () => {
    render(
      <KbStaleChatHint
        {...STALE_PROPS}
        sessionMcpServers={[{ id: 'project-kb-p1', name: BUILTIN_KNOWLEDGE_NAME, transport: { type: 'stdio' } }]}
      />
    );
    await waitFor(() => expect(listSourcesMock).not.toHaveBeenCalled());
    expect(screen.queryByText(BODY_KEY)).not.toBeInTheDocument();
  });

  it('renders nothing for a non-project chat', async () => {
    render(<KbStaleChatHint {...STALE_PROPS} projectId={undefined} />);
    await waitFor(() => expect(listSourcesMock).not.toHaveBeenCalled());
    expect(screen.queryByText(BODY_KEY)).not.toBeInTheDocument();
  });

  it('renders nothing when the project has no indexed sources', async () => {
    listSourcesMock.mockResolvedValue({ sources: [], summary: null, folderMissing: false });
    render(<KbStaleChatHint {...STALE_PROPS} />);
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    expect(screen.queryByText(BODY_KEY)).not.toBeInTheDocument();
  });

  it('renders nothing once dismissed', async () => {
    localStorage.setItem(kbStaleHintDismissKey('c1'), '1');
    render(<KbStaleChatHint {...STALE_PROPS} />);
    await waitFor(() => expect(listSourcesMock).toHaveBeenCalled());
    expect(screen.queryByText(BODY_KEY)).not.toBeInTheDocument();
  });

  it('navigates to the project-scoped new chat with the project carried in router state', async () => {
    render(<KbStaleChatHint {...STALE_PROPS} />);
    fireEvent.click(await screen.findByRole('button', { name: ACTION_KEY }));
    expect(navigateMock).toHaveBeenCalledWith('/guid', { state: { workspace: '/tmp/project', projectId: 'p1' } });
  });

  it('closing it hides the notice and remembers the choice', async () => {
    const { container } = render(<KbStaleChatHint {...STALE_PROPS} />);
    expect(await screen.findByText(BODY_KEY)).toBeInTheDocument();
    const close = container.querySelector('.arco-alert-close-btn');
    expect(close).not.toBeNull();
    fireEvent.click(close as Element);
    await waitFor(() => expect(screen.queryByText(BODY_KEY)).not.toBeInTheDocument());
    expect(localStorage.getItem(kbStaleHintDismissKey('c1'))).toBe('1');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
bunx vitest run tests/unit/renderer/conversation/KbStaleChatHint.dom.test.tsx
```

Expected: FAIL — cannot resolve `KbStaleChatHint`.

- [ ] **Step 3: Write the component**

Create `packages/desktop/src/renderer/pages/conversation/knowledge/KbStaleChatHint.tsx`:

```tsx
/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import { Alert, Button } from '@arco-design/web-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PROJECT_CHAT_ROUTE, useKbStaleChatHint } from './useKbStaleChatHint';

/**
 * Explains, right where the confusion happens, why this chat cannot see the
 * project's knowledge base: its MCP server set was frozen at creation, before
 * any file was indexed. Offers the only actual fix — a new chat, which picks
 * up the current set. Renders nothing unless that is provably the situation.
 */
const KbStaleChatHint: React.FC<{
  conversationId?: string;
  projectId?: string;
  workspace?: string;
  sessionMcpServers?: unknown;
}> = ({ conversationId, projectId, workspace, sessionMcpServers }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const teamPermission = useTeamPermission();
  const { visible, dismiss } = useKbStaleChatHint({ conversationId, projectId, sessionMcpServers });

  if (!visible) return null;

  return (
    <div className={`${getChatSurfaceWidthClass(Boolean(teamPermission))} mb-8px`}>
      <Alert
        type='info'
        data-testid='kb-stale-chat-hint'
        closable
        onClose={dismiss}
        className='!rounded-8px'
        content={
          <div className='flex items-center justify-between gap-8px flex-wrap'>
            <span className='text-13px text-t-secondary'>{t('conversation.staleKnowledgeHint.body')}</span>
            <Button type='text' size='mini' onClick={() => void navigate(PROJECT_CHAT_ROUTE, { state: { workspace, projectId } })}>
              {t('conversation.staleKnowledgeHint.action')}
            </Button>
          </div>
        }
      />
    </div>
  );
};

export default KbStaleChatHint;
```

`getChatSurfaceWidthClass` is what the composer itself uses (`AcpSendBox.tsx:686`), so the notice lines up with the input rather than the full-bleed message column.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
bunx vitest run tests/unit/renderer/conversation/KbStaleChatHint.dom.test.tsx
```

Expected: PASS, 7 tests. If the close-button selector misses, print `container.innerHTML` and match Arco's actual close class rather than switching to a raw `<button>`.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/knowledge/KbStaleChatHint.tsx tests/unit/renderer/conversation/KbStaleChatHint.dom.test.tsx
git commit -m "feat(knowledge): add the stale-chat notice component"
```

---

## Task 6: Mount it beside the composer in both platform views

Project conversations exist in both the `aionrs` and `acp` runtimes (`useGuidSend.ts:262` and `:314` both attach the knowledge descriptor), so both views need it. `ChatConversation.tsx` owns the conversation record and already destructures `extra` for exactly this kind of prop.

**Files:**
- Modify: `packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx:226-240` (aionrs) and `:300-316` (acp)
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx`
- Modify: `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx`

- [ ] **Step 1: Thread the two `extra` fields from ChatConversation**

In the `<AionrsChat …>` element (`:226-240`), add after `loadedMcpStatuses`:

```tsx
        project_id={conversation.extra?.project_id}
        session_mcp_servers={
          (conversation.extra as { session_mcp_servers?: unknown } | undefined)?.session_mcp_servers
        }
```

In the `<AcpChat …>` element (`:300-316`), add the same two props after `loadedMcpStatuses`:

```tsx
            project_id={conversation.extra?.project_id}
            session_mcp_servers={
              (conversation.extra as { session_mcp_servers?: unknown } | undefined)?.session_mcp_servers
            }
```

If `conversation.extra?.project_id` does not type-check on either union member, use the same cast shape as the sibling line: `(conversation.extra as { project_id?: string } | undefined)?.project_id`.

- [ ] **Step 2: Accept and render in AionrsChat**

In `packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx`, add to the props type (after `assistantId?: string;`):

```ts
  project_id?: string;
  /** Frozen-at-create MCP snapshot; validated by the hint, not trusted here. */
  session_mcp_servers?: unknown;
```

add both to the destructuring list, add the import:

```ts
import KbStaleChatHint from '@/renderer/pages/conversation/knowledge/KbStaleChatHint';
```

and insert the notice between the message list and the composer (currently lines 84-85):

```tsx
          </FlexFullContainer>
          <KbStaleChatHint
            conversationId={conversation_id}
            projectId={project_id}
            workspace={workspace}
            sessionMcpServers={session_mcp_servers}
          />
          <AionrsSendBox
```

- [ ] **Step 3: Accept and render in AcpChat**

In `packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx`, add the identical two props to the type and destructuring, add the same import, and wrap the composer block (currently lines 89-101) so the notice appears only when there is a composer to explain:

```tsx
          <AcpE2EStreamInjector conversationId={conversation_id} />
          {!hideSendBox && (
            <>
              <KbStaleChatHint
                conversationId={conversation_id}
                projectId={project_id}
                workspace={workspace}
                sessionMcpServers={session_mcp_servers}
              />
              <AcpSendBox
                conversation_id={conversation_id}
                backend={backend}
                session_mode={session_mode}
                agent_name={agent_name}
                modelSelector={modelSelector}
                workspacePath={workspace}
                messageState={messageState}
                teamSendMessage={teamSendMessage}
                teamRuntime={teamRuntime}
              ></AcpSendBox>
            </>
          )}
```

- [ ] **Step 4: Typecheck and run the full suite**

```bash
bunx tsc --noEmit && bun run test 2>&1 | tail -25
```

Expected: no type errors; the suite passes with the ~4460 pre-existing tests plus the 44 new ones. Any failure in an existing `ChatConversation`/`AcpChat`/`AionrsChat` test means the new props broke a render — fix before continuing.

- [ ] **Step 5: Commit**

```bash
git add packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx
git commit -m "feat(knowledge): show the stale-chat notice beside the composer"
```

---

## Task 7: Case B — verify before building anything

Case B is "files added mid-chat are invisible to a chat that *does* have the tool". The design doc's reading of the dev logs is that aioncore reconnects the session MCP every turn, so the subprocess re-reads the store and mid-chat additions are searchable on the next message — making a Case-B notice pure noise. **Verify empirically. Do not build Case B "just in case", and do not skip the experiment.**

- [ ] **Step 1: Launch the dev app (only one instance at a time)**

Follow the project's dev-run procedure. If aioncore fails at boot with a migration mismatch, reset the dev DB as documented rather than editing migrations. Confirm no second dev app is already running before starting.

- [ ] **Step 2: Set up the experiment**

1. Open (or create) a project chat that **has** the tool — confirm with:
   ```bash
   sqlite3 -readonly ~/.aionui-dev/aionui-backend.db "SELECT substr(id,1,8), (extra LIKE '%aionui-project-knowledge%') AS has_kb FROM conversations WHERE json_extract(extra,'\$.project_id') IS NOT NULL ORDER BY created_at DESC LIMIT 5;"
   ```
2. Send one message so the session is live.
3. Drop a new file into the project's `Knowledge Base/` folder containing a fact that appears nowhere else — e.g. a line like `The Q3 offsite budget code is ZX-4417.`
4. Wait for the Knowledge card to show it as ready.

- [ ] **Step 3: Ask, on the next turn, a question only that file answers**

Ask e.g. "What is the Q3 offsite budget code?" in the **same** conversation.

- [ ] **Step 4: Record the outcome and act on it**

- **The assistant finds it** → Case B is not real. **Build nothing for B.** Capture the aioncore log lines showing the per-turn MCP reconnect (grep the dev log for the session's MCP connect messages) and record them, with this conclusion, in the MR description and in Task 8's report.
- **The assistant does not find it** → Case B is real. Only then extend the existing component with a second variant: copy for "the knowledge base changed — new chats will see the latest files", triggered when a `projectKnowledge.updated` event for this project lands with a timestamp after the conversation's `created_at`, reusing the same dismiss mechanics, plus 2 more keys × 12 locales. Add its own truth-table tests mirroring Task 2.

Write the verdict, the exact question asked, the exact answer received, and the log evidence into `docs/superpowers/plans/2026-07-31-kb-stale-chat-hint.md` under a new "Case B outcome" section, so the question stays answered for the next person.

- [ ] **Step 5: Live-verify Case A in the same session**

1. Create a project with **no** knowledge files. Start a chat in it. Send a message.
2. Add a file to its `Knowledge Base/`; wait for ready.
3. **Expected:** the notice appears in that old chat, next to the composer.
4. Click "Start a new chat" → lands on the project-scoped new-chat screen; ask about the file → the new chat answers from it.
5. Back in the old chat, dismiss the notice → it disappears. Reload the app (Cmd+R / restart) → it stays dismissed.
6. Open a *different* project chat that lacks the tool → its notice is still shown (dismissal did not leak).
7. Open a project chat that **has** the tool → no notice.

Capture a screenshot of the notice in light and dark mode. Any deviation is a bug to fix before the gate, not a note to file.

---

## Task 8: Gate, coordination note, and handoff

- [ ] **Step 1: Run the full gate**

```bash
bun run test 2>&1 | tail -20
```

```bash
bunx tsc --noEmit && bun run lint:fix && node scripts/check-i18n.js
```

Expected: all tests pass; zero type errors; lint reports **0 errors** (the ~847 warnings are the pre-existing baseline — judge by errors); check-i18n exits 0.

Format only what this branch touched, never the tree:

```bash
bunx oxfmt packages/desktop/src/renderer/pages/conversation/knowledge packages/desktop/src/renderer/pages/conversation/platforms/acp/AcpChat.tsx packages/desktop/src/renderer/pages/conversation/platforms/aionrs/AionrsChat.tsx packages/desktop/src/renderer/pages/conversation/components/ChatConversation.tsx packages/desktop/src/common/knowledge/constants.ts tests/unit/renderer/conversation
```

If `lint:fix` also rewrites `DashboardStoreService.test.ts` (`.sort()` → `.toSorted()`), revert that file — it is documented pre-existing drift owned by nobody on this branch.

- [ ] **Step 2: Confirm nothing out of scope changed**

```bash
git diff --stat origin/sprint1...HEAD
```

Expected: only the files listed in this plan. `ipcBridge.ts` must not appear — the feature adds zero IPC channels. Confirm:

```bash
git diff origin/sprint1...HEAD -- packages/desktop/src/common/adapter/ipcBridge.ts | wc -l
```

Expected: `0`.

- [ ] **Step 3: Record the cross-stream overlap**

Append to the "Escalations" section of `docs/superpowers/plans/ui-improvements-streams.md` (a gitignored working doc):

```
- **KB stale-chat hint (branch `feat/kb-stale-chat-hint`, off sprint1@d60397537)
  touched three files nominally owned by S3:** `pages/conversation/index.tsx` was
  NOT touched, but `components/ChatConversation.tsx`, `platforms/acp/AcpChat.tsx`
  and `platforms/aionrs/AionrsChat.tsx` each gained two pass-through props
  (`project_id`, `session_mcp_servers`) and, in the two platform views, one
  `<KbStaleChatHint />` between the message list and the send box. No S3 branch
  existed at the time. New i18n lives in its own top-level
  `conversation.staleKnowledgeHint` block appended at the end of each
  conversation.json — it does not touch S4's `projectHome` block.
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "docs(knowledge): record the stale-chat hint verification outcome"
```

- [ ] **Step 5: Report — do not push or open an MR without explicit approval**

Summarize for the user: what shipped for Case A, the Case-B verdict with its evidence, gate results with real numbers, the live-verification observations, and the cross-stream note. State explicitly that nothing has been pushed. Draft MR text (including the Case-B finding, so the question stays answered) and offer to push on approval.

---

## Case B outcome — VERIFIED REAL (2026-07-31)

The design doc predicted Case B was probably not real, reasoning that aioncore reconnects
the session MCP per turn so the subprocess would re-read the store. **The experiment
contradicts that.** Files added mid-chat are invisible to the running session.

Setup: project `kb-stale-test`, chat `ee2a6578` (created *with* the knowledge server).
`offsite-notes.md` was indexed before the chat started; `vendor-contacts.md` was added to
`Knowledge Base/` mid-conversation and reached `status: ready, chunkCount: 1` in the
manifest before any question was asked.

The decisive turn asked the **already-running** chat to run two searches. Same message,
same subprocess, from `messages` in `~/.aionui-dev-2/aionui-backend.db`:

```
query "Q3 offsite budget code"  → Found 1 passage(s) … [1] offsite-notes.md …   (indexed BEFORE the session)
query "Lumenpath Rentals"       → No relevant passages found …                  (indexed AFTER the session)
```

An exact-name query returning nothing rules out a ranking miss. The control: a **fresh**
chat in the same project, same query string, ran immediately after —

```
query "after-hours dispatch passphrase AV equipment vendor"
  → Found 1 passage(s) … [1] vendor-contacts.md … HALCYON-2291
```

Same store on disk, same project, opposite results. The only variable is whether the
knowledge subprocess was spawned before or after the file was indexed, so the running
session serves a **snapshot frozen at spawn time**. Earlier in the same conversation the
mid-chat file had already failed twice ("No relevant passages found") on two differently
phrased queries.

**Consequence:** Case B ships (Task 9). Note the staleness is per-session, not permanent —
a restart respawns the subprocess and un-stales the chat, which is why the Case-B trigger
is deliberately in-session/ephemeral rather than persisted.

## Task 9: Case B — the knowledge-changed notice

Trigger, all renderer-side, reusing the same component and dismiss mechanics:
the conversation is project-scoped, it **does** have the knowledge server (a chat without
it is Case A, not this), a knowledge source that was not present when the view mounted has
since become ready, and the notice has not been dismissed for this conversation.

The signal is deliberately **ephemeral** — it is derived from a source appearing during
this mount, not persisted. That mirrors the real mechanism: the session's subprocess is
stale only until it respawns, so forgetting on reload fails closed rather than nagging
about a chat that can now search. Progress ticks on an already-known source must not fire
it; only a genuinely new ready source counts.

Dismissal uses a separate key (`kb.changedHint.dismissed.<id>`) so silencing one notice
does not silence the other. Copy: "The knowledge base changed — new chats will see the
latest files." reusing the existing `action` string. Keys × 12 locales.

## Self-review against the spec

- §2 trigger, all four conditions — Task 2 (predicate, 16-cell truth table) + Task 3 (readiness via existing `listSources`, refreshed on `projectKnowledge.updated`; per-conversation `localStorage` dismissal). Discovery step done up front: the conversation record with `extra` is already in the page's SWR entry (`pages/conversation/index.tsx:21-23`) and flows to `ChatConversation` — nothing is refetched.
- §2 constant, no magic string, no renderer→process import — Task 1 moves the single definition to `common/knowledge/constants.ts`.
- §3 presentation: single-line Arco `Alert`, neutral `info` tone, semantic tokens, near the composer, reuses the existing `/guid` project-chat navigation, `localStorage` dismissal, never shown in non-project / has-tool / no-sources / loading states — Tasks 5 and 6.
- §4 Case B verified before any build — Task 7. It came back **real**, contradicting the
  design doc's prediction, so §4's second branch applies and Task 9 ships it: same
  component, `changedBody` copy, same dismiss mechanics on a separate key, keys × 12.
- §6 tests: truth table, dismiss persistence and isolation, navigation args, DOM presence/absence, plus live verification — Tasks 2, 3, 5, 7.
- §7 out of scope: no auto-migration of old chats, no descriptor/attach changes, no Project Home or sidebar hints, no Knowledge card or retrieval changes, zero new IPC channels — asserted mechanically in Task 8 Step 2.

---

## Outcome (appended 2026-07-31, after implementation)

Shipped into `sprint1` as MR !21 (feature) + MR !22 (fix). **Case B was built and then
removed** — read the Case B tasks above as history, not as the shipped design.

The plan's Case B premise ("the knowledge subprocess serves a store snapshot frozen at
spawn") is **wrong**. `process/resources/builtinMcp/knowledgeServer.ts:101,109` initializes
`storePromise` lazily *inside* the request handler, so the store freezes at the **first
`search_project_knowledge` call**, not at spawn. The live experiment that appeared to confirm
the spawn theory had already run a search before the second file was added — so it froze the
store itself and could not distinguish the two hypotheses.

Consequently the `changed` trigger ("a source became ready after the view mounted") was
neither necessary nor sufficient, and produced false positives on ordinary paths: a chat that
had not yet searched would be told it could not see a file it *would* find, and because
`useGuidSend.ts:221` fires `syncFolder` un-awaited at creation, a brand-new chat could be told
to start a new chat seconds after being started. A correct trigger would need to know both
whether the session has already searched and whether it has since respawned; the latter is not
observable from the renderer, so the notice was removed rather than approximated.

Case A (`stale`) shipped as planned and was live-verified. It rests on
`extra.session_mcp_servers`, which genuinely cannot change after creation.

MR !22 also fixed four defects found by self-review: `hasIndexedSource` not being reset when
`projectId` changed (failed *open*), unsequenced overlapping refetches, `session_mcp_servers`
cast to `unknown` when it was already typed `ISessionMcpServer[]`, and two Arco `Alert`
accessibility defects (assertive `role="alert"`, unlabeled close button).
