/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IConversationArtifact } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import { isDiagnosticToolMessage } from '@/common/chat/normalizeToolCall';
import { useConversationContextSafe } from '@/renderer/hooks/context/ConversationContext';
import { useConversationRuntimeView } from '@/renderer/pages/conversation/runtime/useConversationRuntimeView';
import { getChatSurfaceWidthClass } from '@/renderer/pages/conversation/utils/chatSurfaceWidth';
import { useTeamPermission } from '@/renderer/pages/team/hooks/TeamPermissionContext';
import { iconColors } from '@/renderer/styles/colors';
import { CHAT_MESSAGE_JUMP_EVENT, type ChatMessageJumpDetail } from '@/renderer/utils/chat/chatMinimapEvents';
import { Button, Image, Tooltip } from '@arco-design/web-react';
import { Down } from '@icon-park/react';
import MessageAcpPermission from '@renderer/pages/conversation/Messages/acp/MessageAcpPermission';
import MessagePermission from './components/MessagePermission';
import MessageAcpToolCall from '@renderer/pages/conversation/Messages/acp/MessageAcpToolCall';
import classNames from 'classnames';
import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router-dom';
import { uuid } from '@renderer/utils/common';
import './messages.css';
import HOC from '@renderer/utils/ui/HOC';
import type { FileChangeInfo } from './MessageFileChanges';
import MessageFileChanges, { parseDiff } from './MessageFileChanges';
import { useConversationArtifacts } from './artifacts';
import {
  isHistoryGapMarker,
  useLoadAnchorMessageWindow,
  useLoadPreviousMessagePage,
  useMessageList,
  useMessageListLoading,
  useMessagePaginationState,
} from './hooks';
import MessageAgentStatus from './components/MessageAgentStatus';
import MessagePlan from './components/MessagePlan';
import MessageTips from './components/MessageTips';
import MessageToolCall from './components/MessageToolCall';
import MessageToolGroup from './components/MessageToolGroup';
import MessageToolGroupSummary from './components/MessageToolGroupSummary';
import MessageCronTrigger from './components/MessageCronTrigger';
import MessageSkillSuggest from './components/MessageSkillSuggest';
import MessageText from './components/MessageText';
import MessageThinking from './components/MessageThinking';
import type { WorkJournalSourceMessage, WriteFileResult } from './types';
import { dedupRestatedTextMessages } from './dedupRestatedTexts';
import { useAutoScroll } from './useAutoScroll';
import { useAutoPreviewOfficeFiles } from '@/renderer/hooks/file/useAutoPreviewOfficeFiles';
import SelectionReplyButton from './components/SelectionReplyButton';

type IMessageVO =
  | TMessage
  | { type: 'file_summary'; id: string; diffs: FileChangeInfo[]; sourceMessageIds: string[]; created_at: number }
  | {
      type: 'work_summary';
      id: string;
      messages: WorkJournalSourceMessage[];
      sourceMessageIds: string[];
      created_at: number;
    };
type IArtifactVO = { type: 'artifact'; id: string; artifact: IConversationArtifact; created_at: number };
type IProcessedItem = IMessageVO | IArtifactVO;
export type MessageListInlineItem = { id: string; createdAt: number; content: React.ReactNode };
type IInlineVO = { type: 'inline'; id: string; content: React.ReactNode; created_at: number };
type ITimelineItem = IProcessedItem | IInlineVO;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isWriteFileResult = (value: unknown): value is WriteFileResult =>
  isRecord(value) &&
  'file_diff' in value &&
  typeof value.file_diff === 'string' &&
  value.file_diff.length > 0 &&
  'file_name' in value &&
  typeof value.file_name === 'string';

type ConversationLocationState = {
  targetMessageId?: string;
  fromConversationSearch?: boolean;
};

const getProcessedItemSourceMessageIds = (item: IProcessedItem): string[] => {
  if ('type' in item && item.type === 'artifact') {
    return [item.id];
  }
  if ('type' in item && item.type === 'work_summary') {
    return item.sourceMessageIds;
  }
  if ('type' in item && item.type === 'file_summary') {
    return item.sourceMessageIds;
  }
  return 'id' in item ? [item.id] : [];
};

