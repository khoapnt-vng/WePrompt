/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import i18next from 'i18next';
import { describe, expect, it } from 'vitest';
import i18nConfig from '@/common/config/i18n-config.json';

type JsonObject = Record<string, unknown>;

const localeRoot = new URL('../../../../packages/desktop/src/renderer/services/i18n/locales/', import.meta.url);

const plannedGroups = [
  'close',
  'create',
  'draft',
  'empty',
  'errors',
  'export',
  'inspector',
  'jobs',
  'library',
  'models',
  'nav',
  'phase',
  'preview',
  'project',
  'reference',
  'review',
  'routing',
  'scene',
  'storyboard',
  'timeline',
  'transition',
] as const;

const phaseKeys = [
  'phase.nav.label',
  'phase.nav.brief',
  'phase.nav.write',
  'phase.nav.produce',
  'phase.nav.review',
  'phase.nav.saved',
  'phase.nav.saving',
  'phase.shared.backToLibrary',
  'phase.shared.noMediaGeneration',
  'phase.brief.title',
  'phase.brief.description',
  'phase.brief.nameLabel',
  'phase.brief.intentLabel',
  'phase.brief.durationLabel',
  'phase.brief.aspectRatioLabel',
  'phase.brief.startWriting',
  'phase.brief.saved',
  'phase.brief.saving',
  'phase.brief.unsaved',
  'phase.brief.invalidName',
  'phase.brief.aspectLocked',
  'phase.brief.aspectLockedHelp',
  'phase.write.title',
  'phase.write.continueToProduce',
  'phase.write.askAssistant',
  'phase.write.assistantTitle',
  'phase.write.assistantDescription',
  'phase.write.textChargeDisclosure',
  'phase.write.draftStoryboard',
  'phase.write.addShot',
  'phase.write.fitToGoal',
  'phase.write.noScenes',
  'phase.write.scriptTableTitle',
  'phase.write.scriptTableHelp',
  'phase.write.shotColumn',
  'phase.write.scriptColumn',
  'phase.write.visualColumn',
  'phase.write.outputColumn',
  'phase.write.visualPlaceholder',
  'phase.write.suggestVisual',
  'phase.write.addReference',
  'phase.write.moreDetails',
  'phase.write.invalidTitle',
  'phase.write.placeholder.opening',
  'phase.write.placeholder.middle',
  'phase.write.placeholder.closing',
  'phase.write.needsTitle',
  'phase.write.pacingTitle',
  'phase.write.pacingSummary',
  'phase.write.goalMarker',
  'phase.produce.reviewCut',
  'phase.produce.modelsTitle',
  'phase.produce.activityTitle',
  'phase.produce.activityEmpty',
  'phase.produce.jobsRunning',
  'phase.review.title',
  'phase.review.description',
  'phase.review.handoff',
  'phase.review.noAssets',
  'phase.review.selectedTake',
  'phase.review.slateLabel',
  'phase.review.slateDescription',
  'phase.review.excludedFromHandoff',
  'phase.review.renderedShots',
  'phase.review.missingSlates',
  'phase.review.openProduce',
  'phase.review.handoffDescription',
  'phase.review.partialHandoff',
  'transition.savingBlocked',
] as const;

const phasePluralLogicalKeys = [
  'phase.produce.jobsRunning',
  'phase.review.renderedShots',
  'phase.review.missingSlates',
] as const;

const closeKeys = [
  'close.saveAndClose',
  'close.discard',
  'close.cancel',
  'close.unsavedMessage',
  'close.unavailableMessage',
] as const;

const taskSevenKeys = [
  'nav.title',
  'library.title',
  'library.subtitle',
  'library.loading',
  'library.retry',
  'library.readinessLabel',
  'library.readinessSetupRequired',
  'library.openProject',
  'library.deleteProject',
  'library.deleteConfirmTitle',
  'library.deleteConfirmBody',
  'library.deleteActiveWork',
  'library.deleteConfirm',
  'empty.title',
  'empty.body',
  'empty.create',
  'create.title',
  'create.nameLabel',
  'create.namePlaceholder',
  'create.aspectRatio16x9',
  'create.aspectRatio9x16',
  'create.aspectRatio1x1',
  'create.aspectRatio4x3',
  'create.aspectRatio3x4',
  'create.invalidDuration',
  'create.cancel',
  'project.loading',
  'project.notFound',
  'project.title',
  'project.brief',
  'project.aspectRatio',
  'project.targetDuration',
  'project.resolution',
  'project.sceneCount',
  'project.readiness',
] as const;

