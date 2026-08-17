/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  StudioAsset,
  StudioDirectorCommandReceiptV1,
  StudioDirectorCommandRecordV1,
  StudioScene,
} from '@/common/types/project/creativeStudioTypes';
import type { GenerationProviderAdapter } from '@process/services/creative-studio/adapters';
import type { StudioDirectorCommandMailbox } from '@process/services/creative-studio/service/directorCommandMailbox';
import {
  createStudioDirectorCommandProcessor,
  createStudioDirectorCommitTracker,
} from '@process/services/creative-studio/service/directorCommandProcessor';
import { createStudioDirectorCommandService } from '@process/services/creative-studio/service/directorCommandService';
import { createCreativeStudioStore } from '@process/services/creative-studio/store';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const scene = (id: string): StudioScene => ({
  id,
  title: `Scene ${id}`,
  purpose: 'Advance the story',
  visualPrompt: `Prompt ${id}`,
  narration: '',
  onScreenText: '',
  mediaKind: 'image',
  durationSeconds: 5,
  referenceAssetId: null,
  selectedAssetId: null,
  assetIds: [],
  jobIds: [],
  reviewState: 'ready',
});

const take = (projectId: string): StudioAsset => ({
  id: 'take_1',
  projectId,
  sceneId: 'scene_1',
  mediaKind: 'image',
  mimeType: 'image/png',
  managedAsset: { collection: 'assets', fileName: 'take_1.png' },
  byteSize: 1,
  sha256: 'a'.repeat(64),
  durationSeconds: 5,
  createdAt: '2026-08-17T00:00:00.000Z',
});

