/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import * as creativeStudioTypes from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandSlotV1,
} from '@/common/types/project/creativeStudioTypes';
import * as directorCommandContracts from '@process/services/creative-studio/service/directorCommandContracts';
import {
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorPendingRecord,
} from '@process/services/creative-studio/service/directorCommandContracts';

const NOW = '2026-08-16T12:00:00.000Z';
const WAIT_MS = 15_000;

type SlotLeaseFixture = {
  schemaVersion: 1;
  leaseId: string;
  owner: 'writer' | 'main';
  commandId: string | null;
  reservedAt: string | null;
  deadlineAt: string | null;
  acquiredAt: string;
  expiresAt: string;
};

const validLease = (overrides: Partial<SlotLeaseFixture> = {}): SlotLeaseFixture => ({
  schemaVersion: 1,
  leaseId: 'lease_1',
  owner: 'writer',
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  acquiredAt: NOW,
  expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
  ...overrides,
});

const parseLease = (value: unknown, now = NOW): SlotLeaseFixture | null | undefined => {
  const parser = Reflect.get(directorCommandContracts, 'parseStudioDirectorCommandSlotLease');
  return typeof parser === 'function'
    ? (Reflect.apply(parser, undefined, [value, now, WAIT_MS]) as SlotLeaseFixture | null)
    : undefined;
};

const validCommand = (overrides: Partial<StudioDirectorCommandRecordV1> = {}): StudioDirectorCommandRecordV1 => ({
  schemaVersion: 1,
  commandId: 'command_1',
  projectId: 'project_1',
  expectedRevision: 4,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A quieter launch story.' }],
  ...overrides,
});

const validSlot = (overrides: Partial<StudioDirectorCommandSlotV1> = {}): StudioDirectorCommandSlotV1 => ({
  schemaVersion: 1,
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  ...overrides,
});

const parsePending = (value: unknown, slot: unknown = validSlot()) =>
  parseStudioDirectorPendingRecord({
    projectId: 'project_1',
    commandId: 'command_1',
    value,
    slot,
    now: NOW,
    waitMs: WAIT_MS,
  });

