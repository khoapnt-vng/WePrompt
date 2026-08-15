/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { TProviderWithModel } from '@/common/config/storage';
import {
  createOpenRouterVideoAdapter,
  OPENROUTER_VIDEO_MODELS,
} from '@process/services/creative-studio/adapters/openRouterVideoAdapter';
import type {
  ProviderFetch,
  ProviderHttpResponse,
  ResolvedProviderInput,
} from '@process/services/creative-studio/adapters/types';

const provider = (overrides: Partial<TProviderWithModel> = {}): TProviderWithModel => ({
  id: 'openrouter',
  name: 'OpenRouter',
  platform: 'openai-compatible',
  base_url: 'https://openrouter.ai/api/v1',
  api_key: 'sk-or-test',
  use_model: 'bytedance/seedance-2.0-fast',
  ...overrides,
});

const request = {
  prompt: 'VNG intro',
  mediaKind: 'video' as const,
  aspectRatio: '16:9' as const,
  resolution: '720p' as const,
  durationSeconds: 10,
  idempotencyKey: 'request_1',
};

const response = (status: number, body: unknown): ProviderHttpResponse => ({
  status,
  json: async () => body,
});

const firstFrame = (asDataUrl = vi.fn(async () => 'data:image/png;base64,QUJD')): ResolvedProviderInput => ({
  assetId: 'asset_1',
  mimeType: 'image/png',
  byteSize: 3,
  openStream: async () => {
    throw new Error('not used by adapters');
  },
  asDataUrl,
});

describe('OpenRouter video generation adapter', () => {
  it('submits the supported audio request shape without frame_images when no first frame is set', async () => {
    const fetch = vi.fn(async () =>
      response(202, {
        id: 'job_abc',
        polling_url: 'https://openrouter.ai/api/v1/videos/job_abc',
        status: 'pending',
      })
    );
    const adapter = createOpenRouterVideoAdapter({ fetch });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).resolves.toEqual({
      kind: 'remote',
      providerJobId: 'job_abc',
    });

    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/videos',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-or-test' }),
      })
    );
    const payload = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(payload).toMatchObject({
      model: 'bytedance/seedance-2.0-fast',
      prompt: 'VNG intro',
      duration: 10,
      aspect_ratio: '16:9',
      resolution: '720p',
      generate_audio: true,
    });
    expect(payload).not.toHaveProperty('frame_images');
  });

  it('omits generate_audio when the selected model spec does not support it', async () => {
    const fetch = vi.fn(async () => response(202, { id: 'job_abc', status: 'pending' }));
    const adapter = createOpenRouterVideoAdapter({ fetch });
    const spec = OPENROUTER_VIDEO_MODELS['bytedance/seedance-2.0-fast'];
    if (!spec) throw new Error('Expected curated OpenRouter model spec');

    // Every currently curated model supports audio; temporarily exercise the
    // false branch without inventing a production model ID.
    Reflect.set(spec, 'supportsAudio', false);
    try {
      await adapter.submit(request, provider(), new AbortController().signal);
    } finally {
      Reflect.set(spec, 'supportsAudio', true);
    }

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty('generate_audio');
  });

  it('rejects a managed first frame before data-url conversion or provider submission', async () => {
    const fetch = vi.fn(async () => response(202, { id: 'job_abc', status: 'pending' }));
    const asDataUrl = vi.fn(async () => 'data:image/png;base64,QUJD');
    const adapter = createOpenRouterVideoAdapter({ fetch });

    await expect(
      adapter.submit({ ...request, firstFrame: firstFrame(asDataUrl) }, provider(), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'unsupported' });

    expect(asDataUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['pending', { status: 'queued' }],
    ['processing', { status: 'running' }],
    ['failed', { status: 'failed', error: { code: 'unknown' } }],
    ['cancelled', { status: 'cancelled', error: { code: 'unknown' } }],
  ])('maps the %s polling state', async (status, expected) => {
    const fetch: ProviderFetch = async () => response(200, { status });
    const adapter = createOpenRouterVideoAdapter({ fetch });

    await expect(adapter.poll?.('job_abc', provider(), new AbortController().signal)).resolves.toEqual(expected);
  });

  it('maps completed unsigned_urls to the primary video output', async () => {
    const fetch = vi.fn(async () =>
      response(200, {
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/job_abc/content?index=0'],
      })
    );
    const adapter = createOpenRouterVideoAdapter({ fetch });

    await expect(adapter.poll?.('job_abc', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'url', url: 'https://openrouter.ai/api/v1/videos/job_abc/content?index=0' },
          mimeType: 'video/mp4',
        },
      ],
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/videos/job_abc',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('rejects a provider base URL whose host is not exactly openrouter.ai', () => {
    const adapter = createOpenRouterVideoAdapter();

    expect(
      adapter.validateRequest(request, provider({ base_url: 'https://openrouter.ai.evil.example/api/v1' }))
    ).toEqual({ ok: false, issues: [{ code: 'provider_unavailable' }] });
  });

  it('rejects a completed output URL whose host is not exactly openrouter.ai', async () => {
    const adapter = createOpenRouterVideoAdapter({
      fetch: async () =>
        response(200, { status: 'completed', unsigned_urls: ['https://openrouter.ai.evil.example/video.mp4'] }),
    });

    await expect(adapter.poll?.('job_abc', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'failed',
      error: { code: 'no_output' },
    });
  });

  it('validates against GET /videos/models and returns the curated model capabilities', async () => {
    const fetch = vi.fn(async () => response(200, { models: ['bytedance/seedance-2.0-fast'] }));
    const adapter = createOpenRouterVideoAdapter({ fetch, validationTimeoutMs: 5_000 });
    const spec = OPENROUTER_VIDEO_MODELS['bytedance/seedance-2.0-fast'];
    if (!spec) throw new Error('Expected curated OpenRouter model spec');

    await expect(
      adapter.validateConnection({ model: 'bytedance/seedance-2.0-fast' }, provider(), new AbortController().signal)
    ).resolves.toEqual({
      ok: true,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        aspectRatios: [...spec.ratios],
        resolutions: [...spec.resolutions],
        minDurationSeconds: spec.minDuration,
        maxDurationSeconds: spec.maxDuration,
        supportsFirstFrame: false,
        cancellationPolicy: 'none',
      },
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/videos/models',
      expect.objectContaining({ method: 'GET' })
    );
  });
});
