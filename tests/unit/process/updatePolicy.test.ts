import { describe, expect, it } from 'vitest';
import {
  isUpdateFeatureEnabled,
  resolveDesktopReleaseBuildPolicy,
  resolveUpdateBaseUrl,
} from '@/common/update/updatePolicy';

describe('desktop release update policy', () => {
  it('keeps updates disabled when no product-owned feed is configured', () => {
    expect(resolveUpdateBaseUrl(undefined)).toBeNull();
    expect(resolveUpdateBaseUrl('  ')).toBeNull();
  });

  it('accepts and normalizes a product-owned HTTPS feed', () => {
    expect(resolveUpdateBaseUrl(' https://updates.weprompt.test/releases/ ')).toBe(
      'https://updates.weprompt.test/releases'
    );
  });

  it.each([
    { AIONUI_DISABLE_AUTO_UPDATE: '1' },
    { AIONUI_E2E_TEST: '1' },
    { CI: '1' },
    { CI: 'true' },
    { GITHUB_ACTIONS: 'true' },
  ])('keeps the runtime update feature disabled under guard %#', (environment) => {
    expect(isUpdateFeatureEnabled('https://updates.weprompt.test/releases', environment)).toBe(false);
  });

  it.each([
    'http://updates.weprompt.test/releases',
    'https://static.aionui.com/releases',
    'https://static.aionui.com./releases',
    'https://aionui.com/download',
    'https://aionui.com./download',
    'https://github.com/iOfficeAI/AionUi/releases',
    'https://github.com./iOfficeAI/AionUi/releases',
    'https://api.github.com/repos/iOfficeAI/AionUi/releases',
    'https://api.github.com./repos/iOfficeAI/AionUi/releases',
  ])('rejects an unsafe or upstream AionUi feed: %s', (value) => {
    expect(() => resolveUpdateBaseUrl(value)).toThrow();
  });

  it('rejects ambient update and Sentry variables for an internal release', () => {
    expect(() =>
      resolveDesktopReleaseBuildPolicy(
        {
          WEPROMPT_INTERNAL_RELEASE: '1',
          WEPROMPT_UPDATE_BASE_URL: 'https://updates.weprompt.test/releases',
        },
        { isDevelopment: false }
      )
    ).toThrow(/WEPROMPT_UPDATE_BASE_URL/);

    for (const variable of [
      'SENTRY_DSN',
      'SENTRY_AUTH_TOKEN',
      'SENTRY_UPLOAD_SOURCE_MAPS',
      'SENTRY_ORG',
      'SENTRY_PROJECT',
      'SENTRY_RELEASE',
    ] as const) {
      expect(() =>
        resolveDesktopReleaseBuildPolicy(
          {
            WEPROMPT_INTERNAL_RELEASE: '1',
            [variable]: 'ambient-value',
          },
          { isDevelopment: false }
        )
      ).toThrow(new RegExp(variable));
    }
  });

  it('rejects Creative Studio enablement for an internal release', () => {
    expect(() =>
      resolveDesktopReleaseBuildPolicy(
        {
          WEPROMPT_INTERNAL_RELEASE: '1',
          AIONUI_ENABLE_CREATIVE_STUDIO: '1',
        },
        { isDevelopment: false }
      )
    ).toThrow(/AIONUI_ENABLE_CREATIVE_STUDIO/);
  });

  it('resolves every internal release exclusion disabled when forbidden values are absent', () => {
    expect(
      resolveDesktopReleaseBuildPolicy(
        {
          WEPROMPT_INTERNAL_RELEASE: '1',
        },
        { isDevelopment: false }
      )
    ).toMatchObject({
      internalRelease: true,
      creativeStudioEnabled: false,
      updateBaseUrl: null,
      enableSentrySourceMaps: false,
    });
  });

  it('keeps runtime updates disabled for an internal release even when passed a feed', () => {
    expect(
      isUpdateFeatureEnabled('https://updates.weprompt.test/releases', {
        WEPROMPT_INTERNAL_RELEASE: '1',
      })
    ).toBe(false);
  });

  it('does not enable source-map upload from an ambient auth token alone', () => {
    const policy = resolveDesktopReleaseBuildPolicy({ SENTRY_AUTH_TOKEN: 'ambient-token' }, { isDevelopment: false });

    expect(policy.enableSentrySourceMaps).toBe(false);
  });

  it('requires the complete Sentry tuple for an explicit source-map upload', () => {
    expect(() =>
      resolveDesktopReleaseBuildPolicy(
        { SENTRY_UPLOAD_SOURCE_MAPS: 'true', SENTRY_AUTH_TOKEN: 'token' },
        { isDevelopment: false }
      )
    ).toThrow(/SENTRY_DSN/);

    expect(
      resolveDesktopReleaseBuildPolicy(
        {
          SENTRY_UPLOAD_SOURCE_MAPS: 'true',
          SENTRY_DSN: 'https://public@example.invalid/1',
          SENTRY_AUTH_TOKEN: 'token',
          SENTRY_ORG: 'org',
          SENTRY_PROJECT: 'project',
          SENTRY_RELEASE: 'v2.1.39',
        },
        { isDevelopment: false }
      ).enableSentrySourceMaps
    ).toBe(true);
  });
});
