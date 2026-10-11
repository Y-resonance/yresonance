import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('Google consent enables a BigQuery table connection without exposing credentials', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  let connected = false;
  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === 'listDatasourceConnections')
      return route.fulfill({
        json: {
          ok: true,
          data: {
            configured: true,
            connections: connected
              ? [{ id: 'auth_google', account: 'editor@esome.test', status: 'connected' }]
              : [],
          },
        },
      });
    if (request.action === 'beginDatasourceConnection') {
      connected = true;
      return route.fulfill({
        json: {
          ok: true,
          data: {
            authorizationUrl: `${new URL(page.url()).origin}/datasources/new?provider=bigquery`,
          },
        },
      });
    }
    if (request.action === 'registerDatasource')
      return route.fulfill({ json: { ok: true, data: { id: 'src_reporting' } } });
    return route.fallback();
  });
  await page.goto('/datasources/new');
  await page.getByRole('link', { name: /Google BigQuery/ }).click();
  await expect(
    page.getByRole('button', { name: 'Connect datasource', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText(
      'All permitted dashboard viewers query through this account, including shared links.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect Google account', exact: true }).click();
  await expect(page.getByLabel('Google account', { exact: true })).toContainText(
    'editor@esome.test',
  );
  await expect(page.getByRole('button', { name: 'Connect datasource', exact: true })).toBeEnabled();
  await page.getByLabel('Name', { exact: true }).fill('Allianz campaigns');
  await page.getByLabel('Project ID', { exact: true }).fill('vespa-more-dragon');
  await page.getByLabel('Dataset', { exact: true }).fill('local_testing');
  await page
    .getByLabel('Table or view', { exact: true })
    .fill('local_vespa_allianz_all_camapaigns_2025_ms_and_sol');
  const registered = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'registerDatasource',
  );
  await page.getByRole('button', { name: 'Connect datasource', exact: true }).click();
  expect((await registered).postDataJSON()).toEqual({
    action: 'registerDatasource',
    provider: 'bigquery',
    name: 'Allianz campaigns',
    cachePolicy: { mode: 'default' },
    connection: { authorizationId: 'auth_google' },
    location: {
      kind: 'bigquery',
      project: 'vespa-more-dragon',
      dataset: 'local_testing',
      table: 'local_vespa_allianz_all_camapaigns_2025_ms_and_sol',
      location: 'EU',
      maximumBytesBilled: '1000000000',
    },
  });
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
});

test('an existing datasource reconnects its workspace account while keeping its ID', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page);
  let status = 'reconnect_required';
  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === 'describeDatasource')
      return route.fulfill({
        json: {
          ok: true,
          data: {
            ...state.source,
            location: {
              kind: 'bigquery',
              project: 'customer-project',
              dataset: 'reporting',
              table: 'sales',
              location: 'EU',
              maximumBytesBilled: '1000000000',
            },
            defaultCacheTtlSeconds: 300,
          },
        },
      });
    if (request.action === 'listDatasourceConnections')
      return route.fulfill({
        json: {
          ok: true,
          data: {
            configured: true,
            currentConnectionId: 'auth_google',
            connections: [{ id: 'auth_google', account: 'editor@esome.test', status }],
          },
        },
      });
    if (request.action === 'beginDatasourceConnection') {
      expect(request).toEqual({
        action: 'beginDatasourceConnection',
        provider: 'bigquery',
        connectionId: 'auth_google',
        dataSourceId: 'src_reporting',
      });
      status = 'connected';
      return route.fulfill({
        json: {
          ok: true,
          data: { authorizationUrl: `${new URL(page.url()).origin}/datasources/src_reporting` },
        },
      });
    }
    return route.fallback();
  });
  await page.goto('/datasources/src_reporting');
  await expect(page.getByLabel('Google account', { exact: true })).toContainText(
    'reconnect required',
  );
  await page.getByRole('button', { name: 'Reconnect Google account', exact: true }).click();
  await expect(page.getByLabel('Google account', { exact: true })).not.toContainText(
    'reconnect required',
  );
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
});

test('BigQuery setup shows sign-in errors and hydrates in dark mode', async ({ page }) => {
  await mockYresonanceApi(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  const hydrationErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && /hydrat|didn't match/iu.test(message.text()))
      hydrationErrors.push(message.text());
  });
  await page.route('**/api/yresonance', (route) => {
    if (route.request().postDataJSON().action === 'listDatasourceConnections')
      return route.fulfill({
        status: 401,
        json: { ok: false, error: { code: 'unauthenticated', message: 'Sign in to continue.' } },
      });
    return route.fallback();
  });
  await page.goto('/datasources/new?provider=bigquery');
  await expect.soft(page.getByRole('alert')).toHaveText('Sign in to continue.');
  await expect(
    page.getByRole('button', { name: 'Connect Google account', exact: true }),
  ).toBeDisabled();
  await expect(page.locator('html')).toHaveClass('dark');
  expect(hydrationErrors).toEqual([]);
});
