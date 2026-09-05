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
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2,
  STUDIO_MAX_MUTATION_OPERATIONS,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  isValidProviderJobId,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorFreeRecoveryCommandRecordV2,
  type StudioDirectorQueryCommandRecordV2,
  type StudioDirectorCommandSlotLeaseV2,
  type StudioDirectorCommandSlotV2,
  type StudioMutationOperationV2,
  type StudioProposalDecisionV2,
  type StudioProposalRecordV2,
  type StudioProposalSlotV2,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestSlotV2,
  type StudioReferenceRequestV2,
  type StudioProjectStatusV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import * as directorCommandContracts from '@process/services/creative-studio/service/directorCommandContracts';
import {
  classifyStudioDirectorOperationV2,
  isStudioDirectorFreeRecoveryCommandV2,
  isStudioDirectorQueryCommandV2,
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
  studioDirectorCommandReceiptMatchesRecordV2,
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
  shootingScript: '',
  durationSeconds: 5,
});

const validCommandV2 = (overrides: Partial<StudioDirectorCommandRecordV2> = {}): StudioDirectorCommandRecordV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId: 'command_1',
  projectId: 'project_1',
  expectedRevision: 4,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A quieter launch story.' }],
  ...overrides,
});

const validFreeRecoveryCommandV2 = (
  overrides: Partial<StudioDirectorFreeRecoveryCommandRecordV2> = {}
): StudioDirectorFreeRecoveryCommandRecordV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId: 'command_1',
  projectId: 'project_1',
  expectedRevision: 4,
  createdAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'apply_free_fix',
  recovery: { op: 'retry_conditioning_frame', dependentShotId: 'shot_2' },
  ...overrides,
});

const validSlotV2 = (overrides: Partial<StudioDirectorCommandSlotV2> = {}): StudioDirectorCommandSlotV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId: 'command_1',
  reservedAt: NOW,
  deadlineAt: '2026-08-16T12:00:15.000Z',
  ...overrides,
});

const validLeaseV2 = (overrides: Partial<StudioDirectorCommandSlotLeaseV2> = {}): StudioDirectorCommandSlotLeaseV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
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

const validQueryCommandV2 = (
  policy: 'get_project_status' | 'list_routes' | 'get_proposal',
  detail = false
): StudioDirectorQueryCommandRecordV2 =>
  policy === 'get_project_status'
    ? {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: 'command_1',
        projectId: 'project_1',
        createdAt: NOW,
        deadlineAt: '2026-08-16T12:00:15.000Z',
        policy,
        detail,
      }
    : policy === 'list_routes'
      ? {
          schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
          commandId: 'command_1',
          projectId: 'project_1',
          createdAt: NOW,
          deadlineAt: '2026-08-16T12:00:15.000Z',
          policy,
        }
      : {
          schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
          commandId: 'command_1',
          projectId: 'project_1',
          createdAt: NOW,
          deadlineAt: '2026-08-16T12:00:15.000Z',
          policy,
          proposalId: 'proposal_exact_2',
        };

const validProjectStatusV2 = (detail = false): StudioProjectStatusV2 => ({
  projectId: 'project_1',
  projectRevision: 4,
  catalogVersion: '0123456789abcdef',
  stages: [
    { id: 'brief', state: 'complete', summary: { stage: 'brief', hasBrief: true }, blockers: [] },
    {
      id: 'engines',
      state: 'complete',
      summary: { stage: 'engines', image: 'ready', video: 'ready' },
      blockers: [],
    },
    {
      id: 'references',
      state: 'complete',
      summary: { stage: 'references', plannedCount: 0, approvedCount: 0 },
      blockers: [],
    },
    {
      id: 'storyboard',
      state: 'not_started',
      summary: {
        stage: 'storyboard',
        beatCount: 0,
        shotCount: 0,
        authoredShotCount: 0,
        plannedSeconds: 0,
        targetSeconds: 30,
      },
      blockers: [],
    },
    {
      id: 'bindings',
      state: 'not_started',
      summary: { stage: 'bindings', readyShotCount: 0, shotCount: 0, maxConditioningImages: 3 },
      blockers: [],
    },
    {
      id: 'production',
      state: 'not_started',
      summary: { stage: 'production', currentTakeCount: 0, shotCount: 0, activeJobCount: 0 },
      blockers: [],
    },
    {
      id: 'cut',
      state: 'not_started',
      summary: {
        stage: 'cut',
        currentTakeCount: 0,
        shotCount: 0,
        durationSeconds: null,
        targetSeconds: 30,
        structurallyPlayable: false,
      },
      blockers: [],
    },
  ],
  blockerCount: 0,
  advisories: [{ cause: 'next_action', stage: 'storyboard' }],
  boards: { currentPictureCount: 0, shotCount: 0 },
  detail: detail ? { shots: [], references: [] } : null,
});

const routeEntryV2 = (role: 'image' | 'video', suffix: string) => ({
  choiceId: `choice_${suffix.padStart(24, '0')}`,
  providerId: `provider_${role}`,
  providerName: role === 'image' ? 'Image provider' : 'Video provider',
  model: role === 'image' ? 'image-model' : 'video-model',
  integrationLabelKey: role === 'image' ? ('imageApi' as const) : ('bytePlusSeedance' as const),
  health: 'available' as const,
  kind: role,
  constraints: {
    aspectRatios: ['16:9' as const],
    resolutions: ['1080p' as const],
    minDurationSeconds: 4,
    maxDurationSeconds: 8,
    supportedDurationSeconds: [4, 8],
    supportsFirstFrame: role === 'video',
    maxConditioningImages: role === 'image' ? 3 : 0,
    silentOutput: role === 'video',
  },
});

const validRouteCatalogV2 = (): StudioRouteCatalogV2 => {
  const image = routeEntryV2('image', '1');
  const video = routeEntryV2('video', '2');
  return {
    catalogVersion: 'fedcba9876543210',
    image: {
      status: 'ready',
      selected: { choiceId: image.choiceId, providerId: image.providerId, model: image.model },
      selectedRoute: image,
      selectionIssue: null,
      options: [image],
    },
    video: {
      status: 'ready',
      selected: { choiceId: video.choiceId, providerId: video.providerId, model: video.model },
      selectedRoute: video,
      selectionIssue: null,
      options: [video],
    },
  };
};

const parseReceiptV2 = (value: unknown) =>
  parseStudioDirectorCommandReceiptV2({ projectId: 'project_1', commandId: 'command_1', value });

