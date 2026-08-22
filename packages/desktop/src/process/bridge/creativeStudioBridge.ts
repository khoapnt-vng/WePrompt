/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { randomUUID } from 'node:crypto';
import { ipcBridge } from '@/common';
import { CREATIVE_STUDIO_ENABLED } from '@/common/config/constants';
import {
  isStudioPricingRefusalReasonV2,
  STUDIO_MAX_SHOT_SECONDS,
  STUDIO_MIN_SHOT_SECONDS,
  STUDIO_PROJECT_SCHEMA_VERSION,
  STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT,
  STUDIO_MAX_EXPORTS_PER_SHAPE,
  STUDIO_VIEWS,
  type StudioCommandErrorCode,
  type StudioCommandResult,
  type StudioConnectionValidationFailureReason,
  type StudioConnectionValidationResult,
  type StudioConnectionValidationSuccess,
  type StudioMutationBatchResultV2,
  type StudioMutationReducerContextV2,
  type StudioRendererConnectionCapabilities,
  type StudioRendererProjectCommitResultV2,
  type StudioRendererExportCatalogV2,
  type StudioRendererWorkspaceStatusV2,
} from '@/common/types/project/creativeStudioTypes';
import { CreativeStudioServiceError } from '@process/services/creative-studio/service/projectMutations';
import { StudioJobManagerError } from '@process/services/creative-studio/jobManager';
import { StudioPreparedSubmissionCacheErrorV2 } from '@process/services/creative-studio/service/schema2/pricing/preparedSubmissionCache';
import { StudioPricingErrorV2 } from '@process/services/creative-studio/service/schema2/pricing/estimate';
import type { CreativeStudioServiceV2 } from '@process/services/creative-studio/service/v2Service';
import { CreativeStudioStoreError } from '@process/services/creative-studio/store';
import { CreativeStudioMediaError } from '@process/services/creative-studio/mediaStore';
import { getCreativeStudioService } from '@process/services/creative-studio/runtime';
import { BrowserWindow, dialog, shell } from 'electron';

const errorMessageKeys: Record<StudioCommandErrorCode, string> = {
  feature_disabled: 'conversation.creativeStudio.errors.featureDisabled',
  invalid_payload: 'conversation.creativeStudio.errors.invalidPayload',
  pricing_refused: 'conversation.creativeStudio.errors.pricingRefused',
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

type NonPricingStudioCommandErrorCode = Exclude<StudioCommandErrorCode, 'pricing_refused'>;

const storeErrorCode = (error: CreativeStudioStoreError): NonPricingStudioCommandErrorCode =>
  error.code === 'unsupported_prototype_schema' ? 'storage_error' : error.code;

const jobManagerErrorCode = (error: StudioJobManagerError): NonPricingStudioCommandErrorCode =>
  error.code === 'invalid_request' ? 'invalid_payload' : error.code;

const toCommandError = (error: unknown): StudioCommandResult<never> => {
  if (error instanceof StudioPricingErrorV2 && isStudioPricingRefusalReasonV2(error.code)) {
    return {
      ok: false,
      error: {
        code: 'pricing_refused',
        reason: error.code,
        messageKey: errorMessageKeys.pricing_refused,
      },
    };
  }
  const code: NonPricingStudioCommandErrorCode =
    error instanceof CreativeStudioStoreError
      ? storeErrorCode(error)
      : error instanceof StudioJobManagerError
        ? jobManagerErrorCode(error)
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
  showAudioOpenDialog?: (
    window: BrowserWindow | undefined,
    filterName: string
  ) => Promise<{ canceled: boolean; filePaths: string[] }>;
  chooseExportDestination?: (
    window: BrowserWindow | undefined,
    input: { suggestedName: string; isDirectory: boolean }
  ) => Promise<string | null>;
  revealExportPath?: (filePath: string) => void;
  translate?: (key: string) => string | Promise<string>;
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
  showAudioOpenDialog: (window, filterName) =>
    dialog.showOpenDialog(window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0], {
      properties: ['openFile'],
      filters: [{ name: filterName, extensions: ['wav'] }],
    }),
  chooseExportDestination: async (window, input) => {
    const result = await dialog.showSaveDialog(
      window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0],
      { defaultPath: input.suggestedName }
    );
    return result.canceled || !result.filePath ? null : result.filePath;
  },
  revealExportPath: (filePath) => shell.showItemInFolder(filePath),
  translate: async (key) => {
    const { default: i18n } = await import('@process/services/i18n');
    return i18n.t(key);
  },
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

