/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { ipcBridge } from '@/common';
import { CREATIVE_STUDIO_ENABLED } from '@/common/config/constants';
import {
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_VIEWS,
  type StudioCommandErrorCode,
  type StudioCommandResult,
  type StudioMutationBatchResultV2,
  type StudioMutationReducerContextV2,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioServiceError } from '@process/services/creative-studio/service/projectMutations';
import { StudioPreparedSubmissionCacheErrorV2 } from '@process/services/creative-studio/service/schema2/preparedSubmissionCache';
import type { CreativeStudioServiceV2 } from '@process/services/creative-studio/service/v2Service';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import { getCreativeStudioService } from '@process/services/creative-studio/runtime';
import { BrowserWindow, dialog } from 'electron';

const errorMessageKeys: Record<StudioCommandErrorCode, string> = {
  feature_disabled: 'conversation.creativeStudio.errors.featureDisabled',
  invalid_payload: 'conversation.creativeStudio.errors.invalidPayload',
  not_found: 'conversation.creativeStudio.errors.projectNotFound',
  stale_project: 'conversation.creativeStudio.errors.staleProject',
  invalid_route: 'conversation.creativeStudio.errors.invalidRoute',
  rule_breach: 'conversation.creativeStudio.errors.ruleBreach',
  cancellation_refused: 'conversation.creativeStudio.errors.cancellationRefused',
  duplicate_charge_acknowledgement_required:
    'conversation.creativeStudio.errors.duplicateChargeAcknowledgementRequired',
  unsupported: 'conversation.creativeStudio.jobs.errors.unsupported',
  busy: 'conversation.creativeStudio.errors.busy',
  cancelled: 'conversation.creativeStudio.jobs.status.cancelled',
  provider_error: 'conversation.creativeStudio.errors.provider',
  quote_not_found: 'conversation.creativeStudio.errors.quoteNotFound',
  quote_in_use: 'conversation.creativeStudio.errors.quoteInUse',
  quote_cache_full: 'conversation.creativeStudio.errors.quoteCacheFull',
  quote_too_large: 'conversation.creativeStudio.errors.quoteTooLarge',
  media_in_use: 'conversation.creativeStudio.errors.mediaInUse',
  storage_error: 'conversation.creativeStudio.errors.storage',
};

const storeErrorCode = (error: CreativeStudioStoreError): StudioCommandErrorCode =>
  error.code === 'unsupported_prototype_schema' ? 'storage_error' : error.code;

const toCommandError = (error: unknown): StudioCommandResult<never> => {
  const code: StudioCommandErrorCode =
    error instanceof CreativeStudioStoreError
      ? storeErrorCode(error)
      : error instanceof CreativeStudioServiceError
        ? error.code
        : error instanceof StudioPreparedSubmissionCacheErrorV2
          ? error.code
          : error instanceof CreativeStudioMediaError
            ? error.code === 'not_found'
              ? 'not_found'
              : error.code === 'stale_project'
                ? 'stale_project'
                : error.code === 'invalid_media'
                  ? 'invalid_payload'
                  : error.code === 'media_in_use'
                    ? 'media_in_use'
                    : 'storage_error'
            : 'storage_error';
  return { ok: false, error: { code, messageKey: errorMessageKeys[code] } };
};

const command = async <T>(
  isFeatureEnabled: () => boolean,
  operation: () => Promise<T>
): Promise<StudioCommandResult<T>> => {
  if (!isFeatureEnabled()) {
    return {
      ok: false,
      error: { code: 'feature_disabled', messageKey: errorMessageKeys.feature_disabled },
    };
  }
  try {
    return { ok: true, data: await operation() };
  } catch (error) {
    return toCommandError(error);
  }
};

export type CreativeStudioBridgeDependencies = {
  isFeatureEnabled?: () => boolean;
  getService: () => CreativeStudioServiceV2;
  getParentWindow?: () => BrowserWindow | undefined;
  showOpenDialog?: (window: BrowserWindow | undefined) => Promise<{ canceled: boolean; filePaths: string[] }>;
  createMutationId?: () => string;
  now?: () => Date;
};

