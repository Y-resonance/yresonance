import { test } from './support/ui-test';
import { expect, type Locator, type Page } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

const radius = (card: Locator) =>
  card.evaluate((element) => getComputedStyle(element).borderTopLeftRadius);

const conflict = {
  status: 409,
  contentType: 'application/json',
  body: JSON.stringify({
    ok: false,
    error: { code: 'dashboard_conflict', message: 'This dashboard changed while saving.' },
  }),
};
const outage = {
  status: 500,
  contentType: 'application/json',
  body: JSON.stringify({ ok: false, error: { code: 'internal', message: 'Service unavailable.' } }),
};

// The refresh after the last save would repair the form, so leave it unanswered to see what the
// page does by itself.
const leaveReadsUnanswered = (page: Page) =>
  page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action !== 'getDashboard') return route.fallback();
    await new Promise(() => undefined);
  });

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

    // The link is a real anchor styled as a button, so it has to match the Share button beside it.
    const settingsLink = page.getByRole('link', { name: 'Settings' });
    const borderColor = (locator: Locator) =>
      locator.evaluate((element) => getComputedStyle(element).borderTopColor);
    expect(await borderColor(settingsLink)).toBe(
      await borderColor(page.getByRole('button', { name: 'Share' })),
    );
    await settingsLink.click();
    await expect(page).toHaveURL(/\/dashboards\/dash_demo\/settings/);
    const themeRadius = page.getByLabel('Style: border radius');
    await themeRadius.fill('0');
    await themeRadius.press('Enter');
    await expect.poll(() => state.dashboard.theme).toEqual({ widgetDefaults: { borderRadius: 0 } });
    await page.getByRole('link', { name: state.dashboard.name }).click();
    await expect(page).toHaveURL(/\/dashboards\/dash_demo(\?|$)/);
    await expect.poll(() => radius(builderCard('w_spend'))).toBe('0px');
    await expect.poll(() => radius(builderCard('w_campaigns'))).toBe('0px');

    await page.getByRole('button', { name: 'Edit Media spend' }).click();
    const widgetRadius = settings.getByLabel('Style: border radius');
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
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await weight.fill('99');
    await weight.blur();
    await expect(weight).toHaveValue('16');
    await expect.poll(() => state.dashboard.theme?.widgetDefaults?.borderWidth).toBe(16);

    // Already at the limit nothing changes to save, so the field has to correct itself.
    await weight.fill('99');
    await weight.blur();
    await expect(weight).toHaveValue('16');
  });

  // Saving the first field must neither take focus from the second one nor let the refresh that
  // follows the first save overwrite the second edit.
  test('widget fields keep edits made one after the other', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'The inspector sits beside the canvas.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo');
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
    await page.getByRole('button', { name: 'Edit Media spend' }).click();

    const secondSaveSent = Promise.withResolvers<void>();
    const releaseRefresh = Promise.withResolvers<void>();
    const releaseSecondSave = Promise.withResolvers<void>();
    let saves = 0;
    await page.route('**/api/yresonance', async (route) => {
      const { action } = route.request().postDataJSON();
      if (action === 'getDashboard' && saves === 1) await releaseRefresh.promise;
      if (action === 'updateWidget') {
        saves += 1;
        if (saves === 2) {
          secondSaveSent.resolve();
          await releaseSecondSave.promise;
        }
      }
      await route.fallback();
    });

    const settings = page.getByRole('complementary');
    const weight = settings.getByRole('spinbutton', {
      name: 'Style: border weight',
    });
    const corner = settings.getByRole('spinbutton', {
      name: 'Style: border radius',
    });
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
    await expect
      .poll(
        () =>
          state.dashboard.pages[0].widgets.find((widget) => widget.id === 'w_spend')?.definition
            .appearance,
      )
      .toEqual({ borderWidth: 6, borderRadius: 20 });
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
    await expect(corner).toHaveValue('20');
    await expect(weight).toHaveValue('6');
  });

  test('settings fields keep edits made while an earlier one is saving', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByRole('spinbutton', { name: 'Style: border weight' });
    const corner = page.getByRole('spinbutton', { name: 'Style: border radius' });
    await expect(weight).toBeVisible();

    const releaseFirstSave = Promise.withResolvers<void>();
    let saves = 0;
    await page.route('**/api/yresonance', async (route) => {
      if (route.request().postDataJSON().action === 'updateDashboard' && ++saves === 1)
        await releaseFirstSave.promise;
      await route.fallback();
    });

    await weight.click();
    await page.keyboard.type('6');
    await corner.click();
    await page.keyboard.type('20');
    await expect(corner).toBeFocused();
    await page.mouse.click(5, 5);
    await expect(page.getByRole('status', { name: 'Saving changes' })).toBeVisible();

    releaseFirstSave.resolve();
    await expect
      .poll(() => state.dashboard.theme?.widgetDefaults)
      .toEqual({ borderWidth: 6, borderRadius: 20 });
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
    await expect(weight).toHaveValue('6');
    await expect(corner).toHaveValue('20');
  });

  // Opening settings with an older cache entry refetches it behind the form. The next edit is built
  // from what the form shows, so a response that undoes an edit would also erase it on the server.
  test('a settings edit survives the refresh that was running when it was made', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.clock.install();
    await page.goto('/dashboards/dash_demo');
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

    const refreshStarted = Promise.withResolvers<void>();
    const releaseRefresh = Promise.withResolvers<void>();
    const saveStarted = Promise.withResolvers<void>();
    const releaseSave = Promise.withResolvers<void>();
    await page.route('**/api/yresonance', async (route) => {
      const { action } = route.request().postDataJSON();
      if (action === 'updateDashboard') {
        saveStarted.resolve();
        await releaseSave.promise;
      }
      if (action !== 'getDashboard') return route.fallback();
      refreshStarted.resolve();
      // A read answers with the document as it was when it started.
      const dashboard = structuredClone(state.dashboard);
      await releaseRefresh.promise;
      await route
        .fulfill({ json: { ok: true, data: { dashboard, role: 'editor', dataSources: [] } } })
        .catch(() => undefined);
    });
    await page.clock.fastForward(31_000);
    await page.getByRole('link', { name: 'Settings' }).click();
    await refreshStarted.promise;

    const shadow = page.getByRole('switch', { name: 'Style: shadow' });
    await shadow.click();
    await saveStarted.promise;
    releaseRefresh.resolve();
    // Nothing visible marks a dropped response, so give an applied one time to render.
    await page.waitForTimeout(300);
    await expect(shadow).toBeChecked();

    releaseSave.resolve();
    await expect.poll(() => state.dashboard.theme).toEqual({ widgetDefaults: { shadow: true } });
    const weight = page.getByLabel('Style: border weight');
    await weight.fill('6');
    await weight.blur();
    await expect
      .poll(() => state.dashboard.theme)
      .toEqual({ widgetDefaults: { shadow: true, borderWidth: 6 } });
  });

  // A tool write finishing during a save asks for a refresh, which could answer from before the save.
  test('a tool write during a theme save neither undoes the edit nor goes unseen', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    type Tool = { name: string; execute: (input: Record<string, unknown>) => Promise<unknown> };
    await page.addInitScript(() => {
      const tools = new Map<string, Tool>();
      Object.defineProperty(document, 'modelContext', {
        value: {
          tools,
          registerTool: async (tool: Tool, options: { signal: AbortSignal }) => {
            tools.set(tool.name, tool);
            options.signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
          },
        },
      });
    });
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const shadow = page.getByRole('switch', { name: 'Style: shadow' });
    await expect(shadow).toBeVisible();

    const releaseSave = Promise.withResolvers<void>();
    await page.route('**/api/yresonance', async (route) => {
      const { action, theme } = route.request().postDataJSON();
      if (action === 'updateDashboard' && theme) await releaseSave.promise;
      await route.fallback();
    });

    await shadow.click();
    await page.evaluate(() =>
      (document.modelContext as unknown as { tools: Map<string, Tool> }).tools
        .get('updateDashboard')!
        .execute({ name: 'Renamed by agent' }),
    );
    // The server doesn't have the theme yet, so a read now would flip the switch back.
    await page.waitForTimeout(300);
    await expect(shadow).toBeChecked();

    releaseSave.resolve();
    await expect.poll(() => state.dashboard.theme).toEqual({ widgetDefaults: { shadow: true } });
    await expect(page.getByRole('link', { name: 'Renamed by agent' })).toBeVisible();
    await expect(shadow).toBeChecked();
  });

  test('a theme save that fails shows why and restores the field', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await expect(weight).toBeVisible();
    await leaveReadsUnanswered(page);
    await page.route('**/api/yresonance', async (route) => {
      if (route.request().postDataJSON().action !== 'updateDashboard') return route.fallback();
      await route.fulfill(conflict);
    });

    await weight.fill('6');
    await weight.blur();
    await expect(page.getByText('This dashboard changed while saving.')).toBeVisible();
    await expect(page.getByRole('status', { name: 'Changes could not be saved' })).toBeVisible();
    await expect(weight).toHaveValue('');
  });

  test('theme saves that all fail restore the theme the server still has', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    state.dashboard.theme = { widgetDefaults: { borderWidth: 2 } };
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await expect(weight).toHaveValue('2');
    await leaveReadsUnanswered(page);

    const releaseFirstSave = Promise.withResolvers<void>();
    let saves = 0;
    await page.route('**/api/yresonance', async (route) => {
      if (route.request().postDataJSON().action !== 'updateDashboard') return route.fallback();
      if (++saves === 1) await releaseFirstSave.promise;
      await route.fulfill(conflict);
    });

    await weight.fill('6');
    await weight.blur();
    const corner = page.getByLabel('Style: border radius');
    await corner.fill('20');
    await corner.blur();
    releaseFirstSave.resolve();

    await expect(page.getByRole('status', { name: 'Changes could not be saved' })).toBeVisible();
    await expect(weight).toHaveValue('2');
    await expect(corner).toHaveValue('');
  });

  test('a failed theme save keeps an earlier edit that saved', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await expect(weight).toBeVisible();
    await leaveReadsUnanswered(page);
    const releaseFirstSave = Promise.withResolvers<void>();
    let saves = 0;
    await page.route('**/api/yresonance', async (route) => {
      if (route.request().postDataJSON().action !== 'updateDashboard') return route.fallback();
      if (++saves > 1) return route.fulfill(conflict);
      await releaseFirstSave.promise;
      await route.fallback();
    });

    await weight.fill('6');
    await weight.blur();
    const corner = page.getByLabel('Style: border radius');
    await corner.fill('20');
    await corner.blur();
    releaseFirstSave.resolve();

    await expect(page.getByRole('status', { name: 'Changes could not be saved' })).toBeVisible();
    await expect.poll(() => state.dashboard.theme).toEqual({ widgetDefaults: { borderWidth: 6 } });
    await expect(weight).toHaveValue('6');
    await expect(corner).toHaveValue('');
  });

  test('an outage during a theme save keeps the form and says the save failed', async ({
    page,
  }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await expect(weight).toBeVisible();
    await page.route('**/api/yresonance', async (route) => {
      const { action } = route.request().postDataJSON();
      if (action !== 'updateDashboard' && action !== 'getDashboard') return route.fallback();
      await route.fulfill(outage);
    });

    const failedRefresh = page.waitForResponse(
      (response) => response.request().postDataJSON()?.action === 'getDashboard',
    );
    await weight.fill('6');
    await weight.blur();
    await failedRefresh;
    await page.waitForTimeout(300);
    await expect(page.getByRole('status', { name: 'Changes could not be saved' })).toBeVisible();
    await expect(weight).toHaveValue('');
  });

  test('leaving settings while a save runs survives a failed refresh', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await expect(weight).toBeVisible();

    const releaseSave = Promise.withResolvers<void>();
    let saved = false;
    await page.route('**/api/yresonance', async (route) => {
      const { action } = route.request().postDataJSON();
      if (action === 'updateDashboard') {
        await releaseSave.promise;
        saved = true;
      }
      if (action === 'getDashboard' && saved) return route.fulfill(outage);
      await route.fallback();
    });

    await weight.fill('6');
    await weight.blur();
    await page.getByRole('link', { name: state.dashboard.name }).click();
    await expect(page.getByRole('heading', { name: state.dashboard.name })).toBeVisible();

    const failedRefresh = page.waitForResponse((response) => response.status() === 500);
    releaseSave.resolve();
    await failedRefresh;
    await page.waitForTimeout(300);
    await expect(page.getByRole('heading', { name: state.dashboard.name })).toBeVisible();
  });

  test('a later theme save clears the error of an earlier one', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'One viewport covers the settings form.');
    const state = await mockYresonanceApi(page, { role: 'editor' });
    await page.goto('/dashboards/dash_demo/settings');
    const weight = page.getByLabel('Style: border weight');
    await expect(weight).toBeVisible();

    const releaseFirstSave = Promise.withResolvers<void>();
    let saves = 0;
    await page.route('**/api/yresonance', async (route) => {
      if (route.request().postDataJSON().action !== 'updateDashboard') return route.fallback();
      if (++saves > 1) return route.fallback();
      await releaseFirstSave.promise;
      await route.fulfill(conflict);
    });

    await weight.fill('6');
    await weight.blur();
    const corner = page.getByLabel('Style: border radius');
    await corner.fill('20');
    await corner.blur();
    releaseFirstSave.resolve();

    await expect
      .poll(() => state.dashboard.theme?.widgetDefaults)
      .toEqual({ borderWidth: 6, borderRadius: 20 });
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
    await expect(page.getByText('This dashboard changed while saving.')).toHaveCount(0);
  });

  test('viewers have no settings and are sent back to the dashboard', async ({ page }) => {
    test.skip(test.info().project.name !== 'desktop-ui', 'The route behaves the same on mobile.');
    await mockYresonanceApi(page, { role: 'viewer' });
    await page.goto('/dashboards/dash_demo/settings');
    await expect(page).toHaveURL(/\/dashboards\/dash_demo(\?|$)/);
    await expect(page.getByRole('heading', { name: 'Client weekly' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Settings' })).toHaveCount(0);
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
