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
const CATALOG_TIMEOUT_MS = 10_000;
const FIRST_FRAME_MAX_BYTES = 30 * 1024 * 1024;
const MAX_CATALOG_MODELS = 256;
const MAX_CATALOG_VALUES = 128;
const STUDIO_MIN_DURATION_SECONDS = 4;
const STUDIO_MAX_DURATION_SECONDS = 15;
const STUDIO_RESOLUTIONS = ['720p', '1080p'] as const;
const STUDIO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
const MANAGED_FIRST_FRAME_MODELS = new Set(['bytedance/seedance-2.0']);

export type OpenRouterVideoModelSpec = {
  durations: readonly number[];
  minDuration: number;
  maxDuration: number;
  resolutions: readonly ('720p' | '1080p')[];
  ratios: readonly ('16:9' | '9:16' | '1:1' | '4:3' | '3:4')[];
  supportsAudio: boolean;
  /** Enabled only where a managed data-URL first frame has succeeded in a real Studio job. */
  supportsFirstFrame: boolean;
};

export type OpenRouterVideoCatalog = {
  refresh(provider: Pick<IProvider, 'api_key' | 'base_url'>, signal: AbortSignal): Promise<readonly string[]>;
  listModels(): readonly string[];
  getModelSpec(model: string): OpenRouterVideoModelSpec | null;
};

export type OpenRouterVideoCatalogDeps = {
  fetch?: ProviderFetch;
  timeoutMs?: number;
};

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
  /** e.g. `openrouter_credits` on a 402 — the one identifier that says which spend gate fired. */
  limitSource: string | null;
  /**
   * The upstream provider's own code, which OpenRouter nests as JSON *inside* `error.message`
   * rather than in `metadata`. Without lifting it, a rejection like
   * `InputImageSensitiveContentDetected.PrivacyInformation` arrives as two nulls and a flag.
   */
  upstreamCode: string | null;
  messagePresent: boolean;
};

