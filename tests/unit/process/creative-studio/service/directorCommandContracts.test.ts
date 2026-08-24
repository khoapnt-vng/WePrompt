/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_CLOCK_SKEW_MS,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_PROJECT_SCHEMA_VERSION,
  isValidProviderJobId,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV2,
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
  parseStudioDirectorCommandReceiptV2,
  parseStudioDirectorCommandSlotLeaseV2,
  parseStudioDirectorCommandSlotV2,
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

const legacyCommand = () => ({
  schemaVersion: 1,
  commandId: 'command_1',
  projectId: 'project_1',
  expectedRevision: 4,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A quieter launch story.' }],
});

const legacySlot = () => ({
  schemaVersion: 1,
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
});

const legacyLease = () => ({
  schemaVersion: 1,
  leaseId: 'lease_1',
  owner: 'writer',
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  acquiredAt: NOW,
  expiresAt: new Date(Date.parse(NOW) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
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
      bin: [{ kind: 'beat', beatId: 'section_1', reason: 'lifted' }],
    },
  ];

  it('accepts the exact schema-2 envelope and every current Director operation', () => {
    expect(operations.map((operation) => parsePendingV2(validCommandV2({ operations: [operation] })).status)).toEqual(
      Array.from({ length: operations.length }, () => 'valid')
    );
    expect(STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2).toBe(STUDIO_PROJECT_SCHEMA_VERSION);
    expect(STUDIO_MAX_MUTATION_OPERATIONS).toBe(32);
  });

  it('does not expose schema-1 command parser entrypoints', () => {
    expect(Reflect.get(directorCommandContracts, 'parseStudioDirectorPendingRecord')).toBeUndefined();
    expect(Reflect.get(directorCommandContracts, 'parseStudioDirectorCommandSlot')).toBeUndefined();
    expect(Reflect.get(directorCommandContracts, 'parseStudioDirectorCommandSlotLease')).toBeUndefined();
    expect(Reflect.get(directorCommandContracts, 'parseStudioDirectorCommandReceipt')).toBeUndefined();

    const source = readFileSync(
      path.resolve(
        process.cwd(),
        'packages/desktop/src/process/services/creative-studio/service/directorCommandContracts.ts'
      ),
      'utf8'
    );
    expect(source).not.toMatch(/export function parseStudioDirectorPendingRecord\s*\(/u);
    expect(source).not.toMatch(/export function parseStudioDirectorCommandSlot\s*\(/u);
    expect(source).not.toMatch(/export function parseStudioDirectorCommandSlotLease\s*\(/u);
    expect(source).not.toMatch(/export function parseStudioDirectorCommandReceipt\s*\(/u);
  });

  it('freezes an exhaustive 30-kind capability table and rejects unknown provenance', () => {
    const expected = {
      edit_project: 'operation_not_permitted',
      set_brief: 'direct',
      set_rules: 'operation_not_permitted',
      set_project_references: 'proposal',
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
      set_hard_cut: 'operation_not_permitted',
      set_seed_still: 'operation_not_permitted',
      set_shot_background_reference: 'operation_not_permitted',
      promote_board_panel: 'operation_not_permitted',
      trim_shot: 'operation_not_permitted',
      redetach_line: 'proposal',
      rederive_line: 'proposal',
      restore_line: 'operation_not_permitted',
      reorder_bin: 'direct',
      set_routes: 'operation_not_permitted',
      set_spend_policy: 'operation_not_permitted',
      set_bed: 'operation_not_permitted',
      undo_last: 'operation_not_permitted',
    } as const satisfies Readonly<
      Record<StudioMutationOperationV2['kind'], 'direct' | 'proposal' | 'operation_not_permitted'>
    >;

    expect(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2).toEqual(expected);
    expect(Object.keys(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)).toHaveLength(30);
    expect(Object.isFrozen(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)).toBe(true);
    for (const [kind, disposition] of Object.entries(expected)) {
      expect(classifyStudioDirectorOperationV2(kind), kind).toBe(disposition);
    }
    for (const unknown of ['set_match_to', 'future_operation', 'constructor', 'toString', '__proto__', null, {}, 1]) {
      expect(classifyStudioDirectorOperationV2(unknown)).toBeNull();
    }
  });

  it.each([
    { kind: 'edit_project', changes: { name: 'Not direct' } },
    { kind: 'park_beat', beatId: 'section_1' },
    { kind: 'set_shot_background_reference', shotId: 'shot_1', referenceId: 'reference_background' },
    { kind: 'set_routes', imageRouteId: null, videoRouteId: null },
    { kind: 'undo_last', entryId: 'mutation_1' },
  ])('rejects the known but unavailable $kind capability', (operation) => {
    expect(parsePendingV2(validCommandV2({ operations: [operation as never] })).status).toBe('invalid');
  });

  it('keeps the executable provider-job identity guard covered', () => {
    expect(isValidProviderJobId('provider_job-1.~')).toBe(true);
    expect(isValidProviderJobId('')).toBe(false);
    expect(isValidProviderJobId(`j${'x'.repeat(512)}`)).toBe(false);
    expect(isValidProviderJobId('https://provider.example/job')).toBe(false);
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
    expect(parsePendingV2(legacyCommand(), { malformed: true })).toEqual({
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
    expect(parsePendingV2({ ...validCommandV2(), schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION + 1 })).toEqual({
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
    expect(parseStudioDirectorCommandSlotV2(legacySlot(), NOW, WAIT_MS)).toEqual({
      status: 'unsupported_prototype_schema',
    });
    expect(parseStudioDirectorCommandSlotLeaseV2(validLeaseV2(), NOW, WAIT_MS)).toEqual({
      status: 'valid',
      record: validLeaseV2(),
    });
    expect(parseStudioDirectorCommandSlotLeaseV2(legacyLease(), NOW, WAIT_MS)).toEqual({
      status: 'unsupported_prototype_schema',
    });
  });

  it.each([
    ['slot unknown key', () => parseStudioDirectorCommandSlotV2({ ...validSlotV2(), extra: true }, NOW, WAIT_MS)],
    [
      'slot unknown version',
      () =>
        parseStudioDirectorCommandSlotV2(
          { ...validSlotV2(), schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION + 1 },
          NOW,
          WAIT_MS
        ),
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
    const legacy = {
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

  it('accepts exact mutation-batch, project-reference, legacy hard-cut, and pin-rule proposals', () => {
    const projectReferences: StudioProposalRecordV2 = {
      ...mutationProposal,
      id: 'proposal_references',
      payload: {
        kind: 'mutation_batch',
        operations: [
          {
            kind: 'set_project_references',
            references: [
              {
                id: 'ref_ming',
                kind: 'character',
                label: 'Ming',
                prompt: 'Character turnaround sheet for Ming.',
                shotIds: ['clip_1'],
              },
            ],
          },
        ],
      },
    };
    const legacyHardCut: StudioProposalRecordV2 = {
      ...mutationProposal,
      id: 'proposal_hard_cut',
      payload: {
        kind: 'mutation_batch',
        operations: [{ kind: 'set_hard_cut', shotId: 'shot_2', hardCut: true }],
      },
    };
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
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_references',
        value: projectReferences,
      })
    ).toEqual({ status: 'valid', record: projectReferences });
    expect(
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_hard_cut',
        value: legacyHardCut,
      })
    ).toEqual({ status: 'valid', record: legacyHardCut });
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

  it('accepts the bounded ordered unique project-reference IDs and rejects empty, oversized, or duplicates', () => {
    const maximumReferences = Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES }, (_, index) => `ref_${index}`);
    const reference = (referenceIds: string[]): StudioReferenceRequestV2 => ({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      id: 'request_1',
      projectId: 'project_1',
      referenceIds,
      status: 'pending',
      createdAt: NOW,
    });
    const parse = (referenceIds: string[]) =>
      parseStudioReferenceRequestV2({
        projectId: 'project_1',
        requestId: 'request_1',
        value: reference(referenceIds),
      });

    expect(parse(['ref_1'])).toMatchObject({ status: 'valid' });
    expect(parse(['constructor', 'toString', '__proto__'])).toMatchObject({ status: 'valid' });
    expect(parse(maximumReferences)).toEqual({ status: 'valid', record: reference(maximumReferences) });
    expect(parse([])).toEqual({ status: 'invalid' });
    expect(parse([...maximumReferences, 'ref_extra'])).toEqual({ status: 'invalid' });
    expect(parse(['ref_1', 'ref_1'])).toEqual({ status: 'invalid' });
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
      referenceIds: ['ref_1'],
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
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: ['ref_2', 'ref_1'] },
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
      outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: ['ref_1', 'ref_2'] },
    };
    const parse = (value: unknown, projectId = 'project_1', requestId = 'request_1') =>
      parseStudioReferenceRequestDecisionV2({ projectId, requestId, value });
    const sparseReferenceIds = Array(2) as string[];
    sparseReferenceIds[1] = 'ref_1';
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
        outcome: { kind: 'generation_gate', handoffId: 'unsafe/handoff', referenceIds: ['ref_1'] },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: [] },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: ['ref_1', 'ref_1'] },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: sparseReferenceIds },
      },
      {
        ...generationDecision,
        outcome: { kind: 'generation_gate', handoffId: 'handoff_1', referenceIds: ['ref_1'], extra: true },
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
