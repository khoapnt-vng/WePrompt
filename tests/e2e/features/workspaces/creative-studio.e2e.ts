/**
 * Creative Studio schema-2 route smoke.
 *
 * Run with:
 * AIONUI_E2E_TEST=1 E2E_DEV=1 bunx playwright test --config playwright.config.ts \
 *   tests/e2e/features/workspaces/creative-studio.e2e.ts
 */
import { expect, test } from '../../fixtures';
import { navigateTo, ROUTES } from '../../helpers';

const workspaceSelector = '[data-studio-workspace]';
const projectHeaderSelector = '[data-studio-project-header]';
const viewNavigationSelector = '[data-studio-view-navigation]';
const activeViewSelector = '[data-studio-view]';

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

    await navigation.getByRole('link', { name: 'Board' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/board$/);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'board');

    await navigation.getByRole('link', { name: 'Cut' }).click();
    await expect(page).toHaveURL(/#\/studio\/[^/]+\/cut$/);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');

    const cutUrl = page.url();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(cutUrl);
    await expect(page.locator(activeViewSelector)).toHaveAttribute('data-studio-view', 'cut');

    await expect(
      page.getByRole('button', { name: /prepare submission|confirm submission|dismiss handoff/i })
    ).toHaveCount(0);
  });
});
