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

  test('a value above the limit snaps to it instead of being discarded', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'The inspector sits beside the canvas.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo');
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

    const weight = page.getByRole('complementary').getByLabel('Widget defaults: border weight');
    await weight.fill('99');
    await weight.blur();
    await expect(weight).toHaveValue('16');
    await expect.poll(() => state.dashboard.theme?.widgetDefaults?.borderWidth).toBe(16);

    // Already at the limit nothing changes to save, so the field has to correct itself.
    await weight.fill('99');
    await weight.blur();
    await expect(weight).toHaveValue('16');
  });

  for (const scope of [
    { name: 'theme', legend: 'Widget defaults', selectWidget: false },
    { name: 'widget', legend: 'Background and border', selectWidget: true },
  ]) {
    // Saving the first field must neither take focus from the second one nor let the refresh that
    // follows the first save overwrite the second edit.
    test(`${scope.name} fields keep edits made one after the other`, async ({ page }) => {
      test.skip(test.info().project.name !== 'desktop-ui', 'The inspector sits beside the canvas.');
      const state = await mockYresonanceApi(page, { role: 'editor' });
      await page.goto('/dashboards/dash_demo');
      await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
      if (scope.selectWidget) await page.getByRole('button', { name: 'Edit Media spend' }).click();

      const secondSaveSent = Promise.withResolvers<void>();
      const releaseRefresh = Promise.withResolvers<void>();
      const releaseSecondSave = Promise.withResolvers<void>();
      let saves = 0;
      await page.route('**/api/yresonance', async (route) => {
        const { action } = route.request().postDataJSON();
        if (action === 'getDashboard' && saves === 1) await releaseRefresh.promise;
        if (action === 'updateDashboard' || action === 'updateWidget') {
          saves += 1;
          if (saves === 2) {
            secondSaveSent.resolve();
            await releaseSecondSave.promise;
          }
        }
        await route.fallback();
      });

      const settings = page.getByRole('complementary');
      const weight = settings.getByRole('spinbutton', { name: `${scope.legend}: border weight` });
      const corner = settings.getByRole('spinbutton', { name: `${scope.legend}: border radius` });
      await weight.click();
      await page.keyboard.type('6');
      await corner.click();
      await page.keyboard.type('20');
      await expect(corner).toBeFocused();
      await page.mouse.click(5, 5);
      await secondSaveSent.promise;

      // The refresh answers with only the first edit, while the second one is still saving.
      const staleRefresh = page.waitForResponse(
        (response) => response.request().postDataJSON()?.action === 'getDashboard',
      );
      releaseRefresh.resolve();
      await staleRefresh;
      // Nothing visible marks a dropped response, so give an applied one time to render.
      await page.waitForTimeout(300);
      await expect(corner).toHaveValue('20');
      await expect(weight).toHaveValue('6');

      releaseSecondSave.resolve();
      const stored = () =>
        scope.selectWidget
          ? state.dashboard.pages[0].widgets.find((widget) => widget.id === 'w_spend')?.definition
              .appearance
          : state.dashboard.theme?.widgetDefaults;
      await expect.poll(stored).toEqual({ borderWidth: 6, borderRadius: 20 });
      await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
      await expect(corner).toHaveValue('20');
      await expect(weight).toHaveValue('6');
    });
  }
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
