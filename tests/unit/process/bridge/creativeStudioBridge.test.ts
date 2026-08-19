/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_VIEWS,
  type StudioMutationBatchResultV2,
  type StudioRendererPreparedSubmissionOptionsV2,
  type StudioRendererProjectV2,
  type StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import { StudioPreparedSubmissionCacheErrorV2 } from '@process/services/creative-studio/service/schema2/preparedSubmissionCache';
import type { CreativeStudioServiceV2 } from '@process/services/creative-studio/service/v2Service';

const providerNames = [
  'listProjects',
  'createProject',
  'getProject',
  'getBriefSessionServer',
  'listProposals',
  'acceptProposal',
  'rejectProposal',
  'listReferenceRequests',
  'decideReferenceRequest',
  'listReferenceGenerationHandoffs',
  'prepareSubmission',
  'confirmSubmission',
  'dismissReferenceGenerationHandoff',
  'applyAuthoringBatch',
  'undoLast',
  'getWorkspaceStatus',
  'getChainStatus',
  'retryConditioningFrame',
  'cancelWaitingCascade',
  'editProject',
  'setRules',
  'parkBeat',
  'restoreBeat',
  'parkShot',
  'restoreShot',
  'parkTake',
  'addAlternateTake',
  'restoreTake',
  'selectTake',
  'reorderBin',
  'deleteProject',
  'persistCapturedPoster',
  'chooseAndImportReference',
  'detachBriefReference',
  'importSeedStill',
  'listConnectionCandidates',
  'listConnections',
  'validateConnection',
  'saveConnection',
  'removeConnection',
  'listRoutes',
] as const;

type ProviderName = (typeof providerNames)[number];
const mocks = vi.hoisted(() => ({
  providers: Object.fromEntries(
    [
      'listProjects',
      'createProject',
      'getProject',
      'getBriefSessionServer',
      'listProposals',
      'acceptProposal',
      'rejectProposal',
      'listReferenceRequests',
      'decideReferenceRequest',
      'listReferenceGenerationHandoffs',
      'prepareSubmission',
      'confirmSubmission',
      'dismissReferenceGenerationHandoff',
      'applyAuthoringBatch',
      'undoLast',
      'getWorkspaceStatus',
      'getChainStatus',
      'retryConditioningFrame',
      'cancelWaitingCascade',
      'editProject',
      'setRules',
      'parkBeat',
      'restoreBeat',
      'parkShot',
      'restoreShot',
      'parkTake',
      'addAlternateTake',
      'restoreTake',
      'selectTake',
      'reorderBin',
      'deleteProject',
      'persistCapturedPoster',
      'chooseAndImportReference',
      'detachBriefReference',
      'importSeedStill',
      'listConnectionCandidates',
      'listConnections',
      'validateConnection',
      'saveConnection',
      'removeConnection',
      'listRoutes',
    ].map((name) => [name, vi.fn()])
  ) as Record<ProviderName, ReturnType<typeof vi.fn>>,
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: Object.fromEntries(Object.entries(mocks.providers).map(([name, provider]) => [name, { provider }])),
  },
}));
vi.mock('@/common/config/constants', () => ({ CREATIVE_STUDIO_ENABLED: true }));
vi.mock('@process/services/creative-studio/runtime', () => ({ getCreativeStudioService: vi.fn() }));

import {
  createCreativeStudioCloseHandshake,
  initCreativeStudioBridge,
  type CreativeStudioBridgeDependencies,
  type CreativeStudioCloseHandshakeDependencies,
} from '@process/bridge/creativeStudioBridge';
import { CreativeStudioServiceError } from '@process/services/creative-studio/service/projectMutations';

type ProviderHandler = (input?: never) => Promise<unknown>;