type CreativeStudioCloseEvent = {
  preventDefault: () => void;
};

type CreativeStudioCloseQueryOptions = {
  timeoutMs: number;
};

type CreativeStudioCloseDialogOptions = {
  type: 'warning';
  buttons: string[];
  defaultId: number;
  cancelId: number;
  message: string;
};

export type CreativeStudioCloseHandshakeDependencies = {
  getCurrentUrl: () => string;
  queryUnsavedWork: (options: CreativeStudioCloseQueryOptions) => Promise<{ dirtyDraftCount: number }>;
  flushUnsavedWork: (options: CreativeStudioCloseQueryOptions) => Promise<{ saved: boolean }>;
  showMessageBox: (options: CreativeStudioCloseDialogOptions) => Promise<{ response: number }>;
  translate: (key: string, options?: { count?: number }) => string;
  closeWindow: () => void;
  hideWindow: () => void;
  quitApp: () => void;
  onQuitCancelled: () => void;
};

export type CreativeStudioCloseHandshake = {
  handleWindowClose: (event: CreativeStudioCloseEvent) => boolean;
  handleBeforeQuit: (event: CreativeStudioCloseEvent) => boolean;
};

const CLOSE_QUERY_TIMEOUT_MS = 3_000;
/**
 * Built from the shared `STUDIO_VIEWS`, never from a hand-written alternation.
 *
 * This pattern gates the unsaved-work preflight: a Studio document parked on a segment it
 * does not match closes with no prompt and loses the drafts. Deriving it means a new view is
 * covered the moment it joins the shared list, which is the whole reason the vocabulary is shared
 * rather than copied here.
 *
 * The retired `brief|write|produce|review` segments are absent by construction and must stay absent;
 * the renderer redirects an unknown segment to a real view before it can become an editable document.
 *
 * The values are plain lowercase words with no regex metacharacters, so they are interpolated as
 * written rather than escaped; `creativeStudioBridge.test.ts` asserts that shape, so a view named
 * with anything else fails there instead of silently widening this pattern.
 */
const STUDIO_ROUTE_PATTERN = new RegExp(`^/studio/[^/?#]+(?:/(?:${STUDIO_VIEWS.join('|')}))?/?$`);

const isCreativeStudioRendererUrl = (rawUrl: string): boolean => {
  try {
    const hash = new URL(rawUrl).hash;
    const routePath = hash.startsWith('#') ? hash.slice(1).split('?')[0] : '';
    return STUDIO_ROUTE_PATTERN.test(routePath);
  } catch {
    return false;
  }
};

/**
 * Coordinates the renderer draft preflight for real window close and explicit quit.
 * The caller must run its close-to-tray branch before invoking this handshake.
 */
