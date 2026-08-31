/**
 * Playwright + Electron test fixtures.
 *
 * Launches the Electron app once and shares the window across tests.
 *
 * Two modes:
 *   1. **Packaged mode** (CI default): Launches from electron-builder's unpacked output
 *      (e.g. out/linux-unpacked/weprompt, out/mac-arm64/WePrompt.app, out/win-unpacked/WePrompt.exe).
 *      This validates that packaged resources are intact.
 *   2. **Dev mode** (local default): Launches the compiled Electron app via `electron .`
 *      from the project root and resolves a local aioncore binary explicitly.
 *
 * Set `E2E_PACKAGED=1` to force packaged mode, or `E2E_DEV=1` to force dev mode.
 */
import { test as base, expect, type ElectronApplication, type Page, type TestInfo } from '@playwright/test';
import { _electron as electron } from 'playwright';
import path from 'path';
import fs from 'fs';
import os from 'os';

type Fixtures = {
  electronApp: ElectronApplication;
  page: Page;
};

type WorkerFixtures = {
  e2eWorkerCleanup: void;
};

type RendererDiagnostic = {
  type: 'console' | 'pageerror' | 'requestfailed';
  text: string;
};

type MainProcessDiagnostic = {
  stream: 'stdout' | 'stderr';
  text: string;
};

// Singleton – one app per test worker
let app: ElectronApplication | null = null;
let mainPage: Page | null = null;
const projectRoot = path.resolve(__dirname, '../..');
const e2eStateSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aionui-e2e-state-'));
const e2eStateFile = path.join(e2eStateSandboxDir, 'extension-states.json');
const e2eUserDataSandboxDir = path.join(e2eStateSandboxDir, 'user-data');
fs.mkdirSync(e2eUserDataSandboxDir, { recursive: true });
const rendererDiagnostics = new WeakMap<Page, RendererDiagnostic[]>();
const mainProcessDiagnostics: MainProcessDiagnostic[] = [];

function attachMainProcessDiagnostics(electronApp: ElectronApplication): void {
  mainProcessDiagnostics.length = 0;
  const child = electronApp.process();
  const capture = (stream: MainProcessDiagnostic['stream'], chunk: unknown): void => {
    mainProcessDiagnostics.push({ stream, text: String(chunk) });
    if (mainProcessDiagnostics.length > 200) mainProcessDiagnostics.splice(0, mainProcessDiagnostics.length - 200);
  };
  child.stdout?.on('data', (chunk: unknown) => capture('stdout', chunk));
  child.stderr?.on('data', (chunk: unknown) => capture('stderr', chunk));
}

function isDevToolsWindow(page: Page): boolean {
  return page.url().startsWith('devtools://');
}

function attachRendererDiagnostics(page: Page): void {
  if (rendererDiagnostics.has(page)) return;

  const diagnostics: RendererDiagnostic[] = [];
  rendererDiagnostics.set(page, diagnostics);

  page.on('console', (message) => {
    if (!['error', 'warning'].includes(message.type())) return;
    diagnostics.push({ type: 'console', text: `${message.type()}: ${message.text()}` });
  });
  page.on('pageerror', (error) => {
    diagnostics.push({ type: 'pageerror', text: error.stack || error.message });
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? 'unknown';
    diagnostics.push({ type: 'requestfailed', text: `${request.url()} - ${failure}` });
  });
}

async function getRendererReadinessSnapshot(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => {
    const root = document.querySelector('#root');
    const scripts = Array.from(document.scripts)
      .map((script) => script.src || script.getAttribute('src') || '')
      .filter(Boolean);
    const stylesheets = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
      .map((link) => (link as HTMLLinkElement).href || link.getAttribute('href') || '')
      .filter(Boolean);

    return {
      href: window.location.href,
      title: document.title,
      readyState: document.readyState,
      bodyTextLength: document.body?.innerText?.trim().length ?? 0,
      bodyHtmlSample: document.body?.innerHTML?.slice(0, 300) ?? '',
      rootExists: Boolean(root),
      rootChildCount: root?.children.length ?? -1,
      scriptCount: scripts.length,
      stylesheetCount: stylesheets.length,
      scripts,
      stylesheets,
    };
  });
}

async function ensureRendererAppMounted(page: Page): Promise<void> {
  attachRendererDiagnostics(page);
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });

  try {
    await page.waitForFunction(
      () => {
        const root = document.querySelector('#root');
        return Boolean(root && root.children.length > 0 && document.scripts.length > 0);
      },
      undefined,
      { timeout: 30_000 }
    );
  } catch (error) {
    const snapshot = await getRendererReadinessSnapshot(page).catch((snapshotError: unknown) => ({
      snapshotError: snapshotError instanceof Error ? snapshotError.message : String(snapshotError),
    }));
    const diagnostics = rendererDiagnostics.get(page)?.slice(-20) ?? [];
    throw new Error(
      [
        'Electron renderer did not mount a non-empty app root.',
        `Wait failure: ${error instanceof Error ? error.message : String(error)}`,
        `Snapshot: ${JSON.stringify(snapshot, null, 2)}`,
        `Diagnostics: ${JSON.stringify(diagnostics, null, 2)}`,
      ].join('\n'),
      { cause: error }
    );
  }
}

