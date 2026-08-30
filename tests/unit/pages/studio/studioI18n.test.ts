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
import { STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2 } from '@/common/types/project/creativeStudioTypes';

type JsonObject = Record<string, unknown>;

const localeRoot = join(process.cwd(), 'packages/desktop/src/renderer/services/i18n/locales');
const referenceLocale = i18nConfig.referenceLanguage;
const deferredLocales = i18nConfig.supportedLanguages.filter((locale) => locale !== referenceLocale);

const persistedUndoLabelKeys = STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2.map(
  (operation) => `controls.undoLabel.${operation}` as const
);
const localizedMediaUndoLabelKeys = [
  'controls.undoLabel.remove_reference_image',
  'controls.undoLabel.dismiss_seed_still',
  'controls.undoLabel.select_video_take',
  'controls.undoLabel.remove_video_take',
] as const;

const localizedFirstFrameTerms: Record<string, RegExp> = {
  'de-DE': /erste(?:s|n|m)? Bild/iu,
  'en-US': /first[ -]frame/iu,
  'es-ES': /primer fotograma/iu,
  'fa-IR': /فریم نخست/u,
  'ja-JP': /最初のフレーム/u,
  'ko-KR': /첫 프레임/u,
  'pt-BR': /primeiro quadro/iu,
  'ru-RU': /перв(?:ый|ого|ом) кадр/iu,
  'tr-TR': /[İi]lk kare/u,
  'uk-UA': /перш(?:ий|ого|ому) кадр/iu,
  'zh-CN': /首帧/u,
  'zh-TW': /首幀/u,
};

const localizedFirstFrameWorkspaceKeys = [
  'beatPanel.chain.hardCutState',
  'beatPanel.chain.reviewSeverDescription',
  'beatPanel.chain.reviewRejoinDescription',
  'beatPanel.chain.segmentHead',
  'beatPanel.coverage.segmentState.renderingStill',
  'beatPanel.seeds.stillLabel',
  'beatPanel.seeds.effective',
  'beatPanel.seeds.authorizationLocked',
  'gate.continuity.severSummary',
  'gate.continuity.rejoinSummary',
  'gate.continuity.severConfirmed',
  'gate.errors.pricing.missingConditioning',
] as const;

const localizedAuthorizedSeedRecoveryKeys = [
  'beatPanel.seeds.authorizationLocked',
  'beatPanel.seeds.authorizationIncompatible',
  'beatPanel.recovery.cancelAndReviewRejoin',
  'beatPanel.recovery.cancelAndReviewRejoinTitle',
  'beatPanel.recovery.cancelAndReviewRejoinBody',
  'beatPanel.recovery.cancelAndReviewRejoinConfirm',
  'beatPanel.recovery.cancelAndReviewRejoinUnconfirmed',
  'beatPanel.recovery.cancelAndReviewRejoinOutcomeUnknown',
] as const;

const localizedFirstFramesPanelKeys = [
  'beatPanel.firstFrames.title',
  'beatPanel.firstFrames.shotChip',
  'beatPanel.firstFrames.on',
  'beatPanel.firstFrames.status.notReady',
  'beatPanel.firstFrames.status.ready',
  'beatPanel.firstFrames.status.rendering',
  'beatPanel.firstFrames.status.rendered',
  'beatPanel.firstFrames.frameLabel',
  'beatPanel.firstFrames.origin.generated',
  'beatPanel.firstFrames.origin.imported',
  'beatPanel.firstFrames.origin.board',
  'beatPanel.firstFrames.origin.inherited',
  'beatPanel.firstFrames.current',
  'beatPanel.firstFrames.unavailable',
  'beatPanel.firstFrames.previewAlt',
  'beatPanel.firstFrames.openFrame',
  'beatPanel.firstFrames.pinned',
  'beatPanel.firstFrames.pin',
  'beatPanel.firstFrames.firstFrameChanged',
  'beatPanel.firstFrames.promptChanged',
  'beatPanel.firstFrames.import',
  'beatPanel.firstFrames.empty',
  'beatPanel.firstFrames.currentPicture',
  'beatPanel.firstFrames.pictureEmpty',
  'beatPanel.firstFrames.pictureAlt',
  'beatPanel.firstFrames.sendLastFrame',
  'beatPanel.firstFrames.cancelRun',
  'beatPanel.firstFrames.generateShot',
  'beatPanel.firstFrames.generateAgain',
  'beatPanel.firstFrames.promptLabel',
  'beatPanel.firstFrames.regenerate',
  'beatPanel.firstFrames.menu.download',
  'beatPanel.firstFrames.menu.copyPrompt',
  'beatPanel.firstFrames.menu.remove',
  'beatPanel.firstFrames.viewer.currentFirstFrame',
  'beatPanel.firstFrames.viewer.counter',
  'beatPanel.firstFrames.viewer.previous',
  'beatPanel.firstFrames.viewer.next',
] as const;

const localizedShotStatusKeys = [
  'shotStatus.notReady',
  'shotStatus.ready',
  'shotStatus.queued',
  'shotStatus.rendering',
  'shotStatus.rendered',
  'shotStatus.failed',
  'shotStatus.latestAttemptFailed',
] as const;

const localizedShotComposerKeys = [
  'beatPanel.composer.framesSet',
  'beatPanel.composer.start',
  'beatPanel.composer.end',
  'beatPanel.composer.references',
  'beatPanel.composer.startPreview',
  'beatPanel.composer.fromShot',
  'beatPanel.composer.endUnavailable',
  'beatPanel.composer.referencesBudget',
  'beatPanel.composer.promptPlaceholder',
  'beatPanel.composer.action.generate',
  'beatPanel.composer.action.regenerate',
  'beatPanel.composer.action.cancelRun',
  'beatPanel.composer.action.removeFromChain',
  'beatPanel.composer.action.tryAgain',
  'beatPanel.composer.action.fixStartFrame',
  'beatPanel.composer.tag.notCharged',
  'beatPanel.composer.tag.startFrameFailed',
  'beatPanel.composer.footnote.startRequired',
  'beatPanel.composer.footnote.startArrives',
  'beatPanel.composer.footnote.promptAsFired',
  'beatPanel.composer.footnote.lastFrameStartsNext',
  'beatPanel.composer.footnote.engineFailed',
  'beatPanel.composer.footnote.startFrameFailed',
  'beatPanel.composer.chain.rule',
  'beatPanel.composer.chain.runningRule',
  'beatPanel.composer.chain.generate',
  'beatPanel.composer.chain.stop',
] as const;

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

const localizedReferencesPanelKeys = [
  'referenceWorkflow.panel.canonicalImages',
  'referenceWorkflow.panel.intro',
  'referenceWorkflow.panel.progress',
  'referenceWorkflow.panel.bindShots',
  'referenceWorkflow.panel.characterRule',
  'referenceWorkflow.panel.placeRule',
  'referenceWorkflow.panel.addCharacter',
  'referenceWorkflow.panel.addCharacterUnavailable',
  'referenceWorkflow.panel.places',
  'referenceWorkflow.panel.addPlace',
  'referenceWorkflow.panel.kind.character',
  'referenceWorkflow.panel.kind.background',
  'referenceWorkflow.panel.nameLabel',
  'referenceWorkflow.panel.meta.character',
  'referenceWorkflow.panel.meta.background',
  'referenceWorkflow.panel.status.noPhoto',
  'referenceWorkflow.panel.status.current',
  'referenceWorkflow.panel.status.generating',
  'referenceWorkflow.panel.duplicateName',
  'referenceWorkflow.panel.emptyPhoto',
  'referenceWorkflow.panel.currentHandle',
  'referenceWorkflow.panel.currentReference',
  'referenceWorkflow.panel.download',
  'referenceWorkflow.panel.choosePhoto',
  'referenceWorkflow.panel.addPhoto',
  'referenceWorkflow.panel.importPhoto',
  'referenceWorkflow.panel.removePhoto',
  'referenceWorkflow.panel.removePhotoLocked',
  'referenceWorkflow.panel.removalBlocker.activeReferenceJob',
  'referenceWorkflow.panel.removalBlocker.activeAssetConsumer',
  'referenceWorkflow.panel.removalBlocker.activeAssetConsumerRetained',
  'referenceWorkflow.panel.removalBlocker.activeAssetConsumerOther',
  'referenceWorkflow.panel.removalBlocker.downloadRecovery',
  'referenceWorkflow.panel.removalBlocker.downloadRecoveryRetainedShot',
  'referenceWorkflow.panel.removalBlocker.downloadRecoveryRetainedBeat',
  'referenceWorkflow.panel.removalBlocker.downloadRecoveryOther',
  'referenceWorkflow.panel.removalBlocker.invalidAuthority',
  'referenceWorkflow.panel.removalBlocker.reviewInBoard',
  'referenceWorkflow.panel.photoCount',
  'referenceWorkflow.panel.promptLabel',
  'referenceWorkflow.panel.promptPlaceholder.character',
  'referenceWorkflow.panel.promptPlaceholder.background',
  'referenceWorkflow.panel.action.generate',
  'referenceWorkflow.panel.action.generateAnother',
  'referenceWorkflow.panel.action.generateAgain',
  'referenceWorkflow.panel.action.cancelRun',
  'referenceWorkflow.panel.tag.running',
  'referenceWorkflow.panel.tag.edited',
] as const;

