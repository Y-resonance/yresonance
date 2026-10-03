import { expect, test } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('mobile widget settings remove an empty desktop layout row', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.dashboard.canvasRows = 11;
  state.dashboard.widgets = state.dashboard.widgets.map((widget) =>
    widget.layout.y >= 2
      ? { ...widget, layout: { ...widget.layout, y: widget.layout.y + 1 } }
      : widget,
  );
  await page.goto('/dashboards/dash_demo');

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  const settings = page.getByRole('dialog', { name: 'Widget settings' });
  await settings.getByRole('button', { name: 'Remove empty row above' }).click();
  await expect
    .poll(() => state.dashboard.widgets.find((widget) => widget.id === 'w_spend')?.layout.y)
    .toBe(2);
  expect(state.dashboard.canvasRows).toBe(10);
});
