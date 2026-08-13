/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  StudioAsset,
  StudioCommandResult,
  StudioRendererProject,
  StudioRouteCatalog,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import StudioPage from '@renderer/pages/studio/StudioPage';

const bridge = vi.hoisted(() => ({
  hasUnsavedWork: { provider: vi.fn() },
  flushUnsavedWork: { provider: vi.fn() },
  getProject: { invoke: vi.fn() },
  listProposals: { invoke: vi.fn() },
  listRoutes: { invoke: vi.fn() },
  updateProject: { invoke: vi.fn() },
  updateScene: { invoke: vi.fn() },
  reorderScenes: { invoke: vi.fn() },
  proposeStoryboard: { invoke: vi.fn() },
  chooseAndImportReference: { invoke: vi.fn() },
  chooseAndExportAssets: { invoke: vi.fn() },
  getLatestRender: { invoke: vi.fn() },
  renderCut: { invoke: vi.fn() },
  cancelRender: { invoke: vi.fn() },
  submitScenes: { invoke: vi.fn() },
  cancelJob: { invoke: vi.fn() },
  retryJob: { invoke: vi.fn() },
  retryDownload: { invoke: vi.fn() },
  selectAsset: { invoke: vi.fn() },
  listConnectionCandidates: { invoke: vi.fn() },
  listConnections: { invoke: vi.fn() },
  validateConnection: { invoke: vi.fn() },
  saveConnection: { invoke: vi.fn() },
  removeConnection: { invoke: vi.fn() },
  projectUpdated: { on: vi.fn() },
  proposalUpdated: { on: vi.fn() },
  renderProgress: { on: vi.fn() },
  turnCompleted: { on: vi.fn() },
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: bridge,
    conversation: { turnCompleted: bridge.turnCompleted },
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      values === undefined ? key : `${key}:${Object.values(values).join(',')}`,
    i18n: { language: 'en-US' },
  }),
}));
vi.mock('@renderer/pages/studio/components/PhaseShell/phases/brief/useBriefConversation', () => ({
  useBriefConversation: () => ({
    state: { kind: 'absent' },
    errorMessageKey: null,
    recreate: vi.fn(),
  }),
}));

const ok = <T,>(data: T): StudioCommandResult<T> => ({ ok: true, data });

const scene = (id: string, selectedAssetId: string | null): StudioScene => ({
  id,
  title: id === 'scene-1' ? 'Opening' : 'Closing',
  purpose: 'Tell the story',
  visualPrompt: 'A cinematic frame',
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId,
  assetIds: selectedAssetId === null ? [] : [selectedAssetId],
  jobIds: [],
  reviewState: selectedAssetId === null ? 'ready' : 'complete',
});

const asset = (id: string, sceneId: string): StudioAsset => ({
  id,
  projectId: 'project-1',
  sceneId,
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: `${id}.png` },
  byteSize: 128,
  sha256: id.padEnd(64, 'a').slice(0, 64),
  createdAt: '2026-07-30T00:00:00.000Z',
});

const project = (withSelectedAssets = true): StudioRendererProject => {
  const first = scene('scene-1', withSelectedAssets ? 'asset-1' : null);
  const second = scene('scene-2', withSelectedAssets ? 'asset-2' : null);
  return {
    schemaVersion: 1,
    revision: 2,
    id: 'project-1',
    name: 'Launch film',
    brief: 'A short launch video',
    rules: [],
    ruleListUndo: null,
    aspectRatio: '16:9',
    targetDurationSeconds: 10,
    resolution: '720p',
    sceneOrder: [first.id, second.id],
    scenes: { [first.id]: first, [second.id]: second },
    assets: withSelectedAssets
      ? {
          'asset-1': asset('asset-1', first.id),
          'asset-2': asset('asset-2', second.id),
        }
      : {},
    jobs: {},
    routing: { storyboard: null, image: null, video: null },
    createdAt: '2026-07-30T00:00:00.000Z',
    updatedAt: '2026-07-30T00:00:00.000Z',
  };
};

const routes = (): StudioRouteCatalog => ({
  storyboard: {
    status: 'ready',
    selected: { providerId: 'provider-1', model: 'operations-model' },
    options: [
      {
        providerId: 'provider-1',
        providerName: 'Provider',
        model: 'operations-model',
        health: 'available',
      },
    ],
  },
  image: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
  video: { status: 'setup_required', selected: null, selectedRoute: null, options: [] },
  catalogVersion: 'catalog-1',
});

const renderProject = (phase: 'write' | 'review' = 'review') => {
  const router = createMemoryRouter([{ path: '/studio/:id/:phase?', element: <StudioPage /> }], {
    initialEntries: [`/studio/project-1/${phase}`],
  });
  return { router, view: render(<RouterProvider router={router} />) };
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
};

const confirmExport = async (): Promise<void> => {
  const confirm = screen.getByRole('button', {
    name: 'conversation.creativeStudio.export.confirm',
  });
  await waitFor(() => expect(confirm).toBeEnabled());
  fireEvent.click(confirm);
};

