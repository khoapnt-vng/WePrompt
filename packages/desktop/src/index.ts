/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// configureChromium sets app name (dev isolation) and Chromium flags — must run before
// ANY module that calls app.getPath('userData'), because Electron caches the path on first call.
import './process/utils/configureChromium';
import { installGpuCrashHandler } from './process/utils/gpuRecovery';
import { captureBackendStartupFailure, initSentry, scheduleStartupLogReport, setSentryDeviceId } from './sentry';

initSentry();

import './process/utils/configureConsoleLog';
import { app, BrowserWindow, dialog, ipcMain, nativeImage, powerMonitor, protocol, session, shell } from 'electron';
import fixPath from 'fix-path';
import * as fs from 'fs';
import * as path from 'path';
import WebSocket from 'ws';
import { MainBackendHttpError, mainHttpRequest, withLocalTokenHeaders } from './common/adapter/httpBridge';
import { initMainAdapterWithWindow } from './common/adapter/main';
import { CREATIVE_STUDIO_ENABLED, DESKTOP_PET_ENABLED, PRESENTATION_RUN_V2_ENABLED } from './common/config/constants';
import { isUpdateFeatureEnabled } from './common/update/updatePolicy';
import { ipcBridge } from './common';
import { initializeProcess } from './process';
import { registerCreativeStudioScheme } from './process/services/creative-studio/mediaProtocol';
import {
  disposeCreativeStudioRuntime,
  getCreativeStudioRuntime,
  resumeCreativeStudioAfterBackendReady,
} from './process/services/creative-studio/runtime';
import { startBackendOrExit } from './process/startup/backendStartup';
import { assertStartupArchitectureCompatible } from './process/startup/architectureCompatibility';
import { classifyBackendStartupFailure } from './process/startup/backendStartupFailure';
import { installLocalBackendAuth } from './process/startup/localBackendAuth';
import { installQuitCleanup } from './process/startup/quitCleanup';
import {
  createRendererDocumentPolicy,
  isAuthorizedRendererSender,
  isTrustedRendererDocument,
} from './process/startup/rendererDocumentPolicy';
import { shouldRegisterBackendStartup } from './process/startup/singleInstanceGating';
import { ProcessConfig } from './process/utils/initStorage';
import type { BackendStartupFailureInfo } from './common/types/platform/electron';
import { registerWindowMaximizeListeners } from '@process/bridge';
import { BackendLifecycleManager } from '@aionui/web-host';
import { resolveBinaryPath } from '@process/backend';
import { installSessionMcpTrustKeyProvider } from '@process/backend/sessionMcpTrust';
import { initializeFeedbackBridge } from './process/bridge/feedbackBridge';
import {
  createCreativeStudioCloseHandshake,
  type CreativeStudioCloseHandshake,
} from './process/bridge/creativeStudioBridge';
import { wasLaunchedAtLogin } from '@process/bridge/applicationBridge';
import { onLanguageChanged } from './process/bridge/native/systemSettingsBridge';
import i18n, { setInitialLanguage } from '@process/services/i18n';
import { appOperationsBroker } from '@process/services/app-operations';
import { installOfficePreviewSession } from '@process/services/office-artifact/officePreviewSession';
import {
  createOfficeCliRunner,
  disposeOfficeArtifactService,
  inspectPptxOoxml,
  PresentationReadinessService,
} from '@process/services/office-artifact';
import {
  createPresentationRuntimeLifecycleOwner,
  PresentationRunLifecycleCoordinator,
  PresentationRuntimeEventClient,
} from '@process/services/presentation-template';
import {
  getPresentationRunLifecycleGraph,
  setPresentationRunLifecycleCoordinator,
} from '@process/services/presentation-template/bridge';
import { setupApplicationMenu } from './process/utils/appMenu';
import { startWebHost } from '@aionui/web-host';
import { initializeZoomFactor, setupZoomForWindow } from './process/utils/zoom';
import { hydrateWindowsProcessPath } from './process/startup/windowsPath';
import {
  MIN_WINDOW_WIDTH,
  MIN_WINDOW_HEIGHT,
  attachWindowBoundsPersistence,
  loadSavedWindowBounds,
  resolveInitialBounds,
} from './process/utils/windowBounds';
import {
  clearPendingDeepLinkUrl,
  getPendingDeepLinkUrl,
  handleDeepLinkUrl,
  PROTOCOL_SCHEME,
} from './process/utils/deepLink';
import {
  bindMainWindowReferences,
  showAndFocusMainWindow,
  showOrCreateMainWindow,
} from './process/utils/mainWindowLifecycle';
import {
  loadUserWebUIConfig,
  resolveElectronRemoteAccessRequestSources,
  resolveWebUIPort,
  restoreDesktopWebUIFromPreferences,
  warnUnsupportedDesktopRemoteAccess,
} from './process/utils/webuiConfig';
import {
  createOrUpdateTray,
  destroyTray,
  getCloseToTrayEnabled,
  getIsQuitting,
  refreshTrayMenu,
  setCloseToTrayEnabled,
  setIsQuitting,
} from './process/utils/tray';
import { readCloseToTraySetting } from './process/utils/closeToTraySetting';
// @ts-expect-error - electron-squirrel-startup doesn't have types
import electronSquirrelStartup from 'electron-squirrel-startup';

// Privileges are accepted only before Electron reaches its ready lifecycle.
registerCreativeStudioScheme(protocol);

const rendererDirectory = path.join(__dirname, '../renderer');
const fallbackRendererFile = path.join(rendererDirectory, 'index.html');
const rendererDocumentPolicy = createRendererDocumentPolicy({
  isPackaged: app.isPackaged,
  rendererDirectory,
  rendererUrl: process.env['ELECTRON_RENDERER_URL'],
});

// ============ Single Instance Lock ============
// Acquire lock early so the second instance quits before doing unnecessary work.
// When a second instance starts (e.g. from protocol URL), it sends its data
// to the first instance via second-instance event, then quits.
const isE2ETestMode = process.env.AIONUI_E2E_TEST === '1';
const skipSingleInstanceLock = isE2ETestMode || process.env.AIONUI_MULTI_INSTANCE === '1';
const deepLinkFromArgv = process.argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
const gotTheLock = skipSingleInstanceLock ? true : app.requestSingleInstanceLock({ deepLinkUrl: deepLinkFromArgv });
if (!gotTheLock) {
  console.warn('[AionUi] Another instance is already running; current process will exit.');
  app.quit();
} else {
  app.on('second-instance', (_event, argv, _workingDirectory, additionalData) => {
    // Prefer additionalData (reliable on all platforms), fallback to argv scan
    const deepLinkUrl =
      (additionalData as { deepLinkUrl?: string })?.deepLinkUrl ||
      argv.find((arg) => arg.startsWith(`${PROTOCOL_SCHEME}://`));
    if (deepLinkUrl) {
      handleDeepLinkUrl(deepLinkUrl);
    }
    // Focus existing window or recreate one if needed.
    if (isWebUIMode || isResetPasswordMode) {
      return;
    }

    // Skip window creation if app hasn't finished initializing
    if (!appReadyDone) return;

    if (app.isReady()) {
      showOrCreateMainWindow({
        mainWindow,
        createWindow: () => {
          console.log('[AionUi] second-instance received with no active main window, recreating main window');
          createWindow();
        },
      });
    }
  });
}

