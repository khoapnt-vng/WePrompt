/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseStudioPilotDirectorCommand,
  parseStudioPilotDirectorReceipt,
  serializeStudioPilotDirectorRecord,
  studioPilotDirectorProposeBoardCommandSha256,
  STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES,
  STUDIO_PILOT_DIRECTOR_PROPOSE_BOARD_COMMAND_MAX_BYTES,
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS,
  type StudioPilotDirectorCommand,
} from '@process/services/creative-studio/service/pilot/director/contracts';
import {
  deriveStudioProposalExpiresAtV4,
  deriveStudioProposalIdV4,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
} from '@process/services/creative-studio/service/schema2/proposals/proposalContractsV4';

const createdAt = '2026-09-01T00:00:00.000Z';
const deadlineAt = '2026-09-01T00:01:00.000Z';

const commandBase = {
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId: 'command_1',
  projectId: 'project_1',
  createdAt,
  deadlineAt,
} as const;

const prepareCommand = (): StudioPilotDirectorCommand => ({
  ...commandBase,
  policy: 'prepare_photo',
  expectedAuthoringRevision: 4,
  words: 'Lantern light on rain',
  settings: { aspectRatio: '16:9', resolution: '1080p' },
  suggestedHandle: 'lantern_rain',
  referencePieceIds: ['piece_reference'],
});

const boardCommand = (shotCount = 1): Extract<StudioPilotDirectorCommand, { policy: 'propose_board' }> => ({
  ...commandBase,
  policy: 'propose_board',
  expectedAuthoringRevision: 4,
  handle: '雨の_board',
  beats: [
    {
      title: 'Arrival',
      story: 'Rain gathers on the platform.',
      targetSeconds: null,
      shots: Array.from({ length: shotCount }, (_, index) => ({
        shootingScript: `Shot ${index + 1}`,
        durationSeconds: 5,
      })),
    },
  ],
});

const boardCommandAtBytes = (targetBytes: number): StudioPilotDirectorCommand => {
  const candidate = boardCommand(12);
  let remaining = targetBytes - Buffer.byteLength(JSON.stringify(candidate), 'utf8');
  for (const shot of candidate.beats[0]!.shots) {
    const addition = Math.min(remaining, 24 * 1024 - shot.shootingScript.length);
    shot.shootingScript += 'x'.repeat(addition);
    remaining -= addition;
  }
  if (remaining !== 0) throw new Error('Target command size is outside the semantic Board envelope');
  return candidate;
};

const recordedBoardReceipt = (
  command: ReturnType<typeof boardCommand>,
  proposalCreatedAt = '2026-09-01T00:00:30.000Z',
  receiptDecidedAt = deadlineAt
) => ({
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId: command.commandId,
  projectId: command.projectId,
  policy: command.policy,
  expectedAuthoringRevision: command.expectedAuthoringRevision,
  decidedAt: receiptDecidedAt,
  status: 'succeeded' as const,
  result: {
    status: 'recorded' as const,
    proposal: {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V4,
      id: deriveStudioProposalIdV4(command.projectId, command.commandId),
      projectId: command.projectId,
      status: 'pending' as const,
      baseAuthoringRevision: command.expectedAuthoringRevision,
      source: {
        kind: 'director_command' as const,
        commandId: command.commandId,
        commandSha256: studioPilotDirectorProposeBoardCommandSha256(command),
      },
      target: { kind: 'board' as const, boardId: 'board_1' },
      issuedMemberIds: { beatIds: ['beat_1'], shotIds: ['shot_1'] },
      payload: { kind: 'create_board' as const, handle: command.handle, beats: command.beats },
      createdAt: proposalCreatedAt,
      expiresAt: deriveStudioProposalExpiresAtV4(proposalCreatedAt),
      decidedAt: null,
    },
  },
});

const terminalBoardReceipt = (
  command: ReturnType<typeof boardCommand>,
  status: 'accepted' | 'rejected' | 'expired',
  decidedAt: string,
  appliedRevision: number | null = status === 'accepted' ? 9 : null
) => ({
  schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  commandId: command.commandId,
  projectId: command.projectId,
  policy: command.policy,
  expectedAuthoringRevision: command.expectedAuthoringRevision,
  decidedAt,
  status: 'succeeded' as const,
  result: {
    status,
    proposalId: deriveStudioProposalIdV4(command.projectId, command.commandId),
    decidedAt,
    appliedRevision,
  },
});

