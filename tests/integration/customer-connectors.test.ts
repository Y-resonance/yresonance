import { env } from 'cloudflare:workers';
import { afterEach, expect, test, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { createDatabase } from '#/db/client';
import { datasourceConnections, dataSources } from '#/db/schema';
import type { DataSourceRecord } from '#/query/types';
import { handleExternalFileRequest } from '#/data/external-file';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  signInToNewWorkspace,
} from './fixtures';
import { queryEngine } from './doubles/query-engine';

interface RegisteredSource extends DataSourceRecord {
  fields: Array<{ id: string; columnName: string }>;
}

afterEach(() => vi.restoreAllMocks());

// Substitute only the customer network endpoint. Registration, encryption, D1 and query compilation are real.
test('customer ClickHouse credentials survive registration, remain private, and stay workspace-scoped', async () => {
  const original = globalThis.fetch;
  const requests: Array<{ url: string; headers: Headers }> = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    if (new URL(request.url).hostname !== 'analytics.example.com')
      return original(input as RequestInfo, init);
    requests.push({ url: request.url, headers: request.headers });
    const sql = await request.text();
    return Response.json({
      meta: [{ name: 'metric_1', type: 'Float64' }],
      data: sql.startsWith('DESCRIBE')
        ? [
            { name: 'revenue', type: 'Float64' },
            { name: 'day', type: 'Date' },
          ]
        : sql.startsWith('SELECT *')
          ? [{ revenue: 42 }]
          : [{ metric_1: 42 }],
    });
  });
  const owner = await signInToNewWorkspace();
  const source = (await callService({
    action: 'registerDatasource',
    provider: 'clickhouse-external',
    name: 'Customer sales',
    connection: {
      host: 'analytics.example.com',
      port: '8443',
      user: 'reader',
      password: 'customer-secret',
    },
    location: { kind: 'clickhouse', database: 'customer', table: 'sales', ownership: 'external' },
  })) as RegisteredSource;
  const db = createDatabase(env.DB);
  const stored = await db.query.datasourceConnections.findFirst({
    where: eq(datasourceConnections.datasourceId, source.id),
  });
  expect(stored).toBeDefined();
  expect(stored!.encryptedConfig).not.toContain('customer-secret');
  for (const result of [
    source,
    await callService({ action: 'listDataSources' }),
    await callService({ action: 'describeDatasource', dataSourceId: source.id }),
  ]) {
    expect(JSON.stringify(result)).not.toContain('customer-secret');
    expect(JSON.stringify(result)).not.toContain('encryptedConfig');
  }
  const dashboard = await createDashboard();
  const widget = await addWidget(dashboard.id, {
    type: 'scorecard',
    title: 'Revenue',
    dataSourceId: source.id,
    dateRangeFieldId: source.fields.find((field) => field.columnName === 'day')!.id,
    metric: {
      source: { kind: 'field', fieldId: source.fields[0]!.id, aggregation: 'sum' },
      dataType: 'number',
    },
  });
  const query = {
    action: 'queryWidget',
    dashboardId: dashboard.id,
    widgetId: widget.id,
    controlState: {},
  };
  expect(await callService(query)).toMatchObject({ rows: [{ metric_1: 42 }], cache: 'miss' });
  expect(requests.at(-1)!.headers.get('X-ClickHouse-User')).toBe('reader');
  expect(requests.at(-1)!.headers.get('X-ClickHouse-Key')).toBe('customer-secret');
  expect(new URL(requests.at(-1)!.url).searchParams.get('readonly')).toBe('1');
  expect(await callService(query)).toMatchObject({ cache: 'hit' });
  const other = await signInToNewWorkspace();
  const before = requests.length;
  await expectApiError(callService({ action: 'describeDatasource', dataSourceId: source.id }), {
    code: 'datasource_not_found',
    status: 404,
  });
  expect(requests).toHaveLength(before);
  // Even a copied encrypted record cannot be opened under a different datasource/workspace.
  const now = new Date().toISOString();
  const otherId = `ds_${crypto.randomUUID()}`;
  await db.insert(dataSources).values({
    id: otherId,
    workspaceId: other.workspaceId,
    name: 'Copied',
    connectorType: source.connectorType,
    location: source.location,
    version: source.version,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(datasourceConnections).values({
    datasourceId: otherId,
    workspaceId: other.workspaceId,
    encryptedConfig: stored!.encryptedConfig,
  });
  const { loadConnection } = await import('#/data/connection-store.server');
  await expect(loadConnection({ id: otherId, workspaceId: other.workspaceId })).rejects.toThrow(
    'The datasource connection could not be opened.',
  );
  expect(requests).toHaveLength(before);
  expect(owner.workspaceId).not.toBe(other.workspaceId);
});

