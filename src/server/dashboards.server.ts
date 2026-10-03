import { requireSession } from './auth.server';
import { dataSources, shareLinks, dashboards, dashboardGrants, libraryMetrics } from '#/db/schema';
import { eq, inArray, and, isNull } from 'drizzle-orm';
import { ApiError } from './errors';
import { type ApiRequest } from '#/api/contracts';
import {
  type DashboardDocument,
  defaultDateRange,
  type DashboardWidget,
  dashboardDocumentSchema,
  type WidgetDefinition,
} from '#/domain/schema';
import {
  appendPlacement,
  checkPlacement,
  validateLayoutUpdate,
  requiredCanvasRows,
} from '#/domain/layout';
import { placementMessage, layoutMessage, canvasRowsMessage } from '#/domain/layout-messages';
import { widgetLabel } from '#/domain/widget-label';
import { loadDataSource, loadQueryMetadata } from './records.server';
import { remapWidgetDefinition } from '#/domain/remap';
import { yearToDateRange } from '#/domain/dates';
import { seedPreviewWorkspace } from './preview-seed.server';
import { visibleDashboardRows, authorizeDashboard } from './dashboard-access.server';
import { database } from './database.server';
import {
  defaultControlState,
  validateDefinition,
  definitionHash,
  compiledSql,
} from './widget-queries.server';
import { sharingState } from './sharing.server';
import { persistDashboard, widgetById } from './dashboard-records.server';
import { validateLibraryMetricInput, newLibraryMetricValues } from './formulas.server';

export async function bootstrap() {
  const session = await requireSession();
  await seedPreviewWorkspace(session);
  const [dashboardRows, sourceRows] = await Promise.all([
    visibleDashboardRows(session),
    database()
      .select({ id: dataSources.id, name: dataSources.name })
      .from(dataSources)
      .where(eq(dataSources.workspaceId, session.workspace.id)),
  ]);
  return {
    userId: session.userId,
    workspace: { id: session.workspace.id, name: session.workspace.name },
    isAdmin: session.isAdmin,
    dashboards: dashboardRows.map((row) => ({
      ...summary(row),
      canEdit: session.isAdmin || row.role === 'editor',
    })),
    dataSources: sourceRows,
  };
}

export async function listDashboards() {
  const session = await requireSession();
  return (await visibleDashboardRows(session)).map(summary);
}

export async function getDashboard(id: string, shareToken?: string) {
  const access = await authorizeDashboard(id, 'viewer', shareToken);
  const referencedSourceIds = [
    ...new Set(
      access.document.widgets.flatMap((widget) =>
        'dataSourceId' in widget.definition ? [widget.definition.dataSourceId] : [],
      ),
    ),
  ];
  const sources =
    access.role === 'admin' || access.role === 'editor'
      ? await database()
          .select({ id: dataSources.id, name: dataSources.name })
          .from(dataSources)
          .where(eq(dataSources.workspaceId, access.document.workspaceId))
      : referencedSourceIds.length
        ? await database()
            .select({ id: dataSources.id, name: dataSources.name })
            .from(dataSources)
            .where(inArray(dataSources.id, referencedSourceIds))
        : [];
  return {
    dashboard: access.document,
    role: access.role,
    dataSources: sources,
    controlState: defaultControlState(access.document),
    ...(access.role === 'admin' || access.role === 'editor'
      ? { sharing: await sharingState(access.document.id) }
      : {}),
  };
}

export async function getSharedDashboard(shareToken: string) {
  const link = await database().query.shareLinks.findFirst({
    where: and(eq(shareLinks.token, shareToken), isNull(shareLinks.revokedAt)),
  });
  if (!link)
    throw new ApiError(
      404,
      'invalid_share_link',
      'This share link is invalid or has been revoked.',
    );
  return getDashboard(link.dashboardId, shareToken);
}

