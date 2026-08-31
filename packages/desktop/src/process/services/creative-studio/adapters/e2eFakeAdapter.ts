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
  SanitizedProviderErrorCode,
  StudioRouteValidation,
} from './types';
import { hasImageConditioningFields } from './types';
import { BYTEPLUS_SEEDANCE_BASE_URL } from './bytePlusSeedanceAdapter';
import { validateImageConditioningRequest } from './imageAdapter';

export const STUDIO_E2E_FAKE_PROVIDER_ID = 'weprompt_studio_e2e';
export const STUDIO_E2E_CREDENTIAL_SENTINEL = 'STUDIO_SECRET_CREDENTIAL_SENTINEL';
export const STUDIO_E2E_PROVIDER_URL_SENTINEL = 'https://studio-provider-url-sentinel.invalid/v1';
export const STUDIO_E2E_PROVIDER_JOB_SENTINEL = 'STUDIO_PROVIDER_JOB_SENTINEL';
export const STUDIO_E2E_OUTPUT_URL_SENTINEL = 'https://studio-output-sentinel.invalid/generated.png';
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
export const STUDIO_E2E_FAKE_IMAGE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWMwTpv5HwAENAIyeXoBdAAAAABJRU5ErkJggg==';
const IMAGE_BYTES = Buffer.from(STUDIO_E2E_FAKE_IMAGE_BASE64, 'base64');
// Four identical checkerboard bands exercise the real variation-grid detector without a paid provider.
const VARIATION_GRID_IMAGE_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAo0lEQVRoge2SIQ4AQRDC+P+ne3bsOboBWdUmJGecGXnahFiAgdMgcbbb2Hj0AU/FUCbEAgycBomz3cbGow94KoYyIRZg4DRInO02Nh59wFMxlAmxAAOnQeJst7Hx6AOeiqFMiAUYOA0SZ7uNjUcf8FQMZUIswMBpkDjbbWw8+oCnYigTYgEGToPE2W5j49EHPBVDmRALMHAaJM52GxtPm9Bf/gH9QulaQafBsQAAAABJRU5ErkJggg==',
  'base64'
);
// A deterministic 16x16, ten-second H.264 MP4. The comment metadata intentionally retains the
// raw-output sentinel so the E2E boundary oracle still proves provider-only bytes never enter JSON.
const VIDEO_BYTES = Buffer.from(
  'AAAAIGZ0eXBpc29tAAACAGlzb21pc28yYXZjMW1wNDEAAAPBbW9vdgAAAGxtdmhkAAAAAAAAAAAAAAAAAAAD6AAAJxAAAQAAAQAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAAArV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAABAAAAAAAAJxAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAABAAAAAQAAAAAAAkZWR0cwAAABxlbHN0AAAAAAAAAAEAACcQAACAAAABAAAAAAItbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAABAAAACgABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAAB2G1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAZhzdGJsAAAAwHN0c2QAAAAAAAAAAQAAALBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAABAAEABIAAAASAAAAAAAAAABFExhdmM2My4xLjEwMSBsaWJ4MjY0AAAAAAAAAAAAAAAAGP//AAAANmF2Y0MBZAAK/+EAGWdkAAqscgRewEQAAAMABAAAAwAIPEiWEYABAAZo6EOPLIv9+PgAAAAAEHBhc3AAAAABAAAAAQAAABRidHJ0AAAAAAAAApYAAAAAAAAAGHN0dHMAAAAAAAAAAQAAAAoAAEAAAAAAFHN0c3MAAAAAAAAAAQAAAAEAAAA4Y3R0cwAAAAAAAAAFAAAAAQAAgAAAAAABAAKAAAAAAAEAAQAAAAAAAwAAAAAAAAAEAABAAAAAABxzdHNjAAAAAAAAAAEAAAABAAAACgAAAAEAAAA8c3RzegAAAAAAAAAAAAAACgAAAscAAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAANAAAADQAAAA0AAAAUc3RjbwAAAAAAAAABAAAD8QAAAJh1ZHRhAAAAkG1ldGEAAAAAAAAAIWhkbHIAAAAAAAAAAG1kaXJhcHBsAAAAAAAAAAAAAAAAY2lsc3QAAAAkqXRvbwAAABxkYXRhAAAAAQAAAABMYXZmNjMuMS4xMDEAAAA3qWNtdAAAAC9kYXRhAAAAAQAAAABTVFVESU9fUkFXX09VVFBVVF9CT0RZX1NFTlRJTkVMAAAACGZyZWUAAANEbWRhdAAAAq8GBf//q9xF6b3m2Ui3lizYINkj7u94MjY0IC0gY29yZSAxNjUgcjMyMjIgYjM1NjA1YSAtIEguMjY0L01QRUctNCBBVkMgY29kZWMgLSBDb3B5bGVmdCAyMDAzLTIwMjUgLSBodHRwOi8vd3d3LnZpZGVvbGFuLm9yZy94MjY0Lmh0bWwgLSBvcHRpb25zOiBjYWJhYz0xIHJlZj0xNiBkZWJsb2NrPTE6MDowIGFuYWx5c2U9MHgzOjB4MTMzIG1lPXVtaCBzdWJtZT0xMCBwc3k9MSBwc3lfcmQ9MS4wMDowLjAwIG1peGVkX3JlZj0xIG1lX3JhbmdlPTI0IGNocm9tYV9tZT0xIHRyZWxsaXM9MiA4eDhkY3Q9MSBjcW09MCBkZWFkem9uZT0yMSwxMSBmYXN0X3Bza2lwPTEgY2hyb21hX3FwX29mZnNldD0tMiB0aHJlYWRzPTEgbG9va2FoZWFkX3RocmVhZHM9MSBzbGljZWRfdGhyZWFkcz0wIG5yPTAgZGVjaW1hdGU9MSBpbnRlcmxhY2VkPTAgYmx1cmF5X2NvbXBhdD0wIGNvbnN0cmFpbmVkX2ludHJhPTAgYmZyYW1lcz04IGJfcHlyYW1pZD0yIGJfYWRhcHQ9MiBiX2JpYXM9MCBkaXJlY3Q9MyB3ZWlnaHRiPTEgb3Blbl9nb3A9MCB3ZWlnaHRwPTIga2V5aW50PTI1MCBrZXlpbnRfbWluPTEgc2NlbmVjdXQ9NDAgaW50cmFfcmVmcmVzaD0wIHJjX2xvb2thaGVhZD02MCByYz1jcmYgbWJ0cmVlPTEgY3JmPTIzLjAgcWNvbXA9MC42MCBxcG1pbj0wIHFwbWF4PTY5IHFwc3RlcD00IGlwX3JhdGlvPTEuNDAgYXE9MToxLjAwAIAAAAAQZYiBAAL//vfUt8yy7gcjgQAAAAlBmgktiCv//vAAAAAJQZ4QhxBf/4aBAAAACQGeGCaIK/+SgAAAAAkBnhhGiCv/koEAAAAJAZ4YZogr/5KBAAAACQGeGK1IK/+SgQAAAAkBnhjNSCv/koEAAAAJAZ4Y7Ugr/5KAAAAACQGeGQ1IK/+SgA==',
  'base64'
);

