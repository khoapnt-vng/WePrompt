import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const invoke = () => vi.fn(async (input?: unknown) => ({ ok: true as const, data: input ?? 'none' }));
  return {
    bridge: {
      listProjects: { invoke: invoke() },
      createProject: { invoke: invoke() },
      loadProject: { invoke: invoke() },
      preparePhoto: { invoke: invoke() },
      confirmPreparedPhoto: { invoke: invoke() },
      discardPreparedPhoto: { invoke: invoke() },
      importPhoto: { invoke: invoke() },
      applyMutationBatch: { invoke: invoke() },
      cancelJob: { invoke: invoke() },
      resumeJob: { invoke: invoke() },
      retryDownload: { invoke: invoke() },
      listPieceExports: { invoke: invoke() },
      exportPiece: { invoke: invoke() },
      revealPieceExport: { invoke: invoke() },
      deleteProject: { invoke: invoke() },
      projectUpdated: { on: vi.fn(() => vi.fn()) },
    },
  };
});

vi.mock('@/common', () => ({ ipcBridge: { creativeStudioPilot: mocks.bridge } }));

import { studioPilotClientV3 } from '@/renderer/pages/studio/StudioPage/pilotClient';

describe('Studio Pilot renderer client', () => {
  beforeEach(() => vi.clearAllMocks());

  it('maps every typed renderer operation to the exact Pilot provider', async () => {
    const inputs = {
      project: { projectId: 'project_1' },
      create: { name: 'Light', brief: 'Water' },
      prepare: {
        mode: 'create' as const,
        projectId: 'project_1',
        expectedAuthoringRevision: 1,
        words: 'Light on water',
        settings: { aspectRatio: '16:9' as const, resolution: '720p' as const },
        suggestedHandle: null,
      },
      confirm: {
        reservationId: 'reservation_1',
        quoteId: 'quote_1',
        quoteRevision: 1,
        explicitHumanConfirmation: true,
        duplicateChargeAcknowledged: false,
      },
    };

    await studioPilotClientV3.listProjectsV3();
    await studioPilotClientV3.createProjectV3(inputs.create);
    await studioPilotClientV3.loadProjectV3('project_1');
    await studioPilotClientV3.preparePhotoV3(inputs.prepare);
    await studioPilotClientV3.confirmPreparedPhotoV3(inputs.confirm);
    await studioPilotClientV3.discardPreparedPhotoV3(inputs.confirm);
    await studioPilotClientV3.importPhotoV3({ projectId: 'project_1', expectedAuthoringRevision: 1 });
    await studioPilotClientV3.applyMutationBatchV3({
      schemaVersion: 6,
      projectId: 'project_1',
      expectedAuthoringRevision: 1,
      operations: [{ kind: 'set_brief', brief: 'New brief' }],
    });
    await studioPilotClientV3.cancelJobV3({ projectId: 'project_1', pieceId: 'piece_1', jobId: 'job_1' });
    await studioPilotClientV3.resumeJobV3({
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      expectedRevision: 2,
    });
    await studioPilotClientV3.retryDownloadV3({
      projectId: 'project_1',
      pieceId: 'piece_1',
      jobId: 'job_1',
      expectedRevision: 2,
    });
    await studioPilotClientV3.listPieceExportsV3('project_1');
    await studioPilotClientV3.exportPieceV3({
      projectId: 'project_1',
      pieceId: 'piece_1',
      expectedRevision: 2,
    });
    const reveal = { projectId: 'project_1', expectedCatalogRevision: 2, artifactId: 'export_1' };
    await studioPilotClientV3.revealPieceExportV3(reveal);
    await studioPilotClientV3.deleteProjectV3({ mode: 'healthy', projectId: 'project_1', expectedRevision: 2 });

    expect(mocks.bridge.listProjects.invoke).toHaveBeenCalledWith();
    expect(mocks.bridge.createProject.invoke).toHaveBeenCalledWith(inputs.create);
    expect(mocks.bridge.loadProject.invoke).toHaveBeenCalledWith(inputs.project);
    expect(mocks.bridge.preparePhoto.invoke).toHaveBeenCalledWith(inputs.prepare);
    expect(mocks.bridge.confirmPreparedPhoto.invoke).toHaveBeenCalledWith(inputs.confirm);
    expect(mocks.bridge.discardPreparedPhoto.invoke).toHaveBeenCalledWith(inputs.confirm);
    expect(mocks.bridge.listPieceExports.invoke).toHaveBeenCalledWith(inputs.project);
    expect(mocks.bridge.revealPieceExport.invoke).toHaveBeenCalledWith(reveal);
    expect(mocks.bridge.deleteProject.invoke).toHaveBeenCalledOnce();
  });

  it('throws only the bounded bridge error and forwards update subscription disposal', async () => {
    mocks.bridge.loadProject.invoke.mockResolvedValueOnce({
      ok: false,
      error: { code: 'project_quarantined', messageKey: 'pilot.failure' },
    });
    await expect(studioPilotClientV3.loadProjectV3('project_1')).rejects.toEqual({
      code: 'project_quarantined',
      messageKey: 'pilot.failure',
    });

    const listener = vi.fn();
    const dispose = studioPilotClientV3.watchProjectUpdatesV3(listener);
    expect(mocks.bridge.projectUpdated.on).toHaveBeenCalledWith(listener);
    expect(dispose).toEqual(expect.any(Function));
  });
});
