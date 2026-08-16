/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { getImageModelMaxConditioningImages, isImageGenSupported, isImagesApiModel } from './imageModelAllowlist';

const VNG_BASE_URL = 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1';

describe('isImagesApiModel', () => {
  it('matches OpenAI images-API models', () => {
    expect(isImagesApiModel('openai/gpt-image-1')).toBe(true);
    expect(isImagesApiModel('gpt-image-1')).toBe(true);
    expect(isImagesApiModel('dall-e-3')).toBe(true);
    expect(isImagesApiModel('dalle-2')).toBe(true);
  });

  it('does not match chat-completions image models or text models', () => {
    expect(isImagesApiModel('gemini-2.5-flash-image-preview')).toBe(false);
    expect(isImagesApiModel('gpt-4o')).toBe(false);
    expect(isImagesApiModel('minimax/minimax-m2.5')).toBe(false);
  });
});

describe('isImageGenSupported', () => {
  it('allows gpt-image-1 on the VNG MaaS provider (form-A adapter)', () => {
    expect(isImageGenSupported({ base_url: VNG_BASE_URL, platform: 'openai' }, 'openai/gpt-image-1')).toBe(true);
  });

  it('does not surface non-image models on the VNG provider', () => {
    expect(isImageGenSupported({ base_url: VNG_BASE_URL, platform: 'openai' }, 'openai/gpt-5')).toBe(false);
  });

  it('does not allow gpt-image-1 on a non-allowlisted provider', () => {
    expect(isImageGenSupported({ base_url: 'https://api.openai.com/v1', platform: 'openai' }, 'gpt-image-1')).toBe(
      false
    );
  });

  it('preserves existing gemini and openrouter chat-completions image support', () => {
    expect(isImageGenSupported({ platform: 'gemini' }, 'gemini-2.5-flash-image-preview')).toBe(true);
    expect(
      isImageGenSupported({ base_url: 'https://openrouter.ai/api/v1' }, 'google/gemini-2.5-flash-image-preview')
    ).toBe(true);
  });
});

describe('getImageModelMaxConditioningImages', () => {
  it('admits the evidence-backed OpenRouter Gemini 3 Pro Image route exactly', () => {
    expect(
      getImageModelMaxConditioningImages({ base_url: 'https://openrouter.ai/api/v1' }, 'google/gemini-3-pro-image')
    ).toBe(2);
  });

  it.each([
    [{ base_url: 'https://openrouter.ai/api/v1/' }, 'google/gemini-3-pro-image'],
    [{ base_url: 'https://openrouter.ai/api/v1' }, 'google/gemini-3-pro-image-preview'],
    [{ base_url: VNG_BASE_URL, platform: 'openai' }, 'openai/gpt-image-1'],
    [{ platform: 'gemini' }, 'gemini-2.5-flash-image-preview'],
    [{ base_url: 'https://openrouter.ai/api/v1' }, 'google/gemini-2.5-flash-image-preview'],
    [{ platform: 'gemini', name: 'WePrompt Studio E2E' }, 'weprompt-e2e-image'],
  ])('keeps production tuple %j / %s fail-closed at zero', (provider, model) => {
    expect(getImageModelMaxConditioningImages(provider, model)).toBe(0);
  });
});