export type OpenRouterVideoAdapterDeps = {
  fetch?: ProviderFetch;
  catalog?: OpenRouterVideoCatalog;
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

export const isSupportedOpenRouterVideoProvider = (provider: Pick<IProvider, 'base_url'>): boolean =>
  normalizedBaseUrl(provider.base_url) === OPENROUTER_VIDEO_BASE_URL;

const isCanonicalRouteAuthority = (spec: OpenRouterVideoModelSpec): boolean =>
  spec.durations.length > 0 &&
  spec.durations.every(
    (duration, index) =>
      Number.isInteger(duration) &&
      duration >= STUDIO_MIN_DURATION_SECONDS &&
      duration <= STUDIO_MAX_DURATION_SECONDS &&
      (index === 0 || spec.durations[index - 1]! < duration)
  ) &&
  spec.minDuration === spec.durations[0] &&
  spec.maxDuration === spec.durations.at(-1) &&
  spec.resolutions.length > 0 &&
  new Set(spec.resolutions).size === spec.resolutions.length &&
  spec.resolutions.every((resolution) => STUDIO_RESOLUTIONS.includes(resolution)) &&
  spec.ratios.length > 0 &&
  new Set(spec.ratios).size === spec.ratios.length &&
  spec.ratios.every((ratio) => STUDIO_RATIOS.includes(ratio));

const requestAuthority = (request: ResolvedStudioGenerationRequest, model: string): OpenRouterVideoModelSpec | null => {
  const constraints = request.routeConstraints;
  const durations = constraints?.supportedDurationSeconds;
  if (constraints === undefined || !Array.isArray(durations) || constraints.maxConditioningImages !== 0) {
    return null;
  }
  const spec: OpenRouterVideoModelSpec = {
    durations,
    minDuration: constraints.minDurationSeconds,
    maxDuration: constraints.maxDurationSeconds,
    resolutions: constraints.resolutions,
    ratios: constraints.aspectRatios,
    supportsAudio: !constraints.silentOutput,
    supportsFirstFrame: constraints.supportsFirstFrame && MANAGED_FIRST_FRAME_MODELS.has(model),
  };
  return isCanonicalRouteAuthority(spec) ? spec : null;
};

const authorityFitsCurrentCatalog = (
  request: ResolvedStudioGenerationRequest,
  authority: OpenRouterVideoModelSpec,
  current: OpenRouterVideoModelSpec
): boolean =>
  authority.durations.every((duration) => current.durations.includes(duration)) &&
  authority.resolutions.every((resolution) => current.resolutions.includes(resolution)) &&
  authority.ratios.every((ratio) => current.ratios.includes(ratio)) &&
  (!request.routeConstraints?.supportsFirstFrame || current.supportsFirstFrame) &&
  (!authority.supportsAudio || current.supportsAudio);

const requestValidation = (
  request: ResolvedStudioGenerationRequest,
  provider: TProviderWithModel,
  catalog: OpenRouterVideoCatalog
): StudioRouteValidation => {
  const spec = requestAuthority(request, provider.use_model);
  const current = catalog.getModelSpec(provider.use_model);
  if (
    request.mediaKind !== 'video' ||
    hasImageConditioningFields(request) ||
    !isSupportedOpenRouterVideoProvider(provider) ||
    !spec ||
    current === null ||
    !authorityFitsCurrentCatalog(request, spec, current) ||
    !provider.api_key.trim()
  ) {
    return { ok: false, issues: [{ code: 'provider_unavailable' }] };
  }
  const issues: StudioRouteIssue[] = [];
  if (!Number.isInteger(request.durationSeconds) || !spec.durations.includes(request.durationSeconds)) {
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

/**
 * A 4xx is the provider stating that it rejected the request, so it must not read as an outcome we
 * could not determine. `unknown` becomes `submission_unknown` downstream, which parks the job in
 * needs_attention behind a duplicate-charge acknowledgement — a warning about paying twice for work
 * that provably never started.
 *
 * 402 earns its own code because it is the one the user can act on. Measured 2026-08-23: four video
 * submissions failed in a row and were reported as ambiguous; replaying the same submission returned
 * a plain 402 "Insufficient credits" that the redacted bodies had given no way to see.
 */
const mapStatusError = (status: number): SanitizedProviderError => {
  if (status === 401 || status === 403) return { code: 'auth' };
  if (status === 402) return { code: 'quota' };
  if (status === 429) return { code: 'rate_limited' };
  if (status >= 500) return { code: 'provider_unavailable' };
  if (status >= 400) return { code: 'invalid_request' };
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

const isSafeCatalogText = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 256 &&
  value === value.trim() &&
  !Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0)!;
    return (
      codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff)
    );
  });

const catalogArray = <T>(value: unknown, validate: (candidate: unknown) => candidate is T): readonly T[] | null => {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > MAX_CATALOG_VALUES) {
    throw new OpenRouterVideoAdapterError('invalid_response');
  }
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index) || !validate(value[index])) {
      throw new OpenRouterVideoAdapterError('invalid_response');
    }
  }
  return value;
};

