import { env } from 'cloudflare:workers';
import { s3ConnectionSchema } from '#/data/providers/config';
import { loadConnection } from '#/data/connection-store.server';
import { s3Storage } from '#/data/s3.server';
import { externalFileUrl } from '#/data/external-file';
import { createQueryReadBudget, MAX_QUERY_SOURCE_BYTES } from '#/data/internal-r2';
import { collectObjectPages, matchingSourceObjects } from '#/data/listing';
import { hashJson } from '#/domain/hash';
import { compileSourceSqlFromUrls } from '#/query/compiler';
import { describeDataSource, runPreparedQuery } from '#/query/duckdb.server';
import { compileDatasourceQuery } from '#/data/backend-query';
import type { DataSourceRecord } from '#/query/types';
import type { AnalyticsDataBackend } from '#/data/analytics-data-backend';
import { DatasourceError, type DatasourceQuery } from './contract';
import { duckdbFileConnector } from './duckdb-file.server';

export function s3DuckdbBackend(connection = loadConnection): AnalyticsDataBackend {
  async function objects(source: Omit<DataSourceRecord, 'version'>) {
    const config = s3ConnectionSchema.parse(await connection(source));
    const storage = s3Storage(config);
    const location = source.location;
    if (location.kind === 'clickhouse')
      throw new DatasourceError('invalid_query', 'Choose a file source.');
    const files =
      location.kind === 'object'
        ? [await storage.head(location.key)]
        : matchingSourceObjects(
            await collectObjectPages((cursor) => storage.list(location.key, cursor)),
            location.format,
          );
    if (!files.length)
      throw new DatasourceError('datasource_source_not_found', 'No matching files were found.');
    const size = files.reduce((sum, file) => sum + file.size, 0);
    if (size > MAX_QUERY_SOURCE_BYTES)
      throw new DatasourceError(
        'datasource_source_too_large',
        'The source exceeds the 500 MB query limit.',
      );
    return { storage, files, size };
  }
  async function resolve(source: DataSourceRecord, queryId: string) {
    const { storage, files, size } = await objects(source);
    const urls = await Promise.all(
      files.map(async (file) =>
        externalFileUrl(
          await storage.sign(file.key, 'GET'),
          await storage.sign(file.key, 'HEAD'),
          queryId,
          env,
        ),
      ),
    );
    const sql = compileSourceSqlFromUrls(source, urls);
    if (sql.length > 80_000)
      throw new DatasourceError(
        'datasource_source_too_large',
        'This source has too many files for one query. Choose a narrower prefix.',
      );
    await createQueryReadBudget(queryId, source.workspaceId, env);
    return {
      sql,
      sourceBytes: size,
      objectKeys: files.map((file) => file.key),
      queryBudgetId: queryId,
    };
  }
  return {
    ...duckdbFileConnector,
    type: 'duckdb-s3',
    managedUploads: undefined,
    managedStorage: undefined,
    defaultCacheTtlSeconds: () => 300,
    async cacheIdentity(source) {
      const { files } = await objects(source);
      return {
        source: source.location,
        revision: await hashJson(files.map((file) => [file.key, file.etag])),
      };
    },
    async inspect(source) {
      const { files } = await objects(source);
      const version = await hashJson(files.map((file) => [file.key, file.etag]));
      try {
        return { version, ...(await describeDataSource({ ...source, version }, resolve)) };
      } catch {
        throw new DatasourceError(
          'datasource_inspection_failed',
          'DuckDB could not inspect these S3 files. Check the source and read permissions.',
        );
      }
    },
    async executeQuery<T extends Record<string, unknown>>(
      source: DataSourceRecord,
      query: DatasourceQuery,
    ) {
      try {
        return await runPreparedQuery<T>(
          source,
          (sql) => compileDatasourceQuery(source, query, sql),
          resolve,
        );
      } catch {
        throw new DatasourceError(
          'datasource_connector_failed',
          'DuckDB could not query this S3 source.',
        );
      }
    },
  };
}
