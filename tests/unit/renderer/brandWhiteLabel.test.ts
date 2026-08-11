import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

type I18nConfig = {
  modules: string[];
  referenceLanguage: string;
  supportedLanguages: string[];
};

type JsonRecord = Record<string, JsonValue>;
type JsonValue = JsonRecord | JsonValue[] | string | number | boolean | null;

const repoRoot = process.cwd();
const FORGE_WORDMARK = /(^|[^A-Za-z])Forge(?=[^A-Za-z]|$)/;
const UPSTREAM_AIONUI_ALLOWLIST = new Set(['settings.upstreamAionUiDocumentation']);
const UPSTREAM_AIONUI_GUIDE_URLS = [
  'https://github.com/iOfficeAI/AionUi/wiki/ACP-Setup',
  'https://github.com/iOfficeAI/AionUi/wiki/DingTalk-Bot-Setup-Guide',
  'https://github.com/iOfficeAI/AionUi/wiki/LLM-Configuration',
  'https://github.com/iOfficeAI/AionUi/wiki/AionUi-Image-Generation-Tool-Model-Configuration-Guide',
] as const;
const PWA_ICON_SIZES = [180, 192, 512] as const;

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(path.join(repoRoot, relativePath), 'utf8')) as T;

const i18nConfig = readJson<I18nConfig>('packages/desktop/src/common/config/i18n-config.json');

function collectStringLeaves(value: JsonValue, prefix = ''): Array<{ path: string; value: string }> {
  if (typeof value === 'string') {
    return [{ path: prefix, value }];
  }
  if (value === null || typeof value !== 'object') {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectStringLeaves(entry, `${prefix}[${index}]`));
  }
  return Object.entries(value).flatMap(([key, entry]) => collectStringLeaves(entry, prefix ? `${prefix}.${key}` : key));
}

function getNestedValue(value: JsonValue, keyPath: string): JsonValue | undefined {
  return keyPath.split('.').reduce<JsonValue | undefined>((current, key) => {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
      return undefined;
    }
    return current[key];
  }, value);
}

function sourceWithoutLicense(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
}

function collectFiles(root: string, extension: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath, extension);
    return entry.isFile() && entry.name.endsWith(extension) ? [entryPath] : [];
  });
}

