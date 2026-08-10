/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/common/platform/bridge', () => ({
  bridge: {
    buildProvider: vi.fn(() => {
      const handlerMap = new Map<string, Function>();
      return {
        provider: vi.fn((handler: Function) => {
          handlerMap.set('handler', handler);
          return vi.fn();
        }),
        invoke: vi.fn(),
        _getHandler: () => handlerMap.get('handler'),
      };
    }),
    buildRendererQuery: vi.fn(() => ({
      provider: vi.fn(),
      invoke: vi.fn(),
    })),
    buildEmitter: vi.fn(() => ({
      emit: vi.fn(),
      on: vi.fn(),
    })),
  },
}));

vi.mock('electron', () => ({
  app: {
    getVersion: vi.fn(() => '1.0.0'),
    getPath: vi.fn(() => '/test/path'),
    exit: vi.fn(),
    isPackaged: true,
  },
  autoUpdater: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}));

vi.mock('electron-updater', () => ({
  autoUpdater: {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: false,
    allowDowngrade: false,
    setFeedURL: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdatesAndNotify: vi.fn(),
  },
}));

vi.mock('electron-log', () => ({
  default: {
    transports: { file: { level: 'info' } },
    debug: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

const originalEnvironment = {
  WEPROMPT_UPDATE_BASE_URL: process.env.WEPROMPT_UPDATE_BASE_URL,
  AIONUI_DISABLE_AUTO_UPDATE: process.env.AIONUI_DISABLE_AUTO_UPDATE,
  AIONUI_E2E_TEST: process.env.AIONUI_E2E_TEST,
  CI: process.env.CI,
  GITHUB_ACTIONS: process.env.GITHUB_ACTIONS,
};

const restoreEnvironment = () => {
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
};

beforeEach(() => {
  process.env.WEPROMPT_UPDATE_BASE_URL = 'https://updates.weprompt.test/releases';
  delete process.env.AIONUI_DISABLE_AUTO_UPDATE;
  delete process.env.AIONUI_E2E_TEST;
  delete process.env.CI;
  delete process.env.GITHUB_ACTIONS;
});

afterEach(() => {
  restoreEnvironment();
});

const getCheckHandler = async ({ initialize = true }: { initialize?: boolean } = {}) => {
  vi.resetModules();
  const { autoUpdaterService } = await import('@process/services/update/autoUpdaterService');
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  autoUpdaterService.resetForTest();
  if (initialize) autoUpdaterService.initialize();
  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.update.check.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('update.check handler not registered');
  return lastCall[0];
};

const getAutoUpdateQuitAndInstallHandler = async () => {
  const { initUpdateBridge } = await import('@process/bridge/updateBridge');
  const { ipcBridge } = await import('@/common');

  initUpdateBridge();

  const provider = vi.mocked(ipcBridge.autoUpdate.quitAndInstall.provider);
  const lastCall = provider.mock.calls.at(-1);
  if (!lastCall) throw new Error('autoUpdate.quitAndInstall handler not registered');
  return lastCall[0];
};

const makeDeferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe('updateBridge configured feed checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps updater metadata without consulting a public repository API', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    try {
      const handler = await getCheckHandler();
      const { autoUpdater } = await import('electron-updater');
      vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
        isUpdateAvailable: true,
        updateInfo: {
          version: '1.9.22',
          releaseDate: '2026-04-29T00:00:00Z',
          releaseNotes: 'release notes',
          files: [],
          path: '',
          sha512: '',
        },
      });
      const result = await handler({});

      expect(result.success).toBe(true);
      expect(result.data?.currentVersion).toBe('1.0.0');
      expect(result.data?.updateAvailable).toBe(true);
      expect(result.data?.latest).toMatchObject({
        version: '1.9.22',
        body: 'release notes',
        htmlUrl: '',
        assets: [],
      });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('initializes the updater service before the first configured feed check', async () => {
    const handler = await getCheckHandler({ initialize: false });
    const { autoUpdater } = await import('electron-updater');
    const { autoUpdaterService } = await import('@process/services/update/autoUpdaterService');
    vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: {
        version: '1.0.0',
        files: [],
        path: '',
        sha512: '',
      },
    });

    await expect(handler({})).resolves.toMatchObject({
      success: true,
      data: { currentVersion: '1.0.0', updateAvailable: false },
    });
    expect(autoUpdaterService.isInitialized).toBe(true);
  });
});

