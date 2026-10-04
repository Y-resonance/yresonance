import { requireSession } from './auth.server';
import { dataSources, shareLinks, dashboards, dashboardGrants } from '#/db/schema';
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
import { remapWidgetDefinition, UnmatchedFieldsError } from '#/domain/remap';
import { recordProductMetric } from '#/observability';
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
import { persistDashboard, widgetById, nextDashboardTimestamp } from './dashboard-records.server';
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
  await insertDashboard(document);
  return document;
}

// Stores a new dashboard and grants its creator editor access in one batch.
async function insertDashboard(document: DashboardDocument) {
  await database().batch([
    database().insert(dashboards).values({
      id: document.id,
      workspaceId: document.workspaceId,
      name: document.name,
      document,
      createdBy: document.createdBy,
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
    }),
    database().insert(dashboardGrants).values({
      dashboardId: document.id,
      clerkUserId: document.createdBy,
      role: 'editor',
      grantedBy: document.createdBy,
      grantedAt: document.createdAt,
    }),
  ]);
}

/**
 * Copies a dashboard inside its workspace under a new name. `dataSourceMapping` points every
 * widget that uses a mapped datasource at its target, matching fields by canonical name. A single
 * unmatched field fails the whole copy and lists the gaps per widget, so no half-working copy is
 * stored. Share links and grants stay with the original; the caller becomes the only editor.
 */
export async function duplicateDashboard(
  request: Extract<ApiRequest, { action: 'duplicateDashboard' }>,
) {
  const original = await authorizeDashboard(request.dashboardId, 'editor');
  const session = original.session!;
  const workspaceId = original.document.workspaceId;
  const mapping = new Map(
    Object.entries(request.dataSourceMapping ?? {}).filter(([from, to]) => from !== to),
  );
  const targetIds = [...new Set(mapping.values())];
  if (targetIds.length) {
    const owned = await database()
      .select({ id: dataSources.id })
      .from(dataSources)
      .where(and(eq(dataSources.workspaceId, workspaceId), inArray(dataSources.id, targetIds)));
    if (owned.length !== targetIds.length)
      throw new ApiError(
        400,
        'invalid_datasource',
        'One or more target datasources do not belong to this workspace.',
      );
  }
  const usedIds = new Set(
    original.document.widgets.flatMap((widget) =>
      'dataSourceId' in widget.definition ? [widget.definition.dataSourceId] : [],
    ),
  );
  const unusedId = [...mapping.keys()].find((id) => !usedIds.has(id));
  if (unusedId)
    throw new ApiError(
      400,
      'invalid_datasource',
      `The dashboard does not use datasource ${unusedId}.`,
    );
  const metadata = new Map(
    await Promise.all(
      [...new Set([...mapping.keys(), ...targetIds])].map(
        async (id) => [id, await loadQueryMetadata(id, workspaceId)] as const,
      ),
    ),
  );

  // Remap every widget before failing, so one response lists all gaps.
  const unmatched: Array<{ widgetId: string; widget: string; canonicalNames: string[] }> = [];
  const remapped = original.document.widgets.map((widget) => {
    const from = 'dataSourceId' in widget.definition ? widget.definition.dataSourceId : undefined;
    const to = from && mapping.get(from);
    if (!from || !to) return { widget, remapped: false };
    try {
      const definition = remapWidgetDefinition(
        widget.definition,
        metadata.get(from)!,
        to,
        metadata.get(to)!,
      );
      // Default filter values belong to the original datasource, as when switching it in the builder.
      return {
        widget: {
          ...widget,
          definition:
            definition.type === 'control'
              ? { ...definition, defaultValues: undefined }
              : definition,
        },
        remapped: true,
      };
    } catch (error) {
      if (!(error instanceof UnmatchedFieldsError))
        throw new ApiError(
          400,
          'incompatible_datasource',
          `${widgetLabel(widget)}: ${error instanceof Error ? error.message : String(error)}`,
        );
      unmatched.push({
        widgetId: widget.id,
        widget: widgetLabel(widget),
        canonicalNames: error.canonicalNames,
      });
      return { widget, remapped: false };
    }
  });
  if (unmatched.length)
    throw new ApiError(
      400,
      'canonical_field_missing',
      `The target datasource is missing canonical fields for: ${unmatched
        .map((item) => `${item.widget} (${item.widgetId}): ${item.canonicalNames.join(', ')}`)
        .join('; ')}. Add or rename these fields on the target datasource and retry.`,
      unmatched,
    );
  const widgets = await Promise.all(
    remapped.map(async (item): Promise<DashboardWidget> => {
      const id = `widget_${crypto.randomUUID()}`;
      if (!item.remapped) return { ...item.widget, id };
      const { definition } = item.widget;
      try {
        await validateDefinition(original.document, definition);
      } catch (error) {
        if (!(error instanceof ApiError)) throw error;
        throw new ApiError(
          error.status,
          error.code,
          `${widgetLabel(item.widget)}: ${error.message}`,
        );
      }
      return { ...item.widget, id, definitionHash: await definitionHash(definition, workspaceId) };
    }),
  );
  const remappedCount = remapped.filter((item) => item.remapped).length;

  const now = new Date().toISOString();
  const document: DashboardDocument = {
    ...original.document,
    id: `dash_${crypto.randomUUID()}`,
    name: request.name,
    widgets,
    createdBy: session.userId,
    createdAt: now,
    updatedAt: now,
  };
  await insertDashboard(document);
  console.info('yresonance.dashboard_duplicate', {
    dashboardId: original.document.id,
    duplicateId: document.id,
    widgetCount: widgets.length,
    remappedWidgetCount: remappedCount,
    mapped: mapping.size > 0,
  });
  recordProductMetric('dashboard_duplicate', {
    labels: [mapping.size ? 'mapped' : 'plain'],
    numbers: [widgets.length, remappedCount],
    index: workspaceId,
  });
  return document;
}

