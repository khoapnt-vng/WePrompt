/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ipcBridge } from '@/common';
import type { IMcpServer, TChatConversation } from '@/common/config/storage';
import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import { useConversationHistoryContext } from '@/renderer/hooks/context/ConversationHistoryContext';
import { getConversationPinnedContext } from '@/renderer/pages/conversation/contextHandoff/pinnedContext';
import { useGuidModelSelection } from '@/renderer/pages/guid/hooks/useGuidModelSelection';
import { createStudioBriefConversation } from '../studioBriefConversation';

export type StudioBriefConversation = Extract<TChatConversation, { type: 'aionrs' }>;

export type BriefConversationState =
  | { kind: 'absent' }
  | { kind: 'creating' }
  | { kind: 'ready'; conversation: StudioBriefConversation }
  | { kind: 'dangling'; conversationId: string };

export type UseBriefConversationResult = {
  state: BriefConversationState;
  errorMessageKey: string | null;
  sendFirstMessage(text: string): Promise<void>;
  recreate(): void;
};

const resolveBoundState = (
  conversationId: string | null,
  conversations: readonly TChatConversation[],
  ignoredConversationId: string | null
): BriefConversationState => {
  if (conversationId === null || conversationId === ignoredConversationId) return { kind: 'absent' };
  const conversation = conversations.find((candidate) => candidate.id === conversationId);
  return conversation?.type === 'aionrs' ? { kind: 'ready', conversation } : { kind: 'dangling', conversationId };
};

export const useBriefConversation = (project: StudioRendererProject): UseBriefConversationResult => {
  const { allConversations } = useConversationHistoryContext();
  const { current_model } = useGuidModelSelection('aionrs');
  const [ignoredConversationId, setIgnoredConversationId] = useState<string | null>(null);
  const boundState = useMemo(
    () => resolveBoundState(project.briefConversationId ?? null, allConversations, ignoredConversationId),
    [allConversations, ignoredConversationId, project.briefConversationId]
  );
  const [state, setState] = useState<BriefConversationState>(boundState);
  const [errorMessageKey, setErrorMessageKey] = useState<string | null>(null);

  useEffect(() => {
    if (state.kind !== 'creating' && state.kind !== 'ready') setState(boundState);
  }, [boundState, state.kind]);

  const sendFirstMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!current_model) {
        setErrorMessageKey('conversation.noModelConfigured');
        throw new Error('conversation.noModelConfigured');
      }
      setState({ kind: 'creating' });
      setErrorMessageKey(null);

      const descriptorResult = await ipcBridge.creativeStudio.getBriefSessionServer.invoke({ projectId: project.id });
      if (descriptorResult.ok === false) {
        setState({ kind: 'absent' });
        setErrorMessageKey(descriptorResult.error.messageKey);
        throw new Error(descriptorResult.error.messageKey);
      }
      const descriptor = descriptorResult.data;
      const availableServer: IMcpServer = {
        ...descriptor,
        builtin: true,
        enabled: true,
        created_at: 0,
        updated_at: 0,
        original_json: JSON.stringify(descriptor),
      };

      let conversation: StudioBriefConversation;
      try {
        conversation = (await createStudioBriefConversation({
          type: 'aionrs',
          name: project.name,
          model: current_model,
          studioProjectId: project.id,
          mcpServerAllowlist: [descriptor.id],
          availableMcpServers: [availableServer],
          extra: { workspace: '', custom_workspace: false },
        })) as StudioBriefConversation;
      } catch (error) {
        setState({ kind: 'absent' });
        throw error;
      }

      const bindResult = await ipcBridge.creativeStudio.bindBriefConversation.invoke({
        projectId: project.id,
        expectedRevision: project.revision,
        conversationId: conversation.id,
      });
      if (bindResult.ok === false) {
        setState({ kind: 'dangling', conversationId: conversation.id });
        setErrorMessageKey(bindResult.error.messageKey);
        throw new Error(bindResult.error.messageKey);
      }

      setIgnoredConversationId(null);
      setState({ kind: 'ready', conversation });
      await ipcBridge.conversation.sendMessage.invoke({
        input: text,
        conversation_id: conversation.id,
        files: [],
        pinned_context: getConversationPinnedContext(conversation),
      });
    },
    [current_model, project]
  );

  const recreate = useCallback((): void => {
    setIgnoredConversationId(project.briefConversationId ?? null);
    setErrorMessageKey(null);
    setState({ kind: 'absent' });
  }, [project.briefConversationId]);

  return { state, errorMessageKey, sendFirstMessage, recreate };
};
