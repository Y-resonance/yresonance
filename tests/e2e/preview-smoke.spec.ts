import { expect, test } from '@playwright/test';
import { clerkCredentials, missingClerkCredentials } from './support/clerk-credentials';
import { signInWithClerk } from './support/clerk-session';
import { callApi, seedDashboard, seedDataSource } from './support/seed';

test('a deployed preview signs in, imports CSV, queries fresh data and serves an uploaded image', async ({
  page,
}) => {
  const credentials = clerkCredentials();
  if (!credentials) throw new Error(missingClerkCredentials);
  await signInWithClerk(page, credentials);
  const overview = page.getByRole('heading', { level: 1, name: 'Dashboards', exact: true });
  const workspaceGate = page.getByRole('heading', { level: 1, name: 'Choose where to continue' });
  await expect(overview.or(workspaceGate)).toBeVisible();
  if (await workspaceGate.isVisible())
    await page.getByRole('button', { name: 'Continue', exact: true }).first().click();
  await expect(overview).toBeVisible();

  const suffix = Date.now().toString(36);
  const source = await seedDataSource(page, `Preview smoke CSV ${suffix}`);
  const dashboard = await seedDashboard(page, `Preview smoke ${suffix}`, source);
  await page.goto(`/dashboards/${dashboard.id}`);
  const revenue = page.locator('[data-widget-id]').filter({
    has: page.getByRole('button', { name: 'Edit Revenue', exact: true }),
  });
  await expect(revenue).toContainText('445');
  const widgetId = await revenue.getAttribute('data-widget-id');
  const fresh = await callApi<{ cache: string; rows: Record<string, unknown>[] }>(page, {
    action: 'queryWidget',
    dashboardId: dashboard.id,
    widgetId,
    refresh: true,
  });
  expect(fresh.cache).toBe('miss');
  // DuckDB SUM over integers returns HUGEINT, serialized as text to preserve precision.
  expect(fresh.rows).toEqual([{ metric_1: '445' }]);

  // Real PNG bytes exercise storage and the deployed Images binding, without fixture routes.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAA+gAAAACCAIAAABE9mHKAAAAJklEQVR42u3QMQ0AAAgDsElBGlKRho0dTaqgmT0AAKBcFAAAQL8HjrbEiKnb4K8AAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await page.request.put(
    `/api/dashboards/${dashboard.id}/assets?name=preview-smoke.png`,
    {
      data: png,
      headers: { 'content-type': 'image/png' },
    },
  );
  expect(upload.status()).toBe(201);
  const asset = (await upload.json()) as { id: string; width: number; height: number };
  expect(asset).toMatchObject({ width: 1000, height: 2 });
  await callApi(page, {
    action: 'addWidget',
    dashboardId: dashboard.id,
    pageId: `${dashboard.id}_page`,
    definition: { type: 'image', assetId: asset.id, alt: 'Preview smoke image' },
    width: 4,
    height: 3,
  });
  await page.reload();
  const image = page.getByRole('img', { name: 'Preview smoke image', exact: true });
  await expect(image).toBeVisible();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true);
  const served = await page.request.get(
    `/api/dashboards/${dashboard.id}/assets/${asset.id}?w=320`,
    { headers: { accept: 'image/webp' } },
  );
  expect(served.status()).toBe(200);
  expect(served.headers()['content-type']).toMatch(/^image\//);
  expect(served.headers()['cache-control']).toContain('private');
  expect((await served.body()).byteLength).toBeGreaterThan(0);
});
