/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared image generation logic used by both:
 * - The built-in MCP server (imageGenServer.ts)
 * - The legacy Gemini-specific tool (img-gen.ts)
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { jsonrepair } from 'jsonrepair';
import type OpenAI from 'openai';
import { ClientFactory, type RotatingClient } from '@/common/api/ClientFactory';
import { OpenAIRotatingClient } from '@/common/api/OpenAIRotatingClient';
import type { TProviderWithModel } from '@/common/config/storage';
import type { UnifiedChatCompletionResponse } from '@/common/api/RotatingApiClient';
import { isImagesApiModel } from '@/common/utils/imageModelAllowlist';
import { IMAGE_EXTENSIONS, MIME_TYPE_MAP, MIME_TO_EXT_MAP, DEFAULT_IMAGE_EXTENSION } from '@/common/config/constants';

const API_TIMEOUT_MS = 120000; // 2 minutes for image generation API calls

// Default request size for the images API ("form A"). The built-in tool exposes
// only a text prompt, so generation uses a square default rather than a param.
const DEFAULT_IMAGE_SIZE = '1024x1024';

type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

// ===== Utility Functions =====

export function safeJsonParse<T = unknown>(jsonString: string, fallbackValue: T): T {
  if (!jsonString || typeof jsonString !== 'string') {
    return fallbackValue;
  }

  try {
    return JSON.parse(jsonString) as T;
  } catch (_error) {
    try {
      const repairedJson = jsonrepair(jsonString);
      return JSON.parse(repairedJson) as T;
    } catch (_repairError) {
      console.warn('[ImageGen] JSON parse failed:', jsonString.substring(0, 50));
      return fallbackValue;
    }
  }
}

export function isImageFile(file_path: string): boolean {
  const ext = path.extname(file_path).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext as ImageExtension);
}

export function isHttpUrl(str: string): boolean {
  return str.startsWith('http://') || str.startsWith('https://');
}

export async function fileToBase64(file_path: string): Promise<string> {
  try {
    const fileBuffer = await fs.promises.readFile(file_path);
    return fileBuffer.toString('base64');
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    if (errorMessage.includes('ENOENT') || errorMessage.includes('no such file')) {
      throw new Error(`Image file not found: ${file_path}`, { cause: error });
    }
    throw new Error(`Failed to read image file: ${errorMessage}`, { cause: error });
  }
}

export function getImageMimeType(file_path: string): string {
  const ext = path.extname(file_path).toLowerCase();
  return MIME_TYPE_MAP[ext] || MIME_TYPE_MAP[DEFAULT_IMAGE_EXTENSION];
}

export function getFileExtensionFromDataUrl(dataUrl: string): string {
  const mimeTypeMatch = dataUrl.match(/^data:image\/([^;]+);base64,/);
  if (mimeTypeMatch && mimeTypeMatch[1]) {
    const mimeType = mimeTypeMatch[1].toLowerCase();
    return MIME_TO_EXT_MAP[mimeType] || DEFAULT_IMAGE_EXTENSION;
  }
  return DEFAULT_IMAGE_EXTENSION;
}

/**
 * The only remote-image seam in this common module. Main-process callers must
 * supply the Task 4 policy-enforcing downloader; this module never fetches a
 * hosted URL itself.
 */
export type HostedImageDownloader = (input: {
  url: string;
  maxBytes: number;
  signal?: AbortSignal;
  write: (chunk: Buffer) => Promise<void>;
}) => Promise<void>;

export type ImageGenerationDeps = { hostedImageDownloader?: HostedImageDownloader };

const HOSTED_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

const sniffGeneratedImageExtension = (bytes: Buffer): '.png' | '.jpg' | '.webp' | null => {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return '.png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return '.jpg';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return '.webp';
  return null;
};

const decodeImageDataUrl = (value: string, maxBytes: number): Buffer => {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match?.[2] || match[2].length % 4 === 1 || match[2].length > Math.ceil(maxBytes / 3) * 4)
    throw new Error('Invalid image data URL');
  const decoded = Buffer.from(match[2], 'base64');
  const detected = sniffGeneratedImageExtension(decoded);
  const declared = match[1] === 'jpeg' ? '.jpg' : `.${match[1]}`;
  if (decoded.byteLength === 0 || decoded.byteLength > maxBytes || !detected || detected !== declared) {
    throw new Error('Invalid image data URL');
  }
  const canonicalInput = match[2].replace(/=+$/, '');
  if (decoded.toString('base64').replace(/=+$/, '') !== canonicalInput) throw new Error('Invalid image data URL');
  return decoded;
};

