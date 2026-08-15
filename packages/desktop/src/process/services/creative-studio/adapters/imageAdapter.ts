/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { promises as dns } from 'node:dns';
import path from 'node:path';
import {
  executeImageGeneration,
  type HostedImageDownloader,
  type ImageGenParams,
  type ImageGenResult,
} from '@/common/chat/imageGenCore';
import {
  getImageModelMaxConditioningImages,
  isImageGenSupported,
  isImagesApiModel,
} from '@/common/utils/imageModelAllowlist';
import {
  createNodeRemoteMediaRequest,
  downloadRemoteMedia,
  type RemoteMediaDownloadDeps,
} from '@process/services/remote-media/remoteMediaDownloader';
import type {
  GenerationProviderAdapter,
  ProviderSubmitResult,
  ResolvedProviderInput,
  ResolvedStudioGenerationRequest,
  StudioConnectionCandidate,
  StudioConnectionValidation,
  StudioGenerationRequest,
  StudioRouteValidation,
} from './types';

export class ImageGenerationAdapterError extends Error {
  readonly code: 'no_output' | 'unsupported' | 'unknown';

  constructor(code: ImageGenerationAdapterError['code']) {
    super(code);
    this.name = 'ImageGenerationAdapterError';
    this.code = code;
  }
}

export type ImageGenerationAdapterDeps = {
  executeImageGeneration?: (
    params: ImageGenParams,
    provider: TProviderWithModel,
    workspaceDir: string,
    proxy?: string,
    signal?: AbortSignal,
    deps?: { hostedImageDownloader?: HostedImageDownloader }
  ) => Promise<ImageGenResult>;
  workspaceDir: string;
  hostedImageDownloader?: HostedImageDownloader;
  getMaxConditioningImages?: typeof getImageModelMaxConditioningImages;
  proxy?: string;
};

const MAX_CONDITIONING_IMAGES = 6;
const CONDITIONING_IMAGE_BUDGET_BYTES = 30 * 1024 * 1024;

type ImageConditioningValidation =
  | { ok: true; conditioningImages: readonly ResolvedProviderInput[] | undefined }
  | { ok: false };
type ResolvedImageRequestValidation = {
  routeValidation: StudioRouteValidation;
  conditioningValidation: ImageConditioningValidation | null;
};

/** Cheap, main-only safety validation shared with the trusted packaged-refused fake image adapter. */
export const validateImageConditioningRequest = (
  request: ResolvedStudioGenerationRequest,
  currentSafetyLimit: number,
  imagesApiRoute: boolean
): ImageConditioningValidation => {
  const hasConditioningImages = request.conditioningImages !== undefined;
  const hasConditioningImageLimit = request.conditioningImageLimit !== undefined;
  if (request.firstFrame !== undefined || hasConditioningImages !== hasConditioningImageLimit) return { ok: false };
  if (!hasConditioningImages) return { ok: true, conditioningImages: undefined };
  if (imagesApiRoute || !Array.isArray(request.conditioningImages)) return { ok: false };

  const frozenLimit = request.conditioningImageLimit;
  if (
    !Number.isSafeInteger(frozenLimit) ||
    frozenLimit! < 0 ||
    frozenLimit! > MAX_CONDITIONING_IMAGES ||
    !Number.isSafeInteger(currentSafetyLimit) ||
    currentSafetyLimit < 0 ||
    currentSafetyLimit > MAX_CONDITIONING_IMAGES ||
    frozenLimit! > currentSafetyLimit ||
    request.conditioningImages.length > MAX_CONDITIONING_IMAGES ||
    request.conditioningImages.length > frozenLimit!
  ) {
    return { ok: false };
  }

  let remainingBytes = CONDITIONING_IMAGE_BUDGET_BYTES;
  for (const input of request.conditioningImages) {
    if (
      typeof input !== 'object' ||
      input === null ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize <= 0 ||
      input.byteSize > remainingBytes
    ) {
      return { ok: false };
    }
    remainingBytes -= input.byteSize;
  }
  return { ok: true, conditioningImages: request.conditioningImages };
};

export type StudioHostedImageDownloaderDeps = Pick<RemoteMediaDownloadDeps, 'lookup' | 'request'>;

