/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  STUDIO_MAX_EXPORTS_PER_SHAPE,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_VIEWS,
  type StudioMutationBatchResultV2,
  type StudioRendererPreparedSubmissionOptionsV2,
  type StudioRendererProjectV2,
  type StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import { StudioPreparedSubmissionCacheErrorV2 } from '@process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';
import { StudioPricingErrorV2 } from '@process/services/creative-studio/service/schema2/pricing/estimate';
import type { CreativeStudioServiceV2 } from '@process/services/creative-studio/service/v2Service';
import { StudioJobManagerError } from '@process/services/creative-studio/jobManager';

const providerNames = [
  'listProjects',
  'createProject',
  'getProject',
  'getBriefSessionServer',
  'getDirectorSessionAuthority',
  'bindDirectorConversation',
  'listProposals',
  'acceptProposal',
  'rejectProposal',
  'listReferenceRequests',
  'decideReferenceRequest',
  'listReferenceGenerationHandoffs',
  'getGenerationCapability',
  'prepareProjectReferences',
  'prepareSubmission',
  'confirmSubmission',
  'cancelJob',
  'retryJob',
  'retryDownload',
  'dismissReferenceGenerationHandoff',
  'applyAuthoringBatch',
  'undoLast',
  'getProjectWorkspace',
  'retryConditioningFrame',
  'cancelWaitingCascade',
  'editProject',
  'setRules',
  'parkBeat',
  'restoreBeat',
  'parkShot',
  'restoreShot',
  'reorderBin',
  'deleteProject',
  'persistCapturedPoster',
  'importSeedStill',
  'importBedAudio',
  'detachBedAudio',
  'setBed',
  'createExport',
  'listExports',
  'copyExport',
  'revealExport',
  'listConnectionCandidates',
  'listConnections',
  'validateConnection',
  'saveConnection',
  'removeConnection',
  'listRoutes',
] as const;

