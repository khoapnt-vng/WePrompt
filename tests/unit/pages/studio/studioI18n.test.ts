/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import i18next from 'i18next';
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
  'director.resize',
  'director.startFresh',
  'director.danglingNotice',
  'director.interruptedNotice',
  'director.ownerConflict',
  'director.sessionVerificationFailed',
  'director.attachInterrupted',
  'director.noModelConfigured',
  'errors.storage',
  'errors.staleProject',
  'project.backToLibrary',
  'project.loading',
  'project.notFound',
  'project.structure',
  'project.against',
  'project.ready',
  'project.unsupportedPrototype',
  'views.title',
  'views.table',
  'views.board',
  'views.cut',
  'table.label',
  'table.columns.position',
  'table.columns.beat',
  'table.columns.action',
  'table.columns.look',
  'table.columns.actionLook',
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
  'table.state.needsAttention',
  'table.state.rendering',
  'table.state.stale',
  'table.state.statusPending',
  'table.state.ready',
  'table.state.draft',
  'board.ariaLabel',
  'board.actionsLabel',
  'board.openBeat',
  'board.selectedBeat',
  'board.ordinal',
  'board.shotCount',
  'board.shotCount_one',
  'board.shotCount_other',
  'board.targetDuration',
  'board.actualDuration',
  'board.noCoverage',
  'board.coverUnavailable',
  'board.dragHandle',
  'board.moveEarlier',
  'board.moveLater',
  'board.reorderAnnouncement',
  'board.reorderFailed',
  'board.liftBeat',
  'board.liftConfirmTitle',
  'board.liftConfirmContent',
  'board.liftUnavailable',
  'board.liftDirtyDraft',
  'board.liftSucceeded',
  'board.liftFailed',
  'cut.ariaLabel',
  'cut.description',
  'cut.railLabel',
  'cut.orderUnavailable',
  'cut.empty',
  'cut.filmDuration',
  'cut.filmstripDuration',
  'cut.durationPending',
  'cut.beatPosition',
  'cut.shotCount',
  'cut.shotCount_one',
  'cut.shotCount_other',
  'cut.actualDuration',
  'cut.targetDuration',
  'cut.beatDurationPending',
  'cut.preview.label',
  'cut.preview.beatBadge',
  'cut.preview.slate',
  'cut.preview.slateHold',
  'cut.preview.videoLabel',
  'cut.preview.slateLabel',
  'cut.preview.noMedia',
  'cut.preview.awaitingPictureOne',
  'cut.preview.awaitingPictureMany',
  'cut.preview.mediaError',
  'cut.preview.play',
  'cut.preview.pause',
  'cut.preview.position',
  'cut.preview.pictureOnly',
  'cut.preview.controlsLabel',
  'cut.preview.seekLabel',
  'cut.preview.previousJoin',
  'cut.preview.nextJoin',
  'cut.preview.loopJoin',
  'cut.preview.buffering',
  'cut.openBeat',
  'cut.film.title',
  'cut.film.ofTarget',
  'cut.film.targetUnknown',
  'cut.film.under',
  'cut.film.over',
  'cut.film.onTarget',
  'cut.film.counts',
  'cut.film.beatCount',
  'cut.film.beatCount_one',
  'cut.film.beatCount_other',
  'cut.film.slateCount',
  'cut.film.slateCount_one',
  'cut.film.slateCount_other',
  'cut.slate.label',
  'cut.slate.warning',
  'cut.slate.openBeat',
  'cut.dragHandle',
  'cut.moveEarlier',
  'cut.moveLater',
  'cut.reorderAnnouncement',
  'cut.reorderFailed',
  'cut.bed.title',
  'cut.bed.description',
  'cut.bed.label',
  'cut.bed.none',
  'cut.bed.empty',
  'cut.bed.option',
  'cut.bed.import',
  'cut.bed.pickerFilter',
  'cut.bed.imported',
  'cut.bed.importCancelled',
  'cut.bed.importFailed',
  'cut.bed.selected',
  'cut.bed.cleared',
  'cut.bed.setFailed',
  'cut.bed.fade',
  'cut.bed.tooShort',
  'cut.bed.durationPending',
  'cut.bed.invalid',
  'cut.bed.silentPreview',
  'cut.bed.extent',
  'cut.exports.title',
  'cut.exports.description',
  'cut.exports.refresh',
  'cut.exports.refreshed',
  'cut.exports.refreshFailed',
  'cut.exports.catalogUnavailable',
  'cut.exports.editorFolderTitle',
  'cut.exports.editorFolderDescription',
  'cut.exports.createEditorFolder',
  'cut.exports.stillTitle',
  'cut.exports.stillDescription',
  'cut.exports.stillLabel',
  'cut.exports.noStill',
  'cut.exports.createStill',
  'cut.exports.scriptTitle',
  'cut.exports.scriptDescription',
  'cut.exports.createScript',
  'cut.exports.created',
  'cut.exports.createFailed',
  'assets.show',
  'assets.title',
  'assets.close',
  'assets.description',
  'assets.audioTitle',
  'assets.audioEmpty',
  'assets.audioItem',
  'assets.audioFacts',
  'assets.selectedBed',
  'assets.detach',
  'assets.detachTitle',
  'assets.detachContent',
  'assets.detached',
  'assets.detachFailed',
  'assets.cancel',
  'assets.exportsTitle',
  'assets.exportsEmpty',
  'assets.shape.editor_folder',
  'assets.shape.still',
  'assets.shape.script',
  'assets.exportFacts',
  'assets.exportFacts_one',
  'assets.exportFacts_other',
  'assets.copy',
  'assets.reveal',
  'assets.copied',
  'assets.copyCancelled',
  'assets.copyFailed',
  'assets.revealed',
  'assets.revealFailed',
  'bin.title',
  'bin.description',
  'bin.empty',
  'bin.listLabel',
  'bin.kind.beat',
  'bin.kind.shot',
  'bin.reason.lifted',
  'bin.reason.alternate',
  'bin.position',
  'bin.itemLabel',
  'bin.ownerLabel',
  'bin.ownerUnavailable',
  'bin.shotCount',
  'bin.shotCount_one',
  'bin.shotCount_other',
  'bin.retainedWork',
  'bin.stale',
  'bin.coverAlt',
  'bin.coverUnavailable',
  'bin.dragHandle',
  'bin.reorderAnnouncement',
  'bin.restore.positionLabel',
  'bin.restore.atEnd',
  'bin.restore.beforeBeat',
  'bin.restore.beforeShot',
  'bin.restore.beat',
  'bin.restore.shot',
  'bin.blocker.statusUnavailable',
  'bin.blocker.ownerUnavailable',
  'bin.blocker.anchorUnavailable',
  'beatPanel.title',
  'beatPanel.label',
  'beatPanel.untitledBeat',
  'beatPanel.beatPosition',
  'beatPanel.previousBeat',
  'beatPanel.previousBeatShort',
  'beatPanel.nextBeat',
  'beatPanel.nextBeatShort',
  'beatPanel.beatFieldsLabel',
  'beatPanel.fieldGuidance.action',
  'beatPanel.fieldGuidance.look',
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
  'beatPanel.chain.hardCutState',
  'beatPanel.chain.hardCutUnavailable',
  'beatPanel.chain.reviewSever',
  'beatPanel.chain.reviewRejoin',
  'beatPanel.chain.reviewSeverDescription',
  'beatPanel.chain.reviewRejoinDescription',
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
  'controls.renderFilm',
  'controls.renderFilmEmpty',
  'beatPanel.coverage.trimGuidance',
  'beatPanel.coverage.boundaryGuidance',
  'beatPanel.coverage.segmentState.noPicture',
  'beatPanel.coverage.segmentState.queued',
  'beatPanel.coverage.segmentState.nextUp',
  'beatPanel.coverage.segmentState.waitingOnShot',
  'beatPanel.coverage.segmentState.waitingOnFrame',
  'beatPanel.coverage.segmentState.rendering',
  'beatPanel.coverage.segmentState.renderingProgress',
  'beatPanel.coverage.segmentState.renderingStill',
  'beatPanel.coverage.segmentState.rendered',
  'beatPanel.coverage.segmentState.untouched',
  'beatPanel.coverage.segmentState.needsRerender',
  'beatPanel.coverage.segmentState.staleStillPlays',
  'beatPanel.coverage.segmentState.failedNotBilled',
  'beatPanel.coverage.segmentState.neverDispatched',
  'beatPanel.coverage.segmentState.shotKept',
  'beatPanel.coverage.segmentState.statusPending',
  'beatPanel.coverage.segmentState.needsAttention',
  'beatPanel.coverage.boundaryFrame.empty',
  'beatPanel.coverage.boundaryFrame.ready',
  'beatPanel.coverage.boundaryFrame.gone',
  'beatPanel.coverage.boundaryFrame.stale',
  'beatPanel.coverage.seekGuidance',
  'beatPanel.coverage.seekLane',
  'beatPanel.coverage.seekValue',
  'beatPanel.coverage.trimInLabel',
  'beatPanel.coverage.trimOutLabel',
  'beatPanel.coverage.trimValue',
  'beatPanel.coverage.trimAnnouncement',
  'beatPanel.coverage.tailTrimWarning',
  'beatPanel.coverage.reviewResplit',
  'beatPanel.preview.label',
  'beatPanel.preview.noMedia',
  'beatPanel.preview.mediaError',
  'beatPanel.preview.videoLabel',
  'beatPanel.preview.slateLabel',
  'beatPanel.preview.slate',
  'beatPanel.preview.slateHold',
  'beatPanel.preview.play',
  'beatPanel.preview.pause',
  'beatPanel.preview.position',
  'beatPanel.preview.pictureOnly',
  'beatPanel.preview.controlsLabel',
  'beatPanel.preview.previousJoin',
  'beatPanel.preview.nextJoin',
  'beatPanel.preview.loopJoin',
  'beatPanel.preview.keyboardGuidance',
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
  'beatPanel.derivation.attachedLineGuidance',
  'beatPanel.derivation.detachedLineGuidance',
  'beatPanel.derivation.stale',
  'beatPanel.derivation.detach',
  'beatPanel.derivation.rederiveReviewed',
  'beatPanel.derivation.restoreHistory',
  'beatPanel.seeds.label',
  'beatPanel.seeds.title',
  'beatPanel.seeds.stillLabel',
  'beatPanel.seeds.previewAlt',
  'beatPanel.seeds.effective',
  'beatPanel.seeds.pinnedBadge',
  'beatPanel.seeds.pending',
  'beatPanel.seeds.latestDefault',
  'beatPanel.seeds.pinned',
  'beatPanel.seeds.import',
  'beatPanel.seeds.pin',
  'beatPanel.seeds.clearPin',
  'beatPanel.seeds.empty',
  'beatPanel.picture.title',
  'beatPanel.picture.label',
  'beatPanel.picture.empty',
  'beatPanel.picture.sourceDuration',
  'beatPanel.picture.unavailable',
  'beatPanel.picture.videoPreview',
  'beatPanel.generation.gateLocked',
  'beatPanel.generation.generateSeed',
  'beatPanel.generation.renderVideo',
  'beatPanel.generation.choiceLabel',
  'beatPanel.generation.referenceForChoice',
  'beatPanel.generation.noReference',
  'beatPanel.generation.purpose.seedStill',
  'beatPanel.generation.reviewUnavailable',
  'beatPanel.lift.shot',
  'beatPanel.lift.shotTitle',
  'beatPanel.lift.shotBodyNoStale',
  'beatPanel.lift.shotBodyStale',
  'beatPanel.lift.confirmShot',
  'beatPanel.lift.shotSucceeded',
  'beatPanel.lift.shotFailed',
  'beatPanel.lift.beat',
  'beatPanel.lift.beatTitle',
  'beatPanel.lift.beatBodyNoStale',
  'beatPanel.lift.beatBodyStale',
  'beatPanel.lift.confirmBeat',
  'beatPanel.blocker.statusUnavailable',
  'beatPanel.blocker.unsavedDrafts',
  'beatPanel.blocker.ownNonterminalJob',
  'beatPanel.blocker.ownPendingFrame',
  'beatPanel.blocker.downstreamNonterminalJob',
  'beatPanel.blocker.downstreamPendingFrame',
  'beatPanel.blocker.waitingAuthorizationDependency',
  'beatPanel.blocker.boundNonterminalRequest',
  'beatPanel.blocker.beatShotCapacityReached',
  'beatPanel.recovery.label',
  'beatPanel.recovery.title',
  'beatPanel.recovery.reason.upstream_running',
  'beatPanel.recovery.reason.choose_seed',
  'beatPanel.recovery.reason.conditioning_frame',
  'beatPanel.recovery.reason.conditioning_failed',
  'beatPanel.recovery.reason.dependency_failed',
  'beatPanel.recovery.reason.cancelled',
  'beatPanel.recovery.freshQuoteRequired',
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
  'library.pictureCount',
  'library.pictureCount_one',
  'library.pictureCount_other',
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
  'proposals.fixedReason.video_asset',
  'proposals.fixedReason.seed_still',
  'proposals.fixedReason.conditioning_frame',
  'proposals.fixedReason.conditioning_input',
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
  'controls.briefAndRulesTitle',
  'controls.brief',
  'controls.imageRoute',
  'controls.videoRoute',
  'controls.spendCurrency',
  'controls.spendCap',
  'controls.saveBrief',
  'controls.refreshRoutes',
  'controls.invalidSpendPolicy',
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
  'controls.undoLabel.reorder_bin',
  'controls.undoLabel.set_routes',
  'controls.undoLabel.set_spend_policy',
  'controls.undoLabel.set_bed',
  'controls.undoLabel.mutation_batch',
  'controls.undoLabel.unknown',
  'controls.dirtyShot',
  'controls.dirtyCause.continuity_stale',
  'controls.dirtyCause.generation_out_of_date',
  'controls.cascadeTitle',
  'controls.cascadeReason.upstream_running',
  'controls.cascadeReason.choose_seed',
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
  'gate.headline_one',
  'gate.headline_other',
  'gate.continuity.severTitle',
  'gate.continuity.rejoinTitle',
  'gate.continuity.severSummary',
  'gate.continuity.rejoinSummary',
  'gate.continuity.severHeadline',
  'gate.continuity.rejoinHeadline',
  'gate.continuity.requiredWork',
  'gate.continuity.confirmSever',
  'gate.continuity.confirmRejoin',
  'gate.continuity.close',
  'gate.continuity.severConfirmed',
  'gate.continuity.rejoinConfirmed',
  'gate.rateCardSource',
  'gate.showBreakdown',
  'gate.hideBreakdown',
  'gate.group.base',
  'gate.group.cascade',
  'gate.group.required',
  'gate.purpose.seed_still',
  'gate.purpose.video_take',
  'gate.route',
  'gate.duration',
  'gate.durationNotApplicable',
  'gate.rowCost',
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
  'gate.confirm_one',
  'gate.confirm_other',
  'gate.close',
  'gate.errors.generic',
  'gate.errors.routesUnavailable',
  'gate.errors.pricing.invalidQuote',
  'gate.errors.pricing.inactiveShot',
  'gate.errors.pricing.inFlight',
  'gate.errors.pricing.duplicateShotPurpose',
  'gate.errors.pricing.invalidDependency',
  'gate.errors.pricing.invalidPrepareRequest',
  'gate.errors.pricing.invalidReference',
  'gate.errors.pricing.missingConditioning',
  'gate.errors.pricing.unsafeTotal',
  'review.title',
] as const;

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{{\s*([^},\s]+)(?:\s*,[^}]*)?\s*}}/g)].map((match) => match[1]!).sort();

