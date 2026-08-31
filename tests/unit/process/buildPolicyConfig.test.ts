import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sentryVitePluginMock = vi.hoisted(() => vi.fn(() => ({ name: 'test-sentry-plugin' })));

vi.mock('@sentry/vite-plugin', () => ({
  sentryVitePlugin: sentryVitePluginMock,
}));

const POLICY_ENV_KEYS = [
  'WEPROMPT_INTERNAL_RELEASE',
  'WEPROMPT_UPDATE_BASE_URL',
  'SENTRY_DSN',
  'SENTRY_AUTH_TOKEN',
  'SENTRY_UPLOAD_SOURCE_MAPS',
  'SENTRY_ORG',
  'SENTRY_PROJECT',
  'SENTRY_RELEASE',
] as const;

const originalValues = new Map(POLICY_ENV_KEYS.map((key) => [key, process.env[key]]));

async function resolveProductionConfig() {
  vi.resetModules();
  const { default: configExport } = await import('../../../packages/desktop/electron.vite.config');
  if (typeof configExport !== 'function') {
    throw new Error('Expected electron-vite config to be a function');
  }
  return configExport({ command: 'build', mode: 'production' });
}

type BuildPluginContext = {
  emitFile: (asset: { fileName: string; source: string; type: 'asset' }) => string;
  error: (error: string | Error) => never;
};

type TestBuildPlugin = {
  name?: string;
  buildStart?: (this: BuildPluginContext) => void | Promise<void>;
  generateBundle?: (this: BuildPluginContext) => void | Promise<void>;
};

describe('electron-vite internal release policy', () => {
  beforeEach(() => {
    sentryVitePluginMock.mockClear();
    for (const key of POLICY_ENV_KEYS) delete process.env[key];
  });

  afterEach(() => {
    for (const key of POLICY_ENV_KEYS) {
      const original = originalValues.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it('does not construct a Sentry plugin from an ambient auth token alone', async () => {
    process.env.SENTRY_AUTH_TOKEN = 'ambient-token';

    const config = await resolveProductionConfig();

    expect(sentryVitePluginMock).not.toHaveBeenCalled();
    expect(config.main?.build?.sourcemap).toBe(false);
    expect(config.renderer?.build?.sourcemap).toBe(false);
  }, 30_000);

  it('rejects an ambient Sentry token before plugin construction in an internal release', async () => {
    process.env.WEPROMPT_INTERNAL_RELEASE = '1';
    process.env.SENTRY_AUTH_TOKEN = 'ambient-token';

    await expect(resolveProductionConfig()).rejects.toThrow(/SENTRY_AUTH_TOKEN/);
    expect(sentryVitePluginMock).not.toHaveBeenCalled();
  });

  it('emits the presentation template inventory digest with the main bundle', async () => {
    const config = await resolveProductionConfig();
    const plugins = (config.main?.plugins ?? []) as TestBuildPlugin[];
    const plugin = plugins.find(
      (candidate) => candidate?.name === 'vite-plugin-presentation-template-inventory-digest'
    );
    const emittedAssets: Array<{ fileName: string; source: string; type: 'asset' }> = [];
    const context: BuildPluginContext = {
      emitFile: (asset) => {
        emittedAssets.push(asset);
        return `asset-${emittedAssets.length}`;
      },
      error: (error) => {
        throw error instanceof Error ? error : new Error(error);
      },
    };

    expect(plugin).toBeDefined();
    await plugin?.buildStart?.call(context);
    await plugin?.generateBundle?.call(context);

    const manifest = readFileSync(
      resolve(__dirname, '../../../packages/desktop/resources/presentation-templates/manifest.json')
    );
    const expectedDigest = createHash('sha256').update(manifest).digest('hex');
    expect(emittedAssets).toEqual([
      {
        type: 'asset',
        fileName: 'presentation-template-inventory.sha256',
        source: `${expectedDigest}\n`,
      },
    ]);
  });
});
