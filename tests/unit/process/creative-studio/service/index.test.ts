/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { promises as nodeFs } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv';
import { describe, expect, it, vi } from 'vitest';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  STUDIO_PROPOSAL_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  type CreateStudioProjectInputV2,
  type StudioAssetV2,
  type StudioExportCatalogV2,
  type StudioJobV2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioProposalRecordV2,
  type StudioReferenceRequestV2,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import { STUDIO_RULE_LIMITS } from '@/common/types/project/creativeStudioRules';
import type { IProvider } from '@/common/config/storage';
import {
  createCreativeStudioStore,
  CreativeStudioStoreError,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';
import {
  createCreativeStudioServiceV2,
  derivePayableShotIds,
  projectStudioReferenceGenerationHandoffV2,
} from '@process/services/creative-studio/service';
import {
  applyStudioMutationBatchV2,
  calculateStudioQuoteTotals,
  createEmptyStudioProjectV2,
  createStudioFrameExtractionId,
  createStudioQuotedGenerationId,
  createStudioRateCardV2,
  validateStudioMutationOperationV2,
  validateStudioProjectV2,
} from '@process/services/creative-studio/service/schema2';
import { createStudioProjectManifestV2 } from '@process/services/creative-studio/service/briefFile';
import {
  createStudioMediaChoiceId,
  type StudioGenerationRouteCatalog,
} from '@process/services/creative-studio/providerResolver';
import { createConfiguredStudioRateCardV2 } from '@process/services/creative-studio/rateCardConfig';
import { ProviderDeadlineError } from '@process/services/creative-studio/adapters/types';
import type { StudioMediaStore } from '@process/services/creative-studio/mediaStore';
import {
  StudioPreparedSubmissionCacheErrorV2,
  StudioPreparedSubmissionCacheV2,
} from '@process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';
import {
  StudioExportCatalogErrorV2,
  type StudioExportCatalogStoreV2,
} from '@process/services/creative-studio/service/schema2/exports';
import {
  createListRoutesHandler,
  createProposeBriefRuleHandlerV2,
  createProposeStoryboardHandlerV2,
  createReadStoryboardHandlerV2,
  createRequestReferenceImagesHandlerV2,
  registerStudioToolsV2,
  studioApplyEditsInputSchemaV2,
  studioProposeStoryboardInputSchemaV2,
  studioRequestReferenceImagesInputSchemaV2,
} from '@process/resources/builtinMcp/studioServer';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import * as referenceRequestWriter from '@process/resources/builtinMcp/studioReferenceRequestWriter';
import { writeProposalRecordV2 } from '@process/resources/builtinMcp/studioProposalWriter';
import { writePendingRecordV2 } from '@process/resources/builtinMcp/studioPendingRecordWriter';

const createStudioMcpProtocolHarnessV2 = async (
  config: Parameters<typeof registerStudioToolsV2>[1] = null,
  writerDeps: Parameters<typeof registerStudioToolsV2>[2] = {}
) => {
  const server = new McpServer({ name: 'studio-v2-test', version: '2.0.0' });
  registerStudioToolsV2(server, config, writerDeps);
  const client = new Client({ name: 'studio-v2-test-client', version: '2.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: () => server.close(),
  };
};

const makeSchema2ServiceProject = (): StudioProjectV2 => {
  const input: CreateStudioProjectInputV2 = {
    name: 'Schema 2 launch',
    brief: 'A shot-owned launch film',
    aspectRatio: '16:9',
    targetDurationSeconds: 12,
    resolution: '1080p',
  };
  const empty = createEmptyStudioProjectV2(input, 'project_v2', '2026-08-17T00:00:00.000Z');
  const capturedAt = '2026-08-17T00:00:00.000Z';
  const result = applyStudioMutationBatchV2(
    empty,
    {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      projectId: empty.id,
      expectedRevision: empty.revision,
      operations: [
        {
          kind: 'add_beat',
          beatId: 'section_1',
          beat: { title: 'Opening', action: '', look: 'Warm sunrise over a quiet city', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_1',
          shot: {
            line: 'A wide establishing shot',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
          },
          beforeShotId: null,
        },
        {
          kind: 'add_beat',
          beatId: 'section_2',
          beat: { title: 'Close', action: '', look: 'Soft evening light over the skyline', targetSeconds: null },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_2',
          shotId: 'clip_2',
          shot: {
            line: 'A slow closing composition',
            narration: '',
            onScreenText: '',
            durationSeconds: 5,
          },
          beforeShotId: null,
        },
      ],
    },
    { mutationId: 'service_schema_2_fixture', capturedAt }
  );
  return { ...result.project, revision: empty.revision + 1, updatedAt: capturedAt };
};

describe('CreativeStudioServiceV2', () => {
  const imageRoute = {
    choiceId: createStudioMediaChoiceId({
      providerId: 'provider_1',
      adapterId: 'weprompt-image-v1',
      model: 'image-model',
      kind: 'image',
    }),
    providerId: 'provider_1',
    providerName: 'Image provider',
    adapterId: 'weprompt-image-v1' as const,
    model: 'image-model',
    health: 'available' as const,
    kind: 'image' as const,
    cancellationPolicy: 'none' as const,
    constraints: {
      aspectRatios: ['16:9' as const],
      resolutions: ['1080p' as const],
      minDurationSeconds: 1,
      maxDurationSeconds: 60,
      supportsFirstFrame: true,
      maxConditioningImages: 1,
      silentOutput: true,
    },
  };

  const videoRoute = {
    choiceId: createStudioMediaChoiceId({
      providerId: 'provider_1',
      adapterId: 'openrouter-video-v1',
      model: 'video-model',
      kind: 'video',
    }),
    providerId: 'provider_1',
    providerName: 'Video provider',
    adapterId: 'openrouter-video-v1' as const,
    model: 'video-model',
    health: 'available' as const,
    kind: 'video' as const,
    cancellationPolicy: 'queued_and_running' as const,
    constraints: {
      aspectRatios: ['16:9' as const],
      resolutions: ['1080p' as const],
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      supportsFirstFrame: true,
      maxConditioningImages: 1,
      silentOutput: true,
    },
  };

  const makeSchema2Job = (project: StudioProjectV2, overrides: Partial<StudioJobV2> = {}): StudioJobV2 => ({
    id: 'job_1',
    projectId: project.id,
    shotId: 'clip_1',
    status: 'failed',
    provider: { providerId: 'provider_1', adapterId: 'weprompt-image-v1', model: 'image-model' },
    idempotencyKey: 'idempotency_secret',
    providerJobId: null,
    remoteStartedAt: null,
    cancellationPolicy: 'none',
    outputAssetIds: [],
    error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
    purpose: 'seed_still',
    authorizationId: 'authorization_1',
    authorizationItemId: 'item_1',
    requestPlan: {
      kind: 'resolved',
      snapshot: {
        prompt: 'A warm city launch still',
        aspectRatio: '16:9',
        resolution: '1080p',
        durationSeconds: 5,
        referenceInput: null,
        conditioningInput: null,
      },
    },
    requestSnapshot: {
      prompt: 'A warm city launch still',
      aspectRatio: '16:9',
      resolution: '1080p',
      durationSeconds: 5,
      referenceInput: null,
      conditioningInput: null,
    },
    spendReceipt: null,
    outputAssetIdsByRole: { primary: null, poster: null },
    ...overrides,
  });

  const makeHarness = (
    project = makeSchema2ServiceProject(),
    options: {
      includeMediaStore?: boolean;
      includeRateCard?: boolean;
      useDefaultIds?: boolean;
      useDefaultClock?: boolean;
      createQuoteId?: () => string;
      createConnectionId?: () => string;
      createExportId?: () => string;
      now?: () => Date;
      preparedSubmissionCache?: StudioPreparedSubmissionCacheV2;
      exportCatalogStore?: StudioExportCatalogStoreV2;
      serviceStore?: CreativeStudioStore;
      resolveAssetV2?: StudioMediaStore['resolveAssetV2'];
      resolveAssetWithProjectAuthorityV2?: StudioMediaStore['resolveAssetWithProjectAuthorityV2'];
      verifyConditioningFrameV2?: StudioMediaStore['verifyConditioningFrameV2'];
      importBedAudioFromPathV2?: StudioMediaStore['importBedAudioFromPathV2'];
      detachBedAudioV2?: StudioMediaStore['detachBedAudioV2'];
    } = {}
  ) => {
    let current = structuredClone(project);
    const committedAt = '2026-08-17T00:00:02.000Z';
    const applyMutationBatchV2 = vi.fn(
      async (...[batch, context]: Parameters<CreativeStudioStore['applyMutationBatchV2']>) => {
        const applied = applyStudioMutationBatchV2(current, batch, context);
        current = {
          ...applied.project,
          revision: current.revision + 1,
          updatedAt: committedAt,
        };
        return { ...applied, project: structuredClone(current) };
      }
    );
    const updateProjectV2 = vi.fn(
      async (...[projectId, update, expectedRevision]: Parameters<CreativeStudioStore['updateProjectV2']>) => {
        if (projectId !== current.id || (expectedRevision !== undefined && expectedRevision !== current.revision)) {
          throw new CreativeStudioStoreError('stale_project', 'stale Studio fixture project');
        }
        current = {
          ...update(structuredClone(current)),
          revision: current.revision + 1,
          updatedAt: committedAt,
        };
        return structuredClone(current);
      }
    );
    const confirmProjectV2 = vi.fn(async (...[input]: Parameters<CreativeStudioStore['confirmProjectV2']>) => {
      if (input.projectId !== current.id || input.expectedRevision !== current.revision) {
        throw new Error('stale Studio fixture confirmation');
      }
      const revalidation = await input.revalidate(structuredClone(current) as never);
      input.assertActive();
      const built = input.buildCommit(structuredClone(current), structuredClone(revalidation) as never, committedAt);
      input.assertActive();
      current = {
        ...built.project,
        revision: current.revision + 1,
        updatedAt: committedAt,
      };
      return { project: structuredClone(current), dispatch: structuredClone(built.dispatch) };
    });
    const proposal = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      id: 'proposal_service_1',
      projectId: current.id,
      status: 'pending' as const,
      baseRevision: current.revision,
      payload: {
        kind: 'mutation_batch' as const,
        operations: [{ kind: 'set_brief' as const, brief: 'A reviewed proposal' }],
      },
      createdAt: '2026-08-17T00:00:01.000Z',
      decidedAt: null,
    };
    const listProposalsV2 = vi.fn(async () => [structuredClone(proposal)]);
    const acceptProposalV2 = vi.fn(async () => ({
      proposal: {
        ...structuredClone(proposal),
        status: 'accepted' as const,
        decidedAt: committedAt,
      },
      project: structuredClone(current),
      applied: true,
    }));
    const rejectProposalV2 = vi.fn(async () => ({
      ...structuredClone(proposal),
      status: 'rejected' as const,
      decidedAt: committedAt,
    }));
    const referenceRequest: StudioReferenceRequestV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      id: 'reference_request_service_1',
      projectId: current.id,
      shotIds: ['clip_1'],
      status: 'pending',
      createdAt: '2026-08-17T00:00:01.000Z',
    };
    const listReferenceRequestsV2 = vi.fn<CreativeStudioStore['listReferenceRequestsV2']>(async () => [
      { request: structuredClone(referenceRequest), decision: null, receipt: null },
    ]);
    const decideReferenceRequestV2 = vi.fn<CreativeStudioStore['decideReferenceRequestV2']>(async (input) => {
      const outcome =
        input.outcome.kind === 'generation_gate'
          ? { kind: 'generation_gate' as const, handoffId: 'handoff_service_1', shotIds: [...referenceRequest.shotIds] }
          : input.outcome.kind === 'imported_reference'
            ? {
                kind: 'imported_reference' as const,
                assetId: input.outcome.assetId,
                projectRevision: current.revision,
              }
            : { kind: 'rejected' as const };
      return {
        request: structuredClone(referenceRequest),
        decision: {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId: referenceRequest.id,
          projectId: current.id,
          decidedAt: committedAt,
          outcome,
        },
        receipt: null,
      };
    });
    const referenceGenerationDecision = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: referenceRequest.id,
      projectId: current.id,
      decidedAt: committedAt,
      outcome: {
        kind: 'generation_gate' as const,
        handoffId: 'handoff_service_1',
        shotIds: [...referenceRequest.shotIds],
      },
    };
    let referenceGenerationReceipt:
      | import('@/common/types/project/creativeStudioTypes').StudioReferenceGenerationHandoffReceiptV2
      | null = null;
    const readReferenceGenerationHandoffV2 = vi.fn<CreativeStudioStore['readReferenceGenerationHandoffV2']>(
      async (projectId, handoffId) =>
        projectId === current.id && handoffId === referenceGenerationDecision.outcome.handoffId
          ? {
              request: structuredClone(referenceRequest),
              decision: structuredClone(referenceGenerationDecision),
              receipt: structuredClone(referenceGenerationReceipt),
            }
          : null
    );
    const recordReferenceGenerationHandoffReceiptV2 = vi.fn<
      CreativeStudioStore['recordReferenceGenerationHandoffReceiptV2']
    >(async (input) => {
      if (input.projectId !== current.id || input.handoffId !== referenceGenerationDecision.outcome.handoffId) {
        throw new Error('missing Studio fixture handoff');
      }
      if (referenceGenerationReceipt !== null && referenceGenerationReceipt.result.kind !== input.result.kind) {
        throw new Error('completed Studio fixture handoff');
      }
      referenceGenerationReceipt ??= {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId: input.handoffId,
        requestId: referenceRequest.id,
        completedAt: committedAt,
        result: structuredClone(input.result),
      };
      return {
        request: structuredClone(referenceRequest),
        decision: structuredClone(referenceGenerationDecision),
        receipt: structuredClone(referenceGenerationReceipt),
      };
    });
    const confirmReferenceGenerationHandoffV2 = vi.fn<CreativeStudioStore['confirmReferenceGenerationHandoffV2']>(
      async (input) => {
        if (input.handoffId !== referenceGenerationDecision.outcome.handoffId || referenceGenerationReceipt !== null) {
          throw new Error('completed Studio fixture handoff');
        }
        const result = await confirmProjectV2(input);
        const authorization = current.spendAuthorizations.find(
          (candidate) => candidate.originReferenceHandoffId === input.handoffId
        );
        if (authorization === undefined) throw new Error('missing Studio fixture authorization');
        referenceGenerationReceipt = {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          handoffId: input.handoffId,
          requestId: referenceRequest.id,
          completedAt: authorization.confirmedAt,
          result: { kind: 'confirmed', authorizationId: authorization.id },
        };
        return result;
      }
    );
    let connections: import('@/common/types/project/creativeStudioTypes').StudioConnectionBinding[] = [];
    const resolveProposalPathsV2 = vi.fn(async () => ({
      projectDir: `/studio/${current.id}`,
      pendingDir: `/studio/${current.id}/proposals/pending`,
    }));
    const resolveReferenceRequestPathsV2 = vi.fn(async () => ({
      projectDir: `/studio/${current.id}`,
      pendingDir: `/studio/${current.id}/reference-requests/pending`,
    }));
    const getVerifiedProjectDirectoryV2 = vi.fn(async () => `/studio/${current.id}`);
    const listConnections = vi.fn(async () => structuredClone(connections));
    const saveConnection = vi.fn(async (binding: (typeof connections)[number]) => {
      connections = [...connections, structuredClone(binding)];
      return structuredClone(binding);
    });
    const removeConnection = vi.fn(async (bindingId: string) => {
      const next = connections.filter((binding) => binding.id !== bindingId);
      const removed = next.length !== connections.length;
      connections = next;
      return removed;
    });
    const deleteProjectV2 = vi.fn(async () => true);
    const store = {
      listProjectsV2: vi.fn(async () => ({ projects: [], unsupportedProjectIds: [], quarantinedProjectIds: [] })),
      createProjectV2: vi.fn(async () => structuredClone(current)),
      getProjectV2: vi.fn(async () => ({ status: 'supported' as const, project: structuredClone(current) })),
      applyMutationBatchV2,
      updateProjectV2,
      confirmProjectV2,
      confirmReferenceGenerationHandoffV2,
      deleteProjectV2,
      listProposalsV2,
      acceptProposalV2,
      rejectProposalV2,
      listReferenceRequestsV2,
      decideReferenceRequestV2,
      readReferenceGenerationHandoffV2,
      recordReferenceGenerationHandoffReceiptV2,
      resolveProposalPathsV2,
      resolveReferenceRequestPathsV2,
      getVerifiedProjectDirectoryV2,
      listConnections,
      saveConnection,
      removeConnection,
      withProjectAuthorityV2: vi.fn(async (projectId: string, operation: (authority: never) => Promise<unknown>) => {
        if (projectId !== current.id) throw new CreativeStudioStoreError('not_found', 'missing Studio fixture project');
        return operation({
          project: structuredClone(current),
          projectDir: `/studio/${current.id}`,
          assertCurrent: vi.fn(async () => undefined),
          delete: async (expectedRevision: number, authorizeBeforeDelete?: () => void | Promise<void>) => {
            await authorizeBeforeDelete?.();
            return deleteProjectV2(projectId, expectedRevision);
          },
        } as never);
      }),
      deleteProjectWithSidecarAuthorityV2: vi.fn(
        async (projectId: string, _expectedRevision: number, operation: (authority: never) => Promise<boolean>) => {
          if (projectId !== current.id) {
            throw new CreativeStudioStoreError('not_found', 'missing Studio fixture project');
          }
          return operation({
            project: structuredClone(current),
            projectDir: `/studio/${current.id}`,
            delete: async (expectedRevision: number, authorizeBeforeDelete?: () => void | Promise<void>) => {
              await authorizeBeforeDelete?.();
              return deleteProjectV2(projectId, expectedRevision);
            },
          } as never);
        }
      ),
    };
    const dispatchAuthorizedJobsV2 = vi.fn(async ({ jobIds }: { projectId: string; jobIds: string[] }) =>
      jobIds.map((jobId) => structuredClone(current.jobs[jobId]!))
    );
    const submitShots = dispatchAuthorizedJobsV2;
    const cancelJobV2 = vi.fn(async () => makeSchema2Job(current, { status: 'cancelled', error: null }));
    const retryJobV2 = vi.fn(async () => makeSchema2Job(current, { status: 'queued_local', error: null }));
    const retryDownloadV2 = vi.fn(async () => makeSchema2Job(current, { status: 'succeeded', error: null }));
    const referenceAsset = {
      id: 'reference_1',
      projectId: current.id,
      shotId: 'clip_1',
      mediaKind: 'image' as const,
      mimeType: 'image/png',
      managedAsset: { collection: 'imports' as const, fileName: 'reference_1.png' },
      byteSize: 8,
      sha256: 'a'.repeat(64),
      createdAt: '2026-08-17T00:00:00.000Z',
    };
    const importReferenceFromPathV2 = vi.fn(async () => ({
      asset: structuredClone(referenceAsset),
      project: structuredClone(current),
    }));
    const bedAsset: StudioAssetV2 = {
      id: 'bed_service_1',
      projectId: current.id,
      shotId: null,
      mediaKind: 'audio',
      mimeType: 'audio/wav',
      managedAsset: { collection: 'imports', fileName: 'bed_service_1.wav' },
      byteSize: 44,
      sha256: 'b'.repeat(64),
      durationSeconds: 12,
      createdAt: committedAt,
    };
    const importBedAudioFromPathV2 =
      options.importBedAudioFromPathV2 ??
      vi.fn<StudioMediaStore['importBedAudioFromPathV2']>(async (input) => {
        input.assertActive?.();
        const importedProject = structuredClone(current);
        importedProject.assets[bedAsset.id] = structuredClone(bedAsset);
        importedProject.bedAssetId = bedAsset.id;
        return { asset: structuredClone(bedAsset), project: importedProject };
      });
    const detachBedAudioV2 =
      options.detachBedAudioV2 ??
      vi.fn<StudioMediaStore['detachBedAudioV2']>(async (input) => {
        input.assertActive?.();
        return structuredClone(current);
      });
    const detachBriefReferenceV2 = vi.fn(async () => structuredClone(current));
    const persistCapturedPosterV2 = vi.fn(async () => structuredClone(referenceAsset));
    const extractConditioningFrameV2 = vi.fn(async () => ({ status: 'failed' as const }));
    const verifyConditioningFrameV2 = options.verifyConditioningFrameV2 ?? vi.fn(async () => null);
    const resolveAssetV2 = options.resolveAssetV2 ?? vi.fn(async () => null);
    const resolveAssetWithProjectAuthorityV2 = options.resolveAssetWithProjectAuthorityV2 ?? vi.fn(async () => null);
    const providerResolver = {
      listConnectionCandidates: vi.fn(async () => [
        {
          providerId: 'provider_1',
          providerName: 'Image provider',
          models: [{ model: 'image-model', health: 'available' as const }],
          integrationModels: [{ integrationLabelKey: 'openRouterVideo' as const, models: [] }],
        },
      ]),
      listGenerationRoutes: vi.fn(async () => ({
        routes: [structuredClone(imageRoute), structuredClone(videoRoute)],
        diagnostics: [
          { status: 'available' as const, route: structuredClone(imageRoute) },
          { status: 'available' as const, route: structuredClone(videoRoute) },
        ],
        generationCatalogVersion: 'catalog_v2',
      })),
    };
    const rateCard = createStudioRateCardV2([
      {
        routeId: imageRoute.choiceId,
        kind: 'image',
        currency: 'USD',
        rateUnit: 'generation',
        rateMinorUnits: 3,
      },
      {
        routeId: videoRoute.choiceId,
        kind: 'video',
        currency: 'USD',
        rateUnit: 'second',
        rateMinorUnits: 5,
      },
    ]);
    const loadRateCard = vi.fn(async (_generation: StudioGenerationRouteCatalog) => rateCard);
    let quoteOrdinal = 0;
    let jobOrdinal = 0;
    let keyOrdinal = 0;
    const onProjectUpdated = vi.fn();
    const ensureDirectorCommandMailbox = vi.fn(async () => undefined);
    const getStudioServerScriptPath = vi.fn(() => '/bundled/builtin-mcp-studio.js');
    const validateConnection = vi.fn(async () => ({ ok: true as const, capabilities: { maxConditioningImages: 3 } }));
    const adapterRegistry = new Map([
      [
        'weprompt-image-v1',
        {
          id: 'weprompt-image-v1' as const,
          validateConnection,
        },
      ],
    ]);
    const listProviders = vi.fn(
      async (): Promise<IProvider[]> => [
        {
          id: 'provider_1',
          platform: 'openai',
          name: 'Image provider',
          base_url: 'https://provider.invalid/v1',
          api_key: 'provider-secret',
          models: ['image-model'],
        },
      ]
    );
    const defaultExportCatalogStore = {
      list: vi.fn(async () => ({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: current.id,
        revision: 1,
        artifacts: [],
      })),
      create: vi.fn(async () => ({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: current.id,
        revision: 1,
        artifacts: [],
      })),
      repair: vi.fn(async () => ({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: current.id,
        revision: 1,
        artifacts: [],
      })),
      copy: vi.fn(async () => ({ status: 'cancelled' as const })),
      resolveRevealPath: vi.fn(async () => '/studio/export'),
      withManagedMediaAuthority: vi.fn(async (_authority, operation) =>
        operation({ catalogRevision: 1, managedByteSize: 0 })
      ),
    } satisfies StudioExportCatalogStoreV2;
    const service = createCreativeStudioServiceV2({
      store: options.serviceStore ?? (store as unknown as CreativeStudioStore),
      jobManager: { dispatchAuthorizedJobsV2, cancelJobV2, retryJobV2, retryDownloadV2 } as never,
      providerResolver: providerResolver as never,
      listProviders,
      getAdapterRegistry: () => adapterRegistry as never,
      getStudioServerScriptPath,
      ensureDirectorCommandMailbox,
      preparedSubmissionCache: options.preparedSubmissionCache,
      createConnectionId: options.createConnectionId,
      createExportId: options.createExportId,
      exportCatalogStore: options.exportCatalogStore ?? defaultExportCatalogStore,
      ...(options.includeRateCard === false ? {} : { rateCard: loadRateCard }),
      ...(options.useDefaultIds
        ? {}
        : {
            createQuoteId: options.createQuoteId ?? (() => `quote_service_${++quoteOrdinal}`),
            createJobId: () => `job_service_${++jobOrdinal}`,
            createIdempotencyKey: () => `key_service_${++keyOrdinal}`,
          }),
      ...(options.useDefaultClock ? {} : { now: options.now ?? (() => new Date(committedAt)) }),
      ...(options.includeMediaStore === false
        ? {}
        : {
            mediaStore: {
              importReferenceFromPathV2,
              importBedAudioFromPathV2,
              detachBedAudioV2,
              detachBriefReferenceV2,
              persistCapturedPosterV2,
              extractConditioningFrameV2,
              verifyConditioningFrameV2,
              resolveAssetV2,
              resolveAssetWithProjectAuthorityV2,
            } as never,
          }),
      onProjectUpdated,
    });
    return {
      service,
      store,
      exportCatalogStore: options.exportCatalogStore ?? defaultExportCatalogStore,
      submitShots,
      cancelJobV2,
      retryJobV2,
      retryDownloadV2,
      importReferenceFromPathV2,
      importBedAudioFromPathV2,
      detachBedAudioV2,
      detachBriefReferenceV2,
      persistCapturedPosterV2,
      extractConditioningFrameV2,
      verifyConditioningFrameV2,
      resolveAssetV2,
      resolveAssetWithProjectAuthorityV2,
      providerResolver,
      onProjectUpdated,
      proposal,
      listProposalsV2,
      acceptProposalV2,
      rejectProposalV2,
      referenceRequest,
      listReferenceRequestsV2,
      decideReferenceRequestV2,
      readReferenceGenerationHandoffV2,
      recordReferenceGenerationHandoffReceiptV2,
      confirmReferenceGenerationHandoffV2,
      resolveProposalPathsV2,
      resolveReferenceRequestPathsV2,
      getVerifiedProjectDirectoryV2,
      listConnections,
      saveConnection,
      removeConnection,
      listProviders,
      validateConnection,
      adapterRegistry,
      loadRateCard,
      ensureDirectorCommandMailbox,
      getStudioServerScriptPath,
      getProject: (): StudioProjectV2 => structuredClone(current),
      setProject: (next: StudioProjectV2): void => {
        current = structuredClone(next);
      },
    };
  };

  const makeContinuityProject = (chainBreak: 'none' | 'hard_cut'): StudioProjectV2 => {
    const project = makeSchema2ServiceProject();
    project.beats.section_1!.shotOrder = ['clip_1', 'clip_2'];
    project.beats.section_2!.shotOrder = [];
    project.shots.clip_2!.chainBreak = chainBreak;
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    return project;
  };

  const makeRejoinProject = (): { project: StudioProjectV2; take: StudioAssetV2; seed: StudioAssetV2 } => {
    const project = makeContinuityProject('hard_cut');
    const take: StudioAssetV2 = {
      id: 'take_rejoin_1',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'take_rejoin_1.mp4' },
      byteSize: 100,
      sha256: 'c'.repeat(64),
      durationSeconds: 10,
      createdAt: '2026-08-17T00:00:01.000Z',
    };
    const seed: StudioAssetV2 = {
      id: 'seed_rejoin_2',
      projectId: project.id,
      shotId: 'clip_2',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'seed_rejoin_2.png' },
      byteSize: 20,
      sha256: 'd'.repeat(64),
      createdAt: '2026-08-17T00:00:01.000Z',
    };
    Object.assign(project.assets, { [take.id]: take, [seed.id]: seed });
    project.shots.clip_1!.assetIds.push(take.id);
    project.shots.clip_1!.videoAssetId = take.id;
    project.shots.clip_1!.trimOutSeconds = 2;
    project.shots.clip_2!.assetIds.push(seed.id);
    project.shots.clip_2!.seedStillId = seed.id;
    return { project, take, seed };
  };

  it('rejects malformed V2 service envelopes before store, media, or paid work', async () => {
    const harness = makeHarness();
    const symbolKeyedBinding = {
      projectId: 'project_v2',
      expectedRevision: 1,
      conversationId: 'conversation_1',
      [Symbol('unexpected')]: true,
    };
    const attempts: Array<() => Promise<unknown>> = [
      () => harness.service.deleteProject({ projectId: '../project', expectedRevision: 1 }),
      () => harness.service.deleteProject({ projectId: 'project_v2', expectedRevision: 0 }),
      () => harness.service.getChainStatus({ projectId: 'project_v2', extra: true } as never),
      () => harness.service.getDirectorSessionAuthority({ projectId: '../project_v2' }),
      () => harness.service.getDirectorSessionAuthority({ projectId: 'project_v2', extra: true } as never),
      () =>
        harness.service.bindDirectorConversation({
          projectId: 'project_v2',
          expectedRevision: 1,
          conversationId: 'conversation_1',
          extra: true,
        } as never),
      () => harness.service.bindDirectorConversation(symbolKeyedBinding),
      () =>
        harness.service.getGenerationReadiness({
          projectId: 'project_v2',
          beatIds: Object.assign([] as string[], { length: 1 }),
        }),
      () => harness.service.retryConditioningFrame([] as never),
      () =>
        harness.service.cancelWaitingCascade({
          projectId: 'project_v2',
          expectedRevision: 1,
          dependentShotId: 'clip_1',
          extra: true,
        } as never),
      () =>
        harness.service.confirmSubmission({
          projectId: 'project_v2',
          quoteId: 'quote_1',
          expectedRevision: 1,
          extra: true,
        } as never),
      () =>
        harness.service.importReferenceFromPath({
          projectId: 'project_v2',
          shotId: '../clip',
          expectedRevision: 1,
          sourcePath: '/tmp/reference.png',
        }),
      () =>
        harness.service.importReferenceFromPath({
          projectId: 'project_v2',
          briefReferenceRole: 'organisation',
          expectedRevision: 1,
          sourcePath: '/tmp/reference.png',
        } as never),
      () =>
        harness.service.persistCapturedPoster({
          projectId: 'project_v2',
          shotId: 'clip_1',
          videoAssetId: 'take_1',
          dataUrl: 'data:image/png;base64,',
          width: 1,
          height: 1,
        }),
      () =>
        harness.service.retryJob({
          projectId: 'project_v2',
          jobId: 'job_1',
          expectedRevision: 1,
          acknowledgePossibleDuplicateCharge: 'yes',
        } as never),
      () => harness.service.listReferenceRequests({ projectId: 'project_v2', extra: true } as never),
      () =>
        harness.service.decideReferenceRequest({
          projectId: 'project_v2',
          requestId: 'reference_request_1',
          expectedRevision: 1,
          outcome: { kind: 'generation_gate', handoffId: 'forged' },
        } as never),
      () => harness.service.listReferenceGenerationHandoffs({ projectId: '../project' }),
    ];

    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop -- Every hostile payload must refuse independently.
      await expect(attempt()).rejects.toMatchObject({ code: 'invalid_payload' });
    }
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.importReferenceFromPathV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
  });

  it('imports bed audio through the exact main-only lifecycle fence', async () => {
    const harness = makeHarness();

    const imported = await harness.service.importBedAudioFromPath({
      projectId: 'project_v2',
      expectedRevision: 2,
      sourcePath: '/chosen/bed.wav',
    });

    expect(imported).toMatchObject({
      asset: { id: 'bed_service_1', mediaKind: 'audio', durationSeconds: 12 },
      project: { id: 'project_v2', bedAssetId: 'bed_service_1' },
    });
    expect(harness.importBedAudioFromPathV2).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_v2',
      expectedRevision: 2,
      sourcePath: '/chosen/bed.wav',
      assertActive: expect.any(Function),
    });
    expect(harness.onProjectUpdated).toHaveBeenCalledExactlyOnceWith('project_v2');
  });

  it('detaches only the named unselected bed audio through the lifecycle fence', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.detachBedAudio({ projectId: 'project_v2', expectedRevision: 2, assetId: 'bed_service_1' })
    ).resolves.toMatchObject({ id: 'project_v2', revision: 2 });
    expect(harness.detachBedAudioV2).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_v2',
      expectedRevision: 2,
      assetId: 'bed_service_1',
      assertActive: expect.any(Function),
    });
    expect(harness.onProjectUpdated).toHaveBeenCalledExactlyOnceWith('project_v2');
  });

  it('rejects malformed bed-audio envelopes before media storage', async () => {
    const harness = makeHarness();
    const attempts: Array<() => Promise<unknown>> = [
      () => harness.service.importBedAudioFromPath(null as never),
      () =>
        harness.service.importBedAudioFromPath({
          projectId: 'project_v2',
          expectedRevision: 2,
          sourcePath: '/chosen/bed.wav',
          extra: true,
        } as never),
      () =>
        harness.service.importBedAudioFromPath({
          projectId: 'project_v2',
          expectedRevision: 2,
          sourcePath: 42,
        } as never),
      () => harness.service.importBedAudioFromPath({ projectId: 'project_v2', expectedRevision: 2, sourcePath: '' }),
      () => harness.service.detachBedAudio(null as never),
      () =>
        harness.service.detachBedAudio({
          projectId: 'project_v2',
          expectedRevision: 2,
          assetId: 'bed_service_1',
          extra: true,
        } as never),
    ];

    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop -- every hostile bed envelope must refuse independently.
      await expect(attempt()).rejects.toMatchObject({ code: 'invalid_payload' });
    }
    expect(harness.importBedAudioFromPathV2).not.toHaveBeenCalled();
    expect(harness.detachBedAudioV2).not.toHaveBeenCalled();
  });

  it('fails closed when bed media storage is unavailable', async () => {
    const harness = makeHarness(undefined, { includeMediaStore: false });

    await expect(
      harness.service.importBedAudioFromPath({
        projectId: 'project_v2',
        expectedRevision: 2,
        sourcePath: '/chosen/bed.wav',
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      harness.service.detachBedAudio({ projectId: 'project_v2', expectedRevision: 2, assetId: 'bed_service_1' })
    ).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('serializes exact export authority and returns only the renderer-safe catalog', async () => {
    const rawCatalog: StudioExportCatalogV2 = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      projectId: 'project_v2',
      revision: 2,
      artifacts: [
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          id: 'export_service_1',
          projectId: 'project_v2',
          sourceRevision: 2,
          shape: 'script',
          payloadKind: 'file',
          managedExport: { collection: 'exports', fileName: 'private-export-name' },
          byteSize: 42,
          fileCount: 1,
          manifestSha256: 'f'.repeat(64),
          createdAt: '2026-08-17T00:00:02.000Z',
        },
      ],
    };
    const create = vi.fn(async () => structuredClone(rawCatalog));
    const repair = vi.fn(async () => structuredClone(rawCatalog));
    const copy = vi.fn(async (_authority, _request, picker) => {
      const destination =
        typeof picker === 'function'
          ? await picker({
              artifactId: 'export_service_1',
              shape: 'script',
              payloadKind: 'file',
              suggestedName: 'script.md',
            })
          : picker;
      return destination === null ? ({ status: 'cancelled' } as const) : ({ status: 'copied' } as const);
    });
    const resolveRevealPath = vi.fn(async () => '/private/studio/exports/script.md');
    const exportCatalogStore = {
      list: vi.fn(async () => structuredClone(rawCatalog)),
      create,
      repair,
      copy,
      resolveRevealPath,
      withManagedMediaAuthority: vi.fn(async (_authority, operation) =>
        operation({ catalogRevision: rawCatalog.revision, managedByteSize: 0 })
      ),
    } satisfies StudioExportCatalogStoreV2;
    const harness = makeHarness(undefined, {
      exportCatalogStore,
      createExportId: () => 'export_service_1',
    });

    const created = await harness.service.createExport({
      projectId: 'project_v2',
      expectedRevision: 2,
      expectedCatalogRevision: 1,
      shape: 'script',
    });
    expect(created).toEqual({
      revision: 2,
      artifacts: [
        {
          id: 'export_service_1',
          sourceRevision: 2,
          shape: 'script',
          byteSize: 42,
          fileCount: 1,
          createdAt: '2026-08-17T00:00:02.000Z',
        },
      ],
    });
    expect(create).toHaveBeenCalledTimes(1);
    const [authority, plan] = create.mock.calls[0]!;
    expect(authority).toMatchObject({ project: { id: 'project_v2', revision: 2 }, projectDir: '/studio/project_v2' });
    expect(plan).toMatchObject({
      expectedProjectRevision: 2,
      expectedCatalogRevision: 1,
      artifactId: 'export_service_1',
      managedFileName: 'export_service_1',
      shape: 'script',
    });
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toMatchObject({ kind: 'generated', relativePath: 'script.md' });
    expect(Buffer.from((plan.files[0] as { bytes: Uint8Array }).bytes).toString('utf8')).toContain('# Schema 2 launch');

    await expect(harness.service.listExports({ projectId: 'project_v2' })).resolves.toEqual(created);
    expect(repair).toHaveBeenCalledTimes(1);

    const chooseDestination = vi.fn(async () => '/user/Exports/script.md');
    await expect(
      harness.service.copyExport(
        { projectId: 'project_v2', expectedCatalogRevision: 2, artifactId: 'export_service_1' },
        chooseDestination
      )
    ).resolves.toEqual({ status: 'copied' });
    expect(chooseDestination).toHaveBeenCalledExactlyOnceWith({ suggestedName: 'script.md', isDirectory: false });

    const revealPath = vi.fn();
    await expect(
      harness.service.revealExport(
        { projectId: 'project_v2', expectedCatalogRevision: 2, artifactId: 'export_service_1' },
        revealPath
      )
    ).resolves.toEqual({ status: 'revealed' });
    expect(revealPath).toHaveBeenCalledExactlyOnceWith('/private/studio/exports/script.md');
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    expect(JSON.stringify(created)).not.toContain('managedExport');
    expect(JSON.stringify(created)).not.toContain('manifestSha256');
    expect(JSON.stringify(created)).not.toContain('private-export-name');
  });

  it('normalizes every authored script field to canonical LF bytes', async () => {
    const project = makeSchema2ServiceProject();
    project.name = 'Schema\r\n2 launch';
    project.brief = 'First brief line\rSecond brief line';
    project.beats.section_1!.title = 'Opening\r\nBeat';
    project.beats.section_1!.action = 'Move\rthrough the city';
    project.beats.section_1!.look = 'Warm\r\nlight';
    project.shots.clip_1!.line = 'A wide\rcomposition';
    project.shots.clip_1!.narration = 'A voice\r\narrives';
    project.shots.clip_1!.onScreenText = 'WELCOME\rHOME';
    const harness = makeHarness(project, { createExportId: () => 'export_script_lf' });

    await harness.service.createExport({
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'script',
    });

    const plan = vi.mocked(harness.exportCatalogStore.create).mock.calls[0]![1];
    const script = Buffer.from((plan.files[0] as { bytes: Uint8Array }).bytes).toString('utf8');
    expect(script).not.toContain('\r');
    expect(script).toContain('# Schema\n2 launch\n\nFirst brief line\nSecond brief line');
    expect(script).toContain('Narration: A voice\narrives\n\nOn-screen text: WELCOME\nHOME');
  });

  it('builds still and editor exports through the held project authority without re-entering media lookup', async () => {
    const project = makeSchema2ServiceProject();
    project.beatOrder = ['section_1'];
    delete project.beats.section_2;
    delete project.shots.clip_2;
    addGeneratedVideosForMcpV2(project, 1);
    const queueReentrantResolver = vi.fn(async () => {
      throw new Error('export media re-entered the project queue');
    });
    const authorityResolver = vi.fn(async (authority: { project: StudioProjectV2 }, assetId: string) => {
      const asset = authority.project.assets[assetId];
      if (asset === undefined) return null;
      return {
        asset,
        openVerifiedStream: async () => Readable.from([Buffer.alloc(asset.byteSize, 1)]),
      };
    });
    const create = vi.fn(async (_authority, plan) => {
      for (const file of plan.files) {
        if (file.kind !== 'verified_stream') continue;
        // eslint-disable-next-line no-await-in-loop -- exercises every verified export stream while authority is held.
        for await (const _chunk of await file.openVerifiedStream()) void _chunk;
      }
      return {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: project.id,
        revision: plan.expectedCatalogRevision + 1,
        artifacts: [],
      };
    });
    const exportCatalogStore = {
      list: vi.fn(),
      create,
      repair: vi.fn(),
      copy: vi.fn(),
      resolveRevealPath: vi.fn(),
      withManagedMediaAuthority: vi.fn(),
    } as unknown as StudioExportCatalogStoreV2;
    let exportOrdinal = 0;
    const harness = makeHarness(project, {
      exportCatalogStore,
      createExportId: () => `authority_export_${++exportOrdinal}`,
      resolveAssetV2: queueReentrantResolver,
      resolveAssetWithProjectAuthorityV2: authorityResolver,
    });

    await harness.service.createExport({
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'still',
      shotId: 'clip_1',
    });
    await harness.service.createExport({
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 2,
      shape: 'editor_folder',
    });

    expect(queueReentrantResolver).not.toHaveBeenCalled();
    expect(authorityResolver.mock.calls.map(([, assetId]) => assetId)).toEqual(['seed_clip_1', 'take_01']);
    expect(create.mock.calls.map(([, plan]) => plan.shape)).toEqual(['still', 'editor_folder']);
    expect(create.mock.calls[1]?.[1].files.some((file) => file.relativePath === 'media/shot-001.mp4')).toBe(true);
  });

  it('chooses the newest deterministic eligible seed when a still has no explicit cover', async () => {
    const project = makeSchema2ServiceProject();
    addGeneratedVideosForMcpV2(project, 1);
    const shot = project.shots.clip_1!;
    shot.seedStillId = null;
    const seeds: StudioAssetV2[] = [
      {
        id: 'seed_alpha',
        projectId: project.id,
        shotId: shot.id,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'seed_alpha.png' },
        byteSize: 2,
        sha256: '1'.repeat(64),
        createdAt: '2026-08-17T00:00:10.000Z',
      },
      {
        id: 'seed_beta',
        projectId: project.id,
        shotId: shot.id,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'seed_beta.png' },
        byteSize: 3,
        sha256: '2'.repeat(64),
        createdAt: '2026-08-17T00:00:11.000Z',
      },
      {
        id: 'seed_gamma',
        projectId: project.id,
        shotId: shot.id,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'seed_gamma.png' },
        byteSize: 4,
        sha256: '3'.repeat(64),
        createdAt: '2026-08-17T00:00:11.000Z',
      },
    ];
    for (const seed of seeds) {
      project.assets[seed.id] = seed;
      shot.assetIds.push(seed.id);
    }
    const resolveAssetWithProjectAuthorityV2 = vi.fn<StudioMediaStore['resolveAssetWithProjectAuthorityV2']>(
      async (authority, assetId) => {
        const asset = authority.project.assets[assetId];
        return asset === undefined
          ? null
          : {
              asset,
              openVerifiedStream: async () => Readable.from([Buffer.alloc(asset.byteSize, 1)]),
            };
      }
    );
    const harness = makeHarness(project, {
      createExportId: () => 'fallback_still_export',
      resolveAssetWithProjectAuthorityV2,
    });

    await harness.service.createExport({
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'still',
      shotId: shot.id,
    });

    expect(resolveAssetWithProjectAuthorityV2.mock.calls[0]?.[1]).toBe('seed_gamma');
    expect(harness.exportCatalogStore.create).toHaveBeenCalledOnce();
  });

  it.each([
    ['stale_catalog_revision', 'stale_project'],
    ['stale_project_revision', 'stale_project'],
    ['invalid_create_plan', 'invalid_payload'],
    ['artifact_not_found', 'invalid_payload'],
    ['storage_error', 'storage_error'],
  ] as const)('normalizes export-catalog %s failures to %s', async (catalogCode, serviceCode) => {
    const harness = makeHarness();
    vi.mocked(harness.exportCatalogStore.repair).mockRejectedValueOnce(new StudioExportCatalogErrorV2(catalogCode));

    await expect(harness.service.listExports({ projectId: 'project_v2' })).rejects.toMatchObject({
      code: serviceCode,
    });
  });

  it('normalizes an editor-folder coverage refusal without publishing an artifact', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.createExport({
        projectId: 'project_v2',
        expectedRevision: 2,
        expectedCatalogRevision: 1,
        shape: 'editor_folder',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('fences copy and reveal when close wins while their main callbacks are pending', async () => {
    const copy = vi.fn<StudioExportCatalogStoreV2['copy']>(async (_authority, _input, picker) => {
      if (typeof picker !== 'function') throw new Error('Expected a destination picker');
      await picker({
        artifactId: 'export_service_1',
        shape: 'script',
        payloadKind: 'file',
        suggestedName: 'script.md',
      });
      return { status: 'copied' as const };
    });
    const copyHarness = makeHarness(undefined, {
      exportCatalogStore: {
        ...makeHarness().exportCatalogStore,
        copy,
      },
    });
    await expect(
      copyHarness.service.copyExport(
        { projectId: 'project_v2', expectedCatalogRevision: 1, artifactId: 'export_service_1' },
        async () => {
          copyHarness.service.dispose();
          return '/chosen/script.md';
        }
      )
    ).rejects.toMatchObject({ code: 'busy' });

    let closeReveal = (): void => undefined;
    const resolveRevealPath = vi.fn<StudioExportCatalogStoreV2['resolveRevealPath']>(async () => {
      closeReveal();
      return '/private/studio/exports/script.md';
    });
    const revealHarness = makeHarness(undefined, {
      exportCatalogStore: {
        ...makeHarness().exportCatalogStore,
        resolveRevealPath,
      },
    });
    closeReveal = () => revealHarness.service.dispose();
    const revealPath = vi.fn();
    await expect(
      revealHarness.service.revealExport(
        { projectId: 'project_v2', expectedCatalogRevision: 1, artifactId: 'export_service_1' },
        revealPath
      )
    ).rejects.toMatchObject({ code: 'busy' });
    expect(revealPath).not.toHaveBeenCalled();
  });

  it('rejects malformed export requests before catalog or paid work', async () => {
    const exportCatalogStore = {
      list: vi.fn(),
      create: vi.fn(),
      repair: vi.fn(),
      copy: vi.fn(),
      resolveRevealPath: vi.fn(),
    } as unknown as StudioExportCatalogStoreV2;
    const harness = makeHarness(undefined, { exportCatalogStore });
    const attempts: Array<() => Promise<unknown>> = [
      () => harness.service.createExport(null as never),
      () =>
        harness.service.createExport({
          projectId: 'project_v2',
          expectedRevision: 2,
          expectedCatalogRevision: 1,
          shape: 'script',
          shotId: 'clip_1',
        } as never),
      () =>
        harness.service.createExport({
          projectId: 'project_v2',
          expectedRevision: 2,
          expectedCatalogRevision: 1,
          shape: 'one_file',
        } as never),
      () =>
        harness.service.createExport({
          projectId: 'project_v2',
          expectedRevision: 2,
          expectedCatalogRevision: 1,
          shape: 'still',
        } as never),
      () => harness.service.listExports({ projectId: 'project_v2', extra: true } as never),
      () => harness.service.listExports({ projectId: '../project' }),
      () =>
        harness.service.copyExport(
          { projectId: 'project_v2', expectedCatalogRevision: 0, artifactId: 'export_1' },
          vi.fn()
        ),
      () =>
        harness.service.copyExport(
          { projectId: 'project_v2', expectedCatalogRevision: 1, artifactId: 'export_1' },
          null as never
        ),
      () =>
        harness.service.revealExport(
          { projectId: 'project_v2', expectedCatalogRevision: 1, artifactId: '../export' },
          vi.fn()
        ),
      () =>
        harness.service.revealExport(
          { projectId: 'project_v2', expectedCatalogRevision: 1, artifactId: 'export_1' },
          null as never
        ),
    ];
    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop -- each hostile export envelope is independently refused.
      await expect(attempt()).rejects.toMatchObject({ code: 'invalid_payload' });
    }
    expect(exportCatalogStore.create).not.toHaveBeenCalled();
    expect(exportCatalogStore.repair).not.toHaveBeenCalled();
    expect(exportCatalogStore.copy).not.toHaveBeenCalled();
    expect(exportCatalogStore.resolveRevealPath).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('refuses every schema-1 export boundary without observing or changing the legacy project tree', async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), 'studio-v1-export-boundary-'));
    const projectId = 'prototype_export_v1';
    const projectDir = path.join(rootDir, projectId);
    type TreeEntry = { path: string; kind: 'directory' | 'file'; bytes?: string };
    const snapshotProjectTree = async (): Promise<TreeEntry[]> => {
      const visit = async (directory: string, relativeDirectory: string): Promise<TreeEntry[]> => {
        const entries = await nodeFs.readdir(directory, { withFileTypes: true });
        const nested = await Promise.all(
          entries.map(async (entry): Promise<TreeEntry[]> => {
            const relativePath = path.join(relativeDirectory, entry.name);
            const absolutePath = path.join(directory, entry.name);
            if (entry.isDirectory()) {
              return [{ path: relativePath, kind: 'directory' }, ...(await visit(absolutePath, relativePath))];
            }
            if (!entry.isFile()) throw new Error('Unexpected legacy fixture entry');
            return [{ path: relativePath, kind: 'file', bytes: (await readFile(absolutePath)).toString('base64') }];
          })
        );
        return nested.flat();
      };
      return (await visit(projectDir, '')).toSorted((left, right) => left.path.localeCompare(right.path));
    };

    const catalogList = vi.fn();
    const catalogCreate = vi.fn();
    const catalogRepair = vi.fn();
    const catalogCopy = vi.fn();
    const catalogResolveRevealPath = vi.fn();
    const catalogWithManagedMediaAuthority = vi.fn();
    const exportCatalogStore = {
      list: catalogList,
      create: catalogCreate,
      repair: catalogRepair,
      copy: catalogCopy,
      resolveRevealPath: catalogResolveRevealPath,
      withManagedMediaAuthority: catalogWithManagedMediaAuthority,
    } as unknown as StudioExportCatalogStoreV2;
    const createExportId = vi.fn(() => 'must_not_allocate_export');
    const chooseDestination = vi.fn(async () => '/must/not/be/chosen');
    const revealPath = vi.fn();

    try {
      await mkdir(path.join(projectDir, 'exports', 'nested'), { recursive: true });
      await mkdir(path.join(projectDir, 'media'));
      await writeFile(
        path.join(projectDir, 'project.json'),
        JSON.stringify({
          schemaVersion: 1,
          id: projectId,
          revision: 7,
          privateLegacyToken: 'must-never-cross-the-service-boundary',
        })
      );
      await writeFile(path.join(projectDir, 'exports', 'catalog.json'), Buffer.from([0, 255, 1, 254]));
      await writeFile(path.join(projectDir, 'exports', 'nested', 'legacy.json'), '{"schemaVersion":1}\r\n');
      await writeFile(path.join(projectDir, 'media', 'legacy.bin'), Buffer.from([9, 8, 7, 6]));
      const before = await snapshotProjectTree();
      const serviceStore = createCreativeStudioStore({ rootDir, logError: () => undefined });
      const harness = makeHarness(undefined, { createExportId, exportCatalogStore, serviceStore });

      const outcomes = await Promise.allSettled([
        harness.service.createExport({
          projectId,
          expectedRevision: 7,
          expectedCatalogRevision: 1,
          shape: 'script',
        }),
        harness.service.listExports({ projectId }),
        harness.service.copyExport(
          { projectId, expectedCatalogRevision: 1, artifactId: 'legacy_export' },
          chooseDestination
        ),
        harness.service.revealExport(
          { projectId, expectedCatalogRevision: 1, artifactId: 'legacy_export' },
          revealPath
        ),
      ]);

      expect(
        outcomes.map((outcome) => {
          if (outcome.status === 'fulfilled') return { status: outcome.status };
          const error = outcome.reason;
          return error instanceof CreativeStudioStoreError
            ? { status: outcome.status, name: error.name, code: error.code, message: error.message }
            : { status: outcome.status, name: 'UnknownError', code: null, message: 'redacted' };
        })
      ).toEqual(
        Array.from({ length: 4 }, () => ({
          status: 'rejected',
          name: 'CreativeStudioStoreError',
          code: 'unsupported_prototype_schema',
          message: 'Unsupported prototype Studio schema',
        }))
      );
      expect({
        createExportId: createExportId.mock.calls.length,
        catalogList: catalogList.mock.calls.length,
        catalogCreate: catalogCreate.mock.calls.length,
        catalogRepair: catalogRepair.mock.calls.length,
        catalogCopy: catalogCopy.mock.calls.length,
        catalogResolveRevealPath: catalogResolveRevealPath.mock.calls.length,
        catalogWithManagedMediaAuthority: catalogWithManagedMediaAuthority.mock.calls.length,
        chooseDestination: chooseDestination.mock.calls.length,
        revealPath: revealPath.mock.calls.length,
      }).toEqual({
        createExportId: 0,
        catalogList: 0,
        catalogCreate: 0,
        catalogRepair: 0,
        catalogCopy: 0,
        catalogResolveRevealPath: 0,
        catalogWithManagedMediaAuthority: 0,
        chooseDestination: 0,
        revealPath: 0,
      });
      expect(await snapshotProjectTree()).toEqual(before);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('projects schema-2 proposal lifecycle results without exposing persisted project authority', async () => {
    const harness = makeHarness();

    await expect(harness.service.listProposals({ projectId: 'project_v2' })).resolves.toEqual([harness.proposal]);
    await expect(
      harness.service.acceptProposal({ projectId: 'project_v2', proposalId: harness.proposal.id })
    ).resolves.toMatchObject({
      proposal: { id: harness.proposal.id, status: 'accepted' },
      project: { id: 'project_v2' },
      applied: true,
    });
    await expect(
      harness.service.rejectProposal({ projectId: 'project_v2', proposalId: harness.proposal.id })
    ).resolves.toMatchObject({ id: harness.proposal.id, status: 'rejected' });

    harness.acceptProposalV2.mockResolvedValueOnce({
      proposal: {
        ...structuredClone(harness.proposal),
        status: 'accepted',
        decidedAt: '2026-08-17T00:00:02.000Z',
      },
      project: harness.getProject(),
      applied: false,
    });
    const accepted = await harness.service.acceptProposal({
      projectId: 'project_v2',
      proposalId: harness.proposal.id,
    });
    expect(accepted.applied).toBe(false);
    expect(Object.hasOwn(accepted.project, 'spendAuthorizations')).toBe(false);
    expect(Object.hasOwn(accepted.project, 'frameExtractions')).toBe(false);
    expect(Object.hasOwn(accepted.project, 'undoHistory')).toBe(false);
    expect(harness.listProposalsV2).toHaveBeenCalledExactlyOnceWith('project_v2');
    expect(harness.acceptProposalV2).toHaveBeenCalledTimes(2);
    expect(harness.rejectProposalV2).toHaveBeenCalledExactlyOnceWith('project_v2', harness.proposal.id);
    expect(harness.onProjectUpdated).toHaveBeenCalledTimes(1);

    await expect(
      harness.service.listProposals({ projectId: 'project_v2', extra: true } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      harness.service.acceptProposal({ projectId: 'project_v2', proposalId: '../proposal' })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      harness.service.rejectProposal({ projectId: '../project', proposalId: harness.proposal.id })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('projects reference generation handoffs without durable authorization identity', () => {
    const decision = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'reference_request_1',
      projectId: 'project_v2',
      decidedAt: '2026-08-17T00:00:01.000Z',
      outcome: { kind: 'generation_gate' as const, handoffId: 'handoff_1', shotIds: ['clip_1', 'clip_2'] },
    };

    expect(projectStudioReferenceGenerationHandoffV2(decision, null)).toEqual({
      handoffId: 'handoff_1',
      requestId: 'reference_request_1',
      shotIds: ['clip_1', 'clip_2'],
      decidedAt: decision.decidedAt,
      status: 'open',
      completedAt: null,
    });
    const confirmed = projectStudioReferenceGenerationHandoffV2(decision, {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      handoffId: 'handoff_1',
      requestId: 'reference_request_1',
      completedAt: '2026-08-17T00:00:02.000Z',
      result: { kind: 'confirmed', authorizationId: 'authorization_secret' },
    });
    expect(confirmed).toEqual({
      handoffId: 'handoff_1',
      requestId: 'reference_request_1',
      shotIds: ['clip_1', 'clip_2'],
      decidedAt: decision.decidedAt,
      status: 'confirmed',
      completedAt: '2026-08-17T00:00:02.000Z',
    });
    expect(JSON.stringify(confirmed)).not.toContain('authorization_secret');
    expect(projectStudioReferenceGenerationHandoffV2({ ...decision, outcome: { kind: 'rejected' } }, null)).toBeNull();
    expect(() =>
      projectStudioReferenceGenerationHandoffV2(
        { ...decision, outcome: { kind: 'rejected' } },
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          handoffId: 'handoff_1',
          requestId: 'reference_request_1',
          completedAt: '2026-08-17T00:00:02.000Z',
          result: { kind: 'dismissed' },
        }
      )
    ).toThrowError(expect.objectContaining({ code: 'storage_error' }));
    expect(() =>
      projectStudioReferenceGenerationHandoffV2(decision, {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId: 'other_handoff',
        requestId: 'reference_request_1',
        completedAt: '2026-08-17T00:00:02.000Z',
        result: { kind: 'dismissed' },
      })
    ).toThrowError(expect.objectContaining({ code: 'storage_error' }));
  });

  it('lists and decides reference requests while projecting ordered safe handoffs only', async () => {
    const harness = makeHarness();

    await expect(harness.service.listReferenceRequests({ projectId: 'project_v2' })).resolves.toEqual([
      harness.referenceRequest,
    ]);
    const decided = await harness.service.decideReferenceRequest({
      projectId: 'project_v2',
      requestId: harness.referenceRequest.id,
      expectedRevision: 2,
      outcome: { kind: 'generation_gate' },
    });
    expect(decided).toMatchObject({
      requestId: harness.referenceRequest.id,
      outcome: { kind: 'generation_gate', handoffId: 'handoff_service_1', shotIds: ['clip_1'] },
    });
    expect(harness.decideReferenceRequestV2).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_v2',
      requestId: harness.referenceRequest.id,
      expectedRevision: 2,
      outcome: { kind: 'generation_gate' },
    });

    const laterDecision = {
      ...structuredClone(decided),
      requestId: 'reference_request_service_2',
      decidedAt: '2026-08-17T00:00:03.000Z',
      outcome: { kind: 'generation_gate' as const, handoffId: 'handoff_service_2', shotIds: ['clip_1'] },
    };
    harness.listReferenceRequestsV2.mockResolvedValueOnce([
      {
        request: {
          ...structuredClone(harness.referenceRequest),
          id: laterDecision.requestId,
          createdAt: '2026-08-17T00:00:02.000Z',
        },
        decision: laterDecision,
        receipt: {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          handoffId: 'handoff_service_2',
          requestId: laterDecision.requestId,
          completedAt: '2026-08-17T00:00:04.000Z',
          result: { kind: 'confirmed', authorizationId: 'authorization_secret' },
        },
      },
      {
        request: structuredClone(harness.referenceRequest),
        decision: structuredClone(decided),
        receipt: null,
      },
      {
        request: { ...structuredClone(harness.referenceRequest), id: 'reference_request_service_3' },
        decision: {
          ...structuredClone(decided),
          requestId: 'reference_request_service_3',
          outcome: { kind: 'rejected' as const },
        },
        receipt: null,
      },
    ]);
    const handoffs = await harness.service.listReferenceGenerationHandoffs({ projectId: 'project_v2' });
    expect(handoffs).toEqual([
      {
        handoffId: 'handoff_service_1',
        requestId: harness.referenceRequest.id,
        shotIds: ['clip_1'],
        decidedAt: decided.decidedAt,
        status: 'open',
        completedAt: null,
      },
      {
        handoffId: 'handoff_service_2',
        requestId: laterDecision.requestId,
        shotIds: ['clip_1'],
        decidedAt: laterDecision.decidedAt,
        status: 'confirmed',
        completedAt: '2026-08-17T00:00:04.000Z',
      },
    ]);
    expect(JSON.stringify(handoffs)).not.toContain('authorization_secret');
  });

  it('prepares and confirms only the exact ordered seed-only reference handoff', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: 'handoff_service_1',
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [],
    });

    expect(prepared).toMatchObject({
      baseOnly: { projectId: project.id, projectRevision: project.revision, baseItems: [{ shotId: 'clip_1' }] },
      withCascade: null,
    });
    expect(harness.readReferenceGenerationHandoffV2).toHaveBeenCalledExactlyOnceWith(project.id, 'handoff_service_1');
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    expect(harness.confirmReferenceGenerationHandoffV2).toHaveBeenCalledTimes(1);
    expect(harness.getProject().spendAuthorizations).toEqual([
      expect.objectContaining({
        id: prepared.baseOnly.id,
        originReferenceHandoffId: 'handoff_service_1',
        baseItems: [expect.objectContaining({ shotId: 'clip_1', purpose: 'seed_still', generationCount: 1 })],
        cascadeItems: [],
      }),
    ]);
    expect(Object.values(harness.getProject().jobs).map((job) => job.purpose)).toEqual(['seed_still']);
    expect(harness.submitShots).toHaveBeenCalledTimes(1);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('refuses malformed, reordered, replaced, and broader handoff choices before pricing or provider work', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const createQuoteId = vi.fn(() => 'quote_must_not_be_created');
    const harness = makeHarness(project, { createQuoteId });
    const exact = {
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: 'handoff_service_1',
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still' as const, referenceAssetId: null }],
      cascadeChoices: [],
    };
    const malformed = [
      { ...exact, baseChoices: [] },
      {
        ...exact,
        baseChoices: [
          ...exact.baseChoices,
          { shotId: 'clip_2', purpose: 'seed_still' as const, referenceAssetId: null },
        ],
      },
      { ...exact, baseChoices: [...exact.baseChoices, ...exact.baseChoices] },
      { ...exact, baseChoices: [{ ...exact.baseChoices[0]!, purpose: 'video_take' as const }] },
      { ...exact, baseChoices: [{ ...exact.baseChoices[0]!, generationCount: 2 }] },
      { ...exact, baseChoices: [{ ...exact.baseChoices[0]!, referenceAssetId: 'reference_1' }] },
      {
        ...exact,
        cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take' as const, referenceAssetId: null }],
      },
    ];

    for (const request of malformed) {
      // Each shape deliberately violates the frozen handoff subset.
      // eslint-disable-next-line no-await-in-loop
      await expect(harness.service.prepareSubmission(request)).rejects.toMatchObject({ code: 'invalid_payload' });
    }
    harness.readReferenceGenerationHandoffV2.mockResolvedValueOnce({
      request: { ...harness.referenceRequest, shotIds: ['clip_1', 'clip_2'] },
      decision: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: harness.referenceRequest.id,
        projectId: project.id,
        decidedAt: '2026-08-17T00:00:02.000Z',
        outcome: { kind: 'generation_gate', handoffId: 'handoff_service_1', shotIds: ['clip_1', 'clip_2'] },
      },
      receipt: null,
    });
    await expect(
      harness.service.prepareSubmission({
        ...exact,
        baseChoices: [
          { shotId: 'clip_2', purpose: 'seed_still', referenceAssetId: null },
          { shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null },
        ],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    harness.readReferenceGenerationHandoffV2.mockResolvedValueOnce({
      request: structuredClone(harness.referenceRequest),
      decision: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: harness.referenceRequest.id,
        projectId: project.id,
        decidedAt: '2026-08-17T00:00:02.000Z',
        outcome: { kind: 'generation_gate', handoffId: 'handoff_service_1', shotIds: ['clip_1'] },
      },
      receipt: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        handoffId: 'handoff_service_1',
        requestId: harness.referenceRequest.id,
        completedAt: '2026-08-17T00:00:03.000Z',
        result: { kind: 'dismissed' },
      },
    });
    await expect(harness.service.prepareSubmission(exact)).rejects.toMatchObject({ code: 'invalid_payload' });
    harness.readReferenceGenerationHandoffV2.mockResolvedValueOnce({
      request: structuredClone(harness.referenceRequest),
      decision: {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'other_reference_request',
        projectId: project.id,
        decidedAt: '2026-08-17T00:00:02.000Z',
        outcome: { kind: 'generation_gate', handoffId: 'handoff_service_1', shotIds: ['clip_1'] },
      },
      receipt: null,
    });
    await expect(harness.service.prepareSubmission(exact)).rejects.toMatchObject({ code: 'invalid_payload' });
    const existingOrigin = structuredClone(project);
    existingOrigin.spendAuthorizations.push({
      originReferenceHandoffId: 'handoff_service_1',
    } as never);
    harness.setProject(existingOrigin);
    await expect(harness.service.prepareSubmission(exact)).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(createQuoteId).not.toHaveBeenCalled();
    expect(harness.confirmReferenceGenerationHandoffV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('dismisses an open reference handoff idempotently through receipt storage only', async () => {
    const harness = makeHarness();

    const first = await harness.service.dismissReferenceGenerationHandoff({
      projectId: 'project_v2',
      expectedRevision: 2,
      handoffId: 'handoff_service_1',
    });
    const retry = await harness.service.dismissReferenceGenerationHandoff({
      projectId: 'project_v2',
      expectedRevision: 1,
      handoffId: 'handoff_service_1',
    });

    expect(first).toEqual({ status: 'dismissed', completedAt: '2026-08-17T00:00:02.000Z' });
    expect(retry).toEqual(first);
    expect(Object.keys(first).toSorted()).toEqual(['completedAt', 'status']);
    expect(harness.recordReferenceGenerationHandoffReceiptV2).toHaveBeenCalledTimes(2);
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('fails closed for unavailable pricing, invalid clocks, unsafe quote IDs, and disposal', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still' as const, referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take' as const, referenceAssetId: null }],
    };

    await expect(
      makeHarness(project, { includeRateCard: false }).service.prepareSubmission(request)
    ).rejects.toMatchObject({ code: 'provider_error' });
    await expect(
      makeHarness(project, { now: () => 'not-a-date' as never }).service.prepareSubmission(request)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      makeHarness(project, { createQuoteId: () => '../unsafe' }).service.prepareSubmission(request)
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    const disposed = makeHarness(project);
    disposed.service.dispose();
    disposed.service.dispose();
    await expect(disposed.service.prepareSubmission(request)).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('preserves a safe missing-conditioning refusal before provider, cache, or paid work', async () => {
    const project = makeSchema2ServiceProject();
    project.videoRouteId = videoRoute.choiceId;
    const preparedSubmissionCache = new StudioPreparedSubmissionCacheV2();
    const admit = vi.spyOn(preparedSubmissionCache, 'admit');
    const harness = makeHarness(project, { preparedSubmissionCache });

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: project.revision,
        originReferenceHandoffId: null,
        baseChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
        cascadeChoices: [],
      })
    ).rejects.toMatchObject({ name: 'StudioPricingErrorV2', code: 'missing_conditioning' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('caches and confirms the server-derived default cascade instead of the caller empty list', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const preparedSubmissionCache = new StudioPreparedSubmissionCacheV2();
    const admit = vi.spyOn(preparedSubmissionCache, 'admit');
    const harness = makeHarness(project, { preparedSubmissionCache });

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [],
    });

    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
        }),
      })
    );
    expect(prepared.withCascade?.cascadeItems).toEqual([
      expect.objectContaining({ shotId: 'clip_1', purpose: 'video_take', generationCount: 1 }),
    ]);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.withCascade!.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    expect(harness.submitShots).toHaveBeenCalledTimes(1);
  });

  it.each(['quote_cache_full', 'quote_too_large'] as const)(
    'preserves the distinct %s prepare error without project mutation or paid work',
    async (code) => {
      const project = makeSchema2ServiceProject();
      project.imageRouteId = imageRoute.choiceId;
      project.videoRouteId = videoRoute.choiceId;
      const cache = new StudioPreparedSubmissionCacheV2();
      vi.spyOn(cache, 'admit').mockImplementation(() => {
        throw new StudioPreparedSubmissionCacheErrorV2(code);
      });
      const harness = makeHarness(project, { preparedSubmissionCache: cache });

      await expect(
        harness.service.prepareSubmission({
          projectId: project.id,
          expectedRevision: project.revision,
          originReferenceHandoffId: null,
          baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
          cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
        })
      ).rejects.toMatchObject({ code });

      expect(harness.getProject()).toEqual(project);
      expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
      expect(harness.store.confirmReferenceGenerationHandoffV2).not.toHaveBeenCalled();
      expect(harness.submitShots).not.toHaveBeenCalled();
      expect(harness.onProjectUpdated).not.toHaveBeenCalled();
      expect(harness.listProviders).not.toHaveBeenCalled();
      expect(harness.validateConnection).not.toHaveBeenCalled();
    }
  );

  it.each(['quote_not_found', 'quote_in_use'] as const)(
    'preserves the distinct %s confirm error before resolver, mutation, or paid work',
    async (code) => {
      const project = makeSchema2ServiceProject();
      const cache = new StudioPreparedSubmissionCacheV2();
      vi.spyOn(cache, 'claim').mockImplementation(() => {
        throw new StudioPreparedSubmissionCacheErrorV2(code);
      });
      const harness = makeHarness(project, { preparedSubmissionCache: cache });

      await expect(
        harness.service.confirmSubmission({
          projectId: project.id,
          quoteId: 'quote_missing_or_busy',
          expectedRevision: project.revision,
        })
      ).rejects.toMatchObject({ code });

      expect(harness.getProject()).toEqual(project);
      expect(harness.loadRateCard).not.toHaveBeenCalled();
      expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
      expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
      expect(harness.store.confirmReferenceGenerationHandoffV2).not.toHaveBeenCalled();
      expect(harness.submitShots).not.toHaveBeenCalled();
      expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    }
  );

  it('treats exact TTL expiry and restart cache loss as quote_not_found without automatic confirmation', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    let cacheNow = Date.parse('2026-08-17T00:00:00.000Z');
    const cache = new StudioPreparedSubmissionCacheV2({ now: () => cacheNow });
    const harness = makeHarness(project, { preparedSubmissionCache: cache });
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    cacheNow += STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000;

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
    const restarted = makeHarness(project);
    await expect(
      restarted.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });

    expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
    expect(restarted.store.confirmProjectV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(restarted.submitShots).not.toHaveBeenCalled();
  });

  it('uses safe default clocks and identities when no deterministic factories are injected', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project, { useDefaultClock: true, useDefaultIds: true });

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });

    expect(prepared.baseOnly.id).toMatch(/^quote_[a-f0-9]{32}$/);
    expect(Date.parse(prepared.baseOnly.expiresAt)).toBeGreaterThan(Date.now());
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    const committedJob = Object.values(harness.getProject().jobs)[0]!;
    expect(committedJob.id).toMatch(/^job_[a-f0-9]{32}$/);
    expect(committedJob.idempotencyKey).toMatch(/^key_[a-f0-9]{32}$/);
  });

  it('derives payable shots in persisted beat and shot order', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    const result = await harness.service.getGenerationReadiness({
      projectId: 'project_v2',
      beatIds: ['section_2', 'section_1'],
    });

    expect(derivePayableShotIds(project, ['section_2', 'section_1'])).toEqual(['clip_1', 'clip_2']);
    expect(result.payableShotIds).toEqual(['clip_1', 'clip_2']);
    expect(result.shots.every((shot) => shot.ready)).toBe(true);
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();

    const subset = await harness.service.getGenerationReadiness({
      projectId: 'project_v2',
      beatIds: ['section_1'],
    });
    expect(subset.payableShotIds).toEqual(['clip_1']);
  });

  it('reports exact authored and durable blockers without treating optional copy as required', async () => {
    const project = makeSchema2ServiceProject();
    project.beats.section_1.title = '';
    project.shots.clip_2.line = '';
    const harness = makeHarness(project);

    const result = await harness.service.getGenerationReadiness({
      projectId: project.id,
      beatIds: ['section_1', 'section_2'],
    });

    expect(result.payableShotIds).toEqual([]);
    expect(result.shots.map(({ shotId, issues }) => ({ shotId, issues }))).toEqual([
      { shotId: 'clip_1', issues: ['missing_beat_title'] },
      { shotId: 'clip_2', issues: ['missing_line'] },
    ]);
  });

  it('projects only image and video route catalogs without storyboard authority', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);

    const catalog = await harness.service.listRoutes({ projectId: project.id });

    expect(Object.keys(catalog)).toEqual(['image', 'video', 'catalogVersion']);
    expect(catalog.image.selectedRoute?.choiceId).toBe(imageRoute.choiceId);
    expect(catalog.catalogVersion).toBe('catalog_v2');
  });

  it('builds the schema-2 Brief MCP descriptor from complete proposal and reference authorities', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    const descriptor = await harness.service.getBriefSessionServer({ projectId: project.id });

    expect(harness.ensureDirectorCommandMailbox).toHaveBeenCalledWith(project.id);
    expect(harness.resolveProposalPathsV2).toHaveBeenCalledWith(project.id);
    expect(harness.resolveReferenceRequestPathsV2).toHaveBeenCalledWith(project.id);
    expect(descriptor).toEqual({
      id: `studio-brief-${project.id}`,
      name: BUILTIN_STUDIO_NAME,
      transport: {
        type: 'stdio',
        command: 'node',
        args: ['/bundled/builtin-mcp-studio.js'],
        env: expect.objectContaining({
          [STUDIO_ENV.projectId]: project.id,
          [STUDIO_ENV.projectDir]: `/studio/${project.id}`,
          [STUDIO_ENV.pendingDir]: `/studio/${project.id}/proposals/pending`,
          [STUDIO_ENV.referencePendingDir]: `/studio/${project.id}/reference-requests/pending`,
        }),
      },
    });
    const routeCatalog = JSON.parse(
      (descriptor.transport.type === 'stdio' ? descriptor.transport.env?.[STUDIO_ENV.routeCatalog] : undefined) ?? '{}'
    ) as Record<string, unknown>;
    expect(Object.keys(routeCatalog)).toEqual(['image', 'video', 'catalogVersion']);
    expect(routeCatalog).not.toHaveProperty('storyboard');
  });

  it('reads exact Director transport authority without creating sidecars, resolving providers, or mutating', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    const authority = await harness.service.getDirectorSessionAuthority({ projectId: project.id });

    expect(authority).toEqual({
      serverId: `studio-brief-${project.id}`,
      serverName: BUILTIN_STUDIO_NAME,
      scriptPath: '/bundled/builtin-mcp-studio.js',
      projectDir: `/studio/${project.id}`,
      pendingDir: `/studio/${project.id}/proposals/pending`,
      referencePendingDir: `/studio/${project.id}/reference-requests/pending`,
    });
    expect(Object.keys(authority)).toEqual([
      'serverId',
      'serverName',
      'scriptPath',
      'projectDir',
      'pendingDir',
      'referencePendingDir',
    ]);
    expect(harness.getVerifiedProjectDirectoryV2).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(harness.getStudioServerScriptPath).toHaveBeenCalledOnce();
    expect(harness.resolveProposalPathsV2).not.toHaveBeenCalled();
    expect(harness.resolveReferenceRequestPathsV2).not.toHaveBeenCalled();
    expect(harness.ensureDirectorCommandMailbox).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.validateConnection).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
  });

  it('atomically binds only the Director conversation without reducer, provider, or paid work', async () => {
    const harness = makeHarness();
    const before = harness.getProject();

    const result = await harness.service.bindDirectorConversation({
      projectId: before.id,
      expectedRevision: before.revision,
      conversationId: 'conversation_1',
    });
    const after = harness.getProject();

    expect(result).toEqual({
      projectId: before.id,
      projectRevision: before.revision + 1,
      createdBeatIds: [],
      createdShotIds: [],
    });
    expect(after).toEqual({
      ...before,
      revision: before.revision + 1,
      updatedAt: '2026-08-17T00:00:02.000Z',
      briefConversationId: 'conversation_1',
    });
    expect(harness.store.updateProjectV2).toHaveBeenCalledOnce();
    expect(harness.onProjectUpdated).toHaveBeenCalledExactlyOnceWith(before.id);
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('replaces a different dangling Director conversation at the current revision', async () => {
    const project = makeSchema2ServiceProject();
    project.briefConversationId = 'conversation_missing';
    const harness = makeHarness(project);

    await expect(
      harness.service.bindDirectorConversation({
        projectId: project.id,
        expectedRevision: project.revision,
        conversationId: 'conversation_replacement',
      })
    ).resolves.toEqual({
      projectId: project.id,
      projectRevision: project.revision + 1,
      createdBeatIds: [],
      createdShotIds: [],
    });

    expect(harness.getProject()).toEqual({
      ...project,
      revision: project.revision + 1,
      updatedAt: '2026-08-17T00:00:02.000Z',
      briefConversationId: 'conversation_replacement',
    });
    expect(harness.store.updateProjectV2).toHaveBeenCalledOnce();
    expect(harness.onProjectUpdated).toHaveBeenCalledExactlyOnceWith(project.id);
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('treats an already-bound Director conversation as an idempotent replay without a revision bump', async () => {
    const project = makeSchema2ServiceProject();
    project.briefConversationId = 'conversation_1';
    const harness = makeHarness(project);

    const result = await harness.service.bindDirectorConversation({
      projectId: project.id,
      expectedRevision: project.revision - 1,
      conversationId: 'conversation_1',
    });

    expect(result).toEqual({
      projectId: project.id,
      projectRevision: project.revision,
      createdBeatIds: [],
      createdShotIds: [],
    });
    expect(harness.getProject()).toEqual(project);
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('converges an overlapping same-conversation bind after losing the CAS race', async () => {
    const harness = makeHarness();
    const before = harness.getProject();
    harness.store.updateProjectV2.mockImplementationOnce(async () => {
      harness.setProject({
        ...before,
        revision: before.revision + 1,
        updatedAt: '2026-08-17T00:00:02.000Z',
        briefConversationId: 'conversation_1',
      });
      throw new CreativeStudioStoreError('stale_project', 'overlapping Director bind won the CAS race');
    });

    await expect(
      harness.service.bindDirectorConversation({
        projectId: before.id,
        expectedRevision: before.revision,
        conversationId: 'conversation_1',
      })
    ).resolves.toEqual({
      projectId: before.id,
      projectRevision: before.revision + 1,
      createdBeatIds: [],
      createdShotIds: [],
    });

    expect(harness.store.updateProjectV2).toHaveBeenCalledOnce();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('allows exactly one winner when different Director conversations compete at the same revision', async () => {
    const harness = makeHarness();
    const before = harness.getProject();
    const requests = ['conversation_alpha', 'conversation_beta'].map((conversationId) => ({
      projectId: before.id,
      expectedRevision: before.revision,
      conversationId,
    }));

    const results = await Promise.allSettled(
      requests.map((request) => harness.service.bindDirectorConversation(request))
    );
    const winnerIndex = results.findIndex((result) => result.status === 'fulfilled');
    const loserIndex = results.findIndex((result) => result.status === 'rejected');

    expect(winnerIndex).toBeGreaterThanOrEqual(0);
    expect(loserIndex).toBeGreaterThanOrEqual(0);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
    expect(results[winnerIndex]).toEqual({
      status: 'fulfilled',
      value: {
        projectId: before.id,
        projectRevision: before.revision + 1,
        createdBeatIds: [],
        createdShotIds: [],
      },
    });
    expect(results[loserIndex]).toMatchObject({
      status: 'rejected',
      reason: { code: 'stale_project' },
    });
    expect(harness.getProject()).toEqual({
      ...before,
      revision: before.revision + 1,
      updatedAt: '2026-08-17T00:00:02.000Z',
      briefConversationId: requests[winnerIndex]?.conversationId,
    });
    expect(harness.store.updateProjectV2).toHaveBeenCalledTimes(2);
    expect(harness.onProjectUpdated).toHaveBeenCalledExactlyOnceWith(before.id);
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('preserves CAS authority when a stale request tries to replace the Director conversation', async () => {
    const project = makeSchema2ServiceProject();
    project.briefConversationId = 'conversation_1';
    const harness = makeHarness(project);

    await expect(
      harness.service.bindDirectorConversation({
        projectId: project.id,
        expectedRevision: project.revision - 1,
        conversationId: 'conversation_2',
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    expect(harness.getProject()).toEqual(project);
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('validates, stores, lists, and removes schema-independent connections through the V2 service', async () => {
    const harness = makeHarness(makeSchema2ServiceProject(), { createConnectionId: () => 'binding_v2_1' });
    const request = {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image-model',
    };

    await expect(harness.service.listConnectionCandidates()).resolves.toEqual([
      {
        providerId: 'provider_1',
        providerName: 'Image provider',
        models: [{ model: 'image-model', health: 'available' }],
        integrationModels: [{ integrationLabelKey: 'openRouterVideo', models: [] }],
      },
    ]);
    await expect(harness.service.validateConnection(request)).resolves.toMatchObject({
      valid: true,
      connection: {
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
        capabilities: {
          mediaKinds: ['image'],
          supportsFirstFrame: true,
          maxConditioningImages: 3,
        },
        validatedAt: '2026-08-17T00:00:02.000Z',
      },
    });
    const saved = await harness.service.saveConnection(request);
    expect(saved).toMatchObject({ bindingId: 'binding_v2_1', providerId: 'provider_1' });
    expect(JSON.stringify(saved)).not.toContain('provider-secret');
    await expect(harness.service.listConnections()).resolves.toMatchObject({
      integrations: expect.arrayContaining([
        { integrationId: 'integration_g7Q2mB4p', kind: 'image', labelKey: 'imageApi' },
      ]),
      connections: [saved],
    });
    await expect(harness.service.removeConnection({ bindingId: 'binding_v2_1' })).resolves.toBe(true);
    await expect(harness.service.listConnections()).resolves.toMatchObject({ connections: [] });
  });

  it('rejects hostile connection envelopes before provider or adapter access', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
        scope: 'persisted-provenance',
      } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(harness.service.removeConnection({ bindingId: '../binding' })).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(harness.listProviders).not.toHaveBeenCalled();
    expect(harness.validateConnection).not.toHaveBeenCalled();
    expect(harness.removeConnection).not.toHaveBeenCalled();
  });

  it.each([null, '', 'x'.repeat(257), ' leading-space', 'control\u0001character'])(
    'rejects the unsafe connection model %j before provider access',
    async (model) => {
      const harness = makeHarness();

      await expect(
        harness.service.validateConnection({
          providerId: 'provider_1',
          integrationId: 'integration_g7Q2mB4p',
          model,
        } as never)
      ).rejects.toMatchObject({ code: 'invalid_payload' });
      expect(harness.listProviders).not.toHaveBeenCalled();
    }
  );

  it('rejects an unknown connection integration before reading provider credentials', async () => {
    const harness = makeHarness();

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_unknown',
        model: 'image-model',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.listProviders).not.toHaveBeenCalled();
  });

  it('maps provider inventory failures to the stable provider error', async () => {
    const harness = makeHarness();
    harness.listProviders.mockRejectedValueOnce(new Error('credential inventory unavailable'));

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
      })
    ).rejects.toMatchObject({ code: 'provider_error' });
    expect(harness.validateConnection).not.toHaveBeenCalled();
  });

  it.each([
    ['missing provider', []],
    ['disabled provider', [{ enabled: false }]],
    ['disabled model', [{ model_enabled: { 'image-model': false } }]],
    ['unhealthy model', [{ model_health: { 'image-model': { status: 'unhealthy' } } }]],
    ['empty API key', [{ api_key: '  ' }]],
    ['empty base URL', [{ base_url: '  ' }]],
  ] as const)('rejects an unavailable connection for a %s', async (_label, variants) => {
    const harness = makeHarness();
    const baseProvider: IProvider = {
      id: 'provider_1',
      platform: 'openai',
      name: 'Image provider',
      base_url: 'https://provider.invalid/v1',
      api_key: 'provider-secret',
      models: ['image-model'],
    };
    harness.listProviders.mockResolvedValueOnce(
      variants.map((variant) => ({ ...baseProvider, ...variant }) as IProvider)
    );

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.validateConnection).not.toHaveBeenCalled();
  });

  it('rejects a connection whose integration adapter is unavailable', async () => {
    const harness = makeHarness();
    harness.adapterRegistry.delete('weprompt-image-v1');

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.validateConnection).not.toHaveBeenCalled();
  });

  it('returns a bounded connection deadline as a sanitized timeout validation result', async () => {
    const harness = makeHarness();
    const request = {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image-model',
    };
    harness.validateConnection.mockRejectedValueOnce(new ProviderDeadlineError());

    await expect(harness.service.validateConnection(request)).resolves.toEqual({
      valid: false,
      reason: 'timeout',
    });
  });

  it.each([
    'unsupported',
    'auth',
    'rate_limited',
    'provider_unavailable',
    'timeout',
    'invalid_response',
    'unknown',
  ] as const)('preserves the sanitized %s validation reason without provider-controlled details', async (reason) => {
    const harness = makeHarness();
    const request = {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image-model',
    };
    harness.validateConnection.mockResolvedValueOnce({ ok: false, error: { code: reason } });

    await expect(harness.service.validateConnection(request)).resolves.toEqual({ valid: false, reason });
  });

  it('maps the internal no-output adapter reason to the public unknown validation reason', async () => {
    const harness = makeHarness();
    const request = {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image-model',
    };
    harness.validateConnection.mockResolvedValueOnce({ ok: false, error: { code: 'no_output' } });

    await expect(harness.service.validateConnection(request)).resolves.toEqual({ valid: false, reason: 'unknown' });
  });

  it('keeps a malformed adapter validation failure outside the public reason contract', async () => {
    const harness = makeHarness();
    const request = {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image-model',
    };

    harness.validateConnection.mockResolvedValueOnce({ ok: false, error: 'invalid credentials' });
    await expect(harness.service.validateConnection(request)).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('keeps a malformed OpenRouter success outside the public validation contract', async () => {
    const harness = makeHarness();
    harness.adapterRegistry.set('openrouter-video-v1', {
      id: 'openrouter-video-v1',
      validateConnection: harness.validateConnection,
    } as never);
    harness.validateConnection.mockResolvedValueOnce({ ok: true, capabilities: { mediaKinds: ['video'] } });

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_o4R7vD2m',
        model: 'image-model',
      })
    ).rejects.toMatchObject({ code: 'provider_error' });
  });

  it('preserves an exact OpenRouter validation capability contract through the public result', async () => {
    const harness = makeHarness();
    harness.adapterRegistry.set('openrouter-video-v1', {
      id: 'openrouter-video-v1',
      validateConnection: harness.validateConnection,
    } as never);
    harness.validateConnection.mockResolvedValueOnce({
      ok: true,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 15,
        supportedDurationSeconds: [4, 8, 15],
        supportsFirstFrame: true,
        maxConditioningImages: 0,
        cancellationPolicy: 'none',
      },
    } as never);

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_o4R7vD2m',
        model: 'image-model',
      })
    ).resolves.toMatchObject({
      valid: true,
      connection: {
        providerId: 'provider_1',
        integrationId: 'integration_o4R7vD2m',
        model: 'image-model',
        capabilities: {
          mediaKinds: ['video'],
          audioModes: ['audio'],
          aspectRatios: ['16:9', '9:16'],
          resolutions: ['720p', '1080p'],
          minDurationSeconds: 4,
          maxDurationSeconds: 15,
          supportedDurationSeconds: [4, 8, 15],
          supportsFirstFrame: true,
          maxConditioningImages: 0,
        },
      },
    });
  });

  it('refuses to persist a connection when revalidation returns a sanitized business failure', async () => {
    const harness = makeHarness();
    const request = {
      providerId: 'provider_1',
      integrationId: 'integration_g7Q2mB4p',
      model: 'image-model',
    };
    harness.validateConnection.mockResolvedValueOnce({ ok: false, error: { code: 'auth' } });

    await expect(harness.service.saveConnection(request)).rejects.toMatchObject({ code: 'provider_error' });
    expect(harness.saveConnection).not.toHaveBeenCalled();
  });

  it('does not relabel an unexpected adapter implementation failure', async () => {
    const harness = makeHarness();
    const adapterError = new Error('adapter implementation failed');
    harness.validateConnection.mockRejectedValueOnce(adapterError);

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
      })
    ).rejects.toBe(adapterError);
  });

  it('sanitizes self-hosted video capabilities across populated and absent optional constraints', async () => {
    const harness = makeHarness();
    harness.adapterRegistry.set('weprompt-media-gateway-v1', {
      id: 'weprompt-media-gateway-v1',
      validateConnection: harness.validateConnection,
    } as never);
    harness.validateConnection
      .mockResolvedValueOnce({
        ok: true,
        capabilities: {
          aspectRatios: ['16:9', 'unsupported', 42],
          resolutions: ['1080p', 'unsupported', false],
          minDurationSeconds: 0,
          maxDurationSeconds: 61,
          supportsFirstFrame: true,
          cancellationPolicy: 'queued_and_running',
        },
      } as never)
      .mockResolvedValueOnce({
        ok: true,
        capabilities: {
          minDurationSeconds: 4,
          maxDurationSeconds: 15,
          supportsFirstFrame: false,
          cancellationPolicy: 'unsupported',
        },
      } as never);

    const populated = await harness.service.validateConnection({
      providerId: 'provider_1',
      integrationId: 'integration_x5T8cW1h',
      model: 'gateway-video-model',
    });
    const absent = await harness.service.validateConnection({
      providerId: 'provider_1',
      integrationId: 'integration_x5T8cW1h',
      model: 'gateway-video-model-2',
    });

    expect(populated).toMatchObject({ valid: true });
    expect(absent).toMatchObject({ valid: true });
    if (!populated.valid || !absent.valid) throw new Error('Expected successful connection validations');
    expect(populated.connection.capabilities).toEqual({
      mediaKinds: ['video'],
      audioModes: ['none'],
      aspectRatios: ['16:9'],
      resolutions: ['1080p'],
      supportsFirstFrame: true,
      maxConditioningImages: 0,
    });
    expect(absent.connection.capabilities).toEqual({
      mediaKinds: ['video'],
      audioModes: ['none'],
      minDurationSeconds: 4,
      maxDurationSeconds: 15,
      supportsFirstFrame: false,
      maxConditioningImages: 0,
    });
  });

  it('keeps non-silent OpenRouter video routes while filtering non-silent routes from other adapters', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const openRouterAudioRoute = {
      ...videoRoute,
      model: 'openrouter-video-with-audio',
      constraints: { ...videoRoute.constraints, silentOutput: false },
    };
    const gatewayAudioRoute = {
      ...videoRoute,
      choiceId: createStudioMediaChoiceId({
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'gateway-video-with-audio',
        kind: 'video',
      }),
      adapterId: 'weprompt-media-gateway-v1' as const,
      model: 'gateway-video-with-audio',
      constraints: { ...videoRoute.constraints, silentOutput: false },
    };
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [openRouterAudioRoute, gatewayAudioRoute],
      diagnostics: [
        { status: 'available', route: openRouterAudioRoute },
        { status: 'available', route: gatewayAudioRoute },
      ],
      generationCatalogVersion: 'catalog_audio_routes',
    } as never);

    const catalog = await harness.service.listRoutes({ projectId: project.id });

    expect(catalog.video.options).toEqual([
      expect.objectContaining({
        model: 'openrouter-video-with-audio',
        constraints: expect.objectContaining({ silentOutput: false }),
      }),
    ]);
  });

  it('strips durable provider, charge, and remote-task authority from schema-2 jobs', async () => {
    const project = makeSchema2ServiceProject();
    const job = makeSchema2Job(project, {
      status: 'queued_remote',
      providerJobId: 'provider_job_secret',
      remoteStartedAt: '2026-08-17T00:00:01.000Z',
      cancellationPolicy: 'queued_only',
      error: null,
    });
    project.jobs[job.id] = job;
    project.shots.clip_1.jobIds = [job.id];
    const harness = makeHarness(project);

    const loaded = await harness.service.getProject(project.id);
    const rendererJob = loaded.status === 'supported' ? loaded.project.jobs.job_1 : undefined;

    expect(rendererJob?.provider).toEqual({
      choiceId: imageRoute.choiceId,
      providerId: 'provider_1',
      model: 'image-model',
    });
    expect(rendererJob).not.toHaveProperty('providerJobId');
    expect(rendererJob).not.toHaveProperty('idempotencyKey');
  });

  it('keeps free schema-2 project operations outside provider and job-manager code', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const poison = (): never => {
      throw new Error('paid boundary reached by a free operation');
    };
    harness.providerResolver.listGenerationRoutes.mockImplementation(poison);
    harness.submitShots.mockImplementation(poison);
    harness.cancelJobV2.mockImplementation(poison);
    harness.retryJobV2.mockImplementation(poison);
    harness.retryDownloadV2.mockImplementation(poison);

    await harness.service.listProjects();
    await harness.service.getProject(project.id);
    await harness.service.createProject({
      name: 'New project',
      brief: '',
      aspectRatio: '16:9',
      targetDurationSeconds: 12,
      resolution: '1080p',
    });
    await harness.service.applyMutations(
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Updated' }],
      },
      { mutationId: 'service_free_batch', capturedAt: '2026-08-17T00:00:02.000Z' }
    );
    await harness.service.getGenerationReadiness({ projectId: project.id, beatIds: ['section_1'] });
    await harness.service.importReferenceFromPath({
      projectId: project.id,
      shotId: 'clip_1',
      expectedRevision: project.revision,
      sourcePath: '/chosen/reference.png',
    });
    await harness.service.detachBriefReference({
      projectId: project.id,
      assetId: 'reference_1',
      expectedRevision: project.revision,
    });
    await harness.service.persistCapturedPoster({
      projectId: project.id,
      shotId: 'clip_1',
      videoAssetId: 'video_1',
      dataUrl: `data:image/png;base64,${Buffer.from('89504e470d0a1a0a', 'hex').toString('base64')}`,
      width: 1280,
      height: 720,
    });
    await harness.service.deleteProject({ projectId: project.id, expectedRevision: project.revision });

    expect(harness.exportCatalogStore.withManagedMediaAuthority).toHaveBeenCalledOnce();
    expect(harness.store.deleteProjectV2).toHaveBeenCalledWith(project.id, project.revision);
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.cancelJobV2).not.toHaveBeenCalled();
    expect(harness.retryJobV2).not.toHaveBeenCalled();
    expect(harness.retryDownloadV2).not.toHaveBeenCalled();
  });

  it('attaches a reference through the shot-owned media seam and returns a renderer projection', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    const result = await harness.service.importReferenceFromPath({
      projectId: project.id,
      shotId: 'clip_1',
      expectedRevision: project.revision,
      sourcePath: '/chosen/reference.png',
    });

    expect(harness.importReferenceFromPathV2).toHaveBeenCalledWith({
      projectId: project.id,
      shotId: 'clip_1',
      expectedRevision: project.revision,
      sourcePath: '/chosen/reference.png',
      returnProject: true,
    });
    expect(result.asset).toMatchObject({ id: 'reference_1', shotId: 'clip_1' });
    expect(harness.onProjectUpdated).toHaveBeenCalledWith(project.id);
  });

  it('decodes a bounded PNG before forwarding a captured poster to V2 media storage', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const png = Buffer.from('89504e470d0a1a0a', 'hex');

    await harness.service.persistCapturedPoster({
      projectId: project.id,
      shotId: 'clip_1',
      videoAssetId: 'video_1',
      dataUrl: `data:image/png;base64,${png.toString('base64')}`,
      width: 1280,
      height: 720,
    });

    expect(harness.persistCapturedPosterV2).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        shotId: 'clip_1',
        videoAssetId: 'video_1',
        declaredByteSize: png.length,
      })
    );
    expect(harness.onProjectUpdated).toHaveBeenCalledWith(project.id);
  });

  it('forwards cancel, retry, and retry-download through only their named V2 manager seams', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const projectedJob = makeSchema2Job(project, {
      status: 'failed',
      providerJobId: 'remote_job_1',
      error: { code: 'download_failed', messageKey: 'downloadFailed' },
      progress: 0.5,
    });
    harness.cancelJobV2.mockResolvedValueOnce(projectedJob);
    harness.retryJobV2.mockResolvedValueOnce(projectedJob);
    harness.retryDownloadV2.mockResolvedValueOnce(projectedJob);
    const request = { projectId: project.id, jobId: projectedJob.id, expectedRevision: project.revision };

    const cancelled = await harness.service.cancelJob(request);
    const retried = await harness.service.retryJob({ ...request, acknowledgePossibleDuplicateCharge: true });
    const downloaded = await harness.service.retryDownload(request);

    expect(harness.cancelJobV2).toHaveBeenCalledWith(request);
    expect(harness.retryJobV2).toHaveBeenCalledWith({ ...request, acknowledgePossibleDuplicateCharge: true });
    expect(harness.retryDownloadV2).toHaveBeenCalledWith(request);
    for (const job of [cancelled, retried, downloaded]) {
      expect(job).toMatchObject({
        id: projectedJob.id,
        shotId: 'clip_1',
        purpose: 'seed_still',
        progress: 0.5,
        canRetry: false,
        canRetryDownload: true,
        error: { code: 'download_failed' },
      });
      expect(job).not.toHaveProperty('providerJobId');
      expect(job).not.toHaveProperty('idempotencyKey');
    }
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('projects independent same-attempt retry capability across generation siblings', async () => {
    const single = makeSchema2ServiceProject();
    const retryable = makeSchema2Job(single, {
      status: 'needs_attention',
      providerJobId: 'remote_job_1',
      error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    });
    single.jobs[retryable.id] = retryable;
    single.shots.clip_1!.jobIds.push(retryable.id);
    const singleHarness = makeHarness(single);

    const singleResult = await singleHarness.service.getProject({ projectId: single.id });
    expect(singleResult.status === 'supported' ? singleResult.project.jobs[retryable.id]?.canRetry : null).toBe(true);

    const competing = makeSchema2ServiceProject();
    const first = makeSchema2Job(competing, {
      status: 'needs_attention',
      providerJobId: 'remote_job_1',
      error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    });
    const sibling = makeSchema2Job(competing, {
      id: 'job_2',
      status: 'needs_attention',
      providerJobId: 'remote_job_2',
      error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    });
    competing.jobs[first.id] = first;
    competing.jobs[sibling.id] = sibling;
    competing.shots.clip_1!.jobIds.push(first.id, sibling.id);
    const competingHarness = makeHarness(competing);

    const competingResult = await competingHarness.service.getProject({ projectId: competing.id });
    expect(competingResult.status === 'supported' ? competingResult.project.jobs[first.id]?.canRetry : null).toBe(true);
    expect(competingResult.status === 'supported' ? competingResult.project.jobs[sibling.id]?.canRetry : null).toBe(
      true
    );
  });

  it('rejects an invalid duplicate-charge acknowledgement before retry manager work', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.retryJob({
        projectId: project.id,
        jobId: 'job_1',
        expectedRevision: project.revision,
        acknowledgePossibleDuplicateCharge: 'yes' as never,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.retryJobV2).not.toHaveBeenCalled();
  });

  it('derives visual, duration, active-job, and latest-failure blockers', async () => {
    const project = makeSchema2ServiceProject();
    project.beats.section_1.look = '   ';
    project.shots.clip_1.durationSeconds = 3;
    project.assets.take_1 = {
      id: 'take_1',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'take_1.mp4' },
      byteSize: 8,
      sha256: 'b'.repeat(64),
      durationSeconds: 10,
      createdAt: project.createdAt,
    };
    project.shots.clip_1.assetIds = ['take_1'];
    project.jobs.active_job = makeSchema2Job(project, {
      id: 'active_job',
      status: 'running',
      providerJobId: 'remote_active',
      error: null,
    });
    project.jobs.failed_job = makeSchema2Job(project, {
      id: 'failed_job',
      shotId: 'clip_2',
      error: { code: 'timeout', messageKey: 'timeout' },
    });
    project.shots.clip_1.jobIds = ['active_job'];
    project.shots.clip_2.jobIds = ['failed_job'];
    const harness = makeHarness(project);

    const readiness = await harness.service.getGenerationReadiness({
      projectId: project.id,
      beatIds: ['section_1', 'section_2'],
    });

    expect(readiness.shots).toEqual([
      {
        shotId: 'clip_1',
        beatId: 'section_1',
        ready: false,
        issues: ['missing_look', 'invalid_shot_duration', 'active_job'],
      },
      {
        shotId: 'clip_2',
        beatId: 'section_2',
        ready: false,
        issues: ['latest_job_failed'],
      },
    ]);
    expect(readiness.payableShotIds).toEqual([]);
  });

  it('keeps a Shot with a current picture payable for Generate again', async () => {
    const project = makeSchema2ServiceProject();
    project.assets.picture_1 = {
      id: 'picture_1',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'picture_1.mp4' },
      byteSize: 8,
      sha256: 'b'.repeat(64),
      durationSeconds: 10,
      createdAt: project.createdAt,
    };
    project.shots.clip_1.assetIds = ['picture_1'];
    project.shots.clip_1.videoAssetId = 'picture_1';
    const harness = makeHarness(project);

    const readiness = await harness.service.getGenerationReadiness({
      projectId: project.id,
      beatIds: ['section_1'],
    });

    expect(readiness.shots).toEqual([{ shotId: 'clip_1', beatId: 'section_1', ready: true, issues: [] }]);
    expect(readiness.payableShotIds).toEqual(['clip_1']);
  });

  it.each([
    ['a non-array', null],
    ['a duplicate active beat', ['section_1', 'section_1']],
    ['a non-active beat', ['section_missing']],
  ])('rejects %s in a readiness selection', async (_label, beatIds) => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.getGenerationReadiness({ projectId: project.id, beatIds: beatIds as never })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it.each([
    [
      'frame mismatch',
      [{ ...imageRoute, constraints: { ...imageRoute.constraints, aspectRatios: ['9:16' as const] } }],
      [],
      { code: 'frame', aspectRatio: '16:9', resolution: '1080p' },
    ],
    [
      'missing setup',
      [],
      [
        {
          status: 'needs_setup' as const,
          providerId: imageRoute.providerId,
          providerName: imageRoute.providerName,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
      ],
      { code: 'needs_setup', providerName: imageRoute.providerName },
    ],
    [
      'provider health',
      [],
      [
        {
          status: 'health' as const,
          providerId: imageRoute.providerId,
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
      ],
      { code: 'health' },
    ],
    ['retired route', [], [], { code: 'retired' }],
  ])('projects an unavailable selection caused by %s', async (_label, routes, diagnostics, expectedIssue) => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes,
      diagnostics,
      generationCatalogVersion: 'catalog_v2',
    });

    const catalog = await harness.service.listRoutes({ projectId: project.id });

    expect(catalog.image.status).toBe('unavailable');
    expect(catalog.image.selectedRoute).toBeNull();
    expect(catalog.image.selectionIssue).toEqual(expectedIssue);
  });

  it('projects selection-required catalogs globally and maps resolver failure', async () => {
    const harness = makeHarness();

    await expect(harness.service.listRoutes()).resolves.toMatchObject({
      image: { status: 'selection_required', selectionIssue: null },
    });
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(new Error('resolver unavailable'));
    await expect(harness.service.listRoutes()).rejects.toMatchObject({ code: 'provider_error' });
  });

  it.each([
    ['unsupported prototype', { status: 'unsupported_prototype_schema' as const, projectId: 'project_v2' }],
    ['missing project', { status: 'not_found' as const, projectId: 'project_v2' }],
  ])('keeps %s distinct on V2 operational reads', async (_label, loadResult) => {
    const harness = makeHarness();
    harness.store.getProjectV2.mockResolvedValue(loadResult);

    await expect(
      harness.service.getGenerationReadiness({ projectId: 'project_v2', beatIds: [] })
    ).rejects.toMatchObject({
      code: loadResult.status === 'unsupported_prototype_schema' ? 'unsupported_prototype_schema' : 'not_found',
    });
    await expect(harness.service.getProject('project_v2')).resolves.toEqual(loadResult);
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it('rejects unavailable media seams before any storage work can be mistaken for success', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project, { includeMediaStore: false });
    const png = Buffer.from('89504e470d0a1a0a', 'hex');

    await expect(
      harness.service.importReferenceFromPath({
        projectId: project.id,
        shotId: 'clip_1',
        expectedRevision: project.revision,
        sourcePath: '/chosen/reference.png',
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      harness.service.detachBriefReference({
        projectId: project.id,
        assetId: 'reference_1',
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    await expect(
      harness.service.persistCapturedPoster({
        projectId: project.id,
        shotId: 'clip_1',
        videoAssetId: 'video_1',
        dataUrl: `data:image/png;base64,${png.toString('base64')}`,
        width: 1280,
        height: 720,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
  });

  it.each([
    ['invalid dimensions', { width: 0, dataUrl: 'data:image/png;base64,iVBORw0KGgo=' }],
    ['invalid data URL', { width: 1280, dataUrl: 'data:image/jpeg;base64,iVBORw0KGgo=' }],
    ['non-canonical base64', { width: 1280, dataUrl: 'data:image/png;base64,AAAA====' }],
  ])('rejects a captured poster with %s before media storage', async (_label, override) => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.persistCapturedPoster({
        projectId: project.id,
        shotId: 'clip_1',
        videoAssetId: 'video_1',
        width: override.width,
        height: 720,
        dataUrl: override.dataUrl,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.persistCapturedPosterV2).not.toHaveBeenCalled();
  });

  it('returns stale_project for a generic prepare before rate, resolver, or cache work', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const preparedSubmissionCache = new StudioPreparedSubmissionCacheV2();
    const admit = vi.spyOn(preparedSubmissionCache, 'admit');
    const harness = makeHarness(project, { preparedSubmissionCache });

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: project.revision + 1,
        originReferenceHandoffId: null,
        baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
        cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it('confirms one rejoin atomically with exact existing-predecessor extraction authority', async () => {
    const { project, take } = makeRejoinProject();
    const harness = makeHarness(project);

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: false, requiresSeedGeneration: false },
    } as never);

    expect(prepared.withCascade).toBeNull();
    expect(prepared.baseOnly).toMatchObject({
      baseItems: [{ shotId: 'clip_2', purpose: 'video_take', generationCount: 1 }],
      cascadeItems: [],
    });
    harness.extractConditioningFrameV2.mockRejectedValueOnce(new Error('fixture decoder failure'));
    harness.store.getProjectV2.mockRejectedValueOnce(new Error('fixture post-commit read failure'));

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });

    const extractionId = createStudioFrameExtractionId({
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
    });
    const committed = harness.getProject();
    expect(committed.shots.clip_2).toMatchObject({ chainBreak: 'none', seedStillId: null });
    expect(committed.undoHistory).toEqual(project.undoHistory);
    expect(committed.frameExtractions[extractionId]).toMatchObject({
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      status: 'pending',
    });
    expect(committed.spendAuthorizations).toHaveLength(1);
    expect(Object.values(committed.jobs)).toEqual([
      expect.objectContaining({
        shotId: 'clip_2',
        status: 'waiting_for_conditioning',
        requestPlan: {
          kind: 'after_take_selection',
          template: expect.any(Object),
          dependency: {
            kind: 'existing_predecessor',
            predecessorShotId: 'clip_1',
            takeAssetId: take.id,
            endpointSeconds: 8,
          },
        },
      }),
    ]);
    expect(harness.extractConditioningFrameV2).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      extractionId,
    });
    expect(harness.submitShots).not.toHaveBeenCalled();
    await expect(harness.service.getWorkspaceStatus({ projectId: project.id })).resolves.toMatchObject({
      cascadeProgress: [
        {
          dependentShotId: 'clip_2',
          upstreamShotId: 'clip_1',
          eligiblePrimaryAssetIds: [take.id],
          canRetryConditioningFrame: false,
          canCancelWaiting: true,
          waitingReason: 'conditioning_frame',
        },
      ],
    });
  });

  it('rejects rejoin before commit when exact conditioning-frame storage is unavailable', async () => {
    const { project } = makeRejoinProject();
    const harness = makeHarness(project, { includeMediaStore: false });
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: false, requiresSeedGeneration: false },
    });
    const beforeConfirm = harness.getProject();

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'storage_error' });

    expect(harness.getProject()).toEqual(beforeConfirm);
    expect(harness.getProject().spendAuthorizations).toEqual([]);
    expect(harness.getProject().jobs).toEqual({});
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('repairs an unverified rejoin frame and binds the exact verified crash frontier without new spend', async () => {
    const { project, take } = makeRejoinProject();
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: false, requiresSeedGeneration: false },
    });
    harness.extractConditioningFrameV2.mockRejectedValueOnce(new Error('fixture first repair failure'));
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.baseOnly.id,
      expectedRevision: project.revision,
    });

    const extractionId = createStudioFrameExtractionId({
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
    });
    const frameAsset: StudioAssetV2 = {
      id: 'frame_rejoin_1',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'conditioningFrames', fileName: 'frame_rejoin_1.png' },
      byteSize: 15,
      sha256: 'f'.repeat(64),
      createdAt: '2026-08-17T00:00:02.000Z',
    };
    const ready = harness.getProject();
    ready.assets[frameAsset.id] = frameAsset;
    ready.shots.clip_1!.assetIds.push(frameAsset.id);
    ready.frameExtractions[extractionId] = {
      ...ready.frameExtractions[extractionId]!,
      frameAssetId: frameAsset.id,
      status: 'ready',
      errorCode: null,
    };
    harness.setProject(ready);
    harness.extractConditioningFrameV2.mockClear();
    harness.extractConditioningFrameV2.mockResolvedValueOnce(structuredClone(ready.frameExtractions[extractionId]!));
    harness.verifyConditioningFrameV2.mockResolvedValueOnce(null).mockResolvedValueOnce({
      extractionId,
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      frameAssetId: frameAsset.id,
      byteSize: frameAsset.byteSize,
      sha256: frameAsset.sha256,
    });
    const waitingJob = Object.values(ready.jobs)[0]!;

    await expect(
      harness.service.retryConditioningFrame({
        projectId: project.id,
        expectedRevision: ready.revision,
        dependentShotId: 'clip_2',
      })
    ).resolves.toMatchObject({ cascadeProgress: [] });
    expect(harness.extractConditioningFrameV2).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      extractionId,
    });
    expect(harness.getProject().frameExtractions[extractionId]).toMatchObject({
      status: 'ready',
      frameAssetId: frameAsset.id,
    });
    expect(harness.getProject().jobs[waitingJob.id]).toMatchObject({
      status: 'queued_local',
      requestSnapshot: {
        conditioningInput: {
          kind: 'predecessor_frame',
          predecessorShotId: 'clip_1',
          takeAssetId: take.id,
          frameAssetId: frameAsset.id,
          endpointSeconds: 8,
        },
      },
    });
    expect(harness.submitShots).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      jobIds: [waitingJob.id],
    });

    harness.setProject(ready);
    harness.store.updateProjectV2.mockClear();
    harness.extractConditioningFrameV2.mockClear();
    harness.submitShots.mockClear();
    harness.verifyConditioningFrameV2.mockReset().mockResolvedValueOnce({
      extractionId,
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      frameAssetId: frameAsset.id,
      byteSize: frameAsset.byteSize,
      sha256: frameAsset.sha256,
    });
    const authorizationCount = ready.spendAuthorizations.length;
    const jobIds = Object.keys(ready.jobs);
    await expect(
      harness.service.retryConditioningFrame({
        projectId: project.id,
        expectedRevision: ready.revision,
        dependentShotId: 'clip_2',
      })
    ).resolves.toMatchObject({ cascadeProgress: [] });
    expect(harness.extractConditioningFrameV2).not.toHaveBeenCalled();
    expect(harness.getProject().spendAuthorizations).toHaveLength(authorizationCount);
    expect(Object.keys(harness.getProject().jobs)).toEqual(jobIds);
    expect(harness.getProject().jobs[waitingJob.id]).toMatchObject({ status: 'queued_local' });
    expect(harness.submitShots).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      jobIds: [waitingJob.id],
    });

    const wrongAuthority = structuredClone(ready);
    const wrongPlan = wrongAuthority.jobs[waitingJob.id]!.requestPlan;
    if (wrongPlan.kind !== 'after_take_selection' || wrongPlan.dependency.kind !== 'existing_predecessor') {
      throw new Error('invalid ready-frame test fixture');
    }
    wrongPlan.dependency.endpointSeconds = 7;
    harness.setProject(wrongAuthority);
    harness.store.updateProjectV2.mockClear();
    harness.verifyConditioningFrameV2.mockClear();
    await expect(
      harness.service.retryConditioningFrame({
        projectId: project.id,
        expectedRevision: wrongAuthority.revision,
        dependentShotId: 'clip_2',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.getProject()).toEqual(wrongAuthority);
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.verifyConditioningFrameV2).not.toHaveBeenCalled();
  });

  it.each([
    ['pins the exact reusable seed', true],
    ['keeps the seed null until the authorized output is selected', false],
  ])('confirms one mandatory sever graph and %s', async (_label, reuseSeed) => {
    const project = makeContinuityProject('none');
    if (reuseSeed) {
      const seed: StudioAssetV2 = {
        id: 'seed_sever_2',
        projectId: project.id,
        shotId: 'clip_2',
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'imports', fileName: 'seed_sever_2.png' },
        byteSize: 20,
        sha256: 'e'.repeat(64),
        createdAt: '2026-08-17T00:00:01.000Z',
      };
      project.assets[seed.id] = seed;
      project.shots.clip_2!.assetIds.push(seed.id);
    }
    const harness = makeHarness(project);
    const beforePrepare = harness.getProject();

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: true, requiresSeedGeneration: !reuseSeed },
    });

    expect(harness.getProject()).toEqual(beforePrepare);
    expect(prepared.withCascade).toBeNull();
    expect(prepared.baseOnly.baseItems.map(({ purpose, generationCount }) => [purpose, generationCount])).toEqual(
      reuseSeed
        ? [['video_take', 1]]
        : [
            ['seed_still', 1],
            ['video_take', 1],
          ]
    );

    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.baseOnly.id,
      expectedRevision: project.revision,
    });

    const committed = harness.getProject();
    expect(committed.shots.clip_2).toMatchObject({
      chainBreak: 'hard_cut',
      seedStillId: reuseSeed ? 'seed_sever_2' : null,
    });
    expect(committed.undoHistory).toEqual(project.undoHistory);
    expect(committed.spendAuthorizations).toEqual([
      expect.objectContaining({
        id: prepared.baseOnly.id,
        baseItems: expect.any(Array),
        cascadeItems: [],
      }),
    ]);
    expect(Object.values(committed.jobs).map(({ purpose, status }) => [purpose, status])).toEqual(
      reuseSeed
        ? [['video_take', 'queued_local']]
        : [
            ['seed_still', 'queued_local'],
            ['video_take', 'waiting_for_conditioning'],
          ]
    );
    expect(harness.submitShots).toHaveBeenCalledTimes(1);
    expect(harness.extractConditioningFrameV2).not.toHaveBeenCalled();
  });

  it('leaves a failed continuity commit byte-identical, then consumes the sole quote exactly once', async () => {
    const project = makeContinuityProject('none');
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: true, requiresSeedGeneration: true },
    });
    const beforeConfirm = harness.getProject();
    harness.store.confirmProjectV2.mockRejectedValueOnce(new Error('fixture persistence failure'));

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toThrow('fixture persistence failure');
    expect(harness.getProject()).toEqual(beforeConfirm);
    expect(harness.submitShots).not.toHaveBeenCalled();

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    expect(harness.getProject().spendAuthorizations).toHaveLength(1);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
    expect(harness.getProject().spendAuthorizations).toHaveLength(1);
  });

  it('leaves stale and expired continuity confirmations byte-identical', async () => {
    const staleProject = makeContinuityProject('none');
    const staleHarness = makeHarness(staleProject);
    const stalePrepared = await staleHarness.service.prepareSubmission({
      projectId: staleProject.id,
      expectedRevision: staleProject.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: true, requiresSeedGeneration: true },
    });
    const concurrentlyChanged = {
      ...staleHarness.getProject(),
      revision: staleProject.revision + 1,
      name: 'Concurrent durable edit',
    };
    staleHarness.setProject(concurrentlyChanged);

    await expect(
      staleHarness.service.confirmSubmission({
        projectId: staleProject.id,
        quoteId: stalePrepared.baseOnly.id,
        expectedRevision: staleProject.revision,
      })
    ).rejects.toThrow();
    expect(staleHarness.getProject()).toEqual(concurrentlyChanged);
    expect(staleHarness.submitShots).not.toHaveBeenCalled();

    let nowMs = Date.parse('2026-08-17T00:00:00.000Z');
    const expiringCache = new StudioPreparedSubmissionCacheV2({ now: () => nowMs });
    const expiringProject = makeContinuityProject('none');
    const expiringHarness = makeHarness(expiringProject, { preparedSubmissionCache: expiringCache });
    const expiredPrepared = await expiringHarness.service.prepareSubmission({
      projectId: expiringProject.id,
      expectedRevision: expiringProject.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: true, requiresSeedGeneration: true },
    });
    const beforeExpiredConfirm = expiringHarness.getProject();
    nowMs += STUDIO_PREPARED_QUOTE_TTL_SECONDS * 1_000 + 1;

    await expect(
      expiringHarness.service.confirmSubmission({
        projectId: expiringProject.id,
        quoteId: expiredPrepared.baseOnly.id,
        expectedRevision: expiringProject.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
    expect(expiringHarness.getProject()).toEqual(beforeExpiredConfirm);
    expect(expiringHarness.submitShots).not.toHaveBeenCalled();
  });

  it('maps a missing base route to invalid_route before rate, resolver, or cache work', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = null;
    project.videoRouteId = videoRoute.choiceId;
    const preparedSubmissionCache = new StudioPreparedSubmissionCacheV2();
    const admit = vi.spyOn(preparedSubmissionCache, 'admit');
    const harness = makeHarness(project, { preparedSubmissionCache });

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: project.revision,
        originReferenceHandoffId: null,
        baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
        cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it('keeps and confirms the base option when only cascade binding availability changes', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const unavailableVideoRoute = {
      ...structuredClone(videoRoute),
      constraints: { ...structuredClone(videoRoute.constraints), supportsFirstFrame: false },
    };
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [structuredClone(imageRoute), unavailableVideoRoute],
      diagnostics: [],
      generationCatalogVersion: 'catalog_video_unavailable',
    });

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });

    expect(prepared.baseOnly).toMatchObject({
      id: 'quote_service_1',
      lowerMinorUnits: 3,
      upperMinorUnits: 3,
    });
    expect(prepared.withCascade).toBeNull();
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledTimes(2);
    expect(harness.getProject().spendAuthorizations[0]).toMatchObject({
      baseItems: [{ purpose: 'seed_still' }],
      cascadeItems: [],
    });
  });

  it('confirms an unchanged base when a previously absent cascade route becomes available', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    harness.loadRateCard.mockImplementation(async (generation) => createConfiguredStudioRateCardV2(generation));
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [structuredClone(imageRoute)],
      diagnostics: [],
      generationCatalogVersion: 'catalog_without_video',
    });

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    expect(prepared.withCascade).toBeNull();

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
  });

  it('confirms an unchanged base when a previously available cascade route disappears', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    harness.loadRateCard.mockImplementation(async (generation) => createConfiguredStudioRateCardV2(generation));

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    expect(prepared.withCascade).not.toBeNull();
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [structuredClone(imageRoute)],
      diagnostics: [],
      generationCatalogVersion: 'catalog_without_video',
    });

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
  });

  it('stales a base confirmation when its selected base rate changes', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    harness.loadRateCard.mockResolvedValueOnce(
      createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 4,
        },
        {
          routeId: videoRoute.choiceId,
          kind: 'video',
          currency: 'USD',
          rateUnit: 'second',
          rateMinorUnits: 5,
        },
      ])
    );

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.getProject()).toEqual(project);
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('ignores a cascade-only rate change for base confirmation', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    harness.loadRateCard.mockResolvedValueOnce(
      createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
        {
          routeId: videoRoute.choiceId,
          kind: 'video',
          currency: 'USD',
          rateUnit: 'second',
          rateMinorUnits: 7,
        },
      ])
    );

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
  });

  it('stales a cascade confirmation when its cascade rate changes', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    harness.loadRateCard.mockResolvedValueOnce(
      createStudioRateCardV2([
        {
          routeId: imageRoute.choiceId,
          kind: 'image',
          currency: 'USD',
          rateUnit: 'generation',
          rateMinorUnits: 3,
        },
        {
          routeId: videoRoute.choiceId,
          kind: 'video',
          currency: 'USD',
          rateUnit: 'second',
          rateMinorUnits: 7,
        },
      ])
    );

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.withCascade!.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.getProject()).toEqual(project);
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('prepares sanitized base and cascade quotes, then durably commits the selected graph before dispatch', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });

    expect(prepared.baseOnly).toMatchObject({
      id: 'quote_service_1',
      projectId: project.id,
      projectRevision: project.revision,
      currency: 'USD',
      lowerMinorUnits: 3,
      upperMinorUnits: 3,
      budget: { kind: 'no_policy' },
    });
    expect(prepared.withCascade).toMatchObject({
      id: 'quote_service_2',
      lowerMinorUnits: 28,
      upperMinorUnits: 28,
      baseItems: [{ purpose: 'seed_still', requestedTotalMinorUnits: 3 }],
      cascadeItems: [{ purpose: 'video_take', generationCount: 1, requestedTotalMinorUnits: 25 }],
    });
    const rendererItem = prepared.withCascade!.cascadeItems[0]!;
    expect(Object.keys(rendererItem).toSorted()).toEqual([
      'durationSeconds',
      'generationCount',
      'oneGenerationMinorUnits',
      'purpose',
      'requestedTotalMinorUnits',
      'route',
      'shotId',
    ]);
    expect(rendererItem).not.toHaveProperty('requestPlan');
    expect(rendererItem).not.toHaveProperty('authorizationItemId');

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.withCascade!.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });

    const committed = harness.getProject();
    expect(committed.spendAuthorizations).toHaveLength(1);
    expect(committed.spendAuthorizations[0]).toMatchObject({
      id: prepared.withCascade!.id,
      baseItems: [{ purpose: 'seed_still', generationCount: 1 }],
      cascadeItems: [{ purpose: 'video_take', generationCount: 1 }],
      providerBindings: [
        { provider: { adapterId: 'weprompt-image-v1' } },
        { provider: { adapterId: 'openrouter-video-v1' } },
      ],
    });
    expect(
      Object.values(committed.jobs).map(({ status, purpose, requestSnapshot }) => ({
        status,
        purpose,
        requestSnapshot: requestSnapshot === null ? null : requestSnapshot.conditioningInput,
      }))
    ).toEqual([
      { status: 'queued_local', purpose: 'seed_still', requestSnapshot: null },
      { status: 'waiting_for_conditioning', purpose: 'video_take', requestSnapshot: null },
    ]);
    expect(harness.submitShots).toHaveBeenCalledWith({ projectId: project.id, jobIds: ['job_service_1'] });
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('projects exact-one quote rows and preserves their totals and budget in durable authority', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    project.spendPolicy = { currency: 'USD', maxPerBatchMinorUnits: 112 };
    const harness = makeHarness(project);

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    const baseRow = {
      shotId: 'clip_1',
      purpose: 'seed_still' as const,
      route: { choiceId: imageRoute.choiceId, providerId: 'provider_1', model: 'image-model' },
      generationCount: 1,
      durationSeconds: null,
      oneGenerationMinorUnits: 3,
      requestedTotalMinorUnits: 3,
    };
    const cascadeRow = {
      shotId: 'clip_1',
      purpose: 'video_take' as const,
      route: { choiceId: videoRoute.choiceId, providerId: 'provider_1', model: 'video-model' },
      generationCount: 1,
      durationSeconds: 5,
      oneGenerationMinorUnits: 25,
      requestedTotalMinorUnits: 25,
    };
    const budget = { kind: 'within_cap' as const, policyCurrency: 'USD', maxPerBatchMinorUnits: 112 };

    expect(prepared).toEqual({
      baseOnly: {
        id: 'quote_service_1',
        projectId: project.id,
        projectRevision: project.revision,
        expiresAt: '2026-08-17T00:05:02.000Z',
        currency: 'USD',
        baseItems: [baseRow],
        cascadeItems: [],
        lowerMinorUnits: 3,
        upperMinorUnits: 3,
        budget,
      },
      withCascade: {
        id: 'quote_service_2',
        projectId: project.id,
        projectRevision: project.revision,
        expiresAt: '2026-08-17T00:05:02.000Z',
        currency: 'USD',
        baseItems: [baseRow],
        cascadeItems: [cascadeRow],
        lowerMinorUnits: 28,
        upperMinorUnits: 28,
        budget,
      },
    });

    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.withCascade!.id,
      expectedRevision: project.revision,
    });
    expect(harness.getProject().spendAuthorizations).toEqual([
      expect.objectContaining({
        id: prepared.withCascade!.id,
        lowerMinorUnits: prepared.withCascade!.lowerMinorUnits,
        upperMinorUnits: prepared.withCascade!.upperMinorUnits,
        baseItems: [
          expect.objectContaining({
            shotId: baseRow.shotId,
            purpose: baseRow.purpose,
            routeId: baseRow.route.choiceId,
            generationCount: baseRow.generationCount,
            rateUnit: 'generation',
            rateMinorUnits: baseRow.oneGenerationMinorUnits,
          }),
        ],
        cascadeItems: [
          expect.objectContaining({
            shotId: cascadeRow.shotId,
            purpose: cascadeRow.purpose,
            routeId: cascadeRow.route.choiceId,
            generationCount: cascadeRow.generationCount,
            rateUnit: 'second',
            rateMinorUnits: 5,
          }),
        ],
      }),
    ]);
  });

  it('rejects reference origins before resolver work and projects spend-policy refusal without mutating', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    project.spendPolicy = { currency: 'USD', maxPerBatchMinorUnits: 2 };
    const harness = makeHarness(project);

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: project.revision,
        originReferenceHandoffId: 'handoff_not_enabled_yet',
        baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
        cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    expect(prepared.baseOnly.budget).toEqual({
      kind: 'over_cap',
      policyCurrency: 'USD',
      maxPerBatchMinorUnits: 2,
    });
    harness.providerResolver.listGenerationRoutes.mockClear();
    harness.loadRateCard.mockClear();
    harness.providerResolver.listGenerationRoutes.mockImplementation(async () => {
      throw new Error('resolver reached by refused confirmation');
    });
    harness.loadRateCard.mockImplementation(async () => {
      throw new Error('rate card reached by refused confirmation');
    });
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.getProject()).toEqual(project);
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
  });

  it('refuses a changed prepared cancellation policy and releases the quote for exact revalidation', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [{ ...structuredClone(imageRoute), cancellationPolicy: 'queued_only' }],
      diagnostics: [],
      generationCatalogVersion: 'catalog_policy_changed',
    });

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.getProject()).toEqual(project);
    expect(harness.submitShots).not.toHaveBeenCalled();

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
  });

  it('carries acknowledged submission-unknown lineage only into the next reviewed confirmation', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const first = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: first.baseOnly.id,
      expectedRevision: project.revision,
    });
    const ambiguous = harness.getProject();
    const predecessor = ambiguous.jobs.job_service_1!;
    predecessor.status = 'failed';
    predecessor.error = { code: 'submission_unknown', messageKey: 'submissionUnknown' };
    harness.setProject(ambiguous);

    const retry = await harness.service.prepareSubmission({
      projectId: ambiguous.id,
      expectedRevision: ambiguous.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    await harness.service.confirmSubmission({
      projectId: ambiguous.id,
      quoteId: retry.baseOnly.id,
      expectedRevision: ambiguous.revision,
    });

    const committedRetry = harness.getProject();
    expect(committedRetry.jobs).toMatchObject({
      job_service_1: {
        status: 'failed',
        retryOfJobId: null,
        retryReason: null,
        duplicateChargeAcknowledged: false,
        duplicateChargeAcknowledgedAt: null,
      },
      job_service_2: {
        retryOfJobId: 'job_service_1',
        retryReason: 'submission_unknown',
        duplicateChargeAcknowledged: true,
        duplicateChargeAcknowledgedAt: '2026-08-17T00:00:02.000Z',
      },
    });
    expect(validateStudioProjectV2(committedRetry)).toBe(true);
  });

  it('binds the exact-one waiting video only after the generated seed is explicitly selected', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.withCascade!.id,
      expectedRevision: project.revision,
    });

    const paid = harness.getProject();
    const seedJob = Object.values(paid.jobs).find((job) => job.purpose === 'seed_still')!;
    const seedAsset: StudioAssetV2 = {
      id: 'seed_generated',
      projectId: paid.id,
      shotId: 'clip_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'seed_generated.png' },
      byteSize: 8,
      sha256: 'c'.repeat(64),
      createdAt: '2026-08-17T00:00:02.000Z',
    };
    paid.assets[seedAsset.id] = seedAsset;
    paid.shots.clip_1.assetIds.push(seedAsset.id);
    const unrelatedSeedAsset: StudioAssetV2 = {
      id: 'seed_unrelated_import',
      projectId: paid.id,
      shotId: 'clip_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'seed_unrelated_import.png' },
      byteSize: 8,
      sha256: 'd'.repeat(64),
      createdAt: '2026-08-17T00:00:02.000Z',
    };
    paid.assets[unrelatedSeedAsset.id] = unrelatedSeedAsset;
    paid.shots.clip_1.assetIds.push(unrelatedSeedAsset.id);
    seedJob.status = 'succeeded';
    seedJob.providerJobId = 'remote_seed';
    seedJob.outputAssetIds = [seedAsset.id];
    seedJob.outputAssetIdsByRole = { primary: seedAsset.id, poster: null };
    seedJob.spendReceipt = {
      authorizationId: seedJob.authorizationId,
      itemId: seedJob.authorizationItemId,
      jobId: seedJob.id,
      purpose: 'seed_still',
      routeId: imageRoute.choiceId,
      currency: 'USD',
      rateUnit: 'generation',
      rateMinorUnits: 3,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: 3,
    };
    harness.setProject(paid);
    harness.submitShots.mockClear();

    const beforeRejectedSelection = harness.getProject();
    await expect(
      harness.service.applyMutations(
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          projectId: paid.id,
          expectedRevision: paid.revision,
          operations: [{ kind: 'set_seed_still', shotId: 'clip_1', assetId: unrelatedSeedAsset.id }],
        },
        { mutationId: 'reject_unrelated_seed', capturedAt: '2026-08-17T00:00:03.000Z' }
      )
    ).rejects.toMatchObject({ name: 'StudioMutationErrorV2', reasonCode: 'dependency_blocked' });
    expect(harness.getProject()).toEqual(beforeRejectedSelection);
    expect(harness.getProject().shots.clip_1.seedStillId).toBeNull();
    expect(harness.submitShots).not.toHaveBeenCalled();

    await harness.service.applyMutations(
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: paid.id,
        expectedRevision: paid.revision,
        operations: [{ kind: 'set_seed_still', shotId: 'clip_1', assetId: seedAsset.id }],
      },
      { mutationId: 'select_exact_seed', capturedAt: '2026-08-17T00:00:03.000Z' }
    );

    const bound = harness.getProject();
    const videoJobs = Object.values(bound.jobs).filter((job) => job.purpose === 'video_take');
    expect(videoJobs).toHaveLength(1);
    expect(videoJobs.every((job) => job.status === 'queued_local')).toBe(true);
    expect(videoJobs.map((job) => job.requestSnapshot?.conditioningInput)).toEqual([
      { kind: 'seed_still', assetId: seedAsset.id },
    ]);
    expect(harness.submitShots).toHaveBeenCalledWith({
      projectId: paid.id,
      jobIds: videoJobs.map((job) => job.id),
    });
  });

  it('cancels an exact unbound item without provider cancellation and exposes only sanitized progress', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ shotId: 'clip_1', purpose: 'seed_still', referenceAssetId: null }],
      cascadeChoices: [{ shotId: 'clip_1', purpose: 'video_take', referenceAssetId: null }],
    });
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.withCascade!.id,
      expectedRevision: project.revision,
    });
    const paid = harness.getProject();

    const status = await harness.service.cancelWaitingCascade({
      projectId: paid.id,
      expectedRevision: paid.revision,
      dependentShotId: 'clip_1',
    });

    expect(Object.values(harness.getProject().jobs).filter((job) => job.purpose === 'video_take')).toEqual(
      expect.arrayContaining([expect.objectContaining({ status: 'cancelled', spendReceipt: null })])
    );
    expect(harness.cancelJobV2).not.toHaveBeenCalled();
    expect(status.cascadeProgress).toEqual([
      expect.objectContaining({ dependentShotId: 'clip_1', waitingReason: 'cancelled' }),
    ]);
    expect(status.cascadeProgress[0]).not.toHaveProperty('authorizationId');
    expect(status.cascadeProgress[0]).not.toHaveProperty('jobId');
  });

  it('projects workspace and chain status through exact read-only service seams', async () => {
    const project = makeSchema2ServiceProject();
    project.undoHistory = [{ id: 'undo_top', sourceRevision: project.revision, label: 'edit_shot', patches: [] }];
    const harness = makeHarness(project);

    const workspace = await harness.service.getWorkspaceStatus({ projectId: project.id });
    const chain = await harness.service.getChainStatus({ projectId: project.id });

    expect(workspace).toMatchObject({
      projectId: project.id,
      projectRevision: project.revision,
      undoTop: { entryId: 'undo_top', label: 'edit_shot' },
      cascadeProgress: [],
    });
    expect(Object.keys(workspace).toSorted()).toEqual([
      'cascadeProgress',
      'currentVideoJobs',
      'dirtyShots',
      'parkEligibility',
      'projectId',
      'projectRevision',
      'undoTop',
    ]);
    expect(chain).toEqual({
      projectId: project.id,
      projectRevision: project.revision,
      conditioningFailures: [],
      boundaries: [],
    });
    expect(workspace.currentVideoJobs).toEqual([
      { shotId: 'clip_1', jobIds: [] },
      { shotId: 'clip_2', jobIds: [] },
    ]);
    expect(harness.verifyConditioningFrameV2).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    await expect(
      harness.service.getWorkspaceStatus({ projectId: project.id, revision: project.revision } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('marks a ready chain frame on disk only after exact media verification and otherwise fails closed', async () => {
    const project = makeSchema2ServiceProject();
    project.beats.section_1!.shotOrder = ['clip_1', 'clip_2'];
    project.beats.section_2!.shotOrder = [];
    project.shots.clip_2!.chainBreak = 'none';
    const take: StudioAssetV2 = {
      id: 'take_chain_1',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'take_chain_1.mp4' },
      byteSize: 100,
      sha256: 'c'.repeat(64),
      durationSeconds: 10,
      createdAt: '2026-08-17T00:00:01.000Z',
    };
    const frame: StudioAssetV2 = {
      id: 'frame_chain_1',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'conditioningFrames', fileName: 'frame_chain_1.png' },
      byteSize: 25,
      sha256: 'd'.repeat(64),
      createdAt: '2026-08-17T00:00:02.000Z',
    };
    Object.assign(project.assets, { [take.id]: take, [frame.id]: frame });
    project.shots.clip_1!.assetIds.push(take.id, frame.id);
    project.shots.clip_1!.videoAssetId = take.id;
    const extractionId = createStudioFrameExtractionId({
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 10,
    });
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 10,
      frameAssetId: frame.id,
      status: 'ready',
      errorCode: null,
    };
    const verifyConditioningFrameV2 = vi.fn<StudioMediaStore['verifyConditioningFrameV2']>(async () => ({
      extractionId,
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 10,
      frameAssetId: frame.id,
      byteSize: frame.byteSize,
      sha256: frame.sha256,
    }));
    const harness = makeHarness(project, { verifyConditioningFrameV2 });

    await expect(harness.service.getChainStatus({ projectId: project.id })).resolves.toMatchObject({
      boundaries: [
        {
          upstreamShotId: 'clip_1',
          dependentShotId: 'clip_2',
          status: 'on_disk',
          frameAssetId: frame.id,
        },
      ],
    });
    expect(verifyConditioningFrameV2).toHaveBeenCalledWith({ projectId: project.id, extractionId });

    verifyConditioningFrameV2.mockRejectedValueOnce(new Error('media unavailable'));
    await expect(harness.service.getChainStatus({ projectId: project.id })).resolves.toMatchObject({
      boundaries: [{ status: 'gone', frameAssetId: null }],
    });
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
  });
});