describe('updateBridge product-owned download containment', () => {
  it('accepts URLs below the configured update base', async () => {
    vi.resetModules();
    vi.clearAllMocks();

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-length': '0' }),
      body: {
        getReader: () => ({
          read: async () => ({ done: true, value: undefined }),
        }),
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    try {
      const { initUpdateBridge } = await import('@process/bridge/updateBridge');
      const { ipcBridge } = await import('@/common');

      initUpdateBridge();

      const provider = vi.mocked(ipcBridge.update.download.provider);
      const lastCall = provider.mock.calls.at(-1);
      if (!lastCall) throw new Error('update.download handler not registered');
      const handler = lastCall[0];

      const result = await handler({
        downloadId: 'manual-download-1',
        url: 'https://updates.weprompt.test/releases/1.9.22/WePrompt-1.9.22-mac-arm64.dmg',
        file_name: 'WePrompt-1.9.22-mac-arm64.dmg',
      });

      expect(result.success).toBe(true);
      expect(result.data?.downloadId).toBe('manual-download-1');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    'https://evil.example.com/fake.dmg',
    'https://updates.weprompt.test/private/fake.dmg',
    'https://static.aionui.com/releases/fake.dmg',
    'https://updates.weprompt.test/releases/%2e%2e%2fprivate/fake.dmg',
    'https://updates.weprompt.test/releases/%2e%2e%5cprivate/fake.dmg',
    'https://updates.weprompt.test/releases/%252e%252e%252fprivate/fake.dmg',
  ])('rejects URLs outside the configured update base: %s', async (url) => {
    vi.resetModules();
    vi.clearAllMocks();

    const { initUpdateBridge } = await import('@process/bridge/updateBridge');
    const { ipcBridge } = await import('@/common');

    initUpdateBridge();

    const provider = vi.mocked(ipcBridge.update.download.provider);
    const lastCall = provider.mock.calls.at(-1);
    if (!lastCall) throw new Error('update.download handler not registered');
    const handler = lastCall[0];

    const result = await handler({
      url,
      file_name: 'fake.dmg',
    });

    // Download is refused before any network I/O; exact error text comes from i18n and isn't asserted here.
    expect(result.success).toBe(false);
  });
});

describe('autoUpdate quitAndInstall lifecycle', () => {
  const originalPlatform = process.platform;

  const setPlatform = (platform: NodeJS.Platform): void => {
    Object.defineProperty(process, 'platform', {
      configurable: true,
      value: platform,
    });
  };

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useFakeTimers();
    setPlatform('win32');
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    setPlatform(originalPlatform);
  });

  it('waits for the pre-install cleanup before starting the installer', async () => {
    const cleanup = makeDeferred();
    const { autoUpdaterService } = await import('@process/services/update/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => cleanup.promise);

    const installPromise = autoUpdaterService.quitAndInstall();
    await Promise.resolve();

    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();

    cleanup.resolve();
    await installPromise;

    expect(autoUpdater.quitAndInstall).toHaveBeenCalledWith(false, true);
  });

  it('does not start the installer when the pre-install cleanup fails', async () => {
    const cleanupError = new Error('backend did not stop');
    const { autoUpdaterService } = await import('@process/services/update/autoUpdaterService');
    const { autoUpdater } = await import('electron-updater');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => {
      throw cleanupError;
    });

    await expect(autoUpdaterService.quitAndInstall()).rejects.toThrow('backend did not stop');
    expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled();
  });

  it('keeps the IPC request pending until quitAndInstall cleanup completes', async () => {
    const cleanup = makeDeferred();
    const { autoUpdaterService } = await import('@process/services/update/autoUpdaterService');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => cleanup.promise);

    const handler = await getAutoUpdateQuitAndInstallHandler();
    let handlerSettled = false;
    const handlerPromise = handler().then(() => {
      handlerSettled = true;
    });

    await Promise.resolve();

    expect(handlerSettled).toBe(false);

    cleanup.resolve();
    await handlerPromise;

    expect(handlerSettled).toBe(true);
  });

  it('propagates quitAndInstall failures through IPC', async () => {
    const cleanupError = new Error('native readiness failed');
    const { autoUpdaterService } = await import('@process/services/update/autoUpdaterService');

    autoUpdaterService.resetForTest();
    autoUpdaterService.setBeforeQuitAndInstall(async () => {
      throw cleanupError;
    });

    const handler = await getAutoUpdateQuitAndInstallHandler();

    await expect(handler()).rejects.toThrow('native readiness failed');
  });
});
