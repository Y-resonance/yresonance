import { test } from './support/ui-test';
import { expect, type Page } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test.use({ viewport: { width: 1280, height: 900 }, isMobile: false, hasTouch: false });

/** Clicks empty grid space near the bottom-left of the canvas, below every widget. */
async function clickCanvasBackground(page: Page) {
  const grid = page.locator('.react-grid-layout');
  const box = (await grid.boundingBox())!;
  await page.mouse.click(box.x + 20, box.y + box.height - 20);
}

test('the inspector releases the widget on Escape and on a canvas click', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const settings = page.getByRole('complementary');
  const hint = settings.getByText('Select a widget to edit it.');
  const spendSettings = settings.getByRole('heading', { name: 'Media spend' });
  await expect(hint).toBeVisible();

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  await expect(spendSettings).toBeVisible();

  // Working inside the inspector keeps the widget selected.
  await settings.getByLabel('Title', { exact: true }).click();
  await expect(spendSettings).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(hint).toBeVisible();

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  await expect(spendSettings).toBeVisible();
  await clickCanvasBackground(page);
  await expect(hint).toBeVisible();
});

// Escape is layered: the confirm dialog claims it before the canvas selection does.
test('Escape closes the remove dialog before it clears the selection', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  const settings = page.getByRole('complementary');
  await expect(settings.getByRole('heading', { name: 'Media spend' })).toBeVisible();

  await page.getByRole('button', { name: 'Remove Media spend' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(settings.getByRole('heading', { name: 'Media spend' })).toBeVisible();
});

test('finishing a widget drag keeps the widget selected', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const card = page.locator('.react-grid-item').filter({ hasText: 'Media spend' });
  await card.hover();
  const handle = card.locator('.widget-drag-handle');
  await handle.click();
  const settings = page.getByRole('complementary');
  await expect(settings.getByRole('heading', { name: 'Media spend' })).toBeVisible();

  await card.hover();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 300, box.y + 200, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(() => state.dashboard.widgets.find((widget) => widget.id === 'w_spend')?.layout.x)
    .toBeGreaterThan(0);
  await expect(settings.getByRole('heading', { name: 'Media spend' })).toBeVisible();
});

test('a widget resizes from anywhere along its border', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const card = page.locator('.react-grid-item').filter({ hasText: 'Campaigns' });
  const cardBox = (await card.boundingBox())!;
  const bottomEdge = card.locator('.react-resizable-handle-s');
  const edgeBox = (await bottomEdge.boundingBox())!;

  expect(edgeBox.width).toBeGreaterThan(cardBox.width * 0.8);

  // Start near the left side, well away from the old centered handle.
  await page.mouse.move(edgeBox.x + 24, edgeBox.y + edgeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(edgeBox.x + 24, edgeBox.y + edgeBox.height / 2 + 70, { steps: 12 });
  await page.mouse.up();

  await expect
    .poll(
      () => state.dashboard.widgets.find((widget) => widget.id === 'w_campaigns')?.layout.height,
    )
    .toBeGreaterThan(5);
});

test('a control widget can be resized to one row', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  const dateControl = state.dashboard.widgets.find((widget) => widget.id === 'w_date')!;
  dateControl.layout = { ...dateControl.layout, y: 7 };

  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  const control = page.locator('.react-grid-item').filter({ hasText: 'Date range' });
  const bottomEdge = control.locator('.react-resizable-handle-s');
  const edgeBox = (await bottomEdge.boundingBox())!;

  await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(edgeBox.x + edgeBox.width / 2, edgeBox.y + edgeBox.height / 2 - 70, {
    steps: 12,
  });
  await page.mouse.up();

  await expect
    .poll(() => state.dashboard.widgets.find((widget) => widget.id === 'w_date')?.layout.height)
    .toBe(1);
});

test('the toolbar adds a widget while another one is being edited', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Media spend' }).click();
  const settings = page.getByRole('complementary');
  await expect(settings.getByRole('heading', { name: 'Media spend' })).toBeVisible();

  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('button', { name: 'Add Scorecard' }).click();

  await expect
    .poll(() => state.dashboard.widgets.filter((widget) => widget.id.startsWith('w_added')).length)
    .toBe(1);
  // Adding hands the inspector to the new widget instead of dropping back to the empty state.
  await expect(settings.getByRole('heading', { name: 'New scorecard' })).toBeVisible();
  await expect(settings.getByText('Select a widget to edit it.')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add Scorecard' })).toHaveCount(0);
});

// The popover has to survive the drag it starts, and stay clear of the drop target.
test('a widget dragged out of the toolbar popover lands on the grid', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Add widget' }).click();
  const row = page.getByRole('button', { name: 'Add Gauge' }).locator('xpath=..');
  const source = (await row.boundingBox())!;
  const grid = page.locator('.react-grid-layout');
  const box = (await grid.boundingBox())!;

  await page.mouse.move(source.x + 10, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 200, box.y + box.height - 60, { steps: 20 });
  await page.mouse.move(box.x + box.width - 180, box.y + box.height - 50, { steps: 10 });
  await page.mouse.up();

  await expect
    .poll(() => state.dashboard.widgets.map((widget) => widget.definition.type))
    .toContain('gauge');
  await expect(page.getByRole('button', { name: 'Add Gauge' })).toHaveCount(0);
});
