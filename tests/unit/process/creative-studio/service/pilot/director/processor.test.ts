/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  type StudioPilotDirectorCommand,
} from '@process/services/creative-studio/service/pilot/director/contracts';
import {
  createStudioPilotDirectorMailbox,
  StudioPilotDirectorMailboxError,
} from '@process/services/creative-studio/service/pilot/director/mailbox';
import { createStudioPilotDirectorProcessor } from '@process/services/creative-studio/service/pilot/director/processor';
import { CreativeStudioPilotServiceErrorV3 } from '@process/services/creative-studio/service/pilot/errors';
import type { CreativeStudioPilotEntryPointV3 } from '@process/services/creative-studio/service/pilot/entryPoint';
import type {
  StudioApplyMutationBatchResultV3,
  StudioPreparePhotoResultV3,
  StudioProjectLoadResultV3,
} from '@/common/types/project/creativeStudioTypes';

const BASE_TIME = Date.parse('2026-09-01T00:00:00.000Z');

const common = (policy: StudioPilotDirectorCommand['policy']) => ({
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId: `command_${policy}`,
  projectId: 'project_1',
  createdAt: new Date(BASE_TIME).toISOString(),
  deadlineAt: new Date(BASE_TIME + 60_000).toISOString(),
  policy,
});

const prepareCommand = (): StudioPilotDirectorCommand => ({
  ...common('prepare_photo'),
  policy: 'prepare_photo',
  expectedAuthoringRevision: 7,
  words: 'Neon reflected in wet pavement',
  settings: { aspectRatio: '16:9', resolution: '1080p' },
  suggestedHandle: 'night_reflection',
  referencePieceIds: ['piece_reference'],
});

const renameCommand = (): StudioPilotDirectorCommand => ({
  ...common('rename_piece'),
  policy: 'rename_piece',
  expectedAuthoringRevision: 7,
  pieceId: 'piece_1',
  handle: 'شب_بارانی',
});

const supportedLoad = {
  status: 'supported',
  summary: {},
  canvas: {},
  director: {},
  activity: {},
  spendPolicy: null,
  lastUndo: null,
} as StudioProjectLoadResultV3;

const prepared = {
  status: 'prepared',
  quote: { reservationId: 'reservation_1', quoteId: 'quote_1' },
} as StudioPreparePhotoResultV3;

const renamed: StudioApplyMutationBatchResultV3 = {
  projectId: 'project_1',
  revision: 19,
  authoringRevision: 8,
  undoEntryId: 'mutation_1',
};

