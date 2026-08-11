/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  CreateStudioProjectInput,
  ProposeStudioStoryboardInput,
  StudioBindBriefConversationRequest,
  StudioCut,
  StudioCutClip,
  StudioDismissReferenceRequestsRequest,
  StudioEditableCut,
  StudioEditableCutClip,
  StudioEditableScene,
  StudioProject,
  StudioProjectSummary,
  StudioProposal,
  StudioProposalAcceptance,
  StudioProposalDiff,
  StudioProposalPayload,
  StudioProposalRequest,
  StudioReferenceRequest,
  StudioProjectRequest,
  StudioPersistCapturedPosterRequest,
  StudioPlaceCutScenesRequest,
  StudioScene,
  StudioSelectAssetRequest,
  StudioUpdateProjectRequest,
  StudioUpdateCutRequest,
  StudioUpdateSceneRequest,
  StudioReorderScenesRequest,
  StudioDeleteProjectRequest,
  StudioAsset,
  StudioConnectionBinding,
  StudioConnectionCandidate,
  StudioConnectionInventory,
  StudioConnectionRecord,
  StudioConnectionValidationResult,
  StudioExportItem,
  StudioListRoutesRequest,
  StudioLatestRender,
  StudioRemoveConnectionRequest,
  StudioRouteCatalog,
  StudioSaveConnectionRequest,
  StudioValidateConnectionRequest,
  StudioJob,
  StudioRendererJob,
  StudioRendererProject,
  StudioJobRequest,
  StudioRetryDownloadRequest,
  StudioRetryJobRequest,
  StudioSubmitScenesRequest,
  StudioFitStoryboardOutcome,
  StudioFitStoryboardRequest,
  StudioModelAvailability,
  StudioMediaChoiceRef,
  StudioProviderRef,
  StudioRouteCatalogEntry,
  StudioTextModelOption,
  StudioTextModelRef,
  StudioUpdateModelSelectionRequest,
} from '@/common/types/project/creativeStudioTypes';
import type { ISessionMcpServer } from '@/common/config/storage';
import { STUDIO_ENV } from '@/common/types/project/creativeStudioMcpEnv';
import { isCanonicalStudioGeneratedTake } from '@/common/types/project/creativeStudioCanonicalTake';
import { requestedMediaKind } from '@/common/types/project/creativeStudioOutputRole';
import { computeStudioProposalDiff } from '@/common/types/project/creativeStudioProposalDiff';
import { BUILTIN_STUDIO_NAME } from '@process/resources/builtinMcp/constants';
import {
  CreativeStudioStoreError,
  reconcilePersistedStudioCuts,
  resolveStudioCutState,
  type CreativeStudioStore,
} from '@process/services/creative-studio/store';
import type {
  StudioGenerationRoute,
  StudioGenerationRouteCatalog,
  StudioProviderResolver,
} from '@process/services/creative-studio/providerResolver';
import { createStudioMediaChoiceId } from '@process/services/creative-studio/providerResolver';
import type { GenerationProviderAdapterRegistry } from '@process/services/creative-studio/adapters';
import { ProviderDeadlineError, runWithProviderDeadline } from '@process/services/creative-studio/adapters/types';
import { canCancelJob, type StudioJobManager } from '@process/services/creative-studio/jobManager';
import type { IProvider } from '@/common/config/storage';
import { createHash, randomUUID } from 'node:crypto';
import { isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import {
  StudioStoryboardPlannerError,
  type StudioStoryboardPlanner,
} from '@process/services/creative-studio/planning/storyboardPlanner';
import { fitStoryboardDurations } from '@process/services/creative-studio/planning/fitStoryboardDurations';
import { Readable } from 'node:stream';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const MEDIA_KINDS = new Set(['image', 'video']);
const CONNECTION_VALIDATION_TIMEOUT_MS = 30_000;
const UPDATABLE_PROJECT_FIELDS = ['name', 'brief', 'aspectRatio', 'targetDurationSeconds', 'resolution'] as const;
type UpdatableProjectField = (typeof UPDATABLE_PROJECT_FIELDS)[number];
const EDITABLE_CUT_KEYS = new Set(['orderMode', 'clipOrder', 'clips']);
const EDITABLE_CUT_CLIP_KEYS = new Set(['sourceInSeconds', 'sourceOutSeconds', 'crop', 'filters']);
const NORMALISED_RECT_KEYS = new Set(['x', 'y', 'width', 'height']);
const CUT_FILTER_KEYS = new Set(['id', 'amount']);
const CUT_FILTER_IDS = new Set(['exposure', 'contrast', 'saturation', 'temperature']);
const NONTERMINAL_JOB_STATUSES: ReadonlySet<StudioJob['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
  'needs_attention',
]);
const ACTIVE_GENERATION_JOB_STATUSES: ReadonlySet<StudioJob['status']> = new Set([
  'queued_local',
  'submitting',
  'queued_remote',
  'running',
]);
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

export type CreativeStudioService = {
  listProjects(): Promise<StudioProjectSummary[]>;
  createProject(input: CreateStudioProjectInput): Promise<StudioRendererProject>;
  getProject(projectId: string): Promise<StudioRendererProject | null>;
  getLatestRender(input: StudioProjectRequest): Promise<StudioLatestRender | null>;
  getBriefSessionServer(input: StudioProjectRequest): Promise<ISessionMcpServer>;
  listProposals(input: StudioProjectRequest): Promise<StudioProposal[]>;
  listPendingReferenceRequests(input: StudioProjectRequest): Promise<StudioReferenceRequest[]>;
  dismissReferenceRequests(input: StudioDismissReferenceRequestsRequest): Promise<boolean>;
  acceptProposal(input: StudioProposalRequest): Promise<StudioProposalAcceptance>;
  rejectProposal(input: StudioProposalRequest): Promise<StudioProposal>;
  proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioRendererProject>;
  updateProject(input: StudioUpdateProjectRequest): Promise<StudioRendererProject>;
  bindBriefConversation(input: StudioBindBriefConversationRequest): Promise<StudioRendererProject>;
  updateCut(input: StudioUpdateCutRequest): Promise<StudioRendererProject>;
  placeCutScenes(input: StudioPlaceCutScenesRequest): Promise<StudioRendererProject>;
  deleteProject(input: StudioDeleteProjectRequest): Promise<boolean>;
  updateScene(input: StudioUpdateSceneRequest): Promise<StudioRendererProject>;
  reorderScenes(input: StudioReorderScenesRequest): Promise<StudioRendererProject>;
  selectAsset(input: StudioSelectAssetRequest): Promise<StudioRendererProject>;
  persistCapturedPoster(input: StudioPersistCapturedPosterRequest): Promise<StudioAsset>;
  fitStoryboard(input: StudioFitStoryboardRequest): Promise<StudioFitStoryboardOutcome>;
  submitScenes(input: StudioSubmitScenesRequest): Promise<StudioRendererJob[]>;
  cancelJob(input: StudioJobRequest): Promise<StudioRendererJob>;
  retryJob(input: StudioRetryJobRequest): Promise<StudioRendererJob>;
  retryDownload(input: StudioRetryDownloadRequest): Promise<StudioRendererJob>;
  importReferenceFromPath(input: {
    projectId: string;
    sceneId?: string;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<StudioAsset>;
  exportAssetsToDirectory(input: {
    projectId: string;
    destinationDirectory: string;
    includeReferences: boolean;
  }): Promise<{ folderName: string; exported: StudioExportItem[]; missingSceneIds: string[] }>;
  listConnectionCandidates(): Promise<StudioConnectionCandidate[]>;
  listConnections(): Promise<StudioConnectionInventory>;
  validateConnection(input: StudioValidateConnectionRequest): Promise<StudioConnectionValidationResult>;
  saveConnection(input: StudioSaveConnectionRequest): Promise<StudioConnectionRecord>;
  removeConnection(input: StudioRemoveConnectionRequest): Promise<boolean>;
  listRoutes(input?: StudioListRoutesRequest): Promise<StudioRouteCatalog>;
  updateModelSelection(input: StudioUpdateModelSelectionRequest): Promise<StudioRendererProject>;
};

export type CreativeStudioServiceDeps = {
  store: CreativeStudioStore;
  onProjectUpdated: (projectId: string) => void;
  storyboardPlanner: StudioStoryboardPlanner;
  createSceneId?: () => string;
  createConnectionId?: () => string;
  getStudioServerScriptPath?: () => string;
  providerResolver?: StudioProviderResolver;
  validateConnection?: (input: StudioInternalConnectionRequest) => Promise<StudioConnectionBinding>;
  listProviders?: () => Promise<IProvider[]>;
  adapterRegistry?: GenerationProviderAdapterRegistry;
  jobManager?: StudioJobManager;
  mediaStore?: {
    importReferenceFromPath(input: {
      projectId: string;
      sceneId?: string;
      expectedRevision: number;
      sourcePath: string;
    }): Promise<StudioAsset>;
    exportAssetsToDirectory(input: {
      projectId: string;
      destinationDirectory: string;
      includeReferences: boolean;
    }): Promise<{ folderName: string; exported: StudioExportItem[]; missingSceneIds: string[] }>;
    getLatestProjectOutput(projectId: string): Promise<StudioAsset | null>;
    persistCapturedPoster?(input: {
      projectId: string;
      sceneId: string;
      videoAssetId: string;
      width: number;
      height: number;
      declaredByteSize: number;
      body: AsyncIterable<Uint8Array>;
    }): Promise<StudioAsset>;
  };
};

type StudioInternalConnectionRequest = {
  providerId: string;
  adapterId: StudioConnectionBinding['adapterId'];
  model: string;
};

/** A safe, stable service error that can cross only through the bridge error mapper. */
export class CreativeStudioServiceError extends Error {
  readonly code:
    | 'invalid_payload'
    | 'storyboard_exists'
    | 'planning_unavailable'
    | 'busy'
    | 'provider_error'
    | 'invalid_route';

  constructor(code: CreativeStudioServiceError['code']) {
    super(code);
    this.name = 'CreativeStudioServiceError';
    this.code = code;
  }
}

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const isUnsafeTextCharacter = (character: string): boolean => {
  const codePoint = character.codePointAt(0)!;
  return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff);
};

const isSafeCatalogModel = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 256 &&
  value === value.trim() &&
  !Array.from(value).some(isUnsafeTextCharacter);

const sanitizedCatalogProviderName = (value: unknown, providerId: string): string => {
  if (typeof value !== 'string') return providerId;
  const normalized = Array.from(value, (character) => (isUnsafeTextCharacter(character) ? ' ' : character))
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 256);
  return normalized || providerId;
};

