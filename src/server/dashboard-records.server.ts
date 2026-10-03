import type { newLibraryMetricValues } from './formulas.server';
import { type DashboardDocument, dashboardDocumentSchema } from '#/domain/schema';
import { dashboards, libraryMetrics } from '#/db/schema';
import { and, eq, sql } from 'drizzle-orm';
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
  const update = db
    .update(dashboards)
    .set({ name: document.name, document, updatedAt: document.updatedAt })
    .where(expectedVersion)
    .returning({ id: dashboards.id });
  let saved;
  if (libraryMetric) {
    // Both statements run atomically. A stale snapshot inserts no metric and updates no dashboard.
    const [, updated] = await db.batch([
      db.insert(libraryMetrics).select(
        db
          .select({
            id: sql<string>`${libraryMetric.id}`.as('id'),
            workspaceId: sql<string>`${libraryMetric.workspaceId}`.as('workspaceId'),
            name: sql<string>`${libraryMetric.name}`.as('name'),
            canonicalName: sql<string>`${libraryMetric.canonicalName}`.as('canonicalName'),
            expression: sql<string>`${libraryMetric.expression}`.as('expression'),
            semanticType: sql<string>`${libraryMetric.semanticType}`.as('semanticType'),
            description: sql<string | null>`${libraryMetric.description}`.as('description'),
            updatedAt: sql<string>`${libraryMetric.updatedAt}`.as('updatedAt'),
          })
          .from(dashboards)
          .where(expectedVersion),
      ),
      update,
    ]);
    saved = updated;
  } else {
    saved = await update;
  }
  if (!saved.length)
    throw new ApiError(
      409,
      'dashboard_conflict',
      'This dashboard changed while saving. Reload it and retry your edit.',
    );
}

export function widgetById(document: DashboardDocument, widgetId: string) {
  const widget = document.widgets.find((item) => item.id === widgetId);
  if (!widget) throw new ApiError(404, 'widget_not_found', 'Widget not found.');
  return widget;
}

// updated_at doubles as a version, so successful writes must advance it even in one millisecond.
export function nextDashboardTimestamp(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous) + 1)).toISOString();
}
