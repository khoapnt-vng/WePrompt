/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import type { TProviderWithModel } from '@/common/config/storage';
import {
  createOpenRouterVideoAdapter,
  createOpenRouterVideoCatalog,
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
  use_model: 'bytedance/seedance-2.0',
  ...overrides,
});

const request = {
  prompt: 'VNG intro',
  mediaKind: 'video' as const,
  aspectRatio: '16:9' as const,
  resolution: '720p' as const,
  durationSeconds: 10,
  idempotencyKey: 'request_1',
  routeConstraints: {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'] as const,
    resolutions: ['720p', '1080p'] as const,
    minDurationSeconds: 4,
    maxDurationSeconds: 15,
    supportedDurationSeconds: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    supportsFirstFrame: true,
    maxConditioningImages: 0,
    silentOutput: false,
  },
};

const response = (status: number, body: unknown): ProviderHttpResponse => ({
  status,
  json: async () => body,
});

const catalogRow = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'bytedance/seedance-2.0',
  supported_resolutions: ['480p', '720p', '1080p', '4K'],
  supported_aspect_ratios: ['1:1', '3:4', '9:16', '4:3', '16:9', '21:9'],
  supported_durations: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  supported_frame_images: ['first_frame', 'last_frame'],
  generate_audio: true,
  ...overrides,
});

