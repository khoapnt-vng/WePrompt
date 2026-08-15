/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioMediaRouteCatalog,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import { EngineStrip, type EngineStripProps } from '@renderer/pages/studio/components/EngineStrip';
import { BriefConversationProvider } from '@renderer/pages/studio/components/Shell/BriefConversationContext';
import type { UseStudioModelsResult } from '@renderer/pages/studio/hooks/useStudioModels';

const recreateDirector = vi.hoisted(() => vi.fn());

vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => ({ state: { kind: 'absent' }, errorMessageKey: null, recreate: recreateDirector }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values
        ? `${key}:${Object.entries(values)
            .map(([name, value]) => `${name}=${String(value)}`)
            .join(',')}`
        : key,
    i18n: { language: 'en-US' },
  }),
}));

const project = (): StudioRendererProject => ({
  schemaVersion: 1,
  revision: 4,
  id: 'project-1',
  name: 'Project',
  brief: 'Brief',
  aspectRatio: '16:9',
  targetDurationSeconds: 30,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:00.000Z',
});

const route = (kind: 'image' | 'video', overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: `choice_${kind}`,
  providerId: `provider_${kind}`,
  providerName: `${kind} provider`,
  model: `${kind}-model`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'selfHostedVideoGateway',
  health: 'available',
  kind,
  constraints: {
    aspectRatios: ['16:9'],
    resolutions: ['1080p'],
    minDurationSeconds: 4,
    maxDurationSeconds: 12,
    supportsFirstFrame: true,
    maxConditioningImages: 0,
    silentOutput: true,
  },
  ...overrides,
});

const media = (overrides: Partial<StudioMediaRouteCatalog> = {}): StudioMediaRouteCatalog => ({
  status: 'selection_required',
  selected: null,
  selectedRoute: null,
  selectionIssue: null,
  options: [],
  ...overrides,
});

const catalog = (overrides: Partial<StudioRouteCatalog> = {}): StudioRouteCatalog => ({
  storyboard: { status: 'selection_required', selected: null, options: [] },
  image: media({ options: [route('image')] }),
  video: media({ options: [route('video')] }),
  catalogVersion: 'catalog-1',
  ...overrides,
});

const modelResult = (overrides: Partial<UseStudioModelsResult> = {}): UseStudioModelsResult => ({
  catalog: catalog(),
  loading: false,
  errorMessageKey: null,
  selectionIssue: null,
  pendingRole: null,
  refresh: vi.fn(async () => {}),
  updateSelection: vi.fn(async () => true),
  ...overrides,
});

