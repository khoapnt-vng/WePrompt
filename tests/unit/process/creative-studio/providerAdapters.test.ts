/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TProviderWithModel } from '@/common/config/storage';
import {
  createBytePlusSeedanceAdapter,
  createGenerationProviderAdapterRegistry,
  createImageGenerationAdapter,
  createMediaGatewayAdapter,
  createOpenRouterVideoAdapter,
  isValidProviderJobId,
  type GenerationProviderAdapter,
  type ProviderHttpResponse,
  type ResolvedProviderInput,
  type ResolvedStudioGenerationRequest,
} from '@process/services/creative-studio/adapters';
import {
  createStudioE2EFakeBundle,
  createStudioE2EFakeRemoteState,
} from '@process/services/creative-studio/adapters/e2eFakeAdapter';

const REFERENCE_BUDGET_BYTES = 30 * 1024 * 1024;
const temporaryDirectories: string[] = [];

const provider = (overrides: Partial<TProviderWithModel> = {}): TProviderWithModel => ({
  id: 'provider_1',
  name: 'Provider One',
  platform: 'openai',
  base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
  api_key: 'secret-key',
  use_model: 'seedance-1-5-pro-251215',
  ...overrides,
});

const imageProvider = (overrides: Partial<TProviderWithModel> = {}): TProviderWithModel =>
  provider({
    platform: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com',
    use_model: 'gemini-2.5-flash-image',
    ...overrides,
  });

const request = {
  prompt: 'A lantern rises over a quiet harbor',
  mediaKind: 'video' as const,
  aspectRatio: '16:9' as const,
  resolution: '720p' as const,
  durationSeconds: 6,
  idempotencyKey: 'request_1',
};

const response = (status: number, body: unknown, rejectJson = false): ProviderHttpResponse => ({
  status,
  json: async () => {
    if (rejectJson) throw new SyntaxError('empty body');
    return body;
  },
});

const firstFrame = (): ResolvedProviderInput => ({
  assetId: 'asset_1',
  mimeType: 'image/png',
  byteSize: 3,
  openStream: async () => {
    throw new Error('not used by adapters');
  },
  asDataUrl: async () => 'data:image/png;base64,QUJD',
});

const conditioningInput = (index: number, byteSize = 3): ResolvedProviderInput => ({
  assetId: `asset_${index}`,
  mimeType: 'image/png',
  byteSize,
  openStream: async () => {
    throw new Error('not used by adapters');
  },
  asDataUrl: vi.fn(async () => `data:image/png;base64,REF_${index}`),
});

const successfulImageEngine = () =>
  vi.fn(async () => ({
    success: true,
    text: 'saved',
    imagePath: '/private/studio/image.png',
  }));

const createConditioningAdapter = (executeImageGeneration = successfulImageEngine(), currentSafetyLimit = 6) => ({
  adapter: createImageGenerationAdapter({
    executeImageGeneration,
    workspaceDir: '/private/studio',
    getMaxConditioningImages: () => currentSafetyLimit,
  }),
  executeImageGeneration,
});

type VideoAdapterFixture = {
  adapter: GenerationProviderAdapter;
  provider: TProviderWithModel;
  providerCall: ReturnType<typeof vi.fn>;
};

const videoAdapterFixtures: ReadonlyArray<{
  label: string;
  create: () => VideoAdapterFixture;
}> = [
  {
    label: 'BytePlus',
    create: () => {
      const fetch = vi.fn();
      return { adapter: createBytePlusSeedanceAdapter({ fetch }), provider: provider(), providerCall: fetch };
    },
  },
  {
    label: 'OpenRouter',
    create: () => {
      const fetch = vi.fn();
      return {
        adapter: createOpenRouterVideoAdapter({ fetch }),
        provider: provider({
          base_url: 'https://openrouter.ai/api/v1',
          use_model: 'bytedance/seedance-2.0',
        }),
        providerCall: fetch,
      };
    },
  },
  {
    label: 'media gateway',
    create: () => {
      const fetch = vi.fn();
      return {
        adapter: createMediaGatewayAdapter({ fetch }),
        provider: provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        providerCall: fetch,
      };
    },
  },
];

const videoConditioningFields: ReadonlyArray<{
  label: string;
  fields: Partial<ResolvedStudioGenerationRequest>;
}> = [
  { label: 'conditioningImages only', fields: { conditioningImages: [] } },
  { label: 'conditioningImageLimit only', fields: { conditioningImageLimit: 0 } },
  { label: 'both conditioning fields', fields: { conditioningImages: [], conditioningImageLimit: 0 } },
];

const videoConditioningVariants = videoConditioningFields.flatMap(({ label, fields }) => [
  { label, fields, firstFrameLabel: 'without a first frame', includeFirstFrame: false },
  { label, fields, firstFrameLabel: 'with a first frame', includeFirstFrame: true },
]);

const videoConditioningCases = videoAdapterFixtures.flatMap((adapterFixture) =>
  videoConditioningVariants.map((conditioningCase) => ({
    adapterLabel: adapterFixture.label,
    create: adapterFixture.create,
    conditioningLabel: conditioningCase.label,
    fields: conditioningCase.fields,
    firstFrameLabel: conditioningCase.firstFrameLabel,
    includeFirstFrame: conditioningCase.includeFirstFrame,
  }))
);

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { force: true, recursive: true }))
  );
});