export async function saveGeneratedImage(
  imageData: string,
  workspaceDir: string,
  hostedImageDownloader?: HostedImageDownloader,
  signal?: AbortSignal,
  maxBytes = HOSTED_IMAGE_MAX_BYTES
): Promise<string> {
  const timestamp = Date.now();
  const base_name = `img-${timestamp}-${randomUUID()}`;
  const fileExtension = isHttpUrl(imageData) ? DEFAULT_IMAGE_EXTENSION : getFileExtensionFromDataUrl(imageData);
  const file_name = `${base_name}${fileExtension}`;
  const file_path = path.join(workspaceDir, file_name);
  const temp_path = `${file_path}.part`;

  try {
    await fs.promises.mkdir(workspaceDir, { recursive: true });
    if (isHttpUrl(imageData)) {
      if (!hostedImageDownloader) throw new Error('Hosted image downloader is not configured');
      let byteSize = 0;
      const header = Buffer.alloc(12);
      const handle = await fs.promises.open(temp_path, 'wx+');
      try {
        await hostedImageDownloader({
          url: imageData,
          maxBytes,
          signal,
          write: async (chunk) => {
            byteSize += chunk.byteLength;
            if (byteSize > maxBytes) throw new Error('Hosted image exceeds the allowed size');
            await handle.write(chunk);
          },
        });
        if (byteSize === 0) throw new Error('Hosted image did not contain data');
        await handle.read(header, 0, header.byteLength, 0);
      } finally {
        await handle.close();
      }
      const detectedExtension = sniffGeneratedImageExtension(header);
      if (!detectedExtension) throw new Error('Hosted output is not a supported image');
      const detectedPath = path.join(workspaceDir, `${base_name}${detectedExtension}`);
      await fs.promises.rename(temp_path, detectedPath);
      return detectedPath;
    }
    const imageBuffer = decodeImageDataUrl(imageData, maxBytes);
    await fs.promises.writeFile(temp_path, imageBuffer, { flag: 'wx' });
    await fs.promises.rename(temp_path, file_path);
    return file_path;
  } catch (error) {
    await fs.promises.rm(temp_path, { force: true }).catch((): undefined => undefined);
    console.error('[ImageGen] Failed to save image file');
    const stableCode =
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[a-z_]{1,64}$/.test(error.code)
        ? error.code
        : error instanceof Error &&
            [
              'Hosted image downloader is not configured',
              'Hosted image exceeds the allowed size',
              'Hosted image did not contain data',
              'Hosted output is not a supported image',
              'Invalid image data URL',
            ].includes(error.message)
          ? error.message
          : 'hosted_image_download_failed';
    throw new Error(`Failed to save image: ${stableCode}`, { cause: error });
  }
}

// ===== Image Content Processing =====

interface ImageContent {
  type: 'image_url';
  image_url: {
    url: string;
    detail: 'auto' | 'low' | 'high';
  };
}

export async function processImageUri(imageUri: string, workspaceDir: string): Promise<ImageContent | null> {
  if (imageUri.startsWith('data:')) {
    decodeImageDataUrl(imageUri, HOSTED_IMAGE_MAX_BYTES);
    return {
      type: 'image_url',
      image_url: { url: imageUri, detail: 'auto' },
    };
  }

  if (isHttpUrl(imageUri)) {
    return {
      type: 'image_url',
      image_url: { url: imageUri, detail: 'auto' },
    };
  }

  let processedUri = imageUri;
  if (imageUri.startsWith('@')) {
    processedUri = imageUri.substring(1);
  }

  let fullPath = processedUri;
  if (!path.isAbsolute(processedUri)) {
    fullPath = path.join(workspaceDir, processedUri);
  }

  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);

    if (!isImageFile(fullPath)) {
      throw new Error(`File is not a supported image type: ${fullPath}`);
    }

    const base64Data = await fileToBase64(fullPath);
    const mimeType = getImageMimeType(fullPath);
    return {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'auto' },
    };
  } catch (error) {
    const possiblePaths = [imageUri, path.join(workspaceDir, imageUri)].filter((p, i, arr) => arr.indexOf(p) === i);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes('Image file not found') || errorMessage.includes('not a supported image type')) {
      throw error;
    }

    throw new Error(
      `Image file not found. Searched paths:\n${possiblePaths.map((p) => `- ${p}`).join('\n')}\n\nPlease ensure the image file exists and has a valid image extension (.jpg, .png, .gif, .webp, etc.)`,
      { cause: error }
    );
  }
}

