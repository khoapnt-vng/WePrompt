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
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_REFERENCE_REQUEST_SHOTS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  isStudioSceneCountTransitionAllowed,
  isValidProviderJobId,
  type StudioDirectorCommandReceiptV1,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV1,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorCommandSlotV1,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV2,
  type StudioDirectorOperationV2,
  type StudioMutationOperationV2,
  type StudioProposalDecisionV2,
  type StudioProposalRecordV2,
  type StudioProposalSlotV2,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import * as directorCommandContracts from '@process/services/creative-studio/service/directorCommandContracts';
import {
  classifyStudioDirectorOperationV2,
  parseStudioDirectorCommandReceipt,
  parseStudioDirectorCommandReceiptV2,
  parseStudioDirectorCommandSlot,
  parseStudioDirectorCommandSlotLeaseV2,
  parseStudioDirectorCommandSlotV2,
  parseStudioDirectorPendingRecord,
  parseStudioDirectorPendingRecordV2,
  parseStudioProposalDecisionV2,
  parseStudioProposalRecordV2,
  parseStudioProposalSlotV2,
  parseStudioReferenceGenerationHandoffReceiptV2,
  parseStudioReferenceRequestDecisionV2,
  parseStudioReferenceRequestSlotV2,
  parseStudioReferenceRequestV2,
  STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2,
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

const emptyShotV2 = () => ({
  line: '',
  narration: '',
  onScreenText: '',
  durationSeconds: 5,
});

const validCommandV2 = (overrides: Partial<StudioDirectorCommandRecordV2> = {}): StudioDirectorCommandRecordV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  commandId: 'command_1',
  projectId: 'project_1',
  expectedRevision: 4,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A quieter launch story.' }],
  ...overrides,
});

const validSlotV2 = (overrides: Partial<StudioDirectorCommandSlotV2> = {}): StudioDirectorCommandSlotV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  ...overrides,
});

const validLeaseV2 = (overrides: Partial<StudioDirectorCommandSlotLeaseV2> = {}): StudioDirectorCommandSlotLeaseV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  leaseId: 'lease_1',
  owner: 'writer',
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  acquiredAt: NOW,
  expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
  ...overrides,
});

