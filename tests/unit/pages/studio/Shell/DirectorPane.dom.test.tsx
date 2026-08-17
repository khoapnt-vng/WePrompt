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
    recreate: vi.fn(),
  };
});

describe('DirectorPane', () => {
  /**
   * D7: the pane used to open with a `CD` monogram, the Director's name, and the subtitle
   * SAME CONVERSATION AS YOUR BRIEF. That subtitle was load-bearing while the conversation lived
   * inside Brief — a user who reached Write had no other way to know the thread persisted. An
   * always-on pane demonstrates that by never going away, so the copy now explains something the
   * UI no longer hides, and it charges two lines of height for it in the one pane whose scarce
   * axis is height. The conversation starts at the top of the pane.
   */
  it('opens straight onto the conversation, with no header block above it', () => {
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

    const { container } = render(<DirectorPane />);

    expect(screen.queryByText('conversation.creativeStudio.shell.directorName')).toBeNull();
    expect(screen.queryByText('conversation.creativeStudio.shell.sameConversation')).toBeNull();
    expect(screen.queryByText('CD')).toBeNull();
    const pane = container.querySelector('[data-studio-director]');
    expect(pane?.firstElementChild).toBe(container.querySelector(`.${styles.surface}`));
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

  /**
   * D5: the pane owns no composer of its own. It used to hand-roll one for the state before a
   * conversation existed, and that stand-in had no attachments, no model picker, no permission
   * selector, no `/` commands, no `@` references and no history — every one of them a difference
   * from the composer the same user gets in every other conversation in the app. The conversation
   * is now created when the project opens, so the only composer that can appear here is the real
   * one, inside the surface.
   */
  it.each([
    ['absent', { kind: 'absent' }],
    ['creating', { kind: 'creating' }],
  ] as const)('renders no composer of its own while the conversation is %s', (_label, state) => {
    harness.result.state = state as UseBriefConversationResult['state'];

    const { container } = render(<DirectorPane />);

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryAllByRole('button')).toEqual([]);
    expect(screen.getByText('conversation.creativeStudio.shell.directorStarting')).toBeVisible();
  });

  it('surfaces a failed start and offers to try again', () => {
    harness.result.errorMessageKey = 'conversation.creativeStudio.errors.storage';

    render(<DirectorPane />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.storage');
    expect(screen.queryByText('conversation.creativeStudio.shell.directorStarting')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.library.retry' }));
    expect(harness.result.recreate).toHaveBeenCalledOnce();
  });

  it('explains why a binding was refused alongside the offer to start fresh', () => {
    harness.result.state = { kind: 'dangling', conversationId: 'conversation_orphan' };
    harness.result.errorMessageKey = 'conversation.creativeStudio.errors.staleProject';

    render(<DirectorPane />);

    expect(screen.getByRole('alert')).toHaveTextContent('conversation.creativeStudio.errors.staleProject');
    expect(screen.getByText('conversation.creativeStudio.brief.danglingNotice')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'conversation.creativeStudio.brief.danglingStartFresh' })
    ).toBeInTheDocument();
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
    // The conversation's own column is the last thing in the pane: no empty container trails it.
    expect(pane?.lastElementChild).toBe(container.querySelector(`.${styles.notice}`));
  });
});
