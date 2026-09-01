/**
 * Creative Studio schema-6 Pilot acceptance journey.
 *
 * Build and run with:
 * AIONUI_ENABLE_CREATIVE_STUDIO=1 bun run package
 * AIONUI_E2E_TEST=1 AIONUI_E2E_STUDIO_FAKE=1 E2E_DEV=1 \
 *   bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/creative-studio.e2e.ts
 */
import { mkdir, readFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ElectronApplication, Page } from '@playwright/test';
import sharp from 'sharp';

import { expect, test } from '../../fixtures';
import { navigateTo, ROUTES } from '../../helpers';

type NativeHarnessPlan = {
  openPaths?: Array<string | null>;
  savePaths?: Array<string | null>;
};

type NativeHarnessSnapshot = {
  openRequestCount: number;
  saveRequestCount: number;
  revealedPaths: string[];
};

const installNativeHarness = async (electronApp: ElectronApplication, plan: NativeHarnessPlan): Promise<void> => {
  await electronApp.evaluate(({ dialog, shell }, input) => {
    type Harness = NativeHarnessSnapshot & {
      openPaths: Array<string | null>;
      savePaths: Array<string | null>;
    };
    const scope = globalThis as typeof globalThis & { __studioPilotHarness?: Harness };
    const state: Harness = {
      openPaths: [...(input.openPaths ?? [])],
      savePaths: [...(input.savePaths ?? [])],
      openRequestCount: 0,
      saveRequestCount: 0,
      revealedPaths: [],
    };
    scope.__studioPilotHarness = state;
    Object.defineProperty(dialog, 'showOpenDialog', {
      configurable: true,
      value: async () => {
        state.openRequestCount += 1;
        const selected = state.openPaths.shift() ?? null;
        return selected === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [selected] };
      },
    });
    Object.defineProperty(dialog, 'showSaveDialog', {
      configurable: true,
      value: async () => {
        state.saveRequestCount += 1;
        const selected = state.savePaths.shift() ?? null;
        return selected === null ? { canceled: true, filePath: undefined } : { canceled: false, filePath: selected };
      },
    });
    Object.defineProperty(shell, 'showItemInFolder', {
      configurable: true,
      value: (filePath: string) => state.revealedPaths.push(filePath),
    });
  }, plan);
};

const readNativeHarness = (electronApp: ElectronApplication): Promise<NativeHarnessSnapshot> =>
  electronApp.evaluate(() => {
    const scope = globalThis as typeof globalThis & {
      __studioPilotHarness?: NativeHarnessSnapshot;
    };
    const state = scope.__studioPilotHarness;
    if (state === undefined) throw new Error('Creative Studio Pilot native harness was not installed');
    return {
      openRequestCount: state.openRequestCount,
      saveRequestCount: state.saveRequestCount,
      revealedPaths: [...state.revealedPaths],
    };
  });