describe('Studio Director V1 command contracts', () => {
  it('accepts the exact V1 envelope and all five bounded operation variants', () => {
    const commands: StudioDirectorCommandRecordV1[] = [
      validCommand({ operations: [{ kind: 'set_brief', brief: '' }] }),
      validCommand({
        operations: [
          {
            kind: 'add_scene',
            sceneId: 'scene_new',
            scene: {
              title: 'Opening',
              purpose: 'Establish the place',
              visualPrompt: 'Morning light across a quiet square',
              narration: '',
              onScreenText: '',
              mediaKind: 'image',
              durationSeconds: 5,
            },
            beforeSceneId: null,
          },
        ],
      }),
      validCommand({ operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: { narration: 'Hello.' } }] }),
      validCommand({ operations: [{ kind: 'reorder_scenes', sceneOrder: ['scene_2', 'scene_1'] }] }),
      validCommand({ operations: [{ kind: 'select_take', sceneId: 'scene_1', assetId: 'asset_1' }] }),
    ];

    expect(commands.map((command) => parsePending(command).status)).toEqual([
      'valid',
      'valid',
      'valid',
      'valid',
      'valid',
    ]);
    expect(STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION).toBe(1);
    expect(STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS).toBe(32);
    expect(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES).toBe(256 * 1024);
  });

  it.each([
    ['command envelope', { ...validCommand(), unexpected: true }],
    ['set brief', validCommand({ operations: [{ kind: 'set_brief', brief: 'x', prompt: 'secret' } as never] })],
    [
      'new scene',
      validCommand({
        operations: [
          {
            kind: 'add_scene',
            sceneId: 'scene_new',
            beforeSceneId: null,
            scene: {
              title: '',
              purpose: '',
              visualPrompt: '',
              narration: '',
              onScreenText: '',
              mediaKind: 'image',
              durationSeconds: 5,
              selectedAssetId: 'credential_should_not_enter_wire',
            },
          } as never,
        ],
      }),
    ],
    [
      'edit patch',
      validCommand({
        operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: { jobIds: ['job_1'] } } as never],
      }),
    ],
    [
      'reorder',
      validCommand({
        operations: [{ kind: 'reorder_scenes', sceneOrder: ['scene_1'], path: '/private/tmp' } as never],
      }),
    ],
    [
      'take selection',
      validCommand({
        operations: [{ kind: 'select_take', sceneId: 'scene_1', assetId: 'asset_1', provider: 'raw' } as never],
      }),
    ],
  ])('rejects unknown keys in the %s without reflecting their values', (_label, command) => {
    const result = parsePending(command);

    expect(result).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: 4,
      reasonCode: 'malformed_record',
    });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('/private/tmp');
  });

  it('requires one through 32 operations and a nonempty exact edit patch', () => {
    const tooMany = Array.from({ length: STUDIO_DIRECTOR_COMMAND_MAX_OPERATIONS + 1 }, () => ({
      kind: 'set_brief' as const,
      brief: 'x',
    }));

    expect(parsePending(validCommand({ operations: [] })).status).toBe('invalid');
    expect(parsePending(validCommand({ operations: tooMany })).status).toBe('invalid');
    expect(
      parsePending(validCommand({ operations: [{ kind: 'edit_scene', sceneId: 'scene_1', changes: {} }] })).status
    ).toBe('invalid');
  });

  it('accepts a brief at 16 KiB and rejects the next character', () => {
    expect(
      parsePending(validCommand({ operations: [{ kind: 'set_brief', brief: 'x'.repeat(16 * 1024) }] })).status
    ).toBe('valid');
    expect(
      parsePending(validCommand({ operations: [{ kind: 'set_brief', brief: 'x'.repeat(16 * 1024 + 1) }] })).status
    ).toBe('invalid');
  });

  it('rejects a structurally valid in-memory command whose serialized bytes exceed the wire cap', () => {
    const oversized = validCommand({
      operations: [{ kind: 'set_brief', brief: 'x'.repeat(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) }],
    });

    expect(parsePending(oversized)).toMatchObject({ status: 'invalid', reasonCode: 'malformed_record' });
  });

  it('rejects add and reorder in one command while preserving ordered additions as valid', () => {
    const add = {
      kind: 'add_scene' as const,
      sceneId: 'scene_new',
      scene: {
        title: '',
        purpose: '',
        visualPrompt: '',
        narration: '',
        onScreenText: '',
        mediaKind: 'video' as const,
        durationSeconds: 5,
      },
      beforeSceneId: 'scene_1',
    };

    expect(parsePending(validCommand({ operations: [add, { ...add, sceneId: 'scene_new_2' }] })).status).toBe('valid');
    expect(
      parsePending(validCommand({ operations: [add, { kind: 'reorder_scenes', sceneOrder: ['scene_1'] }] })).status
    ).toBe('invalid');
  });

  it.each([
    {
      label: 'created too far in the future',
      command: validCommand({
        createdAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS + 1).toISOString(),
        deadlineAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS + 2).toISOString(),
      }),
    },
    {
      label: 'deadline equal to creation',
      command: validCommand({ deadlineAt: NOW }),
    },
    {
      label: 'deadline beyond the bounded wait',
      command: validCommand({ deadlineAt: new Date(Date.parse(NOW) + WAIT_MS + 1).toISOString() }),
    },
    {
      label: 'parseable but noncanonical timestamp',
      command: validCommand({ createdAt: '2026-08-16T12:00:00Z' }),
    },
  ])('rejects a relationally invalid command time: $label', ({ command }) => {
    expect(parsePending(command)).toMatchObject({ status: 'invalid', reasonCode: 'malformed_record' });
  });

  it.each([
    ['different command', validSlot({ commandId: 'command_2' })],
    ['different deadline', validSlot({ deadlineAt: '2026-08-16T12:00:14.999Z' })],
    ['unknown key', { ...validSlot(), rawError: 'credential=/tmp/secret' }],
    ['unsupported version', { ...validSlot(), schemaVersion: 2 }],
  ])('rejects a slot with a %s', (_label, slot) => {
    expect(parsePending(validCommand(), slot)).toMatchObject({ status: 'invalid' });
  });

  it('bounds standalone slot reservation time against injected now and wait', () => {
    expect(parseStudioDirectorCommandSlot(validSlot(), NOW, WAIT_MS)).toEqual(validSlot());
    expect(
      parseStudioDirectorCommandSlot(validSlot({ deadlineAt: '2030-08-16T12:00:00.000Z' }), NOW, WAIT_MS)
    ).toBeNull();
    expect(
      parseStudioDirectorCommandSlot(
        validSlot({
          reservedAt: '2026-08-16T12:00:02.001Z',
          deadlineAt: '2026-08-16T12:00:12.001Z',
        }),
        NOW,
        WAIT_MS
      )
    ).toBeNull();
  });

  it('distinguishes an unsupported command version from other malformed values', () => {
    expect(parsePending({ ...validCommand(), schemaVersion: 2 })).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: 4,
      reasonCode: 'unsupported_version',
    });
  });

  it('fuzzes malformed values into only a bounded invalid result with nullable recovered revision', () => {
    let state = 0x5eed1234;
    const next = (): number => {
      state = (state * 1_664_525 + 1_013_904_223) >>> 0;
      return state;
    };
    const malformed: unknown[] = [null, undefined, true, 1, 'record', [], {}, { schemaVersion: 1 }];
    for (let index = 0; index < 64; index += 1) {
      malformed.push({
        schemaVersion: next() % 4,
        commandId: next() % 2 === 0 ? 'command_1' : '../escape',
        projectId: next() % 2 === 0 ? 'project_1' : '/tmp/project',
        expectedRevision: next() % 2 === 0 ? next() : 'credential',
        operations: next() % 2 === 0 ? [] : 'prompt',
      });
    }

    for (const value of malformed) {
      const result = parsePending(value);
      expect(result.status).toBe('invalid');
      if (result.status === 'invalid') {
        expect(['malformed_record', 'unsupported_version']).toContain(result.reasonCode);
        expect(result.commandId).toBe('command_1');
        expect(result.expectedRevision === null || Number.isSafeInteger(result.expectedRevision)).toBe(true);
        expect(Object.keys(result).toSorted()).toEqual(['commandId', 'expectedRevision', 'reasonCode', 'status']);
      }
    }
  });

  it('does not recover a revision from a record whose filename or project authority does not match', () => {
    expect(parsePending({ ...validCommand(), commandId: 'other', expectedRevision: 77 })).toMatchObject({
      status: 'invalid',
      expectedRevision: null,
    });
    expect(parsePending({ ...validCommand(), projectId: 'other', expectedRevision: 77 })).toMatchObject({
      status: 'invalid',
      expectedRevision: null,
    });
  });
});

