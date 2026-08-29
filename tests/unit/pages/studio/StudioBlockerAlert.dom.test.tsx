/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import {
  STUDIO_ROUTE_CATALOG_BLOCKER_KEY,
  StudioBlockerAlert,
  StudioBlockerRemedy,
} from '@renderer/pages/studio/components/StudioBlockerAlert';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

/**
 * BUG-183. The route-catalogue blocker named a control the person could not find: "Refresh routes"
 * lives in the More menu, and the banner said so only after the copy was rewritten — a fix that
 * goes stale the moment the menu moves. The control now travels with the message.
 *
 * The narrowness is the point. Every other blocker keeps rendering exactly as it did, so the
 * generic error path does not turn into a table of special cases.
 */
describe('StudioBlockerAlert', () => {
  const refreshLabel = 'conversation.creativeStudio.workspace.controls.refreshRoutes';

  it('renders nothing when there is no blocker', () => {
    const { container } = render(<StudioBlockerAlert messageKey={null} onRefreshRoutes={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers the remedy beside the route-catalogue blocker, and runs it once clicked', () => {
    const onRefreshRoutes = vi.fn();
    render(<StudioBlockerAlert messageKey={STUDIO_ROUTE_CATALOG_BLOCKER_KEY} onRefreshRoutes={onRefreshRoutes} />);

    expect(screen.getByText(STUDIO_ROUTE_CATALOG_BLOCKER_KEY)).toBeInTheDocument();
    const action = screen.getByText(refreshLabel);
    fireEvent.click(action);
    expect(onRefreshRoutes).toHaveBeenCalledTimes(1);
  });

  it('states the blocker without an action when no refresh is reachable', () => {
    // Surfaces that cannot refresh must not grow a dead button.
    render(<StudioBlockerAlert messageKey={STUDIO_ROUTE_CATALOG_BLOCKER_KEY} />);
    expect(screen.getByText(STUDIO_ROUTE_CATALOG_BLOCKER_KEY)).toBeInTheDocument();
    expect(screen.queryByText(refreshLabel)).toBeNull();
  });

  it('leaves every other blocker exactly as it was', () => {
    const onRefreshRoutes = vi.fn();
    const other = 'conversation.creativeStudio.workspace.controls.statusRequired';
    render(<StudioBlockerAlert messageKey={other} onRefreshRoutes={onRefreshRoutes} />);

    expect(screen.getByText(other)).toBeInTheDocument();
    expect(screen.queryByText(refreshLabel)).toBeNull();
    expect(onRefreshRoutes).not.toHaveBeenCalled();
  });

  it('offers the bare remedy where the surface owns its own alert role', () => {
    // The workspace shell wraps its notice in role='alert'; a nested Arco Alert would announce the
    // same blocker twice, so that surface takes the control without the box.
    const onRefreshRoutes = vi.fn();
    const { container } = render(
      <StudioBlockerRemedy messageKey={STUDIO_ROUTE_CATALOG_BLOCKER_KEY} onRefreshRoutes={onRefreshRoutes} />
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
    fireEvent.click(screen.getByText(refreshLabel));
    expect(onRefreshRoutes).toHaveBeenCalledTimes(1);
  });

  it('renders no bare remedy for any other blocker', () => {
    const { container } = render(
      <StudioBlockerRemedy
        messageKey='conversation.creativeStudio.workspace.controls.statusRequired'
        onRefreshRoutes={vi.fn()}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the remedy working rather than leaving the person clicking a dead control', () => {
    render(
      <StudioBlockerAlert messageKey={STUDIO_ROUTE_CATALOG_BLOCKER_KEY} onRefreshRoutes={vi.fn()} refreshing={true} />
    );
    // Arco renders a loading Button with its own spinner element; assert the button is present and
    // marked loading rather than reaching for an internal class name.
    const button = screen.getByText(refreshLabel).closest('button');
    expect(button).not.toBeNull();
    expect(button!.className).toMatch(/loading/);
  });
});
