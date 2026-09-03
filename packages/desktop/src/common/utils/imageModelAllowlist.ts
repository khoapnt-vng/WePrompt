/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Allowlist for built-in image generation tool.
 *
 * The tool supports two request shapes:
 * - "form B" — OpenAI chat completions multimodal output (model returns images
 *   via `message.images` or markdown). Used by Gemini/OpenRouter/Antigravity.
 * - "form A" — the OpenAI images endpoint (`/v1/images/generations`), used by
 *   `gpt-image-1` / `dall-e-*`. Routed by `isImagesApiModel` in imageGenCore.ts.
 *
 * Model selection must still be a platform+model allowlist of providers known
 * to work, rather than a coarse name-substring match. Otherwise users see
 * options in the dropdown that are guaranteed to fail at runtime.
 *
 * Rules below mirror `useConfigModelListWithImage.ts` — the same providers we
 * auto-supplement with default image models.
 */

type ProviderShape = {
  platform?: string;
  base_url?: string;
  name?: string;
  model_health?: Record<string, { status: 'unknown' | 'healthy' | 'unhealthy' }>;
};

const IMAGE_NAME_PATTERN = /(image|banana|imagine)/i;

/**
 * Models served through the OpenAI *images* API (`/v1/images/generations`,
 * "form A") rather than chat-completions multimodal output. These are routed to
 * the form-A adapter (`generateViaImagesApi`) in imageGenCore.ts.
 */
const IMAGES_API_MODEL_PATTERN = /gpt-image|dall[-·]?e/i;

export const isImagesApiModel = (modelName: string): boolean => IMAGES_API_MODEL_PATTERN.test(modelName);

const RULES: Array<{
  id: string;
  match: (provider: ProviderShape) => boolean;
}> = [
  {
    id: 'gemini',
    match: (p) => p.platform === 'gemini' || p.platform === 'gemini-vertex-ai',
  },
  {
    id: 'openrouter',
    match: (p) => !!p.base_url?.includes('openrouter.ai'),
  },
  {
    id: 'antigravity',
    match: (p) => !!p.name?.toLowerCase().includes('antigravity'),
  },
  {
    // VNG MaaS (GreenNode) — OpenAI-compatible images endpoint via the form-A adapter.
    id: 'vng-maas',
    match: (p) => !!p.base_url?.includes('vngcloud.vn'),
  },
];

export const isImageGenSupported = (provider: ProviderShape, modelName: string): boolean => {
  if (!IMAGE_NAME_PATTERN.test(modelName) && !isImagesApiModel(modelName)) return false;
  return RULES.some((rule) => rule.match(provider));
};

/**
 * The provider health probe is a tool-use chat completion, so it cannot judge
 * image-generation endpoints. Ignore that verdict only for exact image tuples
 * admitted by the shared allowlist; every other unhealthy model stays blocked.
 */
export const isDisqualifiedByHealthVerdict = (provider: ProviderShape, modelName: string): boolean =>
  provider.model_health?.[modelName]?.status === 'unhealthy' && !isImageGenSupported(provider, modelName);

/** Exact production admission point; stays fail-closed until a tuple passes the paid Task 8.5 evidence gate. */
export const getImageModelMaxConditioningImages = (provider: ProviderShape, modelName: string): number => {
  // Task 8.5 evidence-backed admission: exactly two inputs visibly influenced the verified still.
  if (provider.base_url === 'https://openrouter.ai/api/v1' && modelName === 'google/gemini-3-pro-image') return 2;
  return 0;
};
