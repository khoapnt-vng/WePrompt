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
  studioPilotDirectorProposeBoardCommandSha256,
  type StudioPilotDirectorCommand,
} from '@process/services/creative-studio/service/pilot/director/contracts';
import {
  createStudioPilotDirectorMailbox,
  StudioPilotDirectorMailboxError,
} from '@process/services/creative-studio/service/pilot/director/mailbox';
import {
  createStudioPilotDirectorProcessor,
  type StudioPilotDirectorProposalIdentityKindV4,
} from '@process/services/creative-studio/service/pilot/director/processor';
import { CreativeStudioPilotServiceErrorV3 } from '@process/services/creative-studio/service/pilot/errors';
import type { CreativeStudioPilotEntryPointV3 } from '@process/services/creative-studio/service/pilot/entryPoint';
import {
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  type StudioProposalRecordV4,
} from '@process/services/creative-studio/service/schema2/proposals/proposalContractsV4';
import type { CreativeStudioProposalSidecarsV4 } from '@process/services/creative-studio/store/pilot/proposalsV4';
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

const proposeBoardCommand = (): StudioPilotDirectorCommand => ({
  ...common('propose_board'),
  policy: 'propose_board',
  expectedAuthoringRevision: 7,
  handle: 'first_board',
  beats: [
    {
      title: 'Arrival',
      story: 'A traveller reaches the station.',
      targetSeconds: 10,
      shots: [{ shootingScript: 'Wide shot of the platform.', durationSeconds: 5 }],
    },
  ],
});

