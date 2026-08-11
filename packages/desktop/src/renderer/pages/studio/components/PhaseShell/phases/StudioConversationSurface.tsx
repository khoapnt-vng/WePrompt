/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback } from 'react';
import { ipcBridge } from '@/common';
import type { IConversationMcpStatus, IProvider, TProviderWithModel } from '@/common/config/storage';
import AionrsChat from '@/renderer/pages/conversation/platforms/aionrs/AionrsChat';
import { useAionrsModelSelection } from '@/renderer/pages/conversation/platforms/aionrs/useAionrsModelSelection';
import type { StudioBriefConversation } from './brief/useBriefConversation';

export type StudioConversationSurfaceProps = {
  conversation: StudioBriefConversation;
};

export const StudioConversationSurface = ({ conversation }: StudioConversationSurfaceProps) => {
  const onSelectModel = useCallback(
    async (provider: IProvider, modelName: string): Promise<boolean> => {
      const model = { ...provider, use_model: modelName } as TProviderWithModel;
      return Boolean(await ipcBridge.conversation.update.invoke({ id: conversation.id, updates: { model } }));
    },
    [conversation.id]
  );
  const modelSelection = useAionrsModelSelection({ initialModel: conversation.model, onSelectModel });

  return (
    <AionrsChat
      conversation_id={conversation.id}
      conversation={conversation}
      workspace={conversation.extra.workspace ?? ''}
      modelSelection={modelSelection}
      session_mode={conversation.extra.session_mode}
      loadedSkills={(conversation.extra as { skills?: string[] }).skills}
      loadedMcpServers={(conversation.extra as { mcp_servers?: string[] }).mcp_servers}
      loadedMcpStatuses={(conversation.extra as { mcp_statuses?: IConversationMcpStatus[] }).mcp_statuses}
      project_id={conversation.extra.project_id}
      session_mcp_servers={conversation.extra.session_mcp_servers}
    />
  );
};
