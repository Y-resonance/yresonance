import { expect, test } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test('charts show legends without widget configuration', async ({ page }) => {
  test.slow();
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.dashboard.widgets.push(
    {
      id: 'w_chart',
      layout: { x: 0, y: 7, width: 8, height: 5 },
      definitionHash: 'hash_w_chart',
      definition: {
        type: 'bar',
        title: 'Spend by campaign',
        dataSourceId: 'src_reporting',
        dateRangeFieldId: 'f_date',
        metric: {
          source: { kind: 'field', fieldId: 'f_spend', aggregation: 'sum' },
          dataType: 'currency',
        },
        dimension: { fieldId: 'f_campaign' },
      },
    },
    {
      id: 'w_line_chart',
      layout: { x: 0, y: 12, width: 8, height: 5 },
      definitionHash: 'hash_w_line_chart',
      definition: {
        type: 'line',
        title: 'Spend trend',
        dataSourceId: 'src_reporting',
        dateRangeFieldId: 'f_date',
        metrics: [
          {
            source: { kind: 'field', fieldId: 'f_spend', aggregation: 'sum' },
            dataType: 'currency',
          },
        ],
        dimension: { fieldId: 'f_campaign' },
      },
    },
    {
      id: 'w_pie_chart',
      layout: { x: 0, y: 17, width: 8, height: 5 },
      definitionHash: 'hash_w_pie_chart',
      definition: {
        type: 'pie',
        title: 'Spend share',
        dataSourceId: 'src_reporting',
        dateRangeFieldId: 'f_date',
        metric: {
          source: { kind: 'field', fieldId: 'f_spend', aggregation: 'sum' },
          dataType: 'currency',
        },
        dimension: { fieldId: 'f_campaign' },
      },
    },
  );
  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.action !== 'queryWidget' || request.widgetId !== 'w_line_chart') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          rows: [
            { dimension_1: '2026-01-05 00:00:00', metric_1: '12340' },
            { dimension_1: '2026-01-06 00:00:00', metric_1: '9870' },
          ],
          columns: [
            { key: 'dimension_1', label: 'Date', kind: 'dimension', dataType: 'date' },
            { key: 'metric_1', label: 'Media cost', kind: 'metric', dataType: 'currency' },
          ],
          hasMore: false,
        },
      }),
    });
  });

  await page.goto('/dashboards/dash_demo');
  const bar = page.locator('[data-widget-id="w_chart"]');
  const line = page.locator('[data-widget-id="w_line_chart"]');
  const pie = page.locator('[data-widget-id="w_pie_chart"]');
  await expect(bar.locator('.recharts-bar-rectangle')).toHaveCount(2, { timeout: 15_000 });
  await expect(bar.locator('.recharts-legend-wrapper')).toContainText('Media cost', {
    timeout: 15_000,
  });
  await expect(line.locator('.recharts-legend-wrapper')).toContainText('Media cost', {
    timeout: 15_000,
  });
  await expect(line.locator('.recharts-line-curve')).toBeVisible();
  await expect(line.getByRole('img', { name: 'Spend trend chart' })).toBeVisible();
  await expect(line.getByText('Jan 5', { exact: true })).toBeVisible();
  await expect(line.getByText('Jan 6', { exact: true })).toBeVisible();
  await expect(pie.locator('.recharts-legend-wrapper')).toContainText('Spring sale', {
    timeout: 15_000,
  });
  await expect(pie.locator('.recharts-legend-wrapper')).toContainText('Always on');

  await bar.getByRole('button', { name: 'Edit Spend by campaign' }).press('Enter');
  await expect(page.getByRole('complementary').getByRole('switch')).toHaveCount(0);
});
