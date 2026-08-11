/**
 * Creative Studio phase-shell persistence and zero-provider coverage.
 *
 * Run with:
 * AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/creative-studio.e2e.ts
 */
import { expect, test } from '../../fixtures';
import { navigateTo, ROUTES } from '../../helpers';
import type { Page } from '@playwright/test';
import path from 'node:path';

const mainProcessOnlySentinels = [
  'STUDIO_SECRET_CREDENTIAL_SENTINEL',
  'https://studio-provider-url-sentinel.invalid/v1',
  'STUDIO_PROVIDER_JOB_SENTINEL',
  'STUDIO_RAW_OUTPUT_BODY_SENTINEL',
  '/private/STUDIO_RAW_OUTPUT_PATH_SENTINEL/provider-output.bin',
];

const studioPhases = ['brief', 'write', 'produce', 'review'] as const;
type StudioPhase = (typeof studioPhases)[number];

const phaseLabels: Record<StudioPhase, string> = {
  brief: 'Brief',
  write: 'Write',
  produce: 'Produce',
  review: 'Review',
};

const phaseCtas: Record<StudioPhase, string> = {
  brief: 'Start writing',
  write: 'Continue to Produce',
  produce: 'Review cut',
  review: 'Prepare handoff',
};

const phaseCtaPattern = /^(Start writing|Continue to Produce|Review cut|Prepare handoff)$/;
const timingGateCopy = [
  'Match the storyboard duration to the target before generating all ready shots.',
  'Scene timing must match the project target before batch generation.',
];

// A project adopts a generation route only when exactly one compatible engine exists.
// The unpackaged fake catalog exposes two image models but a single video model, so a
// freshly created project arrives with the video route adopted and the image route open.
const fakeCatalogRoutes = {
  image: null,
  video: expect.objectContaining({ providerId: 'weprompt_studio_e2e', model: 'weprompt-e2e-video' }),
};

type CanonicalStudioSnapshot = {
  projectId: string;
  revision: number;
  routes: {
    image: { choiceId: string; model: string } | null;
    video: { choiceId: string; model: string } | null;
  };
  scenes: Array<{
    id: string;
    title: string;
    narration: string;
    visualPrompt: string;
    durationSeconds: number;
  }>;
  jobs: Array<{ id: string; sceneId: string; status: string }>;
};

type StudioRouteOptionSnapshot = {
  providerId: string;
  providerName: string;
  model: string;
};

type StudioRouteCatalogSnapshot = {
  image: {
    selected: { choiceId: string; providerId: string; model: string } | null;
    options: StudioRouteOptionSnapshot[];
  };
  video: {
    selected: { choiceId: string; providerId: string; model: string } | null;
    options: StudioRouteOptionSnapshot[];
  };
};

const summarizeStudioRoute = ({ selected, options }: StudioRouteCatalogSnapshot['image']) => ({
  selected,
  options: options.map(({ providerId, providerName, model }) => ({ providerId, providerName, model })),
});

async function invokeStudioBridge<T>(
  page: Page,
  method: 'get-project' | 'list-routes',
  data: { projectId: string }
): Promise<T> {
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
      const response = await new Promise<unknown>((resolve, reject) => {
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
        }, 5_000);

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

      if (
        typeof response !== 'object' ||
        response === null ||
        !('ok' in response) ||
        response.ok !== true ||
        !('data' in response) ||
        typeof response.data !== 'object' ||
        response.data === null
      ) {
        throw new Error(`Creative Studio ${requestedMethod} bridge data was unavailable`);
      }
      return response.data;
    },
    { requestedMethod: method, requestedData: data }
  );

  return result as T;
}

