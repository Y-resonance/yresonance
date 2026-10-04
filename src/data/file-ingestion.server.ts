import { env } from 'cloudflare:workers';
import { createDatabase } from '#/db/client';
import { ingestionTokens } from '#/db/schema';
import { capabilityUrl, createR2Capability } from './internal-r2';
import { deleteSourceObject, localSourceUrl } from './source.server';
import { ingestCsv } from '#/query/duckdb.server';
import { MAX_DATASOURCE_FILE_BYTES } from '#/domain/datasource-upload';
import type { DataSourceRecord } from '#/query/types';
import type { DatasourceConnector } from './connectors/contract';
import type { ManagedUploadImport } from './analytics-data-backend';

const database = () => createDatabase(env.DB);

// The caller has already claimed and authorized this workspace upload.
export async function importManagedFile(
  source: Omit<DataSourceRecord, 'version'>,
  inspect: DatasourceConnector['inspect'],
): Promise<ManagedUploadImport> {
  if (source.location.kind !== 'object') throw new Error('Managed uploads require a file object.');
  const originalKey = source.location.key;
  let convertedKey: string | undefined;
  try {
    let location = source.location;
    if (location.format === 'csv') {
      convertedKey = originalKey.replace(/\.csv$/iu, '.parquet');
      location = (await convertManagedCsvUpload(source.workspaceId, originalKey)).location;
    }
    const pending = { ...source, location };
    const inspection = await inspect(pending, { maximumObjectBytes: MAX_DATASOURCE_FILE_BYTES });
    return {
      dataSource: { ...pending, version: inspection.version },
      inspection,
      async cleanup(outcome) {
        if (convertedKey)
          await deleteSourceObject(outcome === 'registered' ? originalKey : convertedKey);
      },
    };
  } catch (error) {
    if (convertedKey) await deleteSourceObject(convertedKey).catch(() => undefined);
    throw error;
  }
}

async function convertManagedCsvUpload(workspaceId: string, sourceKey: string) {
  const destinationKey = sourceKey.replace(/\.csv$/iu, '.parquet');
  const tokenId = `ingest_${crypto.randomUUID()}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
  await database().insert(ingestionTokens).values({
    id: tokenId,
    workspaceId,
    sourceKey,
    destinationKey,
    expiresAt: expiresAt.toISOString(),
    usedAt: null,
    createdAt: now.toISOString(),
  });
  let sourceUrl: string;
  let destinationUrl: string;
  if (env.DATA_SOURCE_BASE_URL.startsWith('r2://')) {
    const token = await createR2Capability(
      {
        kind: 'ingestion',
        tokenId,
        sourceKey,
        destinationKey,
        expiresAt: Math.floor(expiresAt.getTime() / 1000),
      },
      env.INTERNAL_R2_SIGNING_SECRET,
    );
    sourceUrl = capabilityUrl(token);
    // The ingestion capability selects its read and write object from the HTTP method.
    destinationUrl = sourceUrl;
  } else {
    sourceUrl = localSourceUrl(sourceKey);
    destinationUrl = localSourceUrl(destinationKey);
  }
  await ingestCsv(workspaceId, tokenId, sourceUrl, destinationUrl);
  return {
    key: destinationKey,
    location: { kind: 'object' as const, key: destinationKey, format: 'parquet' as const },
  };
}