const localizedFilmExportKeys = [
  'filmExport.action',
  'filmExport.actionWithSlates',
  'filmExport.actionWithSlates_one',
  'filmExport.actionWithSlates_other',
  'filmExport.cancel',
  'filmExport.cut',
  'filmExport.description',
  'filmExport.disabled.bed_too_short',
  'filmExport.disabled.catalogUnavailable',
  'filmExport.disabled.duration_pending',
  'filmExport.disabled.exportRunning',
  'filmExport.disabled.invalid_media',
  'filmExport.disabled.mutationActive',
  'filmExport.disabled.no_beats',
  'filmExport.dismiss',
  'filmExport.dissolve',
  'filmExport.errors.artifactUnavailable',
  'filmExport.errors.busy',
  'filmExport.errors.cancelled',
  'filmExport.errors.catalogUnavailable',
  'filmExport.errors.invalidMedia',
  'filmExport.errors.renderFailed',
  'filmExport.errors.resultConflict',
  'filmExport.errors.staleCatalog',
  'filmExport.errors.staleAuthority',
  'filmExport.errors.unavailable',
  'filmExport.export',
  'filmExport.noSpend',
  'filmExport.phase.analyzing',
  'filmExport.phase.preparing',
  'filmExport.phase.publishing',
  'filmExport.phase.rendering',
  'filmExport.reveal',
  'filmExport.successFacts',
  'filmExport.successFacts_one',
  'filmExport.successFacts_other',
  'filmExport.successQuarantine',
  'filmExport.successQuarantine_one',
  'filmExport.successQuarantine_other',
  'filmExport.title',
  'filmExport.transition',
  'filmExport.trimTails',
  'filmExport.trimTailsHelp',
] as const;

const localizedBoardShotTileKeys = [
  'board.statusUnavailable',
  'board.renderedCount',
  'board.staleCount',
  'board.staleCount_one',
  'board.staleCount_other',
  'board.inFlightCount',
  'board.inFlightCount_one',
  'board.inFlightCount_other',
  'board.shot.ariaLabel',
  'board.shot.listLabel',
  'board.shot.position',
  'board.shot.videoPreview',
  'board.shot.stale',
  'board.shot.chainHead',
  'board.shot.chainAfter',
  'board.shot.duration',
  'board.shot.statusUnavailable',
  'board.shot.blocker.heading',
  'board.shot.blocker.referenceBindingTable',
  'board.shot.blocker.reviewOnTable',
  'board.shot.blocker.cause.routeInventoryUnavailable',
  'board.shot.blocker.cause.routeNotSelected',
  'board.shot.blocker.cause.routeSetupRequired',
  'board.shot.blocker.cause.routeUnavailable',
  'board.shot.blocker.cause.routeRetired',
  'board.shot.blocker.cause.routeIncompatibleFrame',
  'board.shot.blocker.cause.routeFirstFrameUnsupported',
  'board.shot.blocker.cause.routeDurationUnsupported',
  'board.shot.blocker.cause.referencePlanInvalid',
  'board.shot.blocker.cause.referenceGenerationRequired',
  'board.shot.blocker.cause.referenceApprovalRequired',
  'board.shot.blocker.cause.referenceGenerationFailed',
  'board.shot.blocker.cause.referenceBindingUnassigned',
  'board.shot.blocker.cause.referenceBindingUnknownReference',
  'board.shot.blocker.cause.referenceBindingWrongKind',
  'board.shot.blocker.cause.referenceBindingUnapprovedReference',
  'board.shot.blocker.cause.referenceBindingMissingAsset',
  'board.shot.blocker.cause.referenceBindingCapacityExceeded',
  'board.shot.blocker.cause.seedSelectionRequired',
  'board.shot.blocker.cause.seedGenerationRequired',
  'board.shot.blocker.cause.conditioningFrameRequired',
  'board.shot.blocker.cause.extractionFailed',
  'board.shot.blocker.cause.dependencyFailed',
  'board.shot.blocker.cause.generationInvalidRequest',
  'board.shot.blocker.cause.generationContentRejected',
  'board.shot.blocker.cause.generationAuth',
  'board.shot.blocker.cause.generationQuota',
  'board.shot.blocker.cause.generationRateLimited',
  'board.shot.blocker.cause.generationProviderUnavailable',
  'board.shot.blocker.cause.generationTimeout',
  'board.shot.blocker.cause.generationPollDeadline',
  'board.shot.blocker.cause.generationNoOutput',
  'board.shot.blocker.cause.generationVariationGrid',
  'board.shot.blocker.cause.generationSubmissionUnknown',
  'board.shot.blocker.cause.generationDownloadFailed',
  'board.shot.blocker.cause.generationUnsupported',
  'board.shot.blocker.cause.generationUnknown',
  'board.shot.blocker.cause.cutInvalidMedia',
  'board.shot.blocker.cause.cutBedTooShort',
] as const;

const localizedBoardControlKeys = [
  'board.controls.label',
  'board.controls.progress',
  'board.controls.progressLabel',
  'board.controls.staleCount',
  'board.controls.busyCount',
  'board.controls.stop',
  'board.controls.stopNote',
  'board.controls.drawNext',
] as const;

const localizedBoardPanelKeys = [
  'board.panel.beatActions',
  'board.panel.drawMissing',
  'board.panel.redrawBeat',
  'board.panel.cardLabel',
  'board.panel.redrawShot',
  'board.panel.useAsFirstFrame',
  'board.panel.status.missing',
  'board.panel.status.current',
  'board.panel.status.stale',
  'board.panel.status.statusPending',
  'board.panel.status.queued',
  'board.panel.status.drawing',
  'board.panel.status.needsAttention',
  'board.panel.status.failed',
  'board.panel.status.cancelled',
] as const;

const localizedTableReorderKeys = [
  'table.reorder.label',
  'table.reorder.dragHandle',
  'table.reorder.moveEarlier',
  'table.reorder.moveLater',
  'table.reorder.announcement',
  'table.reorder.failed',
] as const;

const localizedPaidRecoveryKeys = [
  'proposals.paidRecovery.heading',
  'proposals.paidRecovery.explanation',
  'proposals.paidRecovery.blockedBy',
  'proposals.paidRecovery.affectedWork',
  'proposals.paidRecovery.price',
  'proposals.paidRecovery.priceRange',
  'proposals.paidRecovery.generations',
  'proposals.paidRecovery.generationCount',
  'proposals.paidRecovery.includesCascade',
  'proposals.paidRecovery.expires',
  'proposals.paidRecovery.expired',
  'proposals.paidRecovery.confirm',
  'proposals.paidRecovery.refresh',
  'proposals.paidRecovery.refreshed',
  'proposals.paidRecovery.cardOnly',
  'proposals.paidRecovery.location.project',
  'proposals.paidRecovery.location.cut',
  'proposals.paidRecovery.location.route',
  'proposals.paidRecovery.location.reference',
  'proposals.paidRecovery.location.shot',
] as const;

const localizedPlaybackAudioKeys = [
  'playbackAudio.label',
  'playbackAudio.mute',
  'playbackAudio.unmute',
  'playbackAudio.muted',
  'playbackAudio.audible',
  'playbackAudio.volume',
  'playbackAudio.shotStatus.analyzing',
  'playbackAudio.shotStatus.audible',
  'playbackAudio.shotStatus.effectivelySilent',
  'playbackAudio.shotStatus.noAudioStream',
  'playbackAudio.shotStatus.unavailable',
] as const;

const localizedVideoAudioCapabilityKeys = [
  'controls.videoAudioCapability.silentOnly',
  'controls.videoAudioCapability.audioCapable',
] as const;