type ProviderName = (typeof providerNames)[number];
const mocks = vi.hoisted(() => ({
  mainTranslate: vi.fn((key: string) => `main:${key}`),
  providers: Object.fromEntries(
    [
      'listProjects',
      'createProject',
      'getProject',
      'getBriefSessionServer',
      'getDirectorSessionAuthority',
      'bindDirectorConversation',
      'listProposals',
      'acceptProposal',
      'rejectProposal',
      'listReferenceRequests',
      'decideReferenceRequest',
      'listReferenceGenerationHandoffs',
      'getGenerationCapability',
      'prepareProjectReferences',
      'prepareSubmission',
      'confirmSubmission',
      'cancelJob',
      'retryJob',
      'retryDownload',
      'dismissReferenceGenerationHandoff',
      'applyAuthoringBatch',
      'undoLast',
      'getProjectWorkspace',
      'retryConditioningFrame',
      'cancelWaitingCascade',
      'editProject',
      'setRules',
      'parkBeat',
      'restoreBeat',
      'parkShot',
      'restoreShot',
      'reorderBin',
      'deleteProject',
      'persistCapturedPoster',
      'importSeedStill',
      'importBedAudio',
      'detachBedAudio',
      'setBed',
      'createExport',
      'listExports',
      'copyExport',
      'revealExport',
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
vi.mock('@process/services/i18n', () => ({ default: { t: mocks.mainTranslate } }));

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
  boardPanels: [],
  cascadeProgress: [],
  currentVideoJobs: [],
  parkEligibility: [],
};
const generationCapability = {
  projectId: 'project_1',
  projectRevision: 7,
  catalogVersion: 'catalog_1',
  supportedItems: [
    { target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const },
    { target: { kind: 'reference' as const, referenceId: 'reference_1' }, purpose: 'reference_image' as const },
  ],
  blocks: [
    {
      block: { code: 'first_frame' as const, role: 'video' as const },
      items: [{ target: { kind: 'shot' as const, shotId: 'shot_3' }, purpose: 'video_take' as const }],
    },
  ],
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
        generationCount: 1,
        durationSeconds: null,
        oneGenerationMinorUnits: 125,
        requestedTotalMinorUnits: 125,
      },
    ],
    cascadeItems: [],
    lowerMinorUnits: 125,
    upperMinorUnits: 125,
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
        generationCount: 1,
        durationSeconds: null,
        oneGenerationMinorUnits: 125,
        requestedTotalMinorUnits: 125,
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
      },
    ],
    lowerMinorUnits: 125,
    upperMinorUnits: 925,
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
    getDirectorSessionAuthority: vi.fn(async () => ({
      serverId: 'studio-brief-project_1',
      serverName: 'aionui-creative-studio',
      scriptPath: '/repo/out/main/builtin-mcp-studio.js',
      projectDir: '/studio/project_1',
      pendingDir: '/studio/project_1/proposals/pending',
      referencePendingDir: '/studio/project_1/reference-requests/pending',
    })),
    bindDirectorConversation: vi.fn(async () => ({
      projectId: 'project_1',
      projectRevision: 8,
      createdBeatIds: [],
      createdShotIds: [],
    })),
    listProposals: vi.fn(async () => []),
    acceptProposal: vi.fn(),
    rejectProposal: vi.fn(),
    listReferenceRequests: vi.fn(async () => []),
    decideReferenceRequest: vi.fn(),
    listReferenceGenerationHandoffs: vi.fn(async () => []),
    getGenerationCapability: vi.fn(async () => generationCapability),
    prepareProjectReferences: vi.fn(async () => preparedSubmission),
    prepareSubmission: vi.fn(async () => preparedSubmission),
    confirmSubmission: vi.fn(async () => ({ projectId: 'project_1', projectRevision: 8 })),
    cancelJob: vi.fn(),
    retryJob: vi.fn(),
    retryDownload: vi.fn(),
    dismissReferenceGenerationHandoff: vi.fn(async () => ({
      status: 'dismissed' as const,
      completedAt: '2026-08-19T02:03:04.000Z',
    })),
    applyMutations: vi.fn(async () => mutationResult),
    getProjectWorkspace: vi.fn(async () => ({
      status: 'supported' as const,
      snapshot: {
        project: rendererProject,
        workspaceStatus,
        chainStatus: {
          projectId: 'project_1',
          projectRevision: 8,
          conditioningFailures: [],
          boundaries: [],
        },
      },
    })),
    retryConditioningFrame: vi.fn(async () => workspaceStatus),
    cancelWaitingCascade: vi.fn(async () => workspaceStatus),
    deleteProject: vi.fn(async () => true),
    persistCapturedPoster: vi.fn(async () => ({ id: 'poster_1' })),
    importSeedStillFromPath: vi.fn(async () => ({ asset: { id: 'asset_1' }, project: rendererProject })),
    importBedAudioFromPath: vi.fn(async () => ({ asset: { id: 'bed_1' }, project: rendererProject })),
    detachBedAudio: vi.fn(async () => rendererProject),
    createExport: vi.fn(async () => ({ revision: 2, artifacts: [] })),
    listExports: vi.fn(async () => ({ revision: 1, artifacts: [] })),
    copyExport: vi.fn(async () => ({ status: 'copied' as const })),
    revealExport: vi.fn(async () => ({ status: 'revealed' as const })),
    listConnectionCandidates: vi.fn(async () => []),
    listConnections: vi.fn(async () => ({ integrations: [], connections: [] })),
    validateConnection: vi.fn(),
    saveConnection: vi.fn(),
    removeConnection: vi.fn(async () => true),
    listRoutes: vi.fn(),
  }) as unknown as CreativeStudioServiceV2 & {
    getBriefSessionServer: ReturnType<typeof vi.fn>;
    getDirectorSessionAuthority: ReturnType<typeof vi.fn>;
    bindDirectorConversation: ReturnType<typeof vi.fn>;
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
      showAudioOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/private/bed.wav'] })),
      chooseExportDestination: vi.fn(async () => '/private/destination/editor-folder'),
      revealExportPath: vi.fn(),
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
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: input.projectId,
        expectedRevision: input.expectedRevision,
        operations: input.operations,
      },
      { mutationId: 'native_mutation_1', capturedAt: '2026-08-19T02:03:04.000Z' }
    );
    expect((await registeredHandler('applyAuthoringBatch')(input as never)) as object).not.toHaveProperty('project');
  });

  it('binds the Director conversation through the narrow service seam and returns only an empty-created commit DTO', async () => {
    initCreativeStudioBridge(dependencies);
    const input = { projectId: 'project_1', expectedRevision: 7, conversationId: 'conversation_1' };

    const result = await registeredHandler('bindDirectorConversation')(input as never);

    expect(result).toEqual({
      ok: true,
      data: {
        projectId: 'project_1',
        projectRevision: 8,
        createdBeatIds: [],
        createdShotIds: [],
      },
    });
    expect(service.bindDirectorConversation).toHaveBeenCalledExactlyOnceWith(input);
    expect(Object.keys((result as { data: object }).data)).toEqual([
      'projectId',
      'projectRevision',
      'createdBeatIds',
      'createdShotIds',
    ]);
    expect((result as { data: object }).data).not.toHaveProperty('project');
    expect((result as { data: object }).data).not.toHaveProperty('conversationId');
  });

  it('returns only the immutable Director transport authority through the narrow restart seam', async () => {
    initCreativeStudioBridge(dependencies);
    const input = { projectId: 'project_1' };

    const result = await registeredHandler('getDirectorSessionAuthority')(input as never);

    expect(result).toEqual({
      ok: true,
      data: {
        serverId: 'studio-brief-project_1',
        serverName: 'aionui-creative-studio',
        scriptPath: '/repo/out/main/builtin-mcp-studio.js',
        projectDir: '/studio/project_1',
        pendingDir: '/studio/project_1/proposals/pending',
        referencePendingDir: '/studio/project_1/reference-requests/pending',
      },
    });
    expect(service.getDirectorSessionAuthority).toHaveBeenCalledExactlyOnceWith(input);
    expect(Object.keys((result as { data: object }).data)).toEqual([
      'serverId',
      'serverName',
      'scriptPath',
      'projectDir',
      'pendingDir',
      'referencePendingDir',
    ]);
  });

  it('routes the exact generation-capability request through Main and returns its deterministic projection', async () => {
    initCreativeStudioBridge(dependencies);
    const input = {
      projectId: 'project_1',
      expectedRevision: 7,
      items: [
        { target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const },
        { target: { kind: 'reference' as const, referenceId: 'reference_1' }, purpose: 'reference_image' as const },
        { target: { kind: 'shot' as const, shotId: 'shot_3' }, purpose: 'video_take' as const },
      ],
    };

    const result = await registeredHandler('getGenerationCapability')(input as never);

    expect(service.getGenerationCapability).toHaveBeenCalledExactlyOnceWith(input);
    expect(result).toEqual({ ok: true, data: generationCapability });
    expect(Object.keys((result as { data: object }).data).toSorted()).toEqual([
      'blocks',
      'catalogVersion',
      'projectId',
      'projectRevision',
      'supportedItems',
    ]);
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
    ['reorderBin', { projectId: 'project_1', expectedRevision: 1, bin: [] }, { kind: 'reorder_bin', bin: [] }],
  ] as const)('maps %s to one same-named reducer operation', async (providerName, input, operation) => {
    initCreativeStudioBridge(dependencies);
    await registeredHandler(providerName)(input as never);
    expect(service.applyMutations).toHaveBeenCalledExactlyOnceWith(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
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

  it('keeps the project/workspace/chain snapshot on one exact service seam', async () => {
    initCreativeStudioBridge(dependencies);
    await expect(registeredHandler('getProjectWorkspace')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: true,
      data: {
        status: 'supported',
        snapshot: {
          project: rendererProject,
          workspaceStatus,
          chainStatus: {
            projectId: 'project_1',
            projectRevision: 8,
            conditioningFailures: [],
            boundaries: [],
          },
        },
      },
    });
    expect(service.getProjectWorkspace).toHaveBeenCalledExactlyOnceWith({ projectId: 'project_1' });
  });

  it('routes bounded prepare choices and returns only the renderer-safe quote allowlist', async () => {
    initCreativeStudioBridge(dependencies);
    const input = {
      projectId: 'project_1',
      expectedRevision: 7,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot' as const, shotId: 'shot_1' }, purpose: 'seed_still' as const }],
      cascadeChoices: [{ target: { kind: 'shot' as const, shotId: 'shot_2' }, purpose: 'video_take' as const }],
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

  it('routes reference preparation through pricing and human approval through the mutation reducer', async () => {
    initCreativeStudioBridge(dependencies);
    const prepareInput = {
      projectId: 'project_1',
      expectedRevision: 7,
      referenceIds: ['reference_character', 'reference_background'],
    };
    const approvalInput = {
      projectId: 'project_1',
      expectedRevision: 7,
      referenceId: 'reference_character',
      candidateAssetId: 'asset_candidate',
    };

    await expect(registeredHandler('prepareProjectReferences')(prepareInput as never)).resolves.toEqual({
      ok: true,
      data: preparedSubmission,
    });
    await expect(
      registeredHandler('applyAuthoringBatch')({
        projectId: approvalInput.projectId,
        expectedRevision: approvalInput.expectedRevision,
        operations: [
          {
            kind: 'approve_reference',
            referenceId: approvalInput.referenceId,
            candidateAssetId: approvalInput.candidateAssetId,
          },
        ],
      } as never)
    ).resolves.toEqual({
      ok: true,
      data: {
        projectId: 'project_1',
        projectRevision: 7,
        createdBeatIds: ['beat_2'],
        createdShotIds: ['shot_3'],
      },
    });
    expect(service.prepareProjectReferences).toHaveBeenCalledExactlyOnceWith(prepareInput);
    expect(service.applyMutations).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: approvalInput.projectId,
        expectedRevision: approvalInput.expectedRevision,
        operations: [
          {
            kind: 'approve_reference',
            referenceId: approvalInput.referenceId,
            candidateAssetId: approvalInput.candidateAssetId,
          },
        ],
      }),
      expect.any(Object)
    );
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

  it('routes exact job recovery requests and preserves bounded manager failures', async () => {
    const job = {
      id: 'job_1',
      projectId: 'project_1',
      shotId: 'shot_1',
      status: 'queued_remote' as const,
      purpose: 'video_take' as const,
      provider: { choiceId: 'route_1', providerId: 'provider_1', model: 'model_1' },
      outputAssetIds: [],
      outputAssetIdsByRole: { primary: null, poster: null },
      error: null,
      canCancel: true,
      canRetry: false,
      canRetryDownload: false,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      spendReceipt: null,
      createdAt: '2026-08-19T02:03:04.000Z',
      updatedAt: '2026-08-19T02:03:04.000Z',
    };
    vi.mocked(service.cancelJob).mockResolvedValueOnce(job);
    vi.mocked(service.retryJob).mockRejectedValueOnce(
      new StudioJobManagerError('duplicate_charge_acknowledgement_required')
    );
    const downloadJob = {
      ...job,
      status: 'failed' as const,
      purpose: 'board_still' as const,
      error: {
        code: 'download_failed' as const,
        messageKey: 'conversation.creativeStudio.jobs.errors.downloadFailed',
      },
      canCancel: false,
      canRetryDownload: true,
    };
    vi.mocked(service.retryDownload).mockResolvedValueOnce(downloadJob);
    initCreativeStudioBridge(dependencies);

    const request = { projectId: 'project_1', jobId: 'job_1', expectedRevision: 7 };
    await expect(registeredHandler('cancelJob')(request as never)).resolves.toEqual({ ok: true, data: job });
    await expect(
      registeredHandler('retryJob')({ ...request, acknowledgePossibleDuplicateCharge: false } as never)
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'duplicate_charge_acknowledgement_required',
        messageKey: 'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
      },
    });
    await expect(registeredHandler('retryDownload')(request as never)).resolves.toEqual({
      ok: true,
      data: downloadJob,
    });
    expect(service.cancelJob).toHaveBeenCalledExactlyOnceWith(request);
    expect(service.retryJob).toHaveBeenCalledExactlyOnceWith({
      ...request,
      acknowledgePossibleDuplicateCharge: false,
    });
    expect(service.retryDownload).toHaveBeenCalledExactlyOnceWith(request);

    vi.mocked(service.retryJob).mockRejectedValueOnce(new StudioJobManagerError('invalid_request'));
    await expect(
      registeredHandler('retryJob')({ ...request, acknowledgePossibleDuplicateCharge: true } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'invalid_payload', messageKey: 'conversation.creativeStudio.errors.invalidPayload' },
    });
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
        baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
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
        baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'seed_still' }],
        cascadeChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
    });
  });

  it('returns only the allowlisted structured pricing refusal without internal diagnostics', async () => {
    const refusal = Object.assign(new StudioPricingErrorV2('missing_conditioning'), {
      body: 'apiKey=secret-provider-body',
      internalDetails: { stack: 'private stack' },
    });
    vi.mocked(service.prepareSubmission).mockRejectedValueOnce(refusal);
    initCreativeStudioBridge(dependencies);

    const result = await registeredHandler('prepareSubmission')({
      projectId: 'project_1',
      expectedRevision: 7,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
      cascadeChoices: [],
    } as never);

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'pricing_refused',
        reason: 'missing_conditioning',
        details: null,
        messageKey: 'conversation.creativeStudio.errors.pricingRefused',
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-provider-body');
    expect(JSON.stringify(result)).not.toContain('private stack');
  });

  it('does not project an unknown pricing classification or attached diagnostics', async () => {
    const refusal = Object.assign(new StudioPricingErrorV2('route_secret_apiKey' as never), {
      body: 'private provider body',
      routeId: 'private_route_123',
      stack: 'private stack',
    });
    vi.mocked(service.prepareSubmission).mockRejectedValueOnce(refusal);
    initCreativeStudioBridge(dependencies);

    const result = await registeredHandler('prepareSubmission')({
      projectId: 'project_1',
      expectedRevision: 7,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot', shotId: 'shot_1' }, purpose: 'video_take' }],
      cascadeChoices: [],
    } as never);

    expect(result).toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
    expect(JSON.stringify(result)).not.toContain('route_secret_apiKey');
    expect(JSON.stringify(result)).not.toContain('private provider body');
    expect(JSON.stringify(result)).not.toContain('private_route_123');
    expect(JSON.stringify(result)).not.toContain('private stack');
  });

  it('imports a seed still through the native picker and returns no path or project', async () => {
    initCreativeStudioBridge(dependencies);
    const seedInput = { projectId: 'project_1', expectedRevision: 6, shotId: 'shot_1' };

    await expect(registeredHandler('importSeedStill')(seedInput as never)).resolves.toEqual({
      ok: true,
      data: { status: 'imported', assetId: 'asset_1', projectRevision: 7 },
    });
    expect(service.importSeedStillFromPath).toHaveBeenCalledExactlyOnceWith({
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
    expect(service.importSeedStillFromPath).not.toHaveBeenCalled();
  });

  it('keeps the bed-audio picker and result free of renderer paths and media authority', async () => {
    const showAudioOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: ['/private/bed.wav'] }));
    const translate = vi.fn(() => 'Translated WAV audio');
    initCreativeStudioBridge({ ...dependencies, showAudioOpenDialog, translate });
    const input = { projectId: 'project_1', expectedRevision: 6 };

    await expect(registeredHandler('importBedAudio')(input as never)).resolves.toEqual({
      ok: true,
      data: { status: 'imported', assetId: 'bed_1', projectRevision: 7 },
    });
    expect(service.importBedAudioFromPath).toHaveBeenCalledWith({
      ...input,
      sourcePath: '/private/bed.wav',
    });
    expect(translate).toHaveBeenCalledWith('conversation.creativeStudio.workspace.cut.bed.pickerFilter');
    expect(showAudioOpenDialog).toHaveBeenCalledWith(undefined, 'Translated WAV audio');
    expect(dependencies.showOpenDialog).not.toHaveBeenCalled();
  });

  it('loads the default main-process translation only when the bed picker runs', async () => {
    const showAudioOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    initCreativeStudioBridge({ ...dependencies, showAudioOpenDialog });

    expect(mocks.mainTranslate).not.toHaveBeenCalled();
    await expect(
      registeredHandler('importBedAudio')({ projectId: 'project_1', expectedRevision: 6 } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'cancelled' } });

    expect(mocks.mainTranslate).toHaveBeenCalledOnce();
    expect(mocks.mainTranslate).toHaveBeenCalledWith('conversation.creativeStudio.workspace.cut.bed.pickerFilter');
    expect(showAudioOpenDialog).toHaveBeenCalledWith(
      undefined,
      'main:conversation.creativeStudio.workspace.cut.bed.pickerFilter'
    );
  });

  it('returns bed-audio picker cancellation before consulting media storage', async () => {
    const showAudioOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: [] }));
    initCreativeStudioBridge({ ...dependencies, showAudioOpenDialog });

    await expect(
      registeredHandler('importBedAudio')({ projectId: 'project_1', expectedRevision: 6 } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'cancelled' } });
    expect(service.importBedAudioFromPath).not.toHaveBeenCalled();
  });

  it('projects bed detach and sends bed through one exact reducer operation', async () => {
    vi.mocked(service.applyMutations).mockResolvedValue({
      project: rendererProject,
      createdBeatIds: [],
      createdShotIds: [],
    });
    initCreativeStudioBridge(dependencies);

    await expect(
      registeredHandler('detachBedAudio')({
        projectId: 'project_1',
        expectedRevision: 6,
        assetId: 'bed_1',
      } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'detached', projectRevision: 7 } });
    await expect(
      registeredHandler('setBed')({ projectId: 'project_1', expectedRevision: 7, assetId: 'bed_1' } as never)
    ).resolves.toEqual({
      ok: true,
      data: { projectId: 'project_1', projectRevision: 7, createdBeatIds: [], createdShotIds: [] },
    });
    expect(service.detachBedAudio).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 6,
      assetId: 'bed_1',
    });
    expect(service.applyMutations).toHaveBeenCalledWith(
      {
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: 'project_1',
        expectedRevision: 7,
        operations: [{ kind: 'set_bed', assetId: 'bed_1' }],
      },
      { mutationId: 'native_mutation_1', capturedAt: '2026-08-19T02:03:04.000Z' }
    );
  });

  it('projects only the sanitized export catalog and exact create/list requests', async () => {
    const catalog = {
      revision: 2,
      artifacts: [
        {
          id: 'export_1',
          sourceRevision: 7,
          shape: 'editor_folder' as const,
          byteSize: 1024,
          fileCount: 3,
          createdAt: '2026-08-19T02:03:04.000Z',
        },
      ],
    };
    vi.mocked(service.createExport).mockResolvedValueOnce(catalog);
    vi.mocked(service.listExports).mockResolvedValueOnce(catalog);
    initCreativeStudioBridge(dependencies);
    const createInput = {
      projectId: 'project_1',
      expectedRevision: 7,
      expectedCatalogRevision: 1,
      shape: 'editor_folder' as const,
    };

    await expect(registeredHandler('createExport')(createInput as never)).resolves.toEqual({
      ok: true,
      data: catalog,
    });
    await expect(registeredHandler('listExports')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: true,
      data: catalog,
    });
    expect(service.createExport).toHaveBeenCalledWith(createInput);
    expect(service.listExports).toHaveBeenCalledWith({ projectId: 'project_1' });
  });

  it('projects a null-prototype export catalog into a plain renderer envelope', async () => {
    const catalog = Object.assign(Object.create(null) as Record<string, unknown>, {
      revision: 2,
      artifacts: [],
    });
    vi.mocked(service.listExports).mockResolvedValueOnce(catalog as never);
    initCreativeStudioBridge(dependencies);

    await expect(registeredHandler('listExports')({ projectId: 'project_1' } as never)).resolves.toStrictEqual({
      ok: true,
      data: { revision: 2, artifacts: [] },
    });
  });

  it.each([
    [
      'a prototype-bearing catalog',
      (() => {
        const catalog = { revision: 2, artifacts: [] };
        Object.setPrototypeOf(catalog, { inherited: true });
        return catalog;
      })(),
    ],
    [
      'a compensated sparse artifact array',
      (() => {
        const artifacts: unknown[] = [];
        artifacts.length = 1;
        Object.defineProperty(artifacts, 'compensatingOwnKey', { enumerable: true, value: true });
        return { revision: 2, artifacts };
      })(),
    ],
    [
      'an unsupported artifact shape',
      {
        revision: 2,
        artifacts: [
          {
            id: 'export_1',
            sourceRevision: 7,
            shape: 'movie',
            byteSize: 1,
            fileCount: 1,
            createdAt: '2026-08-19T02:03:04.000Z',
          },
        ],
      },
    ],
    [
      'reverse chronological artifacts',
      {
        revision: 2,
        artifacts: [
          {
            id: 'export_1',
            sourceRevision: 7,
            shape: 'still',
            byteSize: 1,
            fileCount: 1,
            createdAt: '2026-08-19T02:03:05.000Z',
          },
          {
            id: 'export_2',
            sourceRevision: 7,
            shape: 'still',
            byteSize: 1,
            fileCount: 1,
            createdAt: '2026-08-19T02:03:04.000Z',
          },
        ],
      },
    ],
    [
      'descending IDs at the same creation time',
      {
        revision: 2,
        artifacts: ['export_2', 'export_1'].map((id) => ({
          id,
          sourceRevision: 7,
          shape: 'still' as const,
          byteSize: 1,
          fileCount: 1,
          createdAt: '2026-08-19T02:03:04.000Z',
        })),
      },
    ],
    [
      'more artifacts of one shape than the renderer contract permits',
      {
        revision: 2,
        artifacts: Array.from({ length: STUDIO_MAX_EXPORTS_PER_SHAPE + 1 }, (_, index) => ({
          id: `export_${index}`,
          sourceRevision: 7,
          shape: 'still' as const,
          byteSize: 1,
          fileCount: 1,
          createdAt: new Date(Date.UTC(2026, 7, 19, 2, 3, index)).toISOString(),
        })),
      },
    ],
  ] as const)('rejects %s at the export service boundary', async (_case, catalog) => {
    vi.mocked(service.listExports).mockResolvedValueOnce(catalog as never);
    initCreativeStudioBridge(dependencies);

    await expect(registeredHandler('listExports')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
  });

  it('keeps export destination and managed reveal paths inside main', async () => {
    vi.mocked(service.copyExport).mockImplementationOnce(async (_input, chooseDestination) => {
      const destination = await chooseDestination({ suggestedName: 'editor-folder', isDirectory: true });
      expect(destination).toBe('/private/destination/editor-folder');
      return { status: 'copied' };
    });
    vi.mocked(service.revealExport).mockImplementationOnce(async (_input, revealPath) => {
      revealPath('/private/managed/exports/export_1');
      return { status: 'revealed' };
    });
    initCreativeStudioBridge(dependencies);
    const input = { projectId: 'project_1', expectedCatalogRevision: 2, artifactId: 'export_1' };

    await expect(registeredHandler('copyExport')(input as never)).resolves.toEqual({
      ok: true,
      data: { status: 'copied' },
    });
    await expect(registeredHandler('revealExport')(input as never)).resolves.toEqual({
      ok: true,
      data: { status: 'revealed' },
    });
    expect(dependencies.chooseExportDestination).toHaveBeenCalledWith(undefined, {
      suggestedName: 'editor-folder',
      isDirectory: true,
    });
    expect(dependencies.revealExportPath).toHaveBeenCalledWith('/private/managed/exports/export_1');
    expect(service.copyExport).toHaveBeenCalledWith(input, expect.any(Function));
    expect(service.revealExport).toHaveBeenCalledWith(input, expect.any(Function));
  });

  it('rejects hostile export service envelopes rather than leaking extra authority', async () => {
    vi.mocked(service.listExports)
      .mockResolvedValueOnce({
        revision: 2,
        artifacts: [],
        managedExport: { collection: 'exports', fileName: 'private' },
      } as never)
      .mockResolvedValueOnce({
        revision: 2,
        artifacts: [
          {
            id: 'export_1',
            sourceRevision: 7,
            shape: 'still',
            byteSize: 1,
            fileCount: 2,
            createdAt: '2026-08-19T02:03:04.000Z',
          },
        ],
      } as never);
    vi.mocked(service.copyExport).mockResolvedValueOnce({ status: 'copied', destinationPath: '/private' } as never);
    vi.mocked(service.revealExport).mockResolvedValueOnce({ status: 'revealed', fileName: 'private' } as never);
    initCreativeStudioBridge(dependencies);
    const input = { projectId: 'project_1', expectedCatalogRevision: 2, artifactId: 'export_1' };

    await expect(registeredHandler('listExports')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
    await expect(registeredHandler('listExports')({ projectId: 'project_1' } as never)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
    await expect(registeredHandler('copyExport')(input as never)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
    await expect(registeredHandler('revealExport')(input as never)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
  });

  it('projects bed-audio detach and maps media_in_use without leaking the media error', async () => {
    initCreativeStudioBridge(dependencies);
    await expect(
      registeredHandler('detachBedAudio')({
        projectId: 'project_1',
        expectedRevision: 6,
        assetId: 'asset_1',
      } as never)
    ).resolves.toEqual({ ok: true, data: { status: 'detached', projectRevision: 7 } });

    vi.mocked(service.detachBedAudio).mockRejectedValueOnce(new CreativeStudioMediaError('media_in_use'));
    await expect(
      registeredHandler('detachBedAudio')({
        projectId: 'project_1',
        expectedRevision: 7,
        assetId: 'asset_1',
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code: 'media_in_use', messageKey: 'conversation.creativeStudio.errors.mediaInUse' },
    });
  });

  it.each([
    ['not_found', 'not_found', 'projectNotFound'],
    ['stale_project', 'stale_project', 'staleProject'],
    ['invalid_media', 'invalid_payload', 'invalidPayload'],
    ['storage_error', 'storage_error', 'storage'],
    ['job_inactive', 'storage_error', 'storage'],
  ] as const)('maps the %s media boundary to the stable %s command code', async (mediaCode, code, messageKeyLeaf) => {
    vi.mocked(service.detachBedAudio).mockRejectedValueOnce(new CreativeStudioMediaError(mediaCode));
    initCreativeStudioBridge(dependencies);

    await expect(
      registeredHandler('detachBedAudio')({
        projectId: 'project_1',
        expectedRevision: 7,
        assetId: 'asset_1',
      } as never)
    ).resolves.toEqual({
      ok: false,
      error: { code, messageKey: `conversation.creativeStudio.errors.${messageKeyLeaf}` },
    });
  });

  it('redacts the legacy unsupported-schema store code as a storage boundary failure', async () => {
    vi.mocked(service.getProject).mockRejectedValueOnce(
      new CreativeStudioStoreError('unsupported_prototype_schema', 'legacy schema path')
    );
    initCreativeStudioBridge(dependencies);

    await expect(registeredHandler('getProject')({ projectId: 'legacy_project' } as never)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
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

  it('preserves a sanitized connection-validation reason inside a successful command envelope', async () => {
    vi.mocked(service.validateConnection).mockResolvedValueOnce({
      valid: false,
      reason: 'auth',
      rawBody: 'key=sk-or-private https://provider.invalid/private',
      httpStatus: 401,
    } as never);
    initCreativeStudioBridge(dependencies);

    const result = await registeredHandler('validateConnection')({
      providerId: 'provider_1',
      integrationId: 'integration_o4R7vD2m',
      model: 'google/veo-3.1',
    } as never);

    expect(result).toEqual({ ok: true, data: { valid: false, reason: 'auth' } });
    expect(JSON.stringify(result)).not.toMatch(/sk-or-private|provider\.invalid|httpStatus|rawBody/i);
  });

  it('projects a successful connection validation without private or unexpected service fields', async () => {
    vi.mocked(service.validateConnection).mockResolvedValueOnce({
      valid: true,
      connection: {
        providerId: 'provider_1',
        integrationId: 'integration_o4R7vD2m',
        labelKey: 'openRouterVideo',
        model: 'google/veo-3.1',
        capabilities: {
          mediaKinds: ['video'],
          audioModes: ['audio'],
          aspectRatios: ['16:9'],
          resolutions: ['720p'],
          minDurationSeconds: 5,
          maxDurationSeconds: 8,
          supportedDurationSeconds: [5, 8],
          supportsFirstFrame: false,
          maxConditioningImages: 0,
          rawBody: 'private response',
        },
        validatedAt: '2026-08-21T00:00:00.000Z',
        apiKey: 'sk-or-private',
      },
      providerStatus: 200,
    } as never);
    initCreativeStudioBridge(dependencies);

    const result = await registeredHandler('validateConnection')({
      providerId: 'provider_1',
      integrationId: 'integration_o4R7vD2m',
      model: 'google/veo-3.1',
    } as never);

    expect(result).toMatchObject({
      ok: true,
      data: {
        valid: true,
        connection: {
          providerId: 'provider_1',
          integrationId: 'integration_o4R7vD2m',
          model: 'google/veo-3.1',
          capabilities: { supportedDurationSeconds: [5, 8] },
        },
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/private response|sk-or-private|rawBody|apiKey|providerStatus/i);
  });

  it('fails closed when connection capabilities are malformed without exposing attached provider diagnostics', async () => {
    vi.mocked(service.validateConnection).mockResolvedValueOnce({
      valid: true,
      connection: {
        providerId: 'provider_1',
        integrationId: 'integration_o4R7vD2m',
        labelKey: 'openRouterVideo',
        model: 'google/veo-3.1',
        capabilities: null,
        validatedAt: '2026-08-21T00:00:00.000Z',
        rawBody: 'private provider body',
      },
    } as never);
    initCreativeStudioBridge(dependencies);

    const result = await registeredHandler('validateConnection')({
      providerId: 'provider_1',
      integrationId: 'integration_o4R7vD2m',
      model: 'google/veo-3.1',
    } as never);

    expect(result).toEqual({
      ok: false,
      error: { code: 'provider_error', messageKey: 'conversation.creativeStudio.errors.provider' },
    });
    expect(JSON.stringify(result)).not.toContain('private provider body');
  });

  it('preserves the generic sixty-second connection ceiling outside discrete Studio durations', async () => {
    vi.mocked(service.validateConnection).mockResolvedValueOnce({
      valid: true,
      connection: {
        providerId: 'provider_1',
        integrationId: 'integration_x5T8cW1h',
        labelKey: 'selfHostedVideoGateway',
        model: 'gateway-video',
        capabilities: {
          mediaKinds: ['video'],
          audioModes: ['none'],
          minDurationSeconds: 1,
          maxDurationSeconds: 60,
          supportsFirstFrame: false,
          maxConditioningImages: 0,
        },
        validatedAt: '2026-08-21T00:00:00.000Z',
      },
    });
    initCreativeStudioBridge(dependencies);

    await expect(
      registeredHandler('validateConnection')({
        providerId: 'provider_1',
        integrationId: 'integration_x5T8cW1h',
        model: 'gateway-video',
      } as never)
    ).resolves.toMatchObject({
      ok: true,
      data: {
        valid: true,
        connection: { capabilities: { minDurationSeconds: 1, maxDurationSeconds: 60 } },
      },
    });
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
    expect(STUDIO_VIEWS).toEqual(['references', 'table', 'board', 'cut']);
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

  it('closes only after explicit discard when a bounded draft flush reports unsaved work', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 0 });
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtyDraftCount: 1 })),
      flushUnsavedWork: vi.fn(async () => ({ saved: false })),
      showMessageBox,
    });
    const handshake = createCreativeStudioCloseHandshake(dependencies);

    handshake.handleWindowClose(createCloseEvent());

    await vi.waitFor(() => expect(dependencies.closeWindow).toHaveBeenCalledOnce());
    expect(showMessageBox).toHaveBeenCalledTimes(2);
    expect(showMessageBox.mock.calls[1]?.[0]).toMatchObject({
      buttons: ['conversation.creativeStudio.close.discard', 'conversation.creativeStudio.close.cancel'],
      defaultId: 1,
      cancelId: 1,
    });
    expect(dependencies.flushUnsavedWork).toHaveBeenCalledExactlyOnceWith({ timeoutMs: 3_000 });
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
