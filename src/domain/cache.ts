import type { WidgetDefinition } from './schema';

interface QueryMetadata {
  fields: Array<{
    id: string;
    columnName: string;
    canonicalName: string;
    label: string;
    castTo: string | null;
  }>;
  calculatedFields: Array<{
    id: string;
    canonicalName: string;
    label: string;
    expression: string;
  }>;
  libraryMetrics: Array<{
    id: string;
    canonicalName: string;
    name: string;
    expression: string;
  }>;
}

export function widgetDependencyState(definition: WidgetDefinition, metadata: QueryMetadata) {
  const libraryMetricIds = new Set([
    ...metricsIn(definition).flatMap((metric) =>
      metric.source.kind === 'library' ? [metric.source.libraryMetricId] : [],
    ),
    ...(definition.type === 'gauge' && definition.upperLimit?.kind === 'library'
      ? [definition.upperLimit.libraryMetricId]
      : []),
  ]);
  return {
    queryResultVersion: 4,
    definition: queryDefinition(definition),
    fields: metadata.fields
      .map(({ id, columnName, canonicalName, label, castTo }) => ({
        id,
        columnName,
        canonicalName,
        label,
        castTo,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    calculatedFields: metadata.calculatedFields
      .map(({ id, canonicalName, label, expression }) => ({
        id,
        canonicalName,
        label,
        expression,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    libraryMetrics: metadata.libraryMetrics
      .filter((metric) => libraryMetricIds.has(metric.id))
      .map(({ id, canonicalName, name, expression }) => ({ id, canonicalName, name, expression }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function queryDefinition(definition: WidgetDefinition) {
  const withoutMetricPresentation = (metric: ReturnType<typeof metricsIn>[number]) => {
    const {
      conditionalFormat: _conditionalFormat,
      displayFormat: _displayFormat,
      styling: _styling,
      userDefinedName: _userDefinedName,
      ...queryMetric
    } = metric;
    return queryMetric;
  };
  const {
    styling: _styling,
    title: _title,
    titleStyle: _titleStyle,
    textStyle: _textStyle,
    ...query
  } = definition as WidgetDefinition & {
    styling?: unknown;
    title?: string;
    titleStyle?: unknown;
    textStyle?: unknown;
  };
  if ('metric' in query) return { ...query, metric: withoutMetricPresentation(query.metric) };
  if ('metrics' in query)
    return { ...query, metrics: query.metrics.map(withoutMetricPresentation) };
  return query;
}

export function queryCacheState(input: {
  definitionHash: string;
  requestedDateRange: unknown;
  resolvedDateRange: { start: string; end: string };
  resolvedControls: unknown;
  drillPath: unknown[];
  dataSourceConnector: string;
  dataSourceVersion: string;
  timezone: string;
  dateBucketTarget: number;
}) {
  return {
    version: 3,
    definitionHash: input.definitionHash,
    controlState: {
      dateRange: {
        requested: input.requestedDateRange,
        resolved: input.resolvedDateRange,
      },
      values: input.resolvedControls,
    },
    drillPath: input.drillPath,
    dataSource: {
      connector: input.dataSourceConnector,
      version: input.dataSourceVersion,
    },
    timezone: input.timezone,
    dateBucketTarget: input.dateBucketTarget,
  };
}

function metricsIn(definition: WidgetDefinition) {
  return 'metric' in definition
    ? [definition.metric]
    : 'metrics' in definition
      ? definition.metrics
      : [];
}
