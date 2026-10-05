import { env } from 'cloudflare:workers';
import { afterEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '#/db/client';
import { dataSources, datasourceUploads } from '#/db/schema';
import type { DataSourceRecord } from '#/query/types';
import { callService, signInToNewWorkspace } from './fixtures';
import { queryEngine } from './doubles/query-engine';

const originalBase = env.DATA_SOURCE_BASE_URL;
afterEach(() => {
  env.DATA_SOURCE_BASE_URL = originalBase;
  vi.restoreAllMocks();
});

// Real service, D1 claims, and R2 staging; only the two engine transports are substituted.
test.each([
  { backend: 'duckdb', format: 'csv' },
  { backend: 'duckdb', format: 'parquet' },
  { backend: 'clickhouse', format: 'csv' },
  { backend: 'clickhouse', format: 'parquet' },
] as const)(
  '$backend $format import rolls back a failed registration and can retry',
  async ({ backend, format }) => {
    env.DATA_SOURCE_BASE_URL = 'r2://yresonance-data';
    env.CLICKHOUSE_URL = 'https://clickhouse.test';
    env.CLICKHOUSE_USER = 'backend';
    env.CLICKHOUSE_PASSWORD = 'private-password';
    const workspace = await signInToNewWorkspace();
    const upload = (await callService({
      action: 'prepareDatasourceUpload',
      fileName: `data.${format}`,
      fileSize: 15,
      format,
    })) as {
      key: string;
      cleanupToken: string;
    };
    const convertedKey = upload.key.replace(/\.csv$/iu, '.parquet');
    await env.DATA.put(upload.key, 'original upload');
    queryEngine.answerWith(async (request) => {
      if (request.operation === 'ingestCsv') {
        await env.DATA.put(convertedKey, 'converted parquet');
        return {
          body: {
            ok: true,
            data: { size: 17, etag: null },
            metrics: { queryDurationMs: 1, resultBytes: 0 },
          },
        };
      }
      return {
        body: {
          ok: true,
          data: {
            description: [{ column_name: 'amount', column_type: 'DOUBLE' }],
            samples: [{ amount: 42 }],
          },
          metrics: { queryDurationMs: 1, resultBytes: 0 },
        },
      };
    });
    const tables = new Set<string>();
    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.hostname !== 'clickhouse.test') return originalFetch(input as RequestInfo, init);
      const request = new Request(input as RequestInfo, init);
      const sql = url.searchParams.get('query') ?? (await request.text());
      const created = sql.match(/^CREATE TABLE (.*?) \(/u)?.[1];
      const dropped = sql.match(/^DROP TABLE IF EXISTS (.*)$/u)?.[1];
      if (created) tables.add(created);
      if (dropped) tables.delete(dropped);
      if (!request.bodyUsed) await request.arrayBuffer();
      return new Response('');
    });
    const request = {
      action: 'registerDatasource',
      name: 'Managed data',
      backend,
      cachePolicy:
        backend === 'duckdb' ? { mode: 'disabled' } : { mode: 'duration', ttlSeconds: 15 },
      cleanupToken: upload.cleanupToken,
      location: { kind: 'object', key: upload.key, format },
    };
    const failedRegistration = vi
      .spyOn(env.DB, 'batch')
      .mockRejectedValueOnce(new Error('Registration unavailable'));
    await expect(callService(request)).rejects.toThrow('Registration unavailable');
    failedRegistration.mockRestore();
    const db = createDatabase(env.DB);
    expect(await env.DATA.get(upload.key)).not.toBeNull();
    expect((await env.DATA.get(convertedKey)) !== null).toBe(format === 'parquet');
    expect(tables.size).toBe(0);
    expect(
      await db.query.datasourceUploads.findFirst({ where: eq(datasourceUploads.key, upload.key) }),
    ).toMatchObject({ status: 'pending', claimId: null });
    expect(
      await db.query.dataSources.findMany({
        where: eq(dataSources.workspaceId, workspace.workspaceId),
      }),
    ).toEqual([]);

    const registered = (await callService(request)) as DataSourceRecord;
    expect(
      await callService({ action: 'describeDatasource', dataSourceId: registered.id }),
    ).toMatchObject({ cachePolicy: request.cachePolicy });
    expect(registered.connectorType).toBe(backend === 'duckdb' ? 'duckdb-file' : 'clickhouse');
    expect(
      await db.query.datasourceUploads.findFirst({ where: eq(datasourceUploads.key, upload.key) }),
    ).toBeUndefined();
    expect(
      await db.query.dataSources.findFirst({ where: eq(dataSources.id, registered.id) }),
    ).toMatchObject({ connectorType: registered.connectorType, location: registered.location });
    expect(registered.location).toMatchObject(
      backend === 'clickhouse'
        ? { kind: 'clickhouse', ownership: 'managed' }
        : { kind: 'object', key: convertedKey, format: 'parquet' },
    );
    expect((await env.DATA.get(upload.key)) !== null).toBe(
      backend === 'duckdb' && format === 'parquet',
    );
    expect((await env.DATA.get(convertedKey)) !== null).toBe(backend === 'duckdb');
    expect(tables.size).toBe(backend === 'clickhouse' ? 1 : 0);
  },
);
