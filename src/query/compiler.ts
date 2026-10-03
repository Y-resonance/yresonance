import { quoteSqlIdentifier, type SqlDialect } from './dialect';
import type {
  Aggregation,
  ControlState,
  DashboardDocument,
  SemanticType,
  WidgetDefinition,
} from '#/domain/schema';
import { resolveDateRange } from '#/domain/dates';
import { resolveDateGranularity } from '#/domain/date-granularity';
import type {
  CalculatedFieldRecord,
  DataSourceRecord,
  FieldRecord,
  LibraryMetricRecord,
} from './types';
import {
  compileFormula,
  formulaIdentifiers,
  formulaTypeForSemanticType,
  type FormulaField,
  type FormulaType,
} from './formula';

export interface QueryContext {
  dashboard: DashboardDocument;
  definition: WidgetDefinition;
  dataSource: DataSourceRecord;
  fields: FieldRecord[];
  calculatedFields: CalculatedFieldRecord[];
  libraryMetrics: LibraryMetricRecord[];
  controlState: ControlState;
  bucketName: string;
  sourceSql?: string;
  resolvedControls?: Array<{ fieldId: string; values: unknown[] }>;
  offset?: number;
  dateBucketTarget?: number;
  dialect?: SqlDialect;
}

export interface CompiledQuery {
  sql: string;
  parameters: unknown[];
  definitions: Array<{ name: string; expression: string; description: string | null }>;
}

export function compileWidgetQuery(context: QueryContext): CompiledQuery {
  const definition = context.definition;
  if (!('dateRangeFieldId' in definition))
    throw new Error('This widget does not query a datasource.');
  const dimensions = widgetDimensions(definition);
  const metrics = widgetMetrics(definition);
  const dateRange = context.controlState.dateRange ?? context.dashboard.defaultDateRange;
  const resolved = resolveDateRange(dateRange, context.dashboard.timezone);
  const dimensionExpressions = dimensions.map((dimension) =>
    dimensionExpression(dimension, context, resolved),
  );
  const definitions: CompiledQuery['definitions'] = [];
  const select = [
    ...dimensionExpressions.map(
      (expression, index) =>
        `${expression} AS ${quoteSqlIdentifier(`dimension_${index + 1}`, context.dialect)}`,
    ),
    ...metrics.map((metric, index) => {
      const compiled = metricExpression(metric, context, definitions);
      return `${compiled} AS ${quoteIdentifier(`metric_${index + 1}`)}`;
    }),
    ...(definition.type === 'gauge' && definition.upperLimit?.kind === 'library'
      ? [
          `${metricExpression(
            {
              source: { kind: 'library', libraryMetricId: definition.upperLimit.libraryMetricId },
              dataType: 'number',
            },
            context,
            definitions,
          )} AS "upper_limit"`,
        ]
      : []),
  ];
  const parameters: unknown[] = [];
  const conditions: string[] = [];
  conditions.push(`${fieldExpression(definition.dateRangeFieldId, context)} BETWEEN ? AND ?`);
  parameters.push(resolved.start, resolved.end);
  if (definition.filter) conditions.push(compileFilter(definition.filter, context, parameters));
  for (const control of context.resolvedControls ?? []) {
    if (!control.values.length) continue;
    const field = fieldExpression(control.fieldId, context);
    parameters.push(...control.values);
    conditions.push(`${field} IN (${control.values.map(() => '?').join(', ')})`);
  }
  const source = context.sourceSql
    ? context.sourceSql
    : compileSourceSql(context.dataSource, context.bucketName);
  const tableRowDimensions = definition.type === 'table' ? definition.dimensions : [];
  const pivotPosition =
    definition.type === 'table' && definition.pivotDimension ? dimensions.length : undefined;
  const groupedTable =
    definition.type === 'table' &&
    tableRowDimensions.length > 0 &&
    (definition.showSummaryRow || (definition.showSubtotals && tableRowDimensions.length > 1));
  if (groupedTable) {
    select.push(
      `GROUPING(${dimensionExpressions.slice(0, tableRowDimensions.length).join(', ')}) AS "__grouping"`,
    );
  }
  const dimensionPositions = dimensions.map((_, index) =>
    context.dialect === 'clickhouse' ? dimensionExpressions[index] : index + 1,
  );
  const pivotPositions = pivotPosition === undefined ? [] : [dimensionPositions[pivotPosition - 1]];
  const groupingSets = groupedTable
    ? [
        `(${dimensionPositions.join(', ')})`,
        ...(definition.type === 'table' && definition.showSubtotals && tableRowDimensions.length > 1
          ? [`(${[dimensionPositions[0], ...pivotPositions].join(', ')})`]
          : []),
        ...(definition.type === 'table' && definition.showSummaryRow
          ? [`(${pivotPositions.join(', ')})`]
          : []),
      ]
    : [];
  const groupBy = dimensions.length
    ? groupedTable
      ? ` GROUP BY GROUPING SETS (${groupingSets.join(', ')})`
      : ` GROUP BY ${dimensionPositions.join(', ')}`
    : '';
  const explicitSort =
    'sort' in definition && definition.sort?.length
      ? compileSort(definition.sort, dimensions)
      : undefined;
  const stableDimensions = dimensions.map((_, index) => `${index + 1} ASC`).join(', ');
  const order = groupedTable
    ? [
        tableRowDimensions.length > 1 ? '1 ASC' : undefined,
        '"__grouping" ASC',
        explicitSort,
        stableDimensions,
      ]
        .filter(Boolean)
        .join(', ')
    : [explicitSort, stableDimensions].filter(Boolean).join(', ');
  const orderBy = order ? ` ORDER BY ${order}` : '';
  const limit = widgetLimit(definition);
  return {
    sql: `SELECT ${select.join(', ')} FROM ${source} WHERE ${conditions.join(' AND ')}${groupBy}${orderBy}${limit ? ` LIMIT ${context.offset === undefined ? limit : limit + 1}` : ''}${context.offset ? ` OFFSET ${context.offset}` : ''}`,
    parameters,
    definitions,
  };
}