// Align GUI-launched PATH with what local CLIs expect on each desktop OS.
if (process.platform === 'darwin' || process.platform === 'linux') {
  fixPath();

  // Supplement nvm paths that fix-path might miss (nvm is often only in .zshrc, not .zshenv)
  const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '', '.nvm');
  const nvmVersionsDir = path.join(nvmDir, 'versions', 'node');
  if (fs.existsSync(nvmVersionsDir)) {
    try {
      const versions = fs.readdirSync(nvmVersionsDir);
      const nvmPaths = versions.map((v) => path.join(nvmVersionsDir, v, 'bin')).filter((p) => fs.existsSync(p));
      if (nvmPaths.length > 0) {
        const currentPath = process.env.PATH || '';
        const missingPaths = nvmPaths.filter((p) => !currentPath.includes(p));
        if (missingPaths.length > 0) {
          process.env.PATH = [...missingPaths, currentPath].join(path.delimiter);
        }
      }
    } catch {
      // Ignore errors when reading nvm directory
    }
  }
} else if (process.platform === 'win32') {
  hydrateWindowsProcessPath();
}

// Handle Squirrel startup events (Windows installer)
if (electronSquirrelStartup) {
  app.quit();
}

// Global error handlers for main process
// Sentry automatically captures these, but we keep the handlers to prevent Electron's default error dialog
process.on('uncaughtException', (_error) => {
  // Sentry captures this automatically
});

process.on('unhandledRejection', (_reason, _promise) => {
  // Sentry captures this automatically
});

const hasSwitch = (flag: string) => process.argv.includes(`--${flag}`) || app.commandLine.hasSwitch(flag);
const getSwitchValue = (flag: string): string | undefined => {
  const withEqualsPrefix = `--${flag}=`;
  const equalsArg = process.argv.find((arg) => arg.startsWith(withEqualsPrefix));
  if (equalsArg) {
    return equalsArg.slice(withEqualsPrefix.length);
  }

  const argIndex = process.argv.indexOf(`--${flag}`);
  if (argIndex !== -1) {
    const nextArg = process.argv[argIndex + 1];
    if (nextArg && !nextArg.startsWith('--')) {
      return nextArg;
    }
  }

  const cliValue = app.commandLine.getSwitchValue(flag);
  return cliValue || undefined;
};
const hasCommand = (cmd: string) => process.argv.includes(cmd);

const isWebUIMode = hasSwitch('webui');
const isResetPasswordMode = hasCommand('--resetpass');
const isVersionMode = hasCommand('--version') || hasCommand('-v');

// Flag to distinguish intentional quit from unexpected exit in WebUI mode
let isExplicitQuit = false;

// Guard against premature window creation (e.g. macOS 'activate' firing during init).
// The activate event fires on first launch before handleAppReady finishes initializeProcess(),
// causing the renderer to load and compete with initStorage on the serial configFile queue,
// which blocks startup for 100-265 seconds.
let appReadyDone = false;

let mainWindow: BrowserWindow;
let creativeStudioCloseHandshake: CreativeStudioCloseHandshake | null = null;
const backendManager = new BackendLifecycleManager(
  {
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.getPath('userData'),
  },
  () => resolveBinaryPath({ allowEnvironmentOverride: !app.isPackaged })
);
installSessionMcpTrustKeyProvider(() => backendManager.sessionMcpTrustKey);

const isPresentationBackendRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const presentationConversationPath = (conversationId: string): string =>
  `/api/conversations/${encodeURIComponent(conversationId)}`;

const createPresentationRunLifecycleCoordinator = (): PresentationRunLifecycleCoordinator => {
  const graph = getPresentationRunLifecycleGraph();
  if (graph === null) throw new Error('Presentation run lifecycle graph is unavailable');

  const readinessRunner = createOfficeCliRunner();
  let coordinator: PresentationRunLifecycleCoordinator | null = null;
  const eventClient = new PresentationRuntimeEventClient({
    createSocket: (url, options) => new WebSocket(url, options),
    onTerminalEvent: (event, authority) =>
      coordinator === null ? Promise.resolve('forged' as const) : coordinator.handleTerminalEvent(event, authority),
    diagnostic: (code) => console.warn(`[AionUi][presentation-runtime] ${code}`),
  });

  coordinator = new PresentationRunLifecycleCoordinator({
    store: graph.store,
    files: graph.files,
    eventClient,
    getPreparedRun: async (runId) => {
      const prepared = await graph.run.getPreparedRun(runId);
      if (prepared === null) throw new Error('Presentation run preparation is unavailable');
      return prepared;
    },
    preflightDispatch: async (credentials, conversationId, runtime) => {
      try {
        const conversation = await mainHttpRequest<unknown>({
          ...credentials,
          method: 'GET',
          path: presentationConversationPath(conversationId),
        });
        if (
          !isPresentationBackendRecord(conversation) ||
          conversation['id'] !== conversationId ||
          conversation['type'] !== runtime
        ) {
          return { ok: false, kind: 'hard' } as const;
        }
        const observed = conversation['runtime'];
        if (
          !isPresentationBackendRecord(observed) ||
          observed['state'] !== 'idle' ||
          observed['can_send_message'] !== true ||
          observed['has_task'] !== false ||
          observed['is_processing'] !== false ||
          observed['pending_confirmations'] !== 0 ||
          observed['turn_id'] !== null ||
          ('task_status' in observed && observed['task_status'] !== 'finished')
        ) {
          return { ok: false, kind: 'transient', retryAfterMs: 1_000 } as const;
        }
        return { ok: true } as const;
      } catch (error) {
        if (
          error instanceof MainBackendHttpError &&
          (error.status === 401 || error.status === 403 || error.status === 404)
        ) {
          return { ok: false, kind: 'hard' } as const;
        }
        return { ok: false, kind: 'transient', retryAfterMs: 1_000 } as const;
      }
    },
    postInitialMessage: (credentials, request) =>
      mainHttpRequest({
        ...credentials,
        method: 'POST',
        path: `${presentationConversationPath(request.conversationId)}/messages`,
        body: {
          content: request.content,
          files: request.files,
          inject_skills: request.injectSkills,
        },
      }),
    observeRuntime: async (credentials, conversationId, options) => {
      const conversation = await mainHttpRequest<unknown>({
        ...credentials,
        method: 'GET',
        path: presentationConversationPath(conversationId),
        signal: options?.signal,
      });
      return isPresentationBackendRecord(conversation) ? (conversation['runtime'] ?? null) : null;
    },
    inspectReadiness: (request, workspace) =>
      new PresentationReadinessService({
        runner: readinessRunner,
        inspectOoxml: inspectPptxOoxml,
        createInspectionWorkspace: async () => workspace,
      }).inspect(request),
    isFeatureEnabled: () => PRESENTATION_RUN_V2_ENABLED,
  });
  setPresentationRunLifecycleCoordinator(coordinator);
  return coordinator;
};

const presentationRuntimeLifecycleOwner = createPresentationRuntimeLifecycleOwner({
  createCoordinator: createPresentationRunLifecycleCoordinator,
});