const admittedCatalog = async (rows: Record<string, unknown>[] = [catalogRow()]) => {
  const catalog = createOpenRouterVideoCatalog({ fetch: async () => response(200, { data: rows }) });
  await catalog.refresh(provider(), new AbortController().signal);
  return catalog;
};

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
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog: await admittedCatalog() });

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
      model: 'bytedance/seedance-2.0',
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
    const catalog = await admittedCatalog([catalogRow({ generate_audio: null })]);
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog });

    await adapter.submit(
      { ...request, routeConstraints: { ...request.routeConstraints, silentOutput: true } },
      provider(),
      new AbortController().signal
    );

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty('generate_audio');
  });

  it('submits one managed first frame for the evidenced Seedance 2.0 route', async () => {
    const fetch = vi.fn(async () => response(202, { id: 'job_abc', status: 'pending' }));
    const asDataUrl = vi.fn(async () => 'data:image/png;base64,QUJD');
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog: await admittedCatalog() });

    await expect(
      adapter.submit({ ...request, firstFrame: firstFrame(asDataUrl) }, provider(), new AbortController().signal)
    ).resolves.toEqual({ kind: 'remote', providerJobId: 'job_abc' });

    expect(asDataUrl).toHaveBeenCalledWith(30 * 1024 * 1024);
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'bytedance/seedance-2.0',
      frame_images: [
        {
          type: 'image_url',
          image_url: { url: 'data:image/png;base64,QUJD' },
          frame_type: 'first_frame',
        },
      ],
    });
  });

  it('keeps unevidenced OpenRouter models closed to managed first frames', async () => {
    const fetch = vi.fn(async () => response(202, { id: 'job_abc', status: 'pending' }));
    const asDataUrl = vi.fn(async () => 'data:image/png;base64,QUJD');
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog: await admittedCatalog() });

    await expect(
      adapter.submit(
        { ...request, firstFrame: firstFrame(asDataUrl) },
        provider({ use_model: 'bytedance/seedance-2.0-fast' }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });

    expect(asDataUrl).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('emits only allowlisted evidence for a non-2xx provider response', async () => {
    const emitHttpErrorEvidence = vi.fn();
    const fetch = vi.fn(async () =>
      response(400, {
        error: {
          code: 400,
          message:
            'prompt=private scarf text key=sk-or-secret url=https://private.example data:image/png;base64,SECRET',
          metadata: {
            error_type: 'invalid_image',
            provider_code: 'image_download_failed',
            prompt: 'private scarf text',
            url: 'https://private.example',
          },
        },
      })
    );
    const adapter = createOpenRouterVideoAdapter({
      fetch,
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });

    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());
    expect(emitHttpErrorEvidence).toHaveBeenCalledWith({
      operation: 'submit',
      model: 'bytedance/seedance-2.0',
      httpStatus: 400,
      stableCode: 'invalid_request',
      jsonReadable: true,
      errorCode: '400',
      errorType: 'invalid_image',
      providerCode: 'image_download_failed',
      limitSource: null,
      upstreamCode: null,
      messagePresent: true,
    });
    expect(JSON.stringify(emitHttpErrorEvidence.mock.calls)).not.toMatch(
      /private scarf|sk-or-secret|private\.example|data:image|base64/i
    );
  });

  it('classifies a recognized upstream seed-image safety rejection without exposing provider prose', async () => {
    const emitHttpErrorEvidence = vi.fn();
    const upstream = JSON.stringify({
      error: {
        code: 'InputImageSensitiveContentDetected.PrivacyInformation',
        message:
          "The request failed because the input image 'content[1]' may contain real person. Request id: 0217874476920",
        param: '',
        type: 'BadRequest',
      },
    });
    const fetch = vi.fn(async () => response(400, { error: { message: `HTTP 400: ${upstream}`, code: 400 } }));
    const adapter = createOpenRouterVideoAdapter({
      fetch,
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'content_rejected',
    });

    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());
    expect(emitHttpErrorEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        stableCode: 'content_rejected',
        upstreamCode: 'InputImageSensitiveContentDetected.PrivacyInformation',
      })
    );
    // The prose beside it names the request and could name the prompt; it must not travel.
    expect(JSON.stringify(emitHttpErrorEvidence.mock.calls)).not.toMatch(/may contain real person|Request id/i);
  });

  it('keeps an unrecognized upstream identifier inside the generic 4xx classification', async () => {
    const upstream = JSON.stringify({
      error: { code: 'InputImageDimensionsRejected.InvalidRatio', message: 'private provider prose' },
    });
    const adapter = createOpenRouterVideoAdapter({
      fetch: async () => response(400, { error: { message: `HTTP 400: ${upstream}` } }),
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence: () => undefined,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('keeps authentication and spend status authoritative over a safety-shaped body', async () => {
    const upstream = JSON.stringify({
      error: { code: 'InputImageSensitiveContentDetected.PrivacyInformation' },
    });
    for (const [status, code] of [
      [402, 'quota'],
      [403, 'auth'],
      [429, 'rate_limited'],
    ] as const) {
      const adapter = createOpenRouterVideoAdapter({
        fetch: async () => response(status, { error: { message: `HTTP ${status}: ${upstream}` } }),
        catalog: await admittedCatalog(),
        emitHttpErrorEvidence: () => undefined,
      });

      // eslint-disable-next-line no-await-in-loop -- Each status owns an independent authority check.
      await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({ code });
    }
  });

  it('surfaces the spend-limit source a 402 names, because it is the one field that explains it', async () => {
    const emitHttpErrorEvidence = vi.fn();
    const fetch = vi.fn(async () =>
      response(402, {
        error: {
          code: 402,
          message: 'Insufficient credits. Add more using https://openrouter.ai/settings/credits',
          metadata: { limit_source: 'openrouter_credits', remedy_hint: 'Add credits at https://openrouter.ai' },
        },
      })
    );
    const adapter = createOpenRouterVideoAdapter({
      fetch,
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'quota',
    });

    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());
    expect(emitHttpErrorEvidence).toHaveBeenCalledWith(expect.objectContaining({ limitSource: 'openrouter_credits' }));
    // remedy_hint is free text with a URL; the identifier gate must keep dropping content like it.
    expect(JSON.stringify(emitHttpErrorEvidence.mock.calls)).not.toMatch(/settings\/credits|Add credits/i);
  });

  it.each([
    [402, 'quota', 'the account is out of credits, which the user can act on'],
    [400, 'invalid_request', 'the provider rejected the request definitively'],
    [404, 'invalid_request', 'a definitive client-side rejection'],
  ])('maps HTTP %i to %s, because %s', async (status, expected) => {
    const fetch = vi.fn(async () => response(status, { error: { message: 'x', code: status } }));
    const adapter = createOpenRouterVideoAdapter({
      fetch,
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence: () => undefined,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: expected,
    });
  });

  it('surfaces an unrecognised provider tag when it is identifier-shaped, and still never the message', async () => {
    const emitHttpErrorEvidence = vi.fn();
    const fetch = vi.fn(async () =>
      response(400, {
        error: {
          code: 'invalid_first_frame_dimensions',
          message: 'prompt=private scarf text key=sk-or-secret url=https://private.example',
          metadata: { error_type: 'first_frame_rejected', provider_code: 'seedance_bad_input' },
        },
      })
    );
    const adapter = createOpenRouterVideoAdapter({
      fetch,
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });

    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());
    expect(emitHttpErrorEvidence).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: 'invalid_first_frame_dimensions',
        errorType: 'first_frame_rejected',
        providerCode: 'seedance_bad_input',
        messagePresent: true,
      })
    );
    expect(JSON.stringify(emitHttpErrorEvidence.mock.calls)).not.toMatch(
      /private scarf|sk-or-secret|private\.example/i
    );
  });

  it('still drops any tag that is not identifier-shaped, because free text can carry the prompt', async () => {
    const emitHttpErrorEvidence = vi.fn();
    const fetch = vi.fn(async () =>
      response(400, {
        error: {
          code: 'the prompt "private scarf text" was rejected',
          metadata: {
            error_type: 'https://private.example/why',
            provider_code: 'data:image/png;base64,SECRET',
          },
        },
      })
    );
    const adapter = createOpenRouterVideoAdapter({
      fetch,
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });

    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());
    expect(emitHttpErrorEvidence).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: null, errorType: null, providerCode: null })
    );
  });

  it('preserves the stable adapter failure when diagnostic emission fails', async () => {
    const adapter = createOpenRouterVideoAdapter({
      fetch: async () => response(400, { error: { message: 'private prompt' } }),
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence: () => {
        throw new Error('diagnostic sink failed');
      },
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('bounds body classification before failure and still invokes the diagnostic sink afterward', async () => {
    let failureObserved = false;
    const bodyReadOrder: string[] = [];
    const sinkOrder: string[] = [];
    const emitHttpErrorEvidence = vi.fn(() => {
      sinkOrder.push(failureObserved ? 'after-failure' : 'before-failure');
    });
    const adapter = createOpenRouterVideoAdapter({
      fetch: async () => ({
        status: 400,
        json: async () => {
          bodyReadOrder.push(failureObserved ? 'after-failure' : 'before-failure');
          return { error: { metadata: { error_type: 'invalid_image' } } };
        },
      }),
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    failureObserved = true;
    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());

    expect(bodyReadOrder).toEqual(['before-failure']);
    expect(sinkOrder).toEqual(['after-failure']);
  });

  it('adopts and absorbs an asynchronously rejecting diagnostic sink', async () => {
    const sinkResult = Promise.reject(new Error('async diagnostic sink failed'));
    void sinkResult.catch(() => undefined);
    const then = vi.spyOn(sinkResult, 'then');
    const emitHttpErrorEvidence = vi.fn(() => sinkResult);
    const adapter = createOpenRouterVideoAdapter({
      fetch: async () => response(400, { error: { metadata: { error_type: 'invalid_image' } } }),
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence,
    });

    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await vi.waitFor(() => expect(emitHttpErrorEvidence).toHaveBeenCalledOnce());

    expect(then).toHaveBeenCalled();
  });

  it('does not wait for a stalled provider error body before rejecting the HTTP status', async () => {
    let resolveBody!: (value: unknown) => void;
    const stalledBody = new Promise<unknown>((resolve) => {
      resolveBody = resolve;
    });
    const adapter = createOpenRouterVideoAdapter({
      fetch: async () => ({ status: 400, json: async () => stalledBody }),
      catalog: await admittedCatalog(),
      emitHttpErrorEvidence: vi.fn(),
    });
    const submission = adapter.submit(request, provider(), new AbortController().signal);

    try {
      const outcome = await Promise.race([
        submission.then(
          () => 'unexpected-success',
          (error: unknown) => error
        ),
        new Promise<'stalled'>((resolve) => setTimeout(() => resolve('stalled'), 200)),
      ]);
      expect(outcome).toMatchObject({ code: 'invalid_request' });
    } finally {
      resolveBody({ error: { metadata: { error_type: 'invalid_image' } } });
      await submission.catch(() => undefined);
    }
  });

  it.each([
    ['pending', { status: 'queued' }],
    ['processing', { status: 'running' }],
    ['failed', { status: 'failed', error: { code: 'unknown' } }],
    ['cancelled', { status: 'cancelled', error: { code: 'unknown' } }],
  ])('maps the %s polling state', async (status, expected) => {
    const fetch: ProviderFetch = async () => response(200, { status });
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog: await admittedCatalog() });

    await expect(adapter.poll?.('job_abc', provider(), new AbortController().signal)).resolves.toEqual(expected);
  });

  it('maps completed unsigned_urls to the primary video output', async () => {
    const fetch = vi.fn(async () =>
      response(200, {
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/job_abc/content?index=0'],
      })
    );
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog: await admittedCatalog() });

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
      catalog: await admittedCatalog(),
    });

    await expect(adapter.poll?.('job_abc', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'failed',
      error: { code: 'no_output' },
    });
  });

  it('authenticates, admits a dynamically discovered model, and preserves its discrete capabilities', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/key')
        ? response(200, { data: { label: 'must-not-cross-processes' } })
        : response(200, {
            data: [
              catalogRow({
                id: 'openai/sora-2-pro',
                supported_resolutions: ['720p', '1080p'],
                supported_aspect_ratios: ['16:9', '9:16'],
                supported_durations: [20, 4, 16, 8, 12],
                supported_frame_images: null,
              }),
            ],
          })
    );
    const adapter = createOpenRouterVideoAdapter({ fetch, validationTimeoutMs: 5_000 });

    await expect(
      adapter.validateConnection(
        { model: 'openai/sora-2-pro' },
        provider({ use_model: 'openai/sora-2-pro' }),
        new AbortController().signal
      )
    ).resolves.toEqual({
      ok: true,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 12,
        supportedDurationSeconds: [4, 8, 12],
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        cancellationPolicy: 'none',
      },
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://openrouter.ai/api/v1/key',
      'https://openrouter.ai/api/v1/videos/models',
    ]);
  });

  it('rejects a selected model that is absent from an otherwise valid catalog', async () => {
    const fetch = vi.fn(async (url: string) =>
      url.endsWith('/key') ? response(200, {}) : response(200, { data: [catalogRow({ id: 'google/veo-3.1' })] })
    );
    const adapter = createOpenRouterVideoAdapter({ fetch });

    await expect(
      adapter.validateConnection({ model: 'openai/sora-2-pro' }, provider(), new AbortController().signal)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
  });

  it.each([{ data: [] }, { models: [catalogRow()] }, { data: [{ id: 'broken' }] }])(
    'fails closed for an empty or malformed catalog payload %#',
    async (payload) => {
      const fetch = vi.fn(async (url: string) => (url.endsWith('/key') ? response(200, {}) : response(200, payload)));
      const adapter = createOpenRouterVideoAdapter({ fetch });

      await expect(
        adapter.validateConnection({ model: 'bytedance/seedance-2.0' }, provider(), new AbortController().signal)
      ).resolves.toEqual({ ok: false, error: { code: 'invalid_response' } });
    }
  );

  it('clears a previously admitted snapshot when a refresh becomes malformed', async () => {
    let payload: unknown = { data: [catalogRow()] };
    const catalog = createOpenRouterVideoCatalog({ fetch: async () => response(200, payload) });
    await catalog.refresh(provider(), new AbortController().signal);
    expect(catalog.getModelSpec('bytedance/seedance-2.0')).not.toBeNull();

    payload = { data: [] };
    await expect(catalog.refresh(provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(catalog.getModelSpec('bytedance/seedance-2.0')).toBeNull();
  });

  it('never lets an older broad refresh overwrite a later catalog shrink', async () => {
    let resolveBroad!: (value: ProviderHttpResponse) => void;
    let resolveShrink!: (value: ProviderHttpResponse) => void;
    const broad = new Promise<ProviderHttpResponse>((resolve) => {
      resolveBroad = resolve;
    });
    const shrink = new Promise<ProviderHttpResponse>((resolve) => {
      resolveShrink = resolve;
    });
    let call = 0;
    const catalog = createOpenRouterVideoCatalog({
      fetch: async () => (call++ === 0 ? broad : shrink),
    });
    const older = catalog.refresh(provider(), new AbortController().signal);
    const newer = catalog.refresh(provider(), new AbortController().signal);

    resolveShrink(response(200, { data: [catalogRow({ id: 'google/veo-3.1', supported_durations: [4, 8] })] }));
    await newer;
    resolveBroad(response(200, { data: [catalogRow(), catalogRow({ id: 'google/veo-3.1' })] }));
    await older;

    expect(catalog.listModels()).toEqual(['google/veo-3.1']);
    expect(catalog.getModelSpec('bytedance/seedance-2.0')).toBeNull();
  });

  it('invalidates prior authority while a newer catalog refresh is pending', async () => {
    let resolveRefresh!: (value: ProviderHttpResponse) => void;
    const pendingResponse = new Promise<ProviderHttpResponse>((resolve) => {
      resolveRefresh = resolve;
    });
    let call = 0;
    const catalog = createOpenRouterVideoCatalog({
      fetch: async () => (call++ === 0 ? response(200, { data: [catalogRow()] }) : pendingResponse),
    });
    await catalog.refresh(provider(), new AbortController().signal);
    const pending = catalog.refresh(provider(), new AbortController().signal);
    const paidFetch = vi.fn(async () => response(202, { id: 'must_not_submit', status: 'pending' }));
    const adapter = createOpenRouterVideoAdapter({ fetch: paidFetch, catalog });

    expect(catalog.getModelSpec('bytedance/seedance-2.0')).toBeNull();
    expect(adapter.validateRequest(request, provider())).toEqual({
      ok: false,
      issues: [{ code: 'provider_unavailable' }],
    });
    await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'unsupported',
    });
    expect(paidFetch).not.toHaveBeenCalled();

    resolveRefresh(response(200, { data: [catalogRow({ id: 'google/veo-3.1' })] }));
    await pending;
  });

  it('rejects duplicate model identities instead of choosing one provider-controlled row', async () => {
    const catalog = createOpenRouterVideoCatalog({
      fetch: async () =>
        response(200, {
          data: [catalogRow(), catalogRow({ supported_durations: [4, 6, 8] })],
        }),
    });

    await expect(catalog.refresh(provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    expect(catalog.listModels()).toEqual([]);
  });

  it.each([
    Array.from({ length: 257 }, () => catalogRow()),
    Object.assign([catalogRow(), catalogRow({ id: 'google/veo-3.1' })], { 0: undefined }),
  ])('rejects oversized or sparse catalog arrays %#', async (data) => {
    const catalog = createOpenRouterVideoCatalog({ fetch: async () => response(200, { data }) });

    await expect(catalog.refresh(provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('enforces discrete catalog durations instead of admitting every value between min and max', async () => {
    const catalog = await admittedCatalog([catalogRow({ id: 'google/veo-3.1', supported_durations: [4, 6, 8] })]);
    const adapter = createOpenRouterVideoAdapter({ catalog });
    const veo = provider({ use_model: 'google/veo-3.1' });

    const veoRequest = {
      ...request,
      routeConstraints: {
        ...request.routeConstraints,
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportedDurationSeconds: [4, 6, 8],
        supportsFirstFrame: false,
      },
    };
    expect(adapter.validateRequest({ ...veoRequest, durationSeconds: 6 }, veo)).toMatchObject({ ok: true });
    expect(adapter.validateRequest({ ...veoRequest, durationSeconds: 5 }, veo)).toEqual({
      ok: false,
      issues: [{ code: 'invalid_duration' }],
    });
  });

  it('keeps catalog first-frame claims behind the managed-input evidence gate', async () => {
    const catalog = await admittedCatalog([
      catalogRow({ id: 'google/veo-3.1', supported_frame_images: ['first_frame'] }),
    ]);
    const adapter = createOpenRouterVideoAdapter({ catalog });

    expect(
      adapter.validateRequest(
        {
          ...request,
          routeConstraints: { ...request.routeConstraints, supportsFirstFrame: false },
          firstFrame: firstFrame(),
        },
        provider({ use_model: 'google/veo-3.1' })
      )
    ).toEqual({ ok: false, issues: [{ code: 'invalid_reference' }] });
  });

  it('polls a paid job after the discovery catalog has been cleared', async () => {
    let catalogPayload: unknown = { data: [catalogRow({ id: 'openai/sora-2-pro' })] };
    const catalog = createOpenRouterVideoCatalog({ fetch: async () => response(200, catalogPayload) });
    await catalog.refresh(provider(), new AbortController().signal);
    catalogPayload = { data: [] };
    await catalog.refresh(provider(), new AbortController().signal).catch(() => undefined);
    const fetch = vi.fn(async () =>
      response(200, {
        status: 'completed',
        unsigned_urls: ['https://openrouter.ai/api/v1/videos/job_paid/content?index=0'],
      })
    );
    const adapter = createOpenRouterVideoAdapter({ fetch, catalog });

    await expect(
      adapter.poll?.('job_paid', provider({ use_model: 'openai/sora-2-pro' }), new AbortController().signal)
    ).resolves.toMatchObject({ status: 'succeeded' });
    expect(fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/videos/job_paid',
      expect.objectContaining({ method: 'GET' })
    );
  });

  it('refuses a paid submit when the refreshed catalog shrinks below durable route authority', async () => {
    let catalogPayload: unknown = {
      data: [catalogRow({ id: 'google/veo-3.1', supported_durations: [4, 6, 8] })],
    };
    const catalog = createOpenRouterVideoCatalog({ fetch: async () => response(200, catalogPayload) });
    await catalog.refresh(provider(), new AbortController().signal);
    const submit = vi.fn(async () => response(202, { id: 'must_not_submit', status: 'pending' }));
    const adapter = createOpenRouterVideoAdapter({ fetch: submit, catalog });
    const veoRequest = {
      ...request,
      durationSeconds: 6,
      routeConstraints: {
        ...request.routeConstraints,
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportedDurationSeconds: [4, 6, 8],
        supportsFirstFrame: false,
      },
    };
    catalogPayload = {
      data: [catalogRow({ id: 'google/veo-3.1', supported_durations: [4, 8] })],
    };
    await catalog.refresh(provider(), new AbortController().signal);

    expect(adapter.validateRequest(veoRequest, provider({ use_model: 'google/veo-3.1' }))).toEqual({
      ok: false,
      issues: [{ code: 'provider_unavailable' }],
    });
    await expect(
      adapter.submit(veoRequest, provider({ use_model: 'google/veo-3.1' }), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(submit).not.toHaveBeenCalled();
  });

  it('re-proves the catalog after materializing a first frame and before the paid POST', async () => {
    let catalogPayload: unknown = { data: [catalogRow()] };
    const catalog = createOpenRouterVideoCatalog({ fetch: async () => response(200, catalogPayload) });
    await catalog.refresh(provider(), new AbortController().signal);
    let releaseFrame!: (value: string) => void;
    const frameReady = new Promise<string>((resolve) => {
      releaseFrame = resolve;
    });
    const asDataUrl = vi.fn(async () => frameReady);
    const paidFetch = vi.fn(async () => response(202, { id: 'must_not_submit', status: 'pending' }));
    const adapter = createOpenRouterVideoAdapter({ fetch: paidFetch, catalog });
    const submission = adapter.submit(
      { ...request, firstFrame: firstFrame(asDataUrl) },
      provider(),
      new AbortController().signal
    );
    await vi.waitFor(() => expect(asDataUrl).toHaveBeenCalledOnce());
    catalogPayload = { data: [catalogRow({ id: 'google/veo-3.1' })] };
    await catalog.refresh(provider(), new AbortController().signal);
    releaseFrame('data:image/png;base64,QUJD');

    await expect(submission).rejects.toMatchObject({ code: 'unsupported' });
    expect(paidFetch).not.toHaveBeenCalled();
  });

  it('intersects the provider catalog with Studio-safe resolution and ratio values', async () => {
    const catalog = await admittedCatalog([
      catalogRow({
        id: 'bytedance/seedance-2.5',
        supported_resolutions: ['480p', '720p'],
        supported_aspect_ratios: ['21:9', '16:9', '4:3'],
        supported_durations: [4, 5, 6],
      }),
    ]);

    expect(catalog.getModelSpec('bytedance/seedance-2.5')).toEqual({
      durations: [4, 5, 6],
      minDuration: 4,
      maxDuration: 6,
      resolutions: ['720p'],
      ratios: ['16:9', '4:3'],
      supportsAudio: true,
      supportsFirstFrame: false,
    });
  });
});
