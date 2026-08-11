/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TChatConversation } from '@/common/config/storage';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  conversations: [] as TChatConversation[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/renderer/pages/conversation/GroupedHistory/hooks/useConversationListSync', () => ({
  useConversationListSync: () => ({
    conversations: harness.conversations,
    hasLoadedConversations: true,
  }),
}));

import {
  ConversationHistoryProvider,
  useConversationHistoryContext,
} from '@/renderer/hooks/context/ConversationHistoryContext';

const conversation = (id: string, extra: TChatConversation['extra']): TChatConversation =>
  ({
    id,
    name: id,
    created_at: 1,
    updated_at: 1,
    status: 'finished',
    platform: 'acp',
    extra,
  }) as TChatConversation;

const VisibleConversationIds = () => {
  const history = useConversationHistoryContext();
  return <output>{history.conversations.map((item) => item.id).join(',')}</output>;
};

describe('ConversationHistoryProvider', () => {
  beforeEach(() => {
    harness.conversations = [
      conversation('ordinary-chat', { backend: 'codex' }),
      conversation('studio-brief-chat', { backend: 'codex', studio_project_id: 'project_1' }),
    ];
  });

  it('exposes ordinary conversations without exposing Studio Brief conversations', () => {
    render(
      <ConversationHistoryProvider>
        <VisibleConversationIds />
      </ConversationHistoryProvider>
    );

    expect(screen.getByText('ordinary-chat')).toBeInTheDocument();
    expect(screen.queryByText(/studio-brief-chat/)).not.toBeInTheDocument();
  });
});
