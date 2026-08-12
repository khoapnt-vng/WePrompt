/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Button } from '@arco-design/web-react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const shellStyles = (await import('@renderer/pages/studio/components/Shell/StudioShell.module.css')).default;

const SHOW_DIRECTOR = 'conversation.creativeStudio.shell.showDirector';
const HIDE_DIRECTOR = 'conversation.creativeStudio.shell.hideDirector';

/**
 * Stands in for DirectorPane: it holds local state (the real pane holds the first-message composer
 * text in `useState`) and counts its own mounts, so a test can tell "still the same component
 * instance" from "torn down and rebuilt".
 */
const directorLifecycle = { mounts: 0 };
const DirectorProbe: React.FC = () => {
  const [draft, setDraft] = React.useState('');
  React.useEffect(() => {
    directorLifecycle.mounts += 1;
  }, []);
  return (
    <div data-testid='director-child'>
      <span data-testid='director-draft'>{draft}</span>
      <Button onClick={() => setDraft('an opening brief')}>director-compose</Button>
    </div>
  );
};

const renderShell = (mode: StudioLayoutMode = 'inline', director?: React.ReactNode) => {
  layout.mode = mode;
  const tree = () => (
    <StudioShell projectId='project-1' director={director ?? <div data-testid='director-child'>conversation</div>}>
      {/* The phase heading StudioPhaseShell focuses after a transition; the shell must not fight it. */}
      <h2 data-studio-phase-heading data-testid='phase-heading' tabIndex={-1}>
        phase
      </h2>
      <div data-testid='work-panel-child'>work</div>
    </StudioShell>
  );
  const view = render(tree());
  return {
    ...view,
    /** Re-renders the same shell at a different measured width, as a resize would. */
    setLayout: (next: StudioLayoutMode) => {
      layout.mode = next;
      view.rerender(tree());
    },
  };
};

/** Arco marks a shut Drawer with `-wrapper-hide` (`display: none`) rather than unmounting it here. */
const overlayVisible = (): boolean => {
  const wrapper = document.querySelector('.arco-drawer-wrapper');
  return wrapper !== null && !wrapper.classList.contains('arco-drawer-wrapper-hide');
};

