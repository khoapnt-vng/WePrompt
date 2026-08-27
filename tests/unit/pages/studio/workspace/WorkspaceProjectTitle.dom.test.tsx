/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { WorkspaceProjectTitle } from '@/renderer/pages/studio/components/Workspace/WorkspaceShell';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const RENAME = 'conversation.creativeStudio.phase.shared.renameProject';
const INVALID = 'conversation.creativeStudio.phase.shared.invalidProjectName';
const AUTHORITY = { projectId: 'project_1', expectedRevision: 7 };

describe('WorkspaceProjectTitle', () => {
  it('commits one trimmed inline rename on Enter and reflects the refreshed authority', async () => {
    const onRename = vi.fn(async () => true);
    const view = render(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={7}
        name='Launch film'
        pending={false}
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: RENAME }));
    const input = screen.getByRole('textbox', { name: RENAME });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Retitled film  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Retitled film', AUTHORITY));
    expect(onRename).toHaveBeenCalledTimes(1);
    view.rerender(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={8}
        name='Retitled film'
        pending={false}
        onRename={onRename}
      />
    );
    expect(screen.getByRole('heading', { name: 'Retitled film' })).toHaveTextContent('Retitled film');
  });

  it('commits on blur but treats an unchanged trimmed name as a local no-op', async () => {
    const onRename = vi.fn(async () => true);
    render(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={7}
        name='Launch film'
        pending={false}
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: RENAME }));
    const input = screen.getByRole('textbox', { name: RENAME });
    fireEvent.change(input, { target: { value: ' Launch film ' } });
    fireEvent.blur(input);

    await waitFor(() => expect(screen.queryByRole('textbox', { name: RENAME })).not.toBeInTheDocument());
    expect(onRename).not.toHaveBeenCalled();
  });

  it('rejects an empty name locally and lets Escape restore the canonical title', () => {
    const onRename = vi.fn(async () => true);
    render(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={7}
        name='Launch film'
        pending={false}
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: RENAME }));
    const input = screen.getByRole('textbox', { name: RENAME });
    fireEvent.change(input, { target: { value: '   ' } });
    expect(screen.getByRole('alert')).toHaveTextContent(INVALID);
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: RENAME })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Launch film' })).toBeInTheDocument();
  });

  it('keeps a refused rename retryable and clears it when the project changes', async () => {
    const onRename = vi.fn(async () => false);
    const view = render(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={7}
        name='Launch film'
        pending={false}
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: RENAME }));
    const input = screen.getByRole('textbox', { name: RENAME });
    fireEvent.change(input, { target: { value: 'Retry this title' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(onRename).toHaveBeenCalledWith('Retry this title', AUTHORITY));
    expect(screen.getByRole('textbox', { name: RENAME })).toHaveValue('Retry this title');

    view.rerender(
      <WorkspaceProjectTitle
        projectId='project_2'
        projectRevision={4}
        name='Second film'
        pending={false}
        onRename={onRename}
      />
    );
    expect(screen.queryByRole('textbox', { name: RENAME })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Second film' })).toBeInTheDocument();
  });

  it('disables rename while an owner mutation is pending', () => {
    const onRename = vi.fn(async () => true);
    render(
      <WorkspaceProjectTitle projectId='project_1' projectRevision={7} name='Launch film' pending onRename={onRename} />
    );

    fireEvent.click(screen.getByRole('button', { name: RENAME }));
    expect(screen.queryByRole('textbox', { name: RENAME })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: RENAME })).toBeDisabled();
  });

  it('discards an inline draft when refreshed authority changes during editing', async () => {
    const onRename = vi.fn(async () => true);
    const view = render(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={7}
        name='Launch film'
        pending={false}
        onRename={onRename}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: RENAME }));
    fireEvent.change(screen.getByRole('textbox', { name: RENAME }), {
      target: { value: 'Stale local title' },
    });
    view.rerender(
      <WorkspaceProjectTitle
        projectId='project_1'
        projectRevision={8}
        name='Concurrent title'
        pending={false}
        onRename={onRename}
      />
    );

    await waitFor(() => expect(screen.queryByRole('textbox', { name: RENAME })).not.toBeInTheDocument());
    expect(screen.getByRole('heading', { name: 'Concurrent title' })).toHaveTextContent('Concurrent title');
    expect(onRename).not.toHaveBeenCalled();
  });
});
