import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  const provider = (name: string) => ({
    provider: vi.fn((handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
      return vi.fn();
    }),
  });
  return {
    handlers,
    electron: {
      getFocusedWindow: vi.fn(() => undefined),
      getAllWindows: vi.fn(() => []),
      showSaveDialog: vi.fn(async () => ({ canceled: true, filePath: undefined })),
      showItemInFolder: vi.fn(),
    },
    bridge: {
      listProjects: provider('listProjects'),
      createProject: provider('createProject'),
      loadProject: provider('loadProject'),
      getDirectorSessionServer: provider('getDirectorSessionServer'),
      getDirectorSessionAuthority: provider('getDirectorSessionAuthority'),
      bindDirectorConversation: provider('bindDirectorConversation'),
      preparePhoto: provider('preparePhoto'),
      confirmPreparedPhoto: provider('confirmPreparedPhoto'),
      discardPreparedPhoto: provider('discardPreparedPhoto'),
      importPhoto: provider('importPhoto'),
      applyMutationBatch: provider('applyMutationBatch'),
      cancelJob: provider('cancelJob'),
      resumeJob: provider('resumeJob'),
      retryDownload: provider('retryDownload'),
      listPieceExports: provider('listPieceExports'),
      exportPiece: provider('exportPiece'),
      revealPieceExport: provider('revealPieceExport'),
      deleteProject: provider('deleteProject'),
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: { creativeStudioPilot: mocks.bridge } }));
vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: mocks.electron.getFocusedWindow,
    getAllWindows: mocks.electron.getAllWindows,
  },
  dialog: { showSaveDialog: mocks.electron.showSaveDialog },
  shell: { showItemInFolder: mocks.electron.showItemInFolder },
}));
vi.mock('@process/services/creative-studio/pilotProductionRuntime', () => ({
  getCreativeStudioPilotProductionRuntimeV3: vi.fn(),
}));

import { initCreativeStudioPilotBridgeV3 } from '@process/bridge/creativeStudioPilotBridge';
import { CreativeStudioPilotServiceErrorV3 } from '@process/services/creative-studio/service/pilot/errors';

const makeEntryPoint = () => ({
  listProjectsV3: vi.fn(async () => ({ entries: [] })),
  createProjectV3: vi.fn(),
  loadProjectV3: vi.fn(),
  bindDirectorConversationV3: vi.fn(),
  preparePhotoV3: vi.fn(),
  confirmPreparedPhotoV3: vi.fn(),
  discardPreparedPhotoV3: vi.fn(),
  importPhotoV3: vi.fn(),
  applyMutationBatchV3: vi.fn(),
  cancelJobV3: vi.fn(),
  resumeJobV3: vi.fn(),
  retryDownloadV3: vi.fn(),
  listPieceExportsV3: vi.fn(),
  exportPieceV3: vi.fn(),
  deleteProjectV3: vi.fn(),
});

const makeRuntime = () => {
  const entryPoint = makeEntryPoint();
  const pieceExports = {
    describe: vi.fn(),
    copy: vi.fn(),
    resolveRevealPath: vi.fn(),
  };
  return {
    entryPoint,
    pilot: { pieceExports },
    pieceExports,
    getDirectorSessionServer: vi.fn(),
    getDirectorSessionAuthority: vi.fn(),
  };
};

