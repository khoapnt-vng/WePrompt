/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import {
  parseStudioPilotDirectorCommand,
  parseStudioPilotDirectorReceipt,
  STUDIO_PILOT_DIRECTOR_COMMAND_MAX_BYTES,
  STUDIO_PILOT_DIRECTOR_COMMAND_SCHEMA_VERSION,
  STUDIO_PILOT_DIRECTOR_MAX_DEADLINE_MS,
  type StudioPilotDirectorCommand,
} from '@process/services/creative-studio/service/pilot/director/contracts';

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
});

describe('Pilot Director schema-11 contracts', () => {
  it.each<StudioPilotDirectorCommand>([
    { ...commandBase, policy: 'get_project_status' },
    prepareCommand(),
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

  it('rejects schema 10 without interpreting it as schema 11', () => {
    expect(parseStudioPilotDirectorCommand({ ...prepareCommand(), schemaVersion: 10 })).toEqual({
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
      schemaVersion: 10,
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