export type StudioE2EFakeOutputScript =
  | { kind: 'managed_file' }
  | { kind: 'url'; url?: string }
  | { kind: 'variation_grid' }
  | { kind: 'duplicate_outputs' };

export type StudioE2EFakePollStep =
  | { kind: 'queued' }
  | { kind: 'running'; progress?: number }
  | { kind: 'hold'; status: 'queued' | 'running'; progress?: number }
  | { kind: 'succeeded'; output: StudioE2EFakeOutputScript }
  | { kind: 'failed'; code: SanitizedProviderErrorCode }
  | { kind: 'malformed' };

export type StudioE2EFakeTaskScript =
  | { submit?: { kind: 'remote' }; pollSteps?: readonly StudioE2EFakePollStep[] }
  | { submit: { kind: 'hold' }; pollSteps?: readonly StudioE2EFakePollStep[] }
  | { submit: { kind: 'complete'; output: StudioE2EFakeOutputScript } }
  | { submit: { kind: 'rejected'; code: SanitizedProviderErrorCode } };

export type StudioE2EFakeTask = {
  mediaKind: StudioMediaKind;
  model: string;
  pollCount: number;
  cancelled: boolean;
  cancellationOpen: boolean;
  holdObserved: boolean;
  pollStepIndex: number;
  pollSteps: StudioE2EFakePollStep[];
};

