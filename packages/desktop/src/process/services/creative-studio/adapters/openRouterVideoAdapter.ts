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
  StudioRouteIssue,
  StudioRouteValidation,
} from './types';
import {
  hasImageConditioningFields,
  isValidProviderJobId,
  ProviderDeadlineError,
  runWithProviderDeadline,
} from './types';

export const OPENROUTER_VIDEO_BASE_URL = 'https://openrouter.ai/api/v1';
const OPENROUTER_HOST = 'openrouter.ai';
const VALIDATION_TIMEOUT_MS = 10_000;
const FIRST_FRAME_MAX_BYTES = 30 * 1024 * 1024;

export type OpenRouterVideoModelSpec = {
  minDuration: number;
  maxDuration: number;
  resolutions: readonly ('720p' | '1080p')[];
  ratios: readonly ('16:9' | '9:16' | '1:1' | '4:3' | '3:4')[];
  supportsAudio: boolean;
  /** Enabled only where a managed data-URL first frame has succeeded in a real Studio job. */
  supportsFirstFrame: boolean;
};

export const OPENROUTER_VIDEO_MODELS: Readonly<Record<string, OpenRouterVideoModelSpec>> = Object.freeze({
  'google/veo-3.1-lite': {
    minDuration: 4,
    maxDuration: 8,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16'],
    supportsAudio: true,
    supportsFirstFrame: false,
  },
  'google/veo-3.1-fast': {
    minDuration: 4,
    maxDuration: 8,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16'],
    supportsAudio: true,
    supportsFirstFrame: false,
  },
  'kwaivgi/kling-v3.0-std': {
    minDuration: 3,
    maxDuration: 15,
    resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsFirstFrame: false,
  },
  'kwaivgi/kling-v3.0-pro': {
    minDuration: 3,
    maxDuration: 15,
    resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1'],
    supportsAudio: true,
    supportsFirstFrame: false,
  },
  'bytedance/seedance-2.0': {
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsAudio: true,
    supportsFirstFrame: true,
  },
  'bytedance/seedance-2.0-fast': {
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsAudio: true,
    supportsFirstFrame: false,
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

export type OpenRouterHttpOperation = 'validate' | 'submit' | 'poll';

export type OpenRouterHttpErrorEvidence = {
  operation: OpenRouterHttpOperation;
  model: string;
  httpStatus: number;
  stableCode: SanitizedProviderError['code'];
  jsonReadable: boolean;
  errorCode: string | null;
  errorType: string | null;
  providerCode: string | null;
  messagePresent: boolean;
};

export type OpenRouterVideoAdapterDeps = {
  fetch?: ProviderFetch;
  validationTimeoutMs?: number;
  emitHttpErrorEvidence?: (evidence: OpenRouterHttpErrorEvidence) => void | PromiseLike<void>;
};

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

const requestValidation = (
  request: ResolvedStudioGenerationRequest,
  provider: TProviderWithModel
): StudioRouteValidation => {
  const spec = getOpenRouterVideoModelSpec(provider.use_model);
  if (
    request.mediaKind !== 'video' ||
    hasImageConditioningFields(request) ||
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
  if ('firstFrame' in request && request.firstFrame !== undefined && !spec.supportsFirstFrame) {
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

const SAFE_HTTP_ERROR_TAGS = new Set([
  'bad_request',
  'content_policy',
  'content_policy_violation',
  'image_download_failed',
  'image_too_large',
  'image_too_small',
  'invalid_image',
  'invalid_image_url',
  'invalid_request',
  'invalid_request_error',
  'moderation',
  'payload_too_large',
  'unprocessable_entity',
  'unsupported_image_format',
  'unsupported_value',
]);

const safeEvidenceTag = (value: unknown): string | null => {
  const normalized = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string') return null;
  if (/^[1-5][0-9]{2}$/.test(normalized)) return normalized;
  return SAFE_HTTP_ERROR_TAGS.has(normalized) ? normalized : null;
};

const httpErrorEvidence = async (
  response: ProviderHttpResponse,
  operation: OpenRouterHttpOperation,
  model: string,
  stableCode: SanitizedProviderError['code']
): Promise<OpenRouterHttpErrorEvidence> => {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return {
      operation,
      model,
      httpStatus: response.status,
      stableCode,
      jsonReadable: false,
      errorCode: null,
      errorType: null,
      providerCode: null,
      messagePresent: false,
    };
  }
  const error = record(record(body)?.error);
  const metadata = record(error?.metadata);
  return {
    operation,
    model,
    httpStatus: response.status,
    stableCode,
    jsonReadable: true,
    errorCode: safeEvidenceTag(error?.code),
    errorType: safeEvidenceTag(metadata?.error_type),
    providerCode: safeEvidenceTag(metadata?.provider_code),
    messagePresent: typeof error?.message === 'string' && error.message.length > 0,
  };
};

const defaultEmitHttpErrorEvidence = (evidence: OpenRouterHttpErrorEvidence): void => {
  console.warn('[CreativeStudio:OpenRouterVideo:http-error]', evidence);
};

const requestJson = async (
  fetcher: ProviderFetch,
  url: string,
  provider: TProviderWithModel,
  init: Omit<Parameters<ProviderFetch>[1], 'headers'>,
  operation: OpenRouterHttpOperation,
  emitHttpErrorEvidence: (evidence: OpenRouterHttpErrorEvidence) => void | PromiseLike<void>,
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
  if (response.status < 200 || response.status >= 300) {
    const stableCode = mapStatusError(response.status).code;
    // Provider-controlled error bodies are detached from failure handling so a stalled body or
    // diagnostic sink can never delay or change the already-known HTTP result.
    setTimeout(() => {
      void httpErrorEvidence(response, operation, provider.use_model, stableCode)
        .then(emitHttpErrorEvidence)
        .catch((): undefined => undefined);
    }, 0);
    throw new OpenRouterVideoAdapterError(stableCode);
  }
  if (!requireJson || response.status === 204) return undefined;
  return safeJson(response);
};

/** OpenRouter async video-generation adapter. Credentials remain in the resolved provider object only. */
export const createOpenRouterVideoAdapter = (deps: OpenRouterVideoAdapterDeps = {}): GenerationProviderAdapter => {
  const fetcher = deps.fetch ?? defaultFetch;
  const validationTimeoutMs = deps.validationTimeoutMs ?? VALIDATION_TIMEOUT_MS;
  const emitHttpErrorEvidence = deps.emitHttpErrorEvidence ?? defaultEmitHttpErrorEvidence;
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
            { method: 'GET', signal: deadlineSignal },
            'validate',
            emitHttpErrorEvidence
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
            supportsFirstFrame: spec.supportsFirstFrame,
            maxConditioningImages: 0,
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

    validateRequest(request: ResolvedStudioGenerationRequest, provider: TProviderWithModel): StudioRouteValidation {
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
      if (request.firstFrame && spec.supportsFirstFrame) {
        payload.frame_images = [
          {
            type: 'image_url',
            image_url: { url: await request.firstFrame.asDataUrl(FIRST_FRAME_MAX_BYTES) },
            frame_type: 'first_frame',
          },
        ];
      }
      const body = await requestJson(
        fetcher,
        videosUrl(provider),
        provider,
        {
          method: 'POST',
          body: JSON.stringify(payload),
          signal,
        },
        'submit',
        emitHttpErrorEvidence
      );
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
      const body = await requestJson(
        fetcher,
        videosUrl(provider, providerJobId),
        provider,
        {
          method: 'GET',
          signal,
        },
        'poll',
        emitHttpErrorEvidence
      );
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
