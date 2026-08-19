/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import i18nConfig from '@/common/config/i18n-config.json';
import { mergeWithFallback } from '@/common/config/i18n';

type JsonObject = Record<string, unknown>;

const localeRoot = join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');
const referenceLocale = i18nConfig.referenceLanguage;
const deferredLocales = i18nConfig.supportedLanguages.filter((locale) => locale !== referenceLocale);

const loadConversation = (locale: string): JsonObject =>
  JSON.parse(readFileSync(join(localeRoot, locale, 'conversation.json'), 'utf8')) as JsonObject;

const asObject = (value: unknown, name: string): JsonObject => {
  expect(value, name).toBeTypeOf('object');
  expect(value, name).not.toBeNull();
  expect(Array.isArray(value), name).toBe(false);
  return value as JsonObject;
};

const workspaceOf = (conversation: JsonObject): JsonObject | undefined => {
  const creativeStudio = asObject(conversation.creativeStudio, 'creativeStudio');
  const workspace = creativeStudio.workspace;
  return workspace === undefined ? undefined : asObject(workspace, 'creativeStudio.workspace');
};

const flattenLeaves = (value: JsonObject, prefix = ''): Record<string, string> => {
  const leaves: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (typeof child === 'string') leaves[path] = child;
    else Object.assign(leaves, flattenLeaves(asObject(child, path), path));
  }
  return leaves;
};

const expectedLeaves = [
  'errors.storage',
  'project.backToLibrary',
  'project.loading',
  'project.notFound',
  'project.structure',
  'project.unsupportedPrototype',
  'views.title',
  'views.table',
  'views.board',
  'views.cut',
  'views.tablePending',
  'views.boardPending',
  'views.cutPending',
  'library.title',
  'library.subtitle',
  'library.loading',
  'library.empty',
  'library.sectionLabel',
  'library.projectCount',
  'library.projectCount_one',
  'library.projectCount_other',
  'library.unsupportedTitle',
  'library.quarantinedTitle',
  'library.cancel',
  'library.deleteConfirm',
  'library.deleteConfirmBody',
  'library.deleteConfirmTitle',
  'library.deleteProject',
  'library.noPoster',
  'library.posterBadge',
  'library.beatCount',
  'library.beatCount_one',
  'library.beatCount_other',
  'library.shotCount',
  'library.shotCount_one',
  'library.shotCount_other',
  'library.selectedTakeCount',
  'library.selectedTakeCount_one',
  'library.selectedTakeCount_other',
  'library.updated',
  'library.status.complete',
  'library.status.partial',
  'library.status.spineOnly',
  'library.composer.label',
  'library.composer.placeholder',
  'library.composer.aspectRatioLabel',
  'library.composer.durationLabel',
  'library.composer.durationGuess',
  'library.composer.submit',
  'library.composer.empty',
  'proposals.title',
  'proposals.revision',
  'proposals.pinRule',
  'proposals.mutationCount',
  'proposals.mutationCount_one',
  'proposals.mutationCount_other',
  'proposals.accept',
  'proposals.reject',
  'references.title',
  'references.shotCount',
  'references.shotCount_one',
  'references.shotCount_other',
  'references.generate',
  'references.reject',
  'handoffs.title',
  'handoffs.shotCount',
  'handoffs.shotCount_one',
  'handoffs.shotCount_other',
  'handoffs.awaitingGate',
  'review.title',
] as const;

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{{\s*([^},\s]+)(?:\s*,[^}]*)?\s*}}/g)].map((match) => match[1]!).sort();

describe('Creative Studio workspace translations', () => {
  const englishConversation = loadConversation(referenceLocale);
  const englishWorkspace = workspaceOf(englishConversation)!;

  it('keeps the exact renderer workspace inventory under one en-US subtree', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(Object.keys(leaves).sort()).toEqual([...expectedLeaves].sort());
    for (const [key, value] of Object.entries(leaves)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('keeps one/other variants paired with identical interpolation parameters', () => {
    const leaves = flattenLeaves(englishWorkspace);
    const pluralBases = Object.keys(leaves)
      .filter((key) => key.endsWith('_one'))
      .map((key) => key.slice(0, -'_one'.length));

    expect(pluralBases).toHaveLength(7);
    for (const base of pluralBases) {
      expect(leaves[`${base}_other`], `${base}_other`).toBeTypeOf('string');
      expect(placeholders(leaves[`${base}_one`]!)).toEqual(placeholders(leaves[`${base}_other`]!));
    }
  });

  it('defers all 11 translations and falls each locale back to the complete en-US workspace', () => {
    expect(deferredLocales).toHaveLength(11);

    for (const locale of deferredLocales) {
      const localeConversation = loadConversation(locale);
      expect(workspaceOf(localeConversation), locale).toBeUndefined();

      const merged = mergeWithFallback(englishConversation, localeConversation);
      expect(workspaceOf(merged), locale).toEqual(englishWorkspace);
    }
  });

  it('authors the media-in-use refusal key in en-US', () => {
    const creativeStudio = asObject(englishConversation.creativeStudio, 'creativeStudio');
    const errors = asObject(creativeStudio.errors, 'creativeStudio.errors');

    expect(errors.mediaInUse).toBe(
      'This reference is in use by a queued paid request. Finish or cancel that request before detaching it.'
    );
  });

  it('falls deferred close-dialog copy back to the Beat/Shot en-US wording', () => {
    const englishCreativeStudio = asObject(englishConversation.creativeStudio, 'creativeStudio');
    const englishClose = asObject(englishCreativeStudio.close, 'creativeStudio.close');
    const keys = ['unsavedMessage', 'unsavedMessage_one', 'unsavedMessage_other', 'unavailableMessage'] as const;

    for (const locale of deferredLocales) {
      const localeConversation = loadConversation(locale);
      const localeCreativeStudio = asObject(localeConversation.creativeStudio, `${locale}.creativeStudio`);
      const localeClose = asObject(localeCreativeStudio.close, `${locale}.creativeStudio.close`);
      for (const key of keys) expect(localeClose[key], `${locale}.${key}`).toBeUndefined();

      const merged = mergeWithFallback(englishConversation, localeConversation);
      const mergedCreativeStudio = asObject(merged.creativeStudio, `${locale}.merged.creativeStudio`);
      const mergedClose = asObject(mergedCreativeStudio.close, `${locale}.merged.creativeStudio.close`);
      for (const key of keys) expect(mergedClose[key], `${locale}.${key}`).toBe(englishClose[key]);
    }
  });
});