export async function createDashboard(request: Extract<ApiRequest, { action: 'createDashboard' }>) {
  const session = await requireSession();
  if (request.dataSourceIds.length) {
    const owned = await database()
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(
        and(
          eq(dataSources.workspaceId, session.workspace.id),
          inArray(dataSources.id, request.dataSourceIds),
        ),
      );
    if (owned.length !== new Set(request.dataSourceIds).size)
      throw new ApiError(
        400,
        'invalid_datasource',
        'One or more datasources do not belong to this workspace.',
      );
  }
  const now = new Date().toISOString();
  const id = `dash_${crypto.randomUUID()}`;
  const document: DashboardDocument = {
    id,
    workspaceId: session.workspace.id,
    name: request.name,
    schemaVersion: 2,
    timezone: request.timezone,
    defaultDateRange: request.defaultDateRange ?? defaultDateRange,
    columns: 12,
    canvasRows: 10,
    widgets: [],
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };
  await database().batch([
    database().insert(dashboards).values({
      id,
      workspaceId: session.workspace.id,
      name: request.name,
      document,
      createdBy: session.userId,
      createdAt: now,
      updatedAt: now,
    }),
    database().insert(dashboardGrants).values({
      dashboardId: id,
      clerkUserId: session.userId,
      role: 'editor',
      grantedBy: session.userId,
      grantedAt: now,
    }),
  ]);
  return document;
}