const editableBeatV2 = () => ({
  title: 'Opening',
  action: 'Introduce the product',
  look: 'Warm sunrise over a quiet city',
  targetSeconds: null,
});

const editableShotV2 = () => ({
  line: 'A wide establishing shot',
  narration: '',
  onScreenText: '',
  durationSeconds: 5,
});

const mutationCatalogV2 = (): StudioMutationOperationV2[] => [
  { kind: 'edit_project', changes: { name: 'A sharper launch film' } },
  { kind: 'set_brief', brief: 'A concise launch story' },
  {
    kind: 'set_rules',
    rules: [{ id: 'rule_1', text: 'Avoid competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['logo'] } }],
  },
  { kind: 'add_beat', beatId: 'section_new', beat: editableBeatV2(), beforeBeatId: null },
  { kind: 'edit_beat', beatId: 'section_1', changes: { targetSeconds: 12 } },
  { kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] },
  { kind: 'park_beat', beatId: 'section_1' },
  { kind: 'restore_beat', beatId: 'section_1', beforeBeatId: null },
  { kind: 'add_binned_beat', beatId: 'section_binned', beat: editableBeatV2() },
  { kind: 'add_shot', beatId: 'section_1', shotId: 'clip_new', shot: editableShotV2(), beforeShotId: null },
  { kind: 'edit_shot', shotId: 'clip_1', changes: { line: 'A tighter opening' } },
  { kind: 'delete_shot', shotId: 'clip_2' },
  { kind: 'park_shot', shotId: 'clip_1' },
  { kind: 'restore_shot', shotId: 'clip_1', beforeShotId: null },
  { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_2', 'clip_1'] },
  {
    kind: 'apply_coverage',
    beatId: 'section_1',
    shots: [
      {
        shotId: 'clip_coverage',
        line: 'A proposed coverage row',
        narration: '',
        onScreenText: '',
        durationSeconds: 5,
        chainBreak: 'none',
      },
    ],
    fixedShots: [{ shotId: 'clip_fixed', reasons: ['owned_asset', 'video_asset', 'on_screen_text'] }],
  },
  { kind: 'set_hard_cut', shotId: 'clip_1', hardCut: true },
  { kind: 'set_seed_still', shotId: 'clip_1', assetId: 'asset_seed' },
  { kind: 'trim_shot', shotId: 'clip_1', trimInSeconds: 0, trimOutSeconds: 4.5 },
  { kind: 'redetach_line', shotId: 'clip_1', line: 'A human-authored line' },
  { kind: 'rederive_line', shotId: 'clip_1', line: 'A reviewed derived line' },
  { kind: 'restore_line', shotId: 'clip_1', historyEntryId: 'history_1' },
  {
    kind: 'reorder_bin',
    bin: [
      { kind: 'beat', beatId: 'section_2', reason: 'lifted' },
      { kind: 'shot', beatId: 'section_1', shotId: 'clip_2', reason: 'lifted' },
    ],
  },
  { kind: 'set_routes', imageRouteId: 'image_route', videoRouteId: 'video_route' },
  { kind: 'set_spend_policy', policy: { currency: 'USD', maxPerBatchMinorUnits: 5_000 } },
  { kind: 'set_bed', assetId: 'bed_1' },
  { kind: 'undo_last', entryId: 'undo_1' },
];

const capturePendingProjectAuthorityV2 = async (projectRoot: string) => {
  const canonicalRoot = await nodeFs.realpath(projectRoot);
  const stats = await nodeFs.lstat(canonicalRoot);
  return { canonicalRoot, rootIdentity: { dev: stats.dev, ino: stats.ino } };
};

const REFERENCE_WRITER_PROJECT_ID_V2 = 'project_v2';
const REFERENCE_WRITER_NOW_MS_V2 = Date.parse('2026-08-19T12:00:00.000Z');

const referenceRequestRecordV2 = (
  requestId: string,
  shotId: string,
  createdAtMs: number
): StudioReferenceRequestV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id: requestId,
  projectId: REFERENCE_WRITER_PROJECT_ID_V2,
  shotIds: [shotId],
  status: 'pending',
  createdAt: new Date(createdAtMs).toISOString(),
});