export async function updateDashboard(request: Extract<ApiRequest, { action: 'updateDashboard' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  const updated = {
    ...access.document,
    name: request.name ?? access.document.name,
    timezone: request.timezone ?? access.document.timezone,
    defaultDateRange: request.defaultDateRange ?? access.document.defaultDateRange,
    updatedAt: nextDashboardTimestamp(access.row.updatedAt),
  };
  await persistDashboard(updated, access.row.updatedAt);
  return updated;
}

export async function deleteDashboard(dashboardId: string) {
  await authorizeDashboard(dashboardId, 'editor');
  await database().delete(dashboards).where(eq(dashboards.id, dashboardId));
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
    updatedAt: nextDashboardTimestamp(access.row.updatedAt),
  };
  await persistDashboard(updated, access.row.updatedAt);
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
    updatedAt: nextDashboardTimestamp(access.row.updatedAt),
  };
  const sql = await compiledSql(updated, widget);
  if (!request.libraryMetric) {
    await persistDashboard(updated, access.row.updatedAt);
    return { widget, compiledSql: sql };
  }

  await validateLibraryMetricInput(request.libraryMetric, access.session!);
  const libraryMetric = newLibraryMetricValues(request.libraryMetric, access.document.workspaceId);
  await persistDashboard(updated, access.row.updatedAt, libraryMetric);
  return { widget, libraryMetric, compiledSql: sql };
}

export async function removeWidget(request: Extract<ApiRequest, { action: 'removeWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  widgetById(access.document, request.widgetId);
  const updated = {
    ...access.document,
    widgets: access.document.widgets.filter((item) => item.id !== request.widgetId),
    updatedAt: nextDashboardTimestamp(access.row.updatedAt),
  };
  await persistDashboard(updated, access.row.updatedAt);
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
    updatedAt: nextDashboardTimestamp(access.row.updatedAt),
  };
  await persistDashboard(updated, access.row.updatedAt);
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
    updatedAt: nextDashboardTimestamp(access.row.updatedAt),
  };
  await persistDashboard(updated, access.row.updatedAt);
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
