import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 375, height: 812 } });

test('a phone browses datasources and edits a field without scrolling sideways', async ({
  page,
}) => {
  await mockYresonanceApi(page);
  await page.goto('/datasources');

  // Below sm the table becomes stacked cards, so nothing is clipped off-screen.
  const card = page.getByRole('listitem').filter({ hasText: 'Reporting example' });
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('table')).toBeHidden();
  const documentWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(documentWidth).toBeLessThanOrEqual(375);

  await page.getByRole('link', { name: 'Reporting example' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Reporting example' })).toBeVisible();

  // Search narrows the same rows the cards are built from.
  const fieldCard = (name: string) => page.getByRole('listitem').filter({ hasText: name });
  await expect(fieldCard('Campaign')).toBeVisible();
  await page.getByLabel('Search fields').fill('media cost');
  await expect(fieldCard('Campaign')).toBeHidden();
  await expect(fieldCard('Media cost')).toBeVisible();
  await page.getByLabel('Search fields').fill('');

  // Sorting stays reachable without column headers to click.
  await page.getByLabel('Sort fields by').selectOption('label');
  await expect(page.getByRole('listitem').first()).toContainText('Campaign');
  await page.getByRole('button', { name: 'Sort descending' }).click();
  await expect(page.getByRole('listitem').first()).toContainText('VTR');

  const saved = page.waitForResponse(
    (response) =>
      response.url().includes('/api/yresonance') &&
      response.request().postDataJSON()?.action === 'updateFieldMetadata',
  );
  await page.getByRole('button', { name: 'Edit Media cost' }).click();
  await expect(page.getByRole('heading', { name: 'Edit Media cost' })).toBeVisible();
  await page.getByLabel('Label', { exact: true }).fill('Spend');
  await page.getByRole('button', { name: 'Save field' }).click();
  await saved;

  // The dialog closes onto the saved value without dropping focus to the document.
  await expect(page.getByRole('button', { name: 'Save field' })).toBeHidden();
  await expect(fieldCard('Spend')).toBeVisible();
  await expect(page.locator('body')).not.toBeFocused();
});

test('the full table returns once there is room for it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await mockYresonanceApi(page);
  await page.goto('/datasources');

  await expect(page.getByRole('columnheader', { name: 'Last updated' })).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('cell', { name: 'Reporting example' })).toBeVisible();
  await expect(page.getByLabel('Sort datasources by')).toBeHidden();
});
