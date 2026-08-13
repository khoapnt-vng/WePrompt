/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `vi.hoisted`, not four bare `const … = vi.fn()`. `vi.mock` calls are hoisted above every top-level
 * declaration, and the factories below dereference these spies immediately (`invoke: harness.update`
 * is evaluated when the factory runs, which is when the statically imported hook first pulls the
 * mocked module in). Plain consts are still in their temporal dead zone at that moment and the file
 * dies with `Cannot access 'update' before initialization`. The sibling spec in this same directory
 * uses exactly this shape for exactly this reason (`BriefConversation.dom.test.tsx:22-32`).
 */
const harness = vi.hoisted(() => ({
  update: vi.fn(async () => true),
  getBriefSessionServer: vi.fn(),
  bindBriefConversation: vi.fn(),
  createStudioBriefConversation: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    conversation: { update: { invoke: harness.update }, create: { invoke: vi.fn() } },
    creativeStudio: {
      getBriefSessionServer: { invoke: harness.getBriefSessionServer },
      bindBriefConversation: { invoke: harness.bindBriefConversation },
    },
  },
}));
vi.mock('@/renderer/hooks/agent/useModelProviderList', () => ({
  useProvidersQuery: () => ({ data: [], error: null }),
}));
/**
 * `modelList` must be NON-EMPTY. `noModelConfigured` is `providersResolved && modelList.length === 0`
 * (useBriefConversation.ts:151-152), and the start effect returns on it before it ever creates
 * anything (`:155-159`) — so an empty list makes the third test's `recreate()` a no-op that reports a
 * missing model instead of minting a conversation.
 */
/*
 * MODULE SCOPE, NOT INLINE LITERALS — this is what keeps the third test from hanging.
 * `current_model` is a dep of the start effect (useBriefConversation.ts:195). A factory returning a
 * fresh object each call changes identity on every render, so the effect re-runs every render; after
 * `recreate()` sets `ignoredConversationId`, `resolveBoundState` returns `absent` (`:35`) so the
 * effect no longer early-returns at `:155`, re-subscribes to the settled promise, and `setState` at
 * `:182` renders again — forever. Stable identities break the loop. The sibling spec already does
 * this deliberately: `BriefConversation.dom.test.tsx:23` holds its array in module scope.
 */
const currentModel = { id: 'p', use_model: 'm' };
const modelList = [currentModel];
vi.mock('@/renderer/pages/guid/hooks/useGuidModelSelection', () => ({
  useGuidModelSelection: () => ({ current_model: currentModel, modelList }),
}));
/**
 * Mocked because the third test drives the REAL `recreate()`, which goes through the create path.
 * Nothing else in this spec reaches it: the first two tests resolve to `ready` straight from
 * `resolveBoundState` and never start.
 */
vi.mock('@/renderer/pages/studio/components/PhaseShell/phases/studioBriefConversation', () => ({
  createStudioBriefConversation: harness.createStudioBriefConversation,
}));

/**
 * The conversation already carries a populated `context_handoff` — a user pin, a snapshot revision
 * and an exported context file. That is the regression guard for the patch shape: `merge_extra`
 * merges at the `extra` level, NOT inside `context_handoff`, so a bare
 * `{ context_handoff: { pinned_context } }` would replace the whole sub-object and wipe every one of
 * these fields on every rules change.
 */
const contextHandoff = {
  pinned_context: [
    {
      id: 'pin_user',
      title: 'User pin',
      content: 'Remember the launch date.',
      source: 'manual' as const,
      created_at: 1,
      updated_at: 1,
    },
  ],
  revision: 4,
  context_file_path: '/tmp/context.md',
  context_file_name: 'context.md',
  turns_since_compaction: 2,
};

const conversation = {
  id: 'conversation_brief',
  type: 'aionrs' as const,
  extra: {
    workspace: '',
    custom_workspace: false,
    studio_project_id: 'project_1',
    context_handoff: contextHandoff,
  },
};

/** What `recreate()` produces: a different conversation id, the same project, the same rules. */
const recreatedConversation = { ...conversation, id: 'conversation_brief_recreated' };

/* Module scope for the same reason as `currentModel` above: `boundState` is a `useMemo` keyed on
 * `allConversations` (useBriefConversation.ts:130-133), so a fresh array per render re-runs the
 * start effect on every render and the third test never settles. */
