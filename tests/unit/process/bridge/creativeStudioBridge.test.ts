/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { STUDIO_VIEWS, type StudioProject } from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';

const mocks = vi.hoisted(() => ({
  listProjectsProvider: vi.fn(),
  createProjectProvider: vi.fn(),
  getProjectProvider: vi.fn(),
  getBriefSessionServerProvider: vi.fn(),
  listProposalsProvider: vi.fn(),
  listPendingReferenceRequestsProvider: vi.fn(),
  dismissReferenceRequestsProvider: vi.fn(),
  acceptProposalProvider: vi.fn(),
  rejectProposalProvider: vi.fn(),
  proposeStoryboardProvider: vi.fn(),
  updateModelSelectionProvider: vi.fn(),
  updateProjectProvider: vi.fn(),
  setBriefRulesProvider: vi.fn(),
  undoBriefRulesProvider: vi.fn(),
  bindBriefConversationProvider: vi.fn(),
  updateCutProvider: vi.fn(),
  placeCutScenesProvider: vi.fn(),
  fitStoryboardProvider: vi.fn(),
  deleteProjectProvider: vi.fn(),
  updateSceneProvider: vi.fn(),
  reorderScenesProvider: vi.fn(),
  selectAssetProvider: vi.fn(),
  persistCapturedPosterProvider: vi.fn(),
  chooseAndImportReferenceProvider: vi.fn(),
  chooseAndExportAssetsProvider: vi.fn(),
  getLatestRenderProvider: vi.fn(),
  renderCutProvider: vi.fn(),
  cancelRenderProvider: vi.fn(),
  submitScenesProvider: vi.fn(),
  cancelJobProvider: vi.fn(),
  retryJobProvider: vi.fn(),
  retryDownloadProvider: vi.fn(),
  listConnectionCandidatesProvider: vi.fn(),
  listConnectionsProvider: vi.fn(),
  validateConnectionProvider: vi.fn(),
  saveConnectionProvider: vi.fn(),
  removeConnectionProvider: vi.fn(),
  listRoutesProvider: vi.fn(),
  projectUpdatedEmit: vi.fn(),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    creativeStudio: {
      listProjects: { provider: mocks.listProjectsProvider },
      createProject: { provider: mocks.createProjectProvider },
      getProject: { provider: mocks.getProjectProvider },
      getBriefSessionServer: { provider: mocks.getBriefSessionServerProvider },
      listProposals: { provider: mocks.listProposalsProvider },
      listPendingReferenceRequests: { provider: mocks.listPendingReferenceRequestsProvider },
      dismissReferenceRequests: { provider: mocks.dismissReferenceRequestsProvider },
      acceptProposal: { provider: mocks.acceptProposalProvider },
      rejectProposal: { provider: mocks.rejectProposalProvider },
      proposeStoryboard: { provider: mocks.proposeStoryboardProvider },
      updateModelSelection: { provider: mocks.updateModelSelectionProvider },
      updateProject: { provider: mocks.updateProjectProvider },
      setBriefRules: { provider: mocks.setBriefRulesProvider },
      undoBriefRules: { provider: mocks.undoBriefRulesProvider },
      bindBriefConversation: { provider: mocks.bindBriefConversationProvider },
      updateCut: { provider: mocks.updateCutProvider },
      placeCutScenes: { provider: mocks.placeCutScenesProvider },
      fitStoryboard: { provider: mocks.fitStoryboardProvider },
      deleteProject: { provider: mocks.deleteProjectProvider },
      updateScene: { provider: mocks.updateSceneProvider },
      reorderScenes: { provider: mocks.reorderScenesProvider },
      selectAsset: { provider: mocks.selectAssetProvider },
      persistCapturedPoster: { provider: mocks.persistCapturedPosterProvider },
      chooseAndImportReference: { provider: mocks.chooseAndImportReferenceProvider },
      chooseAndExportAssets: { provider: mocks.chooseAndExportAssetsProvider },
      getLatestRender: { provider: mocks.getLatestRenderProvider },
      renderCut: { provider: mocks.renderCutProvider },
      cancelRender: { provider: mocks.cancelRenderProvider },
      submitScenes: { provider: mocks.submitScenesProvider },
      cancelJob: { provider: mocks.cancelJobProvider },
      retryJob: { provider: mocks.retryJobProvider },
      retryDownload: { provider: mocks.retryDownloadProvider },
      listConnectionCandidates: { provider: mocks.listConnectionCandidatesProvider },
      listConnections: { provider: mocks.listConnectionsProvider },
      validateConnection: { provider: mocks.validateConnectionProvider },
      saveConnection: { provider: mocks.saveConnectionProvider },
      removeConnection: { provider: mocks.removeConnectionProvider },
      listRoutes: { provider: mocks.listRoutesProvider },
      projectUpdated: { emit: mocks.projectUpdatedEmit },
    },
  },
}));

