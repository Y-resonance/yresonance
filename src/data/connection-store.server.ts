import { env } from 'cloudflare:workers';
import type { DataSourceRecord } from '#/query/types';
import { openConnection } from './connection-secrets';
import { DatasourceError } from './connectors/contract';

export async function loadConnection(dataSource: Pick<DataSourceRecord, 'id' | 'workspaceId'>) {
  const row = await env.DB.prepare(
    'SELECT encrypted_config FROM datasource_connections WHERE datasource_id = ? AND workspace_id = ?',
  )
    .bind(dataSource.id, dataSource.workspaceId)
    .first<{ encrypted_config: string }>();
  if (!row)
    throw new DatasourceError(
      'datasource_access_denied',
      'The datasource connection is unavailable.',
    );
  try {
    return await openConnection(
      row.encrypted_config,
      env.UPLOAD_SIGNING_SECRET,
      `${dataSource.workspaceId}/${dataSource.id}`,
    );
  } catch {
    throw new DatasourceError(
      'datasource_connector_failed',
      'The datasource connection could not be opened.',
    );
  }
}
