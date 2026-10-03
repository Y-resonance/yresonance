import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockRundownApi } from './support/rundown-api';

test('pages use their content in the browser title', async ({ page }) => {
  await mockRundownApi(page);

  await page.goto('/datasources');
  await expect(page).toHaveTitle('Datasources | Rundown');

  await page.goto('/datasources/src_reporting');
  await expect(page).toHaveTitle('Reporting example | Rundown');

  await page.goto('/metrics');
  await expect(page).toHaveTitle('Metric library | Rundown');

  await page.goto('/dashboards/dash_demo');
  await expect(page).toHaveTitle('Client weekly | Rundown');
});