async function resolveMainWindow(electronApp: ElectronApplication): Promise<Page> {
  const existingMainWindow = electronApp.windows().find((win) => !isDevToolsWindow(win));
  if (existingMainWindow) {
    await ensureRendererAppMounted(existingMainWindow);
    return existingMainWindow;
  }

  const resolveWindowBefore = async (deadline: number): Promise<Page> => {
    if (Date.now() >= deadline) {
      throw new Error('Failed to resolve main renderer window (non-DevTools).');
    }

    const win = await electronApp.waitForEvent('window', { timeout: 1_000 }).catch(() => null);
    if (win && !isDevToolsWindow(win)) {
      await ensureRendererAppMounted(win);
      return win;
    }

    return resolveWindowBefore(deadline);
  };

  return resolveWindowBefore(Date.now() + 30_000);
}

/** Resolve the current WePrompt executable from electron-builder's unpacked output. */
function resolvePackagedApp(): { executablePath: string; cwd: string } | null {
  const outDir = path.join(projectRoot, 'out');
  if (!fs.existsSync(outDir)) return null;

  if (process.platform === 'win32') {
    for (const dir of ['win-unpacked', 'win-x64-unpacked', 'win-arm64-unpacked']) {
      const executablePath = path.join(outDir, dir, 'WePrompt.exe');
      if (fs.existsSync(executablePath)) return { executablePath, cwd: path.join(outDir, dir) };
    }
  } else if (process.platform === 'darwin') {
    for (const dir of ['mac-arm64', 'mac-x64', 'mac', 'mac-universal']) {
      const cwd = path.join(outDir, dir);
      if (!fs.existsSync(cwd)) continue;
      const appBundle = fs.readdirSync(cwd).find((file) => file.endsWith('.app'));
      if (!appBundle) continue;
      const executablePath = path.join(cwd, appBundle, 'Contents', 'MacOS', 'WePrompt');
      if (fs.existsSync(executablePath)) return { executablePath, cwd };
    }
  } else {
    for (const dir of ['linux-unpacked', 'linux-x64-unpacked', 'linux-arm64-unpacked']) {
      const cwd = path.join(outDir, dir);
      for (const name of ['weprompt', 'WePrompt']) {
        const executablePath = path.join(cwd, name);
        if (fs.existsSync(executablePath)) return { executablePath, cwd };
      }
    }
  }

  return null;
}

function shouldUsePackagedMode(): boolean {
  if (process.env.E2E_PACKAGED === '1') return true;
  if (process.env.E2E_DEV === '1') return false;
  // Default: packaged in CI, dev locally
  return !!process.env.CI;
}

function backendBinaryName(): string {
  return process.platform === 'win32' ? 'aioncore.exe' : 'aioncore';
}

