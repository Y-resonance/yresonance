import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { DatasourceError } from '#/data/connectors/contract';
import { datasourceUploadKey, type DatasourceUploadFormat } from '#/domain/datasource-upload';
import { compileSourceSqlFromBaseUrl, compileSourceSqlFromUrls } from '#/query/compiler';
import type { DataSourceRecord } from '#/query/types';
import { collectObjectPages, matchingSourceObjects } from './listing';
import {
  browserUploadPath,
  capabilityUrl,
  createQueryReadBudget,
  createR2Capability,
  MAX_QUERY_SOURCE_BYTES,
} from './internal-r2';

const sourceObjectSchema = z.object({
  key: z.string(),
  size: z.number().nonnegative(),
  etag: z.string(),
  uploaded: z.coerce.date(),
});

const sourceListingSchema = z.object({
  objects: z.array(sourceObjectSchema),
  truncated: z.boolean(),
  cursor: z.string().optional(),
});

export type SourceObject = z.infer<typeof sourceObjectSchema>;
export type SourceListing = z.infer<typeof sourceListingSchema>;

export async function listSourceObjects(prefix?: string, cursor?: string): Promise<SourceListing> {
  if (usesR2()) {
    const listing = await env.DATA.list({ prefix, cursor, limit: 1000 });
    return {
      objects: listing.objects.map(({ key, size, etag, uploaded }) => ({
        key,
        size,
        etag,
        uploaded,
      })),
      truncated: listing.truncated,
      cursor: listing.truncated ? listing.cursor : undefined,
    };
  }

  const url = new URL(env.DATA_SOURCE_BASE_URL);
  if (prefix) url.searchParams.set('prefix', prefix);
  if (cursor) url.searchParams.set('cursor', cursor);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Local data listing returned HTTP ${response.status}.`);
  return sourceListingSchema.parse(await response.json());
}

export async function headSourceObject(key: string): Promise<SourceObject | null> {
  if (usesR2()) {
    const object = await env.DATA.head(key);
    return object
      ? { key: object.key, size: object.size, etag: object.etag, uploaded: object.uploaded }
      : null;
  }

  const response = await fetch(sourceUrl(key), { method: 'HEAD' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Local data lookup returned HTTP ${response.status}.`);
  const size = Number(response.headers.get('content-length'));
  return sourceObjectSchema.parse({
    key,
    size,
    etag: response.headers.get('etag'),
    uploaded: response.headers.get('last-modified'),
  });
}

export async function prepareSourceUpload(workspacePrefix: string, format: DatasourceUploadFormat) {
  const key = datasourceUploadKey(workspacePrefix, format);
  if (!usesR2()) {
    return { key, uploadUrl: sourceUrl(key) };
  }
  return { key, uploadUrl: browserUploadPath(key) };
}

export async function deleteSourceObject(key: string) {
  if (usesR2()) {
    await env.DATA.delete(key);
    return;
  }
  const response = await fetch(sourceUrl(key), { method: 'DELETE' });
  if (response.status !== 404 && !response.ok)
    throw new Error(`Local data deletion returned HTTP ${response.status}.`);
}

export async function resolveDataSource(dataSource: DataSourceRecord, queryId: string) {
  const location = dataSource.location;
  if (location.kind === 'clickhouse') throw new Error('File source required.');
  if (!usesR2()) {
    const keys =
      location.kind === 'object'
        ? [location.key]
        : matchingSourceObjects(
            await collectObjectPages((cursor) => listSourceObjects(location.key, cursor)),
            location.format,
          ).map((object) => object.key);
    if (!keys.length)
      throw new DatasourceError(
        'datasource_source_not_found',
        'No matching datasource files were found.',
      );
    return {
      sql: compileSourceSqlFromBaseUrl(dataSource, env.QUERY_DATA_SOURCE_BASE_URL, keys),
      sourceBytes: 0,
      objectKeys: keys,
      queryBudgetId: undefined,
    };
  }

  const objects =
    location.kind === 'object'
      ? [await headSourceObject(location.key)].filter((item) => item !== null)
      : matchingSourceObjects(
          await collectObjectPages((cursor) => listSourceObjects(location.key, cursor)),
          location.format,
        );
  if (!objects.length)
    throw new DatasourceError(
      'datasource_source_not_found',
      'No matching datasource files were found.',
    );
  const sourceBytes = objects.reduce((total, object) => total + object.size, 0);
  if (sourceBytes > MAX_QUERY_SOURCE_BYTES)
    throw new DatasourceError(
      'datasource_source_too_large',
      `Datasource exceeds the ${MAX_QUERY_SOURCE_BYTES} byte query limit.`,
    );
  await createQueryReadBudget(queryId, dataSource.workspaceId, env);

  const urls = await Promise.all(
    objects.map(async (object) =>
      capabilityUrl(
        await createR2Capability(
          { kind: 'read', key: object.key, queryId },
          env.INTERNAL_R2_SIGNING_SECRET,
        ),
      ),
    ),
  );
  return {
    sql: compileSourceSqlFromUrls(dataSource, urls),
    sourceBytes,
    objectKeys: objects.map((object) => object.key),
    queryBudgetId: queryId,
  };
}

export async function checkSourceStorage() {
  if (usesR2()) {
    await env.DATA.list({ limit: 1, prefix: '__readiness__/' });
    return;
  }
  const response = await fetch(env.DATA_SOURCE_BASE_URL, { method: 'GET' });
  if (!response.ok) throw new Error(`Local data service returned HTTP ${response.status}.`);
  await response.body?.cancel();
}

function usesR2() {
  return env.DATA_SOURCE_BASE_URL.startsWith('r2://');
}

function sourceUrl(key: string) {
  const base = env.DATA_SOURCE_BASE_URL.replace(/\/$/u, '');
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`;
}

export function localSourceUrl(key: string) {
  if (usesR2()) throw new Error('Local source URLs are unavailable for R2.');
  return sourceUrl(key);
}

export async function readSourceObject(key: string, maximumBytes: number) {
  if (usesR2()) {
    const object = await env.DATA.get(key);
    if (!object) throw new DatasourceError('datasource_source_not_found', 'Upload not found.');
    if (object.size > maximumBytes)
      throw new DatasourceError('datasource_source_too_large', 'The uploaded file is too large.');
    return object.body;
  }
  const response = await fetch(sourceUrl(key));
  if (!response.ok || !response.body)
    throw new DatasourceError('datasource_source_not_found', 'Upload not found.');
  if (Number(response.headers.get('content-length')) > maximumBytes) {
    await response.body.cancel();
    throw new DatasourceError('datasource_source_too_large', 'The uploaded file is too large.');
  }
  return response.body;
}
