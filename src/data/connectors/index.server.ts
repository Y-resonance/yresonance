import type { DataSourceRecord } from '#/query/types';
import { resolveDatasourceConnector } from './contract';
import { duckdbFileConnector } from './duckdb-file.server';

import { clickhouseBackend } from './clickhouse.server';

const connectors = [duckdbFileConnector, clickhouseBackend];

export function datasourceConnector(dataSource: DataSourceRecord | string) {
  return resolveDatasourceConnector(
    typeof dataSource === 'string' ? dataSource : dataSource.connectorType,
    connectors,
  );
}
