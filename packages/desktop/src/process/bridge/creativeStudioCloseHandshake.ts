/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

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
/** Pilot has one canonical, viewless project route. Legacy room suffixes do not bypass preflight. */
const STUDIO_ROUTE_PATTERN = /^\/studio\/[^/?#]+\/?$/;

const isCreativeStudioRendererUrl = (rawUrl: string): boolean => {
  try {
    const hash = new URL(rawUrl).hash;
    const routePath = hash.startsWith('#') ? hash.slice(1).split('?')[0] : '';
    return STUDIO_ROUTE_PATTERN.test(routePath);
  } catch {
    return false;
  }
};

/** Coordinates Pilot close/quit preflight without importing the retired schema-5 bridge or reader. */
export function createCreativeStudioCloseHandshake(
  dependencies: CreativeStudioCloseHandshakeDependencies
): CreativeStudioCloseHandshake {
  let shutdownConfirmed = false;
  let pendingIntent: 'close' | 'quit' | null = null;
  let preflight: Promise<void> | null = null;

  const cancel = (): void => {
    if (pendingIntent === 'quit') dependencies.onQuitCancelled();
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
    if (shutdownConfirmed || !isCreativeStudioRendererUrl(dependencies.getCurrentUrl())) return false;

    event.preventDefault();
    if (intent === 'quit') pendingIntent = 'quit';
    else if (pendingIntent === null) pendingIntent = 'close';

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
