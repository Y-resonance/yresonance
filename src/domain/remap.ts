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

// Thrown when the target datasource lacks canonical fields the widget needs. Lists every missing
// canonical name at once, so callers can report the full gap instead of one field per attempt.
export class UnmatchedFieldsError extends Error {
  constructor(public readonly canonicalNames: string[]) {
    super(`Target datasource has no canonical field ${canonicalNames.join(', ')}.`);
  }
}

// Points a widget at another datasource by matching every referenced field by canonical name.
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
  const sourceCanonicalNames = new Map(
    [...source.fields, ...source.calculatedFields].map((field) => [field.id, field.canonicalName]),
  );
  const expressionFields = expressionFieldMap(source.fields, targetByCanonicalName);
  const missing = new Set<string>();
  const fieldId = (id: string) => {
    const replacement = fieldIdMap.get(id);
    if (replacement) return replacement;
    missing.add(sourceCanonicalNames.get(id) ?? id);
    return id;
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
                expressionField(identifier, expressionFields, missing),
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

  // Field lookups record gaps instead of throwing, so one error lists every missing field.
  const finish = (value: object) => {
    if (missing.size) throw new UnmatchedFieldsError([...missing]);
    return widgetDefinitionSchema.parse(value);
  };

  if (definition.type === 'control')
    return finish({ ...common, fieldId: fieldId(definition.fieldId) });
  if (definition.type === 'scorecard' || definition.type === 'gauge')
    return finish({ ...common, metric: metric(definition.metric) });
  if (definition.type === 'line')
    return finish({
      ...common,
      dimension: dimension(definition.dimension),
      metrics: definition.metrics.map(metric),
    });
  if (definition.type === 'bar' || definition.type === 'pie')
    return finish({
      ...common,
      metric: metric(definition.metric),
      dimension: dimension(definition.dimension),
      breakdownDimension: definition.breakdownDimension
        ? dimension(definition.breakdownDimension)
        : undefined,
      sort: sort(definition.sort),
    });
  return finish({
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

function expressionField(
  identifier: string,
  fields: ReadonlyMap<string, ExpressionField[]>,
  missing: Set<string>,
) {
  const matches = fields.get(identifier.toLocaleLowerCase('en-US'));
  if (!matches) return undefined;
  if (matches.length > 1)
    throw new Error(`Source datasource has ambiguous field identifier ${identifier}.`);
  const [{ source, target }] = matches;
  if (!target) {
    missing.add(source.canonicalName);
    return undefined;
  }
  if (target.columnName) return quoteIdentifier(target.columnName);
  if (target.expression) return `(${target.expression})`;
  throw new Error(
    `Target canonical field ${source.canonicalName} cannot be used in an expression.`,
  );
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}
