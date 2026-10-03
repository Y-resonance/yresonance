import {
  compileDatasourceQuery,
  compileDatasourceWidget,
  datasourceExpressionSql,
} from '#/data/backend-query';
import type { AnalyticsDataBackend } from '#/data/analytics-data-backend';
import { collectObjectPages, matchingSourceObjects } from '#/data/listing';
import { headSourceObject, listSourceObjects } from '#/data/source.server';
import { hashJson } from '#/domain/hash';
import { describeDataSource, QueryEngineError, runPreparedQuery } from '#/query/duckdb.server';
import type { DataSourceRecord } from '#/query/types';
import { DatasourceError, DUCKDB_FILE_CONNECTOR, type DatasourceQuery } from './contract';

export const duckdbFileConnector: AnalyticsDataBackend = {
  type: DUCKDB_FILE_CONNECTOR,
  cacheIdentity(dataSource) {
    return { source: dataSource.location, revision: dataSource.version };
  },

  async inspect(dataSource, options) {
    try {
      const { location } = dataSource;
      if (location.kind === 'clickhouse')
        throw new DatasourceError('invalid_query', 'DuckDB requires a file source.');
      const objects =
        location.kind === 'object'
          ? [await headSourceObject(location.key)].filter((object) => object !== null)
          : matchingSourceObjects(
              await collectObjectPages((cursor) => listSourceObjects(location.key, cursor)),
              location.format,
            );
      if (!objects.length)
        throw new DatasourceError(
          'datasource_source_not_found',
          'No matching datasource files were found.',
        );
      const maximumObjectBytes = options?.maximumObjectBytes;
      if (
        maximumObjectBytes !== undefined &&
        objects.some((object) => object.size > maximumObjectBytes)
      )
        throw new DatasourceError(
          'datasource_source_too_large',
          'The uploaded file is larger than 100 MB.',
        );
      const version = await hashJson(objects.map((object) => [object.key, object.etag]));
      return { version, ...(await describeDataSource({ ...dataSource, version })) };
    } catch (error) {
      if (error instanceof DatasourceError) throw error;
      throw new DatasourceError(
        'datasource_inspection_failed',
        error instanceof Error ? error.message : 'DuckDB could not inspect this datasource.',
        { cause: error },
      );
    }
  },

  async executeQuery<T extends Record<string, unknown>>(
    dataSource: DataSourceRecord,
    query: DatasourceQuery,
  ) {
    try {
      return await runPreparedQuery<T>(dataSource, (sourceSql) =>
        compileDatasourceQuery(dataSource, query, sourceSql),
      );
    } catch (error) {
      throw connectorError(error);
    }
  },

  async validateQuery(dataSource, query) {
    try {
      compileDatasourceWidget(dataSource, query, quoteIdentifier('yresonance_source'));
    } catch (error) {
      throw connectorError(error, 'invalid_query');
    }
  },

  explainQuery(dataSource, query) {
    try {
      const compiled = compileDatasourceWidget(
        dataSource,
        query,
        quoteIdentifier('yresonance_source'),
      );
      return { sql: compiled.sql, definitions: compiled.definitions };
    } catch (error) {
      throw connectorError(error, 'invalid_query');
    }
  },

  async validateExpression(_dataSource, definition) {
    try {
      datasourceExpressionSql(definition);
    } catch (error) {
      throw connectorError(error, 'invalid_query');
    }
  },
};

function connectorError(
  error: unknown,
  fallbackCode: 'invalid_query' | 'datasource_connector_failed' = 'datasource_connector_failed',
) {
  if (error instanceof DatasourceError) return error;
  if (error instanceof QueryEngineError && error.kind === 'invalid-query')
    return new DatasourceError('invalid_query', error.message, { cause: error });
  return new DatasourceError(
    error instanceof QueryEngineError ? 'datasource_connector_failed' : fallbackCode,
    error instanceof Error ? error.message : 'The datasource connector failed.',
    { cause: error },
  );
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}
