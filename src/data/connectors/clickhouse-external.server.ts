import { clickhouseConnectionSchema } from '#/data/providers/config';
import { loadConnection } from '#/data/connection-store.server';
import { clickhouseRequest, clickhouseTableSql } from '#/data/clickhouse.server';
import { createClickhouseBackend } from './clickhouse.server';
import { DatasourceError } from './contract';
import type { DataSourceRecord } from '#/query/types';

export function externalClickhouseBackend(connection = loadConnection) {
  return createClickhouseBackend({
    type: 'clickhouse-external',
    async table(source) {
      await connection(source);
      if (source.location.kind !== 'clickhouse' || source.location.ownership !== 'external')
        throw new DatasourceError('invalid_query', 'Choose an external ClickHouse table.');
      return clickhouseTableSql(source.location.database, source.location.table);
    },
    async request(source: Omit<DataSourceRecord, 'version'>, sql, parameters) {
      const config = clickhouseConnectionSchema.parse(await connection(source));
      return clickhouseRequest(source.workspaceId, sql, parameters, {
        readonly: true,
        connection: {
          url: `https://${config.host}:${config.port}/`,
          user: config.user,
          password: config.password,
        },
      });
    },
  });
}
