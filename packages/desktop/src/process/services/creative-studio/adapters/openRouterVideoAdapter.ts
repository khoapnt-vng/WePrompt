/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  GenerationProviderAdapter,
  ProviderFetch,
  ProviderHttpResponse,
  ProviderJobSnapshot,
  ProviderOutput,
  ProviderSubmitResult,
  ResolvedStudioGenerationRequest,
  SanitizedProviderError,
  StudioConnectionCandidate,
  StudioConnectionValidation,
  StudioGenerationRequest,
  StudioRouteIssue,
  StudioRouteValidation,
} from './types';
import { isValidProviderJobId, ProviderDeadlineError, runWithProviderDeadline } from './types';

export const OPENROUTER_VIDEO_BASE_URL = 'https://openrouter.ai/api/v1';
/**
 * OpenRouter models may support frame images, but this desktop adapter owns only managed local
 * assets. The documented video path requires a directly downloadable public HTTPS URL, and no
 * vetted publisher exists yet, so advertising first-frame support would permit a paid 400.
 */
export const OPENROUTER_MANAGED_FIRST_FRAME_SUPPORTED = false;
const OPENROUTER_HOST = 'openrouter.ai';
const VALIDATION_TIMEOUT_MS = 10_000;

export type OpenRouterVideoModelSpec = {
  minDuration: number;
  maxDuration: number;
  resolutions: readonly ('720p' | '1080p')[];
  ratios: readonly ('16:9' | '9:16' | '1:1' | '4:3' | '3:4')[];
  supportsAudio: boolean;
};

export const OPENROUTER_VIDEO_MODELS: Readonly<Record<string, OpenRouterVideoModelSpec>> = Object.freeze({
  'google/veo-3.1-lite': {
    minDuration: 4,
    maxDuration: 8,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16'],
    supportsAudio: true,
  },
  'google/veo-3.1-fast': {
    minDuration: 4,
    maxDuration: 8,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16'],
    supportsAudio: true,
  },
  'kwaivgi/kling-v3.0-std': {
    minDuration: 3,
    maxDuration: 15,
    resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
  },
  'kwaivgi/kling-v3.0-pro': {
    minDuration: 3,
    maxDuration: 15,
    resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
  },
  'bytedance/seedance-2.0': {
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsAudio: true,
  },
  'bytedance/seedance-2.0-fast': {
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsAudio: true,
  },
});

export class OpenRouterVideoAdapterError extends Error {
  readonly code: SanitizedProviderError['code'];

  constructor(code: SanitizedProviderError['code']) {
    super(code);
    this.name = 'OpenRouterVideoAdapterError';
    this.code = code;
  }
}

export type OpenRouterVideoAdapterDeps = { fetch?: ProviderFetch; validationTimeoutMs?: number };

const normalizedBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== OPENROUTER_HOST ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api/v1'
    )
      return null;
    return OPENROUTER_VIDEO_BASE_URL;
  } catch {
    return null;
  }
};

export const isSupportedOpenRouterVideoProvider = (provider: Pick<IProvider, 'base_url'>, model?: string): boolean =>
  normalizedBaseUrl(provider.base_url) === OPENROUTER_VIDEO_BASE_URL &&
  (model === undefined || OPENROUTER_VIDEO_MODELS[model] !== undefined);

export const getOpenRouterVideoModelSpec = (model: string): OpenRouterVideoModelSpec | null =>
  OPENROUTER_VIDEO_MODELS[model] ?? null;

