import type { SqlDialect } from '#/query/dialect';
import { quoteSqlIdentifier } from '#/query/dialect';
import { controlOptionsQuery } from '#/domain/control-options';
import {
  compileWidgetQuery,
  validateAggregateFormula,
  validateRowFormula,
  type CompiledQuery,
} from '#/query/compiler';
import type { DataSourceRecord } from '#/query/types';
import type {
  DatasourceExpression,
  DatasourceQuery,
  WidgetDatasourceQuery,
} from './connectors/contract';

export function compileDatasourceQuery(
  dataSource: DataSourceRecord,
  query: DatasourceQuery,
  sourceSql: string,
  dialect?: SqlDialect,
) {
  if (query.kind === 'widget')
    return compileDatasourceWidget(dataSource, query, sourceSql, dialect);
  const expression =
    'columnName' in query.field
      ? quoteSqlIdentifier(query.field.columnName, dialect)
      : `(${validateRowFormula(query.field.expression, { ...query.metadata, dialect }, query.field.semanticType, query.field.formulaDialect).sql})`;
  return controlOptionsQuery(expression, query.search, query.direction, sourceSql, dialect);
}

export function compileDatasourceWidget(
  dataSource: DataSourceRecord,
  query: WidgetDatasourceQuery,
  sourceSql: string,
  dialect?: SqlDialect,
): CompiledQuery {
  return compileWidgetQuery({
    dashboard: query.dashboard,
    definition: query.definition,
    dataSource,
    ...query.metadata,
    controlState: query.controlState,
    bucketName: '',
    sourceSql,
    dialect,
    resolvedControls: query.resolvedControls,
    offset: query.offset,
    scaleBounds: query.scaleBounds,
    dateBucketTarget: query.dateBucketTarget,
  });
}

export function datasourceExpressionSql(definition: DatasourceExpression, dialect?: SqlDialect) {
  if (definition.kind === 'libraryMetric')
    return validateAggregateFormula(
      definition.expression,
      { ...definition.metadata, dialect },
      definition.semanticType,
      definition.formulaDialect,
    ).sql;
  const calculatedFields = [
    ...definition.metadata.calculatedFields.filter((field) => field.id !== definition.id),
    {
      id: definition.id ?? '__candidate__',
      dataSourceId: '',
      canonicalName: definition.canonicalName,
      label: definition.canonicalName,
      expression: definition.expression,
      formulaDialect: definition.formulaDialect,
      role: 'dimension' as const,
      semanticType: definition.semanticType,
      description: null,
    },
  ];
  return validateRowFormula(
    definition.expression,
    { fields: definition.metadata.fields, calculatedFields, dialect },
    definition.semanticType,
    definition.formulaDialect,
  ).sql;
}

// Binder checks use the real datasource schema, but never scan its rows. An extra
// aggregate rejects row references in metrics; WHERE rejects aggregates in row formulas.
export function expressionValidationQuery(
  definition: DatasourceExpression,
  sourceSql: string,
  dialect?: SqlDialect,
) {
  const expression = datasourceExpressionSql(definition, dialect);
  const numeric = ['count', 'currency', 'ratio'].includes(definition.semanticType);
  const value = numeric ? `(${expression}) + 0` : expression;
  return {
    sql:
      definition.kind === 'libraryMetric'
        ? `SELECT ${value} AS value, COUNT(*) AS __aggregate FROM ${sourceSql} WHERE FALSE LIMIT 0`
        : `SELECT ${value} AS value FROM ${sourceSql} WHERE FALSE AND (${expression}) IS NULL LIMIT 0`,
    parameters: [],
  };
}

export function queryFormulaDefinitions(query: DatasourceQuery) {
  if (query.kind === 'controlOptions') return query.metadata.calculatedFields;
  const definition = query.definition;
  const metrics =
    'metrics' in definition
      ? definition.metrics
      : 'metric' in definition
        ? [definition.metric]
        : [];
  const libraryIds = new Set([
    ...metrics.flatMap((metric) =>
      metric.source.kind === 'library' ? [metric.source.libraryMetricId] : [],
    ),
    ...(definition.type === 'gauge' && definition.upperLimit?.kind === 'library'
      ? [definition.upperLimit.libraryMetricId]
      : []),
  ]);
  return [
    ...query.metadata.calculatedFields,
    ...query.metadata.libraryMetrics.filter((metric) => libraryIds.has(metric.id)),
    ...metrics.flatMap((metric) => (metric.source.kind === 'expression' ? [metric.source] : [])),
  ];
}

export function hasNativeFormulas(query: WidgetDatasourceQuery) {
  return queryFormulaDefinitions(query).some((formula) => formula.formulaDialect);
}