const briefAndRulesTitles: Record<string, string> = {
  'de-DE': 'Brief & Regeln',
  'en-US': 'Brief & rules',
  'es-ES': 'Brief y reglas',
  'fa-IR': 'بریف و قوانین',
  'ja-JP': 'ブリーフとルール',
  'ko-KR': '브리프 및 규칙',
  'pt-BR': 'Brief e regras',
  'ru-RU': 'Бриф и правила',
  'tr-TR': 'Brief ve kurallar',
  'uk-UA': 'Бриф і правила',
  'zh-CN': '简报与规则',
  'zh-TW': '簡報與規則',
};

const localizedCutPreviewKeys = [
  'cut.preview.label',
  'cut.preview.beatBadge',
  'cut.preview.slate',
  'cut.preview.slateHold',
  'cut.preview.videoLabel',
  'cut.preview.slateLabel',
  'cut.preview.noMedia',
  'cut.preview.awaitingPictureOne',
  'cut.preview.awaitingPictureMany',
  'cut.preview.mediaError',
  'cut.preview.play',
  'cut.preview.pause',
  'cut.preview.position',
  'cut.preview.pictureOnly',
  'cut.preview.controlsLabel',
  'cut.preview.seekLabel',
  'cut.preview.previousJoin',
  'cut.preview.nextJoin',
  'cut.preview.loopJoin',
  'cut.preview.buffering',
] as const;

