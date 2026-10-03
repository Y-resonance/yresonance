import { expect, test } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test('pages use their content in the browser title', async ({ page }) => {
  await mockYresonanceApi(page);

  await page.goto('/datasources');
  await expect(page).toHaveTitle('Datasources | yresonance');

  await page.goto('/datasources/src_reporting');
  await expect(page).toHaveTitle('Reporting example | yresonance');

  await page.goto('/metrics');
  await expect(page).toHaveTitle('Metric library | yresonance');

  await page.goto('/dashboards/dash_demo');
  await expect(page).toHaveTitle('Client weekly | yresonance');
});
