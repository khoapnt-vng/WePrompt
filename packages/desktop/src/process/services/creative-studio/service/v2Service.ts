/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { isDeepStrictEqual } from 'node:util';
import type { IProvider, ISessionMcpServer } from '@/common/config/storage';
import {
  isStudioPricingRefusalReasonV2,
  STUDIO_MAX_PROJECT_REFERENCES,
  STUDIO_MAX_SHOTS_PER_PROJECT,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  type CreateStudioProjectInputV2,
  type StudioAssetV2,
  type StudioBindDirectorConversationRequestV2,
  type StudioCancellationPolicy,
  type StudioCascadeBarrierActionRequestV2,
  type StudioConnectionBinding,
  type StudioConnectionCandidate,
  type StudioConnectionInventory,
  type StudioConnectionRecord,
  type StudioConnectionValidationFailureReason,
  type StudioConnectionValidationResult,
  type StudioConnectionValidationSuccess,
  type StudioConfirmSubmissionRequestV2,
  type StudioConfirmSubmissionResultV2,
  type StudioCopyExportResultV2,
  type StudioCreateExportRequestV2,
  type StudioFilmExportCapabilityRequestV2,
  type StudioFilmExportCapabilityV2,
  type StudioFilmExportStatusRequestV2,
  type StudioFilmExportStatusV2,
  type StudioCancelFilmExportRequestV2,
  type StudioCancelFilmExportResultV2,
  type StudioAcknowledgeFilmExportRequestV2,
  type StudioAcknowledgeFilmExportResultV2,
  type StudioDetachBedAudioRequestV2,
  type StudioDismissReferenceGenerationHandoffRequestV2,
  type StudioDismissReferenceGenerationHandoffResultV2,
  type StudioDirectorSessionAuthorityV2,
  type StudioJobRequest,
  type StudioJobPurpose,
  type StudioJobV2,
  type StudioExportArtifactRequestV2,
  type StudioGenerationBlockV2,
  type StudioGenerationCapabilityItemV2,
  type StudioGenerationCapabilityRequestV2,
  type StudioGenerationCapabilityV2,
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
  type StudioProjectStatusRequestV2,
  type StudioProjectStatusRouteCatalogV2,
  type StudioProjectStatusV2,
  type StudioProjectWorkspaceLoadResultV2,
  type StudioProjectV2,
  type StudioPrepareProjectReferencesRequestV2,
  type StudioPrepareSubmissionRequestV2,
  type StudioProposalV2,
  type StudioProviderRef,
  type StudioQuotedGeneration,
  type StudioReferenceGenerationHandoffReceiptV2,
  type StudioReferenceRequestDecisionV2,
  type StudioReferenceRequestV2,
  type StudioRemoveConnectionRequest,
  type StudioRendererExportCatalogV2,
  type StudioRendererJobV2,
  type StudioRendererPreparedSubmissionOptionsV2,
  type StudioRendererProposalCatalogV2,
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
import { isDisqualifiedByHealthVerdict, isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import {
  canCancelJobV2,
  canRetryJobV2,
  type StudioDispatchAuthorizedJobsRequestV2,
  type StudioJobManagerV2,
} from '../jobManager';
import { CreativeStudioMediaError, type StudioMediaStore } from '../mediaStore';
import type { GenerationProviderAdapterRegistry } from '../adapters';
import { ProviderDeadlineError, runWithProviderDeadline } from '../adapters/types';
import {
  createStudioMediaChoiceId,
  type StudioGenerationRoute,
  type StudioGenerationRouteCatalog,
  type StudioProviderResolver,
} from '../providerResolver';
import { formatStudioJobLog, logStudioConditioningFrameFailure } from '../jobManager';
import {
  CreativeStudioStoreError,
  StudioProjectConfirmationError,
  type CreativeStudioStore,
  type StudioDecideReferenceRequestInputV2,
  type StudioProjectAuthoritySnapshotV2,
  type StudioProjectConfirmationInputV2,
  type StudioProjectStoreLoadResultV2,
} from '../store';
import {
  createStudioSpendAuthorizationV2,
  deriveStudioProjectReferenceSubmissionQuoteGraphV2,
  deriveStudioSubmissionQuoteGraphV2,
  evaluateStudioBudgetV2,
  priceStudioSubmissionQuoteGraphV2,
  preflightStudioProjectReferencePreparationV2,
  preflightStudioSubmissionPreparationV2,
  StudioPricingErrorV2,
  StudioRateCardErrorV2,
  studioSubmissionQuoteCoresEqual,
  toStudioRendererSubmissionQuoteV2,
  type StudioCompositionRouteLookupV2,
  type StudioRateCardV2,
} from './schema2/pricing';
import {
  composeStudioEditorFolderV2,
  composeStudioEditorFolderScriptV2,
  createStudioExportCatalogStoreV2,
  projectStudioRendererExportCatalogV2,
  StudioEditorFolderErrorV2,
  StudioExportCatalogErrorV2,
  type StudioExportCatalogStoreV2,
  type StudioExportPayloadFilePlanV2,
} from './schema2/exports';
import {
  createStudioFilmExporterV2,
  deriveStudioFilmRequiredAssetIdsV2,
  StudioFilmExportErrorV2,
  type StudioFilmExporterV2,
  type StudioFilmVerifiedSourceV2,
} from './filmExporter';
import {
  StudioPreparedSubmissionCacheErrorV2,
  StudioPreparedSubmissionCacheV2,
  type StudioPreparedSubmissionClaimV2,
} from './schema2/pricing/preparedSubmissionCache';
import {
  applyStudioMutationBatchV2,
  advanceStudioWaitingBindingsV2,
  createStudioFrameExtractionId,
  deriveStudioInboundShotReferencesV2,
  projectStudioChainBoundaryVerificationIdsV2,
  projectStudioChainStatusV2,
  projectStudioStatusV2,
  projectStudioWorkspaceStatusV2,
  STUDIO_BOARD_REQUEST_DURATION_SECONDS,
  resolveStudioReferenceBindingV2,
  resolveStudioCanonicalBoardAssetV2,
  resolveStudioCurrentBoardPanelAuthorityV2,
  studioGenerationTargetKey,
  terminalizeStudioUnboundDependenciesV2,
  type StudioMutationApplyResultV2,
  type StudioVerifiedConditioningFrameV2,
  type StudioWaitingBindingAdvanceV2,
} from './schema2';
import { CreativeStudioServiceError, StudioConnectionValidationError } from './projectMutations';
import { deriveStudioProposalReviewV2 } from './schema2/mutations/proposalReview';

export type { StudioGenerationCapabilityV2, StudioRouteCatalogV2 } from '@/common/types/project/creativeStudioTypes';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ROUTE_INTEGRATION_LABELS = {
  'weprompt-image-v1': 'imageApi',
  'byteplus-seedance-v1': 'bytePlusSeedance',
  'weprompt-media-gateway-v1': 'selfHostedVideoGateway',
  'openrouter-video-v1': 'openRouterVideo',
} as const;
const CONNECTION_VALIDATION_TIMEOUT_MS = 30_000;
const FILM_EXPORT_JOB_DEADLINE_MS = 30 * 60_000;
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
  importSeedStillFromPath(input: {
    projectId: string;
    shotId: string;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }>;
  importReferenceImageFromPath(input: {
    projectId: string;
    referenceId: string;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }>;
  importBedAudioFromPath(input: {
    projectId: string;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }>;
  detachBedAudio(input: StudioDetachBedAudioRequestV2): Promise<StudioRendererProjectV2>;
  createExport(input: StudioCreateExportRequestV2): Promise<StudioRendererExportCatalogV2>;
  getFilmExportCapability(input: StudioFilmExportCapabilityRequestV2): Promise<StudioFilmExportCapabilityV2>;
  getFilmExportStatus(input: StudioFilmExportStatusRequestV2): Promise<StudioFilmExportStatusV2>;
  cancelFilmExport(input: StudioCancelFilmExportRequestV2): Promise<StudioCancelFilmExportResultV2>;
  acknowledgeFilmExport(input: StudioAcknowledgeFilmExportRequestV2): Promise<StudioAcknowledgeFilmExportResultV2>;
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
  getProjectStatus(input: StudioProjectStatusRequestV2): Promise<StudioProjectStatusV2>;
  getGenerationCapability(input: StudioGenerationCapabilityRequestV2): Promise<StudioGenerationCapabilityV2>;
  getProjectWorkspace(input: { projectId: string }): Promise<StudioProjectWorkspaceLoadResultV2>;
  listProposals(input: { projectId: string }): Promise<StudioRendererProposalCatalogV2>;
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
  prepareProjectReferences(
    input: StudioPrepareProjectReferencesRequestV2
  ): Promise<StudioRendererPreparedSubmissionOptionsV2>;
  prepareSubmission(input: StudioPrepareSubmissionRequestV2): Promise<StudioRendererPreparedSubmissionOptionsV2>;
  confirmSubmission(input: StudioConfirmSubmissionRequestV2): Promise<StudioConfirmSubmissionResultV2>;
  /** Internal Director command attribution; renderer calls omit this argument. */
  retryConditioningFrame(
    input: StudioCascadeBarrierActionRequestV2,
    commitTag?: string
  ): Promise<StudioRendererWorkspaceStatusV2>;
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
  filmExporter?: StudioFilmExporterV2;
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

const rethrowLocalInventoryFailure = (error: unknown, message: string): never => {
  if (error instanceof CreativeStudioServiceError || error instanceof CreativeStudioStoreError) throw error;
  throw new CreativeStudioStoreError('storage_error', message);
};

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
    if (isStudioPricingRefusalReasonV2(error.code)) throw error;
    throw new CreativeStudioServiceError('invalid_route');
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

const connectionValidationFailureReason = (value: unknown): StudioConnectionValidationFailureReason | null => {
  if (!isRecord(value) || !hasExactKeys(value, ['code'])) return null;
  switch (value.code) {
    case 'unsupported':
    case 'auth':
    case 'rate_limited':
    case 'provider_unavailable':
    case 'timeout':
    case 'invalid_response':
    case 'unknown':
      return value.code;
    case 'no_output':
      return 'unknown';
    default:
      return null;
  }
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

const hasExactOpenRouterValidationCapabilities = (value: unknown): value is Record<string, unknown> => {
  if (!isRecord(value)) return false;
  const { mediaKinds, audioModes, aspectRatios, resolutions, supportedDurationSeconds } = value;
  if (
    !isExactDenseArray(mediaKinds) ||
    mediaKinds.length !== 1 ||
    mediaKinds[0] !== 'video' ||
    !isExactDenseArray(audioModes) ||
    audioModes.length !== 1 ||
    (audioModes[0] !== 'audio' && audioModes[0] !== 'none') ||
    !isExactDenseArray(aspectRatios) ||
    aspectRatios.length === 0 ||
    aspectRatios.some((item) => typeof item !== 'string' || !ASPECT_RATIOS.has(item)) ||
    new Set(aspectRatios).size !== aspectRatios.length ||
    !isExactDenseArray(resolutions) ||
    resolutions.length === 0 ||
    resolutions.some((item) => typeof item !== 'string' || !RESOLUTIONS.has(item)) ||
    new Set(resolutions).size !== resolutions.length ||
    !isExactDenseArray(supportedDurationSeconds) ||
    supportedDurationSeconds.length === 0 ||
    supportedDurationSeconds.some(
      (item, index) =>
        !Number.isInteger(item) ||
        (item as number) < STUDIO_MIN_SHOT_SECONDS ||
        (item as number) > STUDIO_MAX_SHOT_SECONDS ||
        (index > 0 && (item as number) <= (supportedDurationSeconds[index - 1] as number))
    ) ||
    value.minDurationSeconds !== supportedDurationSeconds[0] ||
    value.maxDurationSeconds !== supportedDurationSeconds.at(-1) ||
    typeof value.supportsFirstFrame !== 'boolean' ||
    value.maxConditioningImages !== 0 ||
    value.cancellationPolicy !== 'none'
  ) {
    return false;
  }
  return true;
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
  !isDisqualifiedByHealthVerdict(provider, model) &&
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
  if (adapterId === 'openrouter-video-v1') {
    const supportedDurationSeconds = Array.isArray(capabilities?.supportedDurationSeconds)
      ? [...new Set(capabilities.supportedDurationSeconds)]
          .filter(
            (value): value is number =>
              Number.isInteger(value) && value >= STUDIO_MIN_SHOT_SECONDS && value <= STUDIO_MAX_SHOT_SECONDS
          )
          .toSorted((left, right) => left - right)
      : [];
    return {
      mediaKinds: ['video'],
      audioModes:
        Array.isArray(capabilities?.audioModes) && capabilities.audioModes.includes('audio') ? ['audio'] : ['none'],
      ...(aspectRatios && aspectRatios.length > 0 ? { aspectRatios } : {}),
      ...(resolutions && resolutions.length > 0 ? { resolutions } : {}),
      ...(supportedDurationSeconds.length > 0
        ? {
            supportedDurationSeconds,
            minDurationSeconds: supportedDurationSeconds[0]!,
            maxDurationSeconds: supportedDurationSeconds.at(-1)!,
          }
        : {}),
      supportsFirstFrame: capabilities?.supportsFirstFrame === true,
      maxConditioningImages: 0,
      cancellationPolicy: 'none',
    };
  }
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

const toConnectionValidation = (binding: StudioConnectionBinding): StudioConnectionValidationSuccess => {
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

const forEachStudioReadBounded = async <Value>(
  values: readonly Value[],
  operation: (value: Value) => Promise<void>
): Promise<void> => {
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < values.length) {
      const value = values[nextIndex++];
      // eslint-disable-next-line no-await-in-loop -- Each worker is sequential so the shared pool stays bounded at eight reads.
      if (value !== undefined) await operation(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, values.length) }, worker));
};

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
      job.target.kind === 'shot' &&
      job.target.shotId === shot.id &&
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
    asset.projectReferenceId === null
    ? asset
    : null;
};

const eligibleExplicitSeedAssetV2 = (
  project: StudioProjectV2,
  shot: StudioShot,
  assetId: string
): StudioAssetV2 | null =>
  eligibleSeedAssetV2(project, shot, assetId) ??
  resolveStudioCanonicalBoardAssetV2(project, shot, assetId)?.asset ??
  null;

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

  if (activeShot.videoAssetId !== null) {
    const selected = ownedShotAssetV2(project, activeShot, activeShot.videoAssetId);
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
  if (activeShot.seedStillId !== null && !activeShot.dismissedSeedStillIds.includes(activeShot.seedStillId)) {
    const explicit = eligibleExplicitSeedAssetV2(project, activeShot, activeShot.seedStillId);
    if (explicit !== null) return explicit;
  }
  const candidates = activeShot.assetIds.flatMap((assetId) => {
    if (activeShot.dismissedSeedStillIds.includes(assetId)) return [];
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
    ...(route.constraints.supportedDurationSeconds === undefined
      ? {}
      : { supportedDurationSeconds: [...route.constraints.supportedDurationSeconds] }),
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

const capabilityRole = (purpose: StudioGenerationCapabilityItemV2['purpose']): StudioMediaKind =>
  purpose === 'video_take' ? 'video' : 'image';

/** One capability predicate shared by disclosure and final quote authorization. */
const generationRouteCapabilityBlock = (input: {
  route: StudioGenerationRoute;
  project: StudioProjectV2;
  role: StudioMediaKind;
  durationSeconds: number;
  requiresFirstFrame: boolean;
}): StudioGenerationBlockV2 | null => {
  const { route, project, role, durationSeconds, requiresFirstFrame } = input;
  if (route.health === 'unavailable') return { code: 'health', role };
  if (!route.constraints.silentOutput && route.adapterId !== 'openrouter-video-v1') {
    return { code: 'retired', role };
  }
  if (!route.constraints.aspectRatios.includes(project.aspectRatio)) {
    return { code: 'frame', role, ratio: project.aspectRatio };
  }
  if (!route.constraints.resolutions.includes(project.resolution)) {
    return { code: 'resolution', role, resolution: project.resolution };
  }
  if (
    durationSeconds < route.constraints.minDurationSeconds ||
    durationSeconds > route.constraints.maxDurationSeconds ||
    (route.constraints.supportedDurationSeconds !== undefined &&
      !route.constraints.supportedDurationSeconds.includes(durationSeconds))
  ) {
    return { code: 'duration', role, seconds: durationSeconds };
  }
  if (requiresFirstFrame && !route.constraints.supportsFirstFrame) {
    return { code: 'first_frame', role: 'video' };
  }
  return null;
};

const generationBlockForItem = (
  project: StudioProjectV2,
  generation: StudioGenerationRouteCatalog | null,
  item: StudioGenerationCapabilityItemV2
): StudioGenerationBlockV2 | null => {
  const role = capabilityRole(item.purpose);
  if (generation === null || generation.generationCatalogVersion.trim().length === 0) {
    return { code: 'catalog_unloaded', role };
  }
  const selection = role === 'image' ? project.imageRouteId : project.videoRouteId;
  if (selection === null) return { code: 'no_engine', role };

  const route = generation.routes.find(
    (candidate) => candidate.kind === role && routeMatchesSelection(candidate, selection)
  );
  if (route === undefined) {
    const diagnostic = generation.diagnostics.find(
      (candidate) =>
        candidate.status !== 'available' &&
        createStudioMediaChoiceId({
          providerId: candidate.providerId,
          adapterId: candidate.adapterId,
          model: candidate.model,
          kind: role,
        }) === selection
    );
    if (diagnostic?.status === 'needs_setup') return { code: 'needs_setup', role };
    if (diagnostic?.status === 'health') return { code: 'health', role };
    return { code: 'retired', role };
  }
  const shot = item.target.kind === 'shot' ? ownValue(project.shots, item.target.shotId) : undefined;
  if (item.target.kind === 'shot' && shot === undefined) return { code: 'retired', role };
  const reference =
    item.target.kind === 'reference' ? ownValue(project.references, item.target.referenceId) : undefined;
  if (item.target.kind === 'reference' && reference === undefined) return { code: 'retired', role };
  const durationSeconds =
    item.purpose === 'board_still' || item.purpose === 'reference_image'
      ? STUDIO_BOARD_REQUEST_DURATION_SECONDS
      : shot!.durationSeconds;
  const capabilityBlock = generationRouteCapabilityBlock({
    route,
    project,
    role,
    durationSeconds,
    requiresFirstFrame: item.purpose === 'video_take',
  });
  if (capabilityBlock !== null) return capabilityBlock;
  if (item.target.kind === 'reference' && route.constraints.maxConditioningImages < 1) {
    return {
      code: 'reference_binding',
      role: 'image',
      reason: 'capacity_exceeded',
      selectedCount: 1,
      limit: route.constraints.maxConditioningImages,
    };
  }
  if (item.target.kind === 'shot' && item.purpose !== 'video_take') {
    const binding = resolveStudioReferenceBindingV2({
      project,
      shotId: shot!.id,
      maxConditioningImages: route.constraints.maxConditioningImages,
    });
    if (binding.ok === false) {
      return {
        code: 'reference_binding',
        role: 'image',
        reason: binding.reason,
        selectedCount:
          shot!.referenceBinding.characterReferenceIds.length +
          (shot!.referenceBinding.backgroundReferenceId === null ? 0 : 1),
        limit: route.constraints.maxConditioningImages,
      };
    }
  }
  return null;
};

const CAPABILITY_PURPOSE_ORDER: Record<StudioGenerationCapabilityItemV2['purpose'], number> = {
  seed_still: 0,
  board_still: 1,
  video_take: 2,
  reference_image: 0,
};

const cloneCapabilityItem = (item: StudioGenerationCapabilityItemV2): StudioGenerationCapabilityItemV2 => {
  if (item.target.kind === 'reference') {
    return { target: { kind: 'reference', referenceId: item.target.referenceId }, purpose: 'reference_image' };
  }
  if (item.purpose === 'reference_image') throw invalid('Invalid Studio Shot capability purpose');
  return { target: { kind: 'shot', shotId: item.target.shotId }, purpose: item.purpose };
};

const capabilityItemIdentity = (item: StudioGenerationCapabilityItemV2): string =>
  item.target.kind === 'shot'
    ? `shot\0${item.target.shotId}\0${item.purpose}`
    : `reference\0${item.target.referenceId}\0reference_image`;

const orderedCapabilityItems = (project: StudioProjectV2, value: unknown): StudioGenerationCapabilityItemV2[] => {
  if (!isDenseArray(value, STUDIO_MAX_SHOTS_PER_PROJECT * 3 + STUDIO_MAX_PROJECT_REFERENCES)) {
    throw invalid('Invalid Studio generation capability items');
  }
  const activeShotIndex = new Map<string, number>();
  for (const beatId of project.beatOrder) {
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    for (const shotId of beat.shotOrder) {
      if (!activeShotIndex.has(shotId)) activeShotIndex.set(shotId, activeShotIndex.size);
    }
  }
  const activeReferenceIndex = new Map(project.referenceOrder.map((referenceId, index) => [referenceId, index]));
  const seen = new Set<string>();
  const items = value.map((candidate): StudioGenerationCapabilityItemV2 => {
    if (!isRecord(candidate) || !hasExactKeys(candidate, ['target', 'purpose']) || !isRecord(candidate.target)) {
      throw invalid('Invalid Studio generation capability item');
    }
    let item: StudioGenerationCapabilityItemV2;
    if (
      hasExactKeys(candidate.target, ['kind', 'shotId']) &&
      candidate.target.kind === 'shot' &&
      isSafeId(candidate.target.shotId) &&
      activeShotIndex.has(candidate.target.shotId) &&
      (candidate.purpose === 'seed_still' || candidate.purpose === 'board_still' || candidate.purpose === 'video_take')
    ) {
      item = {
        target: { kind: 'shot', shotId: candidate.target.shotId },
        purpose: candidate.purpose,
      };
    } else if (
      hasExactKeys(candidate.target, ['kind', 'referenceId']) &&
      candidate.target.kind === 'reference' &&
      isSafeId(candidate.target.referenceId) &&
      activeReferenceIndex.has(candidate.target.referenceId) &&
      candidate.purpose === 'reference_image'
    ) {
      item = {
        target: { kind: 'reference', referenceId: candidate.target.referenceId },
        purpose: 'reference_image',
      };
    } else {
      throw invalid('Invalid Studio generation capability item');
    }
    const identity = capabilityItemIdentity(item);
    if (seen.has(identity)) throw invalid('Duplicate Studio generation capability item');
    seen.add(identity);
    return item;
  });
  return items.toSorted((left, right) => {
    if (left.target.kind !== right.target.kind) return left.target.kind === 'shot' ? -1 : 1;
    const targetOrder =
      left.target.kind === 'shot' && right.target.kind === 'shot'
        ? activeShotIndex.get(left.target.shotId)! - activeShotIndex.get(right.target.shotId)!
        : left.target.kind === 'reference' && right.target.kind === 'reference'
          ? activeReferenceIndex.get(left.target.referenceId)! - activeReferenceIndex.get(right.target.referenceId)!
          : 0;
    return targetOrder || CAPABILITY_PURPOSE_ORDER[left.purpose] - CAPABILITY_PURPOSE_ORDER[right.purpose];
  });
};

const deriveGenerationCapability = (
  project: StudioProjectV2,
  generation: StudioGenerationRouteCatalog | null,
  items: readonly StudioGenerationCapabilityItemV2[]
): StudioGenerationCapabilityV2 => {
  const supportedItems: StudioGenerationCapabilityItemV2[] = [];
  const blocks: StudioGenerationCapabilityV2['blocks'] = [];
  const groupByBlock = new Map<string, StudioGenerationCapabilityV2['blocks'][number]>();
  for (const item of items) {
    const block = generationBlockForItem(project, generation, item);
    if (block === null) {
      supportedItems.push(cloneCapabilityItem(item));
      continue;
    }
    const key = JSON.stringify(block);
    const existing = groupByBlock.get(key);
    if (existing !== undefined) {
      existing.items.push(cloneCapabilityItem(item));
      continue;
    }
    const group = { block, items: [cloneCapabilityItem(item)] };
    blocks.push(group);
    groupByBlock.set(key, group);
  }
  return {
    projectId: project.id,
    projectRevision: project.revision,
    catalogVersion: generation?.generationCatalogVersion ?? null,
    supportedItems,
    blocks,
  };
};

const quotedItems = (
  quote: Pick<StudioSubmissionQuoteCore, 'baseItems' | 'cascadeItems'>
): StudioQuotedGeneration[] => [...quote.baseItems, ...quote.cascadeItems];

const quotedDuration = (item: StudioQuotedGeneration): number =>
  item.requestPlan.kind === 'resolved'
    ? item.requestPlan.snapshot.durationSeconds
    : item.requestPlan.template.durationSeconds;

const generationMediaKindForPurpose = (purpose: StudioJobPurpose): StudioMediaKind => {
  switch (purpose) {
    case 'seed_still':
    case 'board_still':
    case 'reference_image':
      return 'image';
    case 'video_take':
      return 'video';
  }
};

const resolveQuotedRoute = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2,
  item: StudioQuotedGeneration
): StudioGenerationRoute => {
  const kind = generationMediaKindForPurpose(item.purpose);
  const matches = generation.routes.filter((route) => route.choiceId === item.routeId && route.kind === kind);
  const route = matches.length === 1 ? matches[0]! : null;
  const durationSeconds = quotedDuration(item);
  const referenceInputs =
    item.requestPlan.kind === 'resolved'
      ? item.requestPlan.snapshot.referenceInputs
      : item.requestPlan.template.referenceInputs;
  if (route === null) throw new CreativeStudioServiceError('invalid_route');
  const capabilityBlock = generationRouteCapabilityBlock({
    route,
    project,
    role: kind,
    durationSeconds,
    requiresFirstFrame: item.purpose === 'video_take',
  });
  if (capabilityBlock !== null || referenceInputs.length > route.constraints.maxConditioningImages) {
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
    const kind = generationMediaKindForPurpose(purpose);
    const matches = generation.routes.filter((route) => route.choiceId === routeId && route.kind === kind);
    const route = matches.length === 1 ? matches[0]! : null;
    if (route === null || !routeSupportsProject(route, project)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    return toMediaChoice(route, kind);
  };

const compositionRouteLookup =
  (generation: StudioGenerationRouteCatalog, project: StudioProjectV2): StudioCompositionRouteLookupV2 =>
  (routeId, purpose) => {
    const kind = generationMediaKindForPurpose(purpose);
    const matches = generation.routes.filter((route) => route.choiceId === routeId && route.kind === kind);
    const route = matches.length === 1 ? matches[0]! : null;
    if (route === null) throw new StudioPricingErrorV2('missing_route');
    if (!routeSupportsProject(route, project)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    return {
      provider: { providerId: route.providerId, adapterId: route.adapterId, model: route.model },
      maxConditioningImages: route.constraints.maxConditioningImages,
    };
  };

const requestedKind = (job: StudioJobV2): StudioMediaKind => generationMediaKindForPurpose(job.purpose);

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
    generationCount: receipt.generationCount,
    totalMinorUnits: receipt.totalMinorUnits,
  };
};

const canRetryRendererJob = (project: StudioProjectV2 | undefined, job: StudioJobV2): boolean => {
  if (project === undefined || !canRetryJobV2(job)) return false;
  const owner =
    job.target.kind === 'shot'
      ? ownValue(project.shots, job.target.shotId)
      : ownValue(project.references, job.target.referenceId);
  if (job.projectId !== project.id || owner === undefined || !owner.jobIds.includes(job.id)) return false;
  const targetKey = studioGenerationTargetKey(job.target);
  const targetJobs = owner.jobIds.flatMap((jobId) => {
    const candidate = ownValue(project.jobs, jobId);
    return candidate?.projectId === project.id && studioGenerationTargetKey(candidate.target) === targetKey
      ? [candidate]
      : [];
  });
  return !targetJobs.some((candidate) => candidate.retryOfJobId === job.id);
};

const toRendererJob = (job: StudioJobV2, project?: StudioProjectV2): StudioRendererJobV2 => ({
  id: job.id,
  projectId: job.projectId,
  target: structuredClone(job.target),
  status: job.status,
  purpose: job.purpose,
  provider: toMediaChoice(job.provider, requestedKind(job)),
  outputAssetIds: [...job.outputAssetIds],
  outputAssetIdsByRole: { ...job.outputAssetIdsByRole },
  composition: structuredClone(job.composition),
  error: job.error === null ? null : { ...job.error },
  canCancel: canCancelJobV2(job),
  canRetry: canRetryRendererJob(project, job),
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
    jobs: Object.fromEntries(Object.entries(project.jobs).map(([jobId, job]) => [jobId, toRendererJob(job, project)])),
  };
};

const toRendererProjectCommitResult = (project: StudioProjectV2): StudioRendererProjectCommitResultV2 => ({
  projectId: project.id,
  projectRevision: project.revision,
  createdBeatIds: [],
  createdShotIds: [],
});

/** Paid resubmission may extend only failures whose provider attempt is safe to replace. */
const isPaidGenerationRetryPredecessorV2 = (job: StudioJobV2): boolean =>
  job.status === 'failed' &&
  job.error !== null &&
  job.error.code !== 'download_failed' &&
  job.error.code !== 'poll_deadline' &&
  job.error.code !== 'dependency_failed';

/** Resolves paid lineage without extending project-reference recovery rules to ordinary Shot work. */
const paidGenerationRetryReasonV2 = (job: StudioJobV2): Exclude<StudioJobV2['retryReason'], null> | null => {
  if (job.target.kind === 'reference') {
    if (job.status === 'cancelled') return 'provider_failure';
    if (job.status === 'failed' && job.error?.code === 'poll_deadline') return 'submission_unknown';
  }
  if (!isPaidGenerationRetryPredecessorV2(job)) return null;
  return job.error?.code === 'submission_unknown' ? 'submission_unknown' : 'provider_failure';
};

/** Projects one validated generation gate from its immutable authorization/job correlation. */
export const projectStudioReferenceGenerationHandoffV2 = (
  decision: StudioReferenceRequestDecisionV2,
  receipt: StudioReferenceGenerationHandoffReceiptV2 | null,
  project?: StudioProjectV2
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
  const referenceIds = [...decision.outcome.referenceIds];
  const counts = { queued: 0, running: 0, succeeded: 0, failed: 0 };
  const resultAssetIds: string[] = [];
  const failedReferenceIds: string[] = [];
  const terminalUpdatedAts: string[] = [];
  if (receipt?.result.kind === 'confirmed') {
    if (project === undefined) {
      throw new CreativeStudioStoreError(
        'storage_error',
        'Confirmed Studio reference handoff has no project authority'
      );
    }
    const authorizationId = receipt.result.authorizationId;
    const handoffId = decision.outcome.handoffId;
    const authorizations = project.spendAuthorizations.filter(
      (authorization) => authorization.id === authorizationId && authorization.originReferenceHandoffId === handoffId
    );
    if (authorizations.length !== 1) {
      throw new CreativeStudioStoreError(
        'storage_error',
        'Confirmed Studio reference handoff authorization authority mismatch'
      );
    }
    const authorization = authorizations[0]!;
    const items = [...authorization.baseItems, ...authorization.cascadeItems];
    if (
      authorization.projectId !== project.id ||
      authorization.cascadeItems.length !== 0 ||
      items.length !== referenceIds.length ||
      items.some(
        (item, index) =>
          item.target.kind !== 'reference' ||
          item.target.referenceId !== referenceIds[index] ||
          item.purpose !== 'reference_image' ||
          (item.generationCount !== 1 && item.generationCount !== 2)
      )
    ) {
      throw new CreativeStudioStoreError('storage_error', 'Confirmed Studio reference handoff scope mismatch');
    }
    for (let index = 0; index < referenceIds.length; index += 1) {
      const referenceId = referenceIds[index]!;
      const reference = ownValue(project.references, referenceId);
      const item = items[index]!;
      const jobs = Object.values(project.jobs).filter(
        (candidate) => candidate.authorizationId === authorization.id && candidate.authorizationItemId === item.id
      );
      const itemIdempotencyKeys = authorization.idempotencyKeys
        .filter((entry) => entry.itemId === item.id)
        .map((entry) => entry.key);
      const jobsByIdempotencyKey = new Map(jobs.map((candidate) => [candidate.idempotencyKey, candidate]));
      const firstJob = jobsByIdempotencyKey.get(itemIdempotencyKeys[0] ?? '');
      if (
        reference === undefined ||
        jobs.length < 1 ||
        jobs.length > item.generationCount ||
        itemIdempotencyKeys.length !== item.generationCount ||
        jobsByIdempotencyKey.size !== jobs.length ||
        firstJob === undefined ||
        jobs.some(
          (candidate) =>
            candidate.target.kind !== 'reference' ||
            candidate.target.referenceId !== reference.id ||
            candidate.purpose !== 'reference_image' ||
            !itemIdempotencyKeys.includes(candidate.idempotencyKey)
        )
      ) {
        throw new CreativeStudioStoreError(
          'storage_error',
          'Confirmed Studio reference handoff job authority mismatch'
        );
      }
      let job = firstJob;
      const visitedJobIds = new Set([job.id]);
      while (true) {
        const retries = Object.values(project.jobs).filter((candidate) => candidate.retryOfJobId === job.id);
        if (retries.length === 0) break;
        if (
          retries.length !== 1 ||
          retries[0]!.target.kind !== 'reference' ||
          retries[0]!.target.referenceId !== reference.id ||
          retries[0]!.purpose !== 'reference_image' ||
          visitedJobIds.has(retries[0]!.id)
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Confirmed Studio reference handoff retry mismatch');
        }
        job = retries[0]!;
        visitedJobIds.add(job.id);
      }
      if (jobs.some((candidate) => !visitedJobIds.has(candidate.id))) {
        throw new CreativeStudioStoreError('storage_error', 'Confirmed Studio reference handoff retry mismatch');
      }
      if (job.status === 'succeeded') {
        const primaryAssetId = job.outputAssetIdsByRole.primary;
        if (
          primaryAssetId === null ||
          !job.outputAssetIds.includes(primaryAssetId) ||
          ownValue(project.assets, primaryAssetId)?.projectReferenceId !== reference.id
        ) {
          throw new CreativeStudioStoreError('storage_error', 'Confirmed Studio reference handoff output mismatch');
        }
        counts.succeeded += 1;
        resultAssetIds.push(primaryAssetId);
        terminalUpdatedAts.push(job.updatedAt);
      } else if (job.status === 'running') {
        counts.running += 1;
      } else if (
        job.status === 'waiting_for_conditioning' ||
        job.status === 'queued_local' ||
        job.status === 'submitting' ||
        job.status === 'queued_remote'
      ) {
        counts.queued += 1;
      } else {
        counts.failed += 1;
        terminalUpdatedAts.push(job.updatedAt);
        if (paidGenerationRetryReasonV2(job) !== null) failedReferenceIds.push(referenceId);
      }
    }
  }
  const status: StudioRendererReferenceGenerationHandoffV2['status'] =
    receipt === null
      ? 'awaiting_spend'
      : receipt.result.kind === 'dismissed'
        ? 'dismissed'
        : counts.queued > 0 || counts.running > 0
          ? 'running'
          : counts.succeeded === referenceIds.length
            ? 'succeeded'
            : counts.succeeded > 0
              ? 'partially_failed'
              : 'failed';
  const completedAt =
    status === 'dismissed'
      ? (receipt?.completedAt ?? null)
      : status === 'succeeded' || status === 'partially_failed' || status === 'failed'
        ? (terminalUpdatedAts.toSorted().at(-1) ?? null)
        : null;
  return {
    handoffId: decision.outcome.handoffId,
    requestId: decision.requestId,
    referenceIds,
    decidedAt: decision.decidedAt,
    status,
    counts,
    resultAssetIds,
    failedReferenceIds,
    completedAt,
  };
};

const supportedProject = (result: StudioProjectStoreLoadResultV2): StudioProjectV2 => {
  if (result.status === 'supported') return result.project;
  if (result.status === 'unsupported_prototype_schema') {
    throw new CreativeStudioStoreError('unsupported_prototype_schema', 'Unsupported prototype Studio schema');
  }
  throw new CreativeStudioStoreError('not_found', 'Studio project not found');
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
  const filmExporter =
    deps.filmExporter ??
    createStudioFilmExporterV2({
      onDiagnostic: (code) => console.warn(formatStudioJobLog('film_export_cleanup', { code })),
    });
  type ActiveFilmRenderV2 = {
    renderId: string;
    controller: AbortController;
    progress: Extract<StudioFilmExportStatusV2, { status: 'active' }>['progress'];
    settled: Promise<void>;
    resolveSettled: () => void;
  };
  type TerminalFilmRenderV2 = Extract<StudioFilmExportStatusV2, { status: 'terminal' }>['result'];
  const MAX_RETAINED_FILM_TERMINALS = 32;
  const activeFilmRenders = new Map<string, ActiveFilmRenderV2>();
  const terminalFilmRenders = new Map<string, TerminalFilmRenderV2>();
  const activeClaims = new Set<StudioPreparedSubmissionClaimV2>();
  let generationRoutesSnapshot: StudioGenerationRouteCatalog | null = null;
  let generationRoutesFlight: Promise<StudioGenerationRouteCatalog> | null = null;
  let disposed = false;

  const rememberFilmTerminal = (result: TerminalFilmRenderV2): void => {
    terminalFilmRenders.delete(result.projectId);
    terminalFilmRenders.set(result.projectId, structuredClone(result));
    while (terminalFilmRenders.size > MAX_RETAINED_FILM_TERMINALS) {
      const oldestProjectId = terminalFilmRenders.keys().next().value;
      if (oldestProjectId === undefined) break;
      terminalFilmRenders.delete(oldestProjectId);
    }
  };

  const failedFilmTerminal = (projectId: string, renderId: string, error: unknown): TerminalFilmRenderV2 => {
    if (error instanceof StudioFilmExportErrorV2) {
      if (error.code === 'cancelled') return { projectId, renderId, outcome: 'cancelled' };
      if (error.code === 'invalid_media') {
        return { projectId, renderId, outcome: 'failed', reason: 'invalid_media' };
      }
      if (error.code === 'ffmpeg_unavailable' || error.code === 'unsupported_capabilities') {
        return { projectId, renderId, outcome: 'failed', reason: 'unavailable' };
      }
    }
    if (
      (error instanceof CreativeStudioStoreError && error.code === 'stale_export_catalog') ||
      (error instanceof StudioExportCatalogErrorV2 && error.code === 'stale_catalog_revision')
    ) {
      return { projectId, renderId, outcome: 'failed', reason: 'stale_export_catalog' };
    }
    if (
      (error instanceof CreativeStudioStoreError && error.code === 'stale_project') ||
      (error instanceof StudioExportCatalogErrorV2 && error.code === 'stale_project_revision')
    ) {
      return { projectId, renderId, outcome: 'failed', reason: 'stale_project' };
    }
    return { projectId, renderId, outcome: 'failed', reason: 'render_failed' };
  };

  const sameFilmSourceAsset = (left: StudioAssetV2, right: StudioAssetV2): boolean => isDeepStrictEqual(left, right);

  const filmAbortFailure = (signal: AbortSignal): StudioFilmExportErrorV2 =>
    signal.reason instanceof StudioFilmExportErrorV2 ? signal.reason : new StudioFilmExportErrorV2('cancelled');

  const assertFilmJobActive = (signal: AbortSignal): void => {
    if (signal.aborted) throw filmAbortFailure(signal);
    assertGeneralServiceActive();
  };

  const awaitFilmJobStep = async <Value>(work: Promise<Value>, signal: AbortSignal): Promise<Value> => {
    if (signal.aborted) throw filmAbortFailure(signal);
    let removeAbort = (): void => undefined;
    const aborted = new Promise<never>((_resolve, reject) => {
      const onAbort = (): void => reject(filmAbortFailure(signal));
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbort = (): void => signal.removeEventListener('abort', onAbort);
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      removeAbort();
    }
  };

  const fullyReproveFilmSource = async (
    authority: StudioProjectAuthoritySnapshotV2,
    expected: StudioAssetV2,
    signal: AbortSignal
  ): Promise<void> => {
    if (deps.mediaStore === undefined) {
      throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
    }
    assertFilmJobActive(signal);
    // Resolution itself opens and hashes managed media. Never race it against cancellation: wait until
    // its internal descriptor work has settled, then honor the abort before opening the returned lease.
    const resolved = await deps.mediaStore.resolveAssetWithProjectAuthorityV2(authority, expected.id);
    assertFilmJobActive(signal);
    if (resolved === null || !sameFilmSourceAsset(resolved.asset, expected)) {
      throw new CreativeStudioStoreError('storage_error', 'Studio film source bytes changed');
    }
    const digest = createHash('sha256');
    let byteSize = 0;
    try {
      // Do not abandon a late local lease on cancellation. Once acquisition starts, wait for it,
      // then return the iterator below before allowing the public Film job to settle.
      const iterable = await resolved.openVerifiedStream();
      const iterator = iterable[Symbol.asyncIterator]();
      try {
        assertFilmJobActive(signal);
        for (;;) {
          const next = await awaitFilmJobStep(iterator.next(), signal);
          if (next.done) break;
          const chunk = next.value;
          assertFilmJobActive(signal);
          if (!(chunk instanceof Uint8Array)) {
            throw new CreativeStudioStoreError('storage_error', 'Studio film source stream is invalid');
          }
          byteSize += chunk.byteLength;
          if (!Number.isSafeInteger(byteSize) || byteSize > expected.byteSize) {
            throw new CreativeStudioStoreError('storage_error', 'Studio film source bytes changed');
          }
          digest.update(chunk);
        }
      } finally {
        const closing = iterator.return?.();
        if (closing !== undefined) {
          // Once iteration has begun, cancellation must wait for the stream lease itself to close.
          // Racing this return against an already-aborted signal would let the public job settle
          // while an owned source descriptor remained live.
          await Promise.resolve(closing);
        }
      }
    } catch (error) {
      if (error instanceof CreativeStudioStoreError || error instanceof StudioFilmExportErrorV2) throw error;
      throw new CreativeStudioStoreError('storage_error', 'Studio film source bytes changed');
    }
    if (byteSize !== expected.byteSize || digest.digest('hex') !== expected.sha256) {
      throw new CreativeStudioStoreError('storage_error', 'Studio film source bytes changed');
    }
  };

  const cacheFailure = (code: 'quote_not_found'): StudioPreparedSubmissionCacheErrorV2 =>
    new StudioPreparedSubmissionCacheErrorV2(code);
  const assertServiceActive = (claim?: StudioPreparedSubmissionClaimV2): void => {
    if (disposed || (claim !== undefined && !activeClaims.has(claim))) throw cacheFailure('quote_not_found');
  };
  const loadRateCard = async (generation: StudioGenerationRouteCatalog): Promise<StudioRateCardV2> => {
    if (deps.rateCard === undefined) throw new CreativeStudioServiceError('invalid_route');
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
  const refreshGenerationRoutes = async (): Promise<StudioGenerationRouteCatalog> => {
    if (generationRoutesFlight !== null) return generationRoutesFlight;
    const request = (async (): Promise<StudioGenerationRouteCatalog> => {
      try {
        const catalog = await deps.providerResolver.listGenerationRoutes();
        generationRoutesSnapshot = catalog;
        return catalog;
      } catch (error) {
        generationRoutesSnapshot = null;
        return rethrowLocalInventoryFailure(error, 'Studio generation route inventory is unavailable');
      }
    })();
    generationRoutesFlight = request;
    try {
      return await request;
    } finally {
      if (generationRoutesFlight === request) generationRoutesFlight = null;
    }
  };
  // Capability refreshes happen on every project revision, including job progress. Reuse the latest
  // provider snapshot for those pure project derivations; explicit route refresh and every paid
  // prepare/confirm boundary still rediscover providers before authorizing work.
  const currentGenerationRoutes = async (): Promise<StudioGenerationRouteCatalog> =>
    generationRoutesSnapshot ?? refreshGenerationRoutes();
  const exportFailureDiagnostic = (error: unknown): { code: string; detail?: string } => {
    if (error instanceof StudioFilmExportErrorV2) {
      return {
        code: error.code,
        ...(error.detail === 'film_deadline_elapsed' ? { detail: error.detail } : {}),
      };
    }
    if (error instanceof StudioEditorFolderErrorV2) {
      return { code: 'composition_failed', detail: error.code };
    }
    if (error instanceof StudioExportCatalogErrorV2) {
      return { code: 'catalog_failed', detail: error.code };
    }
    if (error instanceof CreativeStudioStoreError || error instanceof CreativeStudioServiceError) {
      return { code: error.code };
    }
    return { code: 'unknown' };
  };
  const rethrowExportFailure = (error: unknown): never => {
    if (error instanceof StudioExportCatalogErrorV2) {
      if (error.code === 'stale_catalog_revision') {
        throw new CreativeStudioStoreError('stale_export_catalog', 'Studio export catalog has changed');
      }
      if (error.code === 'stale_project_revision') {
        throw new CreativeStudioStoreError('stale_project', 'Studio export project has changed');
      }
      if (error.code === 'invalid_create_plan') {
        throw new CreativeStudioServiceError('render_failed');
      }
      if (error.code === 'artifact_not_found') {
        throw new CreativeStudioServiceError('artifact_not_found');
      }
      throw new CreativeStudioStoreError('storage_error', 'Studio export storage is unavailable');
    }
    if (error instanceof StudioEditorFolderErrorV2) {
      throw new CreativeStudioServiceError('render_failed');
    }
    if (error instanceof StudioFilmExportErrorV2) {
      if (error.code === 'ffmpeg_unavailable') throw new CreativeStudioServiceError('ffmpeg_unavailable');
      if (error.code === 'unsupported_capabilities') {
        throw new CreativeStudioServiceError('unsupported_capabilities');
      }
      if (error.code === 'cancelled') throw new CreativeStudioServiceError('cancelled');
      if (error.code === 'invalid_media') {
        throw new CreativeStudioServiceError('invalid_media');
      }
      throw new CreativeStudioServiceError('render_failed');
    }
    if (error instanceof CreativeStudioStoreError && error.code === 'invalid_payload') {
      throw new CreativeStudioServiceError('render_failed');
    }
    throw error;
  };
  const editorFolderManagedFileName = (createdAt: string, artifactId: string): string => {
    const timestamp = createdAt.replace(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u,
      '$1$2$3-$4$5$6-$7'
    );
    const identity = createHash('sha256').update(artifactId, 'utf8').digest('hex').slice(0, 16);
    return `editor-folder-${timestamp}-${identity}`;
  };
  const filmManagedFileName = (createdAt: string, artifactId: string): string => {
    const timestamp = createdAt.replace(
      /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/u,
      '$1$2$3-$4$5$6-$7'
    );
    const identity = createHash('sha256').update(artifactId, 'utf8').digest('hex').slice(0, 16);
    return `film-${timestamp}-${identity}`;
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
      return [{ kind: 'generated', relativePath: 'script.md', bytes: composeStudioEditorFolderScriptV2(project) }];
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
        if (shot === undefined || shot.videoAssetId === null) continue;
        requiredAssetIds.push(shot.videoAssetId);
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

  type ConnectionBindingValidation =
    | { valid: true; binding: StudioConnectionBinding }
    | { valid: false; reason: StudioConnectionValidationFailureReason };

  const validateConnectionBinding = async (
    input: StudioValidateConnectionRequest
  ): Promise<ConnectionBindingValidation> => {
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
    } catch (error) {
      return rethrowLocalInventoryFailure(error, 'Studio provider inventory is unavailable');
    }
    const provider = providers.find((candidate) => candidate.id === input.providerId);
    if (provider === undefined || !providerIsAvailable(provider, input.model)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    const adapter = deps.getAdapterRegistry().get(integration.adapterId);
    if (adapter === undefined) throw new CreativeStudioServiceError('invalid_route');
    let validation: unknown;
    try {
      validation = await runWithProviderDeadline(
        new AbortController().signal,
        CONNECTION_VALIDATION_TIMEOUT_MS,
        (signal) => adapter.validateConnection({ model: input.model }, provider, signal)
      );
    } catch (error) {
      if (error instanceof ProviderDeadlineError) return { valid: false, reason: 'timeout' };
      throw error;
    }
    if (!isRecord(validation) || (validation.ok !== true && validation.ok !== false)) {
      // The provider responded, but outside the bounded validation result contract.
      throw new CreativeStudioServiceError('provider_error');
    }
    if (validation.ok === false) {
      const reason = connectionValidationFailureReason(validation.error);
      if (reason === null) {
        // A provider refusal exists, but it supplied no admitted bounded reason.
        throw new CreativeStudioServiceError('provider_error');
      }
      return { valid: false, reason };
    }
    const capabilities = isRecord(validation.capabilities) ? validation.capabilities : undefined;
    if (adapter.id === 'openrouter-video-v1' && !hasExactOpenRouterValidationCapabilities(capabilities)) {
      // OpenRouter answered successfully, but its capability response is outside the admitted contract.
      throw new CreativeStudioServiceError('provider_error');
    }
    return {
      valid: true,
      binding: {
        schemaVersion: 1,
        id: 'validation_only',
        providerId: provider.id,
        adapterId: adapter.id,
        model: input.model,
        capabilities: sanitizedCapabilities(adapter.id, input.model, capabilities),
        validatedAt: readNow().toISOString(),
      },
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
    const resolveReference = (referenceId: string) => {
      const reference = Object.hasOwn(project.references, referenceId) ? project.references[referenceId] : undefined;
      return reference?.id === referenceId ? { kind: reference.kind, label: reference.label } : null;
    };
    return {
      baseOnly: toStudioRendererSubmissionQuoteV2(options.baseOnly, project.spendPolicy, lookup, resolveReference),
      withCascade:
        options.withCascade === null
          ? null
          : toStudioRendererSubmissionQuoteV2(options.withCascade, project.spendPolicy, lookup, resolveReference),
    };
  };

  const prepareQuoteGraph = async (
    project: StudioProjectV2,
    graph: ReturnType<typeof deriveStudioSubmissionQuoteGraphV2>,
    generation: StudioGenerationRouteCatalog
  ): Promise<StudioRendererPreparedSubmissionOptionsV2> => {
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
    continuityChange: StudioPrepareSubmissionRequestV2['continuityChange'] | null;
    boardPromotion: StudioPrepareSubmissionRequestV2['boardPromotion'] | null;
  };

  type ConfirmationDispatch = StudioDispatchAuthorizedJobsRequestV2 & {
    extractionIds: string[];
    bindingItemIds: string[];
  };

  const currentBoardPromotionSelectedTakeShotIds = (
    project: StudioProjectV2,
    promotion: NonNullable<StudioPrepareSubmissionRequestV2['boardPromotion']>
  ): string[] | null => {
    const authority = resolveStudioCurrentBoardPanelAuthorityV2(project, promotion.shotId, promotion.boardAssetId);
    if (
      authority === null ||
      (authority.shotIndex !== 0 && authority.shot.chainBreak !== 'hard_cut') ||
      authority.shot.dismissedSeedStillIds.includes(promotion.boardAssetId) ||
      authority.shot.seedStillId === promotion.boardAssetId
    ) {
      return null;
    }
    const segmentShotIds: string[] = [];
    for (let shotIndex = authority.shotIndex; shotIndex < authority.beat.shotOrder.length; shotIndex += 1) {
      const shotId = authority.beat.shotOrder[shotIndex]!;
      const shot = ownValue(project.shots, shotId);
      if (shot === undefined) return null;
      if (shotIndex > authority.shotIndex && shot.chainBreak === 'hard_cut') break;
      segmentShotIds.push(shotId);
    }
    if (segmentShotIds.length === 0 || deriveStudioInboundShotReferencesV2(project, segmentShotIds).length > 0) {
      return null;
    }
    return segmentShotIds.filter((shotId) => {
      const shot = ownValue(project.shots, shotId);
      if (shot?.videoAssetId === null || shot === undefined) return false;
      const asset = ownValue(project.assets, shot.videoAssetId);
      return asset !== undefined && isCanonicalStudioGeneratedTakeV2(asset, project.id, shot);
    });
  };

  const buildConfirmedProject = (
    project: StudioProjectV2,
    revalidation: ConfirmationRevalidation,
    confirmedAt: string
  ): { project: StudioProjectV2; dispatch: ConfirmationDispatch } => {
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

    const continuityChange = revalidation.continuityChange;
    const boardPromotion = revalidation.boardPromotion;
    if (continuityChange !== null && boardPromotion !== null) {
      throw invalid('Conflicting Studio confirmation intents');
    }
    if (continuityChange !== null) {
      const shot = ownValue(project.shots, continuityChange.shotId);
      if (
        quote.originReferenceHandoffId !== null ||
        quote.cascadeItems.length !== 0 ||
        shot === undefined ||
        shot.chainBreak !== (continuityChange.hardCut ? 'none' : 'hard_cut')
      ) {
        throw invalid('Invalid Studio continuity confirmation');
      }
      const targetVideo = quote.baseItems.find(
        (item) => item.target.kind === 'shot' && item.target.shotId === shot.id && item.purpose === 'video_take'
      );
      if (targetVideo === undefined) throw invalid('Invalid Studio continuity target');
      if (continuityChange.hardCut) {
        if (continuityChange.requiresSeedGeneration) {
          const seedItem = quote.baseItems.find(
            (item) => item.target.kind === 'shot' && item.target.shotId === shot.id && item.purpose === 'seed_still'
          );
          if (
            seedItem === undefined ||
            targetVideo.requestPlan.kind !== 'after_take_selection' ||
            targetVideo.requestPlan.dependency.kind !== 'authorized_seed' ||
            targetVideo.requestPlan.dependency.upstreamItemId !== seedItem.id
          ) {
            throw invalid('Invalid Studio continuity seed graph');
          }
          shot.seedStillId = null;
        } else {
          const conditioning =
            targetVideo.requestPlan.kind === 'resolved' ? targetVideo.requestPlan.snapshot.conditioningInput : null;
          if (conditioning?.kind !== 'seed_still') throw invalid('Invalid Studio reused continuity seed');
          shot.seedStillId = conditioning.assetId;
        }
        shot.chainBreak = 'hard_cut';
      } else {
        if (
          continuityChange.requiresSeedGeneration ||
          targetVideo.requestPlan.kind !== 'after_take_selection' ||
          targetVideo.requestPlan.dependency.kind !== 'existing_predecessor'
        ) {
          throw invalid('Invalid Studio rejoin graph');
        }
        shot.chainBreak = 'none';
        shot.seedStillId = null;
      }
    }
    if (boardPromotion !== null) {
      const promotedShot = ownValue(project.shots, boardPromotion.shotId);
      const selectedTakeShotIds = currentBoardPromotionSelectedTakeShotIds(project, boardPromotion);
      if (
        quote.originReferenceHandoffId !== null ||
        quote.cascadeItems.length !== 0 ||
        promotedShot === undefined ||
        selectedTakeShotIds === null ||
        selectedTakeShotIds.length === 0 ||
        quote.baseItems.length !== selectedTakeShotIds.length ||
        quote.baseItems.some(
          (item, index) =>
            item.purpose !== 'video_take' ||
            item.target.kind !== 'shot' ||
            item.target.shotId !== selectedTakeShotIds[index]
        )
      ) {
        throw invalid('Invalid Studio Board promotion confirmation');
      }
      const promotedHeadVideo = quote.baseItems.find(
        (item) => item.target.kind === 'shot' && item.target.shotId === promotedShot.id
      );
      if (promotedHeadVideo !== undefined) {
        const conditioning =
          promotedHeadVideo.requestPlan.kind === 'resolved'
            ? promotedHeadVideo.requestPlan.snapshot.conditioningInput
            : null;
        if (conditioning?.kind !== 'seed_still' || conditioning.assetId !== boardPromotion.boardAssetId) {
          throw invalid('Invalid Studio Board promotion conditioning');
        }
      }
      promotedShot.seedStillId = boardPromotion.boardAssetId;
    }

    for (const item of items) {
      const provider = bindingByItem.get(item.id);
      const cancellationPolicy = policies.get(item.id);
      const owner =
        item.target.kind === 'shot'
          ? ownValue(project.shots, item.target.shotId)
          : ownValue(project.references, item.target.referenceId);
      if (provider === undefined || cancellationPolicy === undefined || owner === undefined) {
        throw invalid('Invalid Studio confirmation binding');
      }
      const targetKey = studioGenerationTargetKey(item.target);
      const retryPredecessors = [...owner.jobIds].toReversed().flatMap((jobId) => {
        const candidate = ownValue(project.jobs, jobId);
        if (
          candidate === undefined ||
          studioGenerationTargetKey(candidate.target) !== targetKey ||
          candidate.purpose !== item.purpose ||
          alreadyRetriedJobIds.has(candidate.id)
        ) {
          return [];
        }
        const retryReason = paidGenerationRetryReasonV2(candidate);
        return retryReason === null ? [] : [{ job: candidate, retryReason }];
      });
      if (
        item.generationCount !== 1 &&
        !(item.purpose === 'reference_image' && item.target.kind === 'reference' && item.generationCount === 2)
      ) {
        throw invalid('Invalid Studio generation count');
      }
      {
        const jobId = createJobId();
        const itemIdempotencyKeys = Array.from({ length: item.generationCount }, () => createIdempotencyKey());
        const idempotencyKey = itemIdempotencyKeys[0]!;
        if (
          !isSafeId(jobId) ||
          itemIdempotencyKeys.some((key) => !isSafeId(key)) ||
          new Set(itemIdempotencyKeys).size !== itemIdempotencyKeys.length ||
          existingJobIds.has(jobId) ||
          itemIdempotencyKeys.some((key) => existingKeys.has(key))
        ) {
          throw invalid('Invalid or duplicate Studio paid-work identity');
        }
        existingJobIds.add(jobId);
        for (const key of itemIdempotencyKeys) {
          existingKeys.add(key);
          idempotencyKeys.push({ itemId: item.id, key });
        }
        const requestSnapshot =
          item.requestPlan.kind === 'resolved' ? structuredClone(item.requestPlan.snapshot) : null;
        if (item.target.kind === 'reference' && requestSnapshot === null) {
          throw invalid('Invalid deferred Studio reference generation');
        }
        const resolved = requestSnapshot !== null;
        const retryPredecessor = retryPredecessors[0];
        const retryReason = retryPredecessor?.retryReason ?? null;
        if (retryPredecessor !== undefined) alreadyRetriedJobIds.add(retryPredecessor.job.id);
        const job: StudioJobV2 = {
          id: jobId,
          projectId: project.id,
          target: structuredClone(item.target),
          status: resolved ? 'queued_local' : 'waiting_for_conditioning',
          provider: { ...provider },
          idempotencyKey,
          providerJobId: null,
          cancellationPolicy,
          outputAssetIds: [],
          purpose: item.purpose,
          authorizationId: quote.id,
          authorizationItemId: item.id,
          composition: structuredClone(
            item.requestPlan.kind === 'resolved'
              ? item.requestPlan.snapshot.composition
              : item.requestPlan.template.composition
          ),
          requestPlan: structuredClone(item.requestPlan),
          requestSnapshot,
          spendReceipt: null,
          outputAssetIdsByRole: { primary: null, poster: null },
          error: null,
          retryOfJobId: retryPredecessor?.job.id ?? null,
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
      const owner =
        job.target.kind === 'shot'
          ? ownValue(project.shots, job.target.shotId)
          : ownValue(project.references, job.target.referenceId);
      if (owner === undefined || owner.jobIds.includes(job.id)) throw invalid('Invalid Studio job ownership');
      if (job.target.kind === 'reference') {
        if (job.purpose !== 'reference_image') {
          throw invalid('Invalid Studio project-reference job ownership');
        }
        const reference = ownValue(project.references, job.target.referenceId);
        if (reference === undefined) throw invalid('Invalid Studio project-reference job ownership');
        reference.updatedAt = confirmedAt;
      } else if (job.purpose === 'reference_image') {
        throw invalid('Invalid Studio Shot job ownership');
      }
      defineOwn(project.jobs, job.id, job);
      owner.jobIds.push(job.id);
    }
    const extractionIds: string[] = [];
    const bindingItemIds: string[] = [];
    if (continuityChange?.hardCut === false) {
      const targetVideo = quote.baseItems.find(
        (item) =>
          item.target.kind === 'shot' && item.target.shotId === continuityChange.shotId && item.purpose === 'video_take'
      );
      const dependency =
        targetVideo?.requestPlan.kind === 'after_take_selection' ? targetVideo.requestPlan.dependency : null;
      if (targetVideo === undefined || dependency?.kind !== 'existing_predecessor') {
        throw invalid('Invalid Studio rejoin extraction graph');
      }
      const extractionId = createStudioFrameExtractionId({
        shotId: dependency.predecessorShotId,
        videoAssetId: dependency.takeAssetId,
        endpointSeconds: dependency.endpointSeconds,
      });
      const existing = ownValue(project.frameExtractions, extractionId);
      if (
        existing !== undefined &&
        (existing.id !== extractionId ||
          existing.shotId !== dependency.predecessorShotId ||
          existing.videoAssetId !== dependency.takeAssetId ||
          !Object.is(existing.endpointSeconds, dependency.endpointSeconds))
      ) {
        throw invalid('Invalid Studio rejoin extraction identity');
      }
      if (existing === undefined) {
        defineOwn(project.frameExtractions, extractionId, {
          id: extractionId,
          shotId: dependency.predecessorShotId,
          videoAssetId: dependency.takeAssetId,
          endpointSeconds: dependency.endpointSeconds,
          frameAssetId: null,
          status: 'pending',
          errorCode: null,
          attemptCount: 0,
        });
      } else if (existing.status === 'failed') {
        existing.status = 'pending';
        existing.frameAssetId = null;
        existing.errorCode = null;
        existing.attemptCount = 0;
      }
      extractionIds.push(extractionId);
      bindingItemIds.push(targetVideo.id);
    }
    return {
      project,
      dispatch: {
        projectId: project.id,
        jobIds: dispatchJobIds,
        extractionIds,
        bindingItemIds,
      },
    };
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

  const retryableExtraction = (
    project: StudioProjectV2,
    dependentShotId: string
  ): { extractionId: string; status: 'failed' | 'ready'; bindingItemId: string | null } => {
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
      predecessor?.videoAssetId === null || predecessor === undefined
        ? undefined
        : ownValue(project.assets, predecessor.videoAssetId);
    if (take === undefined || take.mediaKind !== 'video' || take.durationSeconds === undefined) {
      throw invalid('Studio conditioning source is unavailable');
    }
    const endpointSeconds = take.durationSeconds - (predecessor.trimOutSeconds ?? 0);
    const extractionId = createStudioFrameExtractionId({
      shotId: predecessor.id,
      videoAssetId: take.id,
      endpointSeconds,
    });
    const extraction = ownValue(project.frameExtractions, extractionId);
    if (
      extraction === undefined ||
      (extraction.status !== 'failed' && extraction.status !== 'ready') ||
      (extraction.status === 'failed' ? extraction.frameAssetId !== null : extraction.frameAssetId === null) ||
      extraction.shotId !== predecessor.id ||
      extraction.videoAssetId !== take.id ||
      !Object.is(extraction.endpointSeconds, endpointSeconds)
    ) {
      throw invalid('Studio conditioning frame is not retryable');
    }
    const bindingItemIds = new Set(
      Object.values(project.jobs)
        .filter((job) => {
          if (
            job.target.kind !== 'shot' ||
            job.target.shotId !== dependentShotId ||
            job.status !== 'waiting_for_conditioning' ||
            job.requestSnapshot !== null ||
            job.requestPlan.kind !== 'after_take_selection'
          ) {
            return false;
          }
          const dependency = job.requestPlan.dependency;
          if (dependency.kind === 'authorized_predecessor') {
            return dependency.predecessorShotId === predecessor.id;
          }
          return (
            dependency.kind === 'existing_predecessor' &&
            dependency.predecessorShotId === predecessor.id &&
            dependency.takeAssetId === take.id &&
            Object.is(dependency.endpointSeconds, endpointSeconds)
          );
        })
        .map((job) => job.authorizationItemId)
    );
    if (workspaceRows.length === 1 && bindingItemIds.size !== 1) {
      throw invalid('Studio conditioning frame authority changed');
    }
    return {
      extractionId,
      status: extraction.status,
      bindingItemId: bindingItemIds.size === 1 ? [...bindingItemIds][0]! : null,
    };
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
          item.target.kind === 'shot' &&
          item.target.shotId === dependentShotId &&
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
      .catch((error: unknown): undefined => {
        // Swallowing stays — a failed dispatch must not break the caller — but silence does not.
        // Every job in this wave is left in queued_local, and nothing else would ever say so.
        console.warn(
          formatStudioJobLog('dispatch_failed', {
            projectId,
            count: jobIds.length,
            // A bounded name, never a message: StudioJobManagerError's message is its enum code,
            // but any other throw could carry provider text, a URL with a token, or prompt echoes.
            reason: error instanceof Error ? error.name : 'unknown',
          })
        );
        return undefined;
      });
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
      if (deleted) {
        terminalFilmRenders.delete(input.projectId);
        deps.onProjectUpdated(input.projectId);
      }
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
        refreshGenerationRoutes(),
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
        Array.isArray(input.operations) && input.operations.some((operation) => operation.kind === 'set_seed_still');
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
          } catch (error) {
            // The durable failed extraction and waiting jobs are the recoverable result, but the
            // reason for the failure lives only in the thrown error, so it is recorded here.
            logStudioConditioningFrameFailure(committed.id, extractionId, error);
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

    async importSeedStillFromPath(input): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }> {
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      assertSafeId(input.shotId, 'shot id');
      if (typeof input.sourcePath !== 'string' || input.sourcePath.length === 0) {
        throw invalid('Invalid Studio seed-still attachment');
      }
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const imported = await deps.mediaStore.importSeedStillFromPathV2({ ...input, returnProject: true });
      deps.onProjectUpdated(input.projectId);
      return { asset: structuredClone(imported.asset), project: toRendererProject(imported.project) };
    },

    async importReferenceImageFromPath(input): Promise<{
      asset: StudioAssetV2;
      project: StudioRendererProjectV2;
    }> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'referenceId', 'sourcePath'])) {
        throw invalid('Invalid Studio reference-image attachment');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      assertSafeId(input.referenceId, 'reference id');
      if (typeof input.sourcePath !== 'string' || input.sourcePath.length === 0) {
        throw invalid('Invalid Studio reference-image attachment');
      }
      if (deps.mediaStore === undefined) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const imported = await deps.mediaStore.importReferenceImageFromPathV2({ ...input, returnProject: true });
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
          : input.shape === 'film'
            ? [
                'projectId',
                'expectedRevision',
                'expectedCatalogRevision',
                'shape',
                'renderId',
                'transition',
                'trimTails',
              ]
            : ['projectId', 'expectedRevision', 'expectedCatalogRevision', 'shape'];
      if (
        !hasExactKeys(input, exactKeys) ||
        (input.shape !== 'editor_folder' &&
          input.shape !== 'still' &&
          input.shape !== 'script' &&
          input.shape !== 'film')
      ) {
        throw invalid('Invalid Studio export request');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      assertRevision(input.expectedCatalogRevision);
      if (input.shape === 'still') assertSafeId(input.shotId, 'shot id');
      if (input.shape === 'film') {
        assertSafeId(input.renderId, 'film render id');
        if (
          typeof input.trimTails !== 'boolean' ||
          !isRecord(input.transition) ||
          !(
            (hasExactKeys(input.transition, ['kind']) && input.transition.kind === 'cut') ||
            (hasExactKeys(input.transition, ['kind', 'seconds']) &&
              input.transition.kind === 'dissolve' &&
              typeof input.transition.seconds === 'number' &&
              Number.isFinite(input.transition.seconds) &&
              input.transition.seconds >= 1 / 24 &&
              input.transition.seconds <= 1)
          )
        ) {
          throw invalid('Invalid Studio film export request');
        }
      }
      assertGeneralServiceActive();

      try {
        if (input.shape === 'film') {
          if (activeFilmRenders.size > 0) {
            throw new CreativeStudioStoreError('busy', 'A Studio film export is already active');
          }
          const controller = new AbortController();
          const deadline = setTimeout(
            () => controller.abort(new StudioFilmExportErrorV2('render_failed', 'film_deadline_elapsed')),
            FILM_EXPORT_JOB_DEADLINE_MS
          );
          deadline.unref?.();
          let resolveSettled = (): void => undefined;
          const settled = new Promise<void>((resolve) => {
            resolveSettled = resolve;
          });
          const active: ActiveFilmRenderV2 = {
            renderId: input.renderId,
            controller,
            settled,
            resolveSettled,
            progress: {
              projectId: input.projectId,
              renderId: input.renderId,
              phase: 'preparing' as const,
              progress: 0,
            },
          };
          terminalFilmRenders.delete(input.projectId);
          activeFilmRenders.set(input.projectId, active);
          let rendered: Awaited<ReturnType<StudioFilmExporterV2['render']>> | null = null;
          let terminal: TerminalFilmRenderV2 | null = null;
          try {
            const captured = await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
              assertFilmJobActive(controller.signal);
              if (authority.project.revision !== input.expectedRevision) {
                throw new CreativeStudioStoreError('stale_project', 'Studio export project revision has changed');
              }
              if (deps.mediaStore === undefined) {
                throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
              }
              const initialCatalog = await exportCatalogStore.list({
                ...authority,
                assertActive: () => assertFilmJobActive(controller.signal),
              });
              if (initialCatalog.revision !== input.expectedCatalogRevision) {
                throw new CreativeStudioStoreError(
                  'stale_export_catalog',
                  'Studio export catalog revision has changed'
                );
              }
              const project = structuredClone(authority.project);
              const requiredAssetIds = deriveStudioFilmRequiredAssetIdsV2(project);
              const sourceAssets = requiredAssetIds.map((assetId) => {
                const canonical = ownValue(project.assets, assetId);
                if (canonical === undefined) {
                  throw new StudioFilmExportErrorV2('invalid_media');
                }
                return structuredClone(canonical);
              });
              await authority.assertCurrent?.();
              assertFilmJobActive(controller.signal);
              return {
                project,
                requiredAssetIds,
                sourceAssets,
                initialFilmCount: initialCatalog.artifacts.filter(({ shape }) => shape === 'film').length,
              };
            });
            const { project, requiredAssetIds, sourceAssets, initialFilmCount } = captured;
            const sources: StudioFilmVerifiedSourceV2[] = [];
            for (const sourceAsset of sourceAssets) {
              // eslint-disable-next-line no-await-in-loop -- Exact source openers are resolved after the authority callback exits.
              // Resolution opens and hashes the managed file, so cancellation may not abandon it.
              const resolved = await deps.mediaStore.resolveAssetV2(project.id, sourceAsset.id);
              assertFilmJobActive(controller.signal);
              if (resolved === null || !sameFilmSourceAsset(resolved.asset, sourceAsset)) {
                throw new StudioFilmExportErrorV2('invalid_media');
              }
              sources.push({ asset: sourceAsset, openVerifiedStream: resolved.openVerifiedStream });
            }
            rendered = await filmExporter.render({
              project: structuredClone(project),
              transition: structuredClone(input.transition),
              trimTails: input.trimTails,
              sources,
              signal: controller.signal,
              onProgress: (progress) => {
                const current = activeFilmRenders.get(input.projectId);
                if (current?.renderId === input.renderId) {
                  current.progress = { projectId: input.projectId, renderId: input.renderId, ...progress };
                }
              },
            });
            if (controller.signal.aborted) throw new StudioFilmExportErrorV2('cancelled');
            active.progress = { ...active.progress, phase: 'publishing', progress: null };
            assertFilmJobActive(controller.signal);
            const artifactId = createExportId();
            assertSafeId(artifactId, 'export id');
            const createdAt = readNow().toISOString();
            const published = await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
              assertFilmJobActive(controller.signal);
              if (authority.project.revision !== input.expectedRevision) {
                throw new CreativeStudioStoreError('stale_project', 'Studio export project revision has changed');
              }
              const currentRequiredAssetIds = deriveStudioFilmRequiredAssetIdsV2(authority.project);
              if (!isDeepStrictEqual(currentRequiredAssetIds, requiredAssetIds)) {
                throw new CreativeStudioStoreError('stale_project', 'Studio film source authority has changed');
              }
              for (const source of sources) {
                const current = ownValue(authority.project.assets, source.asset.id);
                if (current === undefined || !sameFilmSourceAsset(current, source.asset)) {
                  throw new CreativeStudioStoreError('stale_project', 'Studio film source authority has changed');
                }
                // eslint-disable-next-line no-await-in-loop -- Final publication authority fully re-hashes each exact source.
                await fullyReproveFilmSource(authority, source.asset, controller.signal);
              }
              await authority.assertCurrent?.();
              assertFilmJobActive(controller.signal);
              const catalog = await exportCatalogStore.create(
                { ...authority, assertActive: () => assertFilmJobActive(controller.signal) },
                {
                  expectedProjectRevision: input.expectedRevision,
                  expectedCatalogRevision: input.expectedCatalogRevision,
                  artifactId,
                  managedFileName: filmManagedFileName(createdAt, artifactId),
                  shape: 'film',
                  createdAt,
                  film: rendered!.facts,
                  files: [
                    {
                      kind: 'verified_stream',
                      relativePath: 'film.mp4',
                      byteSize: rendered!.byteSize,
                      sha256: rendered!.sha256,
                      openVerifiedStream: rendered!.openVerifiedStream,
                    },
                  ],
                }
              );
              const rendererCatalog = projectStudioRendererExportCatalogV2(catalog);
              const artifact = rendererCatalog.artifacts.find(
                (candidate): candidate is Extract<(typeof rendererCatalog.artifacts)[number], { shape: 'film' }> =>
                  candidate.id === artifactId && candidate.shape === 'film'
              );
              if (artifact === undefined) {
                throw new CreativeStudioStoreError('storage_error', 'Studio film artifact projection is unavailable');
              }
              terminal = {
                projectId: input.projectId,
                renderId: input.renderId,
                outcome: 'succeeded',
                artifact: structuredClone(artifact),
                movedAsideCount: Math.max(
                  0,
                  initialFilmCount + 1 - rendererCatalog.artifacts.filter(({ shape }) => shape === 'film').length
                ),
              };
              return rendererCatalog;
            });
            return published;
          } catch (error) {
            terminal = failedFilmTerminal(input.projectId, input.renderId, error);
            throw error;
          } finally {
            try {
              await rendered?.cleanup();
            } catch (error) {
              console.warn(
                formatStudioJobLog('film_export_cleanup', {
                  projectId: input.projectId,
                  renderId: input.renderId,
                  code: 'cleanup_failed',
                  reason: error instanceof Error ? error.name : 'unknown',
                })
              );
            } finally {
              clearTimeout(deadline);
              rememberFilmTerminal(
                terminal ?? {
                  projectId: input.projectId,
                  renderId: input.renderId,
                  outcome: 'failed',
                  reason: 'render_failed',
                }
              );
              if (activeFilmRenders.get(input.projectId)?.renderId === input.renderId) {
                activeFilmRenders.delete(input.projectId);
              }
              active.resolveSettled();
            }
          }
        }
        return await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
          assertGeneralServiceActive();
          if (authority.project.revision !== input.expectedRevision) {
            throw new CreativeStudioStoreError('stale_project', 'Studio export project revision has changed');
          }
          const files = await buildExportPayload(authority, input);
          assertGeneralServiceActive();
          const artifactId = createExportId();
          assertSafeId(artifactId, 'export id');
          const createdAt = readNow().toISOString();
          const catalog = await exportCatalogStore.create(
            { ...authority, assertActive: assertGeneralServiceActive },
            {
              expectedProjectRevision: input.expectedRevision,
              expectedCatalogRevision: input.expectedCatalogRevision,
              artifactId,
              managedFileName:
                input.shape === 'editor_folder' ? editorFolderManagedFileName(createdAt, artifactId) : artifactId,
              shape: input.shape,
              createdAt,
              files,
            }
          );
          return projectStudioRendererExportCatalogV2(catalog);
        });
      } catch (error) {
        if (input.shape === 'film') {
          const diagnostic = exportFailureDiagnostic(error);
          console.warn(
            formatStudioJobLog('film_export_failed', {
              projectId: input.projectId,
              renderId: input.renderId,
              ...diagnostic,
            })
          );
        }
        return rethrowExportFailure(error);
      }
    },

    async getFilmExportCapability(input): Promise<StudioFilmExportCapabilityV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio film-export capability request');
      }
      assertSafeId(input.projectId, 'project id');
      assertGeneralServiceActive();
      await loadSupported(input.projectId);
      return filmExporter.capability();
    },

    async getFilmExportStatus(input): Promise<StudioFilmExportStatusV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio film-export status request');
      }
      assertSafeId(input.projectId, 'project id');
      assertGeneralServiceActive();
      const active = activeFilmRenders.get(input.projectId) ?? activeFilmRenders.values().next().value;
      if (active !== undefined) return { status: 'active', progress: structuredClone(active.progress) };
      const terminal = terminalFilmRenders.get(input.projectId);
      return terminal === undefined ? { status: 'idle' } : { status: 'terminal', result: structuredClone(terminal) };
    },

    async cancelFilmExport(input): Promise<StudioCancelFilmExportResultV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'renderId'])) {
        throw invalid('Invalid Studio film-export cancellation request');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.renderId, 'film render id');
      const active = activeFilmRenders.get(input.projectId);
      if (active?.renderId !== input.renderId) return { status: 'not_found' };
      if (active.progress.phase === 'publishing') return { status: 'cancellation_refused' };
      active.controller.abort();
      await active.settled;
      const terminal = terminalFilmRenders.get(input.projectId);
      return terminal?.renderId === input.renderId && terminal.outcome === 'cancelled'
        ? { status: 'cancelled' }
        : { status: 'cancellation_refused' };
    },

    async acknowledgeFilmExport(input): Promise<StudioAcknowledgeFilmExportResultV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'renderId'])) {
        throw invalid('Invalid Studio film-export acknowledgement request');
      }
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.renderId, 'film render id');
      assertGeneralServiceActive();
      const terminal = terminalFilmRenders.get(input.projectId);
      if (terminal?.renderId !== input.renderId) return { status: 'not_found' };
      terminalFilmRenders.delete(input.projectId);
      return { status: 'acknowledged' };
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
      const generation = await refreshGenerationRoutes();
      const project = input.projectId === undefined ? null : await loadSupported(input.projectId);
      return toRouteCatalog(generation, project);
    },

    async getProjectStatus(input): Promise<StudioProjectStatusV2> {
      if (
        !isRecord(input) ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        (!hasExactKeys(input, ['projectId']) && !hasExactKeys(input, ['projectId', 'detail'])) ||
        (input.detail !== undefined && typeof input.detail !== 'boolean')
      ) {
        throw invalid('Invalid Studio project status request');
      }
      assertSafeId(input.projectId, 'project id');
      const detail = Object.hasOwn(input, 'detail') && input.detail === true;
      let generation: StudioGenerationRouteCatalog | null = null;
      try {
        generation = await refreshGenerationRoutes();
      } catch (error) {
        const knownInventoryFailure =
          (error instanceof CreativeStudioServiceError && error.code === 'provider_error') ||
          (error instanceof CreativeStudioStoreError && error.code === 'storage_error');
        if (!knownInventoryFailure) throw error;
      }
      const project = await loadSupported(input.projectId);
      const routes: StudioProjectStatusRouteCatalogV2 =
        generation === null
          ? { status: 'inventory_unavailable', catalogVersion: null }
          : { status: 'available', catalog: toRouteCatalog(generation, project) };
      return projectStudioStatusV2(project, routes, { detail });
    },

    async getGenerationCapability(input): Promise<StudioGenerationCapabilityV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId', 'expectedRevision', 'items'])) {
        throw invalid('Invalid Studio generation capability request');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      const project = await loadSupported(input.projectId);
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio generation capability revision is stale');
      }
      const items = orderedCapabilityItems(project, input.items);
      let generation: StudioGenerationRouteCatalog | null;
      try {
        generation = await currentGenerationRoutes();
      } catch (error) {
        if (
          (error instanceof CreativeStudioServiceError && error.code === 'provider_error') ||
          (error instanceof CreativeStudioStoreError && error.code === 'storage_error')
        ) {
          generation = null;
        } else throw error;
      }
      return deriveGenerationCapability(project, generation, items);
    },

    async getProjectWorkspace(input): Promise<StudioProjectWorkspaceLoadResultV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) {
        throw invalid('Invalid Studio project workspace request');
      }
      assertSafeId(input.projectId, 'project id');
      try {
        return await deps.store.withProjectAuthorityV2(input.projectId, async (authority) => {
          const { project } = authority;
          const verifiedReadyExtractions = new Map<string, StudioVerifiedConditioningFrameV2>();
          const mediaStore = deps.mediaStore;
          if (mediaStore !== undefined) {
            await forEachStudioReadBounded(
              projectStudioChainBoundaryVerificationIdsV2(project),
              async (extractionId) => {
                const extraction = ownValue(project.frameExtractions, extractionId);
                if (
                  extraction?.id !== extractionId ||
                  extraction.status !== 'ready' ||
                  extraction.frameAssetId === null
                ) {
                  return;
                }
                const frameAsset = ownValue(project.assets, extraction.frameAssetId);
                const shot = ownValue(project.shots, extraction.shotId);
                if (
                  frameAsset === undefined ||
                  shot === undefined ||
                  frameAsset.id !== extraction.frameAssetId ||
                  frameAsset.projectId !== project.id ||
                  frameAsset.shotId !== extraction.shotId ||
                  frameAsset.mediaKind !== 'image' ||
                  frameAsset.managedAsset.collection !== 'conditioningFrames' ||
                  !shot.assetIds.includes(frameAsset.id)
                ) {
                  return;
                }
                let resolved: Awaited<ReturnType<StudioMediaStore['resolveAssetWithProjectAuthorityV2']>>;
                try {
                  resolved = await mediaStore.resolveAssetWithProjectAuthorityV2(authority, frameAsset.id);
                } catch {
                  return;
                }
                if (
                  resolved === null ||
                  resolved.asset.id !== frameAsset.id ||
                  resolved.asset.projectId !== frameAsset.projectId ||
                  resolved.asset.shotId !== frameAsset.shotId ||
                  resolved.asset.mediaKind !== frameAsset.mediaKind ||
                  resolved.asset.mimeType !== frameAsset.mimeType ||
                  resolved.asset.byteSize !== frameAsset.byteSize ||
                  resolved.asset.sha256 !== frameAsset.sha256 ||
                  resolved.asset.managedAsset.collection !== frameAsset.managedAsset.collection ||
                  resolved.asset.managedAsset.fileName !== frameAsset.managedAsset.fileName
                ) {
                  return;
                }
                verifiedReadyExtractions.set(extractionId, {
                  extractionId: extraction.id,
                  shotId: extraction.shotId,
                  videoAssetId: extraction.videoAssetId,
                  endpointSeconds: extraction.endpointSeconds,
                  frameAssetId: frameAsset.id,
                  byteSize: frameAsset.byteSize,
                  sha256: frameAsset.sha256,
                });
              }
            );
          }
          if (authority.assertCurrent === undefined) {
            throw new CreativeStudioStoreError('storage_error', 'Studio project authority cannot be verified');
          }
          await authority.assertCurrent();
          return {
            status: 'supported',
            snapshot: {
              project: toRendererProject(project),
              workspaceStatus: projectStudioWorkspaceStatusV2(project),
              chainStatus: projectStudioChainStatusV2(project, verifiedReadyExtractions),
            },
          };
        });
      } catch (error) {
        if (
          error instanceof CreativeStudioStoreError &&
          (error.code === 'not_found' || error.code === 'unsupported_prototype_schema')
        ) {
          return { status: error.code, projectId: input.projectId };
        }
        throw error;
      }
    },

    async listProposals(input): Promise<StudioRendererProposalCatalogV2> {
      if (!isRecord(input) || !hasExactKeys(input, ['projectId'])) throw invalid('Invalid Studio proposal request');
      assertSafeId(input.projectId, 'project id');
      // The project manifest and proposal ledger use distinct durable authorities. Bracket the
      // ledger read with project snapshots so a renderer catalog can never pair proposal state
      // observed around revision R+1 with a review derived from revision R. One retry absorbs a
      // single concurrent project commit; repeated movement fails closed for the caller to retry.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const before = await loadSupported(input.projectId);
        const proposals = await deps.store.listProposalsV2(input.projectId);
        const after = await loadSupported(input.projectId);
        if (before.id !== after.id || before.revision !== after.revision) continue;
        return {
          projectId: after.id,
          projectRevision: after.revision,
          proposals: proposals.map((proposal) =>
            Object.assign(structuredClone(proposal), { review: deriveStudioProposalReviewV2(after, proposal) })
          ),
        };
      }
      throw new CreativeStudioStoreError('stale_project', 'Studio proposal catalog authority changed');
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
      const [entries, project] = await Promise.all([
        deps.store.listReferenceRequestsV2(input.projectId),
        loadSupported(input.projectId),
      ]);
      return entries
        .flatMap((entry) => {
          if (entry.decision === null) return [];
          const projected = projectStudioReferenceGenerationHandoffV2(entry.decision, entry.receipt, project);
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

    async prepareProjectReferences(input): Promise<StudioRendererPreparedSubmissionOptionsV2> {
      assertServiceActive();
      if (
        !isRecord(input) ||
        !hasExactKeys(input, ['projectId', 'expectedRevision', 'referenceIds']) ||
        !isExactDenseArray(input.referenceIds) ||
        input.referenceIds.length === 0 ||
        input.referenceIds.some((referenceId) => !isSafeId(referenceId)) ||
        new Set(input.referenceIds).size !== input.referenceIds.length
      ) {
        throw invalid('Invalid Studio project-reference preparation');
      }
      assertSafeId(input.projectId, 'project id');
      assertRevision(input.expectedRevision);
      const project = await loadSupported(input.projectId);
      if (project.id !== input.projectId || project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }

      const entries = await deps.store.listReferenceRequestsV2(project.id);
      const matchingOpenHandoffs = entries.filter(
        (entry) =>
          entry.receipt === null &&
          entry.decision?.outcome.kind === 'generation_gate' &&
          jsonEqual(entry.request.referenceIds, input.referenceIds) &&
          jsonEqual(entry.decision.outcome.referenceIds, input.referenceIds)
      );
      if (matchingOpenHandoffs.length > 1) {
        throw new CreativeStudioStoreError('storage_error', 'Ambiguous Studio reference handoff authority');
      }
      const originReferenceHandoffId =
        matchingOpenHandoffs[0]?.decision?.outcome.kind === 'generation_gate'
          ? matchingOpenHandoffs[0].decision.outcome.handoffId
          : null;
      if (
        originReferenceHandoffId !== null &&
        project.spendAuthorizations.some(
          (authorization) => authorization.originReferenceHandoffId === originReferenceHandoffId
        )
      ) {
        throw invalid('Studio reference handoff is already authorized');
      }

      try {
        preflightStudioProjectReferencePreparationV2({ project, request: input });
      } catch (error) {
        return rethrowPricingFailure(error);
      }

      let graph;
      const generation = await refreshGenerationRoutes();
      try {
        graph = deriveStudioProjectReferenceSubmissionQuoteGraphV2({
          project,
          request: input,
          resolveRoute: compositionRouteLookup(generation, project),
          originReferenceHandoffId,
        });
      } catch (error) {
        return rethrowPricingFailure(error);
      }
      return prepareQuoteGraph(project, graph, generation);
    },

    async prepareSubmission(input): Promise<StudioRendererPreparedSubmissionOptionsV2> {
      assertServiceActive();
      if (!isRecord(input)) throw invalid('Invalid Studio submission request');
      if (input.originReferenceHandoffId !== null) {
        throw invalid('Project-reference handoffs must use the reference preparation boundary');
      }
      const projectId = input.projectId;
      assertSafeId(projectId, 'project id');
      assertRevision(input.expectedRevision);
      const project = await loadSupported(projectId);
      if (project.id !== projectId || project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      try {
        preflightStudioSubmissionPreparationV2({ project, request: input });
      } catch (error) {
        return rethrowPricingFailure(error);
      }
      let graph;
      const generation = await refreshGenerationRoutes();
      try {
        graph = deriveStudioSubmissionQuoteGraphV2({
          project,
          request: input,
          resolveRoute: compositionRouteLookup(generation, project),
        });
      } catch (error) {
        return rethrowPricingFailure(error);
      }
      return prepareQuoteGraph(project, graph, generation);
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
        const confirmation: StudioProjectConfirmationInputV2<ConfirmationRevalidation, ConfirmationDispatch> = {
          projectId: input.projectId,
          expectedRevision: input.expectedRevision,
          expiresAt: claim.quote.expiresAt,
          revalidate: async (project) => {
            assertServiceActive(claim);
            const mutableProject = structuredClone(project) as StudioProjectV2;
            if (!evaluateStudioBudgetV2(quoteCore(claim.quote), mutableProject.spendPolicy).allowed) {
              throw invalid('Studio spend policy refused the quote');
            }
            const generation = await refreshGenerationRoutes();
            const resolveRoute = compositionRouteLookup(generation, mutableProject);
            let graph;
            try {
              graph = Object.hasOwn(claim.session.request, 'referenceIds')
                ? deriveStudioProjectReferenceSubmissionQuoteGraphV2({
                    project: mutableProject,
                    request: claim.session.request as StudioPrepareProjectReferencesRequestV2,
                    resolveRoute,
                    originReferenceHandoffId: claim.quote.originReferenceHandoffId,
                  })
                : deriveStudioSubmissionQuoteGraphV2({
                    project: mutableProject,
                    request: claim.session.request,
                    resolveRoute,
                  });
            } catch (error) {
              return rethrowPricingFailure(error);
            }
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
            const ordinaryRequest = Object.hasOwn(claim.session.request, 'referenceIds')
              ? null
              : (claim.session.request as StudioPrepareSubmissionRequestV2);
            if (ordinaryRequest?.continuityChange?.hardCut === false && deps.mediaStore === undefined) {
              throw new CreativeStudioStoreError('storage_error', 'Studio conditioning-frame storage is unavailable');
            }
            return {
              quote: structuredClone(claim.quote),
              providerBindings,
              cancellationPolicies,
              continuityChange: structuredClone(ordinaryRequest?.continuityChange ?? null),
              boardPromotion: structuredClone(ordinaryRequest?.boardPromotion ?? null),
            };
          },
          assertActive: () => assertServiceActive(claim),
          buildCommit: (project, revalidation, confirmedAt) =>
            buildConfirmedProject(project, structuredClone(revalidation) as ConfirmationRevalidation, confirmedAt),
          commitTag: `confirm_submission:${claim.quote.id}`,
        };
        const committed =
          claim.quote.originReferenceHandoffId === null
            ? await deps.store.confirmProjectV2<ConfirmationRevalidation, ConfirmationDispatch>(confirmation)
            : await deps.store.confirmReferenceGenerationHandoffV2<ConfirmationRevalidation, ConfirmationDispatch>({
                ...confirmation,
                handoffId: claim.quote.originReferenceHandoffId,
              });
        durable = true;
        activeClaims.delete(claim);
        try {
          preparedSubmissionCache.consume(claim);
        } catch {
          // A durable claim remains non-replayable even if cache bookkeeping is already inconsistent.
        }
        try {
          deps.onProjectUpdated(committed.project.id);
        } catch {
          // Notification is advisory and cannot turn a durable paid commit into a reported failure.
        }

        let finalProject = committed.project;
        try {
          await dispatchBoundJobs(committed.dispatch.projectId, committed.dispatch.jobIds);

          const verifiedReadyExtractions = new Map<string, StudioVerifiedConditioningFrameV2>();
          if (deps.mediaStore !== undefined) {
            for (const extractionId of committed.dispatch.extractionIds) {
              try {
                // eslint-disable-next-line no-await-in-loop -- one local decoder bounds CPU and memory.
                const extraction = await deps.mediaStore.extractConditioningFrameV2({
                  projectId: committed.project.id,
                  extractionId,
                });
                if (extraction.status === 'ready') {
                  // eslint-disable-next-line no-await-in-loop -- verification is bound to the exact completed extraction.
                  const verification = await deps.mediaStore.verifyConditioningFrameV2({
                    projectId: committed.project.id,
                    extractionId: extraction.id,
                  });
                  if (verification !== null) verifiedReadyExtractions.set(verification.extractionId, verification);
                }
              } catch (error) {
                logStudioConditioningFrameFailure(committed.project.id, extractionId, error);
              }
            }
          }
          if (verifiedReadyExtractions.size > 0) {
            let boundAfterExtraction: StudioWaitingBindingAdvanceV2 = {
              dispatchJobIds: [],
              extractionIds: [],
              projectChanged: false,
            };
            finalProject = await deps.store.updateProjectV2(
              committed.project.id,
              (project) => {
                boundAfterExtraction = advanceStudioWaitingBindingsV2(
                  project,
                  readNow().toISOString(),
                  verifiedReadyExtractions,
                  new Set(committed.dispatch.bindingItemIds)
                );
                return project;
              },
              undefined,
              `bind_conditioning:${claim.quote.id}`
            );
            try {
              deps.onProjectUpdated(finalProject.id);
            } catch {
              // Recovery and durable state do not depend on renderer notification delivery.
            }
            await dispatchBoundJobs(finalProject.id, boundAfterExtraction.dispatchJobIds);
          } else if (committed.dispatch.extractionIds.length > 0) {
            finalProject = await loadSupported(committed.project.id);
          }
        } catch {
          // Once confirmation is durable, recovery owns every queued job and pending extraction.
        }
        return { projectId: finalProject.id, projectRevision: finalProject.revision };
      } catch (error) {
        activeClaims.delete(claim);
        if (!durable) preparedSubmissionCache.release(claim);
        if (error instanceof StudioProjectConfirmationError && error.code === 'expired_confirmation') {
          throw cacheFailure('quote_not_found');
        }
        throw error;
      }
    },

    async retryConditioningFrame(input, commitTag): Promise<StudioRendererWorkspaceStatusV2> {
      assertServiceActive();
      assertBarrierRequest(input);
      if (commitTag !== undefined) assertSafeId(commitTag, 'commit tag');
      // A tagged Director recovery publishes one durable command receipt before notifying.
      const notifyDirectly = commitTag === undefined;
      const loaded = await loadSupported(input.projectId);
      if (loaded.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      const candidate = retryableExtraction(loaded, input.dependentShotId);
      const mediaStore = deps.mediaStore;
      let readyVerification: StudioVerifiedConditioningFrameV2 | null = null;
      if (candidate.status === 'ready') {
        if (mediaStore === undefined) {
          throw new CreativeStudioStoreError('storage_error', 'Studio conditioning-frame storage is unavailable');
        }
        try {
          readyVerification = await mediaStore.verifyConditioningFrameV2({
            projectId: input.projectId,
            extractionId: candidate.extractionId,
          });
        } catch (error) {
          if (error instanceof CreativeStudioMediaError) throw error;
          throw new CreativeStudioStoreError('storage_error', 'Studio conditioning-frame verification failed');
        }
        if (readyVerification !== null && candidate.bindingItemId === null) {
          throw invalid('Studio conditioning frame has no exact waiting owner');
        }
      }
      const committed = await deps.store.updateProjectV2(
        input.projectId,
        (project) => {
          const current = retryableExtraction(project, input.dependentShotId);
          if (
            current.extractionId !== candidate.extractionId ||
            current.status !== candidate.status ||
            current.bindingItemId !== candidate.bindingItemId
          ) {
            throw invalid('Studio conditioning frame authority changed');
          }
          const extraction = ownValue(project.frameExtractions, current.extractionId)!;
          if (current.status === 'failed') {
            extraction.status = 'pending';
            extraction.frameAssetId = null;
            extraction.errorCode = null;
            extraction.attemptCount = 0;
          }
          return project;
        },
        input.expectedRevision,
        commitTag ?? `retry_conditioning_frame:${input.dependentShotId}`
      );
      if (notifyDirectly) deps.onProjectUpdated(committed.id);
      if (candidate.status === 'ready' && mediaStore !== undefined) {
        try {
          let verification = readyVerification;
          if (verification === null) {
            const repairedExtraction = await mediaStore.extractConditioningFrameV2({
              projectId: committed.id,
              extractionId: candidate.extractionId,
            });
            verification =
              repairedExtraction.status === 'ready'
                ? await mediaStore.verifyConditioningFrameV2({
                    projectId: committed.id,
                    extractionId: candidate.extractionId,
                  })
                : null;
          }
          const bindingItemId = candidate.bindingItemId;
          if (verification !== null && bindingItemId !== null) {
            let boundAdvance: StudioWaitingBindingAdvanceV2 = {
              dispatchJobIds: [],
              extractionIds: [],
              projectChanged: false,
            };
            const bound = await deps.store.updateProjectV2(
              committed.id,
              (project) => {
                boundAdvance = advanceStudioWaitingBindingsV2(
                  project,
                  readNow().toISOString(),
                  new Map([[verification.extractionId, verification]]),
                  new Set([bindingItemId])
                );
                return project;
              },
              undefined,
              `bind_conditioning_retry:${input.dependentShotId}`
            );
            if (notifyDirectly) deps.onProjectUpdated(bound.id);
            await dispatchBoundJobs(bound.id, boundAdvance.dispatchJobIds);
            return projectStudioWorkspaceStatusV2(bound);
          }
          const repaired = await loadSupported(committed.id);
          if (notifyDirectly) deps.onProjectUpdated(repaired.id);
          return projectStudioWorkspaceStatusV2(repaired);
        } catch (error) {
          logStudioConditioningFrameFailure(committed.id, candidate.extractionId, error);
        }
      }
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
      } catch (error) {
        return rethrowLocalInventoryFailure(error, 'Studio provider inventory is unavailable');
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
      const validation = await validateConnectionBinding(input);
      if (validation.valid === false) return { valid: false, reason: validation.reason };
      return { valid: true, connection: toConnectionValidation(validation.binding) };
    },

    async saveConnection(input): Promise<StudioConnectionRecord> {
      const validated = await validateConnectionBinding(input);
      if (validated.valid === false) throw new StudioConnectionValidationError(validated.reason);
      const binding: StudioConnectionBinding = {
        ...validated.binding,
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
      for (const active of activeFilmRenders.values()) active.controller.abort();
      activeFilmRenders.clear();
      terminalFilmRenders.clear();
      filmExporter.dispose();
      activeClaims.clear();
      preparedSubmissionCache.close();
    },
  };
};
