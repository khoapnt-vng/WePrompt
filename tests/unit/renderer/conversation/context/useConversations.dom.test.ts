/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import type { TimelineSection } from '@/renderer/pages/conversation/GroupedHistory/types';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  activeId: 'conversation-1' as string | undefined,
  pathname: undefined as string | undefined,
  activeCompletion: undefined as { completedAt: number; seenAt?: number } | undefined,
  markCompletionSeen: vi.fn(),
  refreshConversationRuntime: vi.fn(),
  pinnedConversations: [] as TChatConversation[],
  timelineSections: [] as TimelineSection[],
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: harness.pathname ?? (harness.activeId ? `/conversation/${harness.activeId}` : '/') }),
}));

vi.mock('@/renderer/hooks/context/ConversationHistoryContext', () => ({
  useConversationHistoryContext: () => ({
    conversations: [],
    isConversationGenerating: vi.fn(),
    getRecentCompletionAt: vi.fn(),
    getCompletion: () => harness.activeCompletion,
    getRecentStoppedAt: vi.fn(),
    getRecentFailureAt: vi.fn(),
    markCompletionSeen: harness.markCompletionSeen,
    refreshConversationRuntime: harness.refreshConversationRuntime,
    groupedHistory: {
      pinnedConversations: harness.pinnedConversations,
      timelineSections: harness.timelineSections,
    },
  }),
}));

import { useConversations } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversations';
import { WORKSPACE_EXPANSION_STORAGE_KEY } from '@/renderer/pages/conversation/GroupedHistory/hooks/useWorkspaceExpansionState';

const projectConversation: TChatConversation = {
  id: 'project-conversation-1',
  name: 'Project conversation',
  created_at: 1,
  updated_at: 1,
  status: 'finished',
  platform: 'acp',
  extra: { backend: 'codex', workspace: '/w/alpha', project_id: 'project-1' },
};

const projectTimeline = (): TimelineSection[] => [
  {
    timeline: 'Today',
    items: [
      {
        type: 'workspace',
        time: 1,
        workspaceGroup: {
          workspace: '/w/alpha',
          display_name: 'Alpha Project',
          conversations: [projectConversation],
        },
      },
    ],
  },
];

describe('useConversations completion state', () => {
  beforeEach(() => {
    harness.activeId = 'conversation-1';
    harness.pathname = undefined;
    harness.activeCompletion = undefined;
    harness.markCompletionSeen.mockReset();
    harness.refreshConversationRuntime.mockReset();
    harness.pinnedConversations = [];
    harness.timelineSections = [];
    localStorage.clear();
  });

  it('marks an unseen completion seen when its route is active', () => {
    harness.activeCompletion = { completedAt: 1_000 };
    renderHook(() => useConversations());

    expect(harness.markCompletionSeen).toHaveBeenCalledWith('conversation-1');
  });

  it('marks a completion seen when it arrives for an already active route', () => {
    const rendered = renderHook(() => useConversations());
    expect(harness.markCompletionSeen).not.toHaveBeenCalled();

    harness.activeCompletion = { completedAt: 2_000 };
    rendered.rerender();

    expect(harness.markCompletionSeen).toHaveBeenCalledWith('conversation-1');
  });

  it('does not mark an already seen completion again', () => {
    harness.activeCompletion = { completedAt: 1_000, seenAt: 1_500 };
    renderHook(() => useConversations());

    expect(harness.markCompletionSeen).not.toHaveBeenCalled();
  });

  it('does not query a Studio project id as a conversation id', () => {
    harness.pathname = '/studio/project_1';

    renderHook(() => useConversations());

    expect(harness.refreshConversationRuntime).not.toHaveBeenCalled();
    expect(harness.markCompletionSeen).not.toHaveBeenCalled();
  });

  it('preserves an explicitly collapsed project list after remounting', async () => {
    harness.activeId = undefined;
    harness.timelineSections = projectTimeline();
    localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify([]));

    const firstRender = renderHook(() => useConversations());
    await waitFor(() => expect(firstRender.result.current.expandedWorkspaces).toEqual([]));
    firstRender.unmount();

    const secondRender = renderHook(() => useConversations());
    await waitFor(() => expect(secondRender.result.current.expandedWorkspaces).toEqual([]));
    expect(localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY)).toBe('[]');
  });

  it('persists a manual project collapse', async () => {
    harness.activeId = undefined;
    harness.timelineSections = projectTimeline();
    localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify(['/w/alpha']));

    const rendered = renderHook(() => useConversations());
    await waitFor(() => expect(rendered.result.current.expandedWorkspaces).toEqual(['/w/alpha']));

    act(() => rendered.result.current.handleToggleWorkspace('/w/alpha'));

    await waitFor(() => expect(rendered.result.current.expandedWorkspaces).toEqual([]));
    expect(localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY)).toBe('[]');
  });

  it('reveals the active chat when navigation opens it inside a collapsed project', async () => {
    harness.activeId = projectConversation.id;
    harness.timelineSections = projectTimeline();
    localStorage.setItem(WORKSPACE_EXPANSION_STORAGE_KEY, JSON.stringify([]));

    const rendered = renderHook(() => useConversations());

    await waitFor(() => expect(rendered.result.current.expandedWorkspaces).toEqual(['/w/alpha']));
    expect(localStorage.getItem(WORKSPACE_EXPANSION_STORAGE_KEY)).toBe(JSON.stringify(['/w/alpha']));
  });
});