/** Production-safe hosted image path, with injectable DNS/transport seams for focused tests. */
export const createStudioHostedImageDownloader = (
  deps: Partial<StudioHostedImageDownloaderDeps> = {}
): HostedImageDownloader => {
  const lookup: RemoteMediaDownloadDeps['lookup'] =
    deps.lookup ??
    (async (hostname) => {
      const addresses = await dns.lookup(hostname, { all: true, verbatim: true });
      return addresses.flatMap((address) =>
        address.family === 4 || address.family === 6 ? [{ address: address.address, family: address.family }] : []
      );
    });
  const request = deps.request ?? createNodeRemoteMediaRequest(120_000);
  return async ({ url, maxBytes, signal, write }) => {
    await downloadRemoteMedia(url, { lookup, request, write, maxBytes, signal });
  };
};

const validRequest = (request: StudioGenerationRequest, provider: TProviderWithModel): StudioRouteValidation => {
  if (request.mediaKind !== 'image') return { ok: false, issues: [{ code: 'unsupported_media' }] };
  if (!provider.api_key.trim() || !isImageGenSupported(provider, provider.use_model)) {
    return { ok: false, issues: [{ code: 'provider_unavailable' }] };
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

const generatedImageMimeType = (imagePath: string): 'image/jpeg' | 'image/png' | 'image/webp' | null => {
  const extension = path.extname(imagePath).toLowerCase();
  if (extension === '.png') return 'image/png';
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
  if (extension === '.webp') return 'image/webp';
  return null;
};

/** Wraps the existing image engine without exposing its local output path outside the main process. */
export const createImageGenerationAdapter = (deps: ImageGenerationAdapterDeps): GenerationProviderAdapter => {
  const generate = deps.executeImageGeneration ?? executeImageGeneration;
  const hostedImageDownloader = deps.hostedImageDownloader ?? createStudioHostedImageDownloader();
  const getMaxConditioningImages = deps.getMaxConditioningImages ?? getImageModelMaxConditioningImages;
  const validateResolvedRequest = (
    request: ResolvedStudioGenerationRequest,
    provider: TProviderWithModel
  ): ResolvedImageRequestValidation => {
    const routeValidation = validRequest(request, provider);
    if (!routeValidation.ok) return { routeValidation, conditioningValidation: null };
    const conditioningValidation = validateImageConditioningRequest(
      request,
      getMaxConditioningImages(provider, provider.use_model),
      isImagesApiModel(provider.use_model)
    );
    return {
      routeValidation: conditioningValidation.ok
        ? routeValidation
        : { ok: false, issues: [{ code: 'provider_unavailable' }] },
      conditioningValidation,
    };
  };

  return {
    id: 'weprompt-image-v1',

    async validateConnection(
      input: StudioConnectionCandidate,
      provider: IProvider,
      _signal: AbortSignal
    ): Promise<StudioConnectionValidation> {
      if (!provider.api_key.trim()) return { ok: false, error: { code: 'auth' } };
      return isImageGenSupported(provider, input.model)
        ? {
            ok: true,
            capabilities: { maxConditioningImages: getImageModelMaxConditioningImages(provider, input.model) },
          }
        : { ok: false, error: { code: 'unsupported' } };
    },

    validateRequest: (request, provider) => validateResolvedRequest(request, provider).routeValidation,

    async submit(
      request: ResolvedStudioGenerationRequest,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderSubmitResult> {
      const { routeValidation, conditioningValidation } = validateResolvedRequest(request, provider);
      if (!routeValidation.ok || !conditioningValidation?.ok) throw new ImageGenerationAdapterError('unsupported');
      let imageUris: string[] | undefined;
      if (conditioningValidation.conditioningImages !== undefined) {
        imageUris = [];
        try {
          for (const input of conditioningValidation.conditioningImages) {
            imageUris.push(await input.asDataUrl(CONDITIONING_IMAGE_BUDGET_BYTES));
          }
        } catch {
          throw new ImageGenerationAdapterError('unsupported');
        }
      }
      const result = await generate(
        { prompt: request.prompt, image_uris: imageUris },
        provider,
        deps.workspaceDir,
        deps.proxy,
        signal,
        { hostedImageDownloader }
      );
      if (!result.success || !result.imagePath) {
        throw new ImageGenerationAdapterError(result.error === 'no_output' ? 'no_output' : 'unknown');
      }
      const mimeType = generatedImageMimeType(result.imagePath);
      if (!mimeType) throw new ImageGenerationAdapterError('no_output');
      return {
        kind: 'complete',
        outputs: [{ mediaKind: 'image', role: 'primary', source: { kind: 'file', path: result.imagePath }, mimeType }],
      };
    },
  };
};
