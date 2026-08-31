/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { createHash } from 'node:crypto';
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
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2,
  STUDIO_EXPORT_SCHEMA_VERSION_V2,
  STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
  STUDIO_PREPARED_QUOTE_TTL_SECONDS,
  STUDIO_PROPOSAL_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_V2_MAX_PENDING_PER_PROJECT,
  STUDIO_REFERENCE_REQUEST_V2_MAX_RECORD_BYTES,
  STUDIO_REFERENCE_REQUEST_V2_PENDING_TTL_MS,
  STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  type CreateStudioProjectInputV2,
  type StudioAssetV2,
  type StudioDirectorPaidRecoveryCommandRecordV2,
  type StudioExportCatalogV2,
  type StudioGenerationCapabilityItemV2,
  type StudioGenerationRequestPlan,
  type StudioJobV2,
  type StudioMutationOperationV2,
  type StudioProjectV2,
  type StudioPrepareGenerationChoiceV2,
  type StudioPaidRecoveryBlockerV2,
  type StudioProposalRecordV2,
  type StudioProposalV2,
  type StudioReferenceRequestV2,
  type StudioQuotedGeneration,
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
  CreativeStudioServiceError,
  createCreativeStudioServiceV2,
  projectStudioReferenceGenerationHandoffV2,
} from '@process/services/creative-studio/service';
import {
  applyStudioMutationBatchV2,
  calculateStudioQuoteTotals,
  composeStudioGenerationV2,
  createStudioBoardGenerationRequestPlanForShot,
  createEmptyStudioProjectV2,
  createStudioFrameExtractionId,
  createStudioGenerationRequestTemplate,
  createStudioQuotedGenerationId,
  createStudioRateCardV2,
  createStudioResolvedGenerationRequestPlan,
  deriveStudioInstructionProfileV2,
  studioGenerationCompositionDigestV2,
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
  StudioFilmExportErrorV2,
  type StudioFilmExporterV2,
} from '@process/services/creative-studio/service/filmExporter';
import {
  createListRoutesHandler,
  createStudioApplyEditsHandlerV2,
  createStudioApplyFreeFixHandlerV2,
  createStudioGetConditioningFrameHandlerV2,
  createStudioGetProposalHandlerV2,
  createStudioGetProjectStatusHandlerV2,
  createProposeBriefRuleHandlerV2,
  createProposeStoryboardHandlerV2,
  createReadStoryboardHandlerV2,
  createRequestReferenceImagesHandlerV2,
  parseStudioServerEnv,
  registerStudioToolsV2,
  studioApplyEditsInputSchemaV2,
  studioApplyFreeFixInputSchemaV2,
  studioGetProjectStatusInputSchemaV2,
  studioGetProposalInputSchemaV2,
  studioProposePaidRecoveryInputSchemaV2,
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

const proposalOperationVariant = (schema: unknown, operationKind: string): Record<string, unknown> | null => {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return null;
  const properties = Reflect.get(schema, 'properties');
  if (properties === null || typeof properties !== 'object' || Array.isArray(properties)) return null;
  const operations = Reflect.get(properties, 'operations');
  if (operations === null || typeof operations !== 'object' || Array.isArray(operations)) return null;
  const items = Reflect.get(operations, 'items');
  if (items === null || typeof items !== 'object' || Array.isArray(items)) return null;
  const candidates = Reflect.get(items, 'oneOf') ?? Reflect.get(items, 'anyOf');
  if (!Array.isArray(candidates)) return null;
  return (
    candidates.find((candidate): candidate is Record<string, unknown> => {
      if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
      const candidateProperties = Reflect.get(candidate, 'properties');
      if (candidateProperties === null || typeof candidateProperties !== 'object' || Array.isArray(candidateProperties))
        return false;
      const kind = Reflect.get(candidateProperties, 'kind');
      return (
        kind !== null &&
        typeof kind === 'object' &&
        !Array.isArray(kind) &&
        Reflect.get(kind, 'const') === operationKind
      );
    }) ?? null
  );
};

const SERVICE_REFERENCE_AUTHORIZATION_ID = 'authorization_reference_background';
const SERVICE_REFERENCE_JOB_ID = 'job_reference_background';

const shotChoiceV2 = (
  shotId: string,
  purpose: 'seed_still' | 'board_still' | 'video_take'
): StudioPrepareGenerationChoiceV2 => ({ target: { kind: 'shot', shotId }, purpose });

const shotCapabilityV2 = (
  shotId: string,
  purpose: 'seed_still' | 'board_still' | 'video_take'
): StudioGenerationCapabilityItemV2 => ({ target: { kind: 'shot', shotId }, purpose });

const referenceCapabilityV2 = (referenceId: string): StudioGenerationCapabilityItemV2 => ({
  target: { kind: 'reference', referenceId },
  purpose: 'reference_image',
});

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
      schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
      projectId: empty.id,
      expectedRevision: empty.revision,
      operations: [
        {
          kind: 'add_beat',
          beatId: 'section_1',
          beat: {
            title: 'Opening',
            story: 'Warm sunrise over a quiet city introduces the launch.',
            targetSeconds: null,
          },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_1',
          shotId: 'clip_1',
          shot: { shootingScript: 'A wide establishing shot.', durationSeconds: 5 },
          beforeShotId: null,
        },
        {
          kind: 'add_beat',
          beatId: 'section_2',
          beat: {
            title: 'Close',
            story: 'Soft evening light over the skyline closes the launch.',
            targetSeconds: null,
          },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId: 'section_2',
          shotId: 'clip_2',
          shot: { shootingScript: 'A slow closing composition.', durationSeconds: 5 },
          beforeShotId: null,
        },
      ],
    },
    { mutationId: 'service_schema_2_fixture', capturedAt }
  );
  const project = { ...result.project, revision: empty.revision + 1, updatedAt: capturedAt };
  const referenceId = 'ref_background';
  project.referencePlanStatus = 'planned';
  project.referenceOrder = [referenceId];
  project.references = {
    [referenceId]: {
      id: referenceId,
      kind: 'background',
      label: 'City skyline',
      prompt: 'Warm city skyline from sunrise through evening.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: capturedAt,
      updatedAt: capturedAt,
    },
  };
  const assetId = 'asset_reference_background';
  const authorizationId = SERVICE_REFERENCE_AUTHORIZATION_ID;
  const jobId = SERVICE_REFERENCE_JOB_ID;
  const provider = { providerId: 'provider_fixture', adapterId: 'weprompt-image-v1', model: 'image-model' } as const;
  const source = {
    kind: 'project_reference' as const,
    referenceId,
    referenceKind: project.references[referenceId]!.kind,
    prompt: project.references[referenceId]!.prompt,
  };
  const composition = composeStudioGenerationV2({
    projectRevision: 1,
    brief: project.brief,
    rules: project.rules,
    source,
    purpose: 'reference_image',
    referenceInputs: [],
    aspectRatio: project.aspectRatio,
    resolution: project.resolution,
    route: provider,
    boardStyle: null,
    instructionProfile: deriveStudioInstructionProfileV2(provider, 'reference_image', source),
  });
  const requestPlan: StudioGenerationRequestPlan = {
    kind: 'resolved',
    snapshot: {
      composition,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      durationSeconds: 4,
      referenceInputs: [],
      conditioningInput: null,
    },
  };
  const target = { kind: 'reference' as const, referenceId };
  const item: StudioQuotedGeneration = {
    id: createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision: 1,
      target,
      purpose: 'reference_image',
    }),
    target,
    purpose: 'reference_image',
    routeId: 'image_route_fixture',
    generationCount: 1,
    requestPlan,
    rateUnit: 'generation',
    rateMinorUnits: 1,
  };
  const totals = calculateStudioQuoteTotals([item])!;
  const compositionDigest = studioGenerationCompositionDigestV2(composition);
  project.assets[assetId] = {
    id: assetId,
    projectId: project.id,
    shotId: null,
    mediaKind: 'image',
    mimeType: 'image/png',
    managedAsset: { collection: 'assets', fileName: 'asset_reference_background.png' },
    byteSize: 1,
    sha256: 'a'.repeat(64),
    projectReferenceId: referenceId,
    generationReferenceAssetIds: [],
    producerJobId: jobId,
    compositionDigest,
    createdAt: capturedAt,
  };
  project.spendAuthorizations.push({
    id: authorizationId,
    projectId: project.id,
    projectRevision: 1,
    originReferenceHandoffId: null,
    rateCardDigest: 'b'.repeat(64),
    currency: 'USD',
    baseItems: [item],
    cascadeItems: [],
    lowerMinorUnits: totals.lowerMinorUnits,
    upperMinorUnits: totals.upperMinorUnits,
    expiresAt: '2026-08-17T00:05:00.000Z',
    confirmedAt: capturedAt,
    providerBindings: [{ itemId: item.id, provider }],
    idempotencyKeys: [{ itemId: item.id, key: 'idempotency_reference_background' }],
  });
  project.jobs[jobId] = {
    id: jobId,
    projectId: project.id,
    target,
    status: 'succeeded',
    provider,
    idempotencyKey: 'idempotency_reference_background',
    providerJobId: 'remote_reference_background',
    remoteStartedAt: capturedAt,
    cancellationPolicy: 'none',
    purpose: 'reference_image',
    authorizationId,
    authorizationItemId: item.id,
    composition,
    requestPlan,
    requestSnapshot: requestPlan.snapshot,
    spendReceipt: {
      authorizationId,
      itemId: item.id,
      jobId,
      purpose: 'reference_image',
      routeId: item.routeId,
      currency: 'USD',
      rateUnit: 'generation',
      rateMinorUnits: 1,
      durationSeconds: null,
      generationCount: 1,
      totalMinorUnits: 1,
    },
    outputAssetIds: [assetId],
    outputAssetIdsByRole: { primary: assetId, poster: null },
    error: null,
    retryOfJobId: null,
    retryReason: null,
    duplicateChargeAcknowledged: false,
    duplicateChargeAcknowledgedAt: null,
    createdAt: capturedAt,
    updatedAt: capturedAt,
  };
  project.references[referenceId]!.approvedAssetId = assetId;
  project.references[referenceId]!.jobIds.push(jobId);
  project.references[referenceId]!.updatedAt = capturedAt;
  for (const shot of Object.values(project.shots)) {
    shot.referenceBinding = {
      status: 'ready',
      characterReferenceIds: [],
      backgroundReferenceId: referenceId,
    };
  }
  return project;
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

  const makeSchema2Job = (project: StudioProjectV2, overrides: Partial<StudioJobV2> = {}): StudioJobV2 => {
    const target = overrides.target ?? { kind: 'shot' as const, shotId: 'clip_1' };
    const purpose = overrides.purpose ?? 'seed_still';
    const provider =
      overrides.provider ??
      (purpose === 'video_take'
        ? { providerId: 'provider_1', adapterId: 'openrouter-video-v1' as const, model: 'video-model' }
        : { providerId: 'provider_1', adapterId: 'weprompt-image-v1' as const, model: 'image-model' });
    const referenceInputs =
      target.kind === 'shot' && purpose !== 'video_take'
        ? [
            ...project.shots[target.shotId]!.referenceBinding.characterReferenceIds,
            ...(project.shots[target.shotId]!.referenceBinding.backgroundReferenceId === null
              ? []
              : [project.shots[target.shotId]!.referenceBinding.backgroundReferenceId]),
          ].map((referenceId) => {
            const reference = project.references[referenceId]!;
            const asset = project.assets[reference.approvedAssetId!]!;
            return { referenceId, kind: reference.kind, assetId: asset.id, sha256: asset.sha256 };
          })
        : [];
    const source =
      target.kind === 'reference'
        ? {
            kind: 'project_reference' as const,
            referenceId: target.referenceId,
            referenceKind: project.references[target.referenceId]!.kind,
            prompt: project.references[target.referenceId]!.prompt,
          }
        : (() => {
            const beat = Object.values(project.beats).find((candidate) => candidate.shotOrder.includes(target.shotId))!;
            return {
              kind: 'shot' as const,
              beatId: beat.id,
              story: beat.story,
              shotId: target.shotId,
              shootingScript: project.shots[target.shotId]!.shootingScript,
            };
          })();
    const derivedComposition = composeStudioGenerationV2({
      projectRevision: project.revision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose,
      referenceInputs,
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: provider,
      boardStyle: purpose === 'board_still' ? (project.boardStyle ?? 'sketch') : null,
      instructionProfile: deriveStudioInstructionProfileV2(provider, purpose, source),
    });
    const composition =
      overrides.composition ??
      (overrides.requestPlan === undefined
        ? derivedComposition
        : overrides.requestPlan.kind === 'resolved'
          ? overrides.requestPlan.snapshot.composition
          : overrides.requestPlan.template.composition);
    const requestPlan =
      overrides.requestPlan ??
      createStudioResolvedGenerationRequestPlan({
        purpose,
        template: createStudioGenerationRequestTemplate({
          composition,
          durationSeconds:
            purpose === 'board_still' || target.kind === 'reference'
              ? 4
              : Number.isInteger(project.shots[target.shotId]!.durationSeconds) &&
                  project.shots[target.shotId]!.durationSeconds >= 4 &&
                  project.shots[target.shotId]!.durationSeconds <= 15
                ? project.shots[target.shotId]!.durationSeconds
                : 5,
        }),
        conditioningInput:
          purpose === 'video_take'
            ? { kind: 'seed_still', assetId: project.shots[target.kind === 'shot' ? target.shotId : '']!.seedStillId! }
            : null,
      });
    const requestSnapshot =
      overrides.requestSnapshot !== undefined
        ? overrides.requestSnapshot
        : requestPlan.kind === 'resolved'
          ? requestPlan.snapshot
          : null;
    return {
      id: 'job_1',
      projectId: project.id,
      status: 'failed',
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
      authorizationId: 'authorization_1',
      authorizationItemId: 'item_1',
      spendReceipt: null,
      outputAssetIdsByRole: { primary: null, poster: null },
      ...overrides,
      target,
      provider,
      purpose,
      composition,
      requestPlan,
      requestSnapshot,
    };
  };

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
      filmExporter?: StudioFilmExporterV2;
      serviceStore?: CreativeStudioStore;
      resolveAssetV2?: StudioMediaStore['resolveAssetV2'];
      resolveAssetWithProjectAuthorityV2?: StudioMediaStore['resolveAssetWithProjectAuthorityV2'];
      verifyConditioningFrameV2?: StudioMediaStore['verifyConditioningFrameV2'];
      importReferenceImageFromPathV2?: StudioMediaStore['importReferenceImageFromPathV2'];
      importBedAudioFromPathV2?: StudioMediaStore['importBedAudioFromPathV2'];
      detachBedAudioV2?: StudioMediaStore['detachBedAudioV2'];
      analyzeVideoAudioV2?: StudioMediaStore['analyzeVideoAudioV2'];
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
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
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
    const proposals: StudioProposalV2[] = [proposal];
    const listProposalsV2 = vi.fn(async () => structuredClone(proposals));
    const recordProposalV2 = vi.fn<CreativeStudioStore['recordProposalV2']>(async (input) => {
      const existing = proposals.find((candidate) => candidate.id === input.proposalId);
      if (existing !== undefined) {
        if (
          existing.status !== 'pending' ||
          existing.baseRevision !== input.baseRevision ||
          JSON.stringify(existing.payload) !== JSON.stringify(input.payload)
        ) {
          throw new CreativeStudioStoreError('invalid_payload', 'proposal identity collision');
        }
        return structuredClone(existing) as StudioProposalRecordV2;
      }
      const record: StudioProposalRecordV2 = {
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
        id: input.proposalId,
        projectId: input.projectId,
        status: 'pending',
        baseRevision: input.baseRevision,
        payload: structuredClone(input.payload),
        createdAt: committedAt,
        decidedAt: null,
      };
      proposals.push(record);
      return structuredClone(record);
    });
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      id: 'reference_request_service_1',
      projectId: current.id,
      referenceIds: ['ref_background'],
      status: 'pending',
      createdAt: '2026-08-17T00:00:01.000Z',
    };
    const listReferenceRequestsV2 = vi.fn<CreativeStudioStore['listReferenceRequestsV2']>(async () => [
      { request: structuredClone(referenceRequest), decision: null, receipt: null },
    ]);
    const decideReferenceRequestV2 = vi.fn<CreativeStudioStore['decideReferenceRequestV2']>(async (input) => {
      const outcome =
        input.outcome.kind === 'generation_gate'
          ? {
              kind: 'generation_gate' as const,
              handoffId: 'handoff_service_1',
              referenceIds: [...referenceRequest.referenceIds],
            }
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          requestId: referenceRequest.id,
          projectId: current.id,
          decidedAt: committedAt,
          outcome,
        },
        receipt: null,
      };
    });
    const referenceGenerationDecision = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId: referenceRequest.id,
      projectId: current.id,
      decidedAt: committedAt,
      outcome: {
        kind: 'generation_gate' as const,
        handoffId: 'handoff_service_1',
        referenceIds: [...referenceRequest.referenceIds],
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          handoffId: input.handoffId,
          requestId: referenceRequest.id,
          completedAt: authorization.confirmedAt,
          result: { kind: 'confirmed', authorizationId: authorization.id },
        };
        return result;
      }
    );
    const confirmPaidRecoveryProposalV2 = vi.fn<CreativeStudioStore['confirmPaidRecoveryProposalV2']>(async (input) =>
      confirmProjectV2(input)
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
    const assertProjectAuthorityCurrent = vi.fn(async () => undefined);
    const withProjectAuthorityV2 = vi.fn(
      async (projectId: string, operation: (authority: never) => Promise<unknown>) => {
        if (projectId !== current.id) throw new CreativeStudioStoreError('not_found', 'missing Studio fixture project');
        return operation({
          project: structuredClone(current),
          projectDir: `/studio/${current.id}`,
          assertCurrent: assertProjectAuthorityCurrent,
          delete: async (expectedRevision: number, authorizeBeforeDelete?: () => void | Promise<void>) => {
            await authorizeBeforeDelete?.();
            return deleteProjectV2(projectId, expectedRevision);
          },
        } as never);
      }
    );
    const store = {
      listProjectsV2: vi.fn(async () => ({
        projects: [],
        projectRevisions: [],
        unsupportedProjectIds: [],
        quarantinedProjectIds: [],
      })),
      createProjectV2: vi.fn(async () => structuredClone(current)),
      getProjectV2: vi.fn(async () => ({ status: 'supported' as const, project: structuredClone(current) })),
      applyMutationBatchV2,
      updateProjectV2,
      confirmProjectV2,
      confirmPaidRecoveryProposalV2,
      confirmReferenceGenerationHandoffV2,
      deleteProjectV2,
      listProposalsV2,
      recordProposalV2,
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
      withProjectAuthorityV2,
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
    const importedReferenceAsset: StudioAssetV2 = {
      id: 'reference_import_service_1',
      projectId: current.id,
      shotId: null,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'imports', fileName: 'reference_import_service_1.png' },
      byteSize: 8,
      sha256: 'c'.repeat(64),
      projectReferenceId: 'reference_ming',
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
      createdAt: committedAt,
    };
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
    const importReferenceImageFromPathV2 =
      options.importReferenceImageFromPathV2 ??
      vi.fn<StudioMediaStore['importReferenceImageFromPathV2']>(async () => {
        const importedProject = structuredClone(current);
        importedProject.assets[importedReferenceAsset.id] = structuredClone(importedReferenceAsset);
        return { asset: structuredClone(importedReferenceAsset), project: importedProject };
      });
    const detachBedAudioV2 =
      options.detachBedAudioV2 ??
      vi.fn<StudioMediaStore['detachBedAudioV2']>(async (input) => {
        input.assertActive?.();
        return structuredClone(current);
      });
    const persistCapturedPosterV2 = vi.fn(async () => structuredClone(referenceAsset));
    const extractConditioningFrameV2 = vi.fn(async () => ({ status: 'failed' as const }));
    const verifyConditioningFrameV2 = options.verifyConditioningFrameV2 ?? vi.fn(async () => null);
    const resolveAssetV2 = options.resolveAssetV2 ?? vi.fn(async () => null);
    const resolveAssetWithProjectAuthorityV2 = options.resolveAssetWithProjectAuthorityV2 ?? vi.fn(async () => null);
    const analyzeVideoAudioV2 =
      options.analyzeVideoAudioV2 ??
      vi.fn<StudioMediaStore['analyzeVideoAudioV2']>(async () => ({
        status: 'unavailable',
        meanVolumeDbfs: null,
        peakVolumeDbfs: null,
      }));
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
        schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
        projectId: current.id,
        revision: 1,
        artifacts: [],
      })),
      create: vi.fn(async () => ({
        schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
        projectId: current.id,
        revision: 1,
        artifacts: [],
      })),
      repair: vi.fn(async () => ({
        schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
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
      filmExporter: options.filmExporter,
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
              importReferenceImageFromPathV2,
              importBedAudioFromPathV2,
              detachBedAudioV2,
              persistCapturedPosterV2,
              extractConditioningFrameV2,
              verifyConditioningFrameV2,
              resolveAssetV2,
              resolveAssetWithProjectAuthorityV2,
              analyzeVideoAudioV2,
            } as never,
          }),
      onProjectUpdated,
    });
    return {
      service,
      store,
      withProjectAuthorityV2,
      assertProjectAuthorityCurrent,
      exportCatalogStore: options.exportCatalogStore ?? defaultExportCatalogStore,
      submitShots,
      cancelJobV2,
      retryJobV2,
      retryDownloadV2,
      importReferenceImageFromPathV2,
      importBedAudioFromPathV2,
      detachBedAudioV2,
      persistCapturedPosterV2,
      extractConditioningFrameV2,
      verifyConditioningFrameV2,
      resolveAssetV2,
      resolveAssetWithProjectAuthorityV2,
      analyzeVideoAudioV2,
      providerResolver,
      onProjectUpdated,
      proposal,
      listProposalsV2,
      recordProposalV2,
      acceptProposalV2,
      rejectProposalV2,
      referenceRequest,
      listReferenceRequestsV2,
      decideReferenceRequestV2,
      readReferenceGenerationHandoffV2,
      recordReferenceGenerationHandoffReceiptV2,
      confirmReferenceGenerationHandoffV2,
      confirmPaidRecoveryProposalV2,
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

  const makeBoardPromotionProject = (): { project: StudioProjectV2; board: StudioAssetV2 } => {
    const project = makeContinuityProject('none');
    project.boardStyle = 'grey_tone';
    const shot = project.shots.clip_1!;
    const beat = project.beats.section_1!;
    const approvedReference = project.references.ref_background!;
    const approvedAsset = project.assets[approvedReference.approvedAssetId!]!;
    const boardProvider = {
      providerId: imageRoute.providerId,
      adapterId: imageRoute.adapterId,
      model: imageRoute.model,
    };
    const requestPlan = createStudioBoardGenerationRequestPlanForShot({
      project,
      beat,
      shot,
      route: boardProvider,
      referenceInputs: [
        {
          referenceId: approvedReference.id,
          kind: approvedReference.kind,
          assetId: approvedAsset.id,
          sha256: approvedAsset.sha256,
        },
      ],
    });
    if (requestPlan === null) throw new Error('Board promotion fixture request must resolve');
    const board: StudioAssetV2 = {
      id: 'board_promote_1',
      projectId: project.id,
      shotId: shot.id,
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'boardStills', fileName: 'board_promote_1.png' },
      byteSize: 20,
      sha256: 'b'.repeat(64),
      projectReferenceId: null,
      generationReferenceAssetIds: [approvedAsset.id],
      producerJobId: 'job_board_promote_1',
      compositionDigest: studioGenerationCompositionDigestV2(requestPlan.snapshot.composition),
      createdAt: '2026-08-17T00:00:01.000Z',
    };
    project.assets[board.id] = board;
    shot.assetIds.push(board.id);
    shot.boardAssetId = board.id;
    project.jobs.job_board_promote_1 = makeSchema2Job(project, {
      id: 'job_board_promote_1',
      target: { kind: 'shot', shotId: shot.id },
      provider: boardProvider,
      status: 'succeeded',
      purpose: 'board_still',
      providerJobId: 'remote_board_promote_1',
      remoteStartedAt: '2026-08-17T00:00:01.000Z',
      outputAssetIds: [board.id],
      error: null,
      requestPlan,
      requestSnapshot: requestPlan.snapshot,
      spendReceipt: {
        authorizationId: 'authorization_1',
        itemId: 'item_1',
        jobId: 'job_board_promote_1',
        purpose: 'board_still',
        routeId: imageRoute.choiceId,
        currency: 'USD',
        rateUnit: 'generation',
        rateMinorUnits: 3,
        durationSeconds: null,
        generationCount: 1,
        totalMinorUnits: 3,
      },
      outputAssetIdsByRole: { primary: board.id, poster: null },
    });
    shot.jobIds.push('job_board_promote_1');
    for (const shotId of ['clip_1', 'clip_2']) {
      const selectedShot = project.shots[shotId]!;
      const take: StudioAssetV2 = {
        id: `take_${shotId}`,
        projectId: project.id,
        shotId,
        mediaKind: 'video',
        mimeType: 'video/mp4',
        managedAsset: { collection: 'assets', fileName: `take_${shotId}.mp4` },
        byteSize: 100,
        sha256: 'c'.repeat(64),
        durationSeconds: selectedShot.durationSeconds,
        createdAt: '2026-08-17T00:00:01.000Z',
      };
      project.assets[take.id] = take;
      selectedShot.assetIds.push(take.id);
      selectedShot.videoAssetId = take.id;
    }
    return { project, board };
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
      () => harness.service.getProjectWorkspace({ projectId: 'project_v2', extra: true } as never),
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
        harness.service.getGenerationCapability({
          projectId: 'project_v2',
          expectedRevision: 2,
          items: Object.assign([], { length: 1 }) as never,
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
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
  });

  it('imports one semantic reference through the exact Main-only media boundary', async () => {
    const harness = makeHarness();

    const imported = await harness.service.importReferenceImageFromPath({
      projectId: 'project_v2',
      referenceId: 'reference_ming',
      expectedRevision: 2,
      sourcePath: '/chosen/ming.png',
    });

    expect(imported).toMatchObject({
      asset: {
        id: 'reference_import_service_1',
        shotId: null,
        managedAsset: { collection: 'imports' },
        projectReferenceId: 'reference_ming',
        producerJobId: null,
        compositionDigest: null,
      },
      project: { id: 'project_v2' },
    });
    expect(harness.importReferenceImageFromPathV2).toHaveBeenCalledExactlyOnceWith({
      projectId: 'project_v2',
      referenceId: 'reference_ming',
      expectedRevision: 2,
      sourcePath: '/chosen/ming.png',
      returnProject: true,
    });
    expect(harness.onProjectUpdated).toHaveBeenCalledExactlyOnceWith('project_v2');
  });

  it('rejects malformed reference-image import envelopes before media storage', async () => {
    const harness = makeHarness();
    const attempts: Array<() => Promise<unknown>> = [
      () => harness.service.importReferenceImageFromPath(null as never),
      () =>
        harness.service.importReferenceImageFromPath({
          projectId: 'project_v2',
          referenceId: 'reference_ming',
          expectedRevision: 2,
          sourcePath: '/chosen/ming.png',
          extra: true,
        } as never),
      () =>
        harness.service.importReferenceImageFromPath({
          projectId: 'project_v2',
          referenceId: '../reference',
          expectedRevision: 2,
          sourcePath: '/chosen/ming.png',
        }),
      () =>
        harness.service.importReferenceImageFromPath({
          projectId: 'project_v2',
          referenceId: 'reference_ming',
          expectedRevision: 2,
          sourcePath: '',
        }),
    ];

    for (const attempt of attempts) {
      // eslint-disable-next-line no-await-in-loop -- each hostile envelope must refuse independently.
      await expect(attempt()).rejects.toMatchObject({ code: 'invalid_payload' });
    }
    expect(harness.importReferenceImageFromPathV2).not.toHaveBeenCalled();
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
      harness.service.importReferenceImageFromPath({
        projectId: 'project_v2',
        referenceId: 'reference_ming',
        expectedRevision: 2,
        sourcePath: '/chosen/ming.png',
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
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
      schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
      projectId: 'project_v2',
      revision: 2,
      artifacts: [
        {
          schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
          id: 'export_service_1',
          projectId: 'project_v2',
          sourceRevision: 2,
          shape: 'script',
          payloadKind: 'file',
          managedExport: { collection: 'exports', fileName: 'private-export-name' },
          byteSize: 42,
          payloadFileCount: 1,
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
          folderName: 'private-export-name',
          byteSize: 42,
          payloadFileCount: 1,
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
    expect(JSON.stringify(created)).not.toContain('/studio/');
  });

  it('normalizes every authored script field to canonical LF bytes', async () => {
    const project = makeSchema2ServiceProject();
    project.name = 'Schema\r\n2 launch';
    project.brief = 'First brief line\rSecond brief line';
    project.beats.section_1!.title = 'Opening\r\nBeat';
    project.beats.section_1!.story = 'Move\rthrough the city in warm\r\nlight.';
    project.shots.clip_1!.shootingScript = 'Camera: A wide\rcomposition.\r\nDialogue: We have arrived.';
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
    expect(script).toContain('Story\n\nMove\nthrough the city in warm\nlight.');
    expect(script).toContain('Shooting script\n\nCamera: A wide\ncomposition.\nDialogue: We have arrived.');
  });

  it('renders a film outside project authority, then revalidates and publishes one verified file without spend', async () => {
    const project = makeSchema2ServiceProject();
    const cleanup = vi.fn(async () => undefined);
    const facts = {
      schemaVersion: 1 as const,
      nominalDurationSeconds: 8,
      renderedDurationSeconds: 8,
      transition: { kind: 'cut' as const },
      dissolveCount: 0,
      trimTails: false,
      segments: [
        {
          kind: 'slate' as const,
          beatId: 'section_1',
          shotId: null,
          durationSeconds: 8,
          normalizedDurationSeconds: 8,
        },
      ],
      video: {
        container: 'mp4' as const,
        codec: 'h264' as const,
        encoder: 'h264_videotoolbox' as const,
        profile: 'high' as const,
        level: '4.2' as const,
        width: 1920,
        height: 1080,
        frameRate: 24 as const,
        pixelFormat: 'yuv420p' as const,
        scaleMode: 'contain_black_pad' as const,
        sampleAspectRatio: '1:1' as const,
        colorPrimaries: 'bt709' as const,
        colorTransfer: 'bt709' as const,
        colorSpace: 'bt709' as const,
        colorRange: 'tv' as const,
        gopFrames: 48 as const,
        bitrate: 12_000_000 as const,
        trackTimeBase: '1/24000' as const,
        metadataStripped: true as const,
        chaptersStripped: true as const,
        fastStart: false as const,
      },
      audio: {
        codec: 'aac' as const,
        sampleRate: 48_000 as const,
        channels: 2 as const,
        channelLayout: 'stereo' as const,
        sampleFormat: 'fltp' as const,
        bitrate: 192_000 as const,
        silenceForMissingStreams: true as const,
        takeGain: 1,
        bedAssetId: null,
        bedSha256: null,
        bedGain: null,
        bedFadeOutSeconds: null,
        bedFadeCurve: null,
        dissolveCrossfade: false,
        dissolveCurve: 'triangular' as const,
        limiterPeak: 0.95 as const,
        limiterLatencyCompensated: true as const,
      },
    };
    const render = vi.fn<StudioFilmExporterV2['render']>(async ({ onProgress }) => {
      onProgress({ phase: 'rendering', progress: 0.5 });
      return {
        facts,
        byteSize: 4,
        sha256: 'd'.repeat(64),
        openVerifiedStream: async () => Readable.from([Buffer.from('film')]),
        cleanup,
      };
    });
    const filmExporter: StudioFilmExporterV2 = {
      capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
      render,
      dispose: vi.fn(),
    };
    const create = vi.fn(async (authority, plan) => ({
      schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
      projectId: project.id,
      revision: 2,
      artifacts: [
        {
          schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
          id: plan.artifactId,
          projectId: project.id,
          sourceRevision: authority.project.revision,
          shape: 'film' as const,
          payloadKind: 'file' as const,
          managedExport: { collection: 'exports' as const, fileName: plan.managedFileName },
          byteSize: 4,
          payloadFileCount: 1,
          manifestSha256: 'e'.repeat(64),
          createdAt: plan.createdAt,
          film: facts,
        },
      ],
    }));
    const exportCatalogStore = {
      create,
      list: vi.fn(async () => ({
        schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
        projectId: project.id,
        revision: 1,
        artifacts: [],
      })),
      repair: vi.fn(),
      copy: vi.fn(),
      resolveRevealPath: vi.fn(),
      withManagedMediaAuthority: vi.fn(),
    } as unknown as StudioExportCatalogStoreV2;
    const harness = makeHarness(project, {
      filmExporter,
      exportCatalogStore,
      createExportId: () => 'film_export_1',
    });

    await expect(
      harness.service.createExport({
        projectId: project.id,
        expectedRevision: project.revision,
        expectedCatalogRevision: 1,
        shape: 'film',
        renderId: 'film_run_1',
        transition: { kind: 'cut' },
        trimTails: false,
      })
    ).resolves.toMatchObject({ revision: 2, artifacts: [{ id: 'film_export_1', shape: 'film' }] });
    await expect(harness.service.getFilmExportStatus({ projectId: project.id })).resolves.toMatchObject({
      status: 'terminal',
      result: {
        projectId: project.id,
        renderId: 'film_run_1',
        outcome: 'succeeded',
        artifact: { id: 'film_export_1', shape: 'film' },
        movedAsideCount: 0,
      },
    });
    await expect(
      harness.service.acknowledgeFilmExport({ projectId: project.id, renderId: 'film_run_1' })
    ).resolves.toEqual({ status: 'acknowledged' });

    expect(harness.withProjectAuthorityV2.mock.invocationCallOrder[0]).toBeLessThan(
      render.mock.invocationCallOrder[0]!
    );
    expect(vi.mocked(exportCatalogStore.list).mock.invocationCallOrder[0]).toBeLessThan(
      render.mock.invocationCallOrder[0]!
    );
    expect(render.mock.invocationCallOrder[0]).toBeLessThan(
      harness.withProjectAuthorityV2.mock.invocationCallOrder[1]!
    );
    expect(create).toHaveBeenCalledOnce();
    expect(create.mock.calls[0]![1]).toMatchObject({
      shape: 'film',
      film: facts,
      files: [{ kind: 'verified_stream', relativePath: 'film.mp4', byteSize: 4, sha256: 'd'.repeat(64) }],
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it('reports unavailable Film capability and idle/not-found lifecycle without creating work', async () => {
    const project = makeSchema2ServiceProject();
    const filmExporter: StudioFilmExporterV2 = {
      capability: vi.fn(async () => ({ status: 'unavailable', reason: 'unsupported_capabilities' })),
      render: vi.fn(),
      dispose: vi.fn(),
    };
    const harness = makeHarness(project, { filmExporter });

    await expect(harness.service.getFilmExportCapability({ projectId: project.id })).resolves.toEqual({
      status: 'unavailable',
      reason: 'unsupported_capabilities',
    });
    await expect(harness.service.getFilmExportStatus({ projectId: project.id })).resolves.toEqual({ status: 'idle' });
    await expect(
      harness.service.cancelFilmExport({ projectId: project.id, renderId: 'film_run_missing' })
    ).resolves.toEqual({ status: 'not_found' });
    expect(filmExporter.render).not.toHaveBeenCalled();
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('rejects a stale initial Film catalog before source resolution or rendering', async () => {
    const project = makeSchema2ServiceProject();
    const render = vi.fn<StudioFilmExporterV2['render']>();
    const list = vi.fn(
      async (): Promise<StudioExportCatalogV2> => ({
        schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
        projectId: project.id,
        revision: 2,
        artifacts: [],
      })
    );
    const exportCatalogStore = {
      create: vi.fn(),
      list,
      repair: vi.fn(),
      copy: vi.fn(),
      resolveRevealPath: vi.fn(),
      withManagedMediaAuthority: vi.fn(),
    } as unknown as StudioExportCatalogStoreV2;
    const harness = makeHarness(project, {
      exportCatalogStore,
      filmExporter: {
        capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
        render,
        dispose: vi.fn(),
      },
    });

    await expect(
      harness.service.createExport({
        projectId: project.id,
        expectedRevision: project.revision,
        expectedCatalogRevision: 1,
        shape: 'film',
        renderId: 'film_run_stale_initial_catalog',
        transition: { kind: 'cut' },
        trimTails: false,
      })
    ).rejects.toMatchObject({ code: 'stale_export_catalog' });
    expect(list).toHaveBeenCalledOnce();
    expect(harness.resolveAssetV2).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
    expect(exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('reports and cancels one bounded active film render without publishing', async () => {
    const project = makeSchema2ServiceProject();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const render = vi.fn<StudioFilmExporterV2['render']>(
      ({ signal }) =>
        new Promise((_, reject) => {
          markStarted();
          signal.addEventListener('abort', () => reject(new StudioFilmExportErrorV2('cancelled')), { once: true });
        })
    );
    const filmExporter: StudioFilmExporterV2 = {
      capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
      render,
      dispose: vi.fn(),
    };
    const harness = makeHarness(project, { filmExporter, createExportId: () => 'must_not_publish' });
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'film' as const,
      renderId: 'film_run_cancel',
      transition: { kind: 'cut' as const },
      trimTails: false,
    };
    const pending = harness.service.createExport(request);
    await started;
    await expect(harness.service.getFilmExportStatus({ projectId: project.id })).resolves.toMatchObject({
      status: 'active',
      progress: { phase: 'preparing' },
    });
    await expect(harness.service.getFilmExportStatus({ projectId: 'project_other' })).resolves.toMatchObject({
      status: 'active',
      progress: { projectId: project.id, renderId: request.renderId, phase: 'preparing' },
    });
    await expect(
      harness.service.cancelFilmExport({ projectId: project.id, renderId: request.renderId })
    ).resolves.toEqual({ status: 'cancelled' });
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await expect(harness.service.getFilmExportStatus({ projectId: project.id })).resolves.toEqual({
      status: 'terminal',
      result: { projectId: project.id, renderId: request.renderId, outcome: 'cancelled' },
    });
    await expect(
      harness.service.acknowledgeFilmExport({ projectId: project.id, renderId: request.renderId })
    ).resolves.toEqual({ status: 'acknowledged' });
    await expect(harness.service.getFilmExportStatus({ projectId: project.id })).resolves.toEqual({ status: 'idle' });
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('waits for initial managed-source resolution to settle before cancellation completes', async () => {
    const project = makeSchema2ServiceProject();
    addGeneratedVideosForMcpV2(project, 1);
    const take = project.assets.take_01!;
    let markResolverStarted!: () => void;
    const resolverStarted = new Promise<void>((resolve) => {
      markResolverStarted = resolve;
    });
    let releaseResolver!: () => void;
    const resolverReleased = new Promise<void>((resolve) => {
      releaseResolver = resolve;
    });
    const resolveAssetV2 = vi.fn<StudioMediaStore['resolveAssetV2']>(async () => {
      markResolverStarted();
      await resolverReleased;
      return { asset: take, openVerifiedStream: async () => Readable.from([Buffer.alloc(take.byteSize)]) };
    });
    const render = vi.fn<StudioFilmExporterV2['render']>();
    const harness = makeHarness(project, {
      resolveAssetV2,
      filmExporter: {
        capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
        render,
        dispose: vi.fn(),
      },
    });
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'film' as const,
      renderId: 'film_run_initial_resolver',
      transition: { kind: 'cut' as const },
      trimTails: false,
    };
    const pending = harness.service.createExport(request);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await resolverStarted;
    let cancelSettled = false;
    const cancellation = harness.service
      .cancelFilmExport({ projectId: project.id, renderId: request.renderId })
      .finally(() => {
        cancelSettled = true;
      });
    await Promise.resolve();
    expect(cancelSettled).toBe(false);
    expect(render).not.toHaveBeenCalled();
    releaseResolver();
    await expect(cancellation).resolves.toEqual({ status: 'cancelled' });
    await outcome;
    expect(render).not.toHaveBeenCalled();
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('refuses cancellation in publishing and waits for final authority-source resolution before disposal settles', async () => {
    const project = makeSchema2ServiceProject();
    addGeneratedVideosForMcpV2(project, 1);
    const take = project.assets.take_01!;
    let markFinalResolverStarted!: () => void;
    const finalResolverStarted = new Promise<void>((resolve) => {
      markFinalResolverStarted = resolve;
    });
    let releaseFinalResolver!: () => void;
    const finalResolverReleased = new Promise<void>((resolve) => {
      releaseFinalResolver = resolve;
    });
    const finalOpen = vi.fn(async () => Readable.from([Buffer.alloc(take.byteSize)]));
    const cleanup = vi.fn(async () => undefined);
    const harness = makeHarness(project, {
      resolveAssetV2: vi.fn(async () => ({
        asset: take,
        openVerifiedStream: async () => Readable.from([Buffer.alloc(take.byteSize)]),
      })),
      resolveAssetWithProjectAuthorityV2: vi.fn(async () => {
        markFinalResolverStarted();
        await finalResolverReleased;
        return { asset: take, openVerifiedStream: finalOpen };
      }),
      filmExporter: {
        capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
        render: vi.fn(async () => ({
          facts: {} as never,
          byteSize: 4,
          sha256: 'd'.repeat(64),
          openVerifiedStream: async () => Readable.from([Buffer.from('film')]),
          cleanup,
        })),
        dispose: vi.fn(),
      },
    });
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'film' as const,
      renderId: 'film_run_final_resolver',
      transition: { kind: 'cut' as const },
      trimTails: false,
    };
    const pending = harness.service.createExport(request);
    const outcome = expect(pending).rejects.toMatchObject({ code: 'cancelled' });
    await finalResolverStarted;
    await expect(
      harness.service.cancelFilmExport({ projectId: project.id, renderId: request.renderId })
    ).resolves.toEqual({ status: 'cancellation_refused' });
    let jobSettled = false;
    void pending.then(
      () => {
        jobSettled = true;
      },
      () => {
        jobSettled = true;
      }
    );
    harness.service.dispose();
    await Promise.resolve();
    expect(jobSettled).toBe(false);
    releaseFinalResolver();
    await outcome;
    expect(finalOpen).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('refuses a cancellation that loses to the render failure and retains that winning terminal reason', async () => {
    const project = makeSchema2ServiceProject();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let rejectRender!: (error: unknown) => void;
    const render = vi.fn<StudioFilmExporterV2['render']>(
      () =>
        new Promise((_, reject) => {
          rejectRender = reject;
          markStarted();
        })
    );
    const harness = makeHarness(project, {
      filmExporter: {
        capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
        render,
        dispose: vi.fn(),
      },
    });
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'film' as const,
      renderId: 'film_run_failure_wins',
      transition: { kind: 'cut' as const },
      trimTails: false,
    };
    const pending = harness.service.createExport(request);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'render_failed' });
    await started;
    rejectRender(new StudioFilmExportErrorV2('render_failed'));
    await expect(
      harness.service.cancelFilmExport({ projectId: project.id, renderId: request.renderId })
    ).resolves.toEqual({ status: 'cancellation_refused' });
    await rejected;
    await expect(harness.service.getFilmExportStatus({ projectId: project.id })).resolves.toEqual({
      status: 'terminal',
      result: {
        projectId: project.id,
        renderId: request.renderId,
        outcome: 'failed',
        reason: 'render_failed',
      },
    });
    await expect(
      harness.service.acknowledgeFilmExport({ projectId: project.id, renderId: 'different_render' })
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('does not abandon a late final-source lease or settle disposal until that descriptor has closed', async () => {
    const project = makeSchema2ServiceProject();
    addGeneratedVideosForMcpV2(project, 1);
    const take = project.assets.take_01!;
    let markOpenStarted!: () => void;
    const openStarted = new Promise<void>((resolve) => {
      markOpenStarted = resolve;
    });
    let releaseOpen!: () => void;
    const openReleased = new Promise<void>((resolve) => {
      releaseOpen = resolve;
    });
    let releaseClose!: () => void;
    const closeReleased = new Promise<void>((resolve) => {
      releaseClose = resolve;
    });
    const returnStream = vi.fn(async () => {
      await closeReleased;
      return { done: true as const, value: undefined };
    });
    const finalStream = {
      [Symbol.asyncIterator]: () => ({
        next: async (): Promise<IteratorResult<Uint8Array>> => new Promise<IteratorResult<Uint8Array>>(() => undefined),
        return: returnStream,
      }),
    };
    const cleanup = vi.fn(async () => undefined);
    const filmExporter: StudioFilmExporterV2 = {
      capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
      render: vi.fn(async () => ({
        facts: {
          schemaVersion: 1,
          nominalDurationSeconds: 10,
          renderedDurationSeconds: 10,
          transition: { kind: 'cut' },
          dissolveCount: 0,
          trimTails: false,
          segments: [
            {
              kind: 'shot',
              shotId: 'clip_1',
              sourceAssetId: take.id,
              sourceSha256: take.sha256,
              sourceInSeconds: 0,
              sourceOutSeconds: 5,
              renderedSourceOutSeconds: 5,
              normalizedDurationSeconds: 5,
              chainBreak: 'none',
              hasAudio: true,
            },
            { kind: 'slate', beatId: 'section_2', shotId: 'clip_2', durationSeconds: 5, normalizedDurationSeconds: 5 },
          ],
          video: {
            container: 'mp4',
            codec: 'h264',
            encoder: 'h264_videotoolbox',
            profile: 'high',
            level: '4.2',
            width: 1920,
            height: 1080,
            frameRate: 24,
            pixelFormat: 'yuv420p',
            scaleMode: 'contain_black_pad',
            sampleAspectRatio: '1:1',
            colorPrimaries: 'bt709',
            colorTransfer: 'bt709',
            colorSpace: 'bt709',
            colorRange: 'tv',
            gopFrames: 48,
            bitrate: 12_000_000,
            trackTimeBase: '1/24000',
            metadataStripped: true,
            chaptersStripped: true,
            fastStart: false,
          },
          audio: {
            codec: 'aac',
            sampleRate: 48_000,
            channels: 2,
            channelLayout: 'stereo',
            sampleFormat: 'fltp',
            bitrate: 192_000,
            silenceForMissingStreams: true,
            takeGain: 1,
            bedAssetId: null,
            bedSha256: null,
            bedGain: null,
            bedFadeOutSeconds: null,
            bedFadeCurve: null,
            dissolveCrossfade: false,
            dissolveCurve: 'triangular',
            limiterPeak: 0.95,
            limiterLatencyCompensated: true,
          },
        },
        byteSize: 4,
        sha256: 'd'.repeat(64),
        openVerifiedStream: async () => Readable.from([Buffer.from('film')]),
        cleanup,
      })),
      dispose: vi.fn(),
    };
    const harness = makeHarness(project, {
      filmExporter,
      resolveAssetV2: vi.fn(async (_projectId, assetId) =>
        assetId === take.id
          ? { asset: take, openVerifiedStream: async () => Readable.from([Buffer.alloc(take.byteSize)]) }
          : null
      ),
      resolveAssetWithProjectAuthorityV2: vi.fn(async (_authority, assetId) =>
        assetId === take.id
          ? {
              asset: take,
              openVerifiedStream: async () => {
                markOpenStarted();
                await openReleased;
                return finalStream;
              },
            }
          : null
      ),
    });
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'film' as const,
      renderId: 'film_run_close_wait',
      transition: { kind: 'cut' as const },
      trimTails: false,
    };
    const pending = harness.service.createExport(request);
    await openStarted;

    let jobSettled = false;
    const observed = pending.then(
      () => {
        jobSettled = true;
        return null;
      },
      (error: unknown) => {
        jobSettled = true;
        return error;
      }
    );
    harness.service.dispose();
    await Promise.resolve();
    expect(jobSettled).toBe(false);
    expect(returnStream).not.toHaveBeenCalled();
    releaseOpen();
    await vi.waitFor(() => expect(returnStream).toHaveBeenCalledOnce());
    expect(jobSettled).toBe(false);
    releaseClose();

    await expect(observed).resolves.toMatchObject({ code: 'cancelled' });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it('discards and cleans a completed film when project authority changed during the out-of-lock render', async () => {
    const project = makeSchema2ServiceProject();
    const cleanup = vi.fn(async () => undefined);
    let markStarted!: () => void;
    let releaseRender!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });
    const filmExporter: StudioFilmExporterV2 = {
      capability: vi.fn(async () => ({ status: 'ready', encoder: 'h264_videotoolbox' })),
      render: vi.fn(async () => {
        markStarted();
        await released;
        return {
          facts: {
            schemaVersion: 1,
            nominalDurationSeconds: 8,
            renderedDurationSeconds: 8,
            transition: { kind: 'cut' },
            dissolveCount: 0,
            trimTails: false,
            segments: [
              {
                kind: 'slate',
                beatId: 'section_1',
                shotId: null,
                durationSeconds: 8,
                normalizedDurationSeconds: 8,
              },
            ],
            video: {
              container: 'mp4',
              codec: 'h264',
              encoder: 'h264_videotoolbox',
              profile: 'high',
              level: '4.2',
              width: 1920,
              height: 1080,
              frameRate: 24,
              pixelFormat: 'yuv420p',
              scaleMode: 'contain_black_pad',
              sampleAspectRatio: '1:1',
              colorPrimaries: 'bt709',
              colorTransfer: 'bt709',
              colorSpace: 'bt709',
              colorRange: 'tv',
              gopFrames: 48,
              bitrate: 12_000_000,
              trackTimeBase: '1/24000',
              metadataStripped: true,
              chaptersStripped: true,
              fastStart: false,
            },
            audio: {
              codec: 'aac',
              sampleRate: 48_000,
              channels: 2,
              channelLayout: 'stereo',
              sampleFormat: 'fltp',
              bitrate: 192_000,
              silenceForMissingStreams: true,
              takeGain: 1,
              bedAssetId: null,
              bedSha256: null,
              bedGain: null,
              bedFadeOutSeconds: null,
              bedFadeCurve: null,
              dissolveCrossfade: false,
              dissolveCurve: 'triangular',
              limiterPeak: 0.95,
              limiterLatencyCompensated: true,
            },
          },
          byteSize: 4,
          sha256: 'd'.repeat(64),
          openVerifiedStream: async () => Readable.from([Buffer.from('film')]),
          cleanup,
        };
      }),
      dispose: vi.fn(),
    };
    const harness = makeHarness(project, { filmExporter, createExportId: () => 'film_export_stale' });
    const pending = harness.service.createExport({
      projectId: project.id,
      expectedRevision: project.revision,
      expectedCatalogRevision: 1,
      shape: 'film',
      renderId: 'film_run_stale',
      transition: { kind: 'cut' },
      trimTails: false,
    });
    await started;
    await harness.store.updateProjectV2(
      project.id,
      (current) => ({ ...current, name: 'Changed during render' }),
      project.revision
    );
    releaseRender();

    await expect(pending).rejects.toMatchObject({ code: 'stale_project' });
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledOnce();
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
        schemaVersion: STUDIO_EXPORT_SCHEMA_VERSION_V2,
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
    expect(create.mock.calls[1]?.[1].files.some((file) => file.relativePath === 'script.md')).toBe(true);
    expect(create.mock.calls[1]?.[1].managedFileName).toMatch(/^editor-folder-\d{8}-\d{6}-\d{3}-[a-f0-9]{16}$/);
    expect(create.mock.calls[1]?.[1].managedFileName).not.toBe(create.mock.calls[1]?.[1].artifactId);
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
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
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
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
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
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
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

  it('never exports a project-reference output as a Shot still fallback', async () => {
    const project = makeSchema2ServiceProject();
    const referenceAsset = project.assets.asset_reference_background!;
    project.shots.clip_1!.seedStillId = null;
    referenceAsset.createdAt = '2026-08-17T23:59:59.000Z';
    const resolveAssetWithProjectAuthorityV2 = vi.fn<StudioMediaStore['resolveAssetWithProjectAuthorityV2']>();
    const harness = makeHarness(project, {
      createExportId: () => 'reference_leak_export',
      resolveAssetWithProjectAuthorityV2,
    });

    await expect(
      harness.service.createExport({
        projectId: project.id,
        expectedRevision: project.revision,
        expectedCatalogRevision: 1,
        shape: 'still',
        shotId: 'clip_1',
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    expect(resolveAssetWithProjectAuthorityV2).not.toHaveBeenCalled();
    expect(harness.exportCatalogStore.create).not.toHaveBeenCalled();
  });

  it.each([
    ['stale_catalog_revision', 'stale_export_catalog'],
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

  it('exports missing Shot coverage as one shared slate without entering generation or spend', async () => {
    const harness = makeHarness();

    await harness.service.createExport({
      projectId: 'project_v2',
      expectedRevision: 2,
      expectedCatalogRevision: 1,
      shape: 'editor_folder',
    });
    expect(harness.exportCatalogStore.create).toHaveBeenCalledOnce();
    const plan = vi.mocked(harness.exportCatalogStore.create).mock.calls[0]![1];
    expect(plan.files.map(({ relativePath }) => relativePath).toSorted()).toEqual([
      'media/slate.png',
      'script.md',
      'timeline.json',
    ]);
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
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

    await expect(harness.service.listProposals({ projectId: 'project_v2' })).resolves.toEqual({
      projectId: 'project_v2',
      projectRevision: harness.getProject().revision,
      proposals: [expect.objectContaining(harness.proposal)],
    });
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

  it('retries a proposal catalog read when a deferred ledger read straddles a project revision', async () => {
    const harness = makeHarness();
    let releaseLedger!: (proposals: StudioProposalV2[]) => void;
    const firstLedger = new Promise<StudioProposalV2[]>((resolve) => {
      releaseLedger = resolve;
    });
    harness.listProposalsV2
      .mockImplementationOnce(async () => firstLedger)
      .mockImplementation(async () => [structuredClone(harness.proposal)]);

    const pendingCatalog = harness.service.listProposals({ projectId: 'project_v2' });
    await vi.waitFor(() => expect(harness.listProposalsV2).toHaveBeenCalledOnce());
    const advanced = { ...harness.getProject(), revision: harness.getProject().revision + 1 };
    harness.setProject(advanced);
    releaseLedger([structuredClone(harness.proposal)]);

    await expect(pendingCatalog).resolves.toMatchObject({
      projectId: advanced.id,
      projectRevision: advanced.revision,
      proposals: [{ id: harness.proposal.id, review: { status: 'stale', currentRevision: advanced.revision } }],
    });
    expect(harness.listProposalsV2).toHaveBeenCalledTimes(2);
    expect(harness.store.getProjectV2).toHaveBeenCalledTimes(4);
  });

  it('fails a proposal catalog read closed after both bounded snapshots observe concurrent revision movement', async () => {
    const harness = makeHarness();
    harness.listProposalsV2.mockImplementation(async () => {
      const current = harness.getProject();
      harness.setProject({ ...current, revision: current.revision + 1 });
      return [structuredClone(harness.proposal)];
    });

    await expect(harness.service.listProposals({ projectId: 'project_v2' })).rejects.toMatchObject({
      code: 'stale_project',
    });
    expect(harness.listProposalsV2).toHaveBeenCalledTimes(2);
    expect(harness.store.getProjectV2).toHaveBeenCalledTimes(4);
  });

  it('projects reference handoffs from immutable authorization jobs without exposing their identity', () => {
    const project = makeSchema2ServiceProject();
    project.spendAuthorizations[0]!.originReferenceHandoffId = 'handoff_1';
    const decision = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId: 'reference_request_1',
      projectId: 'project_v2',
      decidedAt: '2026-08-17T00:00:01.000Z',
      outcome: {
        kind: 'generation_gate' as const,
        handoffId: 'handoff_1',
        referenceIds: ['ref_background'],
      },
    };

    expect(projectStudioReferenceGenerationHandoffV2(decision, null)).toEqual({
      handoffId: 'handoff_1',
      requestId: 'reference_request_1',
      referenceIds: ['ref_background'],
      decidedAt: decision.decidedAt,
      status: 'awaiting_spend',
      completedAt: null,
      counts: { queued: 0, running: 0, succeeded: 0, failed: 0 },
      resultAssetIds: [],
      failedReferenceIds: [],
    });
    const receipt = {
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      handoffId: 'handoff_1',
      requestId: 'reference_request_1',
      completedAt: '2026-08-17T00:00:02.000Z',
      result: { kind: 'confirmed' as const, authorizationId: SERVICE_REFERENCE_AUTHORIZATION_ID },
    };
    const confirmed = projectStudioReferenceGenerationHandoffV2(decision, receipt, project);
    expect(confirmed).toEqual({
      handoffId: 'handoff_1',
      requestId: 'reference_request_1',
      referenceIds: ['ref_background'],
      decidedAt: decision.decidedAt,
      status: 'succeeded',
      completedAt: '2026-08-17T00:00:00.000Z',
      counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
      resultAssetIds: ['asset_reference_background'],
      failedReferenceIds: [],
    });
    expect(JSON.stringify(confirmed)).not.toContain(SERVICE_REFERENCE_AUTHORIZATION_ID);

    const failed = structuredClone(project);
    failed.jobs[SERVICE_REFERENCE_JOB_ID]!.status = 'failed';
    failed.jobs[SERVICE_REFERENCE_JOB_ID]!.error = {
      code: 'provider_unavailable',
      messageKey: 'providerUnavailable',
    };
    failed.jobs[SERVICE_REFERENCE_JOB_ID]!.outputAssetIds = [];
    failed.jobs[SERVICE_REFERENCE_JOB_ID]!.outputAssetIdsByRole.primary = null;
    expect(projectStudioReferenceGenerationHandoffV2(decision, receipt, failed)).toMatchObject({
      counts: { queued: 0, running: 0, succeeded: 0, failed: 1 },
      resultAssetIds: [],
      failedReferenceIds: ['ref_background'],
    });

    for (const [status, error, failedReferenceIds] of [
      ['needs_attention', { code: 'submission_unknown', messageKey: 'submissionUnknown' }, []],
      ['cancelled', null, ['ref_background']],
      ['failed', { code: 'download_failed', messageKey: 'downloadFailed' }, []],
      ['failed', { code: 'poll_deadline', messageKey: 'pollDeadline' }, ['ref_background']],
    ] as const) {
      const terminal = structuredClone(project);
      terminal.jobs[SERVICE_REFERENCE_JOB_ID]!.status = status;
      terminal.jobs[SERVICE_REFERENCE_JOB_ID]!.error = error;
      terminal.jobs[SERVICE_REFERENCE_JOB_ID]!.outputAssetIds = [];
      terminal.jobs[SERVICE_REFERENCE_JOB_ID]!.outputAssetIdsByRole.primary = null;
      expect(projectStudioReferenceGenerationHandoffV2(decision, receipt, terminal)).toMatchObject({
        counts: { queued: 0, running: 0, succeeded: 0, failed: 1 },
        failedReferenceIds,
      });
    }

    const retried = structuredClone(failed);
    const retryAssetId = 'asset_reference_background_retry';
    retried.assets[retryAssetId] = {
      ...structuredClone(retried.assets.asset_reference_background!),
      id: retryAssetId,
      managedAsset: { collection: 'assets', fileName: `${retryAssetId}.png` },
      producerJobId: 'job_reference_background_retry',
    };
    retried.jobs.job_reference_background_retry = {
      ...structuredClone(retried.jobs[SERVICE_REFERENCE_JOB_ID]!),
      id: 'job_reference_background_retry',
      status: 'succeeded',
      authorizationId: 'authorization_reference_background_retry',
      authorizationItemId: 'item_reference_background_retry',
      idempotencyKey: 'idempotency_reference_background_retry',
      outputAssetIds: [retryAssetId],
      outputAssetIdsByRole: { primary: retryAssetId, poster: null },
      error: null,
      retryOfJobId: SERVICE_REFERENCE_JOB_ID,
      retryReason: 'provider_failure',
    };
    retried.references.ref_background!.jobIds.push('job_reference_background_retry');
    retried.references.ref_background!.supersededAssetIds.push('asset_reference_background');
    retried.references.ref_background!.approvedAssetId = retryAssetId;
    expect(projectStudioReferenceGenerationHandoffV2(decision, receipt, retried)).toMatchObject({
      counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
      resultAssetIds: [retryAssetId],
      failedReferenceIds: [],
    });

    const boundedRetry = structuredClone(project);
    const boundedAuthorization = boundedRetry.spendAuthorizations[0]!;
    const boundedItem = boundedAuthorization.baseItems[0]!;
    boundedItem.generationCount = 2;
    boundedAuthorization.upperMinorUnits = boundedAuthorization.lowerMinorUnits * 2;
    boundedAuthorization.idempotencyKeys.push({ itemId: boundedItem.id, key: 'idempotency_reference_grid_retry' });
    const boundedFirst = boundedRetry.jobs[SERVICE_REFERENCE_JOB_ID]!;
    boundedFirst.status = 'failed';
    boundedFirst.error = {
      code: 'seed_still_variation_grid',
      messageKey: 'conversation.creativeStudio.jobs.errors.seedStillVariationGrid',
    };
    boundedFirst.outputAssetIds = [];
    boundedFirst.outputAssetIdsByRole.primary = null;
    const boundedAssetId = 'asset_reference_grid_retry';
    boundedRetry.assets[boundedAssetId] = {
      ...structuredClone(boundedRetry.assets.asset_reference_background!),
      id: boundedAssetId,
      managedAsset: { collection: 'assets', fileName: `${boundedAssetId}.png` },
      producerJobId: 'job_reference_grid_retry',
    };
    const boundedSecond = {
      ...structuredClone(boundedFirst),
      id: 'job_reference_grid_retry',
      status: 'succeeded' as const,
      idempotencyKey: 'idempotency_reference_grid_retry',
      outputAssetIds: [boundedAssetId],
      outputAssetIdsByRole: { primary: boundedAssetId, poster: null },
      error: null,
      retryOfJobId: boundedFirst.id,
      retryReason: 'variation_grid' as const,
    };
    boundedRetry.jobs = {
      [boundedSecond.id]: boundedSecond,
      [boundedFirst.id]: boundedFirst,
    };
    boundedRetry.references.ref_background!.jobIds = [boundedFirst.id, boundedSecond.id];
    boundedRetry.references.ref_background!.supersededAssetIds = ['asset_reference_background'];
    boundedRetry.references.ref_background!.approvedAssetId = boundedAssetId;
    expect(projectStudioReferenceGenerationHandoffV2(decision, receipt, boundedRetry)).toMatchObject({
      counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
      resultAssetIds: [boundedAssetId],
      failedReferenceIds: [],
    });

    const pollDeadlineRetried = structuredClone(retried);
    pollDeadlineRetried.jobs[SERVICE_REFERENCE_JOB_ID]!.error = {
      code: 'poll_deadline',
      messageKey: 'pollDeadline',
    };
    pollDeadlineRetried.jobs.job_reference_background_retry!.retryReason = 'submission_unknown';
    pollDeadlineRetried.jobs.job_reference_background_retry!.duplicateChargeAcknowledged = true;
    pollDeadlineRetried.jobs.job_reference_background_retry!.duplicateChargeAcknowledgedAt = '2026-08-17T00:00:02.000Z';
    expect(projectStudioReferenceGenerationHandoffV2(decision, receipt, pollDeadlineRetried)).toMatchObject({
      counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
      resultAssetIds: [retryAssetId],
      failedReferenceIds: [],
    });
    expect(() => projectStudioReferenceGenerationHandoffV2(decision, receipt)).toThrowError(
      expect.objectContaining({ code: 'storage_error' })
    );
    expect(projectStudioReferenceGenerationHandoffV2({ ...decision, outcome: { kind: 'rejected' } }, null)).toBeNull();
    expect(() =>
      projectStudioReferenceGenerationHandoffV2(
        { ...decision, outcome: { kind: 'rejected' } },
        {
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          handoffId: 'handoff_1',
          requestId: 'reference_request_1',
          completedAt: '2026-08-17T00:00:02.000Z',
          result: { kind: 'dismissed' },
        }
      )
    ).toThrowError(expect.objectContaining({ code: 'storage_error' }));
    expect(() =>
      projectStudioReferenceGenerationHandoffV2(decision, {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      outcome: { kind: 'generation_gate', handoffId: 'handoff_service_1', referenceIds: ['ref_background'] },
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
      outcome: {
        kind: 'generation_gate' as const,
        handoffId: 'handoff_service_2',
        referenceIds: ['ref_background'],
      },
    };
    const handoffProject = harness.getProject();
    handoffProject.spendAuthorizations[0]!.originReferenceHandoffId = 'handoff_service_2';
    harness.setProject(handoffProject);
    harness.listReferenceRequestsV2.mockResolvedValueOnce([
      {
        request: {
          ...structuredClone(harness.referenceRequest),
          id: laterDecision.requestId,
          createdAt: '2026-08-17T00:00:02.000Z',
        },
        decision: laterDecision,
        receipt: {
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          handoffId: 'handoff_service_2',
          requestId: laterDecision.requestId,
          completedAt: '2026-08-17T00:00:04.000Z',
          result: { kind: 'confirmed', authorizationId: SERVICE_REFERENCE_AUTHORIZATION_ID },
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
        referenceIds: ['ref_background'],
        decidedAt: decided.decidedAt,
        status: 'awaiting_spend',
        completedAt: null,
        counts: { queued: 0, running: 0, succeeded: 0, failed: 0 },
        resultAssetIds: [],
        failedReferenceIds: [],
      },
      {
        handoffId: 'handoff_service_2',
        requestId: laterDecision.requestId,
        referenceIds: ['ref_background'],
        decidedAt: laterDecision.decidedAt,
        status: 'succeeded',
        completedAt: '2026-08-17T00:00:00.000Z',
        counts: { queued: 0, running: 0, succeeded: 1, failed: 0 },
        resultAssetIds: ['asset_reference_background'],
        failedReferenceIds: [],
      },
    ]);
    expect(JSON.stringify(handoffs)).not.toContain(SERVICE_REFERENCE_AUTHORIZATION_ID);
  });

  it('prepares and confirms only the exact ordered seed-only reference handoff', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    harness.listReferenceRequestsV2.mockResolvedValueOnce([
      {
        request: structuredClone(harness.referenceRequest),
        decision: {
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          requestId: harness.referenceRequest.id,
          projectId: project.id,
          decidedAt: '2026-08-17T00:00:02.000Z',
          outcome: {
            kind: 'generation_gate',
            handoffId: 'handoff_service_1',
            referenceIds: ['ref_background'],
          },
        },
        receipt: null,
      },
    ]);

    const prepared = await harness.service.prepareProjectReferences({
      projectId: project.id,
      expectedRevision: project.revision,
      referenceIds: ['ref_background'],
    });

    expect(prepared).toMatchObject({
      baseOnly: {
        projectId: project.id,
        projectRevision: project.revision,
        baseItems: [{ target: { kind: 'reference', referenceId: 'ref_background' } }],
      },
      withCascade: null,
    });
    expect(harness.listReferenceRequestsV2).toHaveBeenCalledExactlyOnceWith(project.id);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    expect(harness.confirmReferenceGenerationHandoffV2).toHaveBeenCalledTimes(1);
    expect(harness.getProject().spendAuthorizations).toContainEqual(
      expect.objectContaining({
        id: prepared.baseOnly.id,
        originReferenceHandoffId: 'handoff_service_1',
        baseItems: [
          expect.objectContaining({
            target: { kind: 'reference', referenceId: 'ref_background' },
            purpose: 'reference_image',
            generationCount: 2,
          }),
        ],
        cascadeItems: [],
      })
    );
    expect(
      Object.values(harness.getProject().jobs).filter((job) => job.authorizationId === prepared.baseOnly.id)
    ).toEqual([
      expect.objectContaining({
        target: { kind: 'reference', referenceId: 'ref_background' },
        purpose: 'reference_image',
      }),
    ]);
    expect(harness.submitShots).toHaveBeenCalledTimes(1);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
  });

  it('regenerates an approved reference after every shot stops using it', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    for (const shot of Object.values(project.shots)) {
      shot.referenceBinding = { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null };
    }
    expect(validateStudioProjectV2(project)).toBe(true);

    const harness = makeHarness(project);
    const prepared = await harness.service.prepareProjectReferences({
      projectId: project.id,
      expectedRevision: project.revision,
      referenceIds: ['ref_background'],
    });

    expect(prepared.baseOnly.baseItems).toEqual([
      expect.objectContaining({
        target: { kind: 'reference', referenceId: 'ref_background' },
        purpose: 'reference_image',
      }),
    ]);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });

    const committed = harness.getProject();
    const regenerated = Object.values(committed.jobs).find((job) => job.authorizationId === prepared.baseOnly.id)!;
    expect(committed.spendAuthorizations).toContainEqual(
      expect.objectContaining({
        id: prepared.baseOnly.id,
        baseItems: [
          expect.objectContaining({
            target: { kind: 'reference', referenceId: 'ref_background' },
            purpose: 'reference_image',
          }),
        ],
      })
    );
    expect(regenerated).toMatchObject({
      target: { kind: 'reference', referenceId: 'ref_background' },
      purpose: 'reference_image',
    });
    expect(committed.references.ref_background).toMatchObject({
      approvedAssetId: 'asset_reference_background',
      jobIds: expect.arrayContaining([regenerated.id]),
    });
    expect(committed.shots.clip_1!.referenceBinding.status).toBe('unassigned');
    expect(committed.shots.clip_2!.referenceBinding.status).toBe('unassigned');
    expect(validateStudioProjectV2(committed)).toBe(true);
    expect(harness.submitShots).toHaveBeenCalledTimes(1);
  });

  it.each([
    {
      label: 'cancelled candidate',
      status: 'cancelled',
      error: null,
      expectedRetryReason: 'provider_failure',
      expectedDuplicateChargeAcknowledged: false,
    },
    {
      label: 'poll-deadline candidate',
      status: 'failed',
      error: { code: 'poll_deadline', messageKey: 'pollDeadline' },
      expectedRetryReason: 'submission_unknown',
      expectedDuplicateChargeAcknowledged: true,
    },
  ] as const)(
    'carries paid project-reference lineage from a $label',
    async ({ status, error, expectedRetryReason, expectedDuplicateChargeAcknowledged }) => {
      const project = makeSchema2ServiceProject();
      project.imageRouteId = imageRoute.choiceId;
      const predecessor = project.jobs[SERVICE_REFERENCE_JOB_ID]!;
      const oldAssetId = predecessor.outputAssetIdsByRole.primary!;
      predecessor.status = status;
      predecessor.error = error === null ? null : { ...error };
      predecessor.outputAssetIds = [];
      predecessor.outputAssetIdsByRole = { primary: null, poster: null };
      predecessor.spendReceipt = null;
      if (status === 'cancelled') {
        predecessor.providerJobId = null;
        predecessor.remoteStartedAt = null;
      }
      delete project.assets[oldAssetId];
      project.shots.clip_1!.assetIds = project.shots.clip_1!.assetIds.filter((assetId) => assetId !== oldAssetId);
      project.references.ref_background!.approvedAssetId = null;
      for (const shot of Object.values(project.shots)) {
        shot.referenceBinding = { status: 'unassigned', characterReferenceIds: [], backgroundReferenceId: null };
      }

      const harness = makeHarness(project);
      const prepared = await harness.service.prepareProjectReferences({
        projectId: project.id,
        expectedRevision: project.revision,
        referenceIds: ['ref_background'],
      });
      await harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      });

      const committed = harness.getProject();
      const retry = Object.values(committed.jobs).find((job) => job.authorizationId === prepared.baseOnly.id)!;
      expect(retry).toMatchObject({
        target: { kind: 'reference', referenceId: 'ref_background' },
        retryOfJobId: SERVICE_REFERENCE_JOB_ID,
        retryReason: expectedRetryReason,
        duplicateChargeAcknowledged: expectedDuplicateChargeAcknowledged,
        duplicateChargeAcknowledgedAt: expectedDuplicateChargeAcknowledged ? '2026-08-17T00:00:02.000Z' : null,
      });
      expect(committed.references.ref_background).toMatchObject({
        jobIds: expect.arrayContaining([retry.id]),
      });
      expect(validateStudioProjectV2(committed)).toBe(true);
    }
  );

  it('refuses malformed, unknown, ambiguous, and already-authorized project-reference preparation', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const createQuoteId = vi.fn(() => 'quote_must_not_be_created');
    const harness = makeHarness(project, { createQuoteId });
    const exact = {
      projectId: project.id,
      expectedRevision: project.revision,
      referenceIds: ['ref_background'],
    };
    const malformed = [
      { ...exact, referenceIds: [] },
      { ...exact, referenceIds: ['ref_background', 'ref_background'] },
      { ...exact, referenceIds: ['../unsafe'] },
      { ...exact, extra: true },
    ];

    for (const request of malformed) {
      // Each shape deliberately violates the exact renderer preparation contract.
      // eslint-disable-next-line no-await-in-loop
      await expect(harness.service.prepareProjectReferences(request as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }
    await expect(
      harness.service.prepareProjectReferences({ ...exact, referenceIds: ['missing_reference'] })
    ).rejects.toMatchObject({ code: 'invalid_reference' });

    const openEntry = {
      request: structuredClone(harness.referenceRequest),
      decision: {
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: harness.referenceRequest.id,
        projectId: project.id,
        decidedAt: '2026-08-17T00:00:02.000Z',
        outcome: {
          kind: 'generation_gate' as const,
          handoffId: 'handoff_service_1',
          referenceIds: ['ref_background'],
        },
      },
      receipt: null,
    };
    harness.listReferenceRequestsV2.mockResolvedValueOnce([
      openEntry,
      {
        request: { ...structuredClone(openEntry.request), id: 'reference_request_service_ambiguous' },
        decision: {
          ...structuredClone(openEntry.decision),
          requestId: 'reference_request_service_ambiguous',
          outcome: { ...openEntry.decision.outcome, handoffId: 'handoff_service_ambiguous' },
        },
        receipt: null,
      },
    ]);
    await expect(harness.service.prepareProjectReferences(exact)).rejects.toMatchObject({ code: 'storage_error' });

    const existingOrigin = structuredClone(project);
    existingOrigin.spendAuthorizations.push({
      originReferenceHandoffId: 'handoff_service_1',
    } as never);
    harness.setProject(existingOrigin);
    harness.listReferenceRequestsV2.mockResolvedValueOnce([openEntry]);
    await expect(harness.service.prepareProjectReferences(exact)).rejects.toMatchObject({ code: 'invalid_payload' });

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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
    };

    await expect(
      makeHarness(project, { includeRateCard: false }).service.prepareSubmission(request)
    ).rejects.toMatchObject({ code: 'invalid_route' });
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
        baseChoices: [shotChoiceV2('clip_1', 'video_take')],
        cascadeChoices: [],
      })
    ).rejects.toMatchObject({ name: 'StudioPricingErrorV2', code: 'missing_conditioning' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('preserves a blank Shooting-script refusal before provider, cache, pricing, or paid work', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.shots.clip_1!.shootingScript = ' \n ';
    const preparedSubmissionCache = new StudioPreparedSubmissionCacheV2();
    const admit = vi.spyOn(preparedSubmissionCache, 'admit');
    const harness = makeHarness(project, { preparedSubmissionCache });

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: project.revision,
        originReferenceHandoffId: null,
        baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
        cascadeChoices: [],
      })
    ).rejects.toMatchObject({ name: 'StudioPricingErrorV2', code: 'missing_shooting_script' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('keeps a 12-second target advisory when a spendable Board-only batch plans 10 seconds', async () => {
    const project = makeSchema2ServiceProject();
    project.boardStyle = 'grey_tone';
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    const plannedDurationSeconds = project.beatOrder
      .flatMap((beatId) => project.beats[beatId]!.shotOrder)
      .reduce((total, shotId) => total + project.shots[shotId]!.durationSeconds, 0);

    expect(project.targetDurationSeconds).toBe(12);
    expect(plannedDurationSeconds).toBe(10);

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [shotChoiceV2('clip_1', 'board_still'), shotChoiceV2('clip_2', 'board_still')],
      cascadeChoices: [],
    });
    expect(prepared.withCascade).toBeNull();
    expect(prepared.baseOnly.baseItems).toHaveLength(2);

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    const committed = harness.getProject();
    const boardJobs = Object.values(committed.jobs).filter((job) => job.purpose === 'board_still');
    const workspace = await harness.service.getProjectWorkspace({ projectId: project.id });

    expect(boardJobs).toHaveLength(2);
    expect(workspace).toMatchObject({
      status: 'supported',
      snapshot: {
        workspaceStatus: {
          boardPanels: boardJobs.map((job) => ({
            shotId: job.target.kind === 'shot' ? job.target.shotId : null,
            assetId: null,
            producerJobId: null,
            latestJobId: job.id,
            staleCauses: [],
          })),
        },
      },
    });
    expect(harness.submitShots).toHaveBeenCalledWith({
      projectId: project.id,
      jobIds: boardJobs.map((job) => job.id),
    });
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [],
    });

    expect(admit).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
        }),
      })
    );
    expect(prepared.withCascade?.cascadeItems).toEqual([
      expect.objectContaining({
        target: { kind: 'shot', shotId: 'clip_1' },
        purpose: 'video_take',
        generationCount: 1,
      }),
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
          baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
          cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
    const committedJob = Object.values(harness.getProject().jobs).find(
      (job) => job.authorizationId === prepared.baseOnly.id
    )!;
    expect(committedJob.id).toMatch(/^job_[a-f0-9]{32}$/);
    expect(committedJob.idempotencyKey).toMatch(/^key_[a-f0-9]{32}$/);
  });

  it('projects supported generation items in persisted Shot and purpose order', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);

    const result = await harness.service.getGenerationCapability({
      projectId: 'project_v2',
      expectedRevision: project.revision,
      items: [
        shotCapabilityV2('clip_2', 'video_take'),
        shotCapabilityV2('clip_1', 'video_take'),
        shotCapabilityV2('clip_1', 'seed_still'),
      ],
    });

    expect(result).toMatchObject({
      projectId: project.id,
      projectRevision: project.revision,
      catalogVersion: 'catalog_v2',
      blocks: [],
    });
    expect(result.supportedItems).toEqual([
      shotCapabilityV2('clip_1', 'seed_still'),
      shotCapabilityV2('clip_1', 'video_take'),
      shotCapabilityV2('clip_2', 'video_take'),
    ]);
  });

  it('rejects stale generation capability before resolving the route catalog', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);

    await expect(
      harness.service.getGenerationCapability({
        projectId: project.id,
        expectedRevision: project.revision + 1,
        items: [shotCapabilityV2('clip_1', 'seed_still')],
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
  });

  it('keeps video generation ready while a Board redraw is nonterminal', async () => {
    const project = makeSchema2ServiceProject();
    project.boardStyle = 'grey_tone';
    project.jobs.board_job = makeSchema2Job(project, {
      id: 'board_job',
      purpose: 'board_still',
      status: 'running',
      providerJobId: 'remote_board_job',
      error: null,
    });
    project.shots.clip_1.jobIds = ['board_job'];
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'video_take')],
    });

    expect(capability.supportedItems).toEqual([shotCapabilityV2('clip_1', 'video_take')]);
    expect(capability.blocks).toEqual([]);
  });

  it('keeps Shot generation ready while project-reference jobs run or fail', async () => {
    const project = makeSchema2ServiceProject();
    project.jobs.reference_pending = makeSchema2Job(project, {
      id: 'reference_pending',
      target: { kind: 'reference', referenceId: 'ref_background' },
      purpose: 'reference_image',
      status: 'running',
      providerJobId: 'remote_reference_pending',
      error: null,
    });
    project.jobs.reference_failed = makeSchema2Job(project, {
      id: 'reference_failed',
      target: { kind: 'reference', referenceId: 'ref_background' },
      purpose: 'reference_image',
      status: 'failed',
      error: { code: 'provider_unavailable', messageKey: 'providerUnavailable' },
    });
    project.references.ref_background!.jobIds.push('reference_pending', 'reference_failed');
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'seed_still')],
    });

    expect(capability.supportedItems).toEqual([shotCapabilityV2('clip_1', 'seed_still')]);
    expect(capability.blocks).toEqual([]);
  });

  it('groups exact missing-engine blockers without treating optional copy as required', async () => {
    const project = makeSchema2ServiceProject();
    project.beats.section_1.title = '';
    project.shots.clip_2.shootingScript = '';
    const harness = makeHarness(project);

    const result = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [
        shotCapabilityV2('clip_1', 'seed_still'),
        shotCapabilityV2('clip_1', 'video_take'),
        shotCapabilityV2('clip_2', 'seed_still'),
        shotCapabilityV2('clip_2', 'video_take'),
      ],
    });

    expect(result.supportedItems).toEqual([]);
    expect(result.blocks).toEqual([
      {
        block: { code: 'no_engine', role: 'image' },
        items: [shotCapabilityV2('clip_1', 'seed_still'), shotCapabilityV2('clip_2', 'seed_still')],
      },
      {
        block: { code: 'no_engine', role: 'video' },
        items: [shotCapabilityV2('clip_1', 'video_take'), shotCapabilityV2('clip_2', 'video_take')],
      },
    ]);
  });

  it('coalesces an initial route refresh with capability derivation and reuses that provider snapshot', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    const catalog: StudioGenerationRouteCatalog = {
      routes: [imageRoute, videoRoute],
      diagnostics: [],
      generationCatalogVersion: 'catalog_atomic',
    };
    let resolveCatalog!: (value: StudioGenerationRouteCatalog) => void;
    const catalogFlight = new Promise<StudioGenerationRouteCatalog>((resolve) => {
      resolveCatalog = resolve;
    });
    harness.providerResolver.listGenerationRoutes.mockReturnValue(catalogFlight);

    const routesPromise = harness.service.listRoutes({ projectId: project.id });
    const capabilityPromise = harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'seed_still')],
    });
    await vi.waitFor(() => expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledOnce());
    resolveCatalog(catalog);

    const [routes, capability] = await Promise.all([routesPromise, capabilityPromise]);
    expect(routes.catalogVersion).toBe('catalog_atomic');
    expect(capability.catalogVersion).toBe('catalog_atomic');
    await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'board_still')],
    });
    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledOnce();
  });

  it('fails closed with renderer-safe catalog blockers when route discovery fails', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(new Error('secret resolver diagnostic'));

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'seed_still'), shotCapabilityV2('clip_1', 'video_take')],
    });

    expect(capability).toMatchObject({ catalogVersion: null, supportedItems: [] });
    expect(capability.blocks).toEqual([
      {
        block: { code: 'catalog_unloaded', role: 'image' },
        items: [shotCapabilityV2('clip_1', 'seed_still')],
      },
      {
        block: { code: 'catalog_unloaded', role: 'video' },
        items: [shotCapabilityV2('clip_1', 'video_take')],
      },
    ]);
    expect(JSON.stringify(capability)).not.toContain('secret resolver diagnostic');
  });

  it.each([
    ['health', { ...imageRoute, health: 'unavailable' as const }, { code: 'health', role: 'image' }],
    [
      'aspect ratio',
      {
        ...imageRoute,
        constraints: { ...imageRoute.constraints, aspectRatios: ['9:16' as const] },
      },
      { code: 'frame', role: 'image', ratio: '16:9' },
    ],
    [
      'resolution',
      {
        ...imageRoute,
        constraints: { ...imageRoute.constraints, resolutions: ['720p' as const] },
      },
      { code: 'resolution', role: 'image', resolution: '1080p' },
    ],
    [
      'duration',
      {
        ...imageRoute,
        constraints: { ...imageRoute.constraints, supportedDurationSeconds: [4] },
      },
      { code: 'duration', role: 'image', seconds: 5 },
    ],
  ])('projects an exact %s capability blocker for the persisted image route', async (_label, route, block) => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [route, videoRoute],
      diagnostics: [],
      generationCatalogVersion: 'catalog_blocked',
    });

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'seed_still')],
    });

    expect(capability.supportedItems).toEqual([]);
    expect(capability.blocks).toEqual([{ block, items: [shotCapabilityV2('clip_1', 'seed_still')] }]);
  });

  it('uses the fixed four-second Board request duration for discrete image-route capability', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [
        {
          ...imageRoute,
          constraints: { ...imageRoute.constraints, supportedDurationSeconds: [4] },
        },
        videoRoute,
      ],
      diagnostics: [],
      generationCatalogVersion: 'catalog_board_fixed_duration',
    });

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'seed_still'), shotCapabilityV2('clip_1', 'board_still')],
    });

    expect(project.shots.clip_1.durationSeconds).toBe(5);
    expect(capability.supportedItems).toEqual([shotCapabilityV2('clip_1', 'board_still')]);
    expect(capability.blocks).toEqual([
      {
        block: { code: 'duration', role: 'image', seconds: 5 },
        items: [shotCapabilityV2('clip_1', 'seed_still')],
      },
    ]);
  });

  it('uses the fixed four-second reference-image request duration through the target union', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [
        {
          ...imageRoute,
          constraints: { ...imageRoute.constraints, supportedDurationSeconds: [4] },
        },
        videoRoute,
      ],
      diagnostics: [],
      generationCatalogVersion: 'catalog_reference_fixed_duration',
    });

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [referenceCapabilityV2('ref_background')],
    });

    expect(capability.supportedItems).toEqual([referenceCapabilityV2('ref_background')]);
    expect(capability.blocks).toEqual([]);
  });

  it.each([
    ['needs_setup', 'needs_setup' as const],
    ['health', 'health' as const],
  ])('projects a selected-route %s diagnostic without leaking provider details', async (code, status) => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [videoRoute],
      diagnostics: [
        {
          status,
          providerId: imageRoute.providerId,
          providerName: 'Sensitive provider name',
          adapterId: imageRoute.adapterId,
          model: imageRoute.model,
        },
      ],
      generationCatalogVersion: 'catalog_diagnostic',
    });

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'seed_still')],
    });

    expect(capability.blocks).toEqual([
      {
        block: { code, role: 'image' },
        items: [shotCapabilityV2('clip_1', 'seed_still')],
      },
    ]);
    expect(JSON.stringify(capability)).not.toContain('Sensitive provider name');
  });

  it('projects retired, first-frame, and reference-capacity blockers from exact persisted authority', async () => {
    const retiredProject = makeSchema2ServiceProject();
    retiredProject.imageRouteId = imageRoute.choiceId;
    const retiredHarness = makeHarness(retiredProject);
    retiredHarness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [videoRoute],
      diagnostics: [],
      generationCatalogVersion: 'catalog_retired',
    });
    await expect(
      retiredHarness.service.getGenerationCapability({
        projectId: retiredProject.id,
        expectedRevision: retiredProject.revision,
        items: [shotCapabilityV2('clip_1', 'seed_still')],
      })
    ).resolves.toMatchObject({
      blocks: [{ block: { code: 'retired', role: 'image' } }],
    });

    const firstFrameProject = makeSchema2ServiceProject();
    firstFrameProject.videoRouteId = videoRoute.choiceId;
    const firstFrameHarness = makeHarness(firstFrameProject);
    firstFrameHarness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [
        imageRoute,
        {
          ...videoRoute,
          constraints: { ...videoRoute.constraints, supportsFirstFrame: false },
        },
      ],
      diagnostics: [],
      generationCatalogVersion: 'catalog_first_frame',
    });
    await expect(
      firstFrameHarness.service.getGenerationCapability({
        projectId: firstFrameProject.id,
        expectedRevision: firstFrameProject.revision,
        items: [shotCapabilityV2('clip_1', 'video_take')],
      })
    ).resolves.toMatchObject({
      blocks: [{ block: { code: 'first_frame', role: 'video' } }],
    });

    const capacityProject = makeSchema2ServiceProject();
    capacityProject.imageRouteId = imageRoute.choiceId;
    const capacityHarness = makeHarness(capacityProject);
    capacityHarness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [
        {
          ...imageRoute,
          constraints: { ...imageRoute.constraints, maxConditioningImages: 0 },
        },
        videoRoute,
      ],
      diagnostics: [],
      generationCatalogVersion: 'catalog_capacity',
    });
    await expect(
      capacityHarness.service.getGenerationCapability({
        projectId: capacityProject.id,
        expectedRevision: capacityProject.revision,
        items: [shotCapabilityV2('clip_1', 'board_still')],
      })
    ).resolves.toMatchObject({
      blocks: [
        {
          block: {
            code: 'reference_binding',
            role: 'image',
            reason: 'capacity_exceeded',
            selectedCount: 1,
            limit: 0,
          },
        },
      ],
    });
  });

  it('projects an unassigned Shot reference binding through Main capability authority', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.shots.clip_1.referenceBinding = {
      status: 'unassigned',
      characterReferenceIds: [],
      backgroundReferenceId: null,
    };
    const harness = makeHarness(project);

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'board_still')],
    });

    expect(capability.supportedItems).toEqual([]);
    expect(capability.blocks).toEqual([
      {
        block: {
          code: 'reference_binding',
          role: 'image',
          reason: 'unassigned',
          selectedCount: 0,
          limit: 1,
        },
        items: [shotCapabilityV2('clip_1', 'board_still')],
      },
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

  it('preserves a quarantined-project runtime cause while listing connection candidates', async () => {
    const harness = makeHarness();
    const runtimeError = new CreativeStudioServiceError('project_quarantined', 'broken_project');
    harness.providerResolver.listConnectionCandidates.mockRejectedValueOnce(runtimeError);

    await expect(harness.service.listConnectionCandidates()).rejects.toBe(runtimeError);
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

  it('keeps local provider-inventory failures on the storage boundary', async () => {
    const harness = makeHarness();
    harness.listProviders.mockRejectedValueOnce(new Error('credential inventory unavailable'));

    await expect(
      harness.service.validateConnection({
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: 'image-model',
      })
    ).rejects.toMatchObject({ code: 'storage_error' });
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

    await expect(harness.service.saveConnection(request)).rejects.toMatchObject({
      code: 'connection_validation_failed',
      reason: 'auth',
    });
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
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Updated' }],
      },
      { mutationId: 'service_free_batch', capturedAt: '2026-08-17T00:00:02.000Z' }
    );
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

  it('preserves the ephemeral project revision catalog across the service boundary', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const listing = {
      projects: [],
      projectRevisions: [{ projectId: project.id, revision: project.revision }],
      unsupportedProjectIds: [],
      quarantinedProjectIds: [],
    };
    harness.store.listProjectsV2.mockResolvedValueOnce(listing);

    await expect(harness.service.listProjects()).resolves.toEqual(listing);
    expect(harness.store.listProjectsV2).toHaveBeenCalledOnce();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
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
        target: { kind: 'shot', shotId: 'clip_1' },
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

  it('keeps retry-download on the existing free recovery seam without pricing, authorization, or dispatch', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const recovered = makeSchema2Job(project, {
      status: 'succeeded',
      providerJobId: 'remote_job_1',
      error: null,
    });
    harness.retryDownloadV2.mockResolvedValueOnce(recovered);
    const request = { projectId: project.id, jobId: recovered.id, expectedRevision: project.revision };

    await harness.service.retryDownload(request);

    expect(harness.retryDownloadV2).toHaveBeenCalledExactlyOnceWith(request);
    expect(harness.retryJobV2).not.toHaveBeenCalled();
    expect(harness.cancelJobV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
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

  it('derives the exact planned-duration blocker without consulting selected Take playback timing', async () => {
    const project = makeSchema2ServiceProject();
    project.shots.clip_1.durationSeconds = 3;
    project.videoRouteId = videoRoute.choiceId;
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
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
    };
    project.shots.clip_1.assetIds = ['take_1'];
    project.shots.clip_1.videoAssetId = 'take_1';
    project.shots.clip_1.trimInSeconds = 1;
    project.shots.clip_1.trimOutSeconds = 2;
    const harness = makeHarness(project);

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'video_take')],
    });

    expect(
      project.assets.take_1.durationSeconds! -
        project.shots.clip_1.trimInSeconds! -
        project.shots.clip_1.trimOutSeconds!
    ).toBe(7);
    expect(capability.supportedItems).toEqual([]);
    expect(capability.blocks).toEqual([
      {
        block: { code: 'duration', role: 'video', seconds: 3 },
        items: [shotCapabilityV2('clip_1', 'video_take')],
      },
    ]);
  });

  it('prices and records video authority from planned Shot duration, not selected Take playback timing', async () => {
    const project = makeSchema2ServiceProject();
    project.shots.clip_1!.durationSeconds = 6;
    addGeneratedVideosForMcpV2(project, 1);
    project.videoRouteId = videoRoute.choiceId;
    const shot = project.shots.clip_1!;
    const selectedTake = project.assets[shot.videoAssetId!]!;
    selectedTake.durationSeconds = 10;
    shot.trimInSeconds = 1;
    shot.trimOutSeconds = 2;
    const harness = makeHarness(project);

    expect(selectedTake.durationSeconds! - shot.trimInSeconds! - shot.trimOutSeconds!).toBe(7);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [shotChoiceV2(shot.id, 'video_take')],
      cascadeChoices: [],
    });
    expect(prepared.baseOnly.baseItems).toEqual([
      expect.objectContaining({
        target: { kind: 'shot', shotId: shot.id },
        purpose: 'video_take',
        durationSeconds: 6,
        requestedTotalMinorUnits: 30,
      }),
    ]);

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });
    const generated = Object.values(harness.getProject().jobs).find(
      (job) => job.authorizationId === prepared.baseOnly.id
    )!;
    expect(generated.requestSnapshot?.durationSeconds).toBe(6);
    expect(generated.spendReceipt).toBeNull();
    expect(harness.getProject().spendAuthorizations.find(({ id }) => id === prepared.baseOnly.id)).toMatchObject({
      lowerMinorUnits: 30,
      upperMinorUnits: 30,
      baseItems: [{ requestPlan: { kind: 'resolved', snapshot: { durationSeconds: 6 } } }],
    });
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
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);

    const capability = await harness.service.getGenerationCapability({
      projectId: project.id,
      expectedRevision: project.revision,
      items: [shotCapabilityV2('clip_1', 'video_take')],
    });

    expect(capability.supportedItems).toEqual([shotCapabilityV2('clip_1', 'video_take')]);
    expect(capability.blocks).toEqual([]);
  });

  it.each([
    ['a non-array', null],
    ['a duplicate item', [shotCapabilityV2('clip_1', 'video_take'), shotCapabilityV2('clip_1', 'video_take')]],
    ['a non-active Shot', [{ target: { kind: 'shot', shotId: 'shot_missing' }, purpose: 'video_take' }]],
  ])('rejects %s in a capability selection', async (_label, items) => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);

    await expect(
      harness.service.getGenerationCapability({
        projectId: project.id,
        expectedRevision: project.revision,
        items: items as never,
      })
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

  it('projects selection-required catalogs globally and keeps resolver failure on local storage', async () => {
    const harness = makeHarness();

    await expect(harness.service.listRoutes()).resolves.toMatchObject({
      image: { status: 'selection_required', selectionIssue: null },
    });
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(new Error('resolver unavailable'));
    await expect(harness.service.listRoutes()).rejects.toMatchObject({ code: 'storage_error' });
  });

  it('re-discovers routes before every project-status read and performs no write', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes
      .mockResolvedValueOnce({
        routes: [structuredClone(imageRoute), structuredClone(videoRoute)],
        diagnostics: [],
        generationCatalogVersion: 'status_catalog_1',
      })
      .mockResolvedValueOnce({
        routes: [structuredClone(imageRoute), structuredClone(videoRoute)],
        diagnostics: [],
        generationCatalogVersion: 'status_catalog_2',
      });

    const first = await harness.service.getProjectStatus({ projectId: project.id });
    const second = await harness.service.getProjectStatus({ projectId: project.id, detail: true });

    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledTimes(2);
    expect(harness.providerResolver.listGenerationRoutes.mock.invocationCallOrder[0]).toBeLessThan(
      harness.store.getProjectV2.mock.invocationCallOrder[0]!
    );
    expect(first).toMatchObject({
      projectId: project.id,
      projectRevision: project.revision,
      catalogVersion: 'status_catalog_1',
      detail: null,
    });
    expect(second.catalogVersion).toBe('status_catalog_2');
    expect(second.detail?.shots.map((shot) => shot.shotId)).toEqual(['clip_1', 'clip_2']);
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.importReferenceImageFromPathV2).not.toHaveBeenCalled();
    expect(harness.importBedAudioFromPathV2).not.toHaveBeenCalled();
  });

  it('analyzes only exact current Shot assets at the requested revision and caches by asset content', async () => {
    const project = makeSchema2ServiceProject();
    const attachVideo = (target: StudioProjectV2, assetId: string, sha256: string): void => {
      const shot = target.shots.clip_1!;
      if (shot.videoAssetId !== null) shot.supersededVideoAssetIds.push(shot.videoAssetId);
      shot.videoAssetId = assetId;
      shot.assetIds.push(assetId);
      target.assets[assetId] = {
        id: assetId,
        projectId: target.id,
        shotId: shot.id,
        mediaKind: 'video',
        mimeType: 'video/mp4',
        managedAsset: { collection: 'assets', fileName: `${assetId}.mp4` },
        byteSize: 128,
        sha256,
        durationSeconds: 5,
        createdAt: '2026-08-17T00:00:01.000Z',
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
      };
    };
    attachVideo(project, 'take_audio_1', 'c'.repeat(64));
    const analyzeVideoAudioV2 = vi.fn<StudioMediaStore['analyzeVideoAudioV2']>(async (_projectId, assetId) =>
      assetId === 'take_audio_1'
        ? { status: 'audible', meanVolumeDbfs: -21, peakVolumeDbfs: -3 }
        : { status: 'no_audio_stream', meanVolumeDbfs: null, peakVolumeDbfs: null }
    );
    const harness = makeHarness(project, { analyzeVideoAudioV2 });
    const firstRequest = {
      projectId: project.id,
      expectedRevision: project.revision,
      shots: [{ shotId: 'clip_1', assetId: 'take_audio_1' }],
    };

    const [first, duplicate] = await Promise.all([
      harness.service.analyzeShotAudio(firstRequest),
      harness.service.analyzeShotAudio(firstRequest),
    ]);
    expect(first).toEqual({
      projectId: project.id,
      projectRevision: project.revision,
      profile: 'effective-loudness-v1',
      shots: [
        {
          shotId: 'clip_1',
          assetId: 'take_audio_1',
          status: 'audible',
          meanVolumeDbfs: -21,
          peakVolumeDbfs: -3,
        },
      ],
    });
    expect(duplicate).toEqual(first);
    expect(analyzeVideoAudioV2).toHaveBeenCalledExactlyOnceWith(project.id, 'take_audio_1');

    const replacement = harness.getProject();
    replacement.revision += 1;
    attachVideo(replacement, 'take_audio_2', 'd'.repeat(64));
    harness.setProject(replacement);
    await expect(harness.service.analyzeShotAudio(firstRequest)).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      harness.service.analyzeShotAudio({
        ...firstRequest,
        expectedRevision: replacement.revision,
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    await expect(
      harness.service.analyzeShotAudio({
        projectId: project.id,
        expectedRevision: replacement.revision,
        shots: [{ shotId: 'clip_1', assetId: 'take_audio_2' }],
      })
    ).resolves.toMatchObject({
      projectRevision: replacement.revision,
      shots: [{ shotId: 'clip_1', assetId: 'take_audio_2', status: 'no_audio_stream' }],
    });
    expect(analyzeVideoAudioV2).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed or duplicate Shot audio analysis targets before probing media', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const base = {
      projectId: project.id,
      expectedRevision: project.revision,
      shots: [{ shotId: 'clip_1', assetId: 'take_audio_1' }],
    };
    const sparse: unknown[] = [];
    sparse.length = 1;
    const attempts = [
      null,
      { ...base, internal: true },
      { ...base, shots: [] },
      { ...base, shots: sparse },
      { ...base, shots: [{ ...base.shots[0], internal: true }] },
      { ...base, shots: [...base.shots, { shotId: 'clip_1', assetId: 'take_audio_2' }] },
    ];

    for (const input of attempts) {
      // eslint-disable-next-line no-await-in-loop -- each hostile query envelope must fail independently.
      await expect(harness.service.analyzeShotAudio(input as never)).rejects.toMatchObject({
        code: 'invalid_payload',
      });
    }
    expect(harness.analyzeVideoAudioV2).not.toHaveBeenCalled();
    expect(harness.store.getProjectV2).not.toHaveBeenCalled();
  });

  it('returns unavailable without inventing an audio fact when the media analyzer is absent or fails', async () => {
    const project = makeSchema2ServiceProject();
    const asset: StudioAssetV2 = {
      id: 'take_audio_unavailable',
      projectId: project.id,
      shotId: 'clip_1',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      managedAsset: { collection: 'assets', fileName: 'take_audio_unavailable.mp4' },
      byteSize: 128,
      sha256: 'e'.repeat(64),
      durationSeconds: 5,
      createdAt: '2026-08-17T00:00:01.000Z',
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
    };
    project.assets[asset.id] = asset;
    project.shots.clip_1!.videoAssetId = asset.id;
    project.shots.clip_1!.assetIds.push(asset.id);
    const request = {
      projectId: project.id,
      expectedRevision: project.revision,
      shots: [{ shotId: 'clip_1', assetId: asset.id }],
    };
    const absent = makeHarness(project, { includeMediaStore: false });
    const rejectedProbe = vi.fn<StudioMediaStore['analyzeVideoAudioV2']>(async () => {
      throw new Error('ffmpeg unavailable');
    });
    const failed = makeHarness(project, { analyzeVideoAudioV2: rejectedProbe });

    await expect(absent.service.analyzeShotAudio(request)).resolves.toMatchObject({
      shots: [{ status: 'unavailable', meanVolumeDbfs: null, peakVolumeDbfs: null }],
    });
    await expect(failed.service.analyzeShotAudio(request)).resolves.toMatchObject({
      shots: [{ status: 'unavailable', meanVolumeDbfs: null, peakVolumeDbfs: null }],
    });
    await expect(failed.service.analyzeShotAudio(request)).resolves.toMatchObject({
      shots: [{ status: 'unavailable' }],
    });
    expect(rejectedProbe).toHaveBeenCalledTimes(2);
  });

  it('admits only an exact fresh paid blocker, records a bounded quote, and performs no spend or project write', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const failedJob = makeSchema2Job(project, { id: 'job_paid_recovery', status: 'failed' });
    project.jobs[failedJob.id] = failedJob;
    project.shots.clip_1!.jobIds.push(failedJob.id);
    const harness = makeHarness(project);
    const status = await harness.service.getProjectStatus({ projectId: project.id, detail: true });
    const blocker = status.stages
      .flatMap((stage) => stage.blockers)
      .find((candidate): candidate is StudioPaidRecoveryBlockerV2 => candidate.remedy.kind === 'proposal');
    if (blocker === undefined) throw new Error('expected a payable recovery blocker');
    const command = {
      schemaVersion: 10,
      commandId: 'proposal_paid_service',
      projectId: project.id,
      expectedRevision: project.revision,
      createdAt: '2026-08-17T00:00:01.000Z',
      deadlineAt: '2026-08-17T00:00:15.000Z',
      policy: 'propose_paid_recovery',
      blocker: structuredClone(blocker),
    } satisfies StudioDirectorPaidRecoveryCommandRecordV2;
    const before = harness.getProject();

    const proposal = await harness.service.proposePaidRecovery(command);

    expect(proposal).toMatchObject({
      id: command.commandId,
      projectId: project.id,
      baseRevision: project.revision,
      status: 'pending',
      payload: {
        kind: 'paid_recovery',
        blocker,
        quote: {
          projectRevision: project.revision,
          currency: 'USD',
          itemCount: expect.any(Number),
        },
      },
    });
    expect(proposal.payload.kind === 'paid_recovery' ? proposal.payload.quote.itemCount : 0).toBeGreaterThan(0);
    expect(harness.recordProposalV2).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      proposalId: command.commandId,
      baseRevision: project.revision,
      payload: proposal.payload,
    });
    expect(harness.getProject()).toEqual(before);
    expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
    expect(harness.confirmPaidRecoveryProposalV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();

    if (proposal.payload.kind !== 'paid_recovery') throw new Error('expected a paid recovery proposal');
    await expect(
      harness.service.preparePaidRecoveryProposal({ projectId: project.id, proposalId: proposal.id })
    ).resolves.toEqual(proposal.payload.quote);
    await expect(
      harness.service.preparePaidRecoveryProposal({
        projectId: project.id,
        proposalId: proposal.id,
        unexpected: true,
      } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });

    const routeReadsAfterFirst = harness.providerResolver.listGenerationRoutes.mock.calls.length;
    await expect(harness.service.proposePaidRecovery(command)).resolves.toEqual(proposal);
    expect(harness.recordProposalV2).toHaveBeenCalledOnce();
    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledTimes(routeReadsAfterFirst);
  });

  it('fails closed before pricing when a paid blocker is stale or no longer matches fresh detailed status', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const failedJob = makeSchema2Job(project, { id: 'job_paid_mismatch', status: 'failed' });
    project.jobs[failedJob.id] = failedJob;
    project.shots.clip_1!.jobIds.push(failedJob.id);
    const harness = makeHarness(project);
    const status = await harness.service.getProjectStatus({ projectId: project.id, detail: true });
    const blocker = status.stages
      .flatMap((stage) => stage.blockers)
      .find((candidate): candidate is StudioPaidRecoveryBlockerV2 => candidate.remedy.kind === 'proposal');
    if (blocker === undefined) throw new Error('expected a payable recovery blocker');
    const command = {
      schemaVersion: 10,
      commandId: 'proposal_paid_mismatch',
      projectId: project.id,
      expectedRevision: project.revision,
      createdAt: '2026-08-17T00:00:01.000Z',
      deadlineAt: '2026-08-17T00:00:15.000Z',
      policy: 'propose_paid_recovery',
      blocker: { ...structuredClone(blocker), where: { ...blocker.where, jobId: 'job_not_current' } },
    } as StudioDirectorPaidRecoveryCommandRecordV2;

    await expect(harness.service.proposePaidRecovery(command)).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(
      harness.service.proposePaidRecovery({
        ...command,
        commandId: 'proposal_paid_stale',
        expectedRevision: project.revision + 1,
        blocker: structuredClone(blocker),
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect(harness.recordProposalV2).not.toHaveBeenCalled();
    expect(harness.store.confirmProjectV2).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
    expect(harness.getProject().spendAuthorizations).toEqual(project.spendAuthorizations);
  });

  it('keeps same-named paid proposals and quote IDs isolated by project after one project confirms', async () => {
    const renameProject = (source: StudioProjectV2, projectId: string): StudioProjectV2 => {
      const project = structuredClone(source);
      project.id = projectId;
      for (const asset of Object.values(project.assets)) asset.projectId = projectId;
      for (const job of Object.values(project.jobs)) job.projectId = projectId;
      for (const authorization of project.spendAuthorizations) authorization.projectId = projectId;
      return project;
    };
    const projectA = renameProject(makeSchema2ServiceProject(), 'project_paid_a');
    const projectB = renameProject(makeSchema2ServiceProject(), 'project_paid_b');
    for (const [index, project] of [projectA, projectB].entries()) {
      project.imageRouteId = imageRoute.choiceId;
      project.videoRouteId = videoRoute.choiceId;
      const failed = makeSchema2Job(project, { id: `job_paid_shared_${index}`, status: 'failed' });
      project.jobs[failed.id] = failed;
      project.shots.clip_1!.jobIds.push(failed.id);
    }
    const projects = new Map([
      [projectA.id, projectA],
      [projectB.id, projectB],
    ]);
    const proposals = new Map<string, StudioProposalV2[]>();
    const committedAt = '2026-08-17T00:00:02.000Z';
    const store = {
      getProjectV2: vi.fn(async (projectId: string) => {
        const project = projects.get(projectId);
        return project === undefined
          ? { status: 'not_found' as const, projectId }
          : { status: 'supported' as const, project: structuredClone(project) };
      }),
      listProposalsV2: vi.fn(async (projectId: string) => structuredClone(proposals.get(projectId) ?? [])),
      recordProposalV2: vi.fn<CreativeStudioStore['recordProposalV2']>(async (input) => {
        const record: StudioProposalRecordV2 = {
          schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
          id: input.proposalId,
          projectId: input.projectId,
          status: 'pending',
          baseRevision: input.baseRevision,
          payload: structuredClone(input.payload),
          createdAt: '2026-08-17T00:00:01.000Z',
          decidedAt: null,
        };
        proposals.set(input.projectId, [...(proposals.get(input.projectId) ?? []), record]);
        return structuredClone(record);
      }),
      listReferenceRequestsV2: vi.fn(async () => []),
      confirmPaidRecoveryProposalV2: vi.fn<CreativeStudioStore['confirmPaidRecoveryProposalV2']>(async (input) => {
        const current = projects.get(input.projectId);
        if (current === undefined || current.revision !== input.expectedRevision) throw new Error('stale fixture');
        const revalidation = await input.revalidate(structuredClone(current) as never);
        input.assertActive();
        const built = input.buildCommit(structuredClone(current), structuredClone(revalidation) as never, committedAt);
        input.assertActive();
        const committed = { ...built.project, revision: current.revision + 1, updatedAt: committedAt };
        projects.set(input.projectId, structuredClone(committed));
        proposals.set(
          input.projectId,
          (proposals.get(input.projectId) ?? []).map((proposal) =>
            proposal.id === input.proposalId
              ? { ...proposal, status: 'accepted' as const, decidedAt: committedAt }
              : proposal
          )
        );
        return { project: structuredClone(committed), dispatch: structuredClone(built.dispatch) };
      }),
      updateProjectV2: vi.fn(async (projectId: string, update: (project: StudioProjectV2) => StudioProjectV2) => {
        const current = projects.get(projectId);
        if (current === undefined) throw new Error('missing fixture');
        const updated = update(structuredClone(current));
        projects.set(projectId, structuredClone(updated));
        return structuredClone(updated);
      }),
    };
    const base = makeHarness(projectA);
    let jobOrdinal = 0;
    let idempotencyOrdinal = 0;
    let quoteOrdinal = 0;
    const dispatchAuthorizedJobsV2 = vi.fn(async ({ projectId, jobIds }: { projectId: string; jobIds: string[] }) =>
      jobIds.map((jobId) => structuredClone(projects.get(projectId)!.jobs[jobId]!))
    );
    const service = createCreativeStudioServiceV2({
      store: store as unknown as CreativeStudioStore,
      jobManager: {
        dispatchAuthorizedJobsV2,
        cancelJobV2: vi.fn(),
        retryJobV2: vi.fn(),
        retryDownloadV2: vi.fn(),
      } as never,
      providerResolver: base.providerResolver as never,
      listProviders: base.listProviders,
      getAdapterRegistry: () => base.adapterRegistry as never,
      getStudioServerScriptPath: base.getStudioServerScriptPath,
      ensureDirectorCommandMailbox: base.ensureDirectorCommandMailbox,
      rateCard: base.loadRateCard,
      createQuoteId: () => (quoteOrdinal++ % 2 === 0 ? 'quote_shared_paid_base' : 'quote_shared_paid_cascade'),
      createJobId: () => `job_shared_paid_${++jobOrdinal}`,
      createIdempotencyKey: () => `key_shared_paid_${++idempotencyOrdinal}`,
      now: () => new Date(committedAt),
      onProjectUpdated: vi.fn(),
    });
    const blockerFor = async (projectId: string): Promise<StudioPaidRecoveryBlockerV2> => {
      const status = await service.getProjectStatus({ projectId, detail: true });
      const blocker = status.stages
        .flatMap((stage) => stage.blockers)
        .find((candidate): candidate is StudioPaidRecoveryBlockerV2 => candidate.remedy.kind === 'proposal');
      if (blocker === undefined) throw new Error('expected paid blocker');
      return blocker;
    };
    const commandFor = async (project: StudioProjectV2): Promise<StudioDirectorPaidRecoveryCommandRecordV2> => ({
      schemaVersion: 10,
      commandId: 'proposal_shared_paid',
      projectId: project.id,
      expectedRevision: project.revision,
      createdAt: '2026-08-17T00:00:01.000Z',
      deadlineAt: '2026-08-17T00:00:15.000Z',
      policy: 'propose_paid_recovery',
      blocker: await blockerFor(project.id),
    });

    const proposalA = await service.proposePaidRecovery(await commandFor(projectA));
    const proposalB = await service.proposePaidRecovery(await commandFor(projectB));
    if (proposalA.payload.kind !== 'paid_recovery' || proposalB.payload.kind !== 'paid_recovery') {
      throw new Error('expected paid proposals');
    }
    expect(proposalA.id).toBe(proposalB.id);
    expect(proposalA.payload.quote.quoteId).toBe(proposalB.payload.quote.quoteId);

    await service.confirmPaidRecoveryProposal({
      projectId: projectA.id,
      proposalId: proposalA.id,
      quoteId: proposalA.payload.quote.quoteId,
      expectedRevision: projectA.revision,
    });
    await expect(
      service.confirmPaidRecoveryProposal({
        projectId: projectB.id,
        proposalId: proposalB.id,
        quoteId: proposalB.payload.quote.quoteId,
        expectedRevision: projectB.revision,
      })
    ).resolves.toEqual({ projectId: projectB.id, projectRevision: projectB.revision + 1 });
    expect(store.confirmPaidRecoveryProposalV2).toHaveBeenCalledTimes(2);
    expect(dispatchAuthorizedJobsV2).toHaveBeenCalledTimes(2);
    await service.dispose();
    await base.service.dispose();
  });

  it('reports an empty active Beat as incomplete authored coverage through the Director status read', async () => {
    const project = makeSchema2ServiceProject();
    project.targetDurationSeconds = 12;
    project.beatOrder = ['section_1'];
    project.beats = {
      section_1: {
        ...project.beats.section_1!,
        targetSeconds: 12,
        shotOrder: [],
      },
    };
    project.shots = {};
    const harness = makeHarness(project);

    const status = await harness.service.getProjectStatus({ projectId: project.id });

    expect(status.stages.find((stage) => stage.id === 'storyboard')).toMatchObject({
      state: 'in_progress',
      summary: { plannedSeconds: 0, shotCount: 0, authoredShotCount: 0, targetSeconds: 12 },
    });
    expect(status.stages.find((stage) => stage.id === 'cut')).toMatchObject({
      state: 'complete',
      summary: { structurallyPlayable: true, durationSeconds: 12, targetSeconds: 12 },
    });
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
  });

  it('reports the exact blank-script Shot through the read-only Director status path', async () => {
    const project = makeSchema2ServiceProject();
    project.shots.clip_2!.shootingScript = ' \n ';
    const harness = makeHarness(project);

    const status = await harness.service.getProjectStatus({ projectId: project.id, detail: true });

    expect(status.stages.find((stage) => stage.id === 'storyboard')).toMatchObject({
      state: 'blocked',
      summary: { shotCount: 2, authoredShotCount: 1, plannedSeconds: 10 },
      blockers: [
        {
          cause: 'shooting_script_required',
          where: {
            kind: 'shot',
            beatId: 'section_2',
            shotId: 'clip_2',
            beatPosition: 2,
            shotPosition: 1,
            jobId: null,
          },
          remedy: { kind: 'owner_only', reason: 'review_project_data' },
        },
      ],
    });
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.submitShots).not.toHaveBeenCalled();
  });

  it('loads the latest project revision only after a slow fresh route discovery completes', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    let resolveCatalog!: (catalog: StudioGenerationRouteCatalog) => void;
    harness.providerResolver.listGenerationRoutes.mockReturnValueOnce(
      new Promise<StudioGenerationRouteCatalog>((resolve) => {
        resolveCatalog = resolve;
      })
    );

    const statusPromise = harness.service.getProjectStatus({ projectId: project.id });
    await vi.waitFor(() => expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledOnce());
    harness.setProject({ ...project, revision: project.revision + 1 });
    resolveCatalog({
      routes: [structuredClone(imageRoute), structuredClone(videoRoute)],
      diagnostics: [],
      generationCatalogVersion: 'status_catalog_after_flight',
    });

    await expect(statusPromise).resolves.toMatchObject({
      projectRevision: project.revision + 1,
      catalogVersion: 'status_catalog_after_flight',
    });
  });

  it('returns all other status stages with a bounded engines blocker when fresh inventory fails', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(new Error('secret inventory body'));

    const status = await harness.service.getProjectStatus({ projectId: project.id });

    expect(status.catalogVersion).toBeNull();
    expect(status.stages.map((stage) => stage.id)).toEqual([
      'brief',
      'engines',
      'references',
      'storyboard',
      'bindings',
      'production',
      'cut',
    ]);
    expect(status.stages.find((stage) => stage.id === 'engines')).toMatchObject({
      state: 'blocked',
      blockers: [{ cause: 'route_inventory_unavailable', remedy: { kind: 'owner_only' } }],
    });
    expect(harness.store.applyMutationBatchV2).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [structuredClone(imageRoute), structuredClone(videoRoute)],
      diagnostics: [],
      generationCatalogVersion: 'status_catalog_recovered',
    });
    await expect(harness.service.getProjectStatus({ projectId: project.id })).resolves.toMatchObject({
      catalogVersion: 'status_catalog_recovered',
    });
    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledTimes(2);
  });

  it('rejects prototype-bearing status requests and propagates unknown inventory errors before loading a project', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    const inherited = Object.assign(Object.create({ detail: true }) as object, { projectId: project.id });

    await expect(harness.service.getProjectStatus(inherited as never)).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();

    const runtimeError = new CreativeStudioServiceError('runtime_inactive');
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(runtimeError);
    await expect(harness.service.getProjectStatus({ projectId: project.id })).rejects.toBe(runtimeError);
    expect(harness.store.getProjectV2).not.toHaveBeenCalled();
  });

  it('preserves a quarantined-project runtime cause while refreshing routes', async () => {
    const harness = makeHarness();
    const runtimeError = new CreativeStudioServiceError('project_quarantined', 'broken_project');
    harness.providerResolver.listGenerationRoutes.mockRejectedValueOnce(runtimeError);

    await expect(harness.service.listRoutes()).rejects.toBe(runtimeError);
  });

  it.each([
    ['unsupported prototype', { status: 'unsupported_prototype_schema' as const, projectId: 'project_v2' }],
    ['missing project', { status: 'not_found' as const, projectId: 'project_v2' }],
  ])('keeps %s distinct on V2 operational reads', async (_label, loadResult) => {
    const harness = makeHarness();
    harness.store.getProjectV2.mockResolvedValue(loadResult);

    await expect(
      harness.service.getGenerationCapability({ projectId: 'project_v2', expectedRevision: 1, items: [] })
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
        baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
        cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
      })
    ).rejects.toMatchObject({ code: 'stale_project' });
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it('atomically pins an exact Board panel and authorizes only selected takes in its segment', async () => {
    const { project, board } = makeBoardPromotionProject();
    const harness = makeHarness(project);
    const boardBefore = structuredClone({
      asset: project.assets[board.id],
      pointer: project.shots.clip_1!.boardAssetId,
      history: project.shots.clip_1!.supersededBoardAssetIds,
      producer: project.jobs.job_board_promote_1,
    });

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      boardPromotion: { shotId: 'clip_1', boardAssetId: board.id },
    });
    expect(harness.getProject()).toEqual(project);
    expect(prepared.withCascade).toBeNull();
    expect(
      prepared.baseOnly.baseItems.map(({ target, purpose }) => [target.kind === 'shot' ? target.shotId : null, purpose])
    ).toEqual([
      ['clip_1', 'video_take'],
      ['clip_2', 'video_take'],
    ]);

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: project.revision + 1 });

    const committed = harness.getProject();
    expect(committed.shots.clip_1).toMatchObject({
      seedStillId: board.id,
      dismissedSeedStillIds: [],
      boardAssetId: boardBefore.pointer,
      supersededBoardAssetIds: boardBefore.history,
      chainBreak: 'none',
      videoAssetId: 'take_clip_1',
    });
    expect(committed.assets[board.id]).toEqual(boardBefore.asset);
    expect(committed.jobs.job_board_promote_1).toEqual(boardBefore.producer);
    expect(committed.undoHistory).toEqual(project.undoHistory);
    expect(
      committed.spendAuthorizations.filter((authorization) => authorization.id !== SERVICE_REFERENCE_AUTHORIZATION_ID)
    ).toEqual([expect.objectContaining({ id: prepared.baseOnly.id, cascadeItems: [] })]);
    const replacementJobs = Object.values(committed.jobs).filter(
      (job) => job.id !== 'job_board_promote_1' && job.id !== SERVICE_REFERENCE_JOB_ID
    );
    expect(replacementJobs).toEqual([
      expect.objectContaining({
        target: { kind: 'shot', shotId: 'clip_1' },
        purpose: 'video_take',
        status: 'queued_local',
        requestSnapshot: expect.objectContaining({
          conditioningInput: { kind: 'seed_still', assetId: board.id },
        }),
      }),
      expect.objectContaining({
        target: { kind: 'shot', shotId: 'clip_2' },
        purpose: 'video_take',
        status: 'waiting_for_conditioning',
        requestPlan: expect.objectContaining({
          kind: 'after_take_selection',
          dependency: expect.objectContaining({ kind: 'authorized_predecessor', predecessorShotId: 'clip_1' }),
        }),
      }),
    ]);
    expect(harness.submitShots).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      jobIds: [replacementJobs[0]!.id],
    });
  });

  it('revalidates the exact current Board pointer before paid confirmation and leaves failure byte-identical', async () => {
    const { project, board } = makeBoardPromotionProject();
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      boardPromotion: { shotId: 'clip_1', boardAssetId: board.id },
    });
    const mismatched = harness.getProject();
    mismatched.shots.clip_1!.boardAssetId = null;
    harness.setProject(mismatched);

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toThrow();
    expect(harness.getProject()).toEqual(mismatched);
    expect(harness.getProject().spendAuthorizations).toEqual(mismatched.spendAuthorizations);
    expect(Object.keys(harness.getProject().jobs)).toEqual(Object.keys(mismatched.jobs));
    expect(harness.submitShots).not.toHaveBeenCalled();
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
      baseItems: [{ target: { kind: 'shot', shotId: 'clip_2' }, purpose: 'video_take', generationCount: 1 }],
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
    expect(
      committed.spendAuthorizations.filter((authorization) => authorization.id !== SERVICE_REFERENCE_AUTHORIZATION_ID)
    ).toHaveLength(1);
    expect(Object.values(committed.jobs).filter((job) => job.id !== SERVICE_REFERENCE_JOB_ID)).toEqual([
      expect.objectContaining({
        target: { kind: 'shot', shotId: 'clip_2' },
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
    await expect(harness.service.getProjectWorkspace({ projectId: project.id })).resolves.toMatchObject({
      status: 'supported',
      snapshot: {
        workspaceStatus: {
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
        },
      },
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
    expect(harness.getProject().spendAuthorizations).toEqual(beforeConfirm.spendAuthorizations);
    expect(harness.getProject().jobs).toEqual(beforeConfirm.jobs);
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
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
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
    const waitingJob = Object.values(ready.jobs).find(
      (job) => job.purpose === 'video_take' && job.status === 'waiting_for_conditioning'
    )!;
    harness.store.updateProjectV2.mockClear();
    harness.onProjectUpdated.mockClear();

    await expect(
      harness.service.retryConditioningFrame(
        {
          projectId: project.id,
          expectedRevision: ready.revision,
          dependentShotId: 'clip_2',
        },
        'command_free_fix_1'
      )
    ).resolves.toMatchObject({ cascadeProgress: [] });
    expect(harness.store.updateProjectV2.mock.calls.map((call) => [call[2], call[3]])).toEqual([
      [ready.revision, 'command_free_fix_1'],
      [undefined, 'bind_conditioning_retry:clip_2'],
    ]);
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
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
    harness.onProjectUpdated.mockClear();
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
    expect(harness.onProjectUpdated).toHaveBeenCalledTimes(2);
    expect(harness.onProjectUpdated).toHaveBeenNthCalledWith(1, project.id);
    expect(harness.onProjectUpdated).toHaveBeenNthCalledWith(2, project.id);

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
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
        createdAt: '2026-08-17T00:00:01.000Z',
      };
      project.assets[seed.id] = seed;
      project.shots.clip_2!.assetIds.push(seed.id);
      project.shots.clip_2!.seedStillId = seed.id;
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
      dismissedSeedStillIds: [],
    });
    expect(committed.undoHistory).toEqual(project.undoHistory);
    expect(
      committed.spendAuthorizations.filter((authorization) => authorization.id !== SERVICE_REFERENCE_AUTHORIZATION_ID)
    ).toEqual([
      expect.objectContaining({
        id: prepared.baseOnly.id,
        baseItems: expect.any(Array),
        cascadeItems: [],
      }),
    ]);
    expect(
      Object.values(committed.jobs)
        .filter((job) => job.id !== SERVICE_REFERENCE_JOB_ID)
        .map(({ purpose, status }) => [purpose, status])
    ).toEqual(
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
    expect(
      harness
        .getProject()
        .spendAuthorizations.filter((authorization) => authorization.id !== SERVICE_REFERENCE_AUTHORIZATION_ID)
    ).toHaveLength(1);
    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: prepared.baseOnly.id,
        expectedRevision: project.revision,
      })
    ).rejects.toMatchObject({ code: 'quote_not_found' });
    expect(
      harness
        .getProject()
        .spendAuthorizations.filter((authorization) => authorization.id !== SERVICE_REFERENCE_AUTHORIZATION_ID)
    ).toHaveLength(1);
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
        baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
        cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
      })
    ).rejects.toMatchObject({ code: 'invalid_route' });
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
  });

  it('refuses a selected image route whose conditioning capacity is below the exact approved reference set', async () => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    const preparedSubmissionCache = new StudioPreparedSubmissionCacheV2();
    const admit = vi.spyOn(preparedSubmissionCache, 'admit');
    const harness = makeHarness(project, { preparedSubmissionCache });
    const incapableImageRoute = {
      ...structuredClone(imageRoute),
      constraints: { ...structuredClone(imageRoute.constraints), maxConditioningImages: 0 },
    };
    harness.providerResolver.listGenerationRoutes.mockResolvedValueOnce({
      routes: [incapableImageRoute, structuredClone(videoRoute)],
      diagnostics: [],
      generationCatalogVersion: 'catalog_reference_capacity_zero',
    });
    const before = harness.getProject();

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: project.revision,
        originReferenceHandoffId: null,
        baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
        cascadeChoices: [],
      })
    ).rejects.toMatchObject({ code: 'invalid_reference' });

    expect(harness.providerResolver.listGenerationRoutes).toHaveBeenCalledTimes(1);
    expect(harness.loadRateCard).not.toHaveBeenCalled();
    expect(admit).not.toHaveBeenCalled();
    expect(harness.getProject()).toEqual(before);
    expect(harness.submitShots).not.toHaveBeenCalled();
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
    expect(harness.getProject().spendAuthorizations.find(({ id }) => id === prepared.baseOnly.id)).toMatchObject({
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      'composition',
      'conditioningAssetId',
      'durationSeconds',
      'generationCount',
      'oneGenerationMinorUnits',
      'purpose',
      'referenceTarget',
      'requestedTotalMinorUnits',
      'route',
      'target',
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
    const committedAuthorization = committed.spendAuthorizations.find(
      (authorization) => authorization.id === prepared.withCascade!.id
    );
    expect(committedAuthorization).toMatchObject({
      id: prepared.withCascade!.id,
      baseItems: [{ purpose: 'seed_still', generationCount: 1 }],
      cascadeItems: [{ purpose: 'video_take', generationCount: 1 }],
      providerBindings: [
        { provider: { adapterId: 'weprompt-image-v1' } },
        { provider: { adapterId: 'openrouter-video-v1' } },
      ],
    });
    expect(
      Object.values(committed.jobs)
        .filter((job) => job.id !== SERVICE_REFERENCE_JOB_ID)
        .map(({ status, purpose, requestSnapshot }) => ({
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
    });
    const baseRow = {
      target: { kind: 'shot' as const, shotId: 'clip_1' },
      referenceTarget: null,
      purpose: 'seed_still' as const,
      route: { choiceId: imageRoute.choiceId, providerId: 'provider_1', model: 'image-model' },
      generationCount: 1,
      durationSeconds: null,
      conditioningAssetId: null,
      oneGenerationMinorUnits: 3,
      requestedTotalMinorUnits: 3,
      composition: prepared.baseOnly.baseItems[0]!.composition,
    };
    const cascadeRow = {
      target: { kind: 'shot' as const, shotId: 'clip_1' },
      referenceTarget: null,
      purpose: 'video_take' as const,
      route: { choiceId: videoRoute.choiceId, providerId: 'provider_1', model: 'video-model' },
      generationCount: 1,
      durationSeconds: 5,
      conditioningAssetId: null,
      oneGenerationMinorUnits: 25,
      requestedTotalMinorUnits: 25,
      composition: prepared.withCascade!.cascadeItems[0]!.composition,
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
    expect(
      harness
        .getProject()
        .spendAuthorizations.filter((authorization) => authorization.id !== SERVICE_REFERENCE_AUTHORIZATION_ID)
    ).toEqual([
      expect.objectContaining({
        id: prepared.withCascade!.id,
        lowerMinorUnits: prepared.withCascade!.lowerMinorUnits,
        upperMinorUnits: prepared.withCascade!.upperMinorUnits,
        baseItems: [
          expect.objectContaining({
            target: baseRow.target,
            purpose: baseRow.purpose,
            routeId: baseRow.route.choiceId,
            generationCount: baseRow.generationCount,
            rateUnit: 'generation',
            rateMinorUnits: baseRow.oneGenerationMinorUnits,
          }),
        ],
        cascadeItems: [
          expect.objectContaining({
            target: cascadeRow.target,
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
        baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
        cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
      })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();

    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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

  it.each([
    { label: 'cancelled', status: 'cancelled', error: null },
    {
      label: 'poll-deadline',
      status: 'failed',
      error: { code: 'poll_deadline', messageKey: 'pollDeadline' },
    },
  ] as const)('does not extend project-reference retry exceptions to an ordinary $label Shot job', async (entry) => {
    const project = makeSchema2ServiceProject();
    project.imageRouteId = imageRoute.choiceId;
    project.videoRouteId = videoRoute.choiceId;
    const harness = makeHarness(project);
    const first = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
    });
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: first.baseOnly.id,
      expectedRevision: project.revision,
    });
    const terminal = harness.getProject();
    const predecessor = terminal.jobs.job_service_1!;
    predecessor.status = entry.status;
    predecessor.error = entry.error === null ? null : { ...entry.error };
    if (entry.status === 'failed') {
      predecessor.providerJobId = 'remote_ordinary_poll_deadline';
      predecessor.remoteStartedAt = '2026-08-17T00:00:02.000Z';
    }
    harness.setProject(terminal);

    const second = await harness.service.prepareSubmission({
      projectId: terminal.id,
      expectedRevision: terminal.revision,
      originReferenceHandoffId: null,
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
    });
    await harness.service.confirmSubmission({
      projectId: terminal.id,
      quoteId: second.baseOnly.id,
      expectedRevision: terminal.revision,
    });

    const committed = harness.getProject();
    expect(committed.jobs.job_service_2).toMatchObject({
      retryOfJobId: null,
      retryReason: null,
      duplicateChargeAcknowledged: false,
      duplicateChargeAcknowledgedAt: null,
    });
    expect(validateStudioProjectV2(committed)).toBe(true);
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
    });
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.withCascade!.id,
      expectedRevision: project.revision,
    });

    const paid = harness.getProject();
    const seedJob = Object.values(paid.jobs).find(
      (job) => job.purpose === 'seed_still' && job.target.kind === 'shot' && job.target.shotId === 'clip_1'
    )!;
    const seedAsset: StudioAssetV2 = {
      id: 'seed_generated',
      projectId: paid.id,
      shotId: 'clip_1',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'seed_generated.png' },
      byteSize: 8,
      sha256: 'c'.repeat(64),
      projectReferenceId: null,
      generationReferenceAssetIds: ['asset_reference_background'],
      producerJobId: seedJob.id,
      compositionDigest: studioGenerationCompositionDigestV2(seedJob.composition),
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
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: null,
      compositionDigest: null,
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
          schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
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
      baseChoices: [shotChoiceV2('clip_1', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_1', 'video_take')],
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

  it('cancels one authorized seed wait, persists downstream terminalization, and requotes an exact trim-aware rejoin', async () => {
    let { project, take, seed: importedCandidate } = makeRejoinProject();
    project.shots.clip_2!.seedStillId = null;
    importedCandidate = project.assets[importedCandidate.id]!;
    importedCandidate.managedAsset = { collection: 'imports', fileName: 'seed_rejoin_import.png' };
    importedCandidate.sha256 = 'e'.repeat(64);
    importedCandidate.projectReferenceId = null;
    importedCandidate.generationReferenceAssetIds = [];
    importedCandidate.producerJobId = null;
    importedCandidate.compositionDigest = null;
    importedCandidate.createdAt = '2026-08-17T00:00:03.000Z';
    project.beats.section_1!.shotOrder.push('clip_3');
    project.shots.clip_3 = {
      ...structuredClone(project.shots.clip_2!),
      id: 'clip_3',
      shootingScript: 'A final connected composition.',
      chainBreak: 'none',
      trimInSeconds: null,
      trimOutSeconds: null,
      seedStillId: null,
      dismissedSeedStillIds: [],
      boardAssetId: null,
      supersededBoardAssetIds: [],
      videoAssetId: null,
      supersededVideoAssetIds: [],
      assetIds: [],
      jobIds: [],
    };

    const completedTakeBefore = structuredClone(project.assets[take.id]!);
    const importedCandidateBefore = structuredClone(project.assets[importedCandidate.id]!);
    const referenceBefore = structuredClone(project.references.ref_background!);
    const referenceAuthorizationBefore = structuredClone(
      project.spendAuthorizations.find((authorization) => authorization.id === SERVICE_REFERENCE_AUTHORIZATION_ID)!
    );
    const harness = makeHarness(project);
    const prepared = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: project.revision,
      originReferenceHandoffId: null,
      baseChoices: [shotChoiceV2('clip_2', 'seed_still')],
      cascadeChoices: [shotChoiceV2('clip_2', 'video_take'), shotChoiceV2('clip_3', 'video_take')],
    });
    expect(prepared.withCascade).not.toBeNull();
    await harness.service.confirmSubmission({
      projectId: project.id,
      quoteId: prepared.withCascade!.id,
      expectedRevision: project.revision,
    });

    const authorized = harness.getProject();
    const seedJob = Object.values(authorized.jobs).find(
      (job) =>
        job.authorizationId === prepared.withCascade!.id &&
        job.purpose === 'seed_still' &&
        job.target.kind === 'shot' &&
        job.target.shotId === 'clip_2'
    )!;
    const generatedSeed: StudioAssetV2 = {
      id: 'seed_bug_123_authorized',
      projectId: authorized.id,
      shotId: 'clip_2',
      mediaKind: 'image',
      mimeType: 'image/png',
      managedAsset: { collection: 'assets', fileName: 'seed_bug_123_authorized.png' },
      byteSize: 21,
      sha256: 'f'.repeat(64),
      projectReferenceId: null,
      generationReferenceAssetIds: ['asset_reference_background'],
      producerJobId: seedJob.id,
      compositionDigest: studioGenerationCompositionDigestV2(seedJob.composition),
      createdAt: '2026-08-17T00:00:02.000Z',
    };
    authorized.assets[generatedSeed.id] = generatedSeed;
    authorized.shots.clip_2!.assetIds.push(generatedSeed.id);
    seedJob.status = 'succeeded';
    seedJob.providerJobId = 'remote_seed_bug_123';
    seedJob.outputAssetIds = [generatedSeed.id];
    seedJob.outputAssetIdsByRole = { primary: generatedSeed.id, poster: null };
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
    harness.setProject(authorized);
    const beforeCancellation = harness.getProject();
    const previousAuthorizations = structuredClone(beforeCancellation.spendAuthorizations);
    const previousAssets = structuredClone(beforeCancellation.assets);
    const previousJobs = structuredClone(beforeCancellation.jobs);

    const cancelledStatus = await harness.service.cancelWaitingCascade({
      projectId: project.id,
      expectedRevision: beforeCancellation.revision,
      dependentShotId: 'clip_2',
    });

    const cancelled = harness.getProject();
    const cancelledShotJob = Object.values(cancelled.jobs).find(
      (job) =>
        job.authorizationId === prepared.withCascade!.id &&
        job.purpose === 'video_take' &&
        job.target.kind === 'shot' &&
        job.target.shotId === 'clip_2'
    )!;
    const downstreamJob = Object.values(cancelled.jobs).find(
      (job) =>
        job.authorizationId === prepared.withCascade!.id &&
        job.purpose === 'video_take' &&
        job.target.kind === 'shot' &&
        job.target.shotId === 'clip_3'
    )!;
    expect(cancelled.revision).toBe(beforeCancellation.revision + 1);
    expect(cancelledShotJob).toMatchObject({ status: 'cancelled', error: null, spendReceipt: null });
    expect(downstreamJob).toMatchObject({
      status: 'failed',
      error: { code: 'dependency_failed', messageKey: 'dependency_failed' },
      spendReceipt: null,
    });
    expect(cancelledStatus.cascadeProgress).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dependentShotId: 'clip_2', waitingReason: 'cancelled' }),
        expect.objectContaining({ dependentShotId: 'clip_3', waitingReason: 'dependency_failed' }),
      ])
    );
    expect(cancelled.assets).toEqual(previousAssets);
    expect(cancelled.assets[take.id]).toEqual(completedTakeBefore);
    expect(cancelled.assets[importedCandidate.id]).toEqual(importedCandidateBefore);
    expect(cancelled.assets[generatedSeed.id]).toEqual(generatedSeed);
    expect(cancelled.references.ref_background).toEqual(referenceBefore);
    expect(cancelled.spendAuthorizations).toEqual(previousAuthorizations);
    expect(cancelled.spendAuthorizations).toContainEqual(referenceAuthorizationBefore);
    expect(cancelled.jobs[seedJob.id]).toEqual(previousJobs[seedJob.id]);
    expect(cancelled.shots.clip_1).toMatchObject({ videoAssetId: take.id, trimOutSeconds: 2 });
    expect(cancelled.shots.clip_2!.seedStillId).toBeNull();
    expect(harness.cancelJobV2).not.toHaveBeenCalled();

    const reloadedHarness = makeHarness(cancelled);
    await expect(reloadedHarness.service.getProjectWorkspace({ projectId: project.id })).resolves.toMatchObject({
      status: 'supported',
      snapshot: {
        project: { revision: cancelled.revision },
        workspaceStatus: {
          projectRevision: cancelled.revision,
          cascadeProgress: expect.arrayContaining([
            expect.objectContaining({ dependentShotId: 'clip_2', waitingReason: 'cancelled' }),
            expect.objectContaining({ dependentShotId: 'clip_3', waitingReason: 'dependency_failed' }),
          ]),
        },
      },
    });

    await expect(
      harness.service.prepareSubmission({
        projectId: project.id,
        expectedRevision: beforeCancellation.revision,
        originReferenceHandoffId: null,
        baseChoices: [],
        cascadeChoices: [],
        continuityChange: { shotId: 'clip_2', hardCut: false, requiresSeedGeneration: false },
      })
    ).rejects.toMatchObject({ code: 'stale_project' });

    const beforeRejoinReview = harness.getProject();
    const rejoin = await harness.service.prepareSubmission({
      projectId: project.id,
      expectedRevision: cancelled.revision,
      originReferenceHandoffId: null,
      baseChoices: [],
      cascadeChoices: [],
      continuityChange: { shotId: 'clip_2', hardCut: false, requiresSeedGeneration: false },
    });
    expect(harness.getProject()).toEqual(beforeRejoinReview);
    const rejoinQuote = rejoin.withCascade ?? rejoin.baseOnly;
    const rejoinItems = [...rejoinQuote.baseItems, ...rejoinQuote.cascadeItems];
    const rejoinShotItem = rejoinItems.find(
      (item) => item.purpose === 'video_take' && item.target.kind === 'shot' && item.target.shotId === 'clip_2'
    );
    if (rejoinShotItem === undefined) throw new Error(`missing rejoin item: ${JSON.stringify(rejoin)}`);
    expect(rejoinQuote.id).not.toBe(prepared.withCascade!.id);
    expect(rejoinQuote.projectRevision).toBe(cancelled.revision);
    expect(rejoinShotItem).toMatchObject({ purpose: 'video_take', generationCount: 1 });
    expect(rejoinItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: { kind: 'shot', shotId: 'clip_2' }, purpose: 'video_take' }),
        expect.objectContaining({ target: { kind: 'shot', shotId: 'clip_3' }, purpose: 'video_take' }),
      ])
    );
    expect(JSON.stringify(rejoinQuote)).not.toContain(importedCandidate.id);
    expect(JSON.stringify(rejoinQuote)).not.toContain(generatedSeed.id);

    await expect(
      harness.service.confirmSubmission({
        projectId: project.id,
        quoteId: rejoinQuote.id,
        expectedRevision: cancelled.revision,
      })
    ).resolves.toEqual({ projectId: project.id, projectRevision: cancelled.revision + 1 });

    const rejoined = harness.getProject();
    const extractionId = createStudioFrameExtractionId({
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
    });
    expect(rejoined.shots.clip_2).toMatchObject({ chainBreak: 'none', seedStillId: null });
    expect(rejoined.frameExtractions[extractionId]).toMatchObject({
      shotId: 'clip_1',
      videoAssetId: take.id,
      endpointSeconds: 8,
      status: 'pending',
    });
    expect(rejoined.assets).toEqual(previousAssets);
    expect(rejoined.spendAuthorizations.slice(0, previousAuthorizations.length)).toEqual(previousAuthorizations);
    const rejoinAuthorization = rejoined.spendAuthorizations.at(-1)!;
    expect(rejoinAuthorization).toMatchObject({ id: rejoinQuote.id, projectRevision: cancelled.revision });
    const rejoinAuthorizedItem = [...rejoinAuthorization.baseItems, ...rejoinAuthorization.cascadeItems].find(
      (item) => item.purpose === 'video_take' && item.target.kind === 'shot' && item.target.shotId === 'clip_2'
    )!;
    expect(rejoinAuthorizedItem.requestPlan).toMatchObject({
      kind: 'after_take_selection',
      dependency: {
        kind: 'existing_predecessor',
        predecessorShotId: 'clip_1',
        takeAssetId: take.id,
        endpointSeconds: 8,
      },
    });
    expect(rejoined.jobs[cancelledShotJob.id]).toEqual(cancelledShotJob);
    expect(rejoined.jobs[downstreamJob.id]).toEqual(downstreamJob);
    expect(JSON.stringify(rejoined.jobs)).not.toContain(`"assetId":"${importedCandidate.id}"`);
    expect(harness.extractConditioningFrameV2).toHaveBeenCalledExactlyOnceWith({
      projectId: project.id,
      extractionId,
    });
    expect(harness.cancelJobV2).not.toHaveBeenCalled();
  });

  it('projects one revision-matched project/workspace/chain snapshot through one authority seam', async () => {
    const project = makeSchema2ServiceProject();
    project.undoHistory = [{ id: 'undo_top', sourceRevision: project.revision, label: 'edit_shot', patches: [] }];
    const harness = makeHarness(project);

    const result = await harness.service.getProjectWorkspace({ projectId: project.id });

    expect(result.status).toBe('supported');
    if (result.status !== 'supported') throw new Error('Expected a supported project workspace snapshot');
    const { project: rendererProject, workspaceStatus: workspace, chainStatus: chain } = result.snapshot;

    expect(rendererProject).toMatchObject({ id: project.id, revision: project.revision });
    expect(workspace).toMatchObject({
      projectId: project.id,
      projectRevision: project.revision,
      undoTop: { entryId: 'undo_top', label: 'edit_shot' },
      cascadeProgress: [],
    });
    expect(Object.keys(workspace).toSorted()).toEqual([
      'boardPanels',
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
    expect(workspace.boardPanels).toEqual([
      { shotId: 'clip_1', assetId: null, producerJobId: null, latestJobId: null, staleCauses: [] },
      { shotId: 'clip_2', assetId: null, producerJobId: null, latestJobId: null, staleCauses: [] },
    ]);
    expect(harness.verifyConditioningFrameV2).not.toHaveBeenCalled();
    expect(harness.providerResolver.listGenerationRoutes).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    await expect(
      harness.service.getProjectWorkspace({ projectId: project.id, revision: project.revision } as never)
    ).rejects.toMatchObject({ code: 'invalid_payload' });
  });

  it('verifies ready chain frames inside project authority and fails closed on null, mismatch, or media failure', async () => {
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
    const resolveAssetWithProjectAuthorityV2 = vi.fn<StudioMediaStore['resolveAssetWithProjectAuthorityV2']>(
      async (_authority, assetId) =>
        assetId === frame.id
          ? {
              asset: structuredClone(frame),
              openVerifiedStream: async () => Readable.from([Buffer.alloc(frame.byteSize)]),
            }
          : null
    );
    const harness = makeHarness(project, { resolveAssetWithProjectAuthorityV2 });
    harness.store.getProjectV2.mockRejectedValue(new Error('composite read escaped project authority'));
    harness.resolveAssetV2.mockRejectedValue(new Error('composite read re-entered queued media lookup'));
    harness.verifyConditioningFrameV2.mockRejectedValue(new Error('composite read used the re-entrant frame verifier'));
    const readBoundary = async () => {
      const result = await harness.service.getProjectWorkspace({ projectId: project.id });
      expect(result.status).toBe('supported');
      if (result.status !== 'supported') throw new Error('Expected a supported project workspace snapshot');
      return result.snapshot.chainStatus.boundaries[0];
    };

    await expect(readBoundary()).resolves.toEqual({
      upstreamShotId: 'clip_1',
      dependentShotId: 'clip_2',
      status: 'on_disk',
      frameAssetId: frame.id,
    });
    expect(resolveAssetWithProjectAuthorityV2).toHaveBeenCalledWith(expect.any(Object), frame.id);
    expect(resolveAssetWithProjectAuthorityV2.mock.invocationCallOrder[0]).toBeLessThan(
      harness.assertProjectAuthorityCurrent.mock.invocationCallOrder[0]!
    );

    resolveAssetWithProjectAuthorityV2.mockResolvedValueOnce(null);
    await expect(readBoundary()).resolves.toMatchObject({ status: 'gone', frameAssetId: null });

    resolveAssetWithProjectAuthorityV2.mockResolvedValueOnce({
      asset: { ...structuredClone(frame), sha256: 'e'.repeat(64) },
      openVerifiedStream: async () => Readable.from([]),
    });
    await expect(readBoundary()).resolves.toMatchObject({ status: 'gone', frameAssetId: null });

    resolveAssetWithProjectAuthorityV2.mockRejectedValueOnce(new Error('media unavailable'));
    await expect(readBoundary()).resolves.toMatchObject({ status: 'gone', frameAssetId: null });
    expect(harness.store.getProjectV2).not.toHaveBeenCalled();
    expect(harness.resolveAssetV2).not.toHaveBeenCalled();
    expect(harness.verifyConditioningFrameV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
  });

  it('rejects the composite snapshot when its final project-authority fence rejects', async () => {
    const project = makeSchema2ServiceProject();
    const harness = makeHarness(project);
    harness.assertProjectAuthorityCurrent.mockRejectedValueOnce(new Error('project authority expired'));

    await expect(harness.service.getProjectWorkspace({ projectId: project.id })).rejects.toThrow(
      'project authority expired'
    );
    expect(harness.assertProjectAuthorityCurrent).toHaveBeenCalledTimes(1);
    expect(harness.store.getProjectV2).not.toHaveBeenCalled();
    expect(harness.store.updateProjectV2).not.toHaveBeenCalled();
    expect(harness.onProjectUpdated).not.toHaveBeenCalled();
  });

  it('maps only missing and unsupported authority loads into the composite load-result union', async () => {
    const harness = makeHarness();

    harness.withProjectAuthorityV2.mockRejectedValueOnce(
      new CreativeStudioStoreError('not_found', 'missing Studio project')
    );
    await expect(harness.service.getProjectWorkspace({ projectId: 'project_v2' })).resolves.toEqual({
      status: 'not_found',
      projectId: 'project_v2',
    });

    harness.withProjectAuthorityV2.mockRejectedValueOnce(
      new CreativeStudioStoreError('unsupported_prototype_schema', 'old Studio schema')
    );
    await expect(harness.service.getProjectWorkspace({ projectId: 'project_v2' })).resolves.toEqual({
      status: 'unsupported_prototype_schema',
      projectId: 'project_v2',
    });

    harness.withProjectAuthorityV2.mockRejectedValueOnce(
      new CreativeStudioStoreError('storage_error', 'Studio storage unavailable')
    );
    await expect(harness.service.getProjectWorkspace({ projectId: 'project_v2' })).rejects.toMatchObject({
      code: 'storage_error',
    });
  });
});

const editableBeatV2 = () => ({
  title: 'Opening',
  story: 'Warm sunrise over a quiet city introduces the product.',
  targetSeconds: null,
});

const editableShotV2 = () => ({
  shootingScript: 'A wide establishing shot.',
  durationSeconds: 5,
});

const mutationCatalogV2 = (): StudioMutationOperationV2[] => [
  { kind: 'edit_project', changes: { name: 'A sharper launch film' } },
  { kind: 'set_brief', brief: 'A concise launch story' },
  {
    kind: 'set_rules',
    rules: [{ id: 'rule_1', text: 'Avoid competitor logos.', predicate: { kind: 'forbidden_terms', terms: ['logo'] } }],
  },
  {
    kind: 'set_reference_plan',
    references: [
      {
        kind: 'character',
        label: 'Ming',
        prompt: 'Character turnaround sheet for Ming.',
      },
    ],
  },
  {
    kind: 'amend_reference_plan',
    additions: [
      {
        kind: 'background',
        label: 'Dai pai dong',
        prompt: 'Recurring dai-pai-dong background.',
      },
    ],
  },
  { kind: 'set_reference_label', referenceId: 'ref_ming', label: 'Ming Wong' },
  { kind: 'set_reference_prompt', referenceId: 'ref_ming', prompt: 'Updated Ming prompt.' },
  { kind: 'select_reference_image', referenceId: 'ref_ming', assetId: 'asset_ming' },
  { kind: 'remove_reference_image', referenceId: 'ref_ming', assetId: 'asset_ming' },
  { kind: 'add_beat', beatId: 'section_new', beat: editableBeatV2(), beforeBeatId: null },
  { kind: 'edit_beat', beatId: 'section_1', changes: { targetSeconds: 12 } },
  { kind: 'reorder_beats', beatOrder: ['section_2', 'section_1'] },
  { kind: 'park_beat', beatId: 'section_1' },
  { kind: 'restore_beat', beatId: 'section_1', beforeBeatId: null },
  { kind: 'add_binned_beat', beatId: 'section_binned', beat: editableBeatV2() },
  { kind: 'add_shot', beatId: 'section_1', shotId: 'clip_new', shot: editableShotV2(), beforeShotId: null },
  { kind: 'edit_shot', shotId: 'clip_1', changes: { shootingScript: 'A tighter opening.' } },
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
        shootingScript: 'A proposed coverage row.',
        durationSeconds: 5,
        chainBreak: 'none',
      },
    ],
    fixedShots: [{ shotId: 'clip_fixed', reasons: ['owned_asset', 'video_asset', 'shooting_script'] }],
  },
  { kind: 'set_hard_cut', shotId: 'clip_1', hardCut: true },
  { kind: 'set_seed_still', shotId: 'clip_1', assetId: 'asset_seed' },
  { kind: 'dismiss_seed_still', shotId: 'clip_1', assetId: 'asset_seed' },
  {
    kind: 'set_shot_reference_binding',
    shotId: 'clip_1',
    characterReferenceIds: ['ref_ming'],
    backgroundReferenceId: 'ref_background',
  },
  { kind: 'promote_board_panel', shotId: 'clip_1', boardAssetId: 'asset_board' },
  { kind: 'trim_shot', shotId: 'clip_1', trimInSeconds: 0, trimOutSeconds: 4.5 },
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