function dimensionExpression(
  dimension: ReturnType<typeof widgetDimensions>[number],
  context: QueryContext,
  range: { start: string; end: string },
) {
  const expression = fieldExpression(dimension.fieldId, context);
  const field = [...context.fields, ...context.calculatedFields].find(
    (candidate) => candidate.id === dimension.fieldId,
  );
  if (field?.semanticType !== 'date') return expression;
  const granularity = resolveDateGranularity(
    dimension.dateGranularity ?? (context.definition.type === 'table' ? 'raw' : 'auto'),
    range,
    context.dateBucketTarget ?? 60,
  );
  return granularity === 'raw' ? expression : `DATE_TRUNC('${granularity}', ${expression})`;
}

function widgetDimensions(definition: WidgetDefinition) {
  if (definition.type === 'line') return [definition.dimension];
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
  return definition.type === 'line' || definition.type === 'table' ? definition.metrics : [];
}

function metricExpression(
  metric: ReturnType<typeof widgetMetrics>[number],
  context: QueryContext,
  definitions: CompiledQuery['definitions'],
) {
  if (metric.source.kind === 'field') {
    assertAggregationType(metric.source.aggregation, metric.source.fieldId, context);
    const expression = fieldExpression(metric.source.fieldId, context);
    if (metric.source.aggregation === 'median' && context.dialect === 'clickhouse') {
      return `((quantileExactLow(0.5)(${expression}) + quantileExactHigh(0.5)(${expression})) / 2)`;
    }
    const aggregation = {
      sum: 'SUM',
      average: 'AVG',
      count: 'COUNT',
      countDistinct: 'COUNT(DISTINCT',
      min: 'MIN',
      max: 'MAX',
      median: 'MEDIAN',
      standardDeviation: context.dialect === 'clickhouse' ? 'stddevSamp' : 'STDDEV_SAMP',
      variance: context.dialect === 'clickhouse' ? 'varSamp' : 'VAR_SAMP',
    }[metric.source.aggregation];
    return metric.source.aggregation === 'countDistinct'
      ? `COUNT(DISTINCT ${expression})`
      : `${aggregation}(${expression})`;
  }
  if (metric.source.kind === 'expression') {
    const compiled = compileFormula(metric.source.expression, {
      mode: 'aggregate',
      fields: formulaFields(context),
      dialect: context.dialect,
    });
    assertNumericMetric(compiled.type, 'Widget expression');
    definitions.push({
      name: metric.userDefinedName ?? 'Widget expression',
      expression: metric.source.expression,
      description: null,
    });
    return compiled.sql;
  }
  const libraryMetricId = metric.source.libraryMetricId;
  const library = context.libraryMetrics.find((item) => item.id === libraryMetricId);
  if (!library) throw new Error(`Unknown library metric ${libraryMetricId}.`);
  definitions.push({
    name: library.name,
    expression: library.expression,
    description: library.description,
  });
  const compiled = compileFormula(library.expression, {
    mode: 'aggregate',
    fields: formulaFields(context),
    dialect: context.dialect,
  });
  assertNumericMetric(compiled.type, `Library metric ${library.name}`);
  return compiled.sql;
}

