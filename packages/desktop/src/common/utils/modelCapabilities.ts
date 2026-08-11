/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  IProvider,
  ModelImageInputCapability,
  ModelOpenAiApiMode,
  ModelSettings,
  ModelType,
} from '@/common/config/storage';

/**
 * Capability matching regex patterns
 */
export const CAPABILITY_PATTERNS: Record<ModelType, RegExp> = {
  text: /gpt|claude|gemini|qwen|llama|mistral|deepseek/i,
  vision: /4o|claude-3|gemini-.*-pro|gemini-.*-flash|gemini-2\.0|qwen-vl|llava|vision/i,
  function_calling: /gpt-4|claude-3|gemini|qwen|deepseek/i,
  image_generation: /flux|diffusion|stabilityai|sd-|dall|cogview|janus|midjourney|mj-|imagen/i,
  web_search: /search|perplexity/i,
  reasoning: /o1-|reasoning|think/i,
  embedding: /(?:^text-|embed|bge-|e5-|LLM2Vec|retrieval|uae-|gte-|jina-clip|jina-embeddings|voyage-)/i,
  rerank: /(?:rerank|re-rank|re-ranker|re-ranking|retrieval|retriever)/i,
  excludeFromPrimary: /dall-e|flux|stable-diffusion|midjourney|flash-image|image|embed|rerank/i,
};

/**
 * Explicit exclusion lists (blacklist) for capabilities
 */
export const CAPABILITY_EXCLUSIONS: Record<ModelType, RegExp[]> = {
  text: [],
  vision: [/embed|rerank|dall-e|flux|stable-diffusion/i],
  function_calling: [
    /aqa(?:-[\w-]+)?/i,
    /imagen(?:-[\w-]+)?/i,
    /o1-mini/i,
    /o1-preview/i,
    /gemini-1(?:\\.[\w-]+)?/i,
    /dall-e/i,
    /embed/i,
    /rerank/i,
  ],
  image_generation: [],
  web_search: [],
  reasoning: [],
  embedding: [],
  rerank: [],
  excludeFromPrimary: [],
};

/**
 * Get the lowercase, normalized base model name for matching.
 */
export const getBaseModelName = (modelName: string): string => {
  return modelName
    .toLowerCase()
    .replace(/[^a-z0-9./-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
};

export type ModelOpenAiApiModeChoice = ModelOpenAiApiMode | 'auto';
export type ModelImageInputChoice = ModelImageInputCapability | 'auto';

/** Whether a provider/model protocol can select an OpenAI wire API. */
export const supportsOpenAiApiMode = (platform: string, modelProtocol = 'openai'): boolean => {
  if (platform === 'new-api') return modelProtocol === 'openai';
  return !['anthropic', 'bedrock', 'gemini', 'gemini-vertex-ai'].includes(platform);
};

/** Apply explicit settings to models while keeping automatic values absent on the wire. */
export const updateModelSettings = (
  current: Record<string, ModelSettings> | undefined,
  modelIds: string[],
  imageInput: ModelImageInputChoice,
  openAiApiMode: ModelOpenAiApiModeChoice
): Record<string, ModelSettings> => {
  const next = { ...current };

  for (const modelId of modelIds) {
    if (imageInput === 'auto' && openAiApiMode === 'auto') {
      delete next[modelId];
      continue;
    }

    const settings: ModelSettings = {};
    if (imageInput !== 'auto') settings.image_input = imageInput;
    if (openAiApiMode !== 'auto') settings.openai_api_mode = openAiApiMode;
    next[modelId] = settings;
  }

  return next;
};

/**
 * Capabilities that CANNOT be answered by this module at all, by any heuristic.
 *
 * Every other capability here is resolved from evidence of decreasing strength:
 * an explicit user tag, then a per-provider rule, then a regex over the model
 * name (note `_platformModel` is unused below — name matching ignores the
 * provider entirely). For vision or function-calling that ladder is fine; a
 * wrong guess degrades a list filter.
 *
 * Reasoning is different. EPIC-003 rules that even an explicit
 * provider-declared reasoning badge is insufficient evidence to enable
 * reasoning controls — positive evidence must come from the capability
 * discovery seam. Every rung of the ladder above is therefore too weak: a user
 * checkbox is the user telling themselves, and a name regex is weaker still, so
 * a model merely named `*-thinking` would grant the feature with no backend
 * consulted. Guarding only the regex would leave the other two rungs open.
 *
 * These capabilities resolve to `undefined` ("unknown") — never `true`, and
 * never `false`. `undefined` preserves the tri-state vocabulary: callers must
 * seek positive evidence from the discovery seam, and nobody is told the
 * capability is definitively absent.
 *
 * This does NOT remove `reasoning` from {@link ModelType}: storing and
 * displaying a reasoning tag is unaffected. It only stops this module being
 * treated as authority for whether reasoning controls may be enabled.
 */
export const DISCOVERY_ONLY_CAPABILITIES: ReadonlySet<ModelType> = new Set<ModelType>(['reasoning']);

/**
 * Check whether a specific model within a provider has a given capability.
 * Returns true (supported), false (excluded), or undefined (unknown).
 */
export const hasSpecificModelCapability = (
  _platformModel: IProvider,
  modelName: string,
  type: ModelType
): boolean | undefined => {
  if (DISCOVERY_ONLY_CAPABILITIES.has(type)) return undefined;

  const baseModelName = getBaseModelName(modelName);
  const exclusions = CAPABILITY_EXCLUSIONS[type];
  const pattern = CAPABILITY_PATTERNS[type];

  const isExcluded = exclusions.some((excludePattern) => excludePattern.test(baseModelName));
  if (isExcluded) return false;

  return pattern.test(baseModelName) ? true : undefined;
};
