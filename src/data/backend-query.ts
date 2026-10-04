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
      : `(${validateRowFormula(query.field.expression, { ...query.metadata, dialect }).sql})`;
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
    dateBucketTarget: query.dateBucketTarget,
  });
}

export function datasourceExpressionSql(definition: DatasourceExpression, dialect?: SqlDialect) {
  if (definition.kind === 'libraryMetric')
    return validateAggregateFormula(
      definition.expression,
      { ...definition.metadata, dialect },
      definition.semanticType,
    ).sql;
  const calculatedFields = [
    ...definition.metadata.calculatedFields.filter((field) => field.id !== definition.id),
    {
      id: definition.id ?? '__candidate__',
      dataSourceId: '',
      canonicalName: definition.canonicalName,
      label: definition.canonicalName,
      expression: definition.expression,
      role: 'dimension' as const,
      semanticType: definition.semanticType,
      description: null,
    },
  ];
  return validateRowFormula(
    definition.expression,
    { fields: definition.metadata.fields, calculatedFields, dialect },
    definition.semanticType,
  ).sql;
}