const stableMessageKeys = [
  'errors.invalidPayload',
  'errors.projectNotFound',
  'errors.storyboardExists',
  'errors.staleProject',
  'errors.planningUnavailable',
  'errors.invalidRoute',
  'errors.cancellationRefused',
  'errors.duplicateChargeAcknowledgementRequired',
  'errors.busy',
  'errors.provider',
  'errors.storage',
  'jobs.errors.invalidRequest',
  'jobs.errors.auth',
  'jobs.errors.quota',
  'jobs.errors.rateLimited',
  'jobs.errors.providerUnavailable',
  'jobs.errors.timeout',
  'jobs.errors.pollDeadline',
  'jobs.errors.noOutput',
  'jobs.errors.submissionUnknown',
  'jobs.errors.downloadFailed',
  'jobs.errors.unsupported',
  'jobs.errors.unknown',
] as const;

const ordinaryRetryConfirmationKeys = [
  'jobs.retryConfirmationTitle',
  'jobs.retryConfirmationBody',
  'jobs.retryConfirmationConfirm',
] as const;

const readinessActionKeys = [
  'review.noReadyScenes',
  'preview.missingVisualPrompt',
  'preview.missingModel',
  'preview.generateThisScene',
] as const;

const renderStateAndExportKeys = [
  'phase.review.render.progressWithClip',
  'phase.review.render.busyReason',
  'phase.review.render.installFfmpeg',
  'phase.review.render.tryAgain',
  'phase.review.render.openProduce',
  'phase.review.render.errors.failedClip',
  'phase.review.render.errors.noRenderableShots',
  'export.checkingRender',
  'export.noRender',
  'export.renderedAt',
  'export.staleRender',
  'export.latestRenderUnavailable',
] as const;

const pluralLogicalKeys = [
  'export.confirmSelectedCount',
  'export.gapWarning',
  'phase.review.render.errors.noRenderableShots',
  'library.shotCount',
  'library.projectCount',
  'close.unsavedMessage',
  'export.successBody',
  'review.generateReadyScenes',
  'scene.durationSeconds',
  'timeline.totalDurationFull',
  'timeline.selectSceneAccessible',
  'review.selectedDurationFull',
  'review.targetDurationFull',
  ...phasePluralLogicalKeys,
] as const;

const streamFullSentenceKeys = [
  'storyboard.dragSceneAccessible',
  'storyboard.moveSceneUpAccessible',
  'storyboard.moveSceneDownAccessible',
  'storyboard.removeSceneAccessible',
  'preview.selectVersionAccessible',
  'phase.shared.noMediaGeneration',
  'phase.brief.description',
  'phase.brief.invalidName',
  'phase.brief.aspectLockedHelp',
  'phase.write.assistantDescription',
  'phase.write.textChargeDisclosure',
  'phase.write.noScenes',
  'phase.write.scriptTableHelp',
  'phase.write.visualPlaceholder',
  'phase.write.invalidTitle',
  'phase.produce.activityEmpty',
  'phase.review.description',
  'phase.review.noAssets',
  'phase.review.slateDescription',
  'phase.review.excludedFromHandoff',
  'phase.review.handoffDescription',
  'phase.review.partialHandoff',
  'transition.savingBlocked',
  ...pluralLogicalKeys,
] as const;

type PluralResolver = {
  getSuffix(locale: string, count: number): string;
  getSuffixes(locale: string): string[];
};