const openStudio = async (page: Page): Promise<void> => {
  await navigateTo(page, ROUTES.studio);
  await expect(page.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
};

test.describe.serial('Creative Studio schema-6 Pilot', () => {
  test.skip(
    process.env.AIONUI_E2E_TEST !== '1' || process.env.AIONUI_E2E_STUDIO_FAKE !== '1',
    'requires the explicit E2E and fake-provider gates'
  );

  const projectName = `Pilot acceptance ${Date.now()}`;
  let projectHash = '';
  let importPath = '';
  let exportPath = '';

  test.beforeAll(async () => {
    const fixtureRoot = path.join(os.tmpdir(), `weprompt-cs4-e2e-${process.pid}-${Date.now()}`);
    await mkdir(fixtureRoot, { recursive: true });
    const canonicalRoot = await realpath(fixtureRoot);
    importPath = path.join(canonicalRoot, 'imported-persian.png');
    exportPath = path.join(canonicalRoot, 'piece-export');
    await sharp({
      create: { width: 760, height: 900, channels: 4, background: { r: 28, g: 42, b: 64, alpha: 1 } },
    })
      .png()
      .toFile(importPath);
  });

  test('creates a viewless schema-6 project and retires the old room routes', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('textbox', { name: 'Project name' }).fill(projectName);
    await page
      .getByRole('textbox', { name: 'Brief' })
      .fill('A compact photo study with one generated and one imported Piece.');
    await page.getByRole('button', { name: 'Create project' }).click();

    await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
    projectHash = new URL(page.url()).hash;
    expect(projectHash).toMatch(/^#\/studio\/[A-Za-z0-9_-]+$/);
    await expect(page.getByRole('button', { name: 'Create photo' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Import photo' })).toBeVisible();
    await expect(page.getByText('References', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Board', { exact: true })).toHaveCount(0);

    // Route transitions are deliberately sequential: each redirect must settle before the next legacy route is probed.
    for (const retired of ['references', 'board', 'first-frames', 'cut']) {
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, `${projectHash}/${retired}`);
      // eslint-disable-next-line no-await-in-loop
      await expect.poll(() => new URL(page.url()).hash).toBe(ROUTES.guid);
      // eslint-disable-next-line no-await-in-loop
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, projectHash);
      // eslint-disable-next-line no-await-in-loop
      await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
    }
  });

  test('quotes before spending, generates one current photograph, then renames and undoes it', async ({ page }) => {
    await page.getByRole('button', { name: 'Create photo' }).click();
    await page.getByRole('textbox', { name: 'Photo description' }).fill('Morning light across a quiet lake');
    await page.getByRole('button', { name: 'Review cost' }).click();

    const quote = page.getByRole('article', { name: 'Prepared photo quote' });
    await expect(quote).toBeVisible();
    await expect(quote).toContainText('One photo');
    await expect(page.getByRole('button', { name: 'Confirm and create photo' })).toBeVisible();
    await page.getByRole('button', { name: 'Confirm and create photo' }).click();

    const current = page.getByRole('img', { name: /current image$/ });
    await expect(current).toBeVisible({ timeout: 60_000 });
    const piece = page.getByRole('article').filter({ has: current });
    await expect(piece.getByRole('region', { name: /Provenance for/ })).toContainText('Generated');

    const rename = piece.getByRole('button', { name: 'Rename Piece' });
    await rename.click();
    const renameInput = piece.getByRole('textbox', { name: /Rename #/ });
    await renameInput.fill('lake_at_dawn');
    await renameInput.press('Enter');
    await expect(piece.getByText('#lake_at_dawn', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Undo last rename' }).click();
    await expect(page.getByText('Last Piece rename undone.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: projectName })).toBeVisible();
    await expect(page.getByRole('img', { name: /current image$/ })).toBeVisible();
    await expect(page.getByText('#lake_at_dawn', { exact: true })).toHaveCount(0);
  });

  test('imports a separate RTL Piece without quote or spend', async ({ electronApp, page }) => {
    await installNativeHarness(electronApp, { openPaths: [importPath], savePaths: [exportPath] });
    const piecesBefore = await page.getByRole('img', { name: /current image$/ }).count();
    await page.getByRole('button', { name: 'Import photo' }).click();
    await expect(page.getByText('Photo imported.')).toBeVisible();
    await expect(page.getByRole('img', { name: /current image$/ })).toHaveCount(piecesBefore + 1);
    await expect(page.getByRole('article', { name: 'Prepared photo quote' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: /Provenance for/ }).filter({ hasText: 'Imported' })).toHaveCount(1);
    expect(await readNativeHarness(electronApp)).toMatchObject({ openRequestCount: 1, saveRequestCount: 0 });
  });

  test('exports exactly the selected current Piece and records a recoverable catalog entry', async ({
    electronApp,
    page,
  }) => {
    await page.getByRole('button', { name: 'Project menu' }).click();
    const exportItems = page.getByRole('menuitem', { name: /^Export #/ });
    await expect(exportItems).toHaveCount(2);
    await exportItems.first().click();
    await expect(page.getByRole('region', { name: /^Export for #/ })).toBeVisible();

    const manifest = JSON.parse(await readFile(path.join(exportPath, 'manifest.json'), 'utf8')) as {
      schemaVersion: number;
      piece: { handleAtExport: string };
      asset: { relativePath: string };
    };
    expect(manifest.schemaVersion).toBe(3);
    expect(manifest.piece.handleAtExport.length).toBeGreaterThan(0);
    expect(manifest.asset.relativePath).toBe('photo.png');
    expect((await readFile(path.join(exportPath, 'photo.png'))).byteLength).toBeGreaterThan(0);

    await page.getByRole('button', { name: 'Reveal in folder' }).click();
    await expect.poll(async () => (await readNativeHarness(electronApp)).revealedPaths).toHaveLength(1);
    const harness = await readNativeHarness(electronApp);
    expect(harness.saveRequestCount).toBe(1);
    expect(path.isAbsolute(harness.revealedPaths[0]!)).toBe(true);
  });
});