async function stopBackendWithPresentationRuntimeLifecycle(): Promise<void> {
  try {
    await presentationRuntimeLifecycleOwner.dispose();
  } finally {
    setPresentationRunLifecycleCoordinator(null);
    await backendManager.stop();
  }
}

let disposeCronResumeListener: (() => void) | null = null;

// Flag tracking whether the backend subprocess started successfully. Read by
// the deferred runBackendMigrations trigger in createWindow().
let backendStartedOk = false;
let backendStartupFailed = false;
let backendStartupFailureInfo: BackendStartupFailureInfo | null = null;
let rendererInitialLanguage: string | null = null;
let backendMigrationsScheduled = false;
let ensureAdminUserPromise: Promise<void> | null = null;

ipcMain.on('get-backend-port', (event) => {
  event.returnValue = backendManager.port;
});

// The `--local` backend skips JWT verification, so this per-launch secret is the
// only thing separating the app's own renderer from any other page or process
// that reaches the loopback port. Handed out over the preload bridge only.
ipcMain.on('get-backend-local-token', (event) => {
  const boundWebContents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!isAuthorizedRendererSender(event, boundWebContents, rendererDocumentPolicy.mainWindowDocuments)) {
    console.warn('[AionUi][security] Denied backend local token request from an untrusted renderer document');
    event.returnValue = '';
    return;
  }
  event.returnValue = backendManager.localToken;
});

ipcMain.on('get-initial-language', (event) => {
  event.returnValue = rendererInitialLanguage;
});

ipcMain.on('get-backend-startup-failed', (event) => {
  event.returnValue = backendStartupFailed;
});

ipcMain.on('get-backend-startup-failure', (event) => {
  event.returnValue = backendStartupFailureInfo;
});

ipcMain.handle('backend:recover-corrupted-database', async () => {
  const { recoverCorruptedDatabaseAfterUserConfirmation } = await import('./process/startup/recoverCorruptedDatabase');

  await recoverCorruptedDatabaseAfterUserConfirmation({
    getFailure: () => backendStartupFailureInfo,
    stopBackend: stopBackendWithPresentationRuntimeLifecycle,
    startBackendWithRecovery: async () => {
      try {
        const { getDataPath } = await import('./process/utils/utils');
        const { getSystemDir } = await import('./process/utils/initStorage');
        const sysDir = getSystemDir();
        return await backendManager.start(
          getDataPath(),
          sysDir.logDir,
          {
            cacheDir: sysDir.cacheDir,
            workDir: sysDir.workDir,
            logDir: sysDir.logDir,
          },
          {
            allowPendingOnHealthTimeout: false,
            onHealthTimeout: async (error) => {
              markBackendStartupFailed(error);
              await captureBackendStartupFailure(error);
            },
            onPendingExit: async (error) => {
              markBackendStartupFailed(error);
              await captureBackendStartupFailure(error);
            },
            onReady: (backendPort) => {
              markBackendReady(backendPort, 'backendManager.recoverCorruptedDatabase.lateReady');
            },
            allowedOrigins: rendererAllowedOrigins(),
          },
          undefined,
          { recoverCorruptedDatabase: true }
        );
      } catch (error) {
        markBackendStartupFailed(error);
        await captureBackendStartupFailure(error);
        throw error;
      }
    },
    markReady: markBackendReady,
    reloadMainWindow: () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.reload();
      }
    },
    logInfo: console.info,
    logWarn: console.warn,
  });
});

function markBackendStartupFailed(error: unknown): void {
  backendStartupFailed = true;
  backendStartupFailureInfo = classifyBackendStartupFailure(error);
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
}

function registerCronResumeBridge(backendPort: number): void {
  disposeCronResumeListener?.();

  const onResume = () => {
    void fetch(`http://127.0.0.1:${backendPort}/api/cron/internal/system-resume`, {
      method: 'POST',
      headers: withLocalTokenHeaders({
        'x-aionui-internal': '1',
      }),
    }).catch((error) => {
      console.error('[AionUi] Failed to notify backend about system resume:', error);
    });
  };

  powerMonitor.on('resume', onResume);
  disposeCronResumeListener = () => {
    powerMonitor.removeListener('resume', onResume);
  };
}

/**
 * Run one-shot backend migrations after the renderer has loaded. Some steps
 * (ConfigStorage.get, ipcBridge.listProviders) route through the renderer via
 * BroadcastChannel, so invoking them before the renderer exists deadlocks the
 * main process. Called from did-finish-load.
 */
const scheduleBackendMigrations = (): void => {
  if (backendMigrationsScheduled || !backendStartedOk) return;
  backendMigrationsScheduled = true;
  void (async () => {
    try {
      const { runBackendMigrations } = await import('./process/utils/runBackendMigrations');
      await runBackendMigrations(ProcessConfig);
      console.info('[AionUi] runBackendMigrations completed');
    } catch (error) {
      console.error('[AionUi] Backend migration hook threw:', error);
    }
  })();
};

/**
 * Browser origins allowed to call the local backend.
 *
 * A packaged renderer is loaded with `loadFile`, so its requests carry
 * `Origin: null` — that literal is what the backend's allow-list has to match.
 * In dev the renderer is served by vite and gets a real origin, so add that too.
 * Anything not listed here cannot read a local-mode response.
 */
function rendererAllowedOrigins(): string[] {
  const origins = ['null'];
  const devUrl = rendererDocumentPolicy.developmentRendererUrl;
  if (devUrl) {
    try {
      origins.push(new URL(devUrl).origin);
    } catch {
      console.warn(`[AionUi] ignoring malformed ELECTRON_RENDERER_URL: ${devUrl}`);
    }
  }
  return origins;
}

function exposeBackendPort(backendPort: number): void {
  // Expose the backend port to main-process callers of httpBridge (e.g. the
  // one-shot assistant migration hook below). Must land BEFORE any
  // ipcBridge.* invoke from the main process — the renderer side reads
  // window.__backendPort via preload, but main has no `window`.
  (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort = backendPort;
  // Same reason, for the local-mode secret: main-process callers reach the
  // backend through httpBridge too, and it reads the token from globalThis when
  // there is no `window`.
  (globalThis as typeof globalThis & { __backendLocalToken?: string }).__backendLocalToken = backendManager.localToken;
}

function installLocalBackendAuthForMainWindow(backendPort: number): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  installLocalBackendAuth(session.defaultSession, mainWindow.webContents, backendPort, backendManager.localToken);
}

function ensureAdminUserOnce(backendPort: number): Promise<void> {
  if (!ensureAdminUserPromise) {
    ensureAdminUserPromise = (async () => {
      try {
        const { ensureAdminUser } = await import('./process/utils/ensureAdminUser');
        await ensureAdminUser(backendPort);
      } catch (err) {
        console.error('[WebUI] ensureAdminUser failed:', err);
      }
    })();
  }
  return ensureAdminUserPromise;
}

