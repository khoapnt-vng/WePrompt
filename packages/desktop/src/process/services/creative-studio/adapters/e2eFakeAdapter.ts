/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import type {
  StudioConnectionBinding,
  StudioMediaKind,
  StudioProviderAdapterId,
  StudioRouteIssue,
} from '@/common/types/project/creativeStudioTypes';
import type {
  GenerationProviderAdapter,
  ProviderJobSnapshot,
  ProviderOutput,
  ProviderSubmitResult,
  ResolvedStudioGenerationRequest,
  StudioRouteValidation,
} from './types';
import { BYTEPLUS_SEEDANCE_BASE_URL } from './bytePlusSeedanceAdapter';
import { validateImageConditioningRequest } from './imageAdapter';

export const STUDIO_E2E_FAKE_PROVIDER_ID = 'weprompt_studio_e2e';
export const STUDIO_E2E_CREDENTIAL_SENTINEL = 'STUDIO_SECRET_CREDENTIAL_SENTINEL';
export const STUDIO_E2E_PROVIDER_URL_SENTINEL = 'https://studio-provider-url-sentinel.invalid/v1';
export const STUDIO_E2E_PROVIDER_JOB_SENTINEL = 'STUDIO_PROVIDER_JOB_SENTINEL';
export const STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL = 'STUDIO_RAW_OUTPUT_BODY_SENTINEL';
export const STUDIO_E2E_RAW_OUTPUT_PATH_SENTINEL = '/private/STUDIO_RAW_OUTPUT_PATH_SENTINEL/provider-output.bin';
export const STUDIO_E2E_BOUNDARY_SENTINELS = {
  credential: STUDIO_E2E_CREDENTIAL_SENTINEL,
  providerUrl: STUDIO_E2E_PROVIDER_URL_SENTINEL,
  providerJobId: STUDIO_E2E_PROVIDER_JOB_SENTINEL,
  rawOutputBody: STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL,
  rawOutputPath: STUDIO_E2E_RAW_OUTPUT_PATH_SENTINEL,
} as const;
export const STUDIO_E2E_FAKE_FIXTURE_DIRECTORY = '.studio-raw-output-path-sentinel';
const STUDIO_E2E_IMAGE_MODEL = 'weprompt-e2e-image';
const STUDIO_E2E_NEXT_IMAGE_MODEL = 'weprompt-e2e-image-next';
const STUDIO_E2E_VIDEO_MODEL = 'weprompt-e2e-video';
const STUDIO_E2E_EXPLICIT_SELECTION_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';
const FAKE_FIXTURE_DIRECTORY = STUDIO_E2E_FAKE_FIXTURE_DIRECTORY;
const RAW_OUTPUT_SENTINEL_BYTES = Buffer.from(STUDIO_E2E_RAW_OUTPUT_BODY_SENTINEL);
const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwTpv5HwAENAIyeXoBdAAAAABJRU5ErkJggg==',
  'base64'
);
const VIDEO_BYTES = Buffer.concat([
  Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex'),
  RAW_OUTPUT_SENTINEL_BYTES,
]);

export type StudioE2EFakeTask = {
  mediaKind: StudioMediaKind;
  model: string;
  pollCount: number;
  cancelled: boolean;
};

export type StudioE2EFakeRemoteState = {
  tasks: Map<string, StudioE2EFakeTask>;
  taskCounter: number;
};

export const createStudioE2EFakeRemoteState = (): StudioE2EFakeRemoteState => ({
  tasks: new Map(),
  taskCounter: 0,
});

export type StudioE2EFakeBundle = {
  catalogProfile: StudioE2EFakeCatalogProfile;
  provider: IProvider;
  connections: StudioConnectionBinding[];
  adapters: ReadonlyMap<StudioProviderAdapterId, GenerationProviderAdapter>;
  dispose(): Promise<void>;
};

/** The lifecycle profile is retained for direct tests; explicit selection is only for the E2E journey. */
export type StudioE2EFakeCatalogProfile = 'lifecycle' | 'explicit-selection';

export type StudioE2EFakeBundleDeps = {
  rootDir: string;
  catalogProfile?: StudioE2EFakeCatalogProfile;
  /** Test-only remote service state may outlive a runtime to model provider-side durability. */
  remoteState?: StudioE2EFakeRemoteState;
};

class StudioE2EFakeAdapterError extends Error {
  readonly code: 'unsupported' | 'unknown';

