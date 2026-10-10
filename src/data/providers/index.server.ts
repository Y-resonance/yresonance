import type { ApiRequest } from '#/api/contracts';
import { datasourceProviders } from './catalog';
import type { DatasourceProvider } from './contract';
import { duckdbFileConnector } from '#/data/connectors/duckdb-file.server';
import { clickhouseBackend } from '#/data/connectors/clickhouse.server';
import { s3DuckdbBackend } from '#/data/connectors/duckdb-s3.server';
import { externalClickhouseBackend } from '#/data/connectors/clickhouse-external.server';
import { s3ConnectionSchema, clickhouseConnectionSchema } from './config';
import { isWorkspaceR2Key } from '#/domain/tenancy';
import {
  isManagedDatasourceUpload,
  datasourcePrefixOverlapsManagedUploads,
} from '#/domain/datasource-upload';
import { ApiError } from '#/server/errors';
import type { AnalyticsDataBackend } from '#/data/analytics-data-backend';

function managedSource(
  request: Extract<ApiRequest, { action: 'registerDatasource' }>,
  prefix: string,
  requiresUpload: boolean,
) {
  if (request.connection)
    throw new ApiError(400, 'invalid_connection', 'Managed providers do not accept credentials.');
  const location = request.location;
  // Retain authorized tables from the original API. New managed setup offers uploads only.
  if (location.kind === 'clickhouse') {
    if (!requiresUpload || location.ownership !== 'external' || request.cleanupToken)
      throw new ApiError(
        400,
        'invalid_datasource_location',
        'Register an external table or upload a file for managed ClickHouse data.',
      );
    return undefined;
  }
  if (!isWorkspaceR2Key(prefix, location.key))
    throw new ApiError(400, 'invalid_r2_prefix', `Datasource keys must start with ${prefix}.`);
  if (location.kind === 'prefix' && datasourcePrefixOverlapsManagedUploads(prefix, location.key))
    throw new ApiError(
      400,
      'managed_upload_prefix_not_allowed',
      'Prefixes cannot include yresonance-managed uploads.',
    );
  const uploadKey =
    location.kind === 'object' && isManagedDatasourceUpload(prefix, location.key)
      ? location.key
      : undefined;
  if (uploadKey && !uploadKey.toLowerCase().endsWith(`.${location.format}`))
    throw new ApiError(
      400,
      'invalid_upload_format',
      `Managed ${location.format} uploads need a .${location.format} key.`,
    );
  if (requiresUpload && !uploadKey)
    throw new ApiError(
      400,
      'managed_upload_required',
      'Upload a file or register an authorized external table for ClickHouse.',
    );
  return uploadKey;
}

function provider(
  id: string,
  backend: AnalyticsDataBackend,
  setup: (
    request: Parameters<DatasourceProvider['prepare']>[0],
    context: Parameters<DatasourceProvider['prepare']>[1],
  ) => Pick<ReturnType<DatasourceProvider['prepare']>, 'connection' | 'managedUploadKey'> & {
    backend?: AnalyticsDataBackend;
  },
): DatasourceProvider {
  const definition = datasourceProviders.find((candidate) => candidate.id === id);
  if (!definition) throw new Error(`Missing provider definition: ${id}`);
  return {
    definition,
    backend,
    prepare(request, context) {
      if (request.backend && request.backend !== definition.engine)
        throw new ApiError(
          400,
          'invalid_datasource_provider',
          'The provider and backend do not match.',
        );
      const prepared = setup(request, context);
      return {
        ...prepared,
        backend: prepared.backend ?? backend,
        source: {
          id: `ds_${crypto.randomUUID()}`,
          workspaceId: context.workspaceId,
          name: request.name,
          connectorType: id,
          location: request.location,
          cachePolicy: request.cachePolicy,
        },
      };
    },
  };
}

function externalSource(request: Parameters<DatasourceProvider['prepare']>[0]) {
  if (request.cleanupToken)
    throw new ApiError(
      400,
      'invalid_connection',
      'Bring your own providers do not import managed uploads.',
    );
}

// Provider-specific setup lives here; registration and dashboard callers use only the interfaces.
export const providers: readonly DatasourceProvider[] = [
  provider('duckdb-file', duckdbFileConnector, (request, context) => ({
    managedUploadKey: managedSource(request, context.workspacePrefix, false),
  })),
  provider('clickhouse', clickhouseBackend, (request, context) => ({
    managedUploadKey: managedSource(request, context.workspacePrefix, true),
  })),
  provider('duckdb-s3', s3DuckdbBackend(), (request) => {
    externalSource(request);
    if (request.location.kind === 'clickhouse')
      throw new ApiError(400, 'invalid_datasource_location', 'Choose an S3 file or prefix.');
    if (request.location.key.split('/').some((segment) => segment === '.' || segment === '..'))
      throw new ApiError(
        400,
        'invalid_datasource_location',
        'Object keys cannot contain dot path segments.',
      );
    const connection = s3ConnectionSchema.parse(request.connection);
    return { connection, backend: s3DuckdbBackend(async () => connection) };
  }),
  provider('clickhouse-external', externalClickhouseBackend(), (request) => {
    externalSource(request);
    if (request.location.kind !== 'clickhouse' || request.location.ownership !== 'external')
      throw new ApiError(
        400,
        'invalid_datasource_location',
        'Choose an external ClickHouse table.',
      );
    const connection = clickhouseConnectionSchema.parse(request.connection);
    return { connection, backend: externalClickhouseBackend(async () => connection) };
  }),
];

export function datasourceProvider(id: string) {
  const provider = providers.find((candidate) => candidate.definition.id === id);
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
      (request.backend === 'clickhouse' || request.location.kind === 'clickhouse'
        ? 'clickhouse'
        : 'duckdb-file'),
  );
}
