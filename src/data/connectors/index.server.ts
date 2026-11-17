import type { DataSourceRecord } from '#/query/types';
import { resolveDatasourceConnector } from './contract';
import { platform } from '#/platform/index.server';

export function datasourceConnector(dataSource: DataSourceRecord | string) {
  return resolveDatasourceConnector(
    typeof dataSource === 'string' ? dataSource : dataSource.connectorType,
    platform.datasources.map((provider) => provider.backend),
  );
}
