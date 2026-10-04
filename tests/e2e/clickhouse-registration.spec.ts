import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('datasource registration chooses a backend and authorized external table without credentials', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON()?.action !== 'registerDatasource') return route.fallback();
    await route.fulfill({ json: { ok: true, data: { id: 'src_reporting' } } });
  });
  await page.goto('/datasources');
  await page.getByRole('link', { name: 'New datasource' }).click();
  await expect(page).toHaveURL(/\/datasources\/new$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'New datasource', exact: true })).toBeVisible();
  await expect(page.getByLabel('Analytics backend')).toHaveValue('duckdb');
  await page.getByLabel('Analytics backend').selectOption('clickhouse');
  await expect(page.getByLabel('File', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Use existing workspace data' }).click();
  await page.getByLabel('Name', { exact: true }).fill('External campaign data');
  await page.getByLabel('Database', { exact: true }).fill('reporting');
  await page.getByLabel('Table', { exact: true }).fill('campaigns');
  await expect(page.getByLabel('Cache TTL in seconds')).toHaveValue('300');
  await page.getByLabel('Cache TTL in seconds').fill('0');
  const registered = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'registerDatasource',
  );
  await page.getByRole('button', { name: 'Register datasource', exact: true }).click();
  expect((await registered).postDataJSON()).toEqual({
    action: 'registerDatasource',
    name: 'External campaign data',
    backend: 'clickhouse',
    location: {
      kind: 'clickhouse',
      database: 'reporting',
      table: 'campaigns',
      ownership: 'external',
      cacheTtlSeconds: 0,
    },
  });
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
});

test('new datasource page links back to the datasource list', async ({ page }) => {
  await mockYresonanceApi(page);
  await page.goto('/datasources/new');
  await expect(page.getByRole('heading', { name: 'New datasource', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Datasources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Datasources', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New datasource' })).toBeVisible();
});