function loadConversationLocale(locale: string): JsonObject {
  const localeUrl = new URL(`${locale}/conversation.json`, localeRoot);
  return JSON.parse(readFileSync(localeUrl, 'utf8')) as JsonObject;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function flattenStringLeaves(value: unknown, prefix = ''): Record<string, string> {
  if (typeof value === 'string') {
    return { [prefix]: value };
  }

  if (!isJsonObject(value)) {
    return {};
  }

  const leaves: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const childPrefix = prefix ? `${prefix}.${key}` : key;
    Object.assign(leaves, flattenStringLeaves(child, childPrefix));
  }
  return leaves;
}

function getPlaceholders(value: string): string[] {
  return (value.match(/{{[^{}]+}}/g) ?? []).toSorted();
}

function isPluralVariantKey(key: string): boolean {
  return pluralLogicalKeys.some((base) => key.startsWith(`${base}_`));
}

const truthfulAssistantDescriptions: Record<string, string> = {
  'zh-CN': '根据创作简报生成故事板草稿。',
  'en-US': 'Draft a storyboard from your brief.',
  'ja-JP': 'ブリーフをもとにストーリーボードの下書きを作成します。',
  'zh-TW': '根據創作簡報產生分鏡腳本草稿。',
  'ko-KR': '브리프를 바탕으로 스토리보드 초안을 만듭니다.',
  'tr-TR': 'Kısa açıklamanızdan bir storyboard taslağı oluşturun.',
  'ru-RU': 'Создайте черновик раскадровки на основе брифа.',
  'uk-UA': 'Створіть чернетку розкадрування на основі брифу.',
  'pt-BR': 'Crie um rascunho de storyboard a partir do seu briefing.',
  'de-DE': 'Erstelle aus deinem Briefing einen Storyboard-Entwurf.',
  'es-ES': 'Crea un borrador de storyboard a partir de tu brief.',
  'fa-IR': 'از شرح مختصر خود یک پیش‌نویس استوری‌بورد بسازید.',
};

