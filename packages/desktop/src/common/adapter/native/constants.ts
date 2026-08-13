/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

export const ADAPTER_BRIDGE_EVENT_KEY = 'office-ai-bridge-adapter';

/**
 * Electron-native providers reachable through the generic bridge adapter.
 * HTTP/WS-backed providers are intentionally absent because they never cross
 * the Electron IPC boundary.
 */
export const NATIVE_BRIDGE_PROVIDER_KEYS = [
  'restart-app',
  'quit-app',
  'open-dev-tools',
  'is-dev-tools-opened',
  'app.get-path',
  'update-system-info',
  'app.get-zoom-factor',
  'app.set-zoom-factor',
  'app.get-cdp-status',
  'app.update-cdp-config',
  'app.get-start-on-boot-status',
  'app.set-start-on-boot',
  'app.get-gpu-status',
  'app.set-gpu-override',
  'app.write-renderer-log',
  'update.check',
  'update.installer-last-failure.consume',
  'update.download',
  'update.download.cancel',
  'auto-update.check',
  'auto-update.restore-downloaded',
  'auto-update.download',
  'auto-update.download.cancel',
  'auto-update.quit-and-install',
  'show-open',
  'presentation-templates.list',
  'presentation-templates.import-spec',
  'presentation-templates.describe-spec',
  'presentation-templates.import-spec-bound',
  'presentation-templates.remove',
  'presentation-templates.scratch.allocate',
  'presentation-templates.scratch.complete',
  'presentation-templates.scratch.retain',
  'presentation-templates.scratch.discard',
  'presentation-sources.get-source-owner',
  'presentation-sources.create-draft',
  'presentation-sources.bind-draft',
  'presentation-sources.pick-sources',
  'presentation-sources.grant-workspace-source',
  'presentation-sources.revoke',
  'presentation-sources.confirm-queued',
  'presentation-runs.start',
  'presentation-runs.get',
  'presentation-runs.list-recoverable',
  'presentation-runs.open-recovery',
  'presentation-runs.discard',
  'presentation-runs.claim-initial-dispatch',
  'presentation-runs.renew-initial-dispatch',
  'presentation-runs.dispatch',
  'app-operations.context-compact',
  'app-operations.cancel',
  'project-knowledge.list-sources',
  'project-knowledge.add-sources',
  'project-knowledge.remove-source',
  'project-knowledge.get-source-text',
  'project-knowledge.retry-source',
  'project-knowledge.sync-folder',
  'project-knowledge.watch-folder',
  'project-knowledge.unwatch-folder',
  'project-knowledge.remove-store',
  'project-knowledge.get-session-mcp-server',
  'creative-studio.list-projects',
  'creative-studio.create-project',
  'creative-studio.get-project',
  'creative-studio.get-brief-session-server',
  'creative-studio.list-proposals',
  'creative-studio.list-pending-reference-requests',
  'creative-studio.dismiss-reference-requests',
  'creative-studio.accept-proposal',
  'creative-studio.reject-proposal',
  'creative-studio.propose-storyboard',
  'creative-studio.update-model-selection',
  'creative-studio.update-project',
  'creative-studio.set-brief-rules',
  'creative-studio.undo-brief-rules',
  'creative-studio.bind-brief-conversation',
  'creative-studio.update-cut',
  'creative-studio.place-cut-scenes',
  'creative-studio.delete-project',
  'creative-studio.update-scene',
  'creative-studio.reorder-scenes',
  'creative-studio.select-asset',
  'creative-studio.persist-captured-poster',
  'creative-studio.choose-and-import-reference',
  'creative-studio.choose-and-export-assets',
  'creative-studio.get-latest-render',
  'creative-studio.render-cut',
  'creative-studio.cancel-render',
  'creative-studio.fit-storyboard',
  'creative-studio.submit-scenes',
  'creative-studio.cancel-job',
  'creative-studio.retry-job',
  'creative-studio.retry-download',
  'creative-studio.list-connection-candidates',
  'creative-studio.list-connections',
  'creative-studio.validate-connection',
  'creative-studio.save-connection',
  'creative-studio.remove-connection',
  'creative-studio.list-routes',
  'office-artifact.get-state',
  'office-artifact.prepare-preview',
  'office-artifact.start-preview',
  'office-artifact.release-preview',
  'office-artifact.inspect',
  'office-artifact.apply',
  'office-artifact.undo',
  'window-controls:minimize',
  'window-controls:maximize',
  'window-controls:unmaximize',
  'window-controls:close',
  'window-controls:is-maximized',
  'theme:set-active',
  'theme:request-current',
  'system-settings:get-close-to-tray',
  'system-settings:set-close-to-tray',
  'system-settings:get-pet-enabled',
  'system-settings:set-pet-enabled',
  'system-settings:get-pet-size',
  'system-settings:set-pet-size',
  'system-settings:get-pet-dnd',
  'system-settings:set-pet-dnd',
  'system-settings:get-pet-confirm-enabled',
  'system-settings:set-pet-confirm-enabled',
  'notification.show',
  'webui.get-status',
  'webui.start',
  'webui.stop',
] as const;

export type NativeBridgeProviderKey = (typeof NATIVE_BRIDGE_PROVIDER_KEYS)[number];

/**
 * Renderer-owned queries that the main process may invoke. These are kept
 * separate from native providers so a renderer cannot invoke them through the
 * privileged renderer-to-main request path.
 */
export const RENDERER_BRIDGE_QUERY_KEYS = [
  'creative-studio.has-unsaved-work',
  'creative-studio.flush-unsaved-work',
] as const;

export type RendererBridgeQueryKey = (typeof RENDERER_BRIDGE_QUERY_KEYS)[number];

const NATIVE_BRIDGE_PROVIDER_KEY_SET = new Set<string>(NATIVE_BRIDGE_PROVIDER_KEYS);
const NATIVE_BRIDGE_REQUEST_PREFIX = 'subscribe-';
const RENDERER_BRIDGE_QUERY_CALLBACK_PREFIX = 'subscribe.callback-';
const BRIDGE_REQUEST_ID_SUFFIX_PATTERN = /^[a-f0-9]{8}$/;

export function getNativeBridgeProviderKey(name: string): NativeBridgeProviderKey | null {
  if (!name.startsWith(NATIVE_BRIDGE_REQUEST_PREFIX)) return null;
  const providerKey = name.slice(NATIVE_BRIDGE_REQUEST_PREFIX.length);
  return NATIVE_BRIDGE_PROVIDER_KEY_SET.has(providerKey) ? (providerKey as NativeBridgeProviderKey) : null;
}

export function isAllowedNativeBridgeRequestName(name: string): boolean {
  return getNativeBridgeProviderKey(name) !== null;
}

export function getRendererBridgeQueryResponseKey(name: string): RendererBridgeQueryKey | null {
  if (!name.startsWith(RENDERER_BRIDGE_QUERY_CALLBACK_PREFIX)) return null;

  for (const queryKey of RENDERER_BRIDGE_QUERY_KEYS) {
    const responsePrefix = `${RENDERER_BRIDGE_QUERY_CALLBACK_PREFIX}${queryKey}${queryKey}`;
    if (!name.startsWith(responsePrefix)) continue;

    const requestIdSuffix = name.slice(responsePrefix.length);
    return BRIDGE_REQUEST_ID_SUFFIX_PATTERN.test(requestIdSuffix) ? queryKey : null;
  }

  return null;
}

/**
 * File/Directory selection events
 * 用于 WebUI 模式下的文件选择请求
 */
export const SHOW_OPEN_REQUEST_EVENT = 'show-open-request';
