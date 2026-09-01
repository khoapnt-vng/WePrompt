import { describe, expect, it, vi } from 'vitest';

import type { IProvider } from '@/common/config/storage';
import type { StudioConnectionBinding } from '@/common/types/project/creativeStudioTypes';
import { ProviderDeadlineError } from '@process/services/creative-studio/adapters';
import { createStudioConnectionControllerV1 } from '@process/services/creative-studio/connectionController';

const IMAGE_MODEL = 'gemini-2.5-flash-image-preview';

const imageBinding = (id = 'image_binding'): StudioConnectionBinding => ({
  schemaVersion: 1,
  id,
  providerId: 'provider_1',
  adapterId: 'weprompt-image-v1',
  model: IMAGE_MODEL,
  capabilities: {
    mediaKinds: ['image'],
    supportsFirstFrame: true,
    maxConditioningImages: 3,
    cancellationPolicy: 'none',
  },
  validatedAt: '2026-09-01T00:00:00.000Z',
});

const videoBinding = (): StudioConnectionBinding => ({
  schemaVersion: 1,
  id: 'video_binding',
  providerId: 'provider_1',
  adapterId: 'byteplus-seedance-v1',
  model: 'video-model',
  capabilities: { mediaKinds: ['video'], audioModes: ['none'], cancellationPolicy: 'queued_only' },
  validatedAt: '2026-09-01T00:00:00.000Z',
});

const provider = {
  id: 'provider_1',
  name: 'Provider',
  enabled: true,
  api_key: 'private-key',
  base_url: 'https://provider.invalid',
  platform: 'gemini',
  models: [IMAGE_MODEL],
  model_health: { [IMAGE_MODEL]: { status: 'healthy' } },
} as unknown as IProvider;

const createHarness = (options: { validation?: unknown; injected?: StudioConnectionBinding[] } = {}) => {
  const persisted = [imageBinding(), videoBinding()];
  const manifest = {
    listConnections: vi.fn(async () => structuredClone(persisted)),
    saveConnection: vi.fn(async (binding: StudioConnectionBinding) => binding),
    removeConnection: vi.fn(async () => true),
  };
  const adapter = {
    id: 'weprompt-image-v1',
    validateConnection: vi.fn(
      async () => options.validation ?? { ok: true, capabilities: { maxConditioningImages: 4 } }
    ),
  };
  const candidate = {
    providerId: 'provider_1',
    providerName: 'Provider',
    models: [{ model: IMAGE_MODEL, health: 'available' as const }],
    integrationModels: [
      {
        integrationLabelKey: 'openRouterVideo' as const,
        models: [{ model: 'video-model', health: 'available' as const }],
      },
    ],
  };
  const controller = createStudioConnectionControllerV1({
    manifest,
    listProviders: vi.fn(async () => [provider]),
    adapters: new Map([['weprompt-image-v1', adapter]]) as never,
    injectedBindings: options.injected,
    now: () => new Date('2026-09-01T01:02:03.000Z'),
    createConnectionId: () => 'connection_minted_by_main',
  });
  return { controller, manifest, adapter, candidate };
};

const request = { providerId: 'provider_1', integrationId: 'integration_g7Q2mB4p', model: IMAGE_MODEL };

describe('Pilot image connection controller', () => {
  it('exposes only image integration and image bindings while retaining video storage', async () => {
    const harness = createHarness();

    await expect(harness.controller.listConnectionCandidates()).resolves.toEqual([
      { ...harness.candidate, integrationModels: [] },
    ]);
    await expect(harness.controller.listConnections()).resolves.toMatchObject({
      integrations: [{ integrationId: 'integration_g7Q2mB4p', kind: 'image', labelKey: 'imageApi' }],
      connections: [{ bindingId: 'image_binding', integrationId: 'integration_g7Q2mB4p' }],
    });
    await expect(harness.controller.removeConnection({ bindingId: 'video_binding' })).resolves.toBe(false);
    expect(harness.manifest.removeConnection).not.toHaveBeenCalled();
  });

  it('validates and saves a secret-free Main-identified image binding', async () => {
    const harness = createHarness();

    await expect(harness.controller.validateConnection(request)).resolves.toMatchObject({
      valid: true,
      connection: {
        providerId: 'provider_1',
        integrationId: 'integration_g7Q2mB4p',
        model: IMAGE_MODEL,
        capabilities: { mediaKinds: ['image'], maxConditioningImages: 4 },
      },
    });
    const saved = await harness.controller.saveConnection(request);
    expect(saved.bindingId).toBe('connection_minted_by_main');
    expect(JSON.stringify(saved)).not.toContain('private-key');
    expect(harness.manifest.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'connection_minted_by_main',
        providerId: 'provider_1',
        adapterId: 'weprompt-image-v1',
      })
    );
  });

  it('maps bounded provider refusals and save-time validation failures', async () => {
    const refused = createHarness({ validation: { ok: false, error: { code: 'auth' } } });
    await expect(refused.controller.validateConnection(request)).resolves.toEqual({ valid: false, reason: 'auth' });
    await expect(refused.controller.saveConnection(request)).rejects.toMatchObject({
      code: 'connection_validation_failed',
      reason: 'auth',
    });
    expect(refused.manifest.saveConnection).not.toHaveBeenCalled();

    const timeout = createHarness();
    timeout.adapter.validateConnection.mockRejectedValueOnce(new ProviderDeadlineError());
    await expect(timeout.controller.validateConnection(request)).resolves.toEqual({ valid: false, reason: 'timeout' });
  });

  it('rejects video integration requests and refuses removal of injected E2E bindings', async () => {
    const injected = imageBinding('injected_image');
    const harness = createHarness({ injected: [injected] });

    await expect(
      harness.controller.validateConnection({ ...request, integrationId: 'integration_r9L3vN6k' })
    ).rejects.toMatchObject({ code: 'invalid_payload' });
    await expect(harness.controller.removeConnection({ bindingId: injected.id })).resolves.toBe(false);
    expect(harness.manifest.removeConnection).not.toHaveBeenCalled();
  });

  it('fails closed for malformed removal and removes only a persisted image binding', async () => {
    const harness = createHarness();

    await expect(harness.controller.removeConnection({ bindingId: '../escape' })).rejects.toMatchObject({
      code: 'invalid_payload',
    });
    await expect(harness.controller.removeConnection({ bindingId: 'image_binding' })).resolves.toBe(true);
    expect(harness.manifest.removeConnection).toHaveBeenCalledExactlyOnceWith('image_binding');
  });
});