describe('Creative Studio localization contract', () => {
  it('describes the Write assistant truthfully in every configured locale', () => {
    expect(Object.keys(truthfulAssistantDescriptions).toSorted()).toEqual(
      [...i18nConfig.supportedLanguages].toSorted()
    );

    for (const locale of i18nConfig.supportedLanguages) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const description = flattenStringLeaves(creativeStudio)['phase.write.assistantDescription'];

      expect(description, `${locale}/phase.write.assistantDescription`).toBe(truthfulAssistantDescriptions[locale]);
    }
  });

  it.each(i18nConfig.supportedLanguages)(
    'keeps the %s ordinary-retry confirmation free of price-like numerals',
    (locale) => {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const leaves = flattenStringLeaves(creativeStudio);

      for (const key of ordinaryRetryConfirmationKeys) {
        const value = leaves[key];
        expect(value, `${locale}/${key} must exist`).toBeTruthy();
        expect(value, `${locale}/${key} must not contain a price-like numeral`).not.toMatch(/\p{N}/u);
      }
    }
  );

  it('states that ordinary retry resubmits to the provider and may incur provider charges', () => {
    const creativeStudio = loadConversationLocale(i18nConfig.referenceLanguage).creativeStudio;
    const body = flattenStringLeaves(creativeStudio)['jobs.retryConfirmationBody'];

    expect(body).toBe('Retrying resubmits this generation to the provider and may incur provider charges.');
  });

  // Asserts the ABSENCE of a fabricated cost fragment rather than exact wording,
  // so improving a translation does not fail the guard while re-adding a fake
  // price still does.
  it.each(i18nConfig.supportedLanguages)('keeps the %s render actions free of fabricated cost fragments', (locale) => {
    const creativeStudio = loadConversationLocale(locale).creativeStudio;
    const leaves = flattenStringLeaves(creativeStudio);

    for (const key of ['phase.produce.render', 'phase.produce.renderAnother'] as const) {
      const label = leaves[key];
      expect(label, `${locale}/${key} must exist`).toBeTruthy();
      expect(label, `${locale}/${key} must not carry a fabricated cost`).not.toMatch(
        /n\/a|n\/d|k\.\s?A\.|不适用|該当なし|해당\s?없음|\bcr\b|credits?/i
      );
      expect(label, `${locale}/${key} must not end in a dangling separator`).not.toMatch(/[·:\-–—]\s*$/);
    }
  });

  it('defines the complete planned group, phase-shell, and Task 7 key contract in the reference locale', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage);
    const creativeStudio = reference.creativeStudio;

    expect(isJsonObject(creativeStudio), 'en-US conversation.creativeStudio must be an object').toBe(true);
    if (!isJsonObject(creativeStudio)) return;

    expect(Object.keys(creativeStudio).toSorted()).toEqual([...plannedGroups].toSorted());

    const leaves = flattenStringLeaves(creativeStudio);
    for (const key of taskSevenKeys) {
      expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
    }
    for (const key of phaseKeys) {
      expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
    }
    for (const key of closeKeys) {
      expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
    }
  });

  it('renders the close handshake vocabulary and required Slavic plurals in every locale', async () => {
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversationLocale(locale);
      const instance = i18next.createInstance();
      await instance.init({
        lng: locale,
        fallbackLng: false,
        resources: { [locale]: { translation: { conversation } } },
        interpolation: { escapeValue: false },
      });

      for (const closeKey of closeKeys) {
        const key = `conversation.creativeStudio.${closeKey}`;
        const rendered = instance.t(key, closeKey === 'close.unsavedMessage' ? { count: 2 } : undefined);
        if (!rendered.trim() || rendered === key || rendered.includes('conversation.creativeStudio.')) {
          issues.push(`${locale}.${closeKey} rendered ${rendered}`);
        }
      }

      if (locale === 'ru-RU' || locale === 'uk-UA') {
        const close = (conversation.creativeStudio as JsonObject | undefined)?.close;
        for (const suffix of ['one', 'few', 'many', 'other']) {
          if (!isJsonObject(close) || typeof close[`unsavedMessage_${suffix}`] !== 'string') {
            issues.push(`${locale}.close.unsavedMessage_${suffix} missing`);
          }
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('renders the complete phase vocabulary in every configured locale without exposing raw keys', async () => {
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversationLocale(locale);
      const instance = i18next.createInstance();
      await instance.init({
        lng: locale,
        fallbackLng: false,
        resources: { [locale]: { translation: { conversation } } },
        interpolation: { escapeValue: false },
      });

      for (const phaseKey of phaseKeys) {
        const key = `conversation.creativeStudio.${phaseKey}`;
        const rendered = instance.t(key, phasePluralLogicalKeys.includes(phaseKey) ? { count: 2 } : undefined);
        if (!rendered.trim() || rendered === key || rendered.includes('conversation.creativeStudio.')) {
          issues.push(`${locale}.${phaseKey} rendered ${rendered}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('does not retain Studio connection ownership or App Operations copy', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage);
    const creativeStudio = reference.creativeStudio;
    expect(isJsonObject(creativeStudio)).toBe(true);
    if (!isJsonObject(creativeStudio)) return;

    expect(creativeStudio.connection).toBeUndefined();
    expect(JSON.stringify(creativeStudio)).not.toContain('App Operations');
  });

  it('explains that imported media also protects a scene from deletion', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage).creativeStudio;
    const leaves = flattenStringLeaves(reference);
    const expected = 'Scenes with imported or generated media, or generation history, cannot be removed.';

    expect(leaves['storyboard.removeConfirmBody']).toBe(expected);
    expect(leaves['storyboard.removeBlocked']).toBe(expected);
  });

  it('keeps every configured locale exactly in parity, non-empty, translated, and placeholder-compatible', () => {
    const reference = loadConversationLocale(i18nConfig.referenceLanguage).creativeStudio;
    expect(isJsonObject(reference), 'Reference Creative Studio subtree is missing').toBe(true);
    if (!isJsonObject(reference)) return;

    const issues: string[] = [];
    const referenceLeaves = flattenStringLeaves(reference);
    const referenceKeys = Object.keys(referenceLeaves)
      .filter((key) => !isPluralVariantKey(key))
      .toSorted();
    const configuredLocales = i18nConfig.supportedLanguages.toSorted();

    for (const locale of configuredLocales) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      if (!isJsonObject(creativeStudio)) {
        issues.push(`${locale} is missing conversation.creativeStudio`);
        continue;
      }

      const localeLeaves = flattenStringLeaves(creativeStudio);
      const localeKeys = Object.keys(localeLeaves)
        .filter((key) => !isPluralVariantKey(key))
        .toSorted();
      const missingKeys = referenceKeys.filter((key) => !(key in localeLeaves));
      const extraKeys = localeKeys.filter((key) => !(key in referenceLeaves));

      if (missingKeys.length > 0) {
        issues.push(`${locale} is missing: ${missingKeys.join(', ')}`);
      }
      if (extraKeys.length > 0) {
        issues.push(`${locale} has extra keys: ${extraKeys.join(', ')}`);
      }

      for (const key of referenceKeys) {
        const value = localeLeaves[key];
        if (value === undefined) continue;

        if (value.trim().length === 0) {
          issues.push(`${locale}.${key} is empty`);
        }

        const expectedPlaceholders = getPlaceholders(referenceLeaves[key]);
        const actualPlaceholders = getPlaceholders(value);
        if (expectedPlaceholders.join('\n') !== actualPlaceholders.join('\n')) {
          issues.push(
            `${locale}.${key} placeholders ${actualPlaceholders.join(', ')} do not match ${expectedPlaceholders.join(', ')}`
          );
        }
      }

      if (locale !== i18nConfig.referenceLanguage) {
        const copiedStreamKeys = streamFullSentenceKeys.filter((key) => localeLeaves[key] === referenceLeaves[key]);
        if (copiedStreamKeys.length > 0) {
          issues.push(`${locale} copies new English full-sentence keys: ${copiedStreamKeys.join(', ')}`);
        }

        const copiedKeys = referenceKeys.filter((key) => localeLeaves[key] === referenceLeaves[key]);
        const maximumCopiedLeaves = Math.max(4, Math.floor(referenceKeys.length * 0.05));
        if (copiedKeys.length > maximumCopiedLeaves) {
          issues.push(`${locale} leaves too much English copy (${copiedKeys.length} keys): ${copiedKeys.join(', ')}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('defines and behaviorally resolves every locale-specific plural category', async () => {
    const issues: string[] = [];
    const categoryCandidates = [0, 1, 2, 3, 4, 5, 10, 11, 12, 20, 21, 22, 25, 100, 1_000_000, 1.5];
    const referenceLeaves = flattenStringLeaves(loadConversationLocale(i18nConfig.referenceLanguage).creativeStudio);

    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversationLocale(locale);
      const creativeStudio = conversation.creativeStudio;
      if (!isJsonObject(creativeStudio)) {
        issues.push(`${locale} is missing conversation.creativeStudio`);
        continue;
      }

      const leaves = flattenStringLeaves(creativeStudio);
      const instance = i18next.createInstance();
      await instance.init({
        lng: locale,
        fallbackLng: false,
        resources: { [locale]: { translation: { conversation } } },
        interpolation: { escapeValue: false },
      });
      const resolver = (instance.services as unknown as { pluralResolver: PluralResolver }).pluralResolver;
      const suffixes = resolver.getSuffixes(locale);
      const categoryCounts = suffixes.flatMap((suffix) => {
        const count = categoryCandidates.find((candidate) => resolver.getSuffix(locale, candidate) === suffix);
        if (count === undefined) {
          issues.push(`${locale} has no exercised count for ${suffix}`);
          return [];
        }
        return [count];
      });

      if (locale === 'ru-RU' || locale === 'uk-UA') {
        expect(suffixes).toEqual(['_one', '_few', '_many', '_other']);
      }

      for (const base of pluralLogicalKeys) {
        const fallback = leaves[base];
        if (!fallback?.trim()) {
          issues.push(`${locale} is missing plural fallback conversation.creativeStudio.${base}`);
          continue;
        }

        const expectedVariantKeys = suffixes.map((suffix) => `${base}${suffix}`).toSorted();
        const actualVariantKeys = Object.keys(leaves)
          .filter((key) => key.startsWith(`${base}_`))
          .toSorted();
        if (actualVariantKeys.join('\n') !== expectedVariantKeys.join('\n')) {
          issues.push(
            `${locale}.${base} variants ${actualVariantKeys.join(', ')} do not match ${expectedVariantKeys.join(', ')}`
          );
        }

        const fallbackPlaceholders = getPlaceholders(fallback);
        const referenceTemplates = new Set(
          Object.entries(referenceLeaves)
            .filter(([key]) => key === base || key.startsWith(`${base}_`))
            .map(([, value]) => value)
        );
        for (const variantKey of expectedVariantKeys) {
          const variant = leaves[variantKey];
          if (!variant?.trim()) {
            issues.push(`${locale} is missing conversation.creativeStudio.${variantKey}`);
            continue;
          }
          if (getPlaceholders(variant).join('\n') !== fallbackPlaceholders.join('\n')) {
            issues.push(`${locale}.${variantKey} placeholders do not match ${base}`);
          }
          if (locale !== i18nConfig.referenceLanguage && referenceTemplates.has(variant)) {
            issues.push(`${locale}.${variantKey} copies the English plural text`);
          }
        }

        const counts = [...new Set([0, 1, 2, 5, ...categoryCounts])];
        for (const count of counts) {
          const key = `conversation.creativeStudio.${base}`;
          const details = instance.t(key, {
            count,
            seconds: count,
            number: 2,
            shots: '03',
            title: 'Product close-up',
            returnDetails: true,
          });
          const expectedExactKey = `${key}${resolver.getSuffix(locale, count)}`;
          const expectedRenderedValue =
            base === 'export.gapWarning' || base === 'phase.review.render.errors.noRenderableShots'
              ? '03'
              : String(count);
          if (typeof details.res !== 'string' || !details.res.includes(expectedRenderedValue)) {
            issues.push(`${locale}.${base} did not render count ${count}`);
          }
          if (details.res === key) issues.push(`${locale}.${base} returned the raw key for ${count}`);
          if (details.exactUsedKey !== expectedExactKey) {
            issues.push(`${locale}.${base} used ${details.exactUsedKey} instead of ${expectedExactKey} for ${count}`);
          }
        }

        if (locale === 'ru-RU' || locale === 'uk-UA') {
          const normalizedTemplates = ['_one', '_few', '_many'].map((suffix) =>
            leaves[`${base}${suffix}`]?.replaceAll('{{count}}', '{{value}}').replaceAll('{{seconds}}', '{{value}}')
          );
          if (new Set(normalizedTemplates).size !== 3) {
            issues.push(`${locale}.${base} one/few/many templates must be distinct`);
          }
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('resolves every stable bridge and durable-job message key in every locale', () => {
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const leaves = flattenStringLeaves(creativeStudio);

      for (const key of stableMessageKeys) {
        if (!leaves[key]?.trim()) {
          issues.push(`${locale} is missing conversation.creativeStudio.${key}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('localizes every R4 render-state and pre-export metadata message in every configured locale', () => {
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const leaves = flattenStringLeaves(creativeStudio);

      for (const key of renderStateAndExportKeys) {
        if (!leaves[key]?.trim()) {
          issues.push(`${locale} is missing conversation.creativeStudio.${key}`);
        }
      }
    }

    expect(issues).toEqual([]);
  });

  it('localizes every readiness action and blocker in every configured locale', () => {
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const leaves = flattenStringLeaves(creativeStudio);

      for (const key of readinessActionKeys) {
        if (!leaves[key]?.trim()) issues.push(`${locale} is missing conversation.creativeStudio.${key}`);
      }
    }

    expect(issues).toEqual([]);
  });

  it('distinguishes preserved dirty edits from saved scenes in Russian and Ukrainian', () => {
    const expectedDirtyCopy = {
      'ru-RU': 'Несохранённые изменения не потеряны.',
      'uk-UA': 'Незбережені зміни не втрачено.',
    } as const;

    for (const [locale, expected] of Object.entries(expectedDirtyCopy)) {
      const creativeStudio = loadConversationLocale(locale).creativeStudio;
      const leaves = flattenStringLeaves(creativeStudio);

      expect(leaves['inspector.unsavedChanges']).toBe(expected);
      expect(leaves['inspector.unsavedChanges']).not.toBe(leaves['inspector.saved']);
    }
  });
});