function markBackendReady(backendPort: number, source: string): void {
  console.log(`[AionUi] ${source} ready (port=${backendPort})`);
  exposeBackendPort(backendPort);
  installLocalBackendAuthForMainWindow(backendPort);
  void presentationRuntimeLifecycleOwner
    .backendReady({ port: backendPort, token: backendManager.localToken })
    .catch(() => console.warn('[AionUi][presentation-runtime] LIFECYCLE_START_FAILED'));
  // Runs on every backend-ready, like the presentation lifecycle above, so an
  // interrupted job resumes after a reconnect and not only on first start. Gated:
  // with Creative Studio disabled this must not resume paid provider work.
  if (CREATIVE_STUDIO_ENABLED && !isWebUIMode && !isResetPasswordMode) {
    resumeCreativeStudioAfterBackendReady(getCreativeStudioRuntime());
  }
  if (backendStartedOk) return;
  registerCronResumeBridge(backendPort);
  backendStartedOk = true;
  backendStartupFailed = false;
  backendStartupFailureInfo = null;
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = false;
  void ensureAdminUserOnce(backendPort);
  scheduleBackendMigrations();
}

function resolveDebugBackendStartupFailure(): BackendStartupFailureInfo | null {
  const reason = process.env.AIONUI_DEBUG_BACKEND_STARTUP_FAILURE as BackendStartupFailureInfo['reason'] | undefined;
  if (!reason) {
    return null;
  }
  if ((app.isPackaged && !isE2ETestMode) || isWebUIMode || isResetPasswordMode) {
    console.warn('[AionUi] Ignoring AIONUI_DEBUG_BACKEND_STARTUP_FAILURE outside desktop dev/e2e mode.');
    return null;
  }

  if (reason === 'backend_incompatible_runtime') {
    return { reason, runtime: 'glibc', requiredVersions: ['2.28'] };
  }
  if (reason === 'backend_package_architecture_mismatch') {
    return {
      reason,
      deviceArch: process.arch === 'arm64' ? 'arm64' : 'x64',
      expectedDownloadArch: process.arch === 'arm64' ? 'arm64' : 'x64',
      packageArch: process.arch === 'arm64' ? 'x64' : 'arm64',
    };
  }
  if (reason === 'backend_startup_failed') {
    return {
      reason,
      backendBoundaryCode: 'E2E_DEBUG_BACKEND_STARTUP_FAILURE',
      backendBoundaryStage: 'debug_injection',
    };
  }
  if (reason === 'backend_incomplete_installation') {
    return {
      reason,
      incompleteInstallationKind: 'missing_directory_resources',
      missingRuntimeDir: true,
      missingResources: ['managed node runtime', 'ACP adapters'],
    };
  }
  if (reason === 'backend_database_lineage_incompatible') {
    return {
      reason,
      backendBoundaryCode: 'BOOTSTRAP_DATA_INIT_FAILED',
      backendBoundaryStage: 'database.migration_lineage',
      lineageReason: 'changed',
      appliedVersion: 20,
      floorVersion: 19,
      latestVersion: 27,
      expectedFingerprint: '7ab8e15a44ab55603a32038ae20c38eff5c18ca4d5c2cc23c00f3fa868727999',
      actualFingerprint: 'e2e-debug-lineage-mismatch',
    };
  }

  console.warn(`[AionUi] Ignoring unknown AIONUI_DEBUG_BACKEND_STARTUP_FAILURE value: ${reason}`);
  return null;
}

function applyDebugBackendStartupFailure(failure: BackendStartupFailureInfo): void {
  backendStartupFailed = true;
  backendStartupFailureInfo = failure;
  (globalThis as typeof globalThis & { __backendStartupFailed?: boolean }).__backendStartupFailed = true;
}

// ============ Renderer navigation allowlist ============
// The renderer is loaded from one of the exact application documents resolved
// at startup. Pet windows have their own checked-in documents. Top-level
// BrowserWindow contents must never navigate to a sibling local file or an
// arbitrary loopback page just because its protocol or host looks familiar.
//
// NOTE: this list intentionally governs only top-level `window`-type contents.
// The <webview> guest contents (HTML preview, external OAuth/settings pages)
// are meant to browse arbitrary URLs and are handled separately — see
// installWebContentsSecurity() below, which does NOT block guest navigation.
const isAllowedTopLevelNavigation = (targetUrl: string): boolean => {
  return isTrustedRendererDocument(targetUrl, rendererDocumentPolicy.topLevelDocuments);
};

// ============ web-contents-created security guard (Task 1.5 / #2b) ============
// Defense-in-depth in the main process: even if the renderer is compromised it
// cannot escalate by attaching a privileged <webview>, navigating the app shell
// to attacker content, or spawning a new Electron window. Installed once from
// the app-ready path (see handleAppReady) so it covers every WebContents the
// app ever creates (main window, pet windows, and their <webview> guests).
const installWebContentsSecurity = (): void => {
  app.on('web-contents-created', (_event, contents) => {
    // Harden any <webview> the renderer attaches: strip its preload and force
    // an unprivileged, isolated, sandboxed guest. The app's own <webview>
    // usage (HTML preview, external pages) never sets a preload, so this is a
    // no-op for legitimate use and closes the injected-<webview> escalation.
    // NOTE: this only hardens the guest's *privileges*; it intentionally does
    // NOT vet the guest's `src` / navigation destination. Restricting where a
    // guest may go is delegated to the app's own webview usage and is fenced
    // separately (the `will-navigate` guard below applies to `window` contents,
    // not guests — guests are meant to browse arbitrary content). Do not assume
    // this is where guest destinations are restricted.
    contents.on('will-attach-webview', (_attachEvent, webPreferences, _params) => {
      // No preload allowlist exists today; strip unconditionally.
      delete webPreferences.preload;
      webPreferences.nodeIntegration = false;
      webPreferences.contextIsolation = true;
      webPreferences.sandbox = true;
    });

    // Block top-level navigation away from the app shell. Only applies to
    // `window`-type contents (main + pet windows); <webview> guests are meant
    // to browse arbitrary content, so their navigation is left untouched.
    const enforceTopLevelDocumentPolicy = (navigationEvent: Electron.Event, targetUrl: string) => {
      if (contents.getType() !== 'window') {
        return;
      }
      if (!isAllowedTopLevelNavigation(targetUrl)) {
        console.warn(`[AionUi][security] Blocked top-level navigation to: ${targetUrl}`);
        navigationEvent.preventDefault();
      }
    };
    contents.on('will-navigate', enforceTopLevelDocumentPolicy);
    contents.on('will-redirect', (redirectEvent, targetUrl, _isInPlace, isMainFrame) => {
      if (isMainFrame) {
        enforceTopLevelDocumentPolicy(redirectEvent, targetUrl);
      }
    });

    // Never let content open a new Electron window. External http(s) links are
    // handed to the OS browser (preserving legitimate external-link behavior);
    // everything else is denied. Note the renderer normally routes external
    // links through the backend (ipcBridge.shell.openExternal); this handler is
    // the safety net for any raw window.open / target=_blank that reaches here.
    // Non-http(s) schemes — including conventionally-safe `mailto:` / `tel:` —
    // are deliberately denied for now (the app has no such links today). If
    // mail/tel links are ever added to the UI, allowlist those schemes here so
    // they too are passed to shell.openExternal.
    contents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        void shell.openExternal(url).catch((error) => {
          console.error('[AionUi][security] shell.openExternal failed:', error);
        });
      } else {
        console.warn(`[AionUi][security] Denied window.open for non-http(s) URL: ${url}`);
      }
      return { action: 'deny' };
    });
  });
};