const parsePendingV2 = (value: unknown, slot: unknown = validSlotV2()) =>
  parseStudioDirectorPendingRecordV2({
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

describe('Studio Director V2 command contracts', () => {
  const operations: StudioDirectorOperationV2[] = [
    { kind: 'set_brief', brief: '' },
    {
      kind: 'add_beat',
      beatId: 'section_new',
      beat: { title: 'Opening', action: 'Establish the place', look: 'Morning light', targetSeconds: null },
      beforeBeatId: null,
    },
    { kind: 'edit_beat', beatId: 'section_1', changes: { action: 'A quieter opening.' } },
    { kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] },
    {
      kind: 'add_shot',
      beatId: 'section_1',
      shotId: 'clip_new',
      shot: emptyShotV2(),
      beforeShotId: null,
    },
    { kind: 'edit_shot', shotId: 'clip_1', changes: { narration: 'Hello.' } },
    { kind: 'delete_shot', shotId: 'clip_1' },
    { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_2', 'clip_1'] },
    {
      kind: 'reorder_bin',
      bin: [
        { kind: 'take', assetId: 'asset_1', reason: 'alternate' },
        { kind: 'beat', beatId: 'section_1', reason: 'lifted' },
      ],
    },
  ];

  it('accepts the exact schema-2 envelope and every current Director operation', () => {
    expect(operations.map((operation) => parsePendingV2(validCommandV2({ operations: [operation] })).status)).toEqual(
      Array.from({ length: operations.length }, () => 'valid')
    );
    expect(STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2).toBe(STUDIO_PROJECT_SCHEMA_VERSION);
    expect(STUDIO_MAX_MUTATION_OPERATIONS).toBe(32);
  });

  it('freezes an exhaustive 32-kind capability table and rejects unknown provenance', () => {
    const expected = {
      edit_project: 'operation_not_permitted',
      set_brief: 'direct',
      set_rules: 'operation_not_permitted',
      add_beat: 'direct',
      edit_beat: 'direct',
      reorder_beats: 'direct',
      park_beat: 'operation_not_permitted',
      restore_beat: 'operation_not_permitted',
      add_binned_beat: 'proposal',
      add_shot: 'direct',
      edit_shot: 'direct',
      delete_shot: 'direct',
      park_shot: 'operation_not_permitted',
      restore_shot: 'operation_not_permitted',
      reorder_shots: 'direct',
      apply_coverage: 'proposal',
      set_hard_cut: 'proposal',
      set_seed_still: 'operation_not_permitted',
      trim_shot: 'operation_not_permitted',
      redetach_line: 'proposal',
      rederive_line: 'proposal',
      restore_line: 'operation_not_permitted',
      park_take: 'operation_not_permitted',
      add_alternate_take: 'operation_not_permitted',
      restore_take: 'operation_not_permitted',
      reorder_bin: 'direct',
      select_take: 'operation_not_permitted',
      set_routes: 'operation_not_permitted',
      set_spend_policy: 'operation_not_permitted',
      set_match_to: 'operation_not_permitted',
      set_bed: 'operation_not_permitted',
      undo_last: 'operation_not_permitted',
    } as const satisfies Readonly<
      Record<StudioMutationOperationV2['kind'], 'direct' | 'proposal' | 'operation_not_permitted'>
    >;

    expect(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2).toEqual(expected);
    expect(Object.keys(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)).toHaveLength(32);
    expect(Object.isFrozen(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)).toBe(true);
    for (const [kind, disposition] of Object.entries(expected)) {
      expect(classifyStudioDirectorOperationV2(kind), kind).toBe(disposition);
    }
    for (const unknown of ['future_operation', 'constructor', 'toString', '__proto__', null, {}, 1]) {
      expect(classifyStudioDirectorOperationV2(unknown)).toBeNull();
    }
  });

  it.each([
    { kind: 'edit_project', changes: { name: 'Not direct' } },
    { kind: 'park_beat', beatId: 'section_1' },
    { kind: 'select_take', shotId: 'clip_1', assetId: 'asset_1' },
    { kind: 'undo_last', entryId: 'mutation_1' },
  ])('rejects the known but unavailable $kind capability', (operation) => {
    expect(parsePendingV2(validCommandV2({ operations: [operation as never] })).status).toBe('invalid');
  });

  it('keeps executable shared-type guards covered by the tracked Gate-1 manifest', () => {
    expect(isValidProviderJobId('provider_job-1.~')).toBe(true);
    expect(isValidProviderJobId('')).toBe(false);
    expect(isValidProviderJobId(`j${'x'.repeat(512)}`)).toBe(false);
    expect(isValidProviderJobId('https://provider.example/job')).toBe(false);
    expect(isStudioSceneCountTransitionAllowed(24, 24)).toBe(true);
    expect(isStudioSceneCountTransitionAllowed(24, 25)).toBe(false);
    expect(isStudioSceneCountTransitionAllowed(25, 25)).toBe(true);
    expect(isStudioSceneCountTransitionAllowed(25, 26)).toBe(false);
  });

  it.each([
    ['command envelope', { ...validCommandV2(), unexpected: true }],
    [
      'new beat',
      validCommandV2({
        operations: [
          {
            ...operations[1],
            beat: { title: '', action: '', look: '', rawPath: '/private/tmp/secret' },
          } as never,
        ],
      }),
    ],
    [
      'new shot',
      validCommandV2({
        operations: [
          {
            ...operations[4],
            shot: { ...emptyShotV2(), providerJobId: 'credential' },
          } as never,
        ],
      }),
    ],
    [
      'beat edit',
      validCommandV2({
        operations: [{ kind: 'edit_beat', beatId: 'section_1', changes: { title: 'x', extra: true } } as never],
      }),
    ],
    [
      'shot edit',
      validCommandV2({
        operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: { narration: 'x', jobIds: [] } } as never],
      }),
    ],
    [
      'bin item',
      validCommandV2({
        operations: [
          { kind: 'reorder_bin', bin: [{ kind: 'take', assetId: 'asset_1', url: 'file:///tmp/x' }] } as never,
        ],
      }),
    ],
  ])('rejects unknown keys in the %s without reflecting their values', (_label, command) => {
    const result = parsePendingV2(command);

    expect(result).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: 4,
      reasonCode: 'malformed_record',
    });
    expect(JSON.stringify(result)).not.toContain('/private/tmp');
    expect(JSON.stringify(result)).not.toContain('credential');
  });

  it('requires a dense one-through-32 operation list and nonempty exact edit patches', () => {
    const tooMany = Array.from({ length: STUDIO_MAX_MUTATION_OPERATIONS + 1 }, () => ({
      kind: 'set_brief' as const,
      brief: 'x',
    }));
    const sparse = Array(1) as StudioDirectorOperationV2[];

    expect(parsePendingV2(validCommandV2({ operations: [] })).status).toBe('invalid');
    expect(parsePendingV2(validCommandV2({ operations: tooMany })).status).toBe('invalid');
    expect(parsePendingV2(validCommandV2({ operations: sparse })).status).toBe('invalid');
    expect(
      parsePendingV2(validCommandV2({ operations: [{ kind: 'edit_beat', beatId: 'section_1', changes: {} }] })).status
    ).toBe('invalid');
    expect(
      parsePendingV2(validCommandV2({ operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: {} }] })).status
    ).toBe('invalid');
  });

  it('uses own exact keys, rejects array baggage, and accepts safe magic identities', () => {
    const magicIds = ['constructor', 'toString', '__proto__'];
    const command = validCommandV2({
      operations: [{ kind: 'reorder_beats', beatOrder: magicIds }],
    });
    const withSymbol = validCommandV2();
    Object.defineProperty(withSymbol, Symbol('extra'), { value: true, enumerable: true });
    const withHiddenKey = validCommandV2();
    Object.defineProperty(withHiddenKey, 'hidden', { value: true, enumerable: false });
    const operationsWithBaggage = [{ kind: 'set_brief' as const, brief: 'x' }];
    Object.defineProperty(operationsWithBaggage, 'extra', { value: true, enumerable: true });

    expect(parsePendingV2(command).status).toBe('valid');
    expect(parsePendingV2(withSymbol).status).toBe('invalid');
    expect(parsePendingV2(withHiddenKey).status).toBe('invalid');
    expect(parsePendingV2(validCommandV2({ operations: operationsWithBaggage })).status).toBe('invalid');
  });

  it('enforces V2 authored bounds, safe identities, and shot durations', () => {
    const validShot = {
      kind: 'add_shot' as const,
      beatId: 'section_1',
      shotId: 'clip_video',
      shot: { ...emptyShotV2(), durationSeconds: 4 },
      beforeShotId: null,
    };

    expect(parsePendingV2(validCommandV2({ operations: [validShot] })).status).toBe('valid');
    expect(
      parsePendingV2(
        validCommandV2({ operations: [{ ...validShot, shot: { ...validShot.shot, durationSeconds: 3 } }] })
      ).status
    ).toBe('invalid');
    expect(parsePendingV2(validCommandV2({ operations: [{ ...validShot, shotId: '../unsafe' }] })).status).toBe(
      'invalid'
    );
    expect(
      parsePendingV2(validCommandV2({ operations: [{ kind: 'set_brief', brief: 'x'.repeat(16 * 1024 + 1) }] })).status
    ).toBe('invalid');
  });

  it('reports schema-1 pending bytes as unsupported before slot validation and never as a terminal rejection', () => {
    expect(parsePendingV2(validCommand(), { malformed: true })).toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'command_1',
      expectedRevision: 4,
    });
    expect(parsePendingV2({ schemaVersion: 1 }, { malformed: true })).toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'command_1',
      expectedRevision: null,
    });
  });

  it('distinguishes unknown versions from malformed schema-2 records', () => {
    expect(parsePendingV2({ ...validCommandV2(), schemaVersion: 3 })).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: 4,
      reasonCode: 'unsupported_version',
    });
    expect(parsePendingV2({ ...validCommandV2(), policy: 'review' })).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: 4,
      reasonCode: 'malformed_record',
    });
  });

  it('keeps authority and timing checks ahead of accepting an otherwise exact record', () => {
    expect(parsePendingV2({ ...validCommandV2(), projectId: 'other' })).toMatchObject({
      status: 'invalid',
      expectedRevision: null,
    });
    expect(parsePendingV2(validCommandV2(), validSlotV2({ commandId: 'other' }))).toMatchObject({
      status: 'invalid',
      reasonCode: 'malformed_record',
    });
    expect(
      parsePendingV2(
        validCommandV2({
          createdAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS + 1).toISOString(),
          deadlineAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS + 2).toISOString(),
        })
      )
    ).toMatchObject({ status: 'invalid', reasonCode: 'malformed_record' });
  });

  it('is total on accessor and revoked-Proxy input without executing attacker-controlled getters', () => {
    let getterCalls = 0;
    const accessorRecord: Record<string, unknown> = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'command_1',
      expectedRevision: 4,
    };
    Object.defineProperty(accessorRecord, 'projectId', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        throw new Error('must not execute');
      },
    });
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    expect(() => parsePendingV2(accessorRecord)).not.toThrow();
    expect(parsePendingV2(accessorRecord)).toEqual({
      status: 'invalid',
      commandId: 'command_1',
      expectedRevision: null,
      reasonCode: 'malformed_record',
    });
    expect(getterCalls).toBe(0);
    expect(() => parsePendingV2(revocable.proxy)).not.toThrow();
    expect(parsePendingV2(revocable.proxy)).toMatchObject({ status: 'invalid', expectedRevision: null });
  });

  it('rejects executable JSON hooks before measuring record bytes', () => {
    let toJsonCalls = 0;
    const command = validCommandV2({
      operations: [
        {
          kind: 'set_brief',
          brief: 'Safe text',
          toJSON: () => {
            toJsonCalls += 1;
            return { kind: 'set_brief', brief: 'rewritten' };
          },
        } as never,
      ],
    });

    expect(parsePendingV2(command)).toMatchObject({ status: 'invalid', reasonCode: 'malformed_record' });
    expect(toJsonCalls).toBe(0);
  });
});

