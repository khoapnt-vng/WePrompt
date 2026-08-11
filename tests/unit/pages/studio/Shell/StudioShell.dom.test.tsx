/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { StudioShell } from '@renderer/pages/studio/components/Shell/StudioShell';
import type { StudioLayoutMode } from '@renderer/pages/studio/components/PhaseShell/useStudioLayoutMode';
import type { StudioPaneState } from '@renderer/pages/studio/components/Shell/useStudioPanes';

const renderShell = (
  overrides: Partial<{
    directorState: StudioPaneState;
    layoutMode: StudioLayoutMode;
    directorOverlayOpen: boolean;
    onDirectorStateChange: (value: StudioPaneState) => void;
    onDirectorOverlayOpenChange: (open: boolean) => void;
  }> = {}
) => {
  const props = {
    directorState: 'expanded' as StudioPaneState,
    layoutMode: 'inline' as StudioLayoutMode,
    directorOverlayOpen: false,
    onDirectorStateChange: vi.fn(),
    onDirectorOverlayOpenChange: vi.fn(),
    ...overrides,
  };
  render(
    <StudioShell {...props} director={<div data-testid='director-child'>conversation</div>}>
      <div data-testid='work-panel-child'>work</div>
    </StudioShell>
  );
  return props;
};

describe('StudioShell', () => {
  it('renders the Director pane beside the work panel', () => {
    renderShell();

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
    expect(screen.getByTestId('work-panel-child')).toBeInTheDocument();
    expect(document.querySelector('[data-studio-director-pane]')).toHaveAttribute('data-collapsed', 'false');
  });

  /**
   * The property that protects a streaming reply.
   *
   * Collapsing must hide the pane without unmounting its subtree. If the collapsed state were
   * `display: none` on an unmounted branch — or worse, a conditional render — a reply arriving
   * while the pane is shut would be lost, and the user would have no idea it had happened.
   */
  it('keeps the conversation mounted while collapsed', () => {
    renderShell({ directorState: 'collapsed' });

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
    expect(document.querySelector('[data-studio-director-pane]')).toHaveAttribute('data-collapsed', 'true');
  });

  it('toggles the preference at inline width', () => {
    const props = renderShell({ directorState: 'expanded', layoutMode: 'inline' });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.shell.hideDirector' }));

    expect(props.onDirectorStateChange).toHaveBeenCalledExactlyOnceWith('collapsed');
    expect(props.onDirectorOverlayOpenChange).not.toHaveBeenCalled();
  });

  /**
   * Below `inline` the pane cannot sit beside the work panel, so the control opens an overlay.
   * That is a transient UI action and must not write a preference — otherwise resizing the window
   * would quietly rewrite what the user chose at a comfortable width.
   */
  it('opens an overlay instead of writing a preference below inline width', () => {
    const props = renderShell({ layoutMode: 'drawer', directorOverlayOpen: false });

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.shell.hideDirector' }));

    expect(props.onDirectorOverlayOpenChange).toHaveBeenCalledExactlyOnceWith(true);
    expect(props.onDirectorStateChange).not.toHaveBeenCalled();
  });

  it('still mounts the conversation when the overlay is closed', () => {
    renderShell({ layoutMode: 'compact', directorOverlayOpen: false });

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
  });
});
