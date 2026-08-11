/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TConversationRuntimeSummary } from '@/common/config/storage';
import { getConversationOrNull } from '@/renderer/pages/conversation/utils/conversationCache';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import {
  getConversationRuntimeViewSnapshot,
  hydrateFailed,
  hydrateStarted,
  hydrateSucceeded,
  localSendAccepted,
  localSendFailed,
  localSendStarted,
  localStopAcknowledged,
  localStopRequested,
  resetLocalGate,
  subscribeConversationRuntimeView,
  type ConversationRuntimeView,
  type ConversationRuntimeSendFailure,
} from './conversationRuntimeViewStore';
import { ensureConversationRuntimeViewEvents, flushConversationRuntimeViewLogs } from './conversationRuntimeViewEvents';

export { logStreamTerminalObserved } from './conversationRuntimeViewEvents';

type UseConversationRuntimeViewReturn = {
  view: ConversationRuntimeView;
  hydrated: boolean;
  state: ConversationRuntimeView['state'];
  isProcessing: boolean;
  canSendMessage: boolean;
  pendingConfirmations: number;
  activeTurnId: string | null;
  markSendStarted: () => void;
  markSendAccepted: (turn_id: string, runtime: TConversationRuntimeSummary, msg_id?: string) => void;
  markSendFailed: (failure: ConversationRuntimeSendFailure) => void;
  markStopRequested: (turn_id: string) => void;
  markStopAcknowledged: (turn_id: string, runtime: TConversationRuntimeSummary) => void;
  resetLocalGate: (reason: string) => void;
};

const normalizeReason = (reason: string): string => reason.trim().slice(0, 200) || 'unknown';

const getRuntimeOrNull = (runtime: TConversationRuntimeSummary | undefined): TConversationRuntimeSummary | null =>
  runtime ?? null;

export const useConversationRuntimeView = (conversation_id: string): UseConversationRuntimeViewReturn => {
  const getSnapshot = useCallback(() => getConversationRuntimeViewSnapshot(conversation_id), [conversation_id]);
  const view = useSyncExternalStore(subscribeConversationRuntimeView, getSnapshot, getSnapshot);

  useEffect(() => {
    ensureConversationRuntimeViewEvents();
  }, []);

  useEffect(() => {
    if (!conversation_id) {
      return;
    }

    let cancelled = false;
    flushConversationRuntimeViewLogs(hydrateStarted(conversation_id));

    void getConversationOrNull(conversation_id)
      .then((conversation) => {
        if (cancelled) {
          return;
        }
        flushConversationRuntimeViewLogs(hydrateSucceeded(conversation_id, getRuntimeOrNull(conversation?.runtime)));
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        const reason = error instanceof Error ? error.message : String(error);
        flushConversationRuntimeViewLogs(hydrateFailed(conversation_id, normalizeReason(reason)));
      });

    return () => {
      cancelled = true;
    };
  }, [conversation_id]);

  const markSendStarted = useCallback(() => {
    flushConversationRuntimeViewLogs(localSendStarted(conversation_id));
  }, [conversation_id]);

  const markSendAccepted = useCallback(
    (turn_id: string, runtime: TConversationRuntimeSummary, msg_id?: string) => {
      flushConversationRuntimeViewLogs(localSendAccepted(conversation_id, turn_id, runtime, msg_id));
    },
    [conversation_id]
  );

  const markSendFailed = useCallback(
    (failure: ConversationRuntimeSendFailure) => {
      flushConversationRuntimeViewLogs(
        localSendFailed(conversation_id, {
          ...failure,
          reason: normalizeReason(failure.reason),
        })
      );
    },
    [conversation_id]
  );

  const markStopRequested = useCallback(
    (turn_id: string) => {
      flushConversationRuntimeViewLogs(localStopRequested(conversation_id, turn_id));
    },
    [conversation_id]
  );

  const markStopAcknowledged = useCallback(
    (turn_id: string, runtime: TConversationRuntimeSummary) => {
      flushConversationRuntimeViewLogs(localStopAcknowledged(conversation_id, turn_id, runtime));
    },
    [conversation_id]
  );

  const resetLocalRuntimeGate = useCallback(
    (reason: string) => {
      flushConversationRuntimeViewLogs(resetLocalGate(conversation_id, normalizeReason(reason)));
    },
    [conversation_id]
  );

  return {
    view,
    hydrated: view.hydrated,
    state: view.state,
    isProcessing: view.isProcessing,
    canSendMessage: view.canSendMessage,
    pendingConfirmations: view.pendingConfirmations,
    activeTurnId: view.activeTurnId,
    markSendStarted,
    markSendAccepted,
    markSendFailed,
    markStopRequested,
    markStopAcknowledged,
    resetLocalGate: resetLocalRuntimeGate,
  };
};