describe('Studio Director V2 slot and lease contracts', () => {
  it('accepts exact V2 sidecars and reports V1 sidecars as unsupported', () => {
    expect(parseStudioDirectorCommandSlotV2(validSlotV2(), NOW, WAIT_MS)).toEqual({
      status: 'valid',
      record: validSlotV2(),
    });
    expect(parseStudioDirectorCommandSlotV2(validSlot(), NOW, WAIT_MS)).toEqual({
      status: 'unsupported_prototype_schema',
    });
    expect(parseStudioDirectorCommandSlotLeaseV2(validLeaseV2(), NOW, WAIT_MS)).toEqual({
      status: 'valid',
      record: validLeaseV2(),
    });
    expect(parseStudioDirectorCommandSlotLeaseV2(validLease(), NOW, WAIT_MS)).toEqual({
      status: 'unsupported_prototype_schema',
    });
  });

  it.each([
    ['slot unknown key', () => parseStudioDirectorCommandSlotV2({ ...validSlotV2(), extra: true }, NOW, WAIT_MS)],
    [
      'slot unknown version',
      () => parseStudioDirectorCommandSlotV2({ ...validSlotV2(), schemaVersion: 3 }, NOW, WAIT_MS),
    ],
    [
      'lease partial identity',
      () => parseStudioDirectorCommandSlotLeaseV2(validLeaseV2({ reservedAt: null }), NOW, WAIT_MS),
    ],
    [
      'lease wrong duration',
      () =>
        parseStudioDirectorCommandSlotLeaseV2(
          validLeaseV2({
            expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS + 1).toISOString(),
          }),
          NOW,
          WAIT_MS
        ),
    ],
  ])('rejects an invalid V2 sidecar: %s', (_label, parse) => {
    expect(parse()).toEqual({ status: 'invalid' });
  });
});