// ===== Core Execution =====

export interface ImageGenParams {
  prompt: string;
  image_uris?: string[] | string;
}

export interface ImageGenResult {
  success: boolean;
  text: string;
  imagePath?: string;
  relativeImagePath?: string;
  error?: string;
}

/**
 * Extract the first image from an OpenAI images API ("form A") response as a
 * data URL. `gpt-image-1` always returns `b64_json`; other models may return a
 * hosted `url`. Returns null when the response carries no image payload.
 */
export function extractImagesApiDataUrl(response: OpenAI.Images.ImagesResponse): string | null {
  const first = response.data?.[0];
  if (!first) return null;
  if (first.b64_json) return `data:image/png;base64,${first.b64_json}`;
  if (first.url) return first.url;
  return null;
}

/**
 * Generate an image through the OpenAI images endpoint (`/v1/images/generations`).
 * Used for models like `gpt-image-1` that return images via the images API
 * rather than inline in a chat-completions response.
 */
async function generateViaImagesApi(
  params: ImageGenParams,
  provider: TProviderWithModel,
  workspaceDir: string,
  proxy?: string,
  signal?: AbortSignal,
  deps?: ImageGenerationDeps
): Promise<ImageGenResult> {
  const hasInputImages = Array.isArray(params.image_uris) ? params.image_uris.length > 0 : !!params.image_uris;
  if (hasInputImages) {
    return {
      success: false,
      text: `Image editing is not supported for ${provider.use_model}; this model only supports text-to-image generation.`,
      error: 'image_editing_unsupported',
    };
  }

  const rotatingClient = await ClientFactory.createRotatingClient(provider, {
    proxy,
    rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
  });

  if (!(rotatingClient instanceof OpenAIRotatingClient)) {
    return {
      success: false,
      text: `The images API is only supported for OpenAI-compatible providers. Current model: ${provider.use_model}`,
      error: 'images_api_unsupported_provider',
    };
  }

  // `response_format` is intentionally omitted: gpt-image-1 rejects it and
  // always returns base64. extractImagesApiDataUrl handles b64_json and url.
  const response = await rotatingClient.createImage(
    { model: provider.use_model, prompt: params.prompt, size: DEFAULT_IMAGE_SIZE, n: 1 },
    { signal, timeout: API_TIMEOUT_MS }
  );

  const dataUrl = extractImagesApiDataUrl(response);
  if (!dataUrl) {
    return { success: false, text: 'Image generation did not return any image data.', error: 'no_output' };
  }

  const imagePath = await saveGeneratedImage(dataUrl, workspaceDir, deps?.hostedImageDownloader, signal);
  const relativeImagePath = path.relative(workspaceDir, imagePath);
  return {
    success: true,
    text: `Generated image saved to: ${imagePath}`,
    imagePath,
    relativeImagePath,
  };
}

/**
 * Core image generation function shared between MCP server and Gemini tool.
 */
