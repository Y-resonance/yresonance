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
  await expect(page.getByRole('button', { name: 'DuckDB', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'DuckDB', exact: true }).click();
  await expect(page.getByRole('button', { name: 'DuckDB', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'ClickHouse', exact: true }).click();
  await expect(page.getByRole('button', { name: 'ClickHouse', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.getByRole('button', { name: 'DuckDB', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  await expect(page.getByLabel('File', { exact: true })).toBeVisible();
  await page.getByRole('switch', { name: 'Use existing workspace data' }).click();
  await page.getByLabel('Name', { exact: true }).fill('External campaign data');
  await page.getByLabel('Database', { exact: true }).fill('reporting');
  await page.getByLabel('Table', { exact: true }).fill('campaigns');
  await expect(page.getByRole('combobox', { name: 'Query caching' })).toContainText(
    'Default (5 minutes)',
  );
  await page.getByRole('combobox', { name: 'Query caching' }).click();
  await page.getByRole('option', { name: 'Disabled', exact: true }).click();
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
    cachePolicy: { mode: 'disabled' },
    location: {
      kind: 'clickhouse',
      database: 'reporting',
      table: 'campaigns',
      ownership: 'external',
      cacheTtlSeconds: 300,
    },
  });
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
});

test('new datasource page links back to the datasource list', async ({ page }) => {
  await mockYresonanceApi(page);
  await page.goto('/datasources/new');
  await expect(page.getByRole('heading', { name: 'New datasource', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'DuckDB', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('button', { name: 'ClickHouse', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'ClickHouse', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('main').getByRole('link', { name: 'Datasources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Datasources', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'New datasource' })).toBeVisible();
});