describe('Studio Director V2 receipt contracts', () => {
  const receipts: StudioDirectorCommandReceiptV2[] = [
    {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'applied',
      appliedRevision: 5,
      createdBeatIds: ['section_new'],
      createdShotIds: ['clip_new', 'clip_extra'],
    },
    {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: null,
      decidedAt: NOW,
      status: 'rejected',
      observedRevision: null,
      reasonCode: 'malformed_record',
    },
    {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'expired',
      observedRevision: 4,
      reasonCode: 'deadline_elapsed',
    },
    {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'indeterminate',
      observedRevision: 5,
      reasonCode: 'commit_attribution_unknown',
    },
  ];

  it('accepts each exact V2 receipt and both ordered created-ID arrays', () => {
    expect(
      receipts.map((receipt) =>
        parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value: receipt })
      )
    ).toEqual(receipts.map((receipt) => ({ status: 'valid', record: receipt })));
  });

  it('accepts the largest safe applied revision when its expected revision is one lower', () => {
    const receipt = {
      ...receipts[0],
      expectedRevision: Number.MAX_SAFE_INTEGER - 1,
      appliedRevision: Number.MAX_SAFE_INTEGER,
    };

    expect(
      parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value: receipt })
    ).toEqual({ status: 'valid', record: receipt });
  });

  it.each([
    [
      'a maximum-safe expected revision whose successor is unsafe',
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER + 1,
    ],
    ['an unsafe expected revision', Number.MAX_SAFE_INTEGER + 1, Number.MAX_SAFE_INTEGER + 1],
    ['a fractional expected revision', 4.5, 5.5],
    ['a fractional applied revision', 4, 5.5],
    ['a non-finite expected revision', Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ['a non-finite applied revision', 4, Number.NaN],
  ])('rejects an applied receipt with %s', (_label, expectedRevision, appliedRevision) => {
    expect(
      parseStudioDirectorCommandReceiptV2({
        projectId: 'project_1',
        commandId: 'command_1',
        value: { ...receipts[0], expectedRevision, appliedRevision },
      })
    ).toEqual({ status: 'invalid' });
  });

  it('keeps the maximum safe expected revision valid for a rejected receipt', () => {
    const receipt = {
      ...receipts[1],
      expectedRevision: Number.MAX_SAFE_INTEGER,
      observedRevision: Number.MAX_SAFE_INTEGER,
      reasonCode: 'stale_revision' as const,
    };

    expect(
      parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value: receipt })
    ).toEqual({ status: 'valid', record: receipt });
  });

  it.each([
    { ...receipts[0], appliedRevision: 9 },
    { ...receipts[0], createdBeatIds: ['section_new', 'section_new'] },
    { ...receipts[0], createdShotIds: ['../unsafe'] },
    { ...receipts[1], reasonCode: 'unsupported_prototype_schema' },
    { ...receipts[1], expectedRevision: null, reasonCode: 'stale_revision' },
    { ...receipts[2], rawError: '/private/tmp/project.json' },
  ])('rejects an inconsistent, unbounded, or authority-bearing receipt', (receipt) => {
    expect(
      parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value: receipt })
    ).toEqual({ status: 'invalid' });
  });

  it('accepts every frozen mutation reason as a bounded rejection code', () => {
    const reasons = [
      'beat_capacity_reached',
      'beat_shot_capacity_reached',
      'project_shot_capacity_reached',
      'invalid_shot_duration',
      'dependency_blocked',
      'identity_collision',
      'invalid_operation',
      'validation_failed',
      'operation_not_permitted',
    ] as const;

    for (const reasonCode of reasons) {
      const receipt = { ...receipts[1], expectedRevision: 4, reasonCode };
      expect(
        parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value: receipt })
      ).toEqual({ status: 'valid', record: receipt });
    }
  });

  it('reports a V1 receipt as unsupported without accepting it as V2', () => {
    const legacy: StudioDirectorCommandReceiptV1 = {
      schemaVersion: 1,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'applied',
      appliedRevision: 5,
      createdSceneIds: ['scene_1'],
    };

    expect(
      parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value: legacy })
    ).toEqual({ status: 'unsupported_prototype_schema' });
  });
});

