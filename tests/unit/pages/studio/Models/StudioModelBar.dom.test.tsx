/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { StudioRouteCatalog, StudioRouteCatalogEntry } from '@/common/types/project/creativeStudioTypes';
import { StudioModelBar, type StudioModelBarProps } from '@renderer/pages/studio/components/Models/StudioModelBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
    // EngineBar joins the ready media kinds with Intl.ListFormat, so the locale must exist.
    i18n: { language: 'en' },
  }),
}));

const mediaRoute = (
  kind: 'image' | 'video',
  overrides: Partial<StudioRouteCatalogEntry> = {}
): StudioRouteCatalogEntry => ({
  choiceId: `choice_${kind}`,
  providerId: `${kind}-provider`,
  providerName: `${kind} Provider`,
  model: `${kind}-model`,
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['720p'],
    minDurationSeconds: 1,
    maxDurationSeconds: 60,
    supportsFirstFrame: true,
    silentOutput: true,
  },
  ...overrides,
});

const catalog = (overrides: Partial<StudioRouteCatalog> = {}): StudioRouteCatalog => ({
  storyboard: {
    status: 'selection_required',
    selected: null,
    options: [],
  },
  image: { status: 'selection_required', selected: null, selectedRoute: null, options: [mediaRoute('image')] },
  video: { status: 'selection_required', selected: null, selectedRoute: null, options: [mediaRoute('video')] },
  catalogVersion: 'catalog-1',
  ...overrides,
});

/** The engine strip keeps model names and duration contracts out of the visible chip, so pin the exact text. */
const SELECTED_IMAGE_SUMMARY =
  'conversation.creativeStudio.phase.produce.engineSummary:model=selected-image-model,kind=conversation.creativeStudio.scene.image,seconds=47';

/** Ready image role whose selected route is only one of two catalog options. */
const readySelectedImageCatalog = (): StudioRouteCatalog => {
  const selected = mediaRoute('image', {
    model: 'selected-image-model',
    constraints: { ...mediaRoute('image').constraints, maxDurationSeconds: 47 },
  });
  return catalog({
    image: {
      status: 'ready',
      selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
      selectedRoute: selected,
      options: [selected, mediaRoute('image', { choiceId: 'unused', model: 'unused-option' })],
    },
  });
};

const props = (overrides: Partial<StudioModelBarProps> = {}): StudioModelBarProps => ({
  catalog: catalog(),
  disabled: false,
  onOpenSettings: vi.fn(),
  ...overrides,
});

describe('StudioModelBar', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does not turn available options into implicit project selections', () => {
    const { container } = render(<StudioModelBar {...props()} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('shows only real ready selected routes and their contract duration', () => {
    render(<StudioModelBar {...props({ catalog: readySelectedImageCatalog() })} />);

    // The chip keeps the detail behind a hover, so the spend-relevant model name and the
    // maxDurationSeconds contract must stay reachable through the trigger's description.
    expect(screen.getByRole('button', { name: /engineKinds/ })).toHaveAccessibleDescription(SELECTED_IMAGE_SUMMARY);
    expect(screen.queryByText(/unused-option/)).not.toBeInTheDocument();
  });

  it('reveals the selected route detail on keyboard focus, not only on hover', async () => {
    render(<StudioModelBar {...props({ catalog: readySelectedImageCatalog() })} />);

    fireEvent.focus(screen.getByRole('button', { name: /engineKinds/ }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(SELECTED_IMAGE_SUMMARY);
  });

  it('reveals the selected route detail on a bare tap, without focus or hover', async () => {
    render(<StudioModelBar {...props({ catalog: readySelectedImageCatalog() })} />);

    // A touch tap must not depend on Chromium also focusing the tapped button, so `click`
    // is listed on the trigger in its own right. Clicking alone has to be enough.
    fireEvent.click(screen.getByRole('button', { name: /engineKinds/ }));

    expect(await screen.findByRole('tooltip')).toHaveTextContent(SELECTED_IMAGE_SUMMARY);
  });

  it('opens the existing Model Settings surface from Change engines', () => {
    const onOpenSettings = vi.fn();
    const selected = mediaRoute('video');
    render(
      <StudioModelBar
        {...props({
          catalog: catalog({
            video: {
              status: 'ready',
              selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
              selectedRoute: selected,
              options: [selected],
            },
          }),
          onOpenSettings,
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.produce.changeEngines' }));

    expect(onOpenSettings).toHaveBeenCalledExactlyOnceWith('/settings/model');
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