const rendererProject = { id: 'project_1', revision: 7 } as StudioRendererProjectV2;
const mutationResult: StudioMutationBatchResultV2 = {
  project: rendererProject,
  createdBeatIds: ['beat_2'],
  createdShotIds: ['shot_3'],
};
const workspaceStatus: StudioRendererWorkspaceStatusV2 = {
  projectId: 'project_1',
  projectRevision: 8,
  undoTop: null,
  dirtyShots: [],
  cascadeProgress: [],
  parkEligibility: [],
};
const preparedSubmission = {
  baseOnly: {
    id: 'quote_1',
    projectId: 'project_1',
    projectRevision: 7,
    expiresAt: '2026-08-19T02:08:04.000Z',
    currency: 'USD',
    baseItems: [
      {
        shotId: 'shot_1',
        purpose: 'seed_still',
        route: { choiceId: 'route_image_1', providerId: 'provider_1', model: 'image-model' },
        generationCount: 2,
        durationSeconds: null,
        oneGenerationMinorUnits: 125,
        requestedTotalMinorUnits: 250,
        waitsForTakeSelection: false,
      },
    ],
    cascadeItems: [],
    lowerMinorUnits: 250,
    upperMinorUnits: 250,
    budget: { kind: 'within_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 500 },
  },
  withCascade: {
    id: 'quote_2',
    projectId: 'project_1',
    projectRevision: 7,
    expiresAt: '2026-08-19T02:08:04.000Z',
    currency: 'USD',
    baseItems: [
      {
        shotId: 'shot_1',
        purpose: 'seed_still',
        route: { choiceId: 'route_image_1', providerId: 'provider_1', model: 'image-model' },
        generationCount: 2,
        durationSeconds: null,
        oneGenerationMinorUnits: 125,
        requestedTotalMinorUnits: 250,
        waitsForTakeSelection: false,
      },
    ],
    cascadeItems: [
      {
        shotId: 'shot_2',
        purpose: 'video_take',
        route: { choiceId: 'route_video_1', providerId: 'provider_2', model: 'video-model' },
        generationCount: 1,
        durationSeconds: 8,
        oneGenerationMinorUnits: 800,
        requestedTotalMinorUnits: 800,
        waitsForTakeSelection: true,
      },
    ],
    lowerMinorUnits: 250,
    upperMinorUnits: 1_050,
    budget: { kind: 'over_cap', policyCurrency: 'USD', maxPerBatchMinorUnits: 500 },
  },
} satisfies StudioRendererPreparedSubmissionOptionsV2;

const createService = () =>
  ({
    listProjects: vi.fn(async () => ({ projects: [], unsupportedProjectIds: [], quarantinedProjectIds: [] })),
    createProject: vi.fn(async () => rendererProject),
    getProject: vi.fn(async () => ({ status: 'supported' as const, project: rendererProject })),
    getBriefSessionServer: vi.fn(async () => ({
      id: 'studio-brief-project_1',
      name: 'aionui-creative-studio',
      transport: { type: 'stdio' as const, command: 'node', args: ['/tmp/builtin-mcp-studio.js'] },
    })),
    listProposals: vi.fn(async () => []),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
    listReferenceRequests: vi.fn(async () => []),
    decideReferenceRequest: vi.fn(),
    listReferenceGenerationHandoffs: vi.fn(async () => []),
    prepareSubmission: vi.fn(async () => preparedSubmission),
    confirmSubmission: vi.fn(async () => ({ projectId: 'project_1', projectRevision: 8 })),
    dismissReferenceGenerationHandoff: vi.fn(async () => ({
      status: 'dismissed' as const,
      completedAt: '2026-08-19T02:03:04.000Z',
    })),
    applyMutations: vi.fn(async () => mutationResult),
    getWorkspaceStatus: vi.fn(async () => workspaceStatus),
    getChainStatus: vi.fn(async () => ({ projectId: 'project_1', projectRevision: 8, conditioningFailures: [] })),
    retryConditioningFrame: vi.fn(async () => workspaceStatus),
    cancelWaitingCascade: vi.fn(async () => workspaceStatus),
    deleteProject: vi.fn(async () => true),
    persistCapturedPoster: vi.fn(async () => ({ id: 'poster_1' })),
    importReferenceFromPath: vi.fn(async () => ({ asset: { id: 'asset_1' }, project: rendererProject })),
    detachBriefReference: vi.fn(async () => rendererProject),
    listConnectionCandidates: vi.fn(async () => []),
    listConnections: vi.fn(async () => ({ integrations: [], connections: [] })),
    validateConnection: vi.fn(),
    saveConnection: vi.fn(),
    removeConnection: vi.fn(async () => true),
    listRoutes: vi.fn(),
  }) as unknown as CreativeStudioServiceV2 & {
    getBriefSessionServer: ReturnType<typeof vi.fn>;
    listConnectionCandidates: ReturnType<typeof vi.fn>;
    listConnections: ReturnType<typeof vi.fn>;
    validateConnection: ReturnType<typeof vi.fn>;
    saveConnection: ReturnType<typeof vi.fn>;
    removeConnection: ReturnType<typeof vi.fn>;
  };

const registeredHandler = (name: ProviderName): ProviderHandler => {
  const handler = mocks.providers[name].mock.calls[0]?.[0];
  if (typeof handler !== 'function') throw new Error(`Missing ${name} provider handler`);
  return handler as ProviderHandler;
};

describe('initCreativeStudioBridge', () => {
  let service: ReturnType<typeof createService>;
  let dependencies: CreativeStudioBridgeDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    service = createService();
    dependencies = {
      getService: () => service,
      createMutationId: () => 'native_mutation_1',
      now: () => new Date('2026-08-19T02:03:04.000Z'),
      getParentWindow: () => undefined,
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/private/reference.png'] })),
    };
  });

  it('registers exactly the reviewed V2 and schema-independent settings providers', () => {
    initCreativeStudioBridge(dependencies);
    for (const name of providerNames) expect(mocks.providers[name], name).toHaveBeenCalledOnce();
  });

  it('refuses commands before service, picker, or context work when disabled', async () => {
    const getService = vi.fn(() => service);
    const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/private/reference.png'] }));
    initCreativeStudioBridge({ ...dependencies, isFeatureEnabled: () => false, getService, showOpenDialog });

    await expect(
      registeredHandler('applyAuthoringBatch')({
        projectId: 'project_1',
        expectedRevision: 1,
        operations: [{ kind: 'set_brief', brief: 'x' }],
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'feature_disabled', messageKey: 'conversation.creativeStudio.errors.featureDisabled' },
    });
    await expect(
      registeredHandler('importSeedStill')({
        projectId: 'project_1',
        expectedRevision: 1,
        shotId: 'shot_1',
      } as never)
    ).resolves.toMatchObject({ ok: false });
    expect(getService).not.toHaveBeenCalled();
    expect(showOpenDialog).not.toHaveBeenCalled();
  });

  it('mints the reducer envelope in main and returns only the exact commit DTO', async () => {
    initCreativeStudioBridge(dependencies);
    const input = {
      projectId: 'project_1',
      expectedRevision: 6,
      operations: [{ kind: 'set_brief' as const, brief: 'Revised' }],
    };

    await expect(registeredHandler('applyAuthoringBatch')(input as never)).resolves.toEqual({
      ok: true,
      data: {
        projectId: 'project_1',
        projectRevision: 7,
        createdBeatIds: ['beat_2'],
        createdShotIds: ['shot_3'],
      },
    });
    expect(service.applyMutations).toHaveBeenCalledExactlyOnceWith(
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        operations: input.operations,
      },
      { mutationId: 'native_mutation_1', capturedAt: '2026-08-19T02:03:04.000Z' }
    );
    expect((await registeredHandler('applyAuthoringBatch')(input as never)) as object).not.toHaveProperty('project');
  });

  it.each([
    [
      'undoLast',
      { projectId: 'project_1', expectedRevision: 1, entryId: 'undo_1' },
      { kind: 'undo_last', entryId: 'undo_1' },
    ],
    [
      'editProject',
      { projectId: 'project_1', expectedRevision: 1, changes: { name: 'Changed' } },
      { kind: 'edit_project', changes: { name: 'Changed' } },
    ],
    ['setRules', { projectId: 'project_1', expectedRevision: 1, rules: [] }, { kind: 'set_rules', rules: [] }],
    [
      'parkBeat',
      { projectId: 'project_1', expectedRevision: 1, beatId: 'beat_1' },
      { kind: 'park_beat', beatId: 'beat_1' },
    ],
    [
      'restoreBeat',
      { projectId: 'project_1', expectedRevision: 1, beatId: 'beat_1', beforeBeatId: null },
      { kind: 'restore_beat', beatId: 'beat_1', beforeBeatId: null },
    ],
    [
      'parkShot',
      { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1' },
      { kind: 'park_shot', shotId: 'shot_1' },
    ],
    [
      'restoreShot',
      { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1', beforeShotId: null },
      { kind: 'restore_shot', shotId: 'shot_1', beforeShotId: null },
    ],
    [
      'parkTake',
      { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1', assetId: 'asset_1' },
      { kind: 'park_take', shotId: 'shot_1', assetId: 'asset_1' },
    ],
    [
      'addAlternateTake',
      { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1', assetId: 'asset_1' },
      { kind: 'add_alternate_take', shotId: 'shot_1', assetId: 'asset_1' },
    ],
    [
      'restoreTake',
      { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1', assetId: 'asset_1' },
      { kind: 'restore_take', shotId: 'shot_1', assetId: 'asset_1' },
    ],
    [
      'selectTake',
      { projectId: 'project_1', expectedRevision: 1, shotId: 'shot_1', assetId: 'asset_1' },
      { kind: 'select_take', shotId: 'shot_1', assetId: 'asset_1' },
    ],
    ['reorderBin', { projectId: 'project_1', expectedRevision: 1, bin: [] }, { kind: 'reorder_bin', bin: [] }],
  ] as const)('maps %s to one same-named reducer operation', async (providerName, input, operation) => {
    initCreativeStudioBridge(dependencies);
    await registeredHandler(providerName)(input as never);
    expect(service.applyMutations).toHaveBeenCalledExactlyOnceWith(
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        operations: [operation],
      },
      { mutationId: 'native_mutation_1', capturedAt: '2026-08-19T02:03:04.000Z' }
    );
  });

  it.each(['retryConditioningFrame', 'cancelWaitingCascade'] as const)(
    'projects %s to an empty-created-ids commit result',
    async (providerName) => {
      initCreativeStudioBridge(dependencies);
      await expect(
        registeredHandler(providerName)({
          projectId: 'project_1',
          expectedRevision: 7,
          dependentShotId: 'shot_2',
        } as never)
      ).resolves.toEqual({
        ok: true,
        data: { projectId: 'project_1', projectRevision: 8, createdBeatIds: [], createdShotIds: [] },
      });
    }
  );

  it('keeps read-only workspace and chain results on their exact service seams', async () => {
    initCreativeStudioBridge(dependencies);
    await expect(registeredHandler('getWorkspaceStatus')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: true,
      data: workspaceStatus,
    });
    await registeredHandler('getChainStatus')({ projectId: 'project_1' } as never);
    expect(service.getWorkspaceStatus).toHaveBeenCalledExactlyOnceWith({ projectId: 'project_1' });
    expect(service.getChainStatus).toHaveBeenCalledExactlyOnceWith({ projectId: 'project_1' });
  });

  it('routes bounded prepare choices and returns only the renderer-safe quote allowlist', async () => {
    initCreativeStudioBridge(dependencies);
    const input = {
      projectId: 'project_1',
      expectedRevision: 7,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still' as const, generationCount: 2, referenceAssetId: null }],
      cascadeChoices: [
        { shotId: 'shot_2', purpose: 'video_take' as const, generationCount: 1, referenceAssetId: null },
      ],
    };

    const result = (await registeredHandler('prepareSubmission')(input as never)) as {
      ok: true;
      data: StudioRendererPreparedSubmissionOptionsV2;
    };

    expect(service.prepareSubmission).toHaveBeenCalledExactlyOnceWith(input);
    expect(result).toEqual({ ok: true, data: preparedSubmission });
    expect(Object.keys(result.data).toSorted()).toEqual(['baseOnly', 'withCascade']);
    for (const quote of [result.data.baseOnly, result.data.withCascade]) {
      expect(quote).not.toBeNull();
      expect(Object.keys(quote!).toSorted()).toEqual([
        'baseItems',
        'budget',
        'cascadeItems',
        'currency',
        'expiresAt',
        'id',
        'lowerMinorUnits',
        'projectId',
        'projectRevision',
        'upperMinorUnits',
      ]);
      expect(Object.keys(quote!.budget).toSorted()).toEqual(['kind', 'maxPerBatchMinorUnits', 'policyCurrency']);
      for (const item of [...quote!.baseItems, ...quote!.cascadeItems]) {
        expect(Object.keys(item).toSorted()).toEqual([
          'durationSeconds',
          'generationCount',
          'oneGenerationMinorUnits',
          'purpose',
          'requestedTotalMinorUnits',
          'route',
          'shotId',
          'waitsForTakeSelection',
        ]);
        expect(Object.keys(item.route).toSorted()).toEqual(['choiceId', 'model', 'providerId']);
      }
    }

    const serialized = JSON.stringify(result.data);
    for (const forbiddenKey of [
      'authorizationId',
      'authorization',
      'itemId',
      'jobId',
      'rateCardDigest',
      'digest',
      'sha256',
      'routeId',
      'originReferenceHandoffId',
      'requestPlan',
      'requestSnapshot',
      'prompt',
      'referenceAssetId',
      'conditioningInput',
      'frameAssetId',
      'adapterId',
      'apiKey',
      'credentials',
      'providerJobId',
      'provider',
      'providerBindings',
      'cancellationPolicy',
      'receipt',
      'idempotencyKey',
    ]) {
      expect(serialized).not.toContain(`"${forbiddenKey}"`);
    }
  });

  it('routes confirm and dismiss through their exact safe service seams', async () => {
    initCreativeStudioBridge(dependencies);
    const confirmInput = { projectId: 'project_1', quoteId: 'quote_1', expectedRevision: 7 };
    const dismissInput = { projectId: 'project_1', expectedRevision: 7, handoffId: 'handoff_1' };

    const confirmed = (await registeredHandler('confirmSubmission')(confirmInput as never)) as {
      ok: true;
      data: Record<string, unknown>;
    };
    const dismissed = (await registeredHandler('dismissReferenceGenerationHandoff')(dismissInput as never)) as {
      ok: true;
      data: Record<string, unknown>;
    };

    expect(service.confirmSubmission).toHaveBeenCalledExactlyOnceWith(confirmInput);
    expect(service.dismissReferenceGenerationHandoff).toHaveBeenCalledExactlyOnceWith(dismissInput);
    expect(confirmed).toEqual({ ok: true, data: { projectId: 'project_1', projectRevision: 8 } });
    expect(Object.keys(confirmed.data).toSorted()).toEqual(['projectId', 'projectRevision']);
    expect(dismissed).toEqual({
      ok: true,
      data: { status: 'dismissed', completedAt: '2026-08-19T02:03:04.000Z' },
    });
    expect(Object.keys(dismissed.data).toSorted()).toEqual(['completedAt', 'status']);
  });

  it.each([
    ['quote_not_found', 'quoteNotFound'],
    ['quote_in_use', 'quoteInUse'],
    ['quote_cache_full', 'quoteCacheFull'],
    ['quote_too_large', 'quoteTooLarge'],
  ] as const)('preserves the %s cache error without collapsing it', async (code, messageKeyLeaf) => {
    vi.mocked(service.prepareSubmission).mockRejectedValueOnce(new StudioPreparedSubmissionCacheErrorV2(code));
    initCreativeStudioBridge(dependencies);

    await expect(
      registeredHandler('prepareSubmission')({
        projectId: 'project_1',
        expectedRevision: 7,
        originReferenceHandoffId: null,
        baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still', generationCount: 1, referenceAssetId: null }],
        cascadeChoices: [],
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code, messageKey: `conversation.creativeStudio.errors.${messageKeyLeaf}` },
    });
  });

  it('preserves stale_project from generic prepare as the stable public command error', async () => {
    vi.mocked(service.prepareSubmission).mockRejectedValueOnce(
      new CreativeStudioStoreError('stale_project', 'raw prepare revision details')
    );
    initCreativeStudioBridge(dependencies);

    await expect(
      registeredHandler('prepareSubmission')({
        projectId: 'project_1',
        expectedRevision: 6,
        originReferenceHandoffId: null,
        baseChoices: [{ shotId: 'shot_1', purpose: 'seed_still', generationCount: 1, referenceAssetId: null }],
        cascadeChoices: [{ shotId: 'shot_1', purpose: 'video_take', generationCount: 1, referenceAssetId: null }],
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
    });
  });

  it('keeps Brief and seed-still picker imports separate and returns no path or project', async () => {
    initCreativeStudioBridge(dependencies);
    const briefInput = { projectId: 'project_1', expectedRevision: 6, briefReferenceRole: 'look' as const };
    const seedInput = { projectId: 'project_1', expectedRevision: 6, shotId: 'shot_1' };

    await expect(registeredHandler('chooseAndImportReference')(briefInput as never)).resolves.toEqual({
      ok: true,
      data: { status: 'imported', assetId: 'asset_1', projectRevision: 7 },
    });
    await expect(registeredHandler('importSeedStill')(seedInput as never)).resolves.toEqual({
      ok: true,
      data: { status: 'imported', assetId: 'asset_1', projectRevision: 7 },
    });
    expect(service.importReferenceFromPath).toHaveBeenNthCalledWith(1, {
      ...briefInput,
      sourcePath: '/private/reference.png',
    });
    expect(service.importReferenceFromPath).toHaveBeenNthCalledWith(2, {
      ...seedInput,
      sourcePath: '/private/reference.png',
    });
  });

  it('returns picker cancellation without touching storage', async () => {
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    initCreativeStudioBridge({ ...dependencies, showOpenDialog });
    await expect(
      registeredHandler('importSeedStill')({
        projectId: 'project_1',
        expectedRevision: 6,
        shotId: 'shot_1',
      } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'cancelled' } });
    expect(service.importReferenceFromPath).not.toHaveBeenCalled();
  });

  it('projects Brief detach and maps media_in_use without leaking the media error', async () => {
    initCreativeStudioBridge(dependencies);
    await expect(
      registeredHandler('detachBriefReference')({
        projectId: 'project_1',
        expectedRevision: 6,
        assetId: 'asset_1',
      } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'detached', projectRevision: 7 } });

    vi.mocked(service.detachBriefReference).mockRejectedValueOnce(new CreativeStudioMediaError('media_in_use'));
    await expect(
      registeredHandler('detachBriefReference')({
        projectId: 'project_1',
        expectedRevision: 7,
        assetId: 'asset_1',
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'media_in_use', messageKey: 'conversation.creativeStudio.errors.mediaInUse' },
    });
  });

  it('redacts stale and unexpected service failures', async () => {
    vi.mocked(service.applyMutations).mockRejectedValueOnce(
      new CreativeStudioStoreError('stale_project', 'raw compare-and-set details')
    );
    initCreativeStudioBridge(dependencies);
    await expect(
      registeredHandler('undoLast')({
        projectId: 'project_1',
        expectedRevision: 1,
        entryId: 'undo_1',
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
    });

    vi.mocked(service.listProjects).mockRejectedValueOnce(new Error('private path'));
    await expect(registeredHandler('listProjects')()).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
  });

  it('retains schema-independent connection settings behind the V2 service', async () => {
    initCreativeStudioBridge(dependencies);
    await registeredHandler('listConnectionCandidates')();
    await registeredHandler('listConnections')();
    await registeredHandler('validateConnection')({
      providerId: 'provider_1',
      integrationId: 'image',
      model: 'm',
    } as never);
    await registeredHandler('saveConnection')({
      providerId: 'provider_1',
      integrationId: 'image',
      model: 'm',
    } as never);
    await registeredHandler('removeConnection')({ bindingId: 'binding_1' } as never);
    expect(service.listConnectionCandidates).toHaveBeenCalledOnce();
    expect(service.listConnections).toHaveBeenCalledOnce();
    expect(service.validateConnection).toHaveBeenCalledOnce();
    expect(service.saveConnection).toHaveBeenCalledOnce();
    expect(service.removeConnection).toHaveBeenCalledOnce();
  });

  it('maps explicit V2 service errors through the stable command envelope', async () => {
    vi.mocked(service.listRoutes).mockRejectedValueOnce(new CreativeStudioServiceError('provider_error'));
    initCreativeStudioBridge(dependencies);
    await expect(registeredHandler('listRoutes')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: false,
      error: { code: 'provider_error', messageKey: 'conversation.creativeStudio.errors.provider' },
    });
  });
});