const exportBoundaryFailure = (): never => {
  throw new CreativeStudioStoreError('storage_error', 'Creative Studio export result is invalid');
};

const isExactDataObject = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) {
    return false;
  }
  return ownKeys.every((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor;
  });
};

const MISSING_DATA_PROPERTY = Symbol('missing-data-property');
const CONNECTION_MAX_DURATION_SECONDS = 60;

const dataRecord = (value: unknown): Record<string, unknown> | null => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null ? (value as Record<string, unknown>) : null;
};

const ownDataProperty = (record: Record<string, unknown>, key: string): unknown | typeof MISSING_DATA_PROPERTY => {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  return descriptor !== undefined && descriptor.enumerable && 'value' in descriptor
    ? descriptor.value
    : MISSING_DATA_PROPERTY;
};

const projectDenseArray = <T>(value: unknown, accepts: (item: unknown) => item is T): T[] | null => {
  if (!Array.isArray(value) || Reflect.ownKeys(value).length !== value.length + 1) return null;
  const projected: T[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor) || !accepts(descriptor.value)) {
      return null;
    }
    projected.push(descriptor.value);
  }
  return projected;
};

const isStudioConnectionValidationFailureReason = (value: unknown): value is StudioConnectionValidationFailureReason =>
  value === 'unsupported' ||
  value === 'auth' ||
  value === 'rate_limited' ||
  value === 'provider_unavailable' ||
  value === 'timeout' ||
  value === 'invalid_response' ||
  value === 'unknown';

const connectionValidationBoundaryFailure = (): never => {
  throw new CreativeStudioServiceError('provider_error');
};