export async function executeImageGeneration(
  params: ImageGenParams,
  provider: TProviderWithModel,
  workspaceDir: string,
  proxy?: string,
  signal?: AbortSignal,
  deps?: ImageGenerationDeps
): Promise<ImageGenResult> {
  if (signal?.aborted) {
    return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
  }

  try {
    // Form-A models (gpt-image-1, dall-e-*) use the images endpoint, not chat.
    if (isImagesApiModel(provider.use_model)) {
      return await generateViaImagesApi(params, provider, workspaceDir, proxy, signal, deps);
    }

    // Parse image URIs
    let imageUris: string[] = [];
    if (params.image_uris) {
      if (typeof params.image_uris === 'string') {
        const parsed = safeJsonParse<string[]>(params.image_uris, null);
        imageUris = Array.isArray(parsed) ? parsed : [params.image_uris];
      } else if (Array.isArray(params.image_uris)) {
        imageUris = params.image_uris;
      }
    }

    const hasImages = imageUris.length > 0;
    let enhancedPrompt: string;
    if (hasImages) {
      enhancedPrompt = `Analyze/Edit image: ${params.prompt}`;
    } else {
      enhancedPrompt = `Generate image: ${params.prompt}`;
    }

    const contentParts: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [{ type: 'text', text: enhancedPrompt }];

    // Process image URIs
    if (hasImages) {
      try {
        const processed = await Promise.all(imageUris.map((uri) => processImageUri(uri, workspaceDir)));
        if (processed.some((imageContent) => imageContent === null)) throw new Error('Invalid image input');
        contentParts.push(...(processed as ImageContent[]));
      } catch {
        return {
          success: false,
          text: 'Failed to process image inputs.',
          error: 'invalid_image_input',
        };
      }
    }

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [{ role: 'user', content: contentParts }];

    // Create client and call API
    const rotatingClient: RotatingClient = await ClientFactory.createRotatingClient(provider, {
      proxy,
      rotatingOptions: { maxRetries: 3, retryDelay: 1000 },
    });

    const completion: UnifiedChatCompletionResponse = await rotatingClient.createChatCompletion(
      { model: provider.use_model, messages: messages as any },
      { signal, timeout: API_TIMEOUT_MS }
    );

    const choice = completion.choices[0];
    if (!choice) {
      return { success: false, text: 'No response from image generation API', error: 'No response' };
    }

    const responseText = choice.message.content || 'Image generated successfully.';
    let images = choice.message.images;

    // Extract images from markdown in content if not in images field
    if ((!images || images.length === 0) && responseText) {
      const dataUrlRegex = /!\[[^\]]*\]\((data:image\/[^;]+;base64,[^)]+)\)/g;
      const dataUrlMatches = [...responseText.matchAll(dataUrlRegex)];
      if (dataUrlMatches.length > 0) {
        images = dataUrlMatches.map((match) => ({
          type: 'image_url' as const,
          image_url: { url: match[1] },
        }));
      } else {
        const file_pathRegex = /!\[[^\]]*\]\(([^)]+\.(?:jpg|jpeg|png|gif|webp|bmp|tiff|svg))\)/gi;
        const file_pathMatches = [...responseText.matchAll(file_pathRegex)];
        if (file_pathMatches.length > 0) {
          const processedImages: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
          for (const match of file_pathMatches) {
            const file_path = match[1];
            const fullPath = path.isAbsolute(file_path) ? file_path : path.join(workspaceDir, file_path);
            try {
              await fs.promises.access(fullPath);
              const base64Data = await fileToBase64(fullPath);
              const mimeType = getImageMimeType(fullPath);
              processedImages.push({
                type: 'image_url',
                image_url: { url: `data:${mimeType};base64,${base64Data}` },
              });
            } catch (_fileError) {
              console.warn(`[ImageGen] Could not load image file: ${file_path}`);
            }
          }
          if (processedImages.length > 0) {
            images = processedImages;
          }
        }
      }
    }

    if (!images || images.length === 0) {
      const warningMessage = `Image generation did not produce any images.\n\nModel response: ${responseText}\n\nTip: Make sure your image generation model supports this type of request. Current model: ${provider.use_model}`;
      return { success: false, text: warningMessage, error: 'no_output' };
    }

    const firstImage = images[0];
    if (firstImage.type === 'image_url' && firstImage.image_url?.url) {
      const imagePath = await saveGeneratedImage(
        firstImage.image_url.url,
        workspaceDir,
        deps?.hostedImageDownloader,
        signal
      );
      const relativeImagePath = path.relative(workspaceDir, imagePath);

      // Strip any inline base64 data URLs from the human-readable text before
      // returning. The image is already saved to disk and referenced by path,
      // so re-emitting hundreds of MB of base64 in the MCP tool response just
      // forces the parent process to ship that payload through framed TCP again
      // (which is where the 2026-04-14 commit-charge blow-up happened).
      const cleanText = responseText.replace(
        /!\[[^\]]*\]\(data:image\/[^;]+;base64,[^)]+\)/g,
        '[embedded image extracted]'
      );

      return {
        success: true,
        text: `${cleanText}\n\nGenerated image saved to: ${imagePath}`,
        imagePath,
        relativeImagePath,
      };
    }

    return { success: false, text: responseText, error: 'no_output' };
  } catch (error) {
    if (signal?.aborted) {
      return { success: false, text: 'Image generation was cancelled.', error: 'cancelled' };
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[ImageGen] API call failed');
    return { success: false, text: `Error generating image: ${errorMessage}`, error: errorMessage };
  }
}
