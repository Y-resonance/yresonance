import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { dataSourceId, mockYresonanceApi } from './support/yresonance-api';

test('duplicating from the list swaps the datasource and opens the copy', async ({ page }) => {
  const state = await mockYresonanceApi(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Duplicate' }).click();
  const dialog = page.getByRole('dialog', { name: 'Duplicate dashboard' });
  await expect(dialog.getByLabel('Name')).toHaveValue('Client weekly copy');
  await dialog.getByLabel('Name').fill('Client B weekly');
  await dialog.getByLabel('Reporting example').selectOption({ label: 'Client B reporting' });
  await dialog.getByRole('button', { name: 'Duplicate' }).click();

  await expect(page).toHaveURL(/\/dashboards\/dash_copy$/);
  expect(state.duplicateRequests).toEqual([
    {
      action: 'duplicateDashboard',
      dashboardId: 'dash_demo',
      name: 'Client B weekly',
      dataSourceMapping: { [dataSourceId]: 'src_client_b' },
    },
  ]);
});
