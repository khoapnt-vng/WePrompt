/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { mkdtempSync, promises as nodeFs, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS,
  STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS,
  STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES,
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
  type CreateStudioProjectInputV2,
  type StudioDirectorCommandReceiptV2,
  type StudioDirectorCommandRecordV2,
  type StudioDirectorFreeRecoveryCommandRecordV2,
  type StudioDirectorFreeRecoveryV2,
  type StudioDirectorQueryCommandRecordV2,
  type StudioProjectV2,
  type StudioProjectStatusV2,
  type StudioProposalRecordV2,
  type StudioProposalV2,
  type StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  createStudioDirectorCommandProcessorV2,
  createStudioDirectorCommitTrackerV2,
  type StudioDirectorCommandProcessorV2,
  type StudioDirectorCommandProcessorDepsV2,
  type StudioDirectorCommitTrackerV2,
} from '@process/services/creative-studio/service/directorCommandProcessor';
import {
  StudioDirectorCommandApplyErrorV2,
  type StudioDirectorCommandServiceV2,
} from '@process/services/creative-studio/service/directorCommandService';
import {
  createStudioDirectorCommandMailboxV2,
  type StudioDirectorCommandRef,
  type StudioDirectorCommandMailboxV2,
} from '@process/services/creative-studio/service/directorCommandMailbox';
import { createStudioDirectorCommandServiceV2 } from '@process/services/creative-studio/service/directorCommandService';
import { CreativeStudioServiceError } from '@process/services/creative-studio/service/projectMutations';
import { createCreativeStudioStore, CreativeStudioStoreError } from '@process/services/creative-studio/store';

const NOW_MS = Date.parse('2026-08-16T12:00:10.000Z');
const COMMITTED_AT = '2026-08-16T12:00:10.125Z';

const makeInput = (name: string): CreateStudioProjectInputV2 => ({
  name,
  brief: 'A real Director command boundary',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
});

const realCommandDirectories = (rootDir: string, projectId: string) => {
  const root = path.join(rootDir, projectId, 'commands');
  return {
    root,
    pending: path.join(root, 'pending'),
    slots: path.join(root, 'slots'),
    receipts: path.join(root, 'receipts'),
  };
};

const snapshotDirectoryBytes = async (root: string): Promise<Record<string, string>> => {
  const result: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    const entries = (await nodeFs.readdir(directory, { withFileTypes: true })).toSorted((left, right) =>
      left.name.localeCompare(right.name)
    );
    for (const entry of entries) {
      const file = path.join(directory, entry.name);
      const relative = path.relative(root, file);
      if (entry.isDirectory()) {
        result[`${relative}/`] = 'directory';
        // eslint-disable-next-line no-await-in-loop
        await visit(file);
      } else {
        // eslint-disable-next-line no-await-in-loop
        result[relative] = (await nodeFs.readFile(file)).toString('base64');
      }
    }
  };
  await visit(root);
  return result;
};

const publishRealPendingV2 = async (input: {
  rootDir: string;
  projectId: string;
  commandId: string;
  pending: unknown;
}): Promise<void> => {
  const directories = realCommandDirectories(input.rootDir, input.projectId);
  await nodeFs.writeFile(
    path.join(directories.pending, `${input.commandId}.json`),
    typeof input.pending === 'string' ? input.pending : JSON.stringify(input.pending)
  );
  await nodeFs.writeFile(
    path.join(directories.slots, '0.slot'),
    JSON.stringify({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: input.commandId,
      reservedAt: '2026-08-16T12:00:00.000Z',
      deadlineAt: '2026-08-16T12:00:15.000Z',
    })
  );
};

const keyOf = (projectId: string, commandId: string): string => `${projectId}/${commandId}`;

const page = (items: StudioDirectorCommandRef[], nextCursor: string | null = null) => ({
  items,
  nextCursor,
});

type ManualInterval = { callback: () => void; delayMs: number; cleared: boolean };

const makeCommandV2 = (
  projectId = 'project_v2',
  commandId = 'command_v2',
  overrides: Partial<StudioDirectorCommandRecordV2> = {}
): StudioDirectorCommandRecordV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId,
  projectId,
  expectedRevision: 1,
  createdAt: '2026-08-16T12:00:00.000Z',
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'auto_apply',
  operations: [{ kind: 'set_brief', brief: 'A bounded schema-2 edit' }],
  ...overrides,
});

const makeQueryCommandV2 = (
  policy: 'get_project_status' | 'list_routes' | 'get_proposal',
  commandId = 'query_v2',
  detail = false
): StudioDirectorQueryCommandRecordV2 =>
  policy === 'get_project_status'
    ? {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId,
        projectId: 'project_v2',
        createdAt: '2026-08-16T12:00:00.000Z',
        deadlineAt: '2026-08-16T12:00:15.000Z',
        policy,
        detail,
      }
    : policy === 'list_routes'
      ? {
          schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
          commandId,
          projectId: 'project_v2',
          createdAt: '2026-08-16T12:00:00.000Z',
          deadlineAt: '2026-08-16T12:00:15.000Z',
          policy,
        }
      : {
          schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
          commandId,
          projectId: 'project_v2',
          createdAt: '2026-08-16T12:00:00.000Z',
          deadlineAt: '2026-08-16T12:00:15.000Z',
          policy,
          proposalId: 'proposal_exact_b',
        };

const makeFreeRecoveryCommandV2 = (
  recovery: StudioDirectorFreeRecoveryV2,
  commandId = 'free_recovery_v2',
  expectedRevision = 1
): StudioDirectorFreeRecoveryCommandRecordV2 => ({
  schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  commandId,
  projectId: 'project_v2',
  expectedRevision,
  createdAt: '2026-08-16T12:00:00.000Z',
  deadlineAt: '2026-08-16T12:00:15.000Z',
  policy: 'apply_free_fix',
  recovery,
});

const makeProjectStatusV2 = (detail = false): StudioProjectStatusV2 => ({
  projectId: 'project_v2',
  projectRevision: 2,
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
      state: 'complete',
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
  advisories: [],
  boards: { currentPictureCount: 0, shotCount: 0 },
  detail: detail ? { shots: [], references: [] } : null,
});

const makeFreeRecoveryStatusV2 = (
  recovery: StudioDirectorFreeRecoveryV2,
  projectRevision = 1
): StudioProjectStatusV2 => {
  const status = makeProjectStatusV2(true);
  status.projectRevision = projectRevision;
  const production = status.stages.find((stage) => stage.id === 'production')!;
  production.state = 'blocked';
  production.blockers = [
    {
      cause:
        recovery.op === 'retry_conditioning_frame' ? 'conditioning_frame_required' : 'generation_provider_unavailable',
      where: {
        kind: 'shot',
        beatId: 'beat_1',
        shotId: recovery.op === 'retry_conditioning_frame' ? recovery.dependentShotId : 'shot_1',
        beatPosition: 1,
        shotPosition: 1,
        jobId: recovery.op === 'terminalize_refused_job' ? recovery.jobId : null,
      },
      remedy: { kind: 'free_fix', ...structuredClone(recovery) },
    },
  ];
  status.blockerCount = 1;
  return status;
};

const makeUnavailableRoutesV2 = (): StudioRouteCatalogV2 => ({
  catalogVersion: 'fedcba9876543210',
  image: {
    status: 'unavailable',
    selected: null,
    selectedRoute: null,
    selectionIssue: { code: 'health' },
    options: [],
  },
  video: {
    status: 'unavailable',
    selected: null,
    selectedRoute: null,
    selectionIssue: { code: 'health' },
    options: [],
  },
});

