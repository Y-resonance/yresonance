import type { ApiRequest } from '#/api/contracts';
import { platform } from '#/platform/index.server';
import { ApiError } from '#/server/errors';
export function datasourceProvider(id: string) {
  const provider = platform.datasources.find((candidate) => candidate.definition.id === id);
  if (!provider)
    throw new ApiError(
      400,
      'unsupported_datasource_connector',
      `Datasource provider "${id}" is not supported.`,
    );
  return provider;
}

export function registrationProvider(
  request: Extract<ApiRequest, { action: 'registerDatasource' }>,
) {
  return datasourceProvider(
    request.provider ??
      (request.backend === 'bigquery' || request.location.kind === 'bigquery'
        ? 'bigquery'
        : request.backend === 'clickhouse' || request.location.kind === 'clickhouse'
          ? 'clickhouse'
          : 'duckdb-file'),
  );
}
