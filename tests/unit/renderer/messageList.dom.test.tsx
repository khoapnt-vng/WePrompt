/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { type PropsWithChildren } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { IMessageAcpToolCall, IMessageText, TMessage } from '@/common/chat/chatLib';
import type { MessagePaginationState } from '@/renderer/pages/conversation/Messages/hooks';
import {
  MessageListLoadingProvider,
  MessageListProvider,
  MessagePaginationProvider,
} from '@/renderer/pages/conversation/Messages/hooks';
import MessageList from '@/renderer/pages/conversation/Messages/MessageList';
import type { WorkJournalSourceMessage } from '@/renderer/pages/conversation/Messages/types';
import { CHAT_MESSAGE_JUMP_EVENT } from '@/renderer/utils/chat/chatMinimapEvents';

const { scrollElementIntoViewMock, useConversationArtifactsMock, useTeamPermissionMock, autoScrollState } = vi.hoisted(
  () => ({
    scrollElementIntoViewMock: vi.fn(),
    useConversationArtifactsMock: vi.fn(),
    useTeamPermissionMock: vi.fn(),
    autoScrollState: { showScrollButton: false, scrollToBottom: vi.fn() },
  })
);
const workSummaryMessagesMock = vi.hoisted(() => vi.fn());
const loadConversationMessagePageMock = vi.hoisted(() => vi.fn());

vi.mock('@/renderer/utils/chat/messagePagination', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/renderer/utils/chat/messagePagination')>();
  return { ...actual, loadConversationMessagePage: loadConversationMessagePageMock };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? _key,
  }),
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => ({
    key: 'location-key',
    state: {},
  }),
}));

vi.mock('@arco-design/web-react', () => ({
  Image: {
    PreviewGroup: ({ children }: PropsWithChildren) => <>{children}</>,
  },
  Button: ({
    children,
    icon,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: React.ReactNode; shape?: string }) => (
    <button type='button' {...props}>
      {icon}
      {children}
    </button>
  ),
  Tooltip: ({ children }: PropsWithChildren) => <>{children}</>,
}));

vi.mock('@/renderer/hooks/context/ConversationContext', () => ({
  useConversationContextSafe: () => ({ conversation_id: 'conversation-1', type: 'aionrs' }),
}));

vi.mock('@/renderer/pages/team/hooks/TeamPermissionContext', () => ({
  useTeamPermission: useTeamPermissionMock,
}));

let mockIsProcessing = false;
vi.mock('@/renderer/pages/conversation/runtime/useConversationRuntimeView', () => ({
  useConversationRuntimeView: () => ({ isProcessing: mockIsProcessing }),
}));

vi.mock('@/renderer/hooks/file/useAutoPreviewOfficeFiles', () => ({
  useAutoPreviewOfficeFiles: () => {},
}));

vi.mock('@/renderer/pages/conversation/Messages/artifacts', () => ({
  useConversationArtifacts: useConversationArtifactsMock,
}));

vi.mock('@/renderer/pages/conversation/Messages/useAutoScroll', () => ({
  useAutoScroll: () => ({
    handleScrollerRef: () => {},
    handleContentRef: () => {},
    handleScroll: () => {},
    handleWheel: () => {},
    handlePointerDown: () => {},
    get showScrollButton() {
      return autoScrollState.showScrollButton;
    },
    scrollToBottom: autoScrollState.scrollToBottom,
    scrollElementIntoView: scrollElementIntoViewMock,
    hideScrollButton: () => {},
  }),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageText', () => ({
  default: ({ message, showCopyRow }: { message: IMessageText; showCopyRow?: boolean }) => (
    <div data-testid={`msgtext-${message.id}`} data-copy-row={String(showCopyRow ?? true)}>
      {message.content.content}
    </div>
  ),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageTips', () => ({
  default: () => <div>tips</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolCall', () => ({
  default: () => <div>tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroup', () => ({
  default: () => <div>tool_group</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageAgentStatus', () => ({
  default: () => <div>agent_status</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePermission', () => ({
  default: () => <div>permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpPermission', () => ({
  default: () => <div>acp_permission</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/acp/MessageAcpToolCall', () => ({
  default: () => <div>acp_tool_call</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessagePlan', () => ({
  default: () => <div>plan</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageThinking', () => ({
  default: () => <div>thinking</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageCronTrigger', () => ({
  default: () => <div>cron_trigger</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageSkillSuggest', () => ({
  default: () => <div>skill_suggest</div>,
}));

