/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { IProvider, ISessionMcpServer } from '@/common/config/storage';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type CreateStudioProjectInputV2,
  type StudioAssetV2,
  type StudioBindDirectorConversationRequestV2,
  type StudioBriefReferenceRole,
  type StudioCancellationPolicy,
  type StudioCascadeBarrierActionRequestV2,
  type StudioConnectionBinding,
  type StudioConnectionCandidate,
  type StudioConnectionInventory,
  type StudioConnectionRecord,
  type StudioConnectionValidationResult,
  type StudioConfirmSubmissionRequestV2,
  type StudioConfirmSubmissionResultV2,
  type StudioCopyExportResultV2,
  type StudioCreateExportRequestV2,
  type StudioDetachBedAudioRequestV2,
  type StudioDetachBriefReferenceRequest,
  type StudioDismissReferenceGenerationHandoffRequestV2,
  type StudioDismissReferenceGenerationHandoffResultV2,
  type StudioDirectorSessionAuthorityV2,
  type StudioJobRequest,
  type StudioJobV2,
  type StudioExportArtifactRequestV2,
  type StudioListExportsRequestV2,
  type StudioMediaChoiceRef,
  type StudioMediaKind,
  type StudioMediaRouteCatalog,
  type StudioModelAvailability,
  type StudioMutationBatchResultV2,
  type StudioMutationBatchV2,
  type StudioMutationReducerContextV2,
  type StudioProjectListResultV2,
  type StudioProjectLoadResultV2,
  type StudioProjectV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioProposalV2,
  type StudioProviderRef,
  type StudioQuotedGeneration,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestV2,
  type StudioRemoveConnectionRequest,
  type StudioRendererChainStatusV2,
  type StudioRendererExportCatalogV2,
  type StudioRendererJobV2,
  type StudioRendererPreparedSubmissionOptionsV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererProjectV2,
  type StudioRendererReferenceGenerationHandoffV2,
  type StudioRendererWorkspaceStatusV2,
  type StudioRetryDownloadRequest,
  type StudioRetryJobRequest,
  type StudioRouteCatalogEntry,
  type StudioRouteCatalogV2,
  type StudioRevealExportResultV2,
  type StudioSaveConnectionRequest,
  type StudioShot,
  type StudioSpendAuthorization,
  type StudioSubmissionQuote,
  type StudioSubmissionQuoteCore,
  type StudioValidateConnectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import { isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import { canCancelJobV2, type StudioDispatchAuthorizedJobsRequestV2, type StudioJobManagerV2 } from '../jobManager';
import type { StudioMediaStore } from '../mediaStore';
import type { GenerationProviderAdapterRegistry } from '../adapters';
import { ProviderDeadlineError, runWithProviderDeadline } from '../adapters/types';
import {
  createStudioMediaChoiceId,
  type StudioGenerationRoute,
  type StudioGenerationRouteCatalog,
  type StudioProviderResolver,
} from '../providerResolver';
import {
  CreativeStudioStoreError,
  StudioProjectConfirmationError,
  type CreativeStudioStore,
  type StudioDecideReferenceRequestInputV2,
  type StudioProjectAuthoritySnapshotV2,
  type StudioProjectConfirmationInputV2,
  type StudioReferenceGenerationHandoffStoreV2,
  type StudioProjectStoreLoadResultV2,
} from '../store';
import {
  createStudioSpendAuthorizationV2,
  deriveStudioSubmissionQuoteGraphV2,
  evaluateStudioBudgetV2,
  priceStudioSubmissionQuoteGraphV2,
  StudioPricingErrorV2,
  StudioRateCardErrorV2,
  studioSubmissionQuoteCoresEqual,
  toStudioRendererSubmissionQuoteV2,
  type StudioRateCardV2,
} from './schema2/pricing';
import {
  composeStudioEditorFolderV2,
  createStudioExportCatalogStoreV2,
  projectStudioRendererExportCatalogV2,
  StudioEditorFolderErrorV2,
  StudioExportCatalogErrorV2,
  type StudioExportCatalogStoreV2,
  type StudioExportPayloadFilePlanV2,
} from './schema2/exports';
import {
  StudioPreparedSubmissionCacheErrorV2,
  StudioPreparedSubmissionCacheV2,
  type StudioPreparedSubmissionClaimV2,
} from './schema2/pricing/preparedSubmissionCache';
import {
  applyStudioMutationBatchV2,
  advanceStudioWaitingBindingsV2,
  createStudioFrameExtractionId,
  projectStudioChainStatusV2,
  projectStudioWorkspaceStatusV2,
  terminalizeStudioUnboundDependenciesV2,
  type StudioMutationApplyResultV2,
  type StudioVerifiedConditioningFrameV2,
  type StudioWaitingBindingAdvanceV2,
} from './schema2';
import { CreativeStudioServiceError } from './projectMutations';

export type { StudioRouteCatalogV2 } from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ACTIVE_JOB_STATUSES: ReadonlySet<StudioJobV2['status']> = new Set([
  'waiting_for_conditioning',
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);
const ROUTE_INTEGRATION_LABELS = {
  'weprompt-image-v1': 'imageApi',
  'byteplus-seedance-v1': 'bytePlusSeedance',
  'weprompt-media-gateway-v1': 'selfHostedVideoGateway',
  'openrouter-video-v1': 'openRouterVideo',
} as const;
const CONNECTION_VALIDATION_TIMEOUT_MS = 30_000;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_INTEGRATIONS = [
  {
    integrationId: 'integration_g7Q2mB4p',
    adapterId: 'weprompt-image-v1',
    kind: 'image',
    labelKey: 'imageApi',
  },
  {
    integrationId: 'integration_r9L3vN6k',
    adapterId: 'byteplus-seedance-v1',
    kind: 'video',
    labelKey: 'bytePlusSeedance',
  },
  {
    integrationId: 'integration_x5T8cW1h',
    adapterId: 'weprompt-media-gateway-v1',
    kind: 'video',
    labelKey: 'selfHostedVideoGateway',
  },
  {
    integrationId: 'integration_o4R7vD2m',
    adapterId: 'openrouter-video-v1',
    kind: 'video',
    labelKey: 'openRouterVideo',
  },
] as const satisfies ReadonlyArray<{
  integrationId: string;
  adapterId: StudioConnectionBinding['adapterId'];
  kind: 'image' | 'video';
  labelKey: 'imageApi' | 'bytePlusSeedance' | 'selfHostedVideoGateway' | 'openRouterVideo';
}>;
const CAPTURED_POSTER_DATA_URL_PREFIX = 'data:image/png;base64,';
const CAPTURED_POSTER_MAX_BYTES = 50 * 1024 * 1024;
const CAPTURED_POSTER_MAX_BASE64_LENGTH = Math.ceil(CAPTURED_POSTER_MAX_BYTES / 3) * 4;

export type StudioShotReadinessIssueV2 =
  | 'missing_beat_title'
  | 'missing_look'
  | 'missing_line'
  | 'invalid_shot_duration'
  | 'active_job'
  | 'generated_take_exists'
  | 'latest_job_failed';

export type StudioShotGenerationReadinessV2 = {
  shotId: string;
  beatId: string;
  ready: boolean;
  issues: StudioShotReadinessIssueV2[];
};

export type StudioGenerationReadinessV2 = {
  projectId: string;
  revision: number;
  shots: StudioShotGenerationReadinessV2[];
  payableShotIds: string[];
};

export type StudioExportDestinationPickerV2 = (input: {
  suggestedName: string;
  isDirectory: boolean;
}) => Promise<string | null>;

export type StudioExportPathRevealerV2 = (filePath: string) => void;

export type CreativeStudioServiceV2 = {
  listProjects(): Promise<StudioProjectListResultV2>;
  createProject(input: CreateStudioProjectInputV2): Promise<StudioRendererProjectV2>;
  getProject(projectId: string): Promise<StudioProjectLoadResultV2>;
  deleteProject(input: { projectId: string; expectedRevision: number }): Promise<boolean>;
  getBriefSessionServer(input: { projectId: string }): Promise<ISessionMcpServer>;
  getDirectorSessionAuthority(input: { projectId: string }): Promise<StudioDirectorSessionAuthorityV2>;
  bindDirectorConversation(
    input: StudioBindDirectorConversationRequestV2
  ): Promise<StudioRendererProjectCommitResultV2>;
  applyMutations(
    input: StudioMutationBatchV2,
    context: StudioMutationReducerContextV2
  ): Promise<StudioMutationBatchResultV2>;
  importReferenceFromPath(input: {
    projectId: string;
    shotId?: string;
    briefReferenceRole?: StudioBriefReferenceRole;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }>;
  importBedAudioFromPath(input: {
    projectId: string;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }>;
  detachBedAudio(input: StudioDetachBedAudioRequestV2): Promise<StudioRendererProjectV2>;
  detachBriefReference(input: StudioDetachBriefReferenceRequest): Promise<StudioRendererProjectV2>;
  createExport(input: StudioCreateExportRequestV2): Promise<StudioRendererExportCatalogV2>;
  listExports(input: StudioListExportsRequestV2): Promise<StudioRendererExportCatalogV2>;
  copyExport(
    input: StudioExportArtifactRequestV2,
    chooseDestination: StudioExportDestinationPickerV2
  ): Promise<StudioCopyExportResultV2>;
  revealExport(
    input: StudioExportArtifactRequestV2,
    revealPath: StudioExportPathRevealerV2
  ): Promise<StudioRevealExportResultV2>;
  persistCapturedPoster(input: {
    projectId: string;
    shotId: string;
    videoAssetId: string;
    dataUrl: string;
    width: number;
    height: number;
  }): Promise<StudioAssetV2>;
  listRoutes(input?: { projectId?: string }): Promise<StudioRouteCatalogV2>;
  getGenerationReadiness(input: { projectId: string; beatIds: string[] }): Promise<StudioGenerationReadinessV2>;
  getWorkspaceStatus(input: { projectId: string }): Promise<StudioRendererWorkspaceStatusV2>;
  getChainStatus(input: { projectId: string }): Promise<StudioRendererChainStatusV2>;
  listProposals(input: { projectId: string }): Promise<StudioProposalV2[]>;
  acceptProposal(input: { projectId: string; proposalId: string }): Promise<{
    proposal: StudioProposalV2;
    project: StudioRendererProjectV2;
    applied: boolean;
  }>;
  rejectProposal(input: { projectId: string; proposalId: string }): Promise<StudioProposalV2>;
  listReferenceRequests(input: { projectId: string }): Promise<StudioReferenceRequestV2[]>;
  decideReferenceRequest(input: StudioDecideReferenceRequestInputV2): Promise<StudioReferenceRequestDecisionV2>;
  listReferenceGenerationHandoffs(input: { projectId: string }): Promise<StudioRendererReferenceGenerationHandoffV2[]>;
  dismissReferenceGenerationHandoff(
    input: StudioDismissReferenceGenerationHandoffRequestV2
  ): Promise<StudioDismissReferenceGenerationHandoffResultV2>;
  prepareSubmission(input: StudioPrepareSubmissionRequestV2): Promise<StudioRendererPreparedSubmissionOptionsV2>;
  confirmSubmission(input: StudioConfirmSubmissionRequestV2): Promise<StudioConfirmSubmissionResultV2>;
  retryConditioningFrame(input: StudioCascadeBarrierActionRequestV2): Promise<StudioRendererWorkspaceStatusV2>;
  cancelWaitingCascade(input: StudioCascadeBarrierActionRequestV2): Promise<StudioRendererWorkspaceStatusV2>;
  dispatchAuthorizedJobs(input: StudioDispatchAuthorizedJobsRequestV2): Promise<StudioRendererJobV2[]>;
  cancelJob(input: StudioJobRequest): Promise<StudioRendererJobV2>;
  retryJob(input: StudioRetryJobRequest): Promise<StudioRendererJobV2>;
  retryDownload(input: StudioRetryDownloadRequest): Promise<StudioRendererJobV2>;
  listConnectionCandidates(): Promise<StudioConnectionCandidate[]>;
  listConnections(): Promise<StudioConnectionInventory>;
  validateConnection(input: StudioValidateConnectionRequest): Promise<StudioConnectionValidationResult>;
  saveConnection(input: StudioSaveConnectionRequest): Promise<StudioConnectionRecord>;
  removeConnection(input: StudioRemoveConnectionRequest): Promise<boolean>;
  dispose(): void;
};

export type CreativeStudioServiceV2Deps = {
  store: CreativeStudioStore;
  providerResolver: StudioProviderResolver;
  jobManager: StudioJobManagerV2;
  mediaStore?: StudioMediaStore;
  exportCatalogStore?: StudioExportCatalogStoreV2;
  listProviders?: () => Promise<IProvider[]>;
  getAdapterRegistry?: () => GenerationProviderAdapterRegistry;
  getStudioServerScriptPath?: () => string;
  ensureDirectorCommandMailbox?: (projectId: string) => Promise<void>;
  createConnectionId?: () => string;
  rateCard?: (generation: StudioGenerationRouteCatalog) => Promise<StudioRateCardV2>;
  preparedSubmissionCache?: StudioPreparedSubmissionCacheV2;
  createQuoteId?: () => string;
  createJobId?: () => string;
  createIdempotencyKey?: () => string;
  createExportId?: () => string;
  now?: () => Date;
  onProjectUpdated: (projectId: string) => void;
};

const invalid = (message: string): CreativeStudioStoreError => new CreativeStudioStoreError('invalid_payload', message);

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const rethrowPricingFailure = (error: unknown): never => {
  if (error instanceof StudioRateCardErrorV2) {
    throw new CreativeStudioServiceError('invalid_route');
  }
  if (error instanceof StudioPricingErrorV2) {
    if (
      error.code === 'missing_route' ||
      error.code === 'rate_not_found' ||
      error.code === 'route_kind_mismatch' ||
      error.code === 'invalid_rate_card' ||
      error.code === 'mixed_currency'
    ) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    throw invalid(`Invalid Studio submission: ${error.code}`);
  }
  throw error;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const expected = new Set(keys);
  return (
    Reflect.ownKeys(value).length === expected.size &&
    Reflect.ownKeys(value).every((key) => typeof key === 'string' && expected.has(key))
  );
};

const isExactDenseArray = (value: unknown): value is unknown[] => {
  if (!Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || !keys.includes('length')) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
};

const assertReferenceHandoffPrepareEnvelope: (
  input: unknown
) => asserts input is StudioPrepareSubmissionRequestV2 & { originReferenceHandoffId: string } = (input) => {
  if (
    !isRecord(input) ||
    !hasExactKeys(input, [
      'projectId',
      'expectedRevision',
      'originReferenceHandoffId',
      'baseChoices',
      'cascadeChoices',
    ]) ||
    !isSafeId(input.projectId) ||
    !isSafeId(input.originReferenceHandoffId) ||
    !Number.isSafeInteger(input.expectedRevision) ||
    (input.expectedRevision as number) < 1 ||
    !isExactDenseArray(input.baseChoices) ||
    input.baseChoices.length === 0 ||
    !isExactDenseArray(input.cascadeChoices) ||
    input.cascadeChoices.length !== 0
  ) {
    throw invalid('Invalid Studio reference handoff submission');
  }
  for (const choice of input.baseChoices) {
    if (
      !isRecord(choice) ||
      !hasExactKeys(choice, ['shotId', 'purpose', 'generationCount', 'referenceAssetId']) ||
      !isSafeId(choice.shotId) ||
      choice.purpose !== 'seed_still' ||
      choice.generationCount !== 1 ||
      choice.referenceAssetId !== null
    ) {
      throw invalid('Invalid Studio reference handoff submission');
    }
  }
};

const assertExactOpenReferenceHandoff = (
  request: StudioPrepareSubmissionRequestV2 & { originReferenceHandoffId: string },
  handoff: StudioReferenceGenerationHandoffStoreV2 | null
): void => {
  if (
    handoff === null ||
    handoff.receipt !== null ||
    handoff.request.projectId !== request.projectId ||
    handoff.decision.projectId !== request.projectId ||
    handoff.decision.requestId !== handoff.request.id ||
    handoff.decision.outcome.handoffId !== request.originReferenceHandoffId ||
    !jsonEqual(handoff.request.shotIds, handoff.decision.outcome.shotIds) ||
    handoff.decision.outcome.shotIds.length !== request.baseChoices.length ||
    !handoff.decision.outcome.shotIds.every((shotId, index) => request.baseChoices[index]?.shotId === shotId)
  ) {
    throw invalid('Invalid Studio reference handoff submission');
  }
};

const defaultId = (prefix: string): string => `${prefix}_${randomUUID().replaceAll('-', '')}`;

const quoteCore = (quote: StudioSubmissionQuote): StudioSubmissionQuoteCore => {
  const { id: _id, expiresAt: _expiresAt, ...core } = quote;
  return structuredClone(core);
};

const jsonEqual = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const assertSafeId: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (!isSafeId(value)) throw invalid(`Invalid Studio ${label}`);
};

const assertRevision: (value: unknown) => asserts value is number = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalid('Invalid Studio project revision');
  }
};

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;

const isUnsafeTextCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff);
};

