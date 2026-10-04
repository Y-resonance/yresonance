import {
  clickhouseRequest,
  clickhouseTableSql,
  managedClickhouseDatabase,
  managedTableName,
} from './clickhouse.server';
import { readSourceObject } from './source.server';
import { clickhouseColumnType, quoteSqlIdentifier } from '#/query/dialect';
import { MAX_DATASOURCE_FILE_BYTES } from '#/domain/datasource-upload';
import type { DataSourceLocation } from '#/domain/schema';
import type { DatasourceInspection } from './connectors/contract';

// Query backends need not implement ingestion. Only claimed, workspace-scoped uploads reach here.
export async function ingestClickhouseUpload(
  workspaceId: string,
  id: string,
  key: string,
  inspection: DatasourceInspection,
) {
  const database = managedClickhouseDatabase();
  const table = await managedTableName(workspaceId, id);
  const source = clickhouseTableSql(database, table);
  const columns = inspection.description
    .map(
      (column) =>
        `${quoteSqlIdentifier(column.column_name, 'clickhouse')} ${clickhouseColumnType(column.column_type)}`,
    )
    .join(', ');
  await clickhouseRequest(
    workspaceId,
    `CREATE DATABASE IF NOT EXISTS ${quoteSqlIdentifier(database, 'clickhouse')}`,
    [],
    { readonly: false },
  );
  try {
    await clickhouseRequest(
      workspaceId,
      `CREATE TABLE ${source} (${columns}) ENGINE = MergeTree ORDER BY tuple()`,
      [],
      { readonly: false },
    );
    const body = await readSourceObject(key, MAX_DATASOURCE_FILE_BYTES);
    await clickhouseRequest(workspaceId, `INSERT INTO ${source} FORMAT Parquet`, [], {
      body,
      readonly: false,
    });
    return {
      kind: 'clickhouse',
      database,
      table,
      ownership: 'managed',
      cacheTtlSeconds: 300,
    } satisfies DataSourceLocation;
  } catch (error) {
    await removeClickhouseUpload(workspaceId, database, table).catch(() => undefined);
    throw error;
  }
}

export async function removeClickhouseUpload(workspaceId: string, database: string, table: string) {
  await clickhouseRequest(
    workspaceId,
    `DROP TABLE IF EXISTS ${clickhouseTableSql(database, table)}`,
    [],
    { readonly: false },
  );
}