type CloseEvent = { preventDefault: ReturnType<typeof vi.fn> };

const createCloseEvent = (): CloseEvent => ({ preventDefault: vi.fn() });

const createCloseHandshakeDependencies = (
  overrides: Partial<CreativeStudioCloseHandshakeDependencies> = {}
): CreativeStudioCloseHandshakeDependencies => ({
  getCurrentUrl: () => 'file:///Applications/WePrompt/index.html#/studio/project_1/table',
  queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 0 })),
  flushUnsavedWork: vi.fn(async () => ({ saved: true })),
  showMessageBox: vi.fn(async () => ({ response: 2 })),
  translate: (key, options) => (options?.count === undefined ? key : `${key}:${options.count}`),
  closeWindow: vi.fn(),
  hideWindow: vi.fn(),
  quitApp: vi.fn(),
  onQuitCancelled: vi.fn(),
  ...overrides,
});

const studioViewUrl = (segment: string): string =>
  `file:///Applications/WePrompt/index.html#/studio/project_1${segment ? `/${segment}` : ''}`;

/** Segments the rail or view switch used and later retired. */
const retiredPhaseSegments = ['brief', 'write', 'produce', 'review'] as const;

describe('createCreativeStudioCloseHandshake', () => {
  /**
   * The unsaved-draft preflight is gated by a route pattern that names every view segment. A view
   * the pattern does not know about closes the window silently, losing the drafts the handshake
   * exists to save, and no other assertion in this suite notices — the default fixture URL is one
   * single segment, so it can be the only recognised one and everything still passes.
   *
   * Enumerated from the shared `STUDIO_VIEWS` rather than a literal list, so a fifth view is
   * covered the day it is added and the bridge cannot pass by hardcoding a subset of the segments.
   */
  it('interpolates view segments into the route pattern without needing regex escaping', () => {
    // Guards the guard: an empty shared list would make every derived case below vacuous.
    expect(STUDIO_VIEWS).toEqual(['table', 'board', 'cut']);
    for (const view of STUDIO_VIEWS) {
      expect(view, `${view} must stay a plain lowercase segment`).toMatch(/^[a-z]+$/);
    }
    // The negative cases below only mean something while these names are genuinely not views.
    expect(STUDIO_VIEWS.filter((view) => retiredPhaseSegments.includes(view as never))).toEqual([]);
  });

  it.each([studioViewUrl(''), ...STUDIO_VIEWS.map(studioViewUrl)])(
    'runs the unsaved-work preflight for the Studio view route %s',
    async (currentUrl) => {
      const dependencies = createCloseHandshakeDependencies({ getCurrentUrl: () => currentUrl });
      const handshake = createCreativeStudioCloseHandshake(dependencies);
      const event = createCloseEvent();

      expect(handshake.handleWindowClose(event)).toBe(true);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      await vi.waitFor(() =>
        expect(dependencies.queryUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 })
      );
    }
  );

  it.each([
    'file:///Applications/WePrompt/index.html',
    'file:///Applications/WePrompt/index.html#/guid',
    'file:///Applications/WePrompt/index.html#/studio',
    'http://localhost:5173/#/studio-tools',
    'not a renderer URL',
    // The retired phase segments. They are no longer routes, so a URL carrying one is not a Studio
    // document and must not be treated as one — this half is what stops the pattern from being
    // widened into a match-anything that would make the positive cases above meaningless. Asserted
    // against the shared list too: a retired name must never come back as a view.
    ...retiredPhaseSegments.map(studioViewUrl),
  ])('leaves a non-Studio renderer route to the normal close lifecycle: %s', (currentUrl) => {
    const dependencies = createCloseHandshakeDependencies({ getCurrentUrl: () => currentUrl });
    const handshake = createCreativeStudioCloseHandshake(dependencies);
    const event = createCloseEvent();

    expect(handshake.handleWindowClose(event)).toBe(false);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(dependencies.queryUnsavedWork).not.toHaveBeenCalled();
  });

  it('prevents close synchronously and closes without hiding when the Studio renderer is clean', async () => {
    const dependencies = createCloseHandshakeDependencies();
    const handshake = createCreativeStudioCloseHandshake(dependencies);
    const firstEvent = createCloseEvent();

    expect(handshake.handleWindowClose(firstEvent)).toBe(true);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());

    const recursiveEvent = createCloseEvent();
    expect(handshake.handleWindowClose(recursiveEvent)).toBe(false);
    expect(recursiveEvent.preventDefault).not.toHaveBeenCalled();
    expect(dependencies.queryUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 });
    expect(dependencies.hideWindow).not.toHaveBeenCalled();
  });

  it('offers save, discard, and cancel for dirty drafts before flushing and closing', async () => {
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 2 })),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(dependencies.showMessageBox).toHaveBeenCalledExactlyOnceWith({
      type: 'warning',
      buttons: [
        'conversation.creativeStudio.close.saveAndClose',
        'conversation.creativeStudio.close.discard',
        'conversation.creativeStudio.close.cancel',
      ],
      defaultId: 0,
      cancelId: 2,
      message: 'conversation.creativeStudio.close.unsavedMessage:2',
    });
    expect(dependencies.flushUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 });
  });

  it('keeps the window open when the dirty-work dialog is cancelled', async () => {
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      showMessageBox: vi.fn(async () => ({ response: 2 })),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.showMessageBox).toHaveBeenCalledOnce());
    expect(dependencies.closeWindow).not.toHaveBeenCalled();
    expect(dependencies.flushUnsavedWork).not.toHaveBeenCalled();
  });

  it('offers only discard or cancel when the renderer query is unavailable', async () => {
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => {
        throw new Error('renderer query timed out');
      }),
      showMessageBox: vi.fn(async () => ({ response: 0 })),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(dependencies.showMessageBox).toHaveBeenCalledExactlyOnceWith({
      type: 'warning',
      buttons: ['conversation.creativeStudio.close.discard', 'conversation.creativeStudio.close.cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'conversation.creativeStudio.close.unavailableMessage',
    });
    expect(dependencies.flushUnsavedWork).not.toHaveBeenCalled();
  });

  it('keeps the window open when an unavailable-renderer discard prompt is cancelled', async () => {
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => {
        throw new Error('renderer query timed out');
      }),
      showMessageBox: vi.fn(async () => ({ response: 1 })),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.showMessageBox).toHaveBeenCalledOnce());
    expect(dependencies.closeWindow).not.toHaveBeenCalled();
  });

  it('offers only discard or cancel when saving cannot complete', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      flushUnsavedWork: vi.fn(async () => {
        throw new Error('renderer flush timed out');
      }),
      showMessageBox,
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(2));
    expect(showMessageBox.mock.calls[1]?.[0]).toMatchObject({
      buttons: ['conversation.creativeStudio.close.discard', 'conversation.creativeStudio.close.cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    expect(dependencies.flushUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 });
    expect(dependencies.closeWindow).not.toHaveBeenCalled();
  });

  it('runs only one renderer preflight while repeated close events are in flight', async () => {
    let resolveQuery: ((value: { dirtyDraftCount: number }) => void) | undefined;
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(
        () =>
          new Promise<{ dirtyDraftCount: number }>((resolve) => {
            resolveQuery = resolve;
          })
      ),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);
    const firstEvent = createCloseEvent();
    const secondEvent = createCloseEvent();

    handshake.handleWindowClose(firstEvent);
    handshake.handleWindowClose(secondEvent);

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce();
    expect(dependencies.queryUnsavedWork).toHaveBeenCalledOnce();
    resolveQuery?.({ dirtyDraftCount: 0 });
    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
  });

  it('hides the Studio window before explicit quit and bypasses its confirmed retry', async () => {
    const calls: string[] = [];
    const dependencies = createCloseHandshakeDependencies({
      hideWindow: vi.fn(() => calls.push('hide-window')),
      quitApp: vi.fn(() => calls.push('quit-app')),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);
    const firstEvent = createCloseEvent();

    expect(handshake.handleBeforeQuit(firstEvent)).toBe(true);
    expect(firstEvent.preventDefault).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(dependencies.quitApp).toHaveBeenCalledOnce());
    expect(calls).toEqual(['hide-window', 'quit-app']);

    const retryEvent = createCloseEvent();
    expect(handshake.handleBeforeQuit(retryEvent)).toBe(false);
    expect(retryEvent.preventDefault).not.toHaveBeenCalled();
    expect(dependencies.queryUnsavedWork).toHaveBeenCalledOnce();
  });

  it('does not hide the Studio window when explicit quit is cancelled', async () => {
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      showMessageBox: vi.fn(async () => ({ response: 2 })),
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleBeforeQuit(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.onQuitCancelled).toHaveBeenCalledOnce());
    expect(dependencies.hideWindow).not.toHaveBeenCalled();
    expect(dependencies.quitApp).not.toHaveBeenCalled();
  });

  it('resets explicit-quit state after cancellation so a later quit can retry', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 2 }).mockResolvedValueOnce({ response: 1 });
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      showMessageBox,
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleBeforeQuit(createCloseEvent());
    await vi.waitFor(() => expect(dependencies.onQuitCancelled).toHaveBeenCalledOnce());
    handshake.handleBeforeQuit(createCloseEvent());
    await vi.waitFor(() => expect(dependencies.quitApp).toHaveBeenCalledOnce());

    expect(dependencies.queryUnsavedWork).toHaveBeenCalledTimes(2);
  });

  it('does not repeat the renderer query when ordinary close is followed by process quit', async () => {
    const dependencies = createCloseHandshakeDependencies();
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());
    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    const quitEvent = createCloseEvent();

    expect(handshake.handleBeforeQuit(quitEvent)).toBe(false);
    expect(quitEvent.preventDefault).not.toHaveBeenCalled();
    expect(dependencies.queryUnsavedWork).toHaveBeenCalledOnce();
  });
});