const assertConnectionModel: (value: unknown) => asserts value is string = (value) => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 256 ||
    value !== value.trim() ||
    Array.from(value).some(isUnsafeTextCharacter)
  ) {
    throw invalid('Invalid Studio connection model');
  }
};

const providerIsAvailable = (provider: IProvider, model: string): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  typeof provider.api_key === 'string' &&
  provider.api_key.trim().length > 0 &&
  typeof provider.base_url === 'string' &&
  provider.base_url.trim().length > 0;

const sanitizedCapabilities = (
  adapterId: StudioConnectionBinding['adapterId'],
  model: string,
  capabilities: Record<string, unknown> | undefined
): StudioConnectionBinding['capabilities'] => {
  if (adapterId === 'weprompt-image-v1') {
    const maximum = capabilities?.maxConditioningImages;
    return {
      mediaKinds: ['image'],
      supportsFirstFrame: !isImagesApiModel(model),
      maxConditioningImages: !isImagesApiModel(model) && isIntegerInRange(maximum, 0, 6) ? maximum : 0,
      cancellationPolicy: 'none',
    };
  }
  if (adapterId === 'byteplus-seedance-v1') {
    const constraints =
      model === 'seedance-1-0-pro-250528'
        ? {
            minDurationSeconds: 2,
            maxDurationSeconds: 12,
            resolutions: ['720p' as const, '1080p' as const],
            aspectRatios: ['16:9' as const, '9:16' as const, '1:1' as const, '4:3' as const, '3:4' as const],
          }
        : model === 'seedance-1-5-pro-251215'
          ? {
              minDurationSeconds: 4,
              maxDurationSeconds: 12,
              resolutions: ['720p' as const, '1080p' as const],
              aspectRatios: ['16:9' as const, '9:16' as const, '1:1' as const, '4:3' as const, '3:4' as const],
            }
          : {
              minDurationSeconds: 4,
              maxDurationSeconds: 15,
              resolutions: ['720p' as const, '1080p' as const],
              aspectRatios: ['16:9' as const, '9:16' as const, '1:1' as const, '4:3' as const, '3:4' as const],
            };
    return {
      mediaKinds: ['video'],
      audioModes: ['none'],
      supportsFirstFrame: true,
      maxConditioningImages: 0,
      cancellationPolicy: 'queued_only',
      ...constraints,
    };
  }
  const aspectRatios = Array.isArray(capabilities?.aspectRatios)
    ? capabilities.aspectRatios.filter(
        (value): value is StudioConnectionBinding['capabilities']['aspectRatios'][number] =>
          typeof value === 'string' && ASPECT_RATIOS.has(value)
      )
    : undefined;
  const resolutions = Array.isArray(capabilities?.resolutions)
    ? capabilities.resolutions.filter(
        (value): value is StudioConnectionBinding['capabilities']['resolutions'][number] =>
          typeof value === 'string' && RESOLUTIONS.has(value)
      )
    : undefined;
  const minimum = capabilities?.minDurationSeconds;
  const maximum = capabilities?.maxDurationSeconds;
  return {
    mediaKinds: ['video'],
    audioModes: ['none'],
    ...(aspectRatios && aspectRatios.length > 0 ? { aspectRatios } : {}),
    ...(resolutions && resolutions.length > 0 ? { resolutions } : {}),
    ...(isIntegerInRange(minimum, 1, 60) ? { minDurationSeconds: minimum } : {}),
    ...(isIntegerInRange(maximum, 1, 60) ? { maxDurationSeconds: maximum } : {}),
    supportsFirstFrame: capabilities?.supportsFirstFrame === true,
    maxConditioningImages: 0,
    cancellationPolicy:
      capabilities?.cancellationPolicy === 'queued_only' || capabilities?.cancellationPolicy === 'queued_and_running'
        ? capabilities.cancellationPolicy
        : 'none',
  };
};

const integrationForId = (integrationId: string) =>
  MEDIA_INTEGRATIONS.find((integration) => integration.integrationId === integrationId);

const integrationForAdapter = (adapterId: StudioConnectionBinding['adapterId']) =>
  MEDIA_INTEGRATIONS.find((integration) => integration.adapterId === adapterId);

const toConnectionRecord = (binding: StudioConnectionBinding): StudioConnectionRecord => {
  const integration = integrationForAdapter(binding.adapterId);
  if (integration === undefined) {
    throw new CreativeStudioStoreError('storage_error', 'Unknown Studio connection integration');
  }
  const {
    cancellationPolicy: _cancellationPolicy,
    cancellation: _legacyCancellation,
    ...capabilities
  } = sanitizedCapabilities(binding.adapterId, binding.model, binding.capabilities);
  return {
    bindingId: binding.id,
    providerId: binding.providerId,
    integrationId: integration.integrationId,
    labelKey: integration.labelKey,
    model: binding.model,
    capabilities,
    validatedAt: binding.validatedAt,
  };
};

const toConnectionValidation = (binding: StudioConnectionBinding): StudioConnectionValidationResult => {
  const { bindingId: _bindingId, ...validation } = toConnectionRecord(binding);
  return validation;
};

const assertJobRequest = (input: StudioJobRequest): void => {
  assertSafeId(input.projectId, 'project id');
  assertSafeId(input.jobId, 'job id');
  assertRevision(input.expectedRevision);
};

const decodeCapturedPoster = (value: unknown): Buffer => {
  if (typeof value !== 'string' || !value.startsWith(CAPTURED_POSTER_DATA_URL_PREFIX)) {
    throw invalid('Invalid Studio captured poster');
  }
  const encoded = value.slice(CAPTURED_POSTER_DATA_URL_PREFIX.length);
  if (
    encoded.length < 4 ||
    encoded.length > CAPTURED_POSTER_MAX_BASE64_LENGTH ||
    encoded.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  ) {
    throw invalid('Invalid Studio captured poster');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length === 0 || bytes.length > CAPTURED_POSTER_MAX_BYTES || bytes.toString('base64') !== encoded) {
    throw invalid('Invalid Studio captured poster');
  }
  return bytes;
};

const isDenseArray = (value: unknown, maximum: number): value is unknown[] => {
  if (!Array.isArray(value) || value.length > maximum) return false;
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return Reflect.ownKeys(value).every(
    (key) =>
      key === 'length' || (typeof key === 'string' && /^(0|[1-9][0-9]*)$/.test(key) && Number(key) < value.length)
  );
};

const ownValue = <Value>(record: Record<string, Value>, id: string): Value | undefined =>
  Object.hasOwn(record, id) ? record[id] : undefined;

const isBinnedTakeV2 = (project: StudioProjectV2, assetId: string): boolean =>
  project.bin.some((item) => item.kind === 'take' && item.assetId === assetId);

const ownedShotAssetV2 = (project: StudioProjectV2, shot: StudioShot, assetId: string): StudioAssetV2 | null => {
  const asset = ownValue(project.assets, assetId);
  return asset?.id === assetId &&
    asset.projectId === project.id &&
    asset.shotId === shot.id &&
    shot.assetIds.includes(assetId)
    ? asset
    : null;
};