export type StudioE2EFakeRemoteState = {
  tasks: Map<string, StudioE2EFakeTask>;
  submissionHolds: Map<string, StudioE2EFakeSubmissionHold>;
  submissionOutcomes: Map<string, StudioE2EFakeSubmissionOutcome>;
  submitHoldWaiters: Map<string, Set<() => void>>;
  taskHoldWaiters: Map<string, Set<() => void>>;
  taskCounter: number;
  pendingTaskScripts: StudioE2EFakeTaskScript[];
  providerCallCounts: StudioE2EFakeProviderCallCounts;
  providerRequests: StudioE2EFakeProviderRequest[];
};

export type StudioE2EFakeSubmissionHold = {
  idempotencyKey: string;
  providerJobId: string;
  mediaKind: StudioMediaKind;
  model: string;
  requestFingerprint: string;
  pollSteps: StudioE2EFakePollStep[];
  released: boolean;
  aborted: boolean;
};

export type StudioE2EFakeSubmissionOutcome = {
  mediaKind: StudioMediaKind;
  model: string;
  requestFingerprint: string;
  result: { kind: 'remote'; providerJobId: string } | { kind: 'complete'; output: StudioE2EFakeOutputScript };
};

const cloneOutputScript = (output: StudioE2EFakeOutputScript): StudioE2EFakeOutputScript => ({ ...output });

const clonePollStep = (step: StudioE2EFakePollStep): StudioE2EFakePollStep =>
  step.kind === 'succeeded' ? { ...step, output: cloneOutputScript(step.output) } : { ...step };

const cloneTaskScript = (script: StudioE2EFakeTaskScript): StudioE2EFakeTaskScript => {
  if (script.submit?.kind === 'complete') {
    return { submit: { kind: 'complete', output: cloneOutputScript(script.submit.output) } };
  }
  if (script.submit?.kind === 'rejected') return { submit: { ...script.submit } };
  const pollSteps = 'pollSteps' in script ? script.pollSteps : undefined;
  const clonedPollSteps = pollSteps === undefined ? {} : { pollSteps: pollSteps.map(clonePollStep) };
  if (script.submit?.kind === 'hold') return { submit: { kind: 'hold' }, ...clonedPollSteps };
  return {
    ...(script.submit === undefined ? {} : { submit: { kind: 'remote' as const } }),
    ...clonedPollSteps,
  };
};

export const createStudioE2EFakeRemoteState = (
  taskScripts: readonly StudioE2EFakeTaskScript[] = []
): StudioE2EFakeRemoteState => ({
  tasks: new Map(),
  submissionHolds: new Map(),
  submissionOutcomes: new Map(),
  submitHoldWaiters: new Map(),
  taskHoldWaiters: new Map(),
  taskCounter: 0,
  pendingTaskScripts: taskScripts.map(cloneTaskScript),
  providerCallCounts: {
    validateConnection: 0,
    submit: 0,
    poll: 0,
    cancel: 0,
  },
  providerRequests: [],
});