  constructor(code: StudioE2EFakeAdapterError['code']) {
    super(code);
    this.name = 'StudioE2EFakeAdapterError';
    this.code = code;
  }
}

const expectedModels = (catalogProfile: StudioE2EFakeCatalogProfile, mediaKind: StudioMediaKind): readonly string[] =>
  mediaKind === 'image'
    ? catalogProfile === 'explicit-selection'
      ? [STUDIO_E2E_IMAGE_MODEL]
      : [STUDIO_E2E_IMAGE_MODEL, STUDIO_E2E_NEXT_IMAGE_MODEL]
    : catalogProfile === 'explicit-selection'
      ? [STUDIO_E2E_EXPLICIT_SELECTION_VIDEO_MODEL]
      : [STUDIO_E2E_VIDEO_MODEL];

const acceptsModel = (
  catalogProfile: StudioE2EFakeCatalogProfile,
  mediaKind: StudioMediaKind,
  model: string
): boolean => expectedModels(catalogProfile, mediaKind).includes(model);

const validateRequest = (
  request: ResolvedStudioGenerationRequest,
  provider: { id: string; use_model: string },
  catalogProfile: StudioE2EFakeCatalogProfile,
  mediaKind: StudioMediaKind
): StudioRouteValidation => {
  const issues: StudioRouteIssue[] = [];
  if (
    provider.id !== STUDIO_E2E_FAKE_PROVIDER_ID ||
    !acceptsModel(catalogProfile, mediaKind, provider.use_model) ||
    request.mediaKind !== mediaKind
  ) {
    issues.push({ code: 'provider_unavailable' });
  }
  if (!Number.isInteger(request.durationSeconds) || request.durationSeconds < 1 || request.durationSeconds > 60) {
    issues.push({ code: 'invalid_duration' });
  }
  if (mediaKind === 'image' && !validateImageConditioningRequest(request, 6, false).ok) {
    issues.push({ code: 'provider_unavailable' });
  }
  return issues.length > 0
    ? { ok: false, issues }
    : {
        ok: true,
        normalized: {
          aspectRatio: request.aspectRatio,
          resolution: request.resolution,
          durationSeconds: request.durationSeconds,
        },
      };
};