describe('Creative Studio Pilot bridge', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    vi.clearAllMocks();
    mocks.electron.getFocusedWindow.mockReturnValue(undefined);
    mocks.electron.getAllWindows.mockReturnValue([]);
    mocks.electron.showSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined });
  });

  it('registers the exact schema-6 operation set and forwards canonical inputs', async () => {
    const entryPoint = makeEntryPoint();
    initCreativeStudioPilotBridgeV3({ isFeatureEnabled: () => true, getRuntime: () => ({ entryPoint }) as never });

    expect([...mocks.handlers.keys()]).toEqual([
      'listProjects',
      'createProject',
      'loadProject',
      'getDirectorSessionServer',
      'getDirectorSessionAuthority',
      'bindDirectorConversation',
      'preparePhoto',
      'confirmPreparedPhoto',
      'discardPreparedPhoto',
      'importPhoto',
      'applyMutationBatch',
      'cancelJob',
      'resumeJob',
      'retryDownload',
      'listPieceExports',
      'exportPiece',
      'revealPieceExport',
      'deleteProject',
    ]);

    await expect(mocks.handlers.get('loadProject')?.({ projectId: 'project_1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(entryPoint.loadProjectV3).toHaveBeenCalledWith('project_1');

    await expect(mocks.handlers.get('listPieceExports')?.({ projectId: 'project_1' })).resolves.toEqual({
      ok: true,
      data: undefined,
    });
    expect(entryPoint.listPieceExportsV3).toHaveBeenCalledWith('project_1');

    const forwarded = [
      ['createProject', 'createProjectV3'],
      ['preparePhoto', 'preparePhotoV3'],
      ['confirmPreparedPhoto', 'confirmPreparedPhotoV3'],
      ['discardPreparedPhoto', 'discardPreparedPhotoV3'],
      ['importPhoto', 'importPhotoV3'],
      ['applyMutationBatch', 'applyMutationBatchV3'],
      ['cancelJob', 'cancelJobV3'],
      ['resumeJob', 'resumeJobV3'],
      ['retryDownload', 'retryDownloadV3'],
      ['deleteProject', 'deleteProjectV3'],
    ] as const;
    for (const [providerName, methodName] of forwarded) {
      const input = { operation: providerName };
      await expect(mocks.handlers.get(providerName)?.(input)).resolves.toEqual({ ok: true, data: undefined });
      expect(entryPoint[methodName]).toHaveBeenCalledWith(input);
    }
  });

  it('uses the native defaults without returning the chosen or managed path', async () => {
    const runtime = makeRuntime();
    runtime.pieceExports.describe.mockResolvedValue({ suggestedName: 'piece-night_light-export' });
    runtime.pieceExports.resolveRevealPath.mockResolvedValue('/private/managed/piece-export_1');
    const parentWindow = { id: 1 };
    mocks.electron.getAllWindows.mockReturnValue([parentWindow] as never);
    initCreativeStudioPilotBridgeV3({ isFeatureEnabled: () => true, getRuntime: () => runtime as never });
    const input = { projectId: 'project_1', pieceId: 'piece_1', expectedRevision: 4 };

    await expect(mocks.handlers.get('exportPiece')?.(input)).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(mocks.electron.showSaveDialog).toHaveBeenCalledWith(parentWindow, {
      defaultPath: 'piece-night_light-export',
    });

    const reveal = { projectId: 'project_1', expectedCatalogRevision: 2, artifactId: 'export_1' };
    await expect(mocks.handlers.get('revealPieceExport')?.(reveal)).resolves.toEqual({
      ok: true,
      data: { status: 'revealed' },
    });
    expect(mocks.electron.showItemInFolder).toHaveBeenCalledWith('/private/managed/piece-export_1');
    expect(JSON.stringify(await mocks.handlers.get('revealPieceExport')?.(reveal))).not.toContain('/private/managed');
  });

  it('chooses a native destination before creating and cancellation writes nothing', async () => {
    const runtime = makeRuntime();
    runtime.pieceExports.describe.mockResolvedValue({
      suggestedName: 'piece-night_light-export',
    });
    const chooseExportDestination = vi.fn(async () => null);
    initCreativeStudioPilotBridgeV3({
      isFeatureEnabled: () => true,
      getRuntime: () => runtime as never,
      getParentWindow: () => undefined,
      chooseExportDestination,
    });
    const input = {
      projectId: 'project_1',
      pieceId: 'piece_1',
      expectedRevision: 4,
    };

    await expect(mocks.handlers.get('exportPiece')?.(input)).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(runtime.pieceExports.describe).toHaveBeenCalledWith(input);
    expect(chooseExportDestination).toHaveBeenCalledWith(undefined, {
      suggestedName: 'piece-night_light-export',
      isDirectory: true,
    });
    expect(runtime.pieceExports.describe.mock.invocationCallOrder[0]).toBeLessThan(
      chooseExportDestination.mock.invocationCallOrder[0]!
    );
    expect(runtime.entryPoint.exportPieceV3).not.toHaveBeenCalled();
    expect(runtime.entryPoint.listPieceExportsV3).not.toHaveBeenCalled();
    expect(runtime.pieceExports.copy).not.toHaveBeenCalled();
  });

  it('copies exactly one new managed artifact and reveals only a Main-resolved path', async () => {
    const runtime = makeRuntime();
    runtime.pieceExports.describe.mockResolvedValue({
      suggestedName: 'piece-night_light-export',
    });
    runtime.entryPoint.listPieceExportsV3.mockResolvedValue({ revision: 3, artifacts: [] });
    runtime.entryPoint.exportPieceV3.mockResolvedValue({
      status: 'exported',
      catalog: {
        revision: 4,
        artifacts: [
          {
            id: 'export_1',
            pieceId: 'piece_1',
            sourceRevision: 7,
            handleAtExport: 'night_light',
            byteSize: 123,
            payloadFileCount: 2,
            createdAt: '2026-09-01T00:00:00.000Z',
            folderName: 'piece-export_1',
            destinationPath: '/must/not/cross',
          },
        ],
        managedRoot: '/must/not/cross',
      },
    });
    runtime.pieceExports.copy.mockResolvedValue({ status: 'copied' });
    runtime.pieceExports.resolveRevealPath.mockResolvedValue('/private/managed/piece-export_1');
    const chooseExportDestination = vi.fn(async () => '/Users/test/Desktop/night-light');
    const revealExportPath = vi.fn();
    initCreativeStudioPilotBridgeV3({
      isFeatureEnabled: () => true,
      getRuntime: () => runtime as never,
      getParentWindow: () => undefined,
      chooseExportDestination,
      revealExportPath,
    });
    const input = {
      projectId: 'project_1',
      pieceId: 'piece_1',
      expectedRevision: 7,
    };

    const delivered = await mocks.handlers.get('exportPiece')?.(input);
    expect(delivered).toEqual({
      ok: true,
      data: {
        status: 'copied',
        artifact: {
          id: 'export_1',
          pieceId: 'piece_1',
          sourceRevision: 7,
          handleAtExport: 'night_light',
          byteSize: 123,
          payloadFileCount: 2,
          createdAt: '2026-09-01T00:00:00.000Z',
          folderName: 'piece-export_1',
        },
        catalog: {
          revision: 4,
          artifacts: [
            {
              id: 'export_1',
              pieceId: 'piece_1',
              sourceRevision: 7,
              handleAtExport: 'night_light',
              byteSize: 123,
              payloadFileCount: 2,
              createdAt: '2026-09-01T00:00:00.000Z',
              folderName: 'piece-export_1',
            },
          ],
        },
      },
    });
    expect(JSON.stringify(delivered)).not.toContain('/must/not/cross');
    expect(runtime.entryPoint.exportPieceV3).toHaveBeenCalledWith({
      ...input,
      expectedCatalogRevision: 3,
    });
    expect(chooseExportDestination.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.entryPoint.listPieceExportsV3.mock.invocationCallOrder[0]!
    );
    expect(runtime.entryPoint.listPieceExportsV3.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.entryPoint.exportPieceV3.mock.invocationCallOrder[0]!
    );
    expect(runtime.entryPoint.exportPieceV3.mock.invocationCallOrder[0]).toBeLessThan(
      runtime.pieceExports.copy.mock.invocationCallOrder[0]!
    );
    expect(runtime.pieceExports.copy).toHaveBeenCalledWith(
      { projectId: 'project_1', expectedCatalogRevision: 4, artifactId: 'export_1' },
      '/Users/test/Desktop/night-light'
    );

    await expect(
      mocks.handlers.get('revealPieceExport')?.({
        projectId: 'project_1',
        expectedCatalogRevision: 4,
        artifactId: 'export_1',
      })
    ).resolves.toEqual({ ok: true, data: { status: 'revealed' } });
    expect(revealExportPath).toHaveBeenCalledWith('/private/managed/piece-export_1');
  });

  it('fails closed when the managed exporter does not append exactly one matching artifact', async () => {
    const runtime = makeRuntime();
    runtime.pieceExports.describe.mockResolvedValue({ suggestedName: 'piece-night_light-export' });
    runtime.entryPoint.listPieceExportsV3.mockResolvedValue({ revision: 3, artifacts: [] });
    runtime.entryPoint.exportPieceV3.mockResolvedValue({
      status: 'exported',
      catalog: { revision: 4, artifacts: [] },
    });
    initCreativeStudioPilotBridgeV3({
      isFeatureEnabled: () => true,
      getRuntime: () => runtime as never,
      getParentWindow: () => undefined,
      chooseExportDestination: async () => '/Users/test/Desktop/night-light',
    });

    await expect(
      mocks.handlers.get('exportPiece')?.({ projectId: 'project_1', pieceId: 'piece_1', expectedRevision: 7 })
    ).resolves.toMatchObject({ ok: false, error: { code: 'storage_error' } });
    expect(runtime.pieceExports.copy).not.toHaveBeenCalled();
  });

  it('preserves the bounded Pilot error code and removes internal details', async () => {
    const entryPoint = makeEntryPoint();
    entryPoint.loadProjectV3.mockRejectedValue(
      Object.assign(new CreativeStudioPilotServiceErrorV3('project_quarantined'), { path: '/private/project.json' })
    );
    initCreativeStudioPilotBridgeV3({ isFeatureEnabled: () => true, getRuntime: () => ({ entryPoint }) as never });

    await expect(mocks.handlers.get('loadProject')?.({ projectId: 'project_1' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'project_quarantined',
        messageKey: 'conversation.creativeStudio.pilot.common.actionFailed',
      },
    });
  });

  it('sanitizes unexpected failures and refuses all calls while disabled', async () => {
    const entryPoint = makeEntryPoint();
    entryPoint.loadProjectV3.mockRejectedValue(new Error('provider body and local path'));
    const getRuntime = vi.fn(() => ({ entryPoint }) as never);
    initCreativeStudioPilotBridgeV3({ isFeatureEnabled: () => true, getRuntime });
    await expect(mocks.handlers.get('loadProject')?.({ projectId: 'project_1' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'storage_error' },
    });

    mocks.handlers.clear();
    getRuntime.mockClear();
    initCreativeStudioPilotBridgeV3({ isFeatureEnabled: () => false, getRuntime });
    await expect(mocks.handlers.get('listProjects')?.(undefined)).resolves.toMatchObject({
      ok: false,
      error: { code: 'runtime_inactive' },
    });
    expect(getRuntime).not.toHaveBeenCalled();
  });

  it('logs an unexpected Main failure before returning its sanitized envelope', async () => {
    const failure = new Error('provider body and local path');
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const entryPoint = makeEntryPoint();
    entryPoint.loadProjectV3.mockRejectedValue(failure);
    initCreativeStudioPilotBridgeV3({ isFeatureEnabled: () => true, getRuntime: () => ({ entryPoint }) as never });

    await mocks.handlers.get('loadProject')?.({ projectId: 'project_1' });

    expect(errorLog).toHaveBeenCalledWith('[CreativeStudioPilotBridge] command failed:', failure);
    errorLog.mockRestore();
  });
});