describe('WePrompt white-label branding', () => {
  it('derives every active PWA icon exactly from the approved app mark', async () => {
    for (const size of PWA_ICON_SIZES) {
      const expected = await sharp(path.join(repoRoot, 'resources/app.png'))
        .resize(size, size)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const actual = await sharp(path.join(repoRoot, `public/pwa/icon-${size}.png`))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });

      expect(expected.info).toMatchObject({ width: size, height: size, channels: 4 });
      expect(actual.info).toMatchObject({ width: size, height: size, channels: 4 });
      expect(actual.data.equals(expected.data)).toBe(true);
    }
  });

  it('uses the WePrompt wordmark in the primary brand lockup', () => {
    const lockup = readFileSync(
      path.join(repoRoot, 'packages/desktop/src/renderer/assets/logos/brand/forge-lockup-horizontal.svg'),
      'utf8'
    );

    expect(lockup).toContain('WePrompt');
    expect(lockup).not.toContain('>Forge<');
  });

  it('uses WePrompt in primary chrome locale keys for every supported language', () => {
    for (const language of i18nConfig.supportedLanguages) {
      const localeRoot = `packages/desktop/src/renderer/services/i18n/locales/${language}`;
      const login = readJson<Record<string, string>>(`${localeRoot}/login.json`);
      const common = readJson<Record<string, string>>(`${localeRoot}/common.json`);
      const agent = readJson<{ brand: Record<string, string> }>(`${localeRoot}/agent.json`);

      expect(login.brand).toBe('WePrompt');
      expect(login.pageTitle).toContain('WePrompt');
      expect(common['tray.showWindow']).toContain('WePrompt');
      expect(common['tray.about']).toContain('WePrompt');
      expect(agent.brand.forgeChat).toBe('WePrompt Chat');
      expect(agent.brand.forgeCode).toBe('WePrompt Code');
      expect(agent.brand.forgeAssistant).toBe('WePrompt Assistant');
    }
  });

  it('matches only standalone Forge wordmarks', () => {
    for (const accepted of ['Do Not Forget', 'MyForge', 'ForgeAI']) {
      expect(accepted).not.toMatch(FORGE_WORDMARK);
    }
    for (const rejected of ['Forge', 'Forge-Dev', 'Forge_Dev', 'Forge2', 'WePrompt Forge', '中文Forge品牌']) {
      expect(rejected).toMatch(FORGE_WORDMARK);
    }
  });

  it('keeps every configured locale leaf free of legacy product branding', () => {
    for (const language of i18nConfig.supportedLanguages) {
      for (const module of i18nConfig.modules) {
        const localePath = `packages/desktop/src/renderer/services/i18n/locales/${language}/${module}.json`;
        if (!existsSync(path.join(repoRoot, localePath))) continue;

        const locale = readJson<JsonValue>(localePath);
        for (const leaf of collectStringLeaves(locale)) {
          const location = `${language}/${module}/${leaf.path}`;
          expect(leaf.value, `${location} must not contain the Forge wordmark`).not.toMatch(FORGE_WORDMARK);
          if (/AionUi/i.test(leaf.value)) {
            expect(UPSTREAM_AIONUI_ALLOWLIST, `${location} is not an approved upstream attribution`).toContain(
              `${module}.${leaf.path}`
            );
          }
        }
      }
    }
  });

  it('provides complete localized upstream attribution and channel-conflict copy', () => {
    const reference = readJson<JsonValue>('packages/desktop/src/renderer/services/i18n/locales/en-US/settings.json');
    const referenceConflict = getNestedValue(reference, 'channelConflict');
    expect(referenceConflict).toBeDefined();
    const referencePaths = collectStringLeaves(referenceConflict ?? {})
      .map((leaf) => leaf.path)
      .toSorted();

    for (const language of i18nConfig.supportedLanguages) {
      const settings = readJson<JsonValue>(
        `packages/desktop/src/renderer/services/i18n/locales/${language}/settings.json`
      );
      const upstream = getNestedValue(settings, 'upstreamAionUiDocumentation');
      expect(
        typeof upstream === 'string' && upstream.trim().length > 0,
        `${language}/settings/upstreamAionUiDocumentation`
      ).toBe(true);

      const conflict = getNestedValue(settings, 'channelConflict');
      const leaves = collectStringLeaves(conflict ?? {});
      expect(leaves.map((leaf) => leaf.path).toSorted(), `${language}/settings/channelConflict`).toEqual(
        referencePaths
      );
      for (const leaf of leaves) {
        expect(leaf.value.trim(), `${language}/settings/channelConflict.${leaf.path}`).not.toBe('');
      }
    }
  });

  it('describes migration and repair diagnostics as a local save in every locale', () => {
    const descriptionPaths = ['backendStartup.dataMigration.description', 'backendStartup.localDataRepair.description'];
    const reference = readJson<JsonValue>('packages/desktop/src/renderer/services/i18n/locales/en-US/common.json');

    for (const descriptionPath of descriptionPaths) {
      const english = getNestedValue(reference, descriptionPath);
      expect(english, `en-US/common/${descriptionPath}`).toMatch(/Save the diagnostic package locally/);
      expect(english, `en-US/common/${descriptionPath}`).not.toMatch(/send a diagnostics report|contact support/i);

      for (const language of i18nConfig.supportedLanguages) {
        const common = readJson<JsonValue>(
          `packages/desktop/src/renderer/services/i18n/locales/${language}/common.json`
        );
        const description = getNestedValue(common, descriptionPath);
        expect(
          typeof description === 'string' && description.trim().length > 0,
          `${language}/common/${descriptionPath}`
        ).toBe(true);
        expect(description, `${language}/common/${descriptionPath}`).not.toMatch(
          /send a diagnostics report|contact support/i
        );
        if (language !== i18nConfig.referenceLanguage) {
          expect(description, `${language}/common/${descriptionPath} must be localized`).not.toBe(english);
        }
      }
    }
  });

  it('uses localized upstream attribution rather than hardcoded product copy in retained setup guides', () => {
    const sourceFiles = [
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/ModelModalContent/index.tsx',
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/ToolsModalContent.tsx',
      'packages/desktop/src/renderer/pages/settings/AgentSettings/LocalAgents.tsx',
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/DingTalkConfigForm.tsx',
    ];

    for (const file of sourceFiles) {
      const source = sourceWithoutLicense(file);
      expect(source, `${file} should label retained upstream docs`).toContain(
        "t('settings.upstreamAionUiDocumentation')"
      );
      let sourceWithoutAllowedUpstreamReferences = source.replaceAll('settings.upstreamAionUiDocumentation', '');
      for (const url of UPSTREAM_AIONUI_GUIDE_URLS) {
        sourceWithoutAllowedUpstreamReferences = sourceWithoutAllowedUpstreamReferences.replaceAll(url, '');
      }
      expect(
        sourceWithoutAllowedUpstreamReferences,
        `${file} should not render unqualified AionUi product copy`
      ).not.toMatch(/AionUi/i);
    }
  });

  it('moves changed product-facing copy behind localized keys', () => {
    const sourceFiles = [
      'packages/desktop/src/renderer/components/agent/ChannelConflictWarning.tsx',
      'packages/desktop/src/renderer/components/base/ButlerDiagnoseButton.tsx',
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/FeedbackReportModal.tsx',
      'packages/desktop/src/renderer/components/settings/SettingsModal/contents/channels/ChannelModalContent.tsx',
    ];

    for (const file of sourceFiles) {
      const source = sourceWithoutLicense(file);
      expect(source, `${file} should not embed a legacy product wordmark`).not.toMatch(/AionUi|AionUI|Forge/);
    }
    expect(sourceWithoutLicense('packages/desktop/src/renderer/components/agent/ChannelConflictWarning.tsx')).toContain(
      "t('settings.channelConflict."
    );
  });

  it('keeps employee-visible NSIS detail messages free of the legacy product name', () => {
    const installerFiles = collectFiles(path.join(repoRoot, 'resources/windows'), '.nsh');

    for (const file of installerFiles) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/DetailPrint\s+([`"])(.*?)\1/g)) {
        const visibleLiteral = match[2].replace(/\$[A-Za-z0-9_]+/g, '');
        expect(visibleLiteral, `${path.relative(repoRoot, file)} contains stale installer copy`).not.toMatch(
          /\bAionUi\b/i
        );
      }
    }
  });

  it('does not present the Skills Market description as a link without a destination', () => {
    const banner = sourceWithoutLicense('packages/desktop/src/renderer/pages/guid/components/SkillsMarketBanner.tsx');
    expect(banner).not.toContain('skillsMarketDetails');

    for (const language of i18nConfig.supportedLanguages) {
      const conversation = readJson<JsonValue>(
        `packages/desktop/src/renderer/services/i18n/locales/${language}/conversation.json`
      );
      expect(getNestedValue(conversation, 'welcome.skillsMarketDetails'), `${language} retains a false CTA`).toBe(
        undefined
      );
    }
  });

  it('keeps routed About removed and redirects its legacy route to system settings', () => {
    const navigation = sourceWithoutLicense('packages/desktop/src/renderer/components/layout/Router.tsx');
    const settingsModal = sourceWithoutLicense(
      'packages/desktop/src/renderer/components/settings/SettingsModal/index.tsx'
    );

    expect(navigation).toContain("path='/settings/about'");
    expect(navigation).toContain("to='/settings/system'");
    expect(navigation).not.toContain('AboutModalContent');
    expect(settingsModal).not.toContain('AboutModalContent');
  });

  it('uses WePrompt in renderer and WebUI metadata', () => {
    const rendererIndex = readFileSync(path.join(repoRoot, 'packages/desktop/src/renderer/index.html'), 'utf8');
    const manifest = readJson<{ description: string; name: string; short_name: string }>('public/manifest.webmanifest');

    expect(rendererIndex).toMatch(/<meta name="application-name" content="WePrompt" \/>/);
    expect(rendererIndex).toMatch(/<meta name="apple-mobile-web-app-title" content="WePrompt" \/>/);
    expect(rendererIndex).toContain('<title>WePrompt</title>');
    expect(manifest).toMatchObject({
      name: 'WePrompt',
      short_name: 'WePrompt',
      description: expect.stringContaining('WePrompt'),
    });
  });
});