const canonicalVideoPosterAssetV2 = (
  project: StudioProjectV2,
  shot: StudioShot,
  selectedTake: StudioAssetV2
): StudioAssetV2 | null => {
  const producingJobs = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId &&
      job.projectId === project.id &&
      job.shotId === shot.id &&
      job.status === 'succeeded' &&
      job.purpose === 'video_take' &&
      job.outputAssetIdsByRole.primary === selectedTake.id &&
      job.outputAssetIds.filter((assetId) => assetId === selectedTake.id).length === 1
      ? [job]
      : [];
  });
  if (producingJobs.length !== 1) return null;
  const posterId = producingJobs[0]!.outputAssetIdsByRole.poster;
  if (posterId === null || producingJobs[0]!.outputAssetIds.filter((assetId) => assetId === posterId).length !== 1) {
    return null;
  }
  const poster = ownedShotAssetV2(project, shot, posterId);
  return poster !== null && poster.mediaKind === 'image' && poster.managedAsset.collection === 'thumbnails'
    ? poster
    : null;
};

const eligibleSeedAssetV2 = (project: StudioProjectV2, shot: StudioShot, assetId: string): StudioAssetV2 | null => {
  const asset = ownedShotAssetV2(project, shot, assetId);
  return asset !== null &&
    asset.mediaKind === 'image' &&
    (asset.managedAsset.collection === 'assets' || asset.managedAsset.collection === 'imports') &&
    asset.briefReferenceRole === undefined &&
    asset.briefReferenceLabel === undefined &&
    !isBinnedTakeV2(project, asset.id)
    ? asset
    : null;
};

const canonicalCutCoverAssetV2 = (project: StudioProjectV2, shotId: string): StudioAssetV2 | null => {
  let activeShot: StudioShot | null = null;
  let segmentHead = false;
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    const shotIndex = beat.shotOrder.indexOf(shotId);
    if (shotIndex < 0) continue;
    activeShot = ownValue(project.shots, shotId) ?? null;
    segmentHead = shotIndex === 0 || activeShot?.chainBreak === 'hard_cut';
    break;
  }
  if (activeShot === null) return null;

  if (activeShot.selectedTakeId !== null && !isBinnedTakeV2(project, activeShot.selectedTakeId)) {
    const selected = ownedShotAssetV2(project, activeShot, activeShot.selectedTakeId);
    if (
      selected !== null &&
      selected.mediaKind === 'video' &&
      isCanonicalStudioGeneratedTakeV2(selected, project.id, activeShot)
    ) {
      const poster = canonicalVideoPosterAssetV2(project, activeShot, selected);
      if (poster !== null) return poster;
    }
  }
  if (!segmentHead) return null;
  if (activeShot.seedStillId !== null) {
    const explicit = eligibleSeedAssetV2(project, activeShot, activeShot.seedStillId);
    if (explicit !== null) return explicit;
  }
  const candidates = activeShot.assetIds.flatMap((assetId) => {
    const candidate = eligibleSeedAssetV2(project, activeShot!, assetId);
    return candidate === null ? [] : [candidate];
  });
  candidates.sort((left, right) =>
    left.createdAt === right.createdAt
      ? left.id < right.id
        ? 1
        : left.id > right.id
          ? -1
          : 0
      : left.createdAt < right.createdAt
        ? 1
        : -1
  );
  return candidates[0] ?? null;
};

const composeStudioScriptV2 = (project: StudioProjectV2): Uint8Array => {
  const lines: string[] = [`# ${project.name}`, '', project.brief, ''];
  project.beatOrder.forEach((beatId, beatIndex) => {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) return;
    lines.push(`## Beat ${beatIndex + 1}: ${beat.title}`, '', `Action: ${beat.action}`, `Look: ${beat.look}`, '');
    beat.shotOrder.forEach((shotId, shotIndex) => {
      const shot = ownValue(project.shots, shotId);
      if (shot === undefined) return;
      lines.push(`### Shot ${shotIndex + 1}`, '', shot.line);
      if (shot.narration.length > 0) lines.push('', `Narration: ${shot.narration}`);
      if (shot.onScreenText.length > 0) lines.push('', `On-screen text: ${shot.onScreenText}`);
      lines.push('');
    });
  });
  return Buffer.from(lines.join('\n').replace(/\r\n?/gu, '\n').replace(/\n+$/u, '\n'), 'utf8');
};

const defineOwn = <Value>(record: Record<string, Value>, id: string, value: Value): void => {
  Object.defineProperty(record, id, { value, configurable: true, enumerable: true, writable: true });
};

const toMediaChoice = (provider: StudioProviderRef, kind: StudioMediaKind): StudioMediaChoiceRef => ({
  choiceId: createStudioMediaChoiceId({ ...provider, kind }),
  providerId: provider.providerId,
  model: provider.model,
});

const toRendererRoute = (route: StudioGenerationRoute): StudioRouteCatalogEntry => ({
  choiceId: route.choiceId,
  providerId: route.providerId,
  providerName: route.providerName,
  model: route.model,
  integrationLabelKey: ROUTE_INTEGRATION_LABELS[route.adapterId],
  health: route.health,
  kind: route.kind,
  constraints: {
    aspectRatios: [...route.constraints.aspectRatios],
    resolutions: [...route.constraints.resolutions],
    minDurationSeconds: route.constraints.minDurationSeconds,
    maxDurationSeconds: route.constraints.maxDurationSeconds,
    supportsFirstFrame: route.constraints.supportsFirstFrame,
    maxConditioningImages: route.constraints.maxConditioningImages,
    silentOutput: route.constraints.silentOutput,
  },
});

const routeMatchesSelection = (route: StudioGenerationRoute, selection: string): boolean =>
  route.choiceId === selection;

const routeSupportsProject = (route: StudioGenerationRoute, project: StudioProjectV2 | null): boolean =>
  route.health !== 'unavailable' &&
  (route.constraints.silentOutput || route.adapterId === 'openrouter-video-v1') &&
  (project === null ||
    (route.constraints.aspectRatios.includes(project.aspectRatio) &&
      route.constraints.resolutions.includes(project.resolution)));

const modelStatus = (
  selected: string | null,
  optionsLength: number,
  selectionIsAvailable: boolean
): StudioModelAvailability =>
  selected !== null
    ? selectionIsAvailable
      ? 'ready'
      : 'unavailable'
    : optionsLength === 0
      ? 'setup_required'
      : 'selection_required';

const selectedRoute = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2 | null,
  kind: StudioMediaKind,
  selection: string | null
): StudioGenerationRoute | null => {
  if (selection === null) return null;
  return (
    generation.routes.find(
      (route) => route.kind === kind && routeMatchesSelection(route, selection) && routeSupportsProject(route, project)
    ) ?? null
  );
};

const selectionIssue = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2 | null,
  kind: StudioMediaKind,
  selection: string | null,
  selected: StudioGenerationRoute | null
): StudioMediaRouteCatalog['selectionIssue'] => {
  if (selection === null || selected !== null) return null;
  const matching = generation.routes.find((route) => route.kind === kind && routeMatchesSelection(route, selection));
  if (
    matching !== undefined &&
    project !== null &&
    (!matching.constraints.aspectRatios.includes(project.aspectRatio) ||
      !matching.constraints.resolutions.includes(project.resolution))
  ) {
    return { code: 'frame', aspectRatio: project.aspectRatio, resolution: project.resolution };
  }
  const diagnostic = generation.diagnostics.find(
    (candidate) =>
      candidate.status !== 'available' &&
      createStudioMediaChoiceId({
        providerId: candidate.providerId,
        adapterId: candidate.adapterId,
        model: candidate.model,
        kind,
      }) === selection
  );
  if (diagnostic?.status === 'needs_setup') {
    return { code: 'needs_setup', providerName: diagnostic.providerName };
  }
  if (diagnostic?.status === 'health') return { code: 'health' };
  return { code: 'retired' };
};

const toRouteCatalog = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2 | null
): StudioRouteCatalogV2 => {
  const catalogFor = (kind: StudioMediaKind): StudioMediaRouteCatalog => {
    const selection = project === null ? null : kind === 'image' ? project.imageRouteId : project.videoRouteId;
    const routes = generation.routes.filter((route) => route.kind === kind && routeSupportsProject(route, project));
    const chosen = selectedRoute(generation, project, kind, selection);
    return {
      status: modelStatus(selection, routes.length, chosen !== null),
      selected: chosen === null ? null : toMediaChoice(chosen, kind),
      selectedRoute: chosen === null ? null : toRendererRoute(chosen),
      selectionIssue: selectionIssue(generation, project, kind, selection, chosen),
      options: routes.map(toRendererRoute),
    };
  };
  return {
    image: catalogFor('image'),
    video: catalogFor('video'),
    catalogVersion: generation.generationCatalogVersion,
  };
};

const quotedItems = (
  quote: Pick<StudioSubmissionQuoteCore, 'baseItems' | 'cascadeItems'>
): StudioQuotedGeneration[] => [...quote.baseItems, ...quote.cascadeItems];

const assertReferenceHandoffProjectCurrent = (
  project: StudioProjectV2,
  request: StudioPrepareSubmissionRequestV2 & { originReferenceHandoffId: string }
): void => {
  if (project.id !== request.projectId || project.revision !== request.expectedRevision) {
    throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
  }
  if (
    project.spendAuthorizations.some(
      (authorization) => authorization.originReferenceHandoffId === request.originReferenceHandoffId
    )
  ) {
    throw invalid('Studio reference handoff is already authorized');
  }
  const locations = new Map<string, number>();
  let filmIndex = 0;
  for (const beatId of project.beatOrder) {
    const beat = project.beats[beatId];
    if (beat === undefined) throw invalid('Invalid Studio reference handoff project');
    for (const shotId of beat.shotOrder) {
      if (project.shots[shotId] === undefined || locations.has(shotId)) {
        throw invalid('Invalid Studio reference handoff project');
      }
      locations.set(shotId, filmIndex);
      filmIndex += 1;
    }
  }
  let previousPosition = -1;
  for (const choice of request.baseChoices) {
    const position = locations.get(choice.shotId);
    if (position === undefined || position <= previousPosition) {
      throw invalid('Invalid Studio reference handoff shot order');
    }
    previousPosition = position;
  }
};

const quotedDuration = (item: StudioQuotedGeneration): number =>
  item.requestPlan.kind === 'resolved'
    ? item.requestPlan.snapshot.durationSeconds
    : item.requestPlan.template.durationSeconds;

const resolveQuotedRoute = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2,
  item: StudioQuotedGeneration
): StudioGenerationRoute => {
  const kind: StudioMediaKind = item.purpose === 'seed_still' ? 'image' : 'video';
  const matches = generation.routes.filter((route) => route.choiceId === item.routeId && route.kind === kind);
  const route = matches.length === 1 ? matches[0]! : null;
  const durationSeconds = quotedDuration(item);
  const referenceInput =
    item.requestPlan.kind === 'resolved'
      ? item.requestPlan.snapshot.referenceInput
      : item.requestPlan.template.referenceInput;
  if (
    route === null ||
    !routeSupportsProject(route, project) ||
    durationSeconds < route.constraints.minDurationSeconds ||
    durationSeconds > route.constraints.maxDurationSeconds ||
    (item.purpose === 'video_take' && !route.constraints.supportsFirstFrame) ||
    (referenceInput !== null && route.constraints.maxConditioningImages < 1)
  ) {
    throw new CreativeStudioServiceError('invalid_route');
  }
  return route;
};

const resolveProviderBindings = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2,
  quote: Pick<StudioSubmissionQuoteCore, 'baseItems' | 'cascadeItems'>
): StudioSpendAuthorization['providerBindings'] =>
  quotedItems(quote).map((item) => {
    const route = resolveQuotedRoute(generation, project, item);
    return {
      itemId: item.id,
      provider: { providerId: route.providerId, adapterId: route.adapterId, model: route.model },
    };
  });