describe('StudioShell', () => {
  // The pane preference persists by design, so it must be cleared or one test decides the next.
  beforeEach(() => {
    localStorage.clear();
    directorLifecycle.mounts = 0;
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

    fireEvent.click(screen.getByRole('button', { name: HIDE_DIRECTOR }));

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
    expect(document.querySelector('[data-studio-director-pane]')).toHaveAttribute('data-collapsed', 'true');
  });

  it('persists the collapse chosen at inline width', () => {
    renderShell('inline');

    fireEvent.click(screen.getByRole('button', { name: HIDE_DIRECTOR }));

    expect(localStorage.getItem('studio.directorPane.collapsed')).toBe('1');
  });

  /**
   * The same property, across the *width* boundary rather than the collapse control.
   *
   * Inline and overlay are two presentations of one conversation, so crossing 1120px must not be a
   * lifecycle event: anything the user has typed into the Director's composer, and any reply
   * streaming into the mounted chat, has to survive the window being widened or narrowed.
   */
  it('keeps the Director mounted and its state intact across the inline width threshold', () => {
    const view = renderShell('inline', <DirectorProbe />);

    fireEvent.click(screen.getByRole('button', { name: 'director-compose' }));
    expect(screen.getByTestId('director-draft')).toHaveTextContent('an opening brief');
    expect(directorLifecycle.mounts).toBe(1);

    view.setLayout('drawer');
    expect(directorLifecycle.mounts).toBe(1);
    expect(screen.getByTestId('director-draft')).toHaveTextContent('an opening brief');

    view.setLayout('inline');
    expect(directorLifecycle.mounts).toBe(1);
    expect(screen.getByTestId('director-draft')).toHaveTextContent('an opening brief');
  });

  /**
   * Below `inline` the pane cannot sit beside the work panel, so the control opens an overlay.
   * That is a transient UI action and must not write a preference — otherwise resizing the window
   * would quietly rewrite what the user chose at a comfortable width.
   */
  it('opens an overlay instead of writing a preference below inline width', () => {
    renderShell('drawer');

    fireEvent.click(screen.getByRole('button', { name: SHOW_DIRECTOR }));

    expect(localStorage.getItem('studio.directorPane.collapsed')).toBeNull();
  });

  /**
   * Below inline width the overlay is the *only* route to the Director, so the toggle actually
   * showing it is the property under test — asserting that no preference was written says nothing
   * about whether the conversation is reachable at all.
   */
  it('shows the Director in the overlay when the toggle is pressed below inline width', () => {
    renderShell('drawer');

    expect(overlayVisible()).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: SHOW_DIRECTOR }));

    expect(overlayVisible()).toBe(true);
    expect(document.querySelector('.arco-drawer')).toContainElement(screen.getByTestId('director-child'));
  });

  /** The name and the state have to agree: in overlay mode the label used to say "show" while open. */
  it('names the toggle for what it will do while the overlay is open', () => {
    renderShell('drawer');
    const toggle = screen.getByRole('button', { name: SHOW_DIRECTOR });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-label', HIDE_DIRECTOR);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);

    expect(overlayVisible()).toBe(false);
    expect(toggle).toHaveAttribute('aria-label', SHOW_DIRECTOR);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * Opening the overlay is bound to the presentation, not to the project: leaving overlay mode has
   * to clear it, or the next narrow render puts a masked 352px panel over the work panel that the
   * user never asked for.
   */
  it('does not reopen the overlay by itself after the layout leaves overlay mode', () => {
    const view = renderShell('drawer');
    fireEvent.click(screen.getByRole('button', { name: SHOW_DIRECTOR }));
    expect(overlayVisible()).toBe(true);

    view.setLayout('inline');
    view.setLayout('drawer');

    expect(overlayVisible()).toBe(false);
    expect(screen.getByRole('button', { name: SHOW_DIRECTOR })).toHaveAttribute('aria-expanded', 'false');
  });

  it('still mounts the conversation when the overlay is closed', () => {
    renderShell('compact');

    expect(screen.getByTestId('director-child')).toBeInTheDocument();
  });

  /**
   * Focus must not be dropped on `<body>` when the Director stops being reachable — the same
   * requirement AssistantDock already implements for its own drawer.
   */
  it('returns focus to the toggle when Escape closes the Director overlay', async () => {
    renderShell('drawer', <DirectorProbe />);
    const toggle = screen.getByRole('button', { name: SHOW_DIRECTOR });
    fireEvent.click(toggle);
    const inside = screen.getByRole('button', { name: 'director-compose' });
    inside.focus();
    expect(inside).toHaveFocus();

    const wrapper = document.querySelector('.arco-drawer-wrapper');
    expect(wrapper).not.toBeNull();
    fireEvent.keyDown(wrapper as HTMLElement, { key: 'Escape', keyCode: 27, which: 27 });

    await waitFor(() => expect(toggle).toHaveFocus());
  });

  it('returns focus to the toggle when collapsing the pane strands it inside the Director', () => {
    renderShell('inline', <DirectorProbe />);
    const inside = screen.getByRole('button', { name: 'director-compose' });
    inside.focus();
    const toggle = screen.getByRole('button', { name: HIDE_DIRECTOR });

    fireEvent.click(toggle);

    expect(toggle).toHaveFocus();
  });

  it('keeps focus where it is when the layout crosses the inline threshold', () => {
    const view = renderShell('drawer', <DirectorProbe />);
    fireEvent.click(screen.getByRole('button', { name: SHOW_DIRECTOR }));
    const inside = screen.getByRole('button', { name: 'director-compose' });
    inside.focus();

    view.setLayout('inline');

    expect(inside).toHaveFocus();
  });

  /**
   * StudioPhaseShell focuses `[data-studio-phase-heading]` after every phase transition. The
   * shell's own focus handling must only recover focus that was stranded, never take it from the
   * phase — that target has been broken before.
   */
  it('leaves the phase focus target alone when the Director pane collapses', () => {
    renderShell('inline', <DirectorProbe />);
    const heading = screen.getByTestId('phase-heading');
    heading.focus();

    fireEvent.click(screen.getByRole('button', { name: HIDE_DIRECTOR }));

    expect(heading).toHaveFocus();
  });

  /**
   * `.paneToggle` positions this control over the work panel. Without the class the button is the
   * first stretched item of a flex column and takes a full-width row above the phase header.
   */
  it('gives the collapse toggle its floating class instead of leaving it in the work-panel flow', () => {
    renderShell('inline');

    expect(screen.getByRole('button', { name: HIDE_DIRECTOR })).toHaveClass(shellStyles.paneToggle);
  });

  /**
   * The work panel scrolls, the frame does not.
   *
   * When the frame scrolled, a phase taller than the window took the Director column with it and
   * the composer went below the fold — unreachable without scrolling the work away. So the phase
   * lives in a scroll box and the toggle stays outside it: the toggle is the control that brings
   * the Director back, and a control that scrolls out of reach cannot do that job.
   *
   * jsdom performs no layout, so this pins the structure only. `overflow-y` itself is checked
   * against the real stylesheet in studioFrameLayout.test.ts.
   */
  it('puts the phase inside the work panel scroll box and leaves the toggle outside it', () => {
    renderShell('inline');

    const scroll = document.querySelector('[data-studio-work-scroll]');
    expect(scroll).toHaveClass(shellStyles.workScroll);
    expect(scroll).toContainElement(screen.getByTestId('work-panel-child'));
    expect(scroll).toContainElement(screen.getByTestId('phase-heading'));
    expect(scroll).not.toContainElement(screen.getByRole('button', { name: HIDE_DIRECTOR }));
  });

  /** The Director is the shell's own column, never inside the work panel's scroll box. */
  it('keeps the Director out of the work panel scroll box', () => {
    renderShell('inline');

    expect(document.querySelector('[data-studio-work-scroll]')).not.toContainElement(
      screen.getByTestId('director-child')
    );
  });
});