const requestValidation = (request: StudioGenerationRequest, provider: TProviderWithModel): StudioRouteValidation => {
  const spec = getOpenRouterVideoModelSpec(provider.use_model);
  if (
    request.mediaKind !== 'video' ||
    !isSupportedOpenRouterVideoProvider(provider, provider.use_model) ||
    !spec ||
    !provider.api_key.trim()
  ) {
    return { ok: false, issues: [{ code: 'provider_unavailable' }] };
  }
  const issues: StudioRouteIssue[] = [];
  if (
    !Number.isInteger(request.durationSeconds) ||
    request.durationSeconds < spec.minDuration ||
    request.durationSeconds > spec.maxDuration
  ) {
    issues.push({ code: 'invalid_duration' });
  }
  if (!spec.resolutions.includes(request.resolution)) issues.push({ code: 'invalid_resolution' });
  if (!spec.ratios.includes(request.aspectRatio)) issues.push({ code: 'invalid_resolution' });
  if ('firstFrame' in request && request.firstFrame !== undefined && !OPENROUTER_MANAGED_FIRST_FRAME_SUPPORTED) {
    issues.push({ code: 'invalid_reference' });
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

const mapStatusError = (status: number): SanitizedProviderError => {
  if (status === 401 || status === 403) return { code: 'auth' };
  if (status === 429) return { code: 'rate_limited' };
  if (status >= 500) return { code: 'provider_unavailable' };
  return { code: 'unknown' };
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const safeJson = async (response: ProviderHttpResponse): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new OpenRouterVideoAdapterError('invalid_response');
  }
};

const jobId = (value: unknown): string | null => {
  const id = record(value)?.id;
  return typeof id === 'string' && isValidProviderJobId(id) ? id : null;
};

const jobStatus = (value: unknown): string | null => {
  const status = record(value)?.status;
  return typeof status === 'string' ? status.toLowerCase() : null;
};

const isOpenRouterOutputUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > 16 * 1024) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === OPENROUTER_HOST && !url.username && !url.password;
  } catch {
    return false;
  }
};

const outputUrls = (value: unknown): ProviderOutput[] | null => {
  const urls = record(value)?.unsigned_urls;
  if (!Array.isArray(urls) || typeof urls[0] !== 'string' || !isOpenRouterOutputUrl(urls[0])) return null;
  return [{ mediaKind: 'video', role: 'primary', source: { kind: 'url', url: urls[0] }, mimeType: 'video/mp4' }];
};

const defaultFetch: ProviderFetch = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, json: async () => response.json() };
};