vi.mock('@/renderer/pages/conversation/Messages/components/MessageToolGroupSummary', () => ({
  default: ({ messages, isActive }: { messages: WorkJournalSourceMessage[]; isActive: boolean }) => {
    workSummaryMessagesMock(messages);
    return (
      <div data-testid='work-summary' data-active={String(isActive)}>
        {messages.map((message) => message.type).join(',')}
      </div>
    );
  },
}));

vi.mock('@/renderer/pages/conversation/Messages/MessageFileChanges', () => ({
  __esModule: true,
  default: () => <div>file_changes</div>,
  parseDiff: vi.fn(),
}));

vi.mock('@/renderer/pages/conversation/Messages/components/SelectionReplyButton', () => ({
  default: () => null,
}));

vi.mock('@icon-park/react', () => ({
  Down: () => <span>down</span>,
}));

function createTextMessage(): IMessageText {
  return {
    id: 'message-1',
    msg_id: 'msg-1',
    conversation_id: 'conversation-1',
    type: 'text',
    position: 'left',
    content: {
      content: 'streaming reply',
    },
    created_at: 1,
  };
}

function Wrapper({
  children,
  messages = [createTextMessage()],
  loading = false,
  pagination = { hasMoreBefore: false, hasMoreAfter: false, isLoadingBefore: false, isLoadingAnchor: false },
}: PropsWithChildren<{ messages?: TMessage[]; loading?: boolean; pagination?: MessagePaginationState }>): JSX.Element {
  return (
    <MessageListLoadingProvider value={loading}>
      <MessagePaginationProvider value={pagination}>
        <MessageListProvider value={messages}>{children}</MessageListProvider>
      </MessagePaginationProvider>
    </MessageListLoadingProvider>
  );
}

