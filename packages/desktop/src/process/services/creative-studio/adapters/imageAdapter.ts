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
  proxy?: string;
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

    validateRequest: validRequest,

    async submit(
      request: ResolvedStudioGenerationRequest,
      provider: TProviderWithModel,
      signal: AbortSignal
    ): Promise<ProviderSubmitResult> {
      const validation = validRequest(request, provider);
      if (!validation.ok) throw new ImageGenerationAdapterError('unsupported');
      if (request.firstFrame && isImagesApiModel(provider.use_model)) {
        throw new ImageGenerationAdapterError('unsupported');
      }
      const imageUris = request.firstFrame ? [await request.firstFrame.asDataUrl(30 * 1024 * 1024)] : undefined;
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