const parseOpenRouterVideoCatalog = (value: unknown): Map<string, OpenRouterVideoModelSpec> => {
  const data = record(value)?.data;
  if (!Array.isArray(data) || data.length === 0 || data.length > MAX_CATALOG_MODELS) {
    throw new OpenRouterVideoAdapterError('invalid_response');
  }
  const parsed = new Map<string, OpenRouterVideoModelSpec>();
  const seen = new Set<string>();
  for (let index = 0; index < data.length; index += 1) {
    if (!Object.hasOwn(data, index)) throw new OpenRouterVideoAdapterError('invalid_response');
    const candidate = record(data[index]);
    const id = candidate?.id;
    if (candidate === null || typeof id !== 'string' || !isSafeCatalogText(id) || seen.has(id)) {
      throw new OpenRouterVideoAdapterError('invalid_response');
    }
    seen.add(id);
    const providerResolutions = catalogArray(
      candidate.supported_resolutions,
      (item): item is string => typeof item === 'string' && isSafeCatalogText(item)
    );
    const providerRatios = catalogArray(
      candidate.supported_aspect_ratios,
      (item): item is string => typeof item === 'string' && isSafeCatalogText(item)
    );
    const providerDurations = catalogArray(
      candidate.supported_durations,
      (item): item is number => Number.isInteger(item) && (item as number) >= 1 && (item as number) <= 3_600
    );
    const providerFrames = catalogArray(
      candidate.supported_frame_images,
      (item): item is string => typeof item === 'string' && isSafeCatalogText(item)
    );
    if (candidate.generate_audio !== null && typeof candidate.generate_audio !== 'boolean') {
      throw new OpenRouterVideoAdapterError('invalid_response');
    }
    if (providerResolutions === null || providerRatios === null || providerDurations === null) continue;
    const resolutions = STUDIO_RESOLUTIONS.filter((resolution) => providerResolutions.includes(resolution));
    const ratios = STUDIO_RATIOS.filter((ratio) => providerRatios.includes(ratio));
    const durations = [...new Set(providerDurations)]
      .filter((duration) => duration >= STUDIO_MIN_DURATION_SECONDS && duration <= STUDIO_MAX_DURATION_SECONDS)
      .toSorted((left, right) => left - right);
    if (resolutions.length === 0 || ratios.length === 0 || durations.length === 0) continue;
    const spec: OpenRouterVideoModelSpec = Object.freeze({
      durations: Object.freeze(durations),
      minDuration: durations[0]!,
      maxDuration: durations.at(-1)!,
      resolutions: Object.freeze(resolutions),
      ratios: Object.freeze(ratios),
      supportsAudio: candidate.generate_audio === true,
      supportsFirstFrame: providerFrames?.includes('first_frame') === true && MANAGED_FIRST_FRAME_MODELS.has(id),
    });
    parsed.set(id, spec);
  }
  if (parsed.size === 0) throw new OpenRouterVideoAdapterError('invalid_response');
  return new Map([...parsed].toSorted(([left], [right]) => left.localeCompare(right)));
};

