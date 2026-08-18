/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { Readable } from 'node:stream';
import {
  STUDIO_MAX_BEATS,
  STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_REFERENCE_PROMPT_MAX_LENGTH,
  type CreateStudioProjectInputV2,
  type StudioAssetV2,
  type StudioBriefReferenceRole,
  type StudioDetachBriefReferenceRequest,
  type StudioJob,
  type StudioJobRequest,
  type StudioJobV2,
  type StudioMediaChoiceRef,
  type StudioMediaKind,
  type StudioMediaModelRef,
  type StudioMediaRouteCatalog,
  type StudioModelAvailability,
  type StudioMutationBatchResultV2,
  type StudioMutationBatchV2,
  type StudioOutputRole,
  type StudioProjectListResultV2,
  type StudioProjectLoadResultV2,
  type StudioProjectV2,
  type StudioRendererJobV2,
  type StudioRendererProjectV2,
  type StudioRetryDownloadRequest,
  type StudioRetryJobRequest,
  type StudioRouteCatalogEntry,
} from '@/common/types/project/creativeStudioTypes';
import { isCanonicalStudioGeneratedTakeV2 } from '@/common/types/project/creativeStudioCanonicalTake';
import { jobOutputRole } from '@/common/types/project/creativeStudioOutputRole';
import { canCancelJobV2, type StudioJobManagerV2 } from '../jobManager';
import type { StudioMediaStore } from '../mediaStore';
import {
  createStudioMediaChoiceId,
  type StudioGenerationRoute,
  type StudioGenerationRouteCatalog,
  type StudioProviderResolver,
} from '../providerResolver';
import { CreativeStudioStoreError, type CreativeStudioStore, type StudioProjectStoreLoadResultV2 } from '../store';
import { CreativeStudioServiceError } from './projectMutations';

