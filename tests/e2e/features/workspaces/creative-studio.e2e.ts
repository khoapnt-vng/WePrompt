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
import { navigateTo, ROUTES } from '../../helpers';
import type {
  StudioConfirmSubmissionResultV2,
  StudioProjectLoadResultV2,
  StudioProjectListResultV2,
  StudioProjectV2,
  StudioRendererPreparedSubmissionOptionsV2,
  StudioRendererProjectCommitResultV2,
  StudioRendererProjectV2,
  StudioRouteCatalogV2,
} from '@/common/types/project/creativeStudioTypes';
import { lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page } from '@playwright/test';

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
  | 'list-projects'
  | 'list-routes'
  | 'prepare-submission'
  | 'restore-shot'
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

  test('trims and rerenders a continuous chain before retaining it through lift and restore', async ({
    electronApp,
    page,
  }) => {
    test.skip(
      process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
      'The terminal Shot lifecycle requires the explicit development-only Studio fake adapter.'
    );

    const projectBrief = `A rendered paper-airplane landing ${Date.now()}.`;
    await navigateTo(page, ROUTES.studio);
    const workspace = page.locator(workspaceSelector);
    await workspace.getByLabel('What do you want to make?').fill(projectBrief);
    await workspace.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/table$/);

    const projectId = projectIdFromStudioUrl(page);
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
    expect(prepared.withCascade?.cascadeItems.map(({ shotId: itemShotId, purpose }) => [itemShotId, purpose])).toEqual([
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
          const seed = Object.values(project.jobs).find((job) => job.shotId === shotId && job.purpose === 'seed_still');
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
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
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
    const renderedRow = page.getByRole('grid', { name: 'Beat table' }).getByRole('row').filter({ hasText: 'Landing' });
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

    const shotCard = panel.locator(`[data-shot-id="${shotId}"]`);
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

    const retainedShot = structuredClone(terminalForLift.shots[shotId]);
    const retainedAnchorShot = structuredClone(terminalForLift.shots[anchorShotId]);
    const retainedAssets = structuredClone(terminalForLift.assets);
    const retainedJobs = structuredClone(terminalForLift.jobs);
    const retainedFrameExtractions = structuredClone(terminalRaw.frameExtractions);
    const providerCallsBeforeLift = await readStudioE2EProviderCallCounts(userDataDirectory);

    const liftShot = shotCard.getByRole('button', { name: 'Lift Shot' });
    await expect(liftShot).toBeEnabled();
    await liftShot.click();
    const confirmLift = page.locator('.arco-popconfirm .arco-btn-primary').filter({ hasText: 'Lift Shot' });
    await expect(confirmLift).toBeVisible();
    await confirmLift.click();
    await expect
      .poll(async () => (await readStudioProject(page, projectId)).beats[beatId]?.shotOrder)
      .toEqual([anchorShotId]);
    const parked = await readStudioProject(page, projectId);
    expect(parked.revision).toBe(terminalForLift.revision + 1);
    expect(parked.beats[beatId]?.shotOrder).toEqual([anchorShotId]);
    expect(parked.bin).toContainEqual({ kind: 'shot', beatId, shotId, reason: 'lifted' });
    expect(parked.shots[shotId]).toEqual(retainedShot);
    expect(parked.shots[anchorShotId]).toEqual(retainedAnchorShot);
    expect(parked.assets).toEqual(retainedAssets);
    expect(parked.jobs).toEqual(retainedJobs);
    expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(
      retainedFrameExtractions
    );
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeLift);

    await panel.getByRole('button', { name: 'Close' }).click();
    await expect(panel).toBeHidden();

    const restored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'restore-shot', {
      projectId,
      expectedRevision: parked.revision,
      shotId,
      beforeShotId: null,
    });
    const activeAgain = await readStudioProject(page, projectId);
    expect(activeAgain.revision).toBe(restored.projectRevision);
    expect(activeAgain.beats[beatId]?.shotOrder).toEqual([anchorShotId, shotId]);
    expect(activeAgain.bin).not.toContainEqual({ kind: 'shot', beatId, shotId, reason: 'lifted' });
    expect(activeAgain.shots[shotId]).toEqual(retainedShot);
    expect(activeAgain.shots[anchorShotId]).toEqual(retainedAnchorShot);
    expect(activeAgain.assets).toEqual(retainedAssets);
    expect(activeAgain.jobs).toEqual(retainedJobs);
    expect((await readRawStudioProject(userDataDirectory, projectId)).frameExtractions).toEqual(
      retainedFrameExtractions
    );
    await expect(panel).toBeHidden();
    await renderedRow.getByRole('gridcell').first().click();
    await expect(panel).toBeVisible();
    const restoredAnchorCard = panel.locator(`article[data-shot-id="${anchorShotId}"]`);
    const restoredShotCard = panel.locator(`article[data-shot-id="${shotId}"]`);
    await expect(restoredAnchorCard).toContainText('Segment head');
    await expect(restoredAnchorCard).toContainText('Continuity is out of date');
    await expect(restoredShotCard).toContainText('Continuous');
    await expect(restoredShotCard).toContainText('Continuity is out of date');
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeLift);
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
