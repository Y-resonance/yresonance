import { type WidgetDefinition } from '#/domain/schema';
import { yearToDateRange } from '#/domain/dates';
import { remapWidgetDefinition } from '#/domain/remap';
import { callApi } from '#/api/client';
import {
  type BuilderType,
  type BuilderDataSource,
  type QueryDefinition,
  type SourceDescription,
} from './shared';

export async function defaultDefinition(
  type: BuilderType,
  source?: BuilderDataSource,
): Promise<WidgetDefinition> {
  if (type === 'dateControl') return { type, defaultDateRange: yearToDateRange };
  if (type === 'text')
    return { type, content: { schemaVersion: 'plain-text-v1', document: 'Add text' } };
  if (!source) throw new Error('Register a datasource before adding a data widget.');
  const description = await describeSource(source.id);
  const fields = [...description.fields, ...description.calculatedFields];
  const date = fields.find((field) => field.semanticType === 'date');
  const dimension = fields.find(
    (field) => field.role === 'dimension' && field.semanticType !== 'date',
  );
  const metricField = fields.find((field) => field.role === 'metric');
  if (type === 'control') {
    if (!dimension) throw new Error('This datasource has no dimension for a filter control.');
    return {
      type,
      dataSourceId: source.id,
      fieldId: dimension.id,
      userDefinedName: 'Filter',
      allowMultiple: true,
    };
  }
  if (!date || !metricField)
    throw new Error('The datasource needs a date field and a metric field.');
  const metricFor = (field: (typeof fields)[number]) => ({
    source: {
      kind: 'field' as const,
      fieldId: field.id,
      aggregation: field.defaultAggregation ?? 'sum',
    },
    dataType:
      field.semanticType === 'currency'
        ? ('currency' as const)
        : field.semanticType === 'ratio'
          ? ('percent' as const)
          : ('number' as const),
  });
  const metric = metricFor(metricField);
  const base = { title: `New ${type}`, dataSourceId: source.id, dateRangeFieldId: date.id };
  if (type === 'scorecard') return { ...base, type, metric };
  if (type === 'gauge') return { ...base, type, metric };
  if (!dimension) throw new Error('The datasource needs a dimension for this widget.');
  if (type === 'line')
    return { ...base, type, dimension: { fieldId: dimension.id }, metrics: [metric] };
  if (type === 'combo') {
    // Starts as the volume-plus-efficiency chart it exists for: the first metric as bars, another
    // metric as a line on the right axis, preferably one with a different unit.
    const metrics = fields.filter(
      (field) => field.role === 'metric' && field.id !== metricField.id,
    );
    const second =
      metrics.find((field) => metricFor(field).dataType !== metric.dataType) ?? metrics[0];
    return {
      ...base,
      type,
      dimension: { fieldId: date.id },
      metrics: [
        { ...metric, mark: 'bar', axis: 'left' },
        ...(second
          ? [{ ...metricFor(second), mark: 'line' as const, axis: 'right' as const }]
          : []),
      ],
    };
  }
  if (type === 'table')
    return {
      ...base,
      type,
      dimensions: [{ fieldId: dimension.id }],
      metrics: [metric],
      resultLimit: { mode: 'top', amount: 50 },
      showSubtotals: true,
    };
  return { ...base, type, dimension: { fieldId: dimension.id }, metric, limit: 20 };
}

export async function changeSource(
  definition: QueryDefinition,
  sourceId: string,
  dashboardId: string,
  latestDefinition: () => WidgetDefinition = () => definition,
) {
  const [currentSource, targetSource] = await Promise.all([
    describeSource(definition.dataSourceId, dashboardId),
    describeSource(sourceId, dashboardId),
  ]);
  const latest = latestDefinition();
  if (!('dataSourceId' in latest) || latest.dataSourceId !== definition.dataSourceId)
    throw new Error('Widget datasource changed while loading.');
  const remapped = remapWidgetDefinition(latest, currentSource, sourceId, targetSource);
  return remapped.type === 'control' ? { ...remapped, defaultValues: undefined } : remapped;
}

export function describeSource(sourceId: string, dashboardId?: string) {
  return callApi<SourceDescription>({
    action: 'describeDatasource',
    dataSourceId: sourceId,
    dashboardId,
  });
}