describe('Creative Studio provider adapters', () => {
  it('registers the OpenRouter video adapter in the production registry', () => {
    const registry = createGenerationProviderAdapterRegistry({ image: { workspaceDir: '/private/studio' } });

    expect(registry.get('openrouter-video-v1')?.id).toBe('openrouter-video-v1');
  });

  it.each(videoConditioningCases)(
    'rejects $conditioningLabel $firstFrameLabel on $adapterLabel video before input resolution or provider calls',
    async ({ create, fields, includeFirstFrame }) => {
      const { adapter, provider: selectedProvider, providerCall } = create();
      const asDataUrl = vi.fn(async () => 'data:image/png;base64,QUJD');
      const frame = { ...firstFrame(), asDataUrl };
      const resolvedRequest: ResolvedStudioGenerationRequest = {
        ...request,
        ...(includeFirstFrame ? { firstFrame: frame } : {}),
        ...fields,
      };

      expect(adapter.validateRequest({ ...request, firstFrame: frame }, selectedProvider)).toMatchObject({ ok: true });
      expect(adapter.validateRequest(resolvedRequest, selectedProvider)).toEqual({
        ok: false,
        issues: [{ code: 'provider_unavailable' }],
      });
      await expect(
        adapter.submit(resolvedRequest, selectedProvider, new AbortController().signal)
      ).rejects.toMatchObject({ code: 'unsupported' });
      expect(asDataUrl).not.toHaveBeenCalled();
      expect(providerCall).not.toHaveBeenCalled();
    }
  );

  it.each([0, 1, 6])('passes %i ordered conditioning images to the image engine', async (count) => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();
    const conditioningImages = Array.from({ length: count }, (_, index) => conditioningInput(index + 1));

    const result = await adapter.submit(
      { ...request, mediaKind: 'image', conditioningImages, conditioningImageLimit: 6 },
      imageProvider(),
      new AbortController().signal
    );

    expect(result).toEqual({
      kind: 'complete',
      outputs: [
        {
          mediaKind: 'image',
          role: 'primary',
          source: { kind: 'file', path: '/private/studio/image.png' },
          mimeType: 'image/png',
        },
      ],
    });
    expect(executeImageGeneration).toHaveBeenCalledWith(
      {
        prompt: request.prompt,
        image_uris: conditioningImages.map((_, index) => `data:image/png;base64,REF_${index + 1}`),
      },
      expect.any(Object),
      '/private/studio',
      undefined,
      expect.any(AbortSignal),
      { hostedImageDownloader: expect.any(Function) }
    );
    expect(conditioningImages.map((input) => vi.mocked(input.asDataUrl).mock.calls)).toEqual(
      conditioningImages.map(() => [[REFERENCE_BUDGET_BYTES]])
    );
  });

  it('accepts an aggregate conditioning size of exactly 30 MiB', async () => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();
    const conditioningImages = [conditioningInput(1, REFERENCE_BUDGET_BYTES - 1), conditioningInput(2, 1)];

    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', conditioningImages, conditioningImageLimit: 6 },
        imageProvider(),
        new AbortController().signal
      )
    ).resolves.toMatchObject({ kind: 'complete' });
    expect(executeImageGeneration).toHaveBeenCalledOnce();
  });

  it('sanitizes a managed-input resolution failure before calling the image engine', async () => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();
    const input = conditioningInput(1);
    vi.mocked(input.asDataUrl).mockRejectedValue(new Error('secret path and data URL'));

    const submitted = adapter.submit(
      { ...request, mediaKind: 'image', conditioningImages: [input], conditioningImageLimit: 6 },
      imageProvider(),
      new AbortController().signal
    );

    await expect(submitted).rejects.toMatchObject({ code: 'unsupported', message: 'unsupported' });
    await expect(submitted).rejects.not.toThrow('secret path and data URL');
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: 'seven inputs',
      conditioningImages: Array.from({ length: 7 }, (_, index) => conditioningInput(index + 1)),
      conditioningImageLimit: 6,
      currentSafetyLimit: 6,
    },
    {
      label: 'count above the frozen limit',
      conditioningImages: [conditioningInput(1), conditioningInput(2)],
      conditioningImageLimit: 1,
      currentSafetyLimit: 6,
    },
    {
      label: 'frozen limit above six',
      conditioningImages: [conditioningInput(1)],
      conditioningImageLimit: 7,
      currentSafetyLimit: 6,
    },
    {
      label: 'current safety below the frozen limit',
      conditioningImages: [conditioningInput(1)],
      conditioningImageLimit: 6,
      currentSafetyLimit: 5,
    },
    {
      label: 'aggregate bytes above 30 MiB',
      conditioningImages: [conditioningInput(1, REFERENCE_BUDGET_BYTES), conditioningInput(2, 1)],
      conditioningImageLimit: 6,
      currentSafetyLimit: 6,
    },
  ])('rejects $label before resolving or calling the image engine', async (testCase) => {
    const { adapter, executeImageGeneration } = createConditioningAdapter(undefined, testCase.currentSafetyLimit);

    await expect(
      adapter.submit(
        {
          ...request,
          mediaKind: 'image',
          conditioningImages: testCase.conditioningImages,
          conditioningImageLimit: testCase.conditioningImageLimit,
        },
        imageProvider(),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(testCase.conditioningImages.every((input) => vi.mocked(input.asDataUrl).mock.calls.length === 0)).toBe(true);
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('rejects a stale frozen conditioning limit through validation before submission', () => {
    const { adapter, executeImageGeneration } = createConditioningAdapter(undefined, 5);
    const conditioningImages = [conditioningInput(1)];

    expect(
      adapter.validateRequest(
        { ...request, mediaKind: 'image', conditioningImages, conditioningImageLimit: 6 },
        imageProvider()
      )
    ).toEqual({ ok: false, issues: [{ code: 'provider_unavailable' }] });
    expect(conditioningImages.every((input) => vi.mocked(input.asDataUrl).mock.calls.length === 0)).toBe(true);
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid conditioning byte size %s before resolving or calling the image engine',
    async (byteSize) => {
      const { adapter, executeImageGeneration } = createConditioningAdapter();
      const input = conditioningInput(1, byteSize);

      await expect(
        adapter.submit(
          { ...request, mediaKind: 'image', conditioningImages: [input], conditioningImageLimit: 6 },
          imageProvider(),
          new AbortController().signal
        )
      ).rejects.toMatchObject({ code: 'unsupported' });
      expect(input.asDataUrl).not.toHaveBeenCalled();
      expect(executeImageGeneration).not.toHaveBeenCalled();
    }
  );

  it.each([
    { label: 'images without a frozen limit', conditioningImages: [conditioningInput(1)] },
    { label: 'a frozen limit without images', conditioningImageLimit: 6 },
    {
      label: 'conditioning mixed with a first frame',
      conditioningImages: [conditioningInput(1)],
      conditioningImageLimit: 6,
      firstFrame: firstFrame(),
    },
  ])('rejects $label before resolving or calling the image engine', async (invalidInput) => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();

    await expect(
      adapter.submit({ ...request, mediaKind: 'image', ...invalidInput }, imageProvider(), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'unsupported' });
    for (const input of invalidInput.conditioningImages ?? []) expect(input.asDataUrl).not.toHaveBeenCalled();
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('accepts a legacy image first-frame-only request at the pre-persistence validation seam', () => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();
    const input = conditioningInput(1);

    expect(adapter.validateRequest({ ...request, mediaKind: 'image', firstFrame: input }, imageProvider())).toEqual({
      ok: true,
      normalized: {
        aspectRatio: request.aspectRatio,
        resolution: request.resolution,
        durationSeconds: request.durationSeconds,
      },
    });
    expect(input.asDataUrl).not.toHaveBeenCalled();
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('forwards a legacy image first frame as exactly one bounded image URI', async () => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();
    const input = conditioningInput(1);

    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', firstFrame: input },
        imageProvider(),
        new AbortController().signal
      )
    ).resolves.toMatchObject({ kind: 'complete' });
    expect(executeImageGeneration).toHaveBeenCalledWith(
      {
        prompt: request.prompt,
        image_uris: ['data:image/png;base64,REF_1'],
      },
      expect.any(Object),
      '/private/studio',
      undefined,
      expect.any(AbortSignal),
      { hostedImageDownloader: expect.any(Function) }
    );
    expect(input.asDataUrl).toHaveBeenCalledWith(REFERENCE_BUDGET_BYTES);
  });

  it('rejects conditioning on an Images-API route before resolving or calling the image engine', async () => {
    const { adapter, executeImageGeneration } = createConditioningAdapter();
    const input = conditioningInput(1);

    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', conditioningImages: [input], conditioningImageLimit: 6 },
        imageProvider({ platform: 'openai', base_url: 'https://api.vngcloud.vn/v1', use_model: 'gpt-image-1' }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(input.asDataUrl).not.toHaveBeenCalled();
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('keeps ordinary image validation at zero even when production configuration spoofs the fake tuple', async () => {
    const executeImageGeneration = successfulImageEngine();
    const adapter = createImageGenerationAdapter({ executeImageGeneration, workspaceDir: '/private/studio' });
    const spoofed = imageProvider({
      id: 'weprompt_studio_e2e',
      name: 'WePrompt Studio E2E',
      use_model: 'weprompt-e2e-image',
    });

    await expect(
      adapter.validateConnection({ model: spoofed.use_model }, spoofed, new AbortController().signal)
    ).resolves.toEqual({ ok: true, capabilities: { maxConditioningImages: 0 } });
    const input = conditioningInput(1);
    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', conditioningImages: [input], conditioningImageLimit: 6 },
        spoofed,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(input.asDataUrl).not.toHaveBeenCalled();
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('rejects an over-limit resolved request through trusted fake validation', async () => {
    const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'weprompt-fake-adapter-'));
    temporaryDirectories.push(rootDir);
    const remoteState = createStudioE2EFakeRemoteState();
    const bundle = createStudioE2EFakeBundle({ rootDir, remoteState });
    const adapter = bundle.adapters.get('weprompt-image-v1');
    const fakeProvider = { ...bundle.provider, use_model: 'weprompt-e2e-image' } as TProviderWithModel;
    if (!adapter) throw new Error('expected fake image adapter');

    const overLimit = Array.from({ length: 7 }, (_, index) => conditioningInput(index + 1));
    expect(
      adapter.validateRequest(
        { ...request, mediaKind: 'image', conditioningImages: overLimit, conditioningImageLimit: 6 },
        fakeProvider
      )
    ).toEqual({ ok: false, issues: [{ code: 'provider_unavailable' }] });
    expect(remoteState.taskCounter).toBe(0);
  });

  it('enforces the trusted fake image limit before creating a provider task', async () => {
    const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'weprompt-fake-adapter-'));
    temporaryDirectories.push(rootDir);
    const remoteState = createStudioE2EFakeRemoteState();
    const bundle = createStudioE2EFakeBundle({ rootDir, remoteState });
    const adapter = bundle.adapters.get('weprompt-image-v1');
    const fakeProvider = { ...bundle.provider, use_model: 'weprompt-e2e-image' } as TProviderWithModel;
    if (!adapter) throw new Error('expected fake image adapter');

    const six = Array.from({ length: 6 }, (_, index) => conditioningInput(index + 1));
    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', conditioningImages: six, conditioningImageLimit: 6 },
        fakeProvider,
        new AbortController().signal
      )
    ).resolves.toMatchObject({ kind: 'remote' });
    expect(remoteState.taskCounter).toBe(1);

    const seven = Array.from({ length: 7 }, (_, index) => conditioningInput(index + 1));
    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', conditioningImages: seven, conditioningImageLimit: 6 },
        fakeProvider,
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(remoteState.taskCounter).toBe(1);
  });

  it.each(videoConditioningVariants)(
    'rejects $label $firstFrameLabel on trusted fake video before input resolution or task creation',
    async ({ fields, includeFirstFrame }) => {
      const rootDir = await fs.mkdtemp(path.join(tmpdir(), 'weprompt-fake-adapter-'));
      temporaryDirectories.push(rootDir);
      const remoteState = createStudioE2EFakeRemoteState();
      const bundle = createStudioE2EFakeBundle({ rootDir, remoteState });
      const adapter = bundle.adapters.get('weprompt-media-gateway-v1');
      const fakeProvider = { ...bundle.provider, use_model: 'weprompt-e2e-video' } as TProviderWithModel;
      const asDataUrl = vi.fn(async () => 'data:image/png;base64,QUJD');
      const frame = { ...firstFrame(), asDataUrl };
      const resolvedRequest: ResolvedStudioGenerationRequest = {
        ...request,
        ...(includeFirstFrame ? { firstFrame: frame } : {}),
        ...fields,
      };
      if (!adapter) throw new Error('expected fake video adapter');

      expect(adapter.validateRequest({ ...request, firstFrame: frame }, fakeProvider)).toMatchObject({ ok: true });
      expect(adapter.validateRequest(resolvedRequest, fakeProvider)).toEqual({
        ok: false,
        issues: [{ code: 'provider_unavailable' }],
      });
      await expect(adapter.submit(resolvedRequest, fakeProvider, new AbortController().signal)).rejects.toMatchObject({
        code: 'unsupported',
      });
      expect(asDataUrl).not.toHaveBeenCalled();
      expect(remoteState.taskCounter).toBe(0);
    }
  );

  it('rejects an image-engine path whose extension cannot provide a declared managed MIME type', async () => {
    const adapter = createImageGenerationAdapter({
      executeImageGeneration: async () => ({
        success: true,
        text: 'saved',
        imagePath: '/private/studio/image.gif',
      }),
      workspaceDir: '/private/studio',
    });

    await expect(
      adapter.submit({ ...request, mediaKind: 'image' }, imageProvider(), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'no_output' });
  });

  it('rejects first-frame input for images-API models before calling the image engine', async () => {
    const executeImageGeneration = vi.fn();
    const adapter = createImageGenerationAdapter({ executeImageGeneration, workspaceDir: '/private/studio' });

    await expect(
      adapter.submit(
        { ...request, mediaKind: 'image', firstFrame: firstFrame() },
        imageProvider({
          platform: 'openai',
          base_url: 'https://api.vngcloud.vn/v1',
          use_model: 'gpt-image-1',
        }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('preserves an injected hosted-image downloader in the Studio image path', async () => {
    const hostedImageDownloader = vi.fn(async () => undefined);
    const executeImageGeneration = vi.fn(async () => ({
      success: true,
      text: 'saved',
      imagePath: '/private/image.png',
    }));
    const adapter = createImageGenerationAdapter({
      executeImageGeneration,
      workspaceDir: '/private/studio',
      hostedImageDownloader,
    });

    await adapter.submit({ ...request, mediaKind: 'image' }, imageProvider(), new AbortController().signal);

    expect(executeImageGeneration.mock.calls[0]?.[5]).toEqual({ hostedImageDownloader });
  });

  it('maps an image response with no output to a typed no_output error', async () => {
    const adapter = createImageGenerationAdapter({
      executeImageGeneration: async () => ({ success: false, text: 'none', error: 'no_output' }),
      workspaceDir: '/private/studio',
    });

    await expect(
      adapter.submit({ ...request, mediaKind: 'image' }, imageProvider(), new AbortController().signal)
    ).rejects.toMatchObject({
      code: 'no_output',
    });
  });

  it('rejects an arbitrary text model at image connection and paid-request validation boundaries', async () => {
    const executeImageGeneration = vi.fn();
    const adapter = createImageGenerationAdapter({ executeImageGeneration, workspaceDir: '/private/studio' });
    const textProvider = imageProvider({ use_model: 'gemini-2.5-pro' });

    await expect(
      adapter.validateConnection({ model: textProvider.use_model }, textProvider, new AbortController().signal)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
    expect(adapter.validateRequest({ ...request, mediaKind: 'image' }, textProvider)).toEqual({
      ok: false,
      issues: [{ code: 'provider_unavailable' }],
    });
    await expect(
      adapter.submit({ ...request, mediaKind: 'image' }, textProvider, new AbortController().signal)
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(executeImageGeneration).not.toHaveBeenCalled();
  });

  it('sends Seedance 1.5 Pro silent output and one bounded first-frame data URL', async () => {
    const fetch = vi.fn(async () => response(200, { id: 'remote_1', status: 'queued' }));
    const adapter = createBytePlusSeedanceAdapter({ fetch });

    const result = await adapter.submit(
      { ...request, firstFrame: firstFrame() },
      provider(),
      new AbortController().signal
    );

    expect(result).toEqual({ kind: 'remote', providerJobId: 'remote_1' });
    expect(fetch).toHaveBeenCalledWith(
      'https://ark.ap-southeast.bytepluses.com/api/v3/contents/generations/tasks',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
        body: expect.stringContaining('generate_audio'),
      })
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: 'seedance-1-5-pro-251215',
      ratio: '16:9',
      duration: 6,
      resolution: '720p',
      watermark: false,
      return_last_frame: true,
      generate_audio: false,
      content: [
        { type: 'text', text: request.prompt },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' }, role: 'first_frame' },
      ],
    });
  });

  it('omits the unsupported audio setting for Seedance 1.0', async () => {
    const fetch = vi.fn(async () => response(200, { id: 'remote_1', status: 'queued' }));
    const adapter = createBytePlusSeedanceAdapter({ fetch });

    await adapter.submit(
      { ...request, durationSeconds: 2 },
      provider({ use_model: 'seedance-1-0-pro-250528' }),
      new AbortController().signal
    );

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).not.toHaveProperty('generate_audio');
  });

  it('supports the Seedance 2.0 silent request boundary and rejects its intelligent duration', async () => {
    const fetch = vi.fn(async () => response(200, { id: 'remote_2', status: 'queued' }));
    const adapter = createBytePlusSeedanceAdapter({ fetch });
    const seedance2 = provider({ use_model: 'dreamina-seedance-2-0-260128' });

    await adapter.submit(
      { ...request, durationSeconds: 15, resolution: '1080p', aspectRatio: '4:3' },
      seedance2,
      new AbortController().signal
    );
    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      duration: 15,
      resolution: '1080p',
      ratio: '4:3',
      generate_audio: false,
    });
    expect(adapter.validateRequest({ ...request, durationSeconds: -1 }, seedance2)).toMatchObject({ ok: false });
  });

  it('accepts only the exact BytePlus host, root path and official model IDs', () => {
    const adapter = createBytePlusSeedanceAdapter();
    const supported = adapter.validateRequest(request, provider({ use_model: 'dreamina-seedance-2-0-260128' }));
    const lookalikeHost = adapter.validateRequest(
      request,
      provider({ base_url: 'https://ark.ap-southeast.bytepluses.com.evil.test/api/v3' })
    );
    const extraPath = adapter.validateRequest(
      request,
      provider({ base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3/extra' })
    );
    const extraPort = adapter.validateRequest(
      request,
      provider({ base_url: 'https://ark.ap-southeast.bytepluses.com:444/api/v3' })
    );
    const lookalikeModel = adapter.validateRequest(request, provider({ use_model: 'dreamina-seedance-2-0' }));

    expect(supported).toMatchObject({ ok: true });
    expect([lookalikeHost, extraPath, extraPort, lookalikeModel]).toEqual([
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
      expect.objectContaining({ ok: false }),
    ]);
  });

  it('accepts only bounded URL-unreserved opaque remote job IDs', () => {
    expect(['remote-job_1', '01K4ZP.task~2'].map(isValidProviderJobId)).toEqual([true, true]);
    expect(
      [
        '',
        '.',
        '..',
        '\ud800',
        'x'.repeat(513),
        'bad\u0000id',
        'bad\u007fid',
        'bad\u0085id',
        'https://provider.example/jobs/1',
        'job?id=1',
        'job&token=secret',
        'job#fragment',
        'job/path',
        String.raw`job\path`,
        'job%2Fpath',
        'job with spaces',
      ].map(isValidProviderJobId)
    ).toEqual(Array.from({ length: 16 }, () => false));
  });

  it('rejects unsafe job path segments before either remote adapter can make a request', async () => {
    const seedanceFetch = vi.fn();
    const gatewayFetch = vi.fn();
    const seedance = createBytePlusSeedanceAdapter({ fetch: seedanceFetch });
    const gateway = createMediaGatewayAdapter({ fetch: gatewayFetch });

    await expect(seedance.poll?.('..', provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
    await expect(
      gateway.cancel?.(
        '\ud800',
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'invalid_response' });
    expect(seedanceFetch).not.toHaveBeenCalled();
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('rechecks gateway origin and credentials before poll or cancel requests', async () => {
    const fetch = vi.fn();
    const adapter = createMediaGatewayAdapter({ fetch });
    const signal = new AbortController().signal;

    await expect(
      adapter.poll?.('gateway_1', provider({ base_url: 'ftp://gateway.example' }), signal)
    ).rejects.toMatchObject({ code: 'unsupported' });
    await expect(
      adapter.poll?.('gateway_1', provider({ base_url: 'http://gateway.internal:8080' }), signal)
    ).rejects.toMatchObject({ code: 'unsupported' });
    await expect(
      adapter.cancel?.('gateway_1', provider({ base_url: 'https://gateway.example', api_key: '' }), signal)
    ).rejects.toMatchObject({ code: 'auth' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://gateway.example',
    'http://gateway.internal:8080',
    'http://localhost:8080',
    'http://0.0.0.0:8080',
    'http://8.8.8.8:8080',
    'http://11.0.0.1:8080',
    'http://100.64.0.1:8080',
    'http://127.0.0.2:8080',
    'http://169.254.169.254:8080',
    'http://172.15.255.255:8080',
    'http://172.32.0.0:8080',
    'http://192.167.255.255:8080',
    'http://192.169.0.0:8080',
    'http://[fc00::1]:8080',
    'http://[fe80::1]:8080',
    'http://[2001:4860:4860::8888]:8080',
  ])('rejects bearer gateway calls over untrusted HTTP at %s', async (baseUrl) => {
    const fetch = vi.fn();
    const adapter = createMediaGatewayAdapter({ fetch });
    const gateway = provider({ base_url: baseUrl, use_model: 'open-sora' });
    const signal = new AbortController().signal;

    expect(adapter.validateRequest(request, gateway)).toEqual({
      ok: false,
      issues: [{ code: 'provider_unavailable' }],
    });
    await expect(adapter.validateConnection({ model: 'open-sora' }, gateway, signal)).resolves.toEqual({
      ok: false,
      error: { code: 'unsupported' },
    });
    await expect(adapter.submit(request, gateway, signal)).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    'http://127.0.0.1:8080',
    'http://[::1]:8080',
    'http://10.0.0.1:8080',
    'http://10.255.255.254:8080',
    'http://172.16.0.1:8080',
    'http://172.31.255.254:8080',
    'http://192.168.0.1:8080',
    'http://192.168.255.254:8080',
  ])('allows an explicitly configured loopback or RFC1918 IP-literal HTTP gateway at %s', async (baseUrl) => {
    const fetch = vi.fn(async () => response(202, { id: 'gateway_1', status: 'queued' }));
    const adapter = createMediaGatewayAdapter({ fetch });
    const gateway = provider({ base_url: baseUrl, use_model: 'open-sora' });

    expect(adapter.validateRequest(request, gateway)).toMatchObject({ ok: true });
    await expect(adapter.submit(request, gateway, new AbortController().signal)).resolves.toEqual({
      kind: 'remote',
      providerJobId: 'gateway_1',
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('distinguishes unsupported provider configuration from missing credentials during validation', async () => {
    const signal = new AbortController().signal;
    const seedance = createBytePlusSeedanceAdapter();
    await expect(
      seedance.validateConnection(
        { model: 'seedance-1-5-pro-251215' },
        provider({ base_url: 'https://example.invalid/api/v3' }),
        signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
    await expect(
      seedance.validateConnection({ model: 'seedance-1-5-pro-251215' }, provider({ api_key: '' }), signal)
    ).resolves.toEqual({ ok: false, error: { code: 'auth' } });

    const gateway = createMediaGatewayAdapter();
    await expect(
      gateway.validateConnection(
        { model: 'open-sora' },
        provider({ base_url: 'file:///private/gateway', use_model: 'open-sora' }),
        signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
  });

  it('rejects unsupported Seedance duration while accepting the Studio ratio and resolution intersection', async () => {
    const fetch = vi.fn();
    const adapter = createBytePlusSeedanceAdapter({ fetch });

    expect(
      adapter.validateRequest(
        { ...request, durationSeconds: 1, resolution: '1080p' },
        provider({ use_model: 'seedance-1-0-pro-250528' })
      )
    ).toMatchObject({ ok: false });
    expect(
      adapter.validateRequest(
        { ...request, durationSeconds: 12, resolution: '1080p', aspectRatio: '3:4' },
        provider({ use_model: 'seedance-1-0-pro-250528' })
      )
    ).toMatchObject({ ok: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('advertises queued-only cancellation for Seedance because running tasks are refused', async () => {
    const adapter = createBytePlusSeedanceAdapter({ fetch: async () => response(200, {}) });

    await expect(
      adapter.validateConnection({ model: 'seedance-1-5-pro-251215' }, provider(), new AbortController().signal)
    ).resolves.toMatchObject({
      ok: true,
      capabilities: { cancellationPolicy: 'queued_only', maxConditioningImages: 0 },
    });
  });

  it('maps BytePlus auth, rate-limit, and service failures without leaking response text', async () => {
    const statuses = [401, 429, 503] as const;
    await Promise.all(
      statuses.map(async (status) => {
        const adapter = createBytePlusSeedanceAdapter({
          fetch: async () => response(status, { message: 'secret detail' }),
        });
        await expect(adapter.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
          code: status === 401 ? 'auth' : status === 429 ? 'rate_limited' : 'provider_unavailable',
        });
      })
    );
  });

  it('maps a completed Seedance task with no output to no_output and rejects malformed task responses', async () => {
    const noOutput = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { status: 'succeeded', id: 'remote_1' }),
    });
    await expect(noOutput.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'no_output',
    });

    const malformed = createBytePlusSeedanceAdapter({ fetch: async () => response(200, { status: 'wat' }) });
    await expect(malformed.poll?.('remote_1', provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('rejects malformed Seedance job IDs and terminal submit responses even when they contain output URLs', async () => {
    const malformedId = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { id: `bad\u0000id`, status: 'queued' }),
    });
    await expect(malformedId.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });

    const failed = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          id: 'remote_1',
          status: 'failed',
          content: { video_url: 'https://cdn.example/must-not-win.mp4' },
        }),
    });
    await expect(failed.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'unknown',
    });

    const missingStatus = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { id: 'remote_1' }),
    });
    await expect(missingStatus.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps Seedance poll states and a transport timeout to stable results', async () => {
    const queued = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { id: 'remote_1', status: 'queued' }),
    });
    await expect(queued.poll?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'queued',
    });

    const running = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { id: 'remote_1', status: 'running' }),
    });
    await expect(running.poll?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'running',
    });

    const succeeded = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          id: 'remote_1',
          status: 'succeeded',
          content: { video_url: 'https://cdn.example/video.mp4' },
        }),
    });
    await expect(succeeded.poll?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
          mimeType: 'video/mp4',
        },
      ],
    });

    const timeout = createBytePlusSeedanceAdapter({
      fetch: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
    });
    await expect(timeout.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('parses the documented BytePlus video and last-frame output shape', async () => {
    const adapter = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          id: 'remote_1',
          status: 'succeeded',
          content: {
            video_url: 'https://cdn.example/video.mp4',
            last_frame_url: 'https://cdn.example/poster.png',
          },
        }),
    });

    await expect(adapter.poll?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
          mimeType: 'video/mp4',
        },
        {
          mediaKind: 'image',
          role: 'poster',
          source: { kind: 'url', url: 'https://cdn.example/poster.png' },
          mimeType: 'image/png',
        },
      ],
    });
  });

  it('requires a documented primary video instead of succeeding with only a poster or legacy output field', async () => {
    const posterOnly = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          id: 'remote_1',
          status: 'succeeded',
          content: { last_frame_url: 'https://cdn.example/poster.png' },
        }),
    });
    const legacyOutput = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          id: 'remote_1',
          status: 'succeeded',
          outputs: [{ url: 'https://cdn.example/video.mp4' }],
        }),
    });

    await expect(posterOnly.poll?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'failed',
      error: { code: 'no_output' },
    });
    await expect(legacyOutput.poll?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      status: 'failed',
      error: { code: 'no_output' },
    });
  });

  it('rejects credential-bearing and oversized BytePlus output URLs', async () => {
    const credentialBearing = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          status: 'succeeded',
          content: { video_url: 'https://user:password@cdn.example/video.mp4' },
        }),
    });
    await expect(credentialBearing.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'no_output',
    });

    const oversized = createBytePlusSeedanceAdapter({
      fetch: async () =>
        response(200, {
          status: 'succeeded',
          content: { video_url: `https://cdn.example/${'a'.repeat(16 * 1024)}.mp4` },
        }),
    });
    await expect(oversized.submit(request, provider(), new AbortController().signal)).rejects.toMatchObject({
      code: 'no_output',
    });
  });

  it('refuses running Seedance cancellation and cancels a queued task', async () => {
    const running = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { id: 'remote_1', status: 'running' }),
    });
    await expect(running.cancel?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      kind: 'refused',
      error: { code: 'cancellation_refused' },
    });

    const fetch = vi.fn(async (url: string, init: { method: string }) =>
      init.method === 'GET' ? response(200, { id: 'remote_1', status: 'queued' }) : response(204, undefined, true)
    );
    const queued = createBytePlusSeedanceAdapter({ fetch });
    await expect(queued.cancel?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      kind: 'cancelled',
    });
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: 'DELETE' });
  });

  it.each(['succeeded', 'failed', 'expired', 'running'] as const)(
    'truthfully refuses Seedance cancellation for a %s task',
    async (status) => {
      const adapter = createBytePlusSeedanceAdapter({
        fetch: async () =>
          response(200, {
            id: 'remote_1',
            status,
            ...(status === 'succeeded' ? { content: { video_url: 'https://cdn.example/video.mp4' } } : {}),
          }),
      });

      await expect(adapter.cancel?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
        kind: 'refused',
        error: { code: 'cancellation_refused' },
      });
    }
  );

  it('returns an idempotent cancelled result for an already-cancelled Seedance task', async () => {
    const adapter = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, { id: 'remote_1', status: 'cancelled' }),
    });
    await expect(adapter.cancel?.('remote_1', provider(), new AbortController().signal)).resolves.toEqual({
      kind: 'cancelled',
    });
  });

  it('uses gateway capabilities, synchronous output, silent audio and first-frame base64 shape', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          schema_version: 1,
          media_kinds: ['video'],
          models: ['open-sora'],
          video: {
            audio_modes: ['none'],
            aspect_ratios: ['16:9', '9:16'],
            resolutions: ['720p', '1080p'],
            min_duration_seconds: 2,
            max_duration_seconds: 30,
            supports_first_frame: true,
            cancellation_policy: 'queued_and_running',
            cancellation: false,
          },
        })
      )
      .mockResolvedValueOnce(
        response(200, {
          status: 'succeeded',
          outputs: [{ url: 'https://cdn.example/video.mp4', mime_type: 'video/mp4' }],
        })
      );
    const adapter = createMediaGatewayAdapter({ fetch });
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });

    await expect(
      adapter.validateConnection({ model: 'open-sora' }, gateway, new AbortController().signal)
    ).resolves.toEqual({
      ok: true,
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 2,
        maxDurationSeconds: 30,
        supportsFirstFrame: true,
        maxConditioningImages: 0,
        cancellationPolicy: 'queued_and_running',
      },
    });
    await expect(
      adapter.submit({ ...request, firstFrame: firstFrame() }, gateway, new AbortController().signal)
    ).resolves.toEqual({
      kind: 'complete',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
          mimeType: 'video/mp4',
        },
      ],
    });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({
      audio_mode: 'none',
      inputs: [{ role: 'first_frame', mime_type: 'image/png', data_base64: 'QUJD' }],
    });
  });

  it.each([
    { label: 'explicit none', video: { cancellation_policy: 'none', cancellation: true }, expected: 'none' },
    {
      label: 'explicit queued only',
      video: { cancellation_policy: 'queued_only', cancellation: false },
      expected: 'queued_only',
    },
    {
      label: 'explicit queued and running',
      video: { cancellation_policy: 'queued_and_running', cancellation: false },
      expected: 'queued_and_running',
    },
    { label: 'legacy true', video: { cancellation: true }, expected: 'queued_only' },
    { label: 'legacy false', video: { cancellation: false }, expected: 'none' },
    { label: 'missing', video: {}, expected: 'none' },
  ])('maps gateway cancellation policy from $label', async ({ video, expected }) => {
    const adapter = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          schema_version: 1,
          media_kinds: ['video'],
          models: ['open-sora'],
          video: {
            audio_modes: ['none'],
            aspect_ratios: ['16:9'],
            resolutions: ['720p'],
            min_duration_seconds: 2,
            max_duration_seconds: 12,
            ...video,
          },
        }),
    });

    await expect(
      adapter.validateConnection(
        { model: 'open-sora' },
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).resolves.toMatchObject({ ok: true, capabilities: { cancellationPolicy: expected } });
  });

  it.each(['submit', 'poll'] as const)('preserves a valid gateway byte_size on %s success', async (mode) => {
    const body = {
      status: 'succeeded',
      outputs: [{ url: 'https://cdn.example/video.mp4', mime_type: 'video/mp4', byte_size: 512 * 1024 * 1024 }],
    };
    const adapter = createMediaGatewayAdapter({ fetch: async () => response(200, body) });
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });

    const result =
      mode === 'submit'
        ? await adapter.submit(request, gateway, new AbortController().signal)
        : await adapter.poll?.('gateway_1', gateway, new AbortController().signal);

    expect(result).toMatchObject({
      outputs: [
        {
          source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
          byteSize: 512 * 1024 * 1024,
        },
      ],
    });
  });

  it.each(
    (['submit', 'poll'] as const).flatMap((mode) =>
      [undefined, 0, -1, 1.5, '524288', Number.MAX_SAFE_INTEGER + 1].map((byteSize) => [mode, byteSize] as const)
    )
  )('keeps a usable %s output when optional byte_size is %s', async (mode, byteSize) => {
    const body = {
      status: 'succeeded',
      outputs: [
        {
          url: 'https://cdn.example/video.mp4',
          mime_type: 'video/mp4',
          ...(byteSize === undefined ? {} : { byte_size: byteSize }),
        },
      ],
    };
    const adapter = createMediaGatewayAdapter({ fetch: async () => response(200, body) });
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });

    const result =
      mode === 'submit'
        ? await adapter.submit(request, gateway, new AbortController().signal)
        : await adapter.poll?.('gateway_1', gateway, new AbortController().signal);

    expect(result).toMatchObject({
      outputs: [
        {
          source: { kind: 'url', url: 'https://cdn.example/video.mp4' },
        },
      ],
    });
    expect(result?.outputs[0]).not.toHaveProperty('byteSize');
  });

  it('rejects redirects for every credentialed gateway operation', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          schema_version: 1,
          media_kinds: ['video'],
          models: ['open-sora'],
          video: {
            audio_modes: ['none'],
            aspect_ratios: ['16:9'],
            resolutions: ['720p'],
            min_duration_seconds: 2,
            max_duration_seconds: 12,
          },
        })
      )
      .mockResolvedValueOnce(response(202, { id: 'gateway_1', status: 'queued' }))
      .mockResolvedValueOnce(response(200, { id: 'gateway_1', status: 'running' }))
      .mockResolvedValueOnce(response(204, undefined, true));
    const adapter = createMediaGatewayAdapter({ fetch });
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });
    const signal = new AbortController().signal;

    await adapter.validateConnection({ model: 'open-sora' }, gateway, signal);
    await adapter.submit(request, gateway, signal);
    await adapter.poll?.('gateway_1', gateway, signal);
    await adapter.cancel?.('gateway_1', gateway, signal);

    expect(fetch.mock.calls.map(([, init]) => (init as { redirect?: string }).redirect)).toEqual([
      'error',
      'error',
      'error',
      'error',
    ]);
  });

  it('rejects a gateway that cannot produce silent video and maps an async job', async () => {
    const unsupported = createMediaGatewayAdapter({
      fetch: async () => response(200, { video: { audio_modes: ['stereo'] } }),
    });
    await expect(
      unsupported.validateConnection(
        { model: 'open-sora' },
        provider({ base_url: 'https://gateway.example' }),
        new AbortController().signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });

    const asyncAdapter = createMediaGatewayAdapter({
      fetch: async () => response(202, { id: 'gateway_1', status: 'queued' }),
    });
    await expect(
      asyncAdapter.submit(request, provider({ base_url: 'https://gateway.example' }), new AbortController().signal)
    ).resolves.toEqual({ kind: 'remote', providerJobId: 'gateway_1' });

    const missingStatus = createMediaGatewayAdapter({
      fetch: async () => response(202, { id: 'gateway_1' }),
    });
    await expect(
      missingStatus.submit(request, provider({ base_url: 'https://gateway.example' }), new AbortController().signal)
    ).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('rejects a succeeded gateway output without an explicit supported MIME type', async () => {
    const adapter = createMediaGatewayAdapter({
      fetch: async () => response(200, { status: 'succeeded', outputs: [{ url: 'https://cdn.example/video.mp4' }] }),
    });

    await expect(
      adapter.submit(
        request,
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'no_output' });
  });

  it('rejects gateway audio modes that do not explicitly advertise video support', async () => {
    const adapter = createMediaGatewayAdapter({
      fetch: async () => response(200, { audio_modes: ['none'] }),
    });

    await expect(
      adapter.validateConnection(
        { model: 'open-sora' },
        provider({ base_url: 'https://gateway.example' }),
        new AbortController().signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
  });

  it('requires versioned, bounded gateway capabilities for the requested model', async () => {
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });
    const missingVersion = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          media_kinds: ['video'],
          models: ['open-sora'],
          video: { audio_modes: ['none'] },
        }),
    });
    await expect(
      missingVersion.validateConnection({ model: 'open-sora' }, gateway, new AbortController().signal)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });

    const oversized = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          schema_version: 1,
          media_kinds: ['video'],
          models: Array.from({ length: 129 }, (_, index) => `model-${index}`),
          video: { audio_modes: ['none'] },
        }),
    });
    await expect(
      oversized.validateConnection({ model: 'open-sora' }, gateway, new AbortController().signal)
    ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
  });

  it('rejects missing or wrong-type gateway routing constraints instead of advertising broad defaults', async () => {
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });
    const valid = {
      schema_version: 1,
      media_kinds: ['video'],
      models: ['open-sora'],
      video: {
        audio_modes: ['none'],
        aspect_ratios: ['16:9'],
        resolutions: ['720p'],
        min_duration_seconds: 2,
        max_duration_seconds: 12,
      },
    };
    const malformed = [
      { ...valid, video: { ...valid.video, aspect_ratios: undefined } },
      { ...valid, video: { ...valid.video, resolutions: '720p' } },
      { ...valid, video: { ...valid.video, min_duration_seconds: undefined } },
      { ...valid, video: { ...valid.video, max_duration_seconds: '12' } },
      { ...valid, video: { ...valid.video, supports_first_frame: 'yes' } },
      { ...valid, video: { ...valid.video, cancellation: 1 } },
      { ...valid, video: { ...valid.video, cancellation_policy: true } },
      { ...valid, video: { ...valid.video, cancellation_policy: 'always', cancellation: true } },
    ];

    await Promise.all(
      malformed.map(async (body) => {
        const adapter = createMediaGatewayAdapter({ fetch: async () => response(200, body) });
        await expect(
          adapter.validateConnection({ model: 'open-sora' }, gateway, new AbortController().signal)
        ).resolves.toEqual({ ok: false, error: { code: 'unsupported' } });
      })
    );
  });

  it('polls and cancels gateway jobs without exposing their provider payload', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        response(200, {
          status: 'succeeded',
          outputs: [{ url: 'https://cdn.example/final.mp4', mime_type: 'video/mp4' }],
        })
      )
      .mockResolvedValueOnce(response(204, undefined, true));
    const adapter = createMediaGatewayAdapter({ fetch });
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });

    await expect(adapter.poll?.('gateway_1', gateway, new AbortController().signal)).resolves.toEqual({
      status: 'succeeded',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'url', url: 'https://cdn.example/final.mp4' },
          mimeType: 'video/mp4',
        },
      ],
    });
    await expect(adapter.cancel?.('gateway_1', gateway, new AbortController().signal)).resolves.toEqual({
      kind: 'cancelled',
    });
    expect(fetch.mock.calls[1]?.[0]).toBe('https://gateway.example/v1/generations/gateway_1/cancel');
  });

  it('preserves valid gateway progress and ignores invalid progress', async () => {
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });
    const running = createMediaGatewayAdapter({
      fetch: async () => response(200, { id: 'gateway_1', status: 'running', progress: 42 }),
    });
    await expect(running.poll?.('gateway_1', gateway, new AbortController().signal)).resolves.toEqual({
      status: 'running',
      progress: 42,
    });

    const invalidProgress = createMediaGatewayAdapter({
      fetch: async () => response(200, { id: 'gateway_1', status: 'queued', progress: 101 }),
    });
    await expect(invalidProgress.poll?.('gateway_1', gateway, new AbortController().signal)).resolves.toEqual({
      status: 'queued',
    });

    const synchronous = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          outputs: [{ url: 'https://gateway.example/output/video.mp4', mime_type: 'video/mp4' }],
        }),
    });
    await expect(synchronous.submit(request, gateway, new AbortController().signal)).resolves.toEqual({
      kind: 'complete',
      outputs: [
        {
          mediaKind: 'video',
          role: 'primary',
          source: { kind: 'url', url: 'https://gateway.example/output/video.mp4' },
          mimeType: 'video/mp4',
        },
      ],
    });
  });

  it('rejects malformed gateway IDs and explicit failed responses with output URLs', async () => {
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });
    const malformedId = createMediaGatewayAdapter({
      fetch: async () => response(202, { id: 'bad\u0000id', status: 'queued' }),
    });
    await expect(malformedId.submit(request, gateway, new AbortController().signal)).rejects.toMatchObject({
      code: 'invalid_response',
    });

    const failed = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          id: 'gateway_1',
          status: 'failed',
          outputs: [{ url: 'https://cdn.example/must-not-win.mp4' }],
        }),
    });
    await expect(failed.submit(request, gateway, new AbortController().signal)).rejects.toMatchObject({
      code: 'unknown',
    });
  });

  it('rejects credential-bearing and oversized gateway output URLs', async () => {
    const gateway = provider({ base_url: 'https://gateway.example', use_model: 'open-sora' });
    const credentialBearing = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          status: 'succeeded',
          outputs: [{ url: 'https://user:password@cdn.example/video.mp4' }],
        }),
    });
    await expect(credentialBearing.submit(request, gateway, new AbortController().signal)).rejects.toMatchObject({
      code: 'no_output',
    });

    const oversized = createMediaGatewayAdapter({
      fetch: async () =>
        response(200, {
          status: 'succeeded',
          outputs: [{ url: `https://cdn.example/${'a'.repeat(16 * 1024)}.mp4` }],
        }),
    });
    await expect(oversized.submit(request, gateway, new AbortController().signal)).rejects.toMatchObject({
      code: 'no_output',
    });
  });

  it('times out connection validation even when the caller signal never aborts', async () => {
    const adapter = createMediaGatewayAdapter({
      validationTimeoutMs: 5,
      fetch: async () => new Promise<ProviderHttpResponse>(() => undefined),
    });

    await expect(
      adapter.validateConnection(
        { model: 'open-sora' },
        provider({ base_url: 'https://gateway.example' }),
        new AbortController().signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'timeout' } });
  });

  it('applies the same finite deadline and JSON requirement to Seedance connection validation', async () => {
    const timeout = createBytePlusSeedanceAdapter({
      validationTimeoutMs: 5,
      fetch: async () => new Promise<ProviderHttpResponse>(() => undefined),
    });
    await expect(
      timeout.validateConnection({ model: 'seedance-1-5-pro-251215' }, provider(), new AbortController().signal)
    ).resolves.toEqual({ ok: false, error: { code: 'timeout' } });

    const malformed = createBytePlusSeedanceAdapter({
      fetch: async () => response(200, undefined, true),
    });
    await expect(
      malformed.validateConnection({ model: 'seedance-1-5-pro-251215' }, provider(), new AbortController().signal)
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_response' } });
  });

  it('requires JSON for gateway connection validation', async () => {
    const adapter = createMediaGatewayAdapter({
      fetch: async () => response(200, undefined, true),
    });
    await expect(
      adapter.validateConnection(
        { model: 'open-sora' },
        provider({ base_url: 'https://gateway.example' }),
        new AbortController().signal
      )
    ).resolves.toEqual({ ok: false, error: { code: 'invalid_response' } });
  });

  it('maps gateway auth, rate-limit, unavailable, timeout, malformed and unsupported-cancel errors', async () => {
    await Promise.all(
      ([401, 429, 503] as const).map(async (status) => {
        const adapter = createMediaGatewayAdapter({ fetch: async () => response(status, {}) });
        await expect(
          adapter.submit(
            request,
            provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
            new AbortController().signal
          )
        ).rejects.toMatchObject({
          code: status === 401 ? 'auth' : status === 429 ? 'rate_limited' : 'provider_unavailable',
        });
      })
    );

    const timeout = createMediaGatewayAdapter({
      fetch: async () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        throw error;
      },
    });
    await expect(
      timeout.submit(
        request,
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'timeout' });

    const malformed = createMediaGatewayAdapter({ fetch: async () => response(200, { status: 'succeeded' }) });
    await expect(
      malformed.poll?.(
        'gateway_1',
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).resolves.toEqual({ status: 'failed', error: { code: 'no_output' } });

    const noCancel = createMediaGatewayAdapter({ fetch: async () => response(404, {}) });
    await expect(
      noCancel.cancel?.(
        'gateway_1',
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).resolves.toEqual({ kind: 'refused', error: { code: 'cancellation_refused' } });
  });

  it('rejects an oversized gateway first frame before it sends a request', async () => {
    const fetch = vi.fn();
    const adapter = createMediaGatewayAdapter({ fetch });
    await expect(
      adapter.submit(
        { ...request, firstFrame: { ...firstFrame(), byteSize: 30 * 1024 * 1024 + 1 } },
        provider({ base_url: 'https://gateway.example', use_model: 'open-sora' }),
        new AbortController().signal
      )
    ).rejects.toMatchObject({ code: 'unsupported' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