const allConversations = [conversation, recreatedConversation];
vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({ allConversations }),
}));

import {
  forgetDirectorConversationStart,
  useBriefConversation,
} from '@/renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';

// `briefConversationId` is fixed: the recreated conversation is reached through `recreate()`, not by
// handing the hook a different id — see the third test.
const project = (revision: number, rules: unknown[]) =>
  ({
    id: 'project_1',
    name: 'Launch film',
    revision,
    briefConversationId: 'conversation_brief',
    rules,
  }) as never;

const rule = {
  id: 'rule_1',
  scope: 'project',
  text: 'No competitor logos.',
  predicate: null,
  createdAt: '2026-08-13T00:00:00.000Z',
};

type UpdatePayload = {
  id: string;
  merge_extra?: boolean;
  updates: {
    extra: {
      context_handoff: {
        pinned_context: { id: string; content: string }[];
        revision?: number;
        context_file_path?: string;
        turns_since_compaction?: number;
      };
    };
  };
};

/** Everything `recreate()`'s create path needs; only the third test reaches any of it. */
const descriptor = {
  id: 'studio-brief-project_1',
  name: 'aionui-creative-studio',
  transport: { type: 'stdio' as const, command: 'node', args: ['/tmp/builtin-mcp-studio.js'] },
};

describe('the Studio brief rules pin', () => {
  beforeEach(() => {
    harness.update.mockClear();
    // `startedProjects` is module scope and survives every test in this file, so a start attempt from
    // one test would make the next one's `recreate()` reuse a settled promise (useBriefConversation.ts:59).
    forgetDirectorConversationStart();
    harness.getBriefSessionServer.mockReset().mockResolvedValue({ ok: true, data: descriptor });
    harness.bindBriefConversation.mockReset().mockResolvedValue({ ok: true, data: {} });
    harness.createStudioBriefConversation.mockReset().mockResolvedValue(recreatedConversation);
  });

  it('writes the rules into pinned_context without disturbing the rest of context_handoff', async () => {
    renderHook(() => useBriefConversation(project(3, [rule])));

    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
    const [payload] = harness.update.mock.calls[0] as [UpdatePayload];
    expect(payload.id).toBe('conversation_brief');
    expect(payload.merge_extra).toBe(true);
    const patched = payload.updates.extra.context_handoff;
    expect(patched.pinned_context.map((pin) => pin.id)).toEqual(['pin_user', 'studio_brief_rules']);
    expect(patched.pinned_context[1].content).toContain('No competitor logos.');
    // Everything the patch must NOT drop.
    expect(patched.revision).toBe(4);
    expect(patched.context_file_path).toBe('/tmp/context.md');
    expect(patched.turns_since_compaction).toBe(2);
  });

  it('does not rewrite the pin when nothing about the rules changed', async () => {
    const { rerender } = renderHook(
      ({ revision }: { revision: number }) => useBriefConversation(project(revision, [rule])),
      {
        initialProps: { revision: 3 },
      }
    );

    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
    rerender({ revision: 4 });
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
  });

  it('writes the pin into a recreated conversation even though the rules did not change', async () => {
    const { result } = renderHook(() => useBriefConversation(project(3, [rule])));

    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(1));
    expect((harness.update.mock.calls[0][0] as UpdatePayload).id).toBe('conversation_brief');

    // The REAL recreate path, not a prop change. `recreate()` forgets the start guard, marks the old
    // conversation ignored, resets `state` to `absent` and bumps `attempt`
    // (useBriefConversation.ts:197-205); the start effect then runs and installs the new conversation
    // at `:182`. A prop rerender cannot reach this state and would make this test assert nothing: the
    // hook deliberately refuses to re-derive `state` from `boundState` once it is ready (`:143-147`),
    // so `state.conversation.id` — and with it the effect's `conversationId` — would never move.
    act(() => result.current.recreate());

    // With a content-only dedupe signature the rules text is unchanged, the signature matches, the
    // effect returns early, and the new conversation carries no Studio pin for the rest of the
    // renderer's life. The conversation id inside the signature is the whole reason this second write
    // happens.
    await waitFor(() => expect(harness.update).toHaveBeenCalledTimes(2));
    expect((harness.update.mock.calls[1][0] as UpdatePayload).id).toBe('conversation_brief_recreated');
  });
});