function fieldExpression(fieldId: string, context: QueryContext) {
  const field = context.fields.find((item) => item.id === fieldId);
  if (field) {
    const identifier = quoteSqlIdentifier(field.columnName, context.dialect);
    return field.castTo ? `CAST(${identifier} AS ${safeCast(field.castTo)})` : identifier;
  }
  const calculated = context.calculatedFields.find((item) => item.id === fieldId);
  if (!calculated) throw new Error(`Unknown field ${fieldId}.`);
  const resolved = formulaFields(context).find(
    (field) =>
      field.canonicalName.toLocaleLowerCase('en-US') ===
      calculated.canonicalName.toLocaleLowerCase('en-US'),
  );
  if (!resolved) throw new Error(`Unknown calculated field ${calculated.canonicalName}.`);
  return resolved.sql;
}

export function compileLibraryExpression(
  expression: string,
  context: Pick<QueryContext, 'fields' | 'calculatedFields' | 'dialect'>,
) {
  return validateAggregateFormula(expression, context).sql;
}

export function validateAggregateFormula(
  expression: string,
  context: Pick<QueryContext, 'fields' | 'calculatedFields' | 'dialect'>,
  semanticType?: SemanticType,
) {
  const compiled = compileFormula(expression, {
    mode: 'aggregate',
    fields: formulaFields(context),
    dialect: context.dialect,
  });
  const expected = semanticType ? formulaTypeForSemanticType(semanticType) : undefined;
  if (expected && compiled.type !== expected && compiled.type !== 'null')
    throw new Error(
      `Formula returns ${compiled.type}, but ${semanticType} metrics require ${expected}.`,
    );
  return compiled;
}

export function validateRowFormula(
  expression: string,
  context: Pick<QueryContext, 'fields' | 'calculatedFields' | 'dialect'>,
  semanticType?: SemanticType,
) {
  const compiled = compileFormula(expression, {
    mode: 'row',
    fields: formulaFields(context),
    dialect: context.dialect,
  });
  const expected = semanticType ? formulaTypeForSemanticType(semanticType) : undefined;
  if (expected && compiled.type !== expected && compiled.type !== 'null')
    throw new Error(
      `Formula returns ${compiled.type}, but ${semanticType} fields require ${expected}.`,
    );
  return compiled;
}

