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
    'editor@example.test',
  );
  await expect(
    page.getByRole('button', { name: 'Connect datasource', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('Name', { exact: true }).fill('Customer campaigns');
  await page.getByRole('button', { name: 'Show more items' }).click();
  await page.getByLabel('Search projects', { exact: true }).fill('customer');
  await page.getByRole('button', { name: /Customer customer-project/ }).click();
  await page.getByLabel('Search datasets', { exact: true }).fill('local_testing');
  await expect(
    page.getByRole('button', { name: 'local_testing_archive US', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'local_testing US', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'local_testing US', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'campaigns VIEW',
      exact: true,
    })
    .click();
  await expect(page.getByRole('button', { name: 'Connect datasource', exact: true })).toBeEnabled();
  // Changing a parent selection must not register the previously chosen table.
  await page.getByLabel('Search projects', { exact: true }).fill('');
  await page.getByRole('button', { name: 'Other project other-project', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Connect datasource', exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole('region', { name: 'Tables and views' })).toContainText(
    'Choose a dataset.',
  );
  await page.getByLabel('Project ID', { exact: true }).fill('customer-project');
  await page.getByRole('button', { name: 'Use project ID' }).click();
  await page.getByRole('button', { name: 'local_testing US', exact: true }).click();
  await page
    .getByRole('button', {
      name: 'campaigns VIEW',
      exact: true,
    })
    .click();
  const registered = page.waitForRequest(
    (request) =>
      request.url().includes('/api/yresonance') &&
      request.postDataJSON()?.action === 'registerDatasource',
  );
  await page.getByRole('button', { name: 'Connect datasource', exact: true }).click();
  expect((await registered).postDataJSON()).toEqual({
    action: 'registerDatasource',
    provider: 'bigquery',
    name: 'Customer campaigns',
    cachePolicy: { mode: 'default' },
    connection: { authorizationId: 'auth_google' },
    location: {
      kind: 'bigquery',
      project: 'customer-project',
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