const localizedCutCompositionKeys = [
  'cut.openBeat',
  'cut.slate.openBeat',
  'cut.bed.silentPreview',
  'cut.bed.extent',
] as const;

const localizedBeatPlaybackKeys = [
  'beatPanel.coverage.seekGuidance',
  'beatPanel.coverage.seekLane',
  'beatPanel.coverage.seekValue',
  'beatPanel.preview.label',
  'beatPanel.preview.noMedia',
  'beatPanel.preview.mediaError',
  'beatPanel.preview.videoLabel',
  'beatPanel.preview.slateLabel',
  'beatPanel.preview.slate',
  'beatPanel.preview.slateHold',
  'beatPanel.preview.play',
  'beatPanel.preview.pause',
  'beatPanel.preview.position',
  'beatPanel.preview.pictureOnly',
  'beatPanel.preview.controlsLabel',
  'beatPanel.preview.previousJoin',
  'beatPanel.preview.nextJoin',
  'beatPanel.preview.loopJoin',
  'beatPanel.preview.keyboardGuidance',
] as const;

const localizedBeatSegmentKeys = [
  'beatPanel.coverage.segmentState.noPicture',
  'beatPanel.coverage.segmentState.queued',
  'beatPanel.coverage.segmentState.nextUp',
  'beatPanel.coverage.segmentState.waitingOnShot',
  'beatPanel.coverage.segmentState.waitingOnFrame',
  'beatPanel.coverage.segmentState.rendering',
  'beatPanel.coverage.segmentState.renderingProgress',
  'beatPanel.coverage.segmentState.renderingStill',
  'beatPanel.coverage.segmentState.rendered',
  'beatPanel.coverage.segmentState.untouched',
  'beatPanel.coverage.segmentState.needsRerender',
  'beatPanel.coverage.segmentState.staleStillPlays',
  'beatPanel.coverage.segmentState.failedNotBilled',
  'beatPanel.coverage.segmentState.neverDispatched',
  'beatPanel.coverage.segmentState.shotKept',
  'beatPanel.coverage.segmentState.statusPending',
  'beatPanel.coverage.segmentState.needsAttention',
  'beatPanel.coverage.boundaryFrame.empty',
  'beatPanel.coverage.boundaryFrame.ready',
  'beatPanel.coverage.boundaryFrame.gone',
  'beatPanel.coverage.boundaryFrame.stale',
] as const;