function compileFilter(
  filter: NonNullable<Extract<WidgetDefinition, { type: 'table' }>['filter']>,
  context: QueryContext,
  parameters: unknown[],
) {
  const conditions = filter.conditions.map((condition) => {
    const field = fieldExpression(condition.fieldId, context);
    if (condition.operator === 'isEmpty')
      return `(${field} IS NULL OR ${context.dialect === 'clickhouse' ? `toString(${field})` : field} = '')`;
    if (condition.operator === 'isNotEmpty')
      return `(${field} IS NOT NULL AND ${context.dialect === 'clickhouse' ? `toString(${field})` : field} <> '')`;
    const operators = {
      equals: '=',
      notEquals: '<>',
      greaterThan: '>',
      greaterThanOrEqual: '>=',
      lessThan: '<',
      lessThanOrEqual: '<=',
    } as const;
    if (condition.operator in operators) {
      parameters.push(condition.value);
      return `${field} ${operators[condition.operator as keyof typeof operators]} ?`;
    }
    if (condition.operator === 'contains' || condition.operator === 'notContains') {
      parameters.push(`%${String(condition.value ?? '')}%`);
      return `${field} ${condition.operator === 'notContains' ? 'NOT ' : ''}ILIKE ?`;
    }
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    if (!values.length) return condition.operator === 'in' ? 'FALSE' : 'TRUE';
    parameters.push(...values);
    return `${field} ${condition.operator === 'notIn' ? 'NOT ' : ''}IN (${values.map(() => '?').join(', ')})`;
  });
  return `(${conditions.join(filter.connector === 'or' ? ' OR ' : ' AND ') || 'TRUE'})`;
}

function compileSort(
  sort: NonNullable<Extract<WidgetDefinition, { type: 'table' }>['sort']>,
  dimensions: ReturnType<typeof widgetDimensions>,
) {
  return sort
    .map((item) => {
      if (item.target.kind === 'metric')
        return `${dimensions.length + item.target.index + 1} ${item.direction.toUpperCase()}`;
      const fieldId = item.target.fieldId;
      const position = dimensions.findIndex((dimension) => dimension.fieldId === fieldId) + 1;
      if (position < 1) throw new Error(`Cannot sort by unknown dimension ${fieldId}.`);
      return `${position} ${item.direction.toUpperCase()}`;
    })
    .join(', ');
}

function widgetLimit(definition: WidgetDefinition) {
  if (definition.type === 'table') return definition.resultLimit.amount;
  if (definition.type === 'bar' || definition.type === 'pie') return definition.limit;
  return undefined;
}

export function compileSourceSql(dataSource: DataSourceRecord, bucketName: string) {
  return compileSourceSqlFromBaseUrl(dataSource, `r2://${bucketName}`);
}

export function compileSourceSqlFromBaseUrl(
  dataSource: DataSourceRecord,
  baseUrl: string,
  objectKeys?: string[],
) {
  if (dataSource.location.kind === 'clickhouse') throw new Error('File source required.');
  const key =
    dataSource.location.kind === 'prefix'
      ? `${dataSource.location.key}*.${dataSource.location.format}`
      : dataSource.location.key;
  const keys = objectKeys ?? [key];
  return compileSourceSqlFromUrls(
    dataSource,
    keys.map((objectKey) => sourceUrl(baseUrl, objectKey)),
  );
}

export function compileSourceSqlFromUrls(dataSource: DataSourceRecord, urls: string[]) {
  if (dataSource.location.kind === 'clickhouse') throw new Error('File source required.');
  const uris = urls.map((url) => sqlString(url));
  const source = uris.length === 1 ? uris[0] : `[${uris.join(', ')}]`;
  return dataSource.location.format === 'csv'
    ? `read_csv_auto(${source}, header = true)`
    : `read_parquet(${source})`;
}