const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  Number.isInteger(value) &&
  value >= minimum &&
  value <= maximum;

const invalid = (message: string): CreativeStudioStoreError => new CreativeStudioStoreError('invalid_payload', message);

const cutClipEditChanged = (current: StudioCutClip, edit: StudioEditableCutClip): boolean => {
  const currentFilters = current.filters
    .filter((filter) => filter.amount !== 0)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const editedFilters = edit.filters
    .filter((filter) => filter.amount !== 0)
    .toSorted((left, right) => left.id.localeCompare(right.id));
  const cropChanged =
    current.crop === null || edit.crop === null
      ? current.crop !== edit.crop
      : current.crop.x !== edit.crop.x ||
        current.crop.y !== edit.crop.y ||
        current.crop.width !== edit.crop.width ||
        current.crop.height !== edit.crop.height;
  return (
    current.sourceInSeconds !== edit.sourceInSeconds ||
    current.sourceOutSeconds !== edit.sourceOutSeconds ||
    cropChanged ||
    currentFilters.length !== editedFilters.length ||
    currentFilters.some(
      (filter, index) => filter.id !== editedFilters[index]?.id || filter.amount !== editedFilters[index]?.amount
    )
  );
};

const assertSafeId: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (!isSafeId(value)) throw invalid(`Invalid Studio ${label}`);
};

const assertText: (value: unknown, maximum: number, label: string, required?: boolean) => asserts value is string = (
  value,
  maximum,
  label,
  required = false
) => {
  if (typeof value !== 'string' || value.length > maximum || (required && value.trim().length === 0)) {
    throw invalid(`Invalid Studio ${label}`);
  }
};

const assertExpectedRevision: (value: unknown) => asserts value is number = (value) => {
  if (!isIntegerInRange(value, 1, Number.MAX_SAFE_INTEGER)) throw invalid('Invalid Studio project revision');
};

const CAPTURED_POSTER_DATA_URL_PREFIX = 'data:image/png;base64,';
const CAPTURED_POSTER_MAX_BYTES = 50 * 1024 * 1024;
const CAPTURED_POSTER_MAX_BASE64_LENGTH = Math.ceil(CAPTURED_POSTER_MAX_BYTES / 3) * 4;

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

const applyProjectUpdateField = <Field extends UpdatableProjectField>(
  project: StudioProject,
  input: StudioUpdateProjectRequest,
  field: Field
): void => {
  switch (field) {
    case 'name':
      if (input.name !== undefined) project.name = input.name;
      break;
    case 'brief':
      if (input.brief !== undefined) project.brief = input.brief;
      break;
    case 'aspectRatio':
      if (input.aspectRatio !== undefined) project.aspectRatio = input.aspectRatio;
      break;
    case 'targetDurationSeconds':
      if (input.targetDurationSeconds !== undefined) project.targetDurationSeconds = input.targetDurationSeconds;
      break;
    case 'resolution':
      if (input.resolution !== undefined) project.resolution = input.resolution;
      break;
  }
};

const providerIsAvailable = (provider: IProvider, model: string, requireListedModel = true): boolean =>
  provider.enabled !== false &&
  provider.model_enabled?.[model] !== false &&
  provider.model_health?.[model]?.status !== 'unhealthy' &&
  typeof provider.api_key === 'string' &&
  provider.api_key.trim().length > 0 &&
  typeof provider.base_url === 'string' &&
  provider.base_url.trim().length > 0 &&
  (!requireListedModel || provider.models.includes(model));

const sanitizedCapabilities = (
  adapterId: StudioInternalConnectionRequest['adapterId'],
  model: string,
  capabilities: Record<string, unknown> | undefined
): StudioConnectionBinding['capabilities'] => {
  if (adapterId === 'weprompt-image-v1') {
    return { mediaKinds: ['image'], supportsFirstFrame: !isImagesApiModel(model), cancellationPolicy: 'none' };
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
      cancellationPolicy: 'queued_only',
      ...constraints,
    };
  }
  const ratios = Array.isArray(capabilities?.aspectRatios)
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
    ...(ratios && ratios.length > 0 ? { aspectRatios: ratios } : {}),
    ...(resolutions && resolutions.length > 0 ? { resolutions } : {}),
    ...(isIntegerInRange(minimum, 1, 60) ? { minDurationSeconds: minimum } : {}),
    ...(isIntegerInRange(maximum, 1, 60) ? { maxDurationSeconds: maximum } : {}),
    supportsFirstFrame: capabilities?.supportsFirstFrame === true,
    cancellationPolicy:
      capabilities?.cancellationPolicy === 'queued_only' || capabilities?.cancellationPolicy === 'queued_and_running'
        ? capabilities.cancellationPolicy
        : 'none',
  };
};

const plannerError = (error: unknown): CreativeStudioServiceError => {
  if (error instanceof StudioStoryboardPlannerError) {
    switch (error.code) {
      case 'model_unavailable':
        return new CreativeStudioServiceError('planning_unavailable');
      case 'busy':
        return new CreativeStudioServiceError('busy');
      default:
        return new CreativeStudioServiceError('provider_error');
    }
  }
  return new CreativeStudioServiceError('provider_error');
};

const assertProjectInput = (input: CreateStudioProjectInput): void => {
  assertText(input.name, 256, 'project name', true);
  assertText(input.brief, 16 * 1024, 'project brief');
  if (input.forgeProjectId !== undefined) assertSafeId(input.forgeProjectId, 'Forge project id');
  if (!ASPECT_RATIOS.has(input.aspectRatio)) throw invalid('Invalid Studio aspect ratio');
  if (!isIntegerInRange(input.targetDurationSeconds, 5, 60)) throw invalid('Invalid Studio target duration');
  if (!RESOLUTIONS.has(input.resolution)) throw invalid('Invalid Studio resolution');
};

const assertJobRequest = (input: StudioJobRequest): void => {
  assertSafeId(input.projectId, 'project id');
  assertSafeId(input.jobId, 'job id');
  assertExpectedRevision(input.expectedRevision);
};

const assertSubmitScenesInput = (input: StudioSubmitScenesRequest): void => {
  assertSafeId(input.projectId, 'project id');
  assertExpectedRevision(input.expectedRevision);
  if (input.mode !== 'single' && input.mode !== 'batch') throw invalid('Invalid Studio generation mode');
  assertText(input.catalogVersion, 64, 'route catalog version', true);
  if (
    !Array.isArray(input.sceneIds) ||
    input.sceneIds.length < 1 ||
    input.sceneIds.length > 24 ||
    input.sceneIds.some((sceneId) => !isSafeId(sceneId)) ||
    new Set(input.sceneIds).size !== input.sceneIds.length ||
    !Array.isArray(input.routes) ||
    input.routes.length !== input.sceneIds.length
  ) {
    throw invalid('Invalid Studio generation scene selection');
  }
  const selectedSceneIds = new Set(input.sceneIds);
  const routedSceneIds = new Set<string>();
  for (const route of input.routes) {
    if (
      !isSafeId(route.sceneId) ||
      !selectedSceneIds.has(route.sceneId) ||
      routedSceneIds.has(route.sceneId) ||
      !isSafeId(route.choiceId) ||
      !MEDIA_KINDS.has(route.kind)
    ) {
      throw invalid('Invalid Studio generation route');
    }
    routedSceneIds.add(route.sceneId);
  }
};

const assertFitStoryboardInput = (input: StudioFitStoryboardRequest): void => {
  assertSafeId(input.projectId, 'project id');
  assertExpectedRevision(input.expectedRevision);
  if (!/^[a-f0-9]{16}$/.test(input.catalogVersion)) throw invalid('Invalid Studio route catalog version');
};

