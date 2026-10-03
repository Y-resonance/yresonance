import { loadDashboard } from './records.server';
import { and, eq, isNull, getTableColumns, sql } from 'drizzle-orm';
import { shareLinks, dashboardGrants, dashboards } from '#/db/schema';
import { ApiError } from './errors';
import { requireSession, type SessionContext } from './auth.server';
import { type DashboardDocument } from '#/domain/schema';
import { database } from './database.server';

export async function authorizeDashboard(
  id: string,
  required: 'viewer' | 'editor',
  shareToken?: string,
) {
  const loaded = await loadDashboard(id);
  if (shareToken) {
    const link = await database().query.shareLinks.findFirst({
      where: and(
        eq(shareLinks.token, shareToken),
        eq(shareLinks.dashboardId, id),
        isNull(shareLinks.revokedAt),
      ),
    });
    if (!link)
      throw new ApiError(
        403,
        'invalid_share_link',
        'This share link is invalid or has been revoked.',
      );
    if (required === 'editor')
      throw new ApiError(403, 'read_only_link', 'Share links are read-only.');
    return { ...loaded, role: 'viewer' as const, session: null };
  }
  const session = await requireSession();
  if (loaded.document.workspaceId !== session.workspace.id)
    throw new ApiError(404, 'dashboard_not_found', 'Dashboard not found.');
  if (session.isAdmin) return { ...loaded, role: 'admin' as const, session };
  const grant = await database().query.dashboardGrants.findFirst({
    where: and(
      eq(dashboardGrants.dashboardId, id),
      eq(dashboardGrants.clerkUserId, session.userId),
    ),
  });
  if (!grant || (required === 'editor' && grant.role !== 'editor'))
    throw new ApiError(
      403,
      'dashboard_access_denied',
      `You need ${required} access to this dashboard.`,
    );
  return { ...loaded, role: grant.role as 'editor' | 'viewer', session };
}

export async function visibleDashboardRows(session: SessionContext) {
  if (session.isAdmin)
    return database()
      .select({ ...getTableColumns(dashboards), role: sql<string>`'admin'` })
      .from(dashboards)
      .where(eq(dashboards.workspaceId, session.workspace.id));
  return database()
    .select({
      role: dashboardGrants.role,
      id: dashboards.id,
      workspaceId: dashboards.workspaceId,
      name: dashboards.name,
      document: dashboards.document,
      createdBy: dashboards.createdBy,
      createdAt: dashboards.createdAt,
      updatedAt: dashboards.updatedAt,
    })
    .from(dashboards)
    .innerJoin(dashboardGrants, eq(dashboardGrants.dashboardId, dashboards.id))
    .where(
      and(
        eq(dashboards.workspaceId, session.workspace.id),
        eq(dashboardGrants.clerkUserId, session.userId),
      ),
    );
}

export function dashboardUsesDataSource(dashboard: DashboardDocument, dataSourceId: string) {
  return dashboard.widgets.some(
    (widget) =>
      'dataSourceId' in widget.definition && widget.definition.dataSourceId === dataSourceId,
  );
}
