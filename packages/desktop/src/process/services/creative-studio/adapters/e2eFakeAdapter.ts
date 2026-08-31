/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import {
  STUDIO_MAX_GENERATION_PROMPT_LENGTH,
  type StudioConnectionBinding,
  type StudioMediaKind,
  type StudioProviderAdapterId,
  type StudioRouteIssue,
} from '@/common/types/project/creativeStudioTypes';
import type {
  GenerationProviderAdapter,
  ProviderJobSnapshot,
  ProviderOutput,
  ProviderSubmitResult,
  ResolvedStudioGenerationRequest,
  StudioRouteValidation,
} from './types';
import { hasImageConditioningFields } from './types';
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
export const STUDIO_E2E_FAKE_PROVIDER_CALL_COUNTS_FILE = 'provider-call-counts.json';
export const STUDIO_E2E_FAKE_PROVIDER_REQUESTS_FILE = 'provider-requests.json';
export const STUDIO_E2E_FAKE_PROVIDER_REQUESTS_SCHEMA_VERSION = 1 as const;
const STUDIO_E2E_IMAGE_MODEL = 'weprompt-e2e-image';
const STUDIO_E2E_NEXT_IMAGE_MODEL = 'weprompt-e2e-image-next';
const STUDIO_E2E_VIDEO_MODEL = 'weprompt-e2e-video';
const STUDIO_E2E_EXPLICIT_SELECTION_VIDEO_MODEL = 'dreamina-seedance-2-0-260128';
const FAKE_FIXTURE_DIRECTORY = STUDIO_E2E_FAKE_FIXTURE_DIRECTORY;
const PROVIDER_CALL_COUNTS_MAX_BYTES = 512;
const PROVIDER_REQUESTS_MAX_RECORDS = 32;
const PROVIDER_REQUESTS_MAX_BYTES = 8 * 1024 * 1024;
const PROVIDER_REQUEST_MAX_INPUTS = 6;
const SAFE_STUDIO_ID = /^[A-Za-z0-9_-]{1,256}$/;
const IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwTpv5HwAENAIyeXoBdAAAAABJRU5ErkJggg==',
  'base64'
);
// A deterministic 16x16, ten-second H.264 MP4. The comment metadata intentionally retains the
// raw-output sentinel so the E2E boundary oracle still proves provider-only bytes never enter JSON.
const VIDEO_BYTES = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAJxAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAArV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAJxAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAACcQAACAAAABAAAAAAItbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAACgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB2G1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAZhzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqscgRewEQAAAMABAAAAwAIPEiWEYABAAZo6EOPLIv9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAApYAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAoAAEAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAA4Y3R0cwAAAAAAAAAFAAAAAQAAgAAAAAABAAKAAAAAAAEAAQAAAAAAAwAAAAAAAAAEAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAACgAAAAEAAAA8c3RzegAAAAAAAAAAAAAACgAAAscAAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAAUc3RjbwAAAAAAAAABAAAD8QAAAJh1ZHRhAAAAkG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAAY2lsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAAA3qWNtdAAAAC9kYXRhAAAAAQAAAABTVFVESU9fUkFXX09VVFBVVF9CT0RZX1NFTlRJTkVMAAAACGZyZWUAAANEbWRhdAAAAq8GBf//q9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0xNiBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTMzIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz04IGJfcHlyYW1pZD0yIGJfYWRhcHQ9MiBiX2JpYXM9MCBkaXJlY3Q9MyB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD02MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAQZYiBAAL//vfUt8yy7gcjgQAAAAlBmgktiCv//vAAAAAJQZ4QhxBf/4aBAAAACQGeGCaIK/+SgAAAAAkBnhhGiCv/koEAAAAJAZ4YZogr/5KBAAAACQGeGK1IK/+SgQAAAAkBnhjNSCv/koEAAAAJAZ4Y7Ugr/5KAAAAACQGeGQ1IK/+SgA==',
  'base64'
);

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

export type StudioE2EFakeProviderCallCounts = {
  validateConnection: number;
  submit: number;
  poll: number;
  cancel: number;
};

export type StudioE2EFakeProviderRequest = {
  ordinal: number;
  mediaKind: StudioMediaKind;
  model: string;
  prompt: string;
  conditioningAssetIds: string[];
  firstFrameAssetId: string | null;
};