describe('Studio Director V2 command contracts', () => {
  const operations: StudioMutationOperationV2[] = [
    { kind: 'set_brief', brief: '' },
    {
      kind: 'add_beat',
      beatId: 'section_new',
      beat: { title: 'Opening', story: 'Establish the place in morning light.', targetSeconds: null },
      beforeBeatId: null,
    },
    { kind: 'edit_beat', beatId: 'section_1', changes: { story: 'A quieter opening.' } },
    { kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] },
    {
      kind: 'add_shot',
      beatId: 'section_1',
      shotId: 'clip_new',
      shot: emptyShotV2(),
      beforeShotId: null,
    },
    { kind: 'edit_shot', shotId: 'clip_1', changes: { shootingScript: 'Dialogue: Hello.' } },
    { kind: 'delete_shot', shotId: 'clip_1' },
    { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_2', 'clip_1'] },
    {
      kind: 'reorder_bin',
      bin: [{ kind: 'beat', beatId: 'section_1', reason: 'lifted' }],
    },
  ];

  it('accepts exact direct commands and keeps proposal operations out of the durable direct-command lane', () => {
    expect(operations.map((operation) => parsePendingV2(validCommandV2({ operations: [operation] })).status)).toEqual(
      operations.map((operation) =>
        classifyStudioDirectorOperationV2(operation.kind) === 'direct' ? 'valid' : 'invalid'
      )
    );
    for (const operation of [
      {
        kind: 'set_reference_plan' as const,
        references: [
          {
            kind: 'character' as const,
            label: 'Ming',
            prompt: 'Character reference for Ming.',
          },
        ],
      },
      {
        kind: 'amend_reference_plan' as const,
        additions: [
          {
            kind: 'background' as const,
            label: 'Dai pai dong',
            prompt: 'Recurring dai-pai-dong background.',
          },
        ],
      },
      {
        kind: 'set_shot_reference_binding' as const,
        shotId: 'clip_1',
        characterReferenceIds: ['ref_ming'],
        backgroundReferenceId: null,
      },
    ]) {
      expect(parsePendingV2(validCommandV2({ operations: [operation] })).status).toBe('valid');
    }
    expect(STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2).toBe(9);
    expect(STUDIO_MAX_MUTATION_OPERATIONS).toBe(32);
  });

  it('accepts both exact free recoveries as writes outside the reducer and query lanes', () => {
    const commands: StudioDirectorFreeRecoveryCommandRecordV2[] = [
      validFreeRecoveryCommandV2(),
      validFreeRecoveryCommandV2({ recovery: { op: 'terminalize_refused_job', jobId: 'job_refused_1' } }),
    ];

    for (const command of commands) {
      expect(parsePendingV2(command)).toEqual({ status: 'valid', record: command });
      expect(isStudioDirectorFreeRecoveryCommandV2(command)).toBe(true);
      expect(isStudioDirectorQueryCommandV2(command)).toBe(false);
    }
  });

  it('keeps the direct free-recovery inventory exact and outside reference-binding authority', () => {
    expect(Object.isFrozen(STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2)).toBe(true);
    expect(STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2).toEqual({
      retry_conditioning_frame: 'direct',
      terminalize_refused_job: 'direct',
    });
    expect(STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2).not.toHaveProperty('set_shot_reference_binding');
    expect(STUDIO_DIRECTOR_FREE_RECOVERY_DISPOSITIONS_V2).not.toHaveProperty('acknowledge_possible_duplicate_charge');
  });

  it.each([
    [
      'extra command fields',
      { ...validFreeRecoveryCommandV2(), operations: [{ kind: 'set_brief', brief: 'Cross-shape' }] },
    ],
    [
      'extra recovery fields',
      {
        ...validFreeRecoveryCommandV2(),
        recovery: { op: 'retry_conditioning_frame', dependentShotId: 'shot_2', jobId: 'job_1' },
      },
    ],
    [
      'a cross-shaped conditioning recovery',
      { ...validFreeRecoveryCommandV2(), recovery: { op: 'retry_conditioning_frame', jobId: 'job_1' } },
    ],
    [
      'a cross-shaped refused-job recovery',
      {
        ...validFreeRecoveryCommandV2(),
        recovery: { op: 'terminalize_refused_job', dependentShotId: 'shot_2' },
      },
    ],
    [
      'duplicate-charge acknowledgement authority',
      {
        ...validFreeRecoveryCommandV2(),
        recovery: { op: 'terminalize_refused_job', jobId: 'job_1', acknowledgePossibleDuplicateCharge: true },
      },
    ],
    [
      'a status-only binding remedy',
      { ...validFreeRecoveryCommandV2(), recovery: { op: 'set_shot_reference_binding', shotId: 'shot_2' } },
    ],
    [
      'an unsafe target identity',
      { ...validFreeRecoveryCommandV2(), recovery: { op: 'terminalize_refused_job', jobId: '../job_1' } },
    ],
  ])('rejects %s from the bounded free-recovery lane', (_label, command) => {
    expect(parsePendingV2(command)).toMatchObject({ status: 'invalid', reasonCode: 'malformed_record' });
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

  it('freezes the exhaustive schema-5 capability table and rejects unknown provenance', () => {
    const expected = {
      edit_project: 'operation_not_permitted',
      set_brief: 'direct',
      set_rules: 'operation_not_permitted',
      set_reference_plan: 'direct',
      amend_reference_plan: 'direct',
      set_reference_label: 'operation_not_permitted',
      set_reference_prompt: 'operation_not_permitted',
      select_reference_image: 'operation_not_permitted',
      remove_reference_image: 'operation_not_permitted',
      set_shot_reference_binding: 'direct',
      add_beat: 'proposal',
      edit_beat: 'proposal',
      reorder_beats: 'direct',
      park_beat: 'operation_not_permitted',
      restore_beat: 'operation_not_permitted',
      add_binned_beat: 'proposal',
      add_shot: 'proposal',
      edit_shot: 'proposal',
      delete_shot: 'proposal',
      park_shot: 'operation_not_permitted',
      restore_shot: 'operation_not_permitted',
      reorder_shots: 'direct',
      apply_coverage: 'proposal',
      set_hard_cut: 'operation_not_permitted',
      set_seed_still: 'operation_not_permitted',
      dismiss_seed_still: 'operation_not_permitted',
      promote_board_panel: 'operation_not_permitted',
      trim_shot: 'operation_not_permitted',
      reorder_bin: 'direct',
      set_routes: 'operation_not_permitted',
      set_spend_policy: 'operation_not_permitted',
      set_bed: 'operation_not_permitted',
      undo_last: 'operation_not_permitted',
    } as const satisfies Readonly<
      Record<StudioMutationOperationV2['kind'], 'direct' | 'proposal' | 'operation_not_permitted'>
    >;

    expect(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2).toEqual(expected);
    expect(Object.keys(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)).toHaveLength(33);
    expect(Object.isFrozen(STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2)).toBe(true);
    for (const [kind, disposition] of Object.entries(expected)) {
      expect(classifyStudioDirectorOperationV2(kind), kind).toBe(disposition);
    }
    for (const unknown of [
      'select_video_take',
      'remove_video_take',
      'set_match_to',
      'future_operation',
      'constructor',
      'toString',
      '__proto__',
      null,
      {},
      1,
    ]) {
      expect(classifyStudioDirectorOperationV2(unknown)).toBeNull();
    }
  });

  it('requires human review before the Director can delete a Shot', () => {
    const operation = { kind: 'delete_shot' as const, shotId: 'clip_1' };
    const proposal: StudioProposalRecordV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      id: 'proposal_delete_shot',
      projectId: 'project_1',
      status: 'pending',
      baseRevision: 4,
      payload: { kind: 'mutation_batch', operations: [operation] },
      createdAt: NOW,
      decidedAt: null,
    };

    expect(parsePendingV2(validCommandV2({ operations: [operation as never] })).status).toBe('invalid');
    expect(
      parseStudioProposalRecordV2({
        projectId: proposal.projectId,
        proposalId: proposal.id,
        value: proposal,
      }).status
    ).toBe('valid');
  });

  it.each([
    { kind: 'edit_project', changes: { name: 'Not direct' } },
    { kind: 'park_beat', beatId: 'section_1' },
    { kind: 'set_reference_label', referenceId: 'reference_1', label: 'Human name' },
    { kind: 'set_reference_prompt', referenceId: 'reference_1', prompt: 'A human edit' },
    { kind: 'select_reference_image', referenceId: 'reference_1', assetId: 'asset_1' },
    { kind: 'remove_reference_image', referenceId: 'reference_1', assetId: 'asset_1' },
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
            beat: { title: '', story: '', rawPath: '/private/tmp/secret' },
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
        operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: { shootingScript: 'x', jobIds: [] } } as never],
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

  it('enforces V2 authored bounds, safe identities, and integral shot durations across direct and proposal records', () => {
    const validShot = {
      kind: 'add_shot' as const,
      beatId: 'section_1',
      shotId: 'clip_video',
      shot: { ...emptyShotV2(), durationSeconds: 4 },
      beforeShotId: null,
    };

    const proposal = (operation: unknown) => ({
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      id: 'proposal_shot',
      projectId: 'project_1',
      status: 'pending',
      baseRevision: 4,
      payload: { kind: 'mutation_batch', operations: [operation] },
      createdAt: NOW,
      decidedAt: null,
    });
    const parseProposal = (operation: unknown) =>
      parseStudioProposalRecordV2({
        projectId: 'project_1',
        proposalId: 'proposal_shot',
        value: proposal(operation),
      });

    expect(parseProposal(validShot).status).toBe('valid');
    expect(parseProposal({ ...validShot, shot: { ...validShot.shot, durationSeconds: 3.5 } }).status).toBe('invalid');
    expect(parseProposal({ ...validShot, shotId: '../unsafe' }).status).toBe('invalid');
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

  it('treats the immediate-prior schema-8 free-recovery family as unsupported without migration', () => {
    const command = { ...validFreeRecoveryCommandV2(), schemaVersion: 8 };
    const slot = { ...validSlotV2(), schemaVersion: 8 };
    const lease = { ...validLeaseV2(), schemaVersion: 8 };
    const receipt = {
      schemaVersion: 8,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'applied',
      appliedRevision: 5,
      recovery: { op: 'retry_conditioning_frame', dependentShotId: 'shot_2' },
    };

    expect(parsePendingV2(command, slot)).toEqual({
      status: 'unsupported_prototype_schema',
      commandId: 'command_1',
      expectedRevision: 4,
    });
    expect(parseStudioDirectorCommandSlotV2(slot, NOW, WAIT_MS)).toEqual({
      status: 'unsupported_prototype_schema',
    });
    expect(parseStudioDirectorCommandSlotLeaseV2(lease, NOW, WAIT_MS)).toEqual({
      status: 'unsupported_prototype_schema',
    });
    expect(parseReceiptV2(receipt)).toEqual({ status: 'unsupported_prototype_schema' });
  });

  it('distinguishes unknown versions from malformed schema-2 records', () => {
    expect(
      parsePendingV2({ ...validCommandV2(), schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 + 1 })
    ).toEqual({
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
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
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

describe('Studio Director V2 read-query contracts', () => {
  it('accepts only exact normalized status, route, and proposal commands while sidecar versions remain independent', () => {
    const status = validQueryCommandV2('get_project_status', true);
    const routes = validQueryCommandV2('list_routes');
    const proposal = validQueryCommandV2('get_proposal');

    expect(parsePendingV2(status)).toEqual({ status: 'valid', record: status });
    expect(parsePendingV2(routes)).toEqual({ status: 'valid', record: routes });
    expect(parsePendingV2(proposal)).toEqual({ status: 'valid', record: proposal });
    expect(parsePendingV2({ ...status, detail: undefined })).toMatchObject({ status: 'invalid' });
    expect(parsePendingV2({ ...status, expectedRevision: 4 })).toMatchObject({ status: 'invalid' });
    expect(parsePendingV2({ ...routes, detail: false })).toMatchObject({ status: 'invalid' });
    expect(parsePendingV2({ ...proposal, proposalId: '../unsafe' })).toMatchObject({ status: 'invalid' });
    expect(parsePendingV2({ ...proposal, detail: false })).toMatchObject({ status: 'invalid' });
    expect(STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2).toBe(9);
    expect(STUDIO_PROPOSAL_SCHEMA_VERSION_V2).toBe(5);
    expect(STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION).toBe(5);
    expect(STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES).toBeGreaterThan(256 * 1024);
  });

  it('accepts exact pending, no-longer-pending, and missing proposal answers and rejects cross-ID results', () => {
    const command = validQueryCommandV2('get_proposal');
    const proposal: StudioProposalRecordV2 = {
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
      id: 'proposal_exact_2',
      projectId: 'project_1',
      status: 'pending',
      baseRevision: 4,
      payload: {
        kind: 'mutation_batch',
        operations: [{ kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: 'Exact proposal.' } }],
      },
      createdAt: NOW,
      decidedAt: null,
    };
    const base = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered' as const,
      query: { kind: 'get_proposal' as const, proposalId: proposal.id },
    };
    const receipts = [
      { ...base, result: { status: 'pending' as const, proposal } },
      {
        ...base,
        result: { status: 'no_longer_pending' as const, proposalId: proposal.id, decision: 'accepted' as const },
      },
      { ...base, result: { status: 'not_found' as const } },
    ];

    for (const receipt of receipts) expect(parseReceiptV2(receipt)).toEqual({ status: 'valid', record: receipt });
    expect(studioDirectorCommandReceiptMatchesRecordV2(receipts[0], command)).toBe(true);
    expect(
      parseReceiptV2({
        ...base,
        result: { status: 'pending', proposal: { ...proposal, id: 'proposal_other' } },
      })
    ).toEqual({ status: 'invalid' });
    expect(
      parseReceiptV2({
        ...base,
        result: { status: 'no_longer_pending', proposalId: 'proposal_other', decision: 'rejected' },
      })
    ).toEqual({ status: 'invalid' });
    expect(
      parseReceiptV2({
        ...base,
        query: { kind: 'get_proposal', proposalId: 'proposal_other' },
        result: receipts[0].result,
      })
    ).toEqual({ status: 'invalid' });
  });

  it('reserves the larger receipt ceiling exclusively for answered exact-proposal reads', () => {
    const longText = 'x'.repeat(256);
    const route = (role: 'image' | 'video', index: number) => ({
      choiceId: `choice_${index.toString(16).padStart(24, '0')}`,
      providerId: `provider_${index}`,
      providerName: longText,
      model: longText,
      integrationLabelKey: role === 'image' ? ('imageApi' as const) : ('bytePlusSeedance' as const),
      health: 'available' as const,
      kind: role,
      constraints: {
        aspectRatios: ['16:9' as const],
        resolutions: ['1080p' as const],
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportedDurationSeconds: [4, 8],
        supportsFirstFrame: role === 'video',
        maxConditioningImages: role === 'image' ? 3 : 0,
        silentOutput: role === 'video',
      },
    });
    let oversizedRoutes: StudioDirectorCommandReceiptV2 | null = null;
    for (let count = 1; count <= 256; count += 1) {
      const imageOptions = Array.from({ length: count }, (_, index) => route('image', index));
      const videoOptions = Array.from({ length: count }, (_, index) => route('video', index + 256));
      const image = imageOptions[0]!;
      const video = videoOptions[0]!;
      const candidate: StudioDirectorCommandReceiptV2 = {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: 'command_1',
        projectId: 'project_1',
        decidedAt: NOW,
        status: 'answered',
        query: { kind: 'list_routes' },
        result: {
          catalogVersion: 'fedcba9876543210',
          image: {
            status: 'ready',
            selected: { choiceId: image.choiceId, providerId: image.providerId, model: image.model },
            selectedRoute: image,
            selectionIssue: null,
            options: imageOptions,
          },
          video: {
            status: 'ready',
            selected: { choiceId: video.choiceId, providerId: video.providerId, model: video.model },
            selectedRoute: video,
            selectionIssue: null,
            options: videoOptions,
          },
        },
      };
      const bytes = Buffer.byteLength(JSON.stringify(candidate), 'utf8');
      if (bytes > STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES) {
        let bytesToTrim = bytes - (STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES + 1);
        for (const option of [...imageOptions.slice(1), ...videoOptions.slice(1)]) {
          for (const field of ['providerName', 'model'] as const) {
            const trim = Math.min(bytesToTrim, option[field].length - 1);
            option[field] = option[field].slice(0, option[field].length - trim);
            bytesToTrim -= trim;
            if (bytesToTrim === 0) break;
          }
          if (bytesToTrim === 0) break;
        }
        expect(bytesToTrim).toBe(0);
        expect(Buffer.byteLength(JSON.stringify(candidate), 'utf8')).toBe(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES + 1);
        const controlOption = videoOptions.at(-1)!;
        controlOption.model = controlOption.model.slice(0, -1);
        expect(Buffer.byteLength(JSON.stringify(candidate), 'utf8')).toBe(STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES);
        expect(parseReceiptV2(candidate)).toEqual({ status: 'valid', record: candidate });
        controlOption.model += 'x';
        expect(Buffer.byteLength(JSON.stringify(candidate.result), 'utf8')).toBeLessThanOrEqual(
          STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES
        );
        oversizedRoutes = candidate;
        break;
      }
    }
    expect(oversizedRoutes).not.toBeNull();
    expect(parseReceiptV2(oversizedRoutes)).toEqual({ status: 'invalid' });

    const oversizedProposal = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_proposal', proposalId: 'proposal_exact_2' },
      result: {
        status: 'pending',
        proposal: {
          schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
          id: 'proposal_exact_2',
          projectId: 'project_1',
          status: 'pending',
          baseRevision: 4,
          payload: {
            kind: 'mutation_batch',
            operations: [
              {
                kind: 'set_brief',
                brief: 'x'.repeat(STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES),
              },
            ],
          },
          createdAt: NOW,
          decidedAt: null,
        },
      },
    };
    expect(Buffer.byteLength(JSON.stringify(oversizedProposal), 'utf8')).toBeGreaterThan(
      STUDIO_DIRECTOR_COMMAND_MAX_RECEIPT_BYTES
    );
    expect(parseReceiptV2(oversizedProposal)).toEqual({ status: 'invalid' });
  });

  it('accepts exact answered, failed, and expired query receipts and correlates immutable query identity', () => {
    const statusCommand = validQueryCommandV2('get_project_status', true);
    const routeCommand = validQueryCommandV2('list_routes');
    const statusReceipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: true },
      result: validProjectStatusV2(true),
    };
    const routeReceipt: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'list_routes' },
      result: validRouteCatalogV2(),
    };
    const failed: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'failed',
      query: { kind: 'get_project_status', detail: true },
      reasonCode: 'project_read_unavailable',
    };
    const expired: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'expired',
      query: { kind: 'list_routes' },
      reasonCode: 'deadline_elapsed',
    };

    for (const receipt of [statusReceipt, routeReceipt, failed, expired]) {
      expect(parseReceiptV2(receipt)).toEqual({ status: 'valid', record: receipt });
    }
    expect(studioDirectorCommandReceiptMatchesRecordV2(statusReceipt, statusCommand)).toBe(true);
    expect(studioDirectorCommandReceiptMatchesRecordV2(routeReceipt, routeCommand)).toBe(true);
    expect(
      studioDirectorCommandReceiptMatchesRecordV2(
        { ...statusReceipt, query: { kind: 'get_project_status', detail: false } },
        statusCommand
      )
    ).toBe(false);
    expect(studioDirectorCommandReceiptMatchesRecordV2(routeReceipt, statusCommand)).toBe(false);
  });

  it('rejects a status result whose detail or catalog digest contradicts the exact query', () => {
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: false },
      result: validProjectStatusV2(false),
    } as const;

    expect(parseReceiptV2(receipt).status).toBe('valid');
    expect(
      parseReceiptV2({ ...receipt, result: { ...receipt.result, detail: { shots: [], references: [] } } })
    ).toEqual({ status: 'invalid' });
    for (const catalogVersion of ['abc', 'ABCDEF0123456789', '0123456789abcdeg', 'x'.repeat(512)]) {
      expect(parseReceiptV2({ ...receipt, result: { ...receipt.result, catalogVersion } })).toEqual({
        status: 'invalid',
      });
    }
  });

  it('recursively rejects authority-bearing status fields and impossible aggregate counts', () => {
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: false },
      result: validProjectStatusV2(false),
    };
    const withSecret = structuredClone(receipt);
    Object.assign(withSecret.result.stages[0]!.summary, { rawPrompt: 'secret' });
    const countMismatch = structuredClone(receipt);
    countMismatch.result.stages.find((stage) => stage.id === 'storyboard')!.summary.shotCount = 1;
    const blockedWithoutBlocker = structuredClone(receipt);
    blockedWithoutBlocker.result.stages[0]!.state = 'blocked';
    const contradictoryBrief = structuredClone(receipt);
    contradictoryBrief.result.stages.find((stage) => stage.id === 'brief')!.summary.hasBrief = false;
    const contradictoryEngines = structuredClone(receipt);
    contradictoryEngines.result.stages.find((stage) => stage.id === 'engines')!.summary.image = 'unavailable';
    const impossibleProduction = structuredClone(receipt);
    impossibleProduction.result.stages.find((stage) => stage.id === 'production')!.state = 'complete';
    const relabeledReferences = structuredClone(receipt);
    relabeledReferences.result.stages.find((stage) => stage.id === 'references')!.state = 'in_progress';
    relabeledReferences.result.advisories = [{ cause: 'next_action', stage: 'references' }];
    const relabeledStoryboard = structuredClone(receipt);
    relabeledStoryboard.result.stages.find((stage) => stage.id === 'storyboard')!.state = 'in_progress';
    const relabeledBindings = structuredClone(receipt);
    relabeledBindings.result.stages.find((stage) => stage.id === 'bindings')!.state = 'in_progress';
    const relabeledCut = structuredClone(receipt);
    relabeledCut.result.stages.find((stage) => stage.id === 'cut')!.state = 'in_progress';
    const relabeledEmptyBrief = structuredClone(receipt);
    const emptyBrief = relabeledEmptyBrief.result.stages.find((stage) => stage.id === 'brief')!;
    emptyBrief.state = 'in_progress';
    emptyBrief.summary = { stage: 'brief', hasBrief: false };
    relabeledEmptyBrief.result.advisories = [{ cause: 'next_action', stage: 'brief' }];

    const orphanStoryboardCounts = structuredClone(receipt);
    const orphanStoryboard = orphanStoryboardCounts.result.stages.find((stage) => stage.id === 'storyboard')!;
    orphanStoryboard.state = 'not_started';
    orphanStoryboard.summary = {
      stage: 'storyboard',
      beatCount: 0,
      shotCount: 4,
      authoredShotCount: 4,
      plannedSeconds: 18,
      targetSeconds: 30,
    };
    const orphanBindings = orphanStoryboardCounts.result.stages.find((stage) => stage.id === 'bindings')!;
    orphanBindings.state = 'complete';
    orphanBindings.summary = { stage: 'bindings', readyShotCount: 4, shotCount: 4, maxConditioningImages: 3 };
    orphanStoryboardCounts.result.stages.find((stage) => stage.id === 'production')!.summary = {
      stage: 'production',
      currentTakeCount: 0,
      shotCount: 4,
      activeJobCount: 0,
    };
    orphanStoryboardCounts.result.stages.find((stage) => stage.id === 'cut')!.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 4,
      durationSeconds: null,
      targetSeconds: 30,
      structurallyPlayable: false,
    };
    orphanStoryboardCounts.result.boards.shotCount = 4;

    const playableWithoutTakes = structuredClone(receipt);
    const playableStoryboard = playableWithoutTakes.result.stages.find((stage) => stage.id === 'storyboard')!;
    playableStoryboard.state = 'complete';
    playableStoryboard.summary = {
      stage: 'storyboard',
      beatCount: 1,
      shotCount: 4,
      authoredShotCount: 4,
      plannedSeconds: 30,
      targetSeconds: 30,
    };
    const playableBindings = playableWithoutTakes.result.stages.find((stage) => stage.id === 'bindings')!;
    playableBindings.state = 'complete';
    playableBindings.summary = { stage: 'bindings', readyShotCount: 4, shotCount: 4, maxConditioningImages: 3 };
    playableWithoutTakes.result.stages.find((stage) => stage.id === 'production')!.summary = {
      stage: 'production',
      currentTakeCount: 0,
      shotCount: 4,
      activeJobCount: 0,
    };
    const playableCut = playableWithoutTakes.result.stages.find((stage) => stage.id === 'cut')!;
    playableCut.state = 'complete';
    playableCut.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 4,
      durationSeconds: 30,
      targetSeconds: 30,
      structurallyPlayable: true,
    };
    playableWithoutTakes.result.boards.shotCount = 4;
    playableWithoutTakes.result.advisories = [{ cause: 'next_action', stage: 'production' }];

    const plannedTimeWithoutShots = structuredClone(receipt);
    const noShotStoryboard = plannedTimeWithoutShots.result.stages.find((stage) => stage.id === 'storyboard')!;
    noShotStoryboard.state = 'in_progress';
    noShotStoryboard.summary = {
      stage: 'storyboard',
      beatCount: 1,
      shotCount: 0,
      authoredShotCount: 0,
      plannedSeconds: 18,
      targetSeconds: 30,
    };

    const playableSlateWithoutBeat = structuredClone(receipt);
    const falseSlateCut = playableSlateWithoutBeat.result.stages.find((stage) => stage.id === 'cut')!;
    falseSlateCut.state = 'complete';
    falseSlateCut.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 0,
      durationSeconds: 30,
      targetSeconds: 30,
      structurallyPlayable: true,
    };

    const allTakesButUnplayable = structuredClone(playableWithoutTakes);
    const allTakeProduction = allTakesButUnplayable.result.stages.find((stage) => stage.id === 'production')!;
    allTakeProduction.state = 'complete';
    allTakeProduction.summary = { stage: 'production', currentTakeCount: 4, shotCount: 4, activeJobCount: 0 };
    const unplayableCut = allTakesButUnplayable.result.stages.find((stage) => stage.id === 'cut')!;
    unplayableCut.state = 'in_progress';
    unplayableCut.summary = {
      stage: 'cut',
      currentTakeCount: 4,
      shotCount: 4,
      durationSeconds: 30,
      targetSeconds: 30,
      structurallyPlayable: false,
    };
    allTakesButUnplayable.result.advisories = [{ cause: 'next_action', stage: 'cut' }];

    for (const invalid of [
      withSecret,
      countMismatch,
      blockedWithoutBlocker,
      contradictoryBrief,
      contradictoryEngines,
      impossibleProduction,
      relabeledReferences,
      relabeledStoryboard,
      relabeledBindings,
      relabeledCut,
      relabeledEmptyBrief,
      orphanStoryboardCounts,
      playableWithoutTakes,
      plannedTimeWithoutShots,
      playableSlateWithoutBeat,
      allTakesButUnplayable,
    ]) {
      expect(parseReceiptV2(invalid)).toEqual({ status: 'invalid' });
      expect(JSON.stringify(parseReceiptV2(invalid))).not.toContain('secret');
    }
  });

  it('accepts fieldwise-equivalent routes and rejects contradictory or over-cap catalogs', () => {
    const catalog = validRouteCatalogV2();
    const reordered = structuredClone(catalog);
    const constraints = reordered.image.selectedRoute!.constraints;
    reordered.image.selectedRoute!.constraints = {
      silentOutput: constraints.silentOutput,
      maxConditioningImages: constraints.maxConditioningImages,
      supportsFirstFrame: constraints.supportsFirstFrame,
      supportedDurationSeconds: constraints.supportedDurationSeconds,
      maxDurationSeconds: constraints.maxDurationSeconds,
      minDurationSeconds: constraints.minDurationSeconds,
      resolutions: constraints.resolutions,
      aspectRatios: constraints.aspectRatios,
    };
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'list_routes' },
      result: reordered,
    };
    expect(parseReceiptV2(receipt).status).toBe('valid');

    const contradictions = [
      { ...catalog, image: { ...catalog.image, status: 'selection_required' } },
      { ...catalog, image: { ...catalog.image, selected: null } },
      {
        ...catalog,
        image: { ...catalog.image, selectedRoute: { ...catalog.image.selectedRoute!, model: 'different' } },
      },
      { ...catalog, catalogVersion: 'not-a-digest' },
    ];
    for (const result of contradictions) {
      expect(parseReceiptV2({ ...receipt, result })).toEqual({ status: 'invalid' });
    }

    const tooMany = validRouteCatalogV2();
    tooMany.image = {
      status: 'selection_required',
      selected: null,
      selectedRoute: null,
      selectionIssue: null,
      options: Array.from({ length: 257 }, (_, index) => routeEntryV2('image', `${index + 1}`)),
    };
    expect(parseReceiptV2({ ...receipt, result: tooMany })).toEqual({ status: 'invalid' });
  });

  it('accepts every bounded route-selection state and continuous-duration route shape', () => {
    const continuous = routeEntryV2('image', '3');
    continuous.health = 'unknown';
    delete (continuous.constraints as Partial<typeof continuous.constraints>).supportedDurationSeconds;
    continuous.constraints.minDurationSeconds = 1;
    continuous.constraints.maxDurationSeconds = 60;
    const variants: StudioRouteCatalogV2['image'][] = [
      {
        status: 'selection_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [continuous],
      },
      {
        status: 'setup_required',
        selected: null,
        selectedRoute: null,
        selectionIssue: null,
        options: [],
      },
      {
        status: 'unavailable',
        selected: null,
        selectedRoute: null,
        selectionIssue: { code: 'health' },
        options: [],
      },
      {
        status: 'unavailable',
        selected: null,
        selectedRoute: null,
        selectionIssue: { code: 'retired' },
        options: [],
      },
      {
        status: 'unavailable',
        selected: null,
        selectedRoute: null,
        selectionIssue: { code: 'needs_setup', providerName: 'Image provider' },
        options: [],
      },
      {
        status: 'unavailable',
        selected: null,
        selectedRoute: null,
        selectionIssue: { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
        options: [continuous],
      },
    ];
    const baseReceipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'list_routes' },
    } as const;

    for (const image of variants) {
      const result = validRouteCatalogV2();
      result.image = image;
      expect(parseReceiptV2({ ...baseReceipt, result }).status).toBe('valid');
    }
  });

  it('accepts a detailed status spanning every remedy lane and nested diagnostic shape', () => {
    const result = validProjectStatusV2(true);
    result.catalogVersion = null;
    result.advisories = [
      {
        cause: 'target_duration_mismatch',
        stage: 'storyboard',
        actualSeconds: 8,
        targetSeconds: 30,
      },
      {
        cause: 'current_take_stale',
        stage: 'production',
        shotId: 'shot_1',
        staleCauses: ['continuity_stale', 'generation_out_of_date'],
      },
    ];

    const engines = result.stages.find((stage) => stage.id === 'engines')!;
    engines.state = 'blocked';
    engines.summary = { stage: 'engines', image: 'selection_required', video: 'unavailable' };
    engines.blockers = [
      {
        cause: 'route_inventory_unavailable',
        where: { kind: 'project' },
        remedy: { kind: 'owner_only', reason: 'repair_engine_health' },
      },
      {
        cause: 'route_duration_unsupported',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          jobId: null,
        },
        remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
      },
    ];

    const references = result.stages.find((stage) => stage.id === 'references')!;
    references.state = 'blocked';
    references.summary = { stage: 'references', plannedCount: 2, approvedCount: 1 };
    references.blockers = [
      {
        cause: 'reference_generation_required',
        where: { kind: 'reference', referenceId: 'background_1', jobId: null },
        remedy: {
          kind: 'proposal',
          prepare: { kind: 'project_references', referenceIds: ['background_1'] },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ];

    const storyboard = result.stages.find((stage) => stage.id === 'storyboard')!;
    storyboard.state = 'blocked';
    storyboard.summary = {
      stage: 'storyboard',
      beatCount: 1,
      shotCount: 2,
      authoredShotCount: 1,
      plannedSeconds: 8,
      targetSeconds: 30,
    };
    storyboard.blockers = [
      {
        cause: 'shooting_script_required',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          jobId: null,
        },
        remedy: { kind: 'owner_only', reason: 'review_project_data' },
      },
    ];

    const bindings = result.stages.find((stage) => stage.id === 'bindings')!;
    bindings.state = 'blocked';
    bindings.summary = { stage: 'bindings', readyShotCount: 1, shotCount: 2, maxConditioningImages: null };
    bindings.blockers = [
      {
        cause: 'reference_binding_capacity_exceeded',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          jobId: null,
        },
        remedy: { kind: 'free_fix', op: 'set_shot_reference_binding', shotId: 'shot_2' },
      },
    ];

    const production = result.stages.find((stage) => stage.id === 'production')!;
    production.state = 'blocked';
    production.summary = { stage: 'production', currentTakeCount: 1, shotCount: 2, activeJobCount: 1 };
    production.blockers = [
      {
        cause: 'conditioning_frame_required',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          jobId: null,
        },
        remedy: { kind: 'free_fix', op: 'retry_conditioning_frame', dependentShotId: 'shot_2' },
      },
      {
        cause: 'generation_content_rejected',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          jobId: 'job_refused',
        },
        remedy: { kind: 'free_fix', op: 'terminalize_refused_job', jobId: 'job_refused' },
      },
      {
        cause: 'seed_generation_required',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          jobId: null,
        },
        remedy: {
          kind: 'proposal',
          prepare: {
            kind: 'generation',
            baseChoices: [],
            cascadeChoices: [],
            continuityChange: { shotId: 'shot_2', hardCut: true, requiresSeedGeneration: true },
          },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
      {
        cause: 'seed_generation_required',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_1',
          beatPosition: 1,
          shotPosition: 1,
          jobId: null,
        },
        remedy: {
          kind: 'proposal',
          prepare: {
            kind: 'generation',
            baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
            cascadeChoices: [{ target: { kind: 'shot', shotId: 'shot_2' }, purpose: 'board_still' }],
            continuityChange: null,
          },
          estimatedMinorUnits: null,
          currency: null,
        },
      },
    ];

    const cut = result.stages.find((stage) => stage.id === 'cut')!;
    cut.state = 'blocked';
    cut.summary = {
      stage: 'cut',
      currentTakeCount: 1,
      shotCount: 2,
      durationSeconds: 8,
      targetSeconds: 30,
      structurallyPlayable: false,
    };
    cut.blockers = [
      {
        cause: 'cut_invalid_media',
        where: { kind: 'cut' },
        remedy: { kind: 'owner_only', reason: 'edit_cut' },
      },
    ];

    result.boards = { currentPictureCount: 1, shotCount: 2 };
    result.blockerCount = result.stages.reduce((count, stage) => count + stage.blockers.length, 0);
    result.detail = {
      shots: [
        {
          beatId: 'beat_1',
          shotId: 'shot_1',
          beatPosition: 1,
          shotPosition: 1,
          seedStillAssetId: 'seed_1',
          videoAssetId: 'video_1',
          latestGenerationJob: {
            jobId: 'job_video_1',
            purpose: 'video_take',
            status: 'succeeded',
            errorCode: null,
          },
          binding: { status: 'ready', selectedCount: 2, limit: null },
          conditioning: null,
        },
        {
          beatId: 'beat_1',
          shotId: 'shot_2',
          beatPosition: 1,
          shotPosition: 2,
          seedStillAssetId: null,
          videoAssetId: null,
          latestGenerationJob: {
            jobId: 'job_seed_2',
            purpose: 'seed_still',
            status: 'failed',
            errorCode: 'content_rejected',
          },
          binding: { status: 'invalid', reason: 'capacity_exceeded', selectedCount: 4, limit: 3 },
          conditioning: {
            upstreamShotId: 'shot_1',
            recordStatus: 'failed',
            mediaVerified: false,
            extractionId: 'extraction_1',
            errorCode: 'decode_failed',
            attemptCount: 3,
          },
        },
      ],
      references: [
        {
          referenceId: 'character_1',
          kind: 'character',
          approved: true,
          latestJob: { jobId: 'job_character_1', status: 'succeeded', errorCode: null },
        },
        {
          referenceId: 'background_1',
          kind: 'background',
          approved: false,
          latestJob: { jobId: 'job_background_1', status: 'needs_attention', errorCode: 'content_rejected' },
        },
      ],
    };
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: true },
      result,
    } as const;

    expect(parseReceiptV2(receipt)).toEqual({ status: 'valid', record: receipt });
  });

  it.each([
    ['an unknown stage', { cause: 'next_action', stage: 'pilot' }],
    ['a missing stage', { cause: 'next_action' }],
    ['an extra field', { cause: 'next_action', stage: 'production', proposalId: 'proposal_1' }],
  ])('rejects a next-action advisory with %s', (_case, advisory) => {
    const result = validProjectStatusV2(false);
    (result as unknown as { advisories: unknown[] }).advisories = [advisory];
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: false },
      result,
    } as const;

    expect(parseReceiptV2(receipt).status).toBe('invalid');
  });

  it('keeps pre-guidance schema-2 status receipts with no next action readable', () => {
    const result = validProjectStatusV2(false);
    result.advisories = [];
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: false },
      result,
    } as const;

    expect(parseReceiptV2(receipt)).toEqual({ status: 'valid', record: receipt });
  });

  it('accepts a blocked engine stage whose selected routes are otherwise ready', () => {
    const result = validProjectStatusV2(false);
    const engines = result.stages.find((stage) => stage.id === 'engines')!;
    engines.state = 'blocked';
    engines.blockers = [
      {
        cause: 'route_incompatible_frame',
        where: { kind: 'route', routeKind: 'video' },
        remedy: { kind: 'owner_only', reason: 'choose_compatible_engine' },
      },
    ];
    result.blockerCount = 1;
    result.advisories = [];
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: false },
      result,
    } as const;

    expect(parseReceiptV2(receipt)).toEqual({ status: 'valid', record: receipt });
  });

  it.each([
    ['the wrong next stage', [{ cause: 'next_action', stage: 'production' }]],
    [
      'duplicate next actions',
      [
        { cause: 'next_action', stage: 'storyboard' },
        { cause: 'next_action', stage: 'production' },
      ],
    ],
  ])('rejects blocker-free incomplete status with %s', (_case, advisories) => {
    const result = validProjectStatusV2(false);
    (result as unknown as { advisories: unknown[] }).advisories = advisories;
    expect(
      parseReceiptV2({
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: 'command_1',
        projectId: 'project_1',
        decidedAt: NOW,
        status: 'answered',
        query: { kind: 'get_project_status', detail: false },
        result,
      }).status
    ).toBe('invalid');
  });

  it('accepts a Shooting-script blocker only at an exact Shot location', () => {
    const makeReceipt = (where: StudioProjectStatusV2['stages'][number]['blockers'][number]['where']) => {
      const result = validProjectStatusV2(false);
      const storyboard = result.stages.find((stage) => stage.id === 'storyboard')!;
      storyboard.state = 'blocked';
      storyboard.blockers = [
        {
          cause: 'shooting_script_required',
          where,
          remedy: { kind: 'owner_only', reason: 'review_project_data' },
        },
      ];
      result.blockerCount = 1;
      result.advisories = [];
      return {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: 'command_1',
        projectId: 'project_1',
        decidedAt: NOW,
        status: 'answered',
        query: { kind: 'get_project_status', detail: false },
        result,
      } as const;
    };
    const shotWhere = {
      kind: 'shot',
      beatId: 'beat_1',
      shotId: 'shot_1',
      beatPosition: 1,
      shotPosition: 1,
      jobId: null,
    } as const;

    expect(parseReceiptV2(makeReceipt(shotWhere)).status).toBe('valid');
    for (const where of [
      { kind: 'project' },
      { kind: 'route', routeKind: 'image' },
      { kind: 'reference', referenceId: 'reference_1', jobId: null },
      { kind: 'cut' },
    ] as const) {
      expect(parseReceiptV2(makeReceipt(where)).status).toBe('invalid');
    }
  });

  it('keeps current-segment recovery valid when a downstream blocker prepares an earlier Shot root', () => {
    const result = validProjectStatusV2(false);
    const storyboard = result.stages.find((stage) => stage.id === 'storyboard')!;
    storyboard.state = 'in_progress';
    storyboard.summary = {
      stage: 'storyboard',
      beatCount: 1,
      shotCount: 2,
      authoredShotCount: 2,
      plannedSeconds: 8,
      targetSeconds: 30,
    };
    const bindings = result.stages.find((stage) => stage.id === 'bindings')!;
    bindings.state = 'complete';
    bindings.summary = { stage: 'bindings', readyShotCount: 2, shotCount: 2, maxConditioningImages: 3 };
    const production = result.stages.find((stage) => stage.id === 'production')!;
    production.summary = { stage: 'production', currentTakeCount: 0, shotCount: 2, activeJobCount: 0 };
    production.state = 'blocked';
    production.blockers = [
      {
        cause: 'generation_timeout',
        where: {
          kind: 'shot',
          beatId: 'beat_1',
          shotId: 'shot_downstream',
          beatPosition: 0,
          shotPosition: 1,
          jobId: 'job_failed',
        },
        remedy: {
          kind: 'proposal',
          estimatedMinorUnits: null,
          currency: null,
          prepare: {
            kind: 'generation',
            baseChoices: [{ target: { kind: 'shot', shotId: 'shot_root' }, purpose: 'video_take' }],
            cascadeChoices: [],
            continuityChange: null,
          },
        },
      },
    ];
    const cut = result.stages.find((stage) => stage.id === 'cut')!;
    cut.summary = {
      stage: 'cut',
      currentTakeCount: 0,
      shotCount: 2,
      durationSeconds: null,
      targetSeconds: 30,
      structurallyPlayable: false,
    };
    result.boards.shotCount = 2;
    result.blockerCount = 1;
    result.advisories = [];
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      decidedAt: NOW,
      status: 'answered',
      query: { kind: 'get_project_status', detail: false },
      result,
    };

    expect(parseReceiptV2(receipt).status).toBe('valid');
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
          { ...validSlotV2(), schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 + 1 },
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
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
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
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: null,
      decidedAt: NOW,
      status: 'rejected',
      observedRevision: null,
      reasonCode: 'malformed_record',
    },
    {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: 'command_1',
      projectId: 'project_1',
      expectedRevision: 4,
      decidedAt: NOW,
      status: 'expired',
      observedRevision: 4,
      reasonCode: 'deadline_elapsed',
    },
    {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
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

  it('accepts and exactly correlates each free-recovery applied receipt', () => {
    const cases = [
      {
        command: validFreeRecoveryCommandV2(),
        recovery: { op: 'retry_conditioning_frame' as const, dependentShotId: 'shot_2' },
      },
      {
        command: validFreeRecoveryCommandV2({
          recovery: { op: 'terminalize_refused_job', jobId: 'job_refused_1' },
        }),
        recovery: { op: 'terminalize_refused_job' as const, jobId: 'job_refused_1' },
      },
    ];

    for (const { command, recovery } of cases) {
      const receipt = {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: command.commandId,
        projectId: command.projectId,
        expectedRevision: command.expectedRevision,
        decidedAt: NOW,
        status: 'applied' as const,
        appliedRevision: command.expectedRevision + 1,
        recovery,
      };
      expect(parseReceiptV2(receipt)).toEqual({ status: 'valid', record: receipt });
      expect(studioDirectorCommandReceiptMatchesRecordV2(receipt, command)).toBe(true);
    }
  });

  it('rejects cross-shaped recovery receipts and never matches a different applied recovery', () => {
    const command = validFreeRecoveryCommandV2();
    const receipt = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: command.expectedRevision,
      decidedAt: NOW,
      status: 'applied' as const,
      appliedRevision: command.expectedRevision + 1,
      recovery: command.recovery,
    };

    expect(
      parseReceiptV2({
        ...receipt,
        recovery: { op: 'terminalize_refused_job', dependentShotId: 'shot_2' },
      })
    ).toEqual({ status: 'invalid' });
    expect(
      parseReceiptV2({
        ...receipt,
        createdBeatIds: [],
        createdShotIds: [],
      })
    ).toEqual({ status: 'invalid' });
    expect(
      studioDirectorCommandReceiptMatchesRecordV2(
        { ...receipt, recovery: { op: 'retry_conditioning_frame', dependentShotId: 'shot_other' } },
        command
      )
    ).toBe(false);
    expect(studioDirectorCommandReceiptMatchesRecordV2(receipt, validCommandV2())).toBe(false);
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
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
    id: 'proposal_1',
    projectId: 'project_1',
    status: 'pending',
    baseRevision: 4,
    payload: {
      kind: 'mutation_batch',
      operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: { shootingScript: 'A focused launch.' } }],
    },
    createdAt: NOW,
    decidedAt: null,
  };
  const proposalDecision: StudioProposalDecisionV2 = {
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
    proposalId: 'proposal_1',
    status: 'accepted',
    decidedAt: NOW,
  };
  const proposalSlot: StudioProposalSlotV2 = {
    schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
    proposalId: 'proposal_1',
    reservedAt: NOW,
  };

  it('accepts exact prose and pin-rule proposals', () => {
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
    for (const operation of [
      { kind: 'park_take', shotId: 'clip_1', assetId: 'take_1' },
      { kind: 'set_hard_cut', shotId: 'shot_2', hardCut: true },
      {
        kind: 'amend_reference_plan',
        additions: [{ kind: 'background', label: 'Dai pai dong', prompt: 'A recurring food stall.' }],
      },
    ]) {
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId: 'request_1',
      reservedAt: NOW,
    };
    const reference: StudioReferenceRequestV2 = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: 'request_rejected',
        projectId: 'project_1',
        decidedAt: NOW,
        outcome: { kind: 'rejected' },
      },
      {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: 'request_expired',
        projectId: 'project_1',
        decidedAt: NOW,
        outcome: { kind: 'expired' },
      },
      {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        handoffId: 'handoff_dismissed',
        requestId: 'request_dismissed',
        completedAt: NOW,
        result: { kind: 'dismissed' },
      },
      {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