const projectConnectionCapabilities = (value: unknown): StudioRendererConnectionCapabilities => {
  const record = dataRecord(value);
  if (record === null) return connectionValidationBoundaryFailure();
  const mediaKinds = projectDenseArray(
    ownDataProperty(record, 'mediaKinds'),
    (item): item is 'image' | 'video' => item === 'image' || item === 'video'
  );
  if (mediaKinds === null || mediaKinds.length !== 1) return connectionValidationBoundaryFailure();
  const projected: StudioRendererConnectionCapabilities = { mediaKinds };

  const audioModesValue = ownDataProperty(record, 'audioModes');
  if (audioModesValue !== MISSING_DATA_PROPERTY) {
    const audioModes = projectDenseArray(
      audioModesValue,
      (item): item is string => item === 'audio' || item === 'none'
    );
    if (audioModes === null || audioModes.length !== 1) return connectionValidationBoundaryFailure();
    projected.audioModes = audioModes;
  }

  const aspectRatiosValue = ownDataProperty(record, 'aspectRatios');
  if (aspectRatiosValue !== MISSING_DATA_PROPERTY) {
    const aspectRatios = projectDenseArray(
      aspectRatiosValue,
      (item): item is '16:9' | '9:16' | '1:1' | '4:3' | '3:4' =>
        item === '16:9' || item === '9:16' || item === '1:1' || item === '4:3' || item === '3:4'
    );
    if (aspectRatios === null || aspectRatios.length === 0 || new Set(aspectRatios).size !== aspectRatios.length) {
      return connectionValidationBoundaryFailure();
    }
    projected.aspectRatios = aspectRatios;
  }

  const resolutionsValue = ownDataProperty(record, 'resolutions');
  if (resolutionsValue !== MISSING_DATA_PROPERTY) {
    const resolutions = projectDenseArray(
      resolutionsValue,
      (item): item is '720p' | '1080p' => item === '720p' || item === '1080p'
    );
    if (resolutions === null || resolutions.length === 0 || new Set(resolutions).size !== resolutions.length) {
      return connectionValidationBoundaryFailure();
    }
    projected.resolutions = resolutions;
  }

  const minimum = ownDataProperty(record, 'minDurationSeconds');
  const maximum = ownDataProperty(record, 'maxDurationSeconds');
  if (minimum !== MISSING_DATA_PROPERTY || maximum !== MISSING_DATA_PROPERTY) {
    if (
      !Number.isInteger(minimum) ||
      !Number.isInteger(maximum) ||
      (minimum as number) < 1 ||
      (maximum as number) > CONNECTION_MAX_DURATION_SECONDS ||
      (minimum as number) > (maximum as number)
    ) {
      return connectionValidationBoundaryFailure();
    }
    projected.minDurationSeconds = minimum as number;
    projected.maxDurationSeconds = maximum as number;
  }

  const supportedDurationsValue = ownDataProperty(record, 'supportedDurationSeconds');
  if (supportedDurationsValue !== MISSING_DATA_PROPERTY) {
    const supportedDurationSeconds = projectDenseArray(
      supportedDurationsValue,
      (item): item is number =>
        typeof item === 'number' &&
        Number.isInteger(item) &&
        item >= STUDIO_MIN_SHOT_SECONDS &&
        item <= STUDIO_MAX_SHOT_SECONDS
    );
    if (
      supportedDurationSeconds === null ||
      supportedDurationSeconds.length === 0 ||
      supportedDurationSeconds.some(
        (duration, index) => index > 0 && duration <= supportedDurationSeconds[index - 1]!
      ) ||
      projected.minDurationSeconds !== supportedDurationSeconds[0] ||
      projected.maxDurationSeconds !== supportedDurationSeconds.at(-1)
    ) {
      return connectionValidationBoundaryFailure();
    }
    projected.supportedDurationSeconds = supportedDurationSeconds;
  }

  const supportsFirstFrame = ownDataProperty(record, 'supportsFirstFrame');
  if (supportsFirstFrame !== MISSING_DATA_PROPERTY) {
    if (typeof supportsFirstFrame !== 'boolean') return connectionValidationBoundaryFailure();
    projected.supportsFirstFrame = supportsFirstFrame;
  }
  const maxConditioningImages = ownDataProperty(record, 'maxConditioningImages');
  if (maxConditioningImages !== MISSING_DATA_PROPERTY) {
    if (
      !Number.isInteger(maxConditioningImages) ||
      (maxConditioningImages as number) < 0 ||
      (maxConditioningImages as number) > 6
    ) {
      return connectionValidationBoundaryFailure();
    }
    projected.maxConditioningImages = maxConditioningImages as number;
  }
  return projected;
};

const projectConnectionValidationSuccess = (value: unknown): StudioConnectionValidationSuccess => {
  const record = dataRecord(value);
  if (record === null) return connectionValidationBoundaryFailure();
  const providerId = ownDataProperty(record, 'providerId');
  const integrationId = ownDataProperty(record, 'integrationId');
  const labelKey = ownDataProperty(record, 'labelKey');
  const model = ownDataProperty(record, 'model');
  const capabilities = ownDataProperty(record, 'capabilities');
  const validatedAt = ownDataProperty(record, 'validatedAt');
  if (
    typeof providerId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(providerId) ||
    typeof integrationId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,256}$/.test(integrationId) ||
    (labelKey !== 'imageApi' &&
      labelKey !== 'bytePlusSeedance' &&
      labelKey !== 'selfHostedVideoGateway' &&
      labelKey !== 'openRouterVideo') ||
    typeof model !== 'string' ||
    model.length === 0 ||
    model.length > 256 ||
    model !== model.trim() ||
    Array.from(model).some((character) => {
      const codePoint = character.codePointAt(0)!;
      return (
        codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      );
    }) ||
    typeof validatedAt !== 'string' ||
    !Number.isFinite(Date.parse(validatedAt)) ||
    new Date(validatedAt).toISOString() !== validatedAt
  ) {
    return connectionValidationBoundaryFailure();
  }
  return {
    providerId,
    integrationId,
    labelKey,
    model,
    capabilities: projectConnectionCapabilities(capabilities),
    validatedAt,
  };
};

