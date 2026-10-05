import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, expect, test, vi } from 'vitest';
import { createDatabase } from '#/db/client';
import { libraryMetrics } from '#/db/schema';
import type { DashboardDocument } from '#/domain/schema';
import * as records from '#/server/records.server';
import {
  addWidget,
  callService,
  createDashboard,
  postApiRequest,
  scorecardDefinition,
  seedDataSource,
  signInToNewWorkspace,
} from './fixtures';

// Let both requests load the same real D1 snapshot before either can write it.
function overlapDashboardLoads() {
  const load = records.loadDashboard;
  let loaded = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => {
    release = resolve;
  });
  vi.spyOn(records, 'loadDashboard').mockImplementation(async (id) => {
    const snapshot = await load(id);
    if (++loaded === 2) release();
    await ready;
    return snapshot;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

test('overlapping add and move reject the stale write, then retry preserves both edits', async () => {
  await signInToNewWorkspace();
  const dashboard = await createDashboard();
  const widget = await addWidget(dashboard.id, {
    type: 'text',
    content: { schemaVersion: 'plain-text-v1', document: 'Existing' },
  });
  // Even edits within the same millisecond need distinct versions.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
  const requests = [
    {
      action: 'addWidget',
      pageId: `${dashboard.id}_page`,
      dashboardId: dashboard.id,
      definition: { type: 'text', content: { schemaVersion: 'plain-text-v1', document: 'Added' } },
      width: 4,
      height: 3,
    },
    {
      action: 'moveWidget',
      dashboardId: dashboard.id,
      widgetId: widget.id,
      placement: { x: 0, y: 10, width: 4, height: 3 },
    },
  ];
  overlapDashboardLoads();
  const responses = await Promise.all(requests.map(postApiRequest));
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const conflict = responses.findIndex((response) => response.status === 409);
  expect(await responses[conflict].json()).toMatchObject({
    ok: false,
    error: { code: 'dashboard_conflict' },
  });
  vi.restoreAllMocks();
  expect((await postApiRequest(requests[conflict])).status).toBe(200);
  const { dashboard: saved } = (await callService({
    action: 'getDashboard',
    dashboardId: dashboard.id,
  })) as { dashboard: DashboardDocument };
  expect(saved.pages[0].widgets).toHaveLength(2);
  expect(saved.pages[0].widgets.find((item) => item.id === widget.id)?.layout.y).toBe(10);
  expect(saved.updatedAt).toBe('2030-01-01T00:00:00.001Z');
});

test('a conflicting widget and library metric update creates neither half of the losing edit', async () => {
  const workspace = await signInToNewWorkspace();
  const source = await seedDataSource(workspace);
  const dashboard = await createDashboard();
  const widget = await addWidget(dashboard.id, scorecardDefinition(source));
  overlapDashboardLoads();
  const responses = await Promise.all(
    ['First', 'Second'].map((name) =>
      postApiRequest({
        action: 'updateWidget',
        dashboardId: dashboard.id,
        widgetId: widget.id,
        definition: { ...scorecardDefinition(source), title: name },
        libraryMetric: {
          name,
          canonicalName: name.toLowerCase(),
          expression: 'sum(revenue)',
          semanticType: 'currency',
        },
      }),
    ),
  );
  expect(responses.map((response) => response.status).sort()).toEqual([200, 409]);
  const winner = responses.findIndex((response) => response.status === 200);
  vi.restoreAllMocks();
  const { dashboard: saved } = (await callService({
    action: 'getDashboard',
    dashboardId: dashboard.id,
  })) as { dashboard: DashboardDocument };
  expect(saved.pages[0].widgets[0].definition).toMatchObject({
    title: ['First', 'Second'][winner],
  });
  const metrics = await createDatabase(env.DB)
    .select()
    .from(libraryMetrics)
    .where(eq(libraryMetrics.workspaceId, workspace.workspaceId));
  expect(metrics.map((metric) => metric.name)).toEqual([['First', 'Second'][winner]]);
});