export function createCreativeStudioCloseHandshake(
  dependencies: CreativeStudioCloseHandshakeDependencies
): CreativeStudioCloseHandshake {
  let shutdownConfirmed = false;
  let pendingIntent: 'close' | 'quit' | null = null;
  let preflight: Promise<void> | null = null;

  const cancel = (): void => {
    if (pendingIntent === 'quit') {
      dependencies.onQuitCancelled();
    }
  };

  const approve = (): void => {
    const intent = pendingIntent;
    shutdownConfirmed = true;
    if (intent === 'quit') {
      dependencies.hideWindow();
      dependencies.quitApp();
      return;
    }
    dependencies.closeWindow();
  };

  const askToDiscardUnavailableWork = async (): Promise<boolean> => {
    const choice = await dependencies.showMessageBox({
      type: 'warning',
      buttons: [
        dependencies.translate('conversation.creativeStudio.close.discard'),
        dependencies.translate('conversation.creativeStudio.close.cancel'),
      ],
      defaultId: 1,
      cancelId: 1,
      message: dependencies.translate('conversation.creativeStudio.close.unavailableMessage'),
    });
    return choice.response === 0;
  };

  const runPreflight = async (): Promise<void> => {
    let dirtyDraftCount: number;
    try {
      ({ dirtyDraftCount } = await dependencies.queryUnsavedWork({ timeoutMs: CLOSE_QUERY_TIMEOUT_MS }));
    } catch {
      if (await askToDiscardUnavailableWork()) approve();
      else cancel();
      return;
    }

    if (dirtyDraftCount === 0) {
      approve();
      return;
    }

    const choice = await dependencies.showMessageBox({
      type: 'warning',
      buttons: [
        dependencies.translate('conversation.creativeStudio.close.saveAndClose'),
        dependencies.translate('conversation.creativeStudio.close.discard'),
        dependencies.translate('conversation.creativeStudio.close.cancel'),
      ],
      defaultId: 0,
      cancelId: 2,
      message: dependencies.translate('conversation.creativeStudio.close.unsavedMessage', { count: dirtyDraftCount }),
    });

    if (choice.response === 1) {
      approve();
      return;
    }
    if (choice.response !== 0) {
      cancel();
      return;
    }

    try {
      const result = await dependencies.flushUnsavedWork({ timeoutMs: CLOSE_QUERY_TIMEOUT_MS });
      if (result.saved) {
        approve();
        return;
      }
    } catch {
      // The fallback below is shared by a rejected, timed-out, or incomplete flush.
    }

    if (await askToDiscardUnavailableWork()) approve();
    else cancel();
  };

  const intercept = (intent: 'close' | 'quit', event: CreativeStudioCloseEvent): boolean => {
    if (shutdownConfirmed || !isCreativeStudioRendererUrl(dependencies.getCurrentUrl())) {
      return false;
    }

    event.preventDefault();
    if (intent === 'quit') {
      pendingIntent = 'quit';
    } else if (pendingIntent === null) {
      pendingIntent = 'close';
    }

    if (preflight === null) {
      preflight = runPreflight()
        .catch(() => cancel())
        .finally(() => {
          pendingIntent = null;
          preflight = null;
        });
    }
    return true;
  };

  return {
    handleWindowClose: (event) => intercept('close', event),
    handleBeforeQuit: (event) => intercept('quit', event),
  };
}

const defaultDependencies: CreativeStudioBridgeDependencies = {
  getService: getCreativeStudioService,
  getParentWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
  showOpenDialog: (window) =>
    dialog.showOpenDialog(window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp'] }],
    }),
};

const toCommitResult = (
  result: StudioMutationBatchResultV2 | StudioRendererWorkspaceStatusV2
): StudioRendererProjectCommitResultV2 =>
  'project' in result
    ? {
        projectId: result.project.id,
        projectRevision: result.project.revision,
        createdBeatIds: [...result.createdBeatIds],
        createdShotIds: [...result.createdShotIds],
      }
    : {
        projectId: result.projectId,
        projectRevision: result.projectRevision,
        createdBeatIds: [],
        createdShotIds: [],
      };

const mutationContext = (dependencies: CreativeStudioBridgeDependencies): StudioMutationReducerContextV2 => ({
  mutationId: (dependencies.createMutationId ?? (() => `native_${randomUUID().replaceAll('-', '')}`))(),
  capturedAt: (dependencies.now ?? (() => new Date()))().toISOString(),
});