vi.mock('@/common/config/constants', () => ({ CREATIVE_STUDIO_ENABLED: true }));

import {
  createCreativeStudioCloseHandshake,
  initCreativeStudioBridge,
  type CreativeStudioBridgeDependencies,
  type CreativeStudioCloseHandshakeDependencies,
} from '@process/bridge/creativeStudioBridge';
import { CreativeStudioServiceError } from '@process/services/creative-studio/creativeStudioService';
import { StudioJobManagerError } from '@process/services/creative-studio/jobManager';
import { StudioRenderRunnerError } from '@process/services/creative-studio/renderService';

const project: StudioProject = {
  schemaVersion: 1,
  revision: 1,
  id: 'project_1',
  name: 'Launch film',
  brief: 'A short launch story',
  aspectRatio: '16:9',
  targetDurationSeconds: 12,
  resolution: '1080p',
  sceneOrder: [],
  scenes: {},
  assets: {},
  jobs: {},
  routing: { storyboard: null, image: null, video: null },
  rules: [],
  ruleListUndo: null,
  createdAt: '2026-07-30T00:00:00.000Z',
  updatedAt: '2026-07-30T00:00:00.000Z',
};

type ProviderHandler = (input: unknown) => Promise<unknown>;

describe('initCreativeStudioBridge', () => {
  let dependencies: CreativeStudioBridgeDependencies;

  beforeEach(() => {
    vi.clearAllMocks();
    dependencies = {
      getService: () => ({
        listProjects: vi.fn(async () => []),
        createProject: vi.fn(async () => project),
        getProject: vi.fn(async () => project),
        getBriefSessionServer: vi.fn(async () => ({
          id: 'studio-brief-project_1',
          name: 'aionui-creative-studio',
          transport: { type: 'stdio' as const, command: 'node', args: ['/tmp/builtin-mcp-studio.js'] },
        })),
        listProposals: vi.fn(async () => []),
        listPendingReferenceRequests: vi.fn(async () => []),
        dismissReferenceRequests: vi.fn(async () => true),
        acceptProposal: vi.fn(),
        rejectProposal: vi.fn(),
        proposeStoryboard: vi.fn(async () => project),
        updateModelSelection: vi.fn(async () => project),
        updateProject: vi.fn(async () => project),
        setBriefRules: vi.fn(async () => project),
        undoBriefRules: vi.fn(async () => project),
        bindBriefConversation: vi.fn(async () => project),
        updateCut: vi.fn(async () => project),
        placeCutScenes: vi.fn(async () => project),
        fitStoryboard: vi.fn(async () => ({
          status: 'already_matches' as const,
          project,
          changedSceneIds: [] as [],
          lockedSceneIds: [],
        })),
        deleteProject: vi.fn(async () => true),
        updateScene: vi.fn(async () => project),
        reorderScenes: vi.fn(async () => project),
        selectAsset: vi.fn(async () => project),
        persistCapturedPoster: vi.fn(),
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
        getLatestRender: vi.fn(async () => null),
        submitScenes: vi.fn(async () => []),
        cancelJob: vi.fn(),
        retryJob: vi.fn(),
        retryDownload: vi.fn(),
        listConnectionCandidates: vi.fn(async () => []),
        listConnections: vi.fn(async () => ({ integrations: [], connections: [] })),
        validateConnection: vi.fn(),
        saveConnection: vi.fn(),
        removeConnection: vi.fn(),
        listRoutes: vi.fn(),
      }),
      getRenderRunner: () => ({
        renderCut: vi.fn(async () => ({ assetId: 'render_1', missingSceneIds: ['scene_2'] })),
        cancelRender: vi.fn(() => true),
        getState: vi.fn(() => null),
      }),
    };
  });

  it('registers every project command instead of leaving the renderer without a typed provider', () => {
    initCreativeStudioBridge(dependencies);

    expect(mocks.listProjectsProvider).toHaveBeenCalledOnce();
    expect(mocks.createProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.getProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.getBriefSessionServerProvider).toHaveBeenCalledOnce();
    expect(mocks.listProposalsProvider).toHaveBeenCalledOnce();
    expect(mocks.listPendingReferenceRequestsProvider).toHaveBeenCalledOnce();
    expect(mocks.dismissReferenceRequestsProvider).toHaveBeenCalledOnce();
    expect(mocks.acceptProposalProvider).toHaveBeenCalledOnce();
    expect(mocks.rejectProposalProvider).toHaveBeenCalledOnce();
    expect(mocks.proposeStoryboardProvider).toHaveBeenCalledOnce();
    expect(mocks.updateModelSelectionProvider).toHaveBeenCalledOnce();
    expect(mocks.updateProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.setBriefRulesProvider).toHaveBeenCalledOnce();
    expect(mocks.undoBriefRulesProvider).toHaveBeenCalledOnce();
    expect(mocks.bindBriefConversationProvider).toHaveBeenCalledOnce();
    expect(mocks.updateCutProvider).toHaveBeenCalledOnce();
    expect(mocks.placeCutScenesProvider).toHaveBeenCalledOnce();
    expect(mocks.fitStoryboardProvider).toHaveBeenCalledOnce();
    expect(mocks.deleteProjectProvider).toHaveBeenCalledOnce();
    expect(mocks.updateSceneProvider).toHaveBeenCalledOnce();
    expect(mocks.reorderScenesProvider).toHaveBeenCalledOnce();
    expect(mocks.selectAssetProvider).toHaveBeenCalledOnce();
    expect(mocks.persistCapturedPosterProvider).toHaveBeenCalledOnce();
    expect(mocks.chooseAndImportReferenceProvider).toHaveBeenCalledOnce();
    expect(mocks.chooseAndExportAssetsProvider).toHaveBeenCalledOnce();
    expect(mocks.getLatestRenderProvider).toHaveBeenCalledOnce();
    expect(mocks.renderCutProvider).toHaveBeenCalledOnce();
    expect(mocks.cancelRenderProvider).toHaveBeenCalledOnce();
    expect(mocks.submitScenesProvider).toHaveBeenCalledOnce();
    expect(mocks.cancelJobProvider).toHaveBeenCalledOnce();
    expect(mocks.retryJobProvider).toHaveBeenCalledOnce();
    expect(mocks.retryDownloadProvider).toHaveBeenCalledOnce();
    expect(mocks.listConnectionCandidatesProvider).toHaveBeenCalledOnce();
    expect(mocks.listConnectionsProvider).toHaveBeenCalledOnce();
    expect(mocks.validateConnectionProvider).toHaveBeenCalledOnce();
    expect(mocks.saveConnectionProvider).toHaveBeenCalledOnce();
    expect(mocks.removeConnectionProvider).toHaveBeenCalledOnce();
    expect(mocks.listRoutesProvider).toHaveBeenCalledOnce();
  });

  it('refuses direct read, mutation, and render commands before any Studio runtime work when disabled', async () => {
    const service = dependencies.getService();
    const runner = dependencies.getRenderRunner!();
    const getService = vi.fn(() => service);
    const getRenderRunner = vi.fn(() => runner);
    initCreativeStudioBridge({
      ...dependencies,
      isFeatureEnabled: () => false,
      getService,
      getRenderRunner,
    });
    const getProject = mocks.getProjectProvider.mock.calls[0]?.[0] as ProviderHandler;
    const getLatestRender = mocks.getLatestRenderProvider.mock.calls[0]?.[0] as ProviderHandler;
    const updateProject = mocks.updateProjectProvider.mock.calls[0]?.[0] as ProviderHandler;
    const setBriefRules = mocks.setBriefRulesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const renderCut = mocks.renderCutProvider.mock.calls[0]?.[0] as ProviderHandler;
    const disabled = {
      ok: false,
      error: {
        code: 'feature_disabled',
        messageKey: 'conversation.creativeStudio.errors.featureDisabled',
      },
    };

    await expect(getProject({ projectId: 'project_1' })).resolves.toEqual(disabled);
    await expect(getLatestRender({ projectId: 'project_1' })).resolves.toEqual(disabled);
    await expect(updateProject({ projectId: 'project_1', expectedRevision: 1, name: 'Changed' })).resolves.toEqual(
      disabled
    );
    await expect(setBriefRules({ projectId: 'project_1', expectedRevision: 1, rules: [] })).resolves.toEqual(disabled);
    await expect(renderCut({ projectId: 'project_1' })).resolves.toEqual(disabled);
    expect(getService).not.toHaveBeenCalled();
    expect(getRenderRunner).not.toHaveBeenCalled();
    expect(service.getProject).not.toHaveBeenCalled();
    expect(service.getLatestRender).not.toHaveBeenCalled();
    expect(service.updateProject).not.toHaveBeenCalled();
    expect(service.setBriefRules).not.toHaveBeenCalled();
    expect(runner.renderCut).not.toHaveBeenCalled();
  });

  it('keeps direct read, mutation, and render commands unchanged when enabled', async () => {
    const service = dependencies.getService();
    const runner = dependencies.getRenderRunner!();
    initCreativeStudioBridge({ ...dependencies, getService: () => service, getRenderRunner: () => runner });
    const getProject = mocks.getProjectProvider.mock.calls[0]?.[0] as ProviderHandler;
    const getLatestRender = mocks.getLatestRenderProvider.mock.calls[0]?.[0] as ProviderHandler;
    const updateProject = mocks.updateProjectProvider.mock.calls[0]?.[0] as ProviderHandler;
    const setBriefRules = mocks.setBriefRulesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const renderCut = mocks.renderCutProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(getProject({ projectId: 'project_1' })).resolves.toEqual({ ok: true, data: project });
    await expect(getLatestRender({ projectId: 'project_1' })).resolves.toEqual({ ok: true, data: null });
    await expect(updateProject({ projectId: 'project_1', expectedRevision: 1, name: 'Changed' })).resolves.toEqual({
      ok: true,
      data: project,
    });
    await expect(setBriefRules({ projectId: 'project_1', expectedRevision: 1, rules: [] })).resolves.toEqual({
      ok: true,
      data: project,
    });
    await expect(renderCut({ projectId: 'project_1' })).resolves.toEqual({
      ok: true,
      data: { assetId: 'render_1', missingSceneIds: ['scene_2'] },
    });
  });

  it('delegates render start and cancellation without entering the project service', async () => {
    const runner = dependencies.getRenderRunner!();
    initCreativeStudioBridge({ ...dependencies, getRenderRunner: () => runner });
    const render = mocks.renderCutProvider.mock.calls[0]?.[0] as ProviderHandler;
    const cancel = mocks.cancelRenderProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(render({ projectId: 'project_1' })).resolves.toEqual({
      ok: true,
      data: { assetId: 'render_1', missingSceneIds: ['scene_2'] },
    });
    await expect(cancel({ projectId: 'project_1' })).resolves.toEqual({
      ok: true,
      data: { cancelled: true },
    });
    expect(runner.renderCut).toHaveBeenCalledExactlyOnceWith('project_1');
    expect(runner.cancelRender).toHaveBeenCalledExactlyOnceWith('project_1');
  });

  it.each([
    ['busy', 'conversation.creativeStudio.phase.review.render.errors.busy'],
    ['ffmpeg_unavailable', 'conversation.creativeStudio.phase.review.render.errors.ffmpegUnavailable'],
    ['render_failed', 'conversation.creativeStudio.phase.review.render.errors.failed'],
    ['no_renderable_scenes', 'conversation.creativeStudio.phase.review.render.errors.noRenderableScenes'],
    ['cancelled', 'conversation.creativeStudio.phase.review.render.errors.cancelled'],
  ] as const)('maps the %s render failure to its dedicated message', async (code, messageKey) => {
    const runner = {
      renderCut: vi.fn(async () => {
        throw new StudioRenderRunnerError(code);
      }),
      cancelRender: vi.fn(() => false),
      getState: vi.fn(() => null),
    };
    initCreativeStudioBridge({ ...dependencies, getRenderRunner: () => runner });
    const render = mocks.renderCutProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(render({ projectId: 'project_1' })).resolves.toEqual({
      ok: false,
      error: { code, messageKey },
    });
  });

  it('delegates proposal listing, acceptance, and rejection through dedicated providers', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const list = mocks.listProposalsProvider.mock.calls[0]?.[0] as ProviderHandler;
    const accept = mocks.acceptProposalProvider.mock.calls[0]?.[0] as ProviderHandler;
    const reject = mocks.rejectProposalProvider.mock.calls[0]?.[0] as ProviderHandler;
    const projectInput = { projectId: 'project_1' };
    const proposalInput = { ...projectInput, proposalId: 'proposal_1' };

    await list(projectInput);
    await accept(proposalInput);
    await reject(proposalInput);

    expect(service.listProposals).toHaveBeenCalledExactlyOnceWith(projectInput);
    expect(service.acceptProposal).toHaveBeenCalledExactlyOnceWith(proposalInput);
    expect(service.rejectProposal).toHaveBeenCalledExactlyOnceWith(proposalInput);
  });

  it('delegates one exact model-selection mutation', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.updateModelSelectionProvider.mock.calls[0]?.[0] as ProviderHandler;
    const input = {
      projectId: 'project_1',
      expectedRevision: 4,
      role: 'storyboard',
      selection: { providerId: 'provider_1', model: 'gpt-4o' },
    } as const;

    await handler(input);

    expect(service.updateModelSelection).toHaveBeenCalledExactlyOnceWith(input);
  });

  it('delegates one exact cut mutation through its dedicated provider', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.updateCutProvider.mock.calls[0]?.[0] as ProviderHandler;
    const input = {
      projectId: 'project_1',
      expectedRevision: 4,
      cutId: 'cut_1',
      cut: {
        orderMode: 'storyboard' as const,
        clipOrder: ['clip_1'],
        clips: {
          clip_1: {
            sourceInSeconds: 0.5,
            sourceOutSeconds: 4.5,
            crop: null,
            filters: [{ id: 'contrast' as const, amount: 0.25 }],
          },
        },
      },
    };

    await expect(handler(input)).resolves.toEqual({ ok: true, data: project });
    expect(service.updateCut).toHaveBeenCalledExactlyOnceWith(input);
  });

  it('delegates canonical cut placement without letting the renderer mint clip identities', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.placeCutScenesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const input = {
      projectId: 'project_1',
      expectedRevision: 4,
      cutId: 'cut_1',
      sceneIds: ['scene_2'],
      beforeClipId: 'clip_1',
    };

    await expect(handler(input)).resolves.toEqual({ ok: true, data: project });
    expect(service.placeCutScenes).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    [
      new CreativeStudioServiceError('invalid_route'),
      'invalid_route',
      'conversation.creativeStudio.errors.invalidRoute',
    ],
    [
      new CreativeStudioStoreError('stale_project', 'raw compare-and-set failure'),
      'stale_project',
      'conversation.creativeStudio.errors.staleProject',
    ],
    [
      new CreativeStudioStoreError('storage_error', 'raw storage path'),
      'storage_error',
      'conversation.creativeStudio.errors.storage',
    ],
  ] as const)('maps model-selection service failures without exposing details', async (failure, code, messageKey) => {
    const service = {
      ...dependencies.getService(),
      updateModelSelection: vi.fn(async () => {
        throw failure;
      }),
    };
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.updateModelSelectionProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(
      handler({
        projectId: 'project_1',
        expectedRevision: 4,
        role: 'storyboard',
        selection: { providerId: 'provider_1', model: 'gpt-4o' },
      })
    ).resolves.toEqual({ ok: false, error: { code, messageKey } });
  });

  it('delegates generation mutations with their route, revision, and acknowledgement contracts intact', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const submit = mocks.submitScenesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const cancel = mocks.cancelJobProvider.mock.calls[0]?.[0] as ProviderHandler;
    const retry = mocks.retryJobProvider.mock.calls[0]?.[0] as ProviderHandler;
    const retryDownload = mocks.retryDownloadProvider.mock.calls[0]?.[0] as ProviderHandler;
    const submitInput = {
      projectId: 'project_1',
      expectedRevision: 1,
      mode: 'single' as const,
      sceneIds: ['scene_1'],
      catalogVersion: '0123456789abcdef',
      routes: [
        {
          sceneId: 'scene_1',
          choiceId: 'choice_video',
          kind: 'video',
        },
      ],
    };
    const jobInput = { projectId: 'project_1', jobId: 'job_1', expectedRevision: 2 };
    const retryInput = { ...jobInput, acknowledgePossibleDuplicateCharge: true };

    await submit(submitInput);
    await cancel(jobInput);
    await retry(retryInput);
    await retryDownload(jobInput);

    expect(service.submitScenes).toHaveBeenCalledWith(submitInput);
    expect(service.cancelJob).toHaveBeenCalledWith(jobInput);
    expect(service.retryJob).toHaveBeenCalledWith(retryInput);
    expect(service.retryDownload).toHaveBeenCalledWith(jobInput);
  });

  it('delegates one structured fit request and returns the structured outcome', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.fitStoryboardProvider.mock.calls[0]?.[0] as ProviderHandler;
    const input = {
      projectId: 'project_1',
      expectedRevision: 1,
      catalogVersion: '0123456789abcdef',
    };

    await expect(handler(input)).resolves.toMatchObject({
      ok: true,
      data: { status: 'already_matches', changedSceneIds: [], lockedSceneIds: [] },
    });
    expect(service.fitStoryboard).toHaveBeenCalledExactlyOnceWith(input);
  });

  it.each([
    [
      'cancelJob',
      mocks.cancelJobProvider,
      new StudioJobManagerError('cancellation_refused'),
      'cancellation_refused',
      'conversation.creativeStudio.errors.cancellationRefused',
    ],
    [
      'retryJob',
      mocks.retryJobProvider,
      new StudioJobManagerError('duplicate_charge_acknowledgement_required'),
      'duplicate_charge_acknowledgement_required',
      'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
    ],
    [
      'retryDownload',
      mocks.retryDownloadProvider,
      new StudioJobManagerError('unsupported'),
      'unsupported',
      'conversation.creativeStudio.jobs.errors.unsupported',
    ],
  ] as const)(
    'redacts %s manager failures into a stable typed command envelope',
    async (method, provider, failure, code, messageKey) => {
      const service = {
        ...dependencies.getService(),
        [method]: vi.fn(async () => {
          throw failure;
        }),
      };
      initCreativeStudioBridge({ getService: () => service });
      const handler = provider.mock.calls[0]?.[0] as ProviderHandler;

      await expect(handler({ projectId: 'project_1', jobId: 'job_1', expectedRevision: 1 })).resolves.toEqual({
        ok: false,
        error: { code, messageKey },
      });
    }
  );

  it('delegates connection and route commands through the same redacted command envelope', async () => {
    const service = {
      ...dependencies.getService(),
      listConnectionCandidates: vi.fn(async () => [
        {
          providerId: 'provider_1',
          providerName: 'Gateway',
          models: [{ model: 'open-sora', health: 'available' as const }],
        },
      ]),
      listConnections: vi.fn(async () => ({
        integrations: [
          {
            integrationId: 'integration_x5T8cW1h',
            kind: 'video' as const,
            labelKey: 'selfHostedVideoGateway' as const,
          },
        ],
        connections: [
          {
            bindingId: 'binding_1',
            providerId: 'provider_1',
            integrationId: 'integration_x5T8cW1h',
            labelKey: 'selfHostedVideoGateway' as const,
            model: 'open-sora',
            capabilities: { mediaKinds: ['video' as const], audioModes: ['none'] },
            validatedAt: '2026-07-30T00:00:00.000Z',
          },
        ],
      })),
      validateConnection: vi.fn(async () => {
        throw new CreativeStudioServiceError('provider_error');
      }),
      saveConnection: vi.fn(),
      removeConnection: vi.fn(),
      listRoutes: vi.fn(),
    };
    initCreativeStudioBridge({ getService: () => service });
    const candidates = mocks.listConnectionCandidatesProvider.mock.calls[0]?.[0] as ProviderHandler;
    const connections = mocks.listConnectionsProvider.mock.calls[0]?.[0] as ProviderHandler;
    const validate = mocks.validateConnectionProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(candidates(undefined)).resolves.toEqual({ ok: true, data: await service.listConnectionCandidates() });
    await expect(connections(undefined)).resolves.toEqual({ ok: true, data: await service.listConnections() });
    await expect(
      validate({ providerId: 'provider_1', integrationId: 'integration_x5T8cW1h', model: 'open-sora' })
    ).resolves.toEqual({
      ok: false,
      error: { code: 'provider_error', messageKey: 'conversation.creativeStudio.errors.provider' },
    });
  });

  it('returns explicit cancellation outcomes without handing a path to either service operation', async () => {
    const service = dependencies.getService();
    const showOpenDialog = vi.fn(async () => ({ canceled: true, filePaths: ['/private/ignored.png'] }));
    const showExportDialog = vi.fn(async () => ({ canceled: true, filePaths: ['/private/ignored-export'] }));
    initCreativeStudioBridge({
      getService: () => service,
      getParentWindow: () => undefined,
      showOpenDialog,
      showExportDialog,
    });
    const importHandler = mocks.chooseAndImportReferenceProvider.mock.calls[0]?.[0] as ProviderHandler;
    const exportHandler = mocks.chooseAndExportAssetsProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(importHandler({ projectId: 'project_1', expectedRevision: 1, sceneId: 'scene_1' })).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    await expect(exportHandler({ projectId: 'project_1', includeReferences: true })).resolves.toEqual({
      ok: true,
      data: { status: 'cancelled' },
    });
    expect(service.importReferenceFromPath).not.toHaveBeenCalled();
    expect(service.exportAssetsToDirectory).not.toHaveBeenCalled();
  });

  it('keeps selected paths in main while returning only safe import and export DTOs', async () => {
    const importPath = '/private/user/reference.png';
    const exportPath = '/private/user/export-target';
    const asset = {
      id: 'asset_1',
      projectId: 'project_1',
      sceneId: null,
      mediaKind: 'image' as const,
      mimeType: 'image/png',
      managedAsset: { collection: 'imports' as const, fileName: 'asset_1.png' },
      byteSize: 33,
      sha256: 'a'.repeat(64),
      createdAt: '2026-07-30T00:00:00.000Z',
    };
    const service = {
      ...dependencies.getService(),
      importReferenceFromPath: vi.fn(async () => asset),
      exportAssetsToDirectory: vi.fn(async () => ({
        folderName: 'Film-20260730-120000',
        exported: [{ assetId: 'asset_1', fileName: 'scene-01.png' }],
        missingSceneIds: [],
      })),
    };
    initCreativeStudioBridge({
      getService: () => service,
      getParentWindow: () => undefined,
      showOpenDialog: async () => ({ canceled: false, filePaths: [importPath] }),
      showExportDialog: async () => ({ canceled: false, filePaths: [exportPath] }),
    });
    const importHandler = mocks.chooseAndImportReferenceProvider.mock.calls[0]?.[0] as ProviderHandler;
    const exportHandler = mocks.chooseAndExportAssetsProvider.mock.calls[0]?.[0] as ProviderHandler;

    const imported = await importHandler({ projectId: 'project_1', expectedRevision: 1 });
    const exported = await exportHandler({ projectId: 'project_1', includeReferences: false });

    expect(service.importReferenceFromPath).toHaveBeenCalledWith({
      projectId: 'project_1',
      expectedRevision: 1,
      sourcePath: importPath,
    });
    expect(service.exportAssetsToDirectory).toHaveBeenCalledWith({
      projectId: 'project_1',
      includeReferences: false,
      destinationDirectory: exportPath,
    });
    expect(imported).toEqual({ ok: true, data: { status: 'imported', asset } });
    expect(exported).toEqual({
      ok: true,
      data: {
        status: 'exported',
        folderName: 'Film-20260730-120000',
        exported: [{ assetId: 'asset_1', fileName: 'scene-01.png' }],
        missingSceneIds: [],
      },
    });
    expect(JSON.stringify({ imported, exported })).not.toContain('/private/user');
  });

  it.each([
    [
      new CreativeStudioMediaError('invalid_media'),
      'invalid_payload',
      'conversation.creativeStudio.errors.invalidPayload',
    ],
    [new CreativeStudioMediaError('storage_error'), 'storage_error', 'conversation.creativeStudio.errors.storage'],
  ] as const)('maps media failures without leaking their main-process details', async (failure, code, messageKey) => {
    const service = {
      ...dependencies.getService(),
      importReferenceFromPath: vi.fn(async () => {
        throw failure;
      }),
    };
    initCreativeStudioBridge({
      getService: () => service,
      getParentWindow: () => undefined,
      showOpenDialog: async () => ({ canceled: false, filePaths: ['/private/sensitive.png'] }),
    });
    const handler = mocks.chooseAndImportReferenceProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1 })).resolves.toEqual({
      ok: false,
      error: { code, messageKey },
    });
  });

  it('returns a typed storage result instead of leaking an unexpected service exception', async () => {
    dependencies = {
      getService: () => ({
        listProjects: async () => {
          throw new Error('disk path /private/user/studio leaked');
        },
        createProject: vi.fn(),
        getProject: vi.fn(),
        proposeStoryboard: vi.fn(),
        updateProject: vi.fn(),
        updateCut: vi.fn(),
        deleteProject: vi.fn(),
        updateScene: vi.fn(),
        reorderScenes: vi.fn(),
        selectAsset: vi.fn(),
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.listProjectsProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler(undefined)).resolves.toEqual({
      ok: false,
      error: { code: 'storage_error', messageKey: 'conversation.creativeStudio.errors.storage' },
    });
  });

  it('maps a stale store result instead of exposing its raw message', async () => {
    dependencies = {
      getService: () => ({
        listProjects: vi.fn(async () => []),
        createProject: vi.fn(),
        getProject: vi.fn(),
        proposeStoryboard: vi.fn(),
        updateProject: async () => {
          throw new CreativeStudioStoreError('stale_project', 'raw compare-and-set failure');
        },
        deleteProject: vi.fn(),
        updateScene: vi.fn(),
        reorderScenes: vi.fn(),
        selectAsset: vi.fn(),
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.updateProjectProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1, name: 'Changed' })).resolves.toEqual({
      ok: false,
      error: { code: 'stale_project', messageKey: 'conversation.creativeStudio.errors.staleProject' },
    });
  });

  it('forwards an update-scene input once and returns canonical service data', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const handler = mocks.updateSceneProvider.mock.calls[0]?.[0] as ProviderHandler;
    const input = {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneId: 'scene_1',
      scene: { id: 'scene_1' },
    };

    await expect(handler(input)).resolves.toEqual({ ok: true, data: project });
    expect(service.updateScene).toHaveBeenCalledOnce();
    expect(service.updateScene).toHaveBeenCalledWith(input);
  });

  it.each([
    ['planning_unavailable', 'conversation.creativeStudio.errors.planningUnavailable'],
    ['storyboard_exists', 'conversation.creativeStudio.errors.storyboardExists'],
    ['busy', 'conversation.creativeStudio.errors.busy'],
    ['provider_error', 'conversation.creativeStudio.errors.provider'],
    ['stale_project', 'conversation.creativeStudio.errors.staleProject'],
  ] as const)('returns a redacted %s planning envelope', async (code, messageKey) => {
    dependencies = {
      getService: () => ({
        listProjects: vi.fn(async () => []),
        createProject: vi.fn(),
        getProject: vi.fn(),
        proposeStoryboard: async () => {
          throw code === 'stale_project'
            ? new CreativeStudioStoreError(code, 'raw compare-and-set failure')
            : new CreativeStudioServiceError(code);
        },
        updateProject: vi.fn(),
        deleteProject: vi.fn(),
        updateScene: vi.fn(),
        reorderScenes: vi.fn(),
        selectAsset: vi.fn(),
        importReferenceFromPath: vi.fn(),
        exportAssetsToDirectory: vi.fn(),
      }),
    };
    initCreativeStudioBridge(dependencies);
    const handler = mocks.proposeStoryboardProvider.mock.calls[0]?.[0] as ProviderHandler;

    await expect(handler({ projectId: 'project_1', expectedRevision: 1, replaceExisting: false })).resolves.toEqual({
      ok: false,
      error: { code, messageKey },
    });
  });

  it('delegates every registered provider once instead of bypassing the typed service boundary', async () => {
    const service = dependencies.getService();
    initCreativeStudioBridge({ getService: () => service });
    const sceneInput = {
      projectId: 'project_1',
      expectedRevision: 1,
      sceneId: 'scene_1',
      scene: { id: 'scene_1' },
    };
    const handlers: ReadonlyArray<[ReturnType<typeof vi.fn>, unknown]> = [
      [mocks.listProjectsProvider, undefined],
      [
        mocks.createProjectProvider,
        { name: 'Launch film', brief: '', aspectRatio: '16:9', targetDurationSeconds: 12, resolution: '1080p' },
      ],
      [mocks.getProjectProvider, { projectId: 'project_1' }],
      [mocks.getBriefSessionServerProvider, { projectId: 'project_1' }],
      [mocks.proposeStoryboardProvider, { projectId: 'project_1', expectedRevision: 1, replaceExisting: false }],
      [
        mocks.updateModelSelectionProvider,
        {
          projectId: 'project_1',
          expectedRevision: 1,
          role: 'storyboard',
          selection: { providerId: 'provider_1', model: 'gpt-4o' },
        },
      ],
      [mocks.updateProjectProvider, { projectId: 'project_1', expectedRevision: 1, name: 'Changed' }],
      [mocks.setBriefRulesProvider, { projectId: 'project_1', expectedRevision: 1, rules: [] }],
      [mocks.undoBriefRulesProvider, { projectId: 'project_1' }],
      [
        mocks.bindBriefConversationProvider,
        { projectId: 'project_1', expectedRevision: 1, conversationId: 'conversation_brief' },
      ],
      [
        mocks.updateCutProvider,
        {
          projectId: 'project_1',
          expectedRevision: 1,
          cutId: 'cut_1',
          cut: { orderMode: 'storyboard', clipOrder: [], clips: {} },
        },
      ],
      [mocks.deleteProjectProvider, { projectId: 'project_1', expectedRevision: 1 }],
      [mocks.updateSceneProvider, sceneInput],
      [mocks.reorderScenesProvider, { projectId: 'project_1', expectedRevision: 1, sceneOrder: ['scene_1'] }],
      [
        mocks.selectAssetProvider,
        { projectId: 'project_1', expectedRevision: 1, sceneId: 'scene_1', assetId: 'asset_1' },
      ],
      [
        mocks.persistCapturedPosterProvider,
        {
          projectId: 'project_1',
          sceneId: 'scene_1',
          videoAssetId: 'asset_1',
          dataUrl: 'data:image/png;base64,iVBORw0KGgo=',
          width: 1280,
          height: 720,
        },
      ],
    ];

    await Promise.all(
      handlers.map(([provider, input]) => {
        const handler = provider.mock.calls[0]?.[0] as ProviderHandler;
        return handler(input);
      })
    );

    expect(service.listProjects).toHaveBeenCalledOnce();
    expect(service.createProject).toHaveBeenCalledOnce();
    expect(service.getProject).toHaveBeenCalledOnce();
    expect(service.getBriefSessionServer).toHaveBeenCalledOnce();
    expect(service.proposeStoryboard).toHaveBeenCalledOnce();
    expect(service.updateModelSelection).toHaveBeenCalledOnce();
    expect(service.updateProject).toHaveBeenCalledOnce();
    expect(service.setBriefRules).toHaveBeenCalledOnce();
    expect(service.undoBriefRules).toHaveBeenCalledOnce();
    expect(service.bindBriefConversation).toHaveBeenCalledOnce();
    expect(service.updateCut).toHaveBeenCalledOnce();
    expect(service.deleteProject).toHaveBeenCalledOnce();
    expect(service.updateScene).toHaveBeenCalledOnce();
    expect(service.reorderScenes).toHaveBeenCalledOnce();
    expect(service.selectAsset).toHaveBeenCalledOnce();
    expect(service.persistCapturedPoster).toHaveBeenCalledOnce();
  });
});

