import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

test('a calculated field reads as fx and opens the formula editor from the inspector', async ({
  page,
}) => {
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Campaigns' }).click();
  const settings = page.getByRole('complementary');
  await expect(settings.getByRole('heading', { name: 'Campaigns' })).toBeVisible();

  // Raw fields carry their value type, calculated ones carry fx.
  await settings.getByRole('button', { name: 'Media cost' }).click();
  await expect(page.getByRole('option', { name: '123 Media cost' })).toBeVisible();
  await page.getByRole('option', { name: 'fx VTR' }).click();

  await settings.getByRole('button', { name: 'Edit formula for metric 1' }).click();
  await expect(page.getByRole('heading', { name: 'Edit VTR' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('impressions / 100');

  const saved = page.waitForRequest(
    (request) => request.postDataJSON()?.action === 'upsertCalculatedField',
  );
  await page.getByRole('button', { name: 'Save field' }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    role: 'metric',
    semanticType: 'ratio',
    defaultAggregation: 'average',
  });
});

test('a custom metric is written and re-opened in the aggregate formula editor', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Campaigns' }).click();
  const settings = page.getByRole('complementary');
  await settings.getByRole('button', { name: 'Media cost' }).click();
  await page.getByRole('option', { name: 'Add custom metric' }).click();

  await expect(page.getByRole('heading', { name: 'Add custom metric' })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill('Cost per view');
  await page.locator('.cm-content').click();
  await page.keyboard.type('sum(media_cost) / sum(impressions)');
  await page.getByText('Save to workspace library').click();

  const save = page.getByRole('button', { name: 'Add metric' });
  await expect(save).toBeEnabled();
  await save.click();

  await expect
    .poll(() => {
      const widget = state.dashboard.pages[0].widgets.find((item) => item.id === 'w_campaigns');
      return widget?.definition.type === 'table' ? widget.definition.metrics.at(-1)?.source : null;
    })
    .toMatchObject({ kind: 'expression', expression: 'sum(media_cost) / sum(impressions)' });
  expect(state.source.libraryMetrics).toContainEqual(
    expect.objectContaining({
      name: 'Cost per view',
      expression: 'sum(media_cost) / sum(impressions)',
    }),
  );

  // The saved expression comes back into the same editor instead of a bare textarea.
  await settings.getByRole('button', { name: 'Edit formula for metric 2' }).click();
  await expect(page.getByRole('heading', { name: 'Edit custom metric' })).toBeVisible();
  await expect(page.locator('.cm-content')).toContainText('sum(media_cost) / sum(impressions)');
});

test('formula text stays readable across dark and light theme changes', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('theme', 'dark'));
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await page.getByRole('button', { name: 'Edit Campaigns' }).click();
  await page.getByRole('complementary').getByRole('button', { name: 'Media cost' }).click();
  await page.getByRole('option', { name: 'fx VTR' }).click();
  await page.getByRole('button', { name: 'Edit formula for metric 1' }).click();
  const formula = page.locator('.cm-content');
  await expect(formula).toContainText('impressions / 100');

  for (const dark of [true, false, true]) {
    // The application owns this class outside React, including while a dialog is open.
    await page.evaluate((dark) => document.documentElement.classList.toggle('dark', dark), dark);
    await expect
      .poll(() =>
        formula.evaluate((content) => {
          const luminance = (color: string) => {
            const channels = color
              .match(/\d+/gu)!
              .slice(0, 3)
              .map(Number)
              .map((value) => {
                const channel = value / 255;
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
              });
            return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
          };
          const background = luminance(
            getComputedStyle(content.closest('.cm-editor')!).backgroundColor,
          );
          return Math.min(
            ...[content, ...content.querySelectorAll('span')].map((element) => {
              const foreground = luminance(getComputedStyle(element).color);
              return (
                (Math.max(foreground, background) + 0.05) /
                (Math.min(foreground, background) + 0.05)
              );
            }),
          );
        }),
      )
      .toBeGreaterThanOrEqual(4.5);
    await expect(formula).toContainText('impressions / 100');
  }
});