export type StudioE2EFakeBundle = {
  catalogProfile: StudioE2EFakeCatalogProfile;
  provider: IProvider;
  connections: StudioConnectionBinding[];
  adapters: ReadonlyMap<StudioProviderAdapterId, GenerationProviderAdapter>;
  getProviderCallCounts(): StudioE2EFakeProviderCallCounts;
  getProviderRequestLog(): StudioE2EFakeProviderRequestLog;
  enqueueTaskScript(script: StudioE2EFakeTaskScript): void;
  releaseSubmitHold(idempotencyKey: string): boolean;
  releaseTaskHold(providerJobId: string): boolean;
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
  readonly code: SanitizedProviderErrorCode;

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

const fingerprintSubmission = (request: ResolvedStudioGenerationRequest, model: string): string =>
  JSON.stringify({
    model,
    prompt: request.prompt,
    mediaKind: request.mediaKind,
    aspectRatio: request.aspectRatio,
    resolution: request.resolution,
    durationSeconds: request.durationSeconds,
    routeConstraints:
      request.routeConstraints === undefined
        ? null
        : {
            aspectRatios: [...request.routeConstraints.aspectRatios],
            resolutions: [...request.routeConstraints.resolutions],
            minDurationSeconds: request.routeConstraints.minDurationSeconds,
            maxDurationSeconds: request.routeConstraints.maxDurationSeconds,
            supportedDurationSeconds:
              request.routeConstraints.supportedDurationSeconds === undefined
                ? null
                : [...request.routeConstraints.supportedDurationSeconds],
            supportsFirstFrame: request.routeConstraints.supportsFirstFrame,
            maxConditioningImages: request.routeConstraints.maxConditioningImages,
            silentOutput: request.routeConstraints.silentOutput,
          },
    firstFrame:
      request.firstFrame === undefined
        ? null
        : {
            assetId: request.firstFrame.assetId,
            mimeType: request.firstFrame.mimeType,
            byteSize: request.firstFrame.byteSize,
          },
    conditioningImages:
      request.conditioningImages === undefined
        ? null
        : request.conditioningImages.map(({ assetId, mimeType, byteSize }) => ({ assetId, mimeType, byteSize })),
    conditioningImageLimit: request.conditioningImageLimit ?? null,
  });

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
  let providerCallCountWrite = Promise.resolve();
  let providerCallCountWriteOrdinal = 0;
  let providerRequestWrite = Promise.resolve();
  let providerRequestWriteOrdinal = 0;
  const fixtureFlights = new Map<StudioMediaKind | 'variation_grid', Promise<ProviderOutput>>();
  const ensureFixtureDirectory = async (): Promise<void> => {
    await mkdir(fixtureDirectory, { recursive: true });
    const directoryStats = await lstat(fixtureDirectory);
    if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
      throw new StudioE2EFakeAdapterError('unknown');
    }
  };

  const releaseTaskWaiters = (providerJobId: string): void => {
    const waiters = remoteState.taskHoldWaiters.get(providerJobId);
    if (waiters === undefined) return;
    remoteState.taskHoldWaiters.delete(providerJobId);
    for (const release of waiters) release();
  };

  const releaseSubmitWaiters = (idempotencyKey: string): void => {
    const waiters = remoteState.submitHoldWaiters.get(idempotencyKey);
    if (waiters === undefined) return;
    remoteState.submitHoldWaiters.delete(idempotencyKey);
    for (const release of waiters) release();
  };

  const waitForSubmitRelease = async (hold: StudioE2EFakeSubmissionHold, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    if (hold.aborted) throw new StudioE2EFakeAdapterError('unknown');
    if (hold.released) return;
    await new Promise<void>((resolve, reject) => {
      const waiters = remoteState.submitHoldWaiters.get(hold.idempotencyKey) ?? new Set<() => void>();
      remoteState.submitHoldWaiters.set(hold.idempotencyKey, waiters);
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort);
        waiters.delete(release);
        if (waiters.size === 0) remoteState.submitHoldWaiters.delete(hold.idempotencyKey);
      };
      const release = (): void => {
        cleanup();
        if (hold.aborted) reject(new StudioE2EFakeAdapterError('unknown'));
        else resolve();
      };
      const abort = (): void => {
        cleanup();
        hold.aborted = true;
        reject(signal.reason ?? new Error('aborted'));
        releaseSubmitWaiters(hold.idempotencyKey);
      };
      waiters.add(release);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  };

  const waitForTaskRelease = async (providerJobId: string, signal: AbortSignal): Promise<void> => {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const waiters = remoteState.taskHoldWaiters.get(providerJobId) ?? new Set<() => void>();
      remoteState.taskHoldWaiters.set(providerJobId, waiters);
      const cleanup = (): void => {
        signal.removeEventListener('abort', abort);
        waiters.delete(release);
        if (waiters.size === 0) remoteState.taskHoldWaiters.delete(providerJobId);
      };
      const release = (): void => {
        cleanup();
        resolve();
      };
      const abort = (): void => {
        cleanup();
        reject(signal.reason ?? new Error('aborted'));
      };
      waiters.add(release);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  };

  const recordProviderCall = async (method: keyof StudioE2EFakeProviderCallCounts): Promise<void> => {
    if (remoteState.providerCallCounts[method] >= Number.MAX_SAFE_INTEGER) {
      throw new StudioE2EFakeAdapterError('unknown');
    }
    remoteState.providerCallCounts[method] += 1;
    if (catalogProfile !== 'explicit-selection') return;
    const snapshot = JSON.stringify(remoteState.providerCallCounts);
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
    const conditioningAssetIds = request.conditioningImages?.map(({ assetId }) => assetId) ?? [];
    const firstFrameAssetId = request.firstFrame?.assetId ?? null;
    if (
      catalogProfile === 'explicit-selection' &&
      (request.prompt.length === 0 ||
        request.prompt.length > STUDIO_MAX_GENERATION_PROMPT_LENGTH ||
        conditioningAssetIds.length > PROVIDER_REQUEST_MAX_INPUTS ||
        conditioningAssetIds.some((assetId) => !SAFE_STUDIO_ID.test(assetId)) ||
        (firstFrameAssetId !== null && !SAFE_STUDIO_ID.test(firstFrameAssetId)))
    )
      throw new StudioE2EFakeAdapterError('unsupported');
    const safeRequest = {
      mediaKind: request.mediaKind,
      model,
      prompt: request.prompt,
      conditioningAssetIds: [...conditioningAssetIds],
      firstFrameAssetId,
    };
    providerRequestWrite = providerRequestWrite.then(async () => {
      if (
        catalogProfile === 'explicit-selection' &&
        remoteState.providerRequests.length >= PROVIDER_REQUESTS_MAX_RECORDS
      ) {
        throw new StudioE2EFakeAdapterError('unknown');
      }
      const record: StudioE2EFakeProviderRequest = {
        ordinal: remoteState.providerRequests.length + 1,
        ...safeRequest,
      };
      const nextLog: StudioE2EFakeProviderRequestLog = {
        schemaVersion: STUDIO_E2E_FAKE_PROVIDER_REQUESTS_SCHEMA_VERSION,
        requests: [...remoteState.providerRequests, record],
      };
      if (catalogProfile === 'explicit-selection') {
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
      }
      remoteState.providerRequests.push(record);
    });
    await providerRequestWrite;
  };

  const publishFixture = async (
    mediaKind: StudioMediaKind,
    fixtureKind: 'managed_file' | 'variation_grid' = 'managed_file'
  ): Promise<ProviderOutput> => {
    if (fixtureKind === 'variation_grid' && mediaKind !== 'image') {
      throw new StudioE2EFakeAdapterError('unsupported');
    }
    const bytes =
      fixtureKind === 'variation_grid' ? VARIATION_GRID_IMAGE_BYTES : mediaKind === 'image' ? IMAGE_BYTES : VIDEO_BYTES;
    const mimeType = mediaKind === 'image' ? 'image/png' : 'video/mp4';
    const fileName =
      fixtureKind === 'variation_grid'
        ? 'fake-variation-grid.png'
        : mediaKind === 'image'
          ? 'fake-image.png'
          : 'fake-video.mp4';
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
      ...(mediaKind === 'video'
        ? { durationSeconds: 10 }
        : fixtureKind === 'variation_grid'
          ? { width: 64, height: 64 }
          : { width: 1, height: 1 }),
    };
  };

  const ensureFixture = (
    mediaKind: StudioMediaKind,
    fixtureKind: 'managed_file' | 'variation_grid' = 'managed_file'
  ): Promise<ProviderOutput> => {
    const flightKey = fixtureKind === 'variation_grid' ? fixtureKind : mediaKind;
    const existing = fixtureFlights.get(flightKey);
    if (existing !== undefined) return existing;
    const flight = publishFixture(mediaKind, fixtureKind);
    fixtureFlights.set(flightKey, flight);
    const release = (): void => {
      if (fixtureFlights.get(flightKey) === flight) fixtureFlights.delete(flightKey);
    };
    void flight.then(release, release);
    return flight;
  };

  const outputForScript = async (
    mediaKind: StudioMediaKind,
    outputScript: StudioE2EFakeOutputScript
  ): Promise<ProviderOutput[]> => {
    if (outputScript.kind === 'url') {
      return [
        {
          mediaKind,
          role: 'primary',
          source: { kind: 'url', url: outputScript.url ?? STUDIO_E2E_OUTPUT_URL_SENTINEL },
          mimeType: mediaKind === 'image' ? 'image/png' : 'video/mp4',
          ...(mediaKind === 'video' ? { durationSeconds: 10 } : {}),
        },
      ];
    }
    if (outputScript.kind === 'variation_grid') {
      return [await ensureFixture(mediaKind, 'variation_grid')];
    }
    const primary = await ensureFixture(mediaKind);
    if (outputScript.kind === 'duplicate_outputs') {
      return [primary, { ...primary, source: { ...primary.source } }];
    }
    return [primary];
  };

  const defaultPollSteps = (): StudioE2EFakePollStep[] => [
    ...(catalogProfile === 'lifecycle'
      ? ([{ kind: 'queued' }, { kind: 'running', progress: 50 }] satisfies StudioE2EFakePollStep[])
      : []),
    { kind: 'succeeded', output: { kind: 'managed_file' } },
  ];

  const nextTaskScript = (): StudioE2EFakeTaskScript => {
    const scripted = remoteState.pendingTaskScripts.shift();
    if (scripted !== undefined) return cloneTaskScript(scripted);
    return { submit: { kind: 'remote' }, pollSteps: defaultPollSteps() };
  };

  const snapshotForStep = async (
    task: StudioE2EFakeTask,
    step: StudioE2EFakePollStep
  ): Promise<ProviderJobSnapshot> => {
    if (step.kind === 'queued') {
      task.cancellationOpen = true;
      return { status: 'queued' };
    }
    if (step.kind === 'running') {
      task.cancellationOpen = false;
      return { status: 'running', ...(step.progress === undefined ? {} : { progress: step.progress }) };
    }
    if (step.kind === 'hold') {
      task.cancellationOpen = step.status === 'queued';
      return {
        status: step.status,
        ...(step.progress === undefined ? {} : { progress: step.progress }),
      };
    }
    task.cancellationOpen = false;
    if (step.kind === 'failed') return { status: 'failed', error: { code: step.code } };
    if (step.kind === 'malformed') {
      return { status: 'running', progress: 'malformed' } as unknown as ProviderJobSnapshot;
    }
    return { status: 'succeeded', outputs: await outputForScript(task.mediaKind, step.output) };
  };

  const pollScriptedTask = async (
    providerJobId: string,
    task: StudioE2EFakeTask,
    signal: AbortSignal
  ): Promise<ProviderJobSnapshot> => {
    const stepIndex = Math.min(task.pollStepIndex, task.pollSteps.length - 1);
    const step = task.pollSteps[stepIndex];
    if (step === undefined) throw new StudioE2EFakeAdapterError('unknown');
    if (step.kind === 'hold') {
      if (!task.holdObserved) {
        task.holdObserved = true;
        return snapshotForStep(task, step);
      }
      await waitForTaskRelease(providerJobId, signal);
      if (task.cancelled) return { status: 'cancelled', error: { code: 'unknown' } };
      return pollScriptedTask(providerJobId, task, signal);
    }
    if (task.pollStepIndex < task.pollSteps.length - 1) task.pollStepIndex += 1;
    return snapshotForStep(task, step);
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
      const requestFingerprint = fingerprintSubmission(request, provider.use_model);
      const existingOutcome = remoteState.submissionOutcomes.get(request.idempotencyKey);
      if (existingOutcome !== undefined) {
        if (
          existingOutcome.mediaKind !== mediaKind ||
          existingOutcome.model !== provider.use_model ||
          existingOutcome.requestFingerprint !== requestFingerprint
        ) {
          throw new StudioE2EFakeAdapterError('unknown');
        }
        if (existingOutcome.result.kind === 'remote') {
          return { kind: 'remote', providerJobId: existingOutcome.result.providerJobId };
        }
        return {
          kind: 'complete',
          outputs: await outputForScript(mediaKind, existingOutcome.result.output),
        };
      }
      const existingHold = remoteState.submissionHolds.get(request.idempotencyKey);
      if (existingHold !== undefined) {
        if (
          existingHold.mediaKind !== mediaKind ||
          existingHold.model !== provider.use_model ||
          existingHold.requestFingerprint !== requestFingerprint ||
          existingHold.aborted
        ) {
          throw new StudioE2EFakeAdapterError('unknown');
        }
        await waitForSubmitRelease(existingHold, signal);
        return { kind: 'remote', providerJobId: existingHold.providerJobId };
      }
      const taskScript = nextTaskScript();
      remoteState.taskCounter += 1;
      if (taskScript.submit?.kind === 'rejected') {
        throw new StudioE2EFakeAdapterError(taskScript.submit.code);
      }
      if (taskScript.submit?.kind === 'complete') {
        const outcome: StudioE2EFakeSubmissionOutcome = {
          mediaKind,
          model: provider.use_model,
          requestFingerprint,
          result: { kind: 'complete', output: cloneOutputScript(taskScript.submit.output) },
        };
        remoteState.submissionOutcomes.set(request.idempotencyKey, outcome);
        return {
          kind: 'complete',
          outputs: await outputForScript(mediaKind, taskScript.submit.output),
        };
      }
      const providerJobId = `${STUDIO_E2E_PROVIDER_JOB_SENTINEL}_${remoteState.taskCounter}`;
      const scriptedPollSteps = 'pollSteps' in taskScript ? taskScript.pollSteps : undefined;
      const pollSteps =
        scriptedPollSteps === undefined || scriptedPollSteps.length === 0
          ? defaultPollSteps()
          : scriptedPollSteps.map(clonePollStep);
      if (taskScript.submit?.kind === 'hold') {
        const hold: StudioE2EFakeSubmissionHold = {
          idempotencyKey: request.idempotencyKey,
          providerJobId,
          mediaKind,
          model: provider.use_model,
          requestFingerprint,
          pollSteps,
          released: false,
          aborted: false,
        };
        remoteState.submissionHolds.set(request.idempotencyKey, hold);
        await waitForSubmitRelease(hold, signal);
      }
      remoteState.tasks.set(providerJobId, {
        mediaKind,
        model: provider.use_model,
        pollCount: 0,
        cancelled: false,
        cancellationOpen: true,
        holdObserved: false,
        pollStepIndex: 0,
        pollSteps,
      });
      remoteState.submissionOutcomes.set(request.idempotencyKey, {
        mediaKind,
        model: provider.use_model,
        requestFingerprint,
        result: { kind: 'remote', providerJobId },
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
      return pollScriptedTask(providerJobId, task, signal);
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
      if (!task.cancellationOpen) {
        return { kind: 'refused', error: { code: 'cancellation_refused' } };
      }
      task.cancelled = true;
      releaseTaskWaiters(providerJobId);
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
    getProviderCallCounts: (): StudioE2EFakeProviderCallCounts => ({ ...remoteState.providerCallCounts }),
    getProviderRequestLog: (): StudioE2EFakeProviderRequestLog => ({
      schemaVersion: STUDIO_E2E_FAKE_PROVIDER_REQUESTS_SCHEMA_VERSION,
      requests: remoteState.providerRequests.map((request) => ({
        ...request,
        conditioningAssetIds: [...request.conditioningAssetIds],
      })),
    }),
    enqueueTaskScript(script: StudioE2EFakeTaskScript): void {
      remoteState.pendingTaskScripts.push(cloneTaskScript(script));
    },
    releaseSubmitHold(idempotencyKey: string): boolean {
      const hold = remoteState.submissionHolds.get(idempotencyKey);
      if (hold === undefined || hold.released || hold.aborted) return false;
      hold.released = true;
      releaseSubmitWaiters(idempotencyKey);
      return true;
    },
    releaseTaskHold(providerJobId: string): boolean {
      const task = remoteState.tasks.get(providerJobId);
      if (task === undefined) return false;
      const step = task.pollSteps[Math.min(task.pollStepIndex, task.pollSteps.length - 1)];
      if (step?.kind !== 'hold' || task.pollStepIndex >= task.pollSteps.length - 1) return false;
      task.pollStepIndex += 1;
      task.holdObserved = false;
      releaseTaskWaiters(providerJobId);
      return true;
    },
    async dispose(): Promise<void> {
      if (ownsRemoteState) remoteState.tasks.clear();
      await Promise.allSettled([providerCallCountWrite, providerRequestWrite]);
      await rm(fixtureDirectory, { force: true, recursive: true });
    },
  };
};