const proposalRecordV2 = (proposalId: string, createdAtMs: number): StudioProposalRecordV2 => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  id: proposalId,
  projectId: REFERENCE_WRITER_PROJECT_ID_V2,
  status: 'pending',
  baseRevision: 1,
  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: `Proposal ${proposalId}` }] },
  createdAt: new Date(createdAtMs).toISOString(),
  decidedAt: null,
});

const createSidecarFamilyV2 = async (
  projectDir: string,
  family: 'proposals' | 'reference-requests'
): Promise<{ pendingDir: string; slotsDir: string }> => {
  const familyDir = path.join(projectDir, family);
  const childNames =
    family === 'proposals'
      ? ['pending', 'decisions', 'slots', 'commits']
      : ['pending', 'decisions', 'slots', 'receipts'];
  await mkdir(familyDir);
  await Promise.all(childNames.map((childName) => mkdir(path.join(familyDir, childName))));
  return { pendingDir: path.join(familyDir, 'pending'), slotsDir: path.join(familyDir, 'slots') };
};

const createReferenceWriterQueueV2 = async () => {
  const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-reference-writer-v2-'));
  const { pendingDir, slotsDir } = await createSidecarFamilyV2(projectDir, 'reference-requests');
  return {
    projectDir,
    pendingDir,
    slotsDir,
    projectAuthority: await capturePendingProjectAuthorityV2(projectDir),
  };
};

