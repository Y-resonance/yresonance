import type { SemanticType, WidgetDefinition } from './schema';

interface NamedField {
  id: string;
  label: string;
  semanticType: SemanticType;
}

interface NamedLibraryMetric {
  id: string;
  name: string;
}

interface QueryResultMetadata {
  fields: NamedField[];
  calculatedFields: NamedField[];
  libraryMetrics: NamedLibraryMetric[];
}

export interface QueryResultColumn {
  key: string;
  label: string;
  kind: 'dimension' | 'metric';
  dataType: SemanticType | 'number' | 'percent' | 'duration';
  radix?: number;
  conditionalFormat?: Array<
    | {
        comparator: 'gt' | 'lt' | 'gte' | 'lte';
        value: number;
        color: 'positive' | 'warning' | 'negative' | 'neutral';
      }
    | {
        comparator: 'between';
        min: number;
        max: number;
        color: 'positive' | 'warning' | 'negative' | 'neutral';
      }
  >;
}

export function queryResultColumns(
  definition: WidgetDefinition,
  metadata: QueryResultMetadata,
): QueryResultColumn[] {
  const dimensions = widgetDimensions(definition).map((dimension, index) => {
    const field = fieldById(dimension.fieldId, metadata);
    return {
      key: `dimension_${index + 1}`,
      label: dimension.userDefinedName ?? field.label,
      kind: 'dimension' as const,
      dataType: field.semanticType,
    };
  });
  const metrics = widgetMetrics(definition).map((metric, index) => ({
    key: `metric_${index + 1}`,
    label: metric.userDefinedName ?? metricSourceName(metric.source, metadata),
    kind: 'metric' as const,
    dataType: metric.dataType,
    ...(metric.displayFormat?.radix === undefined ? {} : { radix: metric.displayFormat.radix }),
    ...(metric.conditionalFormat ? { conditionalFormat: metric.conditionalFormat } : {}),
  }));
  return [...dimensions, ...metrics];
}

function widgetDimensions(definition: WidgetDefinition) {
  if (definition.type === 'line' || definition.type === 'combo') return [definition.dimension];
  if (definition.type === 'bar' || definition.type === 'pie') {
    return [
      definition.dimension,
      ...(definition.breakdownDimension ? [definition.breakdownDimension] : []),
    ];
  }
  return definition.type === 'table'
    ? [...definition.dimensions, ...(definition.pivotDimension ? [definition.pivotDimension] : [])]
    : [];
}

function widgetMetrics(definition: WidgetDefinition) {
  if (
    definition.type === 'scorecard' ||
    definition.type === 'gauge' ||
    definition.type === 'bar' ||
    definition.type === 'pie'
  )
    return [definition.metric];
  return definition.type === 'line' || definition.type === 'combo' || definition.type === 'table'
    ? definition.metrics
    : [];
}

function fieldById(fieldId: string, metadata: QueryResultMetadata) {
  const field = [...metadata.fields, ...metadata.calculatedFields].find(
    (candidate) => candidate.id === fieldId,
  );
  if (!field) throw new Error(`Unknown field ${fieldId}.`);
  return field;
}

function metricSourceName(
  source: ReturnType<typeof widgetMetrics>[number]['source'],
  metadata: QueryResultMetadata,
) {
  if (source.kind === 'field') return fieldById(source.fieldId, metadata).label;
  if (source.kind === 'expression') return 'Widget expression';
  const metric = metadata.libraryMetrics.find(
    (candidate) => candidate.id === source.libraryMetricId,
  );
  if (!metric) throw new Error(`Unknown library metric ${source.libraryMetricId}.`);
  return metric.name;
}