// ============ Content-Security-Policy (Task 1.6b / #2) ============
// Applied as **Content-Security-Policy-Report-Only** — it REPORTS violations to
// the DevTools console but does NOT block anything, so it cannot white-screen
// the renderer. This is deliberate: the CSP below is grounded in code evidence
// (see comments per directive) but CANNOT be runtime-verified in this
// environment. A human must promote it to the enforcing `Content-Security-Policy`
// header only after launching the app, exercising the main flows + HTML preview
// + charts/markdown (mermaid, katex, syntax highlighting, web-tree-sitter WASM),
// reading the reported violations, and confirming the policy is complete.
//
// ⚠️ SHARED-SESSION CAVEAT — READ BEFORE PROMOTING TO ENFORCING ⚠️
// This header is installed on `session.defaultSession`, which is SHARED with
// partition-less <webview> guests — specifically `URLViewer` (arbitrary remote
// URL preview) and `OfficeWatchViewer` (local office server), both of which
// render <WebviewHost> WITHOUT a `partition` and therefore inherit
// defaultSession. In Report-Only this is harmless (nothing is blocked). But
// this app-shell CSP is authored for the app's OWN content ('self'); imposing
// it on arbitrary external / office guest pages will very likely BREAK them
// (their inline scripts and remote connect-src targets are not covered by
// 'self'). Therefore, BEFORE renaming the header to the enforcing
// `Content-Security-Policy`, the maintainer MUST do ONE of:
//   (a) scope the header to the app-shell/main-frame document only — e.g. gate
//       the onHeadersReceived callback so it only adds CSP to the app's own
//       document requests, not to guest (webview) page loads; OR
//   (b) move every external/remote webview onto a DEDICATED `partition` (a
//       separate session that this defaultSession policy does not touch), so
//       the app-shell CSP never applies to guest pages.
// (Extension-settings webviews already use `persist:ext-settings-*` partitions
// and are unaffected; only the two partition-less viewers above are at risk.)
//
// Directive rationale (desktop Electron renderer, loaded from file:// or the
// Vite dev server):
//   default-src 'self'                     — baseline; app shell is same-origin.
//   script-src 'self' 'wasm-unsafe-eval'   — web-tree-sitter loads WASM; mermaid
//     'unsafe-eval'                            historically evaluates code. Dev
//                                              server also needs eval for HMR.
//   style-src 'self' 'unsafe-inline'       — Arco Design + UnoCSS inject inline
//                                              <style>/style attributes at runtime.
//   img-src 'self' data: blob:            — icons/data-URIs; blob: from
//                                              URL.createObjectURL previews.
//   font-src 'self' data:                  — bundled fonts / data-URI fonts.
//   connect-src 'self' http://127.0.0.1:*  — httpBridge fetches the local backend
//     http://localhost:* ws://127.0.0.1:*    at http://127.0.0.1:<dynamic port>
//     ws://localhost:*                       and the ws://.../ws realtime channel;
//                                              dev/HMR uses localhost. Ports are
//                                              runtime-assigned → wildcard port.
//   worker-src 'self' blob:                — workers spawned from blob URLs.
//   object-src 'none'; frame-src 'self'    — lock down plugins/embedding.
const CSP_DIRECTIVES = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: weprompt-studio:",
  "media-src 'self' weprompt-studio:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'self'",
].join('; ');

const installContentSecurityPolicy = (): void => {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        // Report-Only for now — see block comment above. Promote to
        // 'Content-Security-Policy' after human runtime verification.
        'Content-Security-Policy-Report-Only': [CSP_DIRECTIVES],
      },
    });
  });
};

