import type { DataSourceRecord } from '#/query/types';
import type { DatasourceConnector, DatasourceInspection } from './connectors/contract';

interface DatasourceIdentity {
  source: unknown;
  revision?: string;
}

export interface ManagedUploadImport {
  dataSource: DataSourceRecord;
  inspection: DatasourceInspection;
  // Registration succeeded: remove staging files. Registration failed: remove imported data.
  cleanup(outcome: 'registered' | 'failed'): Promise<void>;
}

// Query-only backends can omit the managed upload capability.
export interface AnalyticsDataBackend extends DatasourceConnector {
  managedUploads?: {
    import(dataSource: Omit<DataSourceRecord, 'version'>): Promise<ManagedUploadImport>;
  };
  cacheIdentity(dataSource: DataSourceRecord): DatasourceIdentity | Promise<DatasourceIdentity>;
}