describe('Pilot Director command processor', () => {
  let root: string;
  let projectDirectory: string;
  let now: number;

  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'studio-pilot-processor-')));
    projectDirectory = path.join(root, 'project_1');
    await fs.mkdir(projectDirectory);
    now = BASE_TIME;
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const harness = () => {
    let temporary = 0;
    const mailbox = createStudioPilotDirectorMailbox({
      resolveVerifiedProjectDirectory: async (projectId) => (projectId === 'project_1' ? projectDirectory : null),
      now: () => now,
      createTemporaryId: () => `temporary_${++temporary}`,
    });
    const entryPoint: Pick<
      CreativeStudioPilotEntryPointV3,
      'loadProjectV3' | 'preparePhotoV3' | 'applyMutationBatchV3'
    > = {
      loadProjectV3: vi.fn(async () => supportedLoad),
      preparePhotoV3: vi.fn(async () => prepared),
      applyMutationBatchV3: vi.fn(async () => renamed),
    };
    const processor = createStudioPilotDirectorProcessor({
      mailbox,
      entryPoint,
      processorId: 'processor_current',
      now: () => now,
    });
    return { mailbox, entryPoint, processor };
  };

  it('records a supported project load without inventing a command-status policy', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command: StudioPilotDirectorCommand = { ...common('get_project_status'), policy: 'get_project_status' };
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      policy: 'get_project_status',
      status: 'succeeded',
      result: { status: 'supported' },
    });
    expect(entryPoint.loadProjectV3).toHaveBeenCalledWith(command.projectId);
    await expect(processor.readCommandStatus(command.projectId, command.commandId)).resolves.toMatchObject({
      status: 'terminal',
    });
  });

  it('returns no work when the project has no pending record or a different command is requested', async () => {
    const { mailbox, entryPoint, processor } = harness();
    await expect(processor.processProject('project_1')).resolves.toBeNull();
    const command = prepareCommand();
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId, 'different_command')).resolves.toBeNull();
    expect(entryPoint.preparePhotoV3).not.toHaveBeenCalled();
  });

  it('passes Director preparation through the shared Pilot prepare operation exactly', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command = prepareCommand();
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      policy: 'prepare_photo',
      status: 'succeeded',
    });
    expect(entryPoint.preparePhotoV3).toHaveBeenCalledWith({
      mode: 'create',
      projectId: command.projectId,
      expectedAuthoringRevision: 7,
      words: command.words,
      settings: command.settings,
      suggestedHandle: command.suggestedHandle,
      referencePieceIds: command.referencePieceIds,
    });
  });

  it('builds only the exact mutation batch 6 for rename and ignores runtime-only revision movement', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command = renameCommand();
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'succeeded',
      result: { revision: 19, authoringRevision: 8 },
    });
    expect(entryPoint.applyMutationBatchV3).toHaveBeenCalledWith({
      schemaVersion: 6,
      projectId: command.projectId,
      expectedAuthoringRevision: 7,
      operations: [{ kind: 'rename_piece', pieceId: command.pieceId, handle: command.handle }],
    });
  });

  it('lets the entrypoint reject stale authoring authority', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command = renameCommand();
    vi.mocked(entryPoint.applyMutationBatchV3).mockRejectedValueOnce(
      new CreativeStudioPilotServiceErrorV3('stale_authoring')
    );
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'rejected',
      reasonCode: 'stale_authoring',
    });
  });

  it.each([
    ['busy', new StudioPilotDirectorMailboxError('busy')],
    ['storage_error', new Error('provider detail must not escape')],
  ] as const)('neutralizes an operation failure to %s', async (reasonCode, failure) => {
    const { mailbox, entryPoint } = harness();
    const command = prepareCommand();
    vi.mocked(entryPoint.preparePhotoV3).mockRejectedValueOnce(failure);
    const processor = createStudioPilotDirectorProcessor({
      mailbox,
      entryPoint,
      processorId: 'processor_failure',
      now: () => now,
      logError: () => {
        throw new Error('diagnostics failed');
      },
    });
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'rejected',
      reasonCode,
    });
  });

  it('expires an unclaimed command without calling the Pilot entrypoint', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command = prepareCommand();
    await mailbox.submit(command);
    now = BASE_TIME + 60_001;

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'expired',
      reasonCode: 'deadline_elapsed',
    });
    expect(entryPoint.preparePhotoV3).not.toHaveBeenCalled();
  });

  it.each([
    ['prepare_photo', prepareCommand()],
    ['rename_piece', renameCommand()],
  ] as const)('terminalizes an ambiguous pre-restart %s without replay', async (_policy, command) => {
    const { mailbox, entryPoint, processor } = harness();
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'indeterminate',
      reasonCode: 'indeterminate_after_restart',
    });
    expect(entryPoint.preparePhotoV3).not.toHaveBeenCalled();
    expect(entryPoint.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('safely replays only a read after restart', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command: StudioPilotDirectorCommand = { ...common('get_project_status'), policy: 'get_project_status' };
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({ status: 'succeeded' });
    expect(entryPoint.loadProjectV3).toHaveBeenCalledTimes(1);
  });

  it('finishes a durable receipt left before cleanup without invoking the entrypoint again', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command = renameCommand();
    await mailbox.submit(command);
    await mailbox.writeReceipt(command, {
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: 'rename_piece',
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: new Date(BASE_TIME + 1_000).toISOString(),
      status: 'succeeded',
      result: renamed,
    });

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({ status: 'succeeded' });
    expect(entryPoint.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('rejects unsafe routing identities and processor identities', async () => {
    const { mailbox, entryPoint, processor } = harness();
    await expect(processor.processProject('../project')).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(processor.processProject('project_1', '../command')).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(() =>
      createStudioPilotDirectorProcessor({ mailbox, entryPoint, processorId: '../processor', now: () => now })
    ).toThrow(expect.objectContaining({ code: 'invalid_payload' }));
  });

  it('fails closed on a malformed durable pending record', async () => {
    const { mailbox, processor } = harness();
    const command = prepareCommand();
    await mailbox.submit(command);
    const pendingFile = path.join(projectDirectory, '.director-v11', 'pending', 'command.json');
    await fs.rm(pendingFile);
    await fs.writeFile(pendingFile, '{');

    await expect(processor.processProject(command.projectId)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('fails closed when the processor clock becomes invalid', async () => {
    const { mailbox, entryPoint } = harness();
    const command = prepareCommand();
    await mailbox.submit(command);
    const processor = createStudioPilotDirectorProcessor({
      mailbox,
      entryPoint,
      processorId: 'processor_bad_clock',
      now: () => Number.NaN,
    });

    await expect(processor.processProject(command.projectId)).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('uses the injected shared entrypoint object as the operation receiver', async () => {
    const { mailbox } = harness();
    const receivers: unknown[] = [];
    const entryPoint = {
      async loadProjectV3(this: unknown) {
        receivers.push(this);
        return supportedLoad;
      },
      async preparePhotoV3(this: unknown) {
        receivers.push(this);
        return prepared;
      },
      async applyMutationBatchV3(this: unknown) {
        receivers.push(this);
        return renamed;
      },
    } satisfies Pick<CreativeStudioPilotEntryPointV3, 'loadProjectV3' | 'preparePhotoV3' | 'applyMutationBatchV3'>;
    const processor = createStudioPilotDirectorProcessor({
      mailbox,
      entryPoint,
      processorId: 'processor_shared',
      now: () => now,
    });
    const command = prepareCommand();
    await mailbox.submit(command);

    await processor.processProject(command.projectId);
    expect(receivers).toEqual([entryPoint]);
  });
});
