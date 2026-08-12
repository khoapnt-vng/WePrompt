/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { UseBriefConversationResult } from '@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation';
// The pane's own stylesheet, so the strip is located by the class the component actually sets
// rather than by a name copied into the test — the two cannot drift apart.
import styles from '@renderer/pages/studio/components/Shell/DirectorPane.module.css';

const harness: { result: UseBriefConversationResult } = {
  result: {
    state: { kind: 'absent' },
    errorMessageKey: null,
    sendFirstMessage: vi.fn(async () => {}),
    recreate: vi.fn(),
  },
};

vi.mock('@renderer/pages/studio/components/Shell/BriefConversationContext', () => ({
  useBriefConversationContext: () => harness.result,
}));

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/StudioConversationSurface', () => ({
  StudioConversationSurface: ({ conversation }: { conversation: { id: string } }) => (
    <div data-testid='conversation-surface'>{conversation.id}</div>
  ),
}));

const { DirectorPane } = await import('@renderer/pages/studio/components/Shell/DirectorPane');

beforeEach(() => {
  harness.result = {
    state: { kind: 'absent' },
    errorMessageKey: null,
    sendFirstMessage: vi.fn(async () => {}),
    recreate: vi.fn(),
  };
});

describe('DirectorPane', () => {
  /**
   * The pane says the thread is continuous. A user who reaches Write has no other way to know the
   * Director still remembers the brief, so this is load-bearing copy rather than decoration.
   */
  it('names the Director and states that the thread is the same one', () => {
    render(<DirectorPane />);

    expect(screen.getByText('conversation.creativeStudio.shell.directorName')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.shell.sameConversation')).toBeVisible();
  });

  it('mounts the ready conversation surface', () => {
    harness.result.state = {
      kind: 'ready',
      conversation: {
        id: 'conversation_brief',
        name: 'Brief',
        type: 'aionrs',
        model: { id: 'provider_1', use_model: 'model_1' },
        created_at: 1,
        modified_at: 1,
        extra: { backend: 'aionrs', workspace: '' },
      },
    } as UseBriefConversationResult['state'];

    render(<DirectorPane />);

    expect(screen.getByTestId('conversation-surface')).toHaveTextContent('conversation_brief');
  });

  it('shows the dangling notice and Start fresh action', () => {
    harness.result.state = { kind: 'dangling', conversationId: 'conversation_deleted' };

    render(<DirectorPane />);

    expect(screen.getByText('conversation.creativeStudio.brief.danglingNotice')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.danglingStartFresh' }));
    expect(harness.result.recreate).toHaveBeenCalledOnce();
  });

  it('offers the first-message composer before a conversation exists', () => {
    render(<DirectorPane />);

    const composer = screen.getByPlaceholderText('conversation.creativeStudio.brief.composerPlaceholder');
    const send = screen.getByRole('button', { name: 'conversation.creativeStudio.brief.composerSend' });
    expect(send).toBeDisabled();

    fireEvent.change(composer, { target: { value: 'A teaser for the launch' } });
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.brief.composerSend' }));

    expect(harness.result.sendFirstMessage).toHaveBeenCalledExactlyOnceWith('A teaser for the launch');
  });

  it('surfaces a conversation error beside the composer', () => {
    harness.result.errorMessageKey = 'conversation.creativeStudio.errors.storage';

    render(<DirectorPane />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');
  });

  /**
   * A proposal is the Director's output, so it belongs beside the Director rather than in whichever
   * phase happens to be open. Brief used to own this card; the work panel is now free to change
   * phase underneath a pending proposal without the proposal disappearing.
   */
  it('renders proposals inside the pane, below the conversation', () => {
    harness.result.state = {
      kind: 'ready',
      conversation: {
        id: 'conversation_brief',
        name: 'Brief',
        type: 'aionrs',
        model: { id: 'provider_1', use_model: 'model_1' },
        created_at: 1,
        modified_at: 1,
        extra: { backend: 'aionrs', workspace: '' },
      },
    } as UseBriefConversationResult['state'];

    const { container } = render(<DirectorPane proposals={<div data-testid='proposal-card'>A proposal</div>} />);

    const pane = screen.getByTestId('proposal-card').closest('[data-studio-director]');
    expect(pane).not.toBeNull();
    expect(screen.getByTestId('conversation-surface')).toBeVisible();
    // The strip is a real element with its own border and scroll box, not just a passthrough.
    const strip = container.querySelector(`.${styles.proposals}`);
    expect(strip).not.toBeNull();
    expect(strip).toContainElement(screen.getByTestId('proposal-card'));
  });

  /**
   * Nothing pending must leave no trace. The strip carries a top border and 14px of padding, so
   * rendering it around an empty slot draws a bordered band under the conversation that reads as a
   * card that failed to load — which is why the pane omits the element rather than its contents.
   */
  it('omits the proposals strip entirely when the slot is empty', () => {
    const { container } = render(<DirectorPane />);

    expect(container.querySelector(`.${styles.proposals}`)).toBeNull();
    const pane = container.querySelector('[data-studio-director]');
    expect(pane).not.toBeNull();
    // The composer is the last thing in the pane: no empty container trails it.
    expect(pane?.lastElementChild).toBe(container.querySelector(`.${styles.composer}`));
  });
});
