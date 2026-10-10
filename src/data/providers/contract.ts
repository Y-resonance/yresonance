import type { ApiRequest } from '#/api/contracts';
import type { AnalyticsDataBackend } from '#/data/analytics-data-backend';
import type { DataSourceRecord } from '#/query/types';
import type { DatasourceProviderDefinition } from './catalog';

export interface DatasourceProvider {
  definition: DatasourceProviderDefinition;
  backend: AnalyticsDataBackend;
  prepare(
    request: Extract<ApiRequest, { action: 'registerDatasource' }>,
    context: { workspaceId: string; workspacePrefix: string },
  ): {
    backend: AnalyticsDataBackend;
    source: Omit<DataSourceRecord, 'version'>;
    connection?: unknown;
    managedUploadKey?: string;
  };
}