const localizedCutFilmDeltaKeys = ['cut.film.under', 'cut.film.over'] as const;

const localizedCurrentPictureKeys = [
  'beatPanel.seeds.stillLabel',
  'beatPanel.seeds.previewAlt',
  'beatPanel.seeds.effective',
  'beatPanel.seeds.pinnedBadge',
  'beatPanel.picture.title',
  'beatPanel.picture.label',
  'beatPanel.picture.empty',
  'beatPanel.picture.sourceDuration',
  'beatPanel.picture.unavailable',
  'beatPanel.picture.videoPreview',
  'beatPanel.generation.renderVideo',
] as const;

const localizedMoveToBinKeys = [
  'board.liftBeat',
  'board.liftConfirmTitle',
  'board.liftConfirmContent',
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
] as const;

const localizedOnePicturePresentationKeys = [
  'library.subtitle',
  'library.status.complete',
  'library.status.partial',
  'cut.exports.editorFolderDescription',
  'proposals.fixedReason.video_asset',
] as const;

const localizedWorkspaceKeys = [
  'beatPanel.beatFieldsLabel',
  'beatPanel.chain.continuous',
  'beatPanel.chain.hardCutUnavailable',
  'beatPanel.chain.hardCutState',
  'beatPanel.chain.reviewSever',
  'beatPanel.chain.reviewRejoin',
  'beatPanel.chain.reviewSeverDescription',
  'beatPanel.chain.reviewRejoinDescription',
  'beatPanel.chain.segmentHead',
  'beatPanel.coverage.boundaryGuidance',
  'beatPanel.coverage.trimGuidance',
  'beatPanel.derivation.attachedLineGuidance',
  'beatPanel.derivation.derived',
  'beatPanel.derivation.detached',
  'beatPanel.derivation.detachedLineGuidance',
  'beatPanel.fieldGuidance.action',
  'beatPanel.fieldGuidance.look',
  'beatPanel.fields.action',
  'beatPanel.fields.look',
  'beatPanel.fields.targetSeconds',
  'beatPanel.lookCounter',
  'beatPanel.lookCounter_one',
  'beatPanel.lookCounter_other',
  ...localizedCurrentPictureKeys,
  'library.pictureCount',
  'library.pictureCount_one',
  'library.pictureCount_other',
  ...localizedOnePicturePresentationKeys,
  ...localizedCutPreviewKeys,
  ...localizedCutCompositionKeys,
  ...localizedBeatPlaybackKeys,
  ...localizedBeatSegmentKeys,
  ...localizedCutFilmDeltaKeys,
  ...localizedMoveToBinKeys,
  'controls.briefAndRulesTitle',
  'gate.errors.routesUnavailable',
  'gate.group.required',
  'gate.continuity.severTitle',
  'gate.continuity.rejoinTitle',
  'gate.continuity.severSummary',
  'gate.continuity.rejoinSummary',
  'gate.continuity.severHeadline',
  'gate.continuity.rejoinHeadline',
  'gate.continuity.requiredWork',
  'gate.continuity.confirmSever',
  'gate.continuity.confirmRejoin',
  'gate.continuity.close',
  'gate.continuity.severConfirmed',
  'gate.continuity.rejoinConfirmed',
  'gate.errors.pricing.invalidQuote',
  'gate.errors.pricing.inactiveShot',
  'gate.errors.pricing.inFlight',
  'gate.errors.pricing.duplicateShotPurpose',
  'gate.errors.pricing.invalidDependency',
  'gate.errors.pricing.invalidPrepareRequest',
  'gate.errors.pricing.invalidReference',
  'gate.errors.pricing.missingConditioning',
  'gate.errors.pricing.unsafeTotal',
] as const;

