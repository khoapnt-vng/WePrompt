/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import type { StudioConnectionBinding, StudioConnectionCapabilities } from '@/common/types/project/creativeStudioTypes';
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
  ]
) =>
  createStudioProviderResolver({
    listProviders: async () => providers,
    listConnections: async () => connections,
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
      capabilities: gatewayCapabilities({ audioModes: ['audio'] }),
    });
    const otherAudioBinding = binding({
      id: 'binding_other_audio',
      adapterId: 'weprompt-media-gateway-v1',
      capabilities: gatewayCapabilities({ audioModes: ['audio'] }),
    });

    const catalog = await resolver([openRouter], [openRouterBinding, otherAudioBinding]).listGenerationRoutes();

    expect(catalog.routes).toEqual([
      expect.objectContaining({
        adapterId: 'openrouter-video-v1',
        constraints: expect.objectContaining({ silentOutput: false, supportsFirstFrame: false }),
      }),
    ]);
  });

  it('does not restore first-frame support from a legacy OpenRouter binding', async () => {
    const openRouter = provider({
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or-test',
      models: ['bytedance/seedance-2.0-fast'],
    });
    const legacyBinding = binding({
      adapterId: 'openrouter-video-v1',
      model: 'bytedance/seedance-2.0-fast',
      capabilities: gatewayCapabilities({ audioModes: ['audio'], supportsFirstFrame: true }),
    });

    const catalog = await resolver([openRouter], [legacyBinding]).listGenerationRoutes();

    expect(catalog.routes).toMatchObject([
      { adapterId: 'openrouter-video-v1', constraints: { supportsFirstFrame: false } },
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

    expect((await resolver([supported], [seedanceBinding]).listGenerationRoutes()).routes).toHaveLength(1);
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
