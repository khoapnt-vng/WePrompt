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
  | 'park-shot'
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

  test('lifts and restores a rendered terminal Shot without another provider call', async ({ electronApp, page }) => {
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
            targetSeconds: 4,
          },
          beforeBeatId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId,
          shot: { line: 'The plane lands.', narration: '', onScreenText: '', durationSeconds: 4 },
          beforeShotId: null,
        },
        {
          kind: 'add_shot',
          beatId,
          shotId: anchorShotId,
          shot: { line: 'The desk remains in view.', narration: '', onScreenText: '', durationSeconds: 4 },
          beforeShotId: null,
        },
        { kind: 'set_hard_cut', shotId: anchorShotId, hardCut: true },
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
      cascadeChoices: [{ shotId, purpose: 'video_take', generationCount: 1, referenceAssetId: null }],
    });
    expect(prepared.withCascade).not.toBeNull();
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
          return {
            seedStatus: seed?.status ?? null,
            seedAssetId: seed?.outputAssetIdsByRole.primary ?? null,
            videoStatus: video?.status ?? null,
          };
        },
        { timeout: 30_000 }
      )
      .toEqual({ seedStatus: 'succeeded', seedAssetId: expect.any(String), videoStatus: 'waiting_for_conditioning' });

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

    const terminal = await readStudioProject(page, projectId);
    expect(terminal.revision).toBe(selected.projectRevision);
    expect(terminal.revision).toBeGreaterThan(confirmed.projectRevision);
    expect(terminal.shots[shotId]?.selectedTakeId).toBe(videoAssetId);
    const retainedShot = structuredClone(terminal.shots[shotId]);
    const retainedAnchorShot = structuredClone(terminal.shots[anchorShotId]);
    const retainedAssets = structuredClone(terminal.assets);
    const retainedJobs = structuredClone(terminal.jobs);
    const userDataDirectory = await electronApp.evaluate(({ app }) => app.getPath('userData'));
    const providerCallsBeforeLift = await readStudioE2EProviderCallCounts(userDataDirectory);

    const lifted = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'park-shot', {
      projectId,
      expectedRevision: terminal.revision,
      shotId,
    });
    const parked = await readStudioProject(page, projectId);
    expect(parked.revision).toBe(lifted.projectRevision);
    expect(parked.beats[beatId]?.shotOrder).toEqual([anchorShotId]);
    expect(parked.bin).toContainEqual({ kind: 'shot', beatId, shotId, reason: 'lifted' });
    expect(parked.shots[shotId]).toEqual(retainedShot);
    expect(parked.shots[anchorShotId]).toEqual(retainedAnchorShot);
    expect(parked.assets).toEqual(retainedAssets);
    expect(parked.jobs).toEqual(retainedJobs);
    expect(await readStudioE2EProviderCallCounts(userDataDirectory)).toEqual(providerCallsBeforeLift);

    const restored = await invokeStudioBridge<StudioRendererProjectCommitResultV2>(page, 'restore-shot', {
      projectId,
      expectedRevision: parked.revision,
      shotId,
      beforeShotId: anchorShotId,
    });
    const activeAgain = await readStudioProject(page, projectId);
    expect(activeAgain.revision).toBe(restored.projectRevision);
    expect(activeAgain.beats[beatId]?.shotOrder).toEqual([shotId, anchorShotId]);
    expect(activeAgain.bin).not.toContainEqual({ kind: 'shot', beatId, shotId, reason: 'lifted' });
    expect(activeAgain.shots[shotId]).toEqual(retainedShot);
    expect(activeAgain.shots[anchorShotId]).toEqual(retainedAnchorShot);
    expect(activeAgain.assets).toEqual(retainedAssets);
    expect(activeAgain.jobs).toEqual(retainedJobs);
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