const makeRouteOptionV2 = (role: 'image' | 'video', index: number, padded = false) => ({
  choiceId: `choice_${index.toString(16).padStart(24, '0')}`,
  providerId: padded ? `p${'x'.repeat(255)}` : `provider_${role}`,
  providerName: padded ? 'P'.repeat(256) : `${role} provider`,
  model: padded ? 'M'.repeat(256) : `${role} model`,
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

const makeOversizedRoutesV2 = (): StudioRouteCatalogV2 => ({
  catalogVersion: 'fedcba9876543210',
  image: {
    status: 'selection_required',
    selected: null,
    selectedRoute: null,
    selectionIssue: null,
    options: Array.from({ length: 256 }, (_, index) => makeRouteOptionV2('image', index + 1, true)),
  },
  video: {
    status: 'selection_required',
    selected: null,
    selectedRoute: null,
    selectionIssue: null,
    options: Array.from({ length: 256 }, (_, index) => makeRouteOptionV2('video', index + 1, true)),
  },
});

const makeProjectV2 = (projectId = 'project_v2', revision = 1): StudioProjectV2 =>
  ({
    id: projectId,
    revision,
    updatedAt: revision === 1 ? '2026-08-16T12:00:00.000Z' : COMMITTED_AT,
  }) as StudioProjectV2;

const makeProposalV2 = (id: string, status: StudioProposalV2['status'] = 'pending'): StudioProposalV2 => {
  const pending: StudioProposalRecordV2 = {
    schemaVersion: 5,
    id,
    projectId: 'project_v2',
    status: 'pending',
    baseRevision: 1,
    payload: {
      kind: 'mutation_batch',
      operations: [{ kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: `Proposal ${id}` } }],
    },
    createdAt: '2026-08-16T12:00:00.000Z',
    decidedAt: null,
  };
  return status === 'pending' ? pending : { ...pending, status, decidedAt: '2026-08-16T12:00:05.000Z' };
};

type HarnessV2 = {
  processor: StudioDirectorCommandProcessorV2;
  tracker: StudioDirectorCommitTrackerV2;
  mailbox: StudioDirectorCommandMailboxV2;
  pendings: Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readPending']>>>;
  receiptReads: Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readReceipt']>>>;
  receipts: Map<string, StudioDirectorCommandReceiptV2>;
  projects: Map<string, StudioProjectV2 | 'unsupported_prototype_schema'>;
  serviceApply: ReturnType<typeof vi.fn<StudioDirectorCommandServiceV2['apply']>>;
  serviceGetProjectStatus: ReturnType<typeof vi.fn>;
  serviceListRoutes: ReturnType<typeof vi.fn>;
  serviceRetryConditioningFrame: ReturnType<typeof vi.fn>;
  serviceTerminalizeRefusedJob: ReturnType<typeof vi.fn>;
  storeGetProject: ReturnType<typeof vi.fn>;
  storeListProposals: ReturnType<typeof vi.fn>;
  writeReceipt: ReturnType<
    typeof vi.fn<
      (
        projectId: string,
        receipt: StudioDirectorCommandReceiptV2,
        authorizeBeforePublish?: () => boolean
      ) => Promise<void>
    >
  >;
  finish: ReturnType<typeof vi.fn<(projectId: string, commandId: string) => Promise<void>>>;
  notify: ReturnType<typeof vi.fn<(projectId: string) => void>>;
  releaseOrphans: ReturnType<typeof vi.fn<StudioDirectorCommandMailboxV2['releaseOrphanedSlotsPage']>>;
  pruneReceipts: ReturnType<typeof vi.fn<StudioDirectorCommandMailboxV2['pruneReceiptsPage']>>;
  intervals: ManualInterval[];
  emitWatch(projectId: string, commandId?: string): void;
  failNextReceiptWrites(count?: number): void;
  failNextFinishes(count?: number): void;
};

const createHarnessV2 = (
  input: {
    nowMs?: number;
    startupRefs?: Array<{ projectId: string; commandId: string }>;
    serviceApply?: StudioDirectorCommandServiceV2['apply'];
    serviceGetProjectStatus?: (input: { projectId: string; detail?: boolean }) => Promise<StudioProjectStatusV2>;
    serviceListRoutes?: (input: { projectId: string }) => Promise<StudioRouteCatalogV2>;
    serviceRetryConditioningFrame?: StudioDirectorCommandProcessorDepsV2['service']['retryConditioningFrame'];
    serviceTerminalizeRefusedJob?: StudioDirectorCommandProcessorDepsV2['service']['terminalizeRefusedJob'];
    proposals?: StudioProposalV2[];
    queryAuthorityActive?: () => boolean;
    beforeReceiptPublish?: () => Promise<void>;
  } = {}
): HarnessV2 => {
  const pendings = new Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readPending']>>>();
  const receiptReads = new Map<string, Awaited<ReturnType<StudioDirectorCommandMailboxV2['readReceipt']>>>();
  const receipts = new Map<string, StudioDirectorCommandReceiptV2>();
  const projects = new Map<string, StudioProjectV2 | 'unsupported_prototype_schema'>();
  const tracker = createStudioDirectorCommitTrackerV2();
  const intervals: ManualInterval[] = [];
  let watcher: ((projectId: string, commandId?: string) => void) | null = null;
  let remainingReceiptFailures = 0;
  let remainingFinishFailures = 0;
  const writeReceipt = vi.fn(
    async (projectId: string, receipt: StudioDirectorCommandReceiptV2, authorizeBeforePublish?: () => boolean) => {
      if (remainingReceiptFailures > 0) {
        remainingReceiptFailures -= 1;
        throw new CreativeStudioStoreError('storage_error', 'receipt write failed');
      }
      await input.beforeReceiptPublish?.();
      if (authorizeBeforePublish !== undefined && !authorizeBeforePublish()) {
        throw new CreativeStudioStoreError('storage_error', 'receipt publication fenced');
      }
      receipts.set(keyOf(projectId, receipt.commandId), structuredClone(receipt));
      receiptReads.set(keyOf(projectId, receipt.commandId), { status: 'valid', record: structuredClone(receipt) });
    }
  );
  const finish = vi.fn(async (projectId: string, commandId: string) => {
    if (remainingFinishFailures > 0) {
      remainingFinishFailures -= 1;
      throw new CreativeStudioStoreError('storage_error', 'cleanup failed');
    }
    pendings.delete(keyOf(projectId, commandId));
  });
  const releaseOrphans = vi.fn(async (_cursor: string | null, _now: string, _limit: number) => ({
    processed: 0,
    nextCursor: null,
  }));
  const pruneReceipts = vi.fn(async (_cursor: string | null, _before: string, _limit: number) => ({
    processed: 0,
    nextCursor: null,
  }));
  const mailbox: StudioDirectorCommandMailboxV2 = {
    ensure: vi.fn(async () => undefined),
    snapshotPendingPage: vi.fn(async (cursor) => (cursor === null ? page(input.startupRefs ?? []) : page([]))),
    readPending: vi.fn(async (projectId, commandId) => pendings.get(keyOf(projectId, commandId)) ?? null),
    readReceipt: vi.fn(async (projectId, commandId) => receiptReads.get(keyOf(projectId, commandId)) ?? null),
    writeReceipt,
    finish,
    listPendingPage: vi.fn(async () =>
      page(
        [...pendings.entries()].map(([key]) => {
          const [projectId, commandId] = key.split('/');
          return { projectId: projectId!, commandId: commandId! };
        })
      )
    ),
    releaseOrphanedSlotsPage: releaseOrphans,
    pruneReceiptsPage: pruneReceipts,
    watch: vi.fn(async (trigger) => {
      watcher = trigger;
      return vi.fn(() => {
        watcher = null;
      });
    }),
    dispose: vi.fn(async () => undefined),
  };
  const defaultApply: StudioDirectorCommandServiceV2['apply'] = async (command) => {
    const project = makeProjectV2(command.projectId, command.expectedRevision + 1);
    projects.set(command.projectId, project);
    return {
      project,
      appliedRevision: project.revision,
      createdBeatIds: command.operations
        .filter((operation) => operation.kind === 'add_beat')
        .map((operation) => operation.beatId),
      createdShotIds: command.operations.flatMap((operation) =>
        operation.kind === 'add_shot' ? [operation.shotId] : []
      ),
    };
  };
  const serviceApply = vi.fn(input.serviceApply ?? defaultApply);
  const serviceGetProjectStatus = vi.fn(
    input.serviceGetProjectStatus ?? (async ({ detail }) => makeProjectStatusV2(detail === true))
  );
  const serviceListRoutes = vi.fn(input.serviceListRoutes ?? (async () => makeUnavailableRoutesV2()));
  const recordRecoveryCommit = (request: { projectId: string; expectedRevision: number }, commandId: string): void => {
    projects.set(request.projectId, makeProjectV2(request.projectId, request.expectedRevision + 1));
    tracker.observe({
      projectId: request.projectId,
      previousRevision: request.expectedRevision,
      committedRevision: request.expectedRevision + 1,
      committedAt: new Date(input.nowMs ?? NOW_MS).toISOString(),
      commitTag: commandId,
    });
  };
  const serviceRetryConditioningFrame = vi.fn(
    input.serviceRetryConditioningFrame ??
      (async (request, commandId) => {
        recordRecoveryCommit(request, commandId!);
        return undefined as never;
      })
  );
  const serviceTerminalizeRefusedJob = vi.fn(
    input.serviceTerminalizeRefusedJob ??
      (async (request, commandId) => {
        recordRecoveryCommit(request, commandId);
      })
  );
  const storeGetProject = vi.fn(async (projectId: string) => {
    const project = projects.get(projectId);
    if (project === undefined) return { status: 'not_found' as const, projectId };
    if (project === 'unsupported_prototype_schema') {
      return { status: 'unsupported_prototype_schema' as const, projectId };
    }
    return { status: 'supported' as const, project };
  });
  const storeListProposals = vi.fn(async () => structuredClone(input.proposals ?? []));
  const notify = vi.fn<(projectId: string) => void>();
  const processor = createStudioDirectorCommandProcessorV2({
    store: { getProjectV2: storeGetProject, listProposalsV2: storeListProposals },
    mailbox,
    service: {
      apply: serviceApply,
      getProjectStatus: serviceGetProjectStatus,
      listRoutes: serviceListRoutes,
      retryConditioningFrame: serviceRetryConditioningFrame,
      terminalizeRefusedJob: serviceTerminalizeRefusedJob,
    },
    tracker,
    queryAuthorityActive: input.queryAuthorityActive,
    onProjectUpdated: notify,
    now: () => input.nowMs ?? NOW_MS,
    setInterval: (callback, delayMs) => {
      const interval = { callback, delayMs, cleared: false };
      intervals.push(interval);
      return interval;
    },
    clearInterval: (interval) => {
      (interval as ManualInterval).cleared = true;
    },
    logError: vi.fn(),
  });
  return {
    processor,
    tracker,
    mailbox,
    pendings,
    receiptReads,
    receipts,
    projects,
    serviceApply,
    serviceGetProjectStatus,
    serviceListRoutes,
    serviceRetryConditioningFrame,
    serviceTerminalizeRefusedJob,
    storeGetProject,
    storeListProposals,
    writeReceipt,
    finish,
    notify,
    releaseOrphans,
    pruneReceipts,
    intervals,
    emitWatch(projectId, commandId) {
      watcher?.(projectId, commandId);
    },
    failNextReceiptWrites(count = 1) {
      remainingReceiptFailures = count;
    },
    failNextFinishes(count = 1) {
      remainingFinishFailures = count;
    },
  };
};

const addLiveCommandV2 = (harness: HarnessV2, command: StudioDirectorCommandRecordV2): void => {
  if (command.policy === 'auto_apply' || command.policy === 'apply_free_fix') {
    harness.projects.set(command.projectId, makeProjectV2(command.projectId, command.expectedRevision));
  }
  harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });
};

