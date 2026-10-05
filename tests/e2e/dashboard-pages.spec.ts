import { expect, test } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test('page navigation preserves filters, opens URL pages, and omits drafts for viewers', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page, { role: 'viewer' });
  const overview = state.dashboard.pages[0];
  const chart = overview.widgets.find((widget) => widget.id === 'w_spend')!;
  overview.widgets = overview.widgets.filter((widget) => widget.id !== chart.id);
  state.dashboard.pages.push({
    id: 'channels',
    name: 'Channels',
    hidden: false,
    canvasRows: 10,
    widgets: [chart],
  });
  state.dashboard.pages.push({
    id: 'draft',
    name: 'Creatives',
    hidden: true,
    canvasRows: 10,
    widgets: [],
  });
  await page.goto('/dashboards/dash_demo');
  await page.getByRole('button', { name: 'Choose Platform values' }).click();
  await page.getByRole('option', { name: 'FB' }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await expect(page).toHaveURL(/page=channels/);
  await expect(page.getByText('Media spend', { exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: /Creatives/ })).toHaveCount(0);
  // The request proves the viewer kept the selection after the control's page unmounted.
  const queried = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'queryWidget' &&
      request.postDataJSON()?.controlState?.values?.w_platform?.includes('FB'),
  );
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await queried;
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Channels', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.goto('/share/demo?page=draft');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});

test('editors create, rename, reorder, hide, publish, and remove pages through the GUI', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add page', exact: true }).click();
  await page.getByLabel('Page name').fill('Channels');
  await page.getByRole('dialog').getByRole('button', { name: 'Add page', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Channels', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByRole('button', { name: /Page actions for/ })).toHaveCount(1);
  await page.getByRole('button', { name: 'Page actions for Channels' }).click();
  await page.getByRole('menuitem', { name: 'Rename page' }).click();
  await page.getByLabel('Page name').fill('Delivery');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Page actions for Delivery' }).click();
  await page.getByRole('menuitem', { name: 'Move left' }).click();
  await expect(page.getByRole('tab').first()).toHaveText('Delivery');
  await page.getByRole('button', { name: 'Page actions for Delivery' }).click();
  await page.getByRole('menuitem', { name: 'Hide page' }).click();
  await expect(page.getByRole('tab', { name: 'Delivery (draft)', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Page actions for Delivery' }).click();
  await page.getByRole('menuitem', { name: 'Publish page' }).click();
  await expect(page.getByRole('tab', { name: 'Delivery', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Page actions for Delivery' }).click();
  await page.getByRole('menuitem', { name: 'Remove page', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('cannot be undone');
  await page.getByRole('dialog').getByRole('button', { name: 'Remove page', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('Media spend', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Viewer mode' }).click();
  await expect(page.getByRole('tablist', { name: 'Dashboard pages' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add page', exact: true })).toHaveCount(0);
});

test('viewers get an empty state when every page is a draft', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'viewer' });
  state.dashboard.pages[0].hidden = true;
  await page.goto('/share/demo');
  await expect(page.getByText('No published pages.')).toBeVisible();
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.getByText('Media spend', { exact: true })).toHaveCount(0);
});

test('builder filters and date selections survive page switches and a save finishing after browser back', async ({
  page,
  isMobile,
}) => {
  const state = await mockYresonanceApi(page);
  state.dashboard.pages.push({
    id: 'channels',
    name: 'Channels',
    hidden: false,
    canvasRows: 10,
    widgets: [],
  });
  await page.goto('/dashboards/dash_demo');
  await page.getByRole('button', { name: 'Choose date range' }).click();
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await page.getByRole('button', { name: 'Choose Platform values' }).click();
  await page.getByRole('option', { name: 'FB', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  await page.getByRole('tab', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Choose date range' })).toContainText(
    'Last 7 days',
  );
  await expect(page.getByRole('button', { name: 'Choose Platform values' })).toContainText(
    '1 selected',
  );

  await page.getByRole('tab', { name: 'Channels', exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let requested!: () => void;
  const started = new Promise<void>((resolve) => {
    requested = resolve;
  });
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action === 'addWidget') {
      requested();
      await pending;
    }
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Add widget', exact: true }).click();
  await page.getByRole('button', { name: 'Add Text', exact: true }).click();
  await started;
  await page.goBack();
  await expect(page.getByRole('tab', { name: 'Overview', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  release();
  await expect.poll(() => state.dashboard.pages[1].widgets.length).toBe(1);
  await expect(page.getByText('Add text', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Choose date range' })).toContainText(
    'Last 7 days',
  );
  await expect(page.getByRole('button', { name: 'Choose Platform values' })).toContainText(
    '1 selected',
  );
  if (isMobile) await expect(page.getByRole('dialog')).toHaveCount(0);
});