test('a failed customer inspection stores neither datasource nor connection', async () => {
  const owner = await signInToNewWorkspace();
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    return new URL(request.url).hostname === 'broken.example.com'
      ? new Response('password=private-upstream-error', { status: 401 })
      : original(input as RequestInfo, init);
  });
  await expectApiError(
    callService({
      action: 'registerDatasource',
      provider: 'clickhouse-external',
      name: 'Broken',
      connection: {
        host: 'broken.example.com',
        port: '8443',
        user: 'reader',
        password: 'private-upstream-error',
      },
      location: { kind: 'clickhouse', database: 'customer', table: 'sales', ownership: 'external' },
    }),
    { code: 'datasource_connector_failed', status: 502 },
  );
  const db = createDatabase(env.DB);
  expect(
    await db
      .select()
      .from(dataSources)
      .where(and(eq(dataSources.workspaceId, owner.workspaceId), eq(dataSources.name, 'Broken'))),
  ).toEqual([]);
  expect(
    await db
      .select()
      .from(datasourceConnections)
      .where(eq(datasourceConnections.workspaceId, owner.workspaceId)),
  ).toEqual([]);
});

test('S3 prefixes use signed paginated reads, private object capabilities, and refreshed object versions', async () => {
  const original = globalThis.fetch;
  const storageRequests: Array<{ url: string; headers: Headers }> = [];
  let etag = 'a-v1';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.hostname !== 'storage.example.com') return original(input as RequestInfo, init);
    const request = new Request(input as RequestInfo, init);
    storageRequests.push({ url: request.url, headers: request.headers });
    if (url.searchParams.has('list-type')) {
      const second = url.searchParams.has('continuation-token');
      const key = second ? 'reports/b.csv' : 'reports/a.csv';
      return new Response(
        `<ListBucketResult><Contents><Key>${key}</Key><Size>10</Size><ETag>${etag}</ETag><LastModified>2026-10-10T00:00:00Z</LastModified></Contents><IsTruncated>${!second}</IsTruncated>${second ? '' : '<NextContinuationToken>next-page</NextContinuationToken>'}</ListBucketResult>`,
      );
    }
    const range = request.headers.get('range');
    return new Response(request.method === 'HEAD' ? null : range ? '1234' : '0123456789', {
      status: range ? 206 : 200,
      headers: {
        'content-length': range ? '4' : '10',
        etag: 'a-v1',
        ...(range ? { 'content-range': 'bytes 1-4/10' } : {}),
      },
    });
  });
  queryEngine.answerWith((request) => ({
    body: {
      ok: true,
      data:
        request.operation === 'describeSource'
          ? {
              description: [
                { column_name: 'revenue', column_type: 'DOUBLE' },
                { column_name: 'day', column_type: 'DATE' },
              ],
              samples: [{ revenue: 42 }],
            }
          : [{ metric_1: 42 }],
      metrics: { queryDurationMs: 1, resultBytes: 10 },
    },
  }));
  await signInToNewWorkspace();
  const source = (await callService({
    action: 'registerDatasource',
    provider: 'duckdb-s3',
    name: 'S3 reports',
    connection: {
      endpoint: 'https://storage.example.com',
      region: 'eu-central-1',
      bucket: 'customer-data',
      accessKeyId: 'customer-access-key',
      secretAccessKey: 'customer-s3-secret',
    },
    location: { kind: 'prefix', key: 'reports/', format: 'csv' },
  })) as RegisteredSource;
  expect(storageRequests[0]!.headers.get('authorization')).toContain(
    'Credential=customer-access-key/',
  );
  expect(
    storageRequests.some(
      (request) => new URL(request.url).searchParams.get('continuation-token') === 'next-page',
    ),
  ).toBe(true);
  const dashboard = await createDashboard();
  const widget = await addWidget(dashboard.id, {
    type: 'scorecard',
    title: 'Revenue',
    dataSourceId: source.id,
    dateRangeFieldId: source.fields.find((field) => field.columnName === 'day')!.id,
    metric: {
      source: { kind: 'field', fieldId: source.fields[0]!.id, aggregation: 'sum' },
      dataType: 'number',
    },
  });
  const query = {
    action: 'queryWidget',
    dashboardId: dashboard.id,
    widgetId: widget.id,
    controlState: {},
  };
  expect(await callService(query)).toMatchObject({ rows: [{ metric_1: 42 }], cache: 'miss' });
  expect(await callService(query)).toMatchObject({ cache: 'hit' });
  etag = 'a-v2';
  expect(await callService(query)).toMatchObject({ cache: 'miss' });
  expect(JSON.stringify(source)).not.toContain('customer-s3-secret');
  const description = await callService({ action: 'describeDatasource', dataSourceId: source.id });
  expect(description).toMatchObject({ defaultCacheTtlSeconds: 300 });
});

