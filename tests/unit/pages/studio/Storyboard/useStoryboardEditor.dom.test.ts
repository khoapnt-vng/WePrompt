/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioCommandResult,
  StudioEditableScene,
  StudioFitStoryboardOutcome,
  StudioRendererProject,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import { draftKey, persistDrafts } from '@renderer/pages/studio/hooks/useDraftPersistence';
import { useStoryboardEditor } from '@renderer/pages/studio/hooks/useStoryboardEditor';

const bridge = vi.hoisted(() => ({
  hasUnsavedWork: { provider: vi.fn() },
  flushUnsavedWork: { provider: vi.fn() },
  updateScene: { invoke: vi.fn() },
  updateProject: { invoke: vi.fn() },
  reorderScenes: { invoke: vi.fn() },
  proposeStoryboard: { invoke: vi.fn() },
  fitStoryboard: { invoke: vi.fn() },
}));

vi.mock('@/common', () => ({ ipcBridge: { creativeStudio: bridge } }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const ok = <T>(data: T): StudioCommandResult<T> => ({ ok: true, data });

const failed = <T>(
  code: 'stale_project' | 'provider_error' | 'planning_unavailable' | 'storyboard_exists' | 'storage_error',
  messageKey = `conversation.creativeStudio.errors.${code}`
): StudioCommandResult<T> => ({
  ok: false,
  error: { code, messageKey },
});

const scene = (id: string, overrides: Partial<StudioScene> = {}): StudioScene => ({
  id,
  title: `Scene ${id}`,
  purpose: 'Move the story forward',
  visualPrompt: 'A cinematic wide shot',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'draft',
  ...overrides,
});

const project = (
  revision = 2,
  orderedScenes: StudioScene[] = [scene('scene-1'), scene('scene-2')],
  overrides: Partial<StudioRendererProject> = {}
): StudioRendererProject => ({
  schemaVersion: 1,
  revision,
  id: 'project-1',
  name: 'Launch film',
  brief: 'A short launch video',
  aspectRatio: '16:9',
  targetDurationSeconds: 10,
  resolution: '720p',
  sceneOrder: orderedScenes.map(({ id }) => id),
  scenes: Object.fromEntries(orderedScenes.map((item) => [item.id, item])),
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

type HasUnsavedWorkHandler = () => { dirtySceneCount: number };
type FlushUnsavedWorkHandler = () => Promise<{ saved: boolean }>;

describe('useStoryboardEditor', () => {
  let hasUnsavedWorkHandler: HasUnsavedWorkHandler | null;
  let flushUnsavedWorkHandler: FlushUnsavedWorkHandler | null;
  let disposeHasUnsavedWork: ReturnType<typeof vi.fn>;
  let disposeFlushUnsavedWork: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    hasUnsavedWorkHandler = null;
    flushUnsavedWorkHandler = null;
    disposeHasUnsavedWork = vi.fn();
    disposeFlushUnsavedWork = vi.fn();
    bridge.hasUnsavedWork.provider.mockImplementation((handler: HasUnsavedWorkHandler) => {
      hasUnsavedWorkHandler = handler;
      disposeHasUnsavedWork.mockImplementation(() => {
        if (hasUnsavedWorkHandler === handler) hasUnsavedWorkHandler = null;
      });
      return disposeHasUnsavedWork;
    });
    bridge.flushUnsavedWork.provider.mockImplementation((handler: FlushUnsavedWorkHandler) => {
      flushUnsavedWorkHandler = handler;
      disposeFlushUnsavedWork.mockImplementation(() => {
        if (flushUnsavedWorkHandler === handler) flushUnsavedWorkHandler = null;
      });
      return disposeFlushUnsavedWork;
    });
    bridge.updateScene.invoke.mockImplementation(async () => ok(project(3)));
    bridge.updateProject.invoke.mockImplementation(async () => ok(project(3)));
    bridge.reorderScenes.invoke.mockImplementation(async () => ok(project(3)));
    bridge.proposeStoryboard.invoke.mockImplementation(async () => ok(project(3)));
    bridge.fitStoryboard.invoke.mockImplementation(async () =>
      ok<StudioFitStoryboardOutcome>({
        status: 'already_matches',
        project: project(3),
        changedSceneIds: [],
        lockedSceneIds: [],
      })
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    window.sessionStorage.clear();
  });

  it('hydrates the ordered scenes, selection, draft, and duration summary', async () => {
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.selectedSceneId).toBe('scene-1');
    expect(result.current.sceneDraft?.title).toBe('Scene scene-1');
    expect(result.current.durationTotalSeconds).toBe(10);
    expect(result.current.durationMatchesTarget).toBe(true);
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(false);
    expect(result.current.selectedSceneSaveState).toBe('saved');
    expect(result.current.sceneDrafts).toMatchObject({
      'scene-1': { title: 'Scene scene-1' },
      'scene-2': { title: 'Scene scene-2' },
    });
    expect(result.current.sceneSaveStates).toEqual({ 'scene-1': 'saved', 'scene-2': 'saved' });
  });

  it('answers close queries from synchronous dirty refs and drains the save queue', async () => {
    const afterFirst = project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')]);
    const afterSecond = project(4, [
      scene('scene-1', { title: 'First edit' }),
      scene('scene-2', { title: 'Second edit' }),
    ]);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(afterFirst)).mockResolvedValueOnce(ok(afterSecond));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    await waitFor(() => {
      expect(hasUnsavedWorkHandler).not.toBeNull();
      expect(flushUnsavedWorkHandler).not.toBeNull();
    });
    act(() => {
      result.current.updateSceneDraftById('scene-1', { title: 'First edit' });
      result.current.updateSceneDraftById('scene-2', { title: 'Second edit' });
    });

    expect(hasUnsavedWorkHandler?.()).toEqual({ dirtySceneCount: 2 });
    await act(async () => {
      await expect(flushUnsavedWorkHandler?.()).resolves.toEqual({ saved: true });
    });
    expect(hasUnsavedWorkHandler?.()).toEqual({ dirtySceneCount: 0 });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
  });

  it('rechecks a Brief edit made while close is draining scenes before reporting saved', async () => {
    const sceneSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const projectSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterScene = project(3, [scene('scene-1', { title: 'Opening v2' }), scene('scene-2')]);
    const afterProject = project(4, [scene('scene-1', { title: 'Opening v2' }), scene('scene-2')], {
      brief: 'Edited during close',
    });
    bridge.updateScene.invoke.mockReturnValueOnce(sceneSave.promise);
    bridge.updateProject.invoke.mockReturnValueOnce(projectSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(flushUnsavedWorkHandler).not.toBeNull());
    const closeHandler = flushUnsavedWorkHandler;
    if (closeHandler === null) throw new Error('close flush provider was not registered');

    act(() => result.current.updateSceneDraftById('scene-1', { title: 'Opening v2' }));
    let closeOutcome: { saved: boolean } | undefined;
    let closeFlush!: Promise<{ saved: boolean }>;
    act(() => {
      closeFlush = closeHandler().then((outcome) => {
        closeOutcome = outcome;
        return outcome;
      });
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());

    act(() => result.current.updateProjectDraft({ brief: 'Edited during close' }));
    await act(async () => {
      sceneSave.resolve(ok(afterScene));
      await Promise.resolve();
    });

    await waitFor(() => expect(bridge.updateProject.invoke).toHaveBeenCalledOnce());
    expect(bridge.updateProject.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 3, brief: 'Edited during close' })
    );
    expect(closeOutcome).toBeUndefined();

    await act(async () => {
      projectSave.resolve(ok(afterProject));
      await expect(closeFlush).resolves.toEqual({ saved: true });
    });
  });

  it('reports unsaved when a Brief edit made during close cannot be re-flushed', async () => {
    const sceneSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterScene = project(3, [scene('scene-1', { title: 'Opening v2' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(sceneSave.promise);
    bridge.updateProject.invoke.mockResolvedValueOnce(
      failed('provider_error', 'conversation.creativeStudio.errors.provider')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );
    await waitFor(() => expect(flushUnsavedWorkHandler).not.toBeNull());
    const closeHandler = flushUnsavedWorkHandler;
    if (closeHandler === null) throw new Error('close flush provider was not registered');

    act(() => result.current.updateSceneDraftById('scene-1', { title: 'Opening v2' }));
    let closeFlush!: Promise<{ saved: boolean }>;
    act(() => {
      closeFlush = closeHandler();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());

    act(() => result.current.updateProjectDraft({ brief: 'Edited during close' }));
    await act(async () => {
      sceneSave.resolve(ok(afterScene));
      await expect(closeFlush).resolves.toEqual({ saved: false });
    });
    expect(bridge.updateProject.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ expectedRevision: 3, brief: 'Edited during close' })
    );
  });

  it('keeps close providers unavailable until a persisted draft is adopted', () => {
    vi.useFakeTimers();
    bridge.updateScene.invoke.mockReturnValue(new Promise(() => {}));
    persistDrafts('project-1', 2, { 'scene-1': { narration: 'pending restore' } });
    const { result, rerender } = renderHook(
      ({ canonical }: { canonical: StudioRendererProject | null }) =>
        useStoryboardEditor({ project: canonical, refetch: vi.fn(async () => canonical) }),
      { initialProps: { canonical: null } }
    );

    expect(bridge.hasUnsavedWork.provider).not.toHaveBeenCalled();
    expect(bridge.flushUnsavedWork.provider).not.toHaveBeenCalled();
    expect(hasUnsavedWorkHandler).toBeNull();
    expect(flushUnsavedWorkHandler).toBeNull();

    rerender({ canonical: project() });

    expect(result.current.sceneDrafts['scene-1']?.narration).toBe('pending restore');
    expect(result.current.sceneSaveStates['scene-1']).toBe('dirty');
    expect(hasUnsavedWorkHandler?.()).toEqual({ dirtySceneCount: 1 });
    expect(flushUnsavedWorkHandler).not.toBeNull();
  });

  it('disposes close providers when the canonical project returns to null', () => {
    const { rerender } = renderHook(
      ({ canonical }: { canonical: StudioRendererProject | null }) =>
        useStoryboardEditor({ project: canonical, refetch: vi.fn(async () => canonical) }),
      { initialProps: { canonical: project() as StudioRendererProject | null } }
    );

    expect(hasUnsavedWorkHandler).not.toBeNull();
    expect(flushUnsavedWorkHandler).not.toBeNull();

    rerender({ canonical: null });

    expect(disposeHasUnsavedWork).toHaveBeenCalledOnce();
    expect(disposeFlushUnsavedWork).toHaveBeenCalledOnce();
    expect(hasUnsavedWorkHandler).toBeNull();
    expect(flushUnsavedWorkHandler).toBeNull();
  });

  it('restores unsaved drafts after unmount and remount of the same project', () => {
    vi.useFakeTimers();
    bridge.updateScene.invoke.mockReturnValue(new Promise(() => {}));
    const first = renderHook(() => useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) }));

    act(() => first.result.current.updateSceneDraftById('scene-1', { narration: 'half-typed thought' }));

    expect(window.sessionStorage.getItem(draftKey('project-1'))).toBe(
      JSON.stringify({
        revision: 2,
        scenes: { 'scene-1': { narration: 'half-typed thought' } },
      })
    );
    first.unmount();

    const second = renderHook(() => useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) }));

    expect(second.result.current.sceneDrafts['scene-1']?.narration).toBe('half-typed thought');
    expect(second.result.current.sceneSaveStates['scene-1']).toBe('dirty');
    second.unmount();
  });

  it('drops persisted drafts once the scene saves cleanly', async () => {
    const saved = project(3, [scene('scene-1', { narration: 'text' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(saved));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraftById('scene-1', { narration: 'text' }));
    expect(window.sessionStorage.getItem(draftKey('project-1'))).not.toBeNull();

    await act(async () => {
      expect(await result.current.flushAllSceneDrafts()).toEqual({ failed: [], dirtied: [] });
    });

    expect(window.sessionStorage.getItem(draftKey('project-1'))).toBeNull();
  });

  it('ignores persisted drafts from a stale revision after a conflict', () => {
    window.sessionStorage.setItem(
      draftKey('project-1'),
      JSON.stringify({ revision: 3, scenes: { 'scene-1': { narration: 'stale thought' } } })
    );

    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(7), refetch: vi.fn(async () => project(7)) })
    );

    expect(result.current.sceneSaveStates['scene-1']).toBe('saved');
    expect(result.current.sceneDrafts['scene-1']?.narration).toBe('');
    expect(window.sessionStorage.getItem(draftKey('project-1'))).toBeNull();
  });

  it('rewrites the remaining dirty snapshot at the accepted canonical revision', async () => {
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterFirst = project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraftById('scene-1', { title: 'First edit' }));
    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());

    act(() => result.current.updateSceneDraftById('scene-1', { narration: 'New during save' }));
    await act(async () => {
      firstSave.resolve(ok(afterFirst));
      expect(await flushed).toEqual({ failed: [], dirtied: ['scene-1'] });
    });

    expect(window.sessionStorage.getItem(draftKey('project-1'))).toBe(
      JSON.stringify({
        revision: 3,
        scenes: { 'scene-1': { narration: 'New during save' } },
      })
    );
  });

  it('does not bless a stale snapshot with a conflict refetch revision', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Remote title' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraftById('scene-1', { title: 'Local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraftById('scene-1')).toBe(false);
    });

    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });
    expect(window.sessionStorage.getItem(draftKey('project-1'))).toBe(
      JSON.stringify({
        revision: 2,
        scenes: { 'scene-1': { title: 'Local title' } },
      })
    );
  });

  it('does not let an old unmount save delete a newer same-project snapshot', async () => {
    vi.useFakeTimers();
    const oldSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(oldSave.promise);
    const first = renderHook(() => useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) }));
    act(() => first.result.current.updateSceneDraftById('scene-1', { title: 'Old instance' }));
    first.unmount();
    await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());

    const second = renderHook(() => useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) }));
    act(() => second.result.current.updateSceneDraftById('scene-1', { title: 'New instance' }));
    const newerSnapshot = window.sessionStorage.getItem(draftKey('project-1'));

    await act(async () => {
      oldSave.resolve(ok(project(3, [scene('scene-1', { title: 'Old instance' }), scene('scene-2')])));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(window.sessionStorage.getItem(draftKey('project-1'))).toBe(newerSnapshot);
    expect(JSON.parse(newerSnapshot ?? '{}')).toMatchObject({
      revision: 2,
      scenes: { 'scene-1': { title: 'New instance' } },
    });
    second.unmount();
  });

  it('edits and saves a scene by ID without changing the current selection', async () => {
    const initial = project();
    const saved = project(3, [scene('scene-1'), scene('scene-2', { narration: 'A new second-scene line.' })]);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(saved));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraftById('scene-2', { narration: 'A new second-scene line.' }));

    expect(result.current.selectedSceneId).toBe('scene-1');
    expect(result.current.sceneDrafts['scene-2']?.narration).toBe('A new second-scene line.');
    expect(result.current.sceneSaveStates['scene-2']).toBe('dirty');

    await act(async () => {
      expect(await result.current.flushSceneDraftById('scene-2')).toBe(true);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        sceneId: 'scene-2',
        expectedRevision: 2,
        scene: expect.objectContaining({ narration: 'A new second-scene line.' }),
      })
    );
    expect(result.current.selectedSceneId).toBe('scene-1');
    expect(result.current.sceneSaveStates['scene-2']).toBe('saved');
  });

  it.each([
    { fromKind: 'image' as const, toKind: 'video' as const, fromDuration: 2, clampedDuration: 4 },
    { fromKind: 'video' as const, toKind: 'image' as const, fromDuration: 12, clampedDuration: 8 },
  ])(
    'sends a $fromKind to $toKind route change and its clamped duration in one IPC scene payload',
    async ({ fromKind, toKind, fromDuration, clampedDuration }) => {
      const initial = project(2, [scene('scene-1', { mediaKind: fromKind, durationSeconds: fromDuration })]);
      const saved = project(3, [scene('scene-1', { mediaKind: toKind, durationSeconds: clampedDuration })]);
      bridge.updateScene.invoke.mockResolvedValueOnce(ok(saved));
      const { result } = renderHook(() =>
        useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) })
      );

      act(() =>
        result.current.updateSceneDraftById('scene-1', {
          mediaKind: toKind,
          durationSeconds: clampedDuration,
        })
      );
      await act(async () => {
        expect(await result.current.flushSceneDraftById('scene-1')).toBe(true);
      });

      expect(bridge.updateScene.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 2,
        scene: {
          title: 'Scene scene-1',
          purpose: 'Move the story forward',
          visualPrompt: 'A cinematic wide shot',
          narration: '',
          onScreenText: '',
          mediaKind: toKind,
          durationSeconds: clampedDuration,
          referenceAssetId: null,
        } satisfies StudioEditableScene,
      });
    }
  );

  it('treats an empty project and scene draft set as safe to flush', async () => {
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    expect(result.current.flushAllSceneDrafts).toBeTypeOf('function');
    await act(async () => {
      expect(await result.current.flushAllSceneDrafts()).toEqual({ failed: [], dirtied: [] });
      expect(await result.current.flushProjectDraft()).toBe(true);
    });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();
  });

  it('persists a complete project draft through the shared mutation queue', async () => {
    const initial = project();
    const saved = project(3, undefined, {
      name: 'Launch film v2',
      brief: 'A sharper product story',
      aspectRatio: '9:16',
      targetDurationSeconds: 15,
    });
    bridge.updateProject.invoke.mockResolvedValueOnce(ok(saved));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => {
      result.current.updateProjectDraft({
        name: 'Launch film v2',
        brief: 'A sharper product story',
        aspectRatio: '9:16',
        targetDurationSeconds: 15,
      });
    });
    expect(result.current.projectDraft).toEqual({
      name: 'Launch film v2',
      brief: 'A sharper product story',
      aspectRatio: '9:16',
      targetDurationSeconds: 15,
    });
    expect(result.current.projectSaveState).toBe('dirty');

    await act(async () => {
      expect(await result.current.flushProjectDraft()).toBe(true);
    });

    expect(bridge.updateProject.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 2,
      name: 'Launch film v2',
      brief: 'A sharper product story',
      aspectRatio: '9:16',
      targetDurationSeconds: 15,
    });
    expect(result.current.projectDraft).toBeNull();
    expect(result.current.projectSaveState).toBe('saved');
  });

  it('trims the project name and rejects invalid Brief fields before IPC', async () => {
    const initial = project();
    const saved = project(3, undefined, { name: 'Launch film v2' });
    bridge.updateProject.invoke.mockResolvedValueOnce(ok(saved));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateProjectDraft({ name: '  Launch film v2  ' }));
    await act(async () => {
      expect(await result.current.flushProjectDraft()).toBe(true);
    });
    expect(bridge.updateProject.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Launch film v2', expectedRevision: 2 })
    );

    bridge.updateProject.invoke.mockClear();
    act(() => result.current.updateProjectDraft({ name: '   ' }));
    await act(async () => {
      expect(await result.current.flushProjectDraft()).toBe(false);
    });
    expect(result.current.error).toMatchObject({ operation: 'update_project', code: 'invalid_payload' });
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();
  });

  it.each([
    [{ brief: 'x'.repeat(16 * 1024 + 1) }, 'conversation.creativeStudio.errors.invalidPayload'],
    [{ targetDurationSeconds: 4 }, 'conversation.creativeStudio.create.invalidDuration'],
    [{ targetDurationSeconds: 61 }, 'conversation.creativeStudio.create.invalidDuration'],
    [{ targetDurationSeconds: 10.5 }, 'conversation.creativeStudio.create.invalidDuration'],
  ] as const)('keeps invalid Brief input local and reports %s', async (patch, messageKey) => {
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateProjectDraft(patch));
    await act(async () => {
      expect(await result.current.flushProjectDraft()).toBe(false);
    });

    expect(result.current.error).toMatchObject({
      operation: 'update_project',
      code: 'invalid_payload',
      messageKey,
    });
    expect(result.current.hasUnsavedProjectDraft).toBe(true);
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();
  });

  it('preserves dirty Brief fields while adopting newer canonical values for untouched fields', () => {
    const initial = project();
    const canonical = project(4, undefined, {
      name: 'Remote project name',
      brief: 'Remote brief',
      aspectRatio: '4:3',
      targetDurationSeconds: 20,
    });
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: initial } }
    );

    act(() => result.current.updateProjectDraft({ name: 'Local project name' }));
    rerender({ value: canonical });

    expect(result.current.projectDraft).toEqual({
      name: 'Local project name',
      brief: 'Remote brief',
      aspectRatio: '4:3',
      targetDurationSeconds: 20,
    });
  });

  it('flushes a project draft before a dirty scene and advances the shared revision', async () => {
    const initial = project();
    const afterProject = project(3, undefined, { name: 'Launch film v2' });
    const afterScene = project(4, [scene('scene-1', { title: 'Opening v2' }), scene('scene-2')], {
      name: 'Launch film v2',
    });
    const operationOrder: string[] = [];
    bridge.updateProject.invoke.mockImplementationOnce(async () => {
      operationOrder.push('project');
      return ok(afterProject);
    });
    bridge.updateScene.invoke.mockImplementationOnce(async () => {
      operationOrder.push('scene');
      return ok(afterScene);
    });
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateProjectDraft({ name: 'Launch film v2' }));
    act(() => result.current.updateSceneDraft({ title: 'Opening v2' }));
    await act(async () => {
      expect(await result.current.flushProjectDraft()).toBe(true);
      expect(await result.current.flushAllSceneDrafts()).toEqual({ failed: [], dirtied: [] });
    });

    expect(operationOrder).toEqual(['project', 'scene']);
    expect(bridge.updateProject.invoke).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 2 }));
    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
    expect(result.current.hasUnsavedProjectDraft).toBe(false);
    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
  });

  it('queues a Brief save behind an in-flight scene save and uses the resulting CAS revision', async () => {
    const initial = project();
    const sceneSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterScene = project(3, [scene('scene-1', { title: 'Opening v2' }), scene('scene-2')]);
    const afterProject = project(4, [scene('scene-1', { title: 'Opening v2' }), scene('scene-2')], {
      name: 'Launch film v2',
    });
    bridge.updateScene.invoke.mockReturnValueOnce(sceneSave.promise);
    bridge.updateProject.invoke.mockResolvedValueOnce(ok(afterProject));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraftById('scene-1', { title: 'Opening v2' }));
    let savingScene!: Promise<boolean>;
    act(() => {
      savingScene = result.current.flushSceneDraftById('scene-1');
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());

    act(() => result.current.updateProjectDraft({ name: 'Launch film v2' }));
    let savingBrief!: Promise<boolean>;
    act(() => {
      savingBrief = result.current.flushProjectDraft();
    });
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();

    await act(async () => {
      sceneSave.resolve(ok(afterScene));
      expect(await savingScene).toBe(true);
      expect(await savingBrief).toBe(true);
    });
    expect(bridge.updateProject.invoke).toHaveBeenCalledWith(expect.objectContaining({ expectedRevision: 3 }));
  });

  it('resolves a project draft flush as false when prior queued work enters conflict', async () => {
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const refreshed = project(8, [scene('scene-1', { title: 'Remote opening' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Local opening' }));
    act(() => result.current.updateProjectDraft({ name: 'Local project name' }));
    let sceneFlush!: Promise<boolean>;
    act(() => {
      sceneFlush = result.current.flushSceneDraft();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    let projectFlushOutcome: boolean | undefined;
    act(() => {
      void result.current.flushProjectDraft().then((outcome) => {
        projectFlushOutcome = outcome;
      });
    });
    await act(async () => {
      firstSave.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await sceneFlush).toBe(false);
    });

    await waitFor(() => expect(result.current.conflict).toMatchObject({ operation: 'save_scene' }));
    await waitFor(() => expect(projectFlushOutcome).toBe(false));
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();
    expect(result.current.projectDraft?.name).toBe('Local project name');
  });

  it('flushes two dirty scenes in order and advances the canonical revision between saves', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterFirst = project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')]);
    const afterSecond = project(4, [
      scene('scene-1', { title: 'First edit' }),
      scene('scene-2', { title: 'Second edit' }),
    ]);
    bridge.updateScene.invoke.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(afterSecond));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First edit' }));
    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Second edit' }));
    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    expect(bridge.updateScene.invoke.mock.calls[0]?.[0]).toMatchObject({ sceneId: 'scene-1', expectedRevision: 2 });

    await act(async () => {
      first.resolve(ok(afterFirst));
      expect(await flushed).toEqual({ failed: [], dirtied: [] });
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({ sceneId: 'scene-2', expectedRevision: 3 });
    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
  });

  it('reports a newer same-scene edit as dirtied instead of a failed save', async () => {
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterFirst = project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First edit' }));
    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Newer edit' }));
    await act(async () => {
      firstSave.resolve(ok(afterFirst));
      expect(await flushed).toEqual({ failed: [], dirtied: ['scene-1'] });
    });

    expect(result.current.sceneDraft?.title).toBe('Newer edit');
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
    expect(result.current.saveIssues).toEqual([]);
  });

  it('keeps a failed in-flight save classified as failed when a newer edit also lands', async () => {
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First edit' }));
    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Newer edit' }));
    await act(async () => {
      firstSave.resolve(failed('provider_error'));
      expect(await flushed).toEqual({ failed: ['scene-1'], dirtied: [] });
    });

    expect(result.current.sceneDraft?.title).toBe('Newer edit');
    expect(result.current.saveIssues).toEqual([
      expect.objectContaining({ sceneId: 'scene-1', code: 'provider_error' }),
    ]);
  });

  it('reports a scene first edited during the flush as dirtied for the next round', async () => {
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const afterFirst = project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First edit' }));
    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraftById('scene-2', { title: 'New during flush' }));
    await act(async () => {
      firstSave.resolve(ok(afterFirst));
      expect(await flushed).toEqual({ failed: [], dirtied: ['scene-2'] });
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.sceneDrafts['scene-2']?.title).toBe('New during flush');
  });

  it('waits for an already queued autosave before reporting all scene drafts clean', async () => {
    vi.useFakeTimers();
    const save = deferred<StudioCommandResult<StudioRendererProject>>();
    const saved = project(3, [scene('scene-1', { title: 'Autosaved edit' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(save.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Autosaved edit' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await act(async () => {
      save.resolve(ok(saved));
      expect(await flushed).toEqual({ failed: [], dirtied: [] });
    });
    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
  });

  it('stops an all-scene flush at validation failure and keeps the draft recoverable', async () => {
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ durationSeconds: 0 }));
    await act(async () => {
      expect(await result.current.flushAllSceneDrafts()).toEqual({ failed: ['scene-1'], dirtied: [] });
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
    expect(result.current.saveIssues).toEqual([
      expect.objectContaining({ sceneId: 'scene-1', code: 'invalid_payload' }),
    ]);
  });

  it('does not enqueue a later dirty scene behind a stale-project conflict', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    const refreshed = project(8, [scene('scene-1', { title: 'Remote first' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Local first' }));
    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Local second' }));
    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    await act(async () => {
      first.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await flushed).toEqual({ failed: ['scene-1'], dirtied: [] });
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });
    expect(result.current.orderedScenes.find(({ id }) => id === 'scene-2')?.title).toBe('Local second');
  });

  it('clears every dirty scene timer before a slow conflict and does not save a later draft after recovery', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const refreshed = project(8, [scene('scene-1', { title: 'Remote first' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Local first' }));
    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Local second' }));
    await act(async () => {
      await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    });

    let flushed!: Promise<unknown>;
    act(() => {
      flushed = result.current.flushAllSceneDrafts();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
      firstSave.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await flushed).toEqual({ failed: ['scene-1'], dirtied: [] });
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.discardConflict();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.orderedScenes.find(({ id }) => id === 'scene-2')?.title).toBe('Local second');
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
  });

  it('fits through one serialized atomic intent and never emits per-scene updates', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 10 }), scene('scene-2', { durationSeconds: 8 })], {
      targetDurationSeconds: 15,
    });
    const fitted = project(3, [scene('scene-1', { durationSeconds: 9 }), scene('scene-2', { durationSeconds: 6 })], {
      targetDurationSeconds: 15,
    });
    const outcome: StudioFitStoryboardOutcome = {
      status: 'applied',
      project: fitted,
      changedSceneIds: ['scene-1', 'scene-2'],
      lockedSceneIds: [],
    };
    bridge.fitStoryboard.invoke.mockResolvedValueOnce(ok(outcome));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await act(async () => {
      await expect(result.current.fitToTarget('0123456789abcdef')).resolves.toEqual(outcome);
    });

    expect(bridge.fitStoryboard.invoke).toHaveBeenCalledExactlyOnceWith({
      projectId: initial.id,
      expectedRevision: initial.revision,
      catalogVersion: '0123456789abcdef',
    });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.project?.revision).toBe(3);
    expect(result.current.durationMatchesTarget).toBe(true);
    expect(result.current.latestFitOutcome).toEqual(outcome);
  });

  it('publishes a structured unreachable outcome after an explicit stale retry', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 18 })], { targetDurationSeconds: 15 });
    const refreshed = project(3, [scene('scene-1', { durationSeconds: 18 })], { targetDurationSeconds: 15 });
    const outcome: StudioFitStoryboardOutcome = {
      status: 'unreachable',
      reason: 'target_out_of_bounds',
      project: refreshed,
      lockedSceneIds: [],
      minimumTotalSeconds: 4,
      maximumTotalSeconds: 12,
    };
    bridge.fitStoryboard.invoke.mockResolvedValueOnce(failed('stale_project')).mockResolvedValueOnce(ok(outcome));
    const refetch = vi.fn(async () => refreshed);
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch }));

    await act(async () => {
      await expect(result.current.fitToTarget('0123456789abcdef')).resolves.toBeNull();
    });
    expect(result.current.conflict).toMatchObject({ operation: 'fit_duration', code: 'stale_project' });
    expect(result.current.latestFitOutcome).toBeNull();

    await act(async () => {
      await expect(result.current.retryConflict()).resolves.toBe(true);
    });
    expect(bridge.fitStoryboard.invoke).toHaveBeenNthCalledWith(2, {
      projectId: refreshed.id,
      expectedRevision: refreshed.revision,
      catalogVersion: '0123456789abcdef',
    });
    expect(result.current.latestFitOutcome).toEqual(outcome);
  });

  it('hides a fit outcome after an unrelated canonical revision is adopted', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 18 })], { targetDurationSeconds: 15 });
    const fitted = project(3, [scene('scene-1', { durationSeconds: 12 })], { targetDurationSeconds: 15 });
    const outcome: StudioFitStoryboardOutcome = {
      status: 'unreachable',
      reason: 'target_out_of_bounds',
      project: fitted,
      lockedSceneIds: [],
      minimumTotalSeconds: 4,
      maximumTotalSeconds: 12,
    };
    bridge.fitStoryboard.invoke.mockResolvedValueOnce(ok(outcome));
    const refetch = vi.fn(async () => initial);
    const { result, rerender } = renderHook(({ canonical }) => useStoryboardEditor({ project: canonical, refetch }), {
      initialProps: { canonical: initial },
    });

    await act(async () => void (await result.current.fitToTarget('catalog-1')));
    expect(result.current.latestFitOutcome).toEqual(outcome);

    rerender({ canonical: project(4, [scene('scene-1', { durationSeconds: 11 })], { targetDurationSeconds: 15 }) });

    expect(result.current.latestFitOutcome).toBeNull();
  });

  it('clears the latest structured fit explanation without changing the project', async () => {
    const initial = project();
    const outcome: StudioFitStoryboardOutcome = {
      status: 'unreachable',
      reason: 'route_unavailable',
      project: initial,
      lockedSceneIds: [],
      unavailableSceneIds: ['scene-1'],
    };
    bridge.fitStoryboard.invoke.mockResolvedValueOnce(ok(outcome));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await act(async () => void (await result.current.fitToTarget('0123456789abcdef')));
    act(() => result.current.clearLatestFitOutcome());

    expect(result.current.latestFitOutcome).toBeNull();
    expect(result.current.project).toEqual(initial);
  });

  it('reports saved, dirty, saving, and saved for the selected scene debounce lifecycle', async () => {
    vi.useFakeTimers();
    const save = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(save.promise);
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    expect(result.current.selectedSceneSaveState).toBe('saved');

    act(() => result.current.updateSceneDraft({ title: 'A new opening' }));
    expect(result.current.selectedSceneSaveState).toBe('dirty');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(result.current.selectedSceneSaveState).toBe('saving');

    await act(async () => {
      save.resolve(ok(project(3, [scene('scene-1', { title: 'A new opening' }), scene('scene-2')])));
      await save.promise;
    });
    await vi.waitFor(() => expect(result.current.selectedSceneSaveState).toBe('saved'));
  });

  it('reports failure and returns to saving when the selected scene is retried', async () => {
    vi.useFakeTimers();
    const failedSave = deferred<StudioCommandResult<StudioRendererProject>>();
    const retrySave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(failedSave.promise).mockReturnValueOnce(retrySave.promise);
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ visualPrompt: 'Preserve this prompt' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
      failedSave.resolve(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
      await failedSave.promise;
    });
    await vi.waitFor(() => expect(result.current.selectedSceneSaveState).toBe('failed'));

    let retry!: Promise<boolean>;
    act(() => {
      retry = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());
    expect(result.current.selectedSceneSaveState).toBe('saving');

    await act(async () => {
      retrySave.resolve(ok(project(3, [scene('scene-1', { visualPrompt: 'Preserve this prompt' }), scene('scene-2')])));
      expect(await retry).toBe(true);
    });
    expect(result.current.selectedSceneSaveState).toBe('saved');
  });

  it('returns a failed selected scene to saved when its local draft is discarded', async () => {
    vi.useFakeTimers();
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('storage_error', 'conversation.creativeStudio.errors.storage')
    );
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Discard this edit' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    await vi.waitFor(() => expect(result.current.selectedSceneSaveState).toBe('failed'));

    act(() => result.current.discardSceneDraft());

    expect(result.current.selectedSceneSaveState).toBe('saved');
  });

  it('does not report saving when an in-flight save belongs to another scene', async () => {
    vi.useFakeTimers();
    const otherSceneSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(otherSceneSave.promise);
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Saving scene one' }));
    act(() => result.current.selectScene('scene-2'));
    await act(async () => Promise.resolve());

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.selectedSceneId).toBe('scene-2');
    expect(result.current.selectedSceneSaveState).toBe('saved');

    await act(async () => {
      otherSceneSave.resolve(ok(project(3, [scene('scene-1', { title: 'Saving scene one' }), scene('scene-2')])));
      await otherSceneSave.promise;
    });
  });

  it('distinguishes the selected scene draft from unrelated dirty scene drafts', async () => {
    vi.useFakeTimers();
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Dirty opening' }));
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(true);

    act(() => result.current.selectScene('scene-2'));
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(false);
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
  });

  it('does not call IPC when no project or selected scene exists', async () => {
    const { result } = renderHook(() => useStoryboardEditor({ project: null, refetch: vi.fn(async () => null) }));

    act(() => result.current.updateSceneDraft({ title: 'Ignored' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
      expect(await result.current.addScene()).toBe(false);
      expect(await result.current.removeScene('missing')).toBe(false);
      expect(await result.current.reorderScenes([])).toBe(false);
      expect(await result.current.proposeStoryboard(false)).toBe(false);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();
    expect(bridge.reorderScenes.invoke).not.toHaveBeenCalled();
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
  });

  it('starts an empty 15-second project with a five-second scene', async () => {
    const initial = project(2, [], { targetDurationSeconds: 15 });
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(project(3, [scene('new-scene', { durationSeconds: 5 })])));
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await act(async () => {
      await result.current.addScene();
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ scene: expect.objectContaining({ durationSeconds: 5 }) })
    );
  });

  it('uses the three seconds remaining for a new scene', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 12 })], { targetDurationSeconds: 15 });
    bridge.updateScene.invoke.mockResolvedValueOnce(
      ok(project(3, [scene('scene-1', { durationSeconds: 12 }), scene('new-scene', { durationSeconds: 3 })]))
    );
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await act(async () => {
      await result.current.addScene();
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ scene: expect.objectContaining({ durationSeconds: 3 }) })
    );
  });

  it('creates a default-duration scene after the target has been reached', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 15 })], { targetDurationSeconds: 15 });
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await act(async () => {
      expect(await result.current.addScene()).toBe(true);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({ scene: expect.objectContaining({ durationSeconds: 5 }) })
    );
  });

  it('increases the target through the revisioned project update intent', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 10 })], { targetDurationSeconds: 15 });
    bridge.updateProject.invoke.mockResolvedValueOnce(
      ok(project(3, [scene('scene-1', { durationSeconds: 10 })], { targetDurationSeconds: 20 }))
    );
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));
    const editor = result.current as typeof result.current & {
      increaseTargetDuration?: () => Promise<boolean>;
      suggestedExpandedTargetSeconds?: number | null;
    };

    expect(editor.suggestedExpandedTargetSeconds).toBe(20);
    await act(async () => {
      expect(await (editor.increaseTargetDuration?.() ?? Promise.resolve(false))).toBe(true);
    });

    expect(bridge.updateProject.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 2,
      targetDurationSeconds: 20,
    });
  });

  it('shows a stale target increase conflict without replaying the update', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 10 })], { targetDurationSeconds: 15 });
    const refreshed = project(3, [scene('scene-1', { durationSeconds: 10 })], { targetDurationSeconds: 15 });
    bridge.updateProject.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: initial, refetch: vi.fn(async () => refreshed) })
    );
    const editor = result.current as typeof result.current & { increaseTargetDuration?: () => Promise<boolean> };

    await act(async () => {
      expect(await (editor.increaseTargetDuration?.() ?? Promise.resolve(false))).toBe(false);
    });

    expect(bridge.updateProject.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.conflict).toMatchObject({ operation: 'update_target', code: 'stale_project' });
  });

  it('does not suggest or send a target increase beyond 60 seconds', async () => {
    const initial = project(2, [scene('scene-1', { durationSeconds: 60 })], { targetDurationSeconds: 60 });
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));
    const editor = result.current as typeof result.current & {
      increaseTargetDuration?: () => Promise<boolean>;
      suggestedExpandedTargetSeconds?: number | null;
    };

    expect(editor.suggestedExpandedTargetSeconds).toBeNull();
    await act(async () => {
      expect(await (editor.increaseTargetDuration?.() ?? Promise.resolve(false))).toBe(false);
    });
    expect(bridge.updateProject.invoke).not.toHaveBeenCalled();
  });

  it('debounces a strict editable-scene command and adopts its canonical response', async () => {
    vi.useFakeTimers();
    const current = project();
    const saved = scene('scene-1', { title: 'A new opening' });
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(project(3, [saved, scene('scene-2')])));
    const { result } = renderHook(() => useStoryboardEditor({ project: current, refetch: vi.fn(async () => current) }));

    act(() => result.current.updateSceneDraft({ title: 'A new opening' }));
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 2,
      scene: {
        title: 'A new opening',
        purpose: 'Move the story forward',
        visualPrompt: 'A cinematic wide shot',
        narration: '',
        onScreenText: '',
        mediaKind: 'image',
        durationSeconds: 5,
        referenceAssetId: null,
      } satisfies StudioEditableScene,
    });
    expect(result.current.project?.revision).toBe(3);
    expect(result.current.sceneDraft?.title).toBe('A new opening');
  });

  it('keeps a cleared title dirty instead of sending it through scene IPC', async () => {
    vi.useFakeTimers();
    const current = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: current, refetch: vi.fn(async () => current) }));

    act(() => result.current.updateSceneDraft({ title: '' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.hasUnsavedSelectedSceneDraft).toBe(true);
    expect(result.current.saveIssues).toEqual([
      expect.objectContaining({
        operation: 'save_scene',
        code: 'invalid_payload',
        messageKey: 'conversation.creativeStudio.phase.write.invalidTitle',
        sceneId: 'scene-1',
      }),
    ]);
  });

  it('flushes the old scene on selection change and the selected scene on unmount', async () => {
    const initial = project();
    const { result, unmount } = renderHook(() =>
      useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) })
    );

    act(() => {
      result.current.updateSceneDraft({ purpose: 'Changed before switch' });
      result.current.selectScene('scene-2');
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    expect(bridge.updateScene.invoke.mock.calls[0]?.[0]).toMatchObject({
      sceneId: 'scene-1',
      scene: { purpose: 'Changed before switch' },
    });

    act(() => result.current.updateSceneDraft({ narration: 'Changed before close' }));
    unmount();
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2));
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-2',
      scene: { narration: 'Changed before close' },
    });
  });

  it('serializes saves and reads the latest canonical revision when each command executes', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(ok(project(4, [scene('scene-1'), scene('scene-2', { title: 'Second edit' })])));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First edit' }));
    let firstFlush!: Promise<boolean>;
    act(() => {
      firstFlush = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());
    act(() => {
      result.current.selectScene('scene-2');
      result.current.updateSceneDraft({ title: 'Second edit' });
    });
    let secondFlush!: Promise<boolean>;
    act(() => {
      secondFlush = result.current.flushSceneDraft();
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    await act(async () => {
      first.resolve(ok(project(3, [scene('scene-1', { title: 'First edit' }), scene('scene-2')])));
      await firstFlush;
      await secondFlush;
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-2',
      expectedRevision: 3,
    });
    expect(result.current.project?.revision).toBe(4);
  });

  it('rebases a queued local field patch onto newer canonical scene fields', async () => {
    const blocker = deferred<StudioCommandResult<StudioRendererProject>>();
    const canonical = project(3, [scene('scene-1', { narration: 'Remote narration' }), scene('scene-2')]);
    const saved = project(4, [
      scene('scene-1', { title: 'Local title', narration: 'Remote narration' }),
      scene('scene-2'),
    ]);
    bridge.reorderScenes.invoke.mockReturnValueOnce(blocker.promise);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(saved));
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: project() } }
    );

    let blockingMove!: Promise<boolean>;
    act(() => {
      blockingMove = result.current.moveScene('scene-1', 'down');
    });
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Local title' }));
    let save!: Promise<boolean>;
    act(() => {
      save = result.current.flushSceneDraft();
    });
    rerender({ value: canonical });

    await act(async () => {
      blocker.resolve(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
      expect(await blockingMove).toBe(false);
      expect(await save).toBe(true);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 3,
      scene: expect.objectContaining({
        title: 'Local title',
        narration: 'Remote narration',
      }),
    });
  });

  it('pauses a later scene save behind a stale conflict and resumes it after discard', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    const refreshed = project(8, [
      scene('scene-1', { title: 'Remote opening' }),
      scene('scene-2', { narration: 'Remote narration' }),
    ]);
    const saved = project(9, [
      scene('scene-1', { title: 'Remote opening' }),
      scene('scene-2', { title: 'Local second scene', narration: 'Remote narration' }),
    ]);
    bridge.updateScene.invoke.mockReturnValueOnce(first.promise).mockResolvedValueOnce(ok(saved));
    const refetch = vi.fn(async () => refreshed);
    const { result } = renderHook(() => useStoryboardEditor({ project: project(), refetch }));

    act(() => result.current.updateSceneDraft({ title: 'Local opening' }));
    let firstSave!: Promise<boolean>;
    act(() => {
      firstSave = result.current.flushSceneDraft();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => {
      result.current.selectScene('scene-2');
      result.current.updateSceneDraft({ title: 'Local second scene' });
    });
    let secondSave!: Promise<boolean>;
    act(() => {
      secondSave = result.current.flushSceneDraft();
    });

    await act(async () => {
      first.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await firstSave).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    act(() => result.current.discardConflict());
    await act(async () => {
      expect(await secondSave).toBe(true);
    });

    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-2',
      expectedRevision: 8,
      scene: expect.objectContaining({
        title: 'Local second scene',
        narration: 'Remote narration',
      }),
    });
    expect(result.current.conflict).toBeNull();
  });

  it('requires explicit retry before restoring a locally edited scene removed by canonical state', async () => {
    vi.useFakeTimers();
    const removed = project(8, [scene('scene-2')]);
    const restored = project(9, [scene('scene-2'), scene('scene-1', { title: 'Restore me' })]);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(restored));
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: project() } }
    );

    act(() => result.current.updateSceneDraft({ title: 'Restore me' }));
    rerender({ value: removed });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.project?.sceneOrder).toEqual(['scene-2']);
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 8,
      scene: expect.objectContaining({ title: 'Restore me' }),
    });
    expect(result.current.project?.sceneOrder).toEqual(['scene-2', 'scene-1']);
  });

  it('drops in-flight results and queued intents after switching to another project', async () => {
    const first = deferred<StudioCommandResult<StudioRendererProject>>();
    const second = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const projectA = project();
    const projectB = project(8, [scene('scene-1'), scene('scene-2')], {
      id: 'project-2',
      name: 'Second project',
      targetDurationSeconds: 15,
    });
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: projectA } }
    );

    act(() => result.current.updateSceneDraft({ title: 'Project A edit' }));
    let save!: Promise<boolean>;
    let queuedAdd!: Promise<boolean>;
    act(() => {
      save = result.current.flushSceneDraft();
      queuedAdd = result.current.addScene();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    rerender({ value: projectB });
    expect(result.current.project?.id).toBe('project-2');

    let projectBAdd!: Promise<boolean>;
    act(() => {
      projectBAdd = result.current.addScene();
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2));
    const projectBRequest = bridge.updateScene.invoke.mock.calls[1]?.[0];
    expect(projectBRequest).toMatchObject({ projectId: 'project-2', expectedRevision: 8 });

    await act(async () => {
      second.resolve(
        ok(
          project(9, [scene('scene-1'), scene('scene-2'), scene(projectBRequest.sceneId, { title: '' })], {
            id: 'project-2',
            name: 'Second project',
            targetDurationSeconds: 15,
          })
        )
      );
      expect(await projectBAdd).toBe(true);
      first.resolve(ok(project(3, [scene('scene-1', { title: 'Project A edit' }), scene('scene-2')])));
      expect(await save).toBe(false);
      expect(await queuedAdd).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(result.current.project?.id).toBe('project-2');
    expect(result.current.project?.revision).toBe(9);
  });

  it('keeps a draft after a typed save failure', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('provider_error', 'conversation.creativeStudio.errors.provider')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ visualPrompt: 'Preserve this prompt' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });

    expect(result.current.sceneDraft?.visualPrompt).toBe('Preserve this prompt');
    expect(result.current.error).toMatchObject({
      operation: 'save_scene',
      code: 'provider_error',
      sceneId: 'scene-1',
    });
  });

  it('can explicitly discard the affected local scene draft after a typed save failure', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('storage_error', 'conversation.creativeStudio.errors.storage')
    );
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Unsaved local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);

    act(() => result.current.discardSceneDraftById('scene-1'));

    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
    expect(result.current.sceneDraft?.title).toBe('Scene scene-1');
    expect(result.current.error).toBeNull();
  });

  it('discards only the failed scene while preserving an unrelated dirty scene', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(firstSave.promise);
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Failed scene A edit' }));
    let saveA!: Promise<boolean>;
    act(() => {
      saveA = result.current.flushSceneDraft();
    });
    await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Keep scene B edit' }));

    await act(async () => {
      firstSave.resolve(failed('storage_error', 'conversation.creativeStudio.errors.storage'));
      expect(await saveA).toBe(false);
    });
    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1']);

    act(() => result.current.discardSceneDraftById('scene-1'));

    expect(result.current.saveIssues).toEqual([]);
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
    expect(result.current.orderedScenes.find(({ id }) => id === 'scene-1')?.title).toBe('Scene scene-1');
    expect(result.current.orderedScenes.find(({ id }) => id === 'scene-2')?.title).toBe('Keep scene B edit');
  });

  it('surfaces the remaining scene issue after two scene saves fail independently', async () => {
    vi.useFakeTimers();
    const firstSave = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke
      .mockReturnValueOnce(firstSave.promise)
      .mockResolvedValueOnce(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Failed scene A edit' }));
    let saveA!: Promise<boolean>;
    act(() => {
      saveA = result.current.flushSceneDraft();
    });
    await vi.waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'Failed scene B edit' }));
    let saveB!: Promise<boolean>;
    act(() => {
      saveB = result.current.flushSceneDraft();
    });

    await act(async () => {
      firstSave.resolve(failed('storage_error', 'conversation.creativeStudio.errors.storage'));
      expect(await saveA).toBe(false);
      expect(await saveB).toBe(false);
    });
    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.error?.sceneId).toBe('scene-2');

    act(() => result.current.discardSceneDraftById('scene-2'));

    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1']);
    expect(result.current.error?.sceneId).toBe('scene-1');
    expect(result.current.hasUnsavedSceneDrafts).toBe(true);
  });

  it.each([0, 61, 1.5])('rejects invalid scene duration %s without sending IPC', async (durationSeconds) => {
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ durationSeconds }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });

    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    expect(result.current.error).toMatchObject({
      operation: 'save_scene',
      code: 'invalid_payload',
      messageKey: 'conversation.creativeStudio.inspector.invalidDuration',
    });
  });

  it('reflects a local duration draft in the storyboard total before debounce persistence', async () => {
    const { result, unmount } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ durationSeconds: 6 }));

    expect(result.current.durationTotalSeconds).toBe(11);
    expect(result.current.durationMatchesTarget).toBe(false);
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();
    act(() => unmount());
  });

  it('refetches on stale save while preserving the draft until explicit retry', async () => {
    const refreshed = project(8, [
      scene('scene-1', { title: 'Canonical title', narration: 'Remote narration' }),
      scene('scene-2'),
    ]);
    const retried = project(9, [
      scene('scene-1', { title: 'My title', narration: 'Remote narration' }),
      scene('scene-2'),
    ]);
    const refetch = vi.fn(async () => refreshed);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(retried));
    const { result } = renderHook(() => useStoryboardEditor({ project: project(), refetch }));

    act(() => result.current.updateSceneDraft({ title: 'My title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });

    expect(refetch).toHaveBeenCalledOnce();
    expect(result.current.project?.revision).toBe(8);
    expect(result.current.sceneDraft?.title).toBe('My title');
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
    });

    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      expectedRevision: 8,
      scene: { title: 'My title', narration: 'Remote narration' },
    });
    expect(result.current.project?.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
  });

  it('replaces a stale save conflict with the typed retry failure and resumes parked scene saves', async () => {
    const refreshed = project(8, [
      scene('scene-1', { title: 'Canonical title' }),
      scene('scene-2', { title: 'Canonical second title' }),
    ]);
    const secondSceneSaved = project(9, [
      scene('scene-1', { title: 'Canonical title' }),
      scene('scene-2', { title: 'My second title' }),
    ]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(failed('provider_error', 'conversation.creativeStudio.errors.provider'))
      .mockResolvedValueOnce(ok(secondSceneSaved));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'My first title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    act(() => result.current.selectScene('scene-2'));
    act(() => result.current.updateSceneDraft({ title: 'My second title' }));
    let parkedSave!: Promise<boolean>;
    act(() => {
      parkedSave = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(false);
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(3));
    await act(async () => {
      expect(await parkedSave).toBe(true);
    });

    expect(result.current.conflict).toBeNull();
    expect(result.current.saveIssues).toEqual([
      expect.objectContaining({
        operation: 'save_scene',
        code: 'provider_error',
        sceneId: 'scene-1',
      }),
    ]);
    expect(result.current.project?.revision).toBe(9);
  });

  it('retries the latest same-scene edit made while a stale save conflict is visible', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Canonical title' }), scene('scene-2')]);
    const retried = project(9, [scene('scene-1', { title: 'Newest local title' }), scene('scene-2')]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(retried));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    act(() => result.current.updateSceneDraft({ title: 'Newest local title' }));
    let supersededSave!: Promise<boolean>;
    act(() => {
      supersededSave = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
      expect(await supersededSave).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      expectedRevision: 8,
      scene: { title: 'Newest local title' },
    });
    expect(result.current.project?.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
  });

  it('replaces a stale reorder conflict with the typed retry failure and resumes parked mutations', async () => {
    const refreshed = project(8);
    const removed = project(9, [scene('scene-1')]);
    bridge.reorderScenes.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(failed('storage_error', 'conversation.creativeStudio.errors.storage'));
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(removed));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    await act(async () => {
      expect(await result.current.reorderScenes(['scene-2', 'scene-1'])).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });

    let parkedRemoval!: Promise<boolean>;
    act(() => {
      parkedRemoval = result.current.removeScene('scene-2');
    });
    await act(async () => Promise.resolve());

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(false);
    });
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledOnce());
    await act(async () => {
      expect(await parkedRemoval).toBe(true);
    });

    expect(result.current.conflict).toBeNull();
    expect(result.current.error).toMatchObject({
      operation: 'reorder_scenes',
      code: 'storage_error',
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1']);
  });

  it('discards a newer same-scene edit without resuming it behind the stale save conflict', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Canonical title' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'First local title' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'save_scene', sceneId: 'scene-1' });

    act(() => result.current.updateSceneDraft({ title: 'Discard this newer title' }));
    let supersededSave!: Promise<boolean>;
    act(() => {
      supersededSave = result.current.flushSceneDraft();
    });
    await act(async () => Promise.resolve());

    act(() => result.current.discardConflict());
    await act(async () => {
      expect(await supersededSave).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
    expect(result.current.sceneDraft?.title).toBe('Canonical title');
    expect(result.current.project?.revision).toBe(8);
    expect(result.current.conflict).toBeNull();
  });

  it('discards a conflicted scene draft back to the refetched canonical scene', async () => {
    const refreshed = project(8, [scene('scene-1', { title: 'Canonical title' }), scene('scene-2')]);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Discard me' }));
    await act(async () => {
      await result.current.flushSceneDraft();
    });
    act(() => result.current.discardConflict());

    expect(result.current.conflict).toBeNull();
    expect(result.current.sceneDraft?.title).toBe('Canonical title');
  });

  it('adds a valid UUID scene and refuses a twenty-fifth scene', async () => {
    const initial = project(2, []);
    bridge.updateScene.invoke.mockImplementationOnce(async ({ sceneId, scene: editable }) =>
      ok(
        project(3, [
          { id: sceneId, ...editable, selectedAssetId: null, assetIds: [], jobIds: [], reviewState: 'draft' },
        ])
      )
    );
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: initial } }
    );

    await act(async () => {
      expect(await result.current.addScene()).toBe(true);
    });

    const request = bridge.updateScene.invoke.mock.calls[0]?.[0];
    expect(request.sceneId).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(request.scene).toMatchObject({
      title: '',
      mediaKind: 'image',
      referenceAssetId: null,
    });
    expect(result.current.selectedSceneId).toBe(request.sceneId);

    const fullScenes = Array.from({ length: 24 }, (_, index) => scene(`scene-${index + 1}`));
    rerender({ value: project(4, fullScenes) });
    expect(result.current.canAddScene).toBe(false);
    await act(async () => {
      expect(await result.current.addScene()).toBe(false);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);
  });

  it('removes with scene null and preserves canonical state after a typed rejection', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(
      failed('storage_error', 'conversation.creativeStudio.errors.storage')
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(false);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      sceneId: 'scene-1',
      expectedRevision: 2,
      scene: null,
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
  });

  it('clears a prior scene-save issue when that scene is successfully removed', async () => {
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('storage_error', 'conversation.creativeStudio.errors.storage'))
      .mockResolvedValueOnce(ok(project(3, [scene('scene-2')])));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Failed edit before remove' }));
    await act(async () => {
      expect(await result.current.flushSceneDraft()).toBe(false);
    });
    expect(result.current.saveIssues.map((issue) => issue.sceneId)).toEqual(['scene-1']);

    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(true);
    });

    expect(result.current.saveIssues).toEqual([]);
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-2']);
  });

  it('persists an edited scene after its pending removal receives a typed rejection', async () => {
    vi.useFakeTimers();
    const saved = project(3, [scene('scene-1', { title: 'Keep this edit' }), scene('scene-2')]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('storage_error', 'conversation.creativeStudio.errors.storage'))
      .mockResolvedValueOnce(ok(saved));
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    act(() => result.current.updateSceneDraft({ title: 'Keep this edit' }));
    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(false);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-1',
      expectedRevision: 2,
      scene: { title: 'Keep this edit' },
    });
    expect(result.current.hasUnsavedSceneDrafts).toBe(false);
  });

  it('resumes an edited-scene save after discarding its stale removal conflict', async () => {
    vi.useFakeTimers();
    const refreshed = project(8, [scene('scene-1', { title: 'Remote title' }), scene('scene-2')]);
    const saved = project(9, [scene('scene-1', { title: 'Keep this edit' }), scene('scene-2')]);
    bridge.updateScene.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(saved));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Keep this edit' }));
    await act(async () => {
      expect(await result.current.removeScene('scene-1')).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'remove_scene', sceneId: 'scene-1' });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(450);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.discardConflict();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(2);
    expect(bridge.updateScene.invoke.mock.calls[1]?.[0]).toMatchObject({
      sceneId: 'scene-1',
      expectedRevision: 8,
      scene: { title: 'Keep this edit' },
    });
    expect(result.current.project?.revision).toBe(9);
    expect(result.current.conflict).toBeNull();
  });

  it('reorders an exact permutation and rejects invalid and boundary moves without IPC', async () => {
    const reordered = project(3, [scene('scene-2'), scene('scene-1')]);
    bridge.reorderScenes.invoke.mockResolvedValueOnce(ok(reordered));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    await act(async () => {
      expect(await result.current.moveScene('scene-1', 'down')).toBe(true);
    });
    expect(bridge.reorderScenes.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 2,
      sceneOrder: ['scene-2', 'scene-1'],
    });

    await act(async () => {
      expect(await result.current.moveScene('scene-2', 'up')).toBe(false);
      expect(await result.current.reorderScenes(['scene-2', 'missing'])).toBe(false);
    });
    expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1);
  });

  it('retries a stale reorder with the refetched revision and preserves the intended order', async () => {
    const refreshed = project(8);
    const reordered = project(9, [scene('scene-2'), scene('scene-1')]);
    bridge.reorderScenes.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockResolvedValueOnce(ok(reordered));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    await act(async () => {
      expect(await result.current.reorderScenes(['scene-2', 'scene-1'])).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(true);
    });

    expect(bridge.reorderScenes.invoke.mock.calls[1]?.[0]).toEqual({
      projectId: 'project-1',
      expectedRevision: 8,
      sceneOrder: ['scene-2', 'scene-1'],
    });
  });

  it('ignores older parent revisions after adopting a newer mutation response', async () => {
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(project(7)));
    const { result, rerender } = renderHook(
      ({ value }) => useStoryboardEditor({ project: value, refetch: vi.fn(async () => value) }),
      { initialProps: { value: project(2) } }
    );

    act(() => result.current.updateSceneDraft({ title: 'Newest' }));
    await act(async () => {
      await result.current.flushSceneDraft();
    });
    rerender({ value: project(4) });

    expect(result.current.project?.revision).toBe(7);
  });

  it('adopts a successful explicit storyboard replacement without loading routes', async () => {
    const drafted = project(3, [scene('draft-1', { title: 'Drafted scene' })]);
    bridge.proposeStoryboard.invoke.mockResolvedValueOnce(ok(drafted));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(true);
    });

    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 2,
      replaceExisting: true,
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['draft-1']);
    expect(result.current.selectedSceneId).toBe('draft-1');
  });

  it('does not start or park a planner call behind a non-draft conflict', async () => {
    bridge.reorderScenes.invoke.mockResolvedValueOnce(
      failed('stale_project', 'conversation.creativeStudio.errors.staleProject')
    );
    const refreshed = project(8);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    await act(async () => {
      expect(await result.current.reorderScenes(['scene-2', 'scene-1'])).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });

    expect(result.current.drafting).toBe(false);
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
  });

  it('settles a planner authorization when an earlier queued mutation becomes stale', async () => {
    const reordering = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.reorderScenes.invoke.mockReturnValueOnce(reordering.promise);
    const refreshed = project(8);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    let reorderResult!: Promise<boolean>;
    act(() => {
      reorderResult = result.current.reorderScenes(['scene-2', 'scene-1']);
    });
    await waitFor(() => expect(bridge.reorderScenes.invoke).toHaveBeenCalledTimes(1));

    let plannerResult!: Promise<boolean>;
    act(() => {
      plannerResult = result.current.proposeStoryboard(true);
    });
    expect(result.current.drafting).toBe(true);
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();

    await act(async () => {
      reordering.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await reorderResult).toBe(false);
    });

    await waitFor(() => expect(result.current.drafting).toBe(false));
    await act(async () => {
      expect(await plannerResult).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'reorder_scenes' });
    expect(bridge.proposeStoryboard.invoke).not.toHaveBeenCalled();
  });

  it('resumes a scene save when a fresh draft confirmation fails without replacing the storyboard', async () => {
    const firstProposal = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.proposeStoryboard.invoke
      .mockReturnValueOnce(firstProposal.promise)
      .mockResolvedValueOnce(failed('provider_error', 'conversation.creativeStudio.errors.provider'));
    const refreshed = project(8);
    bridge.updateScene.invoke.mockResolvedValueOnce(
      ok(project(9, [scene('scene-1', { title: 'Preserved local edit' }), scene('scene-2')]))
    );
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    let firstDraft!: Promise<boolean>;
    act(() => {
      firstDraft = result.current.proposeStoryboard(true);
    });
    await waitFor(() => expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1));

    act(() => result.current.updateSceneDraft({ title: 'Preserved local edit' }));
    let queuedSave!: Promise<boolean>;
    act(() => {
      queuedSave = result.current.flushSceneDraft();
    });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      firstProposal.resolve(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'));
      expect(await firstDraft).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'draft_storyboard' });
    expect(bridge.updateScene.invoke).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });

    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    await act(async () => {
      expect(await queuedSave).toBe(true);
    });
    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 8,
        scene: expect.objectContaining({ title: 'Preserved local edit' }),
      })
    );
    expect(result.current.conflict).toBeNull();
  });

  it('flushes a typed scene draft before a storyboard replacement can supersede it', async () => {
    const saved = project(3, [scene('scene-1', { title: 'Preserved local edit' }), scene('scene-2')]);
    const drafted = project(4, [scene('draft-1', { title: 'Drafted scene' })]);
    bridge.updateScene.invoke.mockResolvedValueOnce(ok(saved));
    bridge.proposeStoryboard.invoke.mockResolvedValueOnce(ok(drafted));
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    act(() => result.current.updateSceneDraft({ title: 'Preserved local edit' }));

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(true);
    });

    // Slice A Task 11 / parent spec section 7: replacement is authorized only
    // after typed scene content has crossed the durable main-process boundary.
    expect(bridge.updateScene.invoke).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        sceneId: 'scene-1',
        expectedRevision: 2,
        scene: expect.objectContaining({ title: 'Preserved local edit' }),
      })
    );
    expect(bridge.updateScene.invoke.mock.invocationCallOrder[0]).toBeLessThan(
      bridge.proposeStoryboard.invoke.mock.invocationCallOrder[0]
    );
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledWith({
      projectId: 'project-1',
      expectedRevision: 3,
      replaceExisting: true,
    });
    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['draft-1']);
    expect(result.current.conflict).toBeNull();
  });

  it('allows only one same-tick storyboard authorization', async () => {
    const proposal = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.proposeStoryboard.invoke.mockReturnValueOnce(proposal.promise);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => project()) })
    );

    let first!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      first = result.current.proposeStoryboard(true);
      duplicate = result.current.proposeStoryboard(true);
    });
    await act(async () => Promise.resolve());
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1);

    await act(async () => {
      proposal.resolve(ok(project(3)));
      expect(await first).toBe(true);
      expect(await duplicate).toBe(false);
    });
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1);
  });

  it('requires a fresh explicit planner confirmation after a charged stale result', async () => {
    const retry = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.proposeStoryboard.invoke
      .mockResolvedValueOnce(failed('stale_project', 'conversation.creativeStudio.errors.staleProject'))
      .mockReturnValueOnce(retry.promise);
    const refreshed = project(8);
    const { result } = renderHook(() =>
      useStoryboardEditor({ project: project(), refetch: vi.fn(async () => refreshed) })
    );

    await act(async () => {
      expect(await result.current.proposeStoryboard(true)).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'draft_storyboard' });

    await act(async () => {
      expect(await result.current.retryConflict()).toBe(false);
    });
    expect(result.current.conflict).toMatchObject({ operation: 'draft_storyboard' });
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(1);

    let confirmedRetry!: Promise<boolean>;
    let duplicate!: Promise<boolean>;
    act(() => {
      confirmedRetry = result.current.proposeStoryboard(true);
      duplicate = result.current.proposeStoryboard(true);
    });
    await waitFor(() => expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(2));

    await act(async () => {
      retry.resolve(ok(project(9)));
      expect(await confirmedRetry).toBe(true);
      expect(await duplicate).toBe(false);
    });
    expect(bridge.proposeStoryboard.invoke).toHaveBeenCalledTimes(2);
  });

  it('preserves the current storyboard for typed planner failures', async () => {
    bridge.proposeStoryboard.invoke.mockResolvedValueOnce(
      failed('storyboard_exists', 'conversation.creativeStudio.errors.storyboardExists')
    );
    const initial = project();
    const { result } = renderHook(() => useStoryboardEditor({ project: initial, refetch: vi.fn(async () => initial) }));

    await act(async () => {
      expect(await result.current.proposeStoryboard(false)).toBe(false);
    });

    expect(result.current.orderedScenes.map(({ id }) => id)).toEqual(['scene-1', 'scene-2']);
    expect(result.current.error).toMatchObject({
      operation: 'draft_storyboard',
      code: 'storyboard_exists',
    });
  });
});