const waitForReceipt = async (
  receipts: Map<string, StudioDirectorCommandReceiptV1>,
  commandId: string
): Promise<StudioDirectorCommandReceiptV1> => {
  const startedAt = performance.now();
  while (performance.now() - startedAt < 5_000) {
    const receipt = receipts.get(commandId);
    if (receipt !== undefined) return receipt;
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for receipt ${commandId}`);
};

describe('Studio Director dynamic spend fence', () => {
  it('applies all five free operations without reaching submit, retry, job, resolver, or adapter boundaries', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-director-spend-fence-'));
    roots.push(rootDir);
    const tracker = createStudioDirectorCommitTracker();
    const store = createCreativeStudioStore({ rootDir, onProjectCommitted: tracker.observe });
    const created = await store.createProject({
      name: 'Spend fence',
      brief: 'Original brief',
      aspectRatio: '16:9',
      targetDurationSeconds: 10,
      resolution: '720p',
    });
    const project = await store.updateProject(created.id, (current) => ({
      ...current,
      sceneOrder: ['scene_1', 'scene_2'],
      scenes: {
        scene_1: { ...scene('scene_1'), assetIds: ['take_1'] },
        scene_2: scene('scene_2'),
      },
      assets: { take_1: take(current.id) },
    }));

    const serviceSubmitScenes = vi.fn(async () => {
      throw new Error('ordinary service submit must stay unreachable');
    });
    const serviceRetryJob = vi.fn(async () => {
      throw new Error('ordinary service retry must stay unreachable');
    });
    const serviceSubmitClips = vi.fn(async () => {
      throw new Error('V2 service submit must stay unreachable');
    });
    const serviceRetryDownload = vi.fn(async () => {
      throw new Error('V2 service retry-download must stay unreachable');
    });
    const serviceCancelJob = vi.fn(async () => {
      throw new Error('V2 service cancel must stay unreachable');
    });
    const serviceRender = vi.fn(async () => {
      throw new Error('service render must stay unreachable');
    });
    const jobSubmit = vi.fn(async () => {
      throw new Error('job manager submit must stay unreachable');
    });
    const jobRetry = vi.fn(async () => {
      throw new Error('job manager retry must stay unreachable');
    });
    const jobSubmitClips = vi.fn(async () => {
      throw new Error('V2 job manager submit must stay unreachable');
    });
    const jobRetryV2 = vi.fn(async () => {
      throw new Error('V2 job manager retry must stay unreachable');
    });
    const jobRetryDownloadV2 = vi.fn(async () => {
      throw new Error('V2 job manager retry-download must stay unreachable');
    });
    const jobCancelV2 = vi.fn(async () => {
      throw new Error('V2 job manager cancel must stay unreachable');
    });
    const renderCutV2 = vi.fn(async () => {
      throw new Error('V2 render runner must stay unreachable');
    });
    const listConnectionCandidates = vi.fn(async () => {
      throw new Error('provider candidates must stay unreachable');
    });
    const listGenerationRoutes = vi.fn(async () => {
      throw new Error('provider resolver must stay unreachable');
    });
    const isGenerationRouteAvailable = vi.fn(async () => {
      throw new Error('provider availability must stay unreachable');
    });
    const adapterValidateConnection = vi.fn(async () => {
      throw new Error('adapter connection validation must stay unreachable');
    });
    const adapterValidateRequest = vi.fn(() => {
      throw new Error('adapter request validation must stay unreachable');
    });
    const adapterSubmit = vi.fn(async () => {
      throw new Error('adapter submit must stay unreachable');
    });
    const adapterPoll = vi.fn(async () => {
      throw new Error('adapter poll must stay unreachable');
    });
    const adapterCancel = vi.fn(async () => {
      throw new Error('adapter cancel must stay unreachable');
    });
    const adapter: GenerationProviderAdapter = {
      id: 'weprompt-image-v1',
      validateConnection: adapterValidateConnection,
      validateRequest: adapterValidateRequest,
      submit: adapterSubmit,
      poll: adapterPoll,
      cancel: adapterCancel,
    };

    const pending = new Map<string, StudioDirectorCommandRecordV1>();
    const receipts = new Map<string, StudioDirectorCommandReceiptV1>();
    const mailbox: StudioDirectorCommandMailbox = {
      ensure: async () => undefined,
      snapshotPendingPage: async () => ({ items: [], nextCursor: null }),
      readPending: async (_projectId, commandId) => {
        const record = pending.get(commandId);
        return record === undefined ? null : { status: 'valid', record };
      },
      readReceipt: async (_projectId, commandId) => receipts.get(commandId) ?? null,
      writeReceipt: async (_projectId, receipt) => {
        if (receipts.has(receipt.commandId)) throw new Error('receipt replacement');
        receipts.set(receipt.commandId, structuredClone(receipt));
      },
      finish: async (_projectId, commandId) => {
        pending.delete(commandId);
      },
      listPendingPage: async () => ({ items: [], nextCursor: null }),
      releaseOrphanedSlotsPage: async () => ({ processed: 0, nextCursor: null }),
      pruneReceiptsPage: async () => ({ processed: 0, nextCursor: null }),
      watch: async () => () => undefined,
      dispose: async () => undefined,
    };
    const directorService = createStudioDirectorCommandService({ store });
    const processorService = Object.assign(directorService, {
      submitScenes: serviceSubmitScenes,
      retryJob: serviceRetryJob,
      submitClips: serviceSubmitClips,
      retryDownload: serviceRetryDownload,
      cancelJob: serviceCancelJob,
      renderCut: serviceRender,
      jobManager: {
        submitScenes: jobSubmit,
        retryJob: jobRetry,
        submitClips: jobSubmitClips,
        retryJobV2: jobRetryV2,
        retryDownloadV2: jobRetryDownloadV2,
        cancelJobV2: jobCancelV2,
      },
      renderRunner: { renderCutV2 },
      providerResolver: { listConnectionCandidates, listGenerationRoutes, isGenerationRouteAvailable },
      adapterRegistry: new Map([[adapter.id, adapter]]),
    });
    const processor = createStudioDirectorCommandProcessor({
      store,
      mailbox,
      service: processorService,
      tracker,
      onProjectUpdated: vi.fn(),
      setInterval: () => Symbol('interval'),
      clearInterval: () => undefined,
    });
    await processor.start();

    const publish = async (
      commandId: string,
      operations: StudioDirectorCommandRecordV1['operations']
    ): Promise<StudioDirectorCommandReceiptV1> => {
      const canonical = await store.getProject(project.id);
      if (canonical === null) throw new Error('project disappeared');
      const createdAtMs = Date.now();
      const command: StudioDirectorCommandRecordV1 = {
        schemaVersion: 1,
        commandId,
        projectId: canonical.id,
        expectedRevision: canonical.revision,
        createdAt: new Date(createdAtMs).toISOString(),
        deadlineAt: new Date(createdAtMs + 15_000).toISOString(),
        policy: 'auto_apply',
        operations,
      };
      pending.set(commandId, command);
      processor.trigger(canonical.id, commandId);
      return waitForReceipt(receipts, commandId);
    };

    await expect(
      publish('command_add', [
        {
          kind: 'add_scene',
          sceneId: 'scene_3',
          beforeSceneId: null,
          scene: {
            title: 'Scene 3',
            purpose: 'Complete the arc',
            visualPrompt: 'Prompt scene_3',
            narration: '',
            onScreenText: '',
            mediaKind: 'image',
            durationSeconds: 5,
          },
        },
      ])
    ).resolves.toMatchObject({ status: 'applied' });
    await expect(
      publish('command_other_four', [
        { kind: 'set_brief', brief: 'Director brief' },
        { kind: 'edit_scene', sceneId: 'scene_2', changes: { visualPrompt: 'Director scene edit' } },
        { kind: 'reorder_scenes', sceneOrder: ['scene_3', 'scene_2', 'scene_1'] },
        { kind: 'select_take', sceneId: 'scene_1', assetId: 'take_1' },
      ])
    ).resolves.toMatchObject({ status: 'applied' });

    const after = await store.getProject(project.id);
    expect(after).toMatchObject({
      brief: 'Director brief',
      sceneOrder: ['scene_3', 'scene_2', 'scene_1'],
      scenes: {
        scene_1: { selectedAssetId: 'take_1' },
        scene_2: { visualPrompt: 'Director scene edit' },
      },
    });
    expect(serviceSubmitScenes).not.toHaveBeenCalled();
    expect(serviceRetryJob).not.toHaveBeenCalled();
    expect(serviceSubmitClips).not.toHaveBeenCalled();
    expect(serviceRetryDownload).not.toHaveBeenCalled();
    expect(serviceCancelJob).not.toHaveBeenCalled();
    expect(serviceRender).not.toHaveBeenCalled();
    expect(jobSubmit).not.toHaveBeenCalled();
    expect(jobRetry).not.toHaveBeenCalled();
    expect(jobSubmitClips).not.toHaveBeenCalled();
    expect(jobRetryV2).not.toHaveBeenCalled();
    expect(jobRetryDownloadV2).not.toHaveBeenCalled();
    expect(jobCancelV2).not.toHaveBeenCalled();
    expect(renderCutV2).not.toHaveBeenCalled();
    expect(listConnectionCandidates).not.toHaveBeenCalled();
    expect(listGenerationRoutes).not.toHaveBeenCalled();
    expect(isGenerationRouteAvailable).not.toHaveBeenCalled();
    expect(adapterValidateConnection).not.toHaveBeenCalled();
    expect(adapterValidateRequest).not.toHaveBeenCalled();
    expect(adapterSubmit).not.toHaveBeenCalled();
    expect(adapterPoll).not.toHaveBeenCalled();
    expect(adapterCancel).not.toHaveBeenCalled();

    await processor.stop();
  });
});