test('external file capabilities relay ranges, enforce read budgets, and reject expired or changed tokens', async () => {
  const { createQueryReadBudget, MAX_QUERY_SOURCE_BYTES } = await import('#/data/internal-r2');
  const { externalFileUrl } = await import('#/data/external-file');
  const workspace = await signInToNewWorkspace();
  const queryId = crypto.randomUUID();
  await createQueryReadBudget(queryId, workspace.workspaceId, env);
  const upstream: Request[] = [];
  let body = '1234';
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    upstream.push(request);
    return new Response(request.method === 'HEAD' ? null : body, {
      status: request.method === 'HEAD' ? 200 : 206,
      headers: {
        'content-length': request.method === 'HEAD' ? '10' : '4',
        'content-range': 'bytes 1-4/10',
      },
    });
  });
  const url = await externalFileUrl(
    'https://storage.example.com/customer-data/a.csv?get-secret',
    'https://storage.example.com/customer-data/a.csv?head-secret',
    queryId,
    env,
  );
  expect(url).not.toContain('get-secret');
  const token = url.split('/api/connector-file/')[1]!;
  const get = () =>
    handleExternalFileRequest(new Request(url, { headers: { range: 'bytes=1-4' } }), token, env);
  const head = await handleExternalFileRequest(new Request(url, { method: 'HEAD' }), token, env);
  expect(head.status).toBe(200);
  expect(upstream[0]!.url).toContain('head-secret');
  const response = await get();
  expect(response.status).toBe(206);
  expect(response.headers.get('content-range')).toBe('bytes 1-4/10');
  expect(await response.text()).toBe('1234');
  expect(upstream[1]!.headers.get('range')).toBe('bytes=1-4');
  expect(
    await env.DB.prepare('SELECT scanned_bytes FROM query_read_budgets WHERE id = ?')
      .bind(queryId)
      .first(),
  ).toMatchObject({ scanned_bytes: 4 });
  await env.DB.prepare('UPDATE query_read_budgets SET scanned_bytes = ? WHERE id = ?')
    .bind(MAX_QUERY_SOURCE_BYTES - 3, queryId)
    .run();
  expect((await get()).status).toBe(413);
  await env.DB.prepare('UPDATE query_read_budgets SET scanned_bytes = 0 WHERE id = ?')
    .bind(queryId)
    .run();
  body = '12345';
  await expect((await get()).text()).rejects.toThrow(
    'Storage response exceeded its declared length.',
  );
  const before = upstream.length;
  expect(
    (
      await handleExternalFileRequest(
        new Request(url),
        `${token.slice(0, 5)}x${token.slice(6)}`,
        env,
      )
    ).status,
  ).toBe(403);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60_000 + 1);
  expect((await get()).status).toBe(403);
  clock.mockRestore();
  expect(upstream).toHaveLength(before);
});