const expectedLeaves = [
  ...localizedFirstFramesPanelKeys,
  ...localizedShotStatusKeys,
  ...localizedShotComposerKeys,
  ...localizedPlaybackAudioKeys,
  ...localizedVideoAudioCapabilityKeys,
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
  'editorFolderExport.action',
  'editorFolderExport.actionWithSlates',
  'editorFolderExport.exporting',
  'editorFolderExport.reveal',
  'editorFolderExport.dismiss',
  'editorFolderExport.none',
  'editorFolderExport.successFacts',
  'editorFolderExport.successSlates',
  'editorFolderExport.successQuarantine',
  'editorFolderExport.disabled.no_beats',
  'editorFolderExport.disabled.duration_pending',
  'editorFolderExport.disabled.invalid_media',
  'editorFolderExport.disabled.bed_too_short',
  'editorFolderExport.disabled.mutationActive',
  'editorFolderExport.disabled.exportRunning',
  'editorFolderExport.disabled.catalogUnavailable',
  'editorFolderExport.errors.catalogUnavailable',
  'editorFolderExport.errors.staleCatalog',
  'editorFolderExport.errors.staleAuthority',
  'editorFolderExport.errors.invalidMedia',
  'editorFolderExport.errors.mediaUnavailable',
  'editorFolderExport.errors.busy',
  'editorFolderExport.errors.artifactUnavailable',
  'editorFolderExport.errors.resultConflict',
  ...localizedFilmExportKeys,
  'project.backToLibrary',
  'project.loading',
  'project.notFound',
  'project.structure',
  'project.against',
  'project.ready',
  'project.statusUnavailable',
  'project.blockers',
  'project.blockers_one',
  'project.blockers_other',
  'project.unsupportedPrototype',
  'views.title',
  'views.references',
  'views.table',
  'views.board',
  'views.cut',
  ...localizedReferencesPanelKeys,
  'referenceWorkflow.description',
  'referenceWorkflow.generationScope',
  'referenceWorkflow.characters.title',
  'referenceWorkflow.characters.description',
  'referenceWorkflow.characters.empty',
  'referenceWorkflow.backgrounds.title',
  'referenceWorkflow.backgrounds.description',
  'referenceWorkflow.backgrounds.charactersRequired',
  'referenceWorkflow.backgrounds.empty',
  'referenceWorkflow.backgrounds.add',
  'referenceWorkflow.backgrounds.addTitle',
  'referenceWorkflow.backgrounds.nameLabel',
  'referenceWorkflow.backgrounds.promptLabel',
  'referenceWorkflow.backgrounds.duplicate',
  'referenceWorkflow.backgrounds.cancel',
  'referenceWorkflow.backgrounds.confirm',
  'referenceWorkflow.previewPending',
  'referenceWorkflow.previewAlt',
  'referenceWorkflow.status.idle',
  'referenceWorkflow.status.queued',
  'referenceWorkflow.status.running',
  'referenceWorkflow.status.succeeded',
  'referenceWorkflow.status.failed',
  'referenceWorkflow.status.current',
  'referenceWorkflow.regenerate',
  'referenceWorkflow.chooseGenerated',
  'referenceWorkflow.regeneratePromptLabel',
  'referenceWorkflow.regenerateCancel',
  'referenceWorkflow.reviewGeneration',
  'referenceWorkflow.generatedHistory',
  'referenceWorkflow.historyClose',
  'referenceWorkflow.historyPreviewAlt',
  'referenceWorkflow.historyCurrent',
  'referenceWorkflow.historyChoose',
  'referenceWorkflow.currentProgress',
  'referenceWorkflow.bindings.title',
  'referenceWorkflow.bindings.description',
  'referenceWorkflow.bindings.empty',
  'referenceWorkflow.bindings.shot',
  'referenceWorkflow.bindings.progress',
  'referenceWorkflow.bindings.unassigned',
  'referenceWorkflow.bindings.invalid',
  'referenceWorkflow.bindings.capacity',
  'referenceWorkflow.bindings.capacityUsage',
  'referenceWorkflow.bindings.characters',
  'referenceWorkflow.bindings.background',
  'referenceWorkflow.bindings.save',
  'table.label',
  'table.authoring.label',
  'table.authoring.coverageGap',
  'table.authoring.coverageGap_one',
  'table.authoring.coverageGap_other',
  'table.authoring.unscriptedWarning',
  'table.authoring.unscriptedWarning_one',
  'table.authoring.unscriptedWarning_other',
  'table.authoring.askDirector',
  'table.authoring.addBeat',
  'table.authoring.addShot',
  'table.authoring.addShotForBeat',
  'table.authoring.unassignedReferenceNote',
  ...localizedTableReorderKeys,
  'table.columns.position',
  'table.columns.beat',
  'table.columns.story',
  'table.columns.shots',
  'table.columns.panel',
  'table.columns.length',
  'table.panel.openDetails',
  'table.panel.closeDetails',
  'table.panel.cardLabel',
  'table.panel.shotDetails',
  'table.panel.head',
  'table.panel.status.missing',
  'table.panel.status.current',
  'table.panel.status.stale',
  'table.panel.status.statusPending',
  'table.panel.status.queued',
  'table.panel.status.drawing',
  'table.panel.status.needsAttention',
  'table.panel.status.failed',
  'table.panel.status.cancelled',
  'table.shotCount',
  'table.shotCount_one',
  'table.shotCount_other',
  'table.actualDuration',
  'table.plannedPending',
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
  ...localizedBoardControlKeys,
  ...localizedBoardPanelKeys,
  'board.ariaLabel',
  'board.openBeat',
  'board.selectedBeat',
  'board.ordinal',
  'board.shotCount',
  'board.shotCount_one',
  'board.shotCount_other',
  'board.actualDuration',
  'board.noCoverage',
  'board.coverUnavailable',
  ...localizedBoardShotTileKeys,
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
  'cut.preview.shotAudioOnly',
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
  'beatPanel.fieldGuidance.story',
  'beatPanel.directorRequestHint',
  'beatPanel.common.cancel',
  'beatPanel.common.keepWaiting',
  'beatPanel.common.saveBeat',
  'beatPanel.common.resetBeat',
  'beatPanel.common.saveShot',
  'beatPanel.common.resetShot',
  'beatPanel.fields.duration',
  'beatPanel.fields.durationFor',
  'beatPanel.fields.story',
  'beatPanel.fields.shootingScript',
  'beatPanel.fields.shootingScriptFor',
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
  'beatPanel.seeds.label',
  'beatPanel.seeds.title',
  'beatPanel.seeds.stillLabel',
  'beatPanel.seeds.previewAlt',
  'beatPanel.seeds.effective',
  'beatPanel.seeds.pinnedBadge',
  'beatPanel.seeds.authorizationLocked',
  'beatPanel.seeds.authorizationIncompatible',
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
  'beatPanel.recovery.cancelAndReviewRejoin',
  'beatPanel.recovery.cancelAndReviewRejoinTitle',
  'beatPanel.recovery.cancelAndReviewRejoinBody',
  'beatPanel.recovery.cancelAndReviewRejoinConfirm',
  'beatPanel.recovery.cancelAndReviewRejoinUnconfirmed',
  'beatPanel.recovery.cancelAndReviewRejoinOutcomeUnknown',
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
  'library.projectStatus.summary',
  'library.projectStatus.unavailable',
  'library.projectStatus.stage.brief',
  'library.projectStatus.stage.engines',
  'library.projectStatus.stage.references',
  'library.projectStatus.stage.storyboard',
  'library.projectStatus.stage.bindings',
  'library.projectStatus.stage.production',
  'library.projectStatus.stage.cut',
  'library.projectStatus.progress.ready',
  'library.projectStatus.progress.needsWork',
  'library.projectStatus.progress.references',
  'library.projectStatus.progress.shots',
  'library.composer.label',
  'library.composer.placeholder',
  'library.composer.aspectRatioLabel',
  'library.composer.durationLabel',
  'library.composer.durationGuess',
  'library.composer.submit',
  'library.composer.empty',
  'proposals.title',
  'proposals.proposalId',
  'proposals.ownerBeat',
  'proposals.before',
  'proposals.after',
  'proposals.reviewUnavailable',
  'proposals.refusal.applyCoverage',
  'proposals.refusal.applyCoverageFixedWork',
  'proposals.refusal.editShotsDirectly',
  'proposals.refusal.reason.beat_capacity_reached',
  'proposals.refusal.reason.beat_shot_capacity_reached',
  'proposals.refusal.reason.project_shot_capacity_reached',
  'proposals.refusal.reason.invalid_shot_duration',
  'proposals.refusal.reason.dependency_blocked',
  'proposals.refusal.reason.identity_collision',
  'proposals.refusal.reason.invalid_operation',
  'proposals.refusal.reason.undo_conflict',
  'proposals.refusal.reason.validation_failed',
  'proposals.refusal.fixedReason.owned_asset',
  'proposals.refusal.fixedReason.owned_job',
  'proposals.refusal.fixedReason.video_asset',
  'proposals.refusal.fixedReason.seed_still',
  'proposals.refusal.fixedReason.conditioning_frame',
  'proposals.refusal.fixedReason.conditioning_input',
  'proposals.refusal.fixedReason.shooting_script',
  'proposals.refreshing',
  'proposals.authorityUnavailable',
  'proposals.requestUpdated',
  'proposals.saveAndRequestUpdated',
  'proposals.reviewRuleDrafts',
  'proposals.reviewRuleDraftsFirst',
  'proposals.reproposalPrompt',
  'proposals.chatAccepted',
  'proposals.chatRejected',
  'proposals.chatNoPending',
  'proposals.chatMultiplePending',
  'proposals.chatProposalNotFound',
  'proposals.chatUnavailable',
  'proposals.chatStale',
  'proposals.chatDecisionBusy',
  'proposals.chatDirty',
  'proposals.revision',
  'proposals.mutationCount',
  'proposals.mutationCount_one',
  'proposals.mutationCount_other',
  'proposals.terminalCount',
  'proposals.terminalCount_one',
  'proposals.terminalCount_other',
  'proposals.showTerminal',
  'proposals.hideTerminal',
  'proposals.reviewDetails',
  'proposals.emptyAuthoredField',
  'proposals.reviewStale',
  'proposals.noChanges',
  ...localizedPaidRecoveryKeys,
  'proposals.subject.project',
  'proposals.subject.reference',
  'proposals.subject.beat',
  'proposals.subject.shot',
  'proposals.change.added',
  'proposals.change.edited',
  'proposals.change.removed',
  'proposals.change.reordered',
  'proposals.placementValue.active',
  'proposals.placementValue.bin',
  'proposals.placementValue.removed',
  'proposals.field.name',
  'proposals.field.brief',
  'proposals.field.rules',
  'proposals.field.aspectRatio',
  'proposals.field.resolution',
  'proposals.field.targetDurationSeconds',
  'proposals.field.boardStyle',
  'proposals.field.prompt',
  'proposals.field.title',
  'proposals.field.story',
  'proposals.field.targetSeconds',
  'proposals.field.shootingScript',
  'proposals.field.durationSeconds',
  'proposals.field.chainBreak',
  'proposals.field.placement',
  'proposals.field.order',
  'proposals.saveBeforeApply',
  'proposals.accept',
  'proposals.reject',
  'references.title',
  'references.referenceCount',
  'references.generate',
  'references.reject',
  'handoffs.title',
  'handoffs.referenceCount',
  'handoffs.progress',
  'handoffs.awaiting_spend',
  'handoffs.running',
  'handoffs.succeeded',
  'handoffs.partially_failed',
  'handoffs.failed',
  'handoffs.review',
  'handoffs.reviewReferences',
  'handoffs.retryFailed',
  'handoffs.dismiss',
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
  ...persistedUndoLabelKeys,
  'controls.undoLabel.select_video_take',
  'controls.undoLabel.remove_video_take',
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
  'gate.referenceGridRetry',
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
  'gate.continuity.severHeadline_one',
  'gate.continuity.severHeadline_other',
  'gate.continuity.rejoinHeadline',
  'gate.continuity.rejoinHeadline_one',
  'gate.continuity.rejoinHeadline_other',
  'gate.continuity.requiredWork',
  'gate.continuity.confirmSever',
  'gate.continuity.confirmSever_one',
  'gate.continuity.confirmSever_other',
  'gate.continuity.confirmRejoin',
  'gate.continuity.confirmRejoin_one',
  'gate.continuity.confirmRejoin_other',
  'gate.continuity.close',
  'gate.continuity.severConfirmed',
  'gate.continuity.rejoinConfirmed',
  'gate.promotion.title',
  'gate.promotion.summary',
  'gate.promotion.impactNone',
  'gate.promotion.impactIntro',
  'gate.promotion.impactItem',
  'gate.promotion.optionsLabel',
  'gate.promotion.promoteOnly',
  'gate.promotion.freePrice',
  'gate.promotion.promoteAndRerender',
  'gate.promotion.priceAfterReview',
  'gate.promotion.promoteOnlyAction',
  'gate.promotion.reviewPaidAction',
  'gate.promotion.paidUnavailable',
  'gate.promotion.headline',
  'gate.promotion.requiredWork',
  'gate.promotion.confirm',
  'gate.promotion.promoted',
  'gate.promotion.promoting',
  'gate.promotion.confirmed',
  'gate.promotion.close',
  'gate.rateCardSource',
  'gate.showBreakdown',
  'gate.conditioningFrameAlt',
  'gate.hideBreakdown',
  'gate.group.base',
  'gate.group.cascade',
  'gate.group.required',
  'gate.purpose.board_still',
  'gate.purpose.seed_still',
  'gate.purpose.video_take',
  'gate.purpose.reference_image',
  'gate.route',
  'gate.routeShared',
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
  'gate.errors.pricing.missingShootingScript',
  'gate.errors.pricing.missingConditioning',
  'gate.errors.pricing.unsafeTotal',
  'gate.reviewShotBinding',
  'gate.readout.prompt',
  'gate.readout.rendersAs',
  'gate.readout.sourceRevision',
  'gate.readout.source',
  'gate.readout.story',
  'gate.readout.shootingScript',
  'gate.readout.referencePrompt',
  'gate.readout.references',
  'gate.readout.noReferences',
  'gate.readout.referenceFact',
  'review.title',
] as const;