const createWindow = ({ showOnReady = true }: { showOnReady?: boolean } = {}): void => {
  console.log('[AionUi] Creating main window...');
  const { x: windowX, y: windowY, width: windowWidth, height: windowHeight } = resolveInitialBounds();

  // Get app icon for development mode (Windows/Linux need icon in BrowserWindow)
  // In production, icons are set via forge.config.ts packagerConfig
  let devIcon: Electron.NativeImage | undefined;
  if (!app.isPackaged) {
    try {
      // Windows: app.ico (no dev version), Linux: app_dev.png (with padding)
      const iconFile = process.platform === 'win32' ? 'app.ico' : 'app_dev.png';
      const iconPath = path.join(process.cwd(), 'resources', iconFile);
      if (fs.existsSync(iconPath)) {
        devIcon = nativeImage.createFromPath(iconPath);
        if (devIcon.isEmpty()) devIcon = undefined;
      }
    } catch {
      // Ignore icon loading errors in development
    }
  }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    ...(windowX !== undefined && windowY !== undefined ? { x: windowX, y: windowY } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    show: false, // Hide until CSS is loaded to prevent FOUC
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    // Set icon for Windows/Linux in development mode
    ...(devIcon && process.platform !== 'darwin' ? { icon: devIcon } : {}),
    // Custom titlebar configuration / 自定义标题栏配置
    ...(process.platform === 'darwin'
      ? {
          titleBarStyle: 'hidden',
          // Align traffic-light vertical center with the titlebar button centers.
          // Titlebar is 45px; buttons are 36px flex-centered → button center y≈22.5.
          // Empirically y=13 places the traffic lights on the same horizontal line
          // as the sidebar / back / forward icons.
          // NOTE: requires a full app restart to take effect (BrowserWindow option).
          trafficLightPosition: { x: 10, y: 13 },
        }
      : { frame: false }),
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      webviewTag: true, // 启用 webview 标签用于 HTML 预览 / Enable webview tag for HTML preview
      // Explicit security posture (was relying on Electron 37 defaults).
      // contextIsolation + nodeIntegration:false are already the effective defaults
      // → adding them is zero behavior change. sandbox:true is verified safe here:
      // the preload (src/preload/main.ts) only uses contextBridge/ipcRenderer/webUtils
      // plus the bundled @sentry/electron/preload, none of which require Node built-ins.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  console.log(`[AionUi] Main window created (id=${mainWindow.id})`);
  const backendPort = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
  if (backendPort) installLocalBackendAuthForMainWindow(backendPort);

  scheduleStartupLogReport(mainWindow);

  // Show window after content is ready to prevent FOUC (Flash of Unstyled Content)
  // Use 'ready-to-show' which fires when renderer has painted first frame,
  // combined with 'did-finish-load' as belt-and-suspenders approach.
  if (showOnReady) {
    const showWindow = () => {
      if (!mainWindow.isDestroyed() && !mainWindow.isVisible()) {
        console.log('[AionUi] Showing main window');
        mainWindow.show();
        mainWindow.focus();
      }
    };
    mainWindow.once('ready-to-show', () => {
      console.log('[AionUi] Window ready-to-show');
      showWindow();
    });
    // Belt-and-suspenders: also show on did-finish-load in case ready-to-show already fired
    mainWindow.webContents.once('did-finish-load', () => {
      console.log('[AionUi] Renderer did-finish-load');
      showWindow();
      scheduleBackendMigrations();
    });
    // Fallback: show window after 5s even if events don't fire (e.g. loadURL failure)
    setTimeout(showWindow, 5000);
  } else if (process.platform === 'darwin' && app.dock) {
    void app.dock.hide();
  }

  // Define renderer documents once so loading and privileged feedback IPC use
  // the same exact application-document paths. URL hashes are handled by the
  // bridge because client-side routing may change them after load.
  const rendererUrl = rendererDocumentPolicy.developmentRendererUrl;

  initMainAdapterWithWindow(mainWindow);
  const studioWindow = mainWindow;
  const closeHandshake = createCreativeStudioCloseHandshake({
    getCurrentUrl: () =>
      studioWindow.isDestroyed() || studioWindow.webContents.isDestroyed() ? '' : studioWindow.webContents.getURL(),
    queryUnsavedWork: (options) => ipcBridge.creativeStudio.hasUnsavedWork.invoke(options),
    flushUnsavedWork: (options) => ipcBridge.creativeStudio.flushUnsavedWork.invoke(options),
    showMessageBox: (options) => dialog.showMessageBox(studioWindow, options),
    translate: (key, options) => i18n.t(key, options ?? {}),
    closeWindow: () => {
      if (!studioWindow.isDestroyed()) studioWindow.close();
    },
    hideWindow: () => {
      if (!studioWindow.isDestroyed()) studioWindow.hide();
    },
    quitApp: () => app.quit(),
    onQuitCancelled: () => setIsQuitting(false),
  });
  creativeStudioCloseHandshake = closeHandshake;
  bindMainWindowReferences(mainWindow);
  initializeFeedbackBridge(mainWindow, rendererDocumentPolicy.mainWindowDocuments);

  setupApplicationMenu();

  setupZoomForWindow(mainWindow);
  registerWindowMaximizeListeners(mainWindow);
  attachWindowBoundsPersistence(mainWindow, (bounds) => ProcessConfig.set('window.bounds', bounds));

  // Initialize auto-updater service (skip when disabled via env, e.g. E2E / CI)
  // 初始化自动更新服务（通过环境变量禁用时跳过，例如 E2E / CI 场景）
  if (isUpdateFeatureEnabled()) {
    Promise.all([import('./process/services/update/autoUpdaterService'), import('./process/bridge/updateBridge')])
      .then(([{ autoUpdaterService }, { createAutoUpdateStatusBroadcast }]) => {
        // Create status broadcast callback that emits via ipcBridge (pure emitter, no window binding)
        const statusBroadcast = createAutoUpdateStatusBroadcast();
        autoUpdaterService.initialize(statusBroadcast);
        autoUpdaterService.setBeforeQuitAndInstall(async () => {
          await stopBackendWithPresentationRuntimeLifecycle();
        });
        // Check for updates after 3 seconds delay
        // 3秒后检查更新
        setTimeout(() => {
          void autoUpdaterService.checkForUpdatesAndNotify();
        }, 3000);
      })
      .catch((error) => {
        console.error('[App] Failed to initialize autoUpdaterService:', error);
      });
  } else {
    console.log('[AionUi] Auto-updater disabled by release policy or env/CI guard');
  }

  // Load the renderer: dev server URL in development, built HTML file in production
  if (!app.isPackaged && rendererUrl) {
    console.log(`[AionUi] Loading renderer URL: ${rendererUrl}`);
    mainWindow.loadURL(rendererUrl).catch((error) => {
      console.error('[AionUi] loadURL failed, falling back to file:', error.message || error);
      mainWindow.loadFile(fallbackRendererFile).catch((e2) => {
        console.error('[AionUi] loadFile fallback also failed:', e2.message || e2);
      });
    });
  } else {
    console.log(`[AionUi] Loading renderer file: ${fallbackRendererFile}`);
    mainWindow.loadFile(fallbackRendererFile).catch((error) => {
      console.error('[AionUi] loadFile failed:', error.message || error);
    });
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    console.error('[AionUi] did-fail-load:', { errorCode, errorDescription, validatedURL, isMainFrame });
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error('[AionUi] render-process-gone:', details);

    // Reload the renderer to recover from the crash.
    // The isDestroyed() guard in adapter/main.ts prevents further sends
    // to the dead webContents while the reload is in progress.
    if (!mainWindow.isDestroyed()) {
      console.log('[AionUi] Attempting to recover from renderer crash by reloading...');

      if (!app.isPackaged && rendererUrl) {
        mainWindow.loadURL(rendererUrl).catch((error) => {
          console.error('[AionUi] Recovery loadURL failed:', error.message || error);
        });
      } else {
        mainWindow.loadFile(fallbackRendererFile).catch((error) => {
          console.error('[AionUi] Recovery loadFile failed:', error.message || error);
        });
      }
    }
  });

  mainWindow.webContents.on('unresponsive', () => {
    console.warn('[AionUi] Renderer became unresponsive');
  });

  mainWindow.on('closed', () => {
    console.log('[AionUi] Main window closed');
    if (creativeStudioCloseHandshake === closeHandshake) creativeStudioCloseHandshake = null;
  });

  // DevTools is no longer auto-opened at startup.
  // Use the DevTools toggle in Settings > System (dev mode only) to open it.

  // Listen to DevTools state changes and notify Renderer
  mainWindow.webContents.on('devtools-opened', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: true });
  });

  mainWindow.webContents.on('devtools-closed', () => {
    ipcBridge.application.devToolsStateChanged.emit({ isOpen: false });
  });

  // 关闭拦截：当启用"关闭到托盘"时，隐藏窗口而非关闭
  // Close interception: hide window instead of closing when "close to tray" is enabled
  mainWindow.on('close', (event) => {
    if (mainWindow.isDestroyed()) return;
    if (getCloseToTrayEnabled() && !getIsQuitting()) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    closeHandshake.handleWindowClose(event);
  });
};

