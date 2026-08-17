/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  GenerationProviderAdapter,
  ProviderCancelResult,
  ProviderFetch,
  ProviderHttpResponse,
  ProviderJobSnapshot,
  ProviderOutput,
  ProviderSubmitResult,
  ResolvedStudioGenerationRequest,
  SanitizedProviderError,
  StudioConnectionCandidate,
  StudioConnectionValidation,
  StudioRouteValidation,
} from './types';
import {
  hasImageConditioningFields,
  isValidProviderJobId,
  ProviderDeadlineError,
  runWithProviderDeadline,
} from './types';

const FIRST_FRAME_MAX_BYTES = 30 * 1024 * 1024;
const VALIDATION_TIMEOUT_MS = 10_000;
const ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4']);
const RESOLUTIONS = new Set(['720p', '1080p']);
const CANCELLATION_POLICIES = new Set(['none', 'queued_only', 'queued_and_running']);
const HTTP_LOOPBACK_HOSTS = new Set(['127.0.0.1', '[::1]']);

export class MediaGatewayAdapterError extends Error {
  readonly code: SanitizedProviderError['code'];

  constructor(code: SanitizedProviderError['code']) {
    super(code);
    this.name = 'MediaGatewayAdapterError';
    this.code = code;
  }
}

export type MediaGatewayAdapterDeps = { fetch?: ProviderFetch; validationTimeoutMs?: number };

const isAllowedHttpGatewayHost = (hostname: string): boolean => {
  if (HTTP_LOOPBACK_HOSTS.has(hostname)) return true;
  const octets = hostname.split('.').map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return false;
  }
  const [first, second] = octets;
  return (
    first === 10 ||
    (first === 172 && second !== undefined && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
};

const normalizedBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && (url.protocol !== 'http:' || !isAllowedHttpGatewayHost(url.hostname)))
    )
      return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const safeJson = async (response: ProviderHttpResponse): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new MediaGatewayAdapterError('invalid_response');
  }
};

const mapStatusError = (status: number): SanitizedProviderError => {
  if (status === 401) return { code: 'auth' };
  if (status === 429) return { code: 'rate_limited' };
  if (status >= 500) return { code: 'provider_unavailable' };
  return { code: 'unknown' };
};

const defaultFetch: ProviderFetch = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, json: async () => response.json() };
};

const sanitizedCapabilities = (value: unknown, model: string): Record<string, unknown> | null => {
  const root = record(value);
  const video = root && record(root.video);
  const capabilities = root && record(root.capabilities);
  const nestedVideo = capabilities && record(capabilities.video);
  const selectedVideo = video ?? nestedVideo;
  const mediaKinds = root?.media_kinds ?? capabilities?.media_kinds;
  const models = root?.models ?? capabilities?.models;
  const modes = selectedVideo?.audio_modes;
  if (
    (root?.schema_version ?? capabilities?.schema_version) !== 1 ||
    !selectedVideo ||
    !Array.isArray(mediaKinds) ||
    mediaKinds.length === 0 ||
    mediaKinds.length > 8 ||
    mediaKinds.some((kind) => typeof kind !== 'string' || kind.length === 0 || kind.length > 64) ||
    !mediaKinds.includes('video') ||
    !Array.isArray(models) ||
    models.length === 0 ||
    models.length > 128 ||
    models.some((candidate) => typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 256) ||
    !models.includes(model) ||
    !Array.isArray(modes) ||
    modes.length === 0 ||
    modes.length > 8 ||
    modes.some((mode) => typeof mode !== 'string' || mode.length === 0 || mode.length > 32) ||
    !modes.includes('none')
  )
    return null;
  const rawAspectRatios = selectedVideo.aspect_ratios;
  const rawResolutions = selectedVideo.resolutions;
  const aspectRatios =
    Array.isArray(rawAspectRatios) &&
    rawAspectRatios.length > 0 &&
    rawAspectRatios.length <= 5 &&
    rawAspectRatios.every((ratio) => typeof ratio === 'string' && ASPECT_RATIOS.has(ratio)) &&
    new Set(rawAspectRatios).size === rawAspectRatios.length
      ? (rawAspectRatios as Array<'16:9' | '9:16' | '1:1' | '4:3' | '3:4'>)
      : null;
  const resolutions =
    Array.isArray(rawResolutions) &&
    rawResolutions.length > 0 &&
    rawResolutions.length <= 2 &&
    rawResolutions.every((resolution) => typeof resolution === 'string' && RESOLUTIONS.has(resolution)) &&
    new Set(rawResolutions).size === rawResolutions.length
      ? (rawResolutions as Array<'720p' | '1080p'>)
      : null;
  const minimum = selectedVideo.min_duration_seconds;
  const maximum = selectedVideo.max_duration_seconds;
  const cancellationPolicy = selectedVideo.cancellation_policy;
  if (
    !aspectRatios ||
    !resolutions ||
    !Number.isInteger(minimum) ||
    (minimum as number) < 1 ||
    (minimum as number) > 60 ||
    !Number.isInteger(maximum) ||
    (maximum as number) < 1 ||
    (maximum as number) > 60 ||
    (minimum as number) > (maximum as number) ||
    (selectedVideo.supports_first_frame !== undefined && typeof selectedVideo.supports_first_frame !== 'boolean') ||
    (selectedVideo.cancellation !== undefined && typeof selectedVideo.cancellation !== 'boolean') ||
    (cancellationPolicy !== undefined &&
      (typeof cancellationPolicy !== 'string' || !CANCELLATION_POLICIES.has(cancellationPolicy)))
  )
    return null;
  return {
    mediaKinds: ['video'],
    audioModes: modes.filter((mode): mode is string => typeof mode === 'string'),
    aspectRatios,
    resolutions,
    minDurationSeconds: minimum as number,
    maxDurationSeconds: maximum as number,
    supportsFirstFrame: selectedVideo.supports_first_frame === true,
    maxConditioningImages: 0,
    cancellationPolicy:
      cancellationPolicy === 'none' ||
      cancellationPolicy === 'queued_only' ||
      cancellationPolicy === 'queued_and_running'
        ? cancellationPolicy
        : selectedVideo.cancellation === true
          ? 'queued_only'
          : 'none',
  };
};

const isGatewayOutputUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > 16 * 1024) return false;
  try {
    const url = new URL(value);
    return !url.username && !url.password && (url.protocol === 'http:' || url.protocol === 'https:');
  } catch {
    return false;
  }
};

const isGatewayVideoMimeType = (value: unknown): value is 'video/mp4' | 'video/webm' =>
  value === 'video/mp4' || value === 'video/webm';

const outputsFrom = (value: unknown): ProviderOutput[] | null => {
  const root = record(value);
  const candidates = root?.outputs ?? root?.output;
  const list = Array.isArray(candidates) ? candidates : candidates === undefined ? [] : [candidates];
  const outputs = list.flatMap((candidate) => {
    const item = record(candidate);
    const url = item?.url;
    const mimeType = item?.mime_type;
    const byteSize = item?.byte_size;
    return typeof url === 'string' && isGatewayOutputUrl(url) && isGatewayVideoMimeType(mimeType)
      ? [
          {
            mediaKind: 'video' as const,
            role: 'primary' as const,
            source: { kind: 'url' as const, url },
            mimeType,
            ...(typeof byteSize === 'number' && Number.isSafeInteger(byteSize) && byteSize > 0 ? { byteSize } : {}),
          },
        ]
      : [];
  });
  return outputs.length > 0 ? outputs : null;
};

const statusOf = (value: unknown): string | null => {
  const root = record(value);
  return typeof root?.status === 'string' ? root.status.toLowerCase() : null;
};

const progressOf = (value: unknown): number | undefined => {
  const progress = record(value)?.progress;
  return typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100
    ? progress
    : undefined;
};

const idOf = (value: unknown): string | null => {
  const root = record(value);
  const id = root?.id ?? root?.job_id;
  return typeof id === 'string' && isValidProviderJobId(id) ? id : null;
};

const firstFramePayload = async (request: ResolvedStudioGenerationRequest): Promise<Array<Record<string, string>>> => {
  if (!request.firstFrame) return [];
  if (request.firstFrame.byteSize > FIRST_FRAME_MAX_BYTES) throw new MediaGatewayAdapterError('unsupported');
  const dataUrl = await request.firstFrame.asDataUrl(FIRST_FRAME_MAX_BYTES);
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match) throw new MediaGatewayAdapterError('invalid_response');
  return [{ role: 'first_frame', mime_type: match[1], data_base64: match[2] }];
};

const requestValidation = (
  request: ResolvedStudioGenerationRequest,
  provider: Pick<IProvider, 'base_url' | 'api_key'>
): StudioRouteValidation => {
  if (
    request.mediaKind !== 'video' ||
    hasImageConditioningFields(request) ||
    !normalizedBaseUrl(provider.base_url) ||
    !provider.api_key.trim()
  ) {
    return { ok: false, issues: [{ code: 'provider_unavailable' }] };
  }
  if (!Number.isInteger(request.durationSeconds) || request.durationSeconds < 1 || request.durationSeconds > 60) {
    return { ok: false, issues: [{ code: 'invalid_duration' }] };
  }
  return {
    ok: true,
    normalized: {
      aspectRatio: request.aspectRatio,
      resolution: request.resolution,
      durationSeconds: request.durationSeconds,
    },
  };
};

