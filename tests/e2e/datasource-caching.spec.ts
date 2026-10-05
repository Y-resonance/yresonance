import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('datasource caching can be saved, reloaded, customized, and disabled', async ({ page }) => {
  await mockYresonanceApi(page, { isAdmin: false });
  await page.goto('/datasources/src_reporting');
  const settings = page.getByRole('dialog', { name: 'Query caching', exact: true });
  const mode = settings.getByLabel('Query caching', { exact: true });
  await page.getByRole('button', { name: 'Query caching: Default (24 hours)' }).click();
  await expect(mode).toHaveValue('default');
  await mode.selectOption('duration');
  await page.getByLabel('Reuse query results for').selectOption('custom');
  await page.getByLabel('Minutes', { exact: true }).fill('7');
  await page.getByRole('button', { name: 'Save caching' }).click();
  await expect(page.getByRole('button', { name: 'Save caching' })).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Query caching: 7 minutes' }).click();
  await expect(page.getByLabel('Minutes', { exact: true })).toHaveValue('7');
  await mode.selectOption('disabled');
  await page.getByRole('button', { name: 'Save caching' }).click();
  await expect(page.getByRole('button', { name: 'Save caching' })).toBeHidden();
  await page.reload();
  await page.getByRole('button', { name: 'Query caching: Disabled' }).click();
  await expect(mode).toHaveValue('disabled');
  await mode.selectOption('duration');
  await page.keyboard.press('Escape');
  await expect(settings).toBeHidden();
  await page.getByRole('button', { name: 'Query caching: Disabled' }).click();
  await expect(mode).toHaveValue('disabled');
});

for (const role of ['editor', 'viewer', 'shared'] as const) {
  test(`${role} refresh fetches fresh dashboard results once and preserves filters`, async ({
    page,
  }) => {
    await mockYresonanceApi(page, { role: role === 'shared' ? 'viewer' : role });
    const requests: Array<{ refresh?: boolean; controlState: unknown }> = [];
    await page.route('**/api/yresonance', async (route) => {
      const request = route.request().postDataJSON();
      if (request.action === 'queryWidget') requests.push(request);
      return route.fallback();
    });
    await page.goto(role === 'shared' ? '/share/demo' : '/dashboards/dash_demo');
    const refresh = page.getByRole('button', { name: 'Fetch fresh data' });
    await expect(refresh).toBeEnabled();
    // Refresh must retain the selected platform.
    await page.getByRole('button', { name: 'Choose Platform values' }).click();
    await page.getByRole('option', { name: 'FB', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(refresh).toBeEnabled();
    const filters = requests.at(-1)!.controlState;
    // Hold both widget queries until the loading state has been observed.
    const releases: Array<() => void> = [];
    await page.unroute('**/api/yresonance');
    await mockYresonanceApi(page, { role: role === 'shared' ? 'viewer' : role });
    await page.route('**/api/yresonance', async (route) => {
      const request = route.request().postDataJSON();
      if (request.action !== 'queryWidget') return route.fallback();
      requests.push(request);
      if (!request.refresh) return route.fallback();
      await new Promise<void>((resolve) => releases.push(resolve));
      await route.fulfill({
        json: {
          ok: true,
          data: {
            rows: [{ metric_1: 999, dimension_1: 'Fresh campaign' }],
            columns: [
              { key: 'metric_1', label: 'Media cost', kind: 'metric', dataType: 'currency' },
            ],
          },
        },
      });
    });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect.poll(() => releases.length).toBe(2);
    expect(requests.slice(-2).every((request) => request.refresh)).toBe(true);
    expect(requests.at(-1)!.controlState).toEqual(filters);
    releases.forEach((resolve) => resolve());
    await expect(refresh).toBeEnabled();
    await expect(page.getByText('€999.00', { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Remove FB' }).click();
    await expect.poll(() => requests.at(-1)?.refresh).toBe(false);
  });
}
