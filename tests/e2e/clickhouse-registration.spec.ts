import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('connects customer ClickHouse through provider selection and credential setup', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON()?.action !== 'registerDatasource') return route.fallback();
    await route.fulfill({ json: { ok: true, data: { id: 'src_reporting' } } });
  });
  await page.goto('/datasources');
  await page.getByRole('link', { name: 'New datasource' }).click();
  await expect(page.getByRole('heading', { name: 'New datasource', exact: true })).toBeVisible();
  await page
    .getByRole('region', { name: 'Bring your own' })
    .getByRole('link', { name: /ClickHouse/ })
    .click();
  await expect(page).toHaveURL(/provider=clickhouse-external$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Connect ClickHouse' })).toBeVisible();
  await expect(page.getByLabel('File', { exact: true })).toHaveCount(0);
  await page.getByLabel('Host', { exact: true }).fill('analytics.example.com');
  await page.getByLabel('Username', { exact: true }).fill('reporting-reader');
  await page.getByLabel('Password (optional)', { exact: true }).fill('customer-password');
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
  await page.getByRole('button', { name: 'Connect datasource', exact: true }).click();
  expect((await registered).postDataJSON()).toEqual({
    action: 'registerDatasource',
    name: 'External campaign data',
    provider: 'clickhouse-external',
    connection: {
      host: 'analytics.example.com',
      port: '8443',
      user: 'reporting-reader',
      password: 'customer-password',
    },
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

test('managed setup needs no credentials and keyboard navigation can return to provider selection', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.goto('/datasources/new');
  const managed = page.getByRole('region', { name: 'Managed', exact: true });
  await managed.getByRole('link', { name: /DuckDB/ }).focus();
  await page.keyboard.press('Tab');
  await expect(managed.getByRole('link', { name: /ClickHouse/ })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('File', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Connection', exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Change provider' }).click();
  await expect(page.getByRole('heading', { name: 'New datasource', exact: true })).toBeVisible();
  await page.getByRole('main').getByRole('link', { name: 'Datasources', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Datasources', exact: true })).toBeVisible();
});

test('S3 setup registers the customer bucket connection and infers the file format', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON()?.action !== 'registerDatasource') return route.fallback();
    await route.fulfill({ json: { ok: true, data: { id: 'src_reporting' } } });
  });
  await page.goto('/datasources/new');
  await page
    .getByRole('region', { name: 'Bring your own' })
    .getByRole('link', { name: /DuckDB/ })
    .click();
  await page.getByLabel('S3 endpoint', { exact: true }).fill('https://storage.example.com');
  await page.getByLabel('Bucket', { exact: true }).fill('customer-data');
  await page.getByLabel('Access key ID', { exact: true }).fill('customer-key');
  await page.getByLabel('Secret access key', { exact: true }).fill('customer-secret');
  await page.getByLabel('Name', { exact: true }).fill('Delivery');
  await page.getByLabel('Object key or prefix', { exact: true }).fill('reports/delivery.parquet');
  await expect(page.getByLabel('Format', { exact: true })).toHaveCount(0);
  const registered = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'registerDatasource',
  );
  await page.getByRole('button', { name: 'Connect datasource', exact: true }).click();
  expect((await registered).postDataJSON()).toEqual({
    action: 'registerDatasource',
    name: 'Delivery',
    provider: 'duckdb-s3',
    cachePolicy: { mode: 'default' },
    connection: {
      endpoint: 'https://storage.example.com',
      region: 'eu-central-1',
      bucket: 'customer-data',
      accessKeyId: 'customer-key',
      secretAccessKey: 'customer-secret',
      sessionToken: '',
    },
    location: { kind: 'object', key: 'reports/delivery.parquet', format: 'parquet' },
  });
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
});
