/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Hook Sentry IPC so the renderer SDK uses ipcRenderer.send instead of falling
// back to fetch('sentry-ipc://...'), which floods the DevTools Network panel.
// Bundled into this preload via `externalizeDepsPlugin({ exclude: [...] })` so
// Electron's sandbox-mode preload doesn't try to resolve it from node_modules.
import '@sentry/electron/preload';
import { contextBridge, ipcRenderer, webUtils } from 'electron';
import { ADAPTER_BRIDGE_EVENT_KEY } from '../common/adapter/native/constants';
import { normalizePresentationConversationId } from '../common/types/office/presentationConversationId';
import type {
  GrantPresentationExternalDropRequest,
  GrantPresentationExternalDropResult,
  PresentationGrantOwner,
} from '../common/types/office/presentationRun';

const PRESENTATION_EXTERNAL_DROP_CHANNEL = 'presentation-sources:grant-external-drop';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key));
};

const parsePresentationGrantOwner = (value: unknown): PresentationGrantOwner | null => {
  if (!isRecord(value) || typeof value.owner_type !== 'string') return null;

  if (value.owner_type === 'draft') {
    return hasExactKeys(value, ['owner_type', 'draft_id']) &&
      typeof value.draft_id === 'string' &&
      UUID_PATTERN.test(value.draft_id)
      ? { owner_type: 'draft', draft_id: value.draft_id }
      : null;
  }

  if (value.owner_type !== 'conversation' || !hasExactKeys(value, ['owner_type', 'conversation_id'])) return null;
  const conversationId = normalizePresentationConversationId(value.conversation_id);
  return conversationId === null ? null : { owner_type: 'conversation', conversation_id: conversationId };
};

const presentationDropFailure = (
  code: 'INVALID_REQUEST' | 'NATIVE_FILE_REQUIRED' | 'INTERNAL_ERROR'
): GrantPresentationExternalDropResult => ({
  ok: false,
  code,
  messageKey: `conversation.presentationRun.${code}`,
  retryable: false,
  state: 'preflight',
  details: null,
});

const grantPresentationExternalDrop = async (
  request: GrantPresentationExternalDropRequest
): Promise<GrantPresentationExternalDropResult> => {
  const owner = isRecord(request) ? parsePresentationGrantOwner(request.owner) : null;
  if (
    !isRecord(request) ||
    !hasExactKeys(request, ['owner', 'files', 'expected_owner_revision']) ||
    owner === null ||
    !Number.isSafeInteger(request.expected_owner_revision) ||
    (request.expected_owner_revision as number) < 0 ||
    !Array.isArray(request.files) ||
    request.files.length < 1 ||
    request.files.length > 16 ||
    !request.files.every((file) => file instanceof File)
  ) {
    return presentationDropFailure('INVALID_REQUEST');
  }

  const nativePaths: string[] = [];
  for (const file of request.files) {
    let nativePath: unknown;
    try {
      nativePath = webUtils.getPathForFile(file);
    } catch {
      return presentationDropFailure('NATIVE_FILE_REQUIRED');
    }
    if (typeof nativePath !== 'string' || nativePath.length === 0) {
      return presentationDropFailure('NATIVE_FILE_REQUIRED');
    }
    nativePaths.push(nativePath);
  }

  try {
    return (await ipcRenderer.invoke(PRESENTATION_EXTERNAL_DROP_CHANNEL, {
      owner,
      native_paths: nativePaths,
      expected_owner_revision: request.expected_owner_revision,
    })) as GrantPresentationExternalDropResult;
  } catch {
    return presentationDropFailure('INTERNAL_ERROR');
  }
};

/**
 * @description 注入到renderer进程中, 用于与main进程通信
 * */
contextBridge.exposeInMainWorld('electronAPI', {
  emit: (name: string, data: unknown) => {
    return ipcRenderer
      .invoke(
        ADAPTER_BRIDGE_EVENT_KEY,
        JSON.stringify({
          name: name,
          data: data,
        })
      )
      .catch((error) => {
        console.error('IPC invoke error:', error);
        throw error;
      });
  },
  on: (callback: (payload: { event: unknown; value: unknown }) => void) => {
    const handler = (event: unknown, value: unknown) => {
      callback({ event, value });
    };
    ipcRenderer.on(ADAPTER_BRIDGE_EVENT_KEY, handler);
    return () => {
      ipcRenderer.off(ADAPTER_BRIDGE_EVENT_KEY, handler);
    };
  },
  // 获取拖拽文件/目录的绝对路径 / Get absolute path for dragged file/directory
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  presentationSources: {
    grantExternalDrop: grantPresentationExternalDrop,
  },
  // Feedback: capture a screenshot of the current window
  captureFeedbackScreenshot: () => ipcRenderer.invoke('feedback:capture-screenshot'),
  // Feedback: export a local diagnostic package chosen by the user
  exportLocalFeedbackDiagnostics: (input: unknown) => ipcRenderer.invoke('feedback:export-local', input),
  recoverCorruptedDatabase: () => ipcRenderer.invoke('backend:recover-corrupted-database'),
});

// Synchronously fetch the aioncore port and expose it to the renderer
// via contextBridge (direct window assignment is invisible under contextIsolation).
const backendPort = ipcRenderer.sendSync('get-backend-port') as number;
const initialLanguage = ipcRenderer.sendSync('get-initial-language') as string | null;
const backendStartupFailed = ipcRenderer.sendSync('get-backend-startup-failed') as boolean;
const backendStartupFailure = ipcRenderer.sendSync('get-backend-startup-failure') as unknown;
const backendLocalToken = ipcRenderer.sendSync('get-backend-local-token') as string;
contextBridge.exposeInMainWorld('__backendPort', backendPort > 0 ? backendPort : 0);
// Secret the `--local` backend requires on every call. Exposed to the app's own
// renderer only — webviews and iframes get their own preload (or none), so page
// content rendered inside the app never sees it.
contextBridge.exposeInMainWorld('__backendLocalToken', backendLocalToken || '');
contextBridge.exposeInMainWorld('__initialLanguage', initialLanguage ?? null);
contextBridge.exposeInMainWorld('__aionuiE2ETest', process.env.AIONUI_E2E_TEST === '1');
contextBridge.exposeInMainWorld('__backendStartupFailed', backendStartupFailed === true);
contextBridge.exposeInMainWorld('__backendStartupFailure', backendStartupFailure ?? null);

// 托盘事件监听 - 将 IPC 事件转换为 DOM 事件
// Tray event listeners - convert IPC events to DOM events
const trayEvents = [
  'tray:navigate-to-guid',
  'tray:navigate-to-conversation',
  'tray:pause-all-tasks',
  'tray:check-update',
];

for (const channel of trayEvents) {
  ipcRenderer.on(channel, (_event, ...args) => {
    window.dispatchEvent(new CustomEvent(channel, { detail: args[0] }));
  });
}
