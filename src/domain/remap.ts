import { widgetDefinitionSchema, type WidgetDefinition } from './schema';
import { rewriteSqlIdentifiers } from '#/query/sql-identifiers';

interface FieldIdentity {
  id: string;
  canonicalName: string;
  columnName?: string;
  expression?: string;
}

interface RemapMetadata {
  fields: FieldIdentity[];
  calculatedFields: FieldIdentity[];
}

type Metric = Extract<WidgetDefinition, { type: 'scorecard' }>['metric'];
type Dimension = Extract<WidgetDefinition, { type: 'line' }>['dimension'];
type Filter = NonNullable<Extract<WidgetDefinition, { type: 'scorecard' }>['filter']>;
type Sort = NonNullable<Extract<WidgetDefinition, { type: 'table' }>['sort']>;

export function remapWidgetDefinition(
  definition: WidgetDefinition,
  source: RemapMetadata,
  targetDataSourceId: string,
  target: RemapMetadata,
) {
  if (!('dataSourceId' in definition)) return definition;
  const targetByCanonicalName = uniqueCanonicalFields(target);
  const fieldIdMap = new Map(
    [...source.fields, ...source.calculatedFields].map((field) => [
      field.id,
      targetByCanonicalName.get(field.canonicalName)?.id,
    ]),
  );
  const expressionFields = expressionFieldMap(source.fields, targetByCanonicalName);
  const fieldId = (id: string) => {
    const replacement = fieldIdMap.get(id);
    if (!replacement) throw new Error(`Target datasource has no canonical field for ${id}.`);
    return replacement;
  };
  const filter = (value: Filter | undefined) =>
    value
      ? {
          ...value,
          conditions: value.conditions.map((condition) => ({
            ...condition,
            fieldId: fieldId(condition.fieldId),
          })),
        }
      : undefined;
  const metric = (value: Metric): Metric => ({
    ...value,
    source:
      value.source.kind === 'field'
        ? { ...value.source, fieldId: fieldId(value.source.fieldId) }
        : value.source.kind === 'expression'
          ? {
              ...value.source,
              expression: rewriteSqlIdentifiers(value.source.expression, (identifier) =>
                expressionField(identifier, expressionFields),
              ),
            }
          : value.source,
  });
  const dimension = (value: Dimension): Dimension => ({
    ...value,
    fieldId: fieldId(value.fieldId),
  });
  const sort = (value: Sort | undefined): Sort | undefined =>
    value?.map((item) => ({
      ...item,
      target:
        item.target.kind === 'dimension'
          ? { ...item.target, fieldId: fieldId(item.target.fieldId) }
          : item.target,
    }));
  const common = {
    ...definition,
    dataSourceId: targetDataSourceId,
    ...('dateRangeFieldId' in definition
      ? { dateRangeFieldId: fieldId(definition.dateRangeFieldId) }
      : {}),
    filter: filter(definition.filter),
  };

  if (definition.type === 'control')
    return widgetDefinitionSchema.parse({ ...common, fieldId: fieldId(definition.fieldId) });
  if (definition.type === 'scorecard' || definition.type === 'gauge')
    return widgetDefinitionSchema.parse({ ...common, metric: metric(definition.metric) });
  if (definition.type === 'line')
    return widgetDefinitionSchema.parse({
      ...common,
      dimension: dimension(definition.dimension),
      drillDimensions: definition.drillDimensions?.map(dimension),
      metrics: definition.metrics.map(metric),
    });
  if (definition.type === 'bar' || definition.type === 'pie')
    return widgetDefinitionSchema.parse({
      ...common,
      metric: metric(definition.metric),
      dimension: dimension(definition.dimension),
      drillDimensions: definition.drillDimensions?.map(dimension),
      breakdownDimension: definition.breakdownDimension
        ? dimension(definition.breakdownDimension)
        : undefined,
      sort: sort(definition.sort),
    });
  return widgetDefinitionSchema.parse({
    ...common,
    dimensions: definition.dimensions.map(dimension),
    pivotDimension: definition.pivotDimension ? dimension(definition.pivotDimension) : undefined,
    metrics: definition.metrics.map(metric),
    sort: sort(definition.sort),
  });
}

function uniqueCanonicalFields(metadata: RemapMetadata) {
  const fields = new Map<string, FieldIdentity>();
  for (const field of [...metadata.fields, ...metadata.calculatedFields]) {
    if (fields.has(field.canonicalName))
      throw new Error(`Target datasource has ambiguous canonical field ${field.canonicalName}.`);
    fields.set(field.canonicalName, field);
  }
  return fields;
}

interface ExpressionField {
  source: FieldIdentity;
  target?: FieldIdentity;
}

function expressionFieldMap(
  sourceFields: FieldIdentity[],
  targetByCanonicalName: ReadonlyMap<string, FieldIdentity>,
) {
  const fields = new Map<string, ExpressionField[]>();
  for (const source of sourceFields) {
    if (!source.columnName) continue;
    const identifier = source.columnName.toLocaleLowerCase('en-US');
    fields.set(identifier, [
      ...(fields.get(identifier) ?? []),
      { source, target: targetByCanonicalName.get(source.canonicalName) },
    ]);
  }
  return fields;
}

function expressionField(identifier: string, fields: ReadonlyMap<string, ExpressionField[]>) {
  const matches = fields.get(identifier.toLocaleLowerCase('en-US'));
  if (!matches) return undefined;
  if (matches.length > 1)
    throw new Error(`Source datasource has ambiguous field identifier ${identifier}.`);
  const [{ source, target }] = matches;
  if (!target)
    throw new Error(
      `Target datasource has no canonical field ${source.canonicalName} for expression identifier ${identifier}.`,
    );
  if (target.columnName) return quoteIdentifier(target.columnName);
  if (target.expression) return `(${target.expression})`;
  throw new Error(
    `Target canonical field ${source.canonicalName} cannot be used in an expression.`,
  );
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