async function readCanonicalStudioSnapshot(page: Page, projectId: string): Promise<CanonicalStudioSnapshot> {
  type RendererProject = {
    id: string;
    revision: number;
    routing: {
      image: { choiceId: string; model: string } | null;
      video: { choiceId: string; model: string } | null;
    };
    sceneOrder: string[];
    scenes: Record<
      string,
      {
        id: string;
        title: string;
        narration: string;
        visualPrompt: string;
        durationSeconds: number;
      }
    >;
    jobs: Record<string, { id: string; sceneId: string; status: string }>;
  };
  const project = await invokeStudioBridge<RendererProject>(page, 'get-project', { projectId });

  return {
    projectId: project.id,
    revision: project.revision,
    routes: {
      image: project.routing.image,
      video: project.routing.video,
    },
    scenes: project.sceneOrder.flatMap((sceneId) => {
      const scene = project.scenes[sceneId];
      return scene?.id === sceneId
        ? [
            {
              id: scene.id,
              title: scene.title,
              narration: scene.narration,
              visualPrompt: scene.visualPrompt,
              durationSeconds: scene.durationSeconds,
            },
          ]
        : [];
    }),
    jobs: Object.values(project.jobs)
      .map((job) => ({ id: job.id, sceneId: job.sceneId, status: job.status }))
      .toSorted((left, right) => left.id.localeCompare(right.id)),
  };
}

async function readStudioRouteCatalog(page: Page, projectId: string): Promise<StudioRouteCatalogSnapshot> {
  type RendererRouteCatalog = {
    image: StudioRouteCatalogSnapshot['image'];
    video: StudioRouteCatalogSnapshot['video'];
  };
  const catalog = await invokeStudioBridge<RendererRouteCatalog>(page, 'list-routes', { projectId });
  return {
    image: summarizeStudioRoute(catalog.image),
    video: summarizeStudioRoute(catalog.video),
  };
}

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const studioPhaseHash = (projectId: string, phase: StudioPhase): string =>
  `#/studio/${encodeURIComponent(projectId)}/${phase}`;

const projectIdFromPhaseUrl = (page: Page, phase: StudioPhase): string => {
  const match = new URL(page.url()).hash.match(new RegExp(`^#/studio/([^/]+)/${phase}$`));
  if (!match?.[1]) throw new Error(`Creative Studio ${phase} route did not contain a project id`);
  return decodeURIComponent(match[1]);
};

async function openStudioLibrary(page: Page): Promise<void> {
  const studioLibrary = page.getByRole('region', { name: 'Creative Studio' });
  await navigateTo(page, ROUTES.studio);
  if (await studioLibrary.isVisible().catch(() => false)) return;
  await navigateTo(page, ROUTES.studio);
  await expect(studioLibrary).toBeVisible({ timeout: 15_000 });
}

async function assertStudioInvariants(page: Page): Promise<void> {
  const visibleAlertCount = await page.locator('[role="alert"]:visible').count();
  expect(visibleAlertCount, 'Creative Studio must never show competing alerts').toBeLessThanOrEqual(1);
  await Promise.all(timingGateCopy.map((copy) => expect(page.locator('body')).not.toContainText(copy)));
}

async function expectStudioPhase(page: Page, projectId: string, phase: StudioPhase): Promise<void> {
  const encodedProjectId = escapeRegExp(encodeURIComponent(projectId));
  await expect(page).toHaveURL(new RegExp(`#\\/studio\\/${encodedProjectId}\\/${phase}$`));

  const workflow = page.getByRole('navigation', { name: 'Creative workflow' });
  await expect(workflow).toBeVisible();
  await expect(workflow.getByRole('button')).toHaveCount(4);
  await expect(workflow.getByRole('button', { name: phaseLabels[phase], exact: true })).toHaveAttribute(
    'aria-current',
    'step'
  );
  await expect(page.getByRole('button', { name: phaseCtaPattern })).toHaveCount(1);
  await expect(page.getByRole('button', { name: phaseCtas[phase], exact: true })).toBeVisible();
  await assertStudioInvariants(page);
}