const boardProposal = (
  command: Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>,
  createdAt = new Date(BASE_TIME).toISOString()
): StudioProposalRecordV4 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
  id: deriveStudioProposalIdV4(command.projectId, command.commandId),
  projectId: command.projectId,
  status: 'pending',
  baseAuthoringRevision: command.expectedAuthoringRevision,
  source: {
    kind: 'director_command',
    commandId: command.commandId,
    commandSha256: studioPilotDirectorProposeBoardCommandSha256(command),
  },
  target: { kind: 'board', boardId: 'board_1' },
  issuedMemberIds: { beatIds: ['beat_1'], shotIds: ['shot_1'] },
  payload: { kind: 'create_board', handle: command.handle, beats: structuredClone(command.beats) },
  createdAt,
  expiresAt: deriveStudioProposalExpiresAtV4(createdAt),
  decidedAt: null,
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

  const harness = (
    options: {
      proposalAuthority?: Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>;
      mintProposalIdentity?: (kind: StudioPilotDirectorProposalIdentityKindV4) => string;
      processorNow?: () => number;
    } = {}
  ) => {
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
      proposalAuthority: options.proposalAuthority,
      mintProposalIdentity: options.mintProposalIdentity,
      processorId: 'processor_current',
      now: options.processorNow ?? (() => now),
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

  it('keeps Board proposals unavailable until the schema-7 authority is injected', async () => {
    const { mailbox, entryPoint, processor } = harness();
    const command = proposeBoardCommand();
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      policy: 'propose_board',
      status: 'rejected',
      reasonCode: 'operation_not_available',
    });
    expect(entryPoint.loadProjectV3).not.toHaveBeenCalled();
    expect(entryPoint.preparePhotoV3).not.toHaveBeenCalled();
    expect(entryPoint.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('mints Board identities once and records one exactly correlated proposal with one Main timestamp', async () => {
    const command = proposeBoardCommand() as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    const replayProposalV4 = vi.fn(async (input: unknown) => {
      const proposal = structuredClone((input as { proposal: StudioProposalRecordV4 }).proposal);
      return { outcome: 'admitted' as const, proposalId: proposal.id, proposal };
    });
    const getProposalStateV4 = vi.fn(async () => ({ status: 'unknown' as const }));
    const proposalAuthority = {
      replayProposalV4,
      getProposalStateV4,
    } satisfies Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>;
    const counts = { board: 0, beat: 0, shot: 0 };
    const mintProposalIdentity = vi.fn((kind: StudioPilotDirectorProposalIdentityKindV4) => {
      counts[kind] += 1;
      return `${kind}_${counts[kind]}`;
    });
    const processorNow = vi.fn(() => BASE_TIME);
    const { mailbox, entryPoint, processor } = harness({
      proposalAuthority,
      mintProposalIdentity,
      processorNow,
    });
    await mailbox.submit(command);

    const proposal = boardProposal(command);
    await expect(processor.processProject(command.projectId)).resolves.toEqual({
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: 'propose_board',
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: proposal.createdAt,
      status: 'succeeded',
      result: { status: 'recorded', proposal },
    });
    expect(replayProposalV4).toHaveBeenCalledWith({
      projectId: command.projectId,
      proposalId: proposal.id,
      proposal,
    });
    expect(getProposalStateV4).not.toHaveBeenCalled();
    expect(mintProposalIdentity.mock.calls.map(([kind]) => kind)).toEqual(['board', 'beat', 'shot']);
    expect(processorNow).toHaveBeenCalledTimes(1);
    expect(entryPoint.loadProjectV3).not.toHaveBeenCalled();
    expect(entryPoint.preparePhotoV3).not.toHaveBeenCalled();
    expect(entryPoint.applyMutationBatchV3).not.toHaveBeenCalled();
  });

  it('uses local proposal time while tolerating a bounded future-skew Director clock', async () => {
    const command = {
      ...proposeBoardCommand(),
      createdAt: new Date(BASE_TIME + 30_000).toISOString(),
    } as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    const replayProposalV4 = vi.fn(async (input: unknown) => {
      const proposal = structuredClone((input as { proposal: StudioProposalRecordV4 }).proposal);
      return { outcome: 'admitted' as const, proposalId: proposal.id, proposal };
    });
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4: vi.fn(async () => ({ status: 'unknown' as const })),
      },
      mintProposalIdentity: (kind) => `${kind}_future`,
    });
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      decidedAt: new Date(BASE_TIME).toISOString(),
      status: 'succeeded',
      result: {
        status: 'recorded',
        proposal: { createdAt: new Date(BASE_TIME).toISOString() },
      },
    });
    expect(replayProposalV4).toHaveBeenCalledWith(
      expect.objectContaining({
        proposal: expect.objectContaining({ createdAt: new Date(BASE_TIME).toISOString() }),
      })
    );
  });

  it.each([
    [{ outcome: 'busy' as const, holdingProposalId: 'proposal_other' }, 'proposal_pending'],
    [
      {
        outcome: 'identity_collision' as const,
        proposalId: deriveStudioProposalIdV4('project_1', 'command_propose_board'),
        expectedSha256: 'a'.repeat(64),
      },
      'identity_collision',
    ],
    [{ outcome: 'refused' as const, reason: 'handle_collision' as const }, 'handle_collision'],
  ])('maps a fresh proposal replay outcome distinctly', async (outcome, reasonCode) => {
    const command = proposeBoardCommand();
    const replayProposalV4 = vi.fn(async () => outcome);
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4: vi.fn(async () => ({ status: 'unknown' as const })),
      } as Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>,
    });
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      policy: 'propose_board',
      status: 'rejected',
      reasonCode,
    });
    expect(replayProposalV4).toHaveBeenCalledTimes(1);
  });

  it('propagates ambiguous proposal storage failures and resumes the durable mailbox without reminting', async () => {
    const command = proposeBoardCommand() as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    let durableProposal: StudioProposalRecordV4 | null = null;
    let firstAttempt = true;
    const replayProposalV4 = vi.fn(async (input: unknown) => {
      const proposal = structuredClone((input as { proposal: StudioProposalRecordV4 }).proposal);
      if (firstAttempt) {
        firstAttempt = false;
        durableProposal = proposal;
        throw new Error('ambiguous proposal storage outcome');
      }
      return {
        outcome: 'already_pending' as const,
        proposalId: proposal.id,
        proposal,
        admittedAt: proposal.createdAt,
      };
    });
    const getProposalStateV4 = vi.fn(async () =>
      durableProposal === null
        ? { status: 'unknown' as const }
        : {
            status: 'pending' as const,
            proposal: structuredClone(durableProposal),
            admittedAt: durableProposal.createdAt,
          }
    );
    const counts = { board: 0, beat: 0, shot: 0 };
    const mintProposalIdentity = vi.fn((kind: StudioPilotDirectorProposalIdentityKindV4) => {
      counts[kind] += 1;
      return `${kind}_${counts[kind]}`;
    });
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4,
      } as Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>,
      mintProposalIdentity,
    });
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).rejects.toThrow('ambiguous proposal storage outcome');
    await expect(mailbox.readPending(command.projectId)).resolves.toMatchObject({
      status: 'valid',
      command: { commandId: command.commandId },
    });
    await expect(mailbox.readReceipt(command.projectId, command.commandId)).resolves.toBeNull();

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'succeeded',
      result: { status: 'recorded', proposal: { id: deriveStudioProposalIdV4(command.projectId, command.commandId) } },
    });
    expect(getProposalStateV4).toHaveBeenCalledTimes(1);
    expect(replayProposalV4).toHaveBeenCalledTimes(2);
    expect(mintProposalIdentity.mock.calls.map(([kind]) => kind)).toEqual(['board', 'beat', 'shot']);
  });

  it('keeps an unavailable proposal replay pending instead of publishing a false rejection', async () => {
    const command = proposeBoardCommand();
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4: vi.fn(async () => ({ outcome: 'unavailable' as const, reason: 'corrupt_storage' as const })),
        getProposalStateV4: vi.fn(async () => ({ status: 'unknown' as const })),
      } as Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>,
    });
    await mailbox.submit(command);

    await expect(processor.processProject(command.projectId)).rejects.toMatchObject({ code: 'storage_error' });
    await expect(mailbox.readPending(command.projectId)).resolves.toMatchObject({
      status: 'valid',
      command: { commandId: command.commandId },
    });
    await expect(mailbox.readReceipt(command.projectId, command.commandId)).resolves.toBeNull();
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

  it('reconstructs the exact recorded Board receipt after restart without reminting or rerecording', async () => {
    const command = proposeBoardCommand() as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    const proposal = boardProposal(command, new Date(BASE_TIME + 1_000).toISOString());
    const replayProposalV4 = vi.fn(async () => ({
      outcome: 'already_pending' as const,
      proposalId: proposal.id,
      proposal: structuredClone(proposal),
      admittedAt: proposal.createdAt,
    }));
    const getProposalStateV4 = vi.fn(async () => ({
      status: 'pending' as const,
      proposal: structuredClone(proposal),
      admittedAt: proposal.createdAt,
    }));
    const mintProposalIdentity = vi.fn(() => {
      throw new Error('must not mint during replay');
    });
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4,
      } as Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>,
      mintProposalIdentity,
    });
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).resolves.toEqual({
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: 'propose_board',
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: proposal.createdAt,
      status: 'succeeded',
      result: { status: 'recorded', proposal },
    });
    expect(getProposalStateV4).toHaveBeenCalledWith(command.projectId, proposal.id);
    expect(replayProposalV4).toHaveBeenCalledWith({
      projectId: command.projectId,
      proposalId: proposal.id,
      proposal,
    });
    expect(mintProposalIdentity).not.toHaveBeenCalled();
  });

  it.each([
    ['accepted', 12],
    ['rejected', null],
    ['expired', null],
  ] as const)('replays the actual terminal %s Board decision after restart', async (status, appliedRevision) => {
    const command = proposeBoardCommand() as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    const proposal = boardProposal(command, new Date(BASE_TIME + 1_000).toISOString());
    const decidedAt = new Date(BASE_TIME + 2_000).toISOString();
    const replayProposalV4 = vi.fn(async () => ({
      outcome: 'already_decided' as const,
      proposalId: proposal.id,
      status,
      decidedAt,
      appliedRevision,
    }));
    const mintProposalIdentity = vi.fn();
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4: vi.fn(async () => ({
          status: 'pending' as const,
          proposal: structuredClone(proposal),
          admittedAt: proposal.createdAt,
        })),
      },
      mintProposalIdentity,
    });
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).resolves.toEqual({
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: 'propose_board',
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt,
      status: 'succeeded',
      result: { status, proposalId: proposal.id, decidedAt, appliedRevision },
    });
    expect(replayProposalV4).toHaveBeenCalledWith({
      projectId: command.projectId,
      proposalId: proposal.id,
      proposal,
    });
    expect(mintProposalIdentity).not.toHaveBeenCalled();
  });

  it('rejects a resumed terminal tombstone bound to different command bytes', async () => {
    const command = proposeBoardCommand() as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    const proposalId = deriveStudioProposalIdV4(command.projectId, command.commandId);
    const replayProposalV4 = vi.fn();
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4: vi.fn(async () => ({
          status: 'rejected' as const,
          proposalId,
          decidedAt: new Date(BASE_TIME + 1_000).toISOString(),
          payloadSha256: 'a'.repeat(64),
          commandSha256: 'b'.repeat(64),
          appliedRevision: null,
          payloadRetained: false,
        })),
      },
    });
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      status: 'rejected',
      reasonCode: 'identity_collision',
    });
    expect(replayProposalV4).not.toHaveBeenCalled();
  });

  it('keeps an unrecorded resumed Board command indeterminate without reminting or rerecording', async () => {
    const command = proposeBoardCommand();
    const replayProposalV4 = vi.fn();
    const getProposalStateV4 = vi.fn(async () => ({ status: 'unknown' as const }));
    const mintProposalIdentity = vi.fn();
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4,
        getProposalStateV4,
      } as Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>,
      mintProposalIdentity,
    });
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).resolves.toMatchObject({
      policy: 'propose_board',
      status: 'indeterminate',
      reasonCode: 'indeterminate_after_restart',
    });
    expect(getProposalStateV4).toHaveBeenCalledWith(
      command.projectId,
      deriveStudioProposalIdV4(command.projectId, command.commandId)
    );
    expect(replayProposalV4).not.toHaveBeenCalled();
    expect(mintProposalIdentity).not.toHaveBeenCalled();
  });

  it('fails closed when resumed Board history does not exactly match its immutable command', async () => {
    const command = proposeBoardCommand() as Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }>;
    const mismatched = boardProposal({ ...command, handle: 'different_board' });
    const { mailbox, processor } = harness({
      proposalAuthority: {
        replayProposalV4: vi.fn(),
        getProposalStateV4: vi.fn(async () => ({
          status: 'pending' as const,
          proposal: mismatched,
          admittedAt: mismatched.createdAt,
        })),
      } as Pick<CreativeStudioProposalSidecarsV4, 'replayProposalV4' | 'getProposalStateV4'>,
    });
    await mailbox.submit(command);
    await mailbox.begin(command.projectId, 'processor_before_restart');

    await expect(processor.processProject(command.projectId)).rejects.toMatchObject({ code: 'storage_error' });
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