/** Provider-neutral remote adapter for a user-hosted WePrompt Media Gateway. */
export const createMediaGatewayAdapter = (deps: MediaGatewayAdapterDeps = {}): GenerationProviderAdapter => {
  const fetcher = deps.fetch ?? defaultFetch;
  const validationTimeoutMs = deps.validationTimeoutMs ?? VALIDATION_TIMEOUT_MS;
  const jobPath = (providerJobId: string): string => {
    if (!isValidProviderJobId(providerJobId)) throw new MediaGatewayAdapterError('invalid_response');
    return encodeURIComponent(providerJobId);
  };
  const request = async (
    provider: TProviderWithModel,
    path: string,
    init: Omit<Parameters<ProviderFetch>[1], 'headers'>,
    requireJson = true
  ): Promise<unknown> => {
    const baseUrl = normalizedBaseUrl(provider.base_url);
    if (!baseUrl) throw new MediaGatewayAdapterError('unsupported');
    if (!provider.api_key.trim()) throw new MediaGatewayAdapterError('auth');
    let response: ProviderHttpResponse;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        redirect: 'error',
        headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' },
      });
    } catch (error) {
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        throw new MediaGatewayAdapterError('timeout');
      }
      throw new MediaGatewayAdapterError('provider_unavailable');
    }
    if (response.status < 200 || response.status >= 300)
      throw new MediaGatewayAdapterError(mapStatusError(response.status).code);
    if (!requireJson || response.status === 204) return undefined;
    return safeJson(response);
  };

  return {
    id: 'weprompt-media-gateway-v1',

    async validateConnection(
      _input: StudioConnectionCandidate,
      provider: IProvider,
      signal: AbortSignal
    ): Promise<StudioConnectionValidation> {
      if (!provider.api_key.trim()) return { ok: false, error: { code: 'auth' } };
      if (!normalizedBaseUrl(provider.base_url)) return { ok: false, error: { code: 'unsupported' } };
      try {
        const capabilities = await runWithProviderDeadline(signal, validationTimeoutMs, (deadlineSignal) =>
          request({ ...provider, use_model: _input.model }, '/v1/capabilities', {
            method: 'GET',
            signal: deadlineSignal,
          })
        );
        const sanitized = sanitizedCapabilities(capabilities, _input.model);
        return sanitized ? { ok: true, capabilities: sanitized } : { ok: false, error: { code: 'unsupported' } };
      } catch (error) {
        return {
          ok: false,
          error: {
            code:
              error instanceof ProviderDeadlineError
                ? 'timeout'
                : error instanceof MediaGatewayAdapterError
                  ? error.code
                  : 'unknown',
          },
        };
      }
    },

    validateRequest: requestValidation,

    async submit(
      requestInput: ResolvedStudioGenerationRequest,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderSubmitResult> {
      const validation = requestValidation(requestInput, provider);
      if (!validation.ok) throw new MediaGatewayAdapterError('unsupported');
      const body = await request(provider, '/v1/generations', {
        method: 'POST',
        body: JSON.stringify({
          model: provider.use_model,
          prompt: requestInput.prompt,
          aspect_ratio: requestInput.aspectRatio,
          resolution: requestInput.resolution,
          duration_seconds: requestInput.durationSeconds,
          idempotency_key: requestInput.idempotencyKey,
          audio_mode: 'none',
          inputs: await firstFramePayload(requestInput),
        }),
        signal,
      });
      const status = statusOf(body);
      const outputs = outputsFrom(body);
      if (status === 'succeeded' || status === 'success') {
        if (!outputs) throw new MediaGatewayAdapterError('no_output');
        return { kind: 'complete', outputs };
      }
      if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
        throw new MediaGatewayAdapterError('unknown');
      }
      if (status === 'expired') throw new MediaGatewayAdapterError('provider_unavailable');
      if (status === null && outputs) return { kind: 'complete', outputs };
      if (!status || !['queued', 'running'].includes(status)) {
        throw new MediaGatewayAdapterError('invalid_response');
      }
      const id = idOf(body);
      if (!id) throw new MediaGatewayAdapterError('invalid_response');
      return { kind: 'remote', providerJobId: id };
    },

    async poll(providerJobId: string, provider: TProviderWithModel, signal: AbortSignal): Promise<ProviderJobSnapshot> {
      const body = await request(provider, `/v1/generations/${jobPath(providerJobId)}`, {
        method: 'GET',
        signal,
      });
      switch (statusOf(body)) {
        case 'queued': {
          const progress = progressOf(body);
          return { status: 'queued', ...(progress === undefined ? {} : { progress }) };
        }
        case 'running': {
          const progress = progressOf(body);
          return { status: 'running', ...(progress === undefined ? {} : { progress }) };
        }
        case 'succeeded':
        case 'success': {
          const outputs = outputsFrom(body);
          return outputs ? { status: 'succeeded', outputs } : { status: 'failed', error: { code: 'no_output' } };
        }
        case 'cancelled':
        case 'canceled':
          return { status: 'cancelled', error: { code: 'unknown' } };
        case 'expired':
          return { status: 'expired', error: { code: 'provider_unavailable' } };
        case 'failed':
          return { status: 'failed', error: { code: 'unknown' } };
        default:
          throw new MediaGatewayAdapterError('invalid_response');
      }
    },

    async cancel(
      providerJobId: string,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderCancelResult> {
      try {
        await request(
          provider,
          `/v1/generations/${jobPath(providerJobId)}/cancel`,
          {
            method: 'POST',
            signal,
          },
          false
        );
        return { kind: 'cancelled' };
      } catch (error) {
        if (error instanceof MediaGatewayAdapterError && error.code === 'unknown') {
          return { kind: 'refused', error: { code: 'cancellation_refused' } };
        }
        throw error;
      }
    },
  };
};