function sourceUrl(baseUrl: string, key: string) {
  const base = baseUrl.replace(/\/$/u, '');
  if (base.startsWith('r2://')) return `${base}/${key}`;
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
function sqlString(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
function safeCast(value: string) {
  if (!/^[A-Z][A-Z0-9_]*(?:\([0-9, ]+\))?$/iu.test(value))
    throw new Error(`Invalid cast type ${value}.`);
  return value;
}

function rawFormulaFields(fields: FieldRecord[], dialect?: SqlDialect): FormulaField[] {
  return fields.map((field) => ({
    canonicalName: field.canonicalName,
    sql: field.castTo
      ? `CAST(${quoteSqlIdentifier(field.columnName, dialect)} AS ${safeCast(field.castTo)})`
      : quoteSqlIdentifier(field.columnName, dialect),
    type: formulaTypeForSemanticType(field.semanticType),
  }));
}

export function formulaFields(
  context: Pick<QueryContext, 'fields' | 'calculatedFields' | 'dialect'>,
): FormulaField[] {
  const raw = rawFormulaFields(context.fields, context.dialect);
  const rawNames = new Set(raw.map((field) => field.canonicalName.toLocaleLowerCase('en-US')));
  const calculatedByName = new Map<string, CalculatedFieldRecord>();
  for (const field of context.calculatedFields) {
    const key = field.canonicalName.toLocaleLowerCase('en-US');
    // Keep reading legacy data that predates collision checks. Raw fields have always won.
    if (rawNames.has(key)) continue;
    if (calculatedByName.has(key))
      throw new Error(`Calculated field name ${field.canonicalName} is ambiguous.`);
    calculatedByName.set(key, field);
  }
  const resolved = new Map<string, FormulaField>();
  const resolving: string[] = [];

  const resolve = (key: string): FormulaField => {
    const cached = resolved.get(key);
    if (cached) return cached;
    const cycleStart = resolving.indexOf(key);
    if (cycleStart >= 0) {
      const cycle = [...resolving.slice(cycleStart), key].map(
        (name) => calculatedByName.get(name)?.canonicalName ?? name,
      );
      throw new Error(`Calculated field cycle: ${cycle.join(' -> ')}.`);
    }
    const field = calculatedByName.get(key);
    if (!field) throw new Error(`Unknown calculated field ${key}.`);
    resolving.push(key);
    try {
      for (const identifier of formulaIdentifiers(field.expression)) {
        const dependency = identifier.toLocaleLowerCase('en-US');
        if (calculatedByName.has(dependency)) resolve(dependency);
      }
      const compiled = compileFormula(field.expression, {
        mode: 'row',
        fields: [...raw, ...resolved.values()],
        dialect: context.dialect,
      });
      const result: FormulaField = {
        canonicalName: field.canonicalName,
        sql: `(${compiled.sql})`,
        type: compiled.type,
      };
      resolved.set(key, result);
      return result;
    } finally {
      resolving.pop();
    }
  };

  for (const key of calculatedByName.keys()) resolve(key);
  return [...raw, ...resolved.values()];
}

export function assertCalculatedFieldNameAvailable(
  canonicalName: string,
  context: Pick<QueryContext, 'fields' | 'calculatedFields' | 'dialect'>,
  editingId?: string,
) {
  const key = canonicalName.toLocaleLowerCase('en-US');
  const raw = context.fields.find(
    (field) => field.canonicalName.toLocaleLowerCase('en-US') === key,
  );
  if (raw) throw new Error(`Field ID ${canonicalName} is already used by raw field ${raw.label}.`);
  const calculated = context.calculatedFields.find(
    (field) => field.id !== editingId && field.canonicalName.toLocaleLowerCase('en-US') === key,
  );
  if (calculated)
    throw new Error(`Field ID ${canonicalName} is already used by ${calculated.label}.`);
}

function assertAggregationType(
  aggregation: Aggregation,
  fieldId: string,
  context: Pick<QueryContext, 'fields' | 'calculatedFields' | 'dialect'>,
) {
  if (aggregation === 'count' || aggregation === 'countDistinct') return;
  const field = context.fields.find((item) => item.id === fieldId);
  const calculated = context.calculatedFields.find((item) => item.id === fieldId);
  const type = field
    ? formulaTypeForSemanticType(field.semanticType)
    : calculated
      ? formulaFields(context).find(
          (candidate) =>
            candidate.canonicalName.toLocaleLowerCase('en-US') ===
            calculated.canonicalName.toLocaleLowerCase('en-US'),
        )?.type
      : undefined;
  if (!type) throw new Error(`Unknown field ${fieldId}.`);
  if (type !== 'number')
    throw new Error(`${aggregation} requires a numeric field, received ${type}.`);
}

function assertNumericMetric(type: FormulaType, name: string) {
  if (type !== 'number') throw new Error(`${name} must return a number, received ${type}.`);
}
