import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('BigQuery manual entry registers an unlisted source with a custom query byte limit', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === 'listDatasourceConnections')
      return route.fulfill({
        json: {
          ok: true,
          data: {
            configured: true,
            connections: [
              { id: 'auth_google', account: 'editor@example.test', status: 'connected' },
            ],
          },
        },
      });
    if (request.action === 'browseDatasource')
      return route.fulfill({ json: { ok: true, data: { entries: [] } } });
    if (request.action === 'registerDatasource')
      return route.fulfill({ json: { ok: true, data: { id: 'src_reporting' } } });
    return route.fallback();
  });
  await page.goto('/datasources/new?provider=bigquery');
  await page.getByRole('switch', { name: 'Enter source manually' }).check();
  await page.getByLabel('Project ID', { exact: true }).fill('customer-project');
  await page.getByLabel('Dataset', { exact: true }).fill('reporting');
  await page.getByLabel('Table or view', { exact: true }).fill('sales');
  await page.getByLabel('Dataset location', { exact: true }).fill('US');
  await page.getByLabel('Maximum bytes billed per query', { exact: true }).fill('2000000000');
  const registered = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'registerDatasource',
  );
  await page.getByRole('button', { name: 'Connect datasource', exact: true }).click();
  expect((await registered).postDataJSON()).toMatchObject({
    name: 'sales',
    connection: { authorizationId: 'auth_google' },
    location: {
      kind: 'bigquery',
      project: 'customer-project',
      dataset: 'reporting',
      table: 'sales',
      location: 'US',
      maximumBytesBilled: '2000000000',
    },
  });
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
});

test('Google consent enables browsing and registering a BigQuery table', async ({ page }) => {
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
              ? [{ id: 'auth_google', account: 'editor@example.test', status: 'connected' }]
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
    if (request.action === 'browseDatasource')
      return route.fulfill({
        json: {
          ok: true,
          data: request.dataset
            ? {
                entries: [
                  {
                    id: 'campaigns',
                    label: 'campaigns',
                    type: 'VIEW',
                  },
                ],
              }
            : request.project
              ? request.cursor === 'datasets-final'
                ? { entries: [{ id: 'local_testing', label: 'local_testing', location: 'US' }] }
                : request.cursor === 'datasets-matching'
                  ? {
                      entries: [
                        {
                          id: 'local_testing_archive',
                          label: 'local_testing_archive',
                          location: 'US',
                        },
                      ],
                      cursor: 'datasets-final',
                    }
                  : request.cursor === 'datasets-empty'
                    ? { entries: [], cursor: 'datasets-matching' }
                    : {
                        entries: [{ id: 'reporting', label: 'reporting', location: 'EU' }],
                        cursor: 'datasets-empty',
                      }
              : request.cursor
                ? { entries: [{ id: 'customer-project', label: 'Customer' }] }
                : {
                    entries: [{ id: 'other-project', label: 'Other project' }],
                    cursor: 'next-projects',
                  },
        },
      });
    if (request.action === 'registerDatasource')
      return route.fulfill({ json: { ok: true, data: { id: 'src_reporting' } } });
    return route.fallback();
  });
  await page.goto('/datasources/new');
  await page.getByRole('link', { name: /Google BigQuery/ }).click();
  const connect = page.getByRole('button', { name: 'Connect datasource', exact: true });
  // Nothing can be named or chosen until an account is connected.
  await expect(page.getByLabel('Name', { exact: true })).toBeDisabled();
  await expect(connect).toBeDisabled();
  await expect(
    page.getByText(
      'All permitted dashboard viewers query through this account, including shared links.',
    ),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Connect Google account', exact: true }).click();
  await expect(page.getByText('editor@example.test')).toBeVisible();
  await expect(page.getByLabel('Name', { exact: true })).toBeEnabled();
  // Account management lives in a menu instead of a row of buttons.
  await page.getByRole('button', { name: 'Google account actions' }).click();
  await expect(page.getByRole('menuitem', { name: 'Connect another account' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Disconnect account' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Show more items' }).click();
  await page.getByLabel('Search projects', { exact: true }).fill('customer');
  await page.getByRole('option', { name: /Customer customer-project/ }).click();
  await page.getByLabel('Search datasets', { exact: true }).fill('local_testing');
  await expect(
    page.getByRole('option', { name: 'local_testing_archive', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('option', { name: 'local_testing', exact: true })).toBeVisible();
  await page.getByRole('option', { name: 'local_testing', exact: true }).click();
  await page.getByRole('option', { name: 'campaigns VIEW', exact: true }).click();
  // Settings unlock with the table name proposed as the datasource name.
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('campaigns');
  await expect(connect).toBeEnabled();
  // Changing a parent selection must not register the previously chosen table.
  await page.getByLabel('Search projects', { exact: true }).fill('');
  await page.getByRole('option', { name: 'Other project other-project', exact: true }).click();
  await expect(connect).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Tables and views' })).toContainText(
    'Choose a dataset.',
  );
  // Projects the account cannot list are reachable by typing their ID into the search. From
  // there the whole path works on the keyboard: Enter chooses and focuses the next column.
  await page.getByLabel('Search projects', { exact: true }).fill('manual-project');
  await expect(
    page.getByRole('option', { name: 'Use project ID manual-project', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Search datasets', { exact: true })).toBeFocused();
  await page.keyboard.type('local_testing');
  await expect(page.getByRole('option', { name: 'local_testing', exact: true })).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Search tables and views', { exact: true })).toBeFocused();
  await expect(page.getByRole('option', { name: 'campaigns VIEW', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(connect).toBeEnabled();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByLabel('Search datasets', { exact: true })).toBeFocused();
  await page.getByLabel('Name', { exact: true }).fill('Customer campaigns');
  const registered = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'registerDatasource',
  );
  await connect.click();
  expect((await registered).postDataJSON()).toEqual({
    action: 'registerDatasource',
    provider: 'bigquery',
    name: 'Customer campaigns',
    cachePolicy: { mode: 'default' },
    connection: { authorizationId: 'auth_google' },
    location: {
      kind: 'bigquery',
      project: 'manual-project',
      dataset: 'local_testing',
      table: 'campaigns',
      location: 'US',
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
            connections: [{ id: 'auth_google', account: 'editor@example.test', status }],
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
  await expect(page.getByText('editor@example.test')).toBeVisible();
  await expect(page.getByText('reconnect required')).toBeVisible();
  await page.getByRole('button', { name: 'Reconnect Google account', exact: true }).click();
  await expect(page.getByText('editor@example.test')).toBeVisible();
  await expect(page.getByText('reconnect required')).toBeHidden();
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