const studioDirectorReferenceDirectOperationKindsV2 = new Set<StudioMutationOperationV2['kind']>([
  'set_reference_plan',
  'amend_reference_plan',
  'set_shot_reference_binding',
]);

const studioDirectorApplyToolAcceptsV2 = (operation: StudioMutationOperationV2): boolean =>
  STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2[operation.kind] === 'direct';

const studioDirectorProposalToolAcceptsV2 = (operation: StudioMutationOperationV2): boolean => {
  const disposition = STUDIO_DIRECTOR_OPERATION_DISPOSITIONS_V2[operation.kind];
  return (
    disposition === 'proposal' ||
    (disposition === 'direct' && !studioDirectorReferenceDirectOperationKindsV2.has(operation.kind))
  );
};

const capturePendingProjectAuthorityV2 = async (projectRoot: string) => {
  const canonicalRoot = await nodeFs.realpath(projectRoot);
  const stats = await nodeFs.lstat(canonicalRoot);
  return { canonicalRoot, rootIdentity: { dev: stats.dev, ino: stats.ino } };
};

const writeStudioProjectFilesV2 = async (projectDir: string, project: StudioProjectV2): Promise<void> => {
  await writeFile(path.join(projectDir, 'project.json'), JSON.stringify(createStudioProjectManifestV2(project)));
  await writeFile(path.join(projectDir, 'brief.md'), project.brief);
};