const SAFE_ID = /^[A-Za-z0-9_-]{1,256}$/;
const ACTIVE_JOB_STATUSES: ReadonlySet<StudioJob['status']> = new Set([
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
const CAPTURED_POSTER_DATA_URL_PREFIX = 'data:image/png;base64,';
const CAPTURED_POSTER_MAX_BYTES = 50 * 1024 * 1024;
const CAPTURED_POSTER_MAX_BASE64_LENGTH = Math.ceil(CAPTURED_POSTER_MAX_BYTES / 3) * 4;
const SUBMIT_REQUIRED_KEYS = new Set(['projectId', 'shotIds', 'expectedRevision', 'routes', 'catalogVersion']);
const SUBMIT_OPTIONAL_KEYS = new Set(['outputRole', 'referencePrompts']);
const ROUTE_CHOICE_KEYS = new Set(['shotId', 'choiceId', 'kind']);
const REFERENCE_PROMPT_KEYS = new Set(['shotId', 'prompt']);

export type StudioRouteCatalogV2 = {
  image: StudioMediaRouteCatalog;
  video: StudioMediaRouteCatalog;
  catalogVersion: string;
};

export type StudioShotGenerationChoiceV2 = {
  shotId: string;
  choiceId: string;
  kind: StudioMediaKind;
};

export type StudioShotReferencePromptV2 = {
  shotId: string;
  prompt: string;
};

export type StudioSubmitShotsRequestV2 = {
  projectId: string;
  shotIds: string[];
  expectedRevision: number;
  routes: StudioShotGenerationChoiceV2[];
  catalogVersion: string;
  outputRole?: StudioOutputRole;
  referencePrompts?: StudioShotReferencePromptV2[];
};

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

export type CreativeStudioServiceV2 = {
  listProjects(): Promise<StudioProjectListResultV2>;
  createProject(input: CreateStudioProjectInputV2): Promise<StudioRendererProjectV2>;
  getProject(projectId: string): Promise<StudioProjectLoadResultV2>;
  deleteProject(input: { projectId: string; expectedRevision: number }): Promise<boolean>;
  applyMutations(input: StudioMutationBatchV2): Promise<StudioMutationBatchResultV2>;
  importReferenceFromPath(input: {
    projectId: string;
    shotId?: string;
    briefReferenceRole?: StudioBriefReferenceRole;
    expectedRevision: number;
    sourcePath: string;
  }): Promise<{ asset: StudioAssetV2; project: StudioRendererProjectV2 }>;
  detachBriefReference(input: StudioDetachBriefReferenceRequest): Promise<StudioRendererProjectV2>;
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
  submitShots(input: StudioSubmitShotsRequestV2): Promise<StudioRendererJobV2[]>;
  cancelJob(input: StudioJobRequest): Promise<StudioRendererJobV2>;
  retryJob(input: StudioRetryJobRequest): Promise<StudioRendererJobV2>;
  retryDownload(input: StudioRetryDownloadRequest): Promise<StudioRendererJobV2>;
};

export type CreativeStudioServiceV2Deps = {
  store: CreativeStudioStore;
  providerResolver: StudioProviderResolver;
  jobManager: StudioJobManagerV2;
  mediaStore?: StudioMediaStore;
  onProjectUpdated: (projectId: string) => void;
};

const invalid = (message: string): CreativeStudioStoreError => new CreativeStudioStoreError('invalid_payload', message);

const isSafeId = (value: unknown): value is string => typeof value === 'string' && SAFE_ID.test(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, expected: ReadonlySet<string>): boolean => {
  const keys = Reflect.ownKeys(value);
  return keys.length === expected.size && keys.every((key) => typeof key === 'string' && expected.has(key));
};

const hasKeys = (
  value: Record<string, unknown>,
  required: ReadonlySet<string>,
  optional: ReadonlySet<string>
): boolean => {
  const keys = Reflect.ownKeys(value);
  return (
    keys.every((key) => typeof key === 'string' && (required.has(key) || optional.has(key))) &&
    [...required].every((key) => Object.hasOwn(value, key))
  );
};

const assertSafeId: (value: unknown, label: string) => asserts value is string = (value, label) => {
  if (!isSafeId(value)) throw invalid(`Invalid Studio ${label}`);
};

const assertRevision: (value: unknown) => asserts value is number = (value) => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw invalid('Invalid Studio project revision');
  }
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

const toMediaChoice = (provider: StudioMediaModelRef, kind: StudioMediaKind): StudioMediaChoiceRef => ({
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

const routeMatchesSelection = (route: StudioGenerationRoute, selection: StudioMediaModelRef): boolean =>
  route.providerId === selection.providerId &&
  route.adapterId === selection.adapterId &&
  route.model === selection.model;

const routeSupportsProject = (route: StudioGenerationRoute, project: StudioProjectV2 | null): boolean =>
  route.health !== 'unavailable' &&
  (route.constraints.silentOutput || route.adapterId === 'openrouter-video-v1') &&
  (project === null ||
    (route.constraints.aspectRatios.includes(project.aspectRatio) &&
      route.constraints.resolutions.includes(project.resolution)));

const modelStatus = (
  selected: StudioMediaModelRef | null,
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
  selection: StudioMediaModelRef | null
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
  selection: StudioMediaModelRef | null,
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
      candidate.providerId === selection.providerId &&
      candidate.adapterId === selection.adapterId &&
      candidate.model === selection.model
  );
  if (diagnostic?.status === 'needs_setup') return { code: 'needs_setup', providerName: diagnostic.providerName };
  if (diagnostic?.status === 'health') return { code: 'health' };
  return { code: 'retired' };
};

const toRouteCatalog = (
  generation: StudioGenerationRouteCatalog,
  project: StudioProjectV2 | null
): StudioRouteCatalogV2 => {
  const catalogFor = (kind: StudioMediaKind): StudioMediaRouteCatalog => {
    const selection = project?.routing[kind] ?? null;
    const routes = generation.routes.filter((route) => route.kind === kind && routeSupportsProject(route, project));
    const chosen = selectedRoute(generation, project, kind, selection);
    return {
      status: modelStatus(selection, routes.length, chosen !== null),
      selected: selection === null ? null : toMediaChoice(selection, kind),
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

const requestedKind = (project: StudioProjectV2, job: StudioJobV2): StudioMediaKind =>
  jobOutputRole(job) === 'reference' ? 'image' : (ownValue(project.shots, job.shotId)?.mediaKind ?? 'image');

const toRendererJob = (project: StudioProjectV2, job: StudioJobV2): StudioRendererJobV2 => ({
  id: job.id,
  projectId: job.projectId,
  shotId: job.shotId,
  status: job.status,
  provider: toMediaChoice(job.provider, requestedKind(project, job)),
  ...(job.outputRole === undefined ? {} : { outputRole: job.outputRole }),
  outputAssetIds: [...job.outputAssetIds],
  error: job.error === null ? null : { ...job.error },
  canCancel: canCancelJobV2(job),
  canRetryDownload: job.status === 'failed' && job.error?.code === 'download_failed' && job.providerJobId !== null,
  ...(job.progress === undefined ? {} : { progress: job.progress }),
  retryOfJobId: job.retryOfJobId,
  retryReason: job.retryReason,
  duplicateChargeAcknowledged: job.duplicateChargeAcknowledged,
  duplicateChargeAcknowledgedAt: job.duplicateChargeAcknowledgedAt,
  createdAt: job.createdAt,
  updatedAt: job.updatedAt,
});

const toRendererProject = (project: StudioProjectV2): StudioRendererProjectV2 => {
  const cloned = structuredClone(project);
  return {
    ...cloned,
    jobs: Object.fromEntries(Object.entries(project.jobs).map(([jobId, job]) => [jobId, toRendererJob(project, job)])),
    routing: {
      image: project.routing.image === null ? null : toMediaChoice(project.routing.image, 'image'),
      video: project.routing.video === null ? null : toMediaChoice(project.routing.video, 'video'),
    },
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
  shot.mediaKind === 'video'
    ? Number.isInteger(shot.durationSeconds) &&
      shot.durationSeconds >= STUDIO_MIN_SHOT_SECONDS &&
      shot.durationSeconds <= STUDIO_MAX_SHOT_SECONDS
    : Number.isInteger(shot.durationSeconds) && shot.durationSeconds >= 1 && shot.durationSeconds <= 60;

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

const activeShotOwners = (project: StudioProjectV2): Map<string, string> => {
  const owners = new Map<string, string>();
  for (let beatIndex = 0; beatIndex < project.beatOrder.length; beatIndex += 1) {
    const beatId = project.beatOrder[beatIndex]!;
    const beat = ownValue(project.beats, beatId);
    if (beat === undefined) continue;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      owners.set(beat.shotOrder[shotIndex]!, beatId);
    }
  }
  return owners;
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

const assertSubmitRequest = (input: StudioSubmitShotsRequestV2): void => {
  if (!isRecord(input) || !hasKeys(input, SUBMIT_REQUIRED_KEYS, SUBMIT_OPTIONAL_KEYS)) {
    throw invalid('Invalid Studio shot generation request');
  }
  assertSafeId(input.projectId, 'project id');
  assertRevision(input.expectedRevision);
  if (
    !isDenseArray(input.shotIds, STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) ||
    input.shotIds.length < 1 ||
    !isDenseArray(input.routes, STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST) ||
    input.routes.length !== input.shotIds.length ||
    typeof input.catalogVersion !== 'string' ||
    input.catalogVersion.length < 1 ||
    input.catalogVersion.length > 64 ||
    (input.outputRole !== undefined && input.outputRole !== 'take' && input.outputRole !== 'reference')
  ) {
    throw invalid('Invalid Studio shot generation request');
  }
  const selected = new Set<string>();
  for (let index = 0; index < input.shotIds.length; index += 1) {
    const shotId = input.shotIds[index];
    if (!isSafeId(shotId) || selected.has(shotId)) throw invalid('Invalid Studio shot generation selection');
    selected.add(shotId);
  }
  const routed = new Set<string>();
  for (let index = 0; index < input.routes.length; index += 1) {
    const route = input.routes[index];
    if (
      !isRecord(route) ||
      !hasExactKeys(route, ROUTE_CHOICE_KEYS) ||
      !isSafeId(route.shotId) ||
      !selected.has(route.shotId) ||
      routed.has(route.shotId) ||
      !isSafeId(route.choiceId) ||
      (route.kind !== 'image' && route.kind !== 'video')
    ) {
      throw invalid('Invalid Studio shot generation route');
    }
    routed.add(route.shotId);
  }
  const outputRole = input.outputRole ?? 'take';
  if (outputRole === 'reference') {
    if (!isDenseArray(input.referencePrompts, STUDIO_MAX_GENERATION_SHOTS_PER_REQUEST)) {
      throw invalid('Invalid Studio shot reference prompts');
    }
    const promptShots = new Set<string>();
    for (let index = 0; index < input.referencePrompts.length; index += 1) {
      const prompt = input.referencePrompts[index];
      if (
        !isRecord(prompt) ||
        !hasExactKeys(prompt, REFERENCE_PROMPT_KEYS) ||
        !selected.has(prompt.shotId) ||
        promptShots.has(prompt.shotId) ||
        typeof prompt.prompt !== 'string' ||
        prompt.prompt.trim().length < 1 ||
        prompt.prompt.length > STUDIO_REFERENCE_PROMPT_MAX_LENGTH
      ) {
        throw invalid('Invalid Studio shot reference prompts');
      }
      promptShots.add(prompt.shotId);
    }
    if (promptShots.size !== selected.size) throw invalid('Invalid Studio shot reference prompts');
  } else if (input.referencePrompts !== undefined) {
    throw invalid('Invalid Studio shot reference prompts');
  }
};

const assertReviewedShots = (project: StudioProjectV2, input: StudioSubmitShotsRequestV2): void => {
  if (project.revision !== input.expectedRevision) {
    throw new CreativeStudioStoreError('stale_project', 'Studio project has changed');
  }
  const owners = activeShotOwners(project);
  const requested = new Set(input.shotIds);
  const canonicalOrder: string[] = [];
  for (let beatIndex = 0; beatIndex < project.beatOrder.length; beatIndex += 1) {
    const beat = ownValue(project.beats, project.beatOrder[beatIndex]!)!;
    for (let shotIndex = 0; shotIndex < beat.shotOrder.length; shotIndex += 1) {
      const shotId = beat.shotOrder[shotIndex]!;
      if (requested.has(shotId)) canonicalOrder.push(shotId);
    }
  }
  if (
    canonicalOrder.length !== input.shotIds.length ||
    canonicalOrder.some((shotId, index) => shotId !== input.shotIds[index]) ||
    input.shotIds.some((shotId) => {
      const beatId = owners.get(shotId);
      if (beatId === undefined) return true;
      if ((input.outputRole ?? 'take') === 'take') {
        return !readinessForShot(project, beatId, shotId).ready;
      }
      const shot = ownValue(project.shots, shotId)!;
      return shot.jobIds.some((jobId) => {
        const job = ownValue(project.jobs, jobId);
        return job !== undefined && ACTIVE_JOB_STATUSES.has(job.status);
      });
    })
  ) {
    throw new CreativeStudioServiceError('invalid_payload');
  }
};

const routeSupportsShot = (
  route: StudioGenerationRoute,
  project: StudioProjectV2,
  shotId: string,
  outputRole: StudioOutputRole
): boolean => {
  const shot = ownValue(project.shots, shotId);
  if (shot === undefined) return false;
  const kind = outputRole === 'reference' ? 'image' : shot.mediaKind;
  return (
    route.kind === kind &&
    routeSupportsProject(route, project) &&
    shot.durationSeconds >= route.constraints.minDurationSeconds &&
    shot.durationSeconds <= route.constraints.maxDurationSeconds &&
    (outputRole === 'reference' || shot.referenceAssetId === null || route.constraints.supportsFirstFrame)
  );
};

/** Creates the schema-2 service beside, but deliberately outside, the registered schema-1 surface. */
export const createCreativeStudioServiceV2 = (deps: CreativeStudioServiceV2Deps): CreativeStudioServiceV2 => {
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
      const deleted = await deps.store.deleteProjectV2(input.projectId, input.expectedRevision);
      if (deleted) deps.onProjectUpdated(input.projectId);
      return deleted;
    },

    async applyMutations(input): Promise<StudioMutationBatchResultV2> {
      const result = await deps.store.applyMutationBatchV2(input);
      return {
        project: notify(result.project),
        createdBeatIds: [...result.createdBeatIds],
        createdShotIds: [...result.createdShotIds],
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

    async submitShots(input): Promise<StudioRendererJobV2[]> {
      assertSubmitRequest(input);
      assertReviewedShots(await loadSupported(input.projectId), input);
      const generation = await listGenerationRoutes();
      if (generation.generationCatalogVersion !== input.catalogVersion) {
        throw new CreativeStudioServiceError('invalid_route');
      }
      const project = await loadSupported(input.projectId);
      assertReviewedShots(project, input);
      const outputRole = input.outputRole ?? 'take';
      const resolvedRoutes = input.routes.map((choice) => {
        const route = generation.routes.find(
          (candidate) => candidate.choiceId === choice.choiceId && candidate.kind === choice.kind
        );
        const selected = project.routing[choice.kind];
        if (
          route === undefined ||
          selected === null ||
          !routeMatchesSelection(route, selected) ||
          !routeSupportsShot(route, project, choice.shotId, outputRole)
        ) {
          throw new CreativeStudioServiceError('invalid_route');
        }
        return {
          shotId: choice.shotId,
          providerId: route.providerId,
          adapterId: route.adapterId,
          model: route.model,
          kind: route.kind,
        };
      });
      const jobs = await deps.jobManager.submitShots({
        projectId: input.projectId,
        shotIds: [...input.shotIds],
        expectedRevision: input.expectedRevision,
        routes: resolvedRoutes,
        catalogVersion: generation.generationCatalogVersion,
        ...(input.outputRole === undefined ? {} : { outputRole: input.outputRole }),
        ...(input.referencePrompts === undefined
          ? {}
          : { referencePrompts: input.referencePrompts.map((prompt) => ({ ...prompt })) }),
      });
      return jobs.map((job) => toRendererJob(project, job));
    },

    async cancelJob(input): Promise<StudioRendererJobV2> {
      assertJobRequest(input);
      const project = await loadSupported(input.projectId);
      return toRendererJob(project, await deps.jobManager.cancelJobV2(input));
    },

    async retryJob(input): Promise<StudioRendererJobV2> {
      assertJobRequest(input);
      if (
        input.acknowledgePossibleDuplicateCharge !== undefined &&
        typeof input.acknowledgePossibleDuplicateCharge !== 'boolean'
      ) {
        throw invalid('Invalid Studio duplicate-charge acknowledgement');
      }
      const project = await loadSupported(input.projectId);
      return toRendererJob(project, await deps.jobManager.retryJobV2(input));
    },

    async retryDownload(input): Promise<StudioRendererJobV2> {
      assertJobRequest(input);
      const project = await loadSupported(input.projectId);
      return toRendererJob(project, await deps.jobManager.retryDownloadV2(input));
    },
  };
};
