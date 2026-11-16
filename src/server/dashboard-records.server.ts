import { dashboardWidgets } from '#/domain/schema';
import type { newLibraryMetricValues } from './formulas.server';
import { type DashboardDocument, dashboardDocumentSchema } from '#/domain/schema';
import { dashboards, libraryMetrics } from '#/db/schema';
import { and, eq } from 'drizzle-orm';
import { ApiError } from './errors';
import { database } from './database.server';

export async function persistDashboard(
  document: DashboardDocument,
  expectedUpdatedAt: string,
  libraryMetric?: ReturnType<typeof newLibraryMetricValues>,
) {
  dashboardDocumentSchema.parse(document);
  const db = database();
  const expectedVersion = and(
    eq(dashboards.id, document.id),
    eq(dashboards.updatedAt, expectedUpdatedAt),
  );
  await db.transaction(async (tx) => {
    const saved = await tx
      .update(dashboards)
      .set({ name: document.name, document, updatedAt: document.updatedAt })
      .where(expectedVersion)
      .returning({ id: dashboards.id });
    if (!saved.length)
      throw new ApiError(
        409,
        'dashboard_conflict',
        'This dashboard changed while saving. Reload it and retry your edit.',
      );
    // The update holds the row lock until the metric and dashboard commit together.
    if (libraryMetric) await tx.insert(libraryMetrics).values(libraryMetric);
  });
}

export function widgetById(document: DashboardDocument, widgetId: string) {
  const widget = dashboardWidgets(document).find((item) => item.id === widgetId);
  if (!widget) throw new ApiError(404, 'widget_not_found', 'Widget not found.');
  return widget;
}

// updated_at doubles as a version, so successful writes must advance it even in one millisecond.
export function nextDashboardTimestamp(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}