const resolveQuoteAuthority = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2,
  quote: Pick<StudioSubmissionQuoteCore, 'baseItems' | 'cascadeItems'>
): Pick<StudioSpendAuthorization, 'providerBindings'> & {
  cancellationPolicies: Array<{ itemId: string; policy: StudioCancellationPolicy }>;
} => ({
  providerBindings: resolveProviderBindings(generation, project, quote),
  cancellationPolicies: quotedItems(quote).map((item) => ({
    itemId: item.id,
    policy: resolveQuotedRoute(generation, project, item).cancellationPolicy,
  })),
});

const rendererRouteLookup =
  (
    generation: StudioGenerationRouteCatalog,
    project: StudioProjectV2
  ): ((routeId: string, purpose: StudioQuotedGeneration['purpose']) => StudioMediaChoiceRef) =>
  (routeId, purpose) => {
    const kind: StudioMediaKind = purpose === 'seed_still' ? 'image' : 'video';
    const matches = generation.routes.filter((route) => route.choiceId === routeId && route.kind === kind);
    const route = matches.length === 1 ? matches[0]! : null;
    if (route === null || !routeSupportsProject(route, project)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    return toMediaChoice(route, kind);
  };

const requestedKind = (job: StudioJobV2): StudioMediaKind => (job.purpose === 'seed_still' ? 'image' : 'video');

const toRendererSpendReceipt = (job: StudioJobV2): StudioRendererJobV2['spendReceipt'] => {
  const receipt = job.spendReceipt;
  if (receipt === null) return null;
  return {
    purpose: receipt.purpose,
    routeId: receipt.routeId,
    currency: receipt.currency,
    rateUnit: receipt.rateUnit,
    rateMinorUnits: receipt.rateMinorUnits,
    durationSeconds: receipt.durationSeconds,
    generationIndex: receipt.generationIndex,
    generationCount: receipt.generationCount,
    totalMinorUnits: receipt.totalMinorUnits,
  };
};

const toRendererJob = (job: StudioJobV2): StudioRendererJobV2 => ({
  id: job.id,
  projectId: job.projectId,
  shotId: job.shotId,
  status: job.status,
  purpose: job.purpose,
  generationIndex: job.generationIndex,
  provider: toMediaChoice(job.provider, requestedKind(job)),
  outputAssetIds: [...job.outputAssetIds],
  outputAssetIdsByRole: { ...job.outputAssetIdsByRole },
  error: job.error === null ? null : { ...job.error },
  canCancel: canCancelJobV2(job),
  canRetryDownload: job.status === 'failed' && job.error?.code === 'download_failed' && job.providerJobId !== null,
  ...(job.progress === undefined ? {} : { progress: job.progress }),
  retryOfJobId: job.retryOfJobId,
  retryReason: job.retryReason,
  duplicateChargeAcknowledged: job.duplicateChargeAcknowledged,
  duplicateChargeAcknowledgedAt: job.duplicateChargeAcknowledgedAt,
  spendReceipt: toRendererSpendReceipt(job),
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const toRendererProject = (project: StudioProjectV2): StudioRendererProjectV2 => {
  const {
    spendAuthorizations: _authorizations,
    frameExtractions: _frames,
    undoHistory: _undo,
    jobs: _jobs,
    ...safe
  } = structuredClone(project);
  return {
    ...safe,
    jobs: Object.fromEntries(Object.entries(project.jobs).map(([jobId, job]) => [jobId, toRendererJob(job)])),
  };
};

const toRendererProjectCommitResult = (project: StudioProjectV2): StudioRendererProjectCommitResultV2 => ({
  projectId: project.id,
  projectRevision: project.revision,
  createdBeatIds: [],
  createdShotIds: [],
});

/** Projects one validated generation-gate decision without its durable authorization correlation. */
export const projectStudioReferenceGenerationHandoffV2 = (
  decision: StudioReferenceRequestDecisionV2,
  receipt: StudioReferenceGenerationHandoffReceiptV2 | null
): StudioRendererReferenceGenerationHandoffV2 | null => {
  if (decision.outcome.kind !== 'generation_gate') {
    if (receipt !== null) {
      throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt has no generation gate');
    }
    return null;
  }
  if (
    receipt !== null &&
    (receipt.handoffId !== decision.outcome.handoffId || receipt.requestId !== decision.requestId)
  ) {
    throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff receipt authority mismatch');
  }
  return {
    handoffId: decision.outcome.handoffId,
    requestId: decision.requestId,
    shotIds: [...decision.outcome.shotIds],
    decidedAt: decision.decidedAt,
    status: receipt === null ? 'open' : receipt.result.kind,
    completedAt: receipt?.completedAt ?? null,
  };
};

const supportedProject = (result: StudioProjectStoreLoadResultV2): StudioProjectV2 => {
  if (result.status === 'supported') return result.project;
  if (result.status === 'unsupported_prototype_schema') {
    throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
  }
  throw new CreativeStudioStoreError('not_found', 'Studio project not found');
};

const shotDurationIsValid = (shot: StudioProjectV2['shots'][string]): boolean =>
  Number.isInteger(shot.durationSeconds) &&
  shot.durationSeconds >= STUDIO_MIN_SHOT_SECONDS &&
  shot.durationSeconds <= STUDIO_MAX_SHOT_SECONDS;

const readinessForShot = (
  project: StudioProjectV2,
  beatId: string,
  shotId: string
): StudioShotGenerationReadinessV2 => {
  const beat = ownValue(project.beats, beatId)!;
  const shot = ownValue(project.shots, shotId)!;
  const issues: StudioShotReadinessIssueV2[] = [];
  if (beat.title.trim().length === 0) issues.push('missing_beat_title');
  if (beat.look.trim().length === 0) issues.push('missing_look');
  if (shot.line.trim().length === 0) issues.push('missing_line');
  if (!shotDurationIsValid(shot)) issues.push('invalid_shot_duration');
  const jobs = shot.jobIds.flatMap((jobId) => {
    const job = ownValue(project.jobs, jobId);
    return job?.id === jobId && job.projectId === project.id && job.shotId === shot.id ? [job] : [];
  });
  if (jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status))) issues.push('active_job');
  if (
    shot.assetIds.some((assetId) => {
      const asset = ownValue(project.assets, assetId);
      return asset !== undefined && isCanonicalStudioGeneratedTakeV2(asset, project.id, shot);
    })
  ) {
    issues.push('generated_take_exists');
  }
  const latest = jobs.at(-1);
  if (latest?.status === 'failed' || latest?.status === 'needs_attention') issues.push('latest_job_failed');
  return { shotId, beatId, ready: issues.length === 0, issues };
};

export const derivePayableShotIds = (project: StudioProjectV2, selectedBeatIds: readonly string[]): string[] => {
  const selected = new Set(selectedBeatIds);
  const payable: string[] = [];
  const seen = new Set<string>();
  for (let beatIndex = 0; beatIndex < project.beatOrder.length; beatIndex += 1) {
    const beatId = project.beatOrder[beatIndex]!;
    if (!selected.has(beatId)) continue;
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shotId = beat.shotOrder[shotIndex]!;
      if (!seen.has(shotId) && readinessForShot(project, beatId, shotId).ready) {
        seen.add(shotId);
        payable.push(shotId);
      }
    }
  }
  return payable;
};

const orderedReadiness = (
  project: StudioProjectV2,
  selectedBeatIds: readonly string[]
): StudioShotGenerationReadinessV2[] => {
  const selected = new Set(selectedBeatIds);
  const result: StudioShotGenerationReadinessV2[] = [];
  for (let beatIndex = 0; beatIndex < project.beatOrder.length; beatIndex += 1) {
    const beatId = project.beatOrder[beatIndex]!;
    if (!selected.has(beatId)) continue;
    const beat = ownValue(project.beats, beatId)!;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      result.push(readinessForShot(project, beatId, beat.shotOrder[shotIndex]!));
    }
  }
  return result;
};

const assertBeatSelection: (project: StudioProjectV2, beatIds: unknown) => asserts beatIds is string[] = (
  project,
  beatIds
) => {
  if (!isDenseArray(beatIds, STUDIO_MAX_BEATS)) throw invalid('Invalid Studio beat selection');
  const active = new Set(project.beatOrder);
  const seen = new Set<string>();
  for (let index = 0; index < beatIds.length; index += 1) {
    const beatId = beatIds[index];
    if (!isSafeId(beatId) || !active.has(beatId) || seen.has(beatId)) {
      throw invalid('Invalid Studio beat selection');
    }
    seen.add(beatId);
  }
};

