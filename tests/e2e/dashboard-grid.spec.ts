import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('viewer keeps the builder row sizes and widget gaps', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop-ui', 'Stored placement applies on desktop.');
  await mockYresonanceApi(page);
  await page.goto('/dashboards/dash_demo');
  const spend = page.locator('.react-grid-item[data-widget-id="w_spend"]');
  const campaigns = page.locator('.react-grid-item[data-widget-id="w_campaigns"]');
  await expect(spend).toBeVisible();
  const builderSpend = (await spend.boundingBox())!;
  const builderCampaigns = (await campaigns.boundingBox())!;
  const builderGap = builderCampaigns.x - builderSpend.x - builderSpend.width;
  await page.getByRole('switch', { name: 'Viewer mode' }).click();
  const viewerSpend = page.locator('[data-slot="card"]').filter({ hasText: 'Media spend' });
  const viewerCampaigns = page.locator('[data-slot="card"]').filter({ hasText: 'Campaigns' });
  await expect(viewerSpend).toBeVisible();
  const spendBox = (await viewerSpend.boundingBox())!;
  const campaignsBox = (await viewerCampaigns.boundingBox())!;
  expect(spendBox.height).toBeCloseTo(builderSpend.height, 0);
  expect(campaignsBox.height).toBeCloseTo(builderCampaigns.height, 0);
  expect(campaignsBox.x - spendBox.x - spendBox.width).toBeCloseTo(builderGap, 0);
});