const createPendingQueueFixtureV2 = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-boundary-'));
  const { pendingDir, slotsDir } = await createSidecarFamilyV2(projectRoot, 'reference-requests');
  return { projectRoot, pendingDir, slotsDir };
};

const createProposalQueueFixtureV2 = async () => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), 'studio-proposal-v2-boundary-'));
  const { pendingDir, slotsDir } = await createSidecarFamilyV2(projectRoot, 'proposals');
  return { projectRoot, pendingDir, slotsDir };
};

const pendingRequestInputV2 = (pendingDir: string, recordId = 'request_boundary') => ({
  pendingDir,
  recordId,
  record: { marker: recordId },
  slotRecordKey: 'requestId' as const,
  capacityMessage: 'full',
  tooLargeMessage: 'too large',
});

const referenceDecisionV2 = (
  requestId: string,
  outcome: { kind: 'rejected' } | { kind: 'generation_gate'; handoffId: string; shotIds: string[] }
) => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  requestId,
  projectId: REFERENCE_WRITER_PROJECT_ID_V2,
  decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2 + 1_000).toISOString(),
  outcome,
});

const referenceReceiptV2 = (requestId: string, handoffId: string) => ({
  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
  handoffId,
  requestId,
  completedAt: new Date(REFERENCE_WRITER_NOW_MS_V2 + 2_000).toISOString(),
  result: { kind: 'dismissed' as const },
});

