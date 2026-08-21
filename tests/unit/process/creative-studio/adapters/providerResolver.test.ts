/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { StudioConnectionBinding, StudioConnectionCapabilities } from '@/common/types/project/creativeStudioTypes';
import type {
  OpenRouterVideoCatalog,
  OpenRouterVideoModelSpec,
} from '@process/services/creative-studio/adapters/openRouterVideoAdapter';
import { createStudioProviderResolver } from '@process/services/creative-studio/providerResolver';

const provider = (overrides: Partial<IProvider> = {}): IProvider => ({
  id: 'provider_1',
  platform: 'gemini',
  name: 'Provider One',
  base_url: 'https://example.invalid/v1',
  api_key: 'never-return-this',
  models: ['image-model', 'video-model'],
  ...overrides,
});

const gatewayCapabilities = (overrides: Partial<StudioConnectionCapabilities> = {}): StudioConnectionCapabilities => ({
  mediaKinds: ['video'],
  audioModes: ['none'],
  aspectRatios: ['16:9', '9:16'],
  resolutions: ['720p', '1080p'],
  minDurationSeconds: 2,
  maxDurationSeconds: 30,
  supportsFirstFrame: false,
  maxConditioningImages: 0,
  cancellationPolicy: 'none',
  ...overrides,
});

const openRouterCapabilities = (
  overrides: Partial<StudioConnectionCapabilities> = {}
): StudioConnectionCapabilities => ({
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
  ...overrides,
});

const binding = (overrides: Partial<StudioConnectionBinding> = {}): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: 'binding_1',
  providerId: 'provider_1',
  adapterId: 'weprompt-media-gateway-v1',
  model: 'video-model',
  capabilities: gatewayCapabilities(),
  validatedAt: '2026-07-30T00:00:00.000Z',
  ...overrides,
});

const openRouterSpec = (overrides: Partial<OpenRouterVideoModelSpec> = {}): OpenRouterVideoModelSpec => ({
  durations: [4, 8, 12],
  minDuration: 4,
  maxDuration: 12,
  resolutions: ['720p', '1080p'],
  ratios: ['16:9', '9:16'],
  supportsAudio: true,
  supportsFirstFrame: false,
  ...overrides,
});

const openRouterCatalog = (
  entries: Record<string, OpenRouterVideoModelSpec> = {},
  refreshError: Error | null = null
): OpenRouterVideoCatalog => ({
  refresh: async () => {
    if (refreshError) throw refreshError;
    return Object.keys(entries).toSorted();
  },
  listModels: () => Object.keys(entries).toSorted(),
  getModelSpec: (model) => entries[model] ?? null,
});

const resolver = (
  providers: IProvider[] = [provider()],
  connections: StudioConnectionBinding[] = [
    binding({
      id: 'binding_image',
      adapterId: 'weprompt-image-v1',
      model: 'gemini-2.5-flash-image',
      capabilities: { mediaKinds: ['image'], supportsFirstFrame: true },
    }),
    binding({ id: 'binding_video' }),
  ],
  catalog: OpenRouterVideoCatalog = openRouterCatalog()
) =>
  createStudioProviderResolver({
    listProviders: async () => providers,
    listConnections: async () => connections,
    openRouterVideoCatalog: catalog,
  });