const handleAppReady = async (): Promise<void> => {
  const t0 = performance.now();
  const mark = (label: string) => console.log(`[AionUi:ready] ${label} +${Math.round(performance.now() - t0)}ms`);
  mark('start');

  // Install main-process security guards before any WebContents is created or
  // any content is loaded, so they cover the very first renderer load.
  installWebContentsSecurity();
  installContentSecurityPolicy();
  installOfficePreviewSession();
  mark('installSecurityGuards');

  if (!app.isPackaged) {
    try {
      const { default: installExtension, REACT_DEVELOPER_TOOLS } = await import('electron-devtools-installer');
      await installExtension(REACT_DEVELOPER_TOOLS);
      console.log('[DevTools] React Developer Tools installed');
    } catch (e) {
      console.warn('[DevTools] Failed to install React DevTools:', e);
    }
  }

  // CLI mode: print app version and exit immediately (used by CI smoke tests)
  if (isVersionMode) {
    console.log(app.getVersion());
    app.exit(0);
    return;
  }

  // Set dock icon in development mode on macOS
  // In production, the icon is set via forge.config.ts packagerConfig.icon
  if (process.platform === 'darwin' && !app.isPackaged && app.dock) {
    try {
      const iconPath = path.join(process.cwd(), 'resources', 'app_dev.png');
      if (fs.existsSync(iconPath)) {
        const icon = nativeImage.createFromPath(iconPath);
        if (!icon.isEmpty()) {
          app.dock.setIcon(icon);
        }
      }
    } catch {
      // Ignore dock icon errors in development
    }
  }

  setSentryDeviceId();

  try {
    await initializeProcess();
    if (CREATIVE_STUDIO_ENABLED && !isWebUIMode && !isResetPasswordMode) {
      await getCreativeStudioRuntime().start();
    }
    rendererInitialLanguage = ProcessConfig.getSync('language') ?? null;
    mark('initializeProcess');
  } catch (error) {
    console.error('Failed to initialize process:', error);
    app.exit(1);
    return;
  }

  const debugBackendStartupFailure = resolveDebugBackendStartupFailure();
  if (debugBackendStartupFailure) {
    applyDebugBackendStartupFailure(debugBackendStartupFailure);
    mark(`debugBackendStartupFailure:${debugBackendStartupFailure.reason}`);
  } else {
    // Start aioncore only after initializeProcess(). initStorage may open
    // the legacy Electron SQLite catalog for a one-shot v26 migration and must
    // close it before the backend touches the same file.
    const backendStartup = await startBackendOrExit({
      startBackend: async () => {
        assertStartupArchitectureCompatible({
          arch: process.arch,
          isPackaged: app.isPackaged,
          platform: process.platform,
        });
        const { getDataPath } = await import('./process/utils/utils');
        const { getSystemDir } = await import('./process/utils/initStorage');
        const sysDir = getSystemDir();
        return backendManager.start(
          getDataPath(),
          sysDir.logDir,
          {
            cacheDir: sysDir.cacheDir,
            workDir: sysDir.workDir,
            logDir: sysDir.logDir,
          },
          {
            allowPendingOnHealthTimeout: !(isWebUIMode || isResetPasswordMode),
            onHealthTimeout: async (error) => {
              markBackendStartupFailed(error);
              await captureBackendStartupFailure(error);
            },
            onPendingExit: async (error) => {
              markBackendStartupFailed(error);
              await captureBackendStartupFailure(error);
            },
            onReady: (backendPort) => {
              markBackendReady(backendPort, 'backendManager.lateReady');
            },
            allowedOrigins: rendererAllowedOrigins(),
          }
        );
      },
      onStarted: (backendPort) => {
        exposeBackendPort(backendPort);
        if (backendManager.status === 'running') {
          markBackendReady(backendPort, 'backendManager.start');
          return;
        }
        mark(`backendManager.start pending health (port=${backendPort})`);
      },
      captureFailure: async (error) => {
        markBackendStartupFailed(error);
        await captureBackendStartupFailure(error);
      },
      exitApp: (code) => app.exit(code),
      exitOnFailure: isWebUIMode || isResetPasswordMode,
      logError: console.error,
    });
    if (!backendStartup.ok) {
      if (isWebUIMode || isResetPasswordMode) {
        return;
      }
    }

    // One-shot WebUI admin credential migration. Must run after the backend is
    // up (__backendPort set) and before any mode branch below that might log the
    // user in. Swallows its own errors; the next boot retries.
    const bootBackendPort = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
    if (backendStartedOk && bootBackendPort) {
      await ensureAdminUserOnce(bootBackendPort);
    }
  }

  // One-shot backend migrations are deferred until after the renderer finishes
  // loading. Some migration steps (ConfigStorage.get, ipcBridge.listProviders)
  // route through the renderer via BroadcastChannel; running them here would
  // deadlock because the renderer does not exist yet. See scheduleBackendMigrations().

  try {
    initializeZoomFactor(await ProcessConfig.get('ui.zoomFactor'));
    mark('initializeZoomFactor');
  } catch (error) {
    console.error('[AionUi] Failed to restore zoom factor:', error);
    initializeZoomFactor(undefined);
  }

  try {
    loadSavedWindowBounds(await ProcessConfig.get('window.bounds'));
    mark('restoreWindowBounds');
  } catch (error) {
    console.error('[AionUi] Failed to restore window bounds:', error);
    loadSavedWindowBounds(undefined);
  }

  if (isResetPasswordMode) {
    // Handle password reset without creating window
    try {
      const { resetPasswordCLI, resolveResetPasswordUsername } = await import('./process/utils/resetPasswordCLI');
      const username = resolveResetPasswordUsername(process.argv);

      await resetPasswordCLI(username);

      app.quit();
    } catch {
      app.exit(1);
    }
  } else if (isWebUIMode) {
    const userConfigInfo = loadUserWebUIConfig();
    if (userConfigInfo.exists && userConfigInfo.path) {
      // Config file loaded from user directory
    }
    const resolvedPort = resolveWebUIPort(userConfigInfo.config, getSwitchValue);
    const remoteAccessRequests = resolveElectronRemoteAccessRequestSources(
      userConfigInfo.config,
      hasSwitch('remote'),
      getSwitchValue('remote')
    );
    warnUnsupportedDesktopRemoteAccess(remoteAccessRequests);
    try {
      // Inside Electron (`AionUi --webui` or packaged `aionui-web` mode that
      // launches via the Electron shell), reuse the desktop app's data-dir so
      // that conversations / cron jobs created in any path show up everywhere.
      // Matches the desktop IPC path at line 493 above.
      const { getDataPath } = await import('./process/utils/utils');
      const { getSystemDir } = await import('./process/utils/initStorage');
      const sysDirWebUI = getSystemDir();
      // M6: Switch to @aionui/web-host
      const handle = await startWebHost({
        app: {
          version: app.getVersion(),
          isPackaged: app.isPackaged,
          resourcesPath: app.getAppPath(),
          // Same reason as dataDir below: webui.config.json must live next to
          // the DB under the CLI-safe symlink path, so every password-change
          // entry point (CLI --resetpass, settings-toggle IPC, browser login)
          // reads the same file.
          userDataPath: getDataPath(),
        },
        staticDir: path.join(__dirname, '../renderer'),
        port: resolvedPort,
        // Forge desktop-only (D1) — ignore any resolved remote flag
        allowRemote: false,
        dataDir: getDataPath(),
        logDir: sysDirWebUI.logDir,
        // Expose the same AIONUI_{CACHE,WORK,LOG}_DIR env the desktop IPC path
        // passes at line 493, so /api/system/info reports the symlink workDir
        // instead of the path-with-spaces userData root.
        dirs: {
          cacheDir: sysDirWebUI.cacheDir,
          workDir: sysDirWebUI.workDir,
          logDir: sysDirWebUI.logDir,
        },
        backend: {
          kind: 'useExistingBackend',
          port: (() => {
            // Reuse the backend already spawned by backendManager.start() above.
            // Spawning a second backend here would race the first on SQLite.
            const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
            if (!port) {
              throw new Error('[WebUI] Cannot start: aioncore is not running (globalThis.__backendPort unset)');
            }
            return port;
          })(),
        },
      });
      console.log(`[WebUI] Headless server started (port=${handle.port}, backendPort=${handle.backendPort})`);
    } catch (err) {
      console.error(`[WebUI] Failed to start server on port ${resolvedPort}:`, err);
      app.exit(1);
      return;
    }

    // Keep the process alive in WebUI mode by preventing default quit behavior.
    // On Linux headless (systemd), Electron may attempt to quit when no windows exist.
    app.on('will-quit', (event) => {
      // Only prevent quit if this is an unexpected exit (server still running).
      // Explicit app.exit() calls bypass will-quit, so they are unaffected.
      if (!isExplicitQuit) {
        event.preventDefault();
        console.warn('[WebUI] Prevented unexpected quit — server is still running');
      }
    });
  } else {
    // 初始化关闭到托盘设置 / Initialize close-to-tray setting
    if (isE2ETestMode) {
      setCloseToTrayEnabled(false);
      destroyTray();
    } else {
      try {
        const savedCloseToTray = await readCloseToTraySetting();
        setCloseToTrayEnabled(savedCloseToTray);
        if (getCloseToTrayEnabled()) {
          createOrUpdateTray();
        }
      } catch {
        // Ignore storage read errors, default to false
      }
    }

    const showMainWindowOnReady = !(wasLaunchedAtLogin() && getCloseToTrayEnabled());

    createWindow({ showOnReady: showMainWindowOnReady });
    appReadyDone = true;
    mark('createWindow');

    // Initialize desktop pet (delayed to not block main window).
    // Skipped entirely when the feature flag is off, regardless of stored pet.enabled.
    if (DESKTOP_PET_ENABLED) {
      setTimeout(() => {
        void (async () => {
          try {
            const petEnabled = await ProcessConfig.get('pet.enabled');
            if (petEnabled === true) {
              // Read pet sub-settings before creating the pet so flags are honored
              // on the first createPetWindow() call (which is sync).
              const confirmEnabled = (await ProcessConfig.get('pet.confirmEnabled')) ?? true;
              const { createPetWindow, setPetConfirmEnabled } = await import('./process/pet/petManager');
              setPetConfirmEnabled(confirmEnabled);
              createPetWindow();
            }
          } catch (error) {
            console.error('[Pet] Failed to initialize:', error);
          }
        })();
      }, 3000);
    }

    // 读取语言设置并初始化主进程 i18n，然后刷新托盘菜单
    // Read language setting and initialize main process i18n, then refresh tray menu
    try {
      const savedLanguage = await ProcessConfig.get('language');
      await setInitialLanguage(savedLanguage);
      // After language is set, refresh tray menu if it exists
      await refreshTrayMenu();
    } catch (error) {
      console.error('[index] Failed to initialize i18n language:', error);
    }

    // 监听语言变更，刷新托盘菜单文案 / Listen for language changes to refresh tray menu labels
    onLanguageChanged(() => {
      void refreshTrayMenu();
    });

    if (!isE2ETestMode) {
      // 窗口创建后异步恢复 WebUI，不阻塞 UI / Restore WebUI async after window creation, non-blocking
      restoreDesktopWebUIFromPreferences().catch((error) => {
        console.error('[WebUI] Failed to auto-restore:', error);
      });
    }

    // Flush pending deep-link URL (received before window was ready)
    const pendingUrl = getPendingDeepLinkUrl();
    if (pendingUrl) {
      clearPendingDeepLinkUrl();
      mainWindow.webContents.once('did-finish-load', () => {
        handleDeepLinkUrl(pendingUrl);
      });
    }
  }

  // Verify CDP is ready and log status
  const { cdpPort, verifyCdpReady } = await import('./process/utils/configureChromium');
  if (cdpPort) {
    const cdpReady = await verifyCdpReady(cdpPort);
    if (cdpReady) {
      console.log(`[CDP] Remote debugging server ready at http://127.0.0.1:${cdpPort}`);
      console.log(
        `[CDP] MCP chrome-devtools: npx chrome-devtools-mcp@0.16.0 --browser-url=http://127.0.0.1:${cdpPort}`
      );
    } else {
      console.warn(`[CDP] Warning: Remote debugging port ${cdpPort} not responding`);
    }
  }
};

