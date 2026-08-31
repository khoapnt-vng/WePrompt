/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Readable } from 'node:stream';
import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import type {
  NormalizedStudioGenerationParameters,
  StudioAspectRatio,
  StudioMediaKind,
  StudioProviderAdapterId,
  StudioResolution,
  StudioRouteConstraints,
  StudioRouteIssue,
  StudioRouteValidation,
} from '@/common/types/project/creativeStudioTypes';

export { isValidProviderJobId } from '@/common/types/project/creativeStudioTypes';

/** Main-process-only reference material resolved by the managed Studio media store. */
export type ResolvedProviderInput = {
  assetId: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  openStream: () => Promise<Readable>;
  asDataUrl: (maxBytes: number) => Promise<string>;
};

export type StudioGenerationRequest = {
  prompt: string;
  mediaKind: StudioMediaKind;
  aspectRatio: StudioAspectRatio;
  resolution: StudioResolution;
  durationSeconds: number;
  idempotencyKey: string;
};

export type ResolvedStudioGenerationRequest = StudioGenerationRequest & {
  /** Main-owned, durable route authority re-proved before a paid submission. */
  routeConstraints?: Readonly<StudioRouteConstraints>;
  firstFrame?: ResolvedProviderInput;
  conditioningImages?: readonly ResolvedProviderInput[];
  conditioningImageLimit?: number;
};

/** Runtime shape guard: conditioning fields are reserved for image jobs, even if explicitly undefined. */
export const hasImageConditioningFields = (request: ResolvedStudioGenerationRequest): boolean =>
  'conditioningImages' in request || 'conditioningImageLimit' in request;

export type { NormalizedStudioGenerationParameters, StudioRouteIssue, StudioRouteValidation };

export type SanitizedProviderErrorCode =
  | 'auth'
  /** A spend limit the user can act on — a balance or a per-key cap, not a broken request. */
  | 'quota'
  /** The provider rejected the request definitively. Never an outcome we could not determine. */
  | 'invalid_request'
  /** The provider's bounded safety classifier rejected the supplied media. */
  | 'content_rejected'
  | 'rate_limited'
  | 'provider_unavailable'
  | 'timeout'
  | 'invalid_response'
  | 'no_output'
  | 'unsupported'
  | 'unknown';

/** Stable and deliberately body-free provider failure information. */
export type SanitizedProviderError = { code: SanitizedProviderErrorCode };

/** Process-only output. It is persisted by the future job manager before any renderer exposure. */
export type ProviderOutput = {
  mediaKind: StudioMediaKind;
  /** Distinguishes a generated video's optional last-frame poster from primary output. */
  role: 'primary' | 'poster';
  source: { kind: 'url'; url: string } | { kind: 'file'; path: string };
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'video/mp4' | 'video/webm';
  byteSize?: number;
  width?: number;
  height?: number;
  durationSeconds?: number;
};

export type ProviderSubmitResult =
  | { kind: 'complete'; outputs: ProviderOutput[] }
  | { kind: 'remote'; providerJobId: string };

export type ProviderJobSnapshot =
  | { status: 'queued' | 'running'; progress?: number }
  | { status: 'succeeded'; outputs: ProviderOutput[] }
  | { status: 'failed' | 'cancelled' | 'expired'; error: SanitizedProviderError };

export type ProviderCancelResult = { kind: 'cancelled' } | { kind: 'refused'; error: { code: 'cancellation_refused' } };

export type StudioConnectionCandidate = { model: string; capabilities?: Record<string, unknown> };

export type StudioConnectionValidation =
  | { ok: true; capabilities?: Record<string, unknown> }
  | { ok: false; error: SanitizedProviderError };

export type GenerationProviderAdapter = {
  id: StudioProviderAdapterId;
  validateConnection(
    input: StudioConnectionCandidate,
    provider: IProvider,
    signal: AbortSignal
  ): Promise<StudioConnectionValidation>;
  validateRequest(request: ResolvedStudioGenerationRequest, provider: TProviderWithModel): StudioRouteValidation;
  submit(
    request: ResolvedStudioGenerationRequest,
    provider: TProviderWithModel,
    signal: AbortSignal
  ): Promise<ProviderSubmitResult>;
  poll?(providerJobId: string, provider: TProviderWithModel, signal: AbortSignal): Promise<ProviderJobSnapshot>;
  cancel?(providerJobId: string, provider: TProviderWithModel, signal: AbortSignal): Promise<ProviderCancelResult>;
};

export type ProviderHttpResponse = { status: number; json: () => Promise<unknown> };

export type ProviderFetch = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string;
    signal: AbortSignal;
    redirect?: RequestRedirect;
  }
) => Promise<ProviderHttpResponse>;

export class ProviderDeadlineError extends Error {
  constructor() {
    super('timeout');
    this.name = 'ProviderDeadlineError';
  }
}

/** Enforces a finite connection-validation deadline even for an injected transport that ignores AbortSignal. */
export const runWithProviderDeadline = async <T>(
  parentSignal: AbortSignal,
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>
): Promise<T> => {
  const controller = new AbortController();
  let rejectDeadline: ((error: ProviderDeadlineError) => void) | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    rejectDeadline = reject;
  });
  void deadline.catch((): undefined => undefined);
  const abort = (): void => {
    controller.abort();
    rejectDeadline?.(new ProviderDeadlineError());
  };
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) abort();
  const timer = setTimeout(abort, timeoutMs);
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    parentSignal.removeEventListener('abort', abort);
  }
};
