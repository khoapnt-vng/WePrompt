/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 *
 * @vitest-environment node
 */

import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { IProvider } from '@/common/config/storage';
import { createStudioProviderResolver } from '@/process/services/creative-studio/providerResolver';
import { createStudioConnectionManifestV1 } from '@/process/services/creative-studio/store/connectionManifest';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('Creative Studio Pilot persisted provider route', () => {
  it('resolves the validated OpenRouter image binding from connections.json after restart', async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), 'studio-pilot-provider-route-'));
    roots.push(rootDir);
    const manifest = createStudioConnectionManifestV1({ rootDir });
    await manifest.saveConnection({
      schemaVersion: 1,
      id: 'binding_openrouter_image',
      providerId: 'provider_openrouter',
      adapterId: 'weprompt-image-v1',
      model: 'google/gemini-3-pro-image',
      capabilities: {
        mediaKinds: ['image'],
        supportsFirstFrame: true,
        maxConditioningImages: 2,
        cancellationPolicy: 'none',
      },
      validatedAt: '2026-09-01T00:00:00.000Z',
    });
    const provider: IProvider = {
      id: 'provider_openrouter',
      platform: 'OpenRouter',
      name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'configured',
      // Provider discovery is not durable route authority and may omit a
      // separately validated image model after restart.
      models: [],
      enabled: true,
    };
    const resolver = createStudioProviderResolver({
      listProviders: async () => [provider],
      listConnections: () => manifest.listConnections(),
    });

    await expect(resolver.listGenerationRoutes()).resolves.toMatchObject({
      routes: [
        {
          providerId: provider.id,
          adapterId: 'weprompt-image-v1',
          model: 'google/gemini-3-pro-image',
          kind: 'image',
          health: 'unknown',
          constraints: { maxConditioningImages: 2 },
        },
      ],
      diagnostics: [],
    });
  });
});