export type StudioE2EFakeProviderRequestLog = {
  schemaVersion: typeof STUDIO_E2E_FAKE_PROVIDER_REQUESTS_SCHEMA_VERSION;
  requests: StudioE2EFakeProviderRequest[];
};

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
    request.mediaKind !== mediaKind ||
    (mediaKind === 'video' && hasImageConditioningFields(request))
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
  const providerCallCounts: StudioE2EFakeProviderCallCounts = {
    validateConnection: 0,
    submit: 0,
    poll: 0,
    cancel: 0,
  };
  let providerCallCountWrite = Promise.resolve();
  let providerCallCountWriteOrdinal = 0;
  const providerRequests: StudioE2EFakeProviderRequest[] = [];
  let providerRequestWrite = Promise.resolve();
  let providerRequestWriteOrdinal = 0;
  const fixtureFlights = new Map<StudioMediaKind, Promise<ProviderOutput>>();

  const ensureFixtureDirectory = async (): Promise<void> => {
    await mkdir(fixtureDirectory, { recursive: true });
    const directoryStats = await lstat(fixtureDirectory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new StudioE2EFakeAdapterError('unknown');
    }
  };

  /** The explicit-selection profile exists only behind the runtime's dual E2E flags. */
  const recordProviderCall = async (method: keyof StudioE2EFakeProviderCallCounts): Promise<void> => {
    if (catalogProfile !== 'explicit-selection') return;
    if (providerCallCounts[method] >= Number.MAX_SAFE_INTEGER) throw new StudioE2EFakeAdapterError('unknown');
    providerCallCounts[method] += 1;
    const snapshot = JSON.stringify(providerCallCounts);
    if (Buffer.byteLength(snapshot, 'utf8') > PROVIDER_CALL_COUNTS_MAX_BYTES) {
      throw new StudioE2EFakeAdapterError('unknown');
    }
    providerCallCountWriteOrdinal += 1;
    const temporaryFile = path.join(
      fixtureDirectory,
      `.${STUDIO_E2E_FAKE_PROVIDER_CALL_COUNTS_FILE}.${process.pid}.${providerCallCountWriteOrdinal}.tmp`
    );
    providerCallCountWrite = providerCallCountWrite.then(async () => {
      await ensureFixtureDirectory();
      await writeFile(temporaryFile, snapshot, { flag: 'wx' });
      try {
        await rename(temporaryFile, path.join(fixtureDirectory, STUDIO_E2E_FAKE_PROVIDER_CALL_COUNTS_FILE));
      } catch (error) {
        await rm(temporaryFile, { force: true });
        throw error;
      }
    });
    await providerCallCountWrite;
  };

  /**
   * Records only the exact, renderer-safe facts needed by the opted-in E2E dispatch oracle.
   * Never serialize the provider, callbacks, paths, URLs, credentials, or the arbitrary request.
   */
  const recordProviderRequest = async (request: ResolvedStudioGenerationRequest, model: string): Promise<void> => {
    if (catalogProfile !== 'explicit-selection') return;
    const conditioningAssetIds = request.conditioningImages?.map(({ assetId }) => assetId) ?? [];
    const firstFrameAssetId = request.firstFrame?.assetId ?? null;
    if (
      request.prompt.length === 0 ||
      request.prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH ||
      conditioningAssetIds.length > PROVIDER_REQUEST_MAX_INPUTS ||
      conditioningAssetIds.some((assetId) => !SAFE_STUDIO_ID.test(assetId)) ||
      (firstFrameAssetId !== null && !SAFE_STUDIO_ID.test(firstFrameAssetId))
    ) {
      throw new StudioE2EFakeAdapterError('unsupported');
    }
    const safeRequest = {
      mediaKind: request.mediaKind,
      model,
      prompt: request.prompt,
      conditioningAssetIds: [...conditioningAssetIds],
      firstFrameAssetId,
    };
    providerRequestWrite = providerRequestWrite.then(async () => {
      if (providerRequests.length >= PROVIDER_REQUESTS_MAX_RECORDS) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      const record: StudioE2EFakeProviderRequest = {
        ordinal: providerRequests.length + 1,
        ...safeRequest,
      };
      const nextLog: StudioE2EFakeProviderRequestLog = {
        schemaVersion: STUDIO_E2E_FAKE_PROVIDER_REQUESTS_SCHEMA_VERSION,
        requests: [...providerRequests, record],
      };
      const snapshot = JSON.stringify(nextLog);
      if (Buffer.byteLength(snapshot, 'utf8') > PROVIDER_REQUESTS_MAX_BYTES) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      providerRequestWriteOrdinal += 1;
      const temporaryFile = path.join(
        fixtureDirectory,
        `.${STUDIO_E2E_FAKE_PROVIDER_REQUESTS_FILE}.${process.pid}.${providerRequestWriteOrdinal}.tmp`
      );
      await ensureFixtureDirectory();
      try {
        await writeFile(temporaryFile, snapshot, { flag: 'wx' });
        await rename(temporaryFile, path.join(fixtureDirectory, STUDIO_E2E_FAKE_PROVIDER_REQUESTS_FILE));
      } catch (error) {
        await rm(temporaryFile, { force: true });
        throw error;
      }
      providerRequests.push(record);
    });
    await providerRequestWrite;
  };

  const publishFixture = async (mediaKind: StudioMediaKind): Promise<ProviderOutput> => {
    const bytes = mediaKind === 'image' ? IMAGE_BYTES : VIDEO_BYTES;
    const mimeType = mediaKind === 'image' ? 'image/png' : 'video/mp4';
    const fileName = mediaKind === 'image' ? 'fake-image.png' : 'fake-video.mp4';
    await ensureFixtureDirectory();
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
      ...(mediaKind === 'video' ? { durationSeconds: 10 } : { width: 1, height: 1 }),
    };
  };

  const ensureFixture = (mediaKind: StudioMediaKind): Promise<ProviderOutput> => {
    const existing = fixtureFlights.get(mediaKind);
    if (existing !== undefined) return existing;
    const flight = publishFixture(mediaKind);
    fixtureFlights.set(mediaKind, flight);
    const release = (): void => {
      if (fixtureFlights.get(mediaKind) === flight) fixtureFlights.delete(mediaKind);
    };
    void flight.then(release, release);
    return flight;
  };

  const createAdapter = (
    id: Extract<StudioProviderAdapterId, 'byteplus-seedance-v1' | 'weprompt-image-v1' | 'weprompt-media-gateway-v1'>,
    mediaKind: StudioMediaKind
  ): GenerationProviderAdapter => ({
    id,
    async validateConnection(input, provider, signal) {
      signal.throwIfAborted();
      await recordProviderCall('validateConnection');
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
      await recordProviderCall('submit');
      if (!validateRequest(request, provider, catalogProfile, mediaKind).ok)
        throw new StudioE2EFakeAdapterError('unsupported');
      await recordProviderRequest(request, provider.use_model);
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
      await recordProviderCall('poll');
      if (provider.id !== STUDIO_E2E_FAKE_PROVIDER_ID || !acceptsModel(catalogProfile, mediaKind, provider.use_model)) {
        throw new StudioE2EFakeAdapterError('unsupported');
      }
      const task = remoteState.tasks.get(providerJobId);
      if (!task || task.mediaKind !== mediaKind || task.model !== provider.use_model) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      if (task.cancelled) return { status: 'cancelled', error: { code: 'unknown' } };
      task.pollCount += 1;
      if (catalogProfile === 'lifecycle' && task.pollCount === 1) return { status: 'queued' };
      if (catalogProfile === 'lifecycle' && task.pollCount === 2) return { status: 'running', progress: 50 };
      return { status: 'succeeded', outputs: [await ensureFixture(mediaKind)] };
    },
    async cancel(providerJobId, provider, signal) {
      signal.throwIfAborted();
      await recordProviderCall('cancel');
      if (provider.id !== STUDIO_E2E_FAKE_PROVIDER_ID || !acceptsModel(catalogProfile, mediaKind, provider.use_model)) {
        throw new StudioE2EFakeAdapterError('unsupported');
      }
      const task = remoteState.tasks.get(providerJobId);
      if (!task || task.mediaKind !== mediaKind || task.model !== provider.use_model) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      if (task.cancelled) return { kind: 'cancelled' };
      if (task.pollCount >= (catalogProfile === 'explicit-selection' ? 1 : 2)) {
        return { kind: 'refused', error: { code: 'cancellation_refused' } };
      }
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
      await Promise.allSettled([providerCallCountWrite, providerRequestWrite]);
      await rm(fixtureDirectory, { force: true, recursive: true });
    },
  };
};