const props = (overrides: Partial<EngineStripProps> = {}): EngineStripProps => ({
  project: project(),
  models: modelResult(),
  variant: 'full',
  locked: false,
  openModelSettings: vi.fn(),
  ...overrides,
});

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('EngineStrip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders full and compact variants with both semantic role labels and no title-only disclosure', () => {
    const view = render(<EngineStrip {...props()} />);

    expect(screen.getByRole('region', { name: 'conversation.creativeStudio.models.engine.label' })).toHaveAttribute(
      'data-variant',
      'full'
    );
    expect(screen.getByRole('group', { name: 'conversation.creativeStudio.models.engine.roleImage' })).toBeVisible();
    expect(screen.getByRole('group', { name: 'conversation.creativeStudio.models.engine.roleVideo' })).toBeVisible();
    expect(screen.getByText('image-model')).not.toHaveAttribute('title');

    view.rerender(<EngineStrip {...props({ variant: 'compact' })} />);
    expect(screen.getByRole('region', { name: 'conversation.creativeStudio.models.engine.label' })).toHaveAttribute(
      'data-variant',
      'compact'
    );
  });

  it('keeps labels and descriptions unique when a work view and Brief mount coexist', () => {
    const { container } = render(
      <>
        <EngineStrip {...props()} />
        <EngineStrip {...props({ variant: 'compact' })} />
      </>
    );
    const ids = [...container.querySelectorAll<HTMLElement>('[id]')].map(({ id }) => id);

    expect(new Set(ids).size).toBe(ids.length);
    for (const group of screen.getAllByRole('group')) {
      const labelId = group.getAttribute('aria-labelledby');
      expect(labelId).not.toBeNull();
      expect(container.querySelectorAll(`[id="${labelId}"]`)).toHaveLength(1);
    }
  });

  it('keeps each engine role programmatically focusable with its localized state description', () => {
    render(<EngineStrip {...props()} />);

    const imageSlot = screen.getByRole('group', {
      name: 'conversation.creativeStudio.models.engine.roleImage',
    });
    expect(imageSlot).toHaveAttribute('tabindex', '-1');
    expect(imageSlot).toHaveAccessibleDescription('conversation.creativeStudio.models.engine.notSetCount:count=1');

    imageSlot.focus();
    expect(document.activeElement).toBe(imageSlot);
  });

  it('keeps the healthy compact variant to one line and only shows fallback bounds', () => {
    const selected = route('video');
    const selectedCatalog = catalog({
      video: media({
        status: 'ready',
        selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
        selectedRoute: selected,
        options: [selected],
      }),
    });
    const view = render(
      <EngineStrip
        {...props({
          project: {
            ...project(),
            routing: {
              ...project().routing,
              video: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
            },
          },
          models: modelResult({ catalog: selectedCatalog }),
          variant: 'compact',
        })}
      />
    );

    expect(screen.getByRole('heading', { name: 'conversation.creativeStudio.models.engine.label' })).toBeVisible();
    expect(screen.queryByText(/models\.engine\.boundsFromEngine/)).not.toBeInTheDocument();

    view.rerender(<EngineStrip {...props({ variant: 'compact' })} />);
    expect(screen.getByText(/models\.engine\.boundsFromOptions/)).toBeVisible();
  });

  it('awaits refresh before exposing integration-specific duplicate options and unknown health', async () => {
    const pending = deferred<void>();
    const refresh = vi.fn(() => pending.promise);
    const first = route('video', {
      choiceId: 'choice_video_1',
      model: 'duplicate-model',
      integrationLabelKey: 'bytePlusSeedance',
    });
    const second = route('video', {
      choiceId: 'choice_video_2',
      model: 'duplicate-model',
      integrationLabelKey: 'selfHostedVideoGateway',
      health: 'unknown',
    });
    render(
      <EngineStrip
        {...props({
          models: modelResult({ catalog: catalog({ video: media({ options: [first, second] }) }), refresh }),
        })}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /models\.engine\.notSetVideo/ }));
    expect(refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText(/settings\.mediaModels\.integration\.bytePlusSeedance/)).not.toBeInTheDocument();

    await act(async () => pending.resolve());

    expect(await screen.findByText(/settings\.mediaModels\.integration\.bytePlusSeedance/)).toBeVisible();
    expect(screen.getByText(/settings\.mediaModels\.integration\.selfHostedVideoGateway/)).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.models.engine.unverified')).toBeVisible();
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.manage' })).toBeVisible();
  });

  it('replaces open options with a localized loading row during a footer refresh', async () => {
    const pending = deferred<void>();
    const refresh = vi.fn().mockResolvedValueOnce(undefined).mockReturnValueOnce(pending.promise);
    render(<EngineStrip {...props({ models: modelResult({ refresh }) })} />);

    fireEvent.click(screen.getByRole('button', { name: /models\.engine\.notSetVideo/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.models.engine.refresh' }));

    expect(screen.getByText('conversation.creativeStudio.models.engine.refreshing')).toBeVisible();
    await act(async () => pending.resolve());
    expect(screen.queryByText('conversation.creativeStudio.models.engine.refreshing')).not.toBeInTheDocument();
  });

  it('repeats a selected engine negative first-frame capability without claiming coherence', () => {
    const selected = route('video', {
      constraints: { ...route('video').constraints, supportsFirstFrame: false },
    });
    render(
      <EngineStrip
        {...props({
          models: modelResult({
            catalog: catalog({
              video: media({
                status: 'ready',
                selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
                selectedRoute: selected,
                options: [selected],
              }),
            }),
          }),
        })}
      />
    );

    expect(screen.getAllByText(/models\.engine\.frameNo/)[0]).toBeVisible();
    expect(screen.queryByText(/coherence/i)).not.toBeInTheDocument();
  });

  it('keeps a selected Image summary truthful while menu rows retain clip capabilities', async () => {
    const selected = route('image', {
      constraints: {
        ...route('image').constraints,
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
      },
    });
    render(
      <EngineStrip
        {...props({
          models: modelResult({
            catalog: catalog({
              image: media({
                status: 'ready',
                selected: { choiceId: selected.choiceId, providerId: selected.providerId, model: selected.model },
                selectedRoute: selected,
                options: [selected],
              }),
            }),
          }),
        })}
      />
    );

    const imageTrigger = screen.getByRole('button', { name: 'image-model' });
    expect(
      screen.getByText(
        'conversation.creativeStudio.models.engine.summaryImage:resolution=720p, 1080p,frame=conversation.creativeStudio.models.engine.frameYes',
        { selector: 'p' }
      )
    ).toBeVisible();
    expect(imageTrigger).toHaveAccessibleDescription(
      'conversation.creativeStudio.models.engine.summaryImage:resolution=720p, 1080p,frame=conversation.creativeStudio.models.engine.frameYes'
    );

    fireEvent.click(imageTrigger);
    const menu = await screen.findByRole('menu');
    expect(
      within(menu).getByText(
        'conversation.creativeStudio.models.engine.summary:resolution=720p, 1080p,duration=conversation.creativeStudio.models.engine.durationRange:min=1,max=60,audio=conversation.creativeStudio.models.engine.audioSilent,frame=conversation.creativeStudio.models.engine.frameYes'
      )
    ).toBeVisible();
  });

  it('selects exactly the chosen row and does not auto-write a pre-armed sole option', async () => {
    const updateSelection = vi.fn(async () => true);
    render(<EngineStrip {...props({ models: modelResult({ updateSelection }) })} />);

    expect(updateSelection).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /models\.engine\.notSetVideo/ }));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByText(/video-model/));

    await waitFor(() =>
      expect(updateSelection).toHaveBeenCalledExactlyOnceWith({
        role: 'video',
        selection: { choiceId: 'choice_video' },
      })
    );
  });

  it('opens Settings from a zero-option slot and from the menu footer without selecting', async () => {
    const openModelSettings = vi.fn();
    const updateSelection = vi.fn(async () => true);
    render(
      <EngineStrip
        {...props({
          openModelSettings,
          models: modelResult({
            catalog: catalog({ image: media(), video: media({ options: [route('video')] }) }),
            updateSelection,
          }),
        })}
      />
    );

    fireEvent.click(
      screen.getAllByRole('button', { name: 'conversation.creativeStudio.models.engine.manageShort' })[0]
    );
    expect(openModelSettings).toHaveBeenCalledWith('/settings/model');

    fireEvent.click(screen.getByRole('button', { name: /models\.engine\.notSetVideo/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'conversation.creativeStudio.models.engine.manage' }));
    expect(openModelSettings).toHaveBeenCalledTimes(2);
    expect(updateSelection).not.toHaveBeenCalled();
  });

  it('disables both triggers for single-flight and lock states with accessible explanations', () => {
    const pendingView = render(<EngineStrip {...props({ models: modelResult({ pendingRole: 'video' }) })} />);
    const pendingButtons = screen.getAllByRole('button', { name: /models\.engine\.(notSet|saving)/ });
    expect(pendingButtons).toHaveLength(2);
    expect(pendingButtons.every((button) => button.hasAttribute('disabled'))).toBe(true);
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.saving' })).toHaveAttribute(
      'aria-busy',
      'true'
    );
    expect(screen.getByRole('button', { name: /models\.engine\.notSetImage/ })).toHaveAccessibleDescription(
      'conversation.creativeStudio.models.engine.savingOther'
    );

    pendingView.rerender(<EngineStrip {...props({ locked: true })} />);
    for (const button of screen.getAllByRole('button', { name: /models\.engine\.notSet/ })) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('conversation.creativeStudio.models.engine.lockedDuringReview');
    }
  });

  it('describes locked static Manage engines actions with the existing lock explanation', () => {
    render(
      <EngineStrip
        {...props({
          locked: true,
          models: modelResult({ catalog: catalog({ image: media(), video: media() }) }),
        })}
      />
    );

    for (const button of screen.getAllByRole('button', {
      name: 'conversation.creativeStudio.models.engine.manageShort',
    })) {
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription('conversation.creativeStudio.models.engine.lockedDuringReview');
    }
  });

  it('keeps a successful selection stale across variants and clears it only when starting a new brief', async () => {
    const updateSelection = vi.fn(async () => true);
    const sharedProps = props({ models: modelResult({ updateSelection }) });
    const view = render(
      <BriefConversationProvider project={sharedProps.project}>
        <EngineStrip {...sharedProps} />
      </BriefConversationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /models\.engine\.notSetVideo/ }));
    fireEvent.click(within(await screen.findByRole('menu')).getByText(/video-model/));
    await waitFor(() => expect(updateSelection).toHaveBeenCalledOnce());
    expect(await screen.findByText(/models\.engine\.directorStale:model=video-model/)).toBeVisible();

    view.rerender(
      <BriefConversationProvider project={sharedProps.project}>
        <EngineStrip {...sharedProps} variant='compact' />
      </BriefConversationProvider>
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'conversation.creativeStudio.models.engine.directorStaleAction' })
    );

    expect(recreateDirector).toHaveBeenCalledOnce();
    expect(screen.queryByText(/models\.engine\.directorStale:model=/)).not.toBeInTheDocument();
  });

  it('does not mark the Director stale after a refused selection', async () => {
    const updateSelection = vi.fn(async () => false);
    const failedProps = props({ models: modelResult({ updateSelection }) });
    render(
      <BriefConversationProvider project={failedProps.project}>
        <EngineStrip {...failedProps} />
      </BriefConversationProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: /models\.engine\.notSetVideo/ }));
    fireEvent.click(within(await screen.findByRole('menu')).getByText(/video-model/));
    await waitFor(() => expect(updateSelection).toHaveBeenCalledOnce());

    expect(screen.queryByText(/models\.engine\.directorStale:model=/)).not.toBeInTheDocument();
  });
});
