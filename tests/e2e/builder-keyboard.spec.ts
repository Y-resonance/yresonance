import { test } from './support/ui-test';
import { expect, type Locator, type Page } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

/** Walks the tab order to `target`, proving the control is reachable without a pointer. */
async function tabTo(page: Page, target: Locator, key: 'Tab' | 'Shift+Tab' = 'Tab', limit = 80) {
  await expect(target).toBeAttached();
  for (let step = 0; step < limit; step += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press(key);
  }
  throw new Error(`Could not reach ${await target.getAttribute('aria-label')} with ${key}`);
}

test('a keyboard-only editor selects, edits, and removes a widget', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('heading', { name: 'Client weekly' })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  // Select
  await tabTo(page, page.getByRole('button', { name: 'Edit Media spend' }));
  await page.keyboard.press('Enter');
  const settings = page.getByRole('complementary');
  await expect(settings.getByRole('heading', { name: 'Media spend' })).toBeVisible();

  // Edit through the form
  const title = settings.getByLabel('Title', { exact: true });
  await tabTo(page, title);
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Spend to date');
  await page.keyboard.press('Tab');
  await expect(settings.getByRole('heading', { name: 'Spend to date' })).toBeVisible();

  // Removing happens on the widget card now; it asks first, and Escape backs out with focus restored
  const remove = page.getByRole('button', { name: 'Remove Spend to date' });
  await tabTo(page, remove, 'Shift+Tab');
  await page.keyboard.press('Enter');
  const confirmation = page.getByRole('dialog');
  await expect(confirmation.getByText('Remove Spend to date?')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirmation).toBeHidden();
  await expect(remove).toBeFocused();
  await expect(settings.getByRole('heading', { name: 'Spend to date' })).toBeVisible();

  // Confirming removes it
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Remove widget' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect
    .poll(() => state.dashboard.widgets.some((widget) => widget.id === 'w_spend'))
    .toBe(false);
  await expect(page.getByText('Spend to date')).toHaveCount(0);
});

test('aggregation options explain their calculations', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  const settings = page.getByRole('complementary');
  const aggregation = settings.getByRole('combobox', { name: 'Aggregation for metric 1' });
  await aggregation.click();

  const sum = page.getByRole('option', { name: 'SUM' });
  const helpIconPositions = await page
    .locator('[data-slot="aggregation-help"]')
    .evaluateAll((icons) => icons.map((icon) => Math.round(icon.getBoundingClientRect().x)));
  expect(new Set(helpIconPositions).size).toBe(1);
  const countDistinctGap = await page.getByRole('option', { name: 'COUNTD' }).evaluate((option) => {
    const label = option.querySelector('span');
    const help = option.querySelector('[data-slot="aggregation-help"]');
    if (!label || !help) throw new Error('Aggregation option layout is incomplete');
    return help.getBoundingClientRect().left - label.getBoundingClientRect().right;
  });
  expect(countDistinctGap).toBeGreaterThanOrEqual(12);

  await sum.hover();
  await expect(page.getByText('Adds all non-null values in each group.')).toBeVisible();

  await sum.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.getByText('Returns the arithmetic mean of all non-null values.')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(aggregation).toContainText('AVG');
});

test('a keyboard-only editor adds a widget from the toolbar catalog', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await tabTo(page, page.getByRole('button', { name: 'Add widget' }));
  await page.keyboard.press('Enter');
  await tabTo(page, page.getByRole('button', { name: 'Add Scorecard' }));
  await page.keyboard.press('Enter');
  await expect
    .poll(() => state.dashboard.widgets.filter((widget) => widget.id.startsWith('w_added')).length)
    .toBe(1);
  await expect(page.getByRole('button', { name: 'Remove New scorecard' })).toBeVisible();
});

test('row controls insert and remove an empty row with the keyboard', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const insert = page.getByRole('button', { name: 'Insert row after row 2' });
  await tabTo(page, insert);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => state.dashboard.widgets.find((widget) => widget.id === 'w_spend')?.layout.y)
    .toBe(3);
  expect(state.dashboard.canvasRows).toBe(11);

  const remove = page.getByRole('button', { name: 'Remove empty row 3' });
  await tabTo(page, remove);
  await page.keyboard.press('Enter');
  await expect
    .poll(() => state.dashboard.widgets.find((widget) => widget.id === 'w_spend')?.layout.y)
    .toBe(2);
  expect(state.dashboard.canvasRows).toBe(10);

  const addBelow = page.getByRole('button', { name: 'Insert row after row 10' });
  await tabTo(page, addBelow);
  await page.keyboard.press('Enter');
  await expect.poll(() => state.dashboard.canvasRows).toBe(11);
  await expect(page.getByRole('button', { name: 'Insert row after row 11' })).toBeVisible();
  expect(state.dashboard.widgets.find((widget) => widget.id === 'w_spend')?.layout.y).toBe(2);
});

// The drag handle doubles as the keyboard "Edit" button, so the pointer path is worth
// pinning down alongside it.
test('the pointer drag handle still moves a widget', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const card = page.locator('.react-grid-item').filter({ hasText: 'Media spend' });
  await card.hover();
  const handle = card.locator('.widget-drag-handle');
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 60, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(() => state.dashboard.widgets.find((widget) => widget.id === 'w_spend')?.layout.x)
    .toBeGreaterThan(0);

  // A plain click on the handle selects the widget instead of starting a drag.
  await card.hover();
  await handle.click();
  await expect(
    page.getByRole('complementary').getByRole('heading', { name: 'Media spend' }),
  ).toBeVisible();
});
