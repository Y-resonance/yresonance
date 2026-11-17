import { settings } from '#/platform/settings';
import { and, eq } from 'drizzle-orm';
import { database } from '#/server/database.server';
import { datasourceConnections } from '#/db/schema';
import type { DataSourceRecord } from '#/query/types';
import { openConnection } from './connection-secrets';
import { DatasourceError } from './connectors/contract';

export async function loadConnection(dataSource: Pick<DataSourceRecord, 'id' | 'workspaceId'>) {
  const row = await database().query.datasourceConnections.findFirst({
    where: and(
      eq(datasourceConnections.datasourceId, dataSource.id),
      eq(datasourceConnections.workspaceId, dataSource.workspaceId),
    ),
  });
  if (!row)
    throw new DatasourceError(
      'datasource_access_denied',
      'The datasource connection is unavailable.',
    );
  try {
    return await openConnection(
      row.encryptedConfig,
      settings().UPLOAD_SIGNING_SECRET,
      `${dataSource.workspaceId}/${dataSource.id}`,
    );
  } catch {
    throw new DatasourceError(
      'datasource_connector_failed',
      'The datasource connection could not be opened.',
    );
  }
}
