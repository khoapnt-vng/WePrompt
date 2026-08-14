/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioMediaRouteCatalog,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import { useStudioModels } from '@renderer/pages/studio/hooks/useStudioModels';

const bridge = vi.hoisted(() => ({
  listRoutes: { invoke: vi.fn() },
  updateModelSelection: { invoke: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));

const ok = <T>(data: T): StudioCommandResult<T> => ({ ok: true, data });
const failed = <T>(
  code: 'stale_project' | 'provider_error' | 'storage_error',
  messageKey = `conversation.creativeStudio.errors.${code}`
): StudioCommandResult<T> => ({ ok: false, error: { code, messageKey } });

const project = (id = 'project-1', revision = 4): StudioRendererProject => ({
  schemaVersion: 1,
  revision,
  id,
  name: id,
  brief: 'Brief',
  aspectRatio: '16:9',
  targetDurationSeconds: 15,
  resolution: '720p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-31T00:00:00.000Z',
  updatedAt: '2026-07-31T00:00:00.000Z',
});

const catalog = (version: string): StudioRouteCatalog => ({
  storyboard: { status: 'selection_required', selected: null, options: [] },
  image: { status: 'selection_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  video: { status: 'selection_required', selected: null, selectedRoute: null, selectionIssue: null, options: [] },
  catalogVersion: version,
});

const route = (kind: 'image' | 'video', overrides: Partial<StudioRouteCatalogEntry> = {}): StudioRouteCatalogEntry => ({
  choiceId: `choice_${kind}`,
  providerId: `provider-${kind}`,
  providerName: `${kind} provider`,
  model: `${kind}-model`,
  integrationLabelKey: kind === 'image' ? 'imageApi' : 'selfHostedVideoGateway',
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

const unchosen = (entry: StudioRouteCatalogEntry, ...rest: StudioRouteCatalogEntry[]): StudioMediaRouteCatalog => ({
  status: 'selection_required',
  selected: null,
  selectedRoute: null,
  selectionIssue: null,
  options: [entry, ...rest],
});

const catalogWith = (version: string, media: Partial<StudioRouteCatalog>): StudioRouteCatalog => ({
  ...catalog(version),
  ...media,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

describe('useStudioModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    bridge.listRoutes.invoke.mockResolvedValue(ok(catalog('catalog-1')));
    bridge.updateModelSelection.invoke.mockResolvedValue(ok(project('project-1', 5)));
  });

  it('ignores a late catalog response from a previous project', async () => {
    const first = deferred<StudioCommandResult<StudioRouteCatalog>>();
    const second = deferred<StudioCommandResult<StudioRouteCatalog>>();
    bridge.listRoutes.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const view = renderHook(
      ({ currentProject }) =>
        useStudioModels({
          project: currentProject,
          refetch: vi.fn(async () => currentProject),
          beforeMutation: vi.fn(async () => true),
        }),
      { initialProps: { currentProject: project('project-1') } }
    );

    view.rerender({ currentProject: project('project-2') });
    second.resolve(ok(catalog('catalog-2')));
    first.resolve(ok(catalog('catalog-1')));

    await waitFor(() => expect(view.result.current.catalog?.catalogVersion).toBe('catalog-2'));
  });

  it('persists a selection with the canonical project revision after flushing edits', async () => {
    const initial = project();
    const canonical = project('project-1', 9);
    const beforeMutation = vi.fn(async () => true);
    const view = renderHook(
      ({ currentProject }) =>
        useStudioModels({
          project: currentProject,
          refetch: vi.fn(async () => canonical),
          beforeMutation,
        }),
      { initialProps: { currentProject: initial } }
    );
    view.rerender({ currentProject: canonical });

    await act(() =>
      view.result.current.updateSelection({
        role: 'storyboard',
        selection: { providerId: 'provider_1', model: 'gpt-4o' },
      })
    );

    expect(beforeMutation).toHaveBeenCalledOnce();
    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledWith({
      projectId: canonical.id,
      expectedRevision: canonical.revision,
      role: 'storyboard',
      selection: { providerId: 'provider_1', model: 'gpt-4o' },
    });
  });

  it('allows only one same-tick selection mutation to enter edit flushing', async () => {
    const flush = deferred<boolean>();
    const beforeMutation = vi.fn(() => flush.promise);
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project('project-1', 5)),
        beforeMutation,
      })
    );

    let first!: Promise<boolean>;
    let second!: Promise<boolean>;
    act(() => {
      first = view.result.current.updateSelection({ role: 'storyboard', selection: null });
      second = view.result.current.updateSelection({ role: 'image', selection: null });
    });

    expect(beforeMutation).toHaveBeenCalledOnce();
    await expect(second).resolves.toBe(false);

    flush.resolve(true);
    await act(() => first);

    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledOnce();
    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'project-1', role: 'storyboard' })
    );
  });

  it('does not carry a selection mutation to a project entered while edit flushing', async () => {
    const flush = deferred<boolean>();
    const beforeMutation = vi.fn(() => flush.promise);
    const view = renderHook(
      ({ currentProject }) =>
        useStudioModels({
          project: currentProject,
          refetch: vi.fn(async () => currentProject),
          beforeMutation,
        }),
      { initialProps: { currentProject: project('project-1') } }
    );

    let update!: Promise<boolean>;
    act(() => {
      update = view.result.current.updateSelection({ role: 'storyboard', selection: null });
    });
    view.rerender({ currentProject: project('project-2') });
    flush.resolve(true);

    await expect(update).resolves.toBe(false);
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
  });

  it('does not mutate after unmount while edit flushing is pending', async () => {
    const flush = deferred<boolean>();
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(() => flush.promise),
      })
    );

    let update!: Promise<boolean>;
    act(() => {
      update = view.result.current.updateSelection({ role: 'storyboard', selection: null });
    });
    view.unmount();
    flush.resolve(true);

    await expect(update).resolves.toBe(false);
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
  });

  it('does not mutate when edit flushing is blocked', async () => {
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => false),
      })
    );

    const updated = await act(() => view.result.current.updateSelection({ role: 'storyboard', selection: null }));

    expect(updated).toBe(false);
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
  });

  it('supports clearing a selection and refetches before refreshing the catalog', async () => {
    const events: string[] = [];
    bridge.updateModelSelection.invoke.mockImplementation(async () => {
      events.push('mutation');
      return ok(project('project-1', 5));
    });
    const refetch = vi.fn(async () => {
      events.push('refetch');
      return project('project-1', 5);
    });
    bridge.listRoutes.invoke.mockImplementation(async () => {
      events.push('catalog');
      return ok(catalog('catalog-2'));
    });
    const view = renderHook(() =>
      useStudioModels({ project: project(), refetch, beforeMutation: vi.fn(async () => true) })
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));
    events.length = 0;

    const updated = await act(() => view.result.current.updateSelection({ role: 'image', selection: null }));

    expect(updated).toBe(true);
    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 4,
      role: 'image',
      selection: null,
    });
    expect(events).toEqual(['mutation', 'refetch', 'catalog']);
  });

  it('refetches a stale project without replaying the mutation', async () => {
    bridge.updateModelSelection.invoke.mockResolvedValue(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const refetch = vi.fn(async () => project('project-1', 8));
    const view = renderHook(() =>
      useStudioModels({ project: project(), refetch, beforeMutation: vi.fn(async () => true) })
    );

    const updated = await act(() =>
      view.result.current.updateSelection({
        role: 'video',
        selection: { choiceId: 'choice_video' },
      })
    );

    expect(updated).toBe(false);
    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledOnce();
    expect(refetch).toHaveBeenCalledOnce();
    expect(view.result.current.errorMessageKey).toBe('conversation.creativeStudio.errors.staleProject');
  });

  it('uses safe model copy for list and mutation failures', async () => {
    bridge.listRoutes.invoke.mockResolvedValueOnce(failed('provider_error'));
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => true),
      })
    );
    await waitFor(() =>
      expect(view.result.current.errorMessageKey).toBe('conversation.creativeStudio.errors.provider_error')
    );

    bridge.updateModelSelection.invoke.mockResolvedValueOnce(failed('storage_error'));
    await act(() => view.result.current.updateSelection({ role: 'storyboard', selection: null }));

    expect(view.result.current.errorMessageKey).toBe('conversation.creativeStudio.models.updateFailed');
  });

  it('ignores a catalog response after unmount', async () => {
    const response = deferred<StudioCommandResult<StudioRouteCatalog>>();
    bridge.listRoutes.invoke.mockReturnValueOnce(response.promise);
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => true),
      })
    );

    view.unmount();
    response.resolve(ok(catalog('late')));
    await response.promise;

    expect(bridge.listRoutes.invoke).toHaveBeenCalledOnce();
  });

  it('refreshes the current project catalog on demand', async () => {
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => true),
      })
    );
    await waitFor(() => expect(view.result.current.loading).toBe(false));

    await act(() => view.result.current.refresh());

    expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.listRoutes.invoke).toHaveBeenLastCalledWith({ projectId: 'project-1' });
  });

  it('makes a successful refresh catalog available to the awaiting caller', async () => {
    bridge.listRoutes.invoke
      .mockResolvedValueOnce(failed('provider_error'))
      .mockResolvedValue(ok(catalog('catalog-2')));
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => true),
      })
    );
    await waitFor(() => expect(view.result.current.errorMessageKey).not.toBeNull());
    const capturedResult = view.result.current;

    await act(() => capturedResult.refresh());

    expect(capturedResult.catalog?.catalogVersion).toBe('catalog-2');
  });

  it('refreshes once when canonical routing changes without refreshing for revision-only changes', async () => {
    const initial = project();
    const revisionOnly = project('project-1', 5);
    const routed = {
      ...project('project-1', 6),
      routing: {
        storyboard: null,
        image: {
          choiceId: 'choice_image',
          providerId: 'provider-image',
          model: 'image-model',
        },
        video: null,
      },
    };
    const view = renderHook(
      ({ currentProject }) =>
        useStudioModels({
          project: currentProject,
          refetch: vi.fn(async () => currentProject),
          beforeMutation: vi.fn(async () => true),
        }),
      { initialProps: { currentProject: initial } }
    );
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(1));

    view.rerender({ currentProject: revisionOnly });
    await act(async () => {});
    expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(1);

    view.rerender({ currentProject: routed });
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(2));
    await act(async () => {});
    expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(2);
  });

  it('adopts the only compatible engine as the project route with the canonical revision', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(ok(catalogWith('catalog-1', { image: unchosen(route('image')) })));
    renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project('project-1', 5)),
        beforeMutation: vi.fn(async () => true),
        autoSelectSoleRoute: true,
      })
    );

    await waitFor(() => expect(bridge.updateModelSelection.invoke).toHaveBeenCalledOnce());
    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 4,
      role: 'image',
      selection: { choiceId: 'choice_image' },
    });
  });

  it('leaves the project route alone while automatic selection is withheld', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(ok(catalogWith('catalog-1', { image: unchosen(route('image')) })));
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => true),
        autoSelectSoleRoute: false,
      })
    );

    await waitFor(() => expect(view.result.current.loading).toBe(false));
    expect(bridge.updateModelSelection.invoke).not.toHaveBeenCalled();
  });

  it('adopts each media role once, in sequence', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(
      ok(catalogWith('catalog-1', { image: unchosen(route('image')), video: unchosen(route('video')) }))
    );
    renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project('project-1', 5)),
        beforeMutation: vi.fn(async () => true),
        autoSelectSoleRoute: true,
      })
    );

    await waitFor(() => expect(bridge.updateModelSelection.invoke).toHaveBeenCalledTimes(2));
    expect(bridge.updateModelSelection.invoke.mock.calls.map(([request]) => request.role)).toEqual(['image', 'video']);
  });

  it('stops after one attempt when the canonical command refuses the adopted route', async () => {
    bridge.listRoutes.invoke.mockResolvedValue(ok(catalogWith('catalog-1', { image: unchosen(route('image')) })));
    bridge.updateModelSelection.invoke.mockResolvedValue(failed('storage_error'));
    const view = renderHook(() =>
      useStudioModels({
        project: project(),
        refetch: vi.fn(async () => project()),
        beforeMutation: vi.fn(async () => true),
        autoSelectSoleRoute: true,
      })
    );

    await waitFor(() =>
      expect(view.result.current.errorMessageKey).toBe('conversation.creativeStudio.models.updateFailed')
    );
    await act(() => view.result.current.refresh());
    expect(bridge.updateModelSelection.invoke).toHaveBeenCalledOnce();
  });

  it('refreshes when project aspect ratio or resolution changes', async () => {
    const initial = project();
    const view = renderHook(
      ({ currentProject }) =>
        useStudioModels({
          project: currentProject,
          refetch: vi.fn(async () => currentProject),
          beforeMutation: vi.fn(async () => true),
        }),
      { initialProps: { currentProject: initial } }
    );
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(1));

    view.rerender({ currentProject: { ...initial, aspectRatio: '1:1' } });
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(2));

    view.rerender({ currentProject: { ...initial, aspectRatio: '1:1', resolution: '1080p' } });
    await waitFor(() => expect(bridge.listRoutes.invoke).toHaveBeenCalledTimes(3));
  });
});
