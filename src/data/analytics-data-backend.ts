import type { DataSourceRecord } from '#/query/types';
import type { DatasourceConnector } from './connectors/contract';

interface DatasourceIdentity {
  source: unknown;
  revision?: string;
}

// Ingestion is separate: external tables only need the query and inspection interface.
export interface AnalyticsDataBackend extends DatasourceConnector {
  cacheIdentity(dataSource: DataSourceRecord): DatasourceIdentity | Promise<DatasourceIdentity>;
}