describe('Studio proposal and reference sidecar V2 contracts', () => {
  const mutationProposal: StudioProposalRecordV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    id: 'proposal_1',
    projectId: 'project_1',
    status: 'pending',
    baseRevision: 4,
    payload: {
      kind: 'mutation_batch',
      operations: [{ kind: 'rederive_line', shotId: 'clip_1', line: 'A focused launch.' }],
    },
    createdAt: NOW,
    decidedAt: null,
  };
  const proposalDecision: StudioProposalDecisionV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    proposalId: 'proposal_1',
    status: 'accepted',
    decidedAt: NOW,
  };
  const proposalSlot: StudioProposalSlotV2 = {
    schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
    proposalId: 'proposal_1',
    reservedAt: NOW,
  };

  it('accepts exact mutation-batch and pin-rule proposals plus their decision and slot', () => {
    const pinRule: StudioProposalRecordV2 = {
      ...mutationProposal,
      id: 'proposal_rule',
      payload: {
        kind: 'pin_rule',
        rule: { text: 'Avoid brand names.', predicate: { kind: 'forbidden_terms', terms: ['Acme'] } },
      },
    };

    expect(
      parseStudioProposalRecordV2({ projectId: 'project_1', proposalId: 'proposal_1', value: mutationProposal })
    ).toEqual({ status: 'valid', record: mutationProposal });
    expect(
      parseStudioProposalRecordV2({ projectId: 'project_1', proposalId: 'proposal_rule', value: pinRule })
    ).toEqual({ status: 'valid', record: pinRule });
    expect(parseStudioProposalDecisionV2({ proposalId: 'proposal_1', value: proposalDecision })).toEqual({
      status: 'valid',
      record: proposalDecision,
    });
    expect(parseStudioProposalSlotV2(proposalSlot)).toEqual({ status: 'valid', record: proposalSlot });
  });

  it('rejects unknown proposal keys, empty mutation batches, and malformed decisions', () => {
    expect(
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_1',
        value: { ...mutationProposal, rawPrompt: 'secret' },
      })
    ).toEqual({ status: 'invalid' });
    const directProposal = {
      ...mutationProposal,
      payload: { kind: 'mutation_batch' as const, operations: [{ kind: 'set_brief' as const, brief: 'Reviewed.' }] },
    };
    expect(
      parseStudioProposalRecordV2({ projectId: 'project_1', proposalId: 'proposal_1', value: directProposal })
    ).toEqual({ status: 'valid', record: directProposal });
    for (const operation of [{ kind: 'park_take', shotId: 'clip_1', assetId: 'take_1' }]) {
      expect(
        parseStudioProposalRecordV2({
          projectId: 'project_1',
          proposalId: 'proposal_1',
          value: { ...mutationProposal, payload: { kind: 'mutation_batch', operations: [operation] } },
        })
      ).toEqual({ status: 'invalid' });
    }
    expect(
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_1',
        value: {
          ...mutationProposal,
          payload: {
            kind: 'pin_rule',
            rule: { text: 'Avoid punctuation.', predicate: { kind: 'forbidden_terms', terms: ['!!!'] } },
          },
        },
      })
    ).toEqual({ status: 'invalid' });
    expect(
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_1',
        value: { ...mutationProposal, payload: { kind: 'mutation_batch', operations: [] } },
      })
    ).toEqual({ status: 'invalid' });
    expect(
      parseStudioProposalDecisionV2({ proposalId: 'proposal_1', value: { ...proposalDecision, status: 'pending' } })
    ).toEqual({ status: 'invalid' });
  });

  it('reports every V1 proposal-family sidecar as unsupported and leaves its bytes uninterpreted', () => {
    expect(
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_1',
        value: { ...mutationProposal, schemaVersion: 1 },
      })
    ).toEqual({ status: 'unsupported_prototype_schema' });
    expect(
      parseStudioProposalDecisionV2({ proposalId: 'proposal_1', value: { ...proposalDecision, schemaVersion: 1 } })
    ).toEqual({ status: 'unsupported_prototype_schema' });
    expect(parseStudioProposalSlotV2({ ...proposalSlot, schemaVersion: 1 })).toEqual({
      status: 'unsupported_prototype_schema',
    });
  });

  it('accepts 1 and 24 ordered unique shot IDs and rejects 0, 25, or duplicates', () => {
    const shots24 = Array.from({ length: STUDIO_MAX_REFERENCE_REQUEST_SHOTS }, (_, index) => `clip_${index}`);
    const reference = (shotIds: string[]): StudioReferenceRequestV2 => ({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      id: 'request_1',
      projectId: 'project_1',
      shotIds,
      status: 'pending',
      createdAt: NOW,
    });
    const parse = (shotIds: string[]) =>
      parseStudioReferenceRequestV2({ projectId: 'project_1', requestId: 'request_1', value: reference(shotIds) });

    expect(parse(['clip_1'])).toMatchObject({ status: 'valid' });
    expect(parse(['constructor', 'toString', '__proto__'])).toMatchObject({ status: 'valid' });
    expect(parse(shots24)).toEqual({ status: 'valid', record: reference(shots24) });
    expect(parse([])).toEqual({ status: 'invalid' });
    expect(parse([...shots24, 'clip_25'])).toEqual({ status: 'invalid' });
    expect(parse(['clip_1', 'clip_1'])).toEqual({ status: 'invalid' });
  });

  it('accepts an exact V2 reference slot and reports V1 reference sidecars as unsupported', () => {
    const slot: StudioReferenceRequestSlotV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'request_1',
      reservedAt: NOW,
    };
    const reference: StudioReferenceRequestV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      id: 'request_1',
      projectId: 'project_1',
      shotIds: ['clip_1'],
      status: 'pending',
      createdAt: NOW,
    };

    expect(parseStudioReferenceRequestSlotV2(slot)).toEqual({ status: 'valid', record: slot });
    expect(parseStudioReferenceRequestSlotV2({ ...slot, schemaVersion: 1 })).toEqual({
      status: 'unsupported_prototype_schema',
    });
    expect(
      parseStudioReferenceRequestV2({
        projectId: 'project_1',
        requestId: 'request_1',
        value: { ...reference, schemaVersion: 1 },
      })
    ).toEqual({ status: 'unsupported_prototype_schema' });
  });

  it('accepts every exact terminal reference decision and handoff receipt variant', () => {
    const decisions: StudioReferenceRequestDecisionV2[] = [
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'request_rejected',
        projectId: 'project_1',
        decidedAt: NOW,
        outcome: { kind: 'rejected' },
      },
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'request_expired',
        projectId: 'project_1',
        decidedAt: NOW,
        outcome: { kind: 'expired' },
      },
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'request_imported',
        projectId: 'project_1',
        decidedAt: NOW,
        outcome: { kind: 'imported_reference', assetId: 'asset_1', projectRevision: 7 },
      },
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'request_generation',
        projectId: 'project_1',
        decidedAt: NOW,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', shotIds: ['shot_2', 'shot_1'] },
      },
    ];
    for (const decision of decisions) {
      expect(
        parseStudioReferenceRequestDecisionV2({
          projectId: decision.projectId,
          requestId: decision.requestId,
          value: decision,
        })
      ).toEqual({ status: 'valid', record: decision });
    }

    const receipts: StudioReferenceGenerationHandoffReceiptV2[] = [
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId: 'handoff_dismissed',
        requestId: 'request_dismissed',
        completedAt: NOW,
        result: { kind: 'dismissed' },
      },
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId: 'handoff_confirmed',
        requestId: 'request_confirmed',
        completedAt: NOW,
        result: { kind: 'confirmed', authorizationId: 'authorization_1' },
      },
    ];
    for (const receipt of receipts) {
      expect(parseStudioReferenceGenerationHandoffReceiptV2({ handoffId: receipt.handoffId, value: receipt })).toEqual({
        status: 'valid',
        record: receipt,
      });
    }
  });

  it('rejects malformed reference decisions without weakening exact nested contracts', () => {
    const generationDecision: StudioReferenceRequestDecisionV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'request_1',
      projectId: 'project_1',
      decidedAt: NOW,
      outcome: { kind: 'generation_gate', handoffId: 'handoff_1', shotIds: ['shot_1', 'shot_2'] },
    };
    const parse = (value: unknown, projectId = 'project_1', requestId = 'request_1') =>
      parseStudioReferenceRequestDecisionV2({ projectId, requestId, value });
    const sparseShotIds = Array(2) as string[];
    sparseShotIds[1] = 'shot_1';
    const invalidValues: unknown[] = [
      { ...generationDecision, provider: 'secret' },
      { ...generationDecision, projectId: 'project_other' },
      { ...generationDecision, requestId: 'request_other' },
      { ...generationDecision, decidedAt: '2026-08-16' },
      { ...generationDecision, outcome: null },
      { ...generationDecision, outcome: { kind: 'rejected', reason: 'no' } },
      { ...generationDecision, outcome: { kind: 'expired', decidedAt: NOW } },
      {
        ...generationDecision,
        outcome: { kind: 'imported_reference', assetId: 'unsafe/asset', projectRevision: 7 },
      },
      {
        ...generationDecision,
        outcome: { kind: 'imported_reference', assetId: 'asset_1', projectRevision: 0 },
      },
      {
        ...generationDecision,
        outcome: { kind: 'imported_reference', assetId: 'asset_1', projectRevision: 7, path: '/tmp/a' },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'unsafe/handoff', shotIds: ['shot_1'] },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', shotIds: [] },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', shotIds: ['shot_1', 'shot_1'] },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', shotIds: sparseShotIds },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', shotIds: ['shot_1'], extra: true },
      },
      { ...generationDecision, outcome: { kind: 'unknown' } },
    ];
    for (const value of invalidValues) expect(parse(value)).toEqual({ status: 'invalid' });
    expect(parse(generationDecision, 'project_other')).toEqual({ status: 'invalid' });
    expect(parse(generationDecision, 'project_1', 'request_other')).toEqual({ status: 'invalid' });
  });

  it('rejects malformed handoff receipts and preserves V1 sidecars as unsupported', () => {
    const confirmed: StudioReferenceGenerationHandoffReceiptV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      handoffId: 'handoff_1',
      requestId: 'request_1',
      completedAt: NOW,
      result: { kind: 'confirmed', authorizationId: 'authorization_1' },
    };
    const parse = (value: unknown, handoffId = 'handoff_1') =>
      parseStudioReferenceGenerationHandoffReceiptV2({ handoffId, value });
    const invalidValues: unknown[] = [
      { ...confirmed, quoteId: 'quote_secret' },
      { ...confirmed, handoffId: 'handoff_other' },
      { ...confirmed, requestId: 'unsafe/request' },
      { ...confirmed, completedAt: 'yesterday' },
      { ...confirmed, result: null },
      { ...confirmed, result: { kind: 'dismissed', authorizationId: 'authorization_1' } },
      { ...confirmed, result: { kind: 'confirmed', authorizationId: 'unsafe/authorization' } },
      { ...confirmed, result: { kind: 'confirmed' } },
      { ...confirmed, result: { kind: 'unknown' } },
    ];
    for (const value of invalidValues) expect(parse(value)).toEqual({ status: 'invalid' });
    expect(parse(confirmed, 'handoff_other')).toEqual({ status: 'invalid' });
    expect(parse({ ...confirmed, schemaVersion: 1 })).toEqual({ status: 'unsupported_prototype_schema' });

    const rejectedDecision: StudioReferenceRequestDecisionV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'request_1',
      projectId: 'project_1',
      decidedAt: NOW,
      outcome: { kind: 'rejected' },
    };
    expect(
      parseStudioReferenceRequestDecisionV2({
        projectId: 'project_1',
        requestId: 'request_1',
        value: { ...rejectedDecision, schemaVersion: 1 },
      })
    ).toEqual({ status: 'unsupported_prototype_schema' });
  });

  it('returns bounded invalid results for revoked proxies across every V2 sidecar parser', () => {
    const makeRevokedProxy = (): unknown => {
      const revocable = Proxy.revocable({}, {});
      revocable.revoke();
      return revocable.proxy;
    };
    const parsers = [
      () => parseStudioDirectorCommandSlotV2(makeRevokedProxy(), NOW, WAIT_MS),
      () => parseStudioDirectorCommandSlotLeaseV2(makeRevokedProxy(), NOW, WAIT_MS),
      () =>
        parseStudioDirectorCommandReceiptV2({
          projectId: 'project_1',
          commandId: 'command_1',
          value: makeRevokedProxy(),
        }),
      () =>
        parseStudioProposalRecordV2({
          projectId: 'project_1',
          proposalId: 'proposal_1',
          value: makeRevokedProxy(),
        }),
      () => parseStudioProposalDecisionV2({ proposalId: 'proposal_1', value: makeRevokedProxy() }),
      () => parseStudioProposalSlotV2(makeRevokedProxy()),
      () =>
        parseStudioReferenceRequestV2({
          projectId: 'project_1',
          requestId: 'request_1',
          value: makeRevokedProxy(),
        }),
      () => parseStudioReferenceRequestSlotV2(makeRevokedProxy()),
      () =>
        parseStudioReferenceRequestDecisionV2({
          projectId: 'project_1',
          requestId: 'request_1',
          value: makeRevokedProxy(),
        }),
      () =>
        parseStudioReferenceGenerationHandoffReceiptV2({
          handoffId: 'handoff_1',
          value: makeRevokedProxy(),
        }),
    ];

    for (const parse of parsers) {
      expect(parse).not.toThrow();
      expect(parse()).toEqual({ status: 'invalid' });
    }
  });
});