const placeholders = (value: string): string[] =>
  [...value.matchAll(/{{\s*([^},\s]+)(?:\s*,[^}]*)?\s*}}/g)].map((match) => match[1]!).sort();

const briefAndRulesTitles: Record<string, string> = {
  'de-DE': 'Film-Einrichtung',
  'en-US': 'Film setup',
  'es-ES': 'Configuración de la película',
  'fa-IR': 'تنظیمات فیلم',
  'ja-JP': '映画設定',
  'ko-KR': '영화 설정',
  'pt-BR': 'Configuração do filme',
  'ru-RU': 'Настройка фильма',
  'tr-TR': 'Film kurulumu',
  'uk-UA': 'Налаштування фільму',
  'zh-CN': '影片设置',
  'zh-TW': '影片設定',
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
  'cut.preview.shotAudioOnly',
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

const localizedBoardKeys = [
  ...localizedBoardShotTileKeys,
  ...localizedBoardControlKeys,
  ...localizedBoardPanelKeys,
  ...localizedTableReorderKeys,
  'table.authoring.label',
  'table.authoring.coverageGap',
  'table.authoring.coverageGap_one',
  'table.authoring.coverageGap_other',
  'table.authoring.unscriptedWarning',
  'table.authoring.unscriptedWarning_one',
  'table.authoring.unscriptedWarning_other',
  'table.authoring.askDirector',
  'table.authoring.addBeat',
  'table.authoring.addShot',
  'table.authoring.addShotForBeat',
  'table.authoring.unassignedReferenceNote',
  'table.columns.panel',
  'table.panel.openDetails',
  'table.panel.closeDetails',
  'table.panel.cardLabel',
  'table.panel.shotDetails',
  'table.panel.head',
  'table.panel.status.missing',
  'table.panel.status.current',
  'table.panel.status.stale',
  'table.panel.status.statusPending',
  'table.panel.status.queued',
  'table.panel.status.drawing',
  'table.panel.status.needsAttention',
  'table.panel.status.failed',
  'table.panel.status.cancelled',
  'gate.purpose.board_still',
  'gate.errors.pricing.missingShootingScript',
] as const;

const localizedBoardPromotionKeys = [
  'controls.undoLabel.promote_board_panel',
  'gate.promotion.title',
  'gate.promotion.summary',
  'gate.promotion.impactNone',
  'gate.promotion.impactIntro',
  'gate.promotion.impactItem',
  'gate.promotion.optionsLabel',
  'gate.promotion.promoteOnly',
  'gate.promotion.freePrice',
  'gate.promotion.promoteAndRerender',
  'gate.promotion.priceAfterReview',
  'gate.promotion.promoteOnlyAction',
  'gate.promotion.reviewPaidAction',
  'gate.promotion.paidUnavailable',
  'gate.promotion.headline',
  'gate.promotion.requiredWork',
  'gate.promotion.confirm',
  'gate.promotion.promoted',
  'gate.promotion.promoting',
  'gate.promotion.confirmed',
  'gate.promotion.close',
] as const;

const localizedOnePicturePresentationKeys = ['library.subtitle', 'cut.exports.editorFolderDescription'] as const;

const localizedProjectStatusKeys = [
  'project.statusUnavailable',
  'project.blockers',
  'project.blockers_one',
  'project.blockers_other',
  'library.projectStatus.summary',
  'library.projectStatus.unavailable',
  'library.projectStatus.stage.brief',
  'library.projectStatus.stage.engines',
  'library.projectStatus.stage.references',
  'library.projectStatus.stage.storyboard',
  'library.projectStatus.stage.bindings',
  'library.projectStatus.stage.production',
  'library.projectStatus.stage.cut',
  'library.projectStatus.progress.ready',
  'library.projectStatus.progress.needsWork',
  'library.projectStatus.progress.references',
  'library.projectStatus.progress.shots',
] as const;

const localizedWorkspaceKeys = [
  ...localizedFirstFramesPanelKeys,
  ...localizedShotStatusKeys,
  ...localizedShotComposerKeys,
  ...localizedPlaybackAudioKeys,
  ...localizedVideoAudioCapabilityKeys,
  ...localizedReferencesPanelKeys,
  'proposals.proposalId',
  'proposals.mutationCount',
  'proposals.mutationCount_one',
  'proposals.mutationCount_other',
  'proposals.terminalCount',
  'proposals.terminalCount_one',
  'proposals.terminalCount_other',
  'proposals.showTerminal',
  'proposals.hideTerminal',
  'proposals.reviewDetails',
  'proposals.ownerBeat',
  'proposals.before',
  'proposals.after',
  'proposals.reviewUnavailable',
  'proposals.refusal.applyCoverage',
  'proposals.refusal.applyCoverageFixedWork',
  'proposals.refusal.editShotsDirectly',
  'proposals.refusal.reason.beat_capacity_reached',
  'proposals.refusal.reason.beat_shot_capacity_reached',
  'proposals.refusal.reason.project_shot_capacity_reached',
  'proposals.refusal.reason.invalid_shot_duration',
  'proposals.refusal.reason.dependency_blocked',
  'proposals.refusal.reason.identity_collision',
  'proposals.refusal.reason.invalid_operation',
  'proposals.refusal.reason.undo_conflict',
  'proposals.refusal.reason.validation_failed',
  'proposals.refusal.fixedReason.owned_asset',
  'proposals.refusal.fixedReason.owned_job',
  'proposals.refusal.fixedReason.video_asset',
  'proposals.refusal.fixedReason.seed_still',
  'proposals.refusal.fixedReason.conditioning_frame',
  'proposals.refusal.fixedReason.conditioning_input',
  'proposals.refusal.fixedReason.shooting_script',
  'proposals.refreshing',
  'proposals.authorityUnavailable',
  'proposals.requestUpdated',
  'proposals.saveAndRequestUpdated',
  'proposals.reviewRuleDrafts',
  'proposals.reviewRuleDraftsFirst',
  'proposals.reproposalPrompt',
  'proposals.chatAccepted',
  'proposals.chatRejected',
  'proposals.chatNoPending',
  'proposals.chatMultiplePending',
  'proposals.chatProposalNotFound',
  'proposals.chatUnavailable',
  'proposals.chatStale',
  'proposals.chatDecisionBusy',
  'proposals.chatDirty',
  'proposals.reviewStale',
  'proposals.noChanges',
  ...localizedPaidRecoveryKeys,
  'proposals.subject.project',
  'proposals.subject.reference',
  'proposals.subject.beat',
  'proposals.subject.shot',
  'proposals.change.added',
  'proposals.change.edited',
  'proposals.change.removed',
  'proposals.change.reordered',
  'proposals.placementValue.active',
  'proposals.placementValue.bin',
  'proposals.placementValue.removed',
  'proposals.field.name',
  'proposals.field.brief',
  'proposals.field.rules',
  'proposals.field.aspectRatio',
  'proposals.field.resolution',
  'proposals.field.targetDurationSeconds',
  'proposals.field.boardStyle',
  'proposals.field.prompt',
  'proposals.field.title',
  'proposals.field.story',
  'proposals.field.targetSeconds',
  'proposals.field.shootingScript',
  'proposals.field.durationSeconds',
  'proposals.field.chainBreak',
  'proposals.field.placement',
  'proposals.field.order',
  'views.references',
  'editorFolderExport.action',
  'editorFolderExport.actionWithSlates',
  'editorFolderExport.exporting',
  'editorFolderExport.reveal',
  'editorFolderExport.dismiss',
  'editorFolderExport.none',
  'editorFolderExport.successFacts',
  'editorFolderExport.successSlates',
  'editorFolderExport.successQuarantine',
  'editorFolderExport.disabled.no_beats',
  'editorFolderExport.disabled.duration_pending',
  'editorFolderExport.disabled.invalid_media',
  'editorFolderExport.disabled.bed_too_short',
  'editorFolderExport.disabled.mutationActive',
  'editorFolderExport.disabled.exportRunning',
  'editorFolderExport.disabled.catalogUnavailable',
  'editorFolderExport.errors.catalogUnavailable',
  'editorFolderExport.errors.staleCatalog',
  'editorFolderExport.errors.staleAuthority',
  'editorFolderExport.errors.invalidMedia',
  'editorFolderExport.errors.mediaUnavailable',
  'editorFolderExport.errors.busy',
  'editorFolderExport.errors.artifactUnavailable',
  'editorFolderExport.errors.resultConflict',
  ...localizedFilmExportKeys,
  'referenceWorkflow.description',
  'referenceWorkflow.generationScope',
  'referenceWorkflow.characters.title',
  'referenceWorkflow.characters.description',
  'referenceWorkflow.characters.empty',
  'referenceWorkflow.backgrounds.title',
  'referenceWorkflow.backgrounds.description',
  'referenceWorkflow.backgrounds.charactersRequired',
  'referenceWorkflow.backgrounds.empty',
  'referenceWorkflow.backgrounds.add',
  'referenceWorkflow.backgrounds.addTitle',
  'referenceWorkflow.backgrounds.nameLabel',
  'referenceWorkflow.backgrounds.promptLabel',
  'referenceWorkflow.backgrounds.duplicate',
  'referenceWorkflow.backgrounds.cancel',
  'referenceWorkflow.backgrounds.confirm',
  'referenceWorkflow.previewPending',
  'referenceWorkflow.previewAlt',
  'referenceWorkflow.status.idle',
  'referenceWorkflow.status.queued',
  'referenceWorkflow.status.running',
  'referenceWorkflow.status.succeeded',
  'referenceWorkflow.status.failed',
  'referenceWorkflow.status.current',
  'referenceWorkflow.regenerate',
  'referenceWorkflow.chooseGenerated',
  'referenceWorkflow.regeneratePromptLabel',
  'referenceWorkflow.regenerateCancel',
  'referenceWorkflow.reviewGeneration',
  'referenceWorkflow.generatedHistory',
  'referenceWorkflow.historyClose',
  'referenceWorkflow.historyPreviewAlt',
  'referenceWorkflow.historyCurrent',
  'referenceWorkflow.historyChoose',
  'referenceWorkflow.currentProgress',
  'referenceWorkflow.bindings.title',
  'referenceWorkflow.bindings.description',
  'referenceWorkflow.bindings.empty',
  'referenceWorkflow.bindings.shot',
  'referenceWorkflow.bindings.progress',
  'referenceWorkflow.bindings.unassigned',
  'referenceWorkflow.bindings.invalid',
  'referenceWorkflow.bindings.capacity',
  'referenceWorkflow.bindings.capacityUsage',
  'referenceWorkflow.bindings.characters',
  'referenceWorkflow.bindings.background',
  'referenceWorkflow.bindings.save',
  'beatPanel.beatFieldsLabel',
  'beatPanel.directorRequestHint',
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
  'beatPanel.fieldGuidance.story',
  'beatPanel.fields.story',
  'beatPanel.fields.shootingScript',
  'beatPanel.fields.shootingScriptFor',
  ...localizedCurrentPictureKeys,
  ...localizedAuthorizedSeedRecoveryKeys,
  'library.pictureCount',
  'library.pictureCount_one',
  'library.pictureCount_other',
  ...localizedOnePicturePresentationKeys,
  ...localizedProjectStatusKeys,
  ...localizedCutPreviewKeys,
  ...localizedCutCompositionKeys,
  ...localizedBeatPlaybackKeys,
  ...localizedBeatSegmentKeys,
  ...localizedCutFilmDeltaKeys,
  ...localizedMoveToBinKeys,
  ...localizedBoardKeys,
  ...localizedBoardPromotionKeys,
  'table.columns.length',
  'table.columns.story',
  'table.plannedPending',
  'controls.briefAndRulesTitle',
  'controls.undoLabel.set_reference_plan',
  'controls.undoLabel.amend_reference_plan',
  'controls.undoLabel.set_reference_label',
  'controls.undoLabel.set_reference_prompt',
  'controls.undoLabel.select_reference_image',
  'controls.undoLabel.set_shot_reference_binding',
  ...localizedMediaUndoLabelKeys,
  'gate.headline_one',
  'gate.headline_other',
  'gate.confirm_one',
  'gate.confirm_other',
  'gate.referenceGridRetry',
  'gate.hideBreakdown',
  'gate.showBreakdown',
  'gate.conditioningFrameAlt',
  'gate.routeShared',
  'gate.errors.routesUnavailable',
  'gate.group.required',
  'gate.continuity.severTitle',
  'gate.continuity.rejoinTitle',
  'gate.continuity.severSummary',
  'gate.continuity.rejoinSummary',
  'gate.continuity.severHeadline',
  'gate.continuity.severHeadline_one',
  'gate.continuity.severHeadline_other',
  'gate.continuity.rejoinHeadline',
  'gate.continuity.rejoinHeadline_one',
  'gate.continuity.rejoinHeadline_other',
  'gate.continuity.requiredWork',
  'gate.continuity.confirmSever',
  'gate.continuity.confirmSever_one',
  'gate.continuity.confirmSever_other',
  'gate.continuity.confirmRejoin',
  'gate.continuity.confirmRejoin_one',
  'gate.continuity.confirmRejoin_other',
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
  'gate.purpose.reference_image',
  'gate.reviewShotBinding',
  'gate.readout.prompt',
  'gate.readout.rendersAs',
  'gate.readout.sourceRevision',
  'gate.readout.source',
  'gate.readout.story',
  'gate.readout.shootingScript',
  'gate.readout.referencePrompt',
  'gate.readout.references',
  'gate.readout.noReferences',
  'gate.readout.referenceFact',
  'references.referenceCount',
  'handoffs.referenceCount',
  'handoffs.progress',
  'handoffs.reviewReferences',
  'handoffs.retryFailed',
  'handoffs.awaiting_spend',
  'handoffs.running',
  'handoffs.succeeded',
  'handoffs.partially_failed',
  'handoffs.failed',
  'handoffs.dismissed',
] as const;

describe('Creative Studio workspace translations', () => {
  const englishConversation = loadConversation(referenceLocale);
  const englishWorkspace = workspaceOf(englishConversation)!;

  it('keeps the exact renderer workspace inventory under one en-US subtree', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(Object.keys(leaves).toSorted()).toEqual(expectedLeaves.toSorted());
    expect(leaves['table.columns.position']).toBe('#');
    expect(leaves['table.columns.length']).toBe('Sum');
    expect(leaves['board.shot.duration']).toBe('{{seconds, number(maximumFractionDigits: 1; useGrouping: false)}}s');
    expect(placeholders(leaves['bin.coverAlt']!)).toEqual(['kind', 'title']);
    for (const [key, value] of Object.entries(leaves)) {
      expect(value.trim(), key).not.toBe('');
    }
  });

  it('keeps the shared Shot status words and qualifier byte-identical in their neutral namespace', () => {
    const expected = {
      'shotStatus.notReady': 'Not ready',
      'shotStatus.ready': 'Ready to render',
      'shotStatus.queued': 'Queued',
      'shotStatus.rendering': 'Rendering',
      'shotStatus.rendered': 'Rendered',
      'shotStatus.failed': 'Failed',
      'shotStatus.latestAttemptFailed': 'Latest attempt failed',
    } as const;

    for (const locale of i18nConfig.supportedLanguages) {
      const leaves = flattenLeaves(workspaceOf(loadConversation(locale))!);
      expect(Object.fromEntries(localizedShotStatusKeys.map((key) => [key, leaves[key]])), locale).toEqual(expected);
      expect(
        Object.keys(leaves).some((key) => key.startsWith('beatPanel.composer.status.')),
        locale
      ).toBe(false);
    }
  });

  it('labels re-proposal as preparing an editable draft and exposes the proposal ID', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'proposals.proposalId': 'Proposal ID',
      'proposals.requestUpdated': 'Prepare updated proposal',
      'proposals.saveAndRequestUpdated': 'Save and prepare updated proposal',
      'proposals.authorityUnavailable':
        'Proposal authority could not be verified. The proposal remains pending and its actions are unavailable.',
    });
  });

  it('localizes the collapsed terminal-proposal disclosure in all twelve locales', () => {
    expect(flattenLeaves(englishWorkspace)).toMatchObject({
      'proposals.terminalCount': '{{count}} Director proposals cannot be accepted',
      'proposals.terminalCount_one': '{{count}} Director proposal cannot be accepted',
      'proposals.terminalCount_other': '{{count}} Director proposals cannot be accepted',
      'proposals.showTerminal': 'Review past proposals',
      'proposals.hideTerminal': 'Hide past proposals',
    });

    for (const locale of i18nConfig.supportedLanguages) {
      const leaves = flattenLeaves(workspaceOf(loadConversation(locale))!);
      for (const key of ['proposals.terminalCount', 'proposals.terminalCount_one', 'proposals.terminalCount_other']) {
        expect(placeholders(leaves[key]!)).toEqual(['count']);
      }
      expect(leaves['proposals.showTerminal']?.trim(), locale).not.toBe('');
      expect(leaves['proposals.hideTerminal']?.trim(), locale).not.toBe('');
    }
  });

  it('defines one exact undo label for every mutation operation that can be persisted', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2).not.toContain('undo_last');
    expect(new Set(STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2).size).toBe(
      STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2.length
    );
    for (const operation of STUDIO_PERSISTED_UNDO_OPERATION_KINDS_V2) {
      const key = `controls.undoLabel.${operation}` as const;
      expect(leaves[key]?.trim(), operation).not.toBe('');
    }
  });

  it('localizes every media-selection undo label in all twelve configured locales', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const leaves = flattenLeaves(workspaceOf(loadConversation(locale))!);
      for (const key of localizedMediaUndoLabelKeys) expect(leaves[key]?.trim(), `${locale}:${key}`).not.toBe('');
    }
  });

  it('keeps the exact Director Board Table copy and spend purpose in en-US', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'table.authoring.label': 'Story authoring and recovery',
      'table.authoring.coverageGap': '{{count}} of {{total}} Beats have no Shots',
      'table.authoring.coverageGap_one': '{{count}} of {{total}} Beats has no Shots',
      'table.authoring.coverageGap_other': '{{count}} of {{total}} Beats have no Shots',
      'table.authoring.unscriptedWarning': '{{count}} Shots have no shooting script',
      'table.authoring.unscriptedWarning_one': '{{count}} Shot has no shooting script',
      'table.authoring.unscriptedWarning_other': '{{count}} Shots have no shooting script',
      'table.authoring.askDirector': 'Ask Director',
      'table.authoring.addBeat': 'Add Beat',
      'table.authoring.addShot': 'Add Shot',
      'table.authoring.addShotForBeat': 'Add Shot to {{title}}',
      'table.authoring.unassignedReferenceNote':
        'A hand-authored Shot starts with references unassigned and requires review before paid generation.',
      'table.reorder.label': 'Actions for {{title}}',
      'table.reorder.dragHandle': 'Reorder {{title}} at position {{position}}',
      'table.reorder.moveEarlier': 'Move {{title}} earlier',
      'table.reorder.moveLater': 'Move {{title}} later',
      'table.reorder.announcement': 'Moved {{title}} from position {{from}} to {{to}} of {{total}}.',
      'table.reorder.failed': 'Beat order was not changed.',
      'table.columns.panel': 'Panel',
      'board.controls.label': 'Director Board controls',
      'board.controls.progress': '{{drawn}} of {{total}} panels drawn',
      'board.controls.progressLabel': 'Board completeness',
      'board.controls.staleCount': '{{count}} stale',
      'board.controls.busyCount': '{{count}} in progress',
      'board.controls.stop': 'Stop drawing',
      'board.controls.stopNote':
        'Stop requests cancellation where possible. Completed panels and charges already incurred remain.',
      'board.controls.drawNext': 'Draw next batch ({{count}})',
      'board.panel.beatActions': 'Actions for {{title}}',
      'board.panel.drawMissing': 'Draw missing ({{count}})',
      'board.panel.redrawBeat': 'Redraw Beat · paid',
      'board.panel.cardLabel': 'Shot {{position}}: {{status}}',
      'board.panel.redrawShot': 'Redraw Shot {{position}} · paid',
      'table.panel.openDetails': 'Open Board panels for {{title}}',
      'table.panel.closeDetails': 'Close Board panels for {{title}}',
      'table.panel.cardLabel': 'Shot {{position}}: {{status}}',
      'table.panel.shotDetails': 'Shot {{position}} details',
      'table.panel.head': 'Chain head',
      'table.panel.status.missing': 'Not drawn',
      'table.panel.status.current': 'Current',
      'table.panel.status.stale': 'Stale',
      'table.panel.status.statusPending': 'Status pending',
      'table.panel.status.queued': 'Queued',
      'table.panel.status.drawing': 'Drawing',
      'table.panel.status.needsAttention': 'Needs attention',
      'table.panel.status.failed': 'Failed',
      'table.panel.status.cancelled': 'Cancelled',
      'gate.purpose.board_still': 'Board panel',
    });
  });

  it('keeps the exact Board-panel promotion copy in en-US', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'controls.undoLabel.promote_board_panel': 'Use panel as first frame',
      'board.panel.useAsFirstFrame': 'Use Shot {{position}} panel as first frame',
      'gate.promotion.title': 'Use panel as first frame',
      'gate.promotion.summary':
        'Promote the current Board panel for Shot {{shotId}}. This does not change the Shot’s continuity boundary.',
      'gate.promotion.impactNone': 'No current pictures depend on this frame.',
      'gate.promotion.impactIntro': '{{count}} current picture(s) will remain playable but become stale:',
      'gate.promotion.impactItem': 'Shot {{shotId}} current picture',
      'gate.promotion.optionsLabel': 'Choose how to handle current pictures',
      'gate.promotion.promoteOnly': 'Promote only — keep playable, stale pictures',
      'gate.promotion.freePrice': '$0',
      'gate.promotion.promoteAndRerender': 'Promote and review exact rerender work',
      'gate.promotion.priceAfterReview': 'Price shown next',
      'gate.promotion.promoteOnlyAction': 'Promote for $0',
      'gate.promotion.reviewPaidAction': 'Review rerender price',
      'gate.promotion.paidUnavailable':
        'This segment has too many current pictures for one paid confirmation. Promote-only remains available.',
      'gate.promotion.headline': 'Promote + {{count}} rerender(s) · {{cost}}',
      'gate.promotion.requiredWork':
        'The listed rerenders are exactly the current pictures this promotion makes stale. Missing coverage is not included.',
      'gate.promotion.confirm': 'Confirm promotion + {{count}} rerender(s) · {{cost}}',
      'gate.promotion.promoted': 'Panel promoted. Existing pictures remain playable and are marked stale.',
      'gate.promotion.promoting': 'Promoting panel…',
      'gate.promotion.confirmed': 'Panel promoted and rerendering started for the confirmed pictures.',
      'gate.promotion.close': 'Close',
    });
  });

  it('keeps exact Shot-binding and quote-readout copy in en-US', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'controls.undoLabel.set_shot_reference_binding': 'Shot reference binding',
      'referenceWorkflow.bindings.title': 'Shot bindings',
      'referenceWorkflow.bindings.description':
        'Choose the exact current characters and background each Shot uses for its Board panel and first frame.',
      'referenceWorkflow.bindings.unassigned': 'This Shot has no reference decision yet.',
      'referenceWorkflow.bindings.invalid':
        'This saved binding is no longer valid. Choose current references and save it again.',
      'referenceWorkflow.bindings.capacity':
        '{{count}} references are selected across characters and background, but their shared image-route budget supports {{limit}}.',
      'referenceWorkflow.bindings.capacityUsage':
        '{{count}} / {{limit}} shared image-reference slots used (characters + background)',
      'gate.reviewShotBinding': 'Review Shot binding',
      'gate.readout.prompt': 'Exact prompt',
      'gate.readout.rendersAs': 'Renders as',
      'gate.readout.sourceRevision': 'Source revision',
      'gate.readout.story': 'Story',
      'gate.readout.shootingScript': 'Shooting script',
      'gate.readout.references': 'Resolved references',
      'gate.readout.referenceFact': '{{kind}} · {{referenceId}} → {{assetId}}',
    });
    expect(placeholders(leaves['referenceWorkflow.bindings.capacity']!)).toEqual(['count', 'limit']);
    expect(placeholders(leaves['referenceWorkflow.bindings.capacityUsage']!)).toEqual(['count', 'limit']);
    expect(placeholders(leaves['gate.readout.referenceFact']!)).toEqual(['assetId', 'kind', 'referenceId']);
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
      'beatPanel.preview.videoLabel': 'Shot {{position}} video · {{shootingScript}}',
      'beatPanel.preview.slateLabel': 'Shot {{position}} planning slate · {{shootingScript}}',
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
      'beatPanel.coverage.segmentState.renderingStill': 'Rendering · Showing the first frame',
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
        'Hard cut confirmed. Review the Shot for first-frame progress, replacement progress, or any required recovery.',
      'gate.continuity.rejoinConfirmed':
        'Rejoin confirmed. Review the Shot for frame extraction and replacement progress or any required recovery.',
    });
    expect(placeholders(leaves['gate.continuity.confirmSever']!)).toEqual(['cost', 'count']);
    expect(placeholders(leaves['gate.continuity.confirmRejoin']!)).toEqual(['cost', 'count']);
  });

  it('names both unavailable estimate routes and directs recovery to Film setup', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves['gate.errors.routesUnavailable']).toBe(
      'Choose ready image and video routes in Film setup before preparing this estimate.'
    );
  });

  it('keeps Shot continuity provenance as complete sentence-case en-US phrases', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'beatPanel.chain.segmentHead': 'Head of the chain · Starts from the first frame',
      'beatPanel.chain.continuous': 'Continues from Shot {{position}}’s last frame',
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
      'cut.exports.editorFolderDescription':
        'Current Shot pictures, target slates, timeline data and the optional bed in film order.',
    });
    for (const key of localizedOnePicturePresentationKeys) expect(placeholders(leaves[key]!)).toEqual([]);
  });

  it('keeps one/other variants paired with identical interpolation parameters', () => {
    const leaves = flattenLeaves(englishWorkspace);
    const pluralBases = Object.keys(leaves)
      .filter((key) => key.endsWith('_one'))
      .map((key) => key.slice(0, -'_one'.length));

    expect(pluralBases).toHaveLength(27);
    for (const base of pluralBases) {
      expect(leaves[`${base}_other`], `${base}_other`).toBeTypeOf('string');
      expect(placeholders(leaves[`${base}_one`]!)).toEqual(placeholders(leaves[`${base}_other`]!));
    }
  });

  it('states an exact one-generation gate amount without an upper-bound qualifier', async () => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: referenceLocale,
      fallbackLng: false,
      resources: { [referenceLocale]: { translation: { conversation: englishConversation } } },
      interpolation: { escapeValue: false },
    });

    expect(i18n.t('conversation.creativeStudio.workspace.gate.headline', { count: 1, cost: '$1.25' })).toBe(
      '1 generation · $1.25'
    );
    expect(i18n.t('conversation.creativeStudio.workspace.gate.confirm', { count: 1, cost: '$1.25' })).toBe(
      'Confirm 1 generation · $1.25'
    );
    expect(i18n.t('conversation.creativeStudio.workspace.gate.confirm', { count: 2, cost: '$2.50' })).toBe(
      'Confirm 2 generations · $2.50'
    );
  });

  it.each([
    [
      'severHeadline',
      'confirmSever',
      'Hard cut · 1 required generation · $4.00',
      'Confirm hard cut + 1 generation · $4.00',
    ],
    [
      'rejoinHeadline',
      'confirmRejoin',
      'Rejoin · 1 required generation · $4.00',
      'Confirm rejoin + 1 generation · $4.00',
    ],
  ])('uses singular continuity copy for %s', async (headlineKey, confirmKey, headline, action) => {
    const i18n = i18next.createInstance();
    await i18n.init({
      lng: referenceLocale,
      fallbackLng: false,
      resources: { [referenceLocale]: { translation: { conversation: englishConversation } } },
      interpolation: { escapeValue: false },
    });

    expect(
      i18n.t(`conversation.creativeStudio.workspace.gate.continuity.${headlineKey}`, {
        count: 1,
        cost: '$4.00',
      })
    ).toBe(headline);
    expect(
      i18n.t(`conversation.creativeStudio.workspace.gate.continuity.${confirmKey}`, {
        count: 1,
        cost: '$4.00',
      })
    ).toBe(action);
  });

  it.each([
    ['table.actualDuration', 15.069002, '15s'],
    ['board.actualDuration', 15.069002, '15s actual'],
    ['board.shot.duration', 15.069002, '15.1s'],
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
      const storyName = localizedLeaves['beatPanel.fields.story'];
      const storyGuidance = localizedLeaves['beatPanel.fieldGuidance.story'];
      expect(storyGuidance?.startsWith(`${storyName} · `), `${locale}:story`).toBe(true);
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
        ...localizedFirstFramesPanelKeys,
        ...localizedShotStatusKeys,
        ...localizedShotComposerKeys,
        ...localizedReferencesPanelKeys,
        'gate.referenceGridRetry',
        ...localizedAuthorizedSeedRecoveryKeys,
        'library.pictureCount',
        'library.pictureCount_one',
        'library.pictureCount_other',
        ...localizedOnePicturePresentationKeys,
        ...localizedProjectStatusKeys,
        ...localizedMoveToBinKeys,
        ...localizedBoardKeys,
        ...localizedBoardPromotionKeys,
        ...localizedPaidRecoveryKeys,
        'table.columns.length',
        'table.columns.story',
        'table.plannedPending',
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
      'This audio is currently selected or in use. Clear it as the bed or wait for the active operation before detaching it.'
    );
  });

  it('localizes the authoring-mutation refusal in every configured locale', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversation(locale);
      const creativeStudio = asObject(conversation.creativeStudio, `${locale}.creativeStudio`);
      const errors = asObject(creativeStudio.errors, `${locale}.creativeStudio.errors`);

      expect(errors.mutationRefused, locale).toBeTypeOf('string');
      expect((errors.mutationRefused as string).trim(), locale).not.toBe('');
    }

    const creativeStudio = asObject(englishConversation.creativeStudio, 'creativeStudio');
    const errors = asObject(creativeStudio.errors, 'creativeStudio.errors');
    expect(errors.mutationRefused).toBe(
      'This change cannot be applied to the project in its current state. Review the project and try again.'
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
      expect(errors.referenceVariationGridRepeated, locale).toBeTypeOf('string');
      expect((errors.referenceVariationGridRepeated as string).trim(), locale).not.toBe('');
    }

    const creativeStudio = asObject(englishConversation.creativeStudio, 'creativeStudio');
    const jobs = asObject(creativeStudio.jobs, 'creativeStudio.jobs');
    const errors = asObject(jobs.errors, 'creativeStudio.jobs.errors');
    expect(errors.seedStillVariationGrid).toBe(
      'The generated image contains a multi-panel variation grid and cannot be used as a current first frame or reference.'
    );
    expect(errors.referenceVariationGridRepeated).toBe(
      'The model returned another multi-panel variation grid. Import photo is the reliable way to set this reference.'
    );
  });

  it('localizes proposal summaries and the seed-image content remedy in every configured locale', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversation(locale);
      const creativeStudio = asObject(conversation.creativeStudio, `${locale}.creativeStudio`);
      const jobs = asObject(creativeStudio.jobs, `${locale}.creativeStudio.jobs`);
      const errors = asObject(jobs.errors, `${locale}.creativeStudio.jobs.errors`);
      const workspace = workspaceOf(conversation)!;
      const proposals = asObject(workspace.proposals, `${locale}.creativeStudio.workspace.proposals`);

      expect(errors.contentRejected, `${locale}.jobs.errors.contentRejected`).toBeTypeOf('string');
      expect((errors.contentRejected as string).trim(), `${locale}.jobs.errors.contentRejected`).not.toBe('');
      expect(proposals.reviewDetails, `${locale}.proposals.reviewDetails`).toBeTypeOf('string');
      expect(proposals.mutationCount, `${locale}.proposals.mutationCount`).toContain('{{count}}');
    }
  });

  it('localizes inactive-runtime recovery and identifies the quarantined project in every locale', () => {
    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversation(locale);
      const creativeStudio = asObject(conversation.creativeStudio, `${locale}.creativeStudio`);
      const errors = asObject(creativeStudio.errors, `${locale}.creativeStudio.errors`);

      expect(errors.runtimeInactive, `${locale}.errors.runtimeInactive`).toBeTypeOf('string');
      expect((errors.runtimeInactive as string).trim(), `${locale}.errors.runtimeInactive`).not.toBe('');
      expect(errors.projectQuarantined, `${locale}.errors.projectQuarantined`).toContain('{{projectId}}');
    }
  });

  it('uses first-frame copy without renaming durable seed identifiers', () => {
    const leaves = flattenLeaves(englishWorkspace);

    expect(leaves).toMatchObject({
      'table.state.seedPending': 'First frame pending',
      'beatPanel.chain.hardCutState': 'Hard cut · Starts from the first frame',
      'beatPanel.chain.reviewSeverDescription':
        'A hard cut makes Shot {{shot}} start from an eligible first frame, creating one if needed. Confirming replaces this Shot and each continuous downstream Shot through the next hard cut.',
      'beatPanel.chain.reviewRejoinDescription':
        'Rejoining Shot {{shot}} clears its first-frame selection and uses Shot {{previous}}’s trim-aware last frame. After confirmation, free frame extraction may finish before this Shot and its continuous downstream Shots are dispatched through the next hard cut.',
      'beatPanel.chain.segmentHead': 'Head of the chain · Starts from the first frame',
      'beatPanel.coverage.segmentState.renderingStill': 'Rendering · Showing the first frame',
      'beatPanel.seeds.label': 'First frames for Shot {{index}}',
      'beatPanel.seeds.title': 'First frames',
      'beatPanel.seeds.pending': 'A first frame is required before video generation.',
      'beatPanel.seeds.latestDefault': 'The latest eligible image is the current first frame.',
      'beatPanel.seeds.pinned': 'A first frame is pinned.',
      'beatPanel.seeds.import': 'Import first frame',
      'beatPanel.seeds.pin': 'Pin as first frame',
      'beatPanel.seeds.clearPin': 'Clear first-frame pin',
      'beatPanel.seeds.empty': 'No first frames yet.',
      'beatPanel.seeds.stillLabel': 'First frame {{stillIndex}} for Shot {{shotIndex}}',
      'beatPanel.seeds.effective': 'Current first frame',
      'beatPanel.seeds.authorizationLocked':
        'Authorized video work has locked this Shot’s first frame. Imported candidates remain stored, but cannot replace the seed in the reviewed quote.',
      'beatPanel.seeds.authorizationIncompatible': 'Not available to authorized work',
      'beatPanel.generation.generateSeed': 'Review first-frame generation',
      'beatPanel.generation.purpose.seedStill': 'first frame',
      'beatPanel.recovery.reason.choose_seed': 'Choose an eligible first frame to continue the existing authorization.',
      'beatPanel.recovery.cancelAndReviewRejoin': 'Cancel and review rejoin',
      'beatPanel.recovery.cancelAndReviewRejoinTitle': 'Cancel authorized work and review rejoin?',
      'beatPanel.recovery.cancelAndReviewRejoinBody':
        'This cancels only the unsubmitted waiting video work. Completed media and authorization history remain. A fresh rejoin estimate must be reviewed before replacement generation.',
      'beatPanel.recovery.cancelAndReviewRejoinConfirm': 'Cancel and review rejoin',
      'beatPanel.recovery.cancelAndReviewRejoinUnconfirmed':
        'The waiting work was cancelled, but the refreshed workspace could not be confirmed. Refresh before reviewing rejoin.',
      'beatPanel.recovery.cancelAndReviewRejoinOutcomeUnknown':
        'The cancellation result could not be confirmed. Refresh the workspace before reviewing rejoin.',
      'controls.imageRouteBlocked':
        'Choose a ready image route before reviewing first-frame generation. Video-only work remains available.',
      'controls.videoRouteBlocked':
        'Choose a ready video route before reviewing video generation. First-frame-only work remains available.',
      'controls.shotState.seed_ready': 'First frame ready',
      'controls.undoLabel.set_seed_still': 'choose first frame',
      'controls.cascadeReason.choose_seed':
        'Choose the authorized first frame to continue without another cost confirmation.',
      'gate.continuity.severSummary':
        'This estimate makes this Shot a chain head, reuses an eligible first frame or creates one if needed, and replaces every affected video through the next hard cut.',
      'gate.continuity.rejoinSummary':
        'This estimate clears this Shot’s first-frame selection and rejoins it to the trim-aware predecessor frame. Free frame extraction may finish after confirmation, before replacement videos are dispatched through the next hard cut.',
      'gate.continuity.severConfirmed':
        'Hard cut confirmed. Review the Shot for first-frame progress, replacement progress, or any required recovery.',
      'gate.purpose.seed_still': 'First frame',
      'gate.errors.pricing.missingConditioning':
        'A video has no eligible first frame or predecessor frame. Add the required image, then prepare again.',
    });
  });

  it('authors the same first-frame concept in all twelve configured locales', () => {
    const englishCreativeStudio = asObject(englishConversation.creativeStudio, 'en-US.creativeStudio');
    const englishJobs = asObject(englishCreativeStudio.jobs, 'en-US.creativeStudio.jobs');
    const englishErrors = asObject(englishJobs.errors, 'en-US.creativeStudio.jobs.errors');
    const englishLeaves = flattenLeaves(englishWorkspace);

    for (const locale of i18nConfig.supportedLanguages) {
      const conversation = loadConversation(locale);
      const creativeStudio = asObject(conversation.creativeStudio, `${locale}.creativeStudio`);
      const jobs = asObject(creativeStudio.jobs, `${locale}.creativeStudio.jobs`);
      const errors = asObject(jobs.errors, `${locale}.creativeStudio.jobs.errors`);
      const leaves = flattenLeaves(workspaceOf(conversation)!);
      const term = localizedFirstFrameTerms[locale];
      expect(term, locale).toBeInstanceOf(RegExp);

      expect(errors.seedStillVariationGrid, `${locale}.jobs.errors.seedStillVariationGrid`).toMatch(term!);
      expect(
        placeholders(errors.seedStillVariationGrid as string),
        `${locale}.jobs.errors.seedStillVariationGrid placeholders`
      ).toEqual(placeholders(englishErrors.seedStillVariationGrid as string));
      for (const key of localizedFirstFrameWorkspaceKeys) {
        expect(leaves[key], `${locale}.${key}`).toMatch(term!);
        expect(placeholders(leaves[key]!), `${locale}.${key} placeholders`).toEqual(placeholders(englishLeaves[key]!));
      }
    }
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
