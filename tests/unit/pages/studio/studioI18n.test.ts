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
  'director.title',
  'director.show',
  'director.hide',
  'director.starting',
  'director.retry',
  'director.startFresh',
  'director.danglingNotice',
  'director.interruptedNotice',
  'director.ownerConflict',
  'director.noModelConfigured',
  'errors.storage',
  'errors.staleProject',
  'project.backToLibrary',
  'project.loading',
  'project.notFound',
  'project.structure',
  'project.unsupportedPrototype',
  'views.title',
  'views.table',
  'views.board',
  'views.cut',
  'views.boardPending',
  'views.cutPending',
  'table.label',
  'table.columns.position',
  'table.columns.beat',
  'table.columns.action',
  'table.columns.look',
  'table.columns.shots',
  'table.columns.length',
  'table.columns.state',
  'table.lookMissing',
  'table.shotCount',
  'table.shotCount_one',
  'table.shotCount_other',
  'table.targetDuration',
  'table.targetPending',
  'table.actualDuration',
  'table.actualPending',
  'table.empty',
  'table.state.durationPending',
  'table.state.noCoverage',
  'table.state.seedPending',
  'table.state.partDone',
  'table.state.rendering',
  'table.state.stale',
  'table.state.statusPending',
  'table.state.ready',
  'table.state.draft',
  'beatPanel.title',
  'beatPanel.label',
  'beatPanel.untitledBeat',
  'beatPanel.beatPosition',
  'beatPanel.previousBeat',
  'beatPanel.previousBeatShort',
  'beatPanel.nextBeat',
  'beatPanel.nextBeatShort',
  'beatPanel.beatFieldsLabel',
  'beatPanel.lookCounter',
  'beatPanel.lookCounter_one',
  'beatPanel.lookCounter_other',
  'beatPanel.directorRequestHint',
  'beatPanel.common.cancel',
  'beatPanel.common.keepWaiting',
  'beatPanel.common.saveBeat',
  'beatPanel.common.resetBeat',
  'beatPanel.common.saveShot',
  'beatPanel.common.resetShot',
  'beatPanel.fields.action',
  'beatPanel.fields.look',
  'beatPanel.fields.targetSeconds',
  'beatPanel.fields.line',
  'beatPanel.fields.lineFor',
  'beatPanel.fields.narration',
  'beatPanel.fields.narrationFor',
  'beatPanel.fields.onScreenText',
  'beatPanel.fields.onScreenTextFor',
  'beatPanel.fields.duration',
  'beatPanel.fields.durationFor',
  'beatPanel.chain.authorHardCut',
  'beatPanel.chain.hardCut',
  'beatPanel.chain.generationOutOfDate',
  'beatPanel.chain.segmentHead',
  'beatPanel.chain.continuous',
  'beatPanel.chain.systemContinuityStale',
  'beatPanel.coverage.label',
  'beatPanel.coverage.empty',
  'beatPanel.coverage.unavailable',
  'beatPanel.coverage.playbackLane',
  'beatPanel.coverage.planningLane',
  'beatPanel.coverage.shotLabel',
  'beatPanel.coverage.sourceDuration',
  'beatPanel.coverage.planningDuration',
  'beatPanel.coverage.boundaryLabel',
  'beatPanel.coverage.boundaryValue',
  'beatPanel.coverage.boundaryAnnouncement',
  'beatPanel.coverage.trimInLabel',
  'beatPanel.coverage.trimOutLabel',
  'beatPanel.coverage.trimValue',
  'beatPanel.coverage.trimAnnouncement',
  'beatPanel.coverage.tailTrimWarning',
  'beatPanel.coverage.reviewResplit',
  'beatPanel.shots.label',
  'beatPanel.shots.heading',
  'beatPanel.shots.position',
  'beatPanel.shots.empty',
  'beatPanel.reorder.previous',
  'beatPanel.reorder.previousShort',
  'beatPanel.reorder.next',
  'beatPanel.reorder.nextShort',
  'beatPanel.reorder.announcement',
  'beatPanel.derivation.label',
  'beatPanel.derivation.title',
  'beatPanel.derivation.derived',
  'beatPanel.derivation.detached',
  'beatPanel.derivation.stale',
  'beatPanel.derivation.detach',
  'beatPanel.derivation.rederiveReviewed',
  'beatPanel.derivation.restoreHistory',
  'beatPanel.seeds.label',
  'beatPanel.seeds.title',
  'beatPanel.seeds.imageLabel',
  'beatPanel.seeds.imageTitle',
  'beatPanel.seeds.pending',
  'beatPanel.seeds.latestDefault',
  'beatPanel.seeds.pinned',
  'beatPanel.seeds.import',
  'beatPanel.seeds.pin',
  'beatPanel.seeds.clearPin',
  'beatPanel.seeds.empty',
  'beatPanel.takes.imageTakeLabel',
  'beatPanel.takes.videoTakeLabel',
  'beatPanel.takes.previewAlt',
  'beatPanel.takes.videoPreview',
  'beatPanel.takes.selected',
  'beatPanel.takes.effectiveSeed',
  'beatPanel.takes.pinnedSeed',
  'beatPanel.takes.binReason.lifted',
  'beatPanel.takes.binReason.alternate',
  'beatPanel.takes.sourceDuration',
  'beatPanel.takes.select',
  'beatPanel.takes.trimIncompatible',
  'beatPanel.takes.park',
  'beatPanel.takes.parkConfirmTitle',
  'beatPanel.takes.parkConfirmBody',
  'beatPanel.takes.addAlternate',
  'beatPanel.takes.alternateConfirmTitle',
  'beatPanel.takes.alternateConfirmBody',
  'beatPanel.takes.restore',
  'beatPanel.takes.unavailable',
  'beatPanel.takes.videoLabel',
  'beatPanel.takes.videoTitle',
  'beatPanel.takes.empty',
  'beatPanel.generation.gateLocked',
  'beatPanel.generation.generateSeed',
  'beatPanel.generation.renderVideo',
  'beatPanel.generation.choiceLabel',
  'beatPanel.generation.countForChoice',
  'beatPanel.generation.referenceForChoice',
  'beatPanel.generation.noReference',
  'beatPanel.generation.purpose.seedStill',
  'beatPanel.generation.purpose.videoTake',
  'beatPanel.generation.reviewUnavailable',
  'beatPanel.lift.shot',
  'beatPanel.lift.shotTitle',
  'beatPanel.lift.shotBodyNoStale',
  'beatPanel.lift.shotBodyStale',
  'beatPanel.lift.confirmShot',
  'beatPanel.lift.beat',
  'beatPanel.lift.beatTitle',
  'beatPanel.lift.beatBodyNoStale',
  'beatPanel.lift.beatBodyStale',
  'beatPanel.lift.confirmBeat',
  'beatPanel.blocker.statusUnavailable',
  'beatPanel.blocker.unsavedDrafts',
  'beatPanel.blocker.currentMatchTo',
  'beatPanel.blocker.ownNonterminalJob',
  'beatPanel.blocker.ownPendingFrame',
  'beatPanel.blocker.downstreamNonterminalJob',
  'beatPanel.blocker.downstreamPendingFrame',
  'beatPanel.blocker.waitingAuthorizationDependency',
  'beatPanel.blocker.boundNonterminalRequest',
  'beatPanel.blocker.currentSelectedTake',
  'beatPanel.blocker.currentSeedStill',
  'beatPanel.blocker.nonterminalConditioningUse',
  'beatPanel.blocker.takeBinCapacityReached',
  'beatPanel.blocker.beatShotCapacityReached',
  'beatPanel.recovery.label',
  'beatPanel.recovery.title',
  'beatPanel.recovery.reason.upstream_running',
  'beatPanel.recovery.reason.choose_seed',
  'beatPanel.recovery.reason.choose_take',
  'beatPanel.recovery.reason.conditioning_frame',
  'beatPanel.recovery.reason.conditioning_failed',
  'beatPanel.recovery.reason.dependency_failed',
  'beatPanel.recovery.reason.cancelled',
  'beatPanel.recovery.freshQuoteRequired',
  'beatPanel.recovery.chooseImage',
  'beatPanel.recovery.chooseVideo',
  'beatPanel.recovery.retryFree',
  'beatPanel.recovery.cancelWaiting',
  'beatPanel.recovery.cancelTitle',
  'beatPanel.recovery.cancelBody',
  'beatPanel.recovery.cancelConfirm',
  'beatPanel.recovery.localConditioningFailure',
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
  'proposals.coverageReviewTitle',
  'proposals.proposedShots',
  'proposals.proposedShot',
  'proposals.proposedDuration',
  'proposals.proposedDurationValue',
  'proposals.proposedLine',
  'proposals.proposedNarration',
  'proposals.emptyAuthoredField',
  'proposals.proposedOnScreenText',
  'proposals.proposedChain',
  'proposals.chainBreak.hard_cut',
  'proposals.chainBreak.none',
  'proposals.fixedShotsTitle',
  'proposals.fixedReviewAnnouncement',
  'proposals.fixedReviewAnnouncement_one',
  'proposals.fixedReviewAnnouncement_other',
  'proposals.noFixedShots',
  'proposals.fixedShot',
  'proposals.fixedReason.owned_asset',
  'proposals.fixedReason.owned_job',
  'proposals.fixedReason.selected_take',
  'proposals.fixedReason.seed_still',
  'proposals.fixedReason.conditioning_frame',
  'proposals.fixedReason.conditioning_input',
  'proposals.fixedReason.match_to',
  'proposals.fixedReason.narration',
  'proposals.fixedReason.on_screen_text',
  'proposals.rederiveTitle',
  'proposals.rederiveShot',
  'proposals.saveBeforeApply',
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
  'handoffs.review',
  'handoffs.dismiss',
  'handoffs.confirmed',
  'handoffs.dismissed',
  'controls.settingsTitle',
  'controls.name',
  'controls.targetDuration',
  'controls.aspectRatio',
  'controls.resolution',
  'controls.settingsEffect',
  'controls.requestShapeLocked',
  'controls.reset',
  'controls.saveSettings',
  'controls.briefTitle',
  'controls.brief',
  'controls.imageRoute',
  'controls.videoRoute',
  'controls.spendCurrency',
  'controls.spendCap',
  'controls.saveBrief',
  'controls.refreshRoutes',
  'controls.rules',
  'controls.saveRules',
  'controls.invalidSpendPolicy',
  'controls.invalidRules',
  'controls.draftConflict',
  'controls.shotsTitle',
  'controls.noCoverage',
  'controls.keepUncoveredFree',
  'controls.reviewRender',
  'controls.saveBeforeReview',
  'controls.statusRequired',
  'controls.routeCatalogRequired',
  'controls.selectionNotPayable',
  'controls.imageRouteBlocked',
  'controls.videoRouteBlocked',
  'controls.routeStatus.ready',
  'controls.routeStatus.selection_required',
  'controls.routeStatus.setup_required',
  'controls.routeStatus.unavailable',
  'controls.shotState.draft',
  'controls.shotState.seed_ready',
  'controls.shotState.takes_available',
  'controls.shotState.selected_take',
  'controls.takeCount',
  'controls.takeCount_one',
  'controls.takeCount_other',
  'controls.generationChoices',
  'controls.undo',
  'controls.undoLabel.edit_project',
  'controls.undoLabel.set_brief',
  'controls.undoLabel.set_rules',
  'controls.undoLabel.add_beat',
  'controls.undoLabel.edit_beat',
  'controls.undoLabel.reorder_beats',
  'controls.undoLabel.park_beat',
  'controls.undoLabel.restore_beat',
  'controls.undoLabel.add_binned_beat',
  'controls.undoLabel.add_shot',
  'controls.undoLabel.edit_shot',
  'controls.undoLabel.delete_shot',
  'controls.undoLabel.park_shot',
  'controls.undoLabel.restore_shot',
  'controls.undoLabel.reorder_shots',
  'controls.undoLabel.apply_coverage',
  'controls.undoLabel.set_hard_cut',
  'controls.undoLabel.set_seed_still',
  'controls.undoLabel.trim_shot',
  'controls.undoLabel.redetach_line',
  'controls.undoLabel.rederive_line',
  'controls.undoLabel.restore_line',
  'controls.undoLabel.park_take',
  'controls.undoLabel.add_alternate_take',
  'controls.undoLabel.restore_take',
  'controls.undoLabel.reorder_bin',
  'controls.undoLabel.select_take',
  'controls.undoLabel.set_routes',
  'controls.undoLabel.set_spend_policy',
  'controls.undoLabel.set_match_to',
  'controls.undoLabel.set_bed',
  'controls.undoLabel.mutation_batch',
  'controls.undoLabel.unknown',
  'controls.dirtyShot',
  'controls.dirtyCause.continuity_stale',
  'controls.dirtyCause.generation_out_of_date',
  'controls.cascadeTitle',
  'controls.cascadeReason.upstream_running',
  'controls.cascadeReason.choose_seed',
  'controls.cascadeReason.choose_take',
  'controls.cascadeReason.conditioning_frame',
  'controls.cascadeReason.conditioning_failed',
  'controls.cascadeReason.dependency_failed',
  'controls.cascadeReason.cancelled',
  'controls.chooseAsset',
  'controls.retryConditioning',
  'controls.cancelWaiting',
  'controls.retryConditioningFor',
  'gate.title',
  'gate.reviewBeforeSpend',
  'gate.requestedShots',
  'gate.requestedShots_one',
  'gate.requestedShots_other',
  'gate.preparing',
  'gate.optionsLabel',
  'gate.baseOnly',
  'gate.withCascade',
  'gate.headline',
  'gate.rateCardSource',
  'gate.group.base',
  'gate.group.cascade',
  'gate.purpose.seed_still',
  'gate.purpose.video_take',
  'gate.route',
  'gate.duration',
  'gate.durationNotApplicable',
  'gate.rowCost',
  'gate.waitsForTakeSelection',
  'gate.budget.no_policy',
  'gate.budget.within_cap',
  'gate.budget.over_cap',
  'gate.budget.currency_mismatch',
  'gate.budgetPolicy',
  'gate.revision',
  'gate.expires',
  'gate.confirmed',
  'gate.prepare',
  'gate.prepareAgain',
  'gate.confirm',
  'gate.close',
  'gate.errors.generic',
  'review.title',
] as const;

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{{\s*([^},\s]+)(?:\s*,[^}]*)?\s*}}/g)].map((match) => match[1]!).sort();

describe('Creative Studio workspace translations', () => {
  const englishConversation = loadConversation(referenceLocale);
  const englishWorkspace = workspaceOf(englishConversation)!;

  it('keeps the exact renderer workspace inventory under one en-US subtree', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(Object.keys(leaves).toSorted()).toEqual(expectedLeaves.toSorted());
    expect(leaves['table.columns.position']).toBe('#');
    for (const [key, value] of Object.entries(leaves)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('keeps one/other variants paired with identical interpolation parameters', () => {
    const leaves = flattenLeaves(englishWorkspace);
    const pluralBases = Object.keys(leaves)
      .filter((key) => key.endsWith('_one'))
      .map((key) => key.slice(0, -'_one'.length));

    expect(pluralBases).toHaveLength(12);
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
