/**
 * Creative Studio schema-5 workspace and native lifecycle smoke.
 *
 * Build the opted-in dev artifacts, then run with the dual-gated fake adapter:
 * AIONUI_ENABLE_CREATIVE_STUDIO=1 bun run package
 * AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/creative-studio.e2e.ts
 */
import { expect, test } from '../../fixtures';
import { navigateTo, ROUTES, takeScreenshot } from '../../helpers';
import type {
  StudioConfirmSubmissionResultV2,
  StudioDirectorOperationV2,
  StudioProjectLoadResultV2,
  StudioProjectListResultV2,
  StudioProjectStatusV2,
  StudioProjectV2,
  StudioRendererPreparedSubmissionOptionsV2,
  StudioRendererProjectCommitResultV2,
  StudioRendererProjectV2,
  StudioRendererExportCatalogV2,
  StudioRendererReferenceGenerationHandoffV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import {
  STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
  STUDIO_PROJECT_SCHEMA_VERSION,
} from '@/common/types/project/creativeStudioTypes';
import { createStudioDirectorCommandWriterV2 } from '@process/resources/builtinMcp/studioDirectorCommandWriter';
import {
  createProposeStoryboardHandlerV2,
  createRequestReferenceImagesHandlerV2,
} from '@process/resources/builtinMcp/studioServer';
import { studioGenerationCompositionDigestV2 } from '@process/services/creative-studio/service/schema2/generation';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

const workspaceSelector = '[data-studio-workspace]';
const projectHeaderSelector = '[data-studio-project-header]';
const viewNavigationSelector = '[data-studio-view-navigation]';
const activeViewSelector = '[data-studio-view]';
const nativeBridgeChannel = 'office-ai-bridge-adapter';
const editProjectCallbackPrefix = 'subscribe.callback-creative-studio.edit-projectcreative-studio.edit-project';
const studioFakeMediaTimeoutMs = 60_000;
const briefAndRulesTitle = 'Film setup';
const studioStorageDirectory = (userDataDirectory: string): string =>
  path.join(userDataDirectory, 'config', 'creative-studio');

const expectProjectConfigurationOutsideActiveView = async (page: Page): Promise<void> => {
  const activeView = page.locator(activeViewSelector);
  await expect(activeView.getByLabel('Project name')).toHaveCount(0);
  await expect(activeView.getByLabel('Project brief')).toHaveCount(0);
  await expect(activeView.getByLabel('Image route')).toHaveCount(0);
  await expect(activeView.getByLabel('Video route')).toHaveCount(0);
  await expect(activeView.getByLabel('Policy currency')).toHaveCount(0);
  await expect(activeView.getByLabel('Rule', { exact: true })).toHaveCount(0);
  await expect(activeView.getByLabel('Project rule drafts (JSON)')).toHaveCount(0);
};

const openStudioProjectDialog = async (page: Page, title: string): Promise<Locator> => {
  const appBar = page.locator('[data-studio-app-bar]');
  const trigger = appBar.getByRole('button', { name: 'More', exact: true });
  await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
  await trigger.click();

  const menu = page.getByRole('menu').filter({ has: page.getByRole('menuitem', { name: title, exact: true }) });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: title, exact: true }).click();

  const dialog = page.getByRole('dialog', { name: title, exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
};

const closeStudioProjectDialog = async (dialog: Locator): Promise<void> => {
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(dialog).toBeHidden();
};

type StudioE2EProviderCallCounts = {
  validateConnection: number;
  submit: number;
  poll: number;
  cancel: number;
};

type StudioE2EProviderRequest = {
  ordinal: number;
  mediaKind: 'image' | 'video';
  model: string;
  prompt: string;
  conditioningAssetIds: string[];
  firstFrameAssetId: string | null;
};

type StudioE2ENativeHarnessPlan = {
  openPaths?: Array<string | null>;
  savePaths?: Array<string | null>;
};

type StudioE2ENativeHarnessSnapshot = {
  openRequestCount: number;
  remainingOpenPaths: number;
  saveRequestCount: number;
  remainingSavePaths: number;
  revealedPaths: string[];
};

const installStudioE2ENativeHarness = async (
  electronApp: ElectronApplication,
  plan: StudioE2ENativeHarnessPlan = {}
): Promise<void> => {
  await electronApp.evaluate(({ dialog, shell }, input) => {
    type HarnessState = StudioE2ENativeHarnessSnapshot & {
      openPaths: Array<string | null>;
      savePaths: Array<string | null>;
    };
    type HarnessGlobal = typeof globalThis & { __studioE2ENativeHarness?: HarnessState };
    const scope = globalThis as HarnessGlobal;
    const state: HarnessState = {
      openPaths: [...(input.openPaths ?? [])],
      savePaths: [...(input.savePaths ?? [])],
      openRequestCount: 0,
      remainingOpenPaths: input.openPaths?.length ?? 0,
      saveRequestCount: 0,
      remainingSavePaths: input.savePaths?.length ?? 0,
      revealedPaths: [],
    };
    scope.__studioE2ENativeHarness = state;

    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => {
        state.openRequestCount += 1;
        const selected = state.openPaths.shift() ?? null;
        state.remainingOpenPaths = state.openPaths.length;
        return selected === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [selected] };
      },
    });
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => {
        state.saveRequestCount += 1;
        const selected = state.savePaths.shift() ?? null;
        state.remainingSavePaths = state.savePaths.length;
        return selected === null ? { canceled: true, filePath: undefined } : { canceled: false, filePath: selected };
      },
    });
    Object.defineProperty(shell, 'showItemInFolder', {
      configurable: true,
      value: (filePath: string) => {
        state.revealedPaths.push(filePath);
      },
    });
  }, plan);
};

const readStudioE2ENativeHarness = async (electronApp: ElectronApplication): Promise<StudioE2ENativeHarnessSnapshot> =>
  electronApp.evaluate(() => {
    type HarnessGlobal = typeof globalThis & {
      __studioE2ENativeHarness?: StudioE2ENativeHarnessSnapshot & {
        openPaths: Array<string | null>;
        savePaths: Array<string | null>;
      };
    };
    const state = (globalThis as HarnessGlobal).__studioE2ENativeHarness;
    if (state === undefined) throw new Error('Creative Studio E2E native harness was unavailable');
    return {
      openRequestCount: state.openRequestCount,
      remainingOpenPaths: state.openPaths.length,
      saveRequestCount: state.saveRequestCount,
      remainingSavePaths: state.savePaths.length,
      revealedPaths: [...state.revealedPaths],
    };
  });

const installEditProjectResponseHold = async (electronApp: ElectronApplication, pageUrl: string): Promise<void> => {
  await electronApp.evaluate(
    ({ BrowserWindow }, input) => {
      type ResponseHoldState = {
        captured: boolean;
        release: () => void;
      };
      type ResponseHoldGlobal = typeof globalThis & {
        __studioE2EEditProjectResponseHold?: ResponseHoldState;
      };
      const scope = globalThis as ResponseHoldGlobal;
      if (scope.__studioE2EEditProjectResponseHold !== undefined) {
        throw new Error('Creative Studio E2E edit-project response hold was already installed');
      }

      const window = BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL() === input.pageUrl
      );
      if (window === undefined || window.webContents.isDestroyed()) {
        throw new Error('Creative Studio E2E main window was unavailable');
      }

      const webContents = window.webContents;
      const ownSendDescriptor = Object.getOwnPropertyDescriptor(webContents, 'send');
      const originalSend = webContents.send;
      let heldResponse: Parameters<typeof webContents.send> | null = null;
      let released = false;
      const state: ResponseHoldState = {
        captured: false,
        release: () => {
          if (released) return;
          released = true;
          if (ownSendDescriptor === undefined) {
            Reflect.deleteProperty(webContents, 'send');
          } else {
            Object.defineProperty(webContents, 'send', ownSendDescriptor);
          }
          if (heldResponse !== null) {
            originalSend.apply(webContents, heldResponse);
            heldResponse = null;
          }
        },
      };

      Object.defineProperty(webContents, 'send', {
        configurable: true,
        value: (...args: Parameters<typeof webContents.send>) => {
          const [channel, serialized] = args;
          if (!state.captured && channel === input.channel && typeof serialized === 'string') {
            let envelope: unknown;
            try {
              envelope = JSON.parse(serialized);
            } catch {
              envelope = null;
            }
            if (
              typeof envelope === 'object' &&
              envelope !== null &&
              'name' in envelope &&
              typeof envelope.name === 'string' &&
              envelope.name.startsWith(input.callbackPrefix)
            ) {
              state.captured = true;
              heldResponse = args;
              return;
            }
          }
          originalSend.apply(webContents, args);
        },
      });
      scope.__studioE2EEditProjectResponseHold = state;
    },
    { callbackPrefix: editProjectCallbackPrefix, channel: nativeBridgeChannel, pageUrl }
  );
};

const hasCapturedEditProjectResponse = async (electronApp: ElectronApplication): Promise<boolean> =>
  electronApp.evaluate(() => {
    type ResponseHoldGlobal = typeof globalThis & {
      __studioE2EEditProjectResponseHold?: { captured: boolean };
    };
    return (globalThis as ResponseHoldGlobal).__studioE2EEditProjectResponseHold?.captured ?? false;
  });

const releaseEditProjectResponseHold = async (electronApp: ElectronApplication): Promise<void> => {
  await electronApp.evaluate(() => {
    type ResponseHoldGlobal = typeof globalThis & {
      __studioE2EEditProjectResponseHold?: { release: () => void };
    };
    const scope = globalThis as ResponseHoldGlobal;
    try {
      scope.__studioE2EEditProjectResponseHold?.release();
    } finally {
      delete scope.__studioE2EEditProjectResponseHold;
    }
  });
};

const readTitleButtonLayout = async (button: Locator) =>
  button.evaluate((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return {
      geometry: {
        height: rect.height,
        width: rect.width,
        x: rect.x,
        y: rect.y,
      },
      padding: {
        bottom: style.paddingBottom,
        left: style.paddingLeft,
        right: style.paddingRight,
        top: style.paddingTop,
      },
      typography: {
        family: style.fontFamily,
        letterSpacing: style.letterSpacing,
        lineHeight: style.lineHeight,
        size: style.fontSize,
        style: style.fontStyle,
        weight: style.fontWeight,
      },
    };
  });

const createPcmWav = (durationSeconds: number): Buffer => {
  const sampleRate = 8_000;
  const channelCount = 1;
  const bitsPerSample = 16;
  const sampleCount = durationSeconds * sampleRate;
  const dataBytes = sampleCount * channelCount * (bitsPerSample / 8);
  const bytes = Buffer.alloc(44 + dataBytes);
  bytes.write('RIFF', 0, 'ascii');
  bytes.writeUInt32LE(36 + dataBytes, 4);
  bytes.write('WAVE', 8, 'ascii');
  bytes.write('fmt ', 12, 'ascii');
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(channelCount, 22);
  bytes.writeUInt32LE(sampleRate, 24);
  bytes.writeUInt32LE(sampleRate * channelCount * (bitsPerSample / 8), 28);
  bytes.writeUInt16LE(channelCount * (bitsPerSample / 8), 32);
  bytes.writeUInt16LE(bitsPerSample, 34);
  bytes.write('data', 36, 'ascii');
  bytes.writeUInt32LE(dataBytes, 40);
  return bytes;
};

const readStudioE2EProviderCallCounts = async (userDataDirectory: string): Promise<StudioE2EProviderCallCounts> => {
  const file = path.join(
    studioStorageDirectory(userDataDirectory),
    '.studio-raw-output-path-sentinel',
    'provider-call-counts.json'
  );
  let stats;
  try {
    stats = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { validateConnection: 0, submit: 0, poll: 0, cancel: 0 };
    }
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Creative Studio E2E provider call counts were unavailable');
  }
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Creative Studio E2E provider call counts were unavailable');
  }
  const record = parsed as Record<string, unknown>;
  const keys = Object.keys(record).toSorted();
  if (
    keys.join('\0') !== ['cancel', 'poll', 'submit', 'validateConnection'].join('\0') ||
    !keys.every((key) => Number.isSafeInteger(record[key]) && (record[key] as number) >= 0)
  ) {
    throw new Error('Creative Studio E2E provider call counts were malformed');
  }
  return {
    validateConnection: record.validateConnection as number,
    submit: record.submit as number,
    poll: record.poll as number,
    cancel: record.cancel as number,
  };
};

const readStudioE2EProviderRequests = async (userDataDirectory: string): Promise<StudioE2EProviderRequest[]> => {
  const file = path.join(
    studioStorageDirectory(userDataDirectory),
    '.studio-raw-output-path-sentinel',
    'provider-requests.json'
  );
  let stats;
  try {
    stats = await lstat(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error('Creative Studio E2E provider request log was unavailable');
  }
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('Creative Studio E2E provider request log was malformed');
  }
  const record = parsed as Record<string, unknown>;
  if (Reflect.ownKeys(record).length !== 2 || record.schemaVersion !== 1 || !Array.isArray(record.requests)) {
    throw new Error('Creative Studio E2E provider request log was malformed');
  }
  const requests = record.requests as unknown[];
  for (const [index, request] of requests.entries()) {
    if (typeof request !== 'object' || request === null || Array.isArray(request)) {
      throw new Error('Creative Studio E2E provider request log was malformed');
    }
    const value = request as Record<string, unknown>;
    if (
      Reflect.ownKeys(value).length !== 6 ||
      value.ordinal !== index + 1 ||
      (value.mediaKind !== 'image' && value.mediaKind !== 'video') ||
      typeof value.model !== 'string' ||
      value.model.length === 0 ||
      typeof value.prompt !== 'string' ||
      value.prompt.length === 0 ||
      !Array.isArray(value.conditioningAssetIds) ||
      !value.conditioningAssetIds.every(
        (assetId) => typeof assetId === 'string' && /^[A-Za-z0-9_-]{1,256}$/.test(assetId)
      ) ||
      (value.firstFrameAssetId !== null &&
        (typeof value.firstFrameAssetId !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(value.firstFrameAssetId)))
    ) {
      throw new Error('Creative Studio E2E provider request log was malformed');
    }
  }
  return requests as StudioE2EProviderRequest[];
};

type StudioBridgeMethod =
  | 'apply-authoring-batch'
  | 'confirm-submission'
  | 'edit-project'
  | 'get-brief-session-server'
  | 'get-project'
  | 'get-project-status'
  | 'list-exports'
  | 'list-projects'
  | 'list-reference-generation-handoffs'
  | 'list-routes'
  | 'prepare-project-references'
  | 'prepare-submission';

