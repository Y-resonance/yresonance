import { test } from './support/ui-test';
import { expect } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

type Tool = {
  name: string;
  inputSchema: { properties?: Record<string, unknown> };
  execute: (input: Record<string, unknown>) => Promise<unknown>;
};
type TestModelContext = { tools: Map<string, Tool> };

// This models the browser's duplicate-name rejection and AbortSignal cleanup.
// The application still chooses and executes the real tools.
test('dashboard management tools keep context and disappear in viewer preview', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const tools = new Map<string, Tool>();
    Object.defineProperty(document, 'modelContext', {
      value: {
        tools,
        registerTool: async (tool: Tool, options: { signal: AbortSignal }) => {
          if (tools.has(tool.name)) throw new DOMException('Duplicate tool', 'InvalidStateError');
          tools.set(tool.name, tool);
          options.signal.addEventListener('abort', () => tools.delete(tool.name), { once: true });
        },
      },
    });
  });
  await mockYresonanceApi(page, { role: 'editor' });
  await page.route('**/api/yresonance', async (route) => {
    if (route.request().postDataJSON().action !== 'shareDashboard') return route.fallback();
    await route.fulfill({
      json: { ok: true, data: { token: 'test-link', url: '/share/test-link' } },
    });
  });
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('heading', { name: 'Client weekly' })).toBeVisible();
  const names = () =>
    page.evaluate(() => [...(document.modelContext as unknown as TestModelContext).tools.keys()]);
  await expect.poll(names).toContain('shareDashboard');
  expect(
    await page.evaluate(
      () =>
        (document.modelContext as unknown as TestModelContext).tools.get('updateDashboard')
          ?.inputSchema.properties,
    ),
  ).not.toHaveProperty('dashboardId');

  const request = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/yresonance') &&
      request.postDataJSON().action === 'shareDashboard',
  );
  await page.evaluate(async () => {
    const tool = (document.modelContext as unknown as TestModelContext).tools.get('shareDashboard');
    if (!tool) throw new Error('Sharing tool missing');
    await tool.execute({ operation: { kind: 'createLink' } });
  });
  expect((await request).postDataJSON()).toMatchObject({
    dashboardId: 'dash_demo',
    operation: { kind: 'createLink' },
  });

  await page.getByRole('switch', { name: 'Viewer mode' }).click();
  await expect.poll(names).not.toContain('shareDashboard');
  expect(await names()).not.toContain('updateDashboard');
  expect(await names()).not.toContain('deleteDashboard');
  await page.getByRole('switch', { name: 'Viewer mode' }).click();
  await expect.poll(names).toContain('shareDashboard');
});

test('a tool changing the dashboard timezone re-runs the widget queries', async ({ page }) => {
  await page.addInitScript(() => {
    const tools = new Map<string, Tool>();
    Object.defineProperty(document, 'modelContext', {
      value: {
        tools,
        registerTool: async (tool: Tool) => void tools.set(tool.name, tool),
      },
    });
  });
  const state = await mockYresonanceApi(page, { role: 'editor' });
  let queries = 0;
  await page.route('**/api/yresonance', async (route) => {
    const body = route.request().postDataJSON();
    if (body.action === 'queryWidget' && body.widgetId === 'w_spend') queries += 1;
    if (body.action !== 'updateDashboard') return route.fallback();
    // Widget definitions stay identical, only the dashboard-level query input changes.
    state.dashboard.timezone = body.timezone;
    await route.fulfill({ json: { ok: true, data: { dashboard: state.dashboard } } });
  });
  await page.goto('/dashboards/dash_demo');
  await expect(page.locator('[data-widget-id="w_spend"] [data-slot="skeleton"]')).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (document.modelContext as unknown as TestModelContext).tools.has('updateDashboard'),
      ),
    )
    .toBe(true);
  const loaded = queries;
  const setTimezone = (timezone: string) =>
    page.evaluate(async (timezone) => {
      const tool = (document.modelContext as unknown as TestModelContext).tools.get(
        'updateDashboard',
      );
      await tool!.execute({ timezone });
    }, timezone);
  // The first tool call switches to agent mode, which remounts the widgets and queries anyway.
  await setTimezone('Europe/London');
  await expect.poll(() => queries).toBeGreaterThan(loaded);
  await expect(page.locator('[data-slot="skeleton"]')).toHaveCount(0);
  const before = queries;
  await setTimezone('America/New_York');
  await expect.poll(() => queries).toBeGreaterThan(before);
});