/** Builds the deterministic fake only for a runtime that has already passed both E2E flag gates. */
export const createStudioE2EFakeBundle = ({
  rootDir,
  catalogProfile = 'lifecycle',
  remoteState: injectedRemoteState,
}: StudioE2EFakeBundleDeps): StudioE2EFakeBundle => {
  const resolvedRoot = path.resolve(rootDir);
  const fixtureDirectory = path.resolve(resolvedRoot, FAKE_FIXTURE_DIRECTORY);
  if (path.dirname(fixtureDirectory) !== resolvedRoot) throw new StudioE2EFakeAdapterError('unsupported');

  const remoteState = injectedRemoteState ?? createStudioE2EFakeRemoteState();
  const ownsRemoteState = injectedRemoteState === undefined;

  const ensureFixture = async (mediaKind: StudioMediaKind): Promise<ProviderOutput> => {
    const bytes = mediaKind === 'image' ? IMAGE_BYTES : VIDEO_BYTES;
    const mimeType = mediaKind === 'image' ? 'image/png' : 'video/mp4';
    const fileName = mediaKind === 'image' ? 'fake-image.png' : 'fake-video.mp4';
    await mkdir(fixtureDirectory, { recursive: true });
    const directoryStats = await lstat(fixtureDirectory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new StudioE2EFakeAdapterError('unknown');
    }
    const outputPath = path.join(fixtureDirectory, fileName);
    if (path.dirname(outputPath) !== fixtureDirectory) throw new StudioE2EFakeAdapterError('unknown');
    try {
      await writeFile(outputPath, bytes, { flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new StudioE2EFakeAdapterError('unknown');
      const [existingStats, existingBytes] = await Promise.all([lstat(outputPath), readFile(outputPath)]);
      if (!existingStats.isFile() || existingStats.isSymbolicLink() || !existingBytes.equals(bytes)) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
    }
    return {
      mediaKind,
      role: 'primary',
      source: { kind: 'file', path: outputPath },
      mimeType,
      byteSize: bytes.byteLength,
      ...(mediaKind === 'video' ? { durationSeconds: 4 } : { width: 1, height: 1 }),
    };
  };

  const createAdapter = (
    id: Extract<StudioProviderAdapterId, 'byteplus-seedance-v1' | 'weprompt-image-v1' | 'weprompt-media-gateway-v1'>,
    mediaKind: StudioMediaKind
  ): GenerationProviderAdapter => ({
    id,
    async validateConnection(input, provider, signal) {
      signal.throwIfAborted();
      return provider.id === STUDIO_E2E_FAKE_PROVIDER_ID && acceptsModel(catalogProfile, mediaKind, input.model)
        ? {
            ok: true,
            capabilities: {
              mediaKinds: [mediaKind],
              audioModes: ['none'],
              aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
              resolutions: ['720p', '1080p'],
              minDurationSeconds: 1,
              maxDurationSeconds: 60,
              supportsFirstFrame: true,
              maxConditioningImages: mediaKind === 'image' ? 6 : 0,
              cancellationPolicy: 'queued_only',
            },
          }
        : { ok: false, error: { code: 'unsupported' } };
    },
    validateRequest: (request, provider) => validateRequest(request, provider, catalogProfile, mediaKind),
    async submit(request, provider, signal) {
      signal.throwIfAborted();
      if (!validateRequest(request, provider, catalogProfile, mediaKind).ok)
        throw new StudioE2EFakeAdapterError('unsupported');
      remoteState.taskCounter += 1;
      const providerJobId = `${STUDIO_E2E_PROVIDER_JOB_SENTINEL}_${remoteState.taskCounter}`;
      remoteState.tasks.set(providerJobId, {
        mediaKind,
        model: provider.use_model,
        pollCount: 0,
        cancelled: false,
      });
      return {
        kind: 'remote',
        providerJobId,
        boundarySentinels: STUDIO_E2E_BOUNDARY_SENTINELS,
      } as ProviderSubmitResult;
    },
    async poll(providerJobId, provider, signal): Promise<ProviderJobSnapshot> {
      signal.throwIfAborted();
      if (provider.id !== STUDIO_E2E_FAKE_PROVIDER_ID || !acceptsModel(catalogProfile, mediaKind, provider.use_model)) {
        throw new StudioE2EFakeAdapterError('unsupported');
      }
      const task = remoteState.tasks.get(providerJobId);
      if (!task || task.mediaKind !== mediaKind || task.model !== provider.use_model) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      if (task.cancelled) return { status: 'cancelled', error: { code: 'unknown' } };
      task.pollCount += 1;
      if (task.pollCount === 1) return { status: 'queued' };
      if (task.pollCount === 2) return { status: 'running', progress: 50 };
      return { status: 'succeeded', outputs: [await ensureFixture(mediaKind)] };
    },
    async cancel(providerJobId, provider, signal) {
      signal.throwIfAborted();
      if (provider.id !== STUDIO_E2E_FAKE_PROVIDER_ID || !acceptsModel(catalogProfile, mediaKind, provider.use_model)) {
        throw new StudioE2EFakeAdapterError('unsupported');
      }
      const task = remoteState.tasks.get(providerJobId);
      if (!task || task.mediaKind !== mediaKind || task.model !== provider.use_model) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      if (task.cancelled) return { kind: 'cancelled' };
      if (task.pollCount >= 2) return { kind: 'refused', error: { code: 'cancellation_refused' } };
      task.cancelled = true;
      return { kind: 'cancelled' };
    },
  });

  const provider: IProvider = {
    id: STUDIO_E2E_FAKE_PROVIDER_ID,
    platform: 'gemini',
    name: 'WePrompt Studio E2E',
    base_url: catalogProfile === 'explicit-selection' ? BYTEPLUS_SEEDANCE_BASE_URL : STUDIO_E2E_PROVIDER_URL_SENTINEL,
    api_key: STUDIO_E2E_CREDENTIAL_SENTINEL,
    models: [...expectedModels(catalogProfile, 'image'), ...expectedModels(catalogProfile, 'video')],
    enabled: true,
    model_enabled: {
      [STUDIO_E2E_IMAGE_MODEL]: true,
      ...(catalogProfile === 'lifecycle'
        ? { [STUDIO_E2E_NEXT_IMAGE_MODEL]: true, [STUDIO_E2E_VIDEO_MODEL]: true }
        : {}),
      ...(catalogProfile === 'explicit-selection' ? { [STUDIO_E2E_EXPLICIT_SELECTION_VIDEO_MODEL]: true } : {}),
    },
    model_health: {
      [STUDIO_E2E_IMAGE_MODEL]: { status: 'healthy' },
      ...(catalogProfile === 'lifecycle'
        ? { [STUDIO_E2E_NEXT_IMAGE_MODEL]: { status: 'healthy' }, [STUDIO_E2E_VIDEO_MODEL]: { status: 'healthy' } }
        : {}),
      ...(catalogProfile === 'explicit-selection'
        ? { [STUDIO_E2E_EXPLICIT_SELECTION_VIDEO_MODEL]: { status: 'healthy' } }
        : {}),
    },
  };
  const lifecycleConnections: StudioConnectionBinding[] = [
    {
      schemaVersion: 1,
      id: 'weprompt_studio_e2e_video',
      providerId: STUDIO_E2E_FAKE_PROVIDER_ID,
      adapterId: 'weprompt-media-gateway-v1',
      model: STUDIO_E2E_VIDEO_MODEL,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 0,
        cancellationPolicy: 'queued_only',
      },
      validatedAt: '1970-01-01T00:00:00.000Z',
    },
    {
      schemaVersion: 1,
      id: 'weprompt_studio_e2e_image',
      providerId: STUDIO_E2E_FAKE_PROVIDER_ID,
      adapterId: 'weprompt-image-v1',
      model: STUDIO_E2E_IMAGE_MODEL,
      capabilities: {
        mediaKinds: ['image'],
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 6,
        cancellationPolicy: 'queued_only',
      },
      validatedAt: '1970-01-01T00:00:00.000Z',
    },
    {
      schemaVersion: 1,
      id: 'weprompt_studio_e2e_image_next',
      providerId: STUDIO_E2E_FAKE_PROVIDER_ID,
      adapterId: 'weprompt-image-v1',
      model: STUDIO_E2E_NEXT_IMAGE_MODEL,
      capabilities: {
        mediaKinds: ['image'],
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 6,
        cancellationPolicy: 'queued_only',
      },
      validatedAt: '1970-01-01T00:00:00.000Z',
    },
  ];
  const explicitSelectionConnections: StudioConnectionBinding[] = [
    {
      schemaVersion: 1,
      id: 'weprompt_studio_e2e_explicit_selection_image',
      providerId: STUDIO_E2E_FAKE_PROVIDER_ID,
      adapterId: 'weprompt-image-v1',
      model: STUDIO_E2E_IMAGE_MODEL,
      capabilities: {
        mediaKinds: ['image'],
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 1,
        maxDurationSeconds: 60,
        supportsFirstFrame: true,
        maxConditioningImages: 6,
        cancellationPolicy: 'queued_only',
      },
      validatedAt: '1970-01-01T00:00:00.000Z',
    },
    ...((['byteplus-seedance-v1', 'weprompt-media-gateway-v1'] as const).map((adapterId) => ({
      schemaVersion: 1,
      id: `weprompt_studio_e2e_explicit_selection_${adapterId}`,
      providerId: STUDIO_E2E_FAKE_PROVIDER_ID,
      adapterId,
      model: STUDIO_E2E_EXPLICIT_SELECTION_VIDEO_MODEL,
      capabilities: {
        mediaKinds: ['video'] as const,
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 15,
        supportsFirstFrame: true,
        maxConditioningImages: 0,
        cancellationPolicy: 'queued_only' as const,
      },
      validatedAt: '1970-01-01T00:00:00.000Z',
    })) satisfies StudioConnectionBinding[]),
  ];
  const connections = catalogProfile === 'explicit-selection' ? explicitSelectionConnections : lifecycleConnections;
  const adapters = new Map<StudioProviderAdapterId, GenerationProviderAdapter>([
    ['weprompt-image-v1', createAdapter('weprompt-image-v1', 'image')],
    ['weprompt-media-gateway-v1', createAdapter('weprompt-media-gateway-v1', 'video')],
    ...(catalogProfile === 'explicit-selection'
      ? [['byteplus-seedance-v1', createAdapter('byteplus-seedance-v1', 'video')] as const]
      : []),
  ]);

  return {
    catalogProfile,
    provider,
    connections,
    adapters,
    async dispose(): Promise<void> {
      if (ownsRemoteState) remoteState.tasks.clear();
      await rm(fixtureDirectory, { force: true, recursive: true });
    },
  };
};
