import type { DataSourceRecord } from '#/query/types';
import type { DatasourceQuery } from './contract';
import type { AnalyticsDataBackend } from '#/data/analytics-data-backend';
import {
  compileDatasourceQuery,
  compileDatasourceWidget,
  datasourceExpressionSql,
} from '#/data/backend-query';
import {
  authorizedClickhouseTable,
  clickhouseRequest,
  clickhouseTableSql,
  normalizeClickhouseRows,
} from '#/data/clickhouse.server';
import { hashJson } from '#/domain/hash';
import { DatasourceError } from './contract';
import { ingestClickhouseUpload, removeClickhouseUpload } from '#/data/clickhouse-ingestion.server';
import { deleteSourceObject } from '#/data/source.server';

interface ClickhouseConnection {
  type: string;
  table(dataSource: Omit<DataSourceRecord, 'version'>): Promise<string>;
  request(
    dataSource: Omit<DataSourceRecord, 'version'>,
    sql: string,
    parameters?: unknown[],
  ): ReturnType<typeof clickhouseRequest>;
}

export function createClickhouseBackend(connection: ClickhouseConnection): AnalyticsDataBackend {
  return {
    type: connection.type,
    defaultCacheTtlSeconds: (source) =>
      source.location.kind === 'clickhouse' && source.location.ownership === 'external'
        ? source.location.cacheTtlSeconds
        : 86400,
    async cacheIdentity(dataSource) {
      await connection.table(dataSource);
      return {
        source: dataSource.location,
        revision:
          dataSource.location.kind === 'clickhouse' && dataSource.location.ownership === 'managed'
            ? dataSource.version
            : undefined,
      };
    },
    async inspect(dataSource) {
      const source = await connection.table(dataSource);
      const description = await connection.request(
        dataSource,
        `DESCRIBE TABLE ${source} FORMAT JSON`,
      );
      const samples = await connection.request(
        dataSource,
        `SELECT * FROM ${source} LIMIT 5 FORMAT JSON`,
      );
      if (!description || !samples)
        throw new DatasourceError(
          'datasource_inspection_failed',
          'ClickHouse could not inspect this table.',
        );
      const columns = description.data.map((column) => ({
        column_name: String(column.name),
        column_type: String(column.type),
      }));
      return {
        // This fingerprints schema, not mutable external contents. The shared cache uses a TTL.
        version: await hashJson({ source: dataSource.location, columns }),
        description: columns,
        samples: normalizeClickhouseRows(samples),
      };
    },
    async executeQuery<T extends Record<string, unknown>>(
      dataSource: DataSourceRecord,
      query: DatasourceQuery,
    ) {
      const source = await connection.table(dataSource);
      const compiled = compileDatasourceQuery(dataSource, query, source, 'clickhouse');
      const result = await connection.request(
        dataSource,
        `${compiled.sql} FORMAT JSON`,
        compiled.parameters,
      );
      if (!result)
        throw new DatasourceError(
          'datasource_connector_failed',
          'ClickHouse returned no query result.',
        );
      return normalizeClickhouseRows(result) as T[];
    },
    async validateQuery(dataSource, query) {
      const source = await connection.table(dataSource);
      try {
        compileDatasourceWidget(dataSource, query, source, 'clickhouse');
      } catch {
        throw new DatasourceError('invalid_query', 'The widget query is invalid.');
      }
    },
    explainQuery(dataSource, query) {
      if (dataSource.location.kind !== 'clickhouse')
        throw new DatasourceError('invalid_query', 'ClickHouse requires a table source.');
      const compiled = compileDatasourceWidget(
        dataSource,
        query,
        clickhouseTableSql(dataSource.location.database, dataSource.location.table),
        'clickhouse',
      );
      return { sql: compiled.sql, definitions: compiled.definitions };
    },
    async validateExpression(dataSource, expression) {
      await connection.table(dataSource);
      try {
        datasourceExpressionSql(expression, 'clickhouse');
      } catch (error) {
        throw new DatasourceError(
          'invalid_query',
          error instanceof Error ? error.message : 'Invalid formula.',
        );
      }
    },
  };
}

export const clickhouseBackend: AnalyticsDataBackend = {
  ...createClickhouseBackend({
    type: 'clickhouse',
    table: authorizedClickhouseTable,
    request: (dataSource, sql, parameters) =>
      clickhouseRequest(dataSource.workspaceId, sql, parameters),
  }),
  managedUploads: {
    async import(dataSource) {
      // Querying external tables does not need the DuckDB ingestion runtime.
      const [{ duckdbFileConnector }, { importManagedFile }] = await Promise.all([
        import('./duckdb-file.server'),
        import('#/data/file-ingestion.server'),
      ]);
      const file = await importManagedFile(
        { ...dataSource, connectorType: duckdbFileConnector.type },
        duckdbFileConnector.inspect,
      );
      const fileLocation = file.dataSource.location;
      if (fileLocation.kind !== 'object') throw new Error('Managed upload requires a file object.');
      try {
        const location = await ingestClickhouseUpload(
          dataSource.workspaceId,
          dataSource.id,
          fileLocation.key,
          file.inspection,
        );
        return {
          dataSource: { ...file.dataSource, connectorType: 'clickhouse', location },
          inspection: file.inspection,
          async cleanup(outcome) {
            try {
              if (outcome === 'failed')
                await removeClickhouseUpload(
                  dataSource.workspaceId,
                  location.database,
                  location.table,
                );
              else await deleteSourceObject(fileLocation.key);
            } finally {
              await file.cleanup(outcome);
            }
          },
        };
      } catch (error) {
        await file.cleanup('failed').catch(() => undefined);
        throw error;
      }
    },
  },
};
