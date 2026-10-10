import type { DataSourceRecord } from '#/query/types';
import { resolveDatasourceConnector } from './contract';
import { providers } from '#/data/providers/index.server';

const connectors = providers.map((provider) => provider.backend);

export function datasourceConnector(dataSource: DataSourceRecord | string) {
  return resolveDatasourceConnector(
    typeof dataSource === 'string' ? dataSource : dataSource.connectorType,
    connectors,
  );
}