describe('Studio asset export', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    bridge.getProject.invoke.mockResolvedValue(ok(project()));
    bridge.listProposals.invoke.mockResolvedValue(ok([]));
    bridge.listRoutes.invoke.mockResolvedValue(ok(routes()));
    bridge.updateProject.invoke.mockResolvedValue(ok(project()));
    bridge.updateScene.invoke.mockResolvedValue(ok(project()));
    bridge.reorderScenes.invoke.mockResolvedValue(ok(project()));
    bridge.proposeStoryboard.invoke.mockResolvedValue(ok(project()));
    bridge.chooseAndImportReference.invoke.mockResolvedValue(ok({ status: 'cancelled' }));
    bridge.chooseAndExportAssets.invoke.mockResolvedValue(
      ok({
        status: 'exported',
        folderName: 'Launch-film-20260730-151500',
        exported: [
          { assetId: 'asset-1', fileName: 'scene-01.png' },
          { assetId: 'asset-2', fileName: 'scene-02.png' },
        ],
        missingSceneIds: [],
      })
    );
    bridge.getLatestRender.invoke.mockResolvedValue(ok(null));
    bridge.submitScenes.invoke.mockResolvedValue(ok([]));
    bridge.renderCut.invoke.mockResolvedValue(ok({ assetId: 'render-1', missingSceneIds: [] }));
    bridge.cancelRender.invoke.mockResolvedValue(ok({ cancelled: true }));
    bridge.cancelJob.invoke.mockResolvedValue(ok(null));
    bridge.retryJob.invoke.mockResolvedValue(ok(null));
    bridge.retryDownload.invoke.mockResolvedValue(ok(null));
    bridge.selectAsset.invoke.mockResolvedValue(ok(project()));
    bridge.listConnectionCandidates.invoke.mockResolvedValue(ok([]));
    bridge.listConnections.invoke.mockResolvedValue(ok([]));
    bridge.validateConnection.invoke.mockResolvedValue(ok(null));
    bridge.saveConnection.invoke.mockResolvedValue(ok(null));
    bridge.removeConnection.invoke.mockResolvedValue(ok(false));
    bridge.projectUpdated.on.mockReturnValue(() => {});
    bridge.proposalUpdated.on.mockReturnValue(() => {});
    bridge.renderProgress.on.mockReturnValue(() => {});
    bridge.turnCompleted.on.mockReturnValue(() => {});
    bridge.hasUnsavedWork.provider.mockReturnValue(() => {});
    bridge.flushUnsavedWork.provider.mockReturnValue(() => {});
  });

  it('opens the native destination chooser with IDs only and reports the returned folder name', async () => {
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );
    expect(screen.getByRole('dialog')).toHaveTextContent('conversation.creativeStudio.export.body');
    within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.label' }))
      .getAllByRole('button')
      .forEach((button) => expect(button).toBeDisabled());

    await confirmExport();

    await waitFor(() =>
      expect(bridge.chooseAndExportAssets.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        includeReferences: false,
      })
    );
    expect(JSON.stringify(bridge.chooseAndExportAssets.invoke.mock.calls[0]?.[0])).not.toMatch(
      /path|directory|destination|file:|https?:|data:/i
    );
    expect(
      await screen.findByText('conversation.creativeStudio.export.successBody:Launch-film-20260730-151500,2')
    ).toBeInTheDocument();
    expect(screen.queryByText(/Export video/i)).not.toBeInTheDocument();
  });

  it('shows the persisted cut render time and stale-edit warning before opening the folder picker', async () => {
    const formatTimestamp = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('Jul 29, 2026, 3:15 PM');
    bridge.getLatestRender.invoke.mockResolvedValueOnce(
      ok({ fileName: 'cut.mp4' as const, renderedAt: '2026-07-29T08:15:00.000Z' })
    );
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );

    const dialog = await screen.findByRole('dialog');
    expect(bridge.getLatestRender.invoke).toHaveBeenCalledExactlyOnceWith({ projectId: 'project-1' });
    expect(within(dialog).getByText('cut.mp4')).toBeVisible();
    expect(within(dialog).getByText('conversation.creativeStudio.export.renderedAt')).toBeVisible();
    expect(within(dialog).getByText('conversation.creativeStudio.export.staleRender')).toBeVisible();
    expect(within(dialog).getByText('Jul 29, 2026, 3:15 PM')).toHaveAttribute('datetime', '2026-07-29T08:15:00.000Z');
    expect(within(dialog).queryByText('2026-07-29T08:15:00.000Z')).not.toBeInTheDocument();
    expect(formatTimestamp).toHaveBeenCalledWith('en-US', { dateStyle: 'medium', timeStyle: 'short' });
    formatTimestamp.mockRestore();
    expect(bridge.chooseAndExportAssets.invoke).not.toHaveBeenCalled();
  });

  it('exports imported references only when the user opts in', async () => {
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );
    fireEvent.click(
      screen.getByRole('checkbox', {
        name: 'conversation.creativeStudio.export.includeReferences',
      })
    );
    await confirmExport();

    await waitFor(() =>
      expect(bridge.chooseAndExportAssets.invoke).toHaveBeenCalledExactlyOnceWith({
        projectId: 'project-1',
        includeReferences: true,
      })
    );
  });

  it('reports a collision-safe folder name and every scene missing from a partial export', async () => {
    bridge.chooseAndExportAssets.invoke.mockResolvedValueOnce(
      ok({
        status: 'exported',
        folderName: 'Launch-film-20260730-151500-2',
        exported: [{ assetId: 'asset-1', fileName: 'scene-01.png' }],
        missingSceneIds: ['scene-2'],
      })
    );
    const { router } = renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );
    await confirmExport();

    expect(
      await screen.findByRole('dialog', {
        name: 'conversation.creativeStudio.export.partialTitle',
      })
    ).toHaveTextContent('conversation.creativeStudio.export.partialBody:Launch-film-20260730-151500-2');
    expect(screen.getByText('Launch-film-20260730-151500-2')).toBeInTheDocument();
    const missingSlates = screen.getByRole('list', {
      name: 'conversation.creativeStudio.phase.review.missingSlates:1',
    });
    expect(within(missingSlates).getAllByRole('listitem')).toHaveLength(1);
    expect(within(missingSlates).getByText('scene-2')).toBeVisible();
    expect(within(missingSlates).queryByText('scene-1')).not.toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.phase.review.partialHandoff')).toBeVisible();
    expect(screen.getByText('conversation.creativeStudio.phase.review.excludedFromHandoff')).toBeVisible();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'conversation.creativeStudio.phase.review.openProduce',
      })
    );
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/produce'));
  });

  it('reports a complete selected-assets handoff without slate or movie claims', async () => {
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );
    await confirmExport();

    const dialog = await screen.findByRole('dialog', {
      name: 'conversation.creativeStudio.export.successTitle',
    });
    expect(dialog).toHaveTextContent('conversation.creativeStudio.export.successBody:Launch-film-20260730-151500,2');
    expect(
      within(dialog).queryByRole('button', { name: 'conversation.creativeStudio.phase.review.openProduce' })
    ).not.toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/slates exported|stitched|final movie|composed/i);
  });

  it('treats native chooser cancellation as a harmless closed flow', async () => {
    bridge.chooseAndExportAssets.invoke.mockResolvedValueOnce(ok({ status: 'cancelled' }));
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );
    await confirmExport();

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByText('conversation.creativeStudio.export.successTitle')).not.toBeInTheDocument();
    expect(screen.queryByText('conversation.creativeStudio.export.failed')).not.toBeInTheDocument();
  });

  it('disables export with a visible reason when no canonical selected assets exist', async () => {
    bridge.getProject.invoke.mockResolvedValue(ok(project(false)));
    renderProject();

    const exportAction = await screen.findByRole('button', {
      name: 'conversation.creativeStudio.phase.review.handoff',
    });
    expect(exportAction).toBeDisabled();
    expect(screen.getByText('conversation.creativeStudio.phase.review.noAssets')).toBeVisible();
    fireEvent.click(exportAction);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(bridge.chooseAndExportAssets.invoke).not.toHaveBeenCalled();
  });

  it('keeps the export review open and surfaces a typed bridge rejection', async () => {
    bridge.chooseAndExportAssets.invoke.mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'storage_error',
        messageKey: 'conversation.creativeStudio.errors.storage',
      },
    });
    renderProject();

    fireEvent.click(
      await screen.findByRole('button', {
        name: 'conversation.creativeStudio.phase.review.handoff',
      })
    );
    await confirmExport();

    expect(await screen.findByText('conversation.creativeStudio.export.failed')).toBeInTheDocument();
    expect(screen.getByText('conversation.creativeStudio.errors.storage')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('cannot export stale canonical data while a scene edit is unsaved or still saving', async () => {
    const save = deferred<StudioCommandResult<StudioRendererProject>>();
    bridge.updateScene.invoke.mockReturnValueOnce(save.promise);
    const { router } = renderProject('write');

    const openingRow = await screen.findByRole('region', { name: 'Opening' });
    const prompt = within(openingRow).getByLabelText('conversation.creativeStudio.inspector.visualPromptLabel');
    fireEvent.change(prompt, { target: { value: 'A newly edited cinematic frame' } });
    fireEvent.click(
      within(screen.getByRole('navigation', { name: 'conversation.creativeStudio.phase.nav.label' })).getByRole(
        'button',
        {
          name: 'conversation.creativeStudio.phase.nav.review',
        }
      )
    );
    await waitFor(() => expect(bridge.updateScene.invoke).toHaveBeenCalledTimes(1));
    expect(router.state.location.pathname).toBe('/studio/project-1/write');
    expect(screen.queryByRole('button', { name: 'conversation.creativeStudio.phase.review.handoff' })).toBeNull();
    expect(bridge.chooseAndExportAssets.invoke).not.toHaveBeenCalled();

    await act(async () => {
      save.resolve(ok(project()));
      await save.promise;
    });
    await waitFor(() => expect(router.state.location.pathname).toBe('/studio/project-1/review'));
    expect(screen.getByRole('button', { name: 'conversation.creativeStudio.phase.review.handoff' })).toBeEnabled();
  });
});