const requestJson = async (
  fetcher: ProviderFetch,
  url: string,
  provider: TProviderWithModel,
  init: Omit<Parameters<ProviderFetch>[1], 'headers'>,
  requireJson = true
): Promise<unknown> => {
  if (!isSupportedOpenRouterVideoProvider(provider, provider.use_model) || !provider.api_key.trim()) {
    throw new OpenRouterVideoAdapterError('unsupported');
  }
  let response: ProviderHttpResponse;
  try {
    response = await fetcher(url, {
      ...init,
      headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    if (
      (error instanceof Error && error.name === 'AbortError') ||
      (error instanceof DOMException && error.name === 'AbortError')
    ) {
      throw new OpenRouterVideoAdapterError('timeout');
    }
    throw new OpenRouterVideoAdapterError('provider_unavailable');
  }
  if (response.status < 200 || response.status >= 300)
    throw new OpenRouterVideoAdapterError(mapStatusError(response.status).code);
  if (!requireJson || response.status === 204) return undefined;
  return safeJson(response);
};

/** OpenRouter async video-generation adapter. Credentials remain in the resolved provider object only. */
export const createOpenRouterVideoAdapter = (deps: OpenRouterVideoAdapterDeps = {}): GenerationProviderAdapter => {
  const fetcher = deps.fetch ?? defaultFetch;
  const validationTimeoutMs = deps.validationTimeoutMs ?? VALIDATION_TIMEOUT_MS;
  const videosUrl = (provider: Pick<IProvider, 'base_url'>, id?: string): string => {
    const baseUrl = normalizedBaseUrl(provider.base_url);
    if (!baseUrl) throw new OpenRouterVideoAdapterError('unsupported');
    if (id !== undefined && !isValidProviderJobId(id)) {
      throw new OpenRouterVideoAdapterError('invalid_response');
    }
    return `${baseUrl}/videos${id ? `/${encodeURIComponent(id)}` : ''}`;
  };

  return {
    id: 'openrouter-video-v1',

    async validateConnection(
      input: StudioConnectionCandidate,
      provider: IProvider,
      signal: AbortSignal
    ): Promise<StudioConnectionValidation> {
      if (!provider.api_key.trim()) return { ok: false, error: { code: 'auth' } };
      const spec = getOpenRouterVideoModelSpec(input.model);
      if (!isSupportedOpenRouterVideoProvider(provider, input.model) || !spec) {
        return { ok: false, error: { code: 'unsupported' } };
      }
      try {
        await runWithProviderDeadline(signal, validationTimeoutMs, (deadlineSignal) =>
          requestJson(
            fetcher,
            `${normalizedBaseUrl(provider.base_url)}/videos/models`,
            { ...provider, use_model: input.model },
            { method: 'GET', signal: deadlineSignal }
          )
        );
        return {
          ok: true,
          capabilities: {
            mediaKinds: ['video'],
            audioModes: spec.supportsAudio ? ['audio'] : ['none'],
            aspectRatios: [...spec.ratios],
            resolutions: [...spec.resolutions],
            minDurationSeconds: spec.minDuration,
            maxDurationSeconds: spec.maxDuration,
            supportsFirstFrame: OPENROUTER_MANAGED_FIRST_FRAME_SUPPORTED,
            cancellationPolicy: 'none',
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code:
              error instanceof ProviderDeadlineError
                ? 'timeout'
                : error instanceof OpenRouterVideoAdapterError
                  ? error.code
                  : 'unknown',
          },
        };
      }
    },

    validateRequest(request: StudioGenerationRequest, provider: TProviderWithModel): StudioRouteValidation {
      return requestValidation(request, provider);
    },

    async submit(
      request: ResolvedStudioGenerationRequest,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderSubmitResult> {
      const validation = requestValidation(request, provider);
      if (!validation.ok) throw new OpenRouterVideoAdapterError('unsupported');
      const spec = getOpenRouterVideoModelSpec(provider.use_model);
      if (!spec) throw new OpenRouterVideoAdapterError('unsupported');
      const payload: Record<string, unknown> = {
        model: provider.use_model,
        prompt: request.prompt,
        duration: request.durationSeconds,
        aspect_ratio: request.aspectRatio,
        resolution: request.resolution,
      };
      if (spec.supportsAudio) payload.generate_audio = true;
      const body = await requestJson(fetcher, videosUrl(provider), provider, {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      });
      const status = jobStatus(body);
      const outputs = outputUrls(body);
      if (status === 'completed' || status === 'succeeded' || status === 'success') {
        if (!outputs) throw new OpenRouterVideoAdapterError('no_output');
        return { kind: 'complete', outputs };
      }
      if (status === 'failed') throw new OpenRouterVideoAdapterError('unknown');
      const id = jobId(body);
      if (!id) throw new OpenRouterVideoAdapterError('invalid_response');
      return { kind: 'remote', providerJobId: id };
    },

    async poll(providerJobId: string, provider: TProviderWithModel, signal: AbortSignal): Promise<ProviderJobSnapshot> {
      const body = await requestJson(fetcher, videosUrl(provider, providerJobId), provider, {
        method: 'GET',
        signal,
      });
      switch (jobStatus(body)) {
        case 'pending':
        case 'queued':
          return { status: 'queued' };
        case 'processing':
        case 'running':
        case 'in_progress':
          return { status: 'running' };
        case 'completed':
        case 'succeeded':
        case 'success': {
          const outputs = outputUrls(body);
          return outputs ? { status: 'succeeded', outputs } : { status: 'failed', error: { code: 'no_output' } };
        }
        case 'cancelled':
        case 'canceled':
          return { status: 'cancelled', error: { code: 'unknown' } };
        case 'failed':
          return { status: 'failed', error: { code: 'unknown' } };
        default:
          throw new OpenRouterVideoAdapterError('invalid_response');
      }
    },
  };
};