describe('MessageList', () => {
  beforeEach(() => {
    mockIsProcessing = false;
    scrollElementIntoViewMock.mockReset();
    useConversationArtifactsMock.mockReturnValue([]);
    useTeamPermissionMock.mockReturnValue(null);
    workSummaryMessagesMock.mockReset();
    loadConversationMessagePageMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders message rows with external margin spacing in the plain scroll list', () => {
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    expect(screen.getByTestId('message-list-scroller')).toBeInTheDocument();
    expect(screen.getByTestId('message-list-content')).toBeInTheDocument();

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('m-t-10px');
    expect(messageRow.className).not.toContain('pt-10px');
  });

  it('uses container-responsive fluid width for standalone message rows', () => {
    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('chat-surface-fluid');
    expect(messageRow.className).not.toContain('w-[calc(100%-24px)]');
    expect(messageRow.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
    expect(messageRow.className).not.toContain('max-w-780px');
  });

  it('uses the full available row width in team mode', () => {
    useTeamPermissionMock.mockReturnValue({
      isTeamMode: true,
      isLeaderAgent: true,
      leaderConversationId: 'conversation-1',
      allConversationIds: ['conversation-1'],
      propagateMode: vi.fn(),
      warmupSession: vi.fn().mockResolvedValue(undefined),
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
    });

    const messageRow = screen.getByTestId('message-text-left');
    expect(messageRow.className).toContain('w-full');
    expect(messageRow.className).toContain('max-w-full');
    expect(messageRow.className).not.toContain('w-[calc(100%-24px)]');
    expect(messageRow.className).not.toContain('md:w-[calc(100%-clamp(80px,10vw,240px))]');
  });

  it('shows the copy row only on the last AI text of each turn', () => {
    // Turn 1: thinking + text(a) + tool + text(b) -> row only on text(b).
    // A user message ends the turn. Turn 2: text(c) -> row on text(c).
    const messages = [
      { id: 'think-1', type: 'thinking', position: 'left', content: { content: 'thinking' }, created_at: 1 },
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 2 },
      { id: 'tool-1', type: 'tool_call', position: 'left', content: { content: 't' }, created_at: 3 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 4 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 5 },
      { id: 'text-c', type: 'text', position: 'left', content: { content: 'c' }, created_at: 6 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // Intermediate AI text (followed by a tool then another text) hides the row.
    expect(screen.getByTestId('msgtext-text-a').getAttribute('data-copy-row')).toBe('false');
    // Last AI text of turn 1 (after the tool block) keeps the row — fallback strategy.
    expect(screen.getByTestId('msgtext-text-b').getAttribute('data-copy-row')).toBe('true');
    // User message always keeps its own row.
    expect(screen.getByTestId('msgtext-user-1').getAttribute('data-copy-row')).toBe('true');
    // Turn 2's only/last text keeps the row.
    expect(screen.getByTestId('msgtext-text-c').getAttribute('data-copy-row')).toBe('true');
  });

  it('withholds the streaming turn copy row but keeps earlier finished turns', () => {
    mockIsProcessing = true;
    // Turn 1 finished (text-a), then a user message, then turn 2 still streaming (text-b).
    const messages = [
      { id: 'text-a', type: 'text', position: 'left', content: { content: 'a' }, created_at: 1 },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'q' }, created_at: 2 },
      { id: 'text-b', type: 'text', position: 'left', content: { content: 'b' }, created_at: 3 },
    ] as unknown as IMessageText[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // Earlier finished turn keeps its row even while a later turn streams.
    expect(screen.getByTestId('msgtext-text-a').getAttribute('data-copy-row')).toBe('true');
    // The in-progress final turn withholds its row until streaming ends.
    expect(screen.getByTestId('msgtext-text-b').getAttribute('data-copy-row')).toBe('false');
  });

  it('does not create a tool summary row for token watermark telemetry', () => {
    const messages = [
      {
        id: 'token-watermark-1',
        conversation_id: 'conversation-1',
        type: 'acp_tool_call',
        content: {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'tool_call_update',
            tool_call_id: 'token-watermark-1',
            status: 'completed',
            title: 'Token watermark override: provider=0, local_estimate=12520, using=12520',
            kind: 'info',
          },
        },
        created_at: 1,
      } satisfies IMessageAcpToolCall,
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.queryByTestId('work-summary')).not.toBeInTheDocument();
    expect(screen.queryByText(/Token watermark override/)).not.toBeInTheDocument();
  });

  it('groups plan, thinking, and tool messages into one renderer-only work summary', () => {
    const messages = [
      {
        id: 'plan-1',
        type: 'plan',
        position: 'left',
        content: { session_id: 's1', entries: [{ content: 'Review the activity flow', status: 'completed' }] },
        created_at: 1,
      },
      {
        id: 'thinking-1',
        type: 'thinking',
        position: 'left',
        content: { content: 'private detail', subject: 'Reviewing the activity flow', status: 'done' },
        created_at: 2,
      },
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 3,
      },
      {
        id: 'tool-2',
        type: 'acp_tool_call',
        position: 'left',
        content: {
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'tool_call_update',
            tool_call_id: 'call-2',
            status: 'completed',
            title: 'Search',
            kind: 'search',
          },
        },
        created_at: 4,
      },
      { id: 'answer-1', type: 'text', position: 'left', content: { content: 'Finished' }, created_at: 5 },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveTextContent(/^plan,thinking,tool_call,acp_tool_call$/);
    expect(screen.queryByText(/^plan$/)).not.toBeInTheDocument();
    expect(screen.queryByText(/^thinking$/)).not.toBeInTheDocument();
    expect(screen.getByText('Finished')).toBeInTheDocument();
  });

  it('groups one turn of work across visible assistant narration at the latest work position', () => {
    const messages = [
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'Please investigate' }, created_at: 1 },
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 2,
      },
      { id: 'narration-1', type: 'text', position: 'left', content: { content: 'I found the cause.' }, created_at: 3 },
      {
        id: 'tool-2',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Write', status: 'completed' },
        created_at: 4,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const summaries = screen.getAllByTestId('work-summary');
    expect(summaries).toHaveLength(1);
    expect(workSummaryMessagesMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'tool-1' }), expect.objectContaining({ id: 'tool-2' })])
    );
    expect(screen.getByText('I found the cause.').compareDocumentPosition(summaries[0])).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
  });

  it('starts a new work summary when a second visible user message starts another turn', () => {
    const messages = [
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'First request' }, created_at: 1 },
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 2,
      },
      { id: 'narration-1', type: 'text', position: 'left', content: { content: 'First update' }, created_at: 3 },
      {
        id: 'tool-2',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Write', status: 'completed' },
        created_at: 4,
      },
      { id: 'user-2', type: 'text', position: 'right', content: { content: 'Second request' }, created_at: 5 },
      {
        id: 'tool-3',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-3', name: 'Search', status: 'completed' },
        created_at: 6,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const summaries = screen.getAllByTestId('work-summary');
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toHaveTextContent('tool_call,tool_call');
    expect(summaries[1]).toHaveTextContent('tool_call');
  });

  it('places structured inline output at its chronological point inside the scrolling transcript', () => {
    const messages = [
      {
        id: 'director-1',
        type: 'text',
        position: 'left',
        content: { content: 'I prepared a handoff.' },
        created_at: 1,
      },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'Review it' }, created_at: 3 },
      { id: 'director-2', type: 'text', position: 'left', content: { content: 'I prepared another.' }, created_at: 5 },
    ] as unknown as TMessage[];

    render(
      <MessageList
        inlineItems={[
          { id: 'handoff-1', createdAt: 2, content: <section>Reviewed handoff</section> },
          { id: 'handoff-2', createdAt: 4, content: <section>Reviewed second handoff</section> },
        ]}
      />,
      { wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper> }
    );

    const transcript = screen.getByTestId('message-list-content');
    const firstMessage = screen.getByText('I prepared a handoff.');
    const handoff = screen.getByText('Reviewed handoff').closest('[data-message-inline-item="handoff-1"]');
    const nextMessage = screen.getByText('Review it');
    const secondHandoff = screen.getByText('Reviewed second handoff').closest('[data-message-inline-item="handoff-2"]');
    const lastMessage = screen.getByText('I prepared another.');
    expect(handoff).not.toBeNull();
    expect(secondHandoff).not.toBeNull();
    expect(transcript).toContainElement(handoff);
    expect(transcript).toContainElement(secondHandoff);
    expect(firstMessage.compareDocumentPosition(handoff!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(handoff!.compareDocumentPosition(nextMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(nextMessage.compareDocumentPosition(secondHandoff!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(secondHandoff!.compareDocumentPosition(lastMessage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps file summaries and artifacts independent from a turn work summary', () => {
    useConversationArtifactsMock.mockReturnValue([
      { id: 'artifact-1', kind: 'skill_suggest', status: 'pending', created_at: 6 },
    ]);
    const messages = [
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'Please update it' }, created_at: 1 },
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 2,
      },
      {
        id: 'file-1',
        type: 'tool_group',
        position: 'left',
        content: [
          {
            name: 'WriteFile',
            result_display: { file_diff: '@@ -1 +1 @@', file_name: 'notes.txt' },
          },
        ],
        created_at: 3,
      },
      { id: 'narration-1', type: 'text', position: 'left', content: { content: 'Saved the change.' }, created_at: 4 },
      {
        id: 'tool-2',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Verify', status: 'completed' },
        created_at: 5,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getAllByTestId('work-summary')).toHaveLength(1);
    expect(screen.getByTestId('work-summary')).toHaveTextContent('tool_call,tool_call');
    expect(screen.getByText('file_changes')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-artifact-skill_suggest')).toBeInTheDocument();
  });

  it('marks the turn work summary active while processing', () => {
    mockIsProcessing = true;
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
      { id: 'answer-1', type: 'text', position: 'left', content: { content: 'First result' }, created_at: 2 },
      {
        id: 'tool-2',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Write', status: 'in_progress' },
        created_at: 3,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const summaries = screen.getAllByTestId('work-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveAttribute('data-active', 'true');
  });

  it('settles a trailing work summary when processing stops', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveAttribute('data-active', 'false');
  });

  it('keeps the latest work summary active after nonterminal assistant narration', () => {
    mockIsProcessing = true;
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
      {
        id: 'narration-1',
        type: 'text',
        position: 'left',
        status: 'pending',
        content: { content: 'I found the relevant files.' },
        created_at: 2,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveAttribute('data-active', 'true');
  });

  it('settles the latest work summary after a terminal assistant answer', () => {
    mockIsProcessing = true;
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
      {
        id: 'answer-1',
        type: 'text',
        position: 'left',
        status: 'finish',
        content: { content: 'Finished' },
        created_at: 2,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveAttribute('data-active', 'false');
  });

  it.each([
    ['a permission prompt', { id: 'permission-1', type: 'permission', position: 'left', content: {}, created_at: 2 }],
    [
      'an error tip',
      { id: 'tips-1', type: 'tips', position: 'left', content: { content: 'Try again' }, created_at: 2 },
    ],
  ])('keeps the latest work summary active when followed by %s in the same turn', (_label, trailingMessage) => {
    mockIsProcessing = true;
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
      trailingMessage,
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveAttribute('data-active', 'true');
  });

  it('keeps the latest work summary active when followed by a file summary in the same turn', () => {
    mockIsProcessing = true;
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
      {
        id: 'file-change-1',
        type: 'tool_group',
        position: 'left',
        content: [
          {
            call_id: 'write-1',
            name: 'WriteFile',
            status: 'Success',
            result_display: { file_diff: 'diff --git a/file.txt b/file.txt', file_name: 'file.txt' },
          },
        ],
        created_at: 2,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveAttribute('data-active', 'true');
    expect(screen.getByText('file_changes')).toBeInTheDocument();
  });

  it('does not carry an active work summary across the next user message', () => {
    mockIsProcessing = true;
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'in_progress' },
        created_at: 1,
      },
      { id: 'user-1', type: 'text', position: 'right', content: { content: 'One more thing' }, created_at: 2 },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getByTestId('work-summary')).toHaveAttribute('data-active', 'false');
  });

  it('jumps a later work-summary source to the summary anchor', () => {
    const messages = [
      {
        id: 'plan-1',
        type: 'plan',
        position: 'left',
        content: { session_id: 's1', entries: [{ content: 'Review the activity flow', status: 'completed' }] },
        created_at: 1,
      },
      {
        id: 'thinking-1',
        type: 'thinking',
        position: 'left',
        content: { content: 'private detail', subject: 'Reviewing the activity flow', status: 'done' },
        created_at: 2,
      },
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 3,
      },
    ] as unknown as TMessage[];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const summaryAnchor = document.getElementById('message-plan-1');
    for (const messageId of ['plan-1', 'thinking-1', 'tool-1']) {
      window.dispatchEvent(
        new CustomEvent(CHAT_MESSAGE_JUMP_EVENT, {
          detail: { conversation_id: 'conversation-1', messageId },
        })
      );
    }

    expect(scrollElementIntoViewMock).toHaveBeenCalledTimes(3);
    expect(scrollElementIntoViewMock).toHaveBeenNthCalledWith(1, summaryAnchor, {
      block: 'start',
      behavior: 'smooth',
    });
    expect(scrollElementIntoViewMock).toHaveBeenNthCalledWith(2, summaryAnchor, {
      block: 'start',
      behavior: 'smooth',
    });
    expect(scrollElementIntoViewMock).toHaveBeenNthCalledWith(3, summaryAnchor, {
      block: 'start',
      behavior: 'smooth',
    });
  });

  it('keeps a permission visible between work messages in the same turn', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 1,
      },
      { id: 'permission-1', type: 'permission', position: 'left', content: {}, created_at: 2 },
      {
        id: 'tool-2',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Write', status: 'completed' },
        created_at: 3,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const summaries = screen.getAllByTestId('work-summary');
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toHaveTextContent('tool_call,tool_call');
    expect(screen.getByText('permission').compareDocumentPosition(summaries[0])).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('folds a terminal tool error into the same work summary as later work, with no standalone error banner', () => {
    const messages = [
      {
        id: 'tool-error-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-error-1', name: 'Read', status: 'error', error: 'Access denied' },
        created_at: 1,
      },
      { id: 'permission-1', type: 'permission', position: 'left', content: {}, created_at: 2 },
      {
        id: 'tool-success-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-success-1', name: 'Write', status: 'completed', output: 'Saved' },
        created_at: 3,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    // The red per-step failure banner is retired: a failed step no longer breaks
    // out on its own, it folds into the same turn work summary as later work.
    expect(screen.queryByTestId('tool-activity-error')).not.toBeInTheDocument();
    const permission = screen.getByText('permission');
    const summary = screen.getByTestId('work-summary');
    expect(permission.compareDocumentPosition(summary)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(workSummaryMessagesMock).toHaveBeenLastCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: 'tool-error-1' }),
        expect.objectContaining({ id: 'tool-success-1' }),
      ])
    );
  });

  it('keeps visible tools in one work summary across a hidden diagnostic', () => {
    const messages = [
      {
        id: 'tool-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 1,
      },
      {
        id: 'diagnostic-1',
        type: 'tool_call',
        position: 'left',
        hidden: true,
        content: {
          call_id: 'diagnostic-1',
          name: 'Token watermark override: provider=0, local_estimate=12520, using=12520',
          status: 'completed',
        },
        created_at: 2,
      },
      {
        id: 'tool-2',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Write', status: 'completed' },
        created_at: 3,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    expect(screen.getAllByTestId('work-summary')).toHaveLength(1);
    expect(screen.getByTestId('work-summary')).toHaveTextContent('tool_call,tool_call');
  });

  it('splits work summaries at a hidden renderer history gap', () => {
    const messages = [
      {
        id: 'tool-1',
        conversation_id: 'conversation-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Read', status: 'completed' },
        created_at: 1,
      },
      {
        id: 'renderer-history-gap:conversation-1',
        conversation_id: 'conversation-1',
        type: 'tips',
        position: 'center',
        hidden: true,
        content: { content: '', type: 'info', code: '__aionui_renderer_history_gap__' },
        created_at: 2,
      },
      {
        id: 'tool-2',
        conversation_id: 'conversation-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-2', name: 'Write', status: 'completed' },
        created_at: 3,
      },
    ] as unknown as TMessage[];

    render(<MessageList />, {
      wrapper: ({ children }) => <Wrapper messages={messages}>{children}</Wrapper>,
    });

    const summaries = screen.getAllByTestId('work-summary');
    expect(summaries).toHaveLength(2);
    expect(summaries[0]).toHaveTextContent('tool_call');
    expect(summaries[1]).toHaveTextContent('tool_call');
    expect(screen.queryByText('tips')).not.toBeInTheDocument();
  });

  it('renders the empty slot when there are no messages', () => {
    render(<MessageList emptySlot={<div>empty state</div>} />, {
      wrapper: ({ children }) => <Wrapper messages={[]}>{children}</Wrapper>,
    });

    expect(screen.getByText('empty state')).toBeInTheDocument();
  });

  describe('earlier-history loading for short pages', () => {
    // Reproduces the reopened-conversation bug: the newest 50-message page can be
    // a single long tool-only turn that collapses into one short work-summary
    // card, so the scroller never overflows and scroll events (the only
    // load-more trigger) can never fire — the older history became unreachable.
    const toolOnlyPageMessages = [
      {
        id: 'tool-1',
        conversation_id: 'conversation-1',
        type: 'tool_call',
        position: 'left',
        content: { call_id: 'call-1', name: 'Write', status: 'completed' },
        created_at: 10,
      },
    ] as unknown as TMessage[];

    const paginationWithHistory: MessagePaginationState = {
      oldestCursor: 'cursor-1',
      newestCursor: 'cursor-2',
      hasMoreBefore: true,
      hasMoreAfter: false,
      isLoadingBefore: false,
      isLoadingAnchor: false,
    };

    const olderHistoryPage = {
      items: [
        {
          id: 'older-user-1',
          conversation_id: 'conversation-1',
          type: 'text',
          position: 'right',
          content: { content: 'older user question' },
          created_at: 1,
        },
      ],
      oldest_cursor: 'cursor-0',
      newest_cursor: 'cursor-1',
      has_more_before: false,
      has_more_after: false,
    };

    const stubScrollerOverflow = (scrollHeight: number, clientHeight: number) => {
      const scrollHeightSpy = vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(scrollHeight);
      const clientHeightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(clientHeight);
      return () => {
        scrollHeightSpy.mockRestore();
        clientHeightSpy.mockRestore();
      };
    };

    it('auto-loads earlier pages until the viewport can scroll when the newest page is too short', async () => {
      loadConversationMessagePageMock.mockResolvedValue(olderHistoryPage);

      render(<MessageList />, {
        wrapper: ({ children }) => (
          <Wrapper messages={toolOnlyPageMessages} pagination={paginationWithHistory}>
            {children}
          </Wrapper>
        ),
      });

      expect(await screen.findByTestId('msgtext-older-user-1')).toHaveTextContent('older user question');
      expect(loadConversationMessagePageMock).toHaveBeenCalledWith(
        'conversation-1',
        expect.objectContaining({ before: 'cursor-1' })
      );
    });

    it('does not auto-load earlier pages when the content already overflows the scroller', () => {
      const restoreOverflow = stubScrollerOverflow(2000, 500);
      try {
        loadConversationMessagePageMock.mockResolvedValue(olderHistoryPage);

        render(<MessageList />, {
          wrapper: ({ children }) => (
            <Wrapper messages={toolOnlyPageMessages} pagination={paginationWithHistory}>
              {children}
            </Wrapper>
          ),
        });

        expect(loadConversationMessagePageMock).not.toHaveBeenCalled();
      } finally {
        restoreOverflow();
      }
    });

    it('loads earlier pages when the user wheels up near the top of an overflowing list', async () => {
      const restoreOverflow = stubScrollerOverflow(2000, 500);
      try {
        loadConversationMessagePageMock.mockResolvedValue(olderHistoryPage);

        render(<MessageList />, {
          wrapper: ({ children }) => (
            <Wrapper messages={toolOnlyPageMessages} pagination={paginationWithHistory}>
              {children}
            </Wrapper>
          ),
        });

        fireEvent.wheel(screen.getByTestId('message-list-scroller'), { deltaY: -40 });

        expect(await screen.findByTestId('msgtext-older-user-1')).toHaveTextContent('older user question');
      } finally {
        restoreOverflow();
      }
    });
  });

  it('renders a skeleton while the initial message batch is loading', () => {
    render(<MessageList emptySlot={<div>empty state</div>} />, {
      wrapper: ({ children }) => (
        <Wrapper messages={[]} loading>
          {children}
        </Wrapper>
      ),
    });

    expect(screen.getByTestId('message-list-skeleton')).toBeInTheDocument();
    expect(screen.queryByText('empty state')).not.toBeInTheDocument();
  });

  describe('scroll-to-bottom control', () => {
    afterEach(() => {
      autoScrollState.showScrollButton = false;
      autoScrollState.scrollToBottom.mockClear();
    });

    it('is a real button with an accessible name and no dead gradient div beside it', () => {
      autoScrollState.showScrollButton = true;

      const { container } = render(<MessageList />, {
        wrapper: ({ children }) => <Wrapper>{children}</Wrapper>,
      });

      const control = screen.getByRole('button', { name: 'messages.scrollToBottom' });
      fireEvent.click(control);
      expect(autoScrollState.scrollToBottom).toHaveBeenCalled();

      // `!b` paints the width and `!border-4` the colour. Both need the important prefix:
      // `border-4` is colour-only, the Uno preflight zeroes border-width, and `.arco-btn`'s own
      // `border-color: transparent` beats an unprefixed utility (measured in the running app).
      expect(control.className).toContain('!border-4');
      expect(control.className).toMatch(/(^|\s)!b(\s|$)/);
      expect(control.className).not.toContain('border-3');
      expect(container.querySelector('.h-100px.pointer-events-none')).toBeNull();
    });
  });
});
