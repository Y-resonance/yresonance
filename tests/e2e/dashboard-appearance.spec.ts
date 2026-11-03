import { test } from './support/ui-test';
import { expect, type Locator } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

const radius = (card: Locator) =>
  card.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);

test.describe('desktop', () => {
  // The project's mobile device settings would otherwise apply; the mobile test below keeps them.
  test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

  test('theme defaults restyle every widget, an override wins, and viewers see the same', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'The inspector sits beside the canvas.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    const actions: unknown[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/yresonance')) actions.push(request.postDataJSON()?.action);
    });
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
    // Restyling keeps the saved result instead of previewing the widget with a fresh query.
    expect(actions).not.toContain('previewWidget');

    const viewerCard = (title: string) =>
      page.locator('[data-slot="card"]').filter({ hasText: title });
    await page.getByRole('switch', { name: 'Viewer mode' }).click();
    await expect.poll(() => radius(viewerCard('Media spend'))).toBe('20px');
    await expect.poll(() => radius(viewerCard('Campaigns'))).toBe('0px');

    await page.goto('/share/token_demo');
    await expect.poll(() => radius(viewerCard('Media spend'))).toBe('20px');
    await expect.poll(() => radius(viewerCard('Campaigns'))).toBe('0px');
  });
});

test('the mobile builder canvas uses the dashboard theme', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile-ui', 'The stacked builder canvas is mobile only.');
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.dashboard.theme = { brandColor: '#7c3aed', chartPalette: 'brand' };
  await page.goto('/dashboards/dash_demo');

  const card = page.locator('[data-widget-id="w_spend"] [data-slot="card"]');
  await expect
    .poll(() => card.evaluate((element) => getComputedStyle(element).getPropertyValue('--chart-1')))
    .toMatch(/^oklch\(/);
});