// ============ Protocol Registration ============
// Register aionui:// as the default protocol client
if (process.defaultApp) {
  // Dev mode: need to pass execPath explicitly
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL_SCHEME);
}

// macOS: handle aionui:// URLs via the open-url event
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleDeepLinkUrl(url);
  if (isWebUIMode || isResetPasswordMode || !app.isReady()) {
    return;
  }
  // Focus existing window so user sees the result
  showOrCreateMainWindow({ mainWindow, createWindow });
});

// 监听 GPU 子进程崩溃，连续多次后下次启动自动关闭硬件加速（参见 ELECTRON-9A / ELECTRON-9D）。
installGpuCrashHandler();

// Register the backend startup flow only when this process owns the single
// instance lock. A lock-losing instance must NOT spawn a competing aioncore
// backend — doing so races the first instance's aioncore over the same data
// directory and produced the "local data repair failed" false alarm
// (Sentry 135525166). Gating here (rather than at the top-level second-instance
// block) keeps it after handleAppReady is declared.
if (shouldRegisterBackendStartup(gotTheLock)) {
  void app
    .whenReady()
    .then(handleAppReady)
    .catch((error) => {
      // App initialization failed
      console.error('[AionUi] App initialization failed:', error);
      app.quit();
    });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  // 当关闭到托盘启用时，不退出应用 / Don't quit when close-to-tray is enabled
  if (getCloseToTrayEnabled()) {
    return;
  }
  // In WebUI mode, don't quit when windows are closed since we're running a web server
  if (!isWebUIMode && process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  // Skip if handleAppReady hasn't finished — it will create the window itself.
  if (!appReadyDone) return;
  if (!isWebUIMode && app.isReady()) {
    if (mainWindow && !mainWindow.isDestroyed()) {
      // 从托盘恢复隐藏的窗口 / Restore hidden window from tray
      showAndFocusMainWindow(mainWindow);
      if (process.platform === 'darwin' && app.dock) {
        void app.dock.show();
      }
    } else {
      createWindow();
    }
  }
});

installQuitCleanup({
  onBeforeQuit: (handler) => app.on('before-quit', (event) => handler(event)),
  beforeCleanup: (event) => creativeStudioCloseHandshake?.handleBeforeQuit(event) ?? false,
  quitApp: () => app.quit(),
  setIsQuitting,
  markExplicitQuit: () => {
    isExplicitQuit = true;
  },
  destroyTray,
  disposeCronResumeListener: () => {
    disposeCronResumeListener?.();
    disposeCronResumeListener = null;
  },
  cancelAppOperations: () => appOperationsBroker.cancelAll(),
  disposeCreativeStudio: disposeCreativeStudioRuntime,
  disposeOfficeArtifacts: disposeOfficeArtifactService,
  // Stop aioncore subprocess — backend shutdown kills all agent children
  // transitively (no separate frontend workerTaskManager remains).
  stopBackend: stopBackendWithPresentationRuntimeLifecycle,
  destroyPetWindow: async () => {
    const { destroyPetWindow } = await import('./process/pet/petManager');
    destroyPetWindow();
  },
  logInfo: console.log,
  logWarn: console.warn,
  logError: console.error,
});

app.on('will-quit', () => {
  console.log('[AionUi] will-quit — all cleanup should be complete');
});

app.on('quit', (_event, exitCode) => {
  console.log(`[AionUi] quit (exitCode=${exitCode})`);
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
