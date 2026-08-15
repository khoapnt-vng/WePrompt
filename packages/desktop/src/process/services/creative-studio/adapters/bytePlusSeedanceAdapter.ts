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
  StudioGenerationRequest,
  StudioRouteIssue,
  StudioRouteValidation,
} from './types';
import { isValidProviderJobId, ProviderDeadlineError, runWithProviderDeadline } from './types';

export const BYTEPLUS_SEEDANCE_BASE_URL = 'https://ark.ap-southeast.bytepluses.com/api/v3';
const VALIDATION_TIMEOUT_MS = 10_000;

export type SeedanceModelSpec = {
  minDuration: number;
  maxDuration: number;
  resolutions: readonly ('720p' | '1080p')[];
  ratios: readonly ('16:9' | '9:16' | '1:1' | '4:3' | '3:4')[];
  supportsGenerateAudioFlag: boolean;
};

export const BYTEPLUS_SEEDANCE_MODELS: Readonly<Record<string, SeedanceModelSpec>> = Object.freeze({
  'seedance-1-0-pro-250528': {
    minDuration: 2,
    maxDuration: 12,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsGenerateAudioFlag: false,
  },
  'seedance-1-5-pro-251215': {
    minDuration: 4,
    maxDuration: 12,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsGenerateAudioFlag: true,
  },
  'dreamina-seedance-2-0-260128': {
    minDuration: 4,
    maxDuration: 15,
    resolutions: ['720p', '1080p'],
    ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    supportsGenerateAudioFlag: true,
  },
});

export class BytePlusSeedanceAdapterError extends Error {
  readonly code: SanitizedProviderError['code'];

  constructor(code: SanitizedProviderError['code']) {
    super(code);
    this.name = 'BytePlusSeedanceAdapterError';
    this.code = code;
  }
}

export type BytePlusSeedanceAdapterDeps = { fetch?: ProviderFetch; validationTimeoutMs?: number };

const normalizedBaseUrl = (value: string): string | null => {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'ark.ap-southeast.bytepluses.com' ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api/v3'
    )
      return null;
    return BYTEPLUS_SEEDANCE_BASE_URL;
  } catch {
    return null;
  }
};

export const isSupportedBytePlusSeedanceProvider = (provider: Pick<IProvider, 'base_url'>, model?: string): boolean =>
  normalizedBaseUrl(provider.base_url) === BYTEPLUS_SEEDANCE_BASE_URL &&
  (model === undefined || BYTEPLUS_SEEDANCE_MODELS[model] !== undefined);

export const getBytePlusSeedanceModelSpec = (model: string): SeedanceModelSpec | null =>
  BYTEPLUS_SEEDANCE_MODELS[model] ?? null;

const requestValidation = (request: StudioGenerationRequest, provider: TProviderWithModel): StudioRouteValidation => {
  const spec = getBytePlusSeedanceModelSpec(provider.use_model);
  if (
    request.mediaKind !== 'video' ||
    !isSupportedBytePlusSeedanceProvider(provider, provider.use_model) ||
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
  if (status === 401) return { code: 'auth' };
  if (status === 429) return { code: 'rate_limited' };
  if (status >= 500) return { code: 'provider_unavailable' };
  return { code: 'unknown' };
};

const safeJson = async (response: ProviderHttpResponse): Promise<unknown> => {
  try {
    return await response.json();
  } catch {
    throw new BytePlusSeedanceAdapterError('invalid_response');
  }
};

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const taskRecord = (value: unknown): Record<string, unknown> | null => {
  const root = record(value);
  const nested = root && record(root.data);
  return nested ?? root;
};

const taskId = (value: unknown): string | null => {
  const task = taskRecord(value);
  const id = task?.id ?? task?.task_id;
  return typeof id === 'string' && isValidProviderJobId(id) ? id : null;
};

const taskStatus = (value: unknown): string | null => {
  const task = taskRecord(value);
  const status = task?.status;
  return typeof status === 'string' ? status.toLowerCase() : null;
};

const isBytePlusOutputUrl = (value: string): boolean => {
  if (value.length === 0 || value.length > 16 * 1024) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && url.hostname.length > 0;
  } catch {
    return false;
  }
};