export async function updateDashboard(request: Extract<ApiRequest, { action: 'updateDashboard' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  const updated = {
    ...access.document,
    name: request.name ?? access.document.name,
    timezone: request.timezone ?? access.document.timezone,
    defaultDateRange: request.defaultDateRange ?? access.document.defaultDateRange,
    updatedAt: new Date().toISOString(),
  };
  await persistDashboard(updated);
  return updated;
}

export async function deleteDashboard(dashboardId: string) {
  await authorizeDashboard(dashboardId, 'editor');
  const db = database();
  // These tables have no cascading foreign keys. Remove access records in the same transaction.
  await db.batch([
    db.delete(shareLinks).where(eq(shareLinks.dashboardId, dashboardId)),
    db.delete(dashboardGrants).where(eq(dashboardGrants.dashboardId, dashboardId)),
    db.delete(dashboards).where(eq(dashboards.id, dashboardId)),
  ]);
  return { id: dashboardId, deleted: true };
}

export async function addWidget(request: Extract<ApiRequest, { action: 'addWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  const definition = withDateControlDefault(request.definition);
  assertSingleDateControl(access.document, definition);
  await validateDefinition(access.document, definition);
  const id = `widget_${crypto.randomUUID()}`;
  const widget: DashboardWidget = {
    id,
    layout: appendPlacement(
      access.document.widgets,
      request.width,
      request.height,
      access.document.columns,
    ),
    definition,
    definitionHash: await definitionHash(definition, access.document.workspaceId),
  };
  const updated = {
    ...access.document,
    widgets: [...access.document.widgets, widget],
    canvasRows: Math.max(access.document.canvasRows, widget.layout.y + widget.layout.height + 2),
    updatedAt: new Date().toISOString(),
  };
  await persistDashboard(updated);
  return { widget, compiledSql: await compiledSql(updated, widget) };
}

export async function updateWidget(request: Extract<ApiRequest, { action: 'updateWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  const existing = widgetById(access.document, request.widgetId);
  const definition = withDateControlDefault(request.definition);
  assertSingleDateControl(access.document, definition, existing.id);
  await validateDefinition(access.document, definition);
  const widget = {
    ...existing,
    definition,
    definitionHash: await definitionHash(definition, access.document.workspaceId),
  };
  const updated = {
    ...access.document,
    widgets: access.document.widgets.map((item) => (item.id === widget.id ? widget : item)),
    updatedAt: new Date().toISOString(),
  };
  const sql = await compiledSql(updated, widget);
  if (!request.libraryMetric) {
    await persistDashboard(updated);
    return { widget, compiledSql: sql };
  }

  await validateLibraryMetricInput(request.libraryMetric, access.session!);
  const libraryMetric = newLibraryMetricValues(request.libraryMetric, access.document.workspaceId);
  dashboardDocumentSchema.parse(updated);
  const db = database();
  await db.batch([
    db
      .update(dashboards)
      .set({ name: updated.name, document: updated, updatedAt: updated.updatedAt })
      .where(eq(dashboards.id, updated.id)),
    db.insert(libraryMetrics).values(libraryMetric),
  ]);
  return { widget, libraryMetric, compiledSql: sql };
}

export async function removeWidget(request: Extract<ApiRequest, { action: 'removeWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  widgetById(access.document, request.widgetId);
  const updated = {
    ...access.document,
    widgets: access.document.widgets.filter((item) => item.id !== request.widgetId),
    updatedAt: new Date().toISOString(),
  };
  await persistDashboard(updated);
  return updated;
}

export async function moveWidget(request: Extract<ApiRequest, { action: 'moveWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  const existing = widgetById(access.document, request.widgetId);
  const check = checkPlacement(
    access.document.widgets,
    request.placement,
    access.document.columns,
    existing.id,
  );
  if (!check.ok)
    throw new ApiError(400, 'invalid_placement', placementMessage(check, widgetLabel(existing)));
  const updatedWidget = { ...existing, layout: request.placement };
  const updated = {
    ...access.document,
    widgets: access.document.widgets.map((widget) =>
      widget.id === existing.id ? updatedWidget : widget,
    ),
    canvasRows: Math.max(
      access.document.canvasRows,
      request.placement.y + request.placement.height,
    ),
    updatedAt: new Date().toISOString(),
  };
  await persistDashboard(updated);
  return updatedWidget;
}

export async function updateLayout(request: Extract<ApiRequest, { action: 'updateLayout' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  const validation = validateLayoutUpdate(
    access.document.widgets,
    request.placements,
    access.document.columns,
  );
  if (!validation.ok)
    throw new ApiError(400, 'invalid_layout', layoutMessage(validation, access.document.widgets));
  const placements = new Map(
    request.placements.map((update) => [update.widgetId, update.placement]),
  );
  const widgets = access.document.widgets.map((widget) => ({
    ...widget,
    layout: placements.get(widget.id)!,
  }));
  if (request.canvasRows < requiredCanvasRows(widgets))
    throw new ApiError(400, 'invalid_layout', canvasRowsMessage(widgets, request.canvasRows));
  const updated = {
    ...access.document,
    widgets,
    canvasRows: request.canvasRows,
    updatedAt: new Date().toISOString(),
  };
  await persistDashboard(updated);
  return updated;
}

export async function copyWidget(request: Extract<ApiRequest, { action: 'copyWidget' }>) {
  const target = await authorizeDashboard(request.dashboardId, 'editor');
  const source = await authorizeDashboard(request.fromDashboardId, 'viewer');
  const original = widgetById(source.document, request.widgetId);
  let definition = original.definition;
  if ('dataSourceId' in original.definition) {
    const sourceDataSource = await loadDataSource(
      original.definition.dataSourceId,
      source.document.workspaceId,
    );
    const targetDataSource = await loadDataSource(
      request.targetDataSourceId ?? original.definition.dataSourceId,
      target.document.workspaceId,
    );
    if (sourceDataSource.id !== targetDataSource.id) {
      const [sourceMetadata, targetMetadata] = await Promise.all([
        loadQueryMetadata(sourceDataSource.id, source.document.workspaceId),
        loadQueryMetadata(targetDataSource.id, target.document.workspaceId),
      ]);
      try {
        definition = remapWidgetDefinition(
          original.definition,
          sourceMetadata,
          targetDataSource.id,
          targetMetadata,
        );
      } catch (error) {
        throw new ApiError(
          400,
          'canonical_field_missing',
          error instanceof Error ? error.message : 'The target datasource is not compatible.',
        );
      }
    }
  }
  return addWidget({
    action: 'addWidget',
    dashboardId: target.document.id,
    definition,
    width: original.layout.width,
    height: original.layout.height,
  });
}

function summary(row: { id: string; name: string; document: unknown; updatedAt: string }) {
  const document = dashboardDocumentSchema.parse(row.document);
  return {
    id: row.id,
    name: row.name,
    widgetCount: document.widgets.length,
    dataSourceIds: [
      ...new Set(
        document.widgets.flatMap((widget) =>
          'dataSourceId' in widget.definition ? [widget.definition.dataSourceId] : [],
        ),
      ),
    ],
    updatedAt: row.updatedAt,
  };
}

function assertSingleDateControl(
  document: DashboardDocument,
  definition: WidgetDefinition,
  replacingWidgetId?: string,
) {
  if (
    definition.type === 'dateControl' &&
    document.widgets.some(
      (widget) => widget.id !== replacingWidgetId && widget.definition.type === 'dateControl',
    )
  )
    throw new ApiError(
      400,
      'date_control_exists',
      'A dashboard can contain only one date control.',
    );
}

function withDateControlDefault(definition: WidgetDefinition): WidgetDefinition {
  return definition.type === 'dateControl' && !definition.defaultDateRange
    ? { ...definition, defaultDateRange: yearToDateRange }
    : definition;
}
