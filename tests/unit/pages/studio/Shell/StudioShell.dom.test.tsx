/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioLayoutMode } from '@renderer/pages/studio/components/PhaseShell/useStudioLayoutMode';

// jsdom measures every element at 0 width, so the shell would always select `compact` and the
// inline pane could never be exercised. The mode is driven directly instead.
const layout: { mode: StudioLayoutMode } = { mode: 'inline' };
vi.mock('@renderer/pages/studio/components/PhaseShell/useStudioLayoutMode', () => ({
  useStudioLayoutMode: () => ({ containerRef: { current: null }, layoutMode: layout.mode }),
}));

const { StudioShell } = await import('@renderer/pages/studio/components/Shell/StudioShell');

const renderShell = (mode: StudioLayoutMode = 'inline') => {
  layout.mode = mode;
  render(
    <StudioShell projectId='project-1' director={<div data-testid='director-child'>conversation</div>}>
      <div data-testid='work-panel-child'>work</div>
    </StudioShell>
  );
};

describe('StudioShell', () => {
  // The pane preference persists by design, so it must be cleared or one test decides the next.
  beforeEach(() => {
    localStorage.clear();
  });

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
    renderShell('inline');

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.shell.hideDirector' }));

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
    expect(document.querySelector('[data-studio-director-pane]')).toHaveAttribute('data-collapsed', 'true');
  });

  it('persists the collapse chosen at inline width', () => {
    renderShell('inline');

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.shell.hideDirector' }));

    expect(localStorage.getItem('studio.directorPane.collapsed')).toBe('1');
  });

  /**
   * Below `inline` the pane cannot sit beside the work panel, so the control opens an overlay.
   * That is a transient UI action and must not write a preference — otherwise resizing the window
   * would quietly rewrite what the user chose at a comfortable width.
   */
  /**
   * Below inline width the control opens an overlay. It must not write a preference — otherwise
   * resizing the window would quietly rewrite what the user chose at a comfortable width.
   */
  it('opens an overlay instead of writing a preference below inline width', () => {
    renderShell('drawer');

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.shell.showDirector' }));

    expect(localStorage.getItem('studio.directorPane.collapsed')).toBeNull();
  });

  it('still mounts the conversation when the overlay is closed', () => {
    renderShell('compact');

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
  });
});