describe('createStudioProviderResolver', () => {
  it('returns only sanitized image and video routes backed by validated bindings', async () => {
    const catalog = await resolver([
      provider({ models: ['gemini-2.5-flash-image', 'video-model'] }),
    ]).listGenerationRoutes();

    expect(catalog.routes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'image',
          providerId: 'provider_1',
          model: 'gemini-2.5-flash-image',
        }),
        expect.objectContaining({
          kind: 'video',
          providerId: 'provider_1',
          model: 'video-model',
          cancellationPolicy: 'none',
        }),
      ])
    );
    expect(JSON.stringify(catalog)).not.toMatch(/api_key|base_url|authorization|secret|never-return-this/i);
  });

  it('does not discover image routes directly from provider model names', async () => {
    const catalog = await resolver([provider({ models: ['gemini-2.5-flash-image'] })], []).listGenerationRoutes();

    expect(catalog.routes).toEqual([]);
  });

  it('sanitizes provider names and filters unsafe provider and model identities', async () => {
    const catalog = await resolver(
      [
        provider({ id: '../unsafe', models: ['gemini-2.5-flash-image'] }),
        provider({
          id: 'provider_safe',
          name: 'Safe\u0000 Provider',
          models: ['gemini-2.5-flash-image'],
        }),
      ],
      [
        binding({
          id: 'binding_safe',
          providerId: 'provider_safe',
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-flash-image',
          capabilities: { mediaKinds: ['image'] },
        }),
        binding({ id: 'binding_unsafe', providerId: '../unsafe' }),
        binding({ id: 'binding_bad_model', providerId: 'provider_safe', model: 'bad\nmodel' }),
      ]
    ).listGenerationRoutes();

    expect(catalog.routes).toMatchObject([
      {
        providerId: 'provider_safe',
        providerName: 'Safe Provider',
        model: 'gemini-2.5-flash-image',
      },
    ]);
  });

  it('returns stable sorted generation versions independent of binding order and timestamps', async () => {
    const image = binding({
      id: 'binding_image',
      adapterId: 'weprompt-image-v1',
      model: 'gemini-2.5-flash-image',
      capabilities: { mediaKinds: ['image'] },
    });
    const video = binding({ id: 'binding_video' });
    const providers = [provider({ models: ['gemini-2.5-flash-image', 'video-model'] })];

    const first = await resolver(providers, [video, image]).listGenerationRoutes();
    const second = await resolver(providers, [
      { ...image, validatedAt: 'later' },
      { ...video, validatedAt: 'later' },
    ]).listGenerationRoutes();

    expect(first.routes.map((route) => route.kind)).toEqual(['image', 'video']);
    expect(second.generationCatalogVersion).toBe(first.generationCatalogVersion);
  });

  it('changes the generation version when sanitized route constraints change', async () => {
    const first = await resolver().listGenerationRoutes();
    const changed = await resolver(
      [provider({ models: ['gemini-2.5-flash-image', 'video-model'] })],
      [
        binding({
          id: 'binding_image',
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-flash-image',
          capabilities: { mediaKinds: ['image'] },
        }),
        binding({
          id: 'binding_video',
          capabilities: gatewayCapabilities({ minDurationSeconds: 3 }),
        }),
      ]
    ).listGenerationRoutes();

    expect(changed.generationCatalogVersion).not.toBe(first.generationCatalogVersion);
  });

  it('projects legacy image capacity as zero and changes the generation version when admitted capacity changes', async () => {
    const image = binding({
      id: 'binding_image',
      adapterId: 'weprompt-image-v1',
      model: 'gemini-2.5-flash-image',
      capabilities: { mediaKinds: ['image'], supportsFirstFrame: true },
    });
    const providers = [provider({ models: ['gemini-2.5-flash-image'] })];

    const legacy = await resolver(providers, [image]).listGenerationRoutes();
    const admitted = await resolver(providers, [
      { ...image, capabilities: { ...image.capabilities, maxConditioningImages: 6 } },
    ]).listGenerationRoutes();

    expect(legacy.routes[0]?.constraints).toHaveProperty('maxConditioningImages', 0);
    expect(admitted.routes[0]?.constraints).toHaveProperty('maxConditioningImages', 6);
    expect(admitted.generationCatalogVersion).not.toBe(legacy.generationCatalogVersion);
  });

  it('keeps video capacity zero even when a persisted binding claims six', async () => {
    const claimed = binding({ capabilities: gatewayCapabilities({ maxConditioningImages: 6 }) });

    const catalog = await resolver([provider()], [claimed]).listGenerationRoutes();

    expect(catalog.routes[0]?.constraints).toHaveProperty('maxConditioningImages', 0);
  });

  it('keeps an Images API route at zero even when a persisted binding claims six', async () => {
    const vng = provider({
      platform: 'openai',
      base_url: 'https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1',
      models: ['openai/gpt-image-1'],
    });
    const claimed = binding({
      adapterId: 'weprompt-image-v1',
      model: 'openai/gpt-image-1',
      capabilities: { mediaKinds: ['image'], supportsFirstFrame: false, maxConditioningImages: 6 },
    });

    const catalog = await resolver([vng], [claimed]).listGenerationRoutes();

    expect(catalog.routes[0]?.constraints).toMatchObject({
      supportsFirstFrame: false,
      maxConditioningImages: 0,
    });
  });

  it('changes the main-only generation version when cancellation policy changes', async () => {
    const first = await resolver().listGenerationRoutes();
    const changed = await resolver(
      [provider({ models: ['gemini-2.5-flash-image', 'video-model'] })],
      [
        binding({
          id: 'binding_image',
          adapterId: 'weprompt-image-v1',
          model: 'gemini-2.5-flash-image',
          capabilities: { mediaKinds: ['image'] },
        }),
        binding({
          id: 'binding_video',
          capabilities: gatewayCapabilities({ cancellationPolicy: 'queued_and_running' }),
        }),
      ]
    ).listGenerationRoutes();

    expect(changed.generationCatalogVersion).not.toBe(first.generationCatalogVersion);
  });

  it('deduplicates duplicate validated bindings with the same route identity', async () => {
    const duplicate = binding({ id: 'binding_duplicate' });
    const catalog = await resolver([provider()], [binding(), duplicate]).listGenerationRoutes();

    expect(catalog.routes).toHaveLength(1);
  });

  it.each([
    ['permissive first', ['queued_and_running', 'queued_only', 'none']],
    ['restrictive first', ['none', 'queued_only', 'queued_and_running']],
  ] as const)('resolves duplicate policy conflicts least-permissively with %s', async (_label, policies) => {
    const connections = policies.map((cancellationPolicy, index) =>
      binding({
        id: `binding_${index}`,
        capabilities: gatewayCapabilities({ cancellationPolicy }),
      })
    );

    const result = await resolver([provider()], connections).listGenerationRoutes();

    expect(result.routes).toMatchObject([{ cancellationPolicy: 'none' }]);
  });

  it('omits routes for disabled, credentialless, or unhealthy providers', async () => {
    const unavailableProviders = [
      provider({ id: 'disabled', enabled: false }),
      provider({ id: 'credentialless', api_key: '' }),
      provider({
        id: 'unhealthy',
        model_health: { 'video-model': { status: 'unhealthy', last_check: 1 } },
      }),
    ];
    const connections = unavailableProviders.map((candidate) =>
      binding({ id: `binding_${candidate.id}`, providerId: candidate.id })
    );

    expect((await resolver(unavailableProviders, connections).listGenerationRoutes()).routes).toEqual([]);
  });

  it('keeps renderer-safe diagnostics for unavailable validated bindings', async () => {
    const unavailableProviders = [
      provider({ id: 'disabled', enabled: false }),
      provider({ id: 'credentialless', api_key: '', name: 'Needs Setup' }),
      provider({
        id: 'unhealthy',
        model_health: { 'video-model': { status: 'unhealthy', last_check: 1 } },
      }),
    ];
    const connections = [
      binding({ id: 'binding_removed', providerId: 'removed' }),
      ...unavailableProviders.map((candidate) => binding({ id: `binding_${candidate.id}`, providerId: candidate.id })),
    ];

    const catalog = await resolver(unavailableProviders, connections).listGenerationRoutes();

    expect(catalog.diagnostics).toEqual(
      expect.arrayContaining([
        {
          status: 'retired',
          providerId: 'removed',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'video-model',
        },
        {
          status: 'needs_setup',
          providerId: 'credentialless',
          providerName: 'Needs Setup',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'video-model',
        },
        {
          status: 'health',
          providerId: 'disabled',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'video-model',
        },
        {
          status: 'health',
          providerId: 'unhealthy',
          adapterId: 'weprompt-media-gateway-v1',
          model: 'video-model',
        },
      ])
    );
    expect(JSON.stringify(catalog.diagnostics)).not.toMatch(/api_key|base_url|never-return-this/i);
  });

  it('requires silent output and complete constraints for media gateway routes', async () => {
    const missingSilent = binding({
      id: 'binding_audio',
      capabilities: gatewayCapabilities({ audioModes: ['required'] }),
    });
    const incomplete = binding({
      id: 'binding_incomplete',
      capabilities: { mediaKinds: ['video'], audioModes: ['none'] },
    });

    expect((await resolver([provider()], [missingSilent, incomplete]).listGenerationRoutes()).routes).toEqual([]);
  });

  it('allows non-silent output only for the trusted OpenRouter video adapter', async () => {
    const openRouter = provider({
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['bytedance/seedance-2.0-fast'],
    });
    const openRouterBinding = binding({
      id: 'binding_openrouter',
      adapterId: 'openrouter-video-v1',
      model: 'bytedance/seedance-2.0-fast',
      capabilities: openRouterCapabilities(),
    });
    const otherAudioBinding = binding({
      id: 'binding_other_audio',
      adapterId: 'weprompt-media-gateway-v1',
      capabilities: gatewayCapabilities({ audioModes: ['audio'] }),
    });

    const catalog = await resolver(
      [openRouter],
      [openRouterBinding, otherAudioBinding],
      openRouterCatalog({ 'bytedance/seedance-2.0-fast': openRouterSpec() })
    ).listGenerationRoutes();

    expect(catalog.routes).toEqual([
      expect.objectContaining({
        adapterId: 'openrouter-video-v1',
        constraints: expect.objectContaining({
          silentOutput: false,
          supportsFirstFrame: false,
          maxConditioningImages: 0,
        }),
      }),
    ]);
  });

  it('retires a legacy binding that claims an unevidenced OpenRouter first frame', async () => {
    const openRouter = provider({
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['bytedance/seedance-2.0-fast'],
    });
    const legacyBinding = binding({
      adapterId: 'openrouter-video-v1',
      model: 'bytedance/seedance-2.0-fast',
      capabilities: openRouterCapabilities({ supportsFirstFrame: true }),
    });

    const catalog = await resolver(
      [openRouter],
      [legacyBinding],
      openRouterCatalog({ 'bytedance/seedance-2.0-fast': openRouterSpec() })
    ).listGenerationRoutes();

    expect(catalog.routes).toEqual([]);
  });

  it('advertises first-frame support only for the evidenced Seedance 2.0 route', async () => {
    const openRouter = provider({
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['bytedance/seedance-2.0'],
    });
    const evidencedBinding = binding({
      adapterId: 'openrouter-video-v1',
      model: 'bytedance/seedance-2.0',
      capabilities: openRouterCapabilities({ supportsFirstFrame: true }),
    });

    const catalog = await resolver(
      [openRouter],
      [evidencedBinding],
      openRouterCatalog({ 'bytedance/seedance-2.0': openRouterSpec({ supportsFirstFrame: true }) })
    ).listGenerationRoutes();

    expect(catalog.routes).toMatchObject([
      {
        adapterId: 'openrouter-video-v1',
        constraints: { supportsFirstFrame: true, maxConditioningImages: 0 },
      },
    ]);
  });

  it('accepts Seedance only for the exact supported provider host and model', async () => {
    const seedanceBinding = binding({
      adapterId: 'byteplus-seedance-v1',
      model: 'seedance-1-0-pro-250528',
      capabilities: gatewayCapabilities({ supportsFirstFrame: true }),
    });
    const supported = provider({
      platform: 'custom',
      base_url: 'https://ark.ap-southeast.bytepluses.com/api/v3',
      models: [],
    });
    const spoofed = provider({
      platform: 'custom',
      base_url: 'https://ark.ap-southeast.bytepluses.com.evil.test/api/v3',
      models: [],
    });

    expect((await resolver([supported], [seedanceBinding]).listGenerationRoutes()).routes).toMatchObject([
      { constraints: { maxConditioningImages: 0 } },
    ]);
    expect((await resolver([spoofed], [seedanceBinding]).listGenerationRoutes()).routes).toEqual([]);
  });

  it('checks image and video availability only against current validated bindings', async () => {
    const checked = resolver([provider({ models: [] })]);

    await expect(
      checked.isGenerationRouteAvailable({
        providerId: 'provider_1',
        adapterId: 'weprompt-image-v1',
        model: 'gemini-2.5-flash-image',
        kind: 'image',
      })
    ).resolves.toBe(true);
    await expect(
      checked.isGenerationRouteAvailable({
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'video-model',
        kind: 'video',
      })
    ).resolves.toBe(true);
    await expect(
      checked.isGenerationRouteAvailable({
        providerId: 'provider_1',
        adapterId: 'weprompt-media-gateway-v1',
        model: 'unbound-model',
        kind: 'video',
      })
    ).resolves.toBe(false);
  });

  it('projects the dynamically admitted OpenRouter video set in deterministic model order', async () => {
    const openRouter = provider({
      id: 'provider_openrouter',
      name: 'OpenRouter',
      platform: 'openrouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['openai/gpt-5', 'anthropic/claude-sonnet-4'],
    });

    const candidates = await resolver(
      [openRouter],
      [],
      openRouterCatalog({
        'openai/sora-2-pro': openRouterSpec(),
        'google/veo-3.1': openRouterSpec({ durations: [4, 6, 8], minDuration: 4, maxDuration: 8 }),
        'bytedance/seedance-2.5': openRouterSpec({ durations: [4, 5, 6], minDuration: 4, maxDuration: 6 }),
      })
    ).listConnectionCandidates();

    expect(candidates).toEqual([
      {
        providerId: 'provider_openrouter',
        providerName: 'OpenRouter',
        models: [
          { model: 'anthropic/claude-sonnet-4', health: 'unknown' },
          { model: 'openai/gpt-5', health: 'unknown' },
        ],
        integrationModels: [
          {
            integrationLabelKey: 'openRouterVideo',
            models: [
              { model: 'bytedance/seedance-2.5', health: 'unknown' },
              { model: 'google/veo-3.1', health: 'unknown' },
              { model: 'openai/sora-2-pro', health: 'unknown' },
            ],
          },
        ],
      },
    ]);
  });

  it('projects an empty closed OpenRouter set for a provider on the wrong host', async () => {
    const candidates = await resolver(
      [provider({ models: ['openai/gpt-5', 'google/veo-3.1-fast'] })],
      []
    ).listConnectionCandidates();

    expect(candidates[0]?.integrationModels).toEqual([{ integrationLabelKey: 'openRouterVideo', models: [] }]);
  });

  it('rebuilds an OpenRouter route after restart from durable exact capabilities and a fresh catalog proof', async () => {
    const openRouter = provider({
      id: 'provider_openrouter',
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: [],
    });
    const persisted = binding({
      id: 'binding_sora',
      providerId: openRouter.id,
      adapterId: 'openrouter-video-v1',
      model: 'openai/sora-2-pro',
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

    const restarted = resolver([openRouter], [persisted], openRouterCatalog({ 'openai/sora-2-pro': openRouterSpec() }));

    await expect(restarted.listGenerationRoutes()).resolves.toMatchObject({
      routes: [
        {
          adapterId: 'openrouter-video-v1',
          model: 'openai/sora-2-pro',
          constraints: {
            minDurationSeconds: 4,
            maxDurationSeconds: 12,
            supportedDurationSeconds: [4, 8, 12],
            silentOutput: false,
          },
        },
      ],
    });
  });

  it('narrows a legacy OpenRouter duration range to fresh discrete catalog values after restart', async () => {
    const openRouter = provider({ base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-or-test', models: [] });
    const legacy = binding({
      adapterId: 'openrouter-video-v1',
      model: 'google/veo-3.1-lite',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['none'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 8,
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        cancellationPolicy: 'none',
      },
    });

    const routes = await resolver(
      [openRouter],
      [legacy],
      openRouterCatalog({
        'google/veo-3.1-lite': openRouterSpec({
          durations: [4, 6, 8, 10],
          minDuration: 4,
          maxDuration: 10,
        }),
      })
    ).listGenerationRoutes();

    expect(routes.routes[0]?.constraints).toMatchObject({
      minDurationSeconds: 4,
      maxDurationSeconds: 8,
      supportedDurationSeconds: [4, 6, 8],
      silentOutput: true,
    });
  });

  it('retires a durable OpenRouter route that expands beyond the refreshed catalog', async () => {
    const openRouter = provider({ base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-or-test', models: [] });
    const expanded = binding({
      adapterId: 'openrouter-video-v1',
      model: 'openai/sora-2-pro',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        aspectRatios: ['16:9', '9:16'],
        resolutions: ['720p', '1080p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 15,
        supportedDurationSeconds: [4, 8, 12, 15],
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        cancellationPolicy: 'none',
      },
    });

    const routes = await resolver(
      [openRouter],
      [expanded],
      openRouterCatalog({ 'openai/sora-2-pro': openRouterSpec() })
    ).listGenerationRoutes();

    expect(routes.routes).toEqual([]);
    expect(routes.diagnostics).toMatchObject([{ status: 'retired', model: 'openai/sora-2-pro' }]);
  });

  it('fails the closed OpenRouter projection and routes when catalog refresh fails', async () => {
    const openRouter = provider({ base_url: 'https://openrouter.ai/api/v1', api_key: 'sk-or-test', models: [] });
    const staleCatalog = openRouterCatalog({ 'openai/sora-2-pro': openRouterSpec() }, new Error('catalog unavailable'));
    const persisted = binding({
      adapterId: 'openrouter-video-v1',
      model: 'openai/sora-2-pro',
      capabilities: {
        mediaKinds: ['video'],
        audioModes: ['audio'],
        aspectRatios: ['16:9'],
        resolutions: ['720p'],
        minDurationSeconds: 4,
        maxDurationSeconds: 12,
        supportedDurationSeconds: [4, 8, 12],
        supportsFirstFrame: false,
        maxConditioningImages: 0,
        cancellationPolicy: 'none',
      },
    });
    const checked = resolver([openRouter], [persisted], staleCatalog);

    await expect(checked.listConnectionCandidates()).resolves.toMatchObject([
      { integrationModels: [{ integrationLabelKey: 'openRouterVideo', models: [] }] },
    ]);
    await expect(checked.listGenerationRoutes()).resolves.toMatchObject({ routes: [] });
  });

  it('keeps candidate ordering stable without projecting provider secrets or adapter identities', async () => {
    const firstProvider = provider({
      id: 'provider_z',
      name: 'Provider Z',
      base_url: 'https://openrouter.ai/api/v1',
      models: ['openai/gpt-5'],
    });
    const secondProvider = provider({
      id: 'provider_a',
      name: 'Provider A',
      base_url: 'https://openrouter.ai/api/v1',
      models: ['anthropic/claude-sonnet-4'],
    });

    const forward = await resolver([firstProvider, secondProvider], []).listConnectionCandidates();
    const reversed = await resolver([secondProvider, firstProvider], []).listConnectionCandidates();

    expect(reversed).toEqual(forward);
    expect(forward.map(({ providerId }) => providerId)).toEqual(['provider_a', 'provider_z']);
    expect(JSON.stringify(forward)).not.toMatch(
      /api_key|base_url|authorization|secret|never-return-this|adapterId|openrouter-video-v1/i
    );
  });

  it('keeps connection candidates safe and credential-gated', async () => {
    const candidates = await resolver([
      provider({ name: 'Provider\u0000 One', models: ['video-model', 'bad\nmodel'] }),
      provider({ id: 'missing_key', api_key: '' }),
    ]).listConnectionCandidates();

    expect(candidates).toEqual([
      {
        providerId: 'provider_1',
        providerName: 'Provider One',
        models: [{ model: 'video-model', health: 'unknown' }],
        integrationModels: [{ integrationLabelKey: 'openRouterVideo', models: [] }],
      },
    ]);
  });

  it('skips version-skewed provider rows without hiding healthy candidates or routes', async () => {
    const healthyProvider = provider({ id: 'provider_healthy', models: ['video-model'] });
    const skewedProvider = provider({
      id: 'provider_skewed',
      api_key: undefined as never,
      base_url: undefined as never,
    });
    const baseUrlSkewedProvider = provider({ id: 'provider_base_url_skewed', base_url: undefined as never });
    const checked = resolver(
      [skewedProvider, baseUrlSkewedProvider, healthyProvider],
      [
        binding({ id: 'binding_skewed', providerId: 'provider_skewed' }),
        binding({ id: 'binding_base_url_skewed', providerId: 'provider_base_url_skewed' }),
        binding({ id: 'binding_healthy', providerId: 'provider_healthy' }),
      ]
    );

    await expect(checked.listConnectionCandidates()).resolves.toMatchObject([{ providerId: 'provider_healthy' }]);
    await expect(checked.listGenerationRoutes()).resolves.toMatchObject({
      routes: [{ providerId: 'provider_healthy' }],
    });
  });
});