async function invokeStudioBridge<T>(
  page: Page,
  method: StudioBridgeMethod,
  data: unknown,
  timeoutMs = 30_000
): Promise<T> {
  const result: unknown = await page.evaluate(
    async ({ requestedMethod, requestedData, requestedTimeoutMs }) => {
      type TestBridgeApi = {
        emit(name: string, data: unknown): Promise<unknown> | void;
        on(callback: (event: { value: string }) => void): () => void;
      };

      const api = window.electronAPI as TestBridgeApi | undefined;
      if (!api) throw new Error('Creative Studio E2E requires the native bridge');

      const requestId = `studio-e2e-${requestedMethod}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const callbackName = `subscribe.callback-creative-studio.${requestedMethod}${requestId}`;
      return new Promise<unknown>((resolve, reject) => {
        let timeout = 0;
        const off = api.on(({ value }) => {
          const event = JSON.parse(value) as { data?: unknown; name?: unknown };
          if (event.name !== callbackName) return;
          window.clearTimeout(timeout);
          off();
          resolve(event.data);
        });
        timeout = window.setTimeout(() => {
          off();
          reject(new Error(`Timed out reading Creative Studio ${requestedMethod} data`));
        }, requestedTimeoutMs);

        Promise.resolve(
          api.emit(`subscribe-creative-studio.${requestedMethod}`, {
            id: requestId,
            data: requestedData,
          })
        ).catch((error: unknown) => {
          window.clearTimeout(timeout);
          off();
          reject(error instanceof Error ? error : new Error(`Creative Studio ${requestedMethod} bridge call failed`));
        });
      });
    },
    { requestedMethod: method, requestedData: data, requestedTimeoutMs: timeoutMs }
  );

  if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true || !('data' in result)) {
    throw new Error(`Creative Studio ${method} bridge data was unavailable: ${JSON.stringify(result)}`);
  }
  return result.data as T;
}

const observeNextStudioBridgeResult = (
  page: Page,
  method: StudioBridgeMethod,
  timeoutMs = 30_000
): { ready: Promise<unknown>; result: Promise<unknown> } => {
  const observerId = `studio-e2e-observer-${method}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const result = page.evaluate(
    ({ requestedMethod, requestedObserverId, requestedTimeoutMs }) => {
      type TestBridgeApi = {
        on(callback: (event: { value: string }) => void): () => void;
      };
      const api = window.electronAPI as TestBridgeApi | undefined;
      if (!api) throw new Error('Creative Studio E2E requires the native bridge');
      const observedWindow = window as typeof window & { __studioE2EBridgeObserverId?: string };
      observedWindow.__studioE2EBridgeObserverId = requestedObserverId;
      return new Promise<unknown>((resolve, reject) => {
        const timeout = window.setTimeout(() => {
          off();
          reject(new Error(`Timed out observing Creative Studio ${requestedMethod} result`));
        }, requestedTimeoutMs);
        const off = api.on(({ value }) => {
          const event = JSON.parse(value) as { data?: unknown; name?: unknown };
          if (
            typeof event.name !== 'string' ||
            !event.name.startsWith(`subscribe.callback-creative-studio.${requestedMethod}`)
          ) {
            return;
          }
          window.clearTimeout(timeout);
          off();
          resolve(event.data);
        });
      });
    },
    { requestedMethod: method, requestedObserverId: observerId, requestedTimeoutMs: timeoutMs }
  );
  const ready = page.waitForFunction(
    (requestedObserverId) =>
      (window as typeof window & { __studioE2EBridgeObserverId?: string }).__studioE2EBridgeObserverId ===
      requestedObserverId,
    observerId
  );
  return { ready, result };
};

const projectIdFromStudioUrl = (page: Page): string => {
  const match = new URL(page.url()).hash.match(/^#\/studio\/([^/]+)(?:\/(?:references|table|board|cut))?$/);
  if (!match?.[1]) throw new Error('Creative Studio route did not contain a project id');
  return decodeURIComponent(match[1]);
};

const readStudioProject = async (page: Page, projectId: string): Promise<StudioRendererProjectV2> => {
  const loaded = await invokeStudioBridge<StudioProjectLoadResultV2>(page, 'get-project', { projectId });
  if (loaded.status !== 'supported') throw new Error(`Creative Studio project ${projectId} was not supported`);
  return loaded.project;
};

const findStudioShotJob = (
  project: StudioRendererProjectV2,
  shotId: string,
  purpose: StudioRendererProjectV2['jobs'][string]['purpose'],
  excludedJobIds?: ReadonlySet<string>
): StudioRendererProjectV2['jobs'][string] | undefined =>
  Object.values(project.jobs).find(
    (job) =>
      (excludedJobIds === undefined || !excludedJobIds.has(job.id)) &&
      job.target.kind === 'shot' &&
      job.target.shotId === shotId &&
      job.purpose === purpose
  );

const findStudioReferenceJob = (
  project: StudioRendererProjectV2,
  referenceId: string
): StudioRendererProjectV2['jobs'][string] | undefined =>
  Object.values(project.jobs).find(
    (job) =>
      job.target.kind === 'reference' && job.target.referenceId === referenceId && job.purpose === 'reference_image'
  );

const readStableStudioProject = async (page: Page, projectId: string): Promise<StudioRendererProjectV2> => {
  let previousRevision: number | null = null;
  let stableReads = 0;
  let stableProject: StudioRendererProjectV2 | null = null;
  await expect
    .poll(
      async () => {
        const project = await readStudioProject(page, projectId);
        if (project.revision === previousRevision) {
          stableReads += 1;
        } else {
          previousRevision = project.revision;
          stableReads = 0;
        }
        stableProject = project;
        return stableReads;
      },
      { intervals: [50, 100, 200, 400], timeout: 15_000 }
    )
    .toBeGreaterThanOrEqual(2);
  if (stableProject === null) throw new Error(`Creative Studio project ${projectId} did not stabilize`);
  return stableProject;
};

const readRawStudioProject = async (userDataDirectory: string, projectId: string): Promise<StudioProjectV2> => {
  const file = path.join(studioStorageDirectory(userDataDirectory), projectId, 'project.json');
  const stats = await lstat(file);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Creative Studio raw project ${projectId} was unavailable`);
  }
  const parsed: unknown = JSON.parse(await readFile(file, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).schemaVersion !== STUDIO_PROJECT_SCHEMA_VERSION ||
    (parsed as Record<string, unknown>).id !== projectId ||
    typeof (parsed as Record<string, unknown>).frameExtractions !== 'object' ||
    (parsed as Record<string, unknown>).frameExtractions === null
  ) {
    throw new Error(`Creative Studio raw project ${projectId} was malformed`);
  }
  return parsed as StudioProjectV2;
};

const readRawStudioProjectBytes = (userDataDirectory: string, projectId: string): Promise<Buffer> =>
  readFile(path.join(studioStorageDirectory(userDataDirectory), projectId, 'project.json'));

const resolveStudioProjectDirectory = async (userDataDirectory: string, projectId: string): Promise<string> =>
  realpath(path.join(studioStorageDirectory(userDataDirectory), projectId));

const applyStudioDirectorOperations = async (
  userDataDirectory: string,
  projectId: string,
  expectedRevision: number,
  commandId: string,
  operations: StudioDirectorOperationV2[]
): Promise<void> => {
  const projectDir = await resolveStudioProjectDirectory(userDataDirectory, projectId);
  const ids = [commandId, `${commandId}_lease`];
  let idIndex = 0;
  const writer = createStudioDirectorCommandWriterV2(
    { projectId, projectDir },
    { createId: () => ids[idIndex++] ?? `${commandId}_extra_${idIndex}` }
  );
  const result = await writer.apply({ expectedRevision, operations });
  expect(result).toMatchObject({
    schemaVersion: STUDIO_DIRECTOR_COMMAND_SCHEMA_VERSION_V2,
    commandId,
    projectId,
    expectedRevision,
    status: 'applied',
  });
};

const writeStudioReferenceRequest = async (
  userDataDirectory: string,
  projectId: string,
  referenceIds: string[]
): Promise<string> => {
  const projectDir = await resolveStudioProjectDirectory(userDataDirectory, projectId);
  const referencePendingDir = path.join(projectDir, 'reference-requests', 'pending');
  const before = new Set(await readdir(referencePendingDir));
  const handler = createRequestReferenceImagesHandlerV2({
    projectId,
    projectDir,
    pendingDir: path.join(projectDir, 'proposals', 'pending'),
    referencePendingDir,
  });
  const exactNewRequestId = async (): Promise<string | null> => {
    const created = (await readdir(referencePendingDir)).filter(
      (entry) => entry.endsWith('.json') && !before.has(entry)
    );
    const exact: string[] = [];
    for (const entry of created) {
      // eslint-disable-next-line no-await-in-loop
      const parsed: unknown = JSON.parse(await readFile(path.join(referencePendingDir, entry), 'utf8'));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) continue;
      const record = parsed as Record<string, unknown>;
      if (
        record.id === entry.slice(0, -'.json'.length) &&
        record.projectId === projectId &&
        record.status === 'pending' &&
        Array.isArray(record.referenceIds) &&
        record.referenceIds.length === referenceIds.length &&
        record.referenceIds.every((referenceId, index) => referenceId === referenceIds[index])
      ) {
        exact.push(record.id as string);
      }
    }
    if (exact.length > 1) throw new Error('Creative Studio reference request writer published duplicate requests');
    return exact[0] ?? null;
  };
  const isRecoverableExclusivePublication = (result: Awaited<ReturnType<typeof handler>>): boolean =>
    result.isError === true &&
    result.content.some(
      (content) => content.type === 'text' && content.text === 'slot write failed: Exclusive publication failed'
    );

  let result = await handler({ referenceIds });
  let requestId = await exactNewRequestId();
  if (result.isError !== true) {
    if (requestId === null) throw new Error('Creative Studio reference request writer did not publish its request');
    return requestId;
  }
  // The cross-process Director writer deliberately fails closed if Main reconciles its exclusive
  // publication mid-flight. An exact canonical record proves the free request committed; otherwise
  // one bounded re-entry lets the writer repair its own recognized slot residue before republishing.
  if (!isRecoverableExclusivePublication(result)) {
    throw new Error(`Creative Studio reference request writer failed: ${JSON.stringify(result.content)}`);
  }
  if (requestId !== null) return requestId;
  result = await handler({ referenceIds });
  requestId = await exactNewRequestId();
  if (requestId !== null) return requestId;
  throw new Error(`Creative Studio reference request writer failed after recovery: ${JSON.stringify(result.content)}`);
};

const writeStudioProposal = async (
  userDataDirectory: string,
  projectId: string,
  baseRevision: number,
  operations: StudioDirectorOperationV2[]
): Promise<string> => {
  const projectDir = await resolveStudioProjectDirectory(userDataDirectory, projectId);
  const pendingDir = path.join(projectDir, 'proposals', 'pending');
  const before = new Set(await readdir(pendingDir));
  const result = await createProposeStoryboardHandlerV2({
    projectId,
    projectDir,
    pendingDir,
    referencePendingDir: path.join(projectDir, 'reference-requests', 'pending'),
  })({ base_revision: baseRevision, operations });
  expect(result.isError).not.toBe(true);
  const created = (await readdir(pendingDir)).filter((entry) => entry.endsWith('.json') && !before.has(entry));
  expect(created).toHaveLength(1);
  return created[0]!.slice(0, -'.json'.length);
};

type StudioNoMutationSnapshot = {
  project: StudioRendererProjectV2;
  rawProjectBytes: Buffer;
  providerCalls: StudioE2EProviderCallCounts;
};

const captureStudioNoMutationSnapshot = async (
  page: Page,
  userDataDirectory: string,
  projectId: string
): Promise<StudioNoMutationSnapshot> => ({
  project: await readStudioProject(page, projectId),
  rawProjectBytes: await readRawStudioProjectBytes(userDataDirectory, projectId),
  providerCalls: await readStudioE2EProviderCallCounts(userDataDirectory),
});

const expectStudioNoMutation = async (
  page: Page,
  userDataDirectory: string,
  projectId: string,
  before: StudioNoMutationSnapshot
): Promise<void> => {
  const after = await captureStudioNoMutationSnapshot(page, userDataDirectory, projectId);
  expect(after.project).toEqual(before.project);
  expect(after.project.bin).toEqual(before.project.bin);
  expect(after.rawProjectBytes).toEqual(before.rawProjectBytes);
  expect(after.providerCalls).toEqual(before.providerCalls);
};

const chooseArcoSelectOption = async (page: Page, label: string, optionText: string): Promise<void> => {
  await page.getByLabel(label, { exact: true }).click();
  const option = page.locator('.arco-select-option:visible').filter({ hasText: optionText });
  await expect(option).toBeVisible();
  await option.dispatchEvent('click');
};

const clearArcoSelect = async (page: Page, label: string): Promise<void> => {
  const select = page
    .getByLabel(label, { exact: true })
    .locator('xpath=ancestor-or-self::*[contains(concat(" ", normalize-space(@class), " "), " arco-select ")][1]');
  await select.hover();
  const clear = select.locator('.arco-select-clear-icon');
  await expect(clear).toHaveCount(1);
  await clear.dispatchEvent('click');
};

type StudioViewportReference = {
  width: number;
  height: number;
  direction: 'ltr' | 'rtl';
  layout: 'columns' | 'stacked';
  screenshotSuffix: string;
  screenshotName: string;
};

const studioViewportReferences = [
  {
    width: 1440,
    height: 900,
    direction: 'ltr',
    layout: 'columns',
    screenshotSuffix: '1440x900-ltr',
    screenshotName: 'creative-studio/gate-3/cut-1440x900-ltr.png',
  },
  {
    width: 1100,
    height: 760,
    direction: 'ltr',
    layout: 'stacked',
    screenshotSuffix: '1100x760-ltr',
    screenshotName: 'creative-studio/gate-3/cut-1100x760-ltr.png',
  },
  {
    width: 760,
    height: 900,
    direction: 'ltr',
    layout: 'stacked',
    screenshotSuffix: '760x900-ltr',
    screenshotName: 'creative-studio/gate-3/cut-760x900-ltr.png',
  },
  {
    width: 760,
    height: 900,
    direction: 'rtl',
    layout: 'stacked',
    screenshotSuffix: '760x900-rtl',
    screenshotName: 'creative-studio/gate-3/cut-760x900-rtl.png',
  },
] as const satisfies readonly StudioViewportReference[];

type CutManagedVideoReference = {
  projectId: string;
  assetId: string;
};

const captureCutViewportReference = async (
  page: Page,
  reference: StudioViewportReference,
  managedVideo: CutManagedVideoReference
): Promise<void> => {
  await page.setViewportSize({ width: reference.width, height: reference.height });
  const root = page.locator('html');
  await root.evaluate((element, direction) => element.setAttribute('dir', direction), reference.direction);
  await expect(root).toHaveAttribute('dir', reference.direction);

  const cutView = page.locator('main[data-studio-view="cut"]');
  const cut = cutView.locator('[data-studio-cut]');
  const cutHeading = cutView.getByRole('heading', { level: 2, name: 'Cut', exact: true });
  await expect(cutHeading).toHaveCount(1);
  await expect(cutHeading).toBeVisible();
  await cutHeading.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await expect(cut).toHaveCSS('direction', reference.direction);
  await expect(cut).toContainText('10s film');
  await expect(cut).toContainText('18s source · fade from 8s to 10s');
  await expect(cut).not.toContainText(/stitched|auto-duck|density/i);

  const hero = cut.locator('[data-cut-hero]');
  const preview = hero.locator('[data-cut-preview]');
  const media = preview.locator('video[data-cut-preview-media][data-media-kind="video"]');
  const transport = hero.locator('[data-cut-transport]');
  const summary = hero.locator(':scope > [data-cut-summary]');
  await expect(hero).toBeVisible();
  await expect(preview).toBeVisible();
  await expect(media).toHaveCount(1);
  await expect(transport).toHaveAttribute('role', 'group');
  await expect(transport).toHaveAccessibleName('Film transport');
  await expect(summary).toBeVisible();
  await expect(summary.locator('[data-cut-film]')).toHaveCount(1);
  await expect(transport.locator('[data-cut-play]')).toHaveAccessibleName('Play film');
  await expect(transport.locator('[data-cut-play]')).toHaveAttribute('aria-pressed', 'false');
  await expect(transport.locator('[data-cut-time]')).toHaveText('0:00 / 0:10');
  await expect(transport.getByText('Picture only — the bed is muted here', { exact: true })).toBeVisible();
  await expect(cut.getByRole('slider', { name: 'Film seek rail' })).toHaveCount(1);
  await expect(cut.locator('[data-cut-seek]')).not.toHaveAttribute('aria-label');
  await expect(cut.locator('[data-cut-previous-join]')).toBeDisabled();
  await expect(cut.locator('[data-cut-next-join]')).toBeDisabled();
  await expect(cut.locator('[data-cut-loop-join]')).toHaveAttribute('aria-pressed', 'false');
  await expect(cut.getByRole('button', { name: 'Open Beat', exact: true })).toBeVisible();
  await expect(cut.locator('audio')).toHaveCount(0);

  const managedVideoUrl = `weprompt-studio://asset/${managedVideo.projectId}/${managedVideo.assetId}`;
  await expect
    .poll(
      async () =>
        media.evaluate((element: HTMLVideoElement) => ({
          controls: element.controls,
          currentSrc: element.currentSrc,
          duration: element.duration,
          muted: element.muted,
          playsInline: element.playsInline,
          ready: element.readyState >= HTMLMediaElement.HAVE_METADATA,
          videoHeight: element.videoHeight,
          videoWidth: element.videoWidth,
        })),
      { timeout: 10_000 }
    )
    .toMatchObject({
      controls: false,
      currentSrc: managedVideoUrl,
      duration: 10,
      // Audible by default: nothing autoplays here, so the constraint that makes muted-by-default
      // correct on the web does not apply. See DEFAULT_STUDIO_PLAYBACK_AUDIO.
      muted: false,
      playsInline: true,
      ready: true,
      videoHeight: 16,
      videoWidth: 16,
    });
  await expect(media).toHaveAccessibleName(
    'Beat 01 · Cut export Beat · Shot 01 · The airplane settles quietly into frame beneath the word LANDING.'
  );

  const heroGeometry = await hero.evaluate((element) => {
    const box = (selector: string) => {
      const target = element.querySelector<HTMLElement>(selector);
      if (target === null) throw new Error(`Cut hero geometry target was unavailable: ${selector}`);
      const { bottom, height, left, right, top, width } = target.getBoundingClientRect();
      return { bottom, height, left, right, top, width };
    };
    const cutContainer = element.closest<HTMLElement>('[data-studio-cut]');
    if (cutContainer === null) throw new Error('Cut hero container was unavailable');
    const heroRect = element.getBoundingClientRect();
    return {
      containerWidth: cutContainer.getBoundingClientRect().width,
      hero: {
        bottom: heroRect.bottom,
        left: heroRect.left,
        right: heroRect.right,
        top: heroRect.top,
        width: heroRect.width,
      },
      heroClientWidth: element.clientWidth,
      heroScrollWidth: element.scrollWidth,
      preview: box('[data-cut-preview]'),
      transport: box('[data-cut-transport]'),
      summary: box('[data-cut-summary]'),
    };
  });
  expect(heroGeometry.heroScrollWidth).toBeLessThanOrEqual(heroGeometry.heroClientWidth + 1);
  expect(heroGeometry.preview.width / heroGeometry.preview.height).toBeCloseTo(16 / 9, 2);
  expect(Math.abs(heroGeometry.preview.left - heroGeometry.transport.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(heroGeometry.preview.right - heroGeometry.transport.right)).toBeLessThanOrEqual(1);
  expect(heroGeometry.preview.bottom).toBeLessThanOrEqual(heroGeometry.transport.top - 6);
  for (const child of [heroGeometry.preview, heroGeometry.transport, heroGeometry.summary]) {
    expect(child.left).toBeGreaterThanOrEqual(heroGeometry.hero.left - 1);
    expect(child.right).toBeLessThanOrEqual(heroGeometry.hero.right + 1);
  }

  const wide = heroGeometry.containerWidth >= 860;
  if (wide) {
    expect(Math.abs(heroGeometry.preview.top - heroGeometry.summary.top)).toBeLessThanOrEqual(1);
    expect(heroGeometry.preview.width / heroGeometry.summary.width).toBeCloseTo(2, 1);
    const [inlineStart, inlineEnd] = [heroGeometry.preview, heroGeometry.summary].toSorted(
      (left, right) => left.left - right.left
    );
    const inlineGap = inlineEnd!.left - inlineStart!.right;
    expect(inlineGap).toBeGreaterThanOrEqual(12);
    expect(inlineGap).toBeLessThanOrEqual(14);
  } else {
    expect(heroGeometry.transport.bottom).toBeLessThanOrEqual(heroGeometry.summary.top - 12);
    expect(Math.abs(heroGeometry.preview.left - heroGeometry.summary.left)).toBeLessThanOrEqual(1);
    expect(Math.abs(heroGeometry.preview.right - heroGeometry.summary.right)).toBeLessThanOrEqual(1);
  }

  const filmstrip = cut.getByRole('list', { name: 'Beats in film order' });
  await expect(filmstrip).toHaveAttribute('data-cut-filmstrip', 'true');
  await expect(filmstrip.locator(':scope > [data-beat-id]')).not.toHaveCount(0);
  await expect(filmstrip.getByRole('button', { name: /(?:move|reorder)/i })).toHaveCount(0);
  const filmstripGeometry = await filmstrip.evaluate((element) => ({
    height: element.getBoundingClientRect().height,
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(filmstripGeometry.height).toBeGreaterThanOrEqual(63);
  expect(filmstripGeometry.height).toBeLessThanOrEqual(65);
  expect(filmstripGeometry.scrollWidth).toBeLessThanOrEqual(filmstripGeometry.clientWidth + 1);
  const seekRailGeometry = await cut.locator('[data-cut-seek-rail]').evaluate((element) => {
    const shell = element.parentElement;
    const strip = element.previousElementSibling;
    if (!(shell instanceof HTMLElement) || !(strip instanceof HTMLElement)) {
      throw new Error('Fused Cut seek geometry was unavailable');
    }
    const railRect = element.getBoundingClientRect();
    const shellRect = shell.getBoundingClientRect();
    const stripRect = strip.getBoundingClientRect();
    return {
      rail: { height: railRect.height, left: railRect.left, right: railRect.right, top: railRect.top },
      shell: { left: shellRect.left, right: shellRect.right },
      strip: { bottom: stripRect.bottom, left: stripRect.left, right: stripRect.right },
    };
  });
  expect(seekRailGeometry.rail.height).toBeGreaterThanOrEqual(17);
  expect(seekRailGeometry.rail.height).toBeLessThanOrEqual(19);
  expect(Math.abs(seekRailGeometry.rail.top - seekRailGeometry.strip.bottom)).toBeLessThanOrEqual(1);
  expect(Math.abs(seekRailGeometry.rail.left - seekRailGeometry.strip.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(seekRailGeometry.rail.right - seekRailGeometry.strip.right)).toBeLessThanOrEqual(1);
  expect(seekRailGeometry.rail.left).toBeGreaterThanOrEqual(seekRailGeometry.shell.left - 1);
  expect(seekRailGeometry.rail.right).toBeLessThanOrEqual(seekRailGeometry.shell.right + 1);

  const bedExtent = cut.locator('[data-cut-bed-extent]');
  await expect(bedExtent).toHaveAttribute('data-source-seconds', '18');
  await expect(bedExtent).toHaveAttribute('data-film-seconds', '10');
  await expect(bedExtent).toContainText('From 0:00 · 18s extent');
  await expect(bedExtent).toContainText('Silent in preview · applied on export');

  const metrics = await cut.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    exportShapes: Array.from(element.querySelectorAll('[data-export-shape]')).map((card) =>
      card.getAttribute('data-export-shape')
    ),
  }));
  expect(metrics).toMatchObject({
    viewportWidth: reference.width,
    viewportHeight: reference.height,
    exportShapes: [],
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);

  const audioPanel = cut.getByRole('heading', { name: 'Audio bed', exact: true }).locator('xpath=ancestor::section[1]');
  const [cutBox, audioBox] = await Promise.all([cut.boundingBox(), audioPanel.boundingBox()]);
  if (cutBox === null || audioBox === null) {
    throw new Error(`Cut ${reference.screenshotName} geometry was unavailable`);
  }
  for (const box of [cutBox, audioBox]) {
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(reference.width + 1);
  }

  const navigation = page.locator(viewNavigationSelector);
  const [tableLinkBox, cutLinkBox] = await Promise.all([
    navigation.getByRole('link', { name: 'Table', exact: true }).boundingBox(),
    navigation.getByRole('link', { name: 'Cut', exact: true }).boundingBox(),
  ]);
  if (tableLinkBox === null || cutLinkBox === null) {
    throw new Error(`Cut ${reference.screenshotName} navigation geometry was unavailable`);
  }
  if (reference.direction === 'ltr') expect(tableLinkBox.x).toBeLessThan(cutLinkBox.x);
  else expect(tableLinkBox.x).toBeGreaterThan(cutLinkBox.x);

  await takeScreenshot(page, reference.screenshotName);
};

const exerciseCutPreviewTransport = async (
  page: Page,
  cut: Locator,
  managedVideo: CutManagedVideoReference
): Promise<void> => {
  const media = cut.locator('[data-cut-preview] video[data-cut-preview-media][data-media-kind="video"]');
  const play = cut.locator('[data-cut-transport] [data-cut-play]');
  const expectedUrl = `weprompt-studio://asset/${managedVideo.projectId}/${managedVideo.assetId}`;
  await expect(media).toHaveCount(1);
  await expect.poll(async () => media.evaluate((element: HTMLVideoElement) => element.currentSrc)).toBe(expectedUrl);
  await cut.focus();
  await expect(cut).toBeFocused();
  await cut.press('ArrowRight');
  await expect(cut.locator('[data-cut-transport] [data-cut-time]')).toHaveText('0:01 / 0:10');
  await expect
    .poll(async () => media.evaluate((element: HTMLVideoElement) => element.currentTime))
    .toBeGreaterThanOrEqual(0.9);
  const initialTime = await media.evaluate((element: HTMLVideoElement) => element.currentTime);

  await play.click();
  await expect(play).toHaveAccessibleName('Pause film');
  await expect(play).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => media.evaluate((element: HTMLVideoElement) => element.paused)).toBe(false);
  await expect
    .poll(async () => media.evaluate((element: HTMLVideoElement) => element.currentTime), { timeout: 4_000 })
    .toBeGreaterThan(initialTime + 0.1);

  await play.click();
  await expect(play).toHaveAccessibleName('Play film');
  await expect(play).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => media.evaluate((element: HTMLVideoElement) => element.paused)).toBe(true);
  const pausedAt = await media.evaluate((element: HTMLVideoElement) => element.currentTime);
  await page.waitForTimeout(300);
  const afterPause = await media.evaluate((element: HTMLVideoElement) => element.currentTime);
  expect(Math.abs(afterPause - pausedAt)).toBeLessThanOrEqual(0.05);
};

type RenderedCutFixture = {
  projectId: string;
  beatId: string;
  shotId: string;
  seedAssetId: string;
  videoAssetId: string;
  project: StudioRendererProjectV2;
};

const createRenderedCutFixture = async (page: Page, projectBrief: string): Promise<RenderedCutFixture> => {
  await navigateTo(page, ROUTES.studio);
  const workspace = page.locator(workspaceSelector);
  await workspace.getByLabel('What do you want to make?').fill(projectBrief);
  await workspace.getByRole('button', { name: 'Create project' }).click();
  await expect(page).toHaveURL(/#\/studio\/[^/]+$/);

  const projectId = projectIdFromStudioUrl(page);
  const beatId = `beat_cut_e2e_${Date.now()}`;
  const shotId = `shot_cut_e2e_${Date.now()}`;
  const routes = await invokeStudioBridge<StudioRouteCatalogV2>(page, 'list-routes', { projectId });
  const imageRouteId = routes.image.options[0]?.choiceId;
  const videoRouteId = routes.video.options[0]?.choiceId;
  if (imageRouteId === undefined || videoRouteId === undefined) {
    throw new Error('Creative Studio E2E fake routes were unavailable');
  }
  const authoringBase = await readStableStudioProject(page, projectId);

  const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
    projectId,
    expectedRevision: authoringBase.revision,
    operations: [
      ...(authoringBase.imageRouteId === imageRouteId && authoringBase.videoRouteId === videoRouteId
        ? []
        : [{ kind: 'set_routes' as const, imageRouteId, videoRouteId }]),
      {
        kind: 'add_beat',
        beatId,
        beat: {
          title: 'Cut export Beat',
          story: 'A paper airplane crosses the finished film in soft morning light with a clean paper texture.',
          targetSeconds: 10,
        },
        beforeBeatId: null,
      },
      {
        kind: 'add_shot',
        beatId,
        shotId,
        shot: {
          shootingScript: 'The airplane settles quietly into frame beneath the word LANDING.',
          durationSeconds: 10,
        },
        beforeShotId: null,
      },
      { kind: 'set_reference_plan', references: [] },
      {
        kind: 'set_shot_reference_binding',
        shotId,
        characterReferenceIds: [],
        backgroundReferenceId: null,
      },
    ],
  });

  const prepared = await invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(page, 'prepare-submission', {
    projectId,
    expectedRevision: authored.projectRevision,
    originReferenceHandoffId: null,
    baseChoices: [{ target: { kind: 'shot', shotId }, purpose: 'seed_still' }],
    cascadeChoices: [{ target: { kind: 'shot', shotId }, purpose: 'video_take' }],
  });
  if (prepared.withCascade === null) throw new Error('Creative Studio Cut fixture cascade quote was unavailable');
  await invokeStudioBridge<StudioConfirmSubmissionResultV2>(
    page,
    'confirm-submission',
    {
      projectId,
      quoteId: prepared.withCascade.id,
      expectedRevision: authored.projectRevision,
    },
    90_000
  );

  await expect
    .poll(
      async () => {
        const project = await readStudioProject(page, projectId);
        return Object.values(project.jobs).find(
          (job) =>
            job.target.kind === 'shot' &&
            job.target.shotId === shotId &&
            job.purpose === 'seed_still' &&
            job.status === 'succeeded'
        )?.outputAssetIdsByRole.primary;
      },
      { timeout: studioFakeMediaTimeoutMs }
    )
    .toEqual(expect.any(String));
  const seeded = await readStudioProject(page, projectId);
  const seedAssetId = Object.values(seeded.jobs).find(
    (job) => job.target.kind === 'shot' && job.target.shotId === shotId && job.purpose === 'seed_still'
  )?.outputAssetIdsByRole.primary;
  if (seedAssetId === null || seedAssetId === undefined) {
    throw new Error('Creative Studio Cut fixture seed asset was unavailable');
  }
  await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
    projectId,
    expectedRevision: seeded.revision,
    operations: [{ kind: 'set_seed_still', shotId, assetId: seedAssetId }],
  });

  await expect
    .poll(
      async () => {
        const project = await readStudioProject(page, projectId);
        return Object.values(project.jobs).find(
          (job) =>
            job.target.kind === 'shot' &&
            job.target.shotId === shotId &&
            job.purpose === 'video_take' &&
            job.status === 'succeeded'
        )?.outputAssetIdsByRole.primary;
      },
      { timeout: studioFakeMediaTimeoutMs }
    )
    .toEqual(expect.any(String));
  const rendered = await readStudioProject(page, projectId);
  const videoAssetId = Object.values(rendered.jobs).find(
    (job) => job.target.kind === 'shot' && job.target.shotId === shotId && job.purpose === 'video_take'
  )?.outputAssetIdsByRole.primary;
  if (videoAssetId === null || videoAssetId === undefined) {
    throw new Error('Creative Studio Cut fixture video asset was unavailable');
  }
  expect(rendered.shots[shotId]?.videoAssetId).toBe(videoAssetId);
  await expect
    .poll(
      async () => {
        const project = await readStudioProject(page, projectId);
        return Object.values(project.assets).find(
          (asset) =>
            asset.shotId === shotId &&
            asset.mediaKind === 'image' &&
            asset.managedAsset?.collection === 'conditioningFrames'
        )?.id;
      },
      { timeout: studioFakeMediaTimeoutMs }
    )
    .toEqual(expect.any(String));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table', { timeout: 30_000 });
  await expect(page.getByRole('grid', { name: 'Beat table' }).getByText('Cut export Beat')).toBeVisible();
  const panel = page.getByRole('dialog', { name: 'Beat panel — Cut export Beat' });
  if (await panel.isVisible()) {
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toBeHidden();
  }
  const project = await readStableStudioProject(page, projectId);
  return { projectId, beatId, shotId, seedAssetId, videoAssetId, project };
};

type CutLifecycleState = {
  projectId: string;
  firstBedAssetId: string;
  selectedBedAssetId: string;
  exportArtifacts: StudioRendererExportCatalogV2['artifacts'];
  providerCalls: StudioE2EProviderCallCounts;
  userDataDirectory: string;
};

let cutLifecycleState: CutLifecycleState | null = null;

const requireCutLifecycleState = (): CutLifecycleState => {
  if (cutLifecycleState === null) throw new Error('Creative Studio Cut lifecycle setup did not complete');
  return cutLifecycleState;
};

type RenderedShotLifecycleState = {
  projectId: string;
  beatId: string;
  shotId: string;
  anchorShotId: string;
  retainedProject: StudioRendererProjectV2;
  retainedFrameExtractions: StudioProjectV2['frameExtractions'];
  providerCalls: StudioE2EProviderCallCounts;
  userDataDirectory: string;
};

let renderedShotLifecycleState: RenderedShotLifecycleState | null = null;

const requireRenderedShotLifecycleState = (): RenderedShotLifecycleState => {
  if (renderedShotLifecycleState === null) {
    throw new Error('Creative Studio rendered Shot lifecycle setup did not complete');
  }
  return renderedShotLifecycleState;
};

const applyStudioViewportReference = async (page: Page, reference: StudioViewportReference): Promise<void> => {
  await page.setViewportSize({ width: reference.width, height: reference.height });
  const root = page.locator('html');
  await root.evaluate((element, direction) => element.setAttribute('dir', direction), reference.direction);
  await expect(root).toHaveAttribute('dir', reference.direction);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
    documentClientWidth: document.documentElement.clientWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
  }));
  expect(viewport).toMatchObject({ width: reference.width, height: reference.height });
  expect(viewport.documentScrollWidth).toBeLessThanOrEqual(viewport.documentClientWidth + 1);
};