/** Creates the sole registered Beat/Shot service after the atomic schema-2 cutover. */
export const createCreativeStudioServiceV2 = (deps: CreativeStudioServiceV2Deps): CreativeStudioServiceV2 => {
  const readNow = (): Date => {
    const value = deps.now?.() ?? new Date();
    const timestamp = value instanceof Date ? value.getTime() : Number.NaN;
    if (!Number.isSafeInteger(timestamp)) throw invalid('Invalid Studio service clock');
    return new Date(timestamp);
  };
  const preparedSubmissionCache =
    deps.preparedSubmissionCache ?? new StudioPreparedSubmissionCacheV2({ now: () => readNow().getTime() });
  const createQuoteId = deps.createQuoteId ?? (() => defaultId('quote'));
  const createJobId = deps.createJobId ?? (() => defaultId('job'));
  const createIdempotencyKey = deps.createIdempotencyKey ?? (() => defaultId('key'));
  const createExportId = deps.createExportId ?? (() => defaultId('export'));
  const createConnectionId = deps.createConnectionId ?? randomUUID;
  const exportCatalogStore = deps.exportCatalogStore ?? createStudioExportCatalogStoreV2();
  const activeClaims = new Set<StudioPreparedSubmissionClaimV2>();
  let disposed = false;

  const cacheFailure = (code: 'quote_not_found'): StudioPreparedSubmissionCacheErrorV2 =>
    new StudioPreparedSubmissionCacheErrorV2(code);
  const assertServiceActive = (claim?: StudioPreparedSubmissionClaimV2): void => {
    if (disposed || (claim !== undefined && !activeClaims.has(claim))) throw cacheFailure('quote_not_found');
  };
  const loadRateCard = async (generation: StudioGenerationRouteCatalog): Promise<StudioRateCardV2> => {
    if (deps.rateCard === undefined) throw new CreativeStudioServiceError('provider_error');
    try {
      return await deps.rateCard(generation);
    } catch (error) {
      return rethrowPricingFailure(error);
    }
  };
  const loadSupported = async (projectId: string): Promise<StudioProjectV2> =>
    supportedProject(await deps.store.getProjectV2(projectId));
  const notify = (project: StudioProjectV2): StudioRendererProjectV2 => {
    deps.onProjectUpdated(project.id);
    return toRendererProject(project);
  };
  const listGenerationRoutes = async (): Promise<StudioGenerationRouteCatalog> => {
    try {
      return await deps.providerResolver.listGenerationRoutes();
    } catch {
      throw new CreativeStudioServiceError('provider_error');
    }
  };
  const rethrowExportFailure = (error: unknown): never => {
    if (error instanceof StudioExportCatalogErrorV2) {
      if (error.code === 'stale_catalog_revision' || error.code === 'stale_project_revision') {
        throw new CreativeStudioStoreError('stale_project', 'Studio export authority has changed');
      }
      if (error.code === 'invalid_create_plan' || error.code === 'artifact_not_found') {
        throw invalid('Invalid Studio export request');
      }
      throw new CreativeStudioStoreError('storage_error', 'Studio export storage is unavailable');
    }
    if (error instanceof StudioEditorFolderErrorV2) {
      throw invalid(`Invalid Studio editor-folder export: ${error.code}`);
    }
    throw error;
  };
  const assertGeneralServiceActive = (): void => {
    if (disposed) throw new CreativeStudioStoreError('busy', 'Creative Studio service is closed');
  };
  const resolveExportAsset = async (authority: StudioProjectAuthoritySnapshotV2, assetId: string) => {
    if (deps.mediaStore === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
    }
    const project = authority.project;
    const resolved = await deps.mediaStore.resolveAssetWithProjectAuthorityV2(authority, assetId);
    const canonical = ownValue(project.assets, assetId);
    if (
      resolved === null ||
      canonical === undefined ||
      resolved.asset.id !== canonical.id ||
      resolved.asset.projectId !== canonical.projectId ||
      resolved.asset.byteSize !== canonical.byteSize ||
      resolved.asset.sha256 !== canonical.sha256 ||
      resolved.asset.managedAsset.collection !== canonical.managedAsset.collection ||
      resolved.asset.managedAsset.fileName !== canonical.managedAsset.fileName
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Studio export media is unavailable');
    }
    return {
      asset: canonical,
      openVerifiedStream: async (): Promise<AsyncIterable<Uint8Array>> => resolved.openVerifiedStream(),
    };
  };
  const exportAssetExtension = (asset: StudioAssetV2): string => {
    const separator = asset.managedAsset.fileName.lastIndexOf('.');
    const extension = separator < 0 ? '' : asset.managedAsset.fileName.slice(separator + 1).toLowerCase();
    if (!/^[a-z0-9]{1,16}$/.test(extension)) throw invalid('Invalid Studio export media extension');
    return extension;
  };
  const buildExportPayload = async (
    authority: StudioProjectAuthoritySnapshotV2,
    input: StudioCreateExportRequestV2
  ): Promise<StudioExportPayloadFilePlanV2[]> => {
    const project = authority.project;
    if (input.shape === 'script') {
      return [{ kind: 'generated', relativePath: 'script.md', bytes: composeStudioScriptV2(project) }];
    }
    if (input.shape === 'still') {
      const cover = canonicalCutCoverAssetV2(project, input.shotId);
      if (cover === null) throw invalid('Studio still export has no canonical cover');
      const resolved = await resolveExportAsset(authority, cover.id);
      return [
        {
          kind: 'verified_stream',
          relativePath: `still.${exportAssetExtension(cover)}`,
          byteSize: cover.byteSize,
          sha256: cover.sha256,
          openVerifiedStream: resolved.openVerifiedStream,
        },
      ];
    }

    const requiredAssetIds: string[] = [];
    for (const beatId of project.beatOrder) {
      const beat = ownValue(project.beats, beatId);
      if (beat === undefined) throw invalid('Studio export Beat is missing');
      for (const shotId of beat.shotOrder) {
        const shot = ownValue(project.shots, shotId);
        if (shot === undefined || shot.selectedTakeId === null) continue;
        requiredAssetIds.push(shot.selectedTakeId);
      }
    }
    if (project.bedAssetId !== null) requiredAssetIds.push(project.bedAssetId);
    const resolvedById = new Map<string, Awaited<ReturnType<typeof resolveExportAsset>>>();
    for (const assetId of requiredAssetIds) {
      if (resolvedById.has(assetId)) continue;
      // eslint-disable-next-line no-await-in-loop -- every canonical media inode is re-proved before composition.
      resolvedById.set(assetId, await resolveExportAsset(authority, assetId));
    }
    const composition = composeStudioEditorFolderV2(
      project,
      [...resolvedById.values()].map(({ asset }) => ({
        assetId: asset.id,
        byteSize: asset.byteSize,
        sha256: asset.sha256,
      }))
    );
    return composition.files.map((file): StudioExportPayloadFilePlanV2 => {
      if (file.kind === 'generated') {
        return { kind: 'generated', relativePath: file.relativePath, bytes: Uint8Array.from(file.bytes) };
      }
      const resolved = resolvedById.get(file.assetId);
      if (resolved === undefined) throw new CreativeStudioStoreError('storage_error', 'Studio export media changed');
      return {
        kind: 'verified_stream',
        relativePath: file.relativePath,
        byteSize: file.byteSize,
        sha256: file.sha256,
        openVerifiedStream: resolved.openVerifiedStream,
      };
    });
  };

  const validateConnectionBinding = async (
    input: StudioValidateConnectionRequest
  ): Promise<StudioConnectionBinding> => {
    if (!isRecord(input) || !hasExactKeys(input, ['providerId', 'integrationId', 'model'])) {
      throw invalid('Invalid Studio connection request');
    }
    assertSafeId(input.providerId, 'provider id');
    assertSafeId(input.integrationId, 'integration id');
    assertConnectionModel(input.model);
    const integration = integrationForId(input.integrationId);
    if (integration === undefined) throw invalid('Invalid Studio integration');
    if (deps.listProviders === undefined || deps.getAdapterRegistry === undefined) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    let providers: IProvider[];
    try {
      providers = await deps.listProviders();
    } catch {
      throw new CreativeStudioServiceError('provider_error');
    }
    const provider = providers.find((candidate) => candidate.id === input.providerId);
    if (provider === undefined || !providerIsAvailable(provider, input.model)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    const adapter = deps.getAdapterRegistry().get(integration.adapterId);
    if (adapter === undefined) throw new CreativeStudioServiceError('invalid_route');
    let validation;
    try {
      validation = await runWithProviderDeadline(
        new AbortController().signal,
        CONNECTION_VALIDATION_TIMEOUT_MS,
        (signal) => adapter.validateConnection({ model: input.model }, provider, signal)
      );
    } catch (error) {
      if (error instanceof ProviderDeadlineError) throw new CreativeStudioServiceError('provider_error');
      throw error;
    }
    if (!validation.ok) throw new CreativeStudioServiceError('provider_error');
    return {
      schemaVersion: 1,
      id: 'validation_only',
      providerId: provider.id,
      adapterId: adapter.id,
      model: input.model,
      capabilities: sanitizedCapabilities(adapter.id, input.model, validation.capabilities),
      validatedAt: readNow().toISOString(),
    };
  };

  const createQuote = (core: StudioSubmissionQuoteCore, id: string): StudioSubmissionQuote => {
    if (!isSafeId(id)) throw invalid('Invalid Studio quote identity');
    return { ...structuredClone(core), id, expiresAt: '1970-01-01T00:00:00.000Z' };
  };

  const projectPreparedOptions = (
    project: StudioProjectV2,
    generation: StudioGenerationRouteCatalog,
    options: { baseOnly: StudioSubmissionQuote; withCascade: StudioSubmissionQuote | null }
  ): StudioRendererPreparedSubmissionOptionsV2 => {
    const lookup = rendererRouteLookup(generation, project);
    return {
      baseOnly: toStudioRendererSubmissionQuoteV2(options.baseOnly, project.spendPolicy, lookup),
      withCascade:
        options.withCascade === null
          ? null
          : toStudioRendererSubmissionQuoteV2(options.withCascade, project.spendPolicy, lookup),
    };
  };

  const exactSelectedBindings = (
    claim: StudioPreparedSubmissionClaimV2
  ): StudioSpendAuthorization['providerBindings'] => {
    const byItem = new Map(claim.session.providerBindings.map((binding) => [binding.itemId, binding]));
    return quotedItems(claim.quote).map((item) => {
      const binding = byItem.get(item.id);
      if (binding === undefined) throw invalid('Invalid cached Studio provider binding');
      return { itemId: binding.itemId, provider: { ...binding.provider } };
    });
  };

  const exactSelectedCancellationPolicies = (
    claim: StudioPreparedSubmissionClaimV2
  ): Array<{ itemId: string; policy: StudioCancellationPolicy }> => {
    const byItem = new Map(claim.session.cancellationPolicies.map((binding) => [binding.itemId, binding]));
    return quotedItems(claim.quote).map((item) => {
      const binding = byItem.get(item.id);
      if (binding === undefined) throw invalid('Invalid cached Studio cancellation policy');
      return { itemId: binding.itemId, policy: binding.policy };
    });
  };

  type ConfirmationRevalidation = {
    quote: StudioSubmissionQuote;
    providerBindings: StudioSpendAuthorization['providerBindings'];
    cancellationPolicies: Array<{ itemId: string; policy: StudioCancellationPolicy }>;
  };

  const buildConfirmedProject = (
    project: StudioProjectV2,
    revalidation: ConfirmationRevalidation,
    confirmedAt: string
  ): { project: StudioProjectV2; dispatch: StudioDispatchAuthorizedJobsRequestV2 } => {
    const quote = structuredClone(revalidation.quote);
    if (
      quote.projectId !== project.id ||
      quote.projectRevision !== project.revision ||
      project.spendAuthorizations.some((authorization) => authorization.id === quote.id)
    ) {
      throw invalid('Invalid or duplicate Studio authorization');
    }
    const items = quotedItems(quote);
    const policies = new Map(revalidation.cancellationPolicies.map((entry) => [entry.itemId, entry.policy]));
    const providerBindings = structuredClone(revalidation.providerBindings);
    const bindingByItem = new Map(providerBindings.map((entry) => [entry.itemId, entry.provider]));
    const existingJobIds = new Set(Object.keys(project.jobs));
    const existingKeys = new Set(
      project.spendAuthorizations.flatMap((authorization) => authorization.idempotencyKeys.map((entry) => entry.key))
    );
    for (const job of Object.values(project.jobs)) existingKeys.add(job.idempotencyKey);
    const idempotencyKeys: StudioSpendAuthorization['idempotencyKeys'] = [];
    const pendingJobs: StudioJobV2[] = [];
    const dispatchJobIds: string[] = [];
    const alreadyRetriedJobIds = new Set(
      Object.values(project.jobs).flatMap((job) => (job.retryOfJobId === null ? [] : [job.retryOfJobId]))
    );

    for (const item of items) {
      const provider = bindingByItem.get(item.id);
      const cancellationPolicy = policies.get(item.id);
      const shot = ownValue(project.shots, item.shotId);
      if (provider === undefined || cancellationPolicy === undefined || shot === undefined) {
        throw invalid('Invalid Studio confirmation binding');
      }
      const retryPredecessors = [...shot.jobIds].reverse().flatMap((jobId) => {
        const candidate = ownValue(project.jobs, jobId);
        if (
          candidate === undefined ||
          candidate.shotId !== shot.id ||
          candidate.purpose !== item.purpose ||
          candidate.status !== 'failed' ||
          candidate.error === null ||
          candidate.error.code === 'download_failed' ||
          candidate.error.code === 'poll_deadline' ||
          candidate.error.code === 'dependency_failed' ||
          alreadyRetriedJobIds.has(candidate.id)
        ) {
          return [];
        }
        return [candidate];
      });
      for (let generationIndex = 0; generationIndex < item.generationCount; generationIndex += 1) {
        const jobId = createJobId();
        const idempotencyKey = createIdempotencyKey();
        if (
          !isSafeId(jobId) ||
          !isSafeId(idempotencyKey) ||
          existingJobIds.has(jobId) ||
          existingKeys.has(idempotencyKey)
        ) {
          throw invalid('Invalid or duplicate Studio paid-work identity');
        }
        existingJobIds.add(jobId);
        existingKeys.add(idempotencyKey);
        idempotencyKeys.push({ itemId: item.id, generationIndex, key: idempotencyKey });
        const requestSnapshot =
          item.requestPlan.kind === 'resolved' ? structuredClone(item.requestPlan.snapshot) : null;
        const resolved = requestSnapshot !== null;
        const retryPredecessor = retryPredecessors[generationIndex];
        const retryReason =
          retryPredecessor === undefined
            ? null
            : retryPredecessor.error?.code === 'submission_unknown'
              ? 'submission_unknown'
              : 'provider_failure';
        if (retryPredecessor !== undefined) alreadyRetriedJobIds.add(retryPredecessor.id);
        const job: StudioJobV2 = {
          id: jobId,
          projectId: project.id,
          shotId: shot.id,
          status: resolved ? 'queued_local' : 'waiting_for_conditioning',
          provider: { ...provider },
          idempotencyKey,
          providerJobId: null,
          cancellationPolicy,
          outputAssetIds: [],
          purpose: item.purpose,
          authorizationId: quote.id,
          authorizationItemId: item.id,
          generationIndex,
          requestPlan: structuredClone(item.requestPlan),
          requestSnapshot,
          spendReceipt: null,
          outputAssetIdsByRole: { primary: null, poster: null },
          error: null,
          retryOfJobId: retryPredecessor?.id ?? null,
          retryReason,
          duplicateChargeAcknowledged: retryReason === 'submission_unknown',
          duplicateChargeAcknowledgedAt: retryReason === 'submission_unknown' ? confirmedAt : null,
          createdAt: confirmedAt,
          updatedAt: confirmedAt,
        };
        pendingJobs.push(job);
        if (resolved) dispatchJobIds.push(job.id);
      }
    }

    const authorization = createStudioSpendAuthorizationV2({
      quote,
      confirmedAt,
      providerBindings,
      idempotencyKeys,
    });
    project.spendAuthorizations.push(authorization);
    for (const job of pendingJobs) {
      const shot = ownValue(project.shots, job.shotId);
      if (shot === undefined || shot.jobIds.includes(job.id)) throw invalid('Invalid Studio job ownership');
      defineOwn(project.jobs, job.id, job);
      shot.jobIds.push(job.id);
    }
    return { project, dispatch: { projectId: project.id, jobIds: dispatchJobIds } };
  };

  const assertBarrierRequest: (
    input: StudioCascadeBarrierActionRequestV2
  ) => asserts input is StudioCascadeBarrierActionRequestV2 = (input) => {
    if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'dependentShotId'])) {
      throw invalid('Invalid Studio cascade action');
    }
    assertSafeId(input.projectId, 'project id');
    assertSafeId(input.dependentShotId, 'dependent shot id');
    assertRevision(input.expectedRevision);
  };

  const activePredecessorId = (project: StudioProjectV2, dependentShotId: string): string | null => {
    for (const beatId of project.beatOrder) {
      const beat = ownValue(project.beats, beatId);
      const index = beat?.shotOrder.indexOf(dependentShotId) ?? -1;
      if (beat === undefined || index <= 0 || project.shots[dependentShotId]?.chainBreak === 'hard_cut') continue;
      return beat.shotOrder[index - 1] ?? null;
    }
    return null;
  };

  const retryableExtractionId = (project: StudioProjectV2, dependentShotId: string): string => {
    const workspaceRows = projectStudioWorkspaceStatusV2(project).cascadeProgress.filter(
      (row) => row.dependentShotId === dependentShotId && row.canRetryConditioningFrame
    );
    const chainRows = projectStudioChainStatusV2(project).conditioningFailures.filter(
      (row) => row.dependentShotId === dependentShotId && row.canRetry
    );
    if (workspaceRows.length + chainRows.length !== 1) throw invalid('Studio conditioning frame is not retryable');
    const predecessorShotId = workspaceRows[0]?.upstreamShotId ?? activePredecessorId(project, dependentShotId);
    const predecessor = predecessorShotId === null ? undefined : ownValue(project.shots, predecessorShotId);
    const take =
      predecessor?.selectedTakeId === null || predecessor === undefined
        ? undefined
        : ownValue(project.assets, predecessor.selectedTakeId);
    if (
      take === undefined ||
      take.mediaKind !== 'video' ||
      take.durationSeconds === undefined ||
      project.bin.some((item) => item.kind === 'take' && item.assetId === take.id)
    ) {
      throw invalid('Studio conditioning source is unavailable');
    }
    const endpointSeconds = take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
    const extractionId = createStudioFrameExtractionId({
      shotId: predecessor.id,
      takeAssetId: take.id,
      endpointSeconds,
    });
    const extraction = ownValue(project.frameExtractions, extractionId);
    if (
      extraction?.status !== 'failed' ||
      extraction.frameAssetId !== null ||
      extraction.shotId !== predecessor.id ||
      extraction.takeAssetId !== take.id ||
      !Object.is(extraction.endpointSeconds, endpointSeconds)
    ) {
      throw invalid('Studio conditioning frame is not retryable');
    }
    return extractionId;
  };

  const cancelWaitingItem = (project: StudioProjectV2, dependentShotId: string, cancelledAt: string): void => {
    const progress = projectStudioWorkspaceStatusV2(project).cascadeProgress.filter(
      (row) => row.dependentShotId === dependentShotId && row.canCancelWaiting
    );
    if (progress.length !== 1) throw invalid('Studio cascade is not cancellable');
    let target:
      | { authorization: StudioSpendAuthorization; item: StudioQuotedGeneration; itemIndex: number }
      | undefined;
    for (const authorization of project.spendAuthorizations) {
      const items = quotedItems(authorization);
      for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
        const item = items[itemIndex]!;
        if (
          item.shotId === dependentShotId &&
          item.purpose === 'video_take' &&
          item.requestPlan.kind === 'after_take_selection'
        ) {
          target = { authorization, item, itemIndex };
        }
      }
    }
    if (target === undefined) throw invalid('Studio cascade is not cancellable');
    const jobs = Object.values(project.jobs).filter(
      (job) => job.authorizationId === target!.authorization.id && job.authorizationItemId === target!.item.id
    );
    const remaining = jobs.filter((job) => job.status !== 'cancelled');
    if (
      jobs.length !== target.item.generationCount ||
      remaining.length === 0 ||
      remaining.some(
        (job) =>
          job.status !== 'waiting_for_conditioning' ||
          job.requestSnapshot !== null ||
          job.providerJobId !== null ||
          (job.remoteStartedAt !== undefined && job.remoteStartedAt !== null) ||
          job.spendReceipt !== null ||
          job.outputAssetIds.length !== 0 ||
          job.outputAssetIdsByRole.primary !== null ||
          job.outputAssetIdsByRole.poster !== null ||
          job.error !== null ||
          job.progress !== undefined
      )
    ) {
      throw invalid('Studio cascade is not cancellable');
    }
    for (const job of remaining) {
      job.status = 'cancelled';
      job.updatedAt = cancelledAt;
    }
    terminalizeStudioUnboundDependenciesV2(project, cancelledAt);
  };

  const dispatchBoundJobs = async (projectId: string, jobIds: readonly string[]): Promise<void> => {
    if (disposed || jobIds.length === 0) return;
    await deps.jobManager
      .dispatchAuthorizedJobsV2({ projectId, jobIds: [...jobIds] })
      .catch((): undefined => undefined);
  };

  return {
    listProjects: () => deps.store.listProjectsV2(),

    async createProject(input): Promise<StudioRendererProjectV2> {
      return notify(await deps.store.createProjectV2(input));
    },

    async getProject(projectId): Promise<StudioProjectLoadResultV2> {
      const loaded = await deps.store.getProjectV2(projectId);
      return loaded.status === 'supported'
        ? { status: 'supported', project: toRendererProject(loaded.project) }
        : loaded;
    },

    async deleteProject(input): Promise<boolean> {
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      assertGeneralServiceActive();
      let deleted: boolean;
      try {
        deleted = await deps.store.deleteProjectWithSidecarAuthorityV2(
          input.projectId,
          input.expectedRevision,
          (authority) =>
            exportCatalogStore.withManagedMediaAuthority(
              { ...authority, assertActive: assertGeneralServiceActive },
              () => authority.delete(input.expectedRevision, assertGeneralServiceActive)
            )
        );
      } catch (error) {
        if (error instanceof CreativeStudioStoreError && error.code === 'not_found') return false;
        throw error;
      }
      if (deleted) deps.onProjectUpdated(input.projectId);
      return deleted;
    },

    async getBriefSessionServer(input): Promise<ISessionMcpServer> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio project request');
      }
      assertSafeId(input.projectId, 'project id');
      if (deps.getStudioServerScriptPath === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio MCP script path is unavailable');
      }
      const project = await loadSupported(input.projectId);
      await deps.ensureDirectorCommandMailbox?.(input.projectId);
      const [proposalPaths, referencePaths, generation] = await Promise.all([
        deps.store.resolveProposalPathsV2(input.projectId),
        deps.store.resolveReferenceRequestPathsV2(input.projectId),
        listGenerationRoutes(),
      ]);
      if (proposalPaths.projectDir !== referencePaths.projectDir) {
        throw new CreativeStudioStoreError('storage_error', 'Studio sidecar authority mismatch');
      }
      return {
        id: `studio-brief-${input.projectId}`,
        name: BUILTIN_STUDIO_NAME,
        transport: {
          type: 'stdio',
          command: 'node',
          args: [deps.getStudioServerScriptPath()],
          env: {
            [STUDIO_ENV.projectId]: input.projectId,
            [STUDIO_ENV.projectDir]: proposalPaths.projectDir,
            [STUDIO_ENV.pendingDir]: proposalPaths.pendingDir,
            [STUDIO_ENV.referencePendingDir]: referencePaths.pendingDir,
            [STUDIO_ENV.routeCatalog]: JSON.stringify(toRouteCatalog(generation, project)),
          },
        },
      };
    },

    async getDirectorSessionAuthority(input): Promise<StudioDirectorSessionAuthorityV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio project request');
      }
      assertSafeId(input.projectId, 'project id');
      await loadSupported(input.projectId);
      if (deps.getStudioServerScriptPath === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Creative Studio MCP script path is unavailable');
      }
      const projectDir = await deps.store.getVerifiedProjectDirectoryV2(input.projectId);
      if (projectDir === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio project directory is unavailable');
      }
      const scriptPath = deps.getStudioServerScriptPath();
      return {
        serverId: `studio-brief-${input.projectId}`,
        serverName: BUILTIN_STUDIO_NAME,
        scriptPath,
        projectDir,
        pendingDir: path.join(projectDir, 'proposals', 'pending'),
        referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
      };
    },

    async bindDirectorConversation(input): Promise<StudioRendererProjectCommitResultV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'conversationId'])) {
        throw invalid('Invalid Studio Director conversation binding request');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      assertSafeId(input.conversationId, 'conversation id');

      const project = await loadSupported(input.projectId);
      if (project.briefConversationId === input.conversationId) return toRendererProjectCommitResult(project);

      try {
        const committed = await deps.store.updateProjectV2(
          input.projectId,
          (current) => ({ ...current, briefConversationId: input.conversationId }),
          input.expectedRevision,
          `bind_director_conversation:${input.conversationId}`
        );
        deps.onProjectUpdated(committed.id);
        return toRendererProjectCommitResult(committed);
      } catch (error) {
        if (!(error instanceof CreativeStudioStoreError) || error.code !== 'stale_project') throw error;
        const latest = await loadSupported(input.projectId);
        if (latest.briefConversationId !== input.conversationId) throw error;
        return toRendererProjectCommitResult(latest);
      }
    },

    async applyMutations(input, context): Promise<StudioMutationBatchResultV2> {
      const affectsHumanBinding =
        Array.isArray(input.operations) &&
        input.operations.some((operation) => operation.kind === 'set_seed_still' || operation.kind === 'select_take');
      if (!affectsHumanBinding) {
        const result = await deps.store.applyMutationBatchV2(input, context);
        return {
          project: notify(result.project),
          createdBeatIds: [...result.createdBeatIds],
          createdShotIds: [...result.createdShotIds],
        };
      }

      let applied: StudioMutationApplyResultV2 | null = null;
      let advance: StudioWaitingBindingAdvanceV2 = {
        dispatchJobIds: [],
        extractionIds: [],
        projectChanged: false,
      };
      let committed = await deps.store.updateProjectV2(
        input.projectId,
        (project) => {
          applied = applyStudioMutationBatchV2(project, input, context);
          advance = advanceStudioWaitingBindingsV2(applied.project, context.capturedAt);
          return applied.project;
        },
        input.expectedRevision,
        `mutation_with_binding:${context.mutationId}`
      );
      if (applied === null) throw invalid('Studio mutation was not applied');
      await dispatchBoundJobs(committed.id, advance.dispatchJobIds);

      const verifiedReadyExtractions = new Map<string, StudioVerifiedConditioningFrameV2>();
      if (deps.mediaStore !== undefined) {
        for (const extractionId of advance.extractionIds) {
          try {
            // eslint-disable-next-line no-await-in-loop -- one local decoder bounds CPU and memory.
            const extraction = await deps.mediaStore.extractConditioningFrameV2({
              projectId: committed.id,
              extractionId,
            });
            if (extraction.status === 'ready') {
              const verification = await deps.mediaStore.verifyConditioningFrameV2({
                projectId: committed.id,
                extractionId: extraction.id,
              });
              if (verification !== null) verifiedReadyExtractions.set(verification.extractionId, verification);
            }
          } catch {
            // The durable failed extraction and waiting jobs are the recoverable result.
          }
        }
      }
      if (verifiedReadyExtractions.size > 0) {
        let boundAfterExtraction: StudioWaitingBindingAdvanceV2 = {
          dispatchJobIds: [],
          extractionIds: [],
          projectChanged: false,
        };
        committed = await deps.store.updateProjectV2(
          committed.id,
          (project) => {
            boundAfterExtraction = advanceStudioWaitingBindingsV2(
              project,
              readNow().toISOString(),
              verifiedReadyExtractions
            );
            return project;
          },
          undefined,
          `bind_conditioning:${context.mutationId}`
        );
        await dispatchBoundJobs(committed.id, boundAfterExtraction.dispatchJobIds);
      } else if (advance.extractionIds.length > 0) {
        committed = await loadSupported(committed.id);
      }
      return {
        project: notify(committed),
        createdBeatIds: [...applied.createdBeatIds],
        createdShotIds: [...applied.createdShotIds],
      };
    },

    async importReferenceFromPath(input): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }> {
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      if (input.shotId !== undefined) assertSafeId(input.shotId, 'shot id');
      if (
        (input.briefReferenceRole !== undefined &&
          input.briefReferenceRole !== 'cast' &&
          input.briefReferenceRole !== 'look') ||
        (input.shotId !== undefined && input.briefReferenceRole !== undefined) ||
        typeof input.sourcePath !== 'string' ||
        input.sourcePath.length === 0
      ) {
        throw invalid('Invalid Studio reference attachment');
      }
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const imported = await deps.mediaStore.importReferenceFromPathV2({ ...input, returnProject: true });
      deps.onProjectUpdated(input.projectId);
      return { asset: structuredClone(imported.asset), project: toRendererProject(imported.project) };
    },

    async importBedAudioFromPath(input): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'sourcePath'])) {
        throw invalid('Invalid Studio bed-audio attachment');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      if (typeof input.sourcePath !== 'string' || input.sourcePath.length === 0) {
        throw invalid('Invalid Studio bed-audio attachment');
      }
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const imported = await deps.mediaStore.importBedAudioFromPathV2({
        ...input,
        assertActive: assertGeneralServiceActive,
      });
      deps.onProjectUpdated(input.projectId);
      return { asset: structuredClone(imported.asset), project: toRendererProject(imported.project) };
    },

    async detachBedAudio(input): Promise<StudioRendererProjectV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'assetId'])) {
        throw invalid('Invalid Studio bed-audio detach request');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.assetId, 'asset id');
      assertRevision(input.expectedRevision);
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const project = await deps.mediaStore.detachBedAudioV2({
        ...input,
        assertActive: assertGeneralServiceActive,
      });
      deps.onProjectUpdated(input.projectId);
      return toRendererProject(project);
    },

    async createExport(input): Promise<StudioRendererExportCatalogV2> {
      if (!isRecord(input)) throw invalid('Invalid Studio export request');
      const exactKeys =
        input.shape === 'still'
          ? ['projectId', 'expectedRevision', 'expectedCatalogRevision', 'shape', 'shotId']
          : ['projectId', 'expectedRevision', 'expectedCatalogRevision', 'shape'];
      if (
        !hasExactKeys(input, exactKeys) ||
        (input.shape !== 'editor_folder' && input.shape !== 'still' && input.shape !== 'script')
      ) {
        throw invalid('Invalid Studio export request');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      assertRevision(input.expectedCatalogRevision);
      if (input.shape === 'still') assertSafeId(input.shotId, 'shot id');
      assertGeneralServiceActive();

      try {
        return await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
          assertGeneralServiceActive();
          if (authority.project.revision !== input.expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio export project revision has changed');
          }
          const files = await buildExportPayload(authority, input);
          assertGeneralServiceActive();
          const artifactId = createExportId();
          assertSafeId(artifactId, 'export id');
          const catalog = await exportCatalogStore.create(
            { ...authority, assertActive: assertGeneralServiceActive },
            {
              expectedProjectRevision: input.expectedRevision,
              expectedCatalogRevision: input.expectedCatalogRevision,
              artifactId,
              managedFileName: artifactId,
              shape: input.shape,
              createdAt: readNow().toISOString(),
              files,
            }
          );
          return projectStudioRendererExportCatalogV2(catalog);
        });
      } catch (error) {
        return rethrowExportFailure(error);
      }
    },

    async listExports(input): Promise<StudioRendererExportCatalogV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio export list request');
      }
      assertSafeId(input.projectId, 'project id');
      assertGeneralServiceActive();
      try {
        return await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
          assertGeneralServiceActive();
          const catalog = await exportCatalogStore.repair({ ...authority, assertActive: assertGeneralServiceActive });
          return projectStudioRendererExportCatalogV2(catalog);
        });
      } catch (error) {
        return rethrowExportFailure(error);
      }
    },

    async copyExport(input, chooseDestination): Promise<StudioCopyExportResultV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedCatalogRevision', 'artifactId'])) {
        throw invalid('Invalid Studio export copy request');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedCatalogRevision);
      assertSafeId(input.artifactId, 'export artifact id');
      if (typeof chooseDestination !== 'function') throw invalid('Invalid Studio export destination picker');
      assertGeneralServiceActive();
      try {
        return await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
          assertGeneralServiceActive();
          return exportCatalogStore.copy(
            { ...authority, assertActive: assertGeneralServiceActive },
            input,
            async (description) => {
              assertGeneralServiceActive();
              const destination = await chooseDestination({
                suggestedName: description.suggestedName,
                isDirectory: description.payloadKind === 'directory',
              });
              assertGeneralServiceActive();
              return destination;
            }
          );
        });
      } catch (error) {
        return rethrowExportFailure(error);
      }
    },

    async revealExport(input, revealPath): Promise<StudioRevealExportResultV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedCatalogRevision', 'artifactId'])) {
        throw invalid('Invalid Studio export reveal request');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedCatalogRevision);
      assertSafeId(input.artifactId, 'export artifact id');
      if (typeof revealPath !== 'function') throw invalid('Invalid Studio export revealer');
      assertGeneralServiceActive();
      try {
        return await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
          assertGeneralServiceActive();
          const filePath = await exportCatalogStore.resolveRevealPath(
            { ...authority, assertActive: assertGeneralServiceActive },
            input
          );
          assertGeneralServiceActive();
          revealPath(filePath);
          return { status: 'revealed' };
        });
      } catch (error) {
        return rethrowExportFailure(error);
      }
    },

    async detachBriefReference(input): Promise<StudioRendererProjectV2> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.assetId, 'asset id');
      assertRevision(input.expectedRevision);
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const project = await deps.mediaStore.detachBriefReferenceV2(input);
      deps.onProjectUpdated(input.projectId);
      return toRendererProject(project);
    },

    async persistCapturedPoster(input): Promise<StudioAssetV2> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.shotId, 'shot id');
      assertSafeId(input.videoAssetId, 'video asset id');
      if (
        !Number.isSafeInteger(input.width) ||
        input.width < 1 ||
        input.width > 16_384 ||
        !Number.isSafeInteger(input.height) ||
        input.height < 1 ||
        input.height > 16_384
      ) {
        throw invalid('Invalid Studio captured poster dimensions');
      }
      const bytes = decodeCapturedPoster(input.dataUrl);
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const asset = await deps.mediaStore.persistCapturedPosterV2({
        projectId: input.projectId,
        shotId: input.shotId,
        videoAssetId: input.videoAssetId,
        width: input.width,
        height: input.height,
        declaredByteSize: bytes.length,
        body: Readable.from([bytes]),
      });
      deps.onProjectUpdated(input.projectId);
      return structuredClone(asset);
    },

    async listRoutes(input = {}): Promise<StudioRouteCatalogV2> {
      if (input.projectId !== undefined) assertSafeId(input.projectId, 'project id');
      const project = input.projectId === undefined ? null : await loadSupported(input.projectId);
      return toRouteCatalog(await listGenerationRoutes(), project);
    },

    async getGenerationReadiness(input): Promise<StudioGenerationReadinessV2> {
      assertSafeId(input.projectId, 'project id');
      const project = await loadSupported(input.projectId);
      assertBeatSelection(project, input.beatIds);
      const shots = orderedReadiness(project, input.beatIds);
      return {
        projectId: project.id,
        revision: project.revision,
        shots: shots,
        payableShotIds: shots.filter((shot) => shot.ready).map((shot) => shot.shotId),
      };
    },

    async getWorkspaceStatus(input): Promise<StudioRendererWorkspaceStatusV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) throw invalid('Invalid Studio workspace request');
      assertSafeId(input.projectId, 'project id');
      return projectStudioWorkspaceStatusV2(await loadSupported(input.projectId));
    },

    async getChainStatus(input): Promise<StudioRendererChainStatusV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) throw invalid('Invalid Studio chain request');
      assertSafeId(input.projectId, 'project id');
      return projectStudioChainStatusV2(await loadSupported(input.projectId));
    },

    async listProposals(input): Promise<StudioProposalV2[]> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) throw invalid('Invalid Studio proposal request');
      assertSafeId(input.projectId, 'project id');
      return structuredClone(await deps.store.listProposalsV2(input.projectId));
    },

    async acceptProposal(input): Promise<{
      proposal: StudioProposalV2;
      project: StudioRendererProjectV2;
      applied: boolean;
    }> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'proposalId'])) {
        throw invalid('Invalid Studio proposal request');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.proposalId, 'proposal id');
      const accepted = await deps.store.acceptProposalV2(input.projectId, input.proposalId);
      if (accepted.applied) deps.onProjectUpdated(input.projectId);
      return {
        proposal: structuredClone(accepted.proposal),
        project: toRendererProject(accepted.project),
        applied: accepted.applied,
      };
    },

    async rejectProposal(input): Promise<StudioProposalV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'proposalId'])) {
        throw invalid('Invalid Studio proposal request');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.proposalId, 'proposal id');
      return structuredClone(await deps.store.rejectProposalV2(input.projectId, input.proposalId));
    },

    async listReferenceRequests(input): Promise<StudioReferenceRequestV2[]> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio reference request');
      }
      assertSafeId(input.projectId, 'project id');
      const entries = await deps.store.listReferenceRequestsV2(input.projectId);
      return entries.filter((entry) => entry.decision === null).map((entry) => structuredClone(entry.request));
    },

    async decideReferenceRequest(input): Promise<StudioReferenceRequestDecisionV2> {
      if (
        !isRecord(input) ||
        !hasExactKeys(input, ['projectId', 'requestId', 'expectedRevision', 'outcome']) ||
        !isRecord(input.outcome)
      ) {
        throw invalid('Invalid Studio reference decision');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.requestId, 'reference request id');
      assertRevision(input.expectedRevision);
      let outcome: StudioDecideReferenceRequestInputV2['outcome'];
      if (input.outcome.kind === 'rejected' || input.outcome.kind === 'generation_gate') {
        if (!hasExactKeys(input.outcome, ['kind'])) throw invalid('Invalid Studio reference decision');
        outcome = { kind: input.outcome.kind };
      } else if (
        input.outcome.kind === 'imported_reference' &&
        hasExactKeys(input.outcome, ['kind', 'assetId']) &&
        isSafeId(input.outcome.assetId)
      ) {
        outcome = { kind: 'imported_reference', assetId: input.outcome.assetId };
      } else {
        throw invalid('Invalid Studio reference decision');
      }
      const entry = await deps.store.decideReferenceRequestV2({
        projectId: input.projectId,
        requestId: input.requestId,
        expectedRevision: input.expectedRevision,
        outcome,
      });
      if (entry.decision === null) {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference decision was not persisted');
      }
      return structuredClone(entry.decision);
    },

    async listReferenceGenerationHandoffs(input): Promise<StudioRendererReferenceGenerationHandoffV2[]> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio reference handoff request');
      }
      assertSafeId(input.projectId, 'project id');
      const entries = await deps.store.listReferenceRequestsV2(input.projectId);
      return entries
        .flatMap((entry) => {
          if (entry.decision === null) return [];
          const projected = projectStudioReferenceGenerationHandoffV2(entry.decision, entry.receipt);
          return projected === null ? [] : [projected];
        })
        .toSorted(
          (left, right) =>
            left.decidedAt.localeCompare(right.decidedAt) ||
            left.requestId.localeCompare(right.requestId) ||
            left.handoffId.localeCompare(right.handoffId)
        );
    },

    async dismissReferenceGenerationHandoff(input): Promise<StudioDismissReferenceGenerationHandoffResultV2> {
      assertServiceActive();
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'handoffId'])) {
        throw invalid('Invalid Studio reference handoff dismissal');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.handoffId, 'reference handoff id');
      assertRevision(input.expectedRevision);
      const completed = await deps.store.recordReferenceGenerationHandoffReceiptV2({
        projectId: input.projectId,
        handoffId: input.handoffId,
        expectedRevision: input.expectedRevision,
        result: { kind: 'dismissed' },
      });
      if (completed.receipt?.result.kind !== 'dismissed') {
        throw new CreativeStudioStoreError('storage_error', 'Studio reference handoff dismissal was not persisted');
      }
      return { status: 'dismissed', completedAt: completed.receipt.completedAt };
    },

    async prepareSubmission(input): Promise<StudioRendererPreparedSubmissionOptionsV2> {
      assertServiceActive();
      if (!isRecord(input)) throw invalid('Invalid Studio submission request');
      let exactHandoffRequest: (StudioPrepareSubmissionRequestV2 & { originReferenceHandoffId: string }) | null = null;
      if (input.originReferenceHandoffId !== null) {
        assertReferenceHandoffPrepareEnvelope(input);
        const handoff = await deps.store.readReferenceGenerationHandoffV2(
          input.projectId,
          input.originReferenceHandoffId
        );
        assertExactOpenReferenceHandoff(input, handoff);
        exactHandoffRequest = input;
      }
      const projectId = input.projectId;
      assertSafeId(projectId, 'project id');
      assertRevision(input.expectedRevision);
      const project = await loadSupported(projectId);
      if (project.id !== projectId || project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      if (exactHandoffRequest !== null) {
        assertReferenceHandoffProjectCurrent(project, exactHandoffRequest);
      }
      let graph;
      try {
        graph = deriveStudioSubmissionQuoteGraphV2({ project, request: input });
      } catch (error) {
        return rethrowPricingFailure(error);
      }
      const generation = await listGenerationRoutes();
      const rateCard = await loadRateCard(generation);
      let derived;
      try {
        derived = priceStudioSubmissionQuoteGraphV2({ project, graph, rateCard });
      } catch (error) {
        return rethrowPricingFailure(error);
      }

      const baseAuthority = resolveQuoteAuthority(generation, project, derived.baseOnly);
      let withCascadeCore = derived.withCascade;
      let authority = baseAuthority;
      if (withCascadeCore !== null) {
        try {
          authority = resolveQuoteAuthority(generation, project, withCascadeCore);
        } catch (error) {
          if (!(error instanceof CreativeStudioServiceError) || error.code !== 'invalid_route') throw error;
          withCascadeCore = null;
        }
      }

      const baseQuoteId = createQuoteId();
      const cascadeQuoteId = withCascadeCore === null ? null : createQuoteId();
      if (
        !isSafeId(baseQuoteId) ||
        (cascadeQuoteId !== null && (!isSafeId(cascadeQuoteId) || cascadeQuoteId === baseQuoteId))
      ) {
        throw invalid('Invalid or duplicate Studio quote identity');
      }
      const options = {
        baseOnly: createQuote(derived.baseOnly, baseQuoteId),
        withCascade:
          withCascadeCore === null || cascadeQuoteId === null ? null : createQuote(withCascadeCore, cascadeQuoteId),
      };
      const session = preparedSubmissionCache.admit({
        request: derived.request,
        options,
        providerBindings: authority.providerBindings,
        cancellationPolicies: authority.cancellationPolicies,
      });
      return projectPreparedOptions(project, generation, session.options);
    },

    async confirmSubmission(input): Promise<StudioConfirmSubmissionResultV2> {
      assertServiceActive();
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'quoteId', 'expectedRevision'])) {
        throw invalid('Invalid Studio confirmation request');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.quoteId, 'quote id');
      assertRevision(input.expectedRevision);
      const claim = preparedSubmissionCache.claim(input.projectId, input.quoteId);
      activeClaims.add(claim);
      let durable = false;
      try {
        const confirmation: StudioProjectConfirmationInputV2<
          ConfirmationRevalidation,
          StudioDispatchAuthorizedJobsRequestV2
        > = {
          projectId: input.projectId,
          expectedRevision: input.expectedRevision,
          expiresAt: claim.quote.expiresAt,
          revalidate: async (project) => {
            assertServiceActive(claim);
            const mutableProject = structuredClone(project) as StudioProjectV2;
            if (!evaluateStudioBudgetV2(quoteCore(claim.quote), mutableProject.spendPolicy).allowed) {
              throw invalid('Studio spend policy refused the quote');
            }
            let graph;
            try {
              graph = deriveStudioSubmissionQuoteGraphV2({
                project: mutableProject,
                request: claim.session.request,
              });
            } catch (error) {
              return rethrowPricingFailure(error);
            }
            const generation = await listGenerationRoutes();
            const rateCard = await loadRateCard(generation);
            let derived;
            try {
              derived = priceStudioSubmissionQuoteGraphV2({ project: mutableProject, graph, rateCard });
            } catch (error) {
              return rethrowPricingFailure(error);
            }
            const currentCore = claim.option === 'baseOnly' ? derived.baseOnly : derived.withCascade;
            if (currentCore === null || !studioSubmissionQuoteCoresEqual(quoteCore(claim.quote), currentCore)) {
              throw invalid('Studio quote is stale');
            }
            if (!evaluateStudioBudgetV2(currentCore, mutableProject.spendPolicy).allowed) {
              throw invalid('Studio spend policy refused the quote');
            }
            const currentAuthority = resolveQuoteAuthority(generation, mutableProject, currentCore);
            const providerBindings = currentAuthority.providerBindings;
            if (!jsonEqual(providerBindings, exactSelectedBindings(claim))) {
              throw new CreativeStudioServiceError('invalid_route');
            }
            const cancellationPolicies = currentAuthority.cancellationPolicies;
            if (!jsonEqual(cancellationPolicies, exactSelectedCancellationPolicies(claim))) {
              throw new CreativeStudioServiceError('invalid_route');
            }
            return { quote: structuredClone(claim.quote), providerBindings, cancellationPolicies };
          },
          assertActive: () => assertServiceActive(claim),
          buildCommit: (project, revalidation, confirmedAt) =>
            buildConfirmedProject(project, structuredClone(revalidation) as ConfirmationRevalidation, confirmedAt),
          commitTag: `confirm_submission:${claim.quote.id}`,
        };
        const committed =
          claim.quote.originReferenceHandoffId === null
            ? await deps.store.confirmProjectV2<ConfirmationRevalidation, StudioDispatchAuthorizedJobsRequestV2>(
                confirmation
              )
            : await deps.store.confirmReferenceGenerationHandoffV2<
                ConfirmationRevalidation,
                StudioDispatchAuthorizedJobsRequestV2
              >({ ...confirmation, handoffId: claim.quote.originReferenceHandoffId });
        durable = true;
        activeClaims.delete(claim);
        preparedSubmissionCache.consume(claim);
        deps.onProjectUpdated(committed.project.id);
        if (!disposed && committed.dispatch.jobIds.length > 0) {
          await deps.jobManager
            .dispatchAuthorizedJobsV2({
              projectId: committed.dispatch.projectId,
              jobIds: [...committed.dispatch.jobIds],
            })
            .catch((): undefined => undefined);
        }
        return { projectId: committed.project.id, projectRevision: committed.project.revision };
      } catch (error) {
        activeClaims.delete(claim);
        if (!durable) preparedSubmissionCache.release(claim);
        if (error instanceof StudioProjectConfirmationError && error.code === 'expired_confirmation') {
          throw cacheFailure('quote_not_found');
        }
        throw error;
      }
    },

    async retryConditioningFrame(input): Promise<StudioRendererWorkspaceStatusV2> {
      assertServiceActive();
      assertBarrierRequest(input);
      let extractionId = '';
      const committed = await deps.store.updateProjectV2(
        input.projectId,
        (project) => {
          extractionId = retryableExtractionId(project, input.dependentShotId);
          const extraction = ownValue(project.frameExtractions, extractionId)!;
          extraction.status = 'pending';
          extraction.frameAssetId = null;
          extraction.errorCode = null;
          return project;
        },
        input.expectedRevision,
        `retry_conditioning_frame:${input.dependentShotId}`
      );
      deps.onProjectUpdated(committed.id);
      return projectStudioWorkspaceStatusV2(committed);
    },

    async cancelWaitingCascade(input): Promise<StudioRendererWorkspaceStatusV2> {
      assertServiceActive();
      assertBarrierRequest(input);
      const cancelledAt = readNow().toISOString();
      const committed = await deps.store.updateProjectV2(
        input.projectId,
        (project) => {
          cancelWaitingItem(project, input.dependentShotId, cancelledAt);
          return project;
        },
        input.expectedRevision,
        `cancel_waiting_cascade:${input.dependentShotId}`
      );
      deps.onProjectUpdated(committed.id);
      return projectStudioWorkspaceStatusV2(committed);
    },

    async dispatchAuthorizedJobs(input): Promise<StudioRendererJobV2[]> {
      const jobs = await deps.jobManager.dispatchAuthorizedJobsV2(input);
      return jobs.map((job) => toRendererJob(job));
    },
    async cancelJob(input): Promise<StudioRendererJobV2> {
      assertJobRequest(input);
      return toRendererJob(await deps.jobManager.cancelJobV2(input));
    },

    async retryJob(input): Promise<StudioRendererJobV2> {
      assertJobRequest(input);
      if (
        input.acknowledgePossibleDuplicateCharge !== undefined &&
        typeof input.acknowledgePossibleDuplicateCharge !== 'boolean'
      ) {
        throw invalid('Invalid Studio duplicate-charge acknowledgement');
      }
      return toRendererJob(await deps.jobManager.retryJobV2(input));
    },

    async retryDownload(input): Promise<StudioRendererJobV2> {
      assertJobRequest(input);
      return toRendererJob(await deps.jobManager.retryDownloadV2(input));
    },

    async listConnectionCandidates(): Promise<StudioConnectionCandidate[]> {
      try {
        return structuredClone(await deps.providerResolver.listConnectionCandidates());
      } catch {
        throw new CreativeStudioServiceError('provider_error');
      }
    },

    async listConnections(): Promise<StudioConnectionInventory> {
      return {
        integrations: MEDIA_INTEGRATIONS.map(({ integrationId, kind, labelKey }) => ({
          integrationId,
          kind,
          labelKey,
        })),
        connections: (await deps.store.listConnections()).map(toConnectionRecord),
      };
    },

    async validateConnection(input): Promise<StudioConnectionValidationResult> {
      return toConnectionValidation(await validateConnectionBinding(input));
    },

    async saveConnection(input): Promise<StudioConnectionRecord> {
      const validated = await validateConnectionBinding(input);
      const binding: StudioConnectionBinding = {
        ...validated,
        id: createConnectionId(),
      };
      if (!isSafeId(binding.id)) {
        throw new CreativeStudioStoreError('storage_error', 'Unable to allocate Studio connection identity');
      }
      return toConnectionRecord(await deps.store.saveConnection(binding));
    },

    async removeConnection(input): Promise<boolean> {
      if (!isRecord(input) || !hasExactKeys(input, ['bindingId'])) {
        throw invalid('Invalid Studio connection request');
      }
      assertSafeId(input.bindingId, 'connection id');
      return deps.store.removeConnection(input.bindingId);
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      activeClaims.clear();
      preparedSubmissionCache.close();
    },
  };
};