describe('Studio Director V1 slot lease contract', () => {
  it('accepts exact writer and main leases and derives duration from ACK grace', () => {
    const mainWithoutSlot = validLease({
      leaseId: 'lease_main',
      owner: 'main',
      commandId: null,
      reservedAt: null,
      deadlineAt: null,
    });

    expect(parseLease(validLease())).toEqual(validLease());
    expect(parseLease(mainWithoutSlot)).toEqual(mainWithoutSlot);
    expect(Reflect.get(creativeStudioTypes, 'STUDIO_DIRECTOR_COMMAND_SLOT_LEASE_MS')).toBe(
      STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS
    );
  });

  it.each([
    ['unknown key', { ...validLease(), extra: true }],
    ['unknown owner', { ...validLease(), owner: 'processor' }],
    ['unsafe lease id', { ...validLease(), leaseId: '../lease' }],
    ['partial command identity', { ...validLease(), reservedAt: null }],
    ['writer without slot identity', { ...validLease(), commandId: null, reservedAt: null, deadlineAt: null }],
    ['noncanonical acquisition', { ...validLease(), acquiredAt: '2026-08-16T12:00:00Z' }],
    [
      'far-future acquisition',
      {
        ...validLease(),
        acquiredAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS + 1).toISOString(),
        expiresAt: new Date(
          Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS + 1 + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS
        ).toISOString(),
      },
    ],
    [
      'short duration',
      {
        ...validLease(),
        expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS - 1).toISOString(),
      },
    ],
    [
      'long duration',
      {
        ...validLease(),
        expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS + 1).toISOString(),
      },
    ],
  ])('rejects %s', (_label, lease) => {
    expect(parseLease(lease)).toBeNull();
  });
});

describe('Studio Director V1 receipt contracts', () => {
  const receipts: StudioDirectorCommandReceiptV1[] = [
    {
      schemaVersion: 1,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'applied',
      appliedRevision: 5,
      createdSceneIds: ['scene_new'],
    },
    {
      schemaVersion: 1,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: null,
      decidedAt: NOW,
      status: 'rejected',
      observedRevision: null,
      reasonCode: 'malformed_record',
    },
    {
      schemaVersion: 1,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'expired',
      observedRevision: 4,
      reasonCode: 'deadline_elapsed',
    },
    {
      schemaVersion: 1,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'indeterminate',
      observedRevision: 5,
      reasonCode: 'commit_attribution_unknown',
    },
  ];

  it('accepts only the exact keys and bounded reason code for each receipt variant', () => {
    expect(
      receipts.map((receipt) =>
        parseStudioDirectorCommandReceipt({ projectId: 'project_1', commandId: 'command_1', value: receipt })
      )
    ).toEqual(receipts);
  });

  it.each([
    { ...receipts[0], prompt: 'never echo this' },
    { ...receipts[1], reasonCode: 'Error: credential at /Users/example' },
    { ...receipts[2], providerMetadata: { token: 'secret' } },
    { ...receipts[3], rawError: '/private/tmp/project.json' },
    { ...receipts[0], appliedRevision: 9 },
    { ...receipts[0], createdSceneIds: ['../unsafe'] },
  ])('rejects receipt fields that could echo authority, secrets, or inconsistent results', (receipt) => {
    expect(
      parseStudioDirectorCommandReceipt({ projectId: 'project_1', commandId: 'command_1', value: receipt })
    ).toBeNull();
  });

  it('rejects a non-string reason code without invoking attacker-controlled coercion', () => {
    const toString = () => {
      throw new Error('raw credential must not execute');
    };

    expect(() =>
      parseStudioDirectorCommandReceipt({
        projectId: 'project_1',
        commandId: 'command_1',
        value: { ...receipts[1], reasonCode: { toString } },
      })
    ).not.toThrow();
    expect(
      parseStudioDirectorCommandReceipt({
        projectId: 'project_1',
        commandId: 'command_1',
        value: { ...receipts[1], reasonCode: { toString } },
      })
    ).toBeNull();
  });
});