/** Registers the typed Creative Studio IPC providers without eagerly creating storage. */
export function initCreativeStudioBridge(dependencies: CreativeStudioBridgeDependencies = defaultDependencies): void {
  const isFeatureEnabled = dependencies.isFeatureEnabled ?? (() => CREATIVE_STUDIO_ENABLED);
  const runCommand = <T>(operation: () => Promise<T>): Promise<StudioCommandResult<T>> =>
    command(isFeatureEnabled, operation);
  const applyOperations = (
    input: { projectId: string; expectedRevision: number },
    operations: Parameters<CreativeStudioServiceV2['applyMutations']>[0]['operations']
  ): Promise<StudioRendererProjectCommitResultV2> =>
    dependencies
      .getService()
      .applyMutations(
        {
          schemaVersion: STUDIO_PROJECT_SCHEMA_VERSION,
          projectId: input.projectId,
          expectedRevision: input.expectedRevision,
          operations,
        },
        mutationContext(dependencies)
      )
      .then(toCommitResult);

  ipcBridge.creativeStudio.listProjects.provider(() => runCommand(() => dependencies.getService().listProjects()));
  ipcBridge.creativeStudio.createProject.provider((input) =>
    runCommand(() => dependencies.getService().createProject(input))
  );
  ipcBridge.creativeStudio.getProject.provider((input) =>
    runCommand(() => dependencies.getService().getProject(input.projectId))
  );
  ipcBridge.creativeStudio.getBriefSessionServer.provider((input) =>
    runCommand(() => dependencies.getService().getBriefSessionServer(input))
  );
  ipcBridge.creativeStudio.getDirectorSessionAuthority.provider((input) =>
    runCommand(() => dependencies.getService().getDirectorSessionAuthority(input))
  );
  ipcBridge.creativeStudio.bindDirectorConversation.provider((input) =>
    runCommand(() => dependencies.getService().bindDirectorConversation(input))
  );
  ipcBridge.creativeStudio.listProposals.provider((input) =>
    runCommand(() => dependencies.getService().listProposals(input))
  );
  ipcBridge.creativeStudio.acceptProposal.provider((input) =>
    runCommand(() => dependencies.getService().acceptProposal(input))
  );
  ipcBridge.creativeStudio.rejectProposal.provider((input) =>
    runCommand(() => dependencies.getService().rejectProposal(input))
  );
  ipcBridge.creativeStudio.listReferenceRequests.provider((input) =>
    runCommand(() => dependencies.getService().listReferenceRequests(input))
  );
  ipcBridge.creativeStudio.decideReferenceRequest.provider((input) =>
    runCommand(() => dependencies.getService().decideReferenceRequest(input))
  );
  ipcBridge.creativeStudio.listReferenceGenerationHandoffs.provider((input) =>
    runCommand(() => dependencies.getService().listReferenceGenerationHandoffs(input))
  );
  ipcBridge.creativeStudio.prepareSubmission.provider((input) =>
    runCommand(() => dependencies.getService().prepareSubmission(input))
  );
  ipcBridge.creativeStudio.confirmSubmission.provider((input) =>
    runCommand(() => dependencies.getService().confirmSubmission(input))
  );
  ipcBridge.creativeStudio.dismissReferenceGenerationHandoff.provider((input) =>
    runCommand(() => dependencies.getService().dismissReferenceGenerationHandoff(input))
  );
  ipcBridge.creativeStudio.applyAuthoringBatch.provider((input) =>
    runCommand(() => applyOperations(input, input.operations))
  );
  ipcBridge.creativeStudio.undoLast.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'undo_last', entryId: input.entryId }]))
  );
  ipcBridge.creativeStudio.getWorkspaceStatus.provider((input) =>
    runCommand(() => dependencies.getService().getWorkspaceStatus(input))
  );
  ipcBridge.creativeStudio.getChainStatus.provider((input) =>
    runCommand(() => dependencies.getService().getChainStatus(input))
  );
  ipcBridge.creativeStudio.retryConditioningFrame.provider((input) =>
    runCommand(() => dependencies.getService().retryConditioningFrame(input).then(toCommitResult))
  );
  ipcBridge.creativeStudio.cancelWaitingCascade.provider((input) =>
    runCommand(() => dependencies.getService().cancelWaitingCascade(input).then(toCommitResult))
  );
  ipcBridge.creativeStudio.editProject.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'edit_project', changes: input.changes }]))
  );
  ipcBridge.creativeStudio.setRules.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'set_rules', rules: input.rules }]))
  );
  ipcBridge.creativeStudio.parkBeat.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'park_beat', beatId: input.beatId }]))
  );
  ipcBridge.creativeStudio.restoreBeat.provider((input) =>
    runCommand(() =>
      applyOperations(input, [{ kind: 'restore_beat', beatId: input.beatId, beforeBeatId: input.beforeBeatId }])
    )
  );
  ipcBridge.creativeStudio.parkShot.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'park_shot', shotId: input.shotId }]))
  );
  ipcBridge.creativeStudio.restoreShot.provider((input) =>
    runCommand(() =>
      applyOperations(input, [{ kind: 'restore_shot', shotId: input.shotId, beforeShotId: input.beforeShotId }])
    )
  );
  ipcBridge.creativeStudio.parkTake.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'park_take', shotId: input.shotId, assetId: input.assetId }]))
  );
  ipcBridge.creativeStudio.addAlternateTake.provider((input) =>
    runCommand(() =>
      applyOperations(input, [{ kind: 'add_alternate_take', shotId: input.shotId, assetId: input.assetId }])
    )
  );
  ipcBridge.creativeStudio.restoreTake.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'restore_take', shotId: input.shotId, assetId: input.assetId }]))
  );
  ipcBridge.creativeStudio.selectTake.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'select_take', shotId: input.shotId, assetId: input.assetId }]))
  );
  ipcBridge.creativeStudio.reorderBin.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'reorder_bin', bin: input.bin }]))
  );
  ipcBridge.creativeStudio.deleteProject.provider((input) =>
    runCommand(() => dependencies.getService().deleteProject(input))
  );
  ipcBridge.creativeStudio.persistCapturedPoster.provider((input) =>
    runCommand(() => dependencies.getService().persistCapturedPoster(input))
  );
  ipcBridge.creativeStudio.chooseAndImportReference.provider((input) =>
    runCommand(async () => {
      const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
      const picked = await (dependencies.showOpenDialog ?? defaultDependencies.showOpenDialog!)(parentWindow);
      if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' as const };
      const imported = await dependencies
        .getService()
        .importReferenceFromPath({ ...input, sourcePath: picked.filePaths[0] });
      return {
        status: 'imported' as const,
        assetId: imported.asset.id,
        projectRevision: imported.project.revision,
      };
    })
  );
  ipcBridge.creativeStudio.detachBriefReference.provider((input) =>
    runCommand(async () => {
      const project = await dependencies.getService().detachBriefReference(input);
      return { status: 'detached' as const, projectRevision: project.revision };
    })
  );
  ipcBridge.creativeStudio.importSeedStill.provider((input) =>
    runCommand(async () => {
      const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
      const picked = await (dependencies.showOpenDialog ?? defaultDependencies.showOpenDialog!)(parentWindow);
      if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' as const };
      const imported = await dependencies
        .getService()
        .importReferenceFromPath({ ...input, sourcePath: picked.filePaths[0] });
      return {
        status: 'imported' as const,
        assetId: imported.asset.id,
        projectRevision: imported.project.revision,
      };
    })
  );
  ipcBridge.creativeStudio.listConnectionCandidates.provider(() =>
    runCommand(() => dependencies.getService().listConnectionCandidates())
  );
  ipcBridge.creativeStudio.listConnections.provider(() =>
    runCommand(() => dependencies.getService().listConnections())
  );
  ipcBridge.creativeStudio.validateConnection.provider((input) =>
    runCommand(() => dependencies.getService().validateConnection(input))
  );
  ipcBridge.creativeStudio.saveConnection.provider((input) =>
    runCommand(() => dependencies.getService().saveConnection(input))
  );
  ipcBridge.creativeStudio.removeConnection.provider((input) =>
    runCommand(() => dependencies.getService().removeConnection(input))
  );
  ipcBridge.creativeStudio.listRoutes.provider((input) =>
    runCommand(() => dependencies.getService().listRoutes(input))
  );
}
