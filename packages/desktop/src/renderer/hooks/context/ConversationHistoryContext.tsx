/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { createContext, useContext, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useConversationListSync } from '@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync';
import type { GroupedHistoryResult } from '@/renderer/pages/conversation/GroupedHistory/types';
import { buildGroupedHistory } from '@/renderer/pages/conversation/GroupedHistory/utils/groupingHelpers';

export type ConversationHistoryContextValue = ReturnType<typeof useConversationListSync> & {
  /** Includes conversations intentionally hidden from the general sidebar. */
  allConversations: ReturnType<typeof useConversationListSync>['conversations'];
  groupedHistory: GroupedHistoryResult;
};

const ConversationHistoryContext = createContext<ConversationHistoryContextValue | null>(null);

export const ConversationHistoryProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
  const { t } = useTranslation();
  const conversationListSync = useConversationListSync();
  const visibleConversations = useMemo(
    () =>
      conversationListSync.conversations.filter(
        (conversation) =>
          !(conversation.extra as { studio_project_id?: string } | undefined)?.studio_project_id
      ),
    [conversationListSync.conversations]
  );

  const groupedHistory = useMemo(() => {
    return buildGroupedHistory(visibleConversations, t);
  }, [t, visibleConversations]);

  const value = useMemo<ConversationHistoryContextValue>(() => {
    return {
      ...conversationListSync,
      allConversations: conversationListSync.conversations,
      conversations: visibleConversations,
      groupedHistory,
    };
  }, [conversationListSync, groupedHistory, visibleConversations]);

  return <ConversationHistoryContext.Provider value={value}>{children}</ConversationHistoryContext.Provider>;
};

export const useConversationHistoryContext = (): ConversationHistoryContextValue => {
  const context = useContext(ConversationHistoryContext);

  if (!context) {
    throw new Error('useConversationHistoryContext must be used within ConversationHistoryProvider');
  }

  return context;
};