const expectLocatorFitsViewport = async (
  locator: Locator,
  reference: StudioViewportReference,
  label: string
): Promise<void> => {
  const box = await locator.boundingBox();
  if (box === null) throw new Error(`${label} ${reference.screenshotSuffix} geometry was unavailable`);
  expect(box.x).toBeGreaterThanOrEqual(-1);
  expect(box.x + box.width).toBeLessThanOrEqual(reference.width + 1);
};

const expectBeatAuthoringBandGeometry = async (panel: Locator, reference: StudioViewportReference): Promise<void> => {
  await panel.evaluate(
    (element) =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      })
  );
  await expect
    .poll(async () =>
      panel.evaluate((element) => {
        const transform = getComputedStyle(element).transform;
        const transformIsSettled =
          transform === 'none' ||
          (() => {
            const matrix = new DOMMatrixReadOnly(transform);
            return Math.abs(matrix.a - 1) <= 0.001 && Math.abs(matrix.d - 1) <= 0.001;
          })();
        const animationsAreSettled = element
          .getAnimations()
          .every((animation) => animation.playState !== 'pending' && animation.playState !== 'running');
        return transformIsSettled && animationsAreSettled;
      })
    )
    .toBe(true);
  if (reference.width > 900) {
    await expect
      .poll(
        async () =>
          panel
            .locator('[data-beat-working-row] > [data-fullscreen-media-frame]')
            .evaluate((element) => Math.abs(element.getBoundingClientRect().width - 376) <= 1),
        { timeout: 10_000 }
      )
      .toBe(true);
  }

  const fields = panel.locator('section[aria-label="Beat story"]');
  const storyField = fields.locator('[data-beat-field="story"]');
  const storyGuidance = storyField.getByText('Story · The narrative purpose and progression for this Beat', {
    exact: true,
  });
  await expect(storyGuidance).toBeVisible();
  await expect(storyGuidance).toHaveCSS('text-transform', 'uppercase');

  const geometry = await panel.evaluate((panelElement) => {
    const element = panelElement.querySelector<HTMLElement>('section[aria-label="Beat story"]');
    if (element === null) throw new Error('Beat authoring section was unavailable');
    // eslint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes only this evaluate closure.
    const box = (root: HTMLElement, selector: string) => {
      const target = root.querySelector<HTMLElement>(selector);
      if (target === null) throw new Error(`Beat authoring geometry target was unavailable: ${selector}`);
      const { bottom, left, right, top, width } = target.getBoundingClientRect();
      return { bottom, height: target.getBoundingClientRect().height, left, right, top, width };
    };
    const panelRect = panelElement.getBoundingClientRect();
    const panelStyle = getComputedStyle(panelElement);
    const { bottom, left, right, top, width } = element.getBoundingClientRect();
    const documentElement = element.ownerDocument.documentElement;
    const visibleShotInspectors = Array.from(
      panelElement.querySelectorAll<HTMLElement>('article[data-shot-id]')
    ).filter((shot) => !shot.hidden);
    const visibleShotInspector = visibleShotInspectors[0];
    if (visibleShotInspector === undefined) throw new Error('Visible Shot inspector was unavailable');
    return {
      panel: {
        rect: {
          bottom: panelRect.bottom,
          left: panelRect.left,
          right: panelRect.right,
          top: panelRect.top,
          width: panelRect.width,
        },
        clientWidth: panelElement.clientWidth,
        scrollWidth: panelElement.scrollWidth,
        computedWidth: panelStyle.width,
        computedInlineSize: panelStyle.inlineSize,
        computedMaxInlineSize: panelStyle.maxInlineSize,
      },
      viewport: {
        innerWidth: window.innerWidth,
        devicePixelRatio: window.devicePixelRatio,
        visualScale: window.visualViewport?.scale ?? null,
      },
      section: { bottom, left, right, top, width },
      sectionClientWidth: element.clientWidth,
      sectionScrollWidth: element.scrollWidth,
      documentClientWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      story: box(element, '[data-beat-field="story"]'),
      working: box(panelElement, '[data-beat-working-row]'),
      previewColumn: box(panelElement, '[data-beat-working-row] > [data-fullscreen-media-frame]'),
      inspector: box(panelElement, '[data-shot-inspector]'),
      playbackTrack: box(panelElement, '[data-testid="studio-coverage-playback"]'),
      coverage: (() => {
        const coverage = panelElement.querySelector<HTMLElement>('[data-beat-coverage]');
        if (coverage === null) throw new Error('Beat coverage geometry target was unavailable');
        return {
          ...box(panelElement, '[data-beat-coverage]'),
          clientWidth: coverage.clientWidth,
          scrollWidth: coverage.scrollWidth,
        };
      })(),
      visibleShotInspectors: visibleShotInspectors.length,
    };
  });
  const computedPanelWidth = Number.parseFloat(geometry.panel.computedWidth);
  const computedPanelInlineSize = Number.parseFloat(geometry.panel.computedInlineSize);
  const computedPanelMaxInlineSize = Number.parseFloat(geometry.panel.computedMaxInlineSize);
  const expectedPanelWidth = Math.min(1320, reference.width - 32);
  expect(computedPanelWidth).toBeGreaterThanOrEqual(expectedPanelWidth - 4);
  expect(computedPanelWidth).toBeLessThanOrEqual(expectedPanelWidth + 2);
  expect(computedPanelInlineSize).toBeGreaterThanOrEqual(expectedPanelWidth - 4);
  expect(computedPanelInlineSize).toBeLessThanOrEqual(expectedPanelWidth + 2);
  expect(computedPanelMaxInlineSize).toBe(1320);
  expect(geometry.panel.clientWidth).toBeGreaterThanOrEqual(expectedPanelWidth - 4);
  expect(geometry.panel.clientWidth).toBeLessThanOrEqual(expectedPanelWidth + 2);
  expect(geometry.panel.scrollWidth).toBeLessThanOrEqual(geometry.panel.clientWidth + 1);
  expect(geometry.section.left).toBeGreaterThanOrEqual(geometry.panel.rect.left - 1);
  expect(geometry.section.right).toBeLessThanOrEqual(geometry.panel.rect.right + 1);
  expect(geometry.sectionScrollWidth).toBeLessThanOrEqual(geometry.sectionClientWidth + 1);
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.visibleShotInspectors).toBe(1);
  expect(geometry.playbackTrack.height).toBeGreaterThanOrEqual(87);
  expect(geometry.playbackTrack.height).toBeLessThanOrEqual(89);
  expect(geometry.coverage.scrollWidth).toBeGreaterThanOrEqual(geometry.coverage.clientWidth);

  if (reference.width > 900) {
    expect(geometry.previewColumn.width).toBeGreaterThanOrEqual(375);
    expect(geometry.previewColumn.width).toBeLessThanOrEqual(377);
    expect(Math.abs(geometry.previewColumn.top - geometry.inspector.top)).toBeLessThanOrEqual(1);
    const workingGap =
      reference.direction === 'rtl'
        ? geometry.previewColumn.left - geometry.inspector.right
        : geometry.inspector.left - geometry.previewColumn.right;
    expect(workingGap).toBeGreaterThanOrEqual(17);
    expect(workingGap).toBeLessThanOrEqual(19);
    expect(
      Math.abs(geometry.previewColumn.width + geometry.inspector.width + workingGap - geometry.working.width)
    ).toBeLessThanOrEqual(1);
  } else {
    expect(geometry.previewColumn.bottom).toBeLessThanOrEqual(geometry.inspector.top - 17);
    expect(Math.abs(geometry.previewColumn.width - geometry.working.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(geometry.inspector.width - geometry.working.width)).toBeLessThanOrEqual(1);
  }

  for (const child of [geometry.story]) {
    expect(child.left).toBeGreaterThanOrEqual(geometry.section.left - 1);
    expect(child.right).toBeLessThanOrEqual(geometry.section.right + 1);
    expect(child.top).toBeGreaterThanOrEqual(geometry.section.top - 1);
    expect(child.bottom).toBeLessThanOrEqual(geometry.section.bottom + 1);
  }
};

const expectFoldedTableFits = async (table: Locator): Promise<void> => {
  await expect(table.getByRole('columnheader')).toHaveCount(6);
  const geometry = await table.evaluate((element) => {
    const scroll = element.closest<HTMLElement>('[data-studio-table-scroll]');
    if (scroll === null) throw new Error('Table scrollport was unavailable');
    const scrollRect = scroll.getBoundingClientRect();
    const gridRect = element.getBoundingClientRect();
    const durationFits = Array.from(element.querySelectorAll<HTMLElement>('[data-duration-kind]')).every((fact) => {
      const cell = fact.closest<HTMLElement>('[data-grid-column-name="length"]');
      if (cell === null) return false;
      const factRect = fact.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      return factRect.left >= cellRect.left - 1 && factRect.right <= cellRect.right + 1;
    });
    const shotFactsFit = Array.from(
      element.querySelectorAll<HTMLElement>('[role="gridcell"][data-grid-column-name="shots"] > *')
    ).every((fact) => {
      const cell = fact.closest<HTMLElement>('[data-grid-column-name="shots"]');
      if (cell === null) return false;
      const factRect = fact.getBoundingClientRect();
      const cellRect = cell.getBoundingClientRect();
      return factRect.left >= cellRect.left - 1 && factRect.right <= cellRect.right + 1;
    });
    return {
      clientWidth: scroll.clientWidth,
      scrollWidth: scroll.scrollWidth,
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      gridWidth: gridRect.width,
      scrollLeft: scrollRect.left,
      scrollRight: scrollRect.right,
      durationFits,
      shotFactsFit,
    };
  });

  // The hi-fi Table deliberately preserves comfortable column widths and owns any horizontal
  // overflow locally. The surrounding document must never widen with it.
  expect(geometry.scrollWidth).toBeGreaterThan(geometry.clientWidth + 1);
  expect(geometry.gridWidth).toBeGreaterThanOrEqual(geometry.clientWidth);
  expect(geometry.documentScrollWidth).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.scrollLeft).toBeGreaterThanOrEqual(-1);
  expect(geometry.scrollRight).toBeLessThanOrEqual(geometry.documentClientWidth + 1);
  expect(geometry.durationFits).toBe(true);
  expect(geometry.shotFactsFit).toBe(true);
};

