import { detectFieldSemantics } from '#/domain/field-metadata';
import { type DataSourceRecord } from '#/query/types';
import { datasourceConnector } from '#/data/connectors/index.server';
import { type DatasourceExpression, DatasourceError } from '#/data/connectors/contract';
import { ApiError } from './errors';

export function seedField(
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

export function slug(value: string) {
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

export function connectorFor(dataSource: DataSourceRecord | string) {
  try {
    return datasourceConnector(dataSource);
  } catch (error) {
    throwDatasourceError(error);
  }
}

export async function datasourceOperation<T>(operation: () => T | Promise<T>) {
  try {
    return await operation();
  } catch (error) {
    throwDatasourceError(error);
  }
}

export async function libraryMetricApplies(
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
    datasource_access_denied: 403,
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
    console.warn('yresonance.datasource_connector_failed', { error: error.message });
    throw new ApiError(status, error.code, 'The query service is unavailable. Try again.');
  }
  throw new ApiError(status, error.code, error.message);
}

export function normalize(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalize(item)]));
  return value;
}