type CloseEvent = { preventDefault: ReturnType<typeof vi.fn> };

const createCloseEvent = (): CloseEvent => ({ preventDefault: vi.fn() });

const createCloseHandshakeDependencies = (
  overrides: Partial<CreativeStudioCloseHandshakeDependencies> = {}
): CreativeStudioCloseHandshakeDependencies => ({
  getCurrentUrl: () => 'file:///Applications/WePrompt/index.html#/studio/project_1/table',
  queryUnsavedWork: vi.fn(async () => ({ dirtySceneCount: 0 })),
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

  it('offers save, discard, and cancel for dirty scenes before flushing and closing', async () => {
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtySceneCount: 2 })),
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
      queryUnsavedWork: vi.fn(async () => ({ dirtySceneCount: 1 })),
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

  it('offers only discard or cancel when saving cannot complete', async () => {
    const showMessageBox = vi.fn().mockResolvedValueOnce({ response: 0 }).mockResolvedValueOnce({ response: 1 });
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(async () => ({ dirtySceneCount: 1 })),
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
    let resolveQuery: ((value: { dirtySceneCount: number }) => void) | undefined;
    const dependencies = createCloseHandshakeDependencies({
      queryUnsavedWork: vi.fn(
        () =>
          new Promise<{ dirtySceneCount: number }>((resolve) => {
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
    resolveQuery?.({ dirtySceneCount: 0 });
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
      queryUnsavedWork: vi.fn(async () => ({ dirtySceneCount: 1 })),
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
      queryUnsavedWork: vi.fn(async () => ({ dirtySceneCount: 1 })),
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