const imageMimeTypeFromUrl = (value: string): 'image/jpeg' | 'image/png' | 'image/webp' | null => {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith('.png')) return 'image/png';
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  return null;
};

const outputUrls = (value: unknown): ProviderOutput[] | null => {
  const task = taskRecord(value);
  const content = task && record(task.content);
  if (typeof content?.video_url !== 'string' || !isBytePlusOutputUrl(content.video_url)) return null;
  const documented: ProviderOutput[] = [
    {
      mediaKind: 'video',
      role: 'primary',
      source: { kind: 'url', url: content.video_url },
      mimeType: 'video/mp4',
    },
  ];
  if (typeof content?.last_frame_url === 'string' && isBytePlusOutputUrl(content.last_frame_url)) {
    const mimeType = imageMimeTypeFromUrl(content.last_frame_url);
    if (mimeType) {
      documented.push({
        mediaKind: 'image',
        role: 'poster',
        source: { kind: 'url', url: content.last_frame_url },
        mimeType,
      });
    }
  }
  return documented;
};

const defaultFetch: ProviderFetch = async (url, init) => {
  const response = await fetch(url, init);
  return { status: response.status, json: async () => response.json() };
};

const requestTask = async (
  fetcher: ProviderFetch,
  url: string,
  provider: TProviderWithModel,
  init: Omit<Parameters<ProviderFetch>[1], 'headers'>,
  requireJson = true
): Promise<unknown> => {
  if (!isSupportedBytePlusSeedanceProvider(provider, provider.use_model) || !provider.api_key.trim()) {
    throw new BytePlusSeedanceAdapterError('unsupported');
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
      throw new BytePlusSeedanceAdapterError('timeout');
    }
    throw new BytePlusSeedanceAdapterError('provider_unavailable');
  }
  if (response.status < 200 || response.status >= 300)
    throw new BytePlusSeedanceAdapterError(mapStatusError(response.status).code);
  if (!requireJson || response.status === 204) return undefined;
  return safeJson(response);
};