const exerciseRenderedShotViewportLifecycle = async (page: Page, reference: StudioViewportReference): Promise<void> => {
  const state = requireRenderedShotLifecycleState();
  const { anchorShotId, beatId, projectId, retainedFrameExtractions, retainedProject, shotId, userDataDirectory } =
    state;
  const projectBeforeLift = await readStudioProject(page, projectId);
  expect(projectBeforeLift.beats[beatId]?.shotOrder).toEqual([shotId, anchorShotId]);
  expect(projectBeforeLift.bin).toEqual(retainedProject.bin);
  expect(projectBeforeLift.shots).toEqual(retainedProject.shots);
  expect(projectBeforeLift.assets).toEqual(retainedProject.assets);
  expect(projectBeforeLift.jobs).toEqual(retainedProject.jobs);
  expect(
    Object.values(projectBeforeLift.jobs).every((job) => ['cancelled', 'failed', 'succeeded'].includes(job.status))
  ).toBe(true);
  expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(retainedFrameExtractions);
  expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(state.providerCalls);

  await navigateTo(page, `#/studio/${encodeURIComponent(projectId)}/table`);
  await applyStudioViewportReference(page, reference);
  const workspace = page.locator(workspaceSelector);
  await expect(workspace).toHaveCSS('direction', reference.direction);
  await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table');
  const table = page.getByRole('grid', { name: 'Beat table' });
  const row = table.getByRole('row').filter({ hasText: 'Landing' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('2 shots');
  await expect(row.locator('[data-duration-kind]')).toHaveCount(1);
  await expect(row.locator('[data-duration-kind="planned"]')).toHaveText('16s');
  await expect(row.locator('[data-duration-kind="target"]')).toHaveCount(0);
  await row.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await takeScreenshot(page, `creative-studio/gate-3/table-${reference.screenshotSuffix}.png`);

  const navigation = page.locator(viewNavigationSelector);
  await navigation.getByRole('link', { name: 'Board', exact: true }).click();
  await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');
  const board = page.getByRole('list', { name: 'Beat board' });
  const beatCard = board.locator(`[data-beat-id="${beatId}"]`);
  const openBeat = beatCard.getByRole('button', { name: 'Open Landing', exact: true });
  await expect(openBeat).toBeVisible();
  await expect(beatCard).toContainText('2 shots');
  await openBeat.click();

  const panel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
  await expect(panel).toBeVisible();
  await expect(panel.locator('article[data-shot-id]')).toHaveCount(2);
  await panel.getByRole('button', { name: 'Story', exact: true }).click();
  await expect(panel.locator('[data-beat-target-reveal]')).toHaveCount(0);
  await expectBeatAuthoringBandGeometry(panel, reference);
  const shotCard = panel.locator(`article[data-shot-id="${shotId}"]`);
  const anchorShotCard = panel.locator(`article[data-shot-id="${anchorShotId}"]`);
  const shotSelector = panel.locator(
    `[data-testid="studio-coverage-playback"] [data-shot-id="${shotId}"] [data-coverage-shot-selector]`
  );
  const anchorShotSelector = panel.locator(
    `[data-testid="studio-coverage-playback"] [data-shot-id="${anchorShotId}"] [data-coverage-shot-selector]`
  );
  await expect(shotSelector).toHaveAttribute('aria-pressed', 'true');
  await expect(anchorShotSelector).toHaveAttribute('aria-pressed', 'false');
  await expect(shotCard).toBeVisible();
  await expect(anchorShotCard).toBeHidden();
  await expect(shotCard).toContainText('The plane lands.');
  await expect(anchorShotCard).toContainText('The desk remains in view.');
  const headState = shotCard.locator('[data-chain-state="segment_head"]');
  const continuousState = anchorShotCard.locator('[data-chain-state="continuous"]');
  await expect(headState).toHaveText('Head of the chain · Starts from the first frame');
  await expect(shotCard.locator('[data-chain-change-trigger]')).toHaveCount(0);
  await expect(shotCard.getByRole('textbox', { name: 'Shooting script for Shot 1', exact: true })).toHaveValue(
    'The plane lands.'
  );

  await anchorShotSelector.click();
  await expect(anchorShotSelector).toHaveAttribute('aria-pressed', 'true');
  await expect(shotSelector).toHaveAttribute('aria-pressed', 'false');
  await expect(anchorShotCard).toBeVisible();
  await expect(shotCard).toBeHidden();
  await expect(continuousState).toHaveText('Continues from Shot 01’s last frame');
  const chainChange = panel.locator(`[data-chain-change-trigger][data-shot-id="${anchorShotId}"]`);
  await expect(chainChange).toHaveAttribute('aria-haspopup', 'dialog');
  await expect(chainChange).toHaveAccessibleDescription(
    'A hard cut makes Shot 2 start from an eligible first frame, creating one if needed. Confirming replaces this Shot and each continuous downstream Shot through the next hard cut.'
  );
  await chainChange.click();
  await expect(page.locator('[data-testid="studio-spend-gate"][data-gate-kind="continuity_change"]')).toBeVisible();
  expect(await readStudioProject(page, projectId)).toEqual(projectBeforeLift);
  await page.getByRole('button', { name: 'Close — keep the chain unchanged', exact: true }).click();
  await expect(anchorShotCard.getByRole('textbox', { name: 'Shooting script for Shot 2', exact: true })).toHaveValue(
    'The desk remains in view.'
  );

  const playbackLane = panel.getByRole('group', { name: 'Playback coverage' });
  const planningLane = panel.getByRole('group', { name: 'Planning overlay' });
  const renderedPlaybackSegment = playbackLane.locator(`[data-shot-id="${shotId}"]`);
  await expect(renderedPlaybackSegment).toContainText('10s source');
  await expect(planningLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('8s plan');
  const sourceDuration = renderedPlaybackSegment.getByText('10s source', { exact: true });
  const trimIn = renderedPlaybackSegment.getByRole('slider', { name: 'Trim in for Shot 1' });
  const [sourceDurationBox, trimInBox] = await Promise.all([sourceDuration.boundingBox(), trimIn.boundingBox()]);
  if (sourceDurationBox === null || trimInBox === null) throw new Error('Trim-lane geometry was unavailable');
  expect(sourceDurationBox.y + sourceDurationBox.height).toBeLessThanOrEqual(trimInBox.y + 1);
  await expectLocatorFitsViewport(panel, reference, 'Beat panel');
  await takeScreenshot(page, `creative-studio/gate-3/beat-panel-coverage-${reference.screenshotSuffix}.png`);

  await shotSelector.click();
  await expect(shotCard).toBeVisible();
  const liftShot = shotCard.locator('[data-shot-overflow-trigger]');
  await expect(liftShot).toBeEnabled();
  await expect(panel.locator('[data-beat-overflow-trigger]')).toBeEnabled();
  await liftShot.click();
  const liftMenu = page.locator('[data-shot-overflow-menu]:visible');
  await liftMenu.getByRole('menuitem', { name: 'Move to Bin', exact: true }).click();
  const liftConfirmation = page.getByRole('dialog').filter({ hasText: 'Move Shot 1 to the Bin?' });
  await expect(liftConfirmation.getByText('Move Shot 1 to the Bin?', { exact: true })).toBeVisible();
  await expect(
    liftConfirmation.getByText(
      'Authored and paid work stays with this Shot. Moving it to the Bin makes Beat 1, Shot 2 stale.',
      { exact: true }
    )
  ).toBeVisible();
  const confirmLift = liftConfirmation.getByRole('button', { name: 'Move to Bin', exact: true });
  await expect(confirmLift).toBeVisible();
  await confirmLift.click();

  await expect
    .poll(async () => (await readStudioProject(page, projectId)).beats[beatId]?.shotOrder)
    .toEqual([anchorShotId]);
  const parked = await readStudioProject(page, projectId);
  expect(parked.revision).toBe(projectBeforeLift.revision + 1);
  expect(parked.beats[beatId]?.shotOrder).toEqual([anchorShotId]);
  expect(parked.bin).toEqual([...projectBeforeLift.bin, { kind: 'shot', beatId, shotId, reason: 'lifted' }]);
  expect(parked.shots).toEqual(projectBeforeLift.shots);
  expect(parked.assets).toEqual(projectBeforeLift.assets);
  expect(parked.jobs).toEqual(projectBeforeLift.jobs);
  expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(retainedFrameExtractions);
  expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(state.providerCalls);

  await expect(panel).toBeHidden();
  await expect(openBeat).toHaveAttribute('aria-current', 'true');
  await expect(beatCard).toContainText('1 shot');
  await expect(beatCard).not.toContainText('2 shots');
  await expect(beatCard.getByText('1 stale Shot', { exact: true })).toBeVisible();
  const liftAnnouncement = page.locator('[data-studio-shot-lift-announcement]');
  await expect(liftAnnouncement).toHaveAttribute('aria-live', 'polite');
  await expect(liftAnnouncement).toHaveAttribute('aria-atomic', 'true');
  await expect(liftAnnouncement).toHaveText('Shot moved to the Bin.');

  const bin = page.locator('[data-studio-bin]');
  await expect(bin.getByRole('heading', { name: 'Bin', exact: true })).toBeVisible();
  const binnedShotPosition = parked.bin.findIndex(
    (entry) => entry.kind === 'shot' && entry.beatId === beatId && entry.shotId === shotId && entry.reason === 'lifted'
  );
  expect(binnedShotPosition).toBeGreaterThanOrEqual(0);
  const binnedShot = bin.locator(`[data-bin-item-key="shot:${shotId}"]`);
  await expect(binnedShot).toHaveAttribute('data-bin-kind', 'shot');
  await expect(binnedShot).toHaveAttribute('data-bin-reason', 'lifted');
  await expect(binnedShot).toHaveAttribute('data-retained-work', 'true');
  await expect(binnedShot).toHaveAttribute(
    'aria-label',
    `Shot, Lifted, position ${binnedShotPosition + 1} of ${parked.bin.length} Recorded owner Beat Landing`
  );
  await expect(binnedShot).toContainText('The plane lands.');
  await expect(binnedShot).toContainText('Recorded owner Beat');
  await expect(binnedShot).toContainText('Landing');
  await expect(binnedShot).toContainText(`Position ${binnedShotPosition + 1} of ${parked.bin.length}`);
  await expect(binnedShot).toContainText('Authored and generated work retained');
  const binnedFocusTarget = bin.locator(`[data-bin-focus-key="shot:${shotId}"]`);
  await expect(binnedFocusTarget).toBeFocused();
  await expectLocatorFitsViewport(binnedShot, reference, 'Binned Shot');
  await applyStudioViewportReference(page, reference);
  await takeScreenshot(page, `creative-studio/gate-3/board-bin-${reference.screenshotSuffix}.png`);

  await openBeat.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator(`article[data-shot-id="${shotId}"]`)).toHaveCount(0);
  const staleAnchorShotCard = panel.locator(`article[data-shot-id="${anchorShotId}"]`);
  await expect(staleAnchorShotCard).toBeVisible();
  await expect(staleAnchorShotCard.getByText('Generated work is out of date', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toBeHidden();

  await chooseArcoSelectOption(
    page,
    `Restore position Shot The plane lands. Position ${binnedShotPosition + 1} of ${parked.bin.length}`,
    'Before Shot 1'
  );
  const restoreShot = binnedShot.getByRole('button', { name: 'Restore Shot', exact: true });
  await expect(restoreShot).toBeEnabled();
  await restoreShot.click();
  await expect
    .poll(async () => (await readStudioProject(page, projectId)).beats[beatId]?.shotOrder)
    .toEqual([shotId, anchorShotId]);
  const restored = await readStudioProject(page, projectId);
  expect(restored.revision).toBe(parked.revision + 1);
  expect(restored.beats[beatId]?.shotOrder).toEqual([shotId, anchorShotId]);
  expect(restored.bin).toEqual(projectBeforeLift.bin);
  expect(restored.shots).toEqual(projectBeforeLift.shots);
  expect(restored.assets).toEqual(projectBeforeLift.assets);
  expect(restored.jobs).toEqual(projectBeforeLift.jobs);
  expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(retainedFrameExtractions);
  expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(state.providerCalls);
  await expect(binnedShot).toHaveCount(0);
  await expect(openBeat).toBeFocused();
  await expect(beatCard).toContainText('2 shots');

  await openBeat.click();
  await expect(panel).toBeVisible();
  await expect(panel.locator(`article[data-shot-id="${shotId}"]`)).toBeVisible();
  await expect(panel.locator(`article[data-shot-id="${anchorShotId}"]`)).toBeHidden();
  await anchorShotSelector.click();
  await expect(panel.locator(`article[data-shot-id="${anchorShotId}"]`)).toBeVisible();
  await expect(panel.locator(`article[data-shot-id="${shotId}"]`)).toBeHidden();
  await shotSelector.click();
  await expect(panel.locator(`article[data-shot-id="${shotId}"]`)).toBeVisible();
  await expect(playbackLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('10s source');
  await expect(planningLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('8s plan');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toBeHidden();
};

test.describe('Creative Studio workspace', () => {
  test.describe.configure({ timeout: 60_000 });
  test.skip(process.env.AIONUI_E2E_TEST !== '1', 'Creative Studio E2E requires an isolated test profile.');

  test('creates and reloads a Beat/Shot project across the shared Table, Board, and Cut routes', async ({
    electronApp,
    page,
  }) => {
    const projectBrief = `A quiet paper-airplane launch story ${Date.now()}.`;
    const renamedProject = `${projectBrief} — renamed ${'with a deliberately extended title '.repeat(12)}`.slice(
      0,
      256
    );

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await expect(workspace.getByRole('region', { name: 'Creative Studio' })).toBeVisible();

    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/#\/studio\/[^/]+$/);
    const projectId = projectIdFromStudioUrl(page);
    await expect(page.locator(projectHeaderSelector).getByRole('heading', { level: 1 })).toHaveText(projectBrief);
    const initialProjectStatus = await invokeStudioBridge<StudioProjectStatusV2>(page, 'get-project-status', {
      projectId,
    });
    const initialBlockerCopy = `${initialProjectStatus.blockerCount} blocker${
      initialProjectStatus.blockerCount === 1 ? '' : 's'
    }`;
    await expect(page.locator('[data-studio-bar-blockers]')).toHaveText(initialBlockerCopy);

    const navigation = page.locator(viewNavigationSelector);
    await expect(navigation.getByRole('link', { name: 'Table' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table');
    await expectProjectConfigurationOutsideActiveView(page);

    const projectTitle = page.locator(projectHeaderSelector).getByRole('heading', { level: 1 });
    await projectTitle.getByRole('button', { name: `Rename project: ${projectBrief}` }).click();
    const nameDraft = projectTitle.getByRole('textbox', { name: 'Rename project' });
    await nameDraft.fill(' ');
    await nameDraft.press('Enter');
    await expect(projectTitle.getByRole('alert')).toBeVisible();
    await expect(projectTitle).toHaveCSS('overflow', 'visible');
    await nameDraft.fill(renamedProject);
    await nameDraft.press('Enter');
    await expect(projectTitle).toHaveText(renamedProject);
    const titleGeometry = await projectTitle.evaluate((heading) => {
      const titleText = heading.querySelector('bdi');
      if (!(titleText instanceof HTMLElement)) throw new Error('Project title text box is missing.');
      const headingRect = heading.getBoundingClientRect();
      const titleTextRect = titleText.getBoundingClientRect();
      return {
        clientWidth: titleText.clientWidth,
        headingRight: headingRect.right,
        scrollWidth: titleText.scrollWidth,
        textRight: titleTextRect.right,
      };
    });
    expect(titleGeometry.textRight).toBeLessThanOrEqual(titleGeometry.headingRight + 1);
    expect(titleGeometry.scrollWidth).toBeGreaterThan(titleGeometry.clientWidth);
    const renameButton = projectTitle.getByRole('button', { name: `Rename project: ${renamedProject}` });
    const titlePalette = await projectTitle.evaluate((heading) => getComputedStyle(heading).color);
    await expect(renameButton).toHaveCSS('color', titlePalette);
    await renameButton.hover();
    await expect(renameButton).not.toHaveCSS('border-bottom-color', 'rgba(0, 0, 0, 0)');

    await navigation.getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/board$/);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');
    await expectProjectConfigurationOutsideActiveView(page);
    await expect(projectTitle).toHaveText(renamedProject);

    await navigation.getByRole('link', { name: 'Cut' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/cut$/);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');
    await expectProjectConfigurationOutsideActiveView(page);
    await expect(projectTitle).toHaveText(renamedProject);
    const editTargetDuration = page.getByRole('button', { name: 'Edit: Target duration (seconds)' });
    await editTargetDuration.click();
    const targetDraft = page.getByRole('spinbutton', { name: 'Target duration (seconds)' });
    await expect(targetDraft).toBeFocused();
    await targetDraft.fill('30');
    await page.mouse.move(0, 0);
    const enabledTitleLayout = await readTitleButtonLayout(renameButton);
    await installEditProjectResponseHold(electronApp, page.url());
    try {
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect.poll(() => hasCapturedEditProjectResponse(electronApp)).toBe(true);
      await expect(renameButton).toBeDisabled();
      const pendingTitleLayout = await readTitleButtonLayout(renameButton);
      expect(pendingTitleLayout.typography).toEqual(enabledTitleLayout.typography);
      expect(pendingTitleLayout.padding).toEqual(enabledTitleLayout.padding);
      for (const dimension of ['height', 'width', 'x', 'y'] as const) {
        expect(
          Math.abs(pendingTitleLayout.geometry[dimension] - enabledTitleLayout.geometry[dimension])
        ).toBeLessThanOrEqual(0.5);
      }
    } finally {
      await releaseEditProjectResponseHold(electronApp);
    }
    await expect(page.locator('[data-cut-film]')).toContainText('of 0:30');
    await expect(page.getByRole('button', { name: 'Edit: Target duration (seconds)' })).toBeFocused();

    const cutUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(cutUrl);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');
    await expectProjectConfigurationOutsideActiveView(page);
    await expect(page.locator(projectHeaderSelector).getByRole('heading', { level: 1 })).toHaveText(renamedProject);
    await expect(page.locator('[data-cut-film]')).toContainText('of 0:30');

    const briefDialog = await openStudioProjectDialog(page, briefAndRulesTitle);
    await expect(briefDialog.getByLabel('Project brief')).toHaveValue(projectBrief);
    await expect(briefDialog.getByRole('combobox', { name: 'Image route', exact: true })).toBeVisible();
    await expect(briefDialog.getByRole('combobox', { name: 'Video route', exact: true })).toBeVisible();
    await expect(briefDialog.getByRole('combobox', { name: 'Aspect ratio', exact: true })).toBeVisible();
    await expect(briefDialog.getByRole('combobox', { name: 'Resolution', exact: true })).toBeVisible();
    await expect(briefDialog.getByLabel('Policy currency')).toBeVisible();
    await expect(briefDialog.getByLabel('Rule', { exact: true })).toBeVisible();
    await expect(briefDialog.getByLabel('Project rule drafts (JSON)')).toHaveCount(0);
    await closeStudioProjectDialog(briefDialog);

    await navigateTo(page, ROUTES.studio);
    const libraryProjectButton = page.getByRole('button', { name: renamedProject, exact: true });
    await expect(libraryProjectButton).toBeVisible();
    const libraryCard = libraryProjectButton.locator('xpath=ancestor::*[contains(@class, "arco-card")][1]');
    const currentProjectStatus = await invokeStudioBridge<StudioProjectStatusV2>(page, 'get-project-status', {
      projectId,
    });
    const currentBlockerCopy = `${currentProjectStatus.blockerCount} blocker${
      currentProjectStatus.blockerCount === 1 ? '' : 's'
    }`;
    await expect(libraryCard.locator('[data-status]')).toContainText(currentBlockerCopy);

    // Merely loading, navigating, and restoring drafts cannot open or cross the paid boundary.
    await expect(page.locator('[data-testid="studio-spend-gate"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /prepare estimate|confirm .*generation/i })).toHaveCount(0);
  });

  test('runs the Ming, Mei, and dai-pai-dong reference trench through exact Board and video dispatch', async ({
    electronApp,
    page,
  }) => {
    test.skip(
      process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
      'The exact reference-dispatch oracle requires the explicit development-only Studio fake adapter.'
    );
    test.setTimeout(300_000);

    const projectBrief = `Ming and Mei meet at a dai pai dong ${Date.now()}.`;
    const beatId = `beat_dai_pai_dong_${Date.now()}`;
    const firstShotId = `shot_ming_arrives_${Date.now()}`;
    const secondShotId = `shot_mei_answers_${Date.now()}`;
    const beatTitle = 'Rain at the dai pai dong';
    const mingPrompt = 'Ming, a middle-aged cook in a white apron and round glasses.';
    const meiPrompt = 'Mei, a young journalist in a red raincoat carrying a notebook.';
    const backgroundPrompt = 'A rain-soaked Hong Kong dai pai dong at night, green awning and warm tungsten light.';
    const beatStory = 'Ming recognizes Mei beneath the green awning and decides whether to trust her.';
    const firstShootingScript = 'Ming looks up from the wok as Mei steps beneath the awning.';
    const secondShootingScript = 'Mei opens her notebook while Ming watches from the counter.';

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+$/);

    const projectId = projectIdFromStudioUrl(page);
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    expect((await readRawStudioProject(userDataDirectory, projectId)).schemaVersion).toBe(
      STUDIO_PROJECT_SCHEMA_VERSION
    );
    const routes = await invokeStudioBridge<StudioRouteCatalogV2>(page, 'list-routes', { projectId });
    const imageRouteId = routes.image.options[0]?.choiceId;
    const videoRouteId = routes.video.options[0]?.choiceId;
    if (imageRouteId === undefined || videoRouteId === undefined) {
      throw new Error('Creative Studio E2E fake routes were unavailable');
    }

    const base = await readStableStudioProject(page, projectId);
    const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
      projectId,
      expectedRevision: base.revision,
      operations: [
        { kind: 'set_routes', imageRouteId, videoRouteId },
        {
          kind: 'add_beat',
          beatId,
          beat: {
            title: beatTitle,
            story: 'Director proposal pending.',
            targetSeconds: 12,
          },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: firstShotId,
          shot: { shootingScript: 'First Shot proposal pending.', durationSeconds: 6 },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: secondShotId,
          shot: { shootingScript: 'Second Shot proposal pending.', durationSeconds: 6 },
          beforeShotId: null,
        },
      ],
    });

    const authoredProject = await readStableStudioProject(page, projectId);
    const styled =
      authoredProject.boardStyle === 'grey_tone'
        ? authored
        : await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'edit-project', {
            projectId,
            expectedRevision: authored.projectRevision,
            changes: { boardStyle: 'grey_tone' },
          });

    // Provision the Director sidecar tree exactly as a real Director session does.
    await invokeStudioBridge<unknown>(page, 'get-brief-session-server', { projectId });
    const proposalId = await writeStudioProposal(userDataDirectory, projectId, styled.projectRevision, [
      { kind: 'edit_beat', beatId, changes: { story: beatStory } },
      { kind: 'edit_shot', shotId: firstShotId, changes: { shootingScript: firstShootingScript } },
      { kind: 'edit_shot', shotId: secondShotId, changes: { shootingScript: secondShootingScript } },
    ]);
    // The E2E writer runs outside Electron and can outrun Main's recursive sidecar watcher.
    // Remounting proves the durable proposal is recovered into the Director transcript.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table', { timeout: 30_000 });
    const proposalCard = page.getByTestId(`studio-proposal-${proposalId}`);
    await expect(proposalCard).toBeVisible({ timeout: 10_000 });
    await proposalCard.getByRole('button', { name: 'Review proposal details', exact: true }).click();
    const proposalReview = proposalCard.getByTestId('studio-proposal-semantic-review');
    await expect(proposalReview.locator('[data-proposal-field="story"]')).toContainText(beatStory);
    const scriptReviewFields = proposalReview.locator('[data-proposal-field="shootingScript"]');
    await expect(scriptReviewFields).toHaveCount(2);
    expect(await scriptReviewFields.allTextContents()).toEqual([
      expect.stringContaining(firstShootingScript),
      expect.stringContaining(secondShootingScript),
    ]);
    await proposalCard.getByRole('button', { name: 'Accept proposal', exact: true }).click();
    await expect(proposalCard).toBeHidden({ timeout: 10_000 });
    const proposalAccepted = await readStableStudioProject(page, projectId);
    expect(proposalAccepted.beats[beatId]?.story).toBe(beatStory);
    expect(proposalAccepted.shots[firstShotId]?.shootingScript).toBe(firstShootingScript);
    expect(proposalAccepted.shots[secondShotId]?.shootingScript).toBe(secondShootingScript);
    await applyStudioDirectorOperations(
      userDataDirectory,
      projectId,
      proposalAccepted.revision,
      `command_reference_plan_${Date.now()}`,
      [
        {
          kind: 'set_reference_plan',
          references: [
            { kind: 'character', label: 'Ming', prompt: mingPrompt },
            { kind: 'character', label: 'Mei', prompt: meiPrompt },
            { kind: 'background', label: 'Dai pai dong', prompt: backgroundPrompt },
          ],
        },
      ]
    );
    const planned = await readStableStudioProject(page, projectId);
    expect(planned.referencePlanStatus).toBe('planned');
    const referenceIdFor = (kind: 'character' | 'background', label: string): string => {
      const referenceId = planned.referenceOrder.find((candidateId) => {
        const candidate = planned.references[candidateId];
        return candidate?.kind === kind && candidate.label === label;
      });
      if (referenceId === undefined) throw new Error(`App-owned reference identity missing for ${kind} ${label}`);
      return referenceId;
    };
    const mingId = referenceIdFor('character', 'Ming');
    const meiId = referenceIdFor('character', 'Mei');
    const backgroundId = referenceIdFor('background', 'Dai pai dong');
    expect(planned.referenceOrder).toEqual([mingId, meiId, backgroundId]);
    await page.locator(viewNavigationSelector).getByRole('link', { name: 'References', exact: true }).click();
    const referencesView = page.locator('[data-studio-references-view]');
    await expect(referencesView.getByRole('button', { name: 'Continue to Table', exact: true })).toHaveCount(0);

    const providerCallsBeforeBlockedBackground = await readStudioE2EProviderCallCounts(userDataDirectory);
    await expect(
      invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(page, 'prepare-project-references', {
        projectId,
        expectedRevision: planned.revision,
        referenceIds: [backgroundId],
      })
    ).rejects.toThrow();
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeBlockedBackground);

    const reviewReferenceBatch = async (
      referenceIds: string[]
    ): Promise<{ handoff: StudioRendererReferenceGenerationHandoffV2; prompts: string[] }> => {
      const requestId = await writeStudioReferenceRequest(userDataDirectory, projectId, referenceIds);
      const requestCard = page.getByTestId(`studio-reference-${requestId}`);
      await expect(requestCard).toBeVisible({ timeout: 10_000 });
      await requestCard.getByRole('button', { name: 'Review generation', exact: true }).click();

      await expect
        .poll(async () => {
          const handoffs = await invokeStudioBridge<StudioRendererReferenceGenerationHandoffV2[]>(
            page,
            'list-reference-generation-handoffs',
            { projectId }
          );
          return handoffs.find((candidate) => candidate.requestId === requestId)?.status ?? null;
        })
        .toBe('awaiting_spend');
      const awaitingHandoffs = await invokeStudioBridge<StudioRendererReferenceGenerationHandoffV2[]>(
        page,
        'list-reference-generation-handoffs',
        { projectId }
      );
      const awaitingHandoff = awaitingHandoffs.find((candidate) => candidate.requestId === requestId);
      if (awaitingHandoff === undefined) throw new Error(`Awaiting reference handoff for ${requestId} was unavailable`);
      const awaitingHandoffCard = page.getByTestId(`studio-handoff-${awaitingHandoff.handoffId}`);
      // A click does not await the card handler's final renderer refetch. Synchronize that free UI update
      // before remounting; the reload then separately proves the durable handoff owns the review card.
      await expect(awaitingHandoffCard).toHaveCount(1);
      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'references', {
        timeout: studioFakeMediaTimeoutMs,
      });
      await expect(awaitingHandoffCard).toBeVisible({ timeout: studioFakeMediaTimeoutMs });
      const reviewCost = awaitingHandoffCard.getByRole('button', { name: 'Review cost', exact: true });
      await expect(reviewCost).toBeEnabled({ timeout: 10_000 });
      await reviewCost.click();

      const gate = page.locator('[data-testid="studio-spend-gate"]');
      await expect(gate).toBeVisible();
      await expect(gate.getByRole('button', { name: 'Show each generation', exact: true })).toBeVisible();
      await gate.getByRole('button', { name: 'Show each generation', exact: true }).click();
      const rows = gate.locator('[data-generation-purpose="reference_image"]');
      await expect(rows).toHaveCount(referenceIds.length);
      const prompts = await rows.locator('pre').allTextContents();
      await gate.getByRole('button', { name: /^Confirm \d+ generation/ }).click();
      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            return referenceIds.map((referenceId) => project.references[referenceId]?.approvedAssetId ?? null);
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual(referenceIds.map(() => expect.any(String)));
      if (await gate.isVisible()) {
        await gate.getByRole('button', { name: 'Close — spend nothing', exact: true }).click();
      }
      const handoffs = await invokeStudioBridge<StudioRendererReferenceGenerationHandoffV2[]>(
        page,
        'list-reference-generation-handoffs',
        { projectId }
      );
      const handoff = handoffs.find((candidate) => candidate.requestId === requestId);
      if (handoff === undefined) throw new Error(`Reference handoff for ${requestId} was unavailable`);
      expect(handoff.status).toBe('succeeded');
      expect(handoff.referenceIds).toEqual(referenceIds);
      return { handoff, prompts };
    };

    const characterReview = await reviewReferenceBatch([mingId, meiId]);
    expect(characterReview.prompts).toHaveLength(2);
    expect(characterReview.prompts[0]).toContain(mingPrompt);
    expect(characterReview.prompts[1]).toContain(meiPrompt);
    const characterHandoffCard = page.getByTestId(`studio-handoff-${characterReview.handoff.handoffId}`);
    await expect(characterHandoffCard).toBeVisible({ timeout: 10_000 });
    await characterHandoffCard.getByRole('button', { name: 'Review references', exact: true }).click();
    await expect(referencesView.locator(`[data-reference-id="${mingId}"]`)).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    await expect(referencesView.locator(`[data-reference-id="${meiId}"]`)).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    const currentCharacters = await readStableStudioProject(page, projectId);
    const mingAssetId = currentCharacters.references[mingId]?.approvedAssetId;
    const meiAssetId = currentCharacters.references[meiId]?.approvedAssetId;
    if (mingAssetId === null || mingAssetId === undefined || meiAssetId === null || meiAssetId === undefined) {
      throw new Error('Current character reference images were unavailable');
    }
    const characterReferencesReady = await readStableStudioProject(page, projectId);

    const backgroundReview = await reviewReferenceBatch([backgroundId]);
    expect(backgroundReview.prompts).toHaveLength(1);
    expect(backgroundReview.prompts[0]).toContain(backgroundPrompt);
    const backgroundHandoffCard = page.getByTestId(`studio-handoff-${backgroundReview.handoff.handoffId}`);
    await expect(backgroundHandoffCard).toBeVisible({ timeout: 10_000 });
    await backgroundHandoffCard.getByRole('button', { name: 'Review references', exact: true }).click();
    await expect(referencesView.locator(`[data-reference-id="${backgroundId}"]`)).toHaveAttribute(
      'data-reference-highlighted',
      'true'
    );
    const currentBackground = await readStableStudioProject(page, projectId);
    expect(currentBackground.revision).toBeGreaterThan(characterReferencesReady.revision);
    const backgroundAssetId = currentBackground.references[backgroundId]?.approvedAssetId;
    if (backgroundAssetId === null || backgroundAssetId === undefined) {
      throw new Error('Current background reference image was unavailable');
    }
    const approved = await readStableStudioProject(page, projectId);
    const expectedReferenceAssets = [
      { assetId: mingAssetId, kind: 'character' as const, prompt: mingPrompt, referenceId: mingId },
      { assetId: meiAssetId, kind: 'character' as const, prompt: meiPrompt, referenceId: meiId },
      { assetId: backgroundAssetId, kind: 'background' as const, prompt: backgroundPrompt, referenceId: backgroundId },
    ];
    for (const { assetId, kind, prompt, referenceId } of expectedReferenceAssets) {
      const job = findStudioReferenceJob(approved, referenceId);
      if (job === undefined) throw new Error(`Reference job for ${referenceId} was unavailable`);
      expect(job).toMatchObject({
        target: { kind: 'reference', referenceId },
        purpose: 'reference_image',
        composition: {
          inputs: {
            source: { kind: 'project_reference', referenceId, referenceKind: kind, prompt },
            purpose: 'reference_image',
            referenceInputs: [],
          },
        },
      });
      expect(approved.assets[assetId]).toMatchObject({
        projectReferenceId: referenceId,
        generationReferenceAssetIds: [],
        producerJobId: job.id,
        compositionDigest: studioGenerationCompositionDigestV2(job.composition),
      });
    }
    const providerRequestsAfterReferences = await readStudioE2EProviderRequests(userDataDirectory);
    expect(providerRequestsAfterReferences).toHaveLength(3);
    expect(providerRequestsAfterReferences.map(({ prompt }) => prompt)).toEqual([
      ...characterReview.prompts,
      ...backgroundReview.prompts,
    ]);
    expect(
      providerRequestsAfterReferences.every(
        ({ conditioningAssetIds, firstFrameAssetId }) => conditioningAssetIds.length === 0 && firstFrameAssetId === null
      )
    ).toBe(true);

    await applyStudioDirectorOperations(
      userDataDirectory,
      projectId,
      approved.revision,
      `command_reference_binding_${Date.now()}`,
      [
        {
          kind: 'set_shot_reference_binding',
          shotId: firstShotId,
          characterReferenceIds: [mingId, meiId],
          backgroundReferenceId: backgroundId,
        },
        {
          kind: 'set_shot_reference_binding',
          shotId: secondShotId,
          characterReferenceIds: [meiId, mingId],
          backgroundReferenceId: backgroundId,
        },
      ]
    );
    const bound = await readStableStudioProject(page, projectId);
    expect(bound.shots[firstShotId]?.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [mingId, meiId],
      backgroundReferenceId: backgroundId,
    });
    expect(bound.shots[secondShotId]?.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [meiId, mingId],
      backgroundReferenceId: backgroundId,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const navigation = page.locator(viewNavigationSelector);
    const referencesLink = navigation.getByRole('link', { name: 'References', exact: true });
    await expect(referencesLink).toBeVisible({ timeout: studioFakeMediaTimeoutMs });
    await referencesLink.click();
    await expect(referencesView.locator('[data-reference-id]')).toHaveCount(3);
    await expect(referencesView.locator('[data-shot-binding-status]')).toHaveCount(0);

    await navigation.getByRole('link', { name: 'Table', exact: true }).click();
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table');
    const beatRow = page.locator(`[data-beat-id="${beatId}"]`);
    await expect(beatRow.locator('[data-grid-column-name="story"]')).toContainText(beatStory);
    await page.getByRole('button', { name: `Open Board panels for ${beatTitle}`, exact: true }).click();
    await expect(page.locator('[data-shot-binding-status="ready"]')).toHaveCount(2);
    await beatRow.locator('[data-grid-column-name="beat"]').click();
    const beatDialog = page.getByRole('dialog', { name: `Beat panel — ${beatTitle}`, exact: true });
    await expect(beatDialog).toBeVisible();
    await beatDialog.getByRole('button', { name: 'Story', exact: true }).click();
    await expect(beatDialog.getByRole('textbox', { name: 'Story', exact: true })).toHaveValue(beatStory);
    await expect(beatDialog.getByRole('textbox', { name: 'Shooting script for Shot 1', exact: true })).toHaveValue(
      firstShootingScript
    );
    const secondShotSelector = beatDialog.locator(
      `[data-testid="studio-coverage-playback"] [data-shot-id="${secondShotId}"] [data-coverage-shot-selector]`
    );
    await secondShotSelector.click();
    await expect(beatDialog.getByRole('textbox', { name: 'Shooting script for Shot 2', exact: true })).toHaveValue(
      secondShootingScript
    );
    await expect(beatDialog.locator('textarea[aria-label="Story"]')).toHaveCount(1);
    await expect(beatDialog.locator('textarea[aria-label^="Shooting script for Shot "]')).toHaveCount(2);
    await beatDialog.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(beatDialog).toBeHidden();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table', {
      timeout: studioFakeMediaTimeoutMs,
    });
    await page.locator(viewNavigationSelector).getByRole('link', { name: 'Board', exact: true }).click();
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');
    const drawNextBoardBatch = page.getByRole('button', { name: 'Draw next batch (2)', exact: true });
    await expect(drawNextBoardBatch).toBeEnabled({ timeout: studioFakeMediaTimeoutMs });
    await drawNextBoardBatch.click();
    const boardGate = page.locator('[data-testid="studio-spend-gate"]');
    await expect
      .poll(async () => {
        if (await boardGate.isVisible()) return 'gate';
        const alerts = (await page.getByRole('alert').allTextContents()).map((text) => text.trim()).filter(Boolean);
        return alerts.join(' | ') || 'silent guard';
      })
      .toBe('gate');
    const boardConfirm = boardGate.getByRole('button', { name: /^Confirm 2 generations/ });
    await expect(boardConfirm).toBeEnabled({ timeout: 30_000 });
    const showBoardRows = boardGate.getByRole('button', { name: 'Show each generation', exact: true });
    await expect(showBoardRows).toHaveAttribute('aria-expanded', 'false');
    await showBoardRows.click();
    await expect(boardGate.getByRole('button', { name: 'Hide each generation', exact: true })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
    const boardRows = boardGate.locator('[data-generation-purpose="board_still"]');
    await expect(boardRows).toHaveCount(2);
    const boardQuotePrompts = await boardRows.locator('pre').allTextContents();
    const boardConfirmation = observeNextStudioBridgeResult(page, 'confirm-submission', 90_000);
    await boardConfirmation.ready;
    await boardConfirm.click();
    expect(await boardConfirmation.result).toMatchObject({ ok: true });
    await expect(boardGate.getByText('Confirmed. The safe project and workspace status are refreshing.')).toBeVisible({
      timeout: 30_000,
    });
    await boardGate.getByRole('button', { name: 'Close — spend nothing', exact: true }).click();

    await expect
      .poll(
        async () => {
          const project = await readStudioProject(page, projectId);
          return [firstShotId, secondShotId].map((shotId) => {
            const job = findStudioShotJob(project, shotId, 'board_still');
            return {
              status: job?.status ?? null,
              errorCode: job?.error?.code ?? null,
              errorMessage: job?.error?.message ?? null,
              providerJobId: job?.providerJobId ?? null,
              hasSpendReceipt: job?.spendReceipt !== null && job?.spendReceipt !== undefined,
            };
          });
        },
        { timeout: studioFakeMediaTimeoutMs }
      )
      .toEqual([
        {
          status: 'succeeded',
          errorCode: null,
          errorMessage: null,
          providerJobId: null,
          hasSpendReceipt: true,
        },
        {
          status: 'succeeded',
          errorCode: null,
          errorMessage: null,
          providerJobId: null,
          hasSpendReceipt: true,
        },
      ]);
    const boarded = await readStableStudioProject(page, projectId);
    const firstBoardJob = findStudioShotJob(boarded, firstShotId, 'board_still');
    const secondBoardJob = findStudioShotJob(boarded, secondShotId, 'board_still');
    const firstBoardAssetId = firstBoardJob?.outputAssetIdsByRole.primary;
    const secondBoardAssetId = secondBoardJob?.outputAssetIdsByRole.primary;
    if (
      firstBoardJob === undefined ||
      secondBoardJob === undefined ||
      firstBoardAssetId === null ||
      firstBoardAssetId === undefined ||
      secondBoardAssetId === null ||
      secondBoardAssetId === undefined
    ) {
      throw new Error('Board outputs were unavailable');
    }
    expect([firstBoardJob.composition.prompt, secondBoardJob.composition.prompt]).toEqual(boardQuotePrompts);
    const providerRequestsAfterBoard = await readStudioE2EProviderRequests(userDataDirectory);
    expect(providerRequestsAfterBoard).toHaveLength(5);
    expect(providerRequestsAfterBoard.slice(0, 3).map(({ prompt }) => prompt)).toEqual([
      ...characterReview.prompts,
      ...backgroundReview.prompts,
    ]);
    const boardProviderRequests = providerRequestsAfterBoard.slice(3);
    const boardProviderRequestByPrompt = new Map(boardProviderRequests.map((request) => [request.prompt, request]));
    expect(boardProviderRequestByPrompt.size).toBe(2);
    expect(boardProviderRequestByPrompt.get(firstBoardJob.composition.prompt)?.conditioningAssetIds).toEqual([
      mingAssetId,
      meiAssetId,
      backgroundAssetId,
    ]);
    expect(boardProviderRequestByPrompt.get(secondBoardJob.composition.prompt)?.conditioningAssetIds).toEqual([
      meiAssetId,
      mingAssetId,
      backgroundAssetId,
    ]);
    expect(boardProviderRequests.every(({ firstFrameAssetId }) => firstFrameAssetId === null)).toBe(true);
    const firstExpectedReferenceInputs = [mingAssetId, meiAssetId, backgroundAssetId].map((assetId) => ({
      referenceId: boarded.assets[assetId]!.projectReferenceId,
      kind: boarded.references[boarded.assets[assetId]!.projectReferenceId!]!.kind,
      assetId,
      sha256: boarded.assets[assetId]!.sha256,
    }));
    const secondExpectedReferenceInputs = [meiAssetId, mingAssetId, backgroundAssetId].map((assetId) => ({
      referenceId: boarded.assets[assetId]!.projectReferenceId,
      kind: boarded.references[boarded.assets[assetId]!.projectReferenceId!]!.kind,
      assetId,
      sha256: boarded.assets[assetId]!.sha256,
    }));
    expect(firstBoardJob).toMatchObject({
      target: { kind: 'shot', shotId: firstShotId },
      purpose: 'board_still',
      composition: {
        inputs: {
          source: {
            kind: 'shot',
            beatId,
            story: beatStory,
            shotId: firstShotId,
            shootingScript: firstShootingScript,
          },
          purpose: 'board_still',
          referenceInputs: firstExpectedReferenceInputs,
        },
      },
    });
    expect(secondBoardJob).toMatchObject({
      target: { kind: 'shot', shotId: secondShotId },
      purpose: 'board_still',
      composition: {
        inputs: {
          source: {
            kind: 'shot',
            beatId,
            story: beatStory,
            shotId: secondShotId,
            shootingScript: secondShootingScript,
          },
          purpose: 'board_still',
          referenceInputs: secondExpectedReferenceInputs,
        },
      },
    });
    expect(boarded.assets[firstBoardAssetId]).toMatchObject({
      projectReferenceId: null,
      producerJobId: firstBoardJob.id,
      generationReferenceAssetIds: [mingAssetId, meiAssetId, backgroundAssetId],
      compositionDigest: studioGenerationCompositionDigestV2(firstBoardJob.composition),
    });
    expect(boarded.assets[secondBoardAssetId]).toMatchObject({
      projectReferenceId: null,
      producerJobId: secondBoardJob.id,
      generationReferenceAssetIds: [meiAssetId, mingAssetId, backgroundAssetId],
      compositionDigest: studioGenerationCompositionDigestV2(secondBoardJob.composition),
    });

    await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
      projectId,
      expectedRevision: boarded.revision,
      operations: [{ kind: 'promote_board_panel', shotId: firstShotId, boardAssetId: firstBoardAssetId }],
    });
    const reviewedFirstFrame = await readStableStudioProject(page, projectId);
    const videoQuote = await invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(page, 'prepare-submission', {
      projectId,
      expectedRevision: reviewedFirstFrame.revision,
      originReferenceHandoffId: null,
      baseChoices: [{ target: { kind: 'shot', shotId: firstShotId }, purpose: 'video_take' }],
      cascadeChoices: [],
    });
    await invokeStudioBridge<StudioConfirmSubmissionResultV2>(
      page,
      'confirm-submission',
      {
        projectId,
        quoteId: videoQuote.baseOnly.id,
        expectedRevision: videoQuote.baseOnly.projectRevision,
      },
      90_000
    );
    await expect
      .poll(
        async () => findStudioShotJob(await readStudioProject(page, projectId), firstShotId, 'video_take')?.status,
        { timeout: studioFakeMediaTimeoutMs }
      )
      .toBe('succeeded');
    const videoRequest = (await readStudioE2EProviderRequests(userDataDirectory)).at(-1);
    expect(videoRequest).toMatchObject({
      mediaKind: 'video',
      prompt: videoQuote.baseOnly.baseItems[0]?.composition.prompt,
      conditioningAssetIds: [],
      firstFrameAssetId: firstBoardAssetId,
    });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.locator(viewNavigationSelector).getByRole('link', { name: 'References', exact: true }).click();
    const reloaded = await readStableStudioProject(page, projectId);
    expect(reloaded.referenceOrder).toEqual([mingId, meiId, backgroundId]);
    expect(reloaded.references[mingId]?.approvedAssetId).toBe(mingAssetId);
    expect(reloaded.references[meiId]?.approvedAssetId).toBe(meiAssetId);
    expect(reloaded.references[backgroundId]?.approvedAssetId).toBe(backgroundAssetId);
    for (const referenceId of [mingId, meiId, backgroundId]) {
      expect(reloaded.references[referenceId]?.supersededAssetIds).toEqual([]);
    }
    expect(reloaded.shots[firstShotId]?.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [mingId, meiId],
      backgroundReferenceId: backgroundId,
    });
    expect(reloaded.shots[secondShotId]?.referenceBinding).toEqual({
      status: 'ready',
      characterReferenceIds: [meiId, mingId],
      backgroundReferenceId: backgroundId,
    });
    expect(reloaded.jobs[firstBoardJob.id]?.composition).toEqual(firstBoardJob.composition);
    expect(reloaded.jobs[secondBoardJob.id]?.composition).toEqual(secondBoardJob.composition);
    expect(reloaded.assets[firstBoardAssetId]).toEqual(boarded.assets[firstBoardAssetId]);
    expect(reloaded.assets[secondBoardAssetId]).toEqual(boarded.assets[secondBoardAssetId]);
    await expect(page.locator('[data-studio-references-view] [data-reference-id]')).toHaveCount(3);
    await expect(page.locator('[data-studio-references-view] [data-shot-binding-status]')).toHaveCount(0);
    const reloadedHandoffs = await invokeStudioBridge<StudioRendererReferenceGenerationHandoffV2[]>(
      page,
      'list-reference-generation-handoffs',
      { projectId }
    );
    expect(reloadedHandoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          handoffId: characterReview.handoff.handoffId,
          referenceIds: [mingId, meiId],
          resultAssetIds: [mingAssetId, meiAssetId],
          status: 'succeeded',
          completedAt: expect.any(String),
        }),
        expect.objectContaining({
          handoffId: backgroundReview.handoff.handoffId,
          referenceIds: [backgroundId],
          resultAssetIds: [backgroundAssetId],
          status: 'succeeded',
          completedAt: expect.any(String),
        }),
      ])
    );
  });

  test('traverses the 24-Beat Table without mutating the project or paid work', async ({ electronApp, page }) => {
    const projectBrief = `A 24-beat keyboard story ${Date.now()}.`;

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+$/);

    const projectId = projectIdFromStudioUrl(page);
    const authoringBase = await readStableStudioProject(page, projectId);
    const beatIds = Array.from({ length: 24 }, (_, index) => `beat_table_${String(index + 1).padStart(2, '0')}`);
    const maxDurationShotIds = Array.from(
      { length: 8 },
      (_, index) => `shot_table_max_${String(index + 1).padStart(2, '0')}`
    );
    const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
      projectId,
      expectedRevision: authoringBase.revision,
      operations: [
        ...beatIds.map((beatId, index) => ({
          kind: 'add_beat' as const,
          beatId,
          beat: {
            title: `Table beat ${String(index + 1).padStart(2, '0')}`,
            story:
              index % 3 === 0
                ? `Show story moment ${index + 1}.`
                : `Show story moment ${index + 1} with visual direction ${index + 1}.`,
            targetSeconds: index === 23 ? 1_440 : index % 2 === 0 ? null : 7,
          },
          beforeBeatId: null,
        })),
        ...maxDurationShotIds.map((shotId, index) => ({
          kind: 'add_shot' as const,
          beatId: beatIds[0]!,
          shotId,
          shot: {
            shootingScript: `Maximum-duration Shot ${index + 1}.`,
            durationSeconds: 15,
          },
          beforeShotId: null,
        })),
      ],
    });
    expect(authored.createdBeatIds).toEqual(beatIds);
    expect(authored.createdShotIds).toEqual(maxDurationShotIds);

    await page.setViewportSize({ width: 1_440, height: 900 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    const grid = page.getByRole('grid', { name: 'Beat table' });
    await expect(grid).toBeVisible();
    await expectFoldedTableFits(grid);
    await expect(grid.getByRole('row')).toHaveCount(25);
    const rows = grid.getByRole('row');
    await expect(rows.nth(1).getByRole('gridcell')).toHaveCount(6);
    await expect(grid.locator('[data-grid-column-name="state"]')).toHaveCount(0);
    await expect(grid.locator('[data-state]')).toHaveCount(0);
    await expect(rows.nth(1).locator('[data-grid-column-name="shots"]')).toContainText('8 shots');
    await expect(rows.nth(1).locator('[data-duration-kind="planned"]')).toHaveText('120s');
    await expect(rows.nth(1).locator('[data-duration-kind]')).toHaveCount(1);
    await expect(rows.nth(24).locator('[data-duration-kind="planned"]')).toHaveText('No planned sum');
    await expect(rows.nth(24).locator('[data-duration-kind]')).toHaveCount(1);

    const directorToggle = page.locator('[data-studio-director-toggle]');
    await expect(directorToggle).toHaveAttribute('aria-expanded', 'true');
    await directorToggle.evaluate((element: HTMLElement) => element.click());
    await expect(directorToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(grid.getByRole('columnheader')).toHaveCount(6);

    const firstLengthCell = rows.nth(1).locator('[data-grid-column-name="length"]');
    await firstLengthCell.focus();
    const firstLengthHandle = await firstLengthCell.elementHandle();
    if (firstLengthHandle === null) throw new Error('Table Sum cell was unavailable');
    await directorToggle.evaluate((element: HTMLElement) => element.click());
    await expect(directorToggle).toHaveAttribute('aria-expanded', 'true');
    await expectFoldedTableFits(grid);
    expect(await firstLengthHandle.evaluate((element) => element === document.activeElement)).toBe(true);
    await expect(firstLengthCell).toBeFocused();
    await expect(grid.locator('[role="gridcell"][tabindex="0"]')).toHaveCount(1);

    await directorToggle.evaluate((element: HTMLElement) => element.click());
    await expect(grid.getByRole('columnheader')).toHaveCount(6);
    expect(await firstLengthHandle.evaluate((element) => element === document.activeElement)).toBe(true);
    const firstStoryCell = rows.nth(1).locator('[data-grid-column-name="story"]');
    await firstStoryCell.focus();
    await directorToggle.evaluate((element: HTMLElement) => element.click());
    await expectFoldedTableFits(grid);
    await expect(rows.nth(1).locator('[data-grid-column-name="story"]')).toBeFocused();

    const root = page.locator('html');
    await root.evaluate((element) => element.setAttribute('dir', 'rtl'));
    await expect(root).toHaveAttribute('dir', 'rtl');
    await expectFoldedTableFits(grid);
    await root.evaluate((element) => element.setAttribute('dir', 'ltr'));
    await expect(root).toHaveAttribute('dir', 'ltr');

    const firstCell = rows.nth(1).getByRole('gridcell').first();
    await firstCell.focus();
    await firstCell.press('ArrowDown');
    const secondCell = rows.nth(2).getByRole('gridcell').first();
    await expect(secondCell).toBeFocused();
    const focusPaint = await secondCell.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    expect(
      (focusPaint.outlineStyle !== 'none' && focusPaint.outlineWidth !== '0px') || focusPaint.boxShadow !== 'none'
    ).toBe(true);
    for (let index = 2; index < 24; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- traversal observes the focus produced by each prior key
      await page.keyboard.press('ArrowDown');
    }
    const lastCell = rows.nth(24).getByRole('gridcell').first();
    await expect(lastCell).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(lastCell).toBeFocused();
    await lastCell.press('Enter');
    const lastReorderHandle = rows.nth(24).getByRole('button', {
      name: 'Reorder Table beat 24 at position 24',
    });
    await expect(lastReorderHandle).toBeFocused();
    await lastReorderHandle.press('Escape');
    await expect(lastCell).toBeFocused();
    const lastBeatCell = rows.nth(24).locator('[data-grid-column-name="beat"]');
    await lastBeatCell.focus();
    await lastBeatCell.press('Enter');
    await expect(rows.nth(24)).toHaveAttribute('aria-selected', 'true');
    const beatPanel = page.getByRole('dialog', { name: 'Beat panel — Table beat 24' });
    await expect(beatPanel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(beatPanel).toBeHidden();
    await expect(rows.nth(24)).toHaveAttribute('aria-selected', 'true');

    await expect(rows.nth(1)).not.toContainText(/\b0s\b/);
    await expect(rows.nth(2)).toContainText('No planned sum');
    await expect(rows.nth(3)).toContainText('No planned sum');

    const beforeNavigation = await readStudioProject(page, projectId);
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const providerCallsBeforeNavigation =
      process.env.AIONUI_E2E_STUDIO_FAKE === '1' ? await readStudioE2EProviderCallCounts(userDataDirectory) : null;
    const navigation = page.locator(viewNavigationSelector);
    await navigation.getByRole('link', { name: 'Board' }).click();
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');
    const board = page.getByRole('list', { name: 'Beat board' });
    const boardCards = board.locator(':scope > [data-beat-id]');
    const firstBoardCard = boardCards.nth(0);
    const selectedBoardCard = boardCards.nth(23);
    const firstBoardOpener = firstBoardCard.getByRole('button', { name: 'Open Table beat 01' });
    const selectedBoardOpener = selectedBoardCard.getByRole('button', { name: 'Open Table beat 24' });
    const firstBoardActions = firstBoardCard.getByRole('group', { name: 'Actions for 1. Table beat 01' });

    await expect(directorToggle).toHaveAttribute('aria-expanded', 'false');
    await expect(boardCards).toHaveCount(24);
    await expect(page.getByRole('group', { name: 'Board card size' })).toHaveCount(0);
    await expect(board).not.toHaveAttribute('data-card-size');
    await expect(firstBoardCard.getByRole('button')).toHaveCount(2);
    await expect(firstBoardActions).toBeVisible();
    await expect(selectedBoardCard.getByRole('group', { name: /Actions for/ })).toHaveCount(0);
    await expect(selectedBoardOpener).toHaveAttribute('aria-current', 'true');
    await expect(board.getByRole('group', { name: /Actions for/ })).toHaveCount(1);

    const expectBoardGeometry = async (direction: 'ltr' | 'rtl'): Promise<void> => {
      await root.evaluate((element, nextDirection) => element.setAttribute('dir', nextDirection), direction);
      await expect(root).toHaveAttribute('dir', direction);
      const geometry = await board.evaluate((element) => {
        const cards = Array.from(element.querySelectorAll<HTMLElement>(':scope > [data-beat-id]')).slice(0, 4);
        const cardRects = cards.map((card) => card.getBoundingClientRect());
        const media =
          cards[0]?.querySelector<HTMLElement>('[data-shot-tile] [data-media-kind]')?.getBoundingClientRect() ?? null;
        const bounds = element.getBoundingClientRect();
        const workScroll = element.closest<HTMLElement>('[data-studio-work-scroll]');
        const workScrollBounds = workScroll?.getBoundingClientRect() ?? null;
        return {
          cardRects: cardRects.map(({ bottom, height, left, right, top, width }) => ({
            bottom,
            height,
            left,
            right,
            top,
            width,
          })),
          clientWidth: element.clientWidth,
          columnCount: getComputedStyle(element).gridTemplateColumns.split(' ').filter(Boolean).length,
          media: media === null ? null : { height: media.height, width: media.width },
          left: bounds.left,
          right: bounds.right,
          scrollWidth: element.scrollWidth,
          workScroll:
            workScroll === null || workScrollBounds === null
              ? null
              : {
                  clientWidth: workScroll.clientWidth,
                  left: workScrollBounds.left,
                  right: workScrollBounds.right,
                  scrollWidth: workScroll.scrollWidth,
                },
        };
      });
      expect(geometry.columnCount).toBe(1);
      expect(geometry.cardRects).toHaveLength(4);
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.clientWidth + 1);
      expect(geometry.workScroll).not.toBeNull();
      expect(geometry.workScroll!.scrollWidth).toBeLessThanOrEqual(geometry.workScroll!.clientWidth + 1);
      expect(geometry.left).toBeGreaterThanOrEqual(geometry.workScroll!.left - 1);
      expect(geometry.right).toBeLessThanOrEqual(geometry.workScroll!.right + 1);
      for (const card of geometry.cardRects) {
        expect(card.left).toBeGreaterThanOrEqual(geometry.left - 1);
        expect(card.right).toBeLessThanOrEqual(geometry.right + 1);
      }
      for (let index = 1; index < geometry.cardRects.length; index += 1) {
        expect(geometry.cardRects[index]!.top).toBeGreaterThan(geometry.cardRects[index - 1]!.bottom);
        expect(Math.abs(geometry.cardRects[0]!.width - geometry.cardRects[index]!.width)).toBeLessThanOrEqual(1);
      }
      expect(geometry.media).not.toBeNull();
      expect(geometry.media!.width / geometry.media!.height).toBeCloseTo(16 / 9, 1);
    };

    await expectBoardGeometry('ltr');
    const titleStyle = async (): Promise<{
      backgroundColor: string;
      boxShadow: string;
      color: string;
      fontFamily: string;
      fontSize: string;
      fontWeight: string;
      ring: string;
    }> =>
      firstBoardOpener.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          boxShadow: style.boxShadow,
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          ring: getComputedStyle(element, '::before').boxShadow,
        };
      });
    const titleStyleBeforeHover = await titleStyle();
    expect(titleStyleBeforeHover).toMatchObject({
      backgroundColor: 'rgba(0, 0, 0, 0)',
      boxShadow: 'none',
      fontSize: '13px',
      fontWeight: '600',
    });
    expect(titleStyleBeforeHover.fontFamily).toContain('Manrope');
    await firstBoardCard.scrollIntoViewIfNeeded();
    await expect(firstBoardCard).toBeVisible();
    const firstMediaBox = await firstBoardCard.locator('[data-shot-tile] [data-media-kind]').first().boundingBox();
    if (firstMediaBox === null) throw new Error('The first Board Shot media geometry was unavailable');
    await page.mouse.move(firstMediaBox.x + firstMediaBox.width / 2, firstMediaBox.y + firstMediaBox.height / 2);
    expect(await titleStyle()).toEqual(titleStyleBeforeHover);
    await firstBoardOpener.focus();
    await page.keyboard.press('Tab');
    await expect(firstBoardActions.getByRole('button', { name: 'Draw missing (8) · 1. Table beat 01' })).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(firstBoardOpener).toBeFocused();
    await expectBoardGeometry('rtl');
    await root.evaluate((element) => element.setAttribute('dir', 'ltr'));
    await expect(root).toHaveAttribute('dir', 'ltr');

    await firstBoardCard.scrollIntoViewIfNeeded();
    await expect(firstBoardCard).toBeVisible();
    await firstBoardOpener.focus();
    await firstBoardOpener.dispatchEvent('click');
    const firstBoardPanel = page.getByRole('dialog', { name: 'Beat panel — Table beat 01' });
    await expect(firstBoardPanel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(firstBoardPanel).toBeHidden();
    await expect(firstBoardOpener).toHaveAttribute('aria-current', 'true');

    await selectedBoardOpener.focus();
    await selectedBoardOpener.dispatchEvent('click');
    const selectedBoardPanel = page.getByRole('dialog', { name: 'Beat panel — Table beat 24' });
    await expect(selectedBoardPanel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(selectedBoardPanel).toBeHidden();
    await expect(selectedBoardOpener).toHaveAttribute('aria-current', 'true');
    await navigation.getByRole('link', { name: 'Cut' }).click();
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');
    await navigation.getByRole('link', { name: 'Table' }).click();
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table');
    await expect(page.getByRole('grid', { name: 'Beat table' }).getByRole('row').nth(24)).toHaveAttribute(
      'aria-selected',
      'true'
    );

    expect(await readStudioProject(page, projectId)).toEqual(beforeNavigation);
    if (providerCallsBeforeNavigation !== null) {
      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeNavigation);
    }
  });

  test('edits a selected Beat and moves a coverage boundary without crossing the paid boundary', async ({
    electronApp,
    page,
  }) => {
    test.skip(
      process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
      'The provider-call oracle requires the explicit development-only Studio fake adapter.'
    );

    const projectBrief = `A keyboard coverage edit ${Date.now()}.`;
    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+$/);

    const projectId = projectIdFromStudioUrl(page);
    const beatId = `beat_panel_e2e_${Date.now()}`;
    const firstShotId = `shot_panel_a_${Date.now()}`;
    const secondShotId = `shot_panel_b_${Date.now()}`;
    const authoringBase = await readStableStudioProject(page, projectId);
    const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
      projectId,
      expectedRevision: authoringBase.revision,
      operations: [
        {
          kind: 'add_beat',
          beatId,
          beat: {
            title: 'Panel keyboard Beat',
            story: 'The plane crosses the workbench in soft studio light.',
            targetSeconds: 12,
          },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: firstShotId,
          shot: { shootingScript: 'The plane enters.', durationSeconds: 6 },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: secondShotId,
          shot: { shootingScript: 'The plane settles.', durationSeconds: 6 },
          beforeShotId: null,
        },
      ],
    });
    expect(authored).toMatchObject({ createdBeatIds: [beatId], createdShotIds: [firstShotId, secondShotId] });

    await page.reload({ waitUntil: 'domcontentloaded' });
    const row = page
      .getByRole('grid', { name: 'Beat table' })
      .getByRole('row')
      .filter({ hasText: 'Panel keyboard Beat' });
    const beatCell = row.locator('[data-grid-column-name="beat"]');
    await beatCell.focus();
    await beatCell.press('Enter');

    const panel = page.getByRole('dialog', { name: 'Beat panel — Panel keyboard Beat' });
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Story', exact: true }).click();
    const beatMenuTrigger = panel.locator('[data-beat-overflow-trigger]');
    const storyEditor = panel.getByRole('textbox', { name: 'Story', exact: true });
    await expect(storyEditor).toHaveValue('The plane crosses the workbench in soft studio light.');
    await expect(panel.getByRole('spinbutton', { name: /Beat target/i })).toHaveCount(0);
    await beatMenuTrigger.click();
    await expect(page.getByRole('menuitem', { name: /Beat target/i })).toHaveCount(0);
    await beatMenuTrigger.click();
    await expect(panel.locator('article[data-shot-id]')).toHaveCount(2);

    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const providerCallsBefore = await readStudioE2EProviderCallCounts(userDataDirectory);
    const beforeReset = await readStudioProject(page, projectId);
    await storyEditor.fill('This local reset value must never persist.');
    await beatMenuTrigger.click();
    await page.getByRole('menuitem', { name: 'Reset Beat', exact: true }).click();
    await expect(storyEditor).toHaveValue('The plane crosses the workbench in soft studio light.');
    expect(await readStudioProject(page, projectId)).toEqual(beforeReset);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBefore);

    const revisedStory =
      'soft silver morning light drifts across paper wings while shallow focus keeps the desk calm warm tactile quiet precise hopeful airy restrained cinematic natural gentle luminous';
    await storyEditor.fill(revisedStory);
    await beatMenuTrigger.click();
    await page.getByRole('menuitem', { name: 'Save Beat', exact: true }).click();
    await expect.poll(async () => (await readStudioProject(page, projectId)).beats[beatId]?.story).toBe(revisedStory);

    const afterStorySave = await readStudioProject(page, projectId);
    expect(afterStorySave.revision).toBe(beforeReset.revision + 1);
    expect(afterStorySave.beats[beatId]).toEqual({ ...beforeReset.beats[beatId], story: revisedStory });
    expect(afterStorySave.assets).toEqual(beforeReset.assets);
    expect(afterStorySave.jobs).toEqual(beforeReset.jobs);
    expect(Object.hasOwn(afterStorySave, 'frameExtractions')).toBe(false);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBefore);

    const boundary = panel.getByRole('slider', { name: 'Boundary after Shot 1' });
    await expect(boundary).toBeEnabled();
    await expect(boundary).toHaveAttribute('aria-valuenow', '6');
    await boundary.focus();
    await boundary.press('ArrowRight');
    await expect
      .poll(async () => {
        const project = await readStudioProject(page, projectId);
        return [project.shots[firstShotId]?.durationSeconds, project.shots[secondShotId]?.durationSeconds];
      })
      .toEqual([7, 5]);

    const afterBoundary = await readStudioProject(page, projectId);
    expect(afterBoundary.revision).toBe(afterStorySave.revision + 1);
    expect(afterBoundary.shots[firstShotId]).toEqual({ ...afterStorySave.shots[firstShotId], durationSeconds: 7 });
    expect(afterBoundary.shots[secondShotId]).toEqual({ ...afterStorySave.shots[secondShotId], durationSeconds: 5 });
    expect(
      (afterBoundary.shots[firstShotId]?.durationSeconds ?? 0) +
        (afterBoundary.shots[secondShotId]?.durationSeconds ?? 0)
    ).toBe(12);
    expect(afterBoundary.assets).toEqual(afterStorySave.assets);
    expect(afterBoundary.jobs).toEqual(afterStorySave.jobs);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBefore);

    await beatMenuTrigger.click();
    await page.getByRole('menuitem', { name: 'Ask Director to re-split', exact: true }).click();
    await expect(panel).toBeHidden();
    const directorToggle = page.locator('[data-studio-director-toggle]');
    await expect(directorToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(directorToggle).toBeFocused();
    expect(await readStudioProject(page, projectId)).toEqual(afterBoundary);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBefore);
  });

  test.describe.serial('Rendered Shot Gate-3 lifecycle', () => {
    test('trims and rerenders a continuous chain while proving stable lift refusal states', async ({
      electronApp,
      page,
    }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The terminal Shot lifecycle requires the explicit development-only Studio fake adapter.'
      );
      test.setTimeout(180_000);

      const projectBrief = 'A rendered paper-airplane landing.';
      await navigateTo(page, ROUTES.studio);
      const workspace = page.locator(workspaceSelector);
      await workspace.getByLabel('What do you want to make?').fill(projectBrief);
      await workspace.getByRole('button', { name: 'Create project' }).click();
      await expect(page).toHaveURL(/#\/studio\/[^/]+$/);

      const projectId = projectIdFromStudioUrl(page);
      const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
      const beatId = `beat_e2e_${Date.now()}`;
      const shotId = `shot_e2e_${Date.now()}`;
      const anchorShotId = `shot_anchor_e2e_${Date.now()}`;
      const routes = await invokeStudioBridge<StudioRouteCatalogV2>(page, 'list-routes', { projectId });
      const imageRouteId = routes.image.options[0]?.choiceId;
      const videoRouteId = routes.video.options[0]?.choiceId;
      expect(routes.image.options.length).toBeGreaterThan(0);
      expect(routes.video.options.length).toBeGreaterThan(0);
      expect(imageRouteId).toBeTruthy();
      expect(videoRouteId).toBeTruthy();
      const authoringBase = await readStableStudioProject(page, projectId);

      const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
        projectId,
        expectedRevision: authoringBase.revision,
        operations: [
          ...(authoringBase.imageRouteId === imageRouteId && authoringBase.videoRouteId === videoRouteId
            ? []
            : [{ kind: 'set_routes' as const, imageRouteId, videoRouteId }]),
          {
            kind: 'add_beat',
            beatId,
            beat: {
              title: 'Landing',
              story: 'The plane settles on the desk in soft morning light.',
              targetSeconds: 16,
            },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId,
            shotId,
            shot: { shootingScript: 'The plane lands.', durationSeconds: 8 },
            beforeShotId: null,
          },
          {
            kind: 'add_shot',
            beatId,
            shotId: anchorShotId,
            shot: { shootingScript: 'The desk remains in view.', durationSeconds: 8 },
            beforeShotId: null,
          },
          { kind: 'set_reference_plan', references: [] },
          {
            kind: 'set_shot_reference_binding',
            shotId,
            characterReferenceIds: [],
            backgroundReferenceId: null,
          },
          {
            kind: 'set_shot_reference_binding',
            shotId: anchorShotId,
            characterReferenceIds: [],
            backgroundReferenceId: null,
          },
        ],
      });
      expect(authored).toMatchObject({
        projectId,
        createdBeatIds: [beatId],
        createdShotIds: [shotId, anchorShotId],
      });

      const prepared = await invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(page, 'prepare-submission', {
        projectId,
        expectedRevision: authored.projectRevision,
        originReferenceHandoffId: null,
        baseChoices: [{ target: { kind: 'shot', shotId }, purpose: 'seed_still' }],
        cascadeChoices: [
          { target: { kind: 'shot', shotId }, purpose: 'video_take' },
          { target: { kind: 'shot', shotId: anchorShotId }, purpose: 'video_take' },
        ],
      });
      expect(prepared.withCascade).not.toBeNull();
      expect(
        prepared.withCascade?.cascadeItems.map(({ target, purpose }) => [
          target.kind === 'shot' ? target.shotId : target.referenceId,
          purpose,
        ])
      ).toEqual([
        [shotId, 'video_take'],
        [anchorShotId, 'video_take'],
      ]);
      await invokeStudioBridge<StudioConfirmSubmissionResultV2>(
        page,
        'confirm-submission',
        {
          projectId,
          quoteId: prepared.withCascade!.id,
          expectedRevision: authored.projectRevision,
        },
        90_000
      );

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const seed = findStudioShotJob(project, shotId, 'seed_still');
            const video = findStudioShotJob(project, shotId, 'video_take');
            const downstreamVideo = findStudioShotJob(project, anchorShotId, 'video_take');
            return {
              seedStatus: seed?.status ?? null,
              seedAssetId: seed?.outputAssetIdsByRole.primary ?? null,
              videoStatus: video?.status ?? null,
              downstreamVideoStatus: downstreamVideo?.status ?? null,
            };
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual({
          seedStatus: 'succeeded',
          seedAssetId: expect.any(String),
          videoStatus: 'waiting_for_conditioning',
          downstreamVideoStatus: 'waiting_for_conditioning',
        });

      const seededProject = await readStudioProject(page, projectId);
      const seedAssetId = findStudioShotJob(seededProject, shotId, 'seed_still')?.outputAssetIdsByRole.primary;
      expect(seedAssetId).toBeTruthy();

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      const seededRow = page.getByRole('grid', { name: 'Beat table' }).getByRole('row').filter({ hasText: 'Landing' });
      await seededRow.locator('[data-grid-column-name="beat"]').click();
      const seededPanel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
      const seededShotCard = seededPanel.locator(`article[data-shot-id="${shotId}"]`);
      const ownInFlightLift = seededShotCard.locator('[data-shot-overflow-trigger]');
      await expect(ownInFlightLift).toBeEnabled();
      await expect(
        seededShotCard.getByText('This item has generation work in progress.', { exact: true })
      ).toBeVisible();
      const seededBeatLift = seededPanel.locator('[data-beat-overflow-trigger]');
      await expect(seededBeatLift).toBeEnabled();
      const ownInFlightSnapshot = await captureStudioNoMutationSnapshot(page, userDataDirectory, projectId);
      await ownInFlightLift.click();
      const shotMoveToBin = page.locator('[data-shot-move-to-bin]');
      await expect(shotMoveToBin).toHaveClass(/arco-dropdown-menu-disabled/);
      await shotMoveToBin.evaluate((item: HTMLElement) => item.click());
      await seededBeatLift.click();
      const beatMoveToBin = page.locator('[data-beat-move-to-bin]');
      await expect(beatMoveToBin).toHaveClass(/arco-dropdown-menu-disabled/);
      await beatMoveToBin.evaluate((item: HTMLElement) => item.click());
      await expectStudioNoMutation(page, userDataDirectory, projectId, ownInFlightSnapshot);
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-shot-own-inflight.png');
      await seededPanel.getByRole('button', { name: 'Close' }).click();

      const seededNavigation = page.locator(viewNavigationSelector);
      await seededNavigation.getByRole('link', { name: 'Board' }).click();
      const seededBeatCard = page.locator(`[data-beat-id="${beatId}"]`);
      await expect(seededBeatCard.getByRole('button', { name: 'Move to Bin' })).toHaveCount(0);
      await expect(page.locator('[data-studio-bin]')).toContainText('The Bin is empty.');
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-beat-inflight-blockers.png');
      await seededNavigation.getByRole('link', { name: 'Table' }).click();
      await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table');

      await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
        projectId,
        expectedRevision: seededProject.revision,
        operations: [{ kind: 'set_seed_still', shotId, assetId: seedAssetId }],
      });

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const video = findStudioShotJob(project, shotId, 'video_take');
            return {
              status: video?.status ?? null,
              assetId: video?.outputAssetIdsByRole.primary ?? null,
              errorCode: video?.error?.code ?? null,
            };
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual({ status: 'succeeded', assetId: expect.any(String), errorCode: null });

      const renderedProject = await readStudioProject(page, projectId);
      const videoAssetId = findStudioShotJob(renderedProject, shotId, 'video_take')?.outputAssetIdsByRole.primary;
      expect(videoAssetId).toBeTruthy();
      expect(renderedProject.shots[shotId]?.seedStillId).toBe(seedAssetId);
      expect(renderedProject.shots[shotId]?.videoAssetId).toBe(videoAssetId);

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const video = findStudioShotJob(project, anchorShotId, 'video_take');
            return {
              status: video?.status ?? null,
              assetId: video?.outputAssetIdsByRole.primary ?? null,
              errorCode: video?.error?.code ?? null,
            };
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual({ status: 'succeeded', assetId: expect.any(String), errorCode: null });

      const chainedProject = await readStudioProject(page, projectId);
      const anchorVideoAssetId = findStudioShotJob(chainedProject, anchorShotId, 'video_take')?.outputAssetIdsByRole
        .primary;
      expect(anchorVideoAssetId).toBeTruthy();
      expect(chainedProject.shots[anchorShotId]?.videoAssetId).toBe(anchorVideoAssetId);

      const terminal = await readStudioProject(page, projectId);
      expect(terminal.shots[shotId]?.videoAssetId).toBe(videoAssetId);
      expect(terminal.shots[anchorShotId]?.videoAssetId).toBe(anchorVideoAssetId);
      expect(terminal.assets[videoAssetId!]?.durationSeconds).toBe(10);
      expect(terminal.assets[anchorVideoAssetId!]?.durationSeconds).toBe(10);
      const initialRaw = await readRawStudioProject(userDataDirectory, projectId);
      const initialExtraction = Object.values(initialRaw.frameExtractions).find(
        (extraction) => extraction.videoAssetId === videoAssetId
      );
      expect(initialExtraction).toMatchObject({
        shotId,
        videoAssetId,
        endpointSeconds: 10,
        status: 'ready',
        frameAssetId: expect.any(String),
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table', { timeout: 30_000 });
      const briefDialog = await openStudioProjectDialog(page, briefAndRulesTitle);
      await expect(briefDialog.locator('small').filter({ hasText: 'Ready' })).toHaveCount(2);
      await closeStudioProjectDialog(briefDialog);
      const renderedRow = page
        .getByRole('grid', { name: 'Beat table' })
        .getByRole('row')
        .filter({ hasText: 'Landing' });
      await expect(renderedRow).toBeVisible();
      await renderedRow.locator('[data-grid-column-name="beat"]').click();
      const panel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
      await expect(panel).toBeVisible();
      const renderedShotCard = panel.locator(`article[data-shot-id="${shotId}"]`);
      await expect(renderedShotCard.locator('[data-action-kind="regenerate"]')).toHaveAccessibleName('Generate again');
      const beatPreview = panel.locator('[data-beat-preview]');
      const beatMedia = beatPreview.locator('video[data-beat-preview-media][data-media-kind="video"]');
      const beatTransport = panel.locator('[data-beat-transport]');
      await expect(beatPreview).toHaveAccessibleName('Beat preview');
      await expect(beatMedia).toHaveAccessibleName('Shot 01 video · The plane lands.');
      await expect(beatTransport).toHaveAccessibleName('Beat transport');
      await expect(beatTransport.locator('[data-beat-play]')).toHaveAccessibleName('Play Beat');
      await expect(beatTransport.locator('[data-beat-time]')).toHaveText('0:00 / 0:20');
      await expect(beatTransport.locator('[data-beat-next-join]')).toBeEnabled();
      await expect(beatTransport.locator('[data-beat-loop]')).toHaveAttribute('aria-pressed', 'false');
      await expect(panel.getByText('Rail · Seek · Free', { exact: true })).toBeVisible();
      const beatSeek = panel.getByRole('slider', { name: 'Beat seek rail' });
      await expect(beatSeek).toHaveAttribute('aria-valuemin', '0');
      await expect(beatSeek).toHaveAttribute('aria-valuemax', '20');
      await expect
        .poll(async () => beatMedia.evaluate((element: HTMLVideoElement) => element.currentSrc))
        .toBe(`weprompt-studio://asset/${projectId}/${videoAssetId}`);
      await expect(beatMedia).toHaveJSProperty('muted', false);
      await expect(beatMedia).toHaveJSProperty('playsInline', true);
      await expect(beatMedia).toHaveJSProperty('controls', false);
      await expect(panel.locator('audio')).toHaveCount(0);
      await beatTransport.locator('[data-beat-next-join]').click();
      await expect(beatTransport.locator('[data-beat-time]')).toHaveText('0:08 / 0:20');
      await beatSeek.focus();
      await beatSeek.press('Home');
      await expect(beatTransport.locator('[data-beat-time]')).toHaveText('0:00 / 0:20');
      const playbackLane = panel.getByRole('group', { name: 'Playback coverage' });
      const planningLane = panel.getByRole('group', { name: 'Planning overlay' });
      const firstPlaybackSegment = playbackLane.locator(`[data-shot-id="${shotId}"]`);
      const secondPlaybackSegment = playbackLane.locator(`[data-shot-id="${anchorShotId}"]`);
      await expect(firstPlaybackSegment).toContainText('10s source');
      await expect(firstPlaybackSegment.locator('[data-segment-state="rendered"]')).toHaveText('Rendered');
      await expect(secondPlaybackSegment.locator('[data-segment-state="rendered"]')).toHaveText('Rendered');
      await expect(panel.getByRole('img', { name: 'Boundary after Shot 01 · Continuity frame ready' })).toHaveAttribute(
        'data-boundary-frame',
        'on_disk'
      );
      await expect(planningLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('8s plan');

      const beforeTrim = await readStableStudioProject(page, projectId);
      const rawBeforeTrim = await readRawStudioProject(userDataDirectory, projectId);
      const providerCallsBeforeTrim = await readStudioE2EProviderCallCounts(userDataDirectory);
      const tailTrim = panel.getByRole('slider', { name: 'Trim out for Shot 1' });
      await expect(tailTrim).toBeEnabled();
      await expect(tailTrim).toHaveAttribute('aria-valuenow', '0');
      await tailTrim.focus();
      await tailTrim.press('ArrowRight');
      await expect.poll(async () => (await readStudioProject(page, projectId)).shots[shotId]?.trimOutSeconds).toBe(0.5);
      await expect(tailTrim).toBeEnabled();
      await expect(tailTrim).toHaveAttribute('aria-valuenow', '0.5');
      await tailTrim.press('ArrowRight');
      await expect.poll(async () => (await readStudioProject(page, projectId)).shots[shotId]?.trimOutSeconds).toBe(1);
      await expect(tailTrim).toBeEnabled();
      await expect(tailTrim).toHaveAttribute('aria-valuenow', '1');
      await tailTrim.press('ArrowRight');
      await expect.poll(async () => (await readStudioProject(page, projectId)).shots[shotId]?.trimOutSeconds).toBe(1.5);
      await expect(tailTrim).toBeEnabled();
      await expect(tailTrim).toHaveAttribute('aria-valuenow', '1.5');
      await tailTrim.press('ArrowRight');
      await expect.poll(async () => (await readStudioProject(page, projectId)).shots[shotId]?.trimOutSeconds).toBe(2);
      await expect(tailTrim).toHaveAttribute('aria-valuenow', '2');
      await expect(beatTransport.locator('[data-beat-time]')).toHaveText('0:00 / 0:18');
      await expect(beatSeek).toHaveAttribute('aria-valuemax', '18');
      await expect(panel.getByText('Tail trim breaks downstream continuity.')).toBeVisible();
      await expect(firstPlaybackSegment.locator('[data-segment-state="rendered"]')).toHaveText('Rendered');
      await expect(secondPlaybackSegment.locator('[data-segment-state="stale"]')).toHaveText('Stale · Still plays');
      await expect(
        panel.getByRole('img', { name: 'Boundary after Shot 01 · Continuity frame is out of date' })
      ).toHaveAttribute('data-boundary-frame', 'gone');
      const anchorShotSelector = secondPlaybackSegment.locator('[data-coverage-shot-selector]');
      await anchorShotSelector.click();
      const staleAnchorShotCard = panel.locator(`article[data-shot-id="${anchorShotId}"]`);
      await expect(staleAnchorShotCard).toBeVisible();
      const continuityWarning = staleAnchorShotCard.getByText('Continuity is out of date', { exact: true });
      await expect(continuityWarning).toBeVisible();
      await expect(staleAnchorShotCard.locator('[data-chain-state="continuous"]')).toHaveText(
        'Continues from Shot 01’s last frame'
      );
      await expect(
        staleAnchorShotCard.locator('[data-chain-state]').getByText('Continuity is out of date', { exact: true })
      ).toHaveCount(0);
      await expect(
        staleAnchorShotCard
          .locator('[data-chain-change-control]')
          .getByText('Continuity is out of date', { exact: true })
      ).toHaveCount(0);

      const trimmed = await readStudioProject(page, projectId);
      expect(trimmed.shots[shotId]).toEqual({ ...beforeTrim.shots[shotId], trimOutSeconds: 2 });
      expect(trimmed.shots[anchorShotId]).toEqual(beforeTrim.shots[anchorShotId]);
      expect(trimmed.assets).toEqual(beforeTrim.assets);
      expect(trimmed.jobs).toEqual(beforeTrim.jobs);
      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeTrim);
      expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(
        rawBeforeTrim.frameExtractions
      );

      const existingJobIds = new Set(Object.keys(trimmed.jobs));
      const rerenderPrepared = await invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(
        page,
        'prepare-submission',
        {
          projectId,
          expectedRevision: trimmed.revision,
          originReferenceHandoffId: null,
          baseChoices: [{ target: { kind: 'shot', shotId }, purpose: 'video_take' }],
          cascadeChoices: [{ target: { kind: 'shot', shotId: anchorShotId }, purpose: 'video_take' }],
        }
      );
      expect(rerenderPrepared.withCascade).not.toBeNull();
      expect(
        rerenderPrepared.withCascade?.baseItems.map(({ target, purpose }) => [
          target.kind === 'shot' ? target.shotId : target.referenceId,
          purpose,
        ])
      ).toEqual([[shotId, 'video_take']]);
      expect(
        rerenderPrepared.withCascade?.cascadeItems.map(({ target, purpose }) => [
          target.kind === 'shot' ? target.shotId : target.referenceId,
          purpose,
        ])
      ).toEqual([[anchorShotId, 'video_take']]);
      await invokeStudioBridge<StudioConfirmSubmissionResultV2>(
        page,
        'confirm-submission',
        {
          projectId,
          quoteId: rerenderPrepared.withCascade!.id,
          expectedRevision: trimmed.revision,
        },
        90_000
      );

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const firstVideo = findStudioShotJob(project, shotId, 'video_take', existingJobIds);
            const downstreamVideo = findStudioShotJob(project, anchorShotId, 'video_take', existingJobIds);
            return {
              firstStatus: firstVideo?.status ?? null,
              firstAssetId: firstVideo?.outputAssetIdsByRole.primary ?? null,
              downstreamStatus: downstreamVideo?.status ?? null,
            };
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual({
          firstStatus: 'succeeded',
          firstAssetId: expect.any(String),
          downstreamStatus: 'succeeded',
        });

      const replacementReady = await readStudioProject(page, projectId);
      const replacementFirstJob = findStudioShotJob(replacementReady, shotId, 'video_take', existingJobIds);
      const replacementVideoAssetId = replacementFirstJob?.outputAssetIdsByRole.primary;
      expect(replacementVideoAssetId).toBeTruthy();
      expect(replacementReady.assets[replacementVideoAssetId!]?.durationSeconds).toBe(10);

      expect(replacementReady.shots[shotId]?.videoAssetId).toBe(replacementVideoAssetId);
      expect(replacementReady.shots[shotId]?.trimOutSeconds).toBeNull();
      await expect
        .poll(async () => {
          const raw = await readRawStudioProject(userDataDirectory, projectId);
          return Object.values(raw.frameExtractions)
            .filter((extraction) => extraction.videoAssetId === replacementVideoAssetId)
            .map(({ shotId: extractionShotId, videoAssetId: extractionVideoAssetId, endpointSeconds }) => ({
              shotId: extractionShotId,
              videoAssetId: extractionVideoAssetId,
              endpointSeconds,
            }));
        })
        .toEqual([{ shotId, videoAssetId: replacementVideoAssetId, endpointSeconds: 10 }]);

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const video = findStudioShotJob(project, anchorShotId, 'video_take', existingJobIds);
            return {
              status: video?.status ?? null,
              assetId: video?.outputAssetIdsByRole.primary ?? null,
              errorCode: video?.error?.code ?? null,
            };
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual({ status: 'succeeded', assetId: expect.any(String), errorCode: null });

      const replacementChain = await readStudioProject(page, projectId);
      const replacementDownstreamJob = findStudioShotJob(replacementChain, anchorShotId, 'video_take', existingJobIds);
      const replacementDownstreamAssetId = replacementDownstreamJob?.outputAssetIdsByRole.primary;
      expect(replacementDownstreamAssetId).toBeTruthy();
      expect(replacementChain.shots[anchorShotId]?.videoAssetId).toBe(replacementDownstreamAssetId);
      await expect
        .poll(
          async () => {
            const raw = await readRawStudioProject(userDataDirectory, projectId);
            return Object.values(raw.frameExtractions)
              .filter((extraction) => extraction.videoAssetId === replacementDownstreamAssetId)
              .map(({ frameAssetId, status }) => ({ frameAssetId, status }));
          },
          { timeout: studioFakeMediaTimeoutMs }
        )
        .toEqual([{ frameAssetId: expect.any(String), status: 'ready' }]);

      await page.reload({ waitUntil: 'domcontentloaded' });
      const downstreamRow = page
        .getByRole('grid', { name: 'Beat table' })
        .getByRole('row')
        .filter({ hasText: 'Landing' });
      await downstreamRow.locator('[data-grid-column-name="beat"]').click();
      const downstreamPanel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
      const downstreamShotCard = downstreamPanel.locator(`article[data-shot-id="${shotId}"]`);
      const downstreamLift = downstreamShotCard.locator('[data-shot-overflow-trigger]');
      await expect(
        downstreamShotCard.getByText('Downstream generation is still using this item.', { exact: true })
      ).toHaveCount(0);
      await expect(downstreamLift).toBeEnabled();

      const terminalForLift = await readStudioProject(page, projectId);
      expect(terminalForLift.shots[shotId]?.videoAssetId).toBe(replacementVideoAssetId);
      expect(terminalForLift.shots[shotId]?.trimOutSeconds).toBeNull();
      expect(terminalForLift.shots[anchorShotId]?.videoAssetId).toBe(replacementDownstreamAssetId);
      const terminalRaw = await readRawStudioProject(userDataDirectory, projectId);
      const replacementExtraction = Object.values(terminalRaw.frameExtractions).find(
        (extraction) => extraction.videoAssetId === replacementVideoAssetId
      );
      expect(replacementExtraction).toMatchObject({
        shotId,
        videoAssetId: replacementVideoAssetId,
        endpointSeconds: 10,
        status: 'ready',
        frameAssetId: expect.any(String),
      });
      const frameAssetId = replacementExtraction!.frameAssetId!;
      const rawFirstJob = terminalRaw.jobs[replacementFirstJob!.id];
      const rawDownstreamJob = terminalRaw.jobs[replacementDownstreamJob!.id];
      expect(rawFirstJob?.outputAssetIdsByRole.poster).toBeNull();
      expect(frameAssetId).not.toBe(replacementVideoAssetId);
      expect(terminalRaw.assets[frameAssetId]).toMatchObject({
        projectId,
        shotId,
        mediaKind: 'image',
        managedAsset: { collection: 'conditioningFrames' },
      });
      expect(rawDownstreamJob?.requestSnapshot?.conditioningInput).toEqual({
        kind: 'predecessor_frame',
        predecessorShotId: shotId,
        takeAssetId: replacementVideoAssetId,
        frameAssetId,
        endpointSeconds: 10,
      });

      expect(
        Object.values(terminalForLift.jobs).every((job) => ['cancelled', 'failed', 'succeeded'].includes(job.status))
      ).toBe(true);
      renderedShotLifecycleState = {
        projectId,
        beatId,
        shotId,
        anchorShotId,
        retainedProject: structuredClone(terminalForLift),
        retainedFrameExtractions: structuredClone(terminalRaw.frameExtractions),
        providerCalls: await readStudioE2EProviderCallCounts(userDataDirectory),
        userDataDirectory,
      };
      await panel.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(panel).toBeHidden();
    });

    test('repeats rendered-Shot lift and restore at desktop 1440x900', async ({ page }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The terminal Shot lifecycle requires the explicit development-only Studio fake adapter.'
      );
      await exerciseRenderedShotViewportLifecycle(page, studioViewportReferences[0]);
    });

    test('repeats rendered-Shot lift and restore at compact 1100x760', async ({ page }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The terminal Shot lifecycle requires the explicit development-only Studio fake adapter.'
      );
      await exerciseRenderedShotViewportLifecycle(page, studioViewportReferences[1]);
    });

    test('repeats rendered-Shot lift and restore at narrow 760x900', async ({ page }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The terminal Shot lifecycle requires the explicit development-only Studio fake adapter.'
      );
      await exerciseRenderedShotViewportLifecycle(page, studioViewportReferences[2]);
    });

    test('repeats rendered-Shot lift and restore in forced RTL at 760x900', async ({ page }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The terminal Shot lifecycle requires the explicit development-only Studio fake adapter.'
      );
      await exerciseRenderedShotViewportLifecycle(page, studioViewportReferences[3]);
    });
  });

  test.describe.serial('Cut retained media and exports', () => {
    test('imports and replaces a bed, then creates only the editor-folder export', async ({ electronApp, page }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The Cut no-spend oracle requires the explicit development-only Studio fake adapter.'
      );

      const rendered = await createRenderedCutFixture(page, 'A Cut export lifecycle.');
      const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
      const fixtureDirectory = path.join(studioStorageDirectory(userDataDirectory), '.studio-raw-output-path-sentinel');
      const wrongMediaPath = path.join(fixtureDirectory, 'fake-image.png');
      const firstAudioPath = path.join(fixtureDirectory, `cut-bed-first-${Date.now()}.wav`);
      const replacementAudioPath = path.join(fixtureDirectory, `cut-bed-replacement-${Date.now()}.wav`);
      await mkdir(fixtureDirectory, { recursive: true });
      const wrongMediaBytes = await readFile(wrongMediaPath);
      const wrongMediaStats = await lstat(wrongMediaPath);
      expect(wrongMediaStats.isFile()).toBe(true);
      expect(wrongMediaStats.isSymbolicLink()).toBe(false);
      expect(wrongMediaBytes.subarray(1, 4).toString('ascii')).toBe('PNG');
      await writeFile(firstAudioPath, createPcmWav(16), { flag: 'wx' });
      await writeFile(replacementAudioPath, createPcmWav(18), { flag: 'wx' });
      await installStudioE2ENativeHarness(electronApp, {
        openPaths: [null, wrongMediaPath, firstAudioPath, replacementAudioPath],
      });

      const providerCalls = await readStudioE2EProviderCallCounts(userDataDirectory);
      await navigateTo(page, `#/studio/${encodeURIComponent(rendered.projectId)}/cut`);
      await expect(page).toHaveURL(new RegExp(`#/studio/${rendered.projectId}/cut$`));
      const cut = page.locator('[data-studio-cut]');
      await expect(cut).toBeVisible();
      await expect(cut.locator('[data-export-shape]')).toHaveCount(0);
      await expect(cut).not.toContainText(/stitched|auto-duck/i);

      const beforeCancel = await readStudioProject(page, rendered.projectId);
      const importAudio = cut.getByRole('button', { name: 'Import audio' });
      await importAudio.click();
      await expect(cut).toContainText('Audio import was cancelled.');
      expect(await readStudioProject(page, rendered.projectId)).toEqual(beforeCancel);

      await importAudio.click();
      await expect(cut).toContainText('Audio could not be imported.');
      expect(await readStudioProject(page, rendered.projectId)).toEqual(beforeCancel);
      expect(await readFile(wrongMediaPath)).toEqual(wrongMediaBytes);
      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCalls);
      expect(await readStudioE2ENativeHarness(electronApp)).toMatchObject({
        openRequestCount: 2,
        remainingOpenPaths: 2,
        saveRequestCount: 0,
        remainingSavePaths: 0,
      });

      await importAudio.click();
      await expect
        .poll(async () => {
          const project = await readStudioProject(page, rendered.projectId);
          return {
            audioAssetIds: Object.values(project.assets)
              .filter((asset) => asset.mediaKind === 'audio')
              .map((asset) => asset.id),
            bedAssetId: project.bedAssetId,
          };
        })
        .toEqual({ audioAssetIds: [expect.any(String)], bedAssetId: expect.any(String) });
      const firstImport = await readStudioProject(page, rendered.projectId);
      const firstBedAssetId = firstImport.bedAssetId;
      if (firstBedAssetId === null) throw new Error('Creative Studio first imported bed was unavailable');
      expect(firstImport.revision).toBe(beforeCancel.revision + 1);
      expect(firstImport.assets[firstBedAssetId]).toMatchObject({
        id: firstBedAssetId,
        projectId: rendered.projectId,
        shotId: null,
        mediaKind: 'audio',
        durationSeconds: 16,
      });
      await expect(cut.locator('[data-bed-status="ready"]')).toContainText('16s source · fade from 8s to 10s');

      await importAudio.click();
      await expect
        .poll(async () => {
          const project = await readStudioProject(page, rendered.projectId);
          return {
            audioAssetCount: Object.values(project.assets).filter((asset) => asset.mediaKind === 'audio').length,
            bedAssetId: project.bedAssetId,
          };
        })
        .toEqual({ audioAssetCount: 2, bedAssetId: expect.not.stringMatching(firstBedAssetId) });
      const replaced = await readStudioProject(page, rendered.projectId);
      const selectedBedAssetId = replaced.bedAssetId;
      if (selectedBedAssetId === null || selectedBedAssetId === firstBedAssetId) {
        throw new Error('Creative Studio replacement bed was unavailable');
      }
      expect(replaced.revision).toBe(firstImport.revision + 1);
      expect(replaced.assets[firstBedAssetId]).toEqual(firstImport.assets[firstBedAssetId]);
      expect(replaced.assets[selectedBedAssetId]).toMatchObject({
        projectId: rendered.projectId,
        shotId: null,
        mediaKind: 'audio',
        durationSeconds: 18,
      });
      await expect(cut.locator('[data-bed-status="ready"]')).toContainText('18s source · fade from 8s to 10s');

      const managedVideo = { projectId: rendered.projectId, assetId: rendered.videoAssetId };
      await captureCutViewportReference(page, studioViewportReferences[0], managedVideo);
      await captureCutViewportReference(page, studioViewportReferences[1], managedVideo);
      await captureCutViewportReference(page, studioViewportReferences[2], managedVideo);
      await captureCutViewportReference(page, studioViewportReferences[3], managedVideo);
      await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
      await page.setViewportSize({ width: 1440, height: 900 });
      const providerCallsBeforePlayback = await readStudioE2EProviderCallCounts(userDataDirectory);
      await exerciseCutPreviewTransport(page, cut, managedVideo);
      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforePlayback);

      const projectBeforeOpenBeat = await readStudioProject(page, rendered.projectId);
      await cut
        .locator('[data-cut-filmstrip-selection]')
        .getByRole('button', { name: 'Open Beat', exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`#/studio/${rendered.projectId}/cut$`));
      const cutBeatPanel = page.getByRole('dialog', { name: 'Beat panel — Cut export Beat' });
      await expect(cutBeatPanel).toBeVisible();
      await expect(cutBeatPanel.locator('[data-beat-player]')).toBeVisible();
      await expect
        .poll(() =>
          cutBeatPanel
            .locator('video[data-beat-preview-media][data-media-kind="video"]')
            .evaluate((element: HTMLVideoElement) => element.currentSrc)
        )
        .toBe(`weprompt-studio://asset/${rendered.projectId}/${rendered.videoAssetId}`);
      await cutBeatPanel.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(cutBeatPanel).toBeHidden();
      expect(await readStudioProject(page, rendered.projectId)).toEqual(projectBeforeOpenBeat);
      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforePlayback);

      const projectMenuTrigger = page.locator('[data-studio-project-menu-trigger]');
      await projectMenuTrigger.click();
      const editorFolderExport = page.locator('[data-studio-editor-folder-export]');
      await expect(editorFolderExport).toBeEnabled();
      await expect(editorFolderExport).toContainText('Export editor folder');
      await editorFolderExport.click();
      await expect
        .poll(async () => {
          const catalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
            projectId: rendered.projectId,
          });
          return catalog.artifacts.map((artifact) => artifact.shape);
        })
        .toEqual(['editor_folder']);
      await expect(page.locator('[data-studio-editor-folder-export-status]')).toContainText('Slate Shot numbers');

      const catalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
        projectId: rendered.projectId,
      });
      expect(catalog.artifacts.map((artifact) => artifact.shape)).toEqual(['editor_folder']);
      await page.getByRole('button', { name: 'Dismiss', exact: true }).click();
      await projectMenuTrigger.click();
      await page.getByRole('menuitem', { name: 'Imported audio', exact: true }).click();
      const drawer = page.locator('[data-studio-audio-drawer]');
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-audio-position]')).toHaveCount(2);
      await expect(drawer).not.toContainText(/stitched|manifest\.json|[/\\]exports[/\\]/i);
      const selectedAudio = drawer.locator('[data-audio-position="1"]');
      const oldAudio = drawer.locator('[data-audio-position="2"]');
      await expect(selectedAudio).toContainText('Imported bed 1');
      await expect(oldAudio).toContainText('Imported bed 2');
      await expect(selectedAudio.getByRole('button', { name: 'Detach audio' })).toBeDisabled();
      await expect(oldAudio.getByRole('button', { name: 'Detach audio' })).toBeEnabled();

      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCalls);
      expect(await readStudioE2ENativeHarness(electronApp)).toMatchObject({
        openRequestCount: 4,
        remainingOpenPaths: 0,
        saveRequestCount: 0,
        remainingSavePaths: 0,
      });
      cutLifecycleState = {
        projectId: rendered.projectId,
        firstBedAssetId,
        selectedBedAssetId,
        exportArtifacts: catalog.artifacts,
        providerCalls,
        userDataDirectory,
      };

      await electronApp.close();
    });

    test('reloads retained Cut state, then clears and detaches audio without disturbing the export', async ({
      electronApp,
      page,
    }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The Cut no-spend oracle requires the explicit development-only Studio fake adapter.'
      );
      const state = requireCutLifecycleState();
      await installStudioE2ENativeHarness(electronApp);
      const restartedProviderCalls = await readStudioE2EProviderCallCounts(state.userDataDirectory);

      await navigateTo(page, `#/studio/${encodeURIComponent(state.projectId)}/cut`);
      await expect(page).toHaveURL(new RegExp(`#/studio/${state.projectId}/cut$`));
      const cut = page.locator('[data-studio-cut]');
      await expect(cut).toBeVisible();
      const restarted = await readStudioProject(page, state.projectId);
      expect(restarted.bedAssetId).toBe(state.selectedBedAssetId);
      expect(
        Object.values(restarted.assets)
          .filter((asset) => asset.mediaKind === 'audio')
          .map((asset) => asset.id)
          .toSorted()
      ).toEqual([state.firstBedAssetId, state.selectedBedAssetId].toSorted());
      await expect(cut.locator('[data-bed-status="ready"]')).toContainText('18s source · fade from 8s to 10s');

      const retainedCatalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
        projectId: state.projectId,
      });
      expect(retainedCatalog).toEqual({
        revision: expect.any(Number),
        artifacts: state.exportArtifacts,
      });
      const projectMenuTrigger = page.locator('[data-studio-project-menu-trigger]');
      await projectMenuTrigger.click();
      await page.getByRole('menuitem', { name: 'Imported audio', exact: true }).click();
      let drawer = page.locator('[data-studio-audio-drawer]');
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-audio-position]')).toHaveCount(2);
      await page.getByRole('button', { name: 'Close Assets' }).click();

      await clearArcoSelect(page, 'Selected audio bed');
      await expect.poll(async () => (await readStudioProject(page, state.projectId)).bedAssetId).toBeNull();
      const bedCleared = await readStudioProject(page, state.projectId);
      expect(bedCleared.revision).toBe(restarted.revision + 1);
      expect(bedCleared.assets[state.firstBedAssetId]).toEqual(restarted.assets[state.firstBedAssetId]);
      expect(bedCleared.assets[state.selectedBedAssetId]).toEqual(restarted.assets[state.selectedBedAssetId]);
      expect(bedCleared.jobs).toEqual(restarted.jobs);

      await chooseArcoSelectOption(page, 'Selected audio bed', 'Imported bed 1');
      await expect
        .poll(async () => (await readStudioProject(page, state.projectId)).bedAssetId)
        .toBe(state.selectedBedAssetId);
      await projectMenuTrigger.click();
      await page.getByRole('menuitem', { name: 'Imported audio', exact: true }).click();
      drawer = page.locator('[data-studio-audio-drawer]');
      await expect(drawer).toBeVisible();
      const selectedAudio = drawer.locator('[data-audio-position="1"]');
      const oldAudio = drawer.locator('[data-audio-position="2"]');
      await expect(selectedAudio).toContainText('Imported bed 1');
      await expect(oldAudio).toContainText('Imported bed 2');
      await expect(selectedAudio.getByRole('button', { name: 'Detach audio' })).toBeDisabled();
      await oldAudio.getByRole('button', { name: 'Detach audio' }).click();
      const confirmDetach = page.locator('.arco-popconfirm .arco-btn-primary').filter({ hasText: 'Detach audio' });
      await expect(confirmDetach).toBeVisible();
      await confirmDetach.click();
      await expect
        .poll(async () => {
          const project = await readStudioProject(page, state.projectId);
          return {
            bedAssetId: project.bedAssetId,
            firstBedPresent: project.assets[state.firstBedAssetId] !== undefined,
            selectedBedPresent: project.assets[state.selectedBedAssetId] !== undefined,
          };
        })
        .toEqual({ bedAssetId: state.selectedBedAssetId, firstBedPresent: false, selectedBedPresent: true });
      await expect(drawer.locator('[data-audio-position="2"]')).toHaveCount(0);
      expect(
        await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
          projectId: state.projectId,
        })
      ).toEqual(retainedCatalog);

      const harness = await readStudioE2ENativeHarness(electronApp);
      expect(harness).toMatchObject({
        openRequestCount: 0,
        remainingOpenPaths: 0,
        saveRequestCount: 0,
        remainingSavePaths: 0,
        revealedPaths: [],
      });
      await expect(drawer).not.toContainText(/stitched|manifest\.json|[/\\]exports[/\\]/i);
      expect(await readStudioE2EProviderCallCounts(state.userDataDirectory)).toEqual(restartedProviderCalls);
    });
  });

  test('lists and loads a schema-1 project as unsupported without touching its bytes', async ({
    electronApp,
    page,
  }) => {
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const projectId = `legacy_e2e_${Date.now()}`;
    const projectDirectory = path.join(studioStorageDirectory(userDataDirectory), projectId);
    const projectFile = path.join(projectDirectory, 'project.json');
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, id: projectId, revision: 1 }));
    await mkdir(projectDirectory, { recursive: true });
    await writeFile(projectFile, bytes, { flag: 'wx' });
    const before = await lstat(projectFile);
    const directoryEntriesBefore = (await readdir(projectDirectory)).toSorted();

    const assertLegacyProjectUntouched = async (): Promise<void> => {
      expect(await readFile(projectFile)).toEqual(bytes);
      expect((await readdir(projectDirectory)).toSorted()).toEqual(directoryEntriesBefore);
      const after = await lstat(projectFile);
      expect({ dev: after.dev, ino: after.ino, size: after.size, mtimeMs: after.mtimeMs }).toEqual({
        dev: before.dev,
        ino: before.ino,
        size: before.size,
        mtimeMs: before.mtimeMs,
      });
    };

    const listed = await invokeStudioBridge<StudioProjectListResultV2>(page, 'list-projects', undefined);
    expect(listed.unsupportedProjectIds).toContain(projectId);
    await assertLegacyProjectUntouched();

    const loaded = await invokeStudioBridge<StudioProjectLoadResultV2>(page, 'get-project', { projectId });
    expect(loaded).toEqual({ status: 'unsupported_prototype_schema', projectId });
    await assertLegacyProjectUntouched();
  });
});
