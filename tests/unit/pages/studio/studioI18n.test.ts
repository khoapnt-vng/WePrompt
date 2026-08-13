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
  'brief',
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
  'rules',
  'scene',
  'shell',
  'storyboard',
  'timeline',
  'transition',
] as const;

const briefKeys = [
  'brief.conversationTitle',
  'brief.danglingNotice',
  'brief.danglingStartFresh',
  'brief.proposalTitle',
  'brief.proposalMeta',
  'brief.proposalSummary',
  'brief.proposalAccept',
  'brief.proposalReject',
  'brief.proposalAccepted',
  'brief.proposalRejected',
  'brief.proposalExpired',
  'brief.proposalStale',
  'brief.proposalRepropose',
  'brief.proposalFlushRefused',
] as const;

/**
 * Every entry is rendered by code in Tasks 7-14, and each is named next to its render site so the
 * list cannot quietly outlive a surface. `check-i18n.js` has no unused-key detection, and this
 * presence loop pins whatever it lists into all twelve locales, so every entry must have a shipped
 * surface.
 */
const rulesKeys = [
  'rules.open', // StudioPhaseShell, Rules button
  'rules.title', // StudioRulesDrawer, Drawer title
  'rules.description', // StudioRulesDrawer
  'rules.precedence', // StudioRulesDrawer
  'rules.empty', // StudioRulesDrawer, both layers empty
  'rules.scope.organisation', // StudioRulesDrawer, scope Tag
  'rules.scope.project', // StudioRulesDrawer, scope Tag
  'rules.scope.organisationLocked', // StudioRulesDrawer, locked Tag
  'rules.contextOnlyBadge', // StudioRulesDrawer, enforcement Tag + legend
  'rules.enforcedBadge', // StudioRulesDrawer, enforcement Tag + legend
  'rules.removeAccessible', // StudioRulesDrawer, per-rule aria-label
  'rules.remove', // StudioRulesDrawer, per-rule button text
  'rules.undo', // StudioRulesDrawer, undo button
  'rules.undoAdded', // StudioRulesDrawer, added-rule undo notice
  'rules.undoRemoved', // StudioRulesDrawer, removed-rule undo notice
  'rules.undoChanged', // StudioRulesDrawer, changed-list undo notice
  'rules.enforcedHelp', // StudioRulesDrawer, badge legend
  'rules.contextOnlyHelp', // StudioRulesDrawer, badge legend
  'rules.textLabel', // StudioRulesDrawer, label + aria-label
  'rules.textPlaceholder', // StudioRulesDrawer
  'rules.invalidText', // StudioRulesDrawer, empty-text alert
  'rules.textTooLong', // StudioRulesDrawer, overlong-text alert
  'rules.tooManyTerms', // StudioRulesDrawer, term-count alert
  'rules.termTooLong', // StudioRulesDrawer, overlong-term alert
  'rules.termUnusable', // StudioRulesDrawer, unusable-term alert
  'rules.duplicateTerm', // StudioRulesDrawer, duplicate-term alert
  'rules.termsLabel', // StudioRulesDrawer, label + aria-label
  'rules.termsPlaceholder', // StudioRulesDrawer
  'rules.termsHelp', // StudioRulesDrawer
  'rules.limitReached', // StudioRulesDrawer, at the cap
  'rules.add', // StudioRulesDrawer, submit
  'rules.breachScene', // GenerationReviewModal, per-scene Alert
  'rules.breachBlockedConfirm', // GenerationReviewModal, disabledReason
  'rules.breachAskDirector', // GenerationReviewModal, escape hatch
  'rules.autoSubmitBlocked', // StudioPage, queued-reference guard
  'rules.proposalTitle', // DirectorProposalCard, pin_rule Card title
  'rules.proposalBody', // DirectorProposalCard, pin_rule
  'rules.proposalTerms', // DirectorProposalCard, pin_rule predicate
  'errors.ruleBreach', // creativeStudioBridge + useStudioJobs rule_breach mapping
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
  'phase.shared.activityLabel',
  'phase.shared.activityGenerating',
  'phase.shared.activityRendering',
  'phase.shared.activityRenderingLabel',
  'phase.brief.title',
  'phase.brief.description',
  'phase.brief.nameLabel',
  'phase.brief.intentLabel',
  'phase.brief.durationLabel',
  'phase.brief.aspectRatioLabel',
  'phase.brief.startWriting',
  'phase.brief.invalidName',
  'phase.brief.aspectLocked',
  'phase.brief.aspectLockedHelp',
  'phase.write.title',
  'phase.write.continueToProduce',
  'phase.write.addShot',
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
  'phase.shared.activityGenerating',
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
  'shell.directorStarting',
  'rules.description',
  'rules.precedence',
  'rules.empty',
  'rules.removeAccessible',
  'rules.undoAdded',
  'rules.undoRemoved',
  'rules.undoChanged',
  'rules.enforcedHelp',
  'rules.contextOnlyHelp',
  'rules.textPlaceholder',
  'rules.invalidText',
  'rules.textTooLong',
  'rules.tooManyTerms',
  'rules.termTooLong',
  'rules.termUnusable',
  'rules.duplicateTerm',
  'rules.termsPlaceholder',
  'rules.termsHelp',
  'rules.limitReached',
  'rules.breachScene',
  'rules.breachBlockedConfirm',
  'rules.autoSubmitBlocked',
  'rules.proposalBody',
  'errors.ruleBreach',
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

/**
 * Copy that belonged to Write's own writing assistant, which D10 removed.
 *
 * Deleting a surface leaves its strings behind in twelve files, where nothing complains about them:
 * `check-i18n.js` only compares locales against each other, so an orphan present everywhere looks
 * perfectly healthy. This is what notices.
 */
const removedWriteAssistantKeys = [
  'phase.write.askAssistant',
  'phase.write.assistantTitle',
  'phase.write.assistantDescription',
  'phase.write.textChargeDisclosure',
  'phase.write.draftStoryboard',
] as const;

describe('Creative Studio localization contract', () => {
  it('carries no copy for the Write assistant it removed, in any configured locale', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const leaves = flattenStringLeaves(loadConversationLocale(locale).creativeStudio);
      // Guards the guard: a wrong path or an empty read would make every absence assertion pass.
      expect(leaves['phase.write.suggestVisual'], `${locale}/phase.write.suggestVisual`).toBeTruthy();
      for (const key of removedWriteAssistantKeys) {
        expect(leaves[key], `${locale}/${key} outlived the surface that used it`).toBeUndefined();
      }
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
    for (const key of briefKeys) {
      expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
    }
    for (const key of rulesKeys) {
      expect(leaves[key], `Missing conversation.creativeStudio.${key}`).toBeTruthy();
    }
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

  /**
   * The frame's header is the single save-state readout. Brief's copy went with its duplicate
   * readout; leaving the keys behind would let the duplicate be restored without a translation
   * round, which is how it comes back.
   */
  it('retains no copy for the Brief save-state readout the frame replaced', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const leaves = flattenStringLeaves(loadConversationLocale(locale).creativeStudio);

      for (const key of ['phase.brief.saved', 'phase.brief.saving', 'phase.brief.unsaved'] as const) {
        expect(leaves[key], `${locale}/${key} must be removed`).toBeUndefined();
      }
      // Guards the guard: a wrong lookup shape would make the assertions above vacuous.
      expect(leaves['phase.brief.startWriting'], `${locale}/phase.brief.startWriting`).toBeTruthy();
    }
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

  /**
   * Seven readiness states, not two.
   *
   * An earlier pass at this copy collapsed the row to a binary derived from whether a reference
   * image existed. That is not what readiness means: `studioReadiness.ts` never consults
   * `referenceAssetId`, and a reference image is optional. A scene with no plate is still ready to
   * produce, while one missing a title is not — so a scene could read "Ready to produce" and then
   * be silently excluded from Produce, or read "needs an image" when nothing was missing.
   *
   * Distinctness is the part that matters: collapsing two states onto one string is how the
   * information gets lost, and it cannot be seen by a key-presence check alone.
   */
  it('words every scene readiness state distinctly in every configured locale', () => {
    const readinessStates = [
      'needs_title',
      'needs_prompt',
      'generating',
      'needs_selection',
      'generated',
      'needs_attention',
      'ready',
    ] as const;
    const issues: string[] = [];

    for (const locale of i18nConfig.supportedLanguages) {
      const leaves = flattenStringLeaves(loadConversationLocale(locale).creativeStudio);
      const wordingToState = new Map<string, string>();

      for (const state of readinessStates) {
        const wording = leaves[`scene.status.${state}`]?.trim();
        if (!wording) {
          issues.push(`${locale} is missing conversation.creativeStudio.scene.status.${state}`);
          continue;
        }
        const clash = wordingToState.get(wording);
        if (clash !== undefined) {
          issues.push(`${locale} words scene.status.${state} the same as scene.status.${clash}: "${wording}"`);
        }
        wordingToState.set(wording, state);
      }
    }

    expect(issues).toEqual([]);
  });

  /**
   * Studio produces shots. "Ready to generate" describes the engine; the row describes the film.
   * `phase.write.needsTitle` is the same statement shown from an unsaved draft before readiness has
   * recomputed, so the two must never drift apart and say different things about one scene.
   */
  it('describes a ready scene in production language rather than engine language', () => {
    const leaves = flattenStringLeaves(loadConversationLocale('en-US').creativeStudio);

    expect(leaves['scene.status.ready']).toBe('Ready to produce');
    expect(leaves['phase.write.needsTitle']).toBe(leaves['scene.status.needs_title']);
  });
});