const projectConnectionValidationResult = (value: unknown): StudioConnectionValidationResult => {
  const record = dataRecord(value);
  if (record === null) return connectionValidationBoundaryFailure();
  const valid = ownDataProperty(record, 'valid');
  if (valid === false) {
    const reason = ownDataProperty(record, 'reason');
    if (!isStudioConnectionValidationFailureReason(reason)) return connectionValidationBoundaryFailure();
    return { valid: false, reason };
  }
  if (valid !== true) return connectionValidationBoundaryFailure();
  return {
    valid: true,
    connection: projectConnectionValidationSuccess(ownDataProperty(record, 'connection')),
  };
};

const toRendererExportCatalog = (value: unknown): StudioRendererExportCatalogV2 => {
  if (
    !isExactDataObject(value, ['revision', 'artifacts']) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 1 ||
    !Array.isArray(value.artifacts) ||
    Reflect.ownKeys(value.artifacts).length !== value.artifacts.length + 1 ||
    value.artifacts.length > STUDIO_MAX_EXPORTS_PER_SHAPE * 3
  ) {
    return exportBoundaryFailure();
  }
  const artifacts: StudioRendererExportCatalogV2['artifacts'] = [];
  const ids = new Set<string>();
  const shapeCounts = new Map<'editor_folder' | 'still' | 'script', number>();
  let previous: { createdAt: string; id: string } | null = null;
  for (let index = 0; index < value.artifacts.length; index += 1) {
    if (!Object.hasOwn(value.artifacts, index)) return exportBoundaryFailure();
    const artifact = value.artifacts[index];
    if (
      !isExactDataObject(artifact, ['id', 'sourceRevision', 'shape', 'byteSize', 'fileCount', 'createdAt']) ||
      typeof artifact.id !== 'string' ||
      !/^[A-Za-z0-9_-]{1,256}$/.test(artifact.id) ||
      ids.has(artifact.id) ||
      !Number.isSafeInteger(artifact.sourceRevision) ||
      (artifact.sourceRevision as number) < 1 ||
      (artifact.shape !== 'editor_folder' && artifact.shape !== 'still' && artifact.shape !== 'script') ||
      !Number.isSafeInteger(artifact.byteSize) ||
      (artifact.byteSize as number) < 0 ||
      !Number.isSafeInteger(artifact.fileCount) ||
      (artifact.fileCount as number) < 1 ||
      (artifact.fileCount as number) > STUDIO_MAX_EXPORT_FILES_PER_ARTIFACT ||
      (artifact.shape !== 'editor_folder' && artifact.fileCount !== 1) ||
      typeof artifact.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(artifact.createdAt)) ||
      new Date(artifact.createdAt).toISOString() !== artifact.createdAt
    ) {
      return exportBoundaryFailure();
    }
    if (
      previous !== null &&
      (previous.createdAt > artifact.createdAt ||
        (previous.createdAt === artifact.createdAt && previous.id >= artifact.id))
    ) {
      return exportBoundaryFailure();
    }
    ids.add(artifact.id);
    const shapeCount = (shapeCounts.get(artifact.shape) ?? 0) + 1;
    if (shapeCount > STUDIO_MAX_EXPORTS_PER_SHAPE) return exportBoundaryFailure();
    shapeCounts.set(artifact.shape, shapeCount);
    previous = { createdAt: artifact.createdAt, id: artifact.id };
    artifacts.push({
      id: artifact.id,
      sourceRevision: artifact.sourceRevision as number,
      shape: artifact.shape,
      byteSize: artifact.byteSize as number,
      fileCount: artifact.fileCount as number,
      createdAt: artifact.createdAt,
    });
  }
  return { revision: value.revision as number, artifacts };
};