const stageReadyReferenceRequestV2 = async (
  pendingDir: string,
  requestId: string
): Promise<{ canonicalFile: string; readyFile: string; temporaryFile: string }> => {
  const canonicalFile = path.join(pendingDir, `${requestId}.json`);
  const temporaryFile = `${canonicalFile}.12345_1.tmp`;
  const readyFile = `${canonicalFile}.12345_1.ready`;
  await writeFile(
    temporaryFile,
    JSON.stringify(referenceRequestRecordV2(requestId, 'shot_existing', REFERENCE_WRITER_NOW_MS_V2))
  );
  await nodeFs.link(temporaryFile, readyFile);
  return { canonicalFile, readyFile, temporaryFile };
};

const stageReadyProposalV2 = async (
  pendingDir: string,
  proposalId: string
): Promise<{ canonicalFile: string; readyFile: string; temporaryFile: string }> => {
  const canonicalFile = path.join(pendingDir, `${proposalId}.json`);
  const temporaryFile = `${canonicalFile}.12345_1.tmp`;
  const readyFile = `${canonicalFile}.12345_1.ready`;
  await writeFile(temporaryFile, JSON.stringify(proposalRecordV2(proposalId, REFERENCE_WRITER_NOW_MS_V2)));
  await nodeFs.link(temporaryFile, readyFile);
  return { canonicalFile, readyFile, temporaryFile };
};

const addGeneratedVideosForMcpV2 = (project: StudioProjectV2, count: number): void => {
  const shot = project.shots.clip_1!;
  const seed: StudioAssetV2 = {
    id: 'seed_clip_1',
    projectId: project.id,
    shotId: shot.id,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'imports', fileName: 'seed_clip_1.png' },
    byteSize: 1,
    sha256: 'c'.repeat(64),
    createdAt: '2026-08-17T00:00:00.000Z',
  };
  project.assets[seed.id] = seed;
  shot.assetIds.push(seed.id);
  shot.seedStillId = seed.id;
  project.videoRouteId = 'video_route';
  const provider = {
    providerId: 'provider_1',
    adapterId: 'openrouter-video-v1',
    model: 'model_1',
  } as const;
  let created = 0;
  while (created < count) {
    const ordinal = created + 1;
    const authorizationOrdinal = project.spendAuthorizations.length + 1;
    const projectRevision = project.revision;
    const itemId = createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision,
      shotId: shot.id,
      purpose: 'video_take',
    });
    const requestPlan = {
      kind: 'resolved' as const,
      snapshot: {
        prompt: `Video batch ${authorizationOrdinal}`,
        aspectRatio: project.aspectRatio,
        resolution: project.resolution,
        durationSeconds: shot.durationSeconds,
        referenceInput: null,
        conditioningInput: { kind: 'seed_still' as const, assetId: seed.id },
      },
    };
    const item = {
      id: itemId,
      shotId: shot.id,
      purpose: 'video_take' as const,
      routeId: 'video_route',
      generationCount: 1,
      requestPlan,
      rateUnit: 'second' as const,
      rateMinorUnits: 2,
    };
    const totals = calculateStudioQuoteTotals([item])!;
    const authorizationId = `auth_mcp_${authorizationOrdinal}`;
    const idempotencyKey = `idem_mcp_${authorizationOrdinal}`;
    project.spendAuthorizations.push({
      id: authorizationId,
      projectId: project.id,
      projectRevision,
      originReferenceHandoffId: null,
      rateCardDigest: 'd'.repeat(64),
      currency: 'USD',
      baseItems: [item],
      cascadeItems: [],
      lowerMinorUnits: totals.lowerMinorUnits,
      upperMinorUnits: totals.upperMinorUnits,
      expiresAt: '2026-08-17T01:00:00.000Z',
      confirmedAt: '2026-08-17T00:00:01.000Z',
      providerBindings: [{ itemId, provider }],
      idempotencyKeys: [{ itemId, key: idempotencyKey }],
    });
    const assetId = `take_${String(ordinal).padStart(2, '0')}`;
    const createdAt = `2026-08-17T00:00:${String(ordinal + 1).padStart(2, '0')}.000Z`;
    const asset: StudioAssetV2 = {
      id: assetId,
      projectId: project.id,
      shotId: shot.id,
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
      byteSize: 1,
      sha256: 'a'.repeat(64),
      durationSeconds: shot.durationSeconds,
      createdAt,
    };
    const jobId = `job_mcp_${ordinal}`;
    const job: StudioJobV2 = {
      id: jobId,
      projectId: project.id,
      shotId: shot.id,
      status: 'succeeded',
      provider,
      idempotencyKey,
      providerJobId: `remote_mcp_${ordinal}`,
      remoteStartedAt: createdAt,
      cancellationPolicy: 'queued_and_running',
      outputAssetIds: [assetId],
      purpose: 'video_take',
      authorizationId,
      authorizationItemId: itemId,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: {
        authorizationId,
        itemId,
        jobId,
        purpose: 'video_take',
        routeId: 'video_route',
        currency: 'USD',
        rateUnit: 'second',
        rateMinorUnits: 2,
        durationSeconds: shot.durationSeconds,
        generationCount: 1,
        totalMinorUnits: shot.durationSeconds * 2,
      },
      outputAssetIdsByRole: { primary: assetId, poster: null },
      error: null,
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
      createdAt,
      updatedAt: createdAt,
    };
    project.assets[assetId] = asset;
    project.jobs[jobId] = job;
    shot.assetIds.push(assetId);
    shot.jobIds.push(jobId);
    if (shot.videoAssetId !== null) shot.supersededVideoAssetIds.push(shot.videoAssetId);
    shot.videoAssetId = assetId;
    created += 1;
    project.revision += 1;
  }
  project.updatedAt = '2026-08-17T00:00:59.000Z';
};

