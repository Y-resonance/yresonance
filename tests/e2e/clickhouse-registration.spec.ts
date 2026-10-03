import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('datasource registration chooses a backend and authorized external table without credentials', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.goto('/datasources');
  await page.getByRole('button', { name: 'New datasource' }).click();
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
});
