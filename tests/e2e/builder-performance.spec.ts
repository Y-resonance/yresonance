import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';
import { apiRequestSchema } from '#/api/contracts';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test('moving a widget keeps its in-flight query and skips sharing lookups', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'editor' });
  let release = () => {};
  const queryGate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let queries = 0;
  let refreshedWithoutSharing = false;
  await page.route('**/api/yresonance', async (route) => {
    const request = apiRequestSchema.parse(route.request().postDataJSON());
    if (request.action === 'getDashboard' && request.includeSharing === false)
      refreshedWithoutSharing = true;
    if (request.action === 'queryWidget' && request.widgetId === 'w_spend') {
      queries += 1;
      await queryGate;
    }
    await route.fallback();
  });
  await page.goto('/dashboards/dash_demo');
  await expect.poll(() => queries).toBeGreaterThan(0);
  const card = page.locator('[data-widget-id="w_spend"]');
  await card.hover();
  const box = (await card.locator('.widget-drag-handle').boundingBox())!;
  const initialQueries = queries;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 230, box.y + 20, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  await expect.poll(() => refreshedWithoutSharing).toBe(true);
  release();
  await expect(card.locator('[data-slot="skeleton"]')).toHaveCount(0);
  expect(queries).toBe(initialQueries);
});

for (const outcome of ['saved', 'failed'] as const) {
  test(`adding a widget shows a placeholder before metadata loads and handles ${outcome} creation`, async ({
    page,
  }) => {
    await mockYresonanceApi(page, { role: 'editor' });
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/api/yresonance', async (route) => {
      const request = apiRequestSchema.parse(route.request().postDataJSON());
      if (request.action === 'describeDatasource' && !request.dashboardId) await gate;
      if (request.action === 'addWidget' && outcome === 'failed') {
        await route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            ok: false,
            error: { code: 'dashboard_conflict', message: 'This dashboard changed while saving.' },
          }),
        });
        return;
      }
      await route.fallback();
    });
    await page.goto('/dashboards/dash_demo');
    await page.getByRole('button', { name: 'Add widget', exact: true }).click();
    await page.getByRole('button', { name: 'Add Scorecard', exact: true }).click();
    await expect(page.getByRole('status', { name: 'Adding Scorecard' })).toBeVisible();
    await expect(page.locator('[data-widget-id="w_added_1"]')).toHaveCount(0);
    release();
    await expect(page.getByRole('status', { name: 'Adding Scorecard' })).toHaveCount(0);
    if (outcome === 'saved')
      await expect(page.locator('[data-widget-id="w_added_1"]')).toBeVisible();
    else {
      await expect(page.getByRole('alert')).toContainText('This dashboard changed while saving.');
      await expect(page.locator('[data-widget-id="w_added_1"]')).toHaveCount(0);
    }
  });
}

test('clearing a default filter sends an explicit empty selection', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  const control = state.dashboard.pages[0]!.widgets.find(
    (widget) => widget.definition.type === 'control',
  )!;
  if (control.definition.type !== 'control') throw new Error('Expected a filter control.');
  control.definition.defaultValues = ['Meta'];
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('button', { name: 'Clear', exact: true })).toBeVisible();
  const clearedQuery = page.waitForRequest(
    (request) => {
      if (!request.url().endsWith('/api/yresonance') || request.method() !== 'POST') return false;
      const body = apiRequestSchema.parse(request.postDataJSON());
      return (
        body.action === 'queryWidget' &&
        body.widgetId === 'w_spend' &&
        body.controlState?.values?.[control.id]?.length === 0
      );
    },
    { timeout: 3000 },
  );
  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await clearedQuery;
  await expect(page.getByRole('button', { name: 'Choose Platform values' })).toHaveText(
    'All values',
  );
});
