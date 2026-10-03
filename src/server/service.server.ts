import { clerkClient } from '@clerk/tanstack-react-start/server';
import { and, count, eq, getTableColumns, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import type { ApiRequest } from '#/api/contracts';
import { createDatabase } from '#/db/client';
import {
  deleteSourceObject,
  listSourceObjects,
  localSourceUrl,
  prepareSourceUpload,
} from '#/data/source.server';
import previewExample from '../../.generated/preview-example.json';
import { capabilityUrl, createR2Capability } from '#/data/internal-r2';
import {
  DatasourceError,
  DUCKDB_FILE_CONNECTOR,
  type DatasourceExpression,
} from '#/data/connectors/contract';
import { datasourceConnector } from '#/data/connectors/index.server';
import {
  calculatedFields,
  dashboardGrants,
  dashboards,
  dataSources,
  datasourceUploads,
  fields,
  ingestionTokens,
  libraryMetrics,
  shareLinks,
  workspaces,
} from '#/db/schema';
import {
  controlStateSchema,
  dashboardDocumentSchema,
  defaultDateRange,
  type ControlState,
  type DashboardDocument,
  type DashboardWidget,
  type WidgetDefinition,
} from '#/domain/schema';
import {
  appendPlacement,
  checkPlacement,
  requiredCanvasRows,
  validateLayoutUpdate,
} from '#/domain/layout';
import { widgetLabel } from '#/domain/widget-label';
import { canvasRowsMessage, layoutMessage, placementMessage } from '#/domain/layout-messages';
import { canUpdateFieldMetadata, detectFieldSemantics } from '#/domain/field-metadata';
import { hashJson } from '#/domain/hash';
import { comparisonDateRange, resolveDateRange, yearToDateRange } from '#/domain/dates';
import { dateBucketTarget, resolveDateGranularity } from '#/domain/date-granularity';
import { queryCacheState, widgetDependencyState } from '#/domain/cache';
import { queryResultColumns } from '#/domain/query-result';
import { remapWidgetDefinition } from '#/domain/remap';
import {
  controlDefaultValues,
  mergeControlState,
  singleValueControlWithMultipleSelections,
} from '#/domain/control-state';
import { alignDateComparisonRows } from '#/domain/widget-results';
import { isWorkspaceR2Key, scopedR2Prefix } from '#/domain/tenancy';
import {
  createDatasourceUploadCleanupToken,
  dataSourceLocationReferencesKey,
  datasourcePrefixOverlapsManagedUploads,
  isManagedDatasourceUpload,
  MAX_DATASOURCE_FILE_BYTES,
  verifyDatasourceUploadCleanupToken,
} from '#/domain/datasource-upload';
import { ingestCsv } from '#/query/duckdb.server';
import {
  assertCalculatedFieldNameAvailable,
  validateAggregateFormula,
  validateRowFormula,
} from '#/query/compiler';
import { recordProductMetric } from '#/observability';
import type { DataSourceRecord } from '#/query/types';
import { requireSession, type SessionContext } from './auth.server';
import { ApiError } from './errors';
import { loadDashboard, loadDataSource, loadQueryMetadata } from './records.server';

const database = () => createDatabase(env.DB);
const UPLOAD_CLAIM_LEASE_MS = 60 * 60 * 1000;

export async function executeRequest(request: ApiRequest): Promise<unknown> {
  const startedAt = Date.now();
  try {
    const result = await dispatchRequest(request);
    console.info('rundown.request', {
      action: request.action,
      result: 'success',
      durationMs: Date.now() - startedAt,
      ...safeRequestIdentifiers(request),
    });
    recordLatency(request.action, 'success', Date.now() - startedAt);
    return result;
  } catch (error) {
    console.warn('rundown.request', {
      action: request.action,
      result: 'error',
      durationMs: Date.now() - startedAt,
      errorCode: error instanceof ApiError ? error.code : 'unexpected_error',
      ...safeRequestIdentifiers(request),
    });
    recordLatency(request.action, 'error', Date.now() - startedAt);
    throw error;
  }
}

async function dispatchRequest(request: ApiRequest): Promise<unknown> {
  switch (request.action) {
    case 'bootstrap':
      return bootstrap();
    case 'listDashboards':
      return listDashboards();
    case 'getDashboard':
      return getDashboard(request.dashboardId, request.shareToken);
    case 'getSharedDashboard':
      return getSharedDashboard(request.shareToken);
    case 'createDashboard':
      return createDashboard(request);
    case 'updateDashboard':
      return updateDashboard(request);
    case 'deleteDashboard':
      return deleteDashboard(request.dashboardId);
    case 'addWidget':
      return addWidget(request);
    case 'updateWidget':
      return updateWidget(request);
    case 'removeWidget':
      return removeWidget(request);
    case 'moveWidget':
      return moveWidget(request);
    case 'updateLayout':
      return updateLayout(request);
    case 'copyWidget':
      return copyWidget(request);
    case 'previewWidget':
      return previewWidget(request);
    case 'queryWidget':
      return queryWidget(
        request.dashboardId,
        request.widgetId,
        request.controlState,
        request.shareToken,
        request.page,
      );
    case 'explainWidget':
      return explainWidget(request.dashboardId, request.widgetId, request.shareToken);
    case 'getControlOptions':
      return getControlOptions(
        request.dashboardId,
        request.controlId,
        request.search,
        request.shareToken,
      );
    case 'listDataSources':
      return listDataSources();
    case 'listLibraryMetrics':
      return listLibraryMetrics();
    case 'describeDatasource':
      return describeDatasource(request.dataSourceId, request.dashboardId, request.shareToken);
    case 'listR2Objects':
      return listR2Objects(request.prefix, request.cursor);
    case 'prepareDatasourceUpload':
      return prepareDatasourceUpload(request);
    case 'removeDatasourceUpload':
      return removeDatasourceUpload(request);
    case 'trackDatasourceUpload':
      return trackDatasourceUpload(request);
    case 'registerDatasource':
      return registerDatasource(request);
    case 'updateFieldMetadata':
      return updateFieldMetadata(request);
    case 'upsertCalculatedField':
      return upsertCalculatedField(request);
    case 'validateCalculatedField':
      return validateCalculatedField(request);
    case 'previewCalculatedFieldValues':
      return previewCalculatedFieldValues(request);
    case 'validateMetricExpression':
      return validateMetricExpression(request);
    case 'upsertLibraryMetric':
      return upsertLibraryMetric(request);
    case 'shareDashboard':
      return shareDashboard(request);
  }
}

async function bootstrap() {
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

async function listDashboards() {
  const session = await requireSession();
  return (await visibleDashboardRows(session)).map(summary);
}

async function getDashboard(id: string, shareToken?: string) {
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

async function getSharedDashboard(shareToken: string) {
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

async function createDashboard(request: Extract<ApiRequest, { action: 'createDashboard' }>) {
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

async function updateDashboard(request: Extract<ApiRequest, { action: 'updateDashboard' }>) {
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

async function deleteDashboard(dashboardId: string) {
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

async function addWidget(request: Extract<ApiRequest, { action: 'addWidget' }>) {
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

async function updateWidget(request: Extract<ApiRequest, { action: 'updateWidget' }>) {
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

async function removeWidget(request: Extract<ApiRequest, { action: 'removeWidget' }>) {
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

async function moveWidget(request: Extract<ApiRequest, { action: 'moveWidget' }>) {
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

async function updateLayout(request: Extract<ApiRequest, { action: 'updateLayout' }>) {
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

async function copyWidget(request: Extract<ApiRequest, { action: 'copyWidget' }>) {
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

async function previewWidget(request: Extract<ApiRequest, { action: 'previewWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  await validateDefinition(access.document, request.definition);
  return runDefinition(
    access.document,
    request.definition,
    request.controlState ?? {},
    request.width,
  );
}

async function queryWidget(
  dashboardId: string,
  widgetId: string,
  state: ControlState | undefined,
  shareToken?: string,
  page = 0,
) {
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  const widget = widgetById(access.document, widgetId);
  const defaults = defaultControlState(access.document);
  const controlState = validateControlState(access.document, mergeControlState(defaults, state));
  if (!compilesToQuery(widget.definition)) return { rows: [], controlState };
  const dataSource = await loadDataSource(
    widget.definition.dataSourceId,
    access.document.workspaceId,
  );
  const connector = connectorFor(dataSource);
  const metadata = await loadQueryMetadata(dataSource.id, access.document.workspaceId);
  const columns = queryResultColumns(widget.definition, metadata);
  const resolvedControls = await resolveControls(
    access.document,
    widget.definition,
    [...metadata.fields, ...metadata.calculatedFields],
    controlState,
  );
  const dateRange = controlState.dateRange ?? access.document.defaultDateRange;
  const resolvedDateRange = resolveDateRange(dateRange, access.document.timezone);
  const bucketTarget = dateBucketTarget(widget.layout.width);
  const comparisonGranularity = resolvedWidgetDateGranularity(
    widget.definition,
    metadata,
    resolvedDateRange,
    bucketTarget,
  );
  const resolvedControlState: ControlState = {
    ...controlState,
    dateRange: {
      startDate: { fixed: resolvedDateRange.start },
      endDate: { fixed: resolvedDateRange.end },
    },
  };
  const currentDefinitionHash = await hashJson(widgetDependencyState(widget.definition, metadata));
  const pageSize =
    widget.definition.type === 'table' && widget.definition.resultLimit.mode === 'pagination'
      ? widget.definition.resultLimit.amount
      : undefined;
  const cacheKey = await hashJson({
    ...queryCacheState({
      definitionHash: currentDefinitionHash,
      requestedDateRange: dateRange,
      resolvedDateRange,
      resolvedControls: normalize(resolvedControls),
      dataSourceConnector: connector.type,
      dataSourceVersion: dataSource.version,
      timezone: access.document.timezone,
      dateBucketTarget: bucketTarget,
    }),
    page: pageSize === undefined ? 0 : page,
  });
  const cached = await env.QUERY_CACHE.get(cacheKey, 'json');
  if (cached) {
    console.info('rundown.query_cache', { dashboardId, widgetId, outcome: 'hit' });
    return { ...(cached as object), columns, cache: 'hit' };
  }
  console.info('rundown.query_cache', { dashboardId, widgetId, outcome: 'miss' });
  const run = (
    queryControlState: ControlState,
    queryDefinition: WidgetDefinition,
    offset?: number,
  ) =>
    datasourceOperation(() =>
      connector.executeQuery<Record<string, unknown>>(dataSource, {
        kind: 'widget',
        dashboard: access.document,
        definition: queryDefinition,
        metadata,
        controlState: queryControlState,
        resolvedControls,
        offset,
        dateBucketTarget: bucketTarget,
      }),
    );
  const comparison = widgetComparison(widget.definition);
  const pageOffset = pageSize === undefined ? undefined : page * pageSize;
  const [rows, comparisonRows] = await Promise.all([
    run(resolvedControlState, widget.definition, pageOffset),
    comparison
      ? run(
          {
            ...resolvedControlState,
            dateRange: comparisonDateRange(
              resolvedControlState.dateRange!,
              comparison,
              access.document.timezone,
            ),
          },
          widget.definition,
          pageOffset,
        )
      : Promise.resolve(undefined),
  ]);
  const alignedComparisonRows =
    comparisonRows && comparison && hasDateDimension(widget.definition, metadata)
      ? alignDateComparisonRows(
          comparisonRows,
          comparison,
          resolvedDateRange,
          comparisonGranularity,
        )
      : comparisonRows;
  const hasMore = pageSize !== undefined && rows.length > pageSize;
  const result = {
    rows: normalize(pageSize === undefined ? rows : rows.slice(0, pageSize)),
    columns,
    ...(alignedComparisonRows
      ? {
          comparisonRows: normalize(
            pageSize === undefined
              ? alignedComparisonRows
              : alignedComparisonRows.slice(0, pageSize),
          ),
        }
      : {}),
    controlState,
    cache: 'miss',
    ...(pageSize === undefined ? {} : { page, hasMore }),
  };
  await env.QUERY_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: 86_400 });
  return result;
}

async function explainWidget(dashboardId: string, widgetId: string, shareToken?: string) {
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  const widget = widgetById(access.document, widgetId);
  if (!compilesToQuery(widget.definition)) return { sql: null, definitions: [] };
  const dataSource = await loadDataSource(
    widget.definition.dataSourceId,
    access.document.workspaceId,
  );
  const metadata = await loadQueryMetadata(dataSource.id, access.document.workspaceId);
  const explanation = await datasourceOperation(() =>
    connectorFor(dataSource).explainQuery(dataSource, {
      kind: 'widget',
      dashboard: access.document,
      definition: widget.definition,
      metadata,
      controlState: {},
      dateBucketTarget: dateBucketTarget(widget.layout.width),
    }),
  );
  const calculatedDefinitions = metadata.calculatedFields
    .filter((field) => definitionFieldIds(widget.definition).includes(field.id))
    .map((field) => ({
      name: field.label,
      expression: field.expression,
      description: field.description,
    }));
  return {
    sql: explanation.sql,
    definitions: [...calculatedDefinitions, ...explanation.definitions],
  };
}

async function getControlOptions(
  dashboardId: string,
  controlId: string,
  search: string | undefined,
  shareToken?: string,
) {
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  const control = widgetById(access.document, controlId);
  if (control.definition.type !== 'control')
    throw new ApiError(400, 'not_a_control', 'The selected widget is not a filter control.');
  const controlDefinition = control.definition;
  const dataSource = await loadDataSource(
    controlDefinition.dataSourceId,
    access.document.workspaceId,
  );
  const metadata = await loadQueryMetadata(dataSource.id, access.document.workspaceId);
  const field =
    metadata.fields.find((item) => item.id === controlDefinition.fieldId) ??
    metadata.calculatedFields.find((item) => item.id === controlDefinition.fieldId);
  if (!field) throw new ApiError(400, 'unknown_field', 'The control field no longer exists.');
  const direction = controlDefinition.optionsSortDirection === 'desc' ? 'DESC' : 'ASC';
  const rows = await datasourceOperation(() =>
    connectorFor(dataSource).executeQuery<{ value: unknown }>(dataSource, {
      kind: 'controlOptions',
      field,
      metadata,
      search,
      direction,
    }),
  );
  return { values: rows.map((row) => normalize(row.value)) };
}

async function listDataSources() {
  const session = await requireSession();
  await seedPreviewWorkspace(session);
  const db = database();
  const workspace = eq(dataSources.workspaceId, session.workspace.id);
  const [sourceRows, rawCounts, calculatedCounts] = await Promise.all([
    db.select().from(dataSources).where(workspace),
    // Hidden fields are excluded so the count matches what the detail page lists.
    db
      .select({ dataSourceId: fields.dataSourceId, total: count() })
      .from(fields)
      .where(and(eq(fields.workspaceId, session.workspace.id), eq(fields.hidden, false)))
      .groupBy(fields.dataSourceId),
    db
      .select({ dataSourceId: calculatedFields.dataSourceId, total: count() })
      .from(calculatedFields)
      .where(eq(calculatedFields.workspaceId, session.workspace.id))
      .groupBy(calculatedFields.dataSourceId),
  ]);
  const totals = new Map<string, number>();
  for (const row of [...rawCounts, ...calculatedCounts])
    totals.set(row.dataSourceId, (totals.get(row.dataSourceId) ?? 0) + row.total);
  return sourceRows.map((row) => ({ ...row, fieldCount: totals.get(row.id) ?? 0 }));
}

async function listLibraryMetrics() {
  const session = await requireSession();
  return database()
    .select()
    .from(libraryMetrics)
    .where(eq(libraryMetrics.workspaceId, session.workspace.id));
}

async function describeDatasource(dataSourceId: string, dashboardId?: string, shareToken?: string) {
  const workspaceId = shareToken
    ? await sharedDatasourceWorkspace(dataSourceId, dashboardId, shareToken)
    : (await requireSession()).workspace.id;
  const dataSource = await loadDataSource(dataSourceId, workspaceId);
  const metadata = await loadQueryMetadata(dataSource.id, workspaceId);
  const applicableMetrics = [];
  for (const metric of metadata.libraryMetrics) {
    if (
      await datasourceOperation(() =>
        libraryMetricApplies(dataSource, {
          kind: 'libraryMetric',
          expression: metric.expression,
          semanticType: metric.semanticType,
          metadata,
        }),
      )
    )
      applicableMetrics.push(metric);
  }
  return {
    ...dataSource,
    fields: metadata.fields.filter((field) => !field.hidden),
    calculatedFields: metadata.calculatedFields,
    libraryMetrics: applicableMetrics,
  };
}

async function sharedDatasourceWorkspace(
  dataSourceId: string,
  dashboardId: string | undefined,
  shareToken: string,
) {
  if (!dashboardId)
    throw new ApiError(400, 'dashboard_required', 'Shared datasource access needs a dashboard.');
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  const referenced = access.document.widgets.some(
    (widget) =>
      'dataSourceId' in widget.definition && widget.definition.dataSourceId === dataSourceId,
  );
  if (!referenced)
    throw new ApiError(
      403,
      'datasource_access_denied',
      'The datasource is not used by this dashboard.',
    );
  return access.document.workspaceId;
}

async function listR2Objects(prefix?: string, cursor?: string) {
  const session = await requireSession();
  const safePrefix = scopedR2Prefix(session.workspace.r2Prefix, prefix);
  if (!safePrefix)
    throw new ApiError(400, 'invalid_r2_prefix', 'R2 prefixes cannot contain traversal segments.');
  return listSourceObjects(safePrefix, cursor);
}

async function prepareDatasourceUpload(
  request: Extract<ApiRequest, { action: 'prepareDatasourceUpload' }>,
) {
  const session = await requireSession();
  const upload = await prepareSourceUpload(session.workspace.r2Prefix, request.format);
  const cleanupToken = await createDatasourceUploadCleanupToken(
    upload.key,
    session.userId,
    uploadCleanupSecret(),
  );
  const now = new Date().toISOString();
  await database().insert(datasourceUploads).values({
    key: upload.key,
    workspaceId: session.workspace.id,
    clerkUserId: session.userId,
    status: 'pending',
    claimId: null,
    createdAt: now,
    updatedAt: now,
  });
  return {
    ...upload,
    cleanupToken,
  };
}

async function removeDatasourceUpload(
  request: Extract<ApiRequest, { action: 'removeDatasourceUpload' }>,
) {
  const session = await requireSession();
  if (!isManagedDatasourceUpload(session.workspace.r2Prefix, request.key))
    throw new ApiError(400, 'invalid_upload_key', 'Only Rundown uploads can be removed here.');
  if (
    !(await verifyDatasourceUploadCleanupToken(
      request.cleanupToken,
      request.key,
      session.userId,
      uploadCleanupSecret(),
    ))
  )
    throw new ApiError(403, 'invalid_cleanup_token', 'This upload cannot be removed by this user.');
  const claimId = crypto.randomUUID();
  const claimedRemoval = await database()
    .update(datasourceUploads)
    .set({ status: 'removing', claimId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, request.key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        claimableUploadStatus(),
      ),
    )
    .returning({ key: datasourceUploads.key });
  if (!claimedRemoval.length)
    throw new ApiError(409, 'upload_not_pending', 'This upload is not available for removal.');
  try {
    if (await isDatasourceObjectRegistered(session.workspace.id, request.key)) {
      await deleteUploadState(session, request.key, 'removing', claimId);
      throw new ApiError(
        409,
        'upload_in_use',
        'This file belongs to a registered datasource and cannot be removed.',
      );
    }
    await renewUploadClaim(session, request.key, 'removing', claimId);
    await deleteSourceObject(request.key);
    await deleteUploadState(session, request.key, 'removing', claimId);
  } catch (error) {
    await restorePendingUpload(session, request.key, 'removing', claimId);
    throw error;
  }
  return { removed: true };
}

async function trackDatasourceUpload(
  request: Extract<ApiRequest, { action: 'trackDatasourceUpload' }>,
) {
  const session = await requireSession();
  console.info('rundown.datasource_upload', {
    event: request.event,
    fileSize: request.fileSize,
    format: request.format,
    durationMs: request.durationMs,
    role: session.isAdmin ? 'admin' : 'editor',
  });
  return { tracked: true };
}

async function registerDatasource(request: Extract<ApiRequest, { action: 'registerDatasource' }>) {
  const session = await requireSession();
  if (!isWorkspaceR2Key(session.workspace.r2Prefix, request.location.key))
    throw new ApiError(
      400,
      'invalid_r2_prefix',
      `Datasource keys must start with ${session.workspace.r2Prefix}.`,
    );
  if (
    request.location.kind === 'prefix' &&
    datasourcePrefixOverlapsManagedUploads(session.workspace.r2Prefix, request.location.key)
  )
    throw new ApiError(
      400,
      'managed_upload_prefix_not_allowed',
      'Prefixes cannot include Rundown-managed uploads.',
    );
  const managedUploadKey =
    request.location.kind === 'object' &&
    isManagedDatasourceUpload(session.workspace.r2Prefix, request.location.key)
      ? request.location.key
      : undefined;
  if (
    managedUploadKey &&
    !managedUploadKey.toLocaleLowerCase('en-US').endsWith(`.${request.location.format}`)
  )
    throw new ApiError(
      400,
      'invalid_upload_format',
      `Managed ${request.location.format} uploads need a .${request.location.format} key.`,
    );
  const claimId = managedUploadKey
    ? await claimPendingUpload(session, managedUploadKey, request.cleanupToken)
    : undefined;
  let convertedKey: string | undefined;
  try {
    const connector = connectorFor(DUCKDB_FILE_CONNECTOR);
    const location =
      managedUploadKey && request.location.format === 'csv'
        ? await ingestManagedCsvUpload(session, managedUploadKey).then((converted) => {
            convertedKey = converted.key;
            return converted.location;
          })
        : request.location;
    const pendingDataSource: Omit<DataSourceRecord, 'version'> = {
      id: `ds_${crypto.randomUUID()}`,
      workspaceId: session.workspace.id,
      name: request.name,
      connectorType: connector.type,
      location,
    };
    const inspection = await datasourceOperation(() =>
      connector.inspect(pendingDataSource, {
        ...(managedUploadKey ? { maximumObjectBytes: MAX_DATASOURCE_FILE_BYTES } : {}),
      }),
    );
    const dataSource: DataSourceRecord = {
      ...pendingDataSource,
      version: inspection.version,
    };
    const discovered = inspection.description.map((column) =>
      seedField(dataSource.id, column, inspection.samples),
    );
    const now = new Date().toISOString();
    const db = database();
    if (managedUploadKey && claimId)
      await renewUploadClaim(session, managedUploadKey, 'registering', claimId);
    const uploadCompletion =
      managedUploadKey && claimId
        ? [
            db
              .delete(datasourceUploads)
              .where(
                and(
                  eq(datasourceUploads.key, managedUploadKey),
                  eq(datasourceUploads.claimId, claimId),
                  eq(datasourceUploads.status, 'registering'),
                ),
              ),
          ]
        : [];
    await db.batch([
      db.insert(dataSources).values({
        id: dataSource.id,
        workspaceId: dataSource.workspaceId,
        name: dataSource.name,
        connectorType: dataSource.connectorType,
        location: dataSource.location,
        version: dataSource.version,
        createdAt: now,
        updatedAt: now,
      }),
      ...discovered.map((field) =>
        db.insert(fields).values({ ...field, workspaceId: session.workspace.id }),
      ),
      ...uploadCompletion,
    ]);
    if (convertedKey && managedUploadKey)
      await deleteSourceObject(managedUploadKey).catch((error: unknown) => {
        console.warn('rundown.datasource_ingestion_cleanup_failed', {
          workspaceId: session.workspace.id,
          sourceKey: managedUploadKey,
          error: error instanceof Error ? error.message : 'Unknown cleanup error.',
        });
      });
    return { ...dataSource, fields: discovered };
  } catch (error) {
    if (convertedKey) await deleteSourceObject(convertedKey).catch(() => undefined);
    if (managedUploadKey && claimId)
      await restorePendingUpload(session, managedUploadKey, 'registering', claimId);
    throw error;
  }
}

// Requests in one isolate share the import; D1 coordinates claims between isolates.
const previewSeeds = new Map<string, Promise<void>>();

async function seedPreviewWorkspace(session: SessionContext) {
  if (env.APP_ENV !== 'preview' || session.workspace.previewSeededAt) return;
  const workspaceId = session.workspace.id;
  const pending = previewSeeds.get(workspaceId);
  if (pending) return pending;
  const seed = importPreviewExample(session);
  previewSeeds.set(workspaceId, seed);
  try {
    await seed;
  } finally {
    previewSeeds.delete(workspaceId);
  }
}

async function importPreviewExample(session: SessionContext) {
  const db = database();
  const workspaceId = session.workspace.id;
  const waitDeadline = Date.now() + 2 * 60 * 1000;
  let claim: string;
  while (true) {
    claim = new Date().toISOString();
    // Engine requests time out after 40 seconds. An hour allows recovery after a Worker crash.
    const expired = new Date(Date.now() - UPLOAD_CLAIM_LEASE_MS).toISOString();
    const claimed = await db
      .update(workspaces)
      .set({ previewSeedClaimedAt: claim })
      .where(
        and(
          eq(workspaces.id, workspaceId),
          isNull(workspaces.previewSeededAt),
          or(isNull(workspaces.previewSeedClaimedAt), lt(workspaces.previewSeedClaimedAt, expired)),
        ),
      )
      .returning({ id: workspaces.id });
    if (claimed.length) break;
    const current = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
    if (current?.previewSeededAt) return;
    if (Date.now() >= waitDeadline)
      throw new ApiError(
        503,
        'preview_seed_pending',
        'Example data is still being prepared. Try again shortly.',
      );
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  // Each attempt owns its object, including cleanup after a failed registration.
  const destinationKey = `${session.workspace.r2Prefix}examples/${crypto.randomUUID()}.parquet`;
  const startedAt = Date.now();
  try {
    const bytes = Uint8Array.from(atob(previewExample.parquet), (character) =>
      character.charCodeAt(0),
    );
    const object = await env.DATA.put(destinationKey, bytes, {
      httpMetadata: { contentType: 'application/vnd.apache.parquet' },
    });
    if (!object) throw new Error('Could not store the preview example.');
    const uploadedAt = Date.now();
    const existingNames = new Set(
      (
        await db
          .select({ name: dataSources.name })
          .from(dataSources)
          .where(eq(dataSources.workspaceId, workspaceId))
      ).map((source) => source.name),
    );
    let name = 'Example campaign data';
    for (let suffix = 2; existingNames.has(name); suffix++)
      name = `Example campaign data ${suffix}`;
    const id = `ds_${crypto.randomUUID()}`;
    const version = await hashJson([[destinationKey, object.etag]]);
    const now = new Date().toISOString();
    const discovered = previewExample.description.map((column) =>
      seedField(id, column, previewExample.samples),
    );
    await db.batch([
      db.insert(dataSources).values({
        id,
        workspaceId,
        name,
        connectorType: DUCKDB_FILE_CONNECTOR,
        location: { kind: 'object', key: destinationKey, format: 'parquet' },
        version,
        createdAt: now,
        updatedAt: now,
      }),
      ...discovered.map((field) => db.insert(fields).values({ ...field, workspaceId })),
      db
        .update(workspaces)
        .set({ previewSeededAt: now, previewSeedClaimedAt: null })
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.previewSeedClaimedAt, claim))),
    ]);
    console.info('rundown.preview_seed_prepared', {
      workspaceId,
      exampleEndDate: previewExample.endDate,
      uploadDurationMs: uploadedAt - startedAt,
      registrationDurationMs: Date.now() - uploadedAt,
    });
  } catch (error) {
    await deleteSourceObject(destinationKey).catch(() => undefined);
    await db
      .update(workspaces)
      .set({ previewSeedClaimedAt: null })
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.previewSeedClaimedAt, claim)));
    console.warn('rundown.preview_seed', { workspaceId, result: 'error', error });
    recordProductMetric('preview_seed', { labels: ['error'], index: workspaceId });
    throw error;
  }
  console.info('rundown.preview_seed', {
    workspaceId,
    result: 'success',
    durationMs: Date.now() - startedAt,
  });
  recordProductMetric('preview_seed', {
    labels: ['success'],
    numbers: [Date.now() - startedAt],
    index: workspaceId,
  });
}

async function ingestManagedCsvUpload(session: SessionContext, sourceKey: string) {
  const destinationKey = sourceKey.replace(/\.csv$/iu, '.parquet');
  const tokenId = `ingest_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  await database().insert(ingestionTokens).values({
    id: tokenId,
    workspaceId: session.workspace.id,
    sourceKey,
    destinationKey,
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  });
  let sourceUrl: string;
  let destinationUrl: string;
  if (env.DATA_SOURCE_BASE_URL.startsWith('r2://')) {
    const token = await createR2Capability(
      {
        kind: 'ingestion',
        tokenId,
        sourceKey,
        destinationKey,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
      },
      env.INTERNAL_R2_SIGNING_SECRET,
    );
    sourceUrl = capabilityUrl(token);
    // The ingestion capability selects its read and write object from the HTTP method.
    destinationUrl = sourceUrl;
  } else {
    sourceUrl = localSourceUrl(sourceKey);
    destinationUrl = localSourceUrl(destinationKey);
  }
  await ingestCsv(session.workspace.id, tokenId, sourceUrl, destinationUrl);
  return {
    key: destinationKey,
    location: { kind: 'object' as const, key: destinationKey, format: 'parquet' as const },
  };
}

function uploadCleanupSecret() {
  return env.UPLOAD_SIGNING_SECRET;
}

function recordLatency(
  action: ApiRequest['action'],
  result: 'success' | 'error',
  durationMs: number,
) {
  const event = dashboardSaveActions.has(action)
    ? 'dashboard_save'
    : action === 'previewWidget'
      ? 'dashboard_preview'
      : action === 'queryWidget'
        ? 'widget_query'
        : undefined;
  if (!event) return;
  console.info(`rundown.${event}`, { action, result, durationMs });
  recordProductMetric(event, { labels: [action, result], numbers: [durationMs] });
}

const dashboardSaveActions = new Set<ApiRequest['action']>([
  'createDashboard',
  'updateDashboard',
  'addWidget',
  'updateWidget',
  'removeWidget',
  'moveWidget',
  'updateLayout',
  'copyWidget',
]);

async function isDatasourceObjectRegistered(workspaceId: string, key: string) {
  const registeredSources = await database()
    .select({ location: dataSources.location })
    .from(dataSources)
    .where(eq(dataSources.workspaceId, workspaceId));
  return registeredSources.some(({ location }) => dataSourceLocationReferencesKey(location, key));
}

async function claimPendingUpload(
  session: SessionContext,
  key: string,
  cleanupToken: string | undefined,
) {
  if (
    !cleanupToken ||
    !(await verifyDatasourceUploadCleanupToken(
      cleanupToken,
      key,
      session.userId,
      uploadCleanupSecret(),
    ))
  )
    throw new ApiError(403, 'invalid_cleanup_token', 'This upload belongs to another user.');
  const claimId = crypto.randomUUID();
  const claimed = await database()
    .update(datasourceUploads)
    .set({ status: 'registering', claimId, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        claimableUploadStatus(),
      ),
    )
    .returning({ key: datasourceUploads.key });
  if (!claimed.length)
    throw new ApiError(409, 'upload_not_pending', 'This upload is already being processed.');
  return claimId;
}

function claimableUploadStatus() {
  return or(
    eq(datasourceUploads.status, 'pending'),
    and(
      inArray(datasourceUploads.status, ['registering', 'removing']),
      lt(datasourceUploads.updatedAt, new Date(Date.now() - UPLOAD_CLAIM_LEASE_MS).toISOString()),
    ),
  );
}

async function restorePendingUpload(
  session: SessionContext,
  key: string,
  fromStatus: 'registering' | 'removing',
  claimId: string,
) {
  await database()
    .update(datasourceUploads)
    .set({ status: 'pending', claimId: null, updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        eq(datasourceUploads.status, fromStatus),
        eq(datasourceUploads.claimId, claimId),
      ),
    );
}

async function deleteUploadState(
  session: SessionContext,
  key: string,
  status: 'registering' | 'removing',
  claimId: string,
) {
  await database()
    .delete(datasourceUploads)
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        eq(datasourceUploads.status, status),
        eq(datasourceUploads.claimId, claimId),
      ),
    );
}

async function renewUploadClaim(
  session: SessionContext,
  key: string,
  status: 'registering' | 'removing',
  claimId: string,
) {
  const renewed = await database()
    .update(datasourceUploads)
    .set({ updatedAt: new Date().toISOString() })
    .where(
      and(
        eq(datasourceUploads.key, key),
        eq(datasourceUploads.workspaceId, session.workspace.id),
        eq(datasourceUploads.clerkUserId, session.userId),
        eq(datasourceUploads.status, status),
        eq(datasourceUploads.claimId, claimId),
      ),
    )
    .returning({ key: datasourceUploads.key });
  if (!renewed.length)
    throw new ApiError(409, 'upload_claim_lost', 'This upload operation was superseded.');
}

async function updateFieldMetadata(
  request: Extract<ApiRequest, { action: 'updateFieldMetadata' }>,
) {
  const session = await requireSession();
  await loadDataSource(request.dataSourceId, session.workspace.id);
  let hasEditorAccess = false;
  let usesSource = false;
  if (request.dashboardId) {
    const access = await authorizeDashboard(request.dashboardId, 'editor');
    hasEditorAccess = access.role === 'admin' || access.role === 'editor';
    usesSource = dashboardUsesDataSource(access.document, request.dataSourceId);
  }
  if (!canUpdateFieldMetadata(session.isAdmin, hasEditorAccess, usesSource, request.patch))
    throw new ApiError(
      403,
      'field_metadata_access_denied',
      'Editors may update visible field metadata only for datasources used by their dashboard.',
    );
  const row = await database().query.fields.findFirst({
    where: and(
      eq(fields.dataSourceId, request.dataSourceId),
      eq(fields.columnName, request.columnName),
    ),
  });
  if (!row) throw new ApiError(404, 'field_not_found', 'Field not found.');
  await database().update(fields).set(request.patch).where(eq(fields.id, row.id));
  return database().query.fields.findFirst({ where: eq(fields.id, row.id) });
}

async function upsertCalculatedField(
  request: Extract<ApiRequest, { action: 'upsertCalculatedField' }>,
) {
  const { session, dataSource, metadata, canonicalName } = await calculatedFieldContext(request);
  validateCalculatedFieldExpression(request, metadata, canonicalName);
  await datasourceOperation(() =>
    connectorFor(dataSource).validateExpression(dataSource, {
      kind: 'calculatedField',
      id: request.id,
      canonicalName,
      expression: request.expression,
      semanticType: request.semanticType,
      metadata,
    }),
  );
  const mutableValues = {
    canonicalName,
    label: request.name,
    expression: request.expression,
    role: request.role,
    semanticType: request.semanticType,
    defaultAggregation: request.defaultAggregation ?? null,
    description: request.description ?? null,
    updatedAt: new Date().toISOString(),
  };
  const db = database();
  if (request.id) {
    const [updated] = await db
      .update(calculatedFields)
      .set(mutableValues)
      .where(
        and(
          eq(calculatedFields.id, request.id),
          eq(calculatedFields.workspaceId, session.workspace.id),
          eq(calculatedFields.dataSourceId, dataSource.id),
        ),
      )
      .returning();
    if (!updated)
      throw new ApiError(404, 'calculated_field_not_found', 'Calculated field not found.');
    return updated;
  }
  const values = {
    id: `calc_${crypto.randomUUID()}`,
    workspaceId: session.workspace.id,
    dataSourceId: dataSource.id,
    ...mutableValues,
  };
  const [created] = await db.insert(calculatedFields).values(values).returning();
  return created;
}

async function validateCalculatedField(
  request: Extract<ApiRequest, { action: 'validateCalculatedField' }>,
) {
  const { metadata, canonicalName } = await calculatedFieldContext(request);
  try {
    const compiled = validateCalculatedFieldExpression(request, metadata, canonicalName);
    return { valid: true as const, type: compiled.type, identifiers: compiled.identifiers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = formulaErrorPosition(message, request.expression);
    return { valid: false as const, error: { message, ...position } };
  }
}

async function previewCalculatedFieldValues(
  request: Extract<ApiRequest, { action: 'previewCalculatedFieldValues' }>,
) {
  const { dataSource, metadata, canonicalName } = await calculatedFieldContext(request);
  validateCalculatedFieldExpression(request, metadata, canonicalName);
  const field = {
    id: request.id ?? '__preview__',
    dataSourceId: request.dataSourceId,
    canonicalName,
    label: request.name,
    expression: request.expression,
    role: 'dimension' as const,
    semanticType: request.semanticType,
    description: null,
  };
  const rows = await datasourceOperation(() =>
    connectorFor(dataSource).executeQuery<{ value: unknown }>(dataSource, {
      kind: 'controlOptions',
      field,
      metadata,
      direction: 'ASC',
    }),
  );
  return { values: rows.slice(0, 10).map((row) => normalize(row.value)) };
}

/**
 * Checks a custom metric formula without saving it. Aggregate formulas must wrap every
 * field reference in an aggregate function, which is the mistake this surfaces early.
 */
async function validateMetricExpression(
  request: Extract<ApiRequest, { action: 'validateMetricExpression' }>,
) {
  const { metadata } = await datasourceFormulaContext(request);
  try {
    if (!request.expression.trim()) throw new Error('A formula is required.');
    const compiled = validateAggregateFormula(request.expression, metadata);
    return { valid: true as const, type: compiled.type, identifiers: compiled.identifiers };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const position = formulaErrorPosition(message, request.expression);
    return { valid: false as const, error: { message, ...position } };
  }
}

/**
 * Writing a formula against a datasource needs workspace admin rights, or editor access
 * to a dashboard that actually uses that datasource.
 */
async function datasourceFormulaContext(request: { dashboardId?: string; dataSourceId: string }) {
  const session = await requireSession();
  if (!session.isAdmin) {
    if (!request.dashboardId)
      throw new ApiError(
        403,
        'dashboard_editor_required',
        'Formulas require editor access to a dashboard.',
      );
    const access = await authorizeDashboard(request.dashboardId, 'editor');
    if (!dashboardUsesDataSource(access.document, request.dataSourceId))
      throw new ApiError(
        403,
        'dashboard_datasource_required',
        'The authorized dashboard does not use this datasource.',
      );
  }
  const dataSource = await loadDataSource(request.dataSourceId, session.workspace.id);
  const metadata = await loadQueryMetadata(dataSource.id, session.workspace.id);
  return { session, dataSource, metadata };
}

async function calculatedFieldContext(
  request: Extract<
    ApiRequest,
    { action: 'upsertCalculatedField' | 'validateCalculatedField' | 'previewCalculatedFieldValues' }
  >,
) {
  const { session, dataSource, metadata } = await datasourceFormulaContext(request);
  const existing = request.id
    ? metadata.calculatedFields.find((field) => field.id === request.id)
    : undefined;
  const canonicalName = existing?.canonicalName ?? request.canonicalName ?? slug(request.name);
  if (!canonicalName)
    throw new ApiError(
      400,
      'calculated_field_name_invalid',
      'The field name must contain a letter or number.',
    );
  return { session, dataSource, metadata, canonicalName };
}

function validateCalculatedFieldExpression(
  request: Extract<
    ApiRequest,
    { action: 'upsertCalculatedField' | 'validateCalculatedField' | 'previewCalculatedFieldValues' }
  >,
  metadata: Awaited<ReturnType<typeof loadQueryMetadata>>,
  canonicalName: string,
) {
  assertCalculatedFieldNameAvailable(canonicalName, metadata, request.id);
  const semanticType = request.semanticType;
  const calculatedFields = [
    ...metadata.calculatedFields.filter((field) => field.id !== request.id),
    {
      id: request.id ?? '__candidate__',
      dataSourceId: request.dataSourceId,
      canonicalName,
      label: request.name,
      expression: request.expression,
      role: 'dimension' as const,
      semanticType: semanticType ?? 'text',
      description: null,
    },
  ];
  return validateRowFormula(
    request.expression,
    { fields: metadata.fields, calculatedFields },
    semanticType,
  );
}

function formulaErrorPosition(message: string, expression: string) {
  const match = message.match(/position (\d+)/iu);
  const from = match ? Math.max(0, Number(match[1]) - 1) : 0;
  return { from: Math.min(from, expression.length), to: Math.min(from + 1, expression.length) };
}

async function upsertLibraryMetric(
  request: Extract<ApiRequest, { action: 'upsertLibraryMetric' }>,
) {
  const session = await requireSession();
  if (!session.isAdmin) {
    if (request.id)
      throw new ApiError(
        403,
        'library_metric_admin_required',
        'Only workspace admins can update library metrics.',
      );
    if (!request.dashboardId)
      throw new ApiError(
        403,
        'dashboard_editor_required',
        'Library metrics require editor access to a dashboard.',
      );
    await authorizeDashboard(request.dashboardId, 'editor');
  }
  await validateLibraryMetricInput(request, session);
  const mutableValues = {
    name: request.name,
    canonicalName: request.canonicalName ?? slug(request.name),
    expression: request.expression,
    semanticType: request.semanticType,
    description: request.description ?? null,
    updatedAt: new Date().toISOString(),
  };
  const db = database();
  if (request.id) {
    const [updated] = await db
      .update(libraryMetrics)
      .set(mutableValues)
      .where(
        and(
          eq(libraryMetrics.id, request.id),
          eq(libraryMetrics.workspaceId, session.workspace.id),
        ),
      )
      .returning();
    if (!updated) throw new ApiError(404, 'library_metric_not_found', 'Library metric not found.');
    return updated;
  }
  const values = newLibraryMetricValues(request, session.workspace.id);
  const [created] = await db.insert(libraryMetrics).values(values).returning();
  return created;
}

type LibraryMetricInput = NonNullable<
  Extract<ApiRequest, { action: 'updateWidget' }>['libraryMetric']
>;

async function validateLibraryMetricInput(input: LibraryMetricInput, session: SessionContext) {
  const sourceRows = await database()
    .select()
    .from(dataSources)
    .where(eq(dataSources.workspaceId, session.workspace.id));
  let validated = false;
  for (const row of sourceRows) {
    const dataSource = await loadDataSource(row.id, session.workspace.id);
    const metadata = await loadQueryMetadata(row.id, session.workspace.id);
    if (
      await datasourceOperation(() =>
        libraryMetricApplies(dataSource, {
          kind: 'libraryMetric',
          expression: input.expression,
          semanticType: input.semanticType,
          metadata,
        }),
      )
    ) {
      validated = true;
      break;
    }
  }
  if (!validated)
    throw new ApiError(
      400,
      'metric_not_applicable',
      'No datasource contains every canonical field referenced by this metric.',
    );
}

function newLibraryMetricValues(input: LibraryMetricInput, workspaceId: string) {
  return {
    id: `metric_${crypto.randomUUID()}`,
    workspaceId,
    name: input.name,
    canonicalName: input.canonicalName ?? slug(input.name),
    expression: input.expression,
    semanticType: input.semanticType,
    description: input.description ?? null,
    updatedAt: new Date().toISOString(),
  };
}

async function shareDashboard(request: Extract<ApiRequest, { action: 'shareDashboard' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  if (!access.session) throw new ApiError(401, 'unauthenticated', 'Sign in to manage sharing.');
  const db = database();
  if (request.operation.kind === 'createLink') {
    const token = randomToken();
    const link = {
      token,
      dashboardId: request.dashboardId,
      createdBy: access.session.userId,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    await db.insert(shareLinks).values(link);
    return { ...link, url: `/share/${token}` };
  }
  if (request.operation.kind === 'revokeLink') {
    await db
      .update(shareLinks)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(shareLinks.dashboardId, request.dashboardId),
          eq(shareLinks.token, request.operation.token),
        ),
      );
  } else {
    if (request.operation.kind === 'grant') {
      const users = await clerkClient().users.getUserList({
        emailAddress: [request.operation.userEmail],
        limit: 2,
      });
      const user = users.data[0];
      if (!user) throw new ApiError(404, 'user_not_found', 'No Clerk user has that email address.');
      const values = {
        dashboardId: request.dashboardId,
        clerkUserId: user.id,
        role: request.operation.role,
        grantedBy: access.session.userId,
        grantedAt: new Date().toISOString(),
      };
      await db
        .insert(dashboardGrants)
        .values(values)
        .onConflictDoUpdate({
          target: [dashboardGrants.dashboardId, dashboardGrants.clerkUserId],
          set: values,
        });
    } else {
      let userId = request.operation.userId;
      if (!userId && request.operation.userEmail) {
        const users = await clerkClient().users.getUserList({
          emailAddress: [request.operation.userEmail],
          limit: 2,
        });
        userId = users.data[0]?.id;
      }
      if (!userId)
        throw new ApiError(400, 'user_reference_required', 'Provide a user id or email to revoke.');
      await db
        .delete(dashboardGrants)
        .where(
          and(
            eq(dashboardGrants.dashboardId, request.dashboardId),
            eq(dashboardGrants.clerkUserId, userId),
          ),
        );
    }
  }
  return sharingState(request.dashboardId);
}

async function authorizeDashboard(id: string, required: 'viewer' | 'editor', shareToken?: string) {
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

async function visibleDashboardRows(session: SessionContext) {
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

function defaultControlState(dashboard: DashboardDocument): ControlState {
  const dateControl = dashboard.widgets.find((widget) => widget.definition.type === 'dateControl');
  const values = Object.fromEntries(
    dashboard.widgets.flatMap((widget) =>
      widget.definition.type === 'control' && controlDefaultValues(widget)?.length
        ? [[widget.id, controlDefaultValues(widget)]]
        : [],
    ),
  );
  return {
    ...(dateControl?.definition.type === 'dateControl'
      ? { dateRange: dateControl.definition.defaultDateRange ?? dashboard.defaultDateRange }
      : {}),
    ...(Object.keys(values).length ? { values } : {}),
  };
}

async function persistDashboard(document: DashboardDocument) {
  dashboardDocumentSchema.parse(document);
  await database()
    .update(dashboards)
    .set({ name: document.name, document, updatedAt: document.updatedAt })
    .where(eq(dashboards.id, document.id));
}

function widgetById(document: DashboardDocument, widgetId: string) {
  const widget = document.widgets.find((item) => item.id === widgetId);
  if (!widget) throw new ApiError(404, 'widget_not_found', 'Widget not found.');
  return widget;
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

async function validateDefinition(dashboard: DashboardDocument, definition: WidgetDefinition) {
  if (
    definition.type === 'control' &&
    !definition.allowMultiple &&
    (definition.defaultValues?.length ?? 0) > 1
  )
    throw new ApiError(
      400,
      'multiple_default_values_not_allowed',
      'A single-select filter accepts only one default value.',
    );
  if (!('dataSourceId' in definition)) return;
  const dataSource = await loadDataSource(definition.dataSourceId, dashboard.workspaceId);
  const metadata = await loadQueryMetadata(dataSource.id, dashboard.workspaceId);
  const referenced = definitionFieldIds(definition);
  const known = new Set(
    [...metadata.fields, ...metadata.calculatedFields].map((field) => field.id),
  );
  if (referenced.some((id) => !known.has(id)))
    throw new ApiError(
      400,
      'unknown_field',
      'The widget references a field that does not belong to its datasource.',
    );
  const metadataById = new Map(
    [...metadata.fields, ...metadata.calculatedFields].map((field) => [field.id, field]),
  );
  if (
    definitionDimensions(definition).some(
      (dimension) =>
        dimension.dateGranularity && metadataById.get(dimension.fieldId)?.semanticType !== 'date',
    )
  )
    throw new ApiError(
      400,
      'invalid_date_granularity',
      'Date granularity can only be set on date dimensions.',
    );
  if (!compilesToQuery(definition)) return;
  await datasourceOperation(() =>
    connectorFor(dataSource).validateQuery(dataSource, {
      kind: 'widget',
      dashboard,
      definition,
      metadata,
      controlState: {},
      dateBucketTarget: 60,
    }),
  );
}

async function runDefinition(
  dashboard: DashboardDocument,
  definition: WidgetDefinition,
  state: ControlState,
  width = 8,
) {
  const defaults = defaultControlState(dashboard);
  const controlState = validateControlState(dashboard, mergeControlState(defaults, state));
  if (!compilesToQuery(definition)) return { rows: [], controlState };
  const dataSource = await loadDataSource(definition.dataSourceId, dashboard.workspaceId);
  const metadata = await loadQueryMetadata(dataSource.id, dashboard.workspaceId);
  const columns = queryResultColumns(definition, metadata);
  const resolvedControls = await resolveControls(
    dashboard,
    definition,
    [...metadata.fields, ...metadata.calculatedFields],
    controlState,
  );
  const dateRange = controlState.dateRange ?? dashboard.defaultDateRange;
  const resolvedDateRange = resolveDateRange(dateRange, dashboard.timezone);
  const bucketTarget = dateBucketTarget(width);
  const comparisonGranularity = resolvedWidgetDateGranularity(
    definition,
    metadata,
    resolvedDateRange,
    bucketTarget,
  );
  const resolvedControlState: ControlState = {
    ...controlState,
    dateRange: {
      startDate: { fixed: resolvedDateRange.start },
      endDate: { fixed: resolvedDateRange.end },
    },
  };
  const run = (queryControlState: ControlState, queryDefinition: WidgetDefinition = definition) =>
    datasourceOperation(() =>
      connectorFor(dataSource).executeQuery<Record<string, unknown>>(dataSource, {
        kind: 'widget',
        dashboard,
        definition: queryDefinition,
        metadata,
        controlState: queryControlState,
        resolvedControls,
        dateBucketTarget: bucketTarget,
      }),
    );
  const comparison = widgetComparison(definition);
  const [rows, comparisonRows] = await Promise.all([
    run(resolvedControlState),
    comparison
      ? run({
          ...resolvedControlState,
          dateRange: comparisonDateRange(
            resolvedControlState.dateRange!,
            comparison,
            dashboard.timezone,
          ),
        })
      : Promise.resolve(undefined),
  ]);
  const alignedComparisonRows =
    comparisonRows && comparison && hasDateDimension(definition, metadata)
      ? alignDateComparisonRows(
          comparisonRows,
          comparison,
          resolvedDateRange,
          comparisonGranularity,
        )
      : comparisonRows;
  return {
    rows: normalize(rows),
    columns,
    ...(alignedComparisonRows ? { comparisonRows: normalize(alignedComparisonRows) } : {}),
    controlState,
  };
}

async function compiledSql(dashboard: DashboardDocument, widget: DashboardWidget) {
  if (!compilesToQuery(widget.definition)) return null;
  const dataSource = await loadDataSource(widget.definition.dataSourceId, dashboard.workspaceId);
  const metadata = await loadQueryMetadata(dataSource.id, dashboard.workspaceId);
  return datasourceOperation(
    () =>
      connectorFor(dataSource).explainQuery(dataSource, {
        kind: 'widget',
        dashboard,
        definition: widget.definition,
        metadata,
        controlState: {},
        dateBucketTarget: dateBucketTarget(widget.layout.width),
      }).sql,
  );
}

async function definitionHash(definition: WidgetDefinition, workspaceId: string) {
  if (!('dataSourceId' in definition)) return hashJson(definition);
  const metadata = await loadQueryMetadata(definition.dataSourceId, workspaceId);
  return hashJson(widgetDependencyState(definition, metadata));
}

export function validateControlState(dashboard: DashboardDocument, input: ControlState) {
  const state = controlStateSchema.parse(input);
  if (
    dashboard.widgets.some((widget) => widget.definition.type === 'dateControl') &&
    !state.dateRange
  )
    throw new ApiError(400, 'date_range_required', 'This dashboard requires a date range.');
  const controlIds = new Set(
    dashboard.widgets
      .filter((widget) => widget.definition.type === 'control')
      .map((widget) => widget.id),
  );
  for (const key of Object.keys(state.values ?? {}))
    if (!controlIds.has(key))
      throw new ApiError(400, 'unknown_control', `Unknown dashboard control ${key}.`);
  if (singleValueControlWithMultipleSelections(dashboard, state))
    throw new ApiError(400, 'multiple_values_not_allowed', 'This filter accepts only one value.');
  return state;
}

function widgetComparison(definition: WidgetDefinition) {
  if (!('comparison' in definition) || !definition.comparison) return undefined;
  return definition.comparison.mode === 'none' ? undefined : definition.comparison.mode;
}

function hasDateDimension(
  definition: WidgetDefinition,
  metadata: {
    fields: Array<{ id: string; semanticType: string }>;
    calculatedFields: Array<{ id: string; semanticType: string }>;
  },
) {
  const fieldId = definitionDimensions(definition)[0]?.fieldId;
  return [...metadata.fields, ...metadata.calculatedFields].some(
    (field) => field.id === fieldId && field.semanticType === 'date',
  );
}

function resolvedWidgetDateGranularity(
  definition: WidgetDefinition,
  metadata: {
    fields: Array<{ id: string; semanticType: string }>;
    calculatedFields: Array<{ id: string; semanticType: string }>;
  },
  range: { start: string; end: string },
  targetBuckets: number,
) {
  const dimension = definitionDimensions(definition)[0];
  if (!dimension) return undefined;
  const field = [...metadata.fields, ...metadata.calculatedFields].find(
    (candidate) => candidate.id === dimension.fieldId,
  );
  if (field?.semanticType !== 'date') return undefined;
  return resolveDateGranularity(
    dimension.dateGranularity ?? (definition.type === 'table' ? 'raw' : 'auto'),
    range,
    targetBuckets,
  );
}

async function resolveControls(
  dashboard: DashboardDocument,
  definition: WidgetDefinition,
  targetFields: Array<{ id: string; canonicalName: string; semanticType: string }>,
  state: ControlState,
) {
  if (!('dataSourceId' in definition)) return [];
  const resolved: Array<{ fieldId: string; values: unknown[] }> = [];
  for (const [controlId, values] of Object.entries(state.values ?? {})) {
    const control = widgetById(dashboard, controlId);
    if (control.definition.type !== 'control') continue;
    const controlDefinition = control.definition;
    const sourceMetadata = await loadQueryMetadata(
      controlDefinition.dataSourceId,
      dashboard.workspaceId,
    );
    const sourceField = [...sourceMetadata.fields, ...sourceMetadata.calculatedFields].find(
      (field) => field.id === controlDefinition.fieldId,
    );
    if (!sourceField) continue;
    const target = targetFields.find(
      (field) =>
        field.canonicalName === sourceField.canonicalName &&
        compatibleSemanticTypes(field.semanticType, sourceField.semanticType),
    );
    if (target) resolved.push({ fieldId: target.id, values });
  }
  return resolved;
}

function compatibleSemanticTypes(left: string, right: string) {
  return left === right || (left === 'text' && right === 'text');
}

/**
 * Text, date controls, and filter controls have no query of their own. Filter controls do name a
 * datasource, so a datasource check alone is not enough to keep them out of the compiler.
 */
function compilesToQuery(definition: WidgetDefinition) {
  return 'dataSourceId' in definition && 'dateRangeFieldId' in definition;
}

function definitionFieldIds(definition: WidgetDefinition) {
  const ids: string[] = [];
  if ('dateRangeFieldId' in definition) ids.push(definition.dateRangeFieldId);
  if ('fieldId' in definition) ids.push(definition.fieldId);
  if ('filter' in definition)
    ids.push(...(definition.filter?.conditions.map((condition) => condition.fieldId) ?? []));
  if ('dimension' in definition) ids.push(definition.dimension.fieldId);
  if ('dimensions' in definition)
    ids.push(...definition.dimensions.map((dimension) => dimension.fieldId));
  if ('pivotDimension' in definition && definition.pivotDimension)
    ids.push(definition.pivotDimension.fieldId);
  if ('breakdownDimension' in definition && definition.breakdownDimension)
    ids.push(definition.breakdownDimension.fieldId);
  const metrics =
    'metric' in definition
      ? [definition.metric]
      : 'metrics' in definition
        ? definition.metrics
        : [];
  ids.push(
    ...metrics.flatMap((metric) => (metric.source.kind === 'field' ? [metric.source.fieldId] : [])),
  );
  return ids;
}

function definitionDimensions(definition: WidgetDefinition) {
  if (definition.type === 'line') return [definition.dimension];
  if (definition.type === 'bar' || definition.type === 'pie')
    return [
      definition.dimension,
      ...(definition.breakdownDimension ? [definition.breakdownDimension] : []),
    ];
  return definition.type === 'table'
    ? [...definition.dimensions, ...(definition.pivotDimension ? [definition.pivotDimension] : [])]
    : [];
}

function dashboardUsesDataSource(dashboard: DashboardDocument, dataSourceId: string) {
  return dashboard.widgets.some(
    (widget) =>
      'dataSourceId' in widget.definition && widget.definition.dataSourceId === dataSourceId,
  );
}

function seedField(
  dataSourceId: string,
  column: { column_name: string; column_type: string },
  samples: Record<string, unknown>[],
) {
  const values = [
    ...new Set(
      samples
        .map((row) => normalize(row[column.column_name]))
        .filter((value) => value !== null && value !== undefined)
        .map((value) => JSON.stringify(value)),
    ),
  ]
    .slice(0, 5)
    .map((value) => JSON.parse(value) as unknown);
  return {
    id: `field_${crypto.randomUUID()}`,
    dataSourceId,
    columnName: column.column_name,
    canonicalName: slug(column.column_name),
    label: humanize(column.column_name),
    ...detectFieldSemantics(column.column_name, column.column_type),
    description: null,
    hidden: false,
    sampleValues: values,
    cardinality: null,
  };
}

async function sharingState(dashboardId: string) {
  const [links, grants] = await Promise.all([
    database()
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.dashboardId, dashboardId), isNull(shareLinks.revokedAt))),
    database().select().from(dashboardGrants).where(eq(dashboardGrants.dashboardId, dashboardId)),
  ]);
  const userPages = await Promise.all(
    chunk(grants, 100).map((page) =>
      clerkClient().users.getUserList({
        userId: page.map((grant) => grant.clerkUserId),
        limit: page.length,
      }),
    ),
  );
  const userById = new Map(userPages.flatMap((page) => page.data).map((user) => [user.id, user]));
  return {
    links: links.map((link) => ({ ...link, url: `/share/${link.token}` })),
    grants: grants.map((grant) => {
      const user = userById.get(grant.clerkUserId);
      return {
        ...grant,
        userEmail: user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress,
        displayName:
          [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
          user?.username ||
          undefined,
      };
    }),
  };
}

function safeRequestIdentifiers(request: ApiRequest) {
  return {
    ...('dashboardId' in request ? { dashboardId: request.dashboardId } : {}),
    ...('widgetId' in request ? { widgetId: request.widgetId } : {}),
    ...('dataSourceId' in request ? { dataSourceId: request.dataSourceId } : {}),
  };
}

function chunk<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

function slug(value: string) {
  return value
    .trim()
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/[^A-Za-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '')
    .toLowerCase();
}
function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/[_-]+/gu, ' ')
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function connectorFor(dataSource: DataSourceRecord | string) {
  try {
    return datasourceConnector(dataSource);
  } catch (error) {
    throwDatasourceError(error);
  }
}

async function datasourceOperation<T>(operation: () => T | Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throwDatasourceError(error);
  }
}

async function libraryMetricApplies(
  dataSource: DataSourceRecord,
  expression: Extract<DatasourceExpression, { kind: 'libraryMetric' }>,
) {
  try {
    await connectorFor(dataSource).validateExpression(dataSource, expression);
    return true;
  } catch (error) {
    if (error instanceof DatasourceError && error.code === 'invalid_query') return false;
    throw error;
  }
}

function throwDatasourceError(error: unknown): never {
  if (!(error instanceof DatasourceError)) throw error;
  const status = {
    datasource_source_not_found: 404,
    datasource_source_too_large: 413,
    datasource_inspection_failed: 422,
    invalid_query: 400,
    unsupported_datasource_connector: 400,
    datasource_connector_failed: 502,
  }[error.code];
  if (error.code === 'datasource_connector_failed') {
    // A connector that failed to answer reports whatever the transport said, which can name
    // container addresses and object keys. That belongs in the log, not in the response.
    console.warn('rundown.datasource_connector_failed', { error: error.message });
    throw new ApiError(status, error.code, 'The query service is unavailable. Try again.');
  }
  throw new ApiError(status, error.code, error.message);
}

function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