describe('Studio MCP schema-2 server', () => {
  it('reports route-catalog absence without exposing a partial catalog', async () => {
    await expect(createListRoutesHandler(null)({})).resolves.toEqual({
      content: [{ type: 'text', text: 'Creative Studio route catalog is unavailable.' }],
      isError: true,
    });
    await expect(
      createListRoutesHandler({
        projectId: 'project_v2',
        projectDir: '/unused',
        pendingDir: '/unused/proposals/pending',
        referencePendingDir: '/unused/reference-requests/pending',
        routeCatalog: null,
      })({})
    ).resolves.toMatchObject({ isError: true });
  });

  it.each(['ordinary file', 'symbolic link'] as const)(
    'refuses an %s as the configured project root',
    async (rootKind) => {
      const parentDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-unsafe-root-'));
      const realProjectDir = path.join(parentDir, 'real-project');
      const configuredProjectDir = path.join(parentDir, 'configured-project');
      await mkdir(realProjectDir);
      await writeFile(path.join(realProjectDir, 'project.json'), JSON.stringify(makeSchema2ServiceProject()));
      if (rootKind === 'ordinary file') await writeFile(configuredProjectDir, 'not a directory');
      else await nodeFs.symlink(realProjectDir, configuredProjectDir);

      try {
        const result = await createReadStoryboardHandlerV2({
          projectId: 'project_v2',
          projectDir: configuredProjectDir,
          pendingDir: path.join(configuredProjectDir, 'proposals', 'pending'),
          referencePendingDir: path.join(configuredProjectDir, 'reference-requests', 'pending'),
        })({});

        expect(result.isError).toBe(true);
        expect(result.content[0].text).toContain('unavailable');
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    }
  );

  it.each([
    ['missing manifest', null],
    ['primitive manifest', 'true'],
    ['array manifest', '[]'],
  ] as const)('refuses a %s without sidecar allocation', async (_label, manifestBytes) => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-invalid-manifest-'));
    if (manifestBytes !== null) await writeFile(path.join(projectDir, 'project.json'), manifestBytes);

    try {
      const result = await createReadStoryboardHandlerV2({
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      })({});

      expect(result.isError).toBe(true);
      await expect(readdir(projectDir)).resolves.toEqual(manifestBytes === null ? [] : ['project.json']);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['initial canonical-root proof', 2],
    ['post-read canonical-root proof', 3],
  ] as const)('rejects a directory identity change during the %s', async (_label, mismatchedRootRead) => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-root-race-'));
    const canonicalProjectDir = await nodeFs.realpath(projectDir);
    const manifest = path.join(projectDir, 'project.json');
    await writeFile(manifest, JSON.stringify(makeSchema2ServiceProject()));
    let rootReads = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'lstat') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          const stats = await nodeFs.lstat(...args);
          if (
            (String(args[0]) !== projectDir && String(args[0]) !== canonicalProjectDir) ||
            ++rootReads !== mismatchedRootRead
          ) {
            return stats;
          }
          return new Proxy(stats, {
            get(target, statsProperty, statsReceiver) {
              if (statsProperty === 'ino') return target.ino + 1;
              const value = Reflect.get(target, statsProperty, statsReceiver) as unknown;
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
        };
      },
    }) as typeof nodeFs;

    try {
      const result = await createReadStoryboardHandlerV2({
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
        fs: racingFs,
      })({});

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('unavailable');
      await expect(readFile(manifest, 'utf8')).resolves.toBe(JSON.stringify(makeSchema2ServiceProject()));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('exports and registers only the schema-2 Beat/Shot MCP surface', async () => {
    const [source, pendingWriterSource, proposalWriterSource, referenceWriterSource] = await Promise.all([
      readFile(
        path.resolve(process.cwd(), 'packages/desktop/src/process/resources/builtinMcp/studioServer.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(process.cwd(), 'packages/desktop/src/process/resources/builtinMcp/studioPendingRecordWriter.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(process.cwd(), 'packages/desktop/src/process/resources/builtinMcp/studioProposalWriter.ts'),
        'utf8'
      ),
      readFile(
        path.resolve(
          process.cwd(),
          'packages/desktop/src/process/resources/builtinMcp/studioReferenceRequestWriter.ts'
        ),
        'utf8'
      ),
    ]);
    const mainStart = source.indexOf('async function main()');
    const mainEnd = source.indexOf('// Only start the stdio loop', mainStart);

    expect(mainStart).toBeGreaterThanOrEqual(0);
    expect(mainEnd).toBeGreaterThan(mainStart);
    const productionEntrypoint = source.slice(mainStart, mainEnd);
    expect(productionEntrypoint).toContain('registerStudioToolsV2(server, config);');
    expect(productionEntrypoint).not.toContain('registerStudioTools(server, config);');
    expect(source.match(/export function registerStudioToolsV2\s*\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bregisterStudioTools\s*\(/);
    expect(source).not.toMatch(
      /\b(?:createReadStoryboardHandler|createProposeStoryboardHandler|createProposeBriefRuleHandler|createRequestReferenceImagesHandler)\s*\(/
    );
    expect(source).not.toMatch(/\b(?:StudioScene|StudioEditableScene|sceneOrder|sceneId|scenes)\b/);
    expect(pendingWriterSource).not.toMatch(/export const writePendingRecord\s*=/);
    expect(proposalWriterSource).not.toMatch(/export (?:type WriteProposalInput\s*=|const writeProposalRecord\s*=)/);
    expect(referenceWriterSource).not.toMatch(
      /export (?:type WriteReferenceRequestInput\s*=|const (?:writeReferenceRequestRecord|listPendingReferenceRequestSceneIds)\s*=)/
    );
  });

  it('publishes all Beat/Shot operations as strict bounded schemas through real MCP tools/list', async () => {
    const harness = await createStudioMcpProtocolHarnessV2();
    try {
      const { tools } = await harness.client.listTools();
      const applyEdits = tools.find((tool) => tool.name === 'studio_apply_edits');
      const applySchema = applyEdits?.inputSchema;
      const operationItems = applySchema?.properties?.operations as { items?: Record<string, unknown> } | undefined;
      const operationVariants = (operationItems?.items?.anyOf ?? operationItems?.items?.oneOf) as
        | Array<{
            additionalProperties?: boolean;
            required?: string[];
            properties?: Record<string, { const?: string; additionalProperties?: boolean }>;
          }>
        | undefined;
      const proposalSchema = tools.find((tool) => tool.name === 'propose_storyboard')?.inputSchema;
      const proposalOperationItems = proposalSchema?.properties?.operations as
        | { items?: Record<string, unknown> }
        | undefined;
      const proposalOperationVariants = (proposalOperationItems?.items?.anyOf ??
        proposalOperationItems?.items?.oneOf) as typeof operationVariants;
      const advertisedValidator = new AjvJsonSchemaValidator().getValidator(applySchema as never);
      const canonicalExample = (applyEdits?.description ?? '').match(
        /(\{"expectedRevision":8,"operations":\[[^]*\]\})\./
      )?.[1];

      expect(tools.map(({ name }) => name).toSorted()).toEqual([
        'propose_brief_rule',
        'propose_storyboard',
        'read_storyboard',
        'studio_apply_edits',
        'studio_get_command_status',
        'studio_list_routes',
        'studio_request_reference_images',
      ]);
      expect(tools.every((tool) => Object.keys(tool.inputSchema).length > 0)).toBe(true);
      expect(applySchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'operations'],
      });
      const operationKinds = mutationCatalogV2()
        .map((operation) => operation.kind)
        .toSorted();
      expect(operationKinds).toHaveLength(27);
      expect(operationVariants?.map((variant) => variant.properties?.kind?.const).toSorted()).toEqual(operationKinds);
      expect(proposalOperationVariants?.map((variant) => variant.properties?.kind?.const).toSorted()).toEqual(
        operationKinds
      );
      const addBeat = operationVariants?.find((variant) => variant.properties?.kind?.const === 'add_beat');
      const addShot = operationVariants?.find((variant) => variant.properties?.kind?.const === 'add_shot');
      expect(addBeat).toMatchObject({
        additionalProperties: false,
        required: ['kind', 'beatId', 'beat', 'beforeBeatId'],
      });
      expect(addBeat?.properties).not.toHaveProperty('firstShotId');
      expect(addBeat?.properties).not.toHaveProperty('firstShot');
      expect(addShot).toMatchObject({
        additionalProperties: false,
        required: ['kind', 'beatId', 'shotId', 'shot', 'beforeShotId'],
      });

      const canonicalBatch = {
        expectedRevision: 8,
        operations: [
          { kind: 'set_brief', brief: '...' },
          { kind: 'edit_beat', beatId: 'beat_1', changes: { title: '...' } },
          { kind: 'edit_shot', shotId: 'shot_1', changes: { line: '...' } },
          { kind: 'reorder_beats', beatOrder: ['beat_2', 'beat_1'] },
        ],
      };
      expect(advertisedValidator(canonicalBatch)).toMatchObject({ valid: true });
      expect(
        advertisedValidator({
          ...canonicalBatch,
          operations: [
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'caller_id',
              shot: editableShotV2(),
              beforeShotId: null,
            },
          ],
        })
      ).toMatchObject({ valid: true });
      expect(
        advertisedValidator({
          expectedRevision: 8,
          operations: [
            {
              kind: 'add_beat',
              beatId: 'section_new',
              beat: editableBeatV2(),
              beforeBeatId: null,
              firstShotId: 'legacy_shot',
              firstShot: editableShotV2(),
            },
          ],
        })
      ).toMatchObject({ valid: false });
      expect(canonicalExample).toBeDefined();
      expect(JSON.parse(canonicalExample ?? '{}')).toEqual(canonicalBatch);
      expect(applyEdits?.description).toMatch(/never starts paid generation/i);

      const referenceSchema = tools.find((tool) => tool.name === 'studio_request_reference_images')?.inputSchema;
      const referenceValidator = new AjvJsonSchemaValidator().getValidator(referenceSchema as never);
      expect(referenceSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['shotIds'] });
      expect(referenceValidator({ shotIds: Array.from({ length: 24 }, (_, index) => `clip_${index}`) })).toMatchObject({
        valid: true,
      });
      expect(referenceValidator({ shotIds: [], unknown: true })).toMatchObject({ valid: false });
    } finally {
      await harness.close();
    }
  });

  it('advertises uniqueness and shot-duration rules that an AJV client can enforce', async () => {
    const harness = await createStudioMcpProtocolHarnessV2();
    try {
      const { tools } = await harness.client.listTools();
      const applySchema = tools.find((tool) => tool.name === 'studio_apply_edits')?.inputSchema;
      const proposalSchema = tools.find((tool) => tool.name === 'propose_storyboard')?.inputSchema;
      const referenceSchema = tools.find((tool) => tool.name === 'studio_request_reference_images')?.inputSchema;
      const applyValidator = new AjvJsonSchemaValidator().getValidator(applySchema as never);
      const proposalValidator = new AjvJsonSchemaValidator().getValidator(proposalSchema as never);
      const referenceValidator = new AjvJsonSchemaValidator().getValidator(referenceSchema as never);
      const invalidApplyInputs = [
        {
          expectedRevision: 7,
          operations: [{ kind: 'reorder_beats', beatOrder: ['section_1', 'section_1'] }],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'reorder_shots',
              beatId: 'section_1',
              shotOrder: ['clip_1', 'clip_1'],
            },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'reorder_bin',
              bin: [
                { kind: 'shot', beatId: 'section_1', shotId: 'clip_1', reason: 'lifted' },
                { kind: 'shot', beatId: 'section_1', shotId: 'clip_1', reason: 'lifted' },
              ],
            },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'add_shot',
              beatId: 'section_1',
              shotId: 'clip_new',
              shot: { ...editableShotV2(), durationSeconds: 3 },
              beforeShotId: null,
            },
          ],
        },
        {
          expectedRevision: 7,
          operations: [
            {
              kind: 'edit_shot',
              shotId: 'clip_1',
              changes: { durationSeconds: 3 },
            },
          ],
        },
      ];

      for (const input of invalidApplyInputs) {
        expect(applyValidator(input), JSON.stringify(input)).toMatchObject({ valid: false });
      }
      expect(
        proposalValidator({
          base_revision: 7,
          operations: [
            {
              kind: 'add_beat',
              beatId: 'section_new',
              beat: editableBeatV2(),
              beforeBeatId: null,
            },
            { kind: 'reorder_beats', beatOrder: ['section_1'] },
          ],
        })
      ).toMatchObject({ valid: true });
      expect(referenceValidator({ shotIds: ['clip_1', 'clip_1'] })).toMatchObject({ valid: false });
    } finally {
      await harness.close();
    }
  });

  it('keeps the full catalog structural in tools/list while handlers own capability and size policy', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-policy-'));
    const createId = vi.fn(() => 'must_not_mint');
    const harness = await createStudioMcpProtocolHarnessV2(
      {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      },
      { createId }
    );
    try {
      const { tools } = await harness.client.listTools();
      const applyTool = tools.find((tool) => tool.name === 'studio_apply_edits');
      const proposalTool = tools.find((tool) => tool.name === 'propose_storyboard');
      const applyValidator = new AjvJsonSchemaValidator().getValidator(applyTool?.inputSchema as never);
      const proposalValidator = new AjvJsonSchemaValidator().getValidator(proposalTool?.inputSchema as never);
      const oversizedOperations = Array.from({ length: 32 }, (_, index) => ({
        kind: 'set_brief',
        brief: `${index}:${'x'.repeat(16 * 1024 - String(index).length - 1)}`,
      }));
      const oversizedApply = { expectedRevision: 7, operations: oversizedOperations };
      const oversizedProposal = { base_revision: 7, operations: oversizedOperations };

      for (const operation of mutationCatalogV2()) {
        expect(applyValidator({ expectedRevision: 7, operations: [operation] }), operation.kind).toMatchObject({
          valid: true,
        });
        expect(proposalValidator({ base_revision: 7, operations: [operation] }), operation.kind).toMatchObject({
          valid: true,
        });
      }
      expect(applyValidator(oversizedApply)).toMatchObject({ valid: true });
      expect(proposalValidator(oversizedProposal)).toMatchObject({ valid: true });
      expect(studioApplyEditsInputSchemaV2.safeParse(oversizedApply).success).toBe(true);
      expect(studioProposeStoryboardInputSchemaV2.safeParse(oversizedProposal).success).toBe(true);

      for (const description of [applyTool?.description, proposalTool?.description]) {
        expect(description).toMatch(/256 KiB/i);
        expect(description).toMatch(/operation_not_permitted/i);
      }
      expect(applyTool?.description).toMatch(/rejected atomically at capability preflight/i);
      expect(applyTool?.description).toMatch(/no operation reaches command evaluation or is applied/i);
      expect(applyTool?.description).toMatch(/zero-based index/i);
      expect(applyTool?.description).toMatch(/whole subset to propose_storyboard/i);
      expect(applyTool?.description).toMatch(/only when it is independently valid/i);
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('accepts every V2 operation independently and rejects mutation-sensitive malformed batches', () => {
    const validOperations = mutationCatalogV2();
    for (const operation of validOperations) {
      expect(validateStudioMutationOperationV2(operation), operation.kind).toBe(true);
      expect(
        studioApplyEditsInputSchemaV2.safeParse({ expectedRevision: 7, operations: [operation] }).success,
        operation.kind
      ).toBe(true);
      expect(
        studioProposeStoryboardInputSchemaV2.safeParse({ base_revision: 7, operations: [operation] }).success,
        operation.kind
      ).toBe(true);
    }

    const invalidBatches = [
      { expectedRevision: 7, operations: [] },
      {
        expectedRevision: 7,
        operations: Array.from({ length: 33 }, (_, index) => ({ kind: 'set_brief', brief: `Brief ${index}` })),
      },
      { expectedRevision: 7, operations: [{ kind: 'edit_beat', beatId: 'section_1', changes: {} }] },
      { expectedRevision: 7, operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: {} }] },
      { expectedRevision: 7, operations: [{ kind: 'delete_shot', shotId: '../shot' }] },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_shot',
            beatId: 'section_1',
            shotId: 'clip_short',
            shot: { ...editableShotV2(), durationSeconds: 3 },
            beforeShotId: null,
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_shot',
            beatId: 'section_1',
            shotId: 'clip_long',
            shot: { ...editableShotV2(), durationSeconds: 16 },
            beforeShotId: null,
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: { durationSeconds: 3 } }],
      },
      {
        expectedRevision: 7,
        operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: { durationSeconds: 16 } }],
      },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'set_rules',
            rules: [
              {
                id: 'rule_bad',
                text: 'This predicate cannot be enforced.',
                predicate: { kind: 'forbidden_terms', terms: ['!!!'] },
              },
            ],
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'apply_coverage',
            beatId: 'section_1',
            shots: [],
            fixedShots: [{ shotId: 'clip_1', reasons: ['video_asset', 'owned_asset'] }],
          },
        ],
      },
      {
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'section_legacy',
            beat: editableBeatV2(),
            beforeBeatId: null,
            firstShotId: 'clip_legacy',
            firstShot: editableShotV2(),
          },
        ],
      },
      { expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Valid', unknown: true }] },
      { expectedRevision: 7, operations: [{ kind: 'set_brief', brief: 'Valid' }], unknown: true },
    ];
    for (const input of invalidBatches) expect(studioApplyEditsInputSchemaV2.safeParse(input).success).toBe(false);

    const ruleDraft = {
      id: 'rule_reviewed',
      text: 'Avoid competitor marks.',
      predicate: { kind: 'forbidden_terms', terms: ['competitor'] },
    };
    for (const persistedProvenance of [
      { scope: 'project' },
      { createdAt: '2026-08-17T00:00:00.000Z' },
      { organizationId: 'organization_1' },
      { unknownRuleField: true },
    ]) {
      const operation = { kind: 'set_rules', rules: [{ ...ruleDraft, ...persistedProvenance }] };
      expect(studioApplyEditsInputSchemaV2.safeParse({ expectedRevision: 7, operations: [operation] }).success).toBe(
        false
      );
      expect(
        studioProposeStoryboardInputSchemaV2.safeParse({ base_revision: 7, operations: [operation] }).success
      ).toBe(false);
    }

    expect(
      studioApplyEditsInputSchemaV2.safeParse({
        expectedRevision: 7,
        operations: [
          {
            kind: 'add_shot',
            beatId: 'section_1',
            shotId: 'clip_new',
            shot: editableShotV2(),
            beforeShotId: null,
          },
          { kind: 'reorder_shots', beatId: 'section_2', shotOrder: ['clip_2'] },
        ],
      }).success
    ).toBe(true);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [
          {
            kind: 'add_beat',
            beatId: 'section_new',
            beat: editableBeatV2(),
            beforeBeatId: null,
          },
        ],
      }).success
    ).toBe(true);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [
          {
            kind: 'add_shot',
            beatId: 'section_1',
            shotId: 'clip_new',
            shot: editableShotV2(),
            beforeShotId: null,
          },
          { kind: 'reorder_shots', beatId: 'section_1', shotOrder: ['clip_1'] },
        ],
      }).success
    ).toBe(true);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [{ kind: 'set_brief', brief: 'Valid', unknown: true }],
      }).success
    ).toBe(false);
    expect(
      studioProposeStoryboardInputSchemaV2.safeParse({
        base_revision: 7,
        operations: [{ kind: 'rederive_line', shotId: 'clip_1', line: '' }],
      }).success
    ).toBe(false);
    for (const shotIds of [
      [],
      Array.from({ length: 25 }, (_, index) => `clip_${index}`),
      ['clip_1', 'clip_1'],
      ['unsafe/shot'],
    ]) {
      expect(studioRequestReferenceImagesInputSchemaV2.safeParse({ shotIds }).success).toBe(false);
    }
  });

  it('returns capability denials through the SDK before IDs or sidecar IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const createId = vi.fn(() => 'must_not_mint');
    const harness = await createStudioMcpProtocolHarnessV2(
      {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      },
      { createId }
    );
    try {
      const calls = [
        {
          name: 'studio_apply_edits',
          arguments: {
            expectedRevision: 7,
            operations: [{ kind: 'rederive_line', shotId: 'clip_1', line: 'Proposal only' }],
          },
        },
        {
          name: 'studio_apply_edits',
          arguments: { expectedRevision: 7, operations: [{ kind: 'undo_last', entryId: 'undo_1' }] },
        },
        {
          name: 'propose_storyboard',
          arguments: { base_revision: 7, operations: [{ kind: 'undo_last', entryId: 'undo_1' }] },
        },
        {
          name: 'propose_storyboard',
          arguments: {
            base_revision: 7,
            operations: [{ kind: 'select_take', shotId: 'clip_1', assetId: 'take_1' }],
          },
        },
        {
          name: 'propose_storyboard',
          arguments: {
            base_revision: 7,
            operations: [{ kind: 'set_match_to', shotId: 'clip_1' }],
          },
        },
        {
          name: 'propose_storyboard',
          arguments: {
            base_revision: 7,
            operations: [
              mutationCatalogV2().find((operation) => operation.kind === 'apply_coverage')!,
              { kind: 'park_shot', shotId: 'clip_1' },
            ],
          },
        },
      ];
      for (const call of calls) {
        // eslint-disable-next-line no-await-in-loop
        const result = await harness.client.callTool(call);
        expect(result.isError).toBe(true);
        if (call.name === 'studio_apply_edits') {
          const content = result.content[0];
          expect(content?.type).toBe('text');
          expect(JSON.parse(content?.type === 'text' ? content.text : '')).toMatchObject({
            code: 'operation_not_permitted',
            rejectedOperations: [{ index: 0, kind: call.arguments.operations[0]?.kind }],
            directCapableOperationIndexes: [],
          });
        } else if (
          call.arguments.operations[0]?.kind === 'select_take' ||
          call.arguments.operations[0]?.kind === 'set_match_to'
        ) {
          const content = result.content[0];
          expect(content?.type).toBe('text');
          expect(content?.type === 'text' ? content.text : '').toMatch(/Input validation error|Invalid arguments/u);
        } else {
          expect(result.content).toEqual([{ type: 'text', text: 'operation_not_permitted' }]);
        }
      }
      expect(createId).not.toHaveBeenCalled();
      await expect(nodeFs.readdir(path.join(projectDir, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(nodeFs.readdir(path.join(projectDir, 'proposals'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('explains every mixed-batch capability rejection without applying its direct operations', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-mixed-capability-'));
    const createId = vi.fn(() => 'must_not_mint');
    const writerFsAccess = vi.fn(() => {
      throw new Error('studio_apply_edits capability rejection must not reach writer IO');
    });
    const writerFs = new Proxy(nodeFs, { get: writerFsAccess });
    const harness = await createStudioMcpProtocolHarnessV2(
      {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      },
      { createId, fs: writerFs }
    );
    try {
      const result = await harness.client.callTool({
        name: 'studio_apply_edits',
        arguments: {
          expectedRevision: 7,
          operations: [
            { kind: 'set_brief', brief: 'Direct work must remain identifiable' },
            { kind: 'rederive_line', shotId: 'clip_1', line: 'Proposal only' },
            { kind: 'set_rules', rules: [] },
            { kind: 'edit_beat', beatId: 'section_1', changes: { title: 'Also direct' } },
          ],
        },
      });
      const content = result.content[0];

      expect(result.isError).toBe(true);
      expect(content?.type).toBe('text');
      expect(JSON.parse(content?.type === 'text' ? content.text : '')).toEqual({
        code: 'operation_not_permitted',
        message:
          'studio_apply_edits rejected the batch at capability preflight; no operation reached command evaluation or was applied.',
        operationIndexBase: 0,
        rejectedOperations: [
          {
            index: 1,
            kind: 'rederive_line',
            disposition: 'proposal',
            reason: 'requires_user_review',
          },
          {
            index: 2,
            kind: 'set_rules',
            disposition: 'operation_not_permitted',
            reason: 'unavailable_to_director',
          },
        ],
        directCapableOperationIndexes: [0, 3],
        guidance: {
          proposal:
            'After omitting unavailable operations, submit the full ordered direct-and-proposal-capable subset to propose_storyboard when it still expresses the intended atomic change.',
          unavailable:
            'Omit unavailable operations or ask the user to perform them manually in Creative Studio when supported.',
          direct:
            'Only if the direct-capable operations are independently valid, call read_storyboard and submit them in a new studio_apply_edits batch against the fresh revision.',
          retry: 'Do not retry this batch unchanged.',
        },
      });
      expect(createId).not.toHaveBeenCalled();
      expect(writerFsAccess).not.toHaveBeenCalled();
      await expect(nodeFs.readdir(projectDir)).resolves.toEqual([]);
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('rejects maximum-count oversized commands and proposals before IDs or sidecar IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-pre-handler-'));
    const createId = vi.fn(() => 'unexpected_id');
    const config = {
      projectId: 'project_v2',
      projectDir,
      pendingDir: path.join(projectDir, 'proposals', 'pending'),
      referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
    };
    const harness = await createStudioMcpProtocolHarnessV2(config, { createId });
    const operations = Array.from({ length: 32 }, (_, index) => ({
      kind: 'set_brief',
      brief: `${index}:${'x'.repeat(16 * 1024 - String(index).length - 1)}`,
    }));
    try {
      await expect(
        harness.client.callTool({
          name: 'studio_apply_edits',
          arguments: { expectedRevision: 7, operations },
        })
      ).resolves.toMatchObject({ isError: true });
      await expect(
        harness.client.callTool({
          name: 'propose_storyboard',
          arguments: { base_revision: 7, operations },
        })
      ).resolves.toMatchObject({ isError: true });
      expect(createId).not.toHaveBeenCalled();
      await expect(nodeFs.lstat(path.join(projectDir, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(nodeFs.lstat(path.join(projectDir, 'proposals'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('projects validated Beat/Shot state with only the canonical picture pointer', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const project = makeSchema2ServiceProject();
    addGeneratedVideosForMcpV2(project, 26);
    const briefReferences: StudioAssetV2[] = [
      ['cast_b', 'cast', 'Second cast'],
      ['cast_a', 'cast', 'First cast'],
      ['look_a', 'look', 'Golden look'],
    ].map(([id, role, label]) => ({
      id: id!,
      projectId: project.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: `${id}.png` },
      byteSize: 1,
      sha256: 'b'.repeat(64),
      briefReferenceRole: role as 'cast' | 'look',
      briefReferenceLabel: label!,
      createdAt: '2026-08-17T00:00:00.000Z',
    }));
    for (const asset of briefReferences) project.assets[asset.id] = asset;
    project.rules = [
      {
        id: 'rule_context',
        scope: 'project',
        text: 'Keep the tone optimistic.',
        predicate: null,
        createdAt: '2026-08-17T00:00:00.000Z',
      },
      {
        id: 'rule_enforced',
        scope: 'project',
        text: 'Never show competitors.',
        predicate: { kind: 'forbidden_terms', terms: ['competitor'] },
        createdAt: '2026-08-17T00:00:01.000Z',
      },
    ];
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));

    const result = await createReadStoryboardHandlerV2({
      projectId: project.id,
      projectDir,
      pendingDir: '',
      referencePendingDir: '',
    })({});
    const view = JSON.parse(result.content[0].text) as {
      beatOrder: string[];
      beats: Record<string, { shotOrder: string[] }>;
      shots: Record<string, { hasVideo: boolean; videoAssetId: string | null }>;
      bin: unknown[];
      briefReferences: unknown[];
      rules: unknown[];
    };

    expect(result.isError).toBeUndefined();
    expect(view.beatOrder).toEqual(['section_1', 'section_2']);
    expect(view.beats.section_1.shotOrder).toEqual(['clip_1']);
    expect(view.shots.clip_1).toMatchObject({ hasVideo: true, videoAssetId: 'take_26' });
    expect(view.shots.clip_1).not.toHaveProperty('selectedTakeId');
    expect(view.shots.clip_1).not.toHaveProperty('availableTakeIds');
    expect(view.bin).toEqual([]);
    expect(view.briefReferences).toEqual([
      { id: 'cast_a', label: 'First cast', role: 'cast' },
      { id: 'cast_b', label: 'Second cast', role: 'cast' },
      { id: 'look_a', label: 'Golden look', role: 'look' },
    ]);
    expect(view.rules).toEqual([
      { scope: 'project', text: 'Keep the tone optimistic.', enforced: false },
      {
        scope: 'project',
        text: 'Never show competitors.',
        enforced: true,
        forbiddenTerms: ['competitor'],
      },
    ]);
    expect(view).not.toHaveProperty('sceneOrder');
    expect(view).not.toHaveProperty('scenes');
    await rm(projectDir, { recursive: true, force: true });
  });

  it('hydrates the storyboard Brief only from the digest-backed Brief file', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-brief-file-'));
    const project = makeSchema2ServiceProject();
    const externalBrief = 'The authoritative prose from brief.md';
    const manifest = createStudioProjectManifestV2({ ...project, brief: externalBrief });
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(manifest));
    await writeFile(path.join(projectDir, 'brief.md'), externalBrief);

    try {
      const result = await createReadStoryboardHandlerV2({
        projectId: project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({});

      expect(result.isError).toBeUndefined();
      expect(JSON.parse(result.content[0].text)).toMatchObject({ brief: externalBrief });
      expect(JSON.parse(await readFile(path.join(projectDir, 'project.json'), 'utf8'))).not.toHaveProperty('brief');
      await writeFile(path.join(projectDir, 'brief.md'), 'Changed before main-process synchronization');
      await expect(
        createReadStoryboardHandlerV2({
          projectId: project.id,
          projectDir,
          pendingDir: '',
          referencePendingDir: '',
        })({})
      ).resolves.toMatchObject({ isError: true });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('counts a parked beat against the schema-2 beat capacity', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-capacity-'));
    const empty = createEmptyStudioProjectV2(
      {
        name: 'Capacity boundary',
        brief: '',
        aspectRatio: '16:9',
        targetDurationSeconds: 24,
        resolution: '1080p',
      },
      'project_capacity',
      '2026-08-17T00:00:00.000Z'
    );
    const addedAt = '2026-08-17T00:00:01.000Z';
    const added = applyStudioMutationBatchV2(
      empty,
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: empty.id,
        expectedRevision: empty.revision,
        operations: Array.from({ length: 24 }, (_, index) => {
          const ordinal = index + 1;
          return {
            kind: 'add_beat' as const,
            beatId: `section_${ordinal}`,
            beat: {
              title: `Section ${ordinal}`,
              action: '',
              look: `Visual ${ordinal}`,
              targetSeconds: null,
            },
            beforeBeatId: null,
          };
        }),
      },
      { mutationId: 'capacity_add_beats', capturedAt: addedAt }
    ).project;
    let project = { ...added, revision: empty.revision + 1, updatedAt: addedAt };
    const parkedAt = '2026-08-17T00:00:02.000Z';
    const parked = applyStudioMutationBatchV2(
      project,
      {
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [{ kind: 'park_beat', beatId: 'section_24' }],
      },
      { mutationId: 'capacity_park_beat', capturedAt: parkedAt }
    ).project;
    project = { ...parked, revision: project.revision + 1, updatedAt: parkedAt };
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));

    try {
      const result = await createReadStoryboardHandlerV2({
        projectId: project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({});
      const view = JSON.parse(result.content[0].text) as {
        beatOrder: string[];
        beatCapacity: { current: number; maximum: number; remaining: number; overCapacity: boolean };
      };

      expect(project.beatOrder).toHaveLength(23);
      expect(Object.keys(project.beats)).toHaveLength(24);
      expect(view.beatCapacity).toEqual({ current: 24, maximum: 24, remaining: 0, overCapacity: false });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each([1, 2] as const)(
    'rejects a schema-%d manifest as unsupported before proposal or reference sidecar IO',
    async (schemaVersion) => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-legacy-'));
      const unsupportedManifest = { schemaVersion, id: `project_schema_${schemaVersion}`, revision: 7 };
      await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(unsupportedManifest));
      const config = {
        projectId: unsupportedManifest.id,
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      };

      try {
        const outcomes = await Promise.all([
          createReadStoryboardHandlerV2(config)({}),
          createProposeStoryboardHandlerV2(config)({
            base_revision: unsupportedManifest.revision,
            operations: [{ kind: 'set_brief', brief: `Must remain schema ${schemaVersion}` }],
          }),
          createRequestReferenceImagesHandlerV2(config)({ shotIds: ['clip_1'] }),
        ]);

        expect(outcomes.every((result) => result.isError === true)).toBe(true);
        expect(outcomes.every((result) => result.content[0].text.includes('unsupported_prototype_schema'))).toBe(true);
        await expect(readdir(projectDir)).resolves.toEqual(['project.json']);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  );

  it.each(['proposal', 'reference'] as const)(
    'rejects a %s queue rooted in another project without changing the foreign project',
    async (requestKind) => {
      const parentDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-cross-root-'));
      const projectDir = path.join(parentDir, 'authorizing-project');
      const foreignProjectDir = path.join(parentDir, 'foreign-project');
      const project = makeSchema2ServiceProject();
      const foreignPendingDir = path.join(foreignProjectDir, 'proposals', 'pending');
      const foreignProposalSlotsDir = path.join(foreignProjectDir, 'proposals', 'slots');
      const foreignReferencePendingDir = path.join(foreignProjectDir, 'reference-requests', 'pending');
      const foreignReferenceSlotsDir = path.join(foreignProjectDir, 'reference-requests', 'slots');
      await mkdir(projectDir);
      await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
      await mkdir(foreignPendingDir, { recursive: true });
      await mkdir(foreignProposalSlotsDir);
      await mkdir(foreignReferencePendingDir, { recursive: true });
      await mkdir(foreignReferenceSlotsDir);
      await writeFile(
        path.join(foreignProjectDir, 'project.json'),
        JSON.stringify({ schemaVersion: 1, id: 'foreign_schema_1', revision: 1 })
      );
      const captureForeignProject = async () => {
        const captureDirectory = async (directory: string) =>
          Promise.all(
            (await readdir(directory))
              .toSorted()
              .map(async (name) => ({ name, bytes: await readFile(path.join(directory, name), 'utf8') }))
          );
        return {
          project: await readFile(path.join(foreignProjectDir, 'project.json'), 'utf8'),
          proposalPending: await captureDirectory(foreignPendingDir),
          proposalSlots: await captureDirectory(foreignProposalSlotsDir),
          referencePending: await captureDirectory(foreignReferencePendingDir),
          referenceSlots: await captureDirectory(foreignReferenceSlotsDir),
        };
      };
      const before = await captureForeignProject();
      const config = {
        projectId: project.id,
        projectDir,
        pendingDir: foreignPendingDir,
        referencePendingDir: foreignReferencePendingDir,
      };

      try {
        const result =
          requestKind === 'proposal'
            ? await createProposeStoryboardHandlerV2(config)({
                base_revision: project.revision,
                operations: [{ kind: 'set_brief', brief: 'Must stay in the authorizing project' }],
              })
            : await createRequestReferenceImagesHandlerV2(config)({ shotIds: ['clip_1'] });

        expect(result.isError).toBe(true);
        expect(await captureForeignProject()).toEqual(before);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    }
  );

  it.each(['proposal', 'reference'] as const)(
    'rejects a whole-project-root replacement before publishing a %s sidecar',
    async (requestKind) => {
      const parentDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-root-generation-'));
      const projectDir = path.join(parentDir, 'project_v2');
      const displacedProjectDir = path.join(parentDir, 'project_v2-original');
      const familyName = requestKind === 'proposal' ? 'proposals' : 'reference-requests';
      const pendingDir = path.join(projectDir, familyName, 'pending');
      const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
      const originalProject = makeSchema2ServiceProject();
      const replacementProject = { ...structuredClone(originalProject), revision: originalProject.revision + 1 };
      const createdAt = '2026-08-17T01:02:03.000Z';

      const seedProjectRoot = async (root: string, project: StudioProjectV2, marker: string): Promise<void> => {
        const { pendingDir: familyPendingDir, slotsDir: familySlotsDir } = await createSidecarFamilyV2(
          root,
          familyName
        );
        const recordId = `${marker}_${requestKind}`;
        await writeFile(path.join(root, 'project.json'), JSON.stringify(project));
        await writeFile(
          path.join(familyPendingDir, `${recordId}.json`),
          JSON.stringify(
            requestKind === 'proposal'
              ? {
                  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                  id: recordId,
                  projectId: project.id,
                  status: 'pending',
                  baseRevision: project.revision,
                  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: marker }] },
                  createdAt,
                  decidedAt: null,
                }
              : {
                  schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                  id: recordId,
                  projectId: project.id,
                  shotIds: ['clip_2'],
                  status: 'pending',
                  createdAt,
                }
          )
        );
        await writeFile(
          path.join(familySlotsDir, '49.slot'),
          JSON.stringify({
            schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
            [requestKind === 'proposal' ? 'proposalId' : 'requestId']: recordId,
            reservedAt: createdAt,
          })
        );
      };
      const readSidecarSnapshot = async (root: string) => {
        const familyRoot = path.join(root, familyName);
        const snapshotDirectory = async (name: 'pending' | 'slots') => {
          const directory = path.join(familyRoot, name);
          const entries = (await readdir(directory)).toSorted();
          return Promise.all(
            entries.map(async (entry) => ({ entry, bytes: await readFile(path.join(directory, entry), 'utf8') }))
          );
        };
        return { pending: await snapshotDirectory('pending'), slots: await snapshotDirectory('slots') };
      };

      await mkdir(projectDir);
      await seedProjectRoot(projectDir, originalProject, 'original_existing');
      const originalSidecars = await readSidecarSnapshot(projectDir);
      let replacementSidecars: Awaited<ReturnType<typeof readSidecarSnapshot>> | undefined;
      let initialProjectReadClosed = false;
      let rootStatsAfterInitialRead = 0;
      let replacementInstalled = false;
      const swappingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'open') {
            return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
              const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
              if (replacementInstalled || path.basename(String(file)) !== 'project.json') return handle;
              return new Proxy(handle, {
                get(current, key, currentReceiver) {
                  if (key === 'close') {
                    return async () => {
                      await current.close();
                      initialProjectReadClosed = true;
                    };
                  }
                  const value = Reflect.get(current, key, currentReceiver) as unknown;
                  return typeof value === 'function' ? value.bind(current) : value;
                },
              });
            };
          }
          if (property === 'lstat') {
            return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
              if (
                initialProjectReadClosed &&
                !replacementInstalled &&
                path.resolve(String(file)) === path.resolve(projectDir)
              ) {
                rootStatsAfterInitialRead += 1;
                if (rootStatsAfterInitialRead === 2) {
                  await nodeFs.rename(projectDir, displacedProjectDir);
                  await mkdir(projectDir);
                  await seedProjectRoot(projectDir, replacementProject, 'replacement_existing');
                  replacementSidecars = await readSidecarSnapshot(projectDir);
                  replacementInstalled = true;
                }
              }
              return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      const config = {
        projectId: originalProject.id,
        projectDir,
        pendingDir: requestKind === 'proposal' ? pendingDir : path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir,
        fs: swappingFs,
      };

      try {
        const result =
          requestKind === 'proposal'
            ? await createProposeStoryboardHandlerV2(config)({
                base_revision: originalProject.revision,
                operations: [{ kind: 'set_brief', brief: 'Must not cross the root generation' }],
              })
            : await createRequestReferenceImagesHandlerV2(config)({ shotIds: ['clip_1'] });

        expect(replacementInstalled).toBe(true);
        expect(result.isError).toBe(true);
        expect(await readSidecarSnapshot(displacedProjectDir)).toEqual(originalSidecars);
        expect(await readSidecarSnapshot(projectDir)).toEqual(replacementSidecars);
      } finally {
        await rm(parentDir, { recursive: true, force: true });
      }
    }
  );

  it.each(['symlink', 'oversized'] as const)(
    'rejects a %s schema-2 manifest before proposal or reference sidecar IO',
    async (manifestKind) => {
      const projectDir = await mkdtemp(path.join(tmpdir(), `studio-server-v2-${manifestKind}-`));
      const projectFile = path.join(projectDir, 'project.json');
      if (manifestKind === 'symlink') {
        const target = path.join(projectDir, 'project-target.json');
        await writeFile(target, JSON.stringify(makeSchema2ServiceProject()));
        await nodeFs.symlink(target, projectFile);
      } else {
        await writeFile(projectFile, '');
        await nodeFs.truncate(projectFile, 64 * 1024 * 1024 + 1);
      }
      const config = {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      };

      try {
        const outcomes = await Promise.all([
          createReadStoryboardHandlerV2(config)({}),
          createProposeStoryboardHandlerV2(config)({
            base_revision: 3,
            operations: [{ kind: 'set_brief', brief: 'Must not be queued' }],
          }),
          createRequestReferenceImagesHandlerV2(config)({ shotIds: ['clip_1'] }),
        ]);

        expect(outcomes.every((result) => result.isError === true)).toBe(true);
        await expect(nodeFs.lstat(path.join(projectDir, 'proposals'))).rejects.toMatchObject({ code: 'ENOENT' });
        await expect(nodeFs.lstat(path.join(projectDir, 'reference-requests'))).rejects.toMatchObject({
          code: 'ENOENT',
        });
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  );

  it('rejects a manifest whose identity differs from config before proposal or reference IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const project = makeSchema2ServiceProject();
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
    await createSidecarFamilyV2(projectDir, 'proposals');
    await createSidecarFamilyV2(projectDir, 'reference-requests');
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
    const config = { projectId: 'other_project', projectDir, pendingDir, referencePendingDir };

    await expect(createReadStoryboardHandlerV2(config)({})).resolves.toMatchObject({ isError: true });
    await expect(
      createProposeStoryboardHandlerV2(config)({
        base_revision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Must not be written' }],
      })
    ).resolves.toMatchObject({ isError: true });
    await expect(createRequestReferenceImagesHandlerV2(config)({ shotIds: ['clip_1'] })).resolves.toMatchObject({
      isError: true,
    });
    await expect(readdir(pendingDir)).resolves.toEqual([]);
    await expect(readdir(path.join(projectDir, 'proposals', 'slots'))).resolves.toEqual([]);
    await expect(readdir(referencePendingDir)).resolves.toEqual([]);
    await expect(readdir(path.join(projectDir, 'reference-requests', 'slots'))).resolves.toEqual([]);
    await rm(projectDir, { recursive: true, force: true });
  });

  it('validates proposal records before any slot or record side effect', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-proposal-v2-'));
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const slotsDir = path.join(projectDir, 'proposals', 'slots');
    await createSidecarFamilyV2(projectDir, 'proposals');
    const projectAuthority = await capturePendingProjectAuthorityV2(projectDir);

    const record = await writeProposalRecordV2({
      pendingDir,
      projectId: 'project_v2',
      proposalId: 'proposal_valid',
      baseRevision: 7,
      payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'A validated proposal' }] },
      projectAuthority,
    });
    expect(record.schemaVersion).toBe(STUDIO_PROJECT_SCHEMA_VERSION);
    expect(JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8'))).toMatchObject({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      proposalId: 'proposal_valid',
    });
    const beforePending = await readdir(pendingDir);
    const beforeSlots = await readdir(slotsDir);
    const invalidInputs = [
      {
        pendingDir,
        projectId: '../project',
        proposalId: 'unsafe_project',
        baseRevision: 7,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'No' }] },
        projectAuthority,
      },
      {
        pendingDir,
        projectId: 'project_v2',
        proposalId: 'bad_revision',
        baseRevision: 0,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'No' }] },
        projectAuthority,
      },
      {
        pendingDir,
        projectId: 'project_v2',
        proposalId: 'unknown_nested',
        baseRevision: 7,
        payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: 'No', unknown: true }] },
        projectAuthority,
      },
      new Proxy({} as never, {
        get() {
          throw new Error('hostile input getter');
        },
      }),
    ];
    for (const input of invalidInputs) {
      // Each rejection must leave the same queue snapshot for the next boundary case.
      // eslint-disable-next-line no-await-in-loop
      await expect(writeProposalRecordV2(input as never)).rejects.toMatchObject({ code: 'storage' });
    }
    await expect(readdir(pendingDir)).resolves.toEqual(beforePending);
    await expect(readdir(slotsDir)).resolves.toEqual(beforeSlots);
    await rm(projectDir, { recursive: true, force: true });
  });

  it('writes one bounded exact V2 reference batch and ignores malformed dedup records', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-reference-v2-'));
    const pendingDir = path.join(projectDir, 'reference-requests', 'pending');
    const slotsDir = path.join(projectDir, 'reference-requests', 'slots');
    await createSidecarFamilyV2(projectDir, 'reference-requests');
    const shotIds = Array.from({ length: 24 }, (_, index) => `clip_${index + 1}`);
    const projectAuthority = await capturePendingProjectAuthorityV2(projectDir);

    const record = await referenceRequestWriter.writeReferenceRequestRecordV2({
      pendingDir,
      projectId: 'project_v2',
      requestId: 'request_valid',
      shotIds,
      projectAuthority,
    });
    expect(record).toMatchObject({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, shotIds });
    expect(JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8'))).toMatchObject({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'request_valid',
    });
    const beforePending = await readdir(pendingDir);
    const beforeSlots = await readdir(slotsDir);
    const hostileShotIds = new Proxy(['clip_1'], {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
    });
    for (const invalidShotIds of [
      [],
      Array.from({ length: 25 }, (_, index) => `clip_${index}`),
      ['clip_1', 'clip_1'],
      ['unsafe/shot'],
      hostileShotIds,
    ]) {
      // Keep the no-side-effect queue oracle deterministic between malformed direct calls.
      // eslint-disable-next-line no-await-in-loop
      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir,
          projectId: 'project_v2',
          requestId: `invalid_${invalidShotIds.length}`,
          shotIds: invalidShotIds,
          projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
    }
    await expect(readdir(pendingDir)).resolves.toEqual(beforePending);
    await expect(readdir(slotsDir)).resolves.toEqual(beforeSlots);

    await writeFile(
      path.join(pendingDir, 'bad_date.json'),
      JSON.stringify({ ...record, id: 'bad_date', shotIds: ['clip_bad_date'], createdAt: '2026-08-17' })
    );
    await writeFile(
      path.join(pendingDir, 'legacy.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'legacy',
        projectId: 'project_v2',
        sceneId: 'scene_legacy',
        status: 'pending',
        createdAt: '2026-08-17T00:00:00.000Z',
      })
    );
    await expect(
      referenceRequestWriter.listPendingReferenceRequestShotIdsV2(pendingDir, 'project_v2')
    ).resolves.toEqual(new Set(shotIds));

    const racedFile = path.join(pendingDir, 'raced.json');
    const canonicalRacedFile = path.join(await nodeFs.realpath(pendingDir), 'raced.json');
    const oversizedTarget = path.join(projectDir, 'oversized.json');
    await writeFile(racedFile, JSON.stringify({ ...record, id: 'raced', shotIds: ['clip_raced'] }));
    await writeFile(
      path.join(slotsDir, '1.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'raced',
        reservedAt: record.createdAt,
      })
    );
    await writeFile(oversizedTarget, 'x'.repeat(256 * 1024 + 1));
    let swapped = false;
    const racedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
            const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
            if (!swapped && String(file) === canonicalRacedFile) {
              swapped = true;
              await rm(racedFile);
              await nodeFs.symlink(oversizedTarget, racedFile);
            }
            return stats;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      referenceRequestWriter.listPendingReferenceRequestShotIdsV2(pendingDir, 'project_v2', racedFs)
    ).rejects.toMatchObject({ code: 'storage' });
    expect(swapped).toBe(true);
    await rm(racedFile);
    await rm(path.join(slotsDir, '1.slot'));

    const canonicalPendingDir = await nodeFs.realpath(pendingDir);
    let directoryStatReads = 0;
    const mismatchedDirectoryFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
            const stats = await Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
            if (String(file) === pendingDir || String(file) === canonicalPendingDir) {
              directoryStatReads += 1;
              if (directoryStatReads === 2) {
                return new Proxy(stats, {
                  get(current, key, currentReceiver) {
                    if (key === 'ino') return current.ino + 1;
                    const value = Reflect.get(current, key, currentReceiver) as unknown;
                    return typeof value === 'function' ? value.bind(current) : value;
                  },
                });
              }
            }
            return stats;
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      referenceRequestWriter.listPendingReferenceRequestShotIdsV2(pendingDir, 'project_v2', mismatchedDirectoryFs)
    ).resolves.toEqual(new Set());
    await rm(projectDir, { recursive: true, force: true });
  });

  it('fails closed on invalid reference clocks and identities without touching an absent queue', async () => {
    const missingRoot = await mkdtemp(path.join(tmpdir(), 'studio-reference-missing-'));
    const missingPendingDir = path.join(missingRoot, 'pending');
    await expect(
      referenceRequestWriter.listPendingReferenceRequestShotIdsV2(
        missingPendingDir,
        REFERENCE_WRITER_PROJECT_ID_V2,
        nodeFs,
        undefined,
        () => REFERENCE_WRITER_NOW_MS_V2
      )
    ).resolves.toEqual(new Set());
    await expect(
      referenceRequestWriter.listPendingReferenceRequestShotIdsV2(
        missingPendingDir,
        REFERENCE_WRITER_PROJECT_ID_V2,
        nodeFs,
        undefined,
        () => Number.NaN
      )
    ).rejects.toMatchObject({ code: 'storage' });
    await rm(missingRoot, { recursive: true, force: true });

    const fixture = await createReferenceWriterQueueV2();
    const sparseShotIds = Array<string>(1);
    Object.defineProperty(sparseShotIds, 'compensating_key', { value: 'not-an-index', enumerable: true });
    try {
      for (const input of [
        { projectId: '../unsafe', requestId: 'request_safe', shotIds: ['shot_safe'] },
        { projectId: REFERENCE_WRITER_PROJECT_ID_V2, requestId: '../unsafe', shotIds: ['shot_safe'] },
        { projectId: REFERENCE_WRITER_PROJECT_ID_V2, requestId: 'request_sparse', shotIds: sparseShotIds },
      ]) {
        // Each invalid identity must fail before any V2 reservation or record publication.
        // eslint-disable-next-line no-await-in-loop
        await expect(
          referenceRequestWriter.writeReferenceRequestRecordV2({
            pendingDir: fixture.pendingDir,
            projectAuthority: fixture.projectAuthority,
            ...input,
          })
        ).rejects.toMatchObject({ code: 'storage' });
      }
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('owns independently named reference pending TTL, count, and record-byte contracts', () => {
    expect({
      maxPending: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
      maxRecordBytes: STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
      pendingTtlMs: STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
    }).toEqual({
      maxPending: 50,
      maxRecordBytes: 256 * 1024,
      pendingTtlMs: 7 * 24 * 60 * 60 * 1_000,
    });
  });

  it('deduplicates only unexpired bounded V2 reference records without reaping expired bytes or slots', async () => {
    const fixture = await createReferenceWriterQueueV2();
    try {
      const expired = referenceRequestRecordV2(
        'request_expired',
        'shot_expired',
        REFERENCE_WRITER_NOW_MS_V2 - STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS
      );
      const current = referenceRequestRecordV2(
        'request_current',
        'shot_current',
        REFERENCE_WRITER_NOW_MS_V2 - STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS + 1
      );
      const terminal = referenceRequestRecordV2('request_terminal', 'shot_terminal', REFERENCE_WRITER_NOW_MS_V2);
      const oversized = referenceRequestRecordV2('request_oversized', 'shot_oversized', REFERENCE_WRITER_NOW_MS_V2);
      const expiredBytes = JSON.stringify(expired);
      const expiredSlotBytes = JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: expired.id,
        reservedAt: expired.createdAt,
      });
      await writeFile(path.join(fixture.pendingDir, `${expired.id}.json`), expiredBytes);
      await writeFile(path.join(fixture.pendingDir, `${current.id}.json`), JSON.stringify(current));
      await writeFile(path.join(fixture.pendingDir, `${terminal.id}.json`), JSON.stringify(terminal));
      await writeFile(
        path.join(fixture.pendingDir, `${oversized.id}.json`),
        `${JSON.stringify(oversized)}${' '.repeat(STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES)}`
      );
      await writeFile(path.join(fixture.slotsDir, '0.slot'), expiredSlotBytes);
      await writeFile(
        path.join(fixture.slotsDir, '1.slot'),
        JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId: current.id,
          reservedAt: current.createdAt,
        })
      );

      await expect(
        referenceRequestWriter.listPendingReferenceRequestShotIdsV2(
          fixture.pendingDir,
          REFERENCE_WRITER_PROJECT_ID_V2,
          nodeFs,
          fixture.projectAuthority,
          () => REFERENCE_WRITER_NOW_MS_V2
        )
      ).resolves.toEqual(new Set(['shot_current']));
      await expect(readFile(path.join(fixture.pendingDir, `${expired.id}.json`), 'utf8')).resolves.toBe(expiredBytes);
      await expect(readFile(path.join(fixture.slotsDir, '0.slot'), 'utf8')).resolves.toBe(expiredSlotBytes);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('rejects duplicate live slot authority and a pending-record replacement during V2 reference dedup', async () => {
    const duplicateFixture = await createReferenceWriterQueueV2();
    try {
      const record = await referenceRequestWriter.writeReferenceRequestRecordV2({
        pendingDir: duplicateFixture.pendingDir,
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        requestId: 'request_duplicate_slot',
        shotIds: ['shot_duplicate_slot'],
        projectAuthority: duplicateFixture.projectAuthority,
      });
      const duplicateSlot = JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: record.id,
        reservedAt: record.createdAt,
      });
      await writeFile(path.join(duplicateFixture.slotsDir, '1.slot'), duplicateSlot);
      const pendingBefore = await readFile(path.join(duplicateFixture.pendingDir, `${record.id}.json`), 'utf8');

      await expect(
        referenceRequestWriter.listPendingReferenceRequestShotIdsV2(
          duplicateFixture.pendingDir,
          REFERENCE_WRITER_PROJECT_ID_V2,
          nodeFs,
          duplicateFixture.projectAuthority
        )
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(readFile(path.join(duplicateFixture.pendingDir, `${record.id}.json`), 'utf8')).resolves.toBe(
        pendingBefore
      );
      await expect(readFile(path.join(duplicateFixture.slotsDir, '1.slot'), 'utf8')).resolves.toBe(duplicateSlot);
    } finally {
      await rm(duplicateFixture.projectDir, { recursive: true, force: true });
    }

    const replacementFixture = await createReferenceWriterQueueV2();
    try {
      const record = await referenceRequestWriter.writeReferenceRequestRecordV2({
        pendingDir: replacementFixture.pendingDir,
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        requestId: 'request_pending_replacement',
        shotIds: ['shot_pending_replacement'],
        projectAuthority: replacementFixture.projectAuthority,
      });
      const slotFile = path.join(await nodeFs.realpath(replacementFixture.slotsDir), '0.slot');
      const pendingFile = path.join(await nodeFs.realpath(replacementFixture.pendingDir), `${record.id}.json`);
      const replacementBytes = JSON.stringify({ ...record, shotIds: ['shot_replacement'] });
      await writeFile(pendingFile, JSON.stringify({ ...record, createdAt: '1970-01-01T00:00:00.000Z' }));
      let slotOpens = 0;
      let replaced = false;
      const replacingFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'open') {
            return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
              if (String(file) === slotFile) {
                slotOpens += 1;
                if (slotOpens === 2) {
                  await rm(pendingFile);
                  await writeFile(pendingFile, replacementBytes);
                  replaced = true;
                }
              }
              return Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      await expect(
        referenceRequestWriter.listPendingReferenceRequestShotIdsV2(
          replacementFixture.pendingDir,
          REFERENCE_WRITER_PROJECT_ID_V2,
          replacingFs,
          replacementFixture.projectAuthority
        )
      ).rejects.toMatchObject({ code: 'storage' });
      expect(replaced).toBe(true);
      await expect(readFile(pendingFile, 'utf8')).resolves.toBe(replacementBytes);
    } finally {
      await rm(replacementFixture.projectDir, { recursive: true, force: true });
    }
  });

  it('rejects the next V2 reference reservation at its own pending-count boundary', async () => {
    const fixture = await createReferenceWriterQueueV2();
    try {
      const reservedAt = new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString();
      await Promise.all(
        Array.from({ length: STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT }, (_, index) => {
          const requestId = `request_reserved_${index}`;
          return Promise.all([
            writeFile(
              path.join(fixture.slotsDir, `${index}.slot`),
              JSON.stringify({
                schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                requestId,
                reservedAt,
              })
            ),
            writeFile(
              path.join(fixture.pendingDir, `${requestId}.json`),
              JSON.stringify(referenceRequestRecordV2(requestId, `shot_${index}`, REFERENCE_WRITER_NOW_MS_V2))
            ),
          ]);
        })
      );

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_over_capacity',
          shotIds: ['shot_1'],
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'capacity' });
      await expect(readdir(fixture.pendingDir)).resolves.toHaveLength(
        STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT
      );
      await expect(readdir(fixture.slotsDir)).resolves.toHaveLength(
        STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT
      );
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('rejects unexpected, out-of-range, and unpaired V2 queue entries before reserving capacity', async () => {
    const cases = [
      { pendingName: 'foreign.txt', pendingBytes: 'foreign', slotName: null, slotBytes: null },
      {
        pendingName: null,
        pendingBytes: null,
        slotName: `${STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT}.slot`,
        slotBytes: JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId: 'request_out_of_range',
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        }),
      },
      {
        pendingName: null,
        pendingBytes: null,
        slotName: '0.slot',
        slotBytes: JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId: 'request_orphan_slot',
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        }),
      },
      {
        pendingName: 'request_orphan_pending.json',
        pendingBytes: JSON.stringify(
          referenceRequestRecordV2('request_orphan_pending', 'shot_orphan', REFERENCE_WRITER_NOW_MS_V2)
        ),
        slotName: null,
        slotBytes: null,
      },
    ] as const;

    for (const [index, fixtureCase] of cases.entries()) {
      // eslint-disable-next-line no-await-in-loop
      const fixture = await createReferenceWriterQueueV2();
      try {
        if (fixtureCase.pendingName !== null) {
          // eslint-disable-next-line no-await-in-loop
          await writeFile(path.join(fixture.pendingDir, fixtureCase.pendingName), fixtureCase.pendingBytes!);
        }
        if (fixtureCase.slotName !== null) {
          // eslint-disable-next-line no-await-in-loop
          await writeFile(path.join(fixture.slotsDir, fixtureCase.slotName), fixtureCase.slotBytes!);
        }
        // eslint-disable-next-line no-await-in-loop
        await expect(
          referenceRequestWriter.writeReferenceRequestRecordV2({
            pendingDir: fixture.pendingDir,
            projectId: REFERENCE_WRITER_PROJECT_ID_V2,
            requestId: `request_rejected_${index}`,
            shotIds: ['shot_new'],
            projectAuthority: fixture.projectAuthority,
          })
        ).rejects.toMatchObject({ code: 'storage' });
        // eslint-disable-next-line no-await-in-loop
        await expect(
          nodeFs.lstat(path.join(fixture.pendingDir, `request_rejected_${index}.json`))
        ).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await rm(fixture.projectDir, { recursive: true, force: true });
      }
    }
  });

  it('rejects duplicate slot authority for one exact pending record', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const requestId = 'request_duplicate_slot';
    const slotBytes = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId,
      reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
    });
    try {
      await writeFile(
        path.join(fixture.pendingDir, `${requestId}.json`),
        JSON.stringify(referenceRequestRecordV2(requestId, 'shot_duplicate', REFERENCE_WRITER_NOW_MS_V2))
      );
      await Promise.all([
        writeFile(path.join(fixture.slotsDir, '0.slot'), slotBytes),
        writeFile(path.join(fixture.slotsDir, '1.slot'), slotBytes),
      ]);

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_after_duplicate',
          shotIds: ['shot_new'],
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot', '1.slot']);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('rejects a slot-backed pending record bound to another project identity', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const requestId = 'request_other_project';
    try {
      await writeFile(
        path.join(fixture.pendingDir, `${requestId}.json`),
        JSON.stringify({
          ...referenceRequestRecordV2(requestId, 'shot_other_project', REFERENCE_WRITER_NOW_MS_V2),
          projectId: 'different_project',
        })
      );
      await writeFile(
        path.join(fixture.slotsDir, '0.slot'),
        JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId,
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        })
      );

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_current_project',
          shotIds: ['shot_new'],
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('reconciles an exact same-inode named slot and cleanup alias before the next publication', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const requestId = 'request_cleanup_restart';
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    const cleanupAlias = `${slotFile}.12345_9.cleanup`;
    try {
      await writeFile(
        path.join(fixture.pendingDir, `${requestId}.json`),
        JSON.stringify(referenceRequestRecordV2(requestId, 'shot_existing', REFERENCE_WRITER_NOW_MS_V2))
      );
      await writeFile(
        slotFile,
        JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId,
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        })
      );
      await nodeFs.link(slotFile, cleanupAlias);

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_after_cleanup_restart',
          shotIds: ['shot_new'],
          projectAuthority: fixture.projectAuthority,
        })
      ).resolves.toMatchObject({ id: 'request_after_cleanup_restart' });
      await expect(nodeFs.lstat(cleanupAlias)).rejects.toMatchObject({ code: 'ENOENT' });
      const slotEntries = await readdir(fixture.slotsDir);
      expect(slotEntries.filter((name) => /^(?:0|[1-9]\d*)\.slot$/.test(name))).toEqual(['0.slot', '1.slot']);
      expect(slotEntries.filter((name) => name.startsWith('1.slot.') && name.endsWith('.tmp'))).toHaveLength(1);
      expect(slotEntries.filter((name) => name.startsWith('1.slot.') && name.endsWith('.ready'))).toHaveLength(1);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('recovers recognized linked, ready, and losing slot publication phases before reserving again', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const reservedAt = new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString();
    const writeExistingPending = async (requestId: string, shotId: string): Promise<void> => {
      await writeFile(
        path.join(fixture.pendingDir, `${requestId}.json`),
        JSON.stringify(referenceRequestRecordV2(requestId, shotId, REFERENCE_WRITER_NOW_MS_V2))
      );
    };
    const slotBytes = (requestId: string): string =>
      JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION, requestId, reservedAt });
    const writeNext = (requestId: string, shotId: string, recordFs: typeof nodeFs = nodeFs) =>
      referenceRequestWriter.writeReferenceRequestRecordV2({
        pendingDir: fixture.pendingDir,
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        requestId,
        shotIds: [shotId],
        fs: recordFs,
        projectAuthority: fixture.projectAuthority,
      });

    try {
      const linkedRequestId = 'request_linked_phase';
      const linkedSlot = path.join(fixture.slotsDir, '0.slot');
      const linkedTemporary = `${linkedSlot}.12345_12.tmp`;
      const linkedReady = `${linkedSlot}.12345_12.ready`;
      await writeExistingPending(linkedRequestId, 'shot_linked_phase');
      await writeFile(linkedSlot, slotBytes(linkedRequestId));
      await nodeFs.link(linkedSlot, linkedTemporary);
      let linkedReadyRaced = false;
      const linkedRecoveryFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'link') {
            return async (
              existingPath: Parameters<typeof nodeFs.link>[0],
              newPath: Parameters<typeof nodeFs.link>[1]
            ) => {
              if (
                !linkedReadyRaced &&
                path.basename(String(existingPath)) === path.basename(linkedTemporary) &&
                path.basename(String(newPath)) === path.basename(linkedReady)
              ) {
                linkedReadyRaced = true;
                await nodeFs.link(existingPath, newPath);
              }
              return nodeFs.link(existingPath, newPath);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      await expect(
        writeNext('request_after_linked_phase', 'shot_after_linked_phase', linkedRecoveryFs)
      ).resolves.toMatchObject({ id: 'request_after_linked_phase' });
      expect(linkedReadyRaced).toBe(true);
      const linkedIdentities = await Promise.all(
        [linkedSlot, linkedTemporary, linkedReady].map(async (file) => {
          const stats = await nodeFs.lstat(file);
          return { dev: stats.dev, ino: stats.ino };
        })
      );
      expect(new Set(linkedIdentities.map(({ dev, ino }) => `${dev}:${ino}`)).size).toBe(1);

      const readyRequestId = 'request_ready_phase';
      const readySlot = path.join(fixture.slotsDir, '2.slot');
      const readyTemporary = `${readySlot}.12345_13.tmp`;
      const readyPhase = `${readySlot}.12345_13.ready`;
      await writeExistingPending(readyRequestId, 'shot_ready_phase');
      await writeFile(readyTemporary, slotBytes(readyRequestId));
      await nodeFs.link(readyTemporary, readyPhase);
      let readyNamedRaced = false;
      const readyRecoveryFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'link') {
            return async (
              existingPath: Parameters<typeof nodeFs.link>[0],
              newPath: Parameters<typeof nodeFs.link>[1]
            ) => {
              if (
                !readyNamedRaced &&
                path.basename(String(existingPath)) === path.basename(readyPhase) &&
                path.basename(String(newPath)) === path.basename(readySlot)
              ) {
                readyNamedRaced = true;
                await nodeFs.link(existingPath, newPath);
              }
              return nodeFs.link(existingPath, newPath);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });

      await expect(
        writeNext('request_after_ready_phase', 'shot_after_ready_phase', readyRecoveryFs)
      ).resolves.toMatchObject({ id: 'request_after_ready_phase' });
      expect(readyNamedRaced).toBe(true);
      const recoveredReady = await nodeFs.lstat(readySlot);
      const readySource = await nodeFs.lstat(readyPhase);
      expect({ dev: recoveredReady.dev, ino: recoveredReady.ino }).toEqual({
        dev: readySource.dev,
        ino: readySource.ino,
      });

      const winnerRequestId = 'request_slot_winner';
      const loserRequestId = 'request_slot_loser';
      const occupiedSlot = path.join(fixture.slotsDir, '4.slot');
      const losingTemporary = `${occupiedSlot}.12345_14.tmp`;
      await writeExistingPending(winnerRequestId, 'shot_slot_winner');
      await writeFile(occupiedSlot, slotBytes(winnerRequestId));
      await writeFile(losingTemporary, slotBytes(loserRequestId));

      await expect(writeNext('request_after_losing_phase', 'shot_after_losing_phase')).resolves.toMatchObject({
        id: 'request_after_losing_phase',
      });
      await expect(nodeFs.lstat(losingTemporary)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readFile(occupiedSlot, 'utf8')).resolves.toBe(slotBytes(winnerRequestId));
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('leaves an exact cleanup hardlink byte-identical when another family entry is schema-1', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const requestId = 'request_cleanup_mixed_family';
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    const cleanupAlias = `${slotFile}.12345_10.cleanup`;
    const legacySlot = path.join(fixture.slotsDir, '1.slot');
    try {
      await writeFile(
        path.join(fixture.pendingDir, `${requestId}.json`),
        JSON.stringify(referenceRequestRecordV2(requestId, 'shot_existing', REFERENCE_WRITER_NOW_MS_V2))
      );
      await writeFile(
        slotFile,
        JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId,
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        })
      );
      await nodeFs.link(slotFile, cleanupAlias);
      await writeFile(
        legacySlot,
        JSON.stringify({
          schemaVersion: 1,
          requestId: 'legacy_mixed_family',
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        })
      );
      const before = await Promise.all([nodeFs.lstat(slotFile), nodeFs.lstat(cleanupAlias)]);

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_after_mixed_cleanup',
          shotIds: ['shot_new'],
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      const after = await Promise.all([nodeFs.lstat(slotFile), nodeFs.lstat(cleanupAlias)]);
      expect(after.map(({ dev, ino }) => ({ dev, ino }))).toEqual(before.map(({ dev, ino }) => ({ dev, ino })));
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot', '0.slot.12345_10.cleanup', '1.slot']);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('leaves an exact cleanup hardlink untouched when project authority becomes schema-1 before cleanup', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const requestId = 'request_cleanup_authority_race';
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    const cleanupAlias = `${slotFile}.12345_11.cleanup`;
    let fenceCalls = 0;
    const authorityFence = vi.fn(async () => {
      fenceCalls += 1;
      return fenceCalls === 1 ? ('valid' as const) : ('unsupported_prototype_schema' as const);
    });
    try {
      await writeFile(
        path.join(fixture.pendingDir, `${requestId}.json`),
        JSON.stringify(referenceRequestRecordV2(requestId, 'shot_existing', REFERENCE_WRITER_NOW_MS_V2))
      );
      await writeFile(
        slotFile,
        JSON.stringify({
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          requestId,
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        })
      );
      await nodeFs.link(slotFile, cleanupAlias);
      const before = await nodeFs.lstat(cleanupAlias);

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_after_authority_race',
          shotIds: ['shot_new'],
          projectAuthority: fixture.projectAuthority,
          authorityFence,
        })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      expect(authorityFence).toHaveBeenCalledTimes(2);
      const after = await nodeFs.lstat(cleanupAlias);
      expect({ dev: after.dev, ino: after.ino }).toEqual({ dev: before.dev, ino: before.ino });
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot', '0.slot.12345_11.cleanup']);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('rejects a V2 reference record above its own byte limit before queue IO', async () => {
    const fixture = await createReferenceWriterQueueV2();
    try {
      await expect(
        writePendingRecordV2({
          pendingDir: fixture.pendingDir,
          recordId: 'request_too_large',
          record: { padding: 'x'.repeat(STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES) },
          slotRecordKey: 'requestId',
          capacityMessage: 'full',
          tooLargeMessage: 'too large',
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'too_large' });
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('covers V2 proposal, rule, reference, and unavailable handler outcomes without spending', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-v2-handler-outcomes-'));
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
    await createSidecarFamilyV2(projectDir, 'proposals');
    await createSidecarFamilyV2(projectDir, 'reference-requests');
    const project = makeSchema2ServiceProject();
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));
    const config = { projectId: project.id, projectDir, pendingDir, referencePendingDir };

    await expect(createReadStoryboardHandlerV2(null)({})).resolves.toMatchObject({ isError: true });
    await expect(createListRoutesHandler({ ...config, routeCatalog: null })({})).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      createProposeStoryboardHandlerV2(null)({
        base_revision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Unavailable' }],
      })
    ).resolves.toMatchObject({ isError: true });
    const proposed = await createProposeStoryboardHandlerV2(config)({
      base_revision: project.revision,
      operations: [{ kind: 'set_brief', brief: 'Proposed only' }],
    });
    expect(proposed.isError).toBeUndefined();
    expect(proposed.content[0].text).toMatch(/recorded for user review/i);
    await expect(
      createProposeStoryboardHandlerV2(config)({
        base_revision: project.revision - 1,
        operations: [{ kind: 'set_brief', brief: 'Stale' }],
      })
    ).resolves.toMatchObject({ isError: true });

    const ruleHandler = createProposeBriefRuleHandlerV2(config);
    for (const input of [
      { base_revision: project.revision, text: '   ', forbidden_terms: [] },
      { base_revision: project.revision, text: 'x'.repeat(241), forbidden_terms: [] },
      { base_revision: project.revision, text: 'No repeats', forbidden_terms: ['logo', 'logo'] },
      { base_revision: project.revision, text: 'Must be enforceable', forbidden_terms: ['+++'] },
      { base_revision: project.revision - 1, text: 'Stale rule', forbidden_terms: [] },
    ]) {
      // These handler outcomes share one durable inbox and are intentionally observed in order.
      // eslint-disable-next-line no-await-in-loop
      await expect(ruleHandler(input)).resolves.toMatchObject({ isError: true });
    }
    await expect(
      createProposeBriefRuleHandlerV2(null)({ base_revision: 1, text: 'Rule', forbidden_terms: [] })
    ).resolves.toMatchObject({
      isError: true,
    });
    await expect(
      ruleHandler({ base_revision: project.revision, text: 'Keep the palette warm.', forbidden_terms: [] })
    ).resolves.not.toHaveProperty('isError');
    await expect(
      ruleHandler({ base_revision: project.revision, text: 'No competitor logos.', forbidden_terms: ['competitor'] })
    ).resolves.not.toHaveProperty('isError');

    const referenceHandler = createRequestReferenceImagesHandlerV2(config);
    for (const input of [
      { shotIds: null as unknown as string[] },
      { shotIds: [] },
      { shotIds: Array.from({ length: 25 }, (_, index) => `clip_${index}`) },
      { shotIds: ['unsafe/shot'] },
      { shotIds: ['clip_1', 'clip_1'] },
      { shotIds: ['inactive_clip'] },
      { shotIds: ['clip_2', 'clip_1'] },
    ]) {
      // These validation outcomes share one dedup inbox and are intentionally observed in order.
      // eslint-disable-next-line no-await-in-loop
      await expect(referenceHandler(input)).resolves.toMatchObject({ isError: true });
    }
    await expect(createRequestReferenceImagesHandlerV2(null)({ shotIds: ['clip_1'] })).resolves.toMatchObject({
      isError: true,
    });
    const queued = await referenceHandler({ shotIds: ['clip_1', 'clip_2'] });
    expect(queued.content[0].text).toMatch(/Queued 2 of 2.*Nothing was generated/i);
    const repeated = await referenceHandler({ shotIds: ['clip_1', 'clip_2'] });
    expect(repeated.content[0].text).toMatch(/Queued 0 of 2.*Already queued: clip_1, clip_2/i);
    const referenceEntries = await readdir(referencePendingDir);
    expect(referenceEntries.filter((name) => name.endsWith('.json'))).toHaveLength(1);
    expect(referenceEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
    expect(referenceEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
    await rm(projectDir, { recursive: true, force: true });
  });

  it('refuses a new proposed rule when the durable project already holds the rule cap', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-v2-rule-cap-'));
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
    await createSidecarFamilyV2(projectDir, 'proposals');
    const project = makeSchema2ServiceProject();
    project.rules = Array.from({ length: STUDIO_RULE_LIMITS.maxRules }, (_, index) => ({
      id: `rule_${index + 1}`,
      scope: 'project' as const,
      text: `Keep authored rule ${index + 1}.`,
      predicate: null,
      createdAt: '2026-08-17T00:00:00.000Z',
    }));
    await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(project));

    try {
      const result = await createProposeBriefRuleHandlerV2({
        projectId: project.id,
        projectDir,
        pendingDir,
        referencePendingDir,
      })({ base_revision: project.revision, text: 'One rule too many.', forbidden_terms: [] });

      expect(result).toMatchObject({ isError: true });
      expect(result.content[0].text).toContain(`maximum of ${STUDIO_RULE_LIMITS.maxRules} rules`);
      await expect(readdir(pendingDir)).resolves.toEqual([]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each(['pending_basename', 'family_name', 'project_root'] as const)(
    'rejects the unsafe V2 pending path boundary: %s',
    async (boundary) => {
      const base = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-path-'));
      let pendingDir: string;
      if (boundary === 'pending_basename') {
        pendingDir = path.join(base, 'proposals', 'inbox');
      } else if (boundary === 'family_name') {
        pendingDir = path.join(base, 'unsafe.family', 'pending');
      } else {
        const projectRoot = path.join(base, 'project-file');
        await writeFile(projectRoot, 'unchanged project-root sentinel');
        pendingDir = path.join(projectRoot, 'proposals', 'pending');
      }
      const beforeEntries = (await readdir(base)).toSorted();

      try {
        await expect(writePendingRecordV2(pendingRequestInputV2(pendingDir))).rejects.toMatchObject({
          code: 'storage',
        });
        await expect(readdir(base)).resolves.toEqual(beforeEntries);
        if (boundary === 'project_root') {
          await expect(readFile(path.join(base, 'project-file'), 'utf8')).resolves.toBe(
            'unchanged project-root sentinel'
          );
        }
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    }
  );

  it('repairs an interrupted occupied-slot collision before the next V2 publication', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const occupiedId = 'occupied_slot_request';
    const interruptedId = 'interrupted_slot_request';
    const projectAuthority = await capturePendingProjectAuthorityV2(fixture.projectRoot);
    let cleanupFailed = false;
    await writeFile(
      path.join(fixture.pendingDir, `${occupiedId}.json`),
      JSON.stringify(referenceRequestRecordV2(occupiedId, 'shot_occupied', REFERENCE_WRITER_NOW_MS_V2))
    );
    await writeFile(
      path.join(fixture.slotsDir, '0.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: occupiedId,
        reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
      })
    );
    const interruptedCleanupFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'rm') {
          return async (file: Parameters<typeof nodeFs.rm>[0], options?: Parameters<typeof nodeFs.rm>[1]) => {
            if (
              !cleanupFailed &&
              String(file).includes(`${path.sep}slots${path.sep}0.slot.`) &&
              String(file).endsWith('.ready')
            ) {
              cleanupFailed = true;
              throw Object.assign(new Error('injected occupied-slot cleanup interruption'), { code: 'EIO' });
            }
            return nodeFs.rm(file, options);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir, interruptedId),
          record: referenceRequestRecordV2(interruptedId, 'shot_interrupted', REFERENCE_WRITER_NOW_MS_V2),
          fs: interruptedCleanupFs,
          projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(cleanupFailed).toBe(true);
      expect((await readdir(fixture.slotsDir)).filter((name) => name.startsWith('0.slot.')).toSorted()).toEqual([
        expect.stringMatching(/\.ready$/),
        expect.stringMatching(/\.tmp$/),
      ]);

      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir, 'request_after_interrupted_collision'),
          record: referenceRequestRecordV2(
            'request_after_interrupted_collision',
            'shot_after_interrupted',
            REFERENCE_WRITER_NOW_MS_V2
          ),
          projectAuthority,
        })
      ).resolves.toMatchObject({ id: 'request_after_interrupted_collision' });
      const finalSlots = await readdir(fixture.slotsDir);
      expect(finalSlots.filter((name) => name.startsWith('0.slot.'))).toEqual([]);
      expect(finalSlots.filter((name) => /^(?:0|[1-9]\d*)\.slot$/.test(name)).toSorted()).toEqual(['0.slot', '1.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('repairs an interrupted same-ID pending collision before the next V2 publication', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const interruptedId = 'interrupted_pending_request';
    const canonicalFile = path.join(await nodeFs.realpath(fixture.pendingDir), `${interruptedId}.json`);
    const winner = referenceRequestRecordV2(interruptedId, 'shot_winner', REFERENCE_WRITER_NOW_MS_V2 + 1_000);
    const projectAuthority = await capturePendingProjectAuthorityV2(fixture.projectRoot);
    let winnerInstalled = false;
    let cleanupFailed = false;
    const interruptedCleanupFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            if (!winnerInstalled && String(newPath) === canonicalFile && String(existingPath).endsWith('.ready')) {
              winnerInstalled = true;
              await writeFile(canonicalFile, JSON.stringify(winner));
            }
            return nodeFs.link(existingPath, newPath);
          };
        }
        if (property === 'rm') {
          return async (file: Parameters<typeof nodeFs.rm>[0], options?: Parameters<typeof nodeFs.rm>[1]) => {
            if (
              winnerInstalled &&
              !cleanupFailed &&
              String(file).startsWith(`${canonicalFile}.`) &&
              String(file).endsWith('.ready')
            ) {
              cleanupFailed = true;
              throw Object.assign(new Error('injected pending cleanup interruption'), { code: 'EIO' });
            }
            return nodeFs.rm(file, options);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir, interruptedId),
          record: referenceRequestRecordV2(interruptedId, 'shot_loser', REFERENCE_WRITER_NOW_MS_V2),
          fs: interruptedCleanupFs,
          projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
      expect({ winnerInstalled, cleanupFailed }).toEqual({ winnerInstalled: true, cleanupFailed: true });
      expect(
        (await readdir(fixture.pendingDir)).filter((name) => name.startsWith(`${interruptedId}.json.`)).toSorted()
      ).toEqual([expect.stringMatching(/\.ready$/), expect.stringMatching(/\.tmp$/)]);
      const winnerBeforeRecovery = await nodeFs.lstat(canonicalFile);

      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir, 'request_after_pending_collision'),
          record: referenceRequestRecordV2(
            'request_after_pending_collision',
            'shot_after_pending_collision',
            REFERENCE_WRITER_NOW_MS_V2
          ),
          projectAuthority,
        })
      ).resolves.toMatchObject({ id: 'request_after_pending_collision' });
      const winnerAfterRecovery = await nodeFs.lstat(canonicalFile);
      expect({ dev: winnerAfterRecovery.dev, ino: winnerAfterRecovery.ino }).toEqual({
        dev: winnerBeforeRecovery.dev,
        ino: winnerBeforeRecovery.ino,
      });
      await expect(readFile(canonicalFile, 'utf8')).resolves.toBe(JSON.stringify(winner));
      expect((await readdir(fixture.pendingDir)).filter((name) => name.startsWith(`${interruptedId}.json.`))).toEqual(
        []
      );
      expect(
        (await readdir(fixture.slotsDir)).filter((name) => /^(?:0|[1-9]\d*)\.slot$/.test(name)).toSorted()
      ).toEqual(['0.slot', '1.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['proposal', 'proposals', 'proposalId'],
    ['reference', 'reference-requests', 'requestId'],
    ['arbitrary', 'other-family', 'requestId'],
  ] as const)('rejects a partial or unowned V2 %s sidecar family before publication', async (_label, family, key) => {
    const projectRoot = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-partial-'));
    const familyRoot = path.join(projectRoot, family);
    const pendingDir = path.join(familyRoot, 'pending');
    const slotsDir = path.join(familyRoot, 'slots');
    await mkdir(pendingDir, { recursive: true });
    await mkdir(slotsDir);
    try {
      await expect(
        writePendingRecordV2({
          pendingDir,
          recordId: 'partial_family_record',
          record: { marker: 'unchanged' },
          slotRecordKey: key,
          capacityMessage: 'full',
          tooLargeMessage: 'too large',
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(readdir(pendingDir)).resolves.toEqual([]);
      await expect(readdir(slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects an extra child in an otherwise complete V2 sidecar family', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const extraDir = path.join(path.dirname(fixture.pendingDir), 'foreign-child');
    await mkdir(extraDir);
    try {
      await expect(writePendingRecordV2(pendingRequestInputV2(fixture.pendingDir))).rejects.toMatchObject({
        code: 'storage',
      });
      await expect(readdir(extraDir)).resolves.toEqual([]);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects a new record id already named by a terminal family entry before reserving a slot', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_terminal_collision';
    const decisionFile = path.join(path.dirname(fixture.pendingDir), 'decisions', `${recordId}.json`);
    await writeFile(decisionFile, 'terminal sentinel');
    try {
      await expect(writePendingRecordV2(pendingRequestInputV2(fixture.pendingDir, recordId))).rejects.toMatchObject({
        code: 'storage',
      });
      await expect(readFile(decisionFile, 'utf8')).resolves.toBe('terminal sentinel');
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'schema-1',
      JSON.stringify({
        schemaVersion: 1,
        requestId: 'request_legacy_terminal',
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        outcome: { kind: 'rejected' },
      }),
      'unsupported_prototype_schema',
    ],
    [
      'malformed schema-2',
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'different_request',
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        outcome: { kind: 'rejected' },
      }),
      'storage',
    ],
  ] as const)('rejects an unrelated %s terminal authority before queue IO', async (_label, bytes, expectedCode) => {
    const fixture = await createPendingQueueFixtureV2();
    const decisionFile = path.join(path.dirname(fixture.pendingDir), 'decisions', 'request_legacy_terminal.json');
    await writeFile(decisionFile, bytes);
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir),
          record: { marker: 'new request', projectId: REFERENCE_WRITER_PROJECT_ID_V2 },
        })
      ).rejects.toMatchObject({ code: expectedCode });
      await expect(readFile(decisionFile, 'utf8')).resolves.toBe(bytes);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('does not promote a ready pending record from a malformed terminal filename', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const requestId = 'request_invalid_terminal_promotion';
    const phase = await stageReadyReferenceRequestV2(fixture.pendingDir, requestId);
    const decisionFile = path.join(path.dirname(fixture.pendingDir), 'decisions', `${requestId}.json`);
    await writeFile(
      decisionFile,
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId,
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2 + 1_000).toISOString(),
        outcome: { kind: 'generation_gate' },
      })
    );
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir),
          record: { marker: 'new request', projectId: REFERENCE_WRITER_PROJECT_ID_V2 },
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(nodeFs.lstat(phase.canonicalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(fixture.pendingDir)).toSorted()).toEqual(
        [path.basename(phase.readyFile), path.basename(phase.temporaryFile)].toSorted()
      );
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['predating rejection', 'rejected', REFERENCE_WRITER_NOW_MS_V2 - 1],
    ['early expiry', 'expired', REFERENCE_WRITER_NOW_MS_V2 + STUDIO_PROPOSAL_V2_PENDING_TTL_MS - 1],
  ] as const)('does not promote a ready proposal from a %s decision', async (_label, status, decidedAtMs) => {
    const fixture = await createProposalQueueFixtureV2();
    const proposalId = `proposal_invalid_${status}`;
    const phase = await stageReadyProposalV2(fixture.pendingDir, proposalId);
    await writeFile(
      path.join(path.dirname(fixture.pendingDir), 'decisions', `${proposalId}.json`),
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        proposalId,
        status,
        decidedAt: new Date(decidedAtMs).toISOString(),
      })
    );
    try {
      const nextId = `proposal_after_invalid_${status}`;
      await expect(
        writePendingRecordV2({
          pendingDir: fixture.pendingDir,
          recordId: nextId,
          record: proposalRecordV2(nextId, REFERENCE_WRITER_NOW_MS_V2),
          slotRecordKey: 'proposalId',
          capacityMessage: 'full',
          tooLargeMessage: 'too large',
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(nodeFs.lstat(phase.canonicalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(fixture.pendingDir)).toSorted()).toEqual(
        [path.basename(phase.readyFile), path.basename(phase.temporaryFile)].toSorted()
      );
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each(['predating rejection', 'early expiry', 'wrong generation shots'] as const)(
    'does not promote a ready reference request from a %s decision',
    async (variant) => {
      const fixture = await createPendingQueueFixtureV2();
      const requestId = `request_invalid_${variant.replaceAll(' ', '_')}`;
      const handoffId = `handoff_${requestId}`;
      const phase = await stageReadyReferenceRequestV2(fixture.pendingDir, requestId);
      const decision =
        variant === 'predating rejection'
          ? {
              schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
              requestId,
              projectId: REFERENCE_WRITER_PROJECT_ID_V2,
              decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2 - 1).toISOString(),
              outcome: { kind: 'rejected' as const },
            }
          : variant === 'early expiry'
            ? {
                schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
                requestId,
                projectId: REFERENCE_WRITER_PROJECT_ID_V2,
                decidedAt: new Date(
                  REFERENCE_WRITER_NOW_MS_V2 + STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS - 1
                ).toISOString(),
                outcome: { kind: 'expired' as const },
              }
            : referenceDecisionV2(requestId, {
                kind: 'generation_gate',
                handoffId,
                shotIds: ['shot_different'],
              });
      await writeFile(
        path.join(path.dirname(fixture.pendingDir), 'decisions', `${requestId}.json`),
        JSON.stringify(decision)
      );
      if (variant === 'wrong generation shots') {
        await writeFile(
          path.join(path.dirname(fixture.pendingDir), 'receipts', `${handoffId}.json`),
          JSON.stringify(referenceReceiptV2(requestId, handoffId))
        );
      }
      try {
        const nextId = `request_after_${requestId}`;
        await expect(
          writePendingRecordV2({
            ...pendingRequestInputV2(fixture.pendingDir, nextId),
            record: referenceRequestRecordV2(nextId, 'shot_new', REFERENCE_WRITER_NOW_MS_V2),
          })
        ).rejects.toMatchObject({ code: 'storage' });
        await expect(nodeFs.lstat(phase.canonicalFile)).rejects.toMatchObject({ code: 'ENOENT' });
        expect((await readdir(fixture.pendingDir)).toSorted()).toEqual(
          [path.basename(phase.readyFile), path.basename(phase.temporaryFile)].toSorted()
        );
        await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
      } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
      }
    }
  );

  it('keeps a generation-gated ready request live until its exact receipt exists', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const requestId = 'request_open_generation_gate';
    const handoffId = 'handoff_open_generation_gate';
    const phase = await stageReadyReferenceRequestV2(fixture.pendingDir, requestId);
    await writeFile(
      path.join(path.dirname(fixture.pendingDir), 'decisions', `${requestId}.json`),
      JSON.stringify(referenceDecisionV2(requestId, { kind: 'generation_gate', handoffId, shotIds: ['shot_existing'] }))
    );
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir),
          record: { marker: 'new request', projectId: REFERENCE_WRITER_PROJECT_ID_V2 },
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(nodeFs.lstat(phase.canonicalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(fixture.pendingDir)).toSorted()).toEqual(
        [path.basename(phase.readyFile), path.basename(phase.temporaryFile)].toSorted()
      );
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('promotes a ready generation-gated request only from an exact decision and receipt journal pair', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const requestId = 'request_completed_generation_gate';
    const handoffId = 'handoff_completed_generation_gate';
    const phase = await stageReadyReferenceRequestV2(fixture.pendingDir, requestId);
    const decisionsDir = path.join(path.dirname(fixture.pendingDir), 'decisions');
    const receiptsDir = path.join(path.dirname(fixture.pendingDir), 'receipts');
    const decisionFile = path.join(decisionsDir, `${requestId}.json`);
    const receiptFile = path.join(receiptsDir, `${handoffId}.json`);
    await writeFile(
      decisionFile,
      JSON.stringify(referenceDecisionV2(requestId, { kind: 'generation_gate', handoffId, shotIds: ['shot_existing'] }))
    );
    await nodeFs.link(decisionFile, `${decisionFile}.publish`);
    await writeFile(receiptFile, JSON.stringify(referenceReceiptV2(requestId, handoffId)));
    await nodeFs.link(receiptFile, `${receiptFile}.publish`);
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir),
          record: { marker: 'new request', projectId: REFERENCE_WRITER_PROJECT_ID_V2 },
        })
      ).resolves.toMatchObject({ marker: 'new request' });
      await expect(readFile(phase.canonicalFile, 'utf8')).resolves.toBe(
        JSON.stringify(referenceRequestRecordV2(requestId, 'shot_existing', REFERENCE_WRITER_NOW_MS_V2))
      );
      await expect(nodeFs.lstat(`${decisionFile}.publish`)).resolves.toMatchObject({ isFile: expect.any(Function) });
      await expect(nodeFs.lstat(`${receiptFile}.publish`)).resolves.toMatchObject({ isFile: expect.any(Function) });
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rejects a receipt that is not bound to its generation-gate request without promoting ready data', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const requestId = 'request_mismatched_generation_receipt';
    const handoffId = 'handoff_mismatched_generation_receipt';
    const phase = await stageReadyReferenceRequestV2(fixture.pendingDir, requestId);
    await writeFile(
      path.join(path.dirname(fixture.pendingDir), 'decisions', `${requestId}.json`),
      JSON.stringify(referenceDecisionV2(requestId, { kind: 'generation_gate', handoffId, shotIds: ['shot_existing'] }))
    );
    await writeFile(
      path.join(path.dirname(fixture.pendingDir), 'receipts', `${handoffId}.json`),
      JSON.stringify(referenceReceiptV2('different_request', handoffId))
    );
    try {
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir),
          record: { marker: 'new request', projectId: REFERENCE_WRITER_PROJECT_ID_V2 },
        })
      ).rejects.toMatchObject({ code: 'storage' });
      await expect(nodeFs.lstat(phase.canonicalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      expect((await readdir(fixture.pendingDir)).toSorted()).toEqual(
        [path.basename(phase.readyFile), path.basename(phase.temporaryFile)].toSorted()
      );
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('freezes terminal record bytes and inode identity through the final publication fence', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const terminalRequestId = 'request_terminal_byte_fence';
    const pendingFile = path.join(fixture.pendingDir, `${terminalRequestId}.json`);
    const decisionFile = path.join(path.dirname(fixture.pendingDir), 'decisions', `${terminalRequestId}.json`);
    const decisionBytes = JSON.stringify(referenceDecisionV2(terminalRequestId, { kind: 'rejected' }));
    await writeFile(
      pendingFile,
      JSON.stringify(referenceRequestRecordV2(terminalRequestId, 'shot_existing', REFERENCE_WRITER_NOW_MS_V2))
    );
    await writeFile(decisionFile, decisionBytes);
    let originalIdentity: { dev: number; ino: number } | null = null;
    let mutatedIdentity: { dev: number; ino: number } | null = null;
    const authorityFence = vi.fn(async () => {
      if (originalIdentity === null && (await readdir(fixture.pendingDir)).some((name) => name.endsWith('.tmp'))) {
        const before = await nodeFs.lstat(decisionFile);
        originalIdentity = { dev: before.dev, ino: before.ino };
        await writeFile(decisionFile, decisionBytes.replace('rejected', 'expired'));
        const after = await nodeFs.lstat(decisionFile);
        mutatedIdentity = { dev: after.dev, ino: after.ino };
      }
      return 'valid' as const;
    });
    try {
      const recordId = 'request_after_terminal_byte_race';
      await expect(
        writePendingRecordV2({
          ...pendingRequestInputV2(fixture.pendingDir, recordId),
          record: { marker: recordId, projectId: REFERENCE_WRITER_PROJECT_ID_V2 },
          authorityFence,
        })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(originalIdentity).toEqual(mutatedIdentity);
      await expect(nodeFs.lstat(path.join(fixture.pendingDir, `${recordId}.json`))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('freezes terminal entry-name snapshots through the final pending publication fence', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const receiptsDir = path.join(path.dirname(fixture.pendingDir), 'receipts');
    const terminalFile = path.join(receiptsDir, 'unrelated_handoff.json');
    let fenceCalls = 0;
    let installedTerminal = false;
    const authorityFence = vi.fn(async () => {
      fenceCalls += 1;
      if (!installedTerminal && (await readdir(fixture.pendingDir)).some((name) => name.endsWith('.tmp'))) {
        installedTerminal = true;
        await writeFile(terminalFile, 'late terminal sentinel');
      }
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(installedTerminal).toBe(true);
      expect(fenceCalls).toBeGreaterThan(3);
      await expect(readFile(terminalFile, 'utf8')).resolves.toBe('late terminal sentinel');
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['unsupported prototype', 'unsupported_prototype_schema', 'unsupported_prototype_schema'],
    ['invalid authority', 'invalid', 'storage'],
  ] as const)('rejects a %s authority result before reserving a V2 slot', async (_label, status, expectedCode) => {
    const fixture = await createPendingQueueFixtureV2();
    const authorityFence = vi.fn(async () => status);
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: expectedCode });
      expect(authorityFence).toHaveBeenCalledOnce();
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('retains recoverable reservation authority when schema-2 authority is revoked before publication', async () => {
    const fixture = await createPendingQueueFixtureV2();
    let revoked = false;
    const authorityFence = vi.fn(async () => {
      if (!revoked && (await readdir(fixture.pendingDir)).some((name) => name.endsWith('.tmp'))) revoked = true;
      return revoked ? ('unsupported_prototype_schema' as const) : ('valid' as const);
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      expect(revoked).toBe(true);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      const slotEntries = await readdir(fixture.slotsDir);
      expect(slotEntries.filter((name) => name === '0.slot')).toEqual(['0.slot']);
      expect(slotEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
      expect(slotEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves an unsupported authority result when its reservation was concurrently reaped', async () => {
    const fixture = await createPendingQueueFixtureV2();
    let revoked = false;
    const authorityFence = vi.fn(async () => {
      if (!revoked && (await readdir(fixture.pendingDir)).some((name) => name.endsWith('.tmp'))) {
        revoked = true;
        await rm(path.join(fixture.slotsDir, '0.slot'));
      }
      return revoked ? ('unsupported_prototype_schema' as const) : ('valid' as const);
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      const slotEntries = await readdir(fixture.slotsDir);
      expect(slotEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
      expect(slotEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rescans the complete family at the final publication fence and preserves a late V1 slot', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const legacySlot = path.join(fixture.slotsDir, '1.slot');
    const legacyBytes = JSON.stringify({
      schemaVersion: 1,
      requestId: 'late_legacy_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let fenceCalls = 0;
    const authorityFence = vi.fn(async () => {
      fenceCalls += 1;
      if (fenceCalls === 4) await writeFile(legacySlot, legacyBytes);
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'unsupported_prototype_schema' });
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readFile(legacySlot, 'utf8')).resolves.toBe(legacyBytes);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['1.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves a valid replacement when its reserved slot inode changes before final publication', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'other_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let replaced = false;
    const authorityFence = vi.fn(async () => {
      if (!replaced && (await readdir(fixture.pendingDir)).some((name) => name.endsWith('.tmp'))) {
        replaced = true;
        await rm(slotFile);
        await writeFile(slotFile, replacement);
      }
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(replaced).toBe(true);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rechecks its exact reserved slot after syncing the pending temp and immediately before linking', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_prelink_recheck';
    const slotFile = path.join(await nodeFs.realpath(fixture.slotsDir), '0.slot');
    const finalFile = path.join(await nodeFs.realpath(fixture.pendingDir), `${recordId}.json`);
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'other_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let replaced = false;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'open') {
          return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
            const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
            const fileName = String(file);
            if (!fileName.startsWith(`${finalFile}.`) || !fileName.endsWith('.tmp')) return handle;
            return new Proxy(handle, {
              get(current, key, currentReceiver) {
                if (key === 'sync') {
                  return async () => {
                    await current.sync();
                    if (!replaced) {
                      replaced = true;
                      await rm(slotFile);
                      await writeFile(slotFile, replacement);
                    }
                  };
                }
                const value = Reflect.get(current, key, currentReceiver) as unknown;
                return typeof value === 'function' ? value.bind(current) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: racingFs })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(replaced).toBe(true);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rechecks the pending temporary after the final async authority fence and preserves a replacement', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_temp_recheck';
    const replacementBytes = 'replacement temp bytes';
    let temporaryFile: string | null = null;
    const authorityFence = vi.fn(async () => {
      if (temporaryFile === null) {
        const temporaryName = (await readdir(fixture.pendingDir)).find((name) => name.endsWith('.tmp'));
        if (temporaryName === undefined) return 'valid' as const;
        temporaryFile = path.join(fixture.pendingDir, temporaryName);
        await rm(temporaryFile);
        await writeFile(temporaryFile, replacementBytes);
      }
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), authorityFence })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(temporaryFile).not.toBeNull();
      await expect(readFile(temporaryFile!, 'utf8')).resolves.toBe(replacementBytes);
      await expect(nodeFs.lstat(path.join(fixture.pendingDir, `${recordId}.json`))).rejects.toMatchObject({
        code: 'ENOENT',
      });
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('rechecks exact pending temporary bytes after the final async authority fence', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_temp_bytes_recheck';
    const finalFile = path.join(fixture.pendingDir, `${recordId}.json`);
    let temporaryFile: string | null = null;
    let originalIdentity: { dev: number; ino: number } | null = null;
    let mutatedIdentity: { dev: number; ino: number } | null = null;
    const authorityFence = vi.fn(async () => {
      if (temporaryFile === null) {
        const temporaryName = (await readdir(fixture.pendingDir)).find((name) => name.endsWith('.tmp'));
        if (temporaryName === undefined) return 'valid' as const;
        temporaryFile = path.join(fixture.pendingDir, temporaryName);
        const originalBytes = await readFile(temporaryFile, 'utf8');
        const before = await nodeFs.lstat(temporaryFile);
        originalIdentity = { dev: before.dev, ino: before.ino };
        await writeFile(temporaryFile, 'x'.repeat(Buffer.byteLength(originalBytes, 'utf8')));
        const after = await nodeFs.lstat(temporaryFile);
        mutatedIdentity = { dev: after.dev, ino: after.ino };
      }
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), authorityFence })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(originalIdentity).toEqual(mutatedIdentity);
      await expect(nodeFs.lstat(finalFile)).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('fences every V2 sidecar directory generation at the final publication boundary', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const familyRoot = path.dirname(fixture.pendingDir);
    const receiptsDir = path.join(familyRoot, 'receipts');
    const displacedReceiptsDir = path.join(familyRoot, 'receipts-original');
    const sentinel = path.join(receiptsDir, 'replacement.sentinel');
    let replacedDirectory = false;
    const authorityFence = vi.fn(async () => {
      if (!replacedDirectory && (await readdir(fixture.pendingDir)).some((name) => name.endsWith('.tmp'))) {
        replacedDirectory = true;
        await nodeFs.rename(receiptsDir, displacedReceiptsDir);
        await mkdir(receiptsDir);
        await writeFile(sentinel, 'replacement bytes');
      }
      return 'valid' as const;
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), authorityFence })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(replacedDirectory).toBe(true);
      await expect(readFile(sentinel, 'utf8')).resolves.toBe('replacement bytes');
      await expect(readdir(displacedReceiptsDir)).resolves.toEqual([]);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      const slotEntries = await readdir(fixture.slotsDir);
      expect(slotEntries.filter((name) => name === '0.slot')).toEqual(['0.slot']);
      expect(slotEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
      expect(slotEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('preserves a replacement raced into exact-slot hardlink cleanup', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'request_cleanup_restore';
    const canonicalSlots = await nodeFs.realpath(fixture.slotsDir);
    const canonicalPending = await nodeFs.realpath(fixture.pendingDir);
    const slotFile = path.join(canonicalSlots, '0.slot');
    const finalFile = path.join(canonicalPending, `${recordId}.json`);
    const replacement = JSON.stringify({
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
      requestId: 'other_request',
      reservedAt: '2026-08-17T00:00:00.000Z',
    });
    let installedFinal = false;
    let installedReplacement = false;
    let restoredDirectorySyncs = 0;
    const racingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            if (!installedReplacement && String(existingPath) === slotFile && String(newPath).endsWith('.cleanup')) {
              installedReplacement = true;
              await rm(slotFile);
              await writeFile(slotFile, replacement);
            }
            await nodeFs.link(existingPath, newPath);
            if (!installedFinal && String(newPath) === slotFile) {
              installedFinal = true;
              await writeFile(finalFile, JSON.stringify({ schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION }));
            }
          };
        }
        if (property === 'open') {
          return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
            const handle = await Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
            if (String(file) !== canonicalSlots) return handle;
            return new Proxy(handle, {
              get(current, key, currentReceiver) {
                if (key === 'sync') {
                  return async () => {
                    await current.sync();
                    if (installedReplacement) restoredDirectorySyncs += 1;
                  };
                }
                const value = Reflect.get(current, key, currentReceiver) as unknown;
                return typeof value === 'function' ? value.bind(current) : value;
              },
            });
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: racingFs })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(installedFinal).toBe(true);
      expect(installedReplacement).toBe(true);
      expect(restoredDirectorySyncs).toBeGreaterThan(0);
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(replacement);
      expect((await readdir(fixture.slotsDir)).filter((name) => name.endsWith('.cleanup'))).toEqual([]);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    ['primitive', 'null', 'storage'],
    ['missing version', JSON.stringify({ requestId: 'missing_version' }), 'storage'],
    [
      'unknown version',
      JSON.stringify({ schemaVersion: 99, requestId: 'unknown_version', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'storage',
    ],
    [
      'schema-1 request slot',
      JSON.stringify({ schemaVersion: 1, requestId: 'legacy_request', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'unsupported_prototype_schema',
    ],
    [
      'malformed schema-2 request slot',
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'unsafe/request',
        reservedAt: '2026-08-17T00:00:00.000Z',
      }),
      'storage',
    ],
  ] as const)('rejects a %s without changing the V2 queue', async (_label, slotBytes, expectedCode) => {
    const fixture = await createPendingQueueFixtureV2();
    const slotFile = path.join(fixture.slotsDir, '0.slot');
    await writeFile(slotFile, slotBytes);
    try {
      await expect(writePendingRecordV2(pendingRequestInputV2(fixture.pendingDir))).rejects.toMatchObject({
        code: expectedCode,
      });
      await expect(readFile(slotFile, 'utf8')).resolves.toBe(slotBytes);
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('classifies a slot-backed schema-1 pending record before publishing V2 queue authority', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const requestId = 'legacy_pending_request';
    const pendingBytes = JSON.stringify({
      schemaVersion: 1,
      id: requestId,
      projectId: REFERENCE_WRITER_PROJECT_ID_V2,
      sceneId: 'legacy_scene',
      status: 'pending',
      createdAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
    });
    await writeFile(path.join(fixture.pendingDir, `${requestId}.json`), pendingBytes);
    await writeFile(
      path.join(fixture.slotsDir, '0.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId,
        reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
      })
    );
    try {
      await expect(writePendingRecordV2(pendingRequestInputV2(fixture.pendingDir))).rejects.toMatchObject({
        code: 'unsupported_prototype_schema',
      });
      await expect(readFile(path.join(fixture.pendingDir, `${requestId}.json`), 'utf8')).resolves.toBe(pendingBytes);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it.each([
    [
      'schema-1',
      JSON.stringify({ schemaVersion: 1, requestId: 'late_legacy', reservedAt: '2026-08-17T00:00:00.000Z' }),
      'unsupported_prototype_schema',
    ],
    [
      'malformed schema-2',
      JSON.stringify({
        schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
        requestId: 'unsafe/late',
        reservedAt: '2026-08-17T00:00:00.000Z',
      }),
      'storage',
    ],
  ] as const)(
    'classifies a late %s request-slot collision without overwriting it',
    async (_label, installedBytes, expectedCode) => {
      const fixture = await createPendingQueueFixtureV2();
      const slotFile = path.join(fixture.slotsDir, '0.slot');
      let installed = false;
      const collisionFs = new Proxy(nodeFs, {
        get(target, property, receiver) {
          if (property === 'link') {
            return async (
              existingPath: Parameters<typeof nodeFs.link>[0],
              newPath: Parameters<typeof nodeFs.link>[1]
            ) => {
              if (!installed && String(newPath).endsWith(`${path.sep}slots${path.sep}0.slot`)) {
                installed = true;
                await writeFile(slotFile, installedBytes, { flag: 'wx' });
                throw Object.assign(new Error('late slot collision'), { code: 'EEXIST' });
              }
              return Reflect.apply(nodeFs.link, nodeFs, [existingPath, newPath]);
            };
          }
          const value = Reflect.get(target, property, receiver) as unknown;
          return typeof value === 'function' ? value.bind(target) : value;
        },
      });
      try {
        await expect(
          writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir), fs: collisionFs })
        ).rejects.toMatchObject({ code: expectedCode });
        expect(installed).toBe(true);
        await expect(readFile(slotFile, 'utf8')).resolves.toBe(installedBytes);
        await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
        await expect(readdir(fixture.slotsDir)).resolves.toEqual(['0.slot']);
      } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
      }
    }
  );

  it.each([
    ['ambiguous link-attempt storage failure', 'storage', false],
    ['late schema-1 record collision', 'unsupported_prototype_schema', true],
  ] as const)('fails closed on a %s after reserving a V2 slot', async (_label, expectedCode, installLegacyRecord) => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = installLegacyRecord ? 'late_record_collision' : 'pre_link_failure';
    const recordFile = path.join(fixture.pendingDir, `${recordId}.json`);
    const legacyBytes = JSON.stringify({ schemaVersion: 1, id: recordId });
    let failed = false;
    const failingFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            if (
              !failed &&
              path.basename(String(newPath)) === `${recordId}.json` &&
              path.basename(path.dirname(String(newPath))) === 'pending'
            ) {
              failed = true;
              if (installLegacyRecord) await writeFile(recordFile, legacyBytes, { flag: 'wx' });
              throw Object.assign(new Error('injected final publication failure'), {
                code: installLegacyRecord ? 'EEXIST' : 'EIO',
              });
            }
            return Reflect.apply(nodeFs.link, nodeFs, [existingPath, newPath]);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: failingFs })
      ).rejects.toMatchObject({ code: expectedCode });
      expect(failed).toBe(true);
      if (installLegacyRecord) {
        await expect(readFile(recordFile, 'utf8')).resolves.toBe(legacyBytes);
        const slotEntries = await readdir(fixture.slotsDir);
        expect(slotEntries.filter((name) => name === '0.slot')).toEqual(['0.slot']);
        expect(slotEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
        expect(slotEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
      } else {
        const pendingEntries = await readdir(fixture.pendingDir);
        expect(pendingEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
        expect(pendingEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
        const slotEntries = await readdir(fixture.slotsDir);
        expect(slotEntries.filter((name) => name === '0.slot')).toEqual(['0.slot']);
        expect(slotEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
        expect(slotEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
      }
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('retains the exact pending record and slot when the final link takes effect before reporting EIO', async () => {
    const fixture = await createPendingQueueFixtureV2();
    const recordId = 'pending_link_effect';
    const recordFile = path.join(await nodeFs.realpath(fixture.pendingDir), `${recordId}.json`);
    let failedAfterEffect = false;
    const ambiguousFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            await nodeFs.link(existingPath, newPath);
            if (!failedAfterEffect && String(newPath) === recordFile) {
              failedAfterEffect = true;
              throw Object.assign(new Error('link result was ambiguous'), { code: 'EIO' });
            }
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        writePendingRecordV2({ ...pendingRequestInputV2(fixture.pendingDir, recordId), fs: ambiguousFs })
      ).rejects.toMatchObject({ code: 'storage' });
      expect(failedAfterEffect).toBe(true);
      await expect(readFile(recordFile, 'utf8')).resolves.toBe(JSON.stringify({ marker: recordId }));
      const slotEntries = await readdir(fixture.slotsDir);
      expect(slotEntries.filter((name) => name === '0.slot')).toEqual(['0.slot']);
      expect(slotEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(1);
      expect(slotEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(1);
    } finally {
      await rm(fixture.projectRoot, { recursive: true, force: true });
    }
  });

  it('bounds pending-record capacity, size, and storage failures behind typed errors', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-pending-v2-'));
    const pendingDir = path.join(projectDir, 'pending');
    const slotsDir = path.join(projectDir, 'slots');
    await mkdir(pendingDir);
    await mkdir(slotsDir);
    const input = (recordId: string, record: unknown) => ({
      pendingDir,
      recordId,
      record,
      slotRecordKey: 'proposalId' as const,
      capacityMessage: 'full',
      tooLargeMessage: 'too large',
    });

    await expect(writePendingRecordV2(input('oversize', { text: 'x'.repeat(256 * 1024) }))).rejects.toMatchObject({
      code: 'too_large',
    });
    await rm(slotsDir, { recursive: true });
    await expect(writePendingRecordV2(input('missing_slots', { ok: true }))).rejects.toMatchObject({
      code: 'storage',
    });
    await mkdir(slotsDir);

    const storageFailureFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'open') {
          return async (file: Parameters<typeof nodeFs.open>[0], ...args: unknown[]) => {
            if (String(file).includes(`${path.sep}slots${path.sep}0.slot.`)) {
              throw Object.assign(new Error('injected storage failure'), { code: 'EIO' });
            }
            return Reflect.apply(nodeFs.open, nodeFs, [file, ...args]);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      writePendingRecordV2({ ...input('record_storage_failure', { ok: true }), fs: storageFailureFs })
    ).rejects.toMatchObject({
      code: 'storage',
    });
    await expect(readdir(slotsDir)).resolves.toEqual([]);

    await rm(projectDir, { recursive: true, force: true });
  });
});