const toCopyExportResult = (value: unknown): { status: 'cancelled' } | { status: 'copied' } => {
  if (!isExactDataObject(value, ['status']) || (value.status !== 'cancelled' && value.status !== 'copied')) {
    return exportBoundaryFailure();
  }
  return { status: value.status };
};

const toRevealExportResult = (value: unknown): { status: 'revealed' } => {
  if (!isExactDataObject(value, ['status']) || value.status !== 'revealed') return exportBoundaryFailure();
  return { status: 'revealed' };
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
  ipcBridge.creativeStudio.cancelJob.provider((input) => runCommand(() => dependencies.getService().cancelJob(input)));
  ipcBridge.creativeStudio.retryJob.provider((input) => runCommand(() => dependencies.getService().retryJob(input)));
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
  ipcBridge.creativeStudio.importBedAudio.provider((input) =>
    runCommand(async () => {
      const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
      const filterName = await (dependencies.translate ?? defaultDependencies.translate!)(
        'conversation.creativeStudio.workspace.cut.bed.pickerFilter'
      );
      const picked = await (dependencies.showAudioOpenDialog ?? defaultDependencies.showAudioOpenDialog!)(
        parentWindow,
        filterName
      );
      if (picked.canceled || !picked.filePaths[0]) return { status: 'cancelled' as const };
      const imported = await dependencies
        .getService()
        .importBedAudioFromPath({ ...input, sourcePath: picked.filePaths[0] });
      return {
        status: 'imported' as const,
        assetId: imported.asset.id,
        projectRevision: imported.project.revision,
      };
    })
  );
  ipcBridge.creativeStudio.detachBedAudio.provider((input) =>
    runCommand(async () => {
      const project = await dependencies.getService().detachBedAudio(input);
      return { status: 'detached' as const, projectRevision: project.revision };
    })
  );
  ipcBridge.creativeStudio.setBed.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'set_bed', assetId: input.assetId }]))
  );
  ipcBridge.creativeStudio.setMatchTo.provider((input) =>
    runCommand(() => applyOperations(input, [{ kind: 'set_match_to', shotId: input.shotId }]))
  );
  ipcBridge.creativeStudio.createExport.provider((input) =>
    runCommand(() => dependencies.getService().createExport(input).then(toRendererExportCatalog))
  );
  ipcBridge.creativeStudio.listExports.provider((input) =>
    runCommand(() => dependencies.getService().listExports(input).then(toRendererExportCatalog))
  );
  ipcBridge.creativeStudio.copyExport.provider((input) =>
    runCommand(() => {
      const parentWindow = (dependencies.getParentWindow ?? defaultDependencies.getParentWindow!)();
      return dependencies
        .getService()
        .copyExport(input, (options) =>
          (dependencies.chooseExportDestination ?? defaultDependencies.chooseExportDestination!)(parentWindow, options)
        )
        .then(toCopyExportResult);
    })
  );
  ipcBridge.creativeStudio.revealExport.provider((input) =>
    runCommand(() =>
      dependencies
        .getService()
        .revealExport(input, dependencies.revealExportPath ?? defaultDependencies.revealExportPath!)
        .then(toRevealExportResult)
    )
  );
  ipcBridge.creativeStudio.listConnectionCandidates.provider(() =>
    runCommand(() => dependencies.getService().listConnectionCandidates())
  );
  ipcBridge.creativeStudio.listConnections.provider(() =>
    runCommand(() => dependencies.getService().listConnections())
  );
  ipcBridge.creativeStudio.validateConnection.provider((input) =>
    runCommand(() => dependencies.getService().validateConnection(input).then(projectConnectionValidationResult))
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