const REFERENCE_WRITER_PROJECT_ID_V2 = 'project_v2';
const REFERENCE_WRITER_NOW_MS_V2 = Date.parse('2026-08-19T12:00:00.000Z');
const REFERENCE_WRITER_LOCK_NAME_V2 = '.reference-requests.writer.lock';
const REFERENCE_WRITER_RECLAIM_NAME_V2 = '.reference-requests.writer.lock.reclaim';

const referenceWriterLeaseV2 = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  token: 'reference_writer_lease',
  pid: 2_147_483_647,
  acquiredAt: '2020-01-01T00:00:00.000Z',
  ...overrides,
});

const referenceRequestRecordV2 = (
  requestId: string,
  referenceId: string,
  createdAtMs: number
): StudioReferenceRequestV2 => ({
  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  id: requestId,
  projectId: REFERENCE_WRITER_PROJECT_ID_V2,
  referenceIds: [referenceId],
  status: 'pending',
  createdAt: new Date(createdAtMs).toISOString(),
});

const proposalRecordV2 = (proposalId: string, createdAtMs: number): StudioProposalRecordV2 => ({
  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
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
  outcome: { kind: 'rejected' } | { kind: 'generation_gate'; handoffId: string; referenceIds: string[] }
) => ({
  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
  requestId,
  projectId: REFERENCE_WRITER_PROJECT_ID_V2,
  decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2 + 1_000).toISOString(),
  outcome,
});

