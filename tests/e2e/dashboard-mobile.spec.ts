import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 375, height: 780 } });

const documentOverflow = () =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth;

test('a phone viewer reaches the controls from a sticky bar and never scrolls sideways', async ({
  page,
}) => {
  await mockYresonanceApi(page, { role: 'viewer' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('heading', { name: 'Client weekly' })).toBeVisible();

  const controls = page.getByRole('region', { name: 'Dashboard controls' });
  await expect(controls.getByText('Date range')).toBeVisible();
  const dateRange = controls.getByRole('button', { name: 'Choose date range' });
  await dateRange.click();
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(page).toHaveURL(/dateRange=last-7-days/u);
  await page.reload();
  await expect(dateRange).toContainText('Last 7 days');
  await dateRange.click();
  await page.getByRole('button', { name: 'Use default' }).click();
  await expect(page).not.toHaveURL(/dateRange=/u);
  await expect(controls.getByRole('button', { name: 'Choose Platform values' })).toBeVisible();
  // Data widgets stay out of the control bar.
  await expect(controls.getByText('Media spend')).toHaveCount(0);
  await expect(page.getByText('Media spend')).toBeVisible();

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.evaluate(documentOverflow)).toBeLessThanOrEqual(0);
  }

  // The bar stays reachable after scrolling down to the widgets.
  await page.mouse.wheel(0, 2000);
  await expect(page.getByRole('button', { name: 'Hide controls' })).toBeInViewport();

  // The filter popover is portalled, so the scrollable bar must not clip it.
  await page.getByRole('button', { name: 'Choose Platform values' }).click();
  await page.getByRole('option', { name: 'TikTok' }).click();
  await page.keyboard.press('Escape');
  await expect(controls.getByRole('button', { name: 'Remove TikTok' })).toBeVisible();

  await page.getByRole('button', { name: 'Hide controls' }).click();
  await expect(page.getByText('Date range')).toBeHidden();
  await page.getByRole('button', { name: 'Show controls' }).click();
  await expect(page.getByText('Date range')).toBeVisible();
});

test('a phone editor edits a widget in a sheet that closes on Escape', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('heading', { name: 'Client weekly' })).toBeVisible();

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 780 });
    expect(await page.evaluate(documentOverflow)).toBeLessThanOrEqual(0);
    await expect(page.getByRole('button', { name: 'Duplicate', exact: true })).toBeInViewport();
    await expect(page.getByRole('button', { name: 'Share', exact: true })).toBeInViewport();
  }

  const edit = page.getByRole('button', { name: 'Edit Media spend' });
  await edit.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', { name: 'Media spend' })).toBeVisible();
  await expect(sheet.getByLabel('Title', { exact: true })).toHaveValue('Media spend');

  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await expect(edit).toBeFocused();

  await page.getByRole('button', { name: 'Edit Date range' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Choose date range' }),
  ).toBeVisible();

  expect(await page.evaluate(documentOverflow)).toBeLessThanOrEqual(0);
});

test('changing the date control default applies it to the dashboard', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');

  await page.getByRole('button', { name: 'Edit Date range' }).click();
  const settings = page.getByRole('dialog', { name: 'Widget settings' });
  await settings.getByRole('button', { name: 'Choose date range' }).click();
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(page.getByRole('button', { name: 'Choose date range' }).first()).toContainText(
    'Last 7 days',
  );
});