async function selectStudioPhase(page: Page, projectId: string, phase: StudioPhase): Promise<void> {
  await page
    .getByRole('navigation', { name: 'Creative workflow' })
    .getByRole('button', { name: phaseLabels[phase], exact: true })
    .click();
  await expectStudioPhase(page, projectId, phase);
}

/**
 * Produce's door when the workspace has NO compatible engine: the connect card is the
 * only content and no route can have been adopted.
 */
async function expectConnectEngineDoor(page: Page, projectId: string): Promise<void> {
  const connectionHeading = page.getByRole('heading', {
    level: 2,
    name: 'Connect an engine — about a minute, once for the whole workspace',
  });
  await expect(connectionHeading).toBeVisible();
  const connectionCard = connectionHeading.locator('..');
  await expect(connectionCard.getByRole('button')).toHaveCount(2);
  await expect(connectionCard.getByRole('button', { name: 'Open Model Settings' })).toBeVisible();
  await expect(connectionCard.getByRole('button', { name: 'Ask a teammate' })).toBeVisible();

  const phaseShell = page.locator('[data-studio-layout-root]');
  await expect(phaseShell.getByRole('combobox')).toHaveCount(0);
  await expect(phaseShell.getByRole('button', { name: /^(Render|Generate)/i })).toHaveCount(0);
  await expect(phaseShell.getByRole('region', { name: 'Storyboard' })).toHaveCount(0);
  await expect(phaseShell.getByText('Generation activity', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Review generation' })).toHaveCount(0);

  expect(await readCanonicalStudioSnapshot(page, projectId)).toMatchObject({
    projectId,
    routes: { image: null, video: null },
    jobs: [],
  });
  await assertStudioInvariants(page);
}

/**
 * Produce with the fake catalog's adopted video engine: the engine bar replaces the
 * connect door, but nothing has been generated and no generation dialog is open.
 */
async function expectIdleProduceSurface(page: Page, projectId: string): Promise<void> {
  await expect(page.getByRole('heading', { level: 2, name: /^Rendering with/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change engines' })).toBeVisible();
  await expect(
    page.getByRole('heading', {
      level: 2,
      name: 'Connect an engine — about a minute, once for the whole workspace',
    })
  ).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Review generation' })).toHaveCount(0);

  expect(await readCanonicalStudioSnapshot(page, projectId)).toMatchObject({
    projectId,
    routes: fakeCatalogRoutes,
    jobs: [],
  });
  await assertStudioInvariants(page);
}

test.describe('Creative Studio workspace', () => {
  test.describe.configure({ timeout: 120_000 });
  test.skip(
    process.env.AIONUI_E2E_TEST !== '1' || process.env.AIONUI_E2E_STUDIO_FAKE !== '1' || process.env.E2E_DEV !== '1',
    'Creative Studio E2E requires both fake-provider flags and an explicit unpackaged dev launch.'
  );

  test('uses the current phase shell while keeping Write available without an engine', async ({
    electronApp,
    page,
  }) => {
    const projectBrief = `A paper airplane carries a launch message across a calm blue studio ${Date.now()}.`;
    const shotTitle = 'Paper airplane launch';
    const narration = 'One small idea can carry a team forward.';
    const visualPrompt = 'A paper airplane crossing a calm blue studio backdrop.';
    let projectId = '';

    await test.step('prove the fake-provider runtime gate is active', async () => {
      const gate = await electronApp.evaluate(({ app }) => ({
        isPackaged: app.isPackaged,
        testMode: process.env.AIONUI_E2E_TEST,
        studioFake: process.env.AIONUI_E2E_STUDIO_FAKE,
        expectedUserDataPath: process.env.AIONUI_E2E_USER_DATA_DIR,
        userDataPath: app.getPath('userData'),
      }));
      expect(gate).toMatchObject({
        isPackaged: false,
        testMode: '1',
        studioFake: '1',
      });
      expect(gate.expectedUserDataPath).toBeTruthy();
      expect(gate.userDataPath).toBe(gate.expectedUserDataPath);

      const systemInfo = await electronApp.evaluate(async () => {
        const port = (globalThis as typeof globalThis & { __backendPort?: number }).__backendPort;
        if (!port) throw new Error('Studio E2E backend port was not published');
        const response = await fetch(`http://127.0.0.1:${port}/api/system/info`);
        if (!response.ok) throw new Error(`Studio E2E system info failed with ${response.status}`);
        const body = (await response.json()) as {
          data?: { cache_dir: string; work_dir: string };
          cache_dir?: string;
          work_dir?: string;
        };
        const data = body.data ?? body;
        return { cacheDir: data.cache_dir, workDir: data.work_dir };
      });
      expect(systemInfo).toEqual({
        cacheDir: path.join(gate.userDataPath, 'config'),
        workDir: path.join(gate.userDataPath, 'aionui'),
      });
    });

    await test.step('create a one-sentence project in the library and land on Brief', async () => {
      await openStudioLibrary(page);
      const studioLibrary = page.getByRole('region', { name: 'Creative Studio' });
      await expect(studioLibrary.getByRole('heading', { level: 1, name: 'Creative Studio' })).toBeVisible();

      const composer = studioLibrary.getByLabel('What are we making?');
      await expect(composer).toHaveAttribute('placeholder', 'A one-sentence idea for the story...');
      await expect(studioLibrary.getByRole('combobox', { name: 'Aspect ratio' })).toContainText('16:9');
      await expect(studioLibrary.getByRole('combobox', { name: 'Estimated length' })).toContainText('About 18s');
      await expect(studioLibrary.getByRole('region', { name: 'Start from a shape' })).toBeVisible();
      await composer.fill(projectBrief);
      await studioLibrary.getByRole('button', { name: 'Read my brief →' }).click();

      await expect(page).toHaveURL(/#\/studio\/[^/]+\/brief$/);
      projectId = projectIdFromPhaseUrl(page, 'brief');
      await expect(page.getByRole('heading', { level: 1, name: projectBrief })).toBeVisible();
      await expect(page.getByLabel('Aspect ratio: 16:9')).toBeVisible();
      await expectStudioPhase(page, projectId, 'brief');
      await expect(page.getByRole('region', { name: 'Brief' }).getByLabel('Creative intent')).toHaveValue(projectBrief);
      await expect(page.locator('[data-studio-layout-root] > header [role="status"]')).toHaveText('Saved');
      // A project adopts a route only when exactly one compatible engine exists, so the
      // fake catalog's single video model is adopted while its two image models are not.
      const snapshot = await readCanonicalStudioSnapshot(page, projectId);
      expect(snapshot).toMatchObject({
        projectId,
        routes: { image: null },
        scenes: [],
        jobs: [],
      });
      expect(snapshot.routes.video).toMatchObject({
        providerId: 'weprompt_studio_e2e',
        model: 'weprompt-e2e-video',
      });
      const routeCatalog = await readStudioRouteCatalog(page, projectId);
      expect(routeCatalog.image.selected).toBeNull();
      expect(routeCatalog.video.selected).toMatchObject({ model: 'weprompt-e2e-video' });
      expect(routeCatalog.image.options).toEqual(
        expect.arrayContaining([
          {
            providerId: 'weprompt_studio_e2e',
            providerName: 'WePrompt Studio E2E',
            model: 'weprompt-e2e-image',
          },
          {
            providerId: 'weprompt_studio_e2e',
            providerName: 'WePrompt Studio E2E',
            model: 'weprompt-e2e-image-next',
          },
        ])
      );
      expect(routeCatalog.video.options).toEqual(
        expect.arrayContaining([
          {
            providerId: 'weprompt_studio_e2e',
            providerName: 'WePrompt Studio E2E',
            model: 'weprompt-e2e-video',
          },
        ])
      );
    });

    await test.step('add and save a complete shot in Write without configuring an engine', async () => {
      await page.getByRole('button', { name: 'Start writing' }).click();
      await expectStudioPhase(page, projectId, 'write');
      const writePhase = page.getByRole('region', { name: 'Write' });
      await expect(writePhase.getByText('This step does not generate images or video.', { exact: true })).toBeVisible();
      await expect(writePhase.getByRole('button', { name: /render|generate/i })).toHaveCount(0);

      const scriptTable = writePhase.getByRole('region', { name: 'Script' });
      await expect(scriptTable.locator('div[aria-hidden="true"] > span')).toHaveText([
        'Shot',
        'Script',
        'Visual',
        'Output',
      ]);
      await scriptTable.getByRole('button', { name: 'Add shot' }).click();

      const emptyRow = scriptTable.getByRole('region', { name: 'Opening shot' });
      await expect(emptyRow).toBeVisible();
      await expect(emptyRow.getByLabel('Scene title')).toHaveValue('');
      await expect(emptyRow.getByLabel('Scene title')).toHaveAttribute('placeholder', 'Opening shot');
      await expect(emptyRow.getByRole('combobox', { name: 'Scene duration in seconds' })).toContainText('5s');
      await expect(emptyRow.getByRole('button', { name: 'More details' })).toHaveAttribute('aria-expanded', 'false');
      await expect(emptyRow.getByRole('button', { name: 'Suggest a visual' })).toBeVisible();
      await expect(emptyRow.getByRole('button', { name: 'Add reference' })).toBeVisible();
      await expect(emptyRow.getByRole('status').filter({ hasText: 'Needs title' })).toBeVisible();
      await expect(page.getByText('Untitled scene', { exact: true })).toHaveCount(0);

      await expect
        .poll(async () => {
          const snapshot = await readCanonicalStudioSnapshot(page, projectId);
          return snapshot.scenes.map(
            ({ title, narration: savedNarration, visualPrompt: savedVisual, durationSeconds }) => ({
              title,
              narration: savedNarration,
              visualPrompt: savedVisual,
              durationSeconds,
            })
          );
        })
        .toEqual([{ title: '', narration: '', visualPrompt: '', durationSeconds: 5 }]);

      await emptyRow.getByLabel('Scene title').fill(shotTitle);
      const shotRow = scriptTable.getByRole('region', { name: shotTitle });
      await shotRow.getByLabel('Narration').fill(narration);
      const visual = shotRow.getByLabel('Visual prompt');
      await visual.fill(visualPrompt);
      await visual.blur();

      await expect(shotRow.locator('[role="status"][data-state="saved"]')).toHaveText('Scene saved');
      await expect(page.locator('[data-studio-layout-root] > header [role="status"]')).toHaveText('Saved');
      // The pacing bar is gone; the off-target warning now lives in the shell advisory slot.
      await expect(page.locator('[data-studio-layout-root] > [role="alert"]')).toHaveText(
        'Storyboard timing does not match the project target.'
      );
      const continueToProduce = page.getByRole('button', { name: 'Continue to Produce' });
      await expect(continueToProduce).toBeEnabled();

      await expect
        .poll(async () => {
          const snapshot = await readCanonicalStudioSnapshot(page, projectId);
          return {
            routes: snapshot.routes,
            scenes: snapshot.scenes.map(
              ({ title, narration: savedNarration, visualPrompt: savedVisual, durationSeconds }) => ({
                title,
                narration: savedNarration,
                visualPrompt: savedVisual,
                durationSeconds,
              })
            ),
            jobs: snapshot.jobs,
          };
        })
        .toEqual({
          routes: fakeCatalogRoutes,
          scenes: [{ title: shotTitle, narration, visualPrompt, durationSeconds: 5 }],
          jobs: [],
        });
      await continueToProduce.click();
      await expectStudioPhase(page, projectId, 'produce');
      await expectIdleProduceSurface(page, projectId);
    });

    await test.step('navigate every phase in both directions and recover a deep-linked reload', async () => {
      await selectStudioPhase(page, projectId, 'review');
      await expect(page.getByRole('heading', { level: 2, name: 'Review' })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Prepare handoff' })).toBeDisabled();

      await selectStudioPhase(page, projectId, 'produce');
      await expectIdleProduceSurface(page, projectId);
      await selectStudioPhase(page, projectId, 'write');
      await expect(page.getByRole('heading', { level: 2, name: 'Write' })).toBeVisible();
      await selectStudioPhase(page, projectId, 'brief');
      await expect(page.getByRole('heading', { level: 2, name: 'Brief' })).toBeVisible();

      await navigateTo(page, studioPhaseHash(projectId, 'write'));
      await expectStudioPhase(page, projectId, 'write');
      const deepLinkedUrl = page.url();
      await page.reload({ waitUntil: 'domcontentloaded' });

      await expect(page).toHaveURL(deepLinkedUrl);
      await expectStudioPhase(page, projectId, 'write');
      const reloadedRow = page.getByRole('region', { name: shotTitle });
      await expect(reloadedRow.getByLabel('Scene title')).toHaveValue(shotTitle);
      await expect(reloadedRow.getByLabel('Narration')).toHaveValue(narration);
      await expect(reloadedRow.getByLabel('Visual prompt')).toHaveValue(visualPrompt);
      await expect(reloadedRow.locator('[role="status"][data-state="saved"]')).toHaveText('Scene saved');
      await assertStudioInvariants(page);
    });

    await test.step('show the project card and create a seeded shape directly into Write', async () => {
      await page.getByRole('button', { name: 'Back to project library' }).click();
      const studioLibrary = page.getByRole('region', { name: 'Creative Studio' });
      await expect(studioLibrary).toBeVisible();
      await expect(studioLibrary.getByRole('button', { name: projectBrief })).toBeVisible();
      await expect(studioLibrary.getByText(/^1 shots? written, none rendered$/)).toBeVisible();
      await expect(studioLibrary.getByText(/^1 shot · 18s ·/)).toBeVisible();

      const shapes = studioLibrary.getByRole('region', { name: 'Start from a shape' });
      await shapes.getByRole('button', { name: '3 shots · 15s' }).click();

      await expect(page).toHaveURL(/#\/studio\/[^/]+\/write$/);
      const shapeProjectId = projectIdFromPhaseUrl(page, 'write');
      await expectStudioPhase(page, shapeProjectId, 'write');
      const scriptTable = page.getByRole('region', { name: 'Script' });
      await expect(scriptTable.getByLabel('Scene title')).toHaveCount(3);
      await Promise.all(
        ['Shot 1', 'Shot 2', 'Shot 3'].flatMap((title) => {
          const row = scriptTable.getByRole('region', { name: title, exact: true });
          return [
            expect(row.getByLabel('Scene title')).toHaveValue(title),
            expect(row.getByLabel('Visual prompt')).toHaveValue(''),
            expect(row.getByRole('combobox', { name: 'Scene duration in seconds' })).toContainText('5s'),
          ];
        })
      );
      // A seeded 3x5s shape hits the 15s target exactly, so no shell advisory is raised.
      await expect(page.locator('[data-studio-layout-root] > [role="alert"]')).toHaveCount(0);
      await expect(page.getByText('Untitled scene', { exact: true })).toHaveCount(0);
      expect(await readCanonicalStudioSnapshot(page, shapeProjectId)).toMatchObject({
        routes: fakeCatalogRoutes,
        scenes: [
          { title: 'Shot 1', visualPrompt: '', durationSeconds: 5 },
          { title: 'Shot 2', visualPrompt: '', durationSeconds: 5 },
          { title: 'Shot 3', visualPrompt: '', durationSeconds: 5 },
        ],
        jobs: [],
      });
      await assertStudioInvariants(page);

      await page.getByRole('button', { name: 'Back to project library' }).click();
      await expect(studioLibrary.getByText('3 shots written, none rendered', { exact: true })).toBeVisible();
      await expect(studioLibrary.getByText(/^3 shots · 15s ·/)).toBeVisible();
      await assertStudioInvariants(page);

      const rendererText = await page.locator('body').innerText();
      for (const sentinel of mainProcessOnlySentinels) expect(rendererText).not.toContain(sentinel);
    });
  });
});

test.describe('Creative Studio packaged workspace', () => {
  test.skip(
    process.env.E2E_PACKAGED !== '1' || process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
    'Packaged Studio smoke requires an isolated E2E profile; the packaged runtime still refuses the fake adapter.'
  );

  test('creates and reloads a phase route without activating the fake provider', async ({ electronApp, page }) => {
    const projectBrief = `A packaged Creative Studio phase-shell smoke ${Date.now()}.`;
    const gate = await electronApp.evaluate(({ app }) => ({
      isPackaged: app.isPackaged,
      expectedUserDataPath: process.env.AIONUI_E2E_USER_DATA_DIR,
      userDataPath: app.getPath('userData'),
    }));
    expect(gate.isPackaged).toBe(true);
    expect(gate.expectedUserDataPath).toBeTruthy();
    expect(gate.userDataPath).toBe(gate.expectedUserDataPath);

    await openStudioLibrary(page);
    const studioLibrary = page.getByRole('region', { name: 'Creative Studio' });
    await studioLibrary.getByLabel('What are we making?').fill(projectBrief);
    await studioLibrary.getByRole('button', { name: 'Read my brief →' }).click();

    await expect(page).toHaveURL(/#\/studio\/[^/]+\/brief$/);
    const projectId = projectIdFromPhaseUrl(page, 'brief');
    await expect(page.getByRole('heading', { level: 1, name: projectBrief })).toBeVisible();
    await expectStudioPhase(page, projectId, 'brief');
    await expect(page.getByText('WePrompt Studio E2E')).toHaveCount(0);
    const routeCatalog = await readStudioRouteCatalog(page, projectId);
    expect(routeCatalog.image.selected).toBeNull();
    expect(routeCatalog.video.selected).toBeNull();
    const packagedRouteOptions = [...routeCatalog.image.options, ...routeCatalog.video.options];
    expect(
      packagedRouteOptions.some(
        ({ providerId, providerName, model }) =>
          providerId === 'weprompt_studio_e2e' ||
          providerName === 'WePrompt Studio E2E' ||
          model.startsWith('weprompt-e2e-')
      )
    ).toBe(false);

    await selectStudioPhase(page, projectId, 'produce');
    await expectConnectEngineDoor(page, projectId);
    await expect(page.getByText('WePrompt Studio E2E')).toHaveCount(0);
    await expect(page.getByText('weprompt-e2e-video')).toHaveCount(0);

    const projectUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(projectUrl);
    await expect(page.getByRole('heading', { level: 1, name: projectBrief })).toBeVisible();
    await expectStudioPhase(page, projectId, 'produce');
    await expectConnectEngineDoor(page, projectId);

    await selectStudioPhase(page, projectId, 'review');
    await expect(page.getByRole('button', { name: 'Prepare handoff' })).toBeDisabled();
    await expect(page.getByRole('dialog', { name: 'Export assets' })).toHaveCount(0);

    const rendererText = await page.locator('body').innerText();
    expect(rendererText).not.toContain('WePrompt Studio E2E');
    expect(rendererText).not.toContain('weprompt_studio_e2e');
    expect(rendererText).not.toContain('weprompt-media-gateway-v1');
    for (const sentinel of mainProcessOnlySentinels) expect(rendererText).not.toContain(sentinel);
  });
});