const waitForReceiptV2 = async (
  harness: HarnessV2,
  projectId = 'project_v2',
  commandId = 'command_v2'
): Promise<StudioDirectorCommandReceiptV2> => {
  await vi.waitFor(() => expect(harness.receipts.has(keyOf(projectId, commandId))).toBe(true));
  return harness.receipts.get(keyOf(projectId, commandId))!;
};

describe('Studio Director schema-2 commit tracker', () => {
  it('materializes an exact tagged direct commit without proposal-only creation identities', () => {
    const tracker = createStudioDirectorCommitTrackerV2();
    const command = makeCommandV2('project_v2', 'command_v2', {
      operations: [{ kind: 'set_brief', brief: 'A direct Director-authored Brief.' }],
    });
    tracker.expect(command);
    tracker.observe({
      projectId: command.projectId,
      previousRevision: 1,
      committedRevision: 2,
      committedAt: COMMITTED_AT,
      commitTag: command.commandId,
    });

    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toEqual({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: 1,
      decidedAt: COMMITTED_AT,
      status: 'applied',
      appliedRevision: 2,
      createdBeatIds: [],
      createdShotIds: [],
    });
  });

  it('materializes the exact tagged free recovery instead of mutation identities', () => {
    const tracker = createStudioDirectorCommitTrackerV2();
    const command = makeFreeRecoveryCommandV2({
      op: 'retry_conditioning_frame',
      dependentShotId: 'shot_waiting',
    });
    tracker.expect(command);
    tracker.observe({
      projectId: command.projectId,
      previousRevision: command.expectedRevision,
      committedRevision: command.expectedRevision + 1,
      committedAt: COMMITTED_AT,
      commitTag: command.commandId,
    });

    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toEqual({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: command.expectedRevision,
      decidedAt: COMMITTED_AT,
      status: 'applied',
      appliedRevision: command.expectedRevision + 1,
      recovery: command.recovery,
    });
  });

  it('ignores untagged, mismatched, duplicate, and post-terminal observations', () => {
    const tracker = createStudioDirectorCommitTrackerV2();
    const command = makeCommandV2();
    tracker.expect(command);
    tracker.expect(command);
    tracker.observe({
      projectId: command.projectId,
      previousRevision: 1,
      committedRevision: 2,
      committedAt: COMMITTED_AT,
      commitTag: null,
    });
    tracker.observe({
      projectId: command.projectId,
      previousRevision: 0,
      committedRevision: 1,
      committedAt: COMMITTED_AT,
      commitTag: command.commandId,
    });
    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toBeNull();

    const terminal: StudioDirectorCommandReceiptV2 = {
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: 1,
      decidedAt: COMMITTED_AT,
      status: 'rejected',
      observedRevision: 1,
      reasonCode: 'validation_failed',
    };
    tracker.materialize(terminal);
    tracker.materialize({ ...terminal, reasonCode: 'invalid_operation' });
    tracker.expect(command);

    expect(tracker.pendingReceipt(command.projectId, command.commandId)).toEqual(terminal);
  });
});