describe('Pilot Director schema-14 contracts', () => {
  it.each<StudioPilotDirectorCommand>([
    { ...commandBase, policy: 'get_project_status' },
    prepareCommand(),
    boardCommand(),
    {
      ...commandBase,
      policy: 'rename_piece',
      expectedAuthoringRevision: 4,
      pieceId: 'piece_1',
      handle: 'شب_بارانی',
    },
  ])('accepts the exact $policy policy', (command) => {
    expect(parseStudioPilotDirectorCommand(command)).toEqual({ status: 'valid', command });
  });

  it('rejects schema 13 without interpreting it as schema 14', () => {
    expect(parseStudioPilotDirectorCommand({ ...prepareCommand(), schemaVersion: 13 })).toEqual({
      status: 'unsupported_version',
      commandId: 'command_1',
      projectId: 'project_1',
    });
  });

  it('does not admit command status as a policy', () => {
    expect(parseStudioPilotDirectorCommand({ ...commandBase, policy: 'get_command_status' }).status).toBe('invalid');
  });

  it.each([
    ['an extra key', { ...prepareCommand(), routeId: 'caller_route' }],
    ['an unsafe id', { ...prepareCommand(), commandId: '../command' }],
    ['an invalid photo setting', { ...prepareCommand(), settings: { aspectRatio: '2:1', resolution: '1080p' } }],
    [
      'an invalid rename',
      {
        ...commandBase,
        policy: 'rename_piece',
        expectedAuthoringRevision: 4,
        pieceId: 'piece_1',
        handle: '\u202Ebad',
      },
    ],
    [
      'an overlong deadline',
      {
        ...prepareCommand(),
        deadlineAt: new Date(Date.parse(createdAt) + STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS + 1).toISOString(),
      },
    ],
  ])('rejects %s', (_label, command) => {
    expect(parseStudioPilotDirectorCommand(command).status).toBe('invalid');
  });

  it('bounds the complete command record', () => {
    const command = { ...prepareCommand(), words: 'x'.repeat(STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES) };
    expect(parseStudioPilotDirectorCommand(command).status).toBe('invalid');
  });

  it('admits Board proposals above the ordinary envelope through the exact 262144-byte edge', () => {
    const aboveOrdinary = boardCommandAtBytes(STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES + 1);
    const atBoundary = boardCommandAtBytes(STUDIO_PILOT_DIRECTOR_PROPOSE_BOARD_COMMAND_MAX_BYTES);

    expect(parseStudioPilotDirectorCommand(aboveOrdinary).status).toBe('valid');
    expect(parseStudioPilotDirectorCommand(atBoundary).status).toBe('valid');
  });

  it('refuses a semantically valid Board proposal one byte above its dedicated envelope', () => {
    const overBoundary = boardCommandAtBytes(STUDIO_PILOT_DIRECTOR_PROPOSE_BOARD_COMMAND_MAX_BYTES + 1);
    expect(parseStudioPilotDirectorCommand(overBoundary).status).toBe('invalid');
  });

  it('rejects hostile or out-of-bounds Board proposal shapes without accepting caller identities', () => {
    const sparse = boardCommand();
    sparse.beats.length = 2;
    const tooManyShots = boardCommand(96);
    tooManyShots.beats.push({ ...tooManyShots.beats[0]!, shots: [tooManyShots.beats[0]!.shots[0]!] });

    expect(parseStudioPilotDirectorCommand(sparse).status).toBe('invalid');
    expect(parseStudioPilotDirectorCommand(tooManyShots).status).toBe('invalid');
    expect(parseStudioPilotDirectorCommand({ ...boardCommand(), boardId: 'caller_owned' }).status).toBe('invalid');
    expect(parseStudioPilotDirectorCommand({ ...boardCommand(), handle: '\u202Eunsafe' }).status).toBe('invalid');
    expect(parseStudioPilotDirectorCommand(new Proxy(boardCommand(), {})).status).toBe('invalid');
  });

  it('accepts an explicit fail-closed receipt while Board proposal persistence is unwired', () => {
    const command = boardCommand();
    const receipt = {
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: command.policy,
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: deadlineAt,
      status: 'rejected',
      reasonCode: 'operation_not_available',
    };
    expect(parseStudioPilotDirectorReceipt(receipt, command).status).toBe('valid');
  });

  it('binds a recorded Board receipt to the command words and causal timestamps', () => {
    const command = boardCommand();
    const receipt = recordedBoardReceipt(command);

    expect(parseStudioPilotDirectorReceipt(receipt, command).status).toBe('valid');
    expect(parseStudioPilotDirectorReceipt(receipt).status).toBe('valid');
    expect(
      parseStudioPilotDirectorReceipt(
        {
          ...receipt,
          result: {
            ...receipt.result,
            proposal: {
              ...receipt.result.proposal,
              payload: { ...receipt.result.proposal.payload, handle: 'different_board' },
            },
          },
        },
        command
      ).status
    ).toBe('invalid');
    expect(
      parseStudioPilotDirectorReceipt(recordedBoardReceipt(command, deadlineAt, '2026-09-01T00:01:00.001Z'), command)
        .status
    ).toBe('invalid');
    expect(
      parseStudioPilotDirectorReceipt(recordedBoardReceipt(command, '2026-08-31T23:59:29.999Z'), command).status
    ).toBe('invalid');
  });

  it('accepts a recorded proposal only inside the command execution window', () => {
    const command = boardCommand();

    expect(
      parseStudioPilotDirectorReceipt(recordedBoardReceipt(command, '2026-09-01T00:00:59.999Z', deadlineAt), command)
        .status
    ).toBe('valid');
    expect(
      parseStudioPilotDirectorReceipt(
        recordedBoardReceipt(command, '2026-09-01T00:01:00.001Z', '2026-09-01T00:01:00.002Z'),
        command
      ).status
    ).toBe('invalid');
  });

  it('admits local proposal and terminal timestamps only within the Director clock-skew bound', () => {
    const command = {
      ...boardCommand(),
      createdAt: '2026-09-01T00:00:30.000Z',
      deadlineAt: '2026-09-01T00:01:30.000Z',
    };
    expect(
      parseStudioPilotDirectorReceipt(
        recordedBoardReceipt(command, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
        command
      ).status
    ).toBe('valid');
    expect(
      parseStudioPilotDirectorReceipt(
        recordedBoardReceipt(command, '2026-08-31T23:59:59.999Z', '2026-08-31T23:59:59.999Z'),
        command
      ).status
    ).toBe('invalid');
  });

  it('keeps a standalone recorded receipt inside the proposal pending window', () => {
    const command = boardCommand();
    const proposalCreatedAt = '2026-09-01T00:00:30.000Z';
    const proposalExpiresAt = deriveStudioProposalExpiresAtV4(proposalCreatedAt);
    const lastPendingMillisecond = new Date(Date.parse(proposalExpiresAt) - 1).toISOString();

    expect(
      parseStudioPilotDirectorReceipt(recordedBoardReceipt(command, proposalCreatedAt, lastPendingMillisecond)).status
    ).toBe('valid');
    expect(
      parseStudioPilotDirectorReceipt(recordedBoardReceipt(command, proposalCreatedAt, proposalExpiresAt)).status
    ).toBe('invalid');
  });

  it('binds standalone recorded Board receipts to the receipt command identity', () => {
    const command = boardCommand();
    const receipt = recordedBoardReceipt(command);

    expect(parseStudioPilotDirectorReceipt(receipt).status).toBe('valid');
    expect(
      parseStudioPilotDirectorReceipt({
        ...receipt,
        commandId: 'command_other',
      }).status
    ).toBe('invalid');
    expect(
      parseStudioPilotDirectorReceipt({
        ...receipt,
        result: {
          ...receipt.result,
          proposal: {
            ...receipt.result.proposal,
            source: { ...receipt.result.proposal.source, commandId: 'command_other' },
          },
        },
      }).status
    ).toBe('invalid');
    expect(
      parseStudioPilotDirectorReceipt({
        ...receipt,
        result: {
          ...receipt.result,
          proposal: { ...receipt.result.proposal, projectId: 'project_other' },
        },
      }).status
    ).toBe('invalid');
  });

  it('binds a standalone recorded proposal id to its outer project and command', () => {
    const command = boardCommand();
    const receipt = recordedBoardReceipt(command);

    expect(
      parseStudioPilotDirectorReceipt({
        ...receipt,
        result: {
          ...receipt.result,
          proposal: {
            ...receipt.result.proposal,
            id: deriveStudioProposalIdV4(command.projectId, 'command_other'),
          },
        },
      }).status
    ).toBe('invalid');
  });

  it.each([
    ['accepted', 9],
    ['rejected', null],
    ['expired', null],
  ] as const)('accepts a byte-truthful terminal Board result for %s', (status, appliedRevision) => {
    const command = boardCommand();
    const receipt = terminalBoardReceipt(command, status, deadlineAt, appliedRevision);

    expect(parseStudioPilotDirectorReceipt(receipt, command).status).toBe('valid');
    expect(
      parseStudioPilotDirectorReceipt(
        { ...receipt, result: { ...receipt.result, appliedRevision: status === 'accepted' ? null : 9 } },
        command
      ).status
    ).toBe('invalid');
    expect(
      parseStudioPilotDirectorReceipt(
        { ...receipt, result: { ...receipt.result, proposalId: 'proposal_wrong' } },
        command
      ).status
    ).toBe('invalid');
    expect(
      parseStudioPilotDirectorReceipt({
        ...receipt,
        result: { ...receipt.result, proposalId: 'proposal_wrong' },
      }).status
    ).toBe('invalid');
  });

  it.each(['accepted', 'rejected', 'expired'] as const)(
    'rejects a %s Board decision beyond clock skew while allowing a post-deadline decision',
    (status) => {
      const command = boardCommand();

      expect(
        parseStudioPilotDirectorReceipt(terminalBoardReceipt(command, status, '2026-08-31T23:59:29.999Z'), command)
          .status
      ).toBe('invalid');
      expect(
        parseStudioPilotDirectorReceipt(terminalBoardReceipt(command, status, '2026-09-02T00:00:00.000Z'), command)
          .status
      ).toBe('valid');
    }
  );

  it('rejects a non-proposal receipt that predates its command', () => {
    const command = prepareCommand();
    const receipt = {
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: command.policy,
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: '2026-08-31T23:59:59.999Z',
      status: 'rejected',
      reasonCode: 'operation_not_available',
    };

    expect(parseStudioPilotDirectorReceipt(receipt, command).status).toBe('invalid');
  });

  it('correlates canonical Board words independently of object insertion order', () => {
    const command = boardCommand();
    const reordered = {
      ...command,
      beats: command.beats.map((beat) => ({
        shots: beat.shots.map((shot) => ({
          durationSeconds: shot.durationSeconds,
          shootingScript: shot.shootingScript,
        })),
        targetSeconds: beat.targetSeconds,
        story: beat.story,
        title: beat.title,
      })),
    };
    const parsed = parseStudioPilotDirectorCommand(reordered);
    expect(parsed.status).toBe('valid');
    if (parsed.status !== 'valid' || parsed.command.policy !== 'propose_board') return;

    expect(studioPilotDirectorProposeBoardCommandSha256(parsed.command)).toBe(
      studioPilotDirectorProposeBoardCommandSha256(command)
    );
    expect(parseStudioPilotDirectorReceipt(recordedBoardReceipt(command), parsed.command).status).toBe('valid');
  });

  it('accepts only a receipt that answers the same command authority', () => {
    const command = prepareCommand();
    const receipt = {
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: command.policy,
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: deadlineAt,
      status: 'succeeded',
      result: { status: 'prepared', quote: { reservationId: 'reservation_1' } },
    };

    expect(parseStudioPilotDirectorReceipt(receipt, command).status).toBe('valid');
    expect(parseStudioPilotDirectorReceipt({ ...receipt, expectedAuthoringRevision: 5 }, command).status).toBe(
      'invalid'
    );
  });

  it('rejects old-version and accessor-backed receipts', () => {
    const command = prepareCommand();
    const oldReceipt = {
      schemaVersion: 11,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: command.policy,
      expectedAuthoringRevision: command.expectedAuthoringRevision,
      decidedAt: deadlineAt,
      status: 'rejected',
      reasonCode: 'stale_authoring',
    };
    expect(parseStudioPilotDirectorReceipt(oldReceipt, command).status).toBe('unsupported_version');

    const accessor = { ...oldReceipt, schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION };
    Object.defineProperty(accessor, 'reasonCode', { enumerable: true, get: () => 'stale_authoring' });
    expect(parseStudioPilotDirectorReceipt(accessor, command).status).toBe('invalid');

    const statusAccessor = { ...oldReceipt, schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION };
    Object.defineProperty(statusAccessor, 'status', {
      enumerable: true,
      get: () => {
        throw new Error('must not run');
      },
    });
    expect(() => parseStudioPilotDirectorReceipt(statusAccessor, command)).not.toThrow();
    expect(parseStudioPilotDirectorReceipt(statusAccessor, command).status).toBe('invalid');
  });

  it('normalizes JSON values without a record representation to a failed serialization', () => {
    expect(serializeStudioPilotDirectorRecord(undefined)).toBeNull();
  });

  it('bounds terminal records even when their nested result is otherwise JSON-safe', () => {
    const command: StudioPilotDirectorCommand = { ...commandBase, policy: 'get_project_status' };
    const receipt = {
      schemaVersion: STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
      commandId: command.commandId,
      projectId: command.projectId,
      policy: command.policy,
      expectedAuthoringRevision: null,
      decidedAt: deadlineAt,
      status: 'succeeded',
      result: { status: 'supported', oversized: 'x'.repeat(1024 * 1024) },
    };
    expect(parseStudioPilotDirectorReceipt(receipt, command).status).toBe('invalid');
  });
});