export const createOpenRouterVideoCatalog = (deps: OpenRouterVideoCatalogDeps = {}): OpenRouterVideoCatalog => {
  const fetcher = deps.fetch ?? defaultFetch;
  const timeoutMs = deps.timeoutMs ?? CATALOG_TIMEOUT_MS;
  let models = new Map<string, OpenRouterVideoModelSpec>();
  let refreshGeneration = 0;
  const refresh = async (
    provider: Pick<IProvider, 'api_key' | 'base_url'>,
    signal: AbortSignal
  ): Promise<readonly string[]> => {
    const generation = ++refreshGeneration;
    // A refresh is an authority transition. Invalidate synchronously so no paid request can
    // use a prior broad snapshot while a newer shrink/removal proof is still in flight.
    models = new Map();
    try {
      const baseUrl = normalizedBaseUrl(provider.base_url);
      if (baseUrl === null) throw new OpenRouterVideoAdapterError('unsupported');
      if (!provider.api_key.trim()) throw new OpenRouterVideoAdapterError('auth');
      const body = await runWithProviderDeadline(signal, timeoutMs, async (deadlineSignal) => {
        let response: ProviderHttpResponse;
        try {
          response = await fetcher(`${baseUrl}/videos/models`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${provider.api_key}`, 'Content-Type': 'application/json' },
            signal: deadlineSignal,
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
          throw new OpenRouterVideoAdapterError(mapStatusError(response.status).code);
        }
        return safeJson(response);
      });
      const refreshed = parseOpenRouterVideoCatalog(body);
      if (generation === refreshGeneration) models = refreshed;
      return Object.freeze([...models.keys()]);
    } catch (error) {
      if (generation === refreshGeneration) models = new Map();
      throw error;
    }
  };
  return {
    refresh,
    listModels: () => Object.freeze([...models.keys()]),
    getModelSpec: (model) => models.get(model) ?? null,
  };
};

const defaultOpenRouterVideoCatalog = createOpenRouterVideoCatalog();

export const getDefaultOpenRouterVideoCatalog = (): OpenRouterVideoCatalog => defaultOpenRouterVideoCatalog;

export const getOpenRouterVideoModelSpec = (model: string): OpenRouterVideoModelSpec | null =>
  defaultOpenRouterVideoCatalog.getModelSpec(model);

/**
 * Provider error tags are enum-like identifiers, and identifier shape is what makes them safe to
 * log: no spaces, no punctuation, no scheme, so a prompt, a URL, an API key or a base64 payload
 * cannot pass through. A fixed allowlist was stricter than that and cost more than it protected —
 * a real 400 arrived on 2026-08-23 carrying tags nobody had enumerated, and both were discarded,
 * leaving a blocked run with no stated reason.
 *
 * `error.message` remains fully redacted and must stay that way. It is free text, and the provider
 * demonstrably echoes the prompt and request material into it; no length cap makes that safe.
 */
const IDENTIFIER_TAG = /^[A-Za-z][A-Za-z0-9_.]{0,79}$/;

/**
 * OpenRouter forwards some upstream rejections by stringifying the origin provider's whole error
 * object into `message`, leaving `metadata` empty. Only that object's `code` is lifted, and only
 * when it passes the same identifier gate — the prose beside it names the request and can name the
 * prompt, so it stays where it is.
 */
const nestedUpstreamCode = (message: unknown): string | null => {
  if (typeof message !== 'string') return null;
  const start = message.indexOf('{');
  if (start < 0) return null;
  try {
    const parsed: unknown = JSON.parse(message.slice(start));
    return safeEvidenceTag(record(record(parsed)?.error)?.code);
  } catch {
    return null;
  }
};

const safeEvidenceTag = (value: unknown): string | null => {
  const normalized = typeof value === 'number' && Number.isInteger(value) ? String(value) : value;
  if (typeof normalized !== 'string') return null;
  if (/^[1-5][0-9]{2}$/.test(normalized)) return normalized;
  return IDENTIFIER_TAG.test(normalized) ? normalized : null;
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
      limitSource: null,
      upstreamCode: null,
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
    limitSource: safeEvidenceTag(metadata?.limit_source),
    upstreamCode: nestedUpstreamCode(error?.message),
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
  if (!isSupportedOpenRouterVideoProvider(provider) || !provider.api_key.trim()) {
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
  const catalog =
    deps.catalog ??
    (deps.fetch === undefined
      ? defaultOpenRouterVideoCatalog
      : createOpenRouterVideoCatalog({ fetch: deps.fetch, timeoutMs: deps.validationTimeoutMs }));
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
      if (!isSupportedOpenRouterVideoProvider(provider)) return { ok: false, error: { code: 'unsupported' } };
      try {
        await runWithProviderDeadline(signal, validationTimeoutMs, async (deadlineSignal) => {
          await requestJson(
            fetcher,
            `${normalizedBaseUrl(provider.base_url)}/key`,
            { ...provider, use_model: input.model },
            { method: 'GET', signal: deadlineSignal },
            'validate',
            emitHttpErrorEvidence,
            false
          );
          await catalog.refresh(provider, deadlineSignal);
        });
        const spec = catalog.getModelSpec(input.model);
        if (spec === null) return { ok: false, error: { code: 'unsupported' } };
        return {
          ok: true,
          capabilities: {
            mediaKinds: ['video'],
            audioModes: spec.supportsAudio ? ['audio'] : ['none'],
            aspectRatios: [...spec.ratios],
            resolutions: [...spec.resolutions],
            minDurationSeconds: spec.minDuration,
            maxDurationSeconds: spec.maxDuration,
            supportedDurationSeconds: [...spec.durations],
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
      return requestValidation(request, provider, catalog);
    },

    async submit(
      request: ResolvedStudioGenerationRequest,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderSubmitResult> {
      const validation = requestValidation(request, provider, catalog);
      if (!validation.ok) throw new OpenRouterVideoAdapterError('unsupported');
      const spec = requestAuthority(request, provider.use_model);
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
      // Materializing managed media can yield. Re-prove the live catalog immediately before
      // invoking the paid endpoint so a concurrent catalog shrink cannot cross the spend gate.
      if (!requestValidation(request, provider, catalog).ok) {
        throw new OpenRouterVideoAdapterError('unsupported');
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
