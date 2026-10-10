import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('global search paginates, filters both resource types, and opens results', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page);
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action !== 'bootstrap') return route.fallback();
    return route.fulfill({
      json: {
        ok: true,
        data: {
          workspace: { id: 'ws_demo', name: 'Demo workspace' },
          isAdmin: true,
          dashboards: [
            { id: state.dashboard.id, name: state.dashboard.name },
            ...Array.from({ length: 11 }, (_, index) => ({
              id: `dash_archive_${index}`,
              name: `Archive ${index + 1}`,
            })),
          ],
          dataSources: [
            { id: state.source.id, name: state.source.name },
            { id: 'src_client_b', name: 'Client B reporting' },
          ],
        },
      },
    });
  });
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Client weekly', exact: true })).toBeVisible();
  const trigger = page.getByRole('button', { name: 'Search dashboards and datasources' });
  await expect(trigger).toBeVisible();
  await page.keyboard.press('Meta+k');
  const dialog = page.getByRole('dialog', { name: 'Search dashboards and datasources' });
  await expect(dialog.getByRole('option')).toHaveCount(10);
  await expect(dialog.getByRole('button', { name: 'Previous results page' })).toBeDisabled();
  await dialog.getByRole('button', { name: 'Next results page' }).click();
  await expect(dialog.getByRole('option')).toHaveCount(4);
  await expect(dialog.getByText('Page 2 of 2')).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Next results page' })).toBeDisabled();
  await dialog.getByRole('combobox').fill('CLIENT');
  await expect(dialog.getByRole('option')).toHaveCount(2);
  await expect(dialog.getByText('Dashboards', { exact: true })).toBeVisible();
  await expect(dialog.getByText('Datasources', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('navigation', { name: 'Search results pages' })).toHaveCount(0);
  await dialog.getByRole('combobox').fill('no matching resource');
  await expect(dialog.getByText('No results found.')).toBeVisible();
  await dialog.getByRole('combobox').fill('client weekly');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/dashboards\/dash_demo$/);
  await expect(page.getByRole('heading', { name: 'Client weekly', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await trigger.click();
  await dialog.getByRole('combobox').fill('Reporting example');
  await dialog.getByRole('option', { name: 'Reporting example' }).click();
  await expect(page).toHaveURL(/\/datasources\/src_reporting$/);
  await expect(page.getByRole('heading', { name: 'Reporting example', exact: true })).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('search retries a failed load and fetches current names when reopened', async ({ page }) => {
  const state = await mockYresonanceApi(page);
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Client weekly', exact: true })).toBeVisible();
  let failSearch = true;
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action !== 'bootstrap' || !failSearch)
      return route.fallback();
    return route.fulfill({
      json: { ok: false, error: { code: 'unavailable', message: 'Search unavailable' } },
    });
  });
  const trigger = page.getByRole('button', { name: 'Search dashboards and datasources' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Search dashboards and datasources' });
  await expect(dialog.getByRole('alert')).toContainText('Search unavailable');
  failSearch = false;
  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect(dialog.getByRole('option', { name: 'Client weekly' })).toBeVisible();
  await page.keyboard.press('Escape');
  state.dashboard.name = 'Renamed dashboard';
  await trigger.click();
  await expect(dialog.getByRole('option', { name: 'Renamed dashboard' })).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'Client weekly' })).toHaveCount(0);
});