function resolveDevBackendBinary(): string {
  const binaryName = backendBinaryName();
  const candidates = [
    process.env.AIONUI_BACKEND_BINARY,
    process.env.AIONUI_BACKEND_BIN,
    path.join(projectRoot, '..', 'aionCore', 'target', 'debug', binaryName),
    path.join(projectRoot, '..', 'aionCore', 'target', 'release', binaryName),
    path.join(os.homedir(), '.cargo', 'bin', binaryName),
  ].filter((candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0);

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (resolved) return path.resolve(resolved);

  throw new Error(
    `E2E dev mode: could not find ${binaryName}. Set AIONUI_BACKEND_BINARY, ` +
      `build ../aionCore, or install it under ${path.join(os.homedir(), '.cargo', 'bin')}.`
  );
}

async function launchApp(): Promise<ElectronApplication> {
  const usePackaged = shouldUsePackagedMode();

  const commonEnv = {
    ...process.env,
    AIONUI_EXTENSIONS_PATH: process.env.AIONUI_EXTENSIONS_PATH || path.join(projectRoot, 'examples'),
    AIONUI_EXTENSION_STATES_FILE: process.env.AIONUI_EXTENSION_STATES_FILE || e2eStateFile,
    AIONUI_DISABLE_AUTO_UPDATE: '1',
    AIONUI_DISABLE_DEVTOOLS: '1',
    AIONUI_E2E_TEST: '1',
    AIONUI_E2E_USER_DATA_DIR: process.env.AIONUI_E2E_USER_DATA_DIR || e2eUserDataSandboxDir,
    AIONUI_CDP_PORT: '0',
  };

  if (usePackaged) {
    const packaged = resolvePackagedApp();
    if (!packaged) {
      throw new Error(
        'E2E packaged mode: could not find packaged app under out/. ' +
          'Run `bun run build` or the platform-specific electron-builder command without `--pack-only` first.'
      );
    }

    console.log(`[E2E] Launching PACKAGED app: ${packaged.executablePath}`);

    const launchArgs: string[] = [];
    if (process.env.AIONUI_E2E_STUDIO_FAKE === '1') {
      launchArgs.push(`--user-data-dir=${e2eUserDataSandboxDir}`);
    }
    if (process.platform === 'linux' && process.env.CI) {
      launchArgs.push('--no-sandbox');
    }

    const electronApp = await electron.launch({
      executablePath: packaged.executablePath,
      args: launchArgs,
      cwd: packaged.cwd,
      env: {
        ...commonEnv,
        NODE_ENV: 'production',
      },
      timeout: 60_000,
    });

    attachMainProcessDiagnostics(electronApp);

    return electronApp;
  }

  // Dev mode: launch via electron .
  console.log(`[E2E] Launching DEV app from: ${projectRoot}`);
  const backendBinary = resolveDevBackendBinary();
  const inheritedPath = process.env.PATH ?? process.env.Path ?? '';
  const backendPath = path.dirname(backendBinary);
  console.log(`[E2E] Using DEV backend: ${backendBinary}`);

  const launchArgs = ['.'];
  if (process.platform === 'linux' && process.env.CI) {
    launchArgs.push('--no-sandbox');
  }

  const electronApp = await electron.launch({
    args: launchArgs,
    cwd: projectRoot,
    env: {
      ...commonEnv,
      PATH: [backendPath, inheritedPath].filter(Boolean).join(path.delimiter),
      NODE_ENV: 'development',
    },
    timeout: 60_000,
  });

  attachMainProcessDiagnostics(electronApp);

  return electronApp;
}

let cleanupPromise: Promise<void> | null = null;
function cleanupE2EWorker(): Promise<void> {
  cleanupPromise ??= (async () => {
    if (app) {
      try {
        await app.evaluate(async ({ app: electronApp }) => {
          electronApp.exit(0);
        });
      } catch {
        // ignore: app may already be closed
      }
      await app.close().catch(() => {});
      app = null;
      mainPage = null;
    }
    fs.rmSync(e2eStateSandboxDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  })();

  return cleanupPromise;
}

export const test = base.extend<Fixtures, WorkerFixtures>({
  e2eWorkerCleanup: [
    // eslint-disable-next-line no-empty-pattern
    async ({}, use) => {
      try {
        await use();
      } finally {
        await cleanupE2EWorker();
      }
    },
    { scope: 'worker', auto: true },
  ],

  // eslint-disable-next-line no-empty-pattern
  electronApp: async ({}, use) => {
    if (!app) {
      app = await launchApp();
    }

    // Verify the app process is still alive; relaunch if it crashed
    try {
      await app.evaluate(() => true);
    } catch {
      console.log('[E2E] App process lost – relaunching...');
      app = await launchApp();
      mainPage = null; // force window re-resolution
    }

    await use(app);
  },

  page: async ({ electronApp }, use, testInfo: TestInfo) => {
    if (!mainPage || mainPage.isClosed() || isDevToolsWindow(mainPage)) {
      mainPage = await resolveMainWindow(electronApp);
    }

    // Only wait for DOM when the page is brand-new or was replaced.
    // For an already-resolved page, skip the expensive waitForLoadState
    // to speed up consecutive tests sharing the same window.
    try {
      if (mainPage.url() === 'about:blank' || mainPage.url() === '') {
        await ensureRendererAppMounted(mainPage);
      }
    } catch {
      // Page may have been replaced – resolve again
      mainPage = await resolveMainWindow(electronApp);
    }

    if (mainPage.isClosed()) {
      mainPage = await resolveMainWindow(electronApp);
    }
    await ensureRendererAppMounted(mainPage);
    await use(mainPage);

    // Attach screenshot on failure so it appears in the HTML report.
    // Playwright's built-in `screenshot: 'only-on-failure'` relies on its
    // own `page` fixture, which we override for Electron — so we do it manually.
    if (testInfo.status !== testInfo.expectedStatus && mainPage && !mainPage.isClosed()) {
      if (mainProcessDiagnostics.length > 0) {
        await testInfo.attach('main-process.log', {
          body: Buffer.from(mainProcessDiagnostics.map((entry) => `[${entry.stream}] ${entry.text}`).join(''), 'utf8'),
          contentType: 'text/plain',
        });
      }
      try {
        const screenshot = await mainPage.screenshot();
        await testInfo.attach('screenshot-on-failure', {
          body: screenshot,
          contentType: 'image/png',
        });
      } catch {
        // best-effort: page may have crashed
      }
    }
  },
});

// ── Cleanup ──────────────────────────────────────────────────────────────────
// IMPORTANT: Do NOT use `test.afterAll` here. Playwright runs afterAll at the
// end of **every** test.describe block, which would close and relaunch the
// Electron app between describe blocks — each relaunch costs ~25-30 seconds.
//
// The auto worker fixture above keeps the singleton app alive for the entire
// worker lifetime and guarantees asynchronous cleanup during normal teardown.
// Process handlers remain as a best-effort fallback for unusual termination.
let cleanupRegistered = false;
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;

  // Async cleanup before the worker process exits
  process.on('beforeExit', () => {
    void cleanupE2EWorker();
  });

  // Synchronous fallback for abrupt termination
  process.on('exit', () => {
    try {
      fs.rmSync(e2eStateSandboxDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // best-effort
    }
  });
}

registerCleanup();

export { expect };
