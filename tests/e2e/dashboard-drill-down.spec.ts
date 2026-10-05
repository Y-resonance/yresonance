import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

test('a viewer drills from a campaign into its platforms and back', async ({ page }) => {
  test.slow();
  const state = await mockYresonanceApi(page, { role: 'viewer' });
  state.dashboard.pages[0].widgets.push({
    id: 'w_drill',
    layout: { x: 0, y: 7, width: 8, height: 5 },
    definitionHash: 'hash_w_drill',
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
      drillDimensions: [{ fieldId: 'f_platform' }],
    },
  });
  const drillPaths: unknown[] = [];
  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON() as Record<string, unknown>;
    if (request.action !== 'queryWidget' || request.widgetId !== 'w_drill') {
      await route.fallback();
      return;
    }
    drillPaths.push(request.drillPath);
    const drilled = Array.isArray(request.drillPath);
    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        data: {
          rows: drilled
            ? [
                { dimension_1: 'FB', metric_1: 800 },
                { dimension_1: 'IG', metric_1: 434.5 },
              ]
            : [
                // Recharts draws no bar for a zero value, so later bars shift in its click index.
                { dimension_1: 'Paused', metric_1: 0 },
                { dimension_1: 'Spring sale', metric_1: 1234.5 },
                { dimension_1: 'Always on', metric_1: 987.25 },
              ],
          columns: [
            {
              key: 'dimension_1',
              label: drilled ? 'Platform' : 'Campaign',
              kind: 'dimension',
              dataType: 'text',
            },
            { key: 'metric_1', label: 'Media cost', kind: 'metric', dataType: 'currency' },
          ],
        },
      }),
    });
  });

  await page.goto('/dashboards/dash_demo');
  const card = page.locator('[data-slot="card"]', { hasText: 'Spend by campaign' });
  const bars = card.locator('.recharts-bar-rectangle');
  const breadcrumb = card.getByRole('navigation', { name: 'Drill-down' });
  await expect(bars).toHaveCount(2);
  await page.waitForLoadState('networkidle');

  // Clicks outside the plot, such as on the legend, do not drill.
  await card.locator('.recharts-legend-wrapper').getByText('Media cost').click();
  await page.waitForLoadState('networkidle');
  await expect(breadcrumb).toBeHidden();
  expect(drillPaths.filter((path) => path !== undefined)).toHaveLength(0);

  await bars.nth(1).click();
  await expect(breadcrumb).toContainText('Always on');
  await expect(card.getByRole('application')).toContainText('FB');
  expect(drillPaths.at(-1)).toEqual(['Always on']);

  // The last level is not clickable any further.
  const queries = drillPaths.length;
  await bars.first().click();
  await page.waitForLoadState('networkidle');
  expect(drillPaths).toHaveLength(queries);
  await expect(breadcrumb.getByRole('button')).toHaveCount(1);

  await breadcrumb.getByRole('button', { name: 'All' }).click();
  await expect(breadcrumb).toBeHidden();
  await expect(card.getByRole('application')).toContainText('Always on');
  expect(drillPaths.at(-1)).toBeUndefined();
});