/** ModelArk Seedance process adapter. Credentials remain in the resolved provider object only. */
export const createBytePlusSeedanceAdapter = (deps: BytePlusSeedanceAdapterDeps = {}): GenerationProviderAdapter => {
  const fetcher = deps.fetch ?? defaultFetch;
  const validationTimeoutMs = deps.validationTimeoutMs ?? VALIDATION_TIMEOUT_MS;
  const taskUrl = (provider: Pick<IProvider, 'base_url'>, id?: string): string => {
    const baseUrl = normalizedBaseUrl(provider.base_url);
    if (!baseUrl) throw new BytePlusSeedanceAdapterError('unsupported');
    if (id !== undefined && !isValidProviderJobId(id)) {
      throw new BytePlusSeedanceAdapterError('invalid_response');
    }
    return `${baseUrl}/contents/generations/tasks${id ? `/${encodeURIComponent(id)}` : ''}`;
  };

  return {
    id: 'byteplus-seedance-v1',

    async validateConnection(
      input: StudioConnectionCandidate,
      provider: IProvider,
      signal: AbortSignal
    ): Promise<StudioConnectionValidation> {
      if (!provider.api_key.trim()) return { ok: false, error: { code: 'auth' } };
      if (!isSupportedBytePlusSeedanceProvider(provider, input.model) || !getBytePlusSeedanceModelSpec(input.model))
        return { ok: false, error: { code: 'unsupported' } };
      try {
        await runWithProviderDeadline(signal, validationTimeoutMs, (deadlineSignal) =>
          requestTask(
            fetcher,
            taskUrl(provider),
            { ...provider, use_model: input.model },
            { method: 'GET', signal: deadlineSignal }
          )
        );
        const spec = getBytePlusSeedanceModelSpec(input.model)!;
        return {
          ok: true,
          capabilities: {
            mediaKinds: ['video'],
            audioModes: ['none'],
            aspectRatios: [...spec.ratios],
            resolutions: [...spec.resolutions],
            minDurationSeconds: spec.minDuration,
            maxDurationSeconds: spec.maxDuration,
            supportsFirstFrame: true,
            maxConditioningImages: 0,
            cancellationPolicy: 'queued_only',
          },
        };
      } catch (error) {
        return {
          ok: false,
          error: {
            code:
              error instanceof ProviderDeadlineError
                ? 'timeout'
                : error instanceof BytePlusSeedanceAdapterError
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
      if (!validation.ok) throw new BytePlusSeedanceAdapterError('unsupported');
      const spec = getBytePlusSeedanceModelSpec(provider.use_model);
      if (!spec) throw new BytePlusSeedanceAdapterError('unsupported');
      const content: Array<Record<string, unknown>> = [{ type: 'text', text: request.prompt }];
      if (request.firstFrame) {
        content.push({
          type: 'image_url',
          image_url: { url: await request.firstFrame.asDataUrl(30 * 1024 * 1024) },
          role: 'first_frame',
        });
      }
      const payload: Record<string, unknown> = {
        model: provider.use_model,
        content,
        ratio: request.aspectRatio,
        duration: request.durationSeconds,
        resolution: request.resolution,
        watermark: false,
        return_last_frame: true,
      };
      if (spec.supportsGenerateAudioFlag) payload.generate_audio = false;
      const body = await requestTask(fetcher, taskUrl(provider), provider, {
        method: 'POST',
        body: JSON.stringify(payload),
        signal,
      });
      const status = taskStatus(body);
      const outputs = outputUrls(body);
      if (status === 'succeeded' || status === 'success') {
        if (!outputs) throw new BytePlusSeedanceAdapterError('no_output');
        return { kind: 'complete', outputs };
      }
      if (status === 'failed' || status === 'cancelled' || status === 'canceled') {
        throw new BytePlusSeedanceAdapterError('unknown');
      }
      if (status === 'expired') throw new BytePlusSeedanceAdapterError('provider_unavailable');
      if (status === null && outputs) return { kind: 'complete', outputs };
      if (!status || !['queued', 'pending', 'running', 'processing'].includes(status)) {
        throw new BytePlusSeedanceAdapterError('invalid_response');
      }
      const id = taskId(body);
      if (!id) throw new BytePlusSeedanceAdapterError('invalid_response');
      return { kind: 'remote', providerJobId: id };
    },

    async poll(providerJobId: string, provider: TProviderWithModel, signal: AbortSignal): Promise<ProviderJobSnapshot> {
      const body = await requestTask(fetcher, taskUrl(provider, providerJobId), provider, { method: 'GET', signal });
      switch (taskStatus(body)) {
        case 'queued':
        case 'pending':
          return { status: 'queued' };
        case 'running':
        case 'processing':
          return { status: 'running' };
        case 'succeeded':
        case 'success': {
          const outputs = outputUrls(body);
          if (!outputs) return { status: 'failed', error: { code: 'no_output' } };
          return { status: 'succeeded', outputs };
        }
        case 'cancelled':
        case 'canceled':
          return { status: 'cancelled', error: { code: 'unknown' } };
        case 'expired':
          return { status: 'expired', error: { code: 'provider_unavailable' } };
        case 'failed':
          return { status: 'failed', error: { code: 'unknown' } };
        default:
          throw new BytePlusSeedanceAdapterError('invalid_response');
      }
    },

    async cancel(
      providerJobId: string,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderCancelResult> {
      const snapshot = await this.poll!(providerJobId, provider, signal);
      if (snapshot.status === 'cancelled') return { kind: 'cancelled' };
      if (snapshot.status !== 'queued') return { kind: 'refused', error: { code: 'cancellation_refused' } };
      await requestTask(fetcher, taskUrl(provider, providerJobId), provider, { method: 'DELETE', signal }, false);
      return { kind: 'cancelled' };
    },
  };
};