const batchSceneIsReady = (project: StudioProject, sceneId: string): boolean => {
  const scene = project.scenes[sceneId];
  if (
    scene?.id !== sceneId ||
    !project.sceneOrder.includes(sceneId) ||
    scene.title.trim().length === 0 ||
    scene.visualPrompt.trim().length === 0
  ) {
    return false;
  }
  const jobs = scene.jobIds.flatMap((jobId) => {
    const job = project.jobs[jobId];
    return job?.id === jobId && job.projectId === project.id && job.sceneId === scene.id ? [job] : [];
  });
  if (jobs.some((job) => ACTIVE_GENERATION_JOB_STATUSES.has(job.status))) return false;
  const hasGeneratedAsset = scene.assetIds.some((assetId) => {
    const asset = project.assets[assetId];
    return (
      asset?.id === assetId &&
      asset.projectId === project.id &&
      asset.sceneId === scene.id &&
      asset.mediaKind === scene.mediaKind &&
      asset.managedAsset.collection === 'assets'
    );
  });
  if (hasGeneratedAsset) return false;
  const latestJob = jobs.at(-1);
  return latestJob?.status !== 'failed' && latestJob?.status !== 'needs_attention';
};

const assertScene = (scene: StudioEditableScene): void => {
  assertText(scene.title, 256, 'scene title');
  assertText(scene.purpose, 256, 'scene purpose');
  assertText(scene.visualPrompt, 8 * 1024, 'scene visual prompt');
  assertText(scene.narration, 4 * 1024, 'scene narration');
  assertText(scene.onScreenText, 1024, 'scene on-screen text');
  if (!MEDIA_KINDS.has(scene.mediaKind)) throw invalid('Invalid Studio scene media kind');
  if (!isIntegerInRange(scene.durationSeconds, 1, 60)) throw invalid('Invalid Studio scene duration');
  if (scene.referenceAssetId !== null) assertSafeId(scene.referenceAssetId, 'reference asset id');
};

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: JsonRecord, keys: ReadonlySet<string>): boolean =>
  Object.keys(value).length === keys.size && Object.keys(value).every((key) => keys.has(key));

const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum;

const trimPointIsValid = (value: unknown): value is number | null =>
  value === null || (typeof value === 'number' && Number.isFinite(value) && value >= 0);

const placedClipIdSuffix = (value: number | null): string => (value === null ? '' : `_${value}`);

const allocatePlacedClipId = (sceneId: string, occupied: ReadonlySet<string>): string => {
  const candidate = (value: number | null): string =>
    `clip_${sceneId}`.slice(0, 256 - placedClipIdSuffix(value).length) + placedClipIdSuffix(value);
  if (!occupied.has(candidate(null))) return candidate(null);
  let sequence = 2;
  while (occupied.has(candidate(sequence))) sequence += 1;
  return candidate(sequence);
};

const assertEditableCut: (value: unknown) => asserts value is StudioEditableCut = (value) => {
  if (
    !isRecord(value) ||
    !isRecord(value.clips) ||
    !hasExactKeys(value, EDITABLE_CUT_KEYS) ||
    (value.orderMode !== 'storyboard' && value.orderMode !== 'manual') ||
    !Array.isArray(value.clipOrder) ||
    value.clipOrder.some((clipId) => !isSafeId(clipId)) ||
    new Set(value.clipOrder).size !== value.clipOrder.length
  ) {
    throw invalid('Invalid Studio cut edit');
  }
  for (const [clipId, candidate] of Object.entries(value.clips)) {
    if (!isSafeId(clipId) || !isRecord(candidate) || !hasExactKeys(candidate, EDITABLE_CUT_CLIP_KEYS)) {
      throw invalid('Invalid Studio cut clip edit');
    }
    const sourceIn = candidate.sourceInSeconds;
    const sourceOut = candidate.sourceOutSeconds;
    if (
      !trimPointIsValid(sourceIn) ||
      !trimPointIsValid(sourceOut) ||
      (sourceIn !== null && sourceOut !== null && sourceIn >= sourceOut)
    ) {
      throw invalid('Invalid Studio cut trim');
    }
    if (candidate.crop !== null) {
      if (
        !isRecord(candidate.crop) ||
        !hasExactKeys(candidate.crop, NORMALISED_RECT_KEYS) ||
        !isFiniteInRange(candidate.crop.x, 0, 1) ||
        !isFiniteInRange(candidate.crop.y, 0, 1) ||
        !isFiniteInRange(candidate.crop.width, 0, 1) ||
        candidate.crop.width <= 0 ||
        !isFiniteInRange(candidate.crop.height, 0, 1) ||
        candidate.crop.height <= 0 ||
        candidate.crop.x + candidate.crop.width > 1 ||
        candidate.crop.y + candidate.crop.height > 1
      ) {
        throw invalid('Invalid Studio cut crop');
      }
    }
    if (!Array.isArray(candidate.filters)) throw invalid('Invalid Studio cut filters');
    const filterIds: string[] = [];
    for (const filter of candidate.filters) {
      if (
        !isRecord(filter) ||
        !hasExactKeys(filter, CUT_FILTER_KEYS) ||
        typeof filter.id !== 'string' ||
        !CUT_FILTER_IDS.has(filter.id) ||
        !isFiniteInRange(filter.amount, -1, 1)
      ) {
        throw invalid('Invalid Studio cut filter');
      }
      filterIds.push(filter.id);
    }
    if (new Set(filterIds).size !== filterIds.length) throw invalid('Duplicate Studio cut filter');
  }
};

const mediaKindForProviderRef = (provider: StudioProviderRef): 'image' | 'video' =>
  provider.adapterId === 'weprompt-image-v1' ? 'image' : 'video';

const toRendererMediaChoice = (
  provider: StudioProviderRef,
  kind: 'image' | 'video' = mediaKindForProviderRef(provider)
): StudioMediaChoiceRef => ({
  choiceId: createStudioMediaChoiceId({ ...provider, kind }),
  providerId: provider.providerId,
  model: provider.model,
});