const matchesTargetMessage = (item: IProcessedItem, targetMessageId?: string): boolean => {
  if (!targetMessageId) {
    return false;
  }
  return getProcessedItemSourceMessageIds(item).includes(targetMessageId);
};

const getProcessedItemAnchorId = (item: IProcessedItem): string => {
  const sourceIds = getProcessedItemSourceMessageIds(item);
  return sourceIds[0] || ('id' in item ? item.id : uuid());
};

const getProcessedItemCreatedAt = (item: ITimelineItem): number => {
  if ('type' in item && ['file_summary', 'work_summary', 'artifact'].includes(item.type)) {
    return item.created_at;
  }
  return item.created_at ?? 0;
};

const highlightStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-aou-1)',
  boxShadow: '0 0 0 1px var(--color-aou-6-brand) inset',
  borderRadius: '12px',
};

const getUnhandledMessageType = (_message: never): string => 'unknown';

// Image preview context
export const ImagePreviewContext = createContext<{ inPreviewGroup: boolean }>({ inPreviewGroup: false });

const MessageListSkeleton: React.FC<{ rowWidthClass: string }> = ({ rowWidthClass }) => {
  const rows = [
    { align: 'left', bubbleWidth: '100%', lines: [72, 58, 64] },
    { align: 'right', bubbleWidth: '82%', lines: [54, 48] },
    { align: 'left', bubbleWidth: '100%', lines: [68, 76, 44] },
    { align: 'left', bubbleWidth: '100%', lines: [46, 52] },
    { align: 'right', bubbleWidth: '78%', lines: [60, 42, 36] },
    { align: 'left', bubbleWidth: '100%', lines: [74, 62] },
    { align: 'right', bubbleWidth: '84%', lines: [52, 66] },
    { align: 'left', bubbleWidth: '100%', lines: [64, 56, 40] },
    { align: 'right', bubbleWidth: '80%', lines: [58, 46] },
  ] as const;

  return (
    <div
      className='flex-1 h-full overflow-y-auto pb-10px box-border'
      data-testid='message-list-skeleton'
      style={{ minHeight: '100%' }}
    >
      <div className='min-h-full flex flex-col justify-between py-10px box-border'>
        {rows.map((row, index) => (
          <div
            key={index}
            className={classNames(`${rowWidthClass} min-w-0 flex items-start message-item px-8px m-t-10px`, {
              'justify-start': row.align === 'left',
              'justify-end': row.align === 'right',
            })}
          >
            <div
              className='flex-none min-w-0 rd-16px p-14px'
              style={{
                width: row.bubbleWidth,
                maxWidth: '100%',
                background: 'var(--color-fill-1)',
                border: '1px solid var(--color-border-2)',
              }}
            >
              <div className='flex flex-col gap-10px'>
                {row.lines.map((width, lineIndex) => (
                  <div
                    key={lineIndex}
                    className='h-12px rd-999px'
                    style={{
                      width: `${width}%`,
                      background:
                        'linear-gradient(90deg, var(--color-fill-2) 0%, var(--color-fill-3) 50%, var(--color-fill-2) 100%)',
                      backgroundSize: '200% 100%',
                      animation: 'message-list-skeleton-shimmer 1.4s ease-in-out infinite',
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
      <style>{`
        @keyframes message-list-skeleton-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
};

const MessageItem: React.FC<{
  message: TMessage;
  highlighted?: boolean;
  rowWidthClass: string;
  showCopyRow?: boolean;
  isStreaming?: boolean;
}> = React.memo(
  HOC((props) => {
    const { message, highlighted, rowWidthClass } = props as {
      message: TMessage;
      highlighted?: boolean;
      rowWidthClass: string;
    };
    return (
      <div
        id={`message-${message.id}`}
        data-testid={`message-${message.type}-${message.position}`}
        data-message-type={message.type}
        data-message-position={message.position}
        className={classNames(
          `${rowWidthClass} min-w-0 flex items-start message-item [&>div]:max-w-full px-8px m-t-10px`,
          message.type,
          {
            'justify-center': message.position === 'center',
            'justify-end': message.position === 'right',
            'justify-start': message.position === 'left',
          }
        )}
        style={highlighted ? highlightStyle : undefined}
      >
        {props.children}
      </div>
    );
  })(
    ({
      message,
      showCopyRow,
      isStreaming,
    }: {
      message: TMessage;
      highlighted?: boolean;
      rowWidthClass: string;
      showCopyRow?: boolean;
      isStreaming?: boolean;
    }) => {
      const { t } = useTranslation();
      switch (message.type) {
        case 'text':
          return <MessageText message={message} showCopyRow={showCopyRow} isStreaming={isStreaming}></MessageText>;
        case 'tips':
          return <MessageTips message={message}></MessageTips>;
        case 'tool_call':
          return <MessageToolCall message={message}></MessageToolCall>;
        case 'tool_group':
          return <MessageToolGroup message={message}></MessageToolGroup>;
        case 'agent_status':
          return <MessageAgentStatus message={message}></MessageAgentStatus>;
        case 'permission':
          return <MessagePermission message={message}></MessagePermission>;
        case 'acp_permission':
          return <MessageAcpPermission message={message}></MessageAcpPermission>;
        case 'acp_tool_call':
          return <MessageAcpToolCall message={message}></MessageAcpToolCall>;
        case 'plan':
          return <MessagePlan message={message}></MessagePlan>;
        case 'thinking':
          return <MessageThinking message={message}></MessageThinking>;
        case 'available_commands':
          return null;
        default:
          return <div>{t('messages.unknownMessageType', { type: getUnhandledMessageType(message) })}</div>;
      }
    }
  ),
  (prev, next) =>
    prev.message.id === next.message.id &&
    prev.message.content === next.message.content &&
    prev.message.position === next.message.position &&
    prev.message.type === next.message.type &&
    prev.highlighted === next.highlighted &&
    prev.rowWidthClass === next.rowWidthClass &&
    prev.showCopyRow === next.showCopyRow
);

const MessageList: React.FC<{
  className?: string;
  emptySlot?: React.ReactNode;
  inlineItems?: readonly MessageListInlineItem[];
}> = ({ emptySlot, inlineItems = [] }) => {
  const list = useMessageList();
  const isMessageListLoading = useMessageListLoading();
  const pagination = useMessagePaginationState();
  const artifacts = useConversationArtifacts();
  const conversationContext = useConversationContextSafe();
  const teamPermission = useTeamPermission();
  const rowWidthClass = getChatSurfaceWidthClass(Boolean(teamPermission));
  const loadPreviousMessagePage = useLoadPreviousMessagePage(conversationContext?.conversation_id);
  const loadAnchorMessageWindow = useLoadAnchorMessageWindow(conversationContext?.conversation_id);
  useAutoPreviewOfficeFiles(conversationContext);
  // While the agent is still streaming, the in-progress turn's last text keeps
  // moving down, so we defer its copy/timestamp row until the turn finishes to
  // avoid the row flashing in and the layout reflowing mid-stream.
  const { isProcessing } = useConversationRuntimeView(conversationContext?.conversation_id ?? '');
  const { t } = useTranslation();
  const location = useLocation();
  const locationState = (location.state || {}) as ConversationLocationState;
  const targetMessageId = locationState.targetMessageId;
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | undefined>();
  const handledTargetKeyRef = useRef<string>('');
  const loadingTargetKeyRef = useRef<string>('');
  const scrollerElementRef = useRef<HTMLDivElement | null>(null);
  const contentElementRef = useRef<HTMLDivElement | null>(null);

  // Pre-process message list to group left-side work activity into summary cards.
  const processedList = useMemo(() => {
    type PendingWorkSummary = {
      messages: WorkJournalSourceMessage[];
      sourceMessageIds: string[];
      latestResultIndex: number;
      latestCreatedAt: number;
    };

    const result: Array<IMessageVO> = [];
    let diffsChanges: FileChangeInfo[] = [];
    let diffsSourceMessageIds: string[] = [];
    let pendingWorkSummary: PendingWorkSummary | undefined;

    const pushFileDiffChanges = (changes: FileChangeInfo, sourceMessageId: string, created_at: number) => {
      if (!diffsChanges.length) {
        diffsSourceMessageIds = [];
        result.push({
          type: 'file_summary',
          id: `summary-${sourceMessageId}`,
          diffs: diffsChanges,
          sourceMessageIds: diffsSourceMessageIds,
          created_at,
        });
      }
      diffsChanges.push(changes);
      diffsSourceMessageIds.push(sourceMessageId);
    };
    const resetFileDiffChanges = () => {
      diffsChanges = [];
      diffsSourceMessageIds = [];
    };
    const pushWorkMessage = (message: WorkJournalSourceMessage) => {
      if (!pendingWorkSummary) {
        pendingWorkSummary = {
          messages: [],
          sourceMessageIds: [],
          latestResultIndex: result.length,
          latestCreatedAt: message.created_at ?? 0,
        };
      }
      pendingWorkSummary.messages.push(message);
      pendingWorkSummary.sourceMessageIds.push(message.id);
      pendingWorkSummary.latestResultIndex = result.length;
      pendingWorkSummary.latestCreatedAt = message.created_at ?? 0;
      resetFileDiffChanges();
    };
    const flushPendingWorkSummary = () => {
      if (!pendingWorkSummary) return;
      result.splice(pendingWorkSummary.latestResultIndex, 0, {
        type: 'work_summary',
        id: `work-summary-${pendingWorkSummary.messages.at(-1)?.id}`,
        messages: pendingWorkSummary.messages,
        sourceMessageIds: pendingWorkSummary.sourceMessageIds,
        created_at: pendingWorkSummary.latestCreatedAt,
      });
      pendingWorkSummary = undefined;
    };

    // Collapse restated replies (same answer persisted twice around a tool call)
    // before grouping, so the turn shows a single copy with its reasoning.
    const dedupedList = dedupRestatedTextMessages(list);

    for (let i = 0, len = dedupedList.length; i < len; i++) {
      const message = dedupedList[i];
      if (isHistoryGapMarker(message)) {
        flushPendingWorkSummary();
        resetFileDiffChanges();
        continue;
      }
      // Skip hidden and available_commands messages
      if (message.hidden) continue;
      if (message.type === 'available_commands') continue;
      if (message.type === 'tool_group') {
        if (isDiagnosticToolMessage(message)) continue;
        const writeFileResults = message.content.flatMap((item) =>
          item.name === 'WriteFile' && isWriteFileResult(item.result_display) ? [item.result_display] : []
        );
        if (writeFileResults.length > 0 && writeFileResults.length === message.content.length) {
          writeFileResults.forEach((writeFileResult) => {
            pushFileDiffChanges(
              parseDiff(writeFileResult.file_diff, writeFileResult.file_name),
              message.id,
              message.created_at ?? 0
            );
          });
          continue;
        }
        if (message.position === 'left') {
          pushWorkMessage(message);
          continue;
        }
      }
      if (message.type === 'acp_tool_call') {
        if (isDiagnosticToolMessage(message)) continue;
        if (message.position === 'left') {
          pushWorkMessage(message);
          continue;
        }
      }
      if (message.type === 'tool_call') {
        if (isDiagnosticToolMessage(message)) continue;
        if (message.position === 'left') {
          pushWorkMessage(message);
          continue;
        }
      }
      if (message.position === 'left' && (message.type === 'plan' || message.type === 'thinking')) {
        pushWorkMessage(message);
        continue;
      }
      if (message.position === 'right') {
        flushPendingWorkSummary();
      }
      resetFileDiffChanges();
      result.push(message);
    }
    flushPendingWorkSummary();
    const visibleArtifacts = artifacts
      .filter((artifact) => {
        if (artifact.kind === 'cron_trigger') return artifact.status === 'active';
        if (artifact.kind === 'skill_suggest') return artifact.status === 'pending';
        return false;
      })
      .map<IArtifactVO>((artifact) => ({
        type: 'artifact',
        id: artifact.id,
        artifact,
        created_at: artifact.created_at,
      }));

    return [...result, ...visibleArtifacts].toSorted(
      (a, b) => getProcessedItemCreatedAt(a) - getProcessedItemCreatedAt(b)
    );
  }, [artifacts, list]);

  const timelineList = useMemo<ITimelineItem[]>(
    () =>
      [
        ...processedList,
        ...inlineItems.map<IInlineVO>((item) => ({
          type: 'inline',
          id: item.id,
          content: item.content,
          created_at: item.createdAt,
        })),
      ].toSorted((a, b) => getProcessedItemCreatedAt(a) - getProcessedItemCreatedAt(b)),
    [inlineItems, processedList]
  );

  const activeWorkSummaryId = useMemo(() => {
    if (!isProcessing) return undefined;
    const sourceIndexById = new Map(list.map((message, index) => [message.id, index]));
    let lastHistoryGapIndex = -1;
    for (let index = list.length - 1; index >= 0; index--) {
      if (isHistoryGapMarker(list[index])) {
        lastHistoryGapIndex = index;
        break;
      }
    }
    for (let index = processedList.length - 1; index >= 0; index--) {
      const item = processedList[index];
      if (item.type === 'artifact') continue;
      if (item.type === 'work_summary') {
        const followsHistoryGap = item.sourceMessageIds.some(
          (sourceId) => (sourceIndexById.get(sourceId) ?? -1) > lastHistoryGapIndex
        );
        return followsHistoryGap ? item.id : undefined;
      }
      if (item.type === 'file_summary') continue;
      if (item.position === 'right') return undefined;
      if (item.type === 'text' && item.position === 'left' && item.status === 'finish') return undefined;
    }
    return undefined;
  }, [isProcessing, list, processedList]);

  // An AI reply can be split into several messages (thinking / multiple text /
  // tool blocks). The hover copy + timestamp row should appear once per turn,
  // after the turn's last text — not under every intermediate text block.
  // Collect the id of the last AI text in each turn; a turn runs until the next
  // user (right) message. Tool/file/artifact items don't end a turn and, per the
  // fallback strategy, the row stays on the turn's last text even when followed
  // by tool blocks. While the conversation is still streaming, the final turn's
  // row is withheld (it would otherwise appear then shift down as more text
  // streams in); earlier, already-finished turns always keep their row.
  const aiCopyRowTextIds = useMemo(() => {
    const ids = new Set<string>();
    let pendingTextId: string | undefined;
    let lastTurnTextId: string | undefined;
    const flush = () => {
      if (pendingTextId) ids.add(pendingTextId);
      pendingTextId = undefined;
    };
    for (const item of processedList) {
      if (
        'type' in item &&
        (item.type === 'file_summary' || item.type === 'work_summary' || item.type === 'artifact')
      ) {
        continue;
      }
      const message = item as TMessage;
      if (message.position === 'right') {
        flush();
        continue;
      }
      if (message.type === 'text') {
        pendingTextId = message.id;
      }
    }
    lastTurnTextId = pendingTextId;
    flush();
    // The final turn is the one that may still be streaming; hide its row until done.
    if (isProcessing && lastTurnTextId) ids.delete(lastTurnTextId);
    return ids;
  }, [processedList, isProcessing]);

  const streamingTextMessageId = useMemo(() => {
    if (!isProcessing) {
      return undefined;
    }

    for (let index = processedList.length - 1; index >= 0; index -= 1) {
      const item = processedList[index];
      if ('type' in item && ['file_summary', 'work_summary', 'artifact'].includes(item.type)) {
        continue;
      }
      const message = item as TMessage;
      if (message.type === 'text' && message.position === 'left') {
        return message.id;
      }
    }

    return undefined;
  }, [isProcessing, processedList]);

  // Use auto-scroll hook
  const {
    handleScrollerRef,
    handleContentRef,
    handleScroll,
    handleWheel,
    handlePointerDown,
    showScrollButton,
    reservedSpaceHeight,
    scrollToBottom,
    scrollElementIntoView,
    hideScrollButton,
  } = useAutoScroll({
    messages: list,
    itemCount: timelineList.length,
    isStreaming: isProcessing,
  });

  const setScrollerRef = useCallback(
    (element: HTMLDivElement | null) => {
      scrollerElementRef.current = element;
      handleScrollerRef(element);
    },
    [handleScrollerRef]
  );

  const setContentRef = useCallback(
    (element: HTMLDivElement | null) => {
      contentElementRef.current = element;
      handleContentRef(element);
    },
    [handleContentRef]
  );

  const loadEarlierMessagesPreservingScroll = useCallback(
    async (scroller: HTMLElement): Promise<boolean> => {
      const previousHeight = contentElementRef.current?.scrollHeight ?? 0;
      const loaded = await loadPreviousMessagePage();
      if (!loaded) return false;
      requestAnimationFrame(() => {
        const nextHeight = contentElementRef.current?.scrollHeight ?? previousHeight;
        scroller.scrollTop += nextHeight - previousHeight;
      });
      return true;
    },
    [loadPreviousMessagePage]
  );

  const handleMessageListScroll = useCallback(
    (event: React.UIEvent<HTMLDivElement>) => {
      handleScroll(event);
      const scroller = event.currentTarget;
      if (!pagination.hasMoreBefore || pagination.isLoadingBefore || scroller.scrollTop > 160) {
        return;
      }
      void loadEarlierMessagesPreservingScroll(scroller);
    },
    [handleScroll, loadEarlierMessagesPreservingScroll, pagination.hasMoreBefore, pagination.isLoadingBefore]
  );

  // Scrolling is the primary load-more trigger, but a wheel-up at the very top
  // produces no scroll event; treat it as an explicit request for older history.
  const handleMessageListWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      handleWheel(event);
      const scroller = event.currentTarget;
      if (event.deltaY >= 0 || scroller.scrollTop > 160) return;
      if (!pagination.hasMoreBefore || pagination.isLoadingBefore) return;
      void loadEarlierMessagesPreservingScroll(scroller);
    },
    [handleWheel, loadEarlierMessagesPreservingScroll, pagination.hasMoreBefore, pagination.isLoadingBefore]
  );

  // A reopened conversation's newest page can collapse into a single short
  // work-summary card (one long tool-only turn), so the scroller never
  // overflows and scroll events — the load-more trigger above — can never
  // fire. Keep pulling earlier pages until the content overflows the viewport
  // or history runs out. A failed load stops the auto-fill (instead of
  // retrying forever); the wheel/scroll paths remain as manual retries.
  const historyAutoFillStoppedRef = useRef(false);
  useEffect(() => {
    historyAutoFillStoppedRef.current = false;
  }, [conversationContext?.conversation_id]);
  useEffect(() => {
    if (historyAutoFillStoppedRef.current || isMessageListLoading) return;
    if (!pagination.hasMoreBefore || pagination.isLoadingBefore) return;
    const scroller = scrollerElementRef.current;
    if (!scroller || scroller.scrollHeight > scroller.clientHeight) return;
    void loadEarlierMessagesPreservingScroll(scroller).then((loaded) => {
      if (!loaded) historyAutoFillStoppedRef.current = true;
    });
  }, [
    isMessageListLoading,
    loadEarlierMessagesPreservingScroll,
    pagination.hasMoreBefore,
    pagination.isLoadingBefore,
    timelineList.length,
  ]);

  useEffect(() => {
    if (!targetMessageId || processedList.length === 0) {
      return;
    }

    const targetKey = `${location.key}:${targetMessageId}`;
    if (handledTargetKeyRef.current === targetKey) {
      return;
    }

    const targetIndex = processedList.findIndex((item) => matchesTargetMessage(item, targetMessageId));
    if (targetIndex === -1) {
      if (loadingTargetKeyRef.current !== targetKey) {
        loadingTargetKeyRef.current = targetKey;
        void loadAnchorMessageWindow(targetMessageId).then((loaded) => {
          if (!loaded) {
            loadingTargetKeyRef.current = '';
          }
        });
      }
      return;
    }

    handledTargetKeyRef.current = targetKey;
    loadingTargetKeyRef.current = '';
    setHighlightedMessageId(targetMessageId);
    hideScrollButton();

    requestAnimationFrame(() => {
      const targetElement = document.getElementById(`message-${getProcessedItemAnchorId(processedList[targetIndex])}`);
      scrollElementIntoView(targetElement, {
        behavior: 'smooth',
        block: 'center',
      });
    });

    const timer = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === targetMessageId ? undefined : current));
    }, 2400);

    return () => window.clearTimeout(timer);
  }, [hideScrollButton, loadAnchorMessageWindow, location.key, processedList, scrollElementIntoView, targetMessageId]);

  useEffect(() => {
    const handleMessageJump = (event: Event) => {
      const detail = (event as CustomEvent<ChatMessageJumpDetail>).detail;
      if (!detail || !detail.conversation_id) return;
      if (!conversationContext?.conversation_id || detail.conversation_id !== conversationContext.conversation_id)
        return;

      const targetIndex = processedList.findIndex((item) => {
        if (item.type === 'work_summary') {
          return matchesTargetMessage(item, detail.messageId);
        }
        if (item.type === 'file_summary' || item.type === 'artifact') {
          return false;
        }
        const message = item as TMessage;
        if (detail.messageId && message.id === detail.messageId) return true;
        if (detail.msgId && message.msg_id === detail.msgId) return true;
        return false;
      });
      if (targetIndex < 0) {
        const anchorMessageId = detail.messageId;
        if (!anchorMessageId) return;
        void loadAnchorMessageWindow(anchorMessageId).then((loaded) => {
          if (!loaded) return;
          setHighlightedMessageId(anchorMessageId);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const targetElement = document.getElementById(`message-${anchorMessageId}`);
              scrollElementIntoView(targetElement, {
                block: detail.align || 'start',
                behavior: detail.behavior || 'smooth',
              });
            });
          });
        });
        return;
      }

      hideScrollButton();
      requestAnimationFrame(() => {
        const targetElement = document.getElementById(
          `message-${getProcessedItemAnchorId(processedList[targetIndex])}`
        );
        scrollElementIntoView(targetElement, {
          block: detail.align || 'start',
          behavior: detail.behavior || 'smooth',
        });
      });
    };

    window.addEventListener(CHAT_MESSAGE_JUMP_EVENT, handleMessageJump);
    return () => {
      window.removeEventListener(CHAT_MESSAGE_JUMP_EVENT, handleMessageJump);
    };
  }, [
    conversationContext?.conversation_id,
    hideScrollButton,
    loadAnchorMessageWindow,
    processedList,
    scrollElementIntoView,
  ]);

  // Click scroll button
  const handleScrollButtonClick = () => {
    hideScrollButton();
    scrollToBottom('smooth');
  };

  const renderItem = (_index: number, item: ITimelineItem) => {
    if (item.type === 'inline') {
      return (
        <div
          className={`${rowWidthClass} min-w-0 message-item px-8px m-t-10px`}
          data-message-inline-item={item.id}
          data-studio-director-reviewed-output
          key={item.id}
        >
          {item.content}
        </div>
      );
    }
    const highlighted = matchesTargetMessage(item, highlightedMessageId);
    if ('type' in item && item.type === 'artifact') {
      return (
        <div
          key={item.id}
          id={`message-${getProcessedItemAnchorId(item)}`}
          data-conversation-artifact-kind={item.artifact.kind}
          data-testid={`conversation-artifact-${item.artifact.kind}`}
          className={`${rowWidthClass} min-w-0 message-item px-8px m-t-10px`}
          style={highlighted ? highlightStyle : undefined}
        >
          {item.artifact.kind === 'cron_trigger' ? (
            <MessageCronTrigger artifact={item.artifact} />
          ) : (
            <MessageSkillSuggest artifact={item.artifact} />
          )}
        </div>
      );
    }
    if ('type' in item && ['file_summary', 'work_summary'].includes(item.type)) {
      return (
        <div
          key={item.id}
          id={`message-${getProcessedItemAnchorId(item)}`}
          className={`${rowWidthClass} min-w-0 message-item px-8px m-t-10px ${item.type}`}
          style={highlighted ? highlightStyle : undefined}
        >
          {item.type === 'file_summary' && <MessageFileChanges diffsChanges={item.diffs} />}
          {item.type === 'work_summary' && (
            <MessageToolGroupSummary messages={item.messages} isActive={item.id === activeWorkSummaryId} />
          )}
        </div>
      );
    }
    const message = item as TMessage;
    // User messages keep their own copy row; AI text only shows it at the turn end.
    const showCopyRow = message.position !== 'left' || message.type !== 'text' || aiCopyRowTextIds.has(message.id);
    return (
      <div id={`message-${message.id}`}>
        <MessageItem
          message={message}
          key={message.id}
          highlighted={highlighted}
          rowWidthClass={rowWidthClass}
          showCopyRow={showCopyRow}
          isStreaming={streamingTextMessageId === message.id}
        ></MessageItem>
      </div>
    );
  };

  if (timelineList.length === 0 && isMessageListLoading) {
    return <MessageListSkeleton rowWidthClass={rowWidthClass} />;
  }

  if (timelineList.length === 0 && emptySlot) {
    return <div className='relative flex-1 h-full flex items-center justify-center'>{emptySlot}</div>;
  }

  return (
    <div className='relative flex-1 h-full'>
      {/* Use PreviewGroup to wrap all messages for cross-message image preview */}
      <Image.PreviewGroup actionsLayout={['zoomIn', 'zoomOut', 'originalSize', 'rotateLeft', 'rotateRight']}>
        <ImagePreviewContext.Provider value={{ inPreviewGroup: true }}>
          <div
            ref={setScrollerRef}
            data-testid='message-list-scroller'
            // Break out of the parent's 20px horizontal padding so the scrollbar hugs the
            // window edge, while re-applying that padding inside to keep message content inset.
            className='flex-1 h-full overflow-y-auto pb-10px box-border -mx-20px px-20px'
            style={{ overflowAnchor: 'none' }}
            onPointerDown={handlePointerDown}
            onScroll={handleMessageListScroll}
            onWheel={handleMessageListWheel}
          >
            <div ref={setContentRef} data-testid='message-list-content' style={{ overflowAnchor: 'none' }}>
              <div className='h-10px' />
              {timelineList.map((item, index) => (
                <React.Fragment key={item.type === 'inline' ? item.id : getProcessedItemAnchorId(item) || index}>
                  {renderItem(index, item)}
                </React.Fragment>
              ))}
              <div className='h-20px' />
              {/* Reserved space so a streaming reply fills in below the anchored user
                  message without the viewport constantly scrolling (see useAutoScroll). */}
              <div
                aria-hidden='true'
                data-testid='message-list-reserve'
                style={{ height: `${reservedSpaceHeight}px` }}
              />
            </div>
          </div>
        </ImagePreviewContext.Provider>
      </Image.PreviewGroup>

      {showScrollButton && (
        // The 100px "Gradient mask" div that used to sit here had no background, no gradient
        // and no mask — it painted nothing and only occupied non-interactive space.
        <div className='absolute bottom-20px left-50% transform -translate-x-50% z-100'>
          <Tooltip content={t('messages.scrollToBottom')} mini>
            <Button
              shape='circle'
              aria-label={t('messages.scrollToBottom')}
              // `!b` supplies the width and `!border-4` the colour: `border-4` is colour-only,
              // the Uno preflight sets every element to border-width 0, and `.arco-btn`'s own
              // `border-color: transparent` beats an unprefixed utility (measured live — the
              // ring stayed transparent without `!`). The old class list paired `border-1` with
              // `border-3`: two competing colours, no width, so it drew no ring in any theme.
              className='!flex items-center justify-center !w-40px !h-40px rd-full bg-base shadow-lg hover:bg-1 transition-all hover:scale-110 !b !b-solid !border-4'
              onClick={handleScrollButtonClick}
              icon={<Down theme='filled' size='20' fill={iconColors.secondary} style={{ display: 'block' }} />}
            />
          </Tooltip>
        </div>
      )}

      <SelectionReplyButton messages={list} />
    </div>
  );
};

export default MessageList;
