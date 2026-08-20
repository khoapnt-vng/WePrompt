/**
 * Creative Studio schema-2 workspace and native lifecycle smoke.
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
  StudioProjectLoadResultV2,
  StudioProjectListResultV2,
  StudioProjectV2,
  StudioRendererPreparedSubmissionOptionsV2,
  StudioRendererProjectCommitResultV2,
  StudioRendererProjectV2,
  StudioRendererExportCatalogV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ElectronApplication, Locator, Page } from '@playwright/test';

const workspaceSelector = '[data-studio-workspace]';
const projectHeaderSelector = '[data-studio-project-header]';
const viewNavigationSelector = '[data-studio-view-navigation]';
const activeViewSelector = '[data-studio-view]';
const controlsSelector = '[data-studio-workspace-controls]';
const studioStorageDirectory = (userDataDirectory: string): string =>
  path.join(userDataDirectory, 'config', 'creative-studio');

type StudioE2EProviderCallCounts = {
  validateConnection: number;
  submit: number;
  poll: number;
  cancel: number;
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
  plan: StudioE2ENativeHarnessPlan
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

type StudioBridgeMethod =
  | 'apply-authoring-batch'
  | 'confirm-submission'
  | 'get-project'
  | 'list-exports'
  | 'list-projects'
  | 'list-routes'
  | 'prepare-submission'
  | 'select-take';

async function invokeStudioBridge<T>(page: Page, method: StudioBridgeMethod, data: unknown): Promise<T> {
  const result: unknown = await page.evaluate(
    async ({ requestedMethod, requestedData }) => {
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
        }, 10_000);

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
    { requestedMethod: method, requestedData: data }
  );

  if (typeof result !== 'object' || result === null || !('ok' in result) || result.ok !== true || !('data' in result)) {
    throw new Error(`Creative Studio ${method} bridge data was unavailable: ${JSON.stringify(result)}`);
  }
  return result.data as T;
}

const projectIdFromStudioUrl = (page: Page): string => {
  const match = new URL(page.url()).hash.match(/^#\/studio\/([^/]+)\/(?:table|board|cut)$/);
  if (!match?.[1]) throw new Error('Creative Studio route did not contain a project id');
  return decodeURIComponent(match[1]);
};

const readStudioProject = async (page: Page, projectId: string): Promise<StudioRendererProjectV2> => {
  const loaded = await invokeStudioBridge<StudioProjectLoadResultV2>(page, 'get-project', { projectId });
  if (loaded.status !== 'supported') throw new Error(`Creative Studio project ${projectId} was not supported`);
  return loaded.project;
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
    (parsed as Record<string, unknown>).schemaVersion !== 2 ||
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

const captureCutViewportReference = async (page: Page, reference: StudioViewportReference): Promise<void> => {
  await page.setViewportSize({ width: reference.width, height: reference.height });
  const root = page.locator('html');
  await root.evaluate((element, direction) => element.setAttribute('dir', direction), reference.direction);
  await expect(root).toHaveAttribute('dir', reference.direction);

  const cut = page.locator('[data-studio-cut]');
  const cutHeading = cut.getByRole('heading', { name: 'Cut', exact: true });
  await expect(cutHeading).toBeVisible();
  await cutHeading.evaluate((element) => element.scrollIntoView({ block: 'start', inline: 'nearest' }));
  await expect(cut).toHaveCSS('direction', reference.direction);
  await expect(cut).toContainText('10s film');
  await expect(cut).toContainText('18s source · fade from 8s to 10s');
  await expect(cut).toContainText('Applying the look requires a separately reviewed, costed re-render');
  await expect(cut).not.toContainText(/stitched|auto-duck|density/i);

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
    exportShapes: ['editor_folder', 'still', 'script'],
  });
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
  expect(metrics.documentScrollWidth).toBeLessThanOrEqual(metrics.documentClientWidth + 1);

  const audioPanel = cut.getByRole('heading', { name: 'Audio bed', exact: true }).locator('xpath=ancestor::section[1]');
  const matchPanel = cut.getByRole('heading', { name: 'Match To', exact: true }).locator('xpath=ancestor::section[1]');
  const [cutBox, audioBox, matchBox, editorBox, stillBox, scriptBox] = await Promise.all([
    cut.boundingBox(),
    audioPanel.boundingBox(),
    matchPanel.boundingBox(),
    cut.locator('[data-export-shape="editor_folder"]').boundingBox(),
    cut.locator('[data-export-shape="still"]').boundingBox(),
    cut.locator('[data-export-shape="script"]').boundingBox(),
  ]);
  if (
    cutBox === null ||
    audioBox === null ||
    matchBox === null ||
    editorBox === null ||
    stillBox === null ||
    scriptBox === null
  ) {
    throw new Error(`Cut ${reference.screenshotName} geometry was unavailable`);
  }
  for (const box of [cutBox, audioBox, matchBox, editorBox, stillBox, scriptBox]) {
    expect(box.x).toBeGreaterThanOrEqual(-1);
    expect(box.x + box.width).toBeLessThanOrEqual(reference.width + 1);
  }

  if (reference.layout === 'columns') {
    expect(Math.abs(audioBox.y - matchBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(editorBox.y - stillBox.y)).toBeLessThanOrEqual(1);
    expect(Math.abs(stillBox.y - scriptBox.y)).toBeLessThanOrEqual(1);
    expect(audioBox.x).toBeLessThan(matchBox.x);
    expect(editorBox.x).toBeLessThan(stillBox.x);
    expect(stillBox.x).toBeLessThan(scriptBox.x);
  } else {
    expect(matchBox.y).toBeGreaterThanOrEqual(audioBox.y + audioBox.height - 1);
    expect(stillBox.y).toBeGreaterThanOrEqual(editorBox.y + editorBox.height - 1);
    expect(scriptBox.y).toBeGreaterThanOrEqual(stillBox.y + stillBox.height - 1);
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
  await expect(page).toHaveURL(/#\/studio\/[^/]+\/table$/);

  const projectId = projectIdFromStudioUrl(page);
  const beatId = `beat_cut_e2e_${Date.now()}`;
  const shotId = `shot_cut_e2e_${Date.now()}`;
  const initial = await readStudioProject(page, projectId);
  const routes = await invokeStudioBridge<StudioRouteCatalogV2>(page, 'list-routes', { projectId });
  const imageRouteId = routes.image.options[0]?.choiceId;
  const videoRouteId = routes.video.options[0]?.choiceId;
  if (imageRouteId === undefined || videoRouteId === undefined) {
    throw new Error('Creative Studio E2E fake routes were unavailable');
  }

  const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
    projectId,
    expectedRevision: initial.revision,
    operations: [
      { kind: 'set_routes', imageRouteId, videoRouteId },
      {
        kind: 'add_beat',
        beatId,
        beat: {
          title: 'Cut export Beat',
          action: 'A paper airplane crosses the finished film.',
          look: 'Soft morning light with a clean paper texture.',
          targetSeconds: 10,
        },
        beforeBeatId: null,
      },
      {
        kind: 'add_shot',
        beatId,
        shotId,
        shot: {
          line: 'The airplane settles into frame.',
          narration: 'A quiet landing.',
          onScreenText: 'LANDING',
          durationSeconds: 10,
        },
        beforeShotId: null,
      },
    ],
  });

  const prepared = await invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(page, 'prepare-submission', {
    projectId,
    expectedRevision: authored.projectRevision,
    originReferenceHandoffId: null,
    baseChoices: [{ shotId, purpose: 'seed_still', generationCount: 1, referenceAssetId: null }],
    cascadeChoices: [{ shotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null }],
  });
  if (prepared.withCascade === null) throw new Error('Creative Studio Cut fixture cascade quote was unavailable');
  await invokeStudioBridge<StudioConfirmSubmissionResultV2>(page, 'confirm-submission', {
    projectId,
    quoteId: prepared.withCascade.id,
    expectedRevision: authored.projectRevision,
  });

  await expect
    .poll(
      async () => {
        const project = await readStudioProject(page, projectId);
        return Object.values(project.jobs).find(
          (job) => job.shotId === shotId && job.purpose === 'seed_still' && job.status === 'succeeded'
        )?.outputAssetIdsByRole.primary;
      },
      { timeout: 30_000 }
    )
    .toEqual(expect.any(String));
  const seeded = await readStudioProject(page, projectId);
  const seedAssetId = Object.values(seeded.jobs).find((job) => job.shotId === shotId && job.purpose === 'seed_still')
    ?.outputAssetIdsByRole.primary;
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
          (job) => job.shotId === shotId && job.purpose === 'video_take' && job.status === 'succeeded'
        )?.outputAssetIdsByRole.primary;
      },
      { timeout: 30_000 }
    )
    .toEqual(expect.any(String));
  const rendered = await readStudioProject(page, projectId);
  const videoAssetId = Object.values(rendered.jobs).find((job) => job.shotId === shotId && job.purpose === 'video_take')
    ?.outputAssetIdsByRole.primary;
  if (videoAssetId === null || videoAssetId === undefined) {
    throw new Error('Creative Studio Cut fixture video asset was unavailable');
  }
  await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'select-take', {
    projectId,
    expectedRevision: rendered.revision,
    shotId,
    assetId: videoAssetId,
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table', { timeout: 30_000 });
  await expect(page.getByRole('grid', { name: 'Beat table' }).getByText('Cut export Beat')).toBeVisible();
  const panel = page.getByRole('dialog', { name: 'Beat panel — Cut export Beat' });
  if (await panel.isVisible()) {
    await panel.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(panel).toBeHidden();
  }
  const project = await readStudioProject(page, projectId);
  return { projectId, beatId, shotId, seedAssetId, videoAssetId, project };
};

type CutLifecycleState = {
  projectId: string;
  beatId: string;
  shotId: string;
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
  await expect(row).toContainText('18s actual');
  await expect(row).toContainText('~16s target');
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
  const shotCard = panel.locator(`article[data-shot-id="${shotId}"]`);
  const anchorShotCard = panel.locator(`article[data-shot-id="${anchorShotId}"]`);
  await expect(shotCard).toContainText('The plane lands.');
  await expect(anchorShotCard).toContainText('The desk remains in view.');
  const playbackLane = panel.getByRole('group', { name: 'Playback coverage' });
  const planningLane = panel.getByRole('group', { name: 'Planning overlay' });
  await expect(playbackLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('10s source');
  await expect(planningLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('8s plan');
  await expectLocatorFitsViewport(panel, reference, 'Beat panel');
  await takeScreenshot(page, `creative-studio/gate-3/beat-panel-coverage-${reference.screenshotSuffix}.png`);

  const liftShot = shotCard.getByRole('button', { name: 'Lift Shot', exact: true });
  await expect(liftShot).toBeEnabled();
  await expect(panel.getByRole('button', { name: 'Lift Beat', exact: true })).toBeEnabled();
  await liftShot.click();
  const liftConfirmation = page.locator('.arco-popconfirm:visible');
  await expect(liftConfirmation.getByText('Lift Shot 1?', { exact: true })).toBeVisible();
  await expect(
    liftConfirmation.getByText('Authored and paid work stays with this Shot. Lifting it makes Beat 1, Shot 2 stale.', {
      exact: true,
    })
  ).toBeVisible();
  const confirmLift = liftConfirmation.getByRole('button', { name: 'Lift Shot', exact: true });
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
  await expect(beatCard.getByText('Stale', { exact: true })).toBeVisible();
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
  await expect(panel.locator(`article[data-shot-id="${anchorShotId}"]`)).toBeVisible();
  await expect(playbackLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('10s source');
  await expect(planningLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('8s plan');
  await panel.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(panel).toBeHidden();
};

test.describe('Creative Studio workspace', () => {
  test.describe.configure({ timeout: 60_000 });
  test.skip(process.env.AIONUI_E2E_TEST !== '1', 'Creative Studio E2E requires an isolated test profile.');

  test('creates and reloads a Beat/Shot project across the shared Table, Board, and Cut routes', async ({ page }) => {
    const projectBrief = `A quiet paper-airplane launch story ${Date.now()}.`;

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await expect(workspace.getByRole('region', { name: 'Creative Studio' })).toBeVisible();

    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();

    await expect(page).toHaveURL(/#\/studio\/[^/]+\/table$/);
    await expect(page.locator(projectHeaderSelector).getByRole('heading', { level: 1 })).toHaveText(projectBrief);

    const navigation = page.locator(viewNavigationSelector);
    await expect(navigation.getByRole('link', { name: 'Table' })).toHaveAttribute('aria-current', 'page');
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table');
    const controls = page.locator(controlsSelector);
    const nameDraft = controls.getByLabel('Project name');
    await expect(nameDraft).toHaveValue(projectBrief);
    await nameDraft.fill(`${projectBrief} — local draft`);

    await navigation.getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/board$/);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');
    await expect(controls.getByLabel('Project name')).toHaveValue(`${projectBrief} — local draft`);

    await navigation.getByRole('link', { name: 'Cut' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/cut$/);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');
    await expect(controls.getByLabel('Project name')).toHaveValue(`${projectBrief} — local draft`);

    const cutUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(cutUrl);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');
    await expect(page.locator(controlsSelector).getByLabel('Project name')).toHaveValue(
      `${projectBrief} — local draft`
    );

    await page.locator(controlsSelector).getByRole('button', { name: 'Reset settings' }).click();
    await expect(page.locator(controlsSelector).getByLabel('Project name')).toHaveValue(projectBrief);

    // Merely loading, navigating, and restoring drafts cannot open or cross the paid boundary.
    await expect(page.locator('[data-testid="studio-spend-gate"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /prepare estimate|confirm .*generation/i })).toHaveCount(0);
  });

  test('traverses the 24-Beat Table without mutating the project or paid work', async ({ electronApp, page }) => {
    const projectBrief = `A 24-beat keyboard story ${Date.now()}.`;

    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/table$/);

    const projectId = projectIdFromStudioUrl(page);
    const initial = await readStudioProject(page, projectId);
    const beatIds = Array.from({ length: 24 }, (_, index) => `beat_table_${String(index + 1).padStart(2, '0')}`);
    const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
      projectId,
      expectedRevision: initial.revision,
      operations: beatIds.map((beatId, index) => ({
        kind: 'add_beat',
        beatId,
        beat: {
          title: `Table beat ${String(index + 1).padStart(2, '0')}`,
          action: `Show story moment ${index + 1}.`,
          look: index % 3 === 0 ? '' : `Visual direction ${index + 1}.`,
          targetSeconds: index % 2 === 0 ? null : 7,
        },
        beforeBeatId: null,
      })),
    });
    expect(authored.createdBeatIds).toEqual(beatIds);

    await page.reload({ waitUntil: 'domcontentloaded' });
    const grid = page.getByRole('grid', { name: 'Beat table' });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole('columnheader')).toHaveCount(7);
    await expect(grid.getByRole('row')).toHaveCount(25);
    const rows = grid.getByRole('row');
    await expect(rows.nth(1).getByRole('gridcell')).toHaveCount(7);

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
    await page.keyboard.press('Enter');
    await expect(rows.nth(24)).toHaveAttribute('aria-selected', 'true');
    const beatPanel = page.getByRole('dialog', { name: 'Beat panel — Table beat 24' });
    await expect(beatPanel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(beatPanel).toBeHidden();
    await expect(rows.nth(24)).toHaveAttribute('aria-selected', 'true');

    await expect(rows.nth(1)).toContainText('Duration pending');
    await expect(rows.nth(1)).not.toContainText(/\b0s\b/);
    await expect(rows.nth(2)).toContainText('No coverage');
    await expect(rows.nth(2)).toContainText('~7s target');

    const beforeNavigation = await readStudioProject(page, projectId);
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const providerCallsBeforeNavigation =
      process.env.AIONUI_E2E_STUDIO_FAKE === '1' ? await readStudioE2EProviderCallCounts(userDataDirectory) : null;
    const navigation = page.locator(viewNavigationSelector);
    await navigation.getByRole('link', { name: 'Board' }).click();
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');
    const board = page.getByRole('list', { name: 'Beat board' });
    await expect(board.locator(':scope > [data-beat-id]')).toHaveCount(24);
    await expect(page.getByRole('button', { name: 'Open Table beat 24' })).toHaveAttribute('aria-current', 'true');
    const boardSizes = page.getByRole('group', { name: 'Board card size' });
    await expect(boardSizes.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    await boardSizes.getByRole('button', { name: 'S' }).click();
    await expect(board).toHaveAttribute('data-card-size', 'small');
    await boardSizes.getByRole('button', { name: 'L' }).click();
    await expect(board).toHaveAttribute('data-card-size', 'large');
    await boardSizes.getByRole('button', { name: 'M' }).click();
    await expect(board).toHaveAttribute('data-card-size', 'medium');
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
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/table$/);

    const projectId = projectIdFromStudioUrl(page);
    const beatId = `beat_panel_e2e_${Date.now()}`;
    const firstShotId = `shot_panel_a_${Date.now()}`;
    const secondShotId = `shot_panel_b_${Date.now()}`;
    const initial = await readStudioProject(page, projectId);
    const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
      projectId,
      expectedRevision: initial.revision,
      operations: [
        {
          kind: 'add_beat',
          beatId,
          beat: {
            title: 'Panel keyboard Beat',
            action: 'The plane crosses the workbench.',
            look: 'Soft studio light.',
            targetSeconds: 12,
          },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: firstShotId,
          shot: { line: 'The plane enters.', narration: '', onScreenText: '', durationSeconds: 6 },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: secondShotId,
          shot: { line: 'The plane settles.', narration: '', onScreenText: '', durationSeconds: 6 },
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
    const firstCell = row.getByRole('gridcell').first();
    await firstCell.focus();
    await firstCell.press('Enter');

    const panel = page.getByRole('dialog', { name: 'Beat panel — Panel keyboard Beat' });
    await expect(panel).toBeVisible();
    const actionEditor = panel.getByRole('textbox', { name: 'Action', exact: true });
    const lookEditor = panel.getByRole('textbox', { name: 'Look', exact: true });
    const targetEditor = panel.getByRole('spinbutton', { name: 'Beat target (seconds)', exact: true });
    await expect(actionEditor).toHaveValue('The plane crosses the workbench.');
    await expect(lookEditor).toHaveValue('Soft studio light.');
    await expect(targetEditor).toHaveValue('12');
    await expect(panel.locator('article[data-shot-id]')).toHaveCount(2);

    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const providerCallsBefore = await readStudioE2EProviderCallCounts(userDataDirectory);
    const beforeReset = await readStudioProject(page, projectId);
    await actionEditor.fill('This local reset value must never persist.');
    await panel.getByRole('button', { name: 'Reset Beat' }).click();
    await expect(actionEditor).toHaveValue('The plane crosses the workbench.');
    expect(await readStudioProject(page, projectId)).toEqual(beforeReset);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBefore);

    const longLook =
      'soft silver morning light drifts across paper wings while shallow focus keeps the desk calm warm tactile quiet precise hopeful airy restrained cinematic natural gentle luminous';
    await lookEditor.fill(longLook);
    await expect(panel.locator('[data-look-warning="true"]')).toContainText('26 words');
    await panel.getByRole('button', { name: 'Save Beat' }).click();
    await expect.poll(async () => (await readStudioProject(page, projectId)).beats[beatId]?.look).toBe(longLook);

    const afterLookSave = await readStudioProject(page, projectId);
    expect(afterLookSave.revision).toBe(beforeReset.revision + 1);
    expect(afterLookSave.beats[beatId]).toEqual({ ...beforeReset.beats[beatId], look: longLook });
    expect(afterLookSave.assets).toEqual(beforeReset.assets);
    expect(afterLookSave.jobs).toEqual(beforeReset.jobs);
    expect(Object.hasOwn(afterLookSave, 'frameExtractions')).toBe(false);
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
    expect(afterBoundary.revision).toBe(afterLookSave.revision + 1);
    expect(afterBoundary.shots[firstShotId]).toEqual({ ...afterLookSave.shots[firstShotId], durationSeconds: 7 });
    expect(afterBoundary.shots[secondShotId]).toEqual({ ...afterLookSave.shots[secondShotId], durationSeconds: 5 });
    expect(
      (afterBoundary.shots[firstShotId]?.durationSeconds ?? 0) +
        (afterBoundary.shots[secondShotId]?.durationSeconds ?? 0)
    ).toBe(12);
    expect(afterBoundary.assets).toEqual(afterLookSave.assets);
    expect(afterBoundary.jobs).toEqual(afterLookSave.jobs);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBefore);

    await panel.getByRole('button', { name: 'Ask Director to re-split' }).click();
    await expect(panel).toBeHidden();
    await expect(
      page.getByText('Ask the Creative Director for a reviewed re-derive or re-split proposal.')
    ).toBeVisible();
    await expect(page.locator('[data-studio-director-toggle]')).toBeFocused();
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

      const projectBrief = 'A rendered paper-airplane landing.';
      await navigateTo(page, ROUTES.studio);
      const workspace = page.locator(workspaceSelector);
      await workspace.getByLabel('What do you want to make?').fill(projectBrief);
      await workspace.getByRole('button', { name: 'Create project' }).click();
      await expect(page).toHaveURL(/#\/studio\/[^/]+\/table$/);

      const projectId = projectIdFromStudioUrl(page);
      const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
      const beatId = `beat_e2e_${Date.now()}`;
      const shotId = `shot_e2e_${Date.now()}`;
      const anchorShotId = `shot_anchor_e2e_${Date.now()}`;
      const initial = await readStudioProject(page, projectId);
      const routes = await invokeStudioBridge<StudioRouteCatalogV2>(page, 'list-routes', { projectId });
      const imageRouteId = routes.image.options[0]?.choiceId;
      const videoRouteId = routes.video.options[0]?.choiceId;
      expect(routes.image.options.length).toBeGreaterThan(0);
      expect(routes.video.options.length).toBeGreaterThan(0);
      expect(imageRouteId).toBeTruthy();
      expect(videoRouteId).toBeTruthy();

      const authored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
        projectId,
        expectedRevision: initial.revision,
        operations: [
          { kind: 'set_routes', imageRouteId, videoRouteId },
          {
            kind: 'add_beat',
            beatId,
            beat: {
              title: 'Landing',
              action: 'The plane settles on the desk.',
              look: 'Soft morning light.',
              targetSeconds: 16,
            },
            beforeBeatId: null,
          },
          {
            kind: 'add_shot',
            beatId,
            shotId,
            shot: { line: 'The plane lands.', narration: '', onScreenText: '', durationSeconds: 8 },
            beforeShotId: null,
          },
          {
            kind: 'add_shot',
            beatId,
            shotId: anchorShotId,
            shot: { line: 'The desk remains in view.', narration: '', onScreenText: '', durationSeconds: 8 },
            beforeShotId: null,
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
        baseChoices: [{ shotId, purpose: 'seed_still', generationCount: 1, referenceAssetId: null }],
        cascadeChoices: [
          { shotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null },
          { shotId: anchorShotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null },
        ],
      });
      expect(prepared.withCascade).not.toBeNull();
      expect(
        prepared.withCascade?.cascadeItems.map(({ shotId: itemShotId, purpose }) => [itemShotId, purpose])
      ).toEqual([
        [shotId, 'video_take'],
        [anchorShotId, 'video_take'],
      ]);
      const confirmed = await invokeStudioBridge<StudioConfirmSubmissionResultV2>(page, 'confirm-submission', {
        projectId,
        quoteId: prepared.withCascade!.id,
        expectedRevision: authored.projectRevision,
      });

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const seed = Object.values(project.jobs).find(
              (job) => job.shotId === shotId && job.purpose === 'seed_still'
            );
            const video = Object.values(project.jobs).find(
              (job) => job.shotId === shotId && job.purpose === 'video_take'
            );
            const downstreamVideo = Object.values(project.jobs).find(
              (job) => job.shotId === anchorShotId && job.purpose === 'video_take'
            );
            return {
              seedStatus: seed?.status ?? null,
              seedAssetId: seed?.outputAssetIdsByRole.primary ?? null,
              videoStatus: video?.status ?? null,
              downstreamVideoStatus: downstreamVideo?.status ?? null,
            };
          },
          { timeout: 30_000 }
        )
        .toEqual({
          seedStatus: 'succeeded',
          seedAssetId: expect.any(String),
          videoStatus: 'waiting_for_conditioning',
          downstreamVideoStatus: 'waiting_for_conditioning',
        });

      const seededProject = await readStudioProject(page, projectId);
      const seedAssetId = Object.values(seededProject.jobs).find(
        (job) => job.shotId === shotId && job.purpose === 'seed_still'
      )?.outputAssetIdsByRole.primary;
      expect(seedAssetId).toBeTruthy();

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
      await page.reload({ waitUntil: 'domcontentloaded' });
      const seededRow = page.getByRole('grid', { name: 'Beat table' }).getByRole('row').filter({ hasText: 'Landing' });
      await seededRow.getByRole('gridcell').first().click();
      const seededPanel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
      const seededShotCard = seededPanel.locator(`article[data-shot-id="${shotId}"]`);
      const ownInFlightLift = seededShotCard.getByRole('button', { name: 'Lift Shot' });
      await expect(ownInFlightLift).toBeDisabled();
      await expect(
        seededShotCard.getByText('This item has generation work in progress.', { exact: true })
      ).toBeVisible();
      const seededBeatLift = seededPanel.getByRole('button', { name: 'Lift Beat' });
      await expect(seededBeatLift).toBeDisabled();
      const ownInFlightSnapshot = await captureStudioNoMutationSnapshot(page, userDataDirectory, projectId);
      await ownInFlightLift.evaluate((button: HTMLButtonElement) => button.click());
      await seededBeatLift.evaluate((button: HTMLButtonElement) => button.click());
      await expectStudioNoMutation(page, userDataDirectory, projectId, ownInFlightSnapshot);
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-shot-own-inflight.png');
      await seededPanel.getByRole('button', { name: 'Close' }).click();

      const seededNavigation = page.locator(viewNavigationSelector);
      await seededNavigation.getByRole('link', { name: 'Board' }).click();
      const seededBeatCard = page.locator(`[data-beat-id="${beatId}"]`);
      const seededBoardLift = seededBeatCard.getByRole('button', { name: 'Lift Beat' });
      await expect(seededBoardLift).toBeDisabled();
      await expect(seededBeatCard.getByText('This item has generation work in progress.', { exact: true })).toHaveCount(
        2
      );
      await expect(
        seededBeatCard.getByText('Downstream generation is still using this item.', { exact: true })
      ).toHaveCount(1);
      await expect(
        seededBeatCard.getByText('An authorized waiting item still depends on this item.', { exact: true })
      ).toHaveCount(1);
      const seededBeatSnapshot = await captureStudioNoMutationSnapshot(page, userDataDirectory, projectId);
      await seededBoardLift.evaluate((button: HTMLButtonElement) => button.click());
      await expectStudioNoMutation(page, userDataDirectory, projectId, seededBeatSnapshot);
      await expect(page.locator('[data-studio-bin]')).toContainText('The Bin is empty.');
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-beat-inflight-blockers.png');
      await seededNavigation.getByRole('link', { name: 'Table' }).click();

      await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'apply-authoring-batch', {
        projectId,
        expectedRevision: seededProject.revision,
        operations: [{ kind: 'set_seed_still', shotId, assetId: seedAssetId }],
      });

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const video = Object.values(project.jobs).find(
              (job) => job.shotId === shotId && job.purpose === 'video_take'
            );
            return {
              status: video?.status ?? null,
              assetId: video?.outputAssetIdsByRole.primary ?? null,
              errorCode: video?.error?.code ?? null,
            };
          },
          { timeout: 30_000 }
        )
        .toEqual({ status: 'succeeded', assetId: expect.any(String), errorCode: null });

      const renderedProject = await readStudioProject(page, projectId);
      const videoAssetId = Object.values(renderedProject.jobs).find(
        (job) => job.shotId === shotId && job.purpose === 'video_take'
      )?.outputAssetIdsByRole.primary;
      expect(videoAssetId).toBeTruthy();
      expect(renderedProject.shots[shotId]?.seedStillId).toBe(seedAssetId);
      const selected = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'select-take', {
        projectId,
        expectedRevision: renderedProject.revision,
        shotId,
        assetId: videoAssetId,
      });

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const video = Object.values(project.jobs).find(
              (job) => job.shotId === anchorShotId && job.purpose === 'video_take'
            );
            return {
              status: video?.status ?? null,
              assetId: video?.outputAssetIdsByRole.primary ?? null,
              errorCode: video?.error?.code ?? null,
            };
          },
          { timeout: 30_000 }
        )
        .toEqual({ status: 'succeeded', assetId: expect.any(String), errorCode: null });

      const chainedProject = await readStudioProject(page, projectId);
      const anchorVideoAssetId = Object.values(chainedProject.jobs).find(
        (job) => job.shotId === anchorShotId && job.purpose === 'video_take'
      )?.outputAssetIdsByRole.primary;
      expect(anchorVideoAssetId).toBeTruthy();
      const selectedAnchor = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'select-take', {
        projectId,
        expectedRevision: chainedProject.revision,
        shotId: anchorShotId,
        assetId: anchorVideoAssetId,
      });

      const terminal = await readStudioProject(page, projectId);
      expect(selected.projectRevision).toBeGreaterThan(confirmed.projectRevision);
      expect(terminal.revision).toBe(selectedAnchor.projectRevision);
      expect(terminal.revision).toBeGreaterThan(confirmed.projectRevision);
      expect(terminal.shots[shotId]?.selectedTakeId).toBe(videoAssetId);
      expect(terminal.shots[anchorShotId]?.selectedTakeId).toBe(anchorVideoAssetId);
      expect(terminal.assets[videoAssetId!]?.durationSeconds).toBe(10);
      expect(terminal.assets[anchorVideoAssetId!]?.durationSeconds).toBe(10);
      const initialRaw = await readRawStudioProject(userDataDirectory, projectId);
      const initialExtraction = Object.values(initialRaw.frameExtractions).find(
        (extraction) => extraction.takeAssetId === videoAssetId
      );
      expect(initialExtraction).toMatchObject({
        shotId,
        takeAssetId: videoAssetId,
        endpointSeconds: 10,
        status: 'ready',
        frameAssetId: expect.any(String),
      });

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'table', { timeout: 30_000 });
      const renderedRow = page
        .getByRole('grid', { name: 'Beat table' })
        .getByRole('row')
        .filter({ hasText: 'Landing' });
      await expect(renderedRow).toBeVisible();
      await renderedRow.getByRole('gridcell').first().click();
      const panel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
      await expect(panel).toBeVisible();
      await expect(page.locator(controlsSelector).locator('small').filter({ hasText: 'Ready' })).toHaveCount(2);
      const playbackLane = panel.getByRole('group', { name: 'Playback coverage' });
      const planningLane = panel.getByRole('group', { name: 'Planning overlay' });
      await expect(playbackLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('10s source');
      await expect(planningLane.locator(`[data-shot-id="${shotId}"]`)).toContainText('8s plan');

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
      await expect(panel.getByText('Tail trim breaks downstream continuity.')).toBeVisible();
      await expect(panel.locator(`article[data-shot-id="${anchorShotId}"]`)).toContainText('Continuity is out of date');

      const trimmed = await readStudioProject(page, projectId);
      expect(trimmed.shots[shotId]).toEqual({ ...terminal.shots[shotId], trimOutSeconds: 2 });
      expect(trimmed.shots[anchorShotId]).toEqual(terminal.shots[anchorShotId]);
      expect(trimmed.assets).toEqual(terminal.assets);
      expect(trimmed.jobs).toEqual(terminal.jobs);
      expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeTrim);
      expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(
        initialRaw.frameExtractions
      );

      const existingJobIds = new Set(Object.keys(trimmed.jobs));
      const rerenderPrepared = await invokeStudioBridge<StudioRendererPreparedSubmissionOptionsV2>(
        page,
        'prepare-submission',
        {
          projectId,
          expectedRevision: trimmed.revision,
          originReferenceHandoffId: null,
          baseChoices: [{ shotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null }],
          cascadeChoices: [{ shotId: anchorShotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null }],
        }
      );
      expect(rerenderPrepared.withCascade).not.toBeNull();
      expect(
        rerenderPrepared.withCascade?.baseItems.map(({ shotId: itemShotId, purpose }) => [itemShotId, purpose])
      ).toEqual([[shotId, 'video_take']]);
      expect(
        rerenderPrepared.withCascade?.cascadeItems.map(({ shotId: itemShotId, purpose }) => [itemShotId, purpose])
      ).toEqual([[anchorShotId, 'video_take']]);
      await invokeStudioBridge<StudioConfirmSubmissionResultV2>(page, 'confirm-submission', {
        projectId,
        quoteId: rerenderPrepared.withCascade!.id,
        expectedRevision: trimmed.revision,
      });

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const firstVideo = Object.values(project.jobs).find(
              (job) => !existingJobIds.has(job.id) && job.shotId === shotId && job.purpose === 'video_take'
            );
            const downstreamVideo = Object.values(project.jobs).find(
              (job) => !existingJobIds.has(job.id) && job.shotId === anchorShotId && job.purpose === 'video_take'
            );
            return {
              firstStatus: firstVideo?.status ?? null,
              firstAssetId: firstVideo?.outputAssetIdsByRole.primary ?? null,
              downstreamStatus: downstreamVideo?.status ?? null,
            };
          },
          { timeout: 30_000 }
        )
        .toEqual({
          firstStatus: 'succeeded',
          firstAssetId: expect.any(String),
          downstreamStatus: 'waiting_for_conditioning',
        });

      const replacementReady = await readStudioProject(page, projectId);
      const replacementFirstJob = Object.values(replacementReady.jobs).find(
        (job) => !existingJobIds.has(job.id) && job.shotId === shotId && job.purpose === 'video_take'
      );
      const replacementVideoAssetId = replacementFirstJob?.outputAssetIdsByRole.primary;
      expect(replacementVideoAssetId).toBeTruthy();
      expect(replacementReady.assets[replacementVideoAssetId!]?.durationSeconds).toBe(10);

      await page.reload({ waitUntil: 'domcontentloaded' });
      const downstreamRow = page
        .getByRole('grid', { name: 'Beat table' })
        .getByRole('row')
        .filter({ hasText: 'Landing' });
      await downstreamRow.getByRole('gridcell').first().click();
      const downstreamPanel = page.getByRole('dialog', { name: 'Beat panel — Landing' });
      const downstreamShotCard = downstreamPanel.locator(`article[data-shot-id="${shotId}"]`);
      const downstreamLift = downstreamShotCard.getByRole('button', { name: 'Lift Shot' });
      await expect(downstreamLift).toBeDisabled();
      await expect(
        downstreamShotCard.getByText('Downstream generation is still using this item.', { exact: true })
      ).toBeVisible();
      const downstreamBeatLift = downstreamPanel.getByRole('button', { name: 'Lift Beat' });
      await expect(downstreamBeatLift).toBeDisabled();
      await expect(
        downstreamPanel.getByText('Downstream generation is still using this item.', { exact: true })
      ).toHaveCount(2);
      const downstreamSnapshot = await captureStudioNoMutationSnapshot(page, userDataDirectory, projectId);
      await downstreamLift.evaluate((button: HTMLButtonElement) => button.click());
      await downstreamBeatLift.evaluate((button: HTMLButtonElement) => button.click());
      await expectStudioNoMutation(page, userDataDirectory, projectId, downstreamSnapshot);
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-shot-downstream-nonterminal.png');
      await downstreamPanel.getByRole('button', { name: 'Close' }).click();

      await page.locator(viewNavigationSelector).getByRole('link', { name: 'Board' }).click();
      const downstreamBeatCard = page.locator(`[data-beat-id="${beatId}"]`);
      const downstreamBoardLift = downstreamBeatCard.getByRole('button', { name: 'Lift Beat' });
      await expect(downstreamBoardLift).toBeDisabled();
      await expect(
        downstreamBeatCard.getByText('Downstream generation is still using this item.', { exact: true })
      ).toHaveCount(1);
      await expect(
        downstreamBeatCard.getByText('An authorized waiting item still depends on this item.', { exact: true })
      ).toHaveCount(1);
      await expect(
        downstreamBeatCard.getByText('This item has generation work in progress.', { exact: true })
      ).toHaveCount(1);
      const downstreamBeatSnapshot = await captureStudioNoMutationSnapshot(page, userDataDirectory, projectId);
      await downstreamBoardLift.evaluate((button: HTMLButtonElement) => button.click());
      await expectStudioNoMutation(page, userDataDirectory, projectId, downstreamBeatSnapshot);
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-beat-downstream-nonterminal.png');
      await page.locator(viewNavigationSelector).getByRole('link', { name: 'Table' }).click();
      await downstreamRow.getByRole('gridcell').first().click();
      await expect(downstreamPanel).toBeVisible();

      await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'select-take', {
        projectId,
        expectedRevision: replacementReady.revision,
        shotId,
        assetId: replacementVideoAssetId,
      });

      const replacementSelected = await readStudioProject(page, projectId);
      expect(replacementSelected.shots[shotId]?.selectedTakeId).toBe(replacementVideoAssetId);
      expect(replacementSelected.shots[shotId]?.trimOutSeconds).toBe(2);
      await expect
        .poll(async () => {
          const raw = await readRawStudioProject(userDataDirectory, projectId);
          return Object.values(raw.frameExtractions)
            .filter((extraction) => extraction.takeAssetId === replacementVideoAssetId)
            .map(({ shotId: extractionShotId, takeAssetId, endpointSeconds }) => ({
              shotId: extractionShotId,
              takeAssetId,
              endpointSeconds,
            }));
        })
        .toEqual([{ shotId, takeAssetId: replacementVideoAssetId, endpointSeconds: 8 }]);

      await expect
        .poll(
          async () => {
            const project = await readStudioProject(page, projectId);
            const video = Object.values(project.jobs).find(
              (job) => !existingJobIds.has(job.id) && job.shotId === anchorShotId && job.purpose === 'video_take'
            );
            return {
              status: video?.status ?? null,
              assetId: video?.outputAssetIdsByRole.primary ?? null,
              errorCode: video?.error?.code ?? null,
            };
          },
          { timeout: 30_000 }
        )
        .toEqual({ status: 'succeeded', assetId: expect.any(String), errorCode: null });

      const replacementChain = await readStudioProject(page, projectId);
      const replacementDownstreamJob = Object.values(replacementChain.jobs).find(
        (job) => !existingJobIds.has(job.id) && job.shotId === anchorShotId && job.purpose === 'video_take'
      );
      const replacementDownstreamAssetId = replacementDownstreamJob?.outputAssetIdsByRole.primary;
      expect(replacementDownstreamAssetId).toBeTruthy();
      const selectedReplacementDownstream = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(
        page,
        'select-take',
        {
          projectId,
          expectedRevision: replacementChain.revision,
          shotId: anchorShotId,
          assetId: replacementDownstreamAssetId,
        }
      );

      const shotCard = panel.locator(`article[data-shot-id="${shotId}"]`);
      const clearSeedPin = shotCard.getByRole('button', { name: 'Clear seed pin' });
      await expect(clearSeedPin).toBeEnabled();
      await clearSeedPin.click();
      await expect.poll(async () => (await readStudioProject(page, projectId)).shots[shotId]?.seedStillId).toBeNull();

      const terminalForLift = await readStudioProject(page, projectId);
      expect(terminalForLift.revision).toBe(selectedReplacementDownstream.projectRevision + 1);
      expect(terminalForLift.shots[shotId]?.selectedTakeId).toBe(replacementVideoAssetId);
      expect(terminalForLift.shots[shotId]?.trimOutSeconds).toBe(2);
      expect(terminalForLift.shots[anchorShotId]?.selectedTakeId).toBe(replacementDownstreamAssetId);
      const terminalRaw = await readRawStudioProject(userDataDirectory, projectId);
      const replacementExtraction = Object.values(terminalRaw.frameExtractions).find(
        (extraction) => extraction.takeAssetId === replacementVideoAssetId
      );
      expect(replacementExtraction).toMatchObject({
        shotId,
        takeAssetId: replacementVideoAssetId,
        endpointSeconds: 8,
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
        endpointSeconds: 8,
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
    test('imports and replaces a bed, sets Match To, and creates only the three non-stitched exports', async ({
      electronApp,
      page,
    }) => {
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
      await expect(cut.locator('[data-export-shape]')).toHaveCount(3);
      await expect(cut.locator('[data-export-shape="editor_folder"]')).toBeVisible();
      await expect(cut.locator('[data-export-shape="still"]')).toBeVisible();
      await expect(cut.locator('[data-export-shape="script"]')).toBeVisible();
      await expect(cut).not.toContainText(/stitched|auto-duck/i);

      const beforeCancel = await readStudioProject(page, rendered.projectId);
      const importAudio = cut.getByRole('button', { name: 'Import audio' });
      await importAudio.click();
      await expect(cut).toContainText('Audio import was cancelled.');
      expect(await readStudioProject(page, rendered.projectId)).toEqual(beforeCancel);

      await importAudio.click();
      await expect(cut).toContainText('Audio could not be imported.');
      await expect(
        page.getByRole('alert').filter({ hasText: 'The request contains invalid or incomplete information.' })
      ).toBeVisible();
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

      await chooseArcoSelectOption(page, 'Prompt reference Shot', 'The airplane settles into frame.');
      await expect
        .poll(async () => (await readStudioProject(page, rendered.projectId)).matchToShotId)
        .toBe(rendered.shotId);
      const matched = await readStudioProject(page, rendered.projectId);
      expect(matched.revision).toBe(replaced.revision + 1);
      expect(matched.jobs).toEqual(replaced.jobs);

      await captureCutViewportReference(page, studioViewportReferences[0]);
      await captureCutViewportReference(page, studioViewportReferences[1]);
      await captureCutViewportReference(page, studioViewportReferences[2]);
      await captureCutViewportReference(page, studioViewportReferences[3]);
      await page.locator('html').evaluate((element) => element.setAttribute('dir', 'ltr'));
      await page.setViewportSize({ width: 1440, height: 900 });

      const createAndReadCatalog = async (buttonName: string, expectedShapes: string[]) => {
        await cut.getByRole('button', { name: buttonName }).click();
        await expect
          .poll(async () => {
            const catalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
              projectId: rendered.projectId,
            });
            return catalog.artifacts.map((artifact) => artifact.shape).toSorted();
          })
          .toEqual(expectedShapes.toSorted());
      };
      await expect(cut.getByRole('button', { name: 'Create editor folder' })).toBeEnabled();
      await createAndReadCatalog('Create editor folder', ['editor_folder']);
      await chooseArcoSelectOption(page, 'Shot cover', 'The airplane settles into frame.');
      await expect(cut.getByRole('button', { name: 'Create still' })).toBeEnabled();
      await createAndReadCatalog('Create still', ['editor_folder', 'still']);
      await createAndReadCatalog('Create script.md', ['editor_folder', 'script', 'still']);

      const catalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
        projectId: rendered.projectId,
      });
      expect(catalog.artifacts.map((artifact) => artifact.shape).toSorted()).toEqual([
        'editor_folder',
        'script',
        'still',
      ]);
      await cut.getByRole('button', { name: 'Assets' }).click();
      const drawer = page.locator('[data-studio-assets-drawer]');
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-audio-position]')).toHaveCount(2);
      await expect(drawer.locator('[data-export-artifact-id]')).toHaveCount(3);
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
        beatId: rendered.beatId,
        shotId: rendered.shotId,
        firstBedAssetId,
        selectedBedAssetId,
        exportArtifacts: catalog.artifacts,
        providerCalls,
        userDataDirectory,
      };

      await electronApp.close();
    });

    test('reloads retained Cut state, refuses the Match To lift, then clears, detaches, copies, and reveals', async ({
      electronApp,
      page,
    }) => {
      test.skip(
        process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
        'The Cut no-spend oracle requires the explicit development-only Studio fake adapter.'
      );
      const state = requireCutLifecycleState();
      const requestedCopyDirectory = path.join(
        studioStorageDirectory(state.userDataDirectory),
        '.studio-raw-output-path-sentinel',
        `cut-export-copies-${Date.now()}`
      );
      await mkdir(requestedCopyDirectory, { recursive: true });
      const copyDirectory = await realpath(requestedCopyDirectory);
      const editorCopyPath = path.join(copyDirectory, 'editor-folder-copy');
      const stillCopyPath = path.join(copyDirectory, 'still-copy.png');
      const scriptCopyPath = path.join(copyDirectory, 'script-copy.md');
      await installStudioE2ENativeHarness(electronApp, {
        savePaths: [null, editorCopyPath, stillCopyPath, scriptCopyPath],
      });
      const restartedProviderCalls = await readStudioE2EProviderCallCounts(state.userDataDirectory);

      await navigateTo(page, `#/studio/${encodeURIComponent(state.projectId)}/cut`);
      await expect(page).toHaveURL(new RegExp(`#/studio/${state.projectId}/cut$`));
      const cut = page.locator('[data-studio-cut]');
      await expect(cut).toBeVisible();
      const restarted = await readStudioProject(page, state.projectId);
      expect(restarted.bedAssetId).toBe(state.selectedBedAssetId);
      expect(restarted.matchToShotId).toBe(state.shotId);
      expect(
        Object.values(restarted.assets)
          .filter((asset) => asset.mediaKind === 'audio')
          .map((asset) => asset.id)
          .toSorted()
      ).toEqual([state.firstBedAssetId, state.selectedBedAssetId].toSorted());
      await expect(cut.locator('[data-bed-status="ready"]')).toContainText('18s source · fade from 8s to 10s');

      await cut.getByRole('button', { name: 'Refresh exports' }).click();
      await expect(cut).toContainText('Export assets refreshed.');
      const retainedCatalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
        projectId: state.projectId,
      });
      expect(retainedCatalog).toEqual({
        revision: expect.any(Number),
        artifacts: state.exportArtifacts,
      });
      await cut.getByRole('button', { name: 'Assets' }).click();
      let drawer = page.locator('[data-studio-assets-drawer]');
      await expect(drawer).toBeVisible();
      await expect(drawer.locator('[data-export-artifact-id]')).toHaveCount(3);
      await page.getByRole('button', { name: 'Close Assets' }).click();

      await applyStudioViewportReference(page, studioViewportReferences[0]);
      await page.locator(viewNavigationSelector).getByRole('link', { name: 'Table' }).click();
      const row = page
        .getByRole('grid', { name: 'Beat table' })
        .getByRole('row')
        .filter({ hasText: 'Cut export Beat' });
      await row.getByRole('gridcell').first().click();
      const panel = page.getByRole('dialog', { name: 'Beat panel — Cut export Beat' });
      await expect(panel).toBeVisible();
      const currentMatchShotCard = panel.locator(`article[data-shot-id="${state.shotId}"]`);
      const currentMatchShotLift = currentMatchShotCard.getByRole('button', { name: 'Lift Shot', exact: true });
      await expect(currentMatchShotLift).toBeDisabled();
      await expect(
        currentMatchShotCard.getByText('This Shot is the current Match To reference.', { exact: true })
      ).toBeVisible();
      const currentMatchBeatLift = panel.getByRole('button', { name: 'Lift Beat', exact: true });
      await expect(currentMatchBeatLift).toBeDisabled();
      await expect(panel.getByText('This Shot is the current Match To reference.', { exact: true })).toHaveCount(2);
      const currentMatchShotSnapshot = await captureStudioNoMutationSnapshot(
        page,
        state.userDataDirectory,
        state.projectId
      );
      await currentMatchShotLift.evaluate((button: HTMLButtonElement) => button.click());
      await currentMatchBeatLift.evaluate((button: HTMLButtonElement) => button.click());
      await expectStudioNoMutation(page, state.userDataDirectory, state.projectId, currentMatchShotSnapshot);
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-shot-current-match.png');
      await panel.getByRole('button', { name: 'Close' }).click();

      await page.locator(viewNavigationSelector).getByRole('link', { name: 'Board' }).click();
      const currentMatchBeatCard = page.locator(`[data-beat-id="${state.beatId}"]`);
      const currentMatchBoardLift = currentMatchBeatCard.getByRole('button', { name: 'Lift Beat', exact: true });
      await expect(currentMatchBoardLift).toBeDisabled();
      await expect(
        currentMatchBeatCard.getByText('This Shot is the current Match To reference.', { exact: true })
      ).toHaveCount(1);
      const currentMatchBeatSnapshot = await captureStudioNoMutationSnapshot(
        page,
        state.userDataDirectory,
        state.projectId
      );
      await currentMatchBoardLift.evaluate((button: HTMLButtonElement) => button.click());
      await expectStudioNoMutation(page, state.userDataDirectory, state.projectId, currentMatchBeatSnapshot);
      await takeScreenshot(page, 'creative-studio/gate-3/refusal-beat-current-match.png');

      await page.locator(viewNavigationSelector).getByRole('link', { name: 'Cut' }).click();
      await clearArcoSelect(page, 'Prompt reference Shot');
      await expect.poll(async () => (await readStudioProject(page, state.projectId)).matchToShotId).toBeNull();
      const matchCleared = await readStudioProject(page, state.projectId);
      expect(matchCleared.revision).toBe(restarted.revision + 1);
      expect(matchCleared.jobs).toEqual(restarted.jobs);

      await clearArcoSelect(page, 'Selected audio bed');
      await expect.poll(async () => (await readStudioProject(page, state.projectId)).bedAssetId).toBeNull();
      const bedCleared = await readStudioProject(page, state.projectId);
      expect(bedCleared.revision).toBe(matchCleared.revision + 1);
      expect(bedCleared.assets[state.firstBedAssetId]).toEqual(matchCleared.assets[state.firstBedAssetId]);
      expect(bedCleared.assets[state.selectedBedAssetId]).toEqual(matchCleared.assets[state.selectedBedAssetId]);

      await chooseArcoSelectOption(page, 'Selected audio bed', 'Imported bed 1');
      await expect
        .poll(async () => (await readStudioProject(page, state.projectId)).bedAssetId)
        .toBe(state.selectedBedAssetId);
      await cut.getByRole('button', { name: 'Assets' }).click();
      drawer = page.locator('[data-studio-assets-drawer]');
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

      const destinationExists = async (destination: string): Promise<boolean> => {
        try {
          await lstat(destination);
          return true;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
          throw error;
        }
      };
      const beforeCopyCancelProject = await readStudioProject(page, state.projectId);
      const beforeCopyCancelCatalog = await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
        projectId: state.projectId,
      });
      const editorItem = drawer.locator('[data-export-artifact-id]').filter({ hasText: 'Editor folder' });
      await editorItem.getByRole('button', { name: 'Copy…' }).click();
      await expect(cut).toContainText('Export copy was cancelled.');
      expect(await Promise.all([editorCopyPath, stillCopyPath, scriptCopyPath].map(destinationExists))).toEqual([
        false,
        false,
        false,
      ]);
      expect(await readStudioProject(page, state.projectId)).toEqual(beforeCopyCancelProject);
      expect(
        await invokeStudioBridge<StudioRendererExportCatalogV2>(page, 'list-exports', {
          projectId: state.projectId,
        })
      ).toEqual(beforeCopyCancelCatalog);
      expect(await readStudioE2EProviderCallCounts(state.userDataDirectory)).toEqual(restartedProviderCalls);
      expect(await readStudioE2ENativeHarness(electronApp)).toMatchObject({
        saveRequestCount: 1,
        remainingSavePaths: 3,
        revealedPaths: [],
      });

      const copyAndReveal = async (
        shapeLabel: 'Editor folder' | 'Still' | 'Script',
        destination: string,
        expectedDirectory: boolean,
        expectedInvocation: number
      ): Promise<void> => {
        const item = drawer.locator('[data-export-artifact-id]').filter({ hasText: shapeLabel });
        await item.getByRole('button', { name: 'Copy…' }).click();
        await expect
          .poll(async () => {
            try {
              const stats = await lstat(destination);
              return expectedDirectory ? stats.isDirectory() : stats.isFile();
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
              throw error;
            }
          })
          .toBe(true);
        await item.getByRole('button', { name: 'Reveal' }).click();
        await expect
          .poll(async () => (await readStudioE2ENativeHarness(electronApp)).revealedPaths.length)
          .toBe(expectedInvocation);
      };
      await copyAndReveal('Editor folder', editorCopyPath, true, 1);
      await copyAndReveal('Still', stillCopyPath, false, 2);
      await copyAndReveal('Script', scriptCopyPath, false, 3);
      expect(await readFile(scriptCopyPath, 'utf8')).toContain('The airplane settles into frame.');

      const harness = await readStudioE2ENativeHarness(electronApp);
      expect(harness).toMatchObject({
        openRequestCount: 0,
        remainingOpenPaths: 0,
        saveRequestCount: 4,
        remainingSavePaths: 0,
      });
      expect(harness.revealedPaths).toHaveLength(3);
      expect(new Set(harness.revealedPaths).size).toBe(3);
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