describe('Studio Director schema-2 command processor', () => {
  it('reads exactly one proposal and reports terminal or missing identities without mutation authority', async () => {
    const proposalA = makeProposalV2('proposal_exact_a');
    const proposalB = makeProposalV2('proposal_exact_b');
    const pending = createHarnessV2({ proposals: [proposalA, proposalB] });
    const trackerExpect = vi.spyOn(pending.tracker, 'expect');
    await pending.processor.start();
    const command = makeQueryCommandV2('get_proposal', 'proposal_query');
    addLiveCommandV2(pending, command);
    pending.processor.trigger(command.projectId, command.commandId);

    expect(await waitForReceiptV2(pending, command.projectId, command.commandId)).toMatchObject({
      status: 'answered',
      query: { kind: 'get_proposal', proposalId: proposalB.id },
      result: { status: 'pending', proposal: { id: proposalB.id } },
    });
    expect(pending.storeListProposals).toHaveBeenCalledExactlyOnceWith('project_v2');
    expect(pending.storeGetProject).not.toHaveBeenCalled();
    expect(pending.serviceApply).not.toHaveBeenCalled();
    expect(pending.serviceGetProjectStatus).not.toHaveBeenCalled();
    expect(pending.serviceListRoutes).not.toHaveBeenCalled();
    expect(pending.notify).not.toHaveBeenCalled();
    expect(trackerExpect).not.toHaveBeenCalled();

    const terminal = createHarnessV2({ proposals: [makeProposalV2('proposal_exact_b', 'rejected')] });
    await terminal.processor.start();
    addLiveCommandV2(terminal, command);
    terminal.processor.trigger(command.projectId, command.commandId);
    expect(await waitForReceiptV2(terminal, command.projectId, command.commandId)).toMatchObject({
      result: { status: 'no_longer_pending', proposalId: 'proposal_exact_b', decision: 'rejected' },
    });

    const missing = createHarnessV2();
    await missing.processor.start();
    addLiveCommandV2(missing, command);
    missing.processor.trigger(command.projectId, command.commandId);
    expect(await waitForReceiptV2(missing, command.projectId, command.commandId)).toMatchObject({
      result: { status: 'not_found' },
    });
  });

  it('answers an exact status query without loading, mutating, tracking, notifying, or spending', async () => {
    const harness = createHarnessV2();
    const trackerExpect = vi.spyOn(harness.tracker, 'expect');
    const trackerPending = vi.spyOn(harness.tracker, 'pendingReceipt');
    const trackerMaterialize = vi.spyOn(harness.tracker, 'materialize');
    const trackerClear = vi.spyOn(harness.tracker, 'clear');
    await harness.processor.start();
    const command = makeQueryCommandV2('get_project_status', 'status_query', true);
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);

    expect(receipt).toEqual({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      decidedAt: new Date(NOW_MS).toISOString(),
      status: 'answered',
      query: { kind: 'get_project_status', detail: true },
      result: makeProjectStatusV2(true),
    });
    expect(harness.serviceGetProjectStatus).toHaveBeenCalledExactlyOnceWith({
      projectId: command.projectId,
      detail: true,
    });
    expect(harness.storeGetProject).not.toHaveBeenCalled();
    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.serviceListRoutes).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(trackerExpect).not.toHaveBeenCalled();
    expect(trackerPending).not.toHaveBeenCalled();
    expect(trackerMaterialize).not.toHaveBeenCalled();
    expect(trackerClear).not.toHaveBeenCalled();
  });

  it('defers a live route query until the exact read graph activates, then answers on the 500 ms sweep', async () => {
    let active = false;
    const harness = createHarnessV2({ queryAuthorityActive: () => active });
    await harness.processor.start();
    const command = makeQueryCommandV2('list_routes', 'routes_query');
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    await vi.waitFor(() => expect(harness.mailbox.readPending).toHaveBeenCalled());
    expect(harness.serviceListRoutes).not.toHaveBeenCalled();
    expect(harness.receipts.size).toBe(0);

    active = true;
    harness.intervals.find(({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS)?.callback();
    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);
    expect(receipt).toEqual({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      decidedAt: new Date(NOW_MS).toISOString(),
      status: 'answered',
      query: { kind: 'list_routes' },
      result: makeUnavailableRoutesV2(),
    });
    expect(harness.storeGetProject).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it('expires snapshot queries before execution and gives a live elapsed deadline fixed precedence', async () => {
    const snapshot = makeQueryCommandV2('get_project_status', 'snapshot_query', true);
    const startup = createHarnessV2({
      startupRefs: [{ projectId: snapshot.projectId, commandId: snapshot.commandId }],
      queryAuthorityActive: () => false,
    });
    startup.pendings.set(keyOf(snapshot.projectId, snapshot.commandId), { status: 'valid', record: snapshot });
    await startup.processor.start();
    const startupReceipt = await waitForReceiptV2(startup, snapshot.projectId, snapshot.commandId);
    expect(startupReceipt).toMatchObject({
      status: 'expired',
      query: { kind: 'get_project_status', detail: true },
      reasonCode: 'expired_after_restart',
    });
    expect(startup.serviceGetProjectStatus).not.toHaveBeenCalled();

    const elapsed = createHarnessV2({ nowMs: Date.parse('2026-08-16T12:00:15.000Z') });
    await elapsed.processor.start();
    const deadline = makeQueryCommandV2('list_routes', 'deadline_query');
    addLiveCommandV2(elapsed, deadline);
    elapsed.processor.trigger(deadline.projectId, deadline.commandId);
    const elapsedReceipt = await waitForReceiptV2(elapsed, deadline.projectId, deadline.commandId);
    expect(elapsedReceipt).toMatchObject({
      status: 'expired',
      query: { kind: 'list_routes' },
      reasonCode: 'deadline_elapsed',
    });
    expect(elapsed.serviceListRoutes).not.toHaveBeenCalled();
  });

  it.each([
    ['status unknown error', 'get_project_status', new Error('provider secret'), 'project_read_unavailable'],
    [
      'active quarantined project',
      'get_project_status',
      new CreativeStudioServiceError('project_quarantined', 'project_v2'),
      'project_read_unavailable',
    ],
    ['routes unknown error', 'list_routes', new Error('provider secret'), 'route_inventory_unavailable'],
  ] as const)('terminalizes %s once with bounded copy', async (_label, policy, error, reasonCode) => {
    const harness = createHarnessV2({
      serviceGetProjectStatus: async () => {
        throw error;
      },
      serviceListRoutes: async () => {
        throw error;
      },
    });
    await harness.processor.start();
    const command = makeQueryCommandV2(policy, 'failed_query', true);
    addLiveCommandV2(harness, command);
    harness.processor.trigger(command.projectId, command.commandId);

    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);
    expect(receipt).toMatchObject({ status: 'failed', reasonCode });
    expect(JSON.stringify(receipt)).not.toContain('provider secret');
    expect(
      policy === 'get_project_status' ? harness.serviceGetProjectStatus : harness.serviceListRoutes
    ).toHaveBeenCalledOnce();
    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.storeGetProject).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it('does not publish when read authority is revoked during service or at the atomic receipt fence', async () => {
    let serviceActive = true;
    let resolveStatus!: (status: StudioProjectStatusV2) => void;
    const serviceResult = new Promise<StudioProjectStatusV2>((resolve) => {
      resolveStatus = resolve;
    });
    const serviceRace = createHarnessV2({
      queryAuthorityActive: () => serviceActive,
      serviceGetProjectStatus: async () => serviceResult,
    });
    await serviceRace.processor.start();
    const serviceCommand = makeQueryCommandV2('get_project_status', 'service_race');
    addLiveCommandV2(serviceRace, serviceCommand);
    serviceRace.processor.trigger(serviceCommand.projectId, serviceCommand.commandId);
    await vi.waitFor(() => expect(serviceRace.serviceGetProjectStatus).toHaveBeenCalledOnce());
    serviceActive = false;
    resolveStatus(makeProjectStatusV2(false));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(serviceRace.writeReceipt).not.toHaveBeenCalled();
    expect(serviceRace.pendings.has(keyOf(serviceCommand.projectId, serviceCommand.commandId))).toBe(true);

    let publishActive = true;
    let releasePublish!: () => void;
    const publishGate = new Promise<void>((resolve) => {
      releasePublish = resolve;
    });
    const publicationRace = createHarnessV2({
      queryAuthorityActive: () => publishActive,
      beforeReceiptPublish: async () => publishGate,
    });
    await publicationRace.processor.start();
    const publicationCommand = makeQueryCommandV2('get_project_status', 'publication_race');
    addLiveCommandV2(publicationRace, publicationCommand);
    publicationRace.processor.trigger(publicationCommand.projectId, publicationCommand.commandId);
    await vi.waitFor(() => expect(publicationRace.writeReceipt).toHaveBeenCalledOnce());
    publishActive = false;
    releasePublish();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(publicationRace.receipts.size).toBe(0);
    expect(publicationRace.finish).not.toHaveBeenCalled();
    expect(publicationRace.pendings.has(keyOf(publicationCommand.projectId, publicationCommand.commandId))).toBe(true);
    expect(publicationRace.notify).not.toHaveBeenCalled();
  });

  it('keeps query receipt recovery completely outside the mutation commit tracker', async () => {
    const harness = createHarnessV2();
    const trackerExpect = vi.spyOn(harness.tracker, 'expect');
    const trackerPending = vi.spyOn(harness.tracker, 'pendingReceipt');
    const trackerMaterialize = vi.spyOn(harness.tracker, 'materialize');
    const trackerClear = vi.spyOn(harness.tracker, 'clear');
    await harness.processor.start();
    const command = makeQueryCommandV2('get_project_status', 'cleanup_query');
    addLiveCommandV2(harness, command);
    harness.failNextFinishes(100);
    harness.processor.trigger(command.projectId, command.commandId);
    await vi.waitFor(() => expect(harness.receipts.has(keyOf(command.projectId, command.commandId))).toBe(true));
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalled());
    expect(harness.pendings.has(keyOf(command.projectId, command.commandId))).toBe(true);

    harness.failNextFinishes(0);
    harness.processor.trigger(command.projectId, command.commandId);
    await vi.waitFor(() => expect(harness.pendings.has(keyOf(command.projectId, command.commandId))).toBe(false));
    expect(harness.serviceGetProjectStatus).toHaveBeenCalledOnce();
    expect(harness.finish.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(trackerExpect).not.toHaveBeenCalled();
    expect(trackerPending).not.toHaveBeenCalled();
    expect(trackerMaterialize).not.toHaveBeenCalled();
    expect(trackerClear).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
  });

  it('classifies malformed and oversized service answers without leaking or writing project state', async () => {
    let getterCalls = 0;
    const accessorResult = makeProjectStatusV2(false) as StudioProjectStatusV2 & Record<string, unknown>;
    Object.defineProperty(accessorResult, 'detail', {
      enumerable: true,
      get: () => {
        getterCalls += 1;
        return null;
      },
    });
    const accessor = createHarnessV2({ serviceGetProjectStatus: async () => accessorResult });
    await accessor.processor.start();
    const accessorCommand = makeQueryCommandV2('get_project_status', 'accessor_query');
    addLiveCommandV2(accessor, accessorCommand);
    accessor.processor.trigger(accessorCommand.projectId, accessorCommand.commandId);
    expect(await waitForReceiptV2(accessor, accessorCommand.projectId, accessorCommand.commandId)).toMatchObject({
      status: 'failed',
      reasonCode: 'result_mismatch',
    });
    expect(getterCalls).toBe(0);

    const mismatch = createHarnessV2({
      serviceGetProjectStatus: async () => ({ ...makeProjectStatusV2(false), projectId: 'other' }),
    });
    await mismatch.processor.start();
    const mismatchCommand = makeQueryCommandV2('get_project_status', 'mismatch_query');
    addLiveCommandV2(mismatch, mismatchCommand);
    mismatch.processor.trigger(mismatchCommand.projectId, mismatchCommand.commandId);
    expect(await waitForReceiptV2(mismatch, mismatchCommand.projectId, mismatchCommand.commandId)).toMatchObject({
      status: 'failed',
      reasonCode: 'result_mismatch',
    });

    const largeResult = makeOversizedRoutesV2();
    expect(Buffer.byteLength(JSON.stringify(largeResult), 'utf8')).toBeGreaterThan(
      STUDIO_DIRECTOR_COMMAND_MAX_RECORD_BYTES
    );
    const oversized = createHarnessV2({ serviceListRoutes: async () => largeResult });
    await oversized.processor.start();
    const oversizedCommand = makeQueryCommandV2('list_routes', 'oversized_query');
    addLiveCommandV2(oversized, oversizedCommand);
    oversized.processor.trigger(oversizedCommand.projectId, oversizedCommand.commandId);
    expect(await waitForReceiptV2(oversized, oversizedCommand.projectId, oversizedCommand.commandId)).toMatchObject({
      status: 'failed',
      reasonCode: 'response_too_large',
    });
    expect(oversized.storeGetProject).not.toHaveBeenCalled();
    expect(oversized.serviceApply).not.toHaveBeenCalled();
    expect(oversized.notify).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'conditioning-frame retry',
      recovery: { op: 'retry_conditioning_frame', dependentShotId: 'shot_waiting' } as const,
    },
    {
      label: 'refused-submission terminalization',
      recovery: { op: 'terminalize_refused_job', jobId: 'job_refused' } as const,
    },
  ])('applies the exact fresh $label remedy through its bounded recovery service', async ({ recovery }) => {
    const harness = createHarnessV2({
      serviceGetProjectStatus: async () => makeFreeRecoveryStatusV2(recovery),
    });
    await harness.processor.start();
    const command = makeFreeRecoveryCommandV2(recovery);
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);

    expect(receipt).toEqual({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      commandId: command.commandId,
      projectId: command.projectId,
      expectedRevision: command.expectedRevision,
      decidedAt: new Date(NOW_MS).toISOString(),
      status: 'applied',
      appliedRevision: command.expectedRevision + 1,
      recovery,
    });
    expect(harness.serviceGetProjectStatus).toHaveBeenCalledExactlyOnceWith({
      projectId: command.projectId,
      detail: true,
    });
    if (recovery.op === 'retry_conditioning_frame') {
      expect(harness.serviceRetryConditioningFrame).toHaveBeenCalledExactlyOnceWith(
        {
          projectId: command.projectId,
          expectedRevision: command.expectedRevision,
          dependentShotId: recovery.dependentShotId,
        },
        command.commandId
      );
      expect(harness.serviceTerminalizeRefusedJob).not.toHaveBeenCalled();
    } else {
      expect(harness.serviceTerminalizeRefusedJob).toHaveBeenCalledExactlyOnceWith(
        {
          projectId: command.projectId,
          expectedRevision: command.expectedRevision,
          jobId: recovery.jobId,
        },
        command.commandId
      );
      expect(harness.serviceRetryConditioningFrame).not.toHaveBeenCalled();
    }
    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(command.projectId);
    await harness.processor.stop();
  });

  it('fails indeterminate instead of claiming a recovery that lacks exact commit attribution', async () => {
    const recovery = { op: 'terminalize_refused_job', jobId: 'job_refused' } as const;
    const harness = createHarnessV2({
      serviceGetProjectStatus: async () => makeFreeRecoveryStatusV2(recovery),
      serviceTerminalizeRefusedJob: async () => undefined,
    });
    await harness.processor.start();
    const command = makeFreeRecoveryCommandV2(recovery);
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);

    expect(receipt).toMatchObject({
      status: 'indeterminate',
      observedRevision: command.expectedRevision,
      reasonCode: 'commit_attribution_unknown',
    });
    expect(harness.serviceTerminalizeRefusedJob).toHaveBeenCalledOnce();
    expect(harness.notify).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('fails closed when fresh status has no exact singleton free remedy', async () => {
    const requested = { op: 'terminalize_refused_job', jobId: 'job_refused' } as const;
    const statuses = [
      makeProjectStatusV2(true),
      makeFreeRecoveryStatusV2({ op: 'terminalize_refused_job', jobId: 'job_other' }),
      (() => {
        const duplicate = makeFreeRecoveryStatusV2(requested);
        const production = duplicate.stages.find((stage) => stage.id === 'production')!;
        production.blockers.push(structuredClone(production.blockers[0]!));
        duplicate.blockerCount = 2;
        return duplicate;
      })(),
    ];
    statuses[0]!.projectRevision = 1;

    for (const [index, status] of statuses.entries()) {
      const harness = createHarnessV2({ serviceGetProjectStatus: async () => status });
      await harness.processor.start();
      const command = makeFreeRecoveryCommandV2(requested, `free_fix_mismatch_${index}`);
      addLiveCommandV2(harness, command);
      harness.processor.trigger(command.projectId, command.commandId);
      // eslint-disable-next-line no-await-in-loop
      const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);

      expect(receipt).toMatchObject({ status: 'rejected', reasonCode: 'dependency_blocked' });
      expect(harness.serviceGetProjectStatus).toHaveBeenCalledExactlyOnceWith({
        projectId: command.projectId,
        detail: true,
      });
      expect(harness.serviceTerminalizeRefusedJob).not.toHaveBeenCalled();
      expect(harness.serviceRetryConditioningFrame).not.toHaveBeenCalled();
      expect(harness.serviceApply).not.toHaveBeenCalled();
      // eslint-disable-next-line no-await-in-loop
      await harness.processor.stop();
    }
  });

  it('rejects a recovery whose fresh status revision is stale before invoking either recovery', async () => {
    const recovery = { op: 'retry_conditioning_frame', dependentShotId: 'shot_waiting' } as const;
    const harness = createHarnessV2({
      serviceGetProjectStatus: async () => makeFreeRecoveryStatusV2(recovery, 2),
    });
    await harness.processor.start();
    const command = makeFreeRecoveryCommandV2(recovery);
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);

    expect(receipt).toMatchObject({ status: 'rejected', reasonCode: 'stale_revision' });
    expect(harness.serviceGetProjectStatus).toHaveBeenCalledOnce();
    expect(harness.serviceRetryConditioningFrame).not.toHaveBeenCalled();
    expect(harness.serviceTerminalizeRefusedJob).not.toHaveBeenCalled();
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('expires a free recovery before status preflight when its acknowledgement window elapsed', async () => {
    const harness = createHarnessV2({ nowMs: Date.parse('2026-08-16T12:00:13.000Z') });
    await harness.processor.start();
    const command = makeFreeRecoveryCommandV2({
      op: 'terminalize_refused_job',
      jobId: 'job_refused',
    });
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness, command.projectId, command.commandId);

    expect(receipt).toMatchObject({ status: 'expired', reasonCode: 'deadline_elapsed' });
    expect(harness.serviceGetProjectStatus).not.toHaveBeenCalled();
    expect(harness.serviceTerminalizeRefusedJob).not.toHaveBeenCalled();
    expect(harness.serviceRetryConditioningFrame).not.toHaveBeenCalled();
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('writes one exact applied receipt, cleans once, and notifies exactly once', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const command = makeCommandV2();
    addLiveCommandV2(harness, command);

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({
      schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
      status: 'applied',
      appliedRevision: 2,
      createdBeatIds: [],
      createdShotIds: [],
    });
    expect(harness.serviceApply).toHaveBeenCalledOnce();
    expect(harness.finish).toHaveBeenCalledExactlyOnceWith(command.projectId, command.commandId);
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(command.projectId);
    await harness.processor.stop();
  });

  it('repairs an observer-proven commit after a failed receipt write without replaying CAS', async () => {
    let tracker!: StudioDirectorCommitTrackerV2;
    const harness = createHarnessV2({
      serviceApply: async (command) => {
        const committed = makeProjectV2(command.projectId, command.expectedRevision + 1);
        harness.projects.set(command.projectId, committed);
        tracker.observe({
          projectId: command.projectId,
          previousRevision: command.expectedRevision,
          committedRevision: committed.revision,
          committedAt: committed.updatedAt,
          commitTag: command.commandId,
        });
        throw new CreativeStudioStoreError('storage_error', 'post-commit summary repair failed');
      },
    });
    tracker = harness.tracker;
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());
    harness.failNextReceiptWrites();

    harness.processor.trigger('project_v2', 'command_v2');
    await vi.waitFor(() => expect(harness.writeReceipt).toHaveBeenCalledOnce());
    expect(harness.receipts.size).toBe(0);
    expect(harness.tracker.pendingReceipt('project_v2', 'command_v2')).toMatchObject({ status: 'applied' });

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'applied', appliedRevision: 2, decidedAt: COMMITTED_AT });
    expect(harness.serviceApply).toHaveBeenCalledOnce();
    expect(harness.notify).toHaveBeenCalledOnce();
    await harness.processor.stop();
  });

  it('retains the applied marker until failed finish cleanup is repaired', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());
    harness.failNextFinishes();

    harness.processor.trigger('project_v2', 'command_v2');
    await waitForReceiptV2(harness);
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledOnce());
    expect(harness.tracker.pendingReceipt('project_v2', 'command_v2')).toMatchObject({ status: 'applied' });
    expect(harness.notify).not.toHaveBeenCalled();

    harness.processor.trigger('project_v2', 'command_v2');
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledTimes(2));

    expect(harness.serviceApply).toHaveBeenCalledOnce();
    expect(harness.tracker.pendingReceipt('project_v2', 'command_v2')).toBeNull();
    expect(harness.notify).toHaveBeenCalledOnce();
    await harness.processor.stop();
  });

  it('performs receipt-only restart cleanup without notification', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2' };
    const harness = createHarnessV2({ startupRefs: [ref] });
    const command = makeCommandV2();
    harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });
    harness.receiptReads.set(keyOf(ref.projectId, ref.commandId), {
      status: 'valid',
      record: {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId: ref.commandId,
        projectId: ref.projectId,
        expectedRevision: 1,
        decidedAt: COMMITTED_AT,
        status: 'applied',
        appliedRevision: 2,
        createdBeatIds: [],
        createdShotIds: [],
      },
    });

    await harness.processor.start();
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledWith(ref.projectId, ref.commandId));

    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('retains restart authority after an invalid durable receipt is removed', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2' };
    const harness = createHarnessV2({ startupRefs: [ref] });
    const command = makeCommandV2();
    harness.projects.set(ref.projectId, makeProjectV2(ref.projectId, command.expectedRevision));
    harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });
    harness.receiptReads.set(keyOf(ref.projectId, ref.commandId), { status: 'invalid' });

    await harness.processor.start();
    await vi.waitFor(() => expect(harness.mailbox.readReceipt).toHaveBeenCalled());
    harness.receiptReads.delete(keyOf(ref.projectId, ref.commandId));
    harness.processor.trigger(ref.projectId, ref.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'expired', reasonCode: 'expired_after_restart' });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('notifies an applied command once while preserving a successor published during finish', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const commandA = makeCommandV2('project_v2', 'command_a');
    const commandB = makeCommandV2('project_v2', 'command_b', { expectedRevision: 2 });
    addLiveCommandV2(harness, commandA);
    harness.finish.mockImplementationOnce(async (projectId, commandId) => {
      harness.pendings.delete(keyOf(projectId, commandId));
      harness.pendings.set(keyOf(projectId, commandB.commandId), { status: 'valid', record: commandB });
    });

    harness.processor.trigger(commandA.projectId, commandA.commandId);
    await waitForReceiptV2(harness, commandA.projectId, commandA.commandId);
    await vi.waitFor(() => expect(harness.notify).toHaveBeenCalledOnce());

    expect(harness.pendings.get(keyOf(commandB.projectId, commandB.commandId))).toEqual({
      status: 'valid',
      record: commandB,
    });
    expect(harness.notify).toHaveBeenCalledExactlyOnceWith(commandA.projectId);
    await harness.processor.stop();
  });

  it('serializes watcher and sweep duplicates on its schema-2 project queue', async () => {
    let releaseApply!: () => void;
    const applyBlocked = new Promise<void>((resolve) => {
      releaseApply = resolve;
    });
    const harness = createHarnessV2({
      serviceApply: async (command) => {
        await applyBlocked;
        return {
          project: makeProjectV2(command.projectId, 2),
          appliedRevision: 2,
          createdBeatIds: [],
          createdShotIds: [],
        };
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.emitWatch('project_v2', 'command_v2');
    harness.intervals.find(({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS)?.callback();
    await vi.waitFor(() => expect(harness.serviceApply).toHaveBeenCalledOnce());
    releaseApply();
    await waitForReceiptV2(harness);
    await vi.waitFor(() => expect(harness.finish).toHaveBeenCalledTimes(2));

    expect(harness.serviceApply).toHaveBeenCalledOnce();
    await harness.processor.stop();
  });

  it('runs independent schema-2 project queues concurrently', async () => {
    let active = 0;
    let maximumActive = 0;
    const releases = new Map<string, () => void>();
    const harness = createHarnessV2({
      serviceApply: async (command) => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise<void>((resolve) => releases.set(command.projectId, resolve));
        active -= 1;
        return {
          project: makeProjectV2(command.projectId, 2),
          appliedRevision: 2,
          createdBeatIds: [],
          createdShotIds: [],
        };
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2('project_a', 'command_a'));
    addLiveCommandV2(harness, makeCommandV2('project_b', 'command_b'));

    harness.processor.trigger('project_a', 'command_a');
    harness.processor.trigger('project_b', 'command_b');
    await vi.waitFor(() => expect(releases.size).toBe(2));
    expect(maximumActive).toBe(2);
    releases.get('project_a')?.();
    releases.get('project_b')?.();
    await Promise.all([
      waitForReceiptV2(harness, 'project_a', 'command_a'),
      waitForReceiptV2(harness, 'project_b', 'command_b'),
    ]);
    await harness.processor.stop();
  });

  it('owns schema-2 sweep and maintenance cadences and disposes once', async () => {
    const harness = createHarnessV2();
    await Promise.all([harness.processor.start(), harness.processor.start()]);

    expect(harness.intervals.map(({ delayMs }) => delayMs).toSorted((a, b) => a - b)).toEqual([
      STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS,
      STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS,
    ]);
    const pendingTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS
    )!.callback;
    const maintenanceTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS
    )!.callback;
    pendingTick();
    pendingTick();
    maintenanceTick();
    maintenanceTick();
    harness.emitWatch('project_v2');
    harness.processor.trigger('project_v2');
    await vi.waitFor(() => expect(harness.releaseOrphans).toHaveBeenCalledOnce());
    expect(harness.pruneReceipts).toHaveBeenCalledOnce();

    await Promise.all([harness.processor.stop(), harness.processor.stop()]);

    expect(harness.intervals.every(({ cleared }) => cleared)).toBe(true);
    expect(harness.mailbox.dispose).toHaveBeenCalledOnce();
  });

  it('resets failed schema-2 cursor sessions before retrying maintenance and pending sweeps', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2' };
    const harness = createHarnessV2();
    const listPendingPage = vi.mocked(harness.mailbox.listPendingPage);
    listPendingPage
      .mockResolvedValueOnce(page([], 'pending-token'))
      .mockRejectedValueOnce(new CreativeStudioStoreError('storage_error', 'closed pending cursor'))
      .mockImplementationOnce(async (cursor) => (cursor === null ? page([ref]) : page([])));
    harness.releaseOrphans
      .mockResolvedValueOnce({ processed: 0, nextCursor: 'slot-token' })
      .mockRejectedValueOnce(new CreativeStudioStoreError('storage_error', 'closed slot cursor'))
      .mockResolvedValueOnce({ processed: 0, nextCursor: null });
    harness.pruneReceipts
      .mockResolvedValueOnce({ processed: 0, nextCursor: 'receipt-token' })
      .mockRejectedValueOnce(new CreativeStudioStoreError('storage_error', 'closed receipt cursor'))
      .mockResolvedValueOnce({ processed: 0, nextCursor: null });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());
    const pendingTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_SWEEP_INTERVAL_MS
    )!.callback;
    const maintenanceTick = harness.intervals.find(
      ({ delayMs }) => delayMs === STUDIO_DIRECTOR_COMMAND_MAINTENANCE_INTERVAL_MS
    )!.callback;

    for (let callCount = 1; callCount <= 3; callCount += 1) {
      pendingTick();
      maintenanceTick();
      // eslint-disable-next-line no-await-in-loop
      await vi.waitFor(() => expect(harness.releaseOrphans).toHaveBeenCalledTimes(callCount));
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setImmediate(resolve));
    }

    expect(listPendingPage.mock.calls.slice(0, 3).map(([cursor]) => cursor)).toEqual([null, 'pending-token', null]);
    expect(harness.releaseOrphans.mock.calls.map(([cursor]) => cursor)).toEqual([null, 'slot-token', null]);
    expect(harness.pruneReceipts.mock.calls.map(([cursor]) => cursor)).toEqual([null, 'receipt-token', null]);
    await expect(waitForReceiptV2(harness)).resolves.toMatchObject({ status: 'applied' });
    await harness.processor.stop();
  });

  it.each([
    ['durable receipt', 'receipt'],
    ['pending command', 'pending'],
    ['project manifest', 'project'],
  ] as const)('leaves an unsupported schema-1 %s byte authority untouched', async (_label, authority) => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const command = makeCommandV2();
    if (authority === 'receipt') {
      harness.receiptReads.set(keyOf(command.projectId, command.commandId), {
        status: 'unsupported_prototype_schema',
      });
      addLiveCommandV2(harness, command);
    } else if (authority === 'pending') {
      harness.projects.set(command.projectId, makeProjectV2());
      harness.pendings.set(keyOf(command.projectId, command.commandId), {
        status: 'unsupported_prototype_schema',
        commandId: command.commandId,
        expectedRevision: command.expectedRevision,
      });
    } else {
      harness.projects.set(command.projectId, 'unsupported_prototype_schema');
      harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });
    }

    harness.processor.trigger(command.projectId, command.commandId);
    await vi.waitFor(() => expect(harness.mailbox.readReceipt).toHaveBeenCalled());
    if (authority !== 'receipt') await vi.waitFor(() => expect(harness.mailbox.readPending).toHaveBeenCalled());

    expect(harness.writeReceipt).not.toHaveBeenCalled();
    expect(harness.finish).not.toHaveBeenCalled();
    expect(harness.serviceApply).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it.each([
    {
      label: 'deadline before revision',
      nowMs: Date.parse('2026-08-16T12:00:13.000Z'),
      projectRevision: 2,
      expected: { status: 'expired', reasonCode: 'deadline_elapsed', observedRevision: 2 },
    },
    {
      label: 'stale revision',
      nowMs: NOW_MS,
      projectRevision: 2,
      expected: { status: 'rejected', reasonCode: 'stale_revision', observedRevision: 2 },
    },
    {
      label: 'future revision',
      nowMs: NOW_MS,
      projectRevision: 1,
      expectedRevision: 2,
      expected: { status: 'rejected', reasonCode: 'future_revision', observedRevision: 1 },
    },
  ])('$label has fixed precommit precedence', async ({ nowMs, projectRevision, expectedRevision = 1, expected }) => {
    const harness = createHarnessV2({ nowMs });
    await harness.processor.start();
    const command = makeCommandV2('project_v2', 'command_v2', { expectedRevision });
    harness.projects.set(command.projectId, makeProjectV2(command.projectId, projectRevision));
    harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject(expected);
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it.each([
    ['beat_capacity_reached', 'rejected'],
    ['dependency_blocked', 'rejected'],
    ['operation_not_permitted', 'rejected'],
    ['validation_failed', 'rejected'],
    ['deadline_elapsed', 'expired'],
  ] as const)('maps reducer reason %s without leaking error prose', async (reasonCode, status) => {
    const harness = createHarnessV2({
      serviceApply: async () => {
        throw new StudioDirectorCommandApplyErrorV2(reasonCode);
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status, reasonCode });
    expect(JSON.stringify(receipt)).not.toContain('prose');
    await harness.processor.stop();
  });

  it.each([
    ['stale_project', { status: 'rejected', reasonCode: 'stale_revision', observedRevision: 1 }],
    ['not_found', { status: 'rejected', reasonCode: 'project_not_found', observedRevision: null }],
    ['storage_error', { status: 'indeterminate', reasonCode: 'commit_attribution_unknown', observedRevision: 1 }],
  ] as const)('maps the schema-2 store %s boundary', async (code, expected) => {
    const harness = createHarnessV2({
      serviceApply: async () => {
        throw new CreativeStudioStoreError(code, 'opaque store detail');
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject(expected);
    expect(JSON.stringify(receipt)).not.toContain('opaque');
    await harness.processor.stop();
  });

  it('rejects malformed schema-2 pending bytes without loading the project', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    harness.pendings.set(keyOf('project_v2', 'command_v2'), {
      status: 'invalid',
      commandId: 'command_v2',
      expectedRevision: 17,
      reasonCode: 'malformed_record',
    });

    harness.processor.trigger('project_v2', 'command_v2');
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({
      status: 'rejected',
      reasonCode: 'malformed_record',
      expectedRevision: 17,
      observedRevision: null,
    });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('rejects a missing schema-2 project before dispatch', async () => {
    const harness = createHarnessV2();
    await harness.processor.start();
    const command = makeCommandV2();
    harness.pendings.set(keyOf(command.projectId, command.commandId), { status: 'valid', record: command });

    harness.processor.trigger(command.projectId, command.commandId);
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'rejected', reasonCode: 'project_not_found', observedRevision: null });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });

  it('defers a busy store result without receipt, cleanup, or notification', async () => {
    const harness = createHarnessV2({
      serviceApply: async () => {
        throw new CreativeStudioStoreError('busy', 'opaque busy detail');
      },
    });
    await harness.processor.start();
    addLiveCommandV2(harness, makeCommandV2());

    harness.processor.trigger('project_v2', 'command_v2');
    await vi.waitFor(() => expect(harness.serviceApply).toHaveBeenCalledOnce());

    expect(harness.writeReceipt).not.toHaveBeenCalled();
    expect(harness.finish).not.toHaveBeenCalled();
    expect(harness.notify).not.toHaveBeenCalled();
    expect(harness.pendings.has(keyOf('project_v2', 'command_v2'))).toBe(true);
    await harness.processor.stop();
  });

  it.each([
    [1, 1, 'expired', 'expired_after_restart'],
    [2, 1, 'rejected', 'future_revision'],
    [1, 2, 'indeterminate', 'indeterminate_after_restart'],
  ] as const)(
    'never replays a startup command at expected revision %i and canonical revision %i',
    async (expectedRevision, projectRevision, status, reasonCode) => {
      const ref = { projectId: 'project_v2', commandId: 'command_v2' };
      const harness = createHarnessV2({ startupRefs: [ref] });
      const command = makeCommandV2(ref.projectId, ref.commandId, { expectedRevision });
      harness.projects.set(ref.projectId, makeProjectV2(ref.projectId, projectRevision));
      harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });

      await harness.processor.start();
      const receipt = await waitForReceiptV2(harness);

      expect(receipt).toMatchObject({ status, reasonCode, observedRevision: projectRevision });
      expect(harness.serviceApply).not.toHaveBeenCalled();
      await harness.processor.stop();
    }
  );

  it('never replays a command recovered after the startup snapshot skipped its project', async () => {
    const ref = { projectId: 'project_v2', commandId: 'command_v2', startedBeforeProcessor: true as const };
    const harness = createHarnessV2();
    const command = makeCommandV2(ref.projectId, ref.commandId);
    harness.projects.set(ref.projectId, makeProjectV2(ref.projectId, command.expectedRevision));
    harness.pendings.set(keyOf(ref.projectId, ref.commandId), { status: 'valid', record: command });
    vi.mocked(harness.mailbox.listPendingPage).mockResolvedValueOnce(page([ref]));

    await harness.processor.start();
    const receipt = await waitForReceiptV2(harness);

    expect(receipt).toMatchObject({ status: 'expired', reasonCode: 'expired_after_restart' });
    expect(harness.serviceApply).not.toHaveBeenCalled();
    await harness.processor.stop();
  });
});

describe('Studio Director schema-2 real mailbox terminal cleanup', () => {
  it.each([
    {
      label: 'malformed record with a recovered revision',
      expectedRevision: 1,
      reasonCode: 'malformed_record' as const,
      pending: (projectId: string, commandId: string) => ({
        ...makeCommandV2(projectId, commandId),
        policy: 'manual_review',
      }),
    },
    {
      label: 'malformed record without a recoverable revision',
      expectedRevision: null,
      reasonCode: 'malformed_record' as const,
      pending: (projectId: string, commandId: string) => ({
        ...makeCommandV2(projectId, commandId),
        expectedRevision: 'invalid',
      }),
    },
    {
      label: 'unknown future schema record',
      expectedRevision: 1,
      reasonCode: 'unsupported_version' as const,
      pending: (projectId: string, commandId: string) => ({
        ...makeCommandV2(projectId, commandId),
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2 + 1,
      }),
    },
  ])(
    'durably rejects and releases real mailbox authority for a $label',
    async ({ expectedRevision, reasonCode, pending }) => {
      const rootDir = mkdtempSync(path.join(tmpdir(), 'studio-director-v2-invalid-'));
      let processor: StudioDirectorCommandProcessorV2 | null = null;
      try {
        const tracker = createStudioDirectorCommitTrackerV2();
        const store = createCreativeStudioStore({
          rootDir,
          now: () => COMMITTED_AT,
          createId: () => 'project_v2_invalid',
          onProjectCommitted: tracker.observe,
        });
        const project = await store.createProjectV2(makeInput('Invalid V2 terminal cleanup'));
        const mailbox = createStudioDirectorCommandMailboxV2({
          rootDir,
          store,
          now: () => new Date(NOW_MS).toISOString(),
          watchCommandTree: () => ({ close: vi.fn() }),
        });
        await mailbox.ensure(project.id);
        const getProjectV2 = vi.fn(store.getProjectV2.bind(store));
        const service = createStudioDirectorCommandServiceV2({ store });
        const apply = vi.fn(service.apply);
        const notify = vi.fn();
        processor = createStudioDirectorCommandProcessorV2({
          store: { getProjectV2 },
          mailbox,
          service: { apply },
          tracker,
          onProjectUpdated: notify,
          now: () => NOW_MS,
          setInterval: () => ({ interval: true }),
          clearInterval: vi.fn(),
          logError: vi.fn(),
        });
        await processor.start();
        const commandId = `command_${reasonCode}_${expectedRevision === null ? 'null' : 'revision'}`;
        await publishRealPendingV2({
          rootDir,
          projectId: project.id,
          commandId,
          pending: pending(project.id, commandId),
        });

        processor.trigger(project.id, commandId);
        await vi.waitFor(async () =>
          expect(await mailbox.readReceipt(project.id, commandId)).toMatchObject({
            status: 'valid',
            record: {
              schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
              commandId,
              projectId: project.id,
              expectedRevision,
              status: 'rejected',
              observedRevision: null,
              reasonCode,
            },
          })
        );
        await vi.waitFor(
          async () => {
            await expect(mailbox.readPending(project.id, commandId)).resolves.toBeNull();
            await expect(
              nodeFs.lstat(path.join(realCommandDirectories(rootDir, project.id).slots, '0.slot'))
            ).rejects.toMatchObject({ code: 'ENOENT' });
            await expect(
              nodeFs.lstat(path.join(realCommandDirectories(rootDir, project.id).slots, '0.slot.lease'))
            ).rejects.toMatchObject({ code: 'ENOENT' });
          },
          { timeout: 5_000 }
        );

        expect(getProjectV2).not.toHaveBeenCalled();
        expect(apply).not.toHaveBeenCalled();
        expect(notify).not.toHaveBeenCalled();
        await expect(mailbox.readReceipt(project.id, commandId)).resolves.toMatchObject({
          status: 'valid',
          record: { status: 'rejected', expectedRevision, reasonCode },
        });
      } finally {
        await processor?.stop();
        rmSync(rootDir, { recursive: true, force: true });
      }
    }
  );

  it('repairs a durable malformed rejection through a fresh real mailbox after finish fails', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'studio-director-v2-invalid-restart-'));
    let firstProcessor: StudioDirectorCommandProcessorV2 | null = null;
    let restartedProcessor: StudioDirectorCommandProcessorV2 | null = null;
    try {
      const firstTracker = createStudioDirectorCommitTrackerV2();
      const store = createCreativeStudioStore({
        rootDir,
        now: () => COMMITTED_AT,
        createId: () => 'project_v2_invalid_restart',
        onProjectCommitted: firstTracker.observe,
      });
      const project = await store.createProjectV2(makeInput('Invalid V2 restart cleanup'));
      const firstMailbox = createStudioDirectorCommandMailboxV2({
        rootDir,
        store,
        now: () => new Date(NOW_MS).toISOString(),
        watchCommandTree: () => ({ close: vi.fn() }),
      });
      await firstMailbox.ensure(project.id);
      const firstFinish = vi.fn(async () => {
        throw new CreativeStudioStoreError('storage_error', 'injected finish failure');
      });
      const firstApply = vi.fn(createStudioDirectorCommandServiceV2({ store }).apply);
      const firstNotify = vi.fn();
      firstProcessor = createStudioDirectorCommandProcessorV2({
        store,
        mailbox: { ...firstMailbox, finish: firstFinish },
        service: { apply: firstApply },
        tracker: firstTracker,
        onProjectUpdated: firstNotify,
        now: () => NOW_MS,
        setInterval: () => ({ interval: true }),
        clearInterval: vi.fn(),
        logError: vi.fn(),
      });
      await firstProcessor.start();
      const commandId = 'command_invalid_restart';
      await publishRealPendingV2({
        rootDir,
        projectId: project.id,
        commandId,
        pending: { ...makeCommandV2(project.id, commandId), operations: [] },
      });

      firstProcessor.trigger(project.id, commandId);
      await vi.waitFor(() => expect(firstFinish).toHaveBeenCalledExactlyOnceWith(project.id, commandId));
      await vi.waitFor(async () =>
        expect(await firstMailbox.readReceipt(project.id, commandId)).toMatchObject({
          status: 'valid',
          record: { status: 'rejected', reasonCode: 'malformed_record', expectedRevision: project.revision },
        })
      );
      expect(firstApply).not.toHaveBeenCalled();
      expect(firstNotify).not.toHaveBeenCalled();
      const directories = realCommandDirectories(rootDir, project.id);
      const receiptFile = path.join(directories.receipts, `${commandId}.json`);
      const receiptBytes = await nodeFs.readFile(receiptFile, 'utf8');
      await expect(nodeFs.lstat(path.join(directories.pending, `${commandId}.json`))).resolves.toBeDefined();
      await expect(nodeFs.lstat(path.join(directories.slots, '0.slot'))).resolves.toBeDefined();
      await firstProcessor.stop();

      const restartedMailbox = createStudioDirectorCommandMailboxV2({
        rootDir,
        store,
        now: () => new Date(NOW_MS).toISOString(),
        watchCommandTree: () => ({ close: vi.fn() }),
      });
      const restartedTracker = createStudioDirectorCommitTrackerV2();
      const restartedGetProject = vi.fn(store.getProjectV2.bind(store));
      const restartedApply = vi.fn(createStudioDirectorCommandServiceV2({ store }).apply);
      const restartedNotify = vi.fn();
      restartedProcessor = createStudioDirectorCommandProcessorV2({
        store: { getProjectV2: restartedGetProject },
        mailbox: restartedMailbox,
        service: { apply: restartedApply },
        tracker: restartedTracker,
        onProjectUpdated: restartedNotify,
        now: () => NOW_MS,
        setInterval: () => ({ interval: true }),
        clearInterval: vi.fn(),
        logError: vi.fn(),
      });

      await restartedProcessor.start();
      await vi.waitFor(async () => {
        await expect(restartedMailbox.readPending(project.id, commandId)).resolves.toBeNull();
        await expect(nodeFs.lstat(path.join(directories.slots, '0.slot'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(nodeFs.lstat(path.join(directories.slots, '0.slot.lease'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      });

      await expect(nodeFs.readFile(receiptFile, 'utf8')).resolves.toBe(receiptBytes);
      expect(restartedGetProject).not.toHaveBeenCalled();
      expect(restartedApply).not.toHaveBeenCalled();
      expect(restartedNotify).not.toHaveBeenCalled();
    } finally {
      await restartedProcessor?.stop();
      await firstProcessor?.stop();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('leaves a complete schema-1 command tree byte-identical behind a V2 terminal receipt', async () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'studio-director-v2-v1-no-touch-'));
    let processor: StudioDirectorCommandProcessorV2 | null = null;
    try {
      const tracker = createStudioDirectorCommitTrackerV2();
      const store = createCreativeStudioStore({
        rootDir,
        now: () => COMMITTED_AT,
        createId: () => 'project_v2_v1_no_touch',
        onProjectCommitted: tracker.observe,
      });
      const project = await store.createProjectV2(makeInput('schema-1 command no-touch'));
      const mailbox = createStudioDirectorCommandMailboxV2({
        rootDir,
        store,
        now: () => new Date(NOW_MS).toISOString(),
        watchCommandTree: () => ({ close: vi.fn() }),
      });
      await mailbox.ensure(project.id);
      const commandId = 'command_v1_no_touch';
      const command = {
        schemaVersion: 1 as const,
        commandId,
        projectId: project.id,
        expectedRevision: project.revision,
        createdAt: '2026-08-16T12:00:00.000Z',
        deadlineAt: '2026-08-16T12:00:15.000Z',
        policy: 'auto_apply' as const,
        operations: [{ kind: 'set_brief' as const, brief: 'Schema-1 bytes stay untouched' }],
      };
      const slot = {
        schemaVersion: 1 as const,
        commandId,
        reservedAt: command.createdAt,
        deadlineAt: command.deadlineAt,
      };
      const acquiredAt = '2026-08-16T12:00:00.000Z';
      const directories = realCommandDirectories(rootDir, project.id);
      await nodeFs.writeFile(path.join(directories.pending, `${commandId}.json`), JSON.stringify(command));
      await nodeFs.writeFile(path.join(directories.slots, '0.slot'), JSON.stringify(slot));
      await nodeFs.writeFile(
        path.join(directories.slots, '0.slot.lease'),
        JSON.stringify({
          schemaVersion: 1,
          leaseId: 'lease_v1_no_touch',
          owner: 'writer',
          commandId,
          reservedAt: slot.reservedAt,
          deadlineAt: slot.deadlineAt,
          acquiredAt,
          expiresAt: new Date(Date.parse(acquiredAt) + STUDIO_DIRECTOR_COMMAND_ACK_GRACE_MS).toISOString(),
        })
      );
      await mailbox.writeReceipt(project.id, {
        schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
        commandId,
        projectId: project.id,
        expectedRevision: project.revision,
        decidedAt: COMMITTED_AT,
        status: 'rejected',
        observedRevision: null,
        reasonCode: 'malformed_record',
      });
      const before = await snapshotDirectoryBytes(directories.root);
      const finish = vi.fn(mailbox.finish.bind(mailbox));
      const getProjectV2 = vi.fn(store.getProjectV2.bind(store));
      const apply = vi.fn(createStudioDirectorCommandServiceV2({ store }).apply);
      const notify = vi.fn();
      processor = createStudioDirectorCommandProcessorV2({
        store: { getProjectV2 },
        mailbox: { ...mailbox, finish },
        service: { apply },
        tracker,
        onProjectUpdated: notify,
        now: () => NOW_MS,
        setInterval: () => ({ interval: true }),
        clearInterval: vi.fn(),
        logError: vi.fn(),
      });

      await processor.start();
      expect(finish).toHaveBeenCalledExactlyOnceWith(project.id, commandId);
      expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
      expect(getProjectV2).not.toHaveBeenCalled();
      expect(apply).not.toHaveBeenCalled();
      expect(notify).not.toHaveBeenCalled();
      await processor.stop();
      expect(await snapshotDirectoryBytes(directories.root)).toEqual(before);
    } finally {
      await processor?.stop();
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