describe('Creative Studio workspace translations', () => {
  const englishConversation = loadConversation(referenceLocale);
  const englishWorkspace = workspaceOf(englishConversation)!;

  it('keeps the exact renderer workspace inventory under one en-US subtree', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(Object.keys(leaves).toSorted()).toEqual(expectedLeaves.toSorted());
    expect(leaves['table.columns.position']).toBe('#');
    expect(placeholders(leaves['bin.coverAlt']!)).toEqual(['kind', 'title']);
    for (const [key, value] of Object.entries(leaves)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('keeps Cut preview labels and transport copy as complete en-US phrases', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'cut.preview.label': 'Film preview',
      'cut.preview.beatBadge': 'Beat {{position}} · {{title}}',
      'cut.preview.slate': 'Slate · No coverage',
      'cut.preview.slateHold': 'Holds {{clock}} in the Cut',
      'cut.preview.videoLabel': 'Beat {{beatPosition}} · {{beatTitle}} · Shot {{shotPosition}} · {{shotTitle}}',
      'cut.preview.slateLabel': 'Beat {{beatPosition}} · {{beatTitle}} · Slate · No coverage',
      'cut.preview.noMedia': 'No film preview is available.',
      'cut.preview.mediaError': 'This preview could not be loaded.',
      'cut.preview.play': 'Play film',
      'cut.preview.pause': 'Pause film',
      'cut.preview.position': '{{current}} / {{total}}',
      'cut.preview.pictureOnly': 'Picture only — the bed is muted here',
      'cut.preview.controlsLabel': 'Film transport',
      'cut.preview.seekLabel': 'Film seek rail',
      'cut.preview.previousJoin': 'Previous join',
      'cut.preview.nextJoin': 'Next join',
      'cut.preview.loopJoin': 'Loop join',
      'cut.preview.buffering': 'Loading preview frame',
    });
  });

  it('keeps Cut navigation and stored-bed truth as complete en-US phrases', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'cut.openBeat': 'Open Beat',
      'cut.slate.openBeat': 'Open uncovered Beat',
      'cut.bed.silentPreview': 'Silent in preview · applied on export',
      'cut.bed.extent': 'From 0:00 · {{seconds}}s extent',
    });
    expect(placeholders(leaves['cut.bed.extent']!)).toEqual(['seconds']);
  });

  it('keeps Beat preview, transport, and free-seek copy as complete en-US phrases', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'beatPanel.coverage.seekGuidance': 'Rail · Seek · Free',
      'beatPanel.coverage.seekLane': 'Beat seek rail',
      'beatPanel.coverage.seekValue': '{{current}} of {{total}}',
      'beatPanel.preview.label': 'Beat preview',
      'beatPanel.preview.noMedia': 'Beat preview unavailable',
      'beatPanel.preview.mediaError': 'The current picture could not be previewed.',
      'beatPanel.preview.videoLabel': 'Shot {{position}} video · {{line}}',
      'beatPanel.preview.slateLabel': 'Shot {{position}} planning slate · {{line}}',
      'beatPanel.preview.slate': 'Planning slate',
      'beatPanel.preview.slateHold': 'Hold {{clock}}',
      'beatPanel.preview.play': 'Play Beat',
      'beatPanel.preview.pause': 'Pause Beat',
      'beatPanel.preview.position': '{{current}} / {{total}}',
      'beatPanel.preview.pictureOnly': 'Picture only',
      'beatPanel.preview.controlsLabel': 'Beat transport',
      'beatPanel.preview.previousJoin': 'Previous join',
      'beatPanel.preview.nextJoin': 'Next join',
      'beatPanel.preview.loopJoin': 'Loop nearest join',
      'beatPanel.preview.keyboardGuidance': 'Space play · Arrows seek · [ ] joins · L loop',
    });
  });

  it('keeps Beat segment and boundary states as complete en-US phrases', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'beatPanel.coverage.segmentState.noPicture': 'No picture',
      'beatPanel.coverage.segmentState.queued': 'Queued',
      'beatPanel.coverage.segmentState.nextUp': 'Next up',
      'beatPanel.coverage.segmentState.waitingOnShot': 'Waiting on {{position}}',
      'beatPanel.coverage.segmentState.waitingOnFrame': 'Waiting on the frame',
      'beatPanel.coverage.segmentState.rendering': 'Rendering',
      'beatPanel.coverage.segmentState.renderingProgress': 'Rendering · {{progress}}%',
      'beatPanel.coverage.segmentState.renderingStill': 'Rendering · Showing the still',
      'beatPanel.coverage.segmentState.rendered': 'Rendered',
      'beatPanel.coverage.segmentState.untouched': 'Untouched',
      'beatPanel.coverage.segmentState.needsRerender': 'Needs a re-render',
      'beatPanel.coverage.segmentState.staleStillPlays': 'Stale · Still plays',
      'beatPanel.coverage.segmentState.failedNotBilled': 'Failed · Not billed',
      'beatPanel.coverage.segmentState.neverDispatched': 'Never dispatched',
      'beatPanel.coverage.segmentState.shotKept': 'Shot {{position}} · Kept',
      'beatPanel.coverage.segmentState.statusPending': 'Status unavailable',
      'beatPanel.coverage.segmentState.needsAttention': 'Needs attention',
      'beatPanel.coverage.boundaryFrame.empty': 'Boundary after Shot {{position}} · Waiting for continuity frame',
      'beatPanel.coverage.boundaryFrame.ready': 'Boundary after Shot {{position}} · Continuity frame ready',
      'beatPanel.coverage.boundaryFrame.gone': 'Boundary after Shot {{position}} · Continuity frame missing',
      'beatPanel.coverage.boundaryFrame.stale': 'Boundary after Shot {{position}} · Continuity frame is out of date',
    });
  });

  it('explains exact reviewed sever and rejoin without promising lifecycle success', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'beatPanel.chain.reviewSever': 'Review hard cut…',
      'beatPanel.chain.reviewRejoin': 'Review rejoin…',
      'gate.continuity.requiredWork': 'All listed replacement work is required for this chain change.',
      'gate.continuity.confirmSever': 'Confirm hard cut + {{count}} generations · {{cost}}',
      'gate.continuity.confirmRejoin': 'Confirm rejoin + {{count}} generations · {{cost}}',
      'gate.continuity.close': 'Close — keep the chain unchanged',
      'gate.continuity.severConfirmed':
        'Hard cut confirmed. Review the Shot for seed and replacement progress or any required recovery.',
      'gate.continuity.rejoinConfirmed':
        'Rejoin confirmed. Review the Shot for frame extraction and replacement progress or any required recovery.',
    });
    expect(placeholders(leaves['gate.continuity.confirmSever']!)).toEqual(['cost', 'count']);
    expect(placeholders(leaves['gate.continuity.confirmRejoin']!)).toEqual(['cost', 'count']);
  });

  it('names both unavailable estimate routes and directs recovery to Brief and rules', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves['gate.errors.routesUnavailable']).toBe(
      'Choose ready image and video routes in Brief & rules before preparing this estimate.'
    );
  });

  it('keeps Shot and Line provenance as complete sentence-case en-US phrases', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'beatPanel.chain.segmentHead': 'Head of the chain · Starts from the still',
      'beatPanel.chain.continuous': 'Continues from Shot {{position}}’s last frame',
      'beatPanel.derivation.attachedLineGuidance': 'Written from the action · Edit to detach',
      'beatPanel.derivation.detachedLineGuidance': 'Your words · No longer follows the action',
      'beatPanel.derivation.derived': 'Derived from the action',
      'beatPanel.derivation.detached': 'Detached · Yours',
    });
    expect(placeholders(leaves['beatPanel.chain.continuous']!)).toEqual(['position']);
  });

  it('prices each generation choice once without per-choice count interpolation', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves['gate.rowCost']).toBe('{{cost}} total');
    expect(placeholders(leaves['gate.rowCost']!)).toEqual(['cost']);
  });

  it('names Beat and Shot removal actions as Move to Bin while preserving durable Bin states', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'board.liftBeat': 'Move to Bin',
      'board.liftConfirmTitle': 'Move {{title}} to the Bin?',
      'board.liftConfirmContent': 'This Beat leaves the film. All authored and paid work is kept in the Bin.',
      'beatPanel.lift.shot': 'Move to Bin',
      'beatPanel.lift.shotTitle': 'Move Shot {{index}} to the Bin?',
      'beatPanel.lift.shotBodyNoStale': 'Authored and paid work stays with this Shot. Move it to the Bin?',
      'beatPanel.lift.shotBodyStale':
        'Authored and paid work stays with this Shot. Moving it to the Bin makes {{shots}} stale.',
      'beatPanel.lift.confirmShot': 'Move to Bin',
      'beatPanel.lift.beat': 'Move to Bin',
      'beatPanel.lift.beatTitle': 'Move this Beat to the Bin?',
      'beatPanel.lift.beatBodyNoStale':
        'Every Shot and all authored and paid work stay with this Beat. Move it to the Bin?',
      'beatPanel.lift.beatBodyStale':
        'Every Shot and all authored and paid work stay with this Beat. Moving it to the Bin makes {{shots}} stale.',
      'beatPanel.lift.confirmBeat': 'Move to Bin',
    });
    expect(leaves['bin.reason.lifted']).toBe('Lifted');
  });

  it('uses the one-picture model in visible Library, Cut, and proposal copy', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'library.subtitle': 'Plan stories as Beats and Shots, then review every current picture.',
      'library.status.complete': 'All Shots have current pictures',
      'library.status.partial': 'Some Shots have current pictures',
      'cut.exports.editorFolderDescription':
        'Current Shot pictures, target slates, timeline data and the optional bed in film order.',
      'proposals.fixedReason.video_asset': 'It has a current picture.',
    });
    for (const key of localizedOnePicturePresentationKeys) expect(placeholders(leaves[key]!)).toEqual([]);
  });

  it('keeps one/other variants paired with identical interpolation parameters', () => {
    const leaves = flattenLeaves(englishWorkspace);
    const pluralBases = Object.keys(leaves)
      .filter((key) => key.endsWith('_one'))
      .map((key) => key.slice(0, -'_one'.length));

    expect(pluralBases).toHaveLength(19);
    for (const base of pluralBases) {
      expect(leaves[`${base}_other`], `${base}_other`).toBeTypeOf('string');
      expect(placeholders(leaves[`${base}_one`]!)).toEqual(placeholders(leaves[`${base}_other`]!));
    }
  });

  it.each([
    ['table.actualDuration', 15.069002, '15s'],
    ['board.actualDuration', 15.069002, '15s actual'],
    ['cut.filmDuration', 178.069002, '178s film'],
    ['cut.filmstripDuration', 15.069002, '15s'],
    ['cut.actualDuration', 15.069002, '15s actual'],
    ['cut.actualDuration', 15.5, '16s actual'],
    ['cut.actualDuration', 1440, '1440s actual'],
    ['cut.targetDuration', 15.6, '16s target slate'],
    ['beatPanel.coverage.sourceDuration', 15.069002, '15s source'],
    ['beatPanel.picture.sourceDuration', 15.069002, '15 seconds source'],
  ])(
    'rounds provider duration facts at the translation boundary for %s at %s seconds',
    async (key, seconds, expected) => {
      const i18n = i18next.createInstance();
      await i18n.init({
        lng: referenceLocale,
        fallbackLng: false,
        resources: { [referenceLocale]: { translation: { conversation: englishConversation } } },
        interpolation: { escapeValue: false },
      });

      expect(i18n.t(`conversation.creativeStudio.workspace.${key}`, { seconds })).toBe(expected);
    }
  );

  it('keeps film-level gaps in the same clock format as the film and target', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves['cut.film.over']).toBe('{{clock}} over');
    expect(leaves['cut.film.under']).toBe('{{clock}} under');
    expect(placeholders(leaves['cut.film.over']!)).toEqual(['clock']);
    expect(placeholders(leaves['cut.film.under']!)).toEqual(['clock']);
  });

  it.each([
    ['cut.bed.option', { position: 1, seconds: 14.6 }, 'Imported bed 1 · 15s'],
    [
      'cut.bed.fade',
      { sourceSeconds: 200.069002, startSeconds: 176.069002, endSeconds: 178.069002 },
      '200s source · fade from 176s to 178s',
    ],
    [
      'cut.bed.tooShort',
      { sourceSeconds: 160.069002, requiredSeconds: 178.069002 },
      'This audio is 160s, shorter than the 178s film. Choose a longer bed or shorten the film.',
    ],
    ['assets.audioFacts', { seconds: 14.6, bytes: 4096 }, '15s · 4096 bytes'],
  ])(
    'rounds imported-audio and derived film facts at the translation boundary for %s',
    async (key, values, expected) => {
      const i18n = i18next.createInstance();
      await i18n.init({
        lng: referenceLocale,
        fallbackLng: false,
        resources: { [referenceLocale]: { translation: { conversation: englishConversation } } },
        interpolation: { escapeValue: false },
      });

      expect(i18n.t(`conversation.creativeStudio.workspace.${key}`, values)).toBe(expected);
    }
  );

  it.each([
    [9, 16, 1, '9 Beats · 16 Shots · 1 Slate'],
    [1, 1, 0, '1 Beat · 1 Shot · 0 Slates'],
    [1, 0, 1, '1 Beat · 0 Shots · 1 Slate'],
  ])('pluralizes each Cut film count independently', async (beats, shots, slates, expected) => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: referenceLocale,
      fallbackLng: false,
      resources: { [referenceLocale]: { translation: { conversation: englishConversation } } },
      interpolation: { escapeValue: false },
    });
    const root = 'conversation.creativeStudio.workspace.cut';

    expect(
      i18n.t(`${root}.film.counts`, {
        beats: i18n.t(`${root}.film.beatCount`, { count: beats }),
        shots: i18n.t(`${root}.shotCount`, { count: shots }),
        slates: i18n.t(`${root}.film.slateCount`, { count: slates }),
      })
    ).toBe(expected);
  });

  it.each(deferredLocales)('keeps en-US Cut fallback plurals grammatical while %s is active', async (locale) => {
    const localeConversation = loadConversation(locale);
    const mergedConversation = mergeWithFallback(englishConversation, localeConversation);
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: locale,
      fallbackLng: false,
      resources: { [locale]: { translation: { conversation: mergedConversation } } },
      interpolation: { escapeValue: false },
    });
    const root = 'conversation.creativeStudio.workspace.cut';
    const counts = (count: number): string => {
      const suffix = count === 1 ? 'one' : 'other';
      return i18n.t(`${root}.film.counts`, {
        beats: i18n.t(`${root}.film.beatCount_${suffix}`, { count }),
        shots: i18n.t(`${root}.shotCount_${suffix}`, { count }),
        slates: i18n.t(`${root}.film.slateCount_${suffix}`, { count }),
      });
    };

    expect(counts(0)).toBe('0 Beats · 0 Shots · 0 Slates');
    expect(counts(1)).toBe('1 Beat · 1 Shot · 1 Slate');
    expect(counts(21)).toBe('21 Beats · 21 Shots · 21 Slates');
  });

  it('keeps superseded Cut promises out of the renderer inventory', () => {
    const leaves = flattenLeaves(englishWorkspace);
    const cutInventory = Object.entries(leaves)
      .filter(([key]) => key.startsWith('cut.') || key.startsWith('assets.'))
      .map(([key, value]) => `${key} ${value}`)
      .join('\n')
      .toLowerCase();

    expect(cutInventory).not.toContain('stitched');
    expect(cutInventory).not.toContain('auto-duck');
    expect(cutInventory).not.toContain('auto duck');
  });

  it('localizes the authored workspace subset and falls the rest back to the complete en-US workspace', () => {
    expect(deferredLocales).toHaveLength(11);
    const englishLeaves = flattenLeaves(englishWorkspace);

    for (const locale of deferredLocales) {
      const localeConversation = loadConversation(locale);
      const localizedTitle = briefAndRulesTitles[locale];
      const localizedLeaves = flattenLeaves(workspaceOf(localeConversation)!);
      expect(localizedTitle, locale).toBeTypeOf('string');
      expect(Object.keys(localizedLeaves).toSorted(), locale).toEqual(localizedWorkspaceKeys.toSorted());
      expect(localizedLeaves['controls.briefAndRulesTitle'], locale).toBe(localizedTitle);
      for (const field of ['action', 'look'] as const) {
        const conciseName = localizedLeaves[`beatPanel.fields.${field}`];
        const guidance = localizedLeaves[`beatPanel.fieldGuidance.${field}`];
        expect(guidance?.startsWith(`${conciseName} · `), `${locale}:${field}`).toBe(true);
      }
      for (const key of localizedCutPreviewKeys) {
        const englishCopy = englishLeaves[key];
        const localizedCopy = localizedLeaves[key];
        expect(localizedCopy?.trim(), `${locale}:${key}`).not.toBe('');
        expect(placeholders(localizedCopy!), `${locale}:${key}:localized placeholders`).toEqual(
          placeholders(englishCopy!)
        );
      }
      for (const key of [
        ...localizedCutCompositionKeys,
        ...localizedBeatPlaybackKeys,
        ...localizedBeatSegmentKeys,
        ...localizedCurrentPictureKeys,
        'library.pictureCount',
        'library.pictureCount_one',
        'library.pictureCount_other',
        ...localizedOnePicturePresentationKeys,
        ...localizedMoveToBinKeys,
      ]) {
        const englishCopy = englishLeaves[key];
        const localizedCopy = localizedLeaves[key];
        expect(localizedCopy?.trim(), `${locale}:${key}`).not.toBe('');
        expect(placeholders(localizedCopy!), `${locale}:${key}:localized placeholders`).toEqual(
          placeholders(englishCopy!)
        );
      }
      for (const key of localizedCutFilmDeltaKeys) {
        const englishCopy = englishLeaves[key];
        const localizedCopy = localizedLeaves[key];
        expect(localizedCopy?.trim(), `${locale}:${key}`).not.toBe('');
        expect(placeholders(localizedCopy!), `${locale}:${key}:localized placeholders`).toEqual(
          placeholders(englishCopy!)
        );
      }
      for (const key of localizedWorkspaceKeys.filter((candidate) => candidate.startsWith('gate.errors.pricing.'))) {
        expect(localizedLeaves[key]?.trim(), `${locale}:${key}`).not.toBe('');
      }

      const merged = mergeWithFallback(englishConversation, localeConversation);
      expect(flattenLeaves(workspaceOf(merged)!), locale).toEqual({
        ...englishLeaves,
        ...localizedLeaves,
      });
    }
  });

  it('authors the media-in-use refusal key in en-US', () => {
    const creativeStudio = asObject(englishConversation.creativeStudio, 'creativeStudio');
    const errors = asObject(creativeStudio.errors, 'creativeStudio.errors');

    expect(errors.mediaInUse).toBe(
      'This reference is in use by a queued paid request. Finish or cancel that request before detaching it.'
    );
  });

  it('localizes the seed-still variation-grid refusal in every configured locale', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversation(locale);
      const creativeStudio = asObject(conversation.creativeStudio, `${locale}.creativeStudio`);
      const jobs = asObject(creativeStudio.jobs, `${locale}.creativeStudio.jobs`);
      const errors = asObject(jobs.errors, `${locale}.creativeStudio.jobs.errors`);
      expect(errors.seedStillVariationGrid, locale).toBeTypeOf('string');
      expect((errors.seedStillVariationGrid as string).trim(), locale).not.toBe('');
    }

    const creativeStudio = asObject(englishConversation.creativeStudio, 'creativeStudio');
    const jobs = asObject(creativeStudio.jobs, 'creativeStudio.jobs');
    const errors = asObject(jobs.errors, 'creativeStudio.jobs.errors');
    expect(errors.seedStillVariationGrid).toBe(
      'The generated seed still contains a multi-panel variation grid and cannot be used for video.'
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