const referenceReceiptV2 = (requestId: string, handoffId: string) => ({
  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
    projectReferenceId: null,
    generationReferenceAssetIds: [],
    producerJobId: null,
    compositionDigest: null,
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
  const beat = Object.values(project.beats).find((candidate) => candidate.shotOrder.includes(shot.id))!;
  const target = { kind: 'shot' as const, shotId: shot.id };
  let created = 0;
  while (created < count) {
    const ordinal = created + 1;
    const authorizationOrdinal = project.spendAuthorizations.length + 1;
    const projectRevision = project.revision;
    const itemId = createStudioQuotedGenerationId({
      projectId: project.id,
      projectRevision,
      target,
      purpose: 'video_take',
    });
    const source = {
      kind: 'shot' as const,
      beatId: beat.id,
      story: beat.story,
      shotId: shot.id,
      shootingScript: shot.shootingScript,
    };
    const composition = composeStudioGenerationV2({
      projectRevision,
      brief: project.brief,
      rules: project.rules,
      source,
      purpose: 'video_take',
      referenceInputs: [],
      aspectRatio: project.aspectRatio,
      resolution: project.resolution,
      route: provider,
      boardStyle: null,
      instructionProfile: deriveStudioInstructionProfileV2(provider, 'video_take', source),
    });
    const requestPlan = createStudioResolvedGenerationRequestPlan({
      purpose: 'video_take',
      template: createStudioGenerationRequestTemplate({ composition, durationSeconds: shot.durationSeconds }),
      conditioningInput: { kind: 'seed_still', assetId: seed.id },
    });
    const item = {
      id: itemId,
      target,
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
    const jobId = `job_mcp_${ordinal}`;
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
      projectReferenceId: null,
      generationReferenceAssetIds: [],
      producerJobId: jobId,
      compositionDigest: studioGenerationCompositionDigestV2(composition),
      createdAt,
    };
    const job: StudioJobV2 = {
      id: jobId,
      projectId: project.id,
      target,
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
      composition,
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

const MCP_CONDITIONING_FRAME_BYTES_V2 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

type McpConditioningFrameFixtureV2 = {
  project: StudioProjectV2;
  dependentShotId: 'clip_2';
  predecessorShotId: 'clip_1';
  takeAssetId: string | null;
  extractionId: string | null;
  frameAssetId: string | null;
  endpointSeconds: number | null;
  frameBytes: Buffer | null;
};

const makeMcpConditioningFrameFixtureV2 = (
  options: {
    takeCount?: 0 | 1 | 2;
    chainBreak?: 'none' | 'hard_cut';
    extraction?: 'missing' | 'pending' | 'extracting' | 'failed' | 'ready';
    extractionTake?: 'current' | 'old';
    frameBytes?: Buffer;
    frameSha256?: string;
  } = {}
): McpConditioningFrameFixtureV2 => {
  const project = makeSchema2ServiceProject();
  project.beats.section_1!.shotOrder = ['clip_1', 'clip_2'];
  project.beats.section_2!.shotOrder = [];
  project.shots.clip_2!.chainBreak = options.chainBreak ?? 'none';
  const takeCount = options.takeCount ?? 1;
  if (takeCount > 0) addGeneratedVideosForMcpV2(project, takeCount);
  const predecessor = project.shots.clip_1!;
  predecessor.trimOutSeconds = takeCount === 0 ? null : 1.5;
  const currentTakeAssetId = predecessor.videoAssetId;
  const extractionTakeAssetId = options.extractionTake === 'old' && takeCount === 2 ? 'take_01' : currentTakeAssetId;
  const take = extractionTakeAssetId === null ? undefined : project.assets[extractionTakeAssetId];
  const endpointSeconds =
    take?.durationSeconds === undefined ? null : take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
  const extractionId =
    endpointSeconds === null || extractionTakeAssetId === null
      ? null
      : createStudioFrameExtractionId({
          shotId: predecessor.id,
          videoAssetId: extractionTakeAssetId,
          endpointSeconds,
        });
  const extractionStatus = options.extraction ?? 'ready';
  let frameAssetId: string | null = null;
  let frameBytes: Buffer | null = null;
  if (extractionId !== null && extractionStatus !== 'missing') {
    if (extractionStatus === 'ready') {
      frameAssetId = `frame_${extractionTakeAssetId}`;
      frameBytes = options.frameBytes ?? MCP_CONDITIONING_FRAME_BYTES_V2;
      const frame: StudioAssetV2 = {
        id: frameAssetId,
        projectId: project.id,
        shotId: predecessor.id,
        mediaKind: 'image',
        mimeType: 'image/png',
        managedAsset: { collection: 'conditioningFrames', fileName: `${frameAssetId}.png` },
        byteSize: frameBytes.byteLength,
        sha256: options.frameSha256 ?? createHash('sha256').update(frameBytes).digest('hex'),
        createdAt: '2026-08-17T00:00:50.000Z',
        projectReferenceId: null,
        generationReferenceAssetIds: [],
        producerJobId: null,
        compositionDigest: null,
      };
      project.assets[frame.id] = frame;
      predecessor.assetIds.push(frame.id);
    }
    project.frameExtractions[extractionId] = {
      id: extractionId,
      shotId: predecessor.id,
      videoAssetId: extractionTakeAssetId!,
      endpointSeconds: endpointSeconds!,
      frameAssetId,
      status: extractionStatus,
      errorCode: extractionStatus === 'failed' ? 'decode_failed' : null,
      attemptCount: extractionStatus === 'pending' ? 0 : 1,
    };
  }
  if (!validateStudioProjectV2(project)) throw new Error('Invalid conditioning-frame MCP fixture');
  return {
    project,
    dependentShotId: 'clip_2',
    predecessorShotId: 'clip_1',
    takeAssetId: currentTakeAssetId,
    extractionId,
    frameAssetId,
    endpointSeconds,
    frameBytes,
  };
};

const writeMcpConditioningFrameFixtureV2 = async (
  projectDir: string,
  fixture: McpConditioningFrameFixtureV2,
  diskFrameBytes: Buffer | null = fixture.frameBytes
): Promise<void> => {
  await writeStudioProjectFilesV2(projectDir, fixture.project);
  if (fixture.frameAssetId === null || diskFrameBytes === null) return;
  await mkdir(path.join(projectDir, 'conditioningFrames'));
  await writeFile(path.join(projectDir, 'conditioningFrames', `${fixture.frameAssetId}.png`), diskFrameBytes);
};

describe('Studio MCP schema-2 server', () => {
  it('parses explicit and defaulted sidecar paths without coupling route-catalog state to project schema', () => {
    const required = {
      [STUDIO_ENV.projectId]: 'project_1',
      [STUDIO_ENV.projectDir]: '/studio/project_1',
      [STUDIO_ENV.pendingDir]: '/studio/project_1/director/pending',
    };
    const serializedRouteCatalog = JSON.stringify({ image: { status: 'ready' }, video: { status: 'missing' } });

    expect(
      parseStudioServerEnv({
        ...required,
        [STUDIO_ENV.referencePendingDir]: '/studio/project_1/references/pending',
        [STUDIO_ENV.routeCatalog]: serializedRouteCatalog,
      })
    ).toEqual({
      projectId: 'project_1',
      projectDir: '/studio/project_1',
      pendingDir: '/studio/project_1/director/pending',
      referencePendingDir: '/studio/project_1/references/pending',
      routeCatalog: JSON.parse(serializedRouteCatalog),
    });
    expect(parseStudioServerEnv(required)).toEqual({
      projectId: 'project_1',
      projectDir: '/studio/project_1',
      pendingDir: '/studio/project_1/director/pending',
      referencePendingDir: '/studio/project_1/reference-requests/pending',
      routeCatalog: null,
    });
    expect(parseStudioServerEnv({})).toBeNull();
  });

  it('reports route-catalog absence without exposing a partial catalog', async () => {
    const unavailable = await createListRoutesHandler(null)({});
    expect(JSON.parse(unavailable.content[0]!.text)).toMatchObject({ status: 'storage_error' });
    const absent = await createListRoutesHandler({
      projectId: 'project_v2',
      projectDir: '/unused',
      pendingDir: '/unused/proposals/pending',
      referencePendingDir: '/unused/reference-requests/pending',
      routeCatalog: null,
    })({});
    expect(JSON.parse(absent.content[0]!.text)).toMatchObject({ status: 'storage_error' });
    const staleEnvironment = await createListRoutesHandler({
      projectId: 'project_v2',
      projectDir: '/unused',
      pendingDir: '/unused/proposals/pending',
      referencePendingDir: '/unused/reference-requests/pending',
      routeCatalog: { image: { status: 'ready' }, video: { status: 'ready' } } as never,
    })({});
    expect(JSON.parse(staleEnvironment.content[0]!.text)).toMatchObject({ status: 'storage_error' });
    const statusUnavailable = await createStudioGetProjectStatusHandlerV2(null)({});
    expect(JSON.parse(statusUnavailable.content[0]!.text)).toMatchObject({ status: 'storage_error' });
    const proposalUnavailable = await createStudioGetProposalHandlerV2(null)({ proposalId: 'proposal_exact' });
    expect(JSON.parse(proposalUnavailable.content[0]!.text)).toMatchObject({ status: 'storage_error' });
  });

  it('returns the exact current trim-aware predecessor frame as MCP image content without mutating project authority', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-conditioning-frame-'));
    const fixture = makeMcpConditioningFrameFixtureV2();
    await writeMcpConditioningFrameFixtureV2(projectDir, fixture);
    const manifestPath = path.join(projectDir, 'project.json');
    const beforeManifest = await readFile(manifestPath);
    const beforeBrief = await readFile(path.join(projectDir, 'brief.md'));
    const beforeSpend = structuredClone(fixture.project.spendAuthorizations);

    try {
      const result = await createStudioGetConditioningFrameHandlerV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      })({ shotId: fixture.dependentShotId });
      const metadata = JSON.parse(result.content[0]!.type === 'text' ? result.content[0].text : '') as Record<
        string,
        unknown
      >;
      const image = result.content[1] as { type: 'image'; data: string; mimeType: string } | undefined;
      const frameAsset = fixture.project.assets[fixture.frameAssetId!]!;

      expect(result.isError).toBeUndefined();
      expect(metadata).toEqual({
        status: 'ready',
        projectRevision: fixture.project.revision,
        shotId: fixture.dependentShotId,
        predecessorShotId: fixture.predecessorShotId,
        takeAssetId: fixture.takeAssetId,
        extractionId: fixture.extractionId,
        frameAssetId: fixture.frameAssetId,
        endpointSeconds: fixture.endpointSeconds,
        mimeType: frameAsset.mimeType,
        byteSize: frameAsset.byteSize,
        sha256: frameAsset.sha256,
        requiresVisualInput: true,
      });
      expect(image).toEqual({
        type: 'image',
        data: fixture.frameBytes!.toString('base64'),
        mimeType: 'image/png',
      });
      const protocol = await createStudioMcpProtocolHarnessV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      });
      try {
        await expect(
          protocol.client.callTool({
            name: 'studio_get_conditioning_frame',
            arguments: { shotId: fixture.dependentShotId },
          })
        ).resolves.toMatchObject({
          content: [
            { type: 'text' },
            { type: 'image', data: fixture.frameBytes!.toString('base64'), mimeType: 'image/png' },
          ],
        });
      } finally {
        await protocol.close();
      }
      await expect(readFile(manifestPath)).resolves.toEqual(beforeManifest);
      await expect(readFile(path.join(projectDir, 'brief.md'))).resolves.toEqual(beforeBrief);
      expect(fixture.project.spendAuthorizations).toEqual(beforeSpend);
      await expect(readdir(projectDir)).resolves.toEqual(['brief.md', 'conditioningFrames', 'project.json']);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('does not return a stale extraction from a superseded predecessor take', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-stale-conditioning-frame-'));
    const fixture = makeMcpConditioningFrameFixtureV2({ takeCount: 2, extractionTake: 'old' });
    await writeMcpConditioningFrameFixtureV2(projectDir, fixture);

    try {
      const result = await createStudioGetConditioningFrameHandlerV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({ shotId: fixture.dependentShotId });
      const metadata = JSON.parse(result.content[0]!.type === 'text' ? result.content[0].text : '');

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(metadata).toMatchObject({
        status: 'unavailable',
        projectRevision: fixture.project.revision,
        shotId: fixture.dependentShotId,
        reason: 'extraction_missing',
        predecessorShotId: fixture.predecessorShotId,
        takeAssetId: fixture.takeAssetId,
        extractionId: createStudioFrameExtractionId({
          shotId: fixture.predecessorShotId,
          videoAssetId: fixture.takeAssetId!,
          endpointSeconds: fixture.endpointSeconds!,
        }),
        endpointSeconds: fixture.endpointSeconds,
      });
      expect(JSON.stringify(result)).not.toContain(fixture.frameAssetId);
      expect(JSON.stringify(result)).not.toContain(fixture.frameBytes!.toString('base64'));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['chain head', { takeCount: 0, extraction: 'missing' }, 'clip_1', 'not_chained'],
    ['hard cut', { chainBreak: 'hard_cut' }, 'clip_2', 'not_chained'],
    ['missing predecessor take', { takeCount: 0, extraction: 'missing' }, 'clip_2', 'predecessor_take_missing'],
    ['missing extraction', { extraction: 'missing' }, 'clip_2', 'extraction_missing'],
    ['pending extraction', { extraction: 'pending' }, 'clip_2', 'extraction_pending'],
    ['extracting frame', { extraction: 'extracting' }, 'clip_2', 'extraction_pending'],
    ['failed extraction', { extraction: 'failed' }, 'clip_2', 'extraction_failed'],
  ] as const)('reports %s as an explicit text-only unavailable state', async (_label, options, shotId, reason) => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-unavailable-conditioning-frame-'));
    const fixture = makeMcpConditioningFrameFixtureV2(options);
    await writeMcpConditioningFrameFixtureV2(projectDir, fixture);

    try {
      const result = await createStudioGetConditioningFrameHandlerV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({ shotId });

      expect(result.isError).toBeUndefined();
      expect(result.content).toHaveLength(1);
      expect(JSON.parse(result.content[0]!.type === 'text' ? result.content[0].text : '')).toMatchObject({
        status: 'unavailable',
        projectRevision: fixture.project.revision,
        shotId,
        reason,
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it.each([
    ['hash mismatch', MCP_CONDITIONING_FRAME_BYTES_V2, 'f'.repeat(64)],
    ['truncated file', MCP_CONDITIONING_FRAME_BYTES_V2.subarray(0, -1), null],
  ] as const)('fails closed when conditioning-frame storage has a %s', async (_label, diskBytes, frameSha256) => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-corrupt-conditioning-frame-'));
    const fixture = makeMcpConditioningFrameFixtureV2(frameSha256 === null ? {} : { frameSha256 });
    await writeMcpConditioningFrameFixtureV2(projectDir, fixture, Buffer.from(diskBytes));

    try {
      const result = await createStudioGetConditioningFrameHandlerV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({ shotId: fixture.dependentShotId });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(diskBytes.toString('base64'));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('fails closed when verified bytes do not match the declared image MIME type', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-conditioning-mime-'));
    const fixture = makeMcpConditioningFrameFixtureV2();
    fixture.project.assets[fixture.frameAssetId!]!.mimeType = 'image/jpeg';
    await writeMcpConditioningFrameFixtureV2(projectDir, fixture);

    try {
      const result = await createStudioGetConditioningFrameHandlerV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
      })({ shotId: fixture.dependentShotId });

      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(fixture.frameBytes!.toString('base64'));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('fails closed when the conditioning-frame directory identity changes during the read', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-conditioning-directory-race-'));
    const fixture = makeMcpConditioningFrameFixtureV2();
    await writeMcpConditioningFrameFixtureV2(projectDir, fixture);
    const framesDirectory = path.join(await nodeFs.realpath(projectDir), 'conditioningFrames');
    let directoryReads = 0;
    const racingFs = new Proxy(nodeFs, {
      get(realFs, property, receiver) {
        if (property !== 'lstat') return Reflect.get(realFs, property, receiver);
        return async (...args: Parameters<typeof nodeFs.lstat>) => {
          const stats = await nodeFs.lstat(...args);
          if (String(args[0]) !== framesDirectory || ++directoryReads !== 3) return stats;
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
      const result = await createStudioGetConditioningFrameHandlerV2({
        projectId: fixture.project.id,
        projectDir,
        pendingDir: '',
        referencePendingDir: '',
        fs: racingFs,
      })({ shotId: fixture.dependentShotId });

      expect(directoryReads).toBe(3);
      expect(result.isError).toBe(true);
      expect(result.content).toHaveLength(1);
      expect(JSON.stringify(result)).not.toContain(fixture.frameBytes!.toString('base64'));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
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

  it('publishes strict bounded authority-specific schemas through real MCP tools/list', async () => {
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
      const applyValidator = new AjvJsonSchemaValidator().getValidator(applySchema as never);
      const proposalValidator = new AjvJsonSchemaValidator().getValidator(proposalSchema as never);
      const conditioningFrameTool = tools.find((tool) => tool.name === 'studio_get_conditioning_frame');
      const conditioningFrameValidator = new AjvJsonSchemaValidator().getValidator(
        conditioningFrameTool?.inputSchema as never
      );

      expect(tools.map(({ name }) => name).toSorted()).toEqual([
        'propose_brief_rule',
        'propose_storyboard',
        'read_storyboard',
        'studio_apply_edits',
        'studio_apply_free_fix',
        'studio_get_command_status',
        'studio_get_conditioning_frame',
        'studio_get_project_status',
        'studio_get_proposal',
        'studio_list_routes',
        'studio_propose_paid_recovery',
        'studio_request_reference_images',
      ]);
      expect(tools.every((tool) => Object.keys(tool.inputSchema).length > 0)).toBe(true);
      expect(conditioningFrameTool?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['shotId'],
      });
      expect(conditioningFrameValidator({ shotId: 'clip_2' })).toMatchObject({ valid: true });
      expect(conditioningFrameValidator({ shotId: '../clip_2' })).toMatchObject({ valid: false });
      expect(conditioningFrameValidator({ shotId: 'clip_2', path: '/tmp/frame.png' })).toMatchObject({ valid: false });
      await expect(
        harness.client.callTool({
          name: 'studio_get_conditioning_frame',
          arguments: { shotId: 'clip_2', path: '/tmp/frame.png' },
        })
      ).resolves.toMatchObject({ isError: true });
      expect(applySchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'operations'],
      });
      const operationKinds = mutationCatalogV2()
        .map((operation) => operation.kind)
        .toSorted();
      const applyOperationKinds = mutationCatalogV2()
        .filter(studioDirectorApplyToolAcceptsV2)
        .map((operation) => operation.kind)
        .toSorted();
      const proposalOperationKinds = mutationCatalogV2()
        .filter(studioDirectorProposalToolAcceptsV2)
        .map((operation) => operation.kind)
        .toSorted();
      expect(operationKinds).toHaveLength(33);
      expect(operationVariants?.map((variant) => variant.properties?.kind?.const).toSorted()).toEqual(
        applyOperationKinds
      );
      expect(proposalOperationVariants?.map((variant) => variant.properties?.kind?.const).toSorted()).toEqual(
        proposalOperationKinds
      );
      expect(operationKinds).not.toContain('select_video_take');
      expect(operationKinds).not.toContain('remove_video_take');
      const addBeat = proposalOperationVariants?.find((variant) => variant.properties?.kind?.const === 'add_beat');
      const addShot = proposalOperationVariants?.find((variant) => variant.properties?.kind?.const === 'add_shot');
      const removeReferenceImage = proposalOperationVariants?.find(
        (variant) => variant.properties?.kind?.const === 'remove_reference_image'
      );
      expect(removeReferenceImage).toBeUndefined();
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
      expect(
        applyValidator({
          expectedRevision: 7,
          operations: [
            {
              kind: 'amend_reference_plan',
              additions: [{ kind: 'character', label: 'Ming', prompt: 'Ming character sheet.' }],
            },
          ],
        })
      ).toMatchObject({ valid: false });

      const canonicalDirectBatch = {
        expectedRevision: 8,
        operations: [
          { kind: 'set_brief', brief: '...' },
          { kind: 'reorder_beats', beatOrder: ['beat_2', 'beat_1'] },
        ],
      };
      const canonicalProposalBatch = {
        base_revision: 8,
        operations: [
          { kind: 'set_brief', brief: '...' },
          { kind: 'edit_beat', beatId: 'beat_1', changes: { title: '...' } },
          { kind: 'edit_shot', shotId: 'shot_1', changes: { shootingScript: '...' } },
          { kind: 'reorder_beats', beatOrder: ['beat_2', 'beat_1'] },
        ],
      };
      expect(applyValidator(canonicalDirectBatch)).toMatchObject({ valid: true });
      expect(proposalValidator(canonicalProposalBatch)).toMatchObject({ valid: true });
      expect(
        applyValidator({
          expectedRevision: 8,
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
      ).toMatchObject({ valid: false });
      expect(
        proposalValidator({
          base_revision: 8,
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
        proposalValidator({
          base_revision: 8,
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
      expect(applyEdits?.description).toMatch(/never starts paid generation/i);

      const freeFixTool = tools.find((tool) => tool.name === 'studio_apply_free_fix');
      const freeFixValidator = new AjvJsonSchemaValidator().getValidator(freeFixTool?.inputSchema as never);
      expect(freeFixTool?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'recovery'],
      });
      expect(
        freeFixValidator({
          expectedRevision: 8,
          recovery: { op: 'retry_conditioning_frame', dependentShotId: 'clip_2' },
        })
      ).toMatchObject({ valid: true });
      expect(
        freeFixValidator({
          expectedRevision: 8,
          recovery: { op: 'terminalize_refused_job', jobId: 'job_refused' },
        })
      ).toMatchObject({ valid: true });
      for (const invalidInput of [
        {
          expectedRevision: 8,
          recovery: { op: 'retry_conditioning_frame', dependentShotId: '../unsafe' },
        },
        {
          expectedRevision: 8,
          recovery: { op: 'terminalize_refused_job', jobId: 'job_refused', acknowledgePossibleDuplicateCharge: true },
        },
        { expectedRevision: 8, recovery: { op: 'acknowledge_possible_duplicate_charge', jobId: 'job_unknown' } },
        { expectedRevision: 8, recovery: { op: 'generation_submission_unknown', jobId: 'job_unknown' } },
        {
          expectedRevision: 8,
          recovery: { op: 'retry_conditioning_frame', dependentShotId: 'clip_2' },
          extra: true,
        },
      ]) {
        expect(freeFixValidator(invalidInput), JSON.stringify(invalidInput)).toMatchObject({ valid: false });
        expect(studioApplyFreeFixInputSchemaV2.safeParse(invalidInput).success).toBe(false);
      }
      expect(
        studioApplyFreeFixInputSchemaV2.safeParse({
          expectedRevision: 8,
          recovery: { op: 'retry_conditioning_frame', dependentShotId: 'clip_2' },
        }).success
      ).toBe(true);
      expect(freeFixTool?.description).toMatch(/immediately preceding studio_get_project_status.*detail: true/i);
      expect(freeFixTool?.description).toMatch(
        /submission_unknown.*duplicate-charge acknowledgement remain owner-only/i
      );
      expect(freeFixTool?.description).toMatch(/creates no quote, authorization, job, generation request, or spend/i);
      expect(freeFixTool?.description).toMatch(/never infer or reuse a stale remedy/i);

      const paidRecoveryTool = tools.find((tool) => tool.name === 'studio_propose_paid_recovery');
      const paidRecoveryValidator = new AjvJsonSchemaValidator().getValidator(paidRecoveryTool?.inputSchema as never);
      const exactPaidRecovery = {
        expectedRevision: 8,
        blocker: {
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
              cascadeChoices: [],
              continuityChange: null,
            },
            estimatedMinorUnits: null,
            currency: null,
          },
        },
      };
      expect(paidRecoveryTool?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['expectedRevision', 'blocker'],
      });
      expect(paidRecoveryValidator(exactPaidRecovery)).toMatchObject({ valid: true });
      expect(studioProposePaidRecoveryInputSchemaV2.safeParse(exactPaidRecovery).success).toBe(true);
      const crossFieldMismatch = {
        ...exactPaidRecovery,
        blocker: { ...exactPaidRecovery.blocker, where: { kind: 'project' } },
      };
      // JSON Schema publishes the finite structural union; the shared strict runtime
      // validator additionally enforces cause/where/remedy correlation.
      expect(paidRecoveryValidator(crossFieldMismatch)).toMatchObject({ valid: true });
      expect(studioProposePaidRecoveryInputSchemaV2.safeParse(crossFieldMismatch).success).toBe(false);
      for (const invalidInput of [
        {
          ...exactPaidRecovery,
          blocker: {
            ...exactPaidRecovery.blocker,
            remedy: { ...exactPaidRecovery.blocker.remedy, currency: 'USD' },
          },
        },
        { ...exactPaidRecovery, blocker: { ...exactPaidRecovery.blocker, extra: true } },
      ]) {
        expect(paidRecoveryValidator(invalidInput), JSON.stringify(invalidInput)).toMatchObject({ valid: false });
        expect(studioProposePaidRecoveryInputSchemaV2.safeParse(invalidInput).success).toBe(false);
      }
      expect(paidRecoveryTool?.description).toMatch(/creates no authorization, job, provider request, or spend/i);
      expect(paidRecoveryTool?.description).toMatch(/only the person's explicit Confirm button may spend/i);

      const projectStatusTool = tools.find((tool) => tool.name === 'studio_get_project_status');
      const projectStatusValidator = new AjvJsonSchemaValidator().getValidator(projectStatusTool?.inputSchema as never);
      expect(projectStatusTool?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
      });
      expect(projectStatusValidator({})).toMatchObject({ valid: true });
      expect(projectStatusValidator({ detail: false })).toMatchObject({ valid: true });
      expect(projectStatusValidator({ detail: true })).toMatchObject({ valid: true });
      expect(projectStatusValidator({ detail: 'yes' })).toMatchObject({ valid: false });
      expect(projectStatusValidator({ detail: true, extra: 'secret' })).toMatchObject({ valid: false });
      expect(studioGetProjectStatusInputSchemaV2.safeParse({ detail: true }).success).toBe(true);
      expect(studioGetProjectStatusInputSchemaV2.safeParse({ detail: 1 }).success).toBe(false);
      expect(projectStatusTool?.description).toMatch(/without writing, generating, or spending/i);
      const proposalTool = tools.find((tool) => tool.name === 'studio_get_proposal');
      const getProposalValidator = new AjvJsonSchemaValidator().getValidator(proposalTool?.inputSchema as never);
      expect(proposalTool?.inputSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['proposalId'],
      });
      expect(getProposalValidator({ proposalId: 'proposal_exact' })).toMatchObject({ valid: true });
      expect(getProposalValidator({ proposalId: 'proposal_exact', extra: true })).toMatchObject({ valid: false });
      expect(getProposalValidator({ proposalId: '../unsafe' })).toMatchObject({ valid: false });
      expect(studioGetProposalInputSchemaV2.safeParse({ proposalId: 'proposal_exact' }).success).toBe(true);
      expect(proposalTool?.description).toMatch(/never authors the project, generates, authorizes, or spends/i);
      expect(proposalTool?.description).toMatch(/never silently rebase, apply, or replace/i);
      const commandStatus = tools.find((tool) => tool.name === 'studio_get_command_status');
      expect(commandStatus?.description).toMatch(/durable.*mutation or read-query status/i);
      expect(commandStatus?.description).not.toMatch(/schema-5/i);

      const referenceSchema = tools.find((tool) => tool.name === 'studio_request_reference_images')?.inputSchema;
      const referenceValidator = new AjvJsonSchemaValidator().getValidator(referenceSchema as never);
      expect(referenceSchema).toMatchObject({
        type: 'object',
        additionalProperties: false,
        required: ['referenceIds'],
      });
      expect(
        referenceValidator({
          referenceIds: Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES }, (_, index) => `ref_${index}`),
        })
      ).toMatchObject({ valid: true });
      expect(referenceValidator({ referenceIds: [], unknown: true })).toMatchObject({ valid: false });
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
      ];

      for (const input of invalidApplyInputs) {
        expect(applyValidator(input), JSON.stringify(input)).toMatchObject({ valid: false });
      }
      for (const operations of [
        [
          {
            kind: 'add_shot',
            beatId: 'section_1',
            shotId: 'clip_new',
            shot: { ...editableShotV2(), durationSeconds: 3 },
            beforeShotId: null,
          },
        ],
        [{ kind: 'edit_shot', shotId: 'clip_1', changes: { durationSeconds: 3 } }],
      ]) {
        expect(proposalValidator({ base_revision: 7, operations }), JSON.stringify(operations)).toMatchObject({
          valid: false,
        });
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
      expect(referenceValidator({ referenceIds: ['clip_1', 'clip_1'] })).toMatchObject({ valid: false });
    } finally {
      await harness.close();
    }
  });

  it('keeps the free-fix handler bounded before command IDs or sidecar IO', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-free-fix-'));
    const createId = vi.fn(() => 'must_not_mint');
    const writerFsAccess = vi.fn(() => {
      throw new Error('invalid free recovery must not reach writer IO');
    });
    const handler = createStudioApplyFreeFixHandlerV2(
      {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      },
      { createId, fs: new Proxy(nodeFs, { get: writerFsAccess }) }
    );
    try {
      const invalid = await handler({
        expectedRevision: 7,
        recovery: { op: 'terminalize_refused_job', jobId: '../unsafe' },
      });
      expect(invalid.isError).toBe(true);
      expect(invalid.content[0]).toMatchObject({ type: 'text', text: expect.stringMatching(/invalid|size cap/i) });
      expect(createId).not.toHaveBeenCalled();
      expect(writerFsAccess).not.toHaveBeenCalled();

      const contextIds = ['command_free_fix', 'lease_free_fix'];
      const unavailable = await createStudioApplyFreeFixHandlerV2(null, {
        createId: vi.fn(() => contextIds.shift() ?? 'unexpected_id'),
      })({
        expectedRevision: 7,
        recovery: { op: 'retry_conditioning_frame', dependentShotId: 'clip_2' },
      });
      expect(unavailable.content[0]).toMatchObject({ type: 'text', text: expect.any(String) });
      const unavailableContent = unavailable.content[0];
      expect(JSON.parse(unavailableContent?.type === 'text' ? unavailableContent.text : '')).toMatchObject({
        status: 'storage_error',
        commandId: 'command_free_fix',
      });
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('advertises only each Director tool authority while retaining handler size policy', async () => {
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
          valid: studioDirectorApplyToolAcceptsV2(operation),
        });
        expect(proposalValidator({ base_revision: 7, operations: [operation] }), operation.kind).toMatchObject({
          valid: studioDirectorProposalToolAcceptsV2(operation),
        });
      }
      const forbiddenRules = mutationCatalogV2().find((operation) => operation.kind === 'set_rules')!;
      expect(applyValidator({ expectedRevision: 7, operations: [forbiddenRules] })).toMatchObject({ valid: false });
      expect(proposalValidator({ base_revision: 7, operations: [forbiddenRules] })).toMatchObject({ valid: false });
      expect(applyValidator(oversizedApply)).toMatchObject({ valid: true });
      expect(proposalValidator(oversizedProposal)).toMatchObject({ valid: true });
      expect(studioApplyEditsInputSchemaV2.safeParse(oversizedApply).success).toBe(true);
      expect(studioProposeStoryboardInputSchemaV2.safeParse(oversizedProposal).success).toBe(true);

      for (const description of [applyTool?.description, proposalTool?.description]) {
        expect(description).toMatch(/256 KiB/i);
        expect(description).toMatch(/invalid arguments/i);
      }
      expect(applyTool?.description).toMatch(/capability preflight remains a fail-closed backstop/i);
      expect(applyTool?.description).toMatch(/whole proposal-eligible subset to propose_storyboard/i);
      expect(applyTool?.description).toMatch(/only when the direct subset is independently valid/i);
      expect(proposalTool?.description).toMatch(/every shootingScript/i);
      expect(proposalTool?.description).toMatch(/what is seen and heard/i);
      expect(proposalTool?.description).toMatch(/narration, dialogue, ambience, and discrete sound hits/i);

      const proposalSchemaText = JSON.stringify(proposalTool?.inputSchema);
      for (const operationKind of ['add_shot', 'edit_shot', 'apply_coverage']) {
        const operationVariant = proposalOperationVariant(proposalTool?.inputSchema, operationKind);
        expect(JSON.stringify(operationVariant), operationKind).toMatch(/what is seen and heard/i);
        expect(JSON.stringify(operationVariant), operationKind).toMatch(
          /narration, dialogue, ambience, and discrete sound hits/i
        );
      }
      expect(proposalSchemaText).not.toMatch(/new Shot sound field/i);
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
      ).toBe(studioDirectorApplyToolAcceptsV2(operation));
      expect(
        studioProposeStoryboardInputSchemaV2.safeParse({ base_revision: 7, operations: [operation] }).success,
        operation.kind
      ).toBe(studioDirectorProposalToolAcceptsV2(operation));
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
            kind: 'amend_reference_plan',
            additions: [{ kind: 'character', label: 'Mei', prompt: 'A character study.' }],
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
            kind: 'set_reference_plan',
            references: [{ id: 'director_owned_id', kind: 'character', label: 'Ming', prompt: 'A character study.' }],
          },
        ],
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
          { kind: 'set_brief', brief: 'A valid direct edit.' },
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
        operations: [{ kind: 'retired_authoring_operation', shotId: 'clip_1' }],
      }).success
    ).toBe(false);
    for (const referenceIds of [
      [],
      Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES + 1 }, (_, index) => `ref_${index}`),
      ['clip_1', 'clip_1'],
      ['unsafe/shot'],
    ]) {
      expect(studioRequestReferenceImagesInputSchemaV2.safeParse({ referenceIds }).success).toBe(false);
    }
  });

  it('rejects operations outside each advertised tool authority before IDs or sidecar IO', async () => {
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
            operations: [{ kind: 'edit_shot', shotId: 'clip_1', changes: { shootingScript: 'Proposal only' } }],
          },
        },
        {
          name: 'studio_apply_edits',
          arguments: { expectedRevision: 7, operations: [{ kind: 'undo_last', entryId: 'undo_1' }] },
        },
        {
          name: 'studio_apply_edits',
          arguments: {
            expectedRevision: 7,
            operations: [{ kind: 'remove_reference_image', referenceId: 'ref_ming', assetId: 'asset_ming' }],
          },
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
        const content = result.content[0];
        expect(content?.type).toBe('text');
        expect(content?.type === 'text' ? content.text : '').toMatch(/Input validation error|Invalid arguments/iu);
      }
      expect(createId).not.toHaveBeenCalled();
      await expect(nodeFs.readdir(path.join(projectDir, 'commands'))).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(nodeFs.readdir(path.join(projectDir, 'proposals'))).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await harness.close();
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  it('keeps handler capability preflight as a fail-closed backstop behind the narrow schema', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-mixed-capability-'));
    const createId = vi.fn(() => 'must_not_mint');
    const writerFsAccess = vi.fn(() => {
      throw new Error('studio_apply_edits capability rejection must not reach writer IO');
    });
    const writerFs = new Proxy(nodeFs, { get: writerFsAccess });
    const handler = createStudioApplyEditsHandlerV2(
      {
        projectId: 'project_v2',
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      },
      { createId, fs: writerFs }
    );
    try {
      const result = await handler({
        expectedRevision: 7,
        operations: [
          { kind: 'set_brief', brief: 'Direct work must remain identifiable' },
          { kind: 'edit_shot', shotId: 'clip_1', changes: { shootingScript: 'Proposal only' } },
          { kind: 'set_rules', rules: [] },
          { kind: 'edit_beat', beatId: 'section_1', changes: { title: 'Also direct' } },
        ],
      });
      const content = result.content[0];

      expect(result.isError).toBe(true);
      expect(content?.type).toBe('text');
      expect(JSON.parse(content?.type === 'text' ? content.text : '')).toMatchObject({
        code: 'operation_not_permitted',
        operationIndexBase: 0,
        rejectedOperations: [
          { index: 1, kind: 'edit_shot', disposition: 'proposal', reason: 'requires_user_review' },
          {
            index: 2,
            kind: 'set_rules',
            disposition: 'operation_not_permitted',
            reason: 'unavailable_to_director',
          },
          { index: 3, kind: 'edit_beat', disposition: 'proposal', reason: 'requires_user_review' },
        ],
        directCapableOperationIndexes: [0],
      });
      expect(createId).not.toHaveBeenCalled();
      expect(writerFsAccess).not.toHaveBeenCalled();
      await expect(nodeFs.readdir(projectDir)).resolves.toEqual([]);
    } finally {
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

  it('projects validated Story, Shooting script, semantic references, and exact Shot bindings', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-'));
    const project = makeSchema2ServiceProject();
    addGeneratedVideosForMcpV2(project, 1);
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
    await writeStudioProjectFilesV2(projectDir, project);

    const result = await createReadStoryboardHandlerV2({
      projectId: project.id,
      projectDir,
      pendingDir: '',
      referencePendingDir: '',
    })({});
    const view = JSON.parse(result.content[0].text) as {
      beatOrder: string[];
      beats: Record<string, { shotOrder: string[] }>;
      referencePlanStatus: string;
      references: Array<Record<string, unknown>>;
      shots: Record<
        string,
        {
          shootingScript: string;
          fixedReasons: string[];
          hasVideo: boolean;
          videoAssetId: string | null;
          referenceBinding: unknown;
        }
      >;
      bin: unknown[];
      rules: unknown[];
    };

    expect(result.isError).toBeUndefined();
    expect(view.beatOrder).toEqual(['section_1', 'section_2']);
    expect(view.beats.section_1.shotOrder).toEqual(['clip_1']);
    expect(view.shots.clip_1).toMatchObject({
      shootingScript: 'A wide establishing shot.',
      fixedReasons: ['owned_asset', 'owned_job', 'video_asset', 'seed_still', 'conditioning_input', 'shooting_script'],
      hasVideo: true,
      videoAssetId: 'take_01',
      referenceBinding: {
        status: 'ready',
        characterReferenceIds: [],
        backgroundReferenceId: 'ref_background',
      },
    });
    expect(view.shots.clip_1).not.toHaveProperty('selectedTakeId');
    expect(view.shots.clip_1).not.toHaveProperty('availableTakeIds');
    expect(view.bin).toEqual([]);
    expect(view.referencePlanStatus).toBe('planned');
    expect(view.references).toEqual([
      {
        id: 'ref_background',
        kind: 'background',
        label: 'City skyline',
        prompt: 'Warm city skyline from sunrise through evening.',
        approvalStatus: 'current',
        approvedAssetId: 'asset_reference_background',
      },
    ]);
    expect(JSON.stringify(view.references)).not.toMatch(/sha256|provider|superseded/u);
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

  it.each([null, 'grey_tone', 'line_art', 'colour_key'] as const)(
    'projects the exact nullable Board style %s without exposing Board asset authority',
    async (boardStyle) => {
      const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-board-style-'));
      const project = makeSchema2ServiceProject();
      project.boardStyle = boardStyle;
      await writeStudioProjectFilesV2(projectDir, project);

      try {
        const result = await createReadStoryboardHandlerV2({
          projectId: project.id,
          projectDir,
          pendingDir: '',
          referencePendingDir: '',
        })({});
        const view = JSON.parse(result.content[0].text) as {
          boardStyle: typeof boardStyle;
          shots: Record<string, Record<string, unknown>>;
        };

        expect(result.isError).toBeUndefined();
        expect(Object.hasOwn(view, 'boardStyle')).toBe(true);
        expect(view.boardStyle).toBe(boardStyle);
        expect(view.shots.clip_1).not.toHaveProperty('boardAssetId');
        expect(view.shots.clip_1).not.toHaveProperty('supersededBoardAssetIds');
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  );

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
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: empty.id,
        expectedRevision: empty.revision,
        operations: Array.from({ length: 24 }, (_, index) => {
          const ordinal = index + 1;
          return {
            kind: 'add_beat' as const,
            beatId: `section_${ordinal}`,
            beat: {
              title: `Section ${ordinal}`,
              story: `Visual story ${ordinal}`,
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
        schemaVersion: STUDIO_MUTATION_BATCH_SCHEMA_VERSION,
        projectId: project.id,
        expectedRevision: project.revision,
        operations: [{ kind: 'park_beat', beatId: 'section_24' }],
      },
      { mutationId: 'capacity_park_beat', capturedAt: parkedAt }
    ).project;
    project = { ...parked, revision: project.revision + 1, updatedAt: parkedAt };
    await writeStudioProjectFilesV2(projectDir, project);

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

  it.each([1, 2, 3, 4] as const)(
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
          createRequestReferenceImagesHandlerV2(config)({ referenceIds: ['ref_ming'] }),
        ]);

        expect(outcomes.every((result) => result.isError === true)).toBe(true);
        expect(outcomes.every((result) => result.content[0].text.includes('unsupported_prototype_schema'))).toBe(true);
        await expect(readdir(projectDir)).resolves.toEqual(['project.json']);
      } finally {
        await rm(projectDir, { recursive: true, force: true });
      }
    }
  );

  it('rejects a future project schema as invalid rather than misclassifying it as a prototype', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-server-v2-future-'));
    const futureManifest = {
      schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION + 1,
      id: 'project_future_schema',
      revision: 7,
    };
    const manifestBytes = JSON.stringify(futureManifest);
    await writeFile(path.join(projectDir, 'project.json'), manifestBytes);
    const config = {
      projectId: futureManifest.id,
      projectDir,
      pendingDir: path.join(projectDir, 'proposals', 'pending'),
      referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
    };

    try {
      const outcomes = await Promise.all([
        createReadStoryboardHandlerV2(config)({}),
        createProposeStoryboardHandlerV2(config)({
          base_revision: futureManifest.revision,
          operations: [{ kind: 'set_brief', brief: 'Must not cross a future schema boundary' }],
        }),
        createRequestReferenceImagesHandlerV2(config)({ referenceIds: ['ref_ming'] }),
      ]);

      expect(outcomes.every((result) => result.isError === true)).toBe(true);
      expect(outcomes.every((result) => result.content[0].text.includes('unsupported_prototype_schema'))).toBe(false);
      await expect(readFile(path.join(projectDir, 'project.json'), 'utf8')).resolves.toBe(manifestBytes);
      await expect(readdir(projectDir)).resolves.toEqual(['project.json']);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

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
      await writeStudioProjectFilesV2(projectDir, project);
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
            : await createRequestReferenceImagesHandlerV2(config)({ referenceIds: ['ref_background'] });

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
        await writeStudioProjectFilesV2(root, project);
        await writeFile(
          path.join(familyPendingDir, `${recordId}.json`),
          JSON.stringify(
            requestKind === 'proposal'
              ? {
                  schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
                  id: recordId,
                  projectId: project.id,
                  status: 'pending',
                  baseRevision: project.revision,
                  payload: { kind: 'mutation_batch', operations: [{ kind: 'set_brief', brief: marker }] },
                  createdAt,
                  decidedAt: null,
                }
              : {
                  schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
                  id: recordId,
                  projectId: project.id,
                  referenceIds: ['ref_background'],
                  status: 'pending',
                  createdAt,
                }
          )
        );
        await writeFile(
          path.join(familySlotsDir, '49.slot'),
          JSON.stringify({
            schemaVersion:
              requestKind === 'proposal' ? STUDIO_PROPOSAL_SCHEMA_VERSION_V2 : STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
            : await createRequestReferenceImagesHandlerV2(config)({ referenceIds: ['ref_background'] });

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
          createRequestReferenceImagesHandlerV2(config)({ referenceIds: ['ref_ming'] }),
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
    await writeStudioProjectFilesV2(projectDir, project);
    const config = { projectId: 'other_project', projectDir, pendingDir, referencePendingDir };

    await expect(createReadStoryboardHandlerV2(config)({})).resolves.toMatchObject({ isError: true });
    await expect(
      createProposeStoryboardHandlerV2(config)({
        base_revision: project.revision,
        operations: [{ kind: 'set_brief', brief: 'Must not be written' }],
      })
    ).resolves.toMatchObject({ isError: true });
    await expect(createRequestReferenceImagesHandlerV2(config)({ referenceIds: ['ref_ming'] })).resolves.toMatchObject({
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
    expect(record.schemaVersion).toBe(STUDIO_PROPOSAL_SCHEMA_VERSION_V2);
    expect(JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8'))).toMatchObject({
      schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
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

  it('validates a paid recovery against the exact timestamp it publishes', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-paid-proposal-v2-'));
    const pendingDir = path.join(projectDir, 'proposals', 'pending');
    await createSidecarFamilyV2(projectDir, 'proposals');
    const projectAuthority = await capturePendingProjectAuthorityV2(projectDir);
    const now = vi.fn(() => new Date('2026-08-17T12:00:01.000Z'));

    const record = await writeProposalRecordV2({
      pendingDir,
      projectId: 'project_v2',
      proposalId: 'proposal_paid_recovery',
      baseRevision: 7,
      payload: {
        kind: 'paid_recovery',
        blocker: {
          cause: 'reference_generation_required',
          where: { kind: 'reference', referenceId: 'reference_paid_recovery', jobId: null },
          remedy: {
            kind: 'proposal',
            prepare: { kind: 'project_references', referenceIds: ['reference_paid_recovery'] },
            estimatedMinorUnits: null,
            currency: null,
          },
        },
        quote: {
          quoteId: 'quote_paid_recovery',
          projectRevision: 7,
          expiresAt: '2026-08-17T12:05:00.000Z',
          currency: 'USD',
          lowerMinorUnits: 2,
          upperMinorUnits: 2,
          itemCount: 1,
          includesCascade: false,
        },
      },
      projectAuthority,
      now,
    });

    expect(record.createdAt).toBe('2026-08-17T12:00:01.000Z');
    expect(now).toHaveBeenCalledTimes(1);
    await expect(readFile(path.join(pendingDir, 'proposal_paid_recovery.json'), 'utf8')).resolves.toContain(
      '2026-08-17T12:00:01.000Z'
    );
    await rm(projectDir, { recursive: true, force: true });
  });

  it('writes one bounded exact V2 reference batch and ignores malformed dedup records', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-reference-v2-'));
    const pendingDir = path.join(projectDir, 'reference-requests', 'pending');
    const slotsDir = path.join(projectDir, 'reference-requests', 'slots');
    await createSidecarFamilyV2(projectDir, 'reference-requests');
    const referenceIds = Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES }, (_, index) => `ref_${index + 1}`);
    const projectAuthority = await capturePendingProjectAuthorityV2(projectDir);

    const record = await referenceRequestWriter.writeReferenceRequestRecordV2({
      pendingDir,
      projectId: 'project_v2',
      requestId: 'request_valid',
      referenceIds,
      projectAuthority,
    });
    expect(record).toMatchObject({ schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION, referenceIds });
    expect(JSON.parse(await readFile(path.join(slotsDir, '0.slot'), 'utf8'))).toMatchObject({
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
      requestId: 'request_valid',
    });
    const beforePending = await readdir(pendingDir);
    const beforeSlots = await readdir(slotsDir);
    const hostileReferenceIds = new Proxy(['ref_1'], {
      ownKeys() {
        throw new Error('hostile ownKeys');
      },
    });
    for (const invalidReferenceIds of [
      [],
      Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES + 1 }, (_, index) => `ref_${index}`),
      ['ref_1', 'ref_1'],
      ['unsafe/ref'],
      hostileReferenceIds,
    ]) {
      // Keep the no-side-effect queue oracle deterministic between malformed direct calls.
      // eslint-disable-next-line no-await-in-loop
      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir,
          projectId: 'project_v2',
          requestId: `invalid_${invalidReferenceIds.length}`,
          referenceIds: invalidReferenceIds,
          projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage' });
    }
    await expect(readdir(pendingDir)).resolves.toEqual(beforePending);
    await expect(readdir(slotsDir)).resolves.toEqual(beforeSlots);

    await writeFile(
      path.join(pendingDir, 'bad_date.json'),
      JSON.stringify({ ...record, id: 'bad_date', referenceIds: ['clip_bad_date'], createdAt: '2026-08-17' })
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
    await expect(referenceRequestWriter.listPendingReferenceRequestIdsV2(pendingDir, 'project_v2')).resolves.toEqual(
      new Set(referenceIds)
    );

    const racedFile = path.join(pendingDir, 'raced.json');
    const canonicalRacedFile = path.join(await nodeFs.realpath(pendingDir), 'raced.json');
    const oversizedTarget = path.join(projectDir, 'oversized.json');
    await writeFile(racedFile, JSON.stringify({ ...record, id: 'raced', referenceIds: ['clip_raced'] }));
    await writeFile(
      path.join(slotsDir, '1.slot'),
      JSON.stringify({
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      referenceRequestWriter.listPendingReferenceRequestIdsV2(pendingDir, 'project_v2', racedFs)
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
      referenceRequestWriter.listPendingReferenceRequestIdsV2(pendingDir, 'project_v2', mismatchedDirectoryFs)
    ).resolves.toEqual(new Set());
    await rm(projectDir, { recursive: true, force: true });
  });

  it('serializes overlapping reference reservations across distinct writer queue keys', async () => {
    const fixture = await createReferenceWriterQueueV2();
    try {
      const alternatePendingDir = `${path.dirname(fixture.pendingDir)}${path.sep}.${path.sep}pending`;
      const outcomes = await Promise.allSettled([
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_cross_process_a',
          referenceIds: ['ref_shared', 'ref_first'],
          projectAuthority: fixture.projectAuthority,
        }),
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: alternatePendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_cross_process_b',
          referenceIds: ['ref_shared', 'ref_second'],
          projectAuthority: fixture.projectAuthority,
        }),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
      expect(rejection).toMatchObject({
        status: 'rejected',
        reason: expect.objectContaining({ code: 'storage', message: expect.stringMatching(/already have pending/i) }),
      });
      expect((await readdir(fixture.pendingDir)).filter((name) => name.endsWith('.json'))).toHaveLength(1);
      expect((await readdir(fixture.slotsDir)).filter((name) => /^(?:0|[1-9]\d*)\.slot$/.test(name))).toHaveLength(1);
      expect((await readdir(path.dirname(fixture.pendingDir))).toSorted()).toEqual([
        'decisions',
        'pending',
        'receipts',
        'slots',
      ]);
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('retries when a competing reference-writer lease disappears during identity verification', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const lockFile = path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_LOCK_NAME_V2);
    let lockStatReads = 0;
    const racedFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'lstat') {
          return async (file: Parameters<typeof nodeFs.lstat>[0], ...args: unknown[]) => {
            if (String(file) === lockFile) {
              lockStatReads += 1;
              if (lockStatReads === 2) {
                await nodeFs.rm(lockFile);
                throw Object.assign(new Error('simulated completed lease release'), { code: 'ENOENT' });
              }
            }
            return Reflect.apply(nodeFs.lstat, nodeFs, [file, ...args]);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await writeFile(
        lockFile,
        JSON.stringify(
          referenceWriterLeaseV2({ pid: process.pid, acquiredAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString() })
        )
      );
      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_after_raced_release',
          referenceIds: ['ref_after_raced_release'],
          fs: racedFs,
          projectAuthority: fixture.projectAuthority,
        })
      ).resolves.toMatchObject({ status: 'pending' });
      expect(lockStatReads).toBeGreaterThanOrEqual(2);
      await expect(nodeFs.lstat(lockFile)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('fails closed on every malformed cross-process writer lease shape', async () => {
    const malformedLeases = [
      'not-json',
      JSON.stringify([]),
      JSON.stringify({ ...referenceWriterLeaseV2(), extra: true }),
      JSON.stringify(referenceWriterLeaseV2({ schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION + 1 })),
      JSON.stringify(referenceWriterLeaseV2({ token: '../unsafe' })),
      JSON.stringify(referenceWriterLeaseV2({ pid: 0 })),
      JSON.stringify(referenceWriterLeaseV2({ acquiredAt: 'not-a-date' })),
    ];

    for (const [index, leaseBytes] of malformedLeases.entries()) {
      // Each malformed publication gets an isolated authority root.
      // eslint-disable-next-line no-await-in-loop
      const fixture = await createReferenceWriterQueueV2();
      try {
        // eslint-disable-next-line no-await-in-loop
        await writeFile(path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_LOCK_NAME_V2), leaseBytes);
        // eslint-disable-next-line no-await-in-loop
        await expect(
          referenceRequestWriter.writeReferenceRequestRecordV2({
            pendingDir: fixture.pendingDir,
            projectId: REFERENCE_WRITER_PROJECT_ID_V2,
            requestId: `request_malformed_lease_${index}`,
            referenceIds: [`ref_malformed_lease_${index}`],
            projectAuthority: fixture.projectAuthority,
          })
        ).rejects.toMatchObject({ code: 'storage', message: expect.stringMatching(/malformed/i) });
        // eslint-disable-next-line no-await-in-loop
        await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
        // eslint-disable-next-line no-await-in-loop
        await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await rm(fixture.projectDir, { recursive: true, force: true });
      }
    }
  });

  it('reclaims stale dead writer and reclaim leases before publishing', async () => {
    for (const leaseName of [REFERENCE_WRITER_LOCK_NAME_V2, REFERENCE_WRITER_RECLAIM_NAME_V2]) {
      // Exercise both interrupted ownership phases independently.
      // eslint-disable-next-line no-await-in-loop
      const fixture = await createReferenceWriterQueueV2();
      try {
        // eslint-disable-next-line no-await-in-loop
        await writeFile(
          path.join(fixture.projectAuthority.canonicalRoot, leaseName),
          JSON.stringify(referenceWriterLeaseV2())
        );
        // eslint-disable-next-line no-await-in-loop
        await expect(
          referenceRequestWriter.writeReferenceRequestRecordV2({
            pendingDir: fixture.pendingDir,
            projectId: REFERENCE_WRITER_PROJECT_ID_V2,
            requestId: `request_after_${leaseName.endsWith('reclaim') ? 'reclaim' : 'lock'}_recovery`,
            referenceIds: [`ref_after_${leaseName.endsWith('reclaim') ? 'reclaim' : 'lock'}_recovery`],
            projectAuthority: fixture.projectAuthority,
          })
        ).resolves.toMatchObject({ status: 'pending' });
        // eslint-disable-next-line no-await-in-loop
        await expect(
          nodeFs.lstat(path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_LOCK_NAME_V2))
        ).rejects.toMatchObject({ code: 'ENOENT' });
        // eslint-disable-next-line no-await-in-loop
        await expect(
          nodeFs.lstat(path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_RECLAIM_NAME_V2))
        ).rejects.toMatchObject({ code: 'ENOENT' });
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await rm(fixture.projectDir, { recursive: true, force: true });
      }
    }
  });

  it('does not steal a stale lease from a live writer', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const now = Date.now();
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(now)
      .mockReturnValue(now + 5_001);
    try {
      await writeFile(
        path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_LOCK_NAME_V2),
        JSON.stringify(referenceWriterLeaseV2({ pid: process.pid }))
      );
      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_live_writer',
          referenceIds: ['ref_live_writer'],
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage', message: expect.stringMatching(/busy/i) });
      await expect(readdir(fixture.pendingDir)).resolves.toEqual([]);
      await expect(readdir(fixture.slotsDir)).resolves.toEqual([]);
    } finally {
      clock.mockRestore();
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('reports a successful publication whose writer lease cannot be released', async () => {
    const fixture = await createReferenceWriterQueueV2();
    const lockFile = path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_LOCK_NAME_V2);
    const reclaimFile = path.join(fixture.projectAuthority.canonicalRoot, REFERENCE_WRITER_RECLAIM_NAME_V2);
    const releaseFailureFs = new Proxy(nodeFs, {
      get(target, property, receiver) {
        if (property === 'link') {
          return async (
            existingPath: Parameters<typeof nodeFs.link>[0],
            newPath: Parameters<typeof nodeFs.link>[1]
          ) => {
            if (String(existingPath) === lockFile && String(newPath) === reclaimFile) {
              throw Object.assign(new Error('simulated release failure'), { code: 'EPERM' });
            }
            return nodeFs.link(existingPath, newPath);
          };
        }
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_release_failure',
          referenceIds: ['ref_release_failure'],
          fs: releaseFailureFs,
          projectAuthority: fixture.projectAuthority,
        })
      ).rejects.toMatchObject({ code: 'storage', message: expect.stringMatching(/could not be released/i) });
      expect((await readdir(fixture.pendingDir)).filter((name) => name === 'request_release_failure.json')).toEqual([
        'request_release_failure.json',
      ]);
      await expect(readdir(fixture.slotsDir)).resolves.toContain('0.slot');
      await expect(nodeFs.lstat(lockFile)).resolves.toMatchObject({ isFile: expect.any(Function) });
    } finally {
      await rm(fixture.projectDir, { recursive: true, force: true });
    }
  });

  it('fails closed on invalid reference clocks and identities without touching an absent queue', async () => {
    const missingRoot = await mkdtemp(path.join(tmpdir(), 'studio-reference-missing-'));
    const missingPendingDir = path.join(missingRoot, 'pending');
    await expect(
      referenceRequestWriter.listPendingReferenceRequestIdsV2(
        missingPendingDir,
        REFERENCE_WRITER_PROJECT_ID_V2,
        nodeFs,
        undefined,
        () => REFERENCE_WRITER_NOW_MS_V2
      )
    ).resolves.toEqual(new Set());
    await expect(
      referenceRequestWriter.listPendingReferenceRequestIdsV2(
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
        { projectId: '../unsafe', requestId: 'request_safe', referenceIds: ['shot_safe'] },
        { projectId: REFERENCE_WRITER_PROJECT_ID_V2, requestId: '../unsafe', referenceIds: ['shot_safe'] },
        { projectId: REFERENCE_WRITER_PROJECT_ID_V2, requestId: 'request_sparse', referenceIds: sparseShotIds },
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          requestId: current.id,
          reservedAt: current.createdAt,
        })
      );

      await expect(
        referenceRequestWriter.listPendingReferenceRequestIdsV2(
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
        referenceIds: ['shot_duplicate_slot'],
        projectAuthority: duplicateFixture.projectAuthority,
      });
      const duplicateSlot = JSON.stringify({
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
        requestId: record.id,
        reservedAt: record.createdAt,
      });
      await writeFile(path.join(duplicateFixture.slotsDir, '1.slot'), duplicateSlot);
      const pendingBefore = await readFile(path.join(duplicateFixture.pendingDir, `${record.id}.json`), 'utf8');

      await expect(
        referenceRequestWriter.listPendingReferenceRequestIdsV2(
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
        referenceIds: ['shot_pending_replacement'],
        projectAuthority: replacementFixture.projectAuthority,
      });
      const slotFile = path.join(await nodeFs.realpath(replacementFixture.slotsDir), '0.slot');
      const pendingFile = path.join(await nodeFs.realpath(replacementFixture.pendingDir), `${record.id}.json`);
      const replacementBytes = JSON.stringify({ ...record, referenceIds: ['shot_replacement'] });
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
        referenceRequestWriter.listPendingReferenceRequestIdsV2(
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
                schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          referenceIds: ['reference_over_capacity'],
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          requestId: 'request_out_of_range',
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        }),
      },
      {
        pendingName: null,
        pendingBytes: null,
        slotName: '0.slot',
        slotBytes: JSON.stringify({
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
            referenceIds: ['shot_new'],
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          referenceIds: ['shot_new'],
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
          requestId,
          reservedAt: new Date(REFERENCE_WRITER_NOW_MS_V2).toISOString(),
        })
      );

      await expect(
        referenceRequestWriter.writeReferenceRequestRecordV2({
          pendingDir: fixture.pendingDir,
          projectId: REFERENCE_WRITER_PROJECT_ID_V2,
          requestId: 'request_current_project',
          referenceIds: ['shot_new'],
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          referenceIds: ['shot_new'],
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
      JSON.stringify({ schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION, requestId, reservedAt });
    const writeNext = (requestId: string, shotId: string, recordFs: typeof nodeFs = nodeFs) =>
      referenceRequestWriter.writeReferenceRequestRecordV2({
        pendingDir: fixture.pendingDir,
        projectId: REFERENCE_WRITER_PROJECT_ID_V2,
        requestId,
        referenceIds: [shotId],
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          referenceIds: ['shot_new'],
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
          schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
          referenceIds: ['shot_new'],
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
    project.referenceOrder = ['ref_ming', 'ref_mei', 'ref_background'];
    project.references.ref_ming = {
      id: 'ref_ming',
      kind: 'character',
      label: 'Ming',
      prompt: 'Character turnaround sheet for Ming.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    project.references.ref_mei = {
      id: 'ref_mei',
      kind: 'character',
      label: 'Mei',
      prompt: 'Character turnaround sheet for Mei.',
      approvedAssetId: null,
      supersededAssetIds: [],
      jobIds: [],
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    };
    await writeStudioProjectFilesV2(projectDir, project);
    const config = { projectId: project.id, projectDir, pendingDir, referencePendingDir };

    await expect(createReadStoryboardHandlerV2(null)({})).resolves.toMatchObject({ isError: true });
    const unavailableRoutes = await createListRoutesHandler({ ...config, routeCatalog: null })({});
    expect(JSON.parse(unavailableRoutes.content[0]!.text)).toMatchObject({ status: 'storage_error' });
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
      { referenceIds: null as unknown as string[] },
      { referenceIds: [] },
      {
        referenceIds: Array.from({ length: STUDIO_MAX_PROJECT_REFERENCES + 1 }, (_, index) => `ref_${index}`),
      },
      { referenceIds: ['unsafe/shot'] },
      { referenceIds: ['clip_1', 'clip_1'] },
      { referenceIds: ['inactive_clip'] },
      { referenceIds: ['ref_mei', 'ref_ming'] },
    ]) {
      // These validation outcomes share one dedup inbox and are intentionally observed in order.
      // eslint-disable-next-line no-await-in-loop
      await expect(referenceHandler(input)).resolves.toMatchObject({ isError: true });
    }
    await expect(createRequestReferenceImagesHandlerV2(null)({ referenceIds: ['ref_ming'] })).resolves.toMatchObject({
      isError: true,
    });
    const queued = await referenceHandler({ referenceIds: ['ref_ming'] });
    expect(queued.content[0].text).toMatch(/Queued 1 reference image request\(s\).*Nothing was generated/i);
    const mixedPending = await referenceHandler({ referenceIds: ['ref_ming', 'ref_mei'] });
    expect(mixedPending).toMatchObject({ isError: true });
    expect(mixedPending.content[0].text).toMatch(/already have pending requests: ref_ming/i);
    expect((await readdir(referencePendingDir)).filter((name) => name.endsWith('.json'))).toHaveLength(1);
    const queuedSecond = await referenceHandler({ referenceIds: ['ref_mei'] });
    expect(queuedSecond.content[0].text).toMatch(/Queued 1 reference image request\(s\).*Nothing was generated/i);
    const repeated = await referenceHandler({ referenceIds: ['ref_ming', 'ref_mei'] });
    expect(repeated).toMatchObject({ isError: true });
    expect(repeated.content[0].text).toMatch(/already have pending requests: ref_ming, ref_mei/i);
    const referenceEntries = await readdir(referencePendingDir);
    expect(referenceEntries.filter((name) => name.endsWith('.json'))).toHaveLength(2);
    expect(referenceEntries.filter((name) => name.endsWith('.tmp'))).toHaveLength(2);
    expect(referenceEntries.filter((name) => name.endsWith('.ready'))).toHaveLength(2);
    await rm(projectDir, { recursive: true, force: true });
  });

  it('rejects a mixed running and runnable reference request atomically', async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), 'studio-v2-running-reference-'));
    try {
      const pendingDir = path.join(projectDir, 'proposals', 'pending');
      const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
      await createSidecarFamilyV2(projectDir, 'proposals');
      await createSidecarFamilyV2(projectDir, 'reference-requests');
      const project = makeSchema2ServiceProject();
      const runningReference = project.references.ref_background!;
      const runningJob = project.jobs[SERVICE_REFERENCE_JOB_ID]!;
      runningReference.approvedAssetId = null;
      runningJob.status = 'running';
      runningJob.outputAssetIds = [];
      runningJob.outputAssetIdsByRole = { primary: null, poster: null };
      runningJob.spendReceipt = null;
      delete project.assets.asset_reference_background;
      for (const shot of Object.values(project.shots)) {
        shot.referenceBinding = {
          status: 'ready',
          characterReferenceIds: [],
          backgroundReferenceId: null,
        };
      }
      project.referenceOrder.push('ref_background_other');
      project.references.ref_background_other = {
        id: 'ref_background_other',
        kind: 'background',
        label: 'Other background',
        prompt: 'A second approved workflow location.',
        approvedAssetId: null,
        supersededAssetIds: [],
        jobIds: [],
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
      };
      expect(validateStudioProjectV2(project)).toBe(true);
      await writeStudioProjectFilesV2(projectDir, project);

      const result = await createRequestReferenceImagesHandlerV2({
        projectId: project.id,
        projectDir,
        pendingDir,
        referencePendingDir,
      })({ referenceIds: ['ref_background', 'ref_background_other'] });

      expect(result).toMatchObject({ isError: true });
      expect(result.content[0].text).toMatch(/generation in progress: ref_background/i);
      expect((await readdir(referencePendingDir)).filter((name) => name.endsWith('.json'))).toEqual([]);
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
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
    await writeStudioProjectFilesV2(projectDir, project);

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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_PROPOSAL_SCHEMA_VERSION_V2,
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
              schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
              requestId,
              projectId: REFERENCE_WRITER_PROJECT_ID_V2,
              decidedAt: new Date(REFERENCE_WRITER_NOW_MS_V2 - 1).toISOString(),
              outcome: { kind: 'rejected' as const },
            }
          : variant === 'early expiry'
            ? {
                schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
                referenceIds: ['shot_different'],
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
      JSON.stringify(
        referenceDecisionV2(requestId, { kind: 'generation_gate', handoffId, referenceIds: ['shot_existing'] })
      )
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
      JSON.stringify(
        referenceDecisionV2(requestId, { kind: 'generation_gate', handoffId, referenceIds: ['shot_existing'] })
      )
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
      JSON.stringify(
        referenceDecisionV2(requestId, { kind: 'generation_gate', handoffId, referenceIds: ['shot_existing'] })
      )
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
      schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
              await writeFile(finalFile, JSON.stringify({ schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION }));
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
        schemaVersion: STUDIO_REFERENCE_REQUEST_SCHEMA_VERSION,
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
