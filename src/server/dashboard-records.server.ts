import { type DashboardDocument, dashboardDocumentSchema } from '#/domain/schema';
import { dashboards } from '#/db/schema';
import { eq } from 'drizzle-orm';
import { ApiError } from './errors';
import { database } from './database.server';

export async function persistDashboard(document: DashboardDocument) {
  dashboardDocumentSchema.parse(document);
  await database()
    .update(dashboards)
    .set({ name: document.name, document, updatedAt: document.updatedAt })
    .where(eq(dashboards.id, document.id));
}

export function widgetById(document: DashboardDocument, widgetId: string) {
  const widget = document.widgets.find((item) => item.id === widgetId);
  if (!widget) throw new ApiError(404, 'widget_not_found', 'Widget not found.');
  return widget;
}
