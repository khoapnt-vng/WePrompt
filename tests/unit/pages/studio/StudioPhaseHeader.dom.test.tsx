/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import type { StudioRendererProject } from '@/common/types/project/creativeStudioTypes';
import type { StudioPhaseHeaderProps } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseHeader';
import { StudioPhaseHeader } from '@renderer/pages/studio/components/PhaseShell/StudioPhaseHeader';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const project: StudioRendererProject = {
  schemaVersion: 1,
  revision: 2,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

describe('StudioPhaseHeader', () => {
  it('keeps the project breadcrumb, save state, and active phase action in one header', () => {
    render(
      <StudioPhaseHeader project={project} saveState='saved' onBack={vi.fn()} actions={<span>phase action</span>} />
    );

    expect(
      screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.shared.backToLibrary' })
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.library.title' })).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.phase.nav.saved');
    expect(screen.getByText('phase action')).toBeVisible();
    expect(screen.queryByText('A short launch video')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.project.readiness')).not.toBeInTheDocument();
  });

  /**
   * The header is a breadcrumb, not a back button with a title next to it. "Creative Studio" is
   * the crumb that returns to the library, and the project name follows it after a separator —
   * so where you are is legible without reading an icon.
   */
  it('reads as a Creative Studio breadcrumb ending in the project name', () => {
    const onBack = vi.fn();
    render(<StudioPhaseHeader project={project} saveState='saved' onBack={onBack} />);

    // Looked up by the crumb's own words: WCAG 2.5.3 (Label in Name) requires the accessible
    // name to contain the visible label, so a speech-input user can say what they can read.
    // An aria-label describing the destination instead of the crumb replaces the name and
    // leaves "click Creative Studio" matching nothing.
    const crumb = screen.getByRole('button', { name: 'conversation.creativeStudio.library.title' });
    expect(crumb).toHaveTextContent('conversation.creativeStudio.library.title');
    fireEvent.click(crumb);
    expect(onBack).toHaveBeenCalledOnce();

    expect(screen.getByRole('heading', { level: 1, name: 'Launch film' })).toBeVisible();
  });

  /**
   * The rail is a sibling row that StudioPhaseShell owns; the header must not host it. Handing
   * the header a rail-shaped slot is what makes the assertion falsifiable: if the `navigation`
   * prop is ever restored to this component, the list below renders and this test goes red.
   */
  it('does not host the phase rail even when handed one', () => {
    const HeaderWithLegacyNavigationSlot = StudioPhaseHeader as React.FC<
      StudioPhaseHeaderProps & { navigation?: React.ReactNode }
    >;

    render(
      <HeaderWithLegacyNavigationSlot
        project={project}
        saveState='saved'
        onBack={vi.fn()}
        navigation={
          <ol>
            <li>phase rail</li>
          </ol>
        }
      />
    );

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByText('phase rail')).not.toBeInTheDocument();
  });

  it('leaves the aspect ratio to the Brief panel rather than restating it as a header chip', () => {
    render(<StudioPhaseHeader project={project} saveState='saved' onBack={vi.fn()} />);

    expect(screen.queryByText('16:9')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/conversation\.creativeStudio\.project\.aspectRatio/)).not.toBeInTheDocument();
  });

  it('omits the action container when the active phase has no page-level action', () => {
    const { container } = render(<StudioPhaseHeader project={project} saveState='saving' onBack={vi.fn()} />);

    expect(container.querySelector('[data-studio-phase-actions]')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('conversation.creativeStudio.phase.nav.saving');
  });

  it.each([
    ['dirty', 'conversation.creativeStudio.phase.nav.saving'],
    ['failed', 'conversation.creativeStudio.inspector.saveFailed'],
  ] as const)('announces the %s shell save state', (saveState, messageKey) => {
    render(<StudioPhaseHeader project={project} saveState={saveState} onBack={vi.fn()} />);

    expect(screen.getByRole('status')).toHaveTextContent(messageKey);
  });
});