const toRendererJob = (job: StudioJob): StudioRendererJob => ({
  id: job.id,
  projectId: job.projectId,
  sceneId: job.sceneId,
  status: job.status,
  provider: toRendererMediaChoice(job.provider),
  outputAssetIds: [...job.outputAssetIds],
  error: job.error === null ? null : { ...job.error },
  canCancel: canCancelJob(job),
  canRetryDownload: job.status === 'failed' && job.error?.code === 'download_failed' && job.providerJobId !== null,
  ...(job.progress === undefined ? {} : { progress: job.progress }),
  retryOfJobId: job.retryOfJobId,
  retryReason: job.retryReason,
  duplicateChargeAcknowledged: job.duplicateChargeAcknowledged,
  duplicateChargeAcknowledgedAt: job.duplicateChargeAcknowledgedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const toRendererScene = (scene: StudioScene): StudioScene => ({
  id: scene.id,
  title: scene.title,
  purpose: scene.purpose,
  visualPrompt: scene.visualPrompt,
  narration: scene.narration,
  onScreenText: scene.onScreenText,
  mediaKind: scene.mediaKind,
  durationSeconds: scene.durationSeconds,
  referenceAssetId: scene.referenceAssetId,
  selectedAssetId: scene.selectedAssetId,
  assetIds: [...scene.assetIds],
  jobIds: [...scene.jobIds],
  reviewState: scene.reviewState,
});

const toRendererAsset = (asset: StudioAsset): StudioAsset => ({
  id: asset.id,
  projectId: asset.projectId,
  sceneId: asset.sceneId,
  mediaKind: asset.mediaKind,
  mimeType: asset.mimeType,
  managedAsset: { ...asset.managedAsset },
  byteSize: asset.byteSize,
  sha256: asset.sha256,
  ...(asset.width === undefined ? {} : { width: asset.width }),
  ...(asset.height === undefined ? {} : { height: asset.height }),
  ...(asset.durationSeconds === undefined ? {} : { durationSeconds: asset.durationSeconds }),
  ...(asset.sourceVisualPrompt === undefined ? {} : { sourceVisualPrompt: asset.sourceVisualPrompt }),
  createdAt: asset.createdAt,
});

const toRendererCut = (cut: StudioCut): StudioCut => ({
  id: cut.id,
  name: cut.name,
  orderMode: cut.orderMode,
  clipOrder: [...cut.clipOrder],
  clips: Object.fromEntries(
    Object.entries(cut.clips).map(([clipId, clip]) => [
      clipId,
      {
        id: clip.id,
        sceneId: clip.sceneId,
        assetId: clip.assetId,
        sourceInSeconds: clip.sourceInSeconds,
        sourceOutSeconds: clip.sourceOutSeconds,
        crop: clip.crop === null ? null : { ...clip.crop },
        filters: clip.filters.map((filter) => ({ ...filter })),
      },
    ])
  ),
});

const toRendererProject = (project: StudioProject): StudioRendererProject => {
  const cutState = resolveStudioCutState(project);
  return {
    schemaVersion: project.schemaVersion,
    revision: project.revision,
    id: project.id,
    name: project.name,
    brief: project.brief,
    ...(project.forgeProjectId === undefined ? {} : { forgeProjectId: project.forgeProjectId }),
    briefConversationId: project.briefConversationId ?? null,
    aspectRatio: project.aspectRatio,
    targetDurationSeconds: project.targetDurationSeconds,
    resolution: project.resolution,
    sceneOrder: [...project.sceneOrder],
    scenes: Object.fromEntries(
      Object.entries(project.scenes).map(([sceneId, scene]) => [sceneId, toRendererScene(scene)])
    ),
    cuts: Object.fromEntries(Object.entries(cutState.cuts).map(([cutId, cut]) => [cutId, toRendererCut(cut)])),
    activeCutId: cutState.activeCutId,
    assets: Object.fromEntries(
      Object.entries(project.assets).map(([assetId, asset]) => [assetId, toRendererAsset(asset)])
    ),
    jobs: Object.fromEntries(Object.entries(project.jobs).map(([jobId, job]) => [jobId, toRendererJob(job)])),
    routing: {
      storyboard: project.routing.storyboard === null ? null : { ...project.routing.storyboard },
      image: project.routing.image === null ? null : toRendererMediaChoice(project.routing.image, 'image'),
      video: project.routing.video === null ? null : toRendererMediaChoice(project.routing.video, 'video'),
    },
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
  };
};

const toRendererProposal = (proposal: StudioProposal, diff?: StudioProposalDiff): StudioProposal => ({
  schemaVersion: proposal.schemaVersion,
  id: proposal.id,
  projectId: proposal.projectId,
  status: proposal.status,
  baseRevision: proposal.baseRevision,
  payload: {
    kind: proposal.payload.kind,
    sceneOrder: [...proposal.payload.sceneOrder],
    scenes: Object.fromEntries(
      Object.entries(proposal.payload.scenes).map(([sceneId, scene]) => [
        sceneId,
        {
          title: scene.title,
          purpose: scene.purpose,
          visualPrompt: scene.visualPrompt,
          narration: scene.narration,
          onScreenText: scene.onScreenText,
          mediaKind: scene.mediaKind,
          durationSeconds: scene.durationSeconds,
          referenceAssetId: scene.referenceAssetId,
        },
      ])
    ),
  },
  createdAt: proposal.createdAt,
  decidedAt: proposal.decidedAt,
  ...(diff === undefined
    ? {}
    : {
        diff: {
          added: diff.added,
          removed: diff.removed,
          changed: diff.changed.map((change) => ({ position: change.position, fields: [...change.fields] })),
        },
      }),
});

const applyProposalPayload = (project: StudioProject, payload: StudioProposalPayload): StudioProject => {
  const proposedIds = new Set(payload.sceneOrder);
  for (const scene of Object.values(project.scenes)) {
    if (!proposedIds.has(scene.id) && (scene.assetIds.length > 0 || scene.jobIds.length > 0)) {
      throw invalid('Studio proposal cannot remove a scene with generated state');
    }
  }
  const scenes = Object.fromEntries(
    payload.sceneOrder.map((sceneId) => {
      const editable = payload.scenes[sceneId]!;
      const existing = project.scenes[sceneId];
      if (
        existing !== undefined &&
        existing.mediaKind !== editable.mediaKind &&
        (existing.assetIds.length > 0 || existing.jobIds.length > 0)
      ) {
        throw invalid('Studio proposal cannot change media kind for a scene with generated state');
      }
      const scene: StudioScene = {
        ...(existing ?? {
          id: sceneId,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft' as const,
        }),
        ...editable,
        id: sceneId,
        reviewState: 'draft',
      };
      return [sceneId, scene];
    })
  );
  return reconcilePersistedStudioCuts({ ...project, sceneOrder: [...payload.sceneOrder], scenes });
};

const modelStatus = (
  selected: unknown | null,
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

const mediaRouteMatches = (route: StudioGenerationRoute, selected: StudioProviderRef): boolean =>
  route.providerId === selected.providerId && route.adapterId === selected.adapterId && route.model === selected.model;

const textModelMatches = (option: StudioTextModelOption, selected: StudioTextModelRef): boolean =>
  option.providerId === selected.providerId && option.model === selected.model;

const sanitizedStoryboardOptions = (options: StudioTextModelOption[]): StudioTextModelOption[] => {
  const unique = new Map<string, StudioTextModelOption>();
  for (const option of options) {
    if (
      !isSafeId(option.providerId) ||
      !isSafeCatalogModel(option.model) ||
      !['available', 'unknown'].includes(option.health)
    ) {
      continue;
    }
    const sanitized: StudioTextModelOption = {
      providerId: option.providerId,
      providerName: sanitizedCatalogProviderName(option.providerName, option.providerId),
      model: option.model,
      health: option.health,
    };
    const identity = `${sanitized.providerId}\u0000${sanitized.model}`;
    if (!unique.has(identity)) unique.set(identity, sanitized);
  }
  return [...unique.values()].toSorted((left, right) =>
    `${left.providerId}\u0000${left.providerName}\u0000${left.model}`.localeCompare(
      `${right.providerId}\u0000${right.providerName}\u0000${right.model}`
    )
  );
};

const toRendererRoute = (route: StudioGenerationRoute): StudioRouteCatalogEntry => ({
  choiceId: route.choiceId,
  providerId: route.providerId,
  providerName: route.providerName,
  model: route.model,
  health: route.health,
  kind: route.kind,
  constraints: {
    aspectRatios: [...route.constraints.aspectRatios],
    resolutions: [...route.constraints.resolutions],
    minDurationSeconds: route.constraints.minDurationSeconds,
    maxDurationSeconds: route.constraints.maxDurationSeconds,
    supportsFirstFrame: route.constraints.supportsFirstFrame,
    silentOutput: route.constraints.silentOutput,
  },
});

const integrationForId = (integrationId: string) =>
  MEDIA_INTEGRATIONS.find((integration) => integration.integrationId === integrationId);

const integrationForAdapter = (adapterId: StudioConnectionBinding['adapterId']) =>
  MEDIA_INTEGRATIONS.find((integration) => integration.adapterId === adapterId);

const toConnectionRecord = (binding: StudioConnectionBinding): StudioConnectionRecord => {
  const integration = integrationForAdapter(binding.adapterId);
  if (!integration) throw new CreativeStudioStoreError('storage_error', 'Unknown Studio connection integration');
  const {
    cancellationPolicy: _cancellationPolicy,
    cancellation: _legacyCancellation,
    ...rendererCapabilities
  } = sanitizedCapabilities(binding.adapterId, binding.model, binding.capabilities);
  return {
    bindingId: binding.id,
    providerId: binding.providerId,
    integrationId: integration.integrationId,
    labelKey: integration.labelKey,
    model: binding.model,
    capabilities: rendererCapabilities,
    validatedAt: binding.validatedAt,
  };
};

const toConnectionValidation = (binding: StudioConnectionBinding): StudioConnectionValidationResult => {
  const { bindingId: _bindingId, ...validation } = toConnectionRecord(binding);
  return validation;
};

const routeSupportsProject = (route: StudioGenerationRoute, project: StudioProject | null): boolean => {
  if (route.health === 'unavailable') return false;
  // OpenRouter video routes may declare non-silent (audio) output; every other
  // adapter keeps the silent-only invariant. Mirrors the resolver's silent gate.
  if (!route.constraints.silentOutput && route.adapterId !== 'openrouter-video-v1') return false;
  if (project === null) return true;
  return (
    route.constraints.aspectRatios.includes(project.aspectRatio) &&
    route.constraints.resolutions.includes(project.resolution)
  );
};

type BuiltStudioCatalog = {
  catalog: StudioRouteCatalog;
  generation: StudioGenerationRouteCatalog;
};

/** Owns bounded Creative Studio project edits and renderer-safe mutation notifications. */
export const createCreativeStudioService = (deps: CreativeStudioServiceDeps): CreativeStudioService => {
  const createSceneId = deps.createSceneId ?? randomUUID;
  const createConnectionId = deps.createConnectionId ?? randomUUID;
  /**
   * Proposal diffs frozen at first observation, keyed `${projectId}:${proposalId}`. The subprocess that
   * drafts a proposal is the agent's own tool, so it never gets to state what it changed; main computes
   * that against the project the proposal was drafted from. Recomputing later is not an option — once a
   * proposal is applied the project equals it, and the diff would collapse to nothing. Entries are pruned
   * against each project listing, so the map tracks the durable proposal ledger rather than growing with it.
   */
  const proposalDiffs = new Map<string, StudioProposalDiff>();
  const proposalDiffKey = (proposal: StudioProposal): string => `${proposal.projectId}:${proposal.id}`;
  /** A positional diff is only truthful while the project still stands at the revision it was drafted from. */
  const rememberProposalDiff = (
    project: StudioProject | null,
    proposal: StudioProposal
  ): StudioProposalDiff | undefined => {
    const key = proposalDiffKey(proposal);
    const frozen = proposalDiffs.get(key);
    if (frozen !== undefined) return frozen;
    if (project === null || project.revision !== proposal.baseRevision) return undefined;
    const computed = computeStudioProposalDiff(project, proposal.payload);
    proposalDiffs.set(key, computed);
    return computed;
  };
  const notify = (project: StudioProject): StudioRendererProject => {
    deps.onProjectUpdated(project.id);
    return toRendererProject(project);
  };
  const buildCatalog = async (project: StudioProject | null): Promise<BuiltStudioCatalog> => {
    if (!deps.providerResolver) throw new CreativeStudioServiceError('invalid_route');
    let storyboardOptions: StudioTextModelOption[];
    let generation: StudioGenerationRouteCatalog;
    try {
      [storyboardOptions, generation] = await Promise.all([
        deps.storyboardPlanner.listModels(),
        deps.providerResolver.listGenerationRoutes(),
      ]);
    } catch {
      throw new CreativeStudioServiceError('provider_error');
    }
    storyboardOptions = sanitizedStoryboardOptions(storyboardOptions);
    const imageRoutes = generation.routes.filter(
      (route) => route.kind === 'image' && routeSupportsProject(route, project)
    );
    const videoRoutes = generation.routes.filter(
      (route) => route.kind === 'video' && routeSupportsProject(route, project)
    );
    const imageOptions = imageRoutes.map(toRendererRoute);
    const videoOptions = videoRoutes.map(toRendererRoute);
    const selected = project?.routing ?? { storyboard: null, image: null, video: null };
    const selectedMediaRoute = (
      kind: 'image' | 'video',
      selection: StudioProviderRef | null
    ): StudioRouteCatalogEntry | null => {
      if (selection === null) return null;
      const route = generation.routes.find(
        (candidate) =>
          candidate.kind === kind && mediaRouteMatches(candidate, selection) && routeSupportsProject(candidate, project)
      );
      return route === undefined ? null : toRendererRoute(route);
    };
    const selectedImageRoute = selectedMediaRoute('image', selected.image);
    const selectedVideoRoute = selectedMediaRoute('video', selected.video);
    const storyboardSelectionAvailable =
      selected.storyboard !== null &&
      storyboardOptions.some((option) => textModelMatches(option, selected.storyboard!));
    const imageSelectionAvailable = selectedImageRoute !== null;
    const videoSelectionAvailable = selectedVideoRoute !== null;
    const storyboard = {
      status: modelStatus(selected.storyboard, storyboardOptions.length, storyboardSelectionAvailable),
      selected: selected.storyboard,
      options: storyboardOptions,
    };
    const image = {
      status: modelStatus(selected.image, imageOptions.length, imageSelectionAvailable),
      selected: selected.image === null ? null : toRendererMediaChoice(selected.image, 'image'),
      selectedRoute: selectedImageRoute,
      options: imageOptions,
    };
    const video = {
      status: modelStatus(selected.video, videoOptions.length, videoSelectionAvailable),
      selected: selected.video === null ? null : toRendererMediaChoice(selected.video, 'video'),
      selectedRoute: selectedVideoRoute,
      options: videoOptions,
    };
    const catalogVersion = createHash('sha256')
      .update(
        JSON.stringify({
          storyboard: storyboardOptions.map(({ providerId, providerName, model, health }) => ({
            providerId,
            providerName,
            model,
            health,
          })),
          media: [...imageOptions, ...videoOptions],
        })
      )
      .digest('hex')
      .slice(0, 16);
    return {
      generation,
      catalog: {
        storyboard,
        image,
        video,
        catalogVersion,
      },
    };
  };

  const validateConnectionBinding = async (
    input: StudioValidateConnectionRequest
  ): Promise<StudioConnectionBinding> => {
    assertSafeId(input.providerId, 'provider id');
    assertSafeId(input.integrationId, 'integration id');
    assertText(input.model, 256, 'connection model', true);
    const integration = integrationForId(input.integrationId);
    if (!integration) throw invalid('Invalid Studio integration');
    const normalizedInput: StudioInternalConnectionRequest = {
      providerId: input.providerId,
      adapterId: integration.adapterId,
      model: input.model.trim(),
    };
    if (deps.validateConnection) {
      const validated = await deps.validateConnection(normalizedInput);
      if (
        validated.providerId !== normalizedInput.providerId ||
        validated.adapterId !== normalizedInput.adapterId ||
        validated.model.trim() !== normalizedInput.model
      ) {
        throw new CreativeStudioServiceError('provider_error');
      }
      return { ...validated, model: normalizedInput.model };
    }
    if (!deps.listProviders || !deps.adapterRegistry) throw new CreativeStudioServiceError('invalid_route');
    let providers: IProvider[];
    try {
      providers = await deps.listProviders();
    } catch {
      throw new CreativeStudioServiceError('provider_error');
    }
    const provider = providers.find((candidate) => candidate.id === normalizedInput.providerId);
    if (!provider || !providerIsAvailable(provider, normalizedInput.model, false)) {
      throw new CreativeStudioServiceError('invalid_route');
    }
    const adapter = deps.adapterRegistry.get(normalizedInput.adapterId);
    if (!adapter) throw new CreativeStudioServiceError('invalid_route');
    let validation;
    try {
      validation = await runWithProviderDeadline(
        new AbortController().signal,
        CONNECTION_VALIDATION_TIMEOUT_MS,
        (signal) => adapter.validateConnection({ model: normalizedInput.model }, provider, signal)
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
      model: normalizedInput.model,
      capabilities: sanitizedCapabilities(adapter.id, normalizedInput.model, validation.capabilities),
      validatedAt: new Date().toISOString(),
    };
  };

  return {
    listProjects: () => deps.store.listProjects(),

    async createProject(input: CreateStudioProjectInput): Promise<StudioRendererProject> {
      assertProjectInput(input);
      return notify(await deps.store.createProject(input));
    },

    async getProject(projectId: string): Promise<StudioRendererProject | null> {
      assertSafeId(projectId, 'project id');
      const project = await deps.store.getProject(projectId);
      return project === null ? null : toRendererProject(project);
    },

    async getBriefSessionServer(input: StudioProjectRequest): Promise<ISessionMcpServer> {
      assertSafeId(input.projectId, 'project id');
      if (!deps.getStudioServerScriptPath) throw new Error('Creative Studio MCP script path is unavailable');
      const paths = await deps.store.resolveProposalPaths(input.projectId);
      const project = await deps.store.getProject(input.projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      const routeCatalog = (await buildCatalog(project)).catalog;
      return {
        id: `studio-brief-${input.projectId}`,
        name: BUILTIN_STUDIO_NAME,
        transport: {
          type: 'stdio',
          command: 'node',
          args: [deps.getStudioServerScriptPath()],
          env: {
            [STUDIO_ENV.projectId]: input.projectId,
            [STUDIO_ENV.projectDir]: paths.projectDir,
            [STUDIO_ENV.pendingDir]: paths.pendingDir,
            [STUDIO_ENV.referencePendingDir]: paths.referencePendingDir,
            [STUDIO_ENV.routeCatalog]: JSON.stringify(routeCatalog),
          },
        },
      };
    },

    async listProposals(input: StudioProjectRequest): Promise<StudioProposal[]> {
      assertSafeId(input.projectId, 'project id');
      const project = await deps.store.getProject(input.projectId);
      const proposals = await deps.store.listProposals(input.projectId);
      const live = new Set(proposals.map(proposalDiffKey));
      for (const key of proposalDiffs.keys()) {
        if (key.startsWith(`${input.projectId}:`) && !live.has(key)) proposalDiffs.delete(key);
      }
      return proposals.map((proposal) => toRendererProposal(proposal, rememberProposalDiff(project, proposal)));
    },

    async listPendingReferenceRequests(input: StudioProjectRequest): Promise<StudioReferenceRequest[]> {
      assertSafeId(input.projectId, 'project id');
      return deps.store.listPendingReferenceRequests(input.projectId);
    },

    async dismissReferenceRequests(input: StudioDismissReferenceRequestsRequest): Promise<boolean> {
      assertSafeId(input.projectId, 'project id');
      if (
        input.requestIds.length === 0 ||
        input.requestIds.length > 50 ||
        new Set(input.requestIds).size !== input.requestIds.length
      ) {
        throw new CreativeStudioServiceError('invalid_payload');
      }
      input.requestIds.forEach((requestId) => assertSafeId(requestId, 'reference request id'));
      await deps.store.dismissReferenceRequests(input.projectId, input.requestIds);
      return true;
    },

    async acceptProposal(input: StudioProposalRequest): Promise<StudioProposalAcceptance> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.proposalId, 'proposal id');
      const accepted = await deps.store.acceptProposal(input.projectId, input.proposalId, applyProposalPayload);
      if (accepted.applied) deps.onProjectUpdated(accepted.project.id);
      return {
        // Only the frozen diff: the applied project now equals the proposal, so recomputing here reads as no change.
        proposal: toRendererProposal(accepted.proposal, proposalDiffs.get(proposalDiffKey(accepted.proposal))),
        project: toRendererProject(accepted.project),
      };
    },

    async rejectProposal(input: StudioProposalRequest): Promise<StudioProposal> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.proposalId, 'proposal id');
      const rejected = await deps.store.rejectProposal(input.projectId, input.proposalId);
      return toRendererProposal(rejected, proposalDiffs.get(proposalDiffKey(rejected)));
    },

    async proposeStoryboard(input: ProposeStudioStoryboardInput): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (typeof input.replaceExisting !== 'boolean') throw invalid('Invalid storyboard replacement option');

      const project = await deps.store.getProject(input.projectId);
      if (!project) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      if (project.sceneOrder.length > 0 && !input.replaceExisting) {
        throw new CreativeStudioServiceError('storyboard_exists');
      }
      const selected = project.routing.storyboard;
      if (selected === null) throw new CreativeStudioServiceError('planning_unavailable');
      let options: StudioTextModelOption[];
      try {
        options = await deps.storyboardPlanner.listModels();
      } catch (error) {
        throw plannerError(error);
      }
      if (!options.some((option) => textModelMatches(option, selected))) {
        throw new CreativeStudioServiceError('planning_unavailable');
      }
      let result;
      try {
        result = await deps.storyboardPlanner.draft(
          {
            projectId: project.id,
            projectRevision: project.revision,
            brief: project.brief,
            aspectRatio: project.aspectRatio,
            targetDurationSeconds: project.targetDurationSeconds,
          },
          selected
        );
      } catch (error) {
        throw plannerError(error);
      }

      const sceneIds = new Set<string>();
      const scenes: Record<string, StudioScene> = {};
      for (const draft of result.scenes) {
        const sceneId = createSceneId();
        if (!isSafeId(sceneId) || sceneIds.has(sceneId)) {
          throw new CreativeStudioStoreError('storage_error', 'Unable to allocate Studio scene identity');
        }
        sceneIds.add(sceneId);
        scenes[sceneId] = {
          id: sceneId,
          title: draft.title,
          purpose: draft.purpose,
          visualPrompt: draft.visualPrompt,
          narration: draft.narration,
          onScreenText: draft.onScreenText,
          mediaKind: draft.mediaKind,
          durationSeconds: draft.durationSeconds,
          referenceAssetId: null,
          selectedAssetId: null,
          assetIds: [],
          jobIds: [],
          reviewState: 'draft',
        };
      }

      return notify(
        await deps.store.updateProject(
          project.id,
          (current) => reconcilePersistedStudioCuts({ ...current, scenes, sceneOrder: [...sceneIds] }),
          project.revision
        )
      );
    },

    async updateProject(input: StudioUpdateProjectRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (
        input.name === undefined &&
        input.brief === undefined &&
        input.aspectRatio === undefined &&
        input.targetDurationSeconds === undefined &&
        input.resolution === undefined
      ) {
        throw invalid('Studio project update is empty');
      }
      if (input.name !== undefined) assertText(input.name, 256, 'project name', true);
      if (input.brief !== undefined) assertText(input.brief, 16 * 1024, 'project brief');
      if (input.aspectRatio !== undefined && !ASPECT_RATIOS.has(input.aspectRatio))
        throw invalid('Invalid Studio aspect ratio');
      if (input.targetDurationSeconds !== undefined && !isIntegerInRange(input.targetDurationSeconds, 5, 60)) {
        throw invalid('Invalid Studio target duration');
      }
      if (input.resolution !== undefined && !RESOLUTIONS.has(input.resolution))
        throw invalid('Invalid Studio resolution');
      const { projectId, expectedRevision } = input;
      if (input.aspectRatio !== undefined) {
        const project = await deps.store.getProject(projectId);
        if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
        if (project.revision !== expectedRevision) {
          throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
        }
        const aspectRatioChanged = input.aspectRatio !== project.aspectRatio;
        const hasGeneratedOutput = Object.values(project.assets).some(
          (asset) => asset.managedAsset.collection === 'assets'
        );
        const hasActiveGeneration = Object.values(project.jobs).some((job) => NONTERMINAL_JOB_STATUSES.has(job.status));
        if (aspectRatioChanged && (hasGeneratedOutput || hasActiveGeneration)) {
          throw new CreativeStudioServiceError('busy');
        }
      }
      return notify(
        await deps.store.updateProject(
          projectId,
          (project) => {
            for (const field of UPDATABLE_PROJECT_FIELDS) applyProjectUpdateField(project, input, field);
            return project;
          },
          expectedRevision
        )
      );
    },

    async bindBriefConversation(input: StudioBindBriefConversationRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (input.conversationId !== null) assertSafeId(input.conversationId, 'conversation id');
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => ({ ...project, briefConversationId: input.conversationId }),
          input.expectedRevision
        )
      );
    },

    async updateCut(input: StudioUpdateCutRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.cutId, 'cut id');
      assertExpectedRevision(input.expectedRevision);
      assertEditableCut(input.cut);
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const cutState = resolveStudioCutState(project);
            const currentCut = cutState.cuts[input.cutId];
            if (currentCut === undefined) throw invalid('Studio cut not found');
            const currentClipIds = Object.keys(currentCut.clips);
            const editedClipIds = Object.keys(input.cut.clips);
            if (
              editedClipIds.length !== currentClipIds.length ||
              editedClipIds.some((clipId) => !Object.hasOwn(currentCut.clips, clipId)) ||
              input.cut.clipOrder.length !== currentClipIds.length ||
              input.cut.clipOrder.some((clipId) => !Object.hasOwn(currentCut.clips, clipId))
            ) {
              throw invalid('Studio cut edit must retain every clip identity');
            }
            const orderChanged =
              input.cut.clipOrder.some((clipId, index) => clipId !== currentCut.clipOrder[index]) ||
              input.cut.clipOrder.length !== currentCut.clipOrder.length;
            const clipsChanged = currentClipIds.some((clipId) =>
              cutClipEditChanged(currentCut.clips[clipId]!, input.cut.clips[clipId]!)
            );
            const orderMode =
              currentCut.orderMode === 'manual'
                ? input.cut.orderMode === 'storyboard'
                  ? 'storyboard'
                  : 'manual'
                : orderChanged || clipsChanged
                  ? 'manual'
                  : 'storyboard';
            const editedCut: StudioCut = {
              ...currentCut,
              orderMode,
              clipOrder: [...input.cut.clipOrder],
              clips: Object.fromEntries(
                currentClipIds.map((clipId) => {
                  const currentClip = currentCut.clips[clipId]!;
                  const edit = input.cut.clips[clipId]!;
                  return [
                    clipId,
                    {
                      ...currentClip,
                      sourceInSeconds: edit.sourceInSeconds,
                      sourceOutSeconds: edit.sourceOutSeconds,
                      crop: edit.crop === null ? null : { ...edit.crop },
                      filters: edit.filters
                        .filter((filter) => filter.amount !== 0)
                        .map((filter) => ({ id: filter.id, amount: filter.amount })),
                    },
                  ];
                })
              ),
            };
            return reconcilePersistedStudioCuts({
              ...project,
              cuts: {
                ...structuredClone(cutState.cuts),
                [input.cutId]: editedCut,
              },
              activeCutId: cutState.activeCutId,
            });
          },
          input.expectedRevision
        )
      );
    },

    async placeCutScenes(input: StudioPlaceCutScenesRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.cutId, 'cut id');
      assertExpectedRevision(input.expectedRevision);
      if (
        !Array.isArray(input.sceneIds) ||
        input.sceneIds.length === 0 ||
        input.sceneIds.some((sceneId) => !isSafeId(sceneId)) ||
        new Set(input.sceneIds).size !== input.sceneIds.length ||
        (input.beforeClipId !== null && !isSafeId(input.beforeClipId))
      ) {
        throw invalid('Invalid Studio cut placement');
      }
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const cutState = resolveStudioCutState(project);
            const currentCut = cutState.cuts[input.cutId];
            if (currentCut === undefined || currentCut.orderMode !== 'manual') {
              throw invalid('Studio cut placement requires a manual cut');
            }
            const insertionIndex =
              input.beforeClipId === null
                ? currentCut.clipOrder.length
                : currentCut.clipOrder.indexOf(input.beforeClipId);
            if (insertionIndex < 0) throw invalid('Studio cut placement target not found');

            const clips = structuredClone(currentCut.clips);
            const occupied = new Set(Object.keys(clips));
            const placedIds = input.sceneIds.map((sceneId) => {
              const scene = project.scenes[sceneId];
              const asset = scene?.selectedAssetId === null ? undefined : project.assets[scene?.selectedAssetId ?? ''];
              if (
                scene === undefined ||
                asset === undefined ||
                !isCanonicalStudioGeneratedTake(asset, project.id, scene) ||
                Object.values(clips).some((clip) => clip.sceneId === sceneId)
              ) {
                throw invalid('Studio cut placement scene is not available');
              }
              const clipId = allocatePlacedClipId(sceneId, occupied);
              occupied.add(clipId);
              clips[clipId] = {
                id: clipId,
                sceneId,
                assetId: asset.id,
                sourceInSeconds: null,
                sourceOutSeconds: null,
                crop: null,
                filters: [],
              };
              return clipId;
            });
            const clipOrder = [...currentCut.clipOrder];
            clipOrder.splice(insertionIndex, 0, ...placedIds);
            return {
              ...project,
              cuts: {
                ...structuredClone(cutState.cuts),
                [input.cutId]: { ...currentCut, clipOrder, clips },
              },
              activeCutId: cutState.activeCutId,
            };
          },
          input.expectedRevision
        )
      );
    },

    async fitStoryboard(input: StudioFitStoryboardRequest): Promise<StudioFitStoryboardOutcome> {
      assertFitStoryboardInput(input);
      const project = await deps.store.getProject(input.projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      const built = await buildCatalog(project);
      if (built.catalog.catalogVersion !== input.catalogVersion) {
        throw new CreativeStudioServiceError('invalid_route');
      }

      const lockedByAsset = new Set(
        Object.values(project.assets)
          .filter((asset) => asset.sceneId !== null && asset.managedAsset.collection === 'assets')
          .map((asset) => asset.sceneId!)
      );
      const lockedByJob = new Set(
        Object.values(project.jobs)
          .filter((job) => NONTERMINAL_JOB_STATUSES.has(job.status))
          .map((job) => job.sceneId)
      );
      const lockedSceneIds = project.sceneOrder.filter(
        (sceneId) => lockedByAsset.has(sceneId) || lockedByJob.has(sceneId)
      );
      const lockedSet = new Set(lockedSceneIds);
      const adjustableSceneIds = project.sceneOrder.filter((sceneId) => !lockedSet.has(sceneId));
      const lockedTotalSeconds = lockedSceneIds.reduce(
        (total, sceneId) => total + project.scenes[sceneId]!.durationSeconds,
        0
      );
      const rendererProject = toRendererProject(project);

      if (adjustableSceneIds.length === 0) {
        if (lockedTotalSeconds === project.targetDurationSeconds) {
          return {
            status: 'already_matches',
            project: rendererProject,
            changedSceneIds: [],
            lockedSceneIds,
          };
        }
        return {
          status: 'unreachable',
          reason: 'no_adjustable_scenes',
          project: rendererProject,
          lockedSceneIds,
          fixedTotalSeconds: lockedTotalSeconds,
        };
      }

      const unavailableSceneIds: string[] = [];
      const durationItems = adjustableSceneIds.flatMap((sceneId) => {
        const scene = project.scenes[sceneId]!;
        const selected = project.routing[scene.mediaKind];
        const route =
          selected === null
            ? undefined
            : built.generation.routes.find(
                (candidate) =>
                  candidate.kind === scene.mediaKind &&
                  mediaRouteMatches(candidate, selected) &&
                  routeSupportsProject(candidate, project)
              );
        if (route === undefined) {
          unavailableSceneIds.push(sceneId);
          return [];
        }
        return [
          {
            sceneId,
            currentDurationSeconds: scene.durationSeconds,
            minDurationSeconds: route.constraints.minDurationSeconds,
            maxDurationSeconds: route.constraints.maxDurationSeconds,
          },
        ];
      });
      if (unavailableSceneIds.length > 0) {
        return {
          status: 'unreachable',
          reason: 'route_unavailable',
          project: rendererProject,
          lockedSceneIds,
          unavailableSceneIds,
        };
      }

      const minimumTotalSeconds = durationItems.reduce(
        (total, item) => total + item.minDurationSeconds,
        lockedTotalSeconds
      );
      const maximumTotalSeconds = durationItems.reduce(
        (total, item) => total + item.maxDurationSeconds,
        lockedTotalSeconds
      );
      if (project.targetDurationSeconds < minimumTotalSeconds || project.targetDurationSeconds > maximumTotalSeconds) {
        return {
          status: 'unreachable',
          reason: 'target_out_of_bounds',
          project: rendererProject,
          lockedSceneIds,
          minimumTotalSeconds,
          maximumTotalSeconds,
        };
      }

      const fitted = fitStoryboardDurations(durationItems, project.targetDurationSeconds - lockedTotalSeconds);
      if (fitted.status === 'unreachable') {
        return {
          status: 'unreachable',
          reason: 'target_out_of_bounds',
          project: rendererProject,
          lockedSceneIds,
          minimumTotalSeconds: lockedTotalSeconds + fitted.minimumSeconds,
          maximumTotalSeconds: lockedTotalSeconds + fitted.maximumSeconds,
        };
      }
      const changedSceneIds = fitted.allocations
        .filter(({ sceneId, durationSeconds }) => project.scenes[sceneId]!.durationSeconds !== durationSeconds)
        .map(({ sceneId }) => sceneId);
      if (changedSceneIds.length === 0) {
        return {
          status: 'already_matches',
          project: rendererProject,
          changedSceneIds: [],
          lockedSceneIds,
        };
      }
      const allocationBySceneId = new Map(
        fitted.allocations.map(({ sceneId, durationSeconds }) => [sceneId, durationSeconds])
      );
      const updated = await deps.store.updateProject(
        project.id,
        (current) => ({
          ...current,
          scenes: Object.fromEntries(
            Object.entries(current.scenes).map(([sceneId, scene]) => {
              const durationSeconds = allocationBySceneId.get(sceneId);
              return [sceneId, durationSeconds === undefined ? scene : { ...scene, durationSeconds }];
            })
          ),
        }),
        input.expectedRevision
      );
      return {
        status: 'applied',
        project: notify(updated),
        changedSceneIds,
        lockedSceneIds,
      };
    },

    async updateModelSelection(input: StudioUpdateModelSelectionRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (!['storyboard', 'image', 'video'].includes(input.role)) {
        throw invalid('Invalid Studio model role');
      }
      if (input.selection !== null) {
        if (input.role === 'storyboard') {
          if (!('providerId' in input.selection) || !('model' in input.selection)) {
            throw invalid('Invalid Studio storyboard model selection');
          }
          assertSafeId(input.selection.providerId, 'provider id');
          assertText(input.selection.model, 256, 'model', true);
        } else {
          if (!('choiceId' in input.selection)) throw invalid('Invalid Studio media choice');
          assertSafeId(input.selection.choiceId, 'media choice id');
        }
      }
      const project = await deps.store.getProject(input.projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      const built = await buildCatalog(project);
      let selection: StudioTextModelRef | StudioProviderRef | null;
      let isAvailable: boolean;
      if (input.selection === null) {
        selection = null;
        isAvailable = true;
      } else if (input.role === 'storyboard') {
        if (!('providerId' in input.selection) || !('model' in input.selection)) {
          throw invalid('Invalid Studio storyboard model selection');
        }
        const storyboardSelection: StudioTextModelRef = {
          providerId: input.selection.providerId,
          model: input.selection.model,
        };
        selection = storyboardSelection;
        isAvailable = built.catalog.storyboard.options.some((option) => textModelMatches(option, storyboardSelection));
      } else {
        if (!('choiceId' in input.selection)) throw invalid('Invalid Studio media choice');
        const choiceId = input.selection.choiceId;
        const catalogSelection = built.catalog[input.role].options.find(
          (route) => route.kind === input.role && route.choiceId === choiceId
        );
        const resolved = built.generation.routes.find(
          (route) =>
            catalogSelection !== undefined && route.kind === input.role && route.choiceId === catalogSelection.choiceId
        );
        selection =
          resolved === undefined
            ? null
            : {
                providerId: resolved.providerId,
                adapterId: resolved.adapterId,
                model: resolved.model,
              };
        isAvailable = resolved !== undefined;
      }
      if (!isAvailable) throw new CreativeStudioServiceError('invalid_route');
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (current) => ({
            ...current,
            routing: {
              ...current.routing,
              [input.role]: selection,
            },
          }),
          input.expectedRevision
        )
      );
    },

    async deleteProject(input: StudioDeleteProjectRequest): Promise<boolean> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      const deleted = await deps.store.deleteProject(input.projectId, input.expectedRevision);
      if (deleted) deps.onProjectUpdated(input.projectId);
      return deleted;
    },

    async updateScene(input: StudioUpdateSceneRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.sceneId, 'scene id');
      assertExpectedRevision(input.expectedRevision);
      if (input.scene !== null) assertScene(input.scene);
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const next = structuredClone(project);
            if (input.scene === null) {
              if (!Object.hasOwn(next.scenes, input.sceneId))
                throw new CreativeStudioStoreError('not_found', 'Studio scene not found');
              const scene = next.scenes[input.sceneId];
              if (scene.assetIds.length > 0 || scene.jobIds.length > 0) {
                throw invalid('Studio scene with assets or jobs cannot be removed');
              }
              delete next.scenes[input.sceneId];
              next.sceneOrder = next.sceneOrder.filter((sceneId) => sceneId !== input.sceneId);
              return reconcilePersistedStudioCuts(next);
            }
            if (!Object.hasOwn(next.scenes, input.sceneId) && next.sceneOrder.length >= 24) {
              throw invalid('Studio project has too many scenes');
            }
            if (input.scene.referenceAssetId !== null) {
              const reference = next.assets[input.scene.referenceAssetId];
              if (
                reference === undefined ||
                reference.projectId !== next.id ||
                reference.sceneId !== input.sceneId ||
                reference.mediaKind !== 'image'
              ) {
                throw invalid('Studio reference asset does not belong to its scene');
              }
            }
            const current = next.scenes[input.sceneId];
            if (current === undefined) {
              next.scenes[input.sceneId] = {
                id: input.sceneId,
                ...input.scene,
                selectedAssetId: null,
                assetIds: [],
                jobIds: [],
                reviewState:
                  input.scene.title.trim().length > 0 && input.scene.visualPrompt.trim().length > 0 ? 'ready' : 'draft',
              };
            } else {
              const mediaKindChanged = current.mediaKind !== input.scene.mediaKind;
              if (
                mediaKindChanged &&
                current.jobIds.some((jobId) => {
                  const job = next.jobs[jobId];
                  return job !== undefined && NONTERMINAL_JOB_STATUSES.has(job.status);
                })
              ) {
                throw new CreativeStudioServiceError('busy');
              }
              const selectedAsset = current.selectedAssetId === null ? undefined : next.assets[current.selectedAssetId];
              const selectedAssetId =
                mediaKindChanged && selectedAsset?.mediaKind !== input.scene.mediaKind ? null : current.selectedAssetId;
              next.scenes[input.sceneId] = {
                ...current,
                ...input.scene,
                id: current.id,
                selectedAssetId,
                assetIds: [...current.assetIds],
                jobIds: [...current.jobIds],
                reviewState: mediaKindChanged
                  ? input.scene.title.trim().length > 0 && input.scene.visualPrompt.trim().length > 0
                    ? 'ready'
                    : 'draft'
                  : current.reviewState,
              };
            }
            if (!next.sceneOrder.includes(input.sceneId)) next.sceneOrder.push(input.sceneId);
            return reconcilePersistedStudioCuts(next);
          },
          input.expectedRevision
        )
      );
    },

    async reorderScenes(input: StudioReorderScenesRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (
        !Array.isArray(input.sceneOrder) ||
        input.sceneOrder.length < 1 ||
        input.sceneOrder.length > 24 ||
        input.sceneOrder.some((sceneId) => !isSafeId(sceneId)) ||
        new Set(input.sceneOrder).size !== input.sceneOrder.length
      ) {
        throw invalid('Invalid Studio scene order');
      }
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            if (
              project.sceneOrder.length !== input.sceneOrder.length ||
              input.sceneOrder.some((sceneId) => !Object.hasOwn(project.scenes, sceneId))
            ) {
              throw invalid('Studio scene order must be an exact permutation');
            }
            return reconcilePersistedStudioCuts({ ...project, sceneOrder: [...input.sceneOrder] });
          },
          input.expectedRevision
        )
      );
    },

    async selectAsset(input: StudioSelectAssetRequest): Promise<StudioRendererProject> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.sceneId, 'scene id');
      assertSafeId(input.assetId, 'asset id');
      assertExpectedRevision(input.expectedRevision);
      return notify(
        await deps.store.updateProject(
          input.projectId,
          (project) => {
            const scene = project.scenes[input.sceneId];
            const asset = project.assets[input.assetId];
            if (
              scene === undefined ||
              asset === undefined ||
              !isCanonicalStudioGeneratedTake(asset, project.id, scene)
            ) {
              throw invalid('Studio asset does not belong to its selected scene');
            }
            return reconcilePersistedStudioCuts({
              ...project,
              scenes: {
                ...project.scenes,
                [input.sceneId]: { ...scene, selectedAssetId: input.assetId },
              },
            });
          },
          input.expectedRevision
        )
      );
    },

    async persistCapturedPoster(input: StudioPersistCapturedPosterRequest): Promise<StudioAsset> {
      assertSafeId(input.projectId, 'project id');
      assertSafeId(input.sceneId, 'scene id');
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
      if (!deps.mediaStore?.persistCapturedPoster) {
        throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      }
      const poster = await deps.mediaStore.persistCapturedPoster({
        projectId: input.projectId,
        sceneId: input.sceneId,
        videoAssetId: input.videoAssetId,
        width: input.width,
        height: input.height,
        declaredByteSize: bytes.length,
        body: Readable.from([bytes]),
      });
      deps.onProjectUpdated(input.projectId);
      return poster;
    },

    async submitScenes(input: StudioSubmitScenesRequest): Promise<StudioRendererJob[]> {
      assertSubmitScenesInput(input);
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      const project = await deps.store.getProject(input.projectId);
      if (project === null) throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      if (project.revision !== input.expectedRevision) {
        throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
      }
      if (input.mode === 'single' && input.sceneIds.length !== 1) {
        throw new CreativeStudioServiceError('invalid_payload');
      }
      if (input.mode === 'batch' && input.sceneIds.some((sceneId) => !batchSceneIsReady(project, sceneId))) {
        throw new CreativeStudioServiceError('invalid_payload');
      }
      const built = await buildCatalog(project);
      if (input.catalogVersion !== built.catalog.catalogVersion) {
        throw new CreativeStudioServiceError('invalid_route');
      }
      const resolvedRoutes = input.routes.map((choice) => {
        const scene = project.scenes[choice.sceneId];
        const available = built.catalog[choice.kind].options.some(
          (option) => option.kind === choice.kind && option.choiceId === choice.choiceId
        );
        const route = built.generation.routes.find(
          (candidate) => candidate.kind === choice.kind && candidate.choiceId === choice.choiceId
        );
        if (scene === undefined) throw new CreativeStudioServiceError('invalid_route');
        const requiredKind = requestedMediaKind(scene.mediaKind, input.outputRole ?? 'take');
        if (requiredKind !== choice.kind || !available || route === undefined) {
          throw new CreativeStudioServiceError('invalid_route');
        }
        return {
          sceneId: choice.sceneId,
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
          kind: route.kind,
        };
      });
      return (
        await deps.jobManager.submitScenes({
          projectId: input.projectId,
          sceneIds: input.sceneIds,
          expectedRevision: input.expectedRevision,
          routes: resolvedRoutes,
          catalogVersion: built.generation.generationCatalogVersion,
          // Forwarded explicitly: submitScenes is assembled field by field and both fields are
          // optional on an Omit-derived type, so dropping them would never fail the typecheck.
          ...(input.outputRole === undefined ? {} : { outputRole: input.outputRole }),
          ...(input.referencePrompt === undefined ? {} : { referencePrompt: input.referencePrompt }),
        })
      ).map(toRendererJob);
    },

    async cancelJob(input: StudioJobRequest): Promise<StudioRendererJob> {
      assertJobRequest(input);
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return toRendererJob(await deps.jobManager.cancelJob(input));
    },

    async retryJob(input: StudioRetryJobRequest): Promise<StudioRendererJob> {
      assertJobRequest(input);
      if (
        input.acknowledgePossibleDuplicateCharge !== undefined &&
        typeof input.acknowledgePossibleDuplicateCharge !== 'boolean'
      ) {
        throw invalid('Invalid Studio duplicate-charge acknowledgement');
      }
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return toRendererJob(await deps.jobManager.retryJob(input));
    },

    async retryDownload(input: StudioRetryDownloadRequest): Promise<StudioRendererJob> {
      assertJobRequest(input);
      if (!deps.jobManager) throw new CreativeStudioServiceError('provider_error');
      return toRendererJob(await deps.jobManager.retryDownload(input));
    },

    async importReferenceFromPath(input): Promise<StudioAsset> {
      assertSafeId(input.projectId, 'project id');
      assertExpectedRevision(input.expectedRevision);
      if (input.sceneId !== undefined) assertSafeId(input.sceneId, 'scene id');
      if (typeof input.sourcePath !== 'string' || input.sourcePath.length === 0)
        throw invalid('Invalid Studio source path');
      if (!deps.mediaStore) throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      const asset = await deps.mediaStore.importReferenceFromPath(input);
      deps.onProjectUpdated(input.projectId);
      return asset;
    },

    async exportAssetsToDirectory(input) {
      assertSafeId(input.projectId, 'project id');
      if (typeof input.destinationDirectory !== 'string' || typeof input.includeReferences !== 'boolean') {
        throw invalid('Invalid Studio export request');
      }
      if (!deps.mediaStore) throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      return deps.mediaStore.exportAssetsToDirectory(input);
    },

    async getLatestRender(input: StudioProjectRequest): Promise<StudioLatestRender | null> {
      assertSafeId(input.projectId, 'project id');
      if (!deps.mediaStore) throw new CreativeStudioStoreError('storage_error', 'Studio media storage is unavailable');
      const asset = await deps.mediaStore.getLatestProjectOutput(input.projectId);
      return asset === null ? null : { fileName: 'cut.mp4', renderedAt: asset.createdAt };
    },

    async listConnectionCandidates(): Promise<StudioConnectionCandidate[]> {
      if (!deps.providerResolver) return [];
      try {
        return await deps.providerResolver.listConnectionCandidates();
      } catch {
        throw new CreativeStudioServiceError('provider_error');
      }
    },

    async listConnections(): Promise<StudioConnectionInventory> {
      const connections = (await deps.store.listConnections()).map(toConnectionRecord);
      return {
        integrations: MEDIA_INTEGRATIONS.map(({ integrationId, kind, labelKey }) => ({
          integrationId,
          kind,
          labelKey,
        })),
        connections,
      };
    },

    async validateConnection(input: StudioValidateConnectionRequest): Promise<StudioConnectionValidationResult> {
      return toConnectionValidation(await validateConnectionBinding(input));
    },

    async saveConnection(input: StudioSaveConnectionRequest): Promise<StudioConnectionRecord> {
      const validated = await validateConnectionBinding(input);
      const binding: StudioConnectionBinding = {
        ...validated,
        schemaVersion: 1,
        id: createConnectionId(),
      };
      if (!isSafeId(binding.id)) {
        throw new CreativeStudioStoreError('storage_error', 'Unable to allocate Studio connection identity');
      }
      return toConnectionRecord(await deps.store.saveConnection(binding));
    },

    async removeConnection(input: StudioRemoveConnectionRequest): Promise<boolean> {
      assertSafeId(input.bindingId, 'connection id');
      return deps.store.removeConnection(input.bindingId);
    },

    async listRoutes(input: StudioListRoutesRequest = {}): Promise<StudioRouteCatalog> {
      if (input.projectId !== undefined) assertSafeId(input.projectId, 'project id');
      if (!deps.providerResolver) throw new CreativeStudioServiceError('invalid_route');
      const project = input.projectId === undefined ? null : await deps.store.getProject(input.projectId);
      if (input.projectId !== undefined && project === null) {
        throw new CreativeStudioStoreError('not_found', 'Studio project not found');
      }
      return (await buildCatalog(project)).catalog;
    },
  };
};
