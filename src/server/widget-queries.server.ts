import { dashboardControlWidgets, dashboardWidgets } from '#/domain/schema';
import { type ApiRequest } from '#/api/contracts';
import {
  type ControlState,
  type WidgetDefinition,
  type DashboardDocument,
  type DashboardWidget,
  controlStateSchema,
} from '#/domain/schema';
import {
  mergeControlState,
  controlDefaultValues,
  singleValueControlWithMultipleSelections,
} from '#/domain/control-state';
import { loadDataSource, loadQueryMetadata } from './records.server';
import { queryResultColumns } from '#/domain/query-result';
import { resolveDateRange, comparisonDateRange } from '#/domain/dates';
import { dateBucketTarget, resolveDateGranularity } from '#/domain/date-granularity';
import { hashJson } from '#/domain/hash';
import { widgetDependencyState, queryCacheState } from '#/domain/cache';
import { env } from 'cloudflare:workers';
import { alignDateComparisonRows } from '#/domain/widget-results';
import { ApiError } from './errors';
import { authorizeDashboard } from './dashboard-access.server';
import { widgetById } from './dashboard-records.server';
import { connectorFor, normalize, datasourceOperation } from './datasource-operations.server';

export async function previewWidget(request: Extract<ApiRequest, { action: 'previewWidget' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  await validateDefinition(access.document, request.definition);
  return runDefinition(
    access.document,
    request.definition,
    request.controlState ?? {},
    request.width,
  );
}

export async function queryWidget(
  dashboardId: string,
  widgetId: string,
  state: ControlState | undefined,
  shareToken?: string,
  page = 0,
) {
  const access = await authorizeDashboard(dashboardId, 'viewer', shareToken);
  const widget = widgetById(access.document, widgetId);
  const { controlState, query } = await prepareWidgetQuery(
    access.document,
    widget.definition,
    state,
    widget.layout.width,
  );
  if (!query) return { rows: [], controlState };
  const {
    dataSource,
    connector,
    metadata,
    columns,
    resolvedControls,
    dateRange,
    resolvedDateRange,
    bucketTarget,
  } = query;
  const currentDefinitionHash = await hashJson(widgetDependencyState(widget.definition, metadata));
  const pageSize =
    widget.definition.type === 'table' && widget.definition.resultLimit.mode === 'pagination'
      ? widget.definition.resultLimit.amount
      : undefined;
  const datasourceIdentity = await datasourceOperation(() => connector.cacheIdentity(dataSource));
  const ttlSeconds =
    dataSource.location.kind === 'clickhouse' && dataSource.location.ownership === 'external'
      ? dataSource.location.cacheTtlSeconds
      : 86_400;
  const cacheKey = await hashJson({
    workspaceId: dataSource.workspaceId,
    datasourceId: dataSource.id,
    datasourceIdentity,
    cacheTtlSeconds: ttlSeconds,
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
  const cached =
    ttlSeconds > 0
      ? await env.QUERY_CACHE.get<{ cachedAt: number; result: Record<string, unknown> }>(
          cacheKey,
          'json',
        )
      : null;
  if (cached && Date.now() - cached.cachedAt < ttlSeconds * 1000) {
    console.info('yresonance.query_cache', { dashboardId, widgetId, outcome: 'hit' });
    return { ...cached.result, columns, cache: 'hit' };
  }
  console.info('yresonance.query_cache', { dashboardId, widgetId, outcome: 'miss' });
  const pageOffset = pageSize === undefined ? undefined : page * pageSize;
  const [{ rows, comparisonRows: alignedComparisonRows }, scaleBounds] = await Promise.all([
    executeWidgetQuery(query, pageOffset),
    pageSize === undefined ? undefined : colorScaleBounds(query),
  ]);
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
    ...(scaleBounds ? { scaleBounds } : {}),
    controlState,
    cache: 'miss',
    ...(pageSize === undefined ? {} : { page, hasMore }),
  };
  if (ttlSeconds > 0)
    await env.QUERY_CACHE.put(cacheKey, JSON.stringify({ cachedAt: Date.now(), result }), {
      expirationTtl: Math.max(60, ttlSeconds),
    });
  return result;
}

export async function explainWidget(dashboardId: string, widgetId: string, shareToken?: string) {
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

export async function getControlOptions(
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

export function defaultControlState(dashboard: DashboardDocument): ControlState {
  const dateControl = dashboardControlWidgets(dashboard).find(
    (widget) => widget.definition.type === 'dateControl',
  );
  const values = Object.fromEntries(
    dashboardControlWidgets(dashboard).flatMap((widget) =>
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

export async function validateDefinition(
  dashboard: DashboardDocument,
  definition: WidgetDefinition,
) {
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
  const { controlState, query } = await prepareWidgetQuery(dashboard, definition, state, width);
  if (!query) return { rows: [], controlState };
  const { rows, comparisonRows } = await executeWidgetQuery(query);
  return {
    rows: normalize(rows),
    columns: query.columns,
    ...(comparisonRows ? { comparisonRows: normalize(comparisonRows) } : {}),
    controlState,
  };
}

// Resolve once before either cache lookup or execution, including relative dates and controls.
async function prepareWidgetQuery(
  dashboard: DashboardDocument,
  definition: WidgetDefinition,
  state: ControlState | undefined,
  width: number,
) {
  const defaults = defaultControlState(dashboard);
  const controlState = validateControlState(dashboard, mergeControlState(defaults, state));
  if (!compilesToQuery(definition)) return { controlState, query: undefined };
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
  return {
    controlState,
    query: {
      dashboard,
      definition,
      dataSource,
      connector: connectorFor(dataSource),
      metadata,
      columns,
      resolvedControls,
      dateRange,
      resolvedDateRange,
      bucketTarget,
      comparisonGranularity,
      resolvedControlState,
    },
  };
}

// Paging and caching belong to the saved-widget caller; preview uses the same query without them.
async function executeWidgetQuery(
  query: NonNullable<Awaited<ReturnType<typeof prepareWidgetQuery>>['query']>,
  offset?: number,
) {
  const {
    dashboard,
    definition,
    dataSource,
    connector,
    metadata,
    resolvedControls,
    resolvedDateRange,
    bucketTarget,
    comparisonGranularity,
    resolvedControlState,
  } = query;
  const run = (queryControlState: ControlState) =>
    datasourceOperation(() =>
      connector.executeQuery<Record<string, unknown>>(dataSource, {
        kind: 'widget',
        dashboard,
        definition,
        metadata,
        controlState: queryControlState,
        resolvedControls,
        offset,
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
  return { rows, comparisonRows: alignedComparisonRows };
}

// A page only sees its own rows, so paged tables read color scale bounds over the whole result.
async function colorScaleBounds(
  query: NonNullable<Awaited<ReturnType<typeof prepareWidgetQuery>>['query']>,
) {
  const { definition, dataSource, connector } = query;
  if (definition.type !== 'table' || !definition.metrics.some((metric) => metric.colorScale))
    return undefined;
  const [bounds] = await datasourceOperation(() =>
    connector.executeQuery<Record<string, unknown>>(dataSource, {
      kind: 'widget',
      dashboard: query.dashboard,
      definition,
      metadata: query.metadata,
      controlState: query.resolvedControlState,
      resolvedControls: query.resolvedControls,
      scaleBounds: true,
      dateBucketTarget: query.bucketTarget,
    }),
  );
  // Empty or non-finite bounds (all NULL, or infinity that ClickHouse sends as null) get no scale.
  const bound = (value: unknown) => (value == null ? NaN : Number(value));
  return Object.fromEntries(
    definition.metrics.flatMap((metric, index) => {
      const min = bound(bounds?.[`min_${index + 1}`]);
      const max = bound(bounds?.[`max_${index + 1}`]);
      return metric.colorScale && Number.isFinite(min) && Number.isFinite(max)
        ? [[`metric_${index + 1}`, { min, max }]]
        : [];
    }),
  );
}

export async function compiledSql(dashboard: DashboardDocument, widget: DashboardWidget) {
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

export async function definitionHash(definition: WidgetDefinition, workspaceId: string) {
  if (!('dataSourceId' in definition)) return hashJson(definition);
  const metadata = await loadQueryMetadata(definition.dataSourceId, workspaceId);
  return hashJson(widgetDependencyState(definition, metadata));
}

export function validateControlState(dashboard: DashboardDocument, input: ControlState) {
  const state = controlStateSchema.parse(input);
  if (
    dashboardControlWidgets(dashboard).some((widget) => widget.definition.type === 'dateControl') &&
    !state.dateRange
  )
    throw new ApiError(400, 'date_range_required', 'This dashboard requires a date range.');
  const controlIds = new Set(
    dashboardWidgets(dashboard)
      .filter((widget) => widget.definition.type === 'control')
      .map((widget) => widget.id),
  );
  for (const key of Object.keys(state.values ?? {}))
    if (!controlIds.has(key))
      throw new ApiError(400, 'unknown_control', `Unknown dashboard control ${key}.`);
  if (singleValueControlWithMultipleSelections(dashboard, state))
    throw new ApiError(400, 'multiple_values_not_allowed', 'This filter accepts only one value.');
  const visibleControls = dashboardControlWidgets(dashboard);
  const visibleIds = new Set(
    visibleControls
      .filter((widget) => widget.definition.type === 'control')
      .map((widget) => widget.id),
  );
  const hasHiddenDateControl = dashboard.pages.some(
    (page) =>
      page.hidden && page.widgets.some((widget) => widget.definition.type === 'dateControl'),
  );
  return {
    ...state,
    ...(hasHiddenDateControl ? { dateRange: undefined } : {}),
    values: Object.fromEntries(
      Object.entries(state.values ?? {}).filter(([id]) => visibleIds.has(id)),
    ),
  };
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
  if (definition.type === 'line' || definition.type === 'combo') return [definition.dimension];
  if (definition.type === 'bar' || definition.type === 'pie')
    return [
      definition.dimension,
      ...(definition.breakdownDimension ? [definition.breakdownDimension] : []),
    ];
  return definition.type === 'table'
    ? [...definition.dimensions, ...(definition.pivotDimension ? [definition.pivotDimension] : [])]
    : [];
}
