import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = ['AIONUI_ENABLE_CREATIVE_STUDIO', 'WEPROMPT_INTERNAL_RELEASE'] as const;
const originalValues = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

describe('internal release feature exclusions', () => {
  afterEach(() => {
    vi.resetModules();
    for (const key of ENV_KEYS) {
      const original = originalValues.get(key);
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    }
  });

  it('keeps Creative Studio disabled at runtime even if an internal build leaks the opt-in flag', async () => {
    process.env.WEPROMPT_INTERNAL_RELEASE = '1';
    process.env.AIONUI_ENABLE_CREATIVE_STUDIO = '1';

    const { CREATIVE_STUDIO_ENABLED } = await import('@/common/config/constants');

    expect(CREATIVE_STUDIO_ENABLED).toBe(false);
  });

  it('retains explicit Creative Studio opt-in outside the internal release', async () => {
    delete process.env.WEPROMPT_INTERNAL_RELEASE;
    process.env.AIONUI_ENABLE_CREATIVE_STUDIO = '1';

    const { CREATIVE_STUDIO_ENABLED } = await import('@/common/config/constants');

    expect(CREATIVE_STUDIO_ENABLED).toBe(true);
  });
});
