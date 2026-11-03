import { test } from './support/ui-test';
import { expect, type Locator } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

const radius = (card: Locator) =>
  card.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);

test('theme defaults restyle every widget, an override wins, and viewers see the same', async ({
  page,
}) => {
  test.skip(test.info().project.name !== 'desktop-ui', 'The inspector sits beside the canvas.');
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  const settings = page.getByRole('complementary');
  const builderCard = (widgetId: string) =>
    page.locator(`[data-widget-id="${widgetId}"] [data-slot="card"]`);

  const themeRadius = settings.getByLabel('Widget defaults: border radius');
  await themeRadius.fill('0');
  await themeRadius.press('Enter');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  await expect.poll(() => radius(builderCard('w_spend'))).toBe('0px');
  await expect.poll(() => radius(builderCard('w_campaigns'))).toBe('0px');

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  const widgetRadius = settings.getByLabel('Background and border: border radius');
  // Unset, the field shows what it inherits from the theme.
  await expect(widgetRadius).toHaveAttribute('placeholder', '0');
  await widgetRadius.fill('20');
  await widgetRadius.press('Enter');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  await expect.poll(() => radius(builderCard('w_spend'))).toBe('20px');
  await expect.poll(() => radius(builderCard('w_campaigns'))).toBe('0px');
  expect(state.dashboard.theme).toEqual({ widgetDefaults: { borderRadius: 0 } });

  const viewerCard = (title: string) =>
    page.locator('[data-slot="card"]').filter({ hasText: title });
  await page.getByRole('switch', { name: 'Viewer mode' }).click();
  await expect.poll(() => radius(viewerCard('Media spend'))).toBe('20px');
  await expect.poll(() => radius(viewerCard('Campaigns'))).toBe('0px');

  await page.goto('/share/token_demo');
  await expect.poll(() => radius(viewerCard('Media spend'))).toBe('20px');
  await expect.poll(() => radius(viewerCard('Campaigns'))).toBe('0px');
});
