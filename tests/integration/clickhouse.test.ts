import { env } from 'cloudflare:workers';
import { afterEach, expect, test, vi } from 'vitest';
import { signOut } from './doubles/clerk';
import { eq } from 'drizzle-orm';
import { createDatabase } from '#/db/client';
import { dataSources } from '#/db/schema';
import type { DataSourceRecord } from '#/query/types';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  signInToNewWorkspace,
} from './fixtures';

const originalMappings = env.CLICKHOUSE_EXTERNAL_TABLES;
afterEach(() => {
  env.CLICKHOUSE_EXTERNAL_TABLES = originalMappings;
  vi.restoreAllMocks();
});

function installClickhouse() {
  env.CLICKHOUSE_URL = 'https://clickhouse.test';
  env.CLICKHOUSE_USER = 'backend';
  env.CLICKHOUSE_PASSWORD = 'private-password';
  const requests: Array<{ sql: string; headers: Headers }> = [];
  let revenue = 42;
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    if (new URL(request.url).hostname !== 'clickhouse.test')
      return original(input as RequestInfo, init);
    const sql = await request.text();
    requests.push({ sql, headers: request.headers });
    const data = sql.startsWith('DESCRIBE')
      ? [
          { name: 'day', type: 'Date' },
          { name: 'revenue', type: 'Float64' },
          { name: 'region', type: 'String' },
        ]
      : sql.startsWith('SELECT *')
        ? [{ day: '2026-08-01', revenue: 42, region: 'north' }]
        : [{ metric_1: revenue }];
    return new Response(
      JSON.stringify({
        meta: [{ name: 'metric_1', type: 'Float64' }],
        data,
        statistics: { elapsed: 0.001, rows_read: 1, bytes_read: 8 },
      }),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  return {
    requests,
    setRevenue(value: number) {
      revenue = value;
    },
  };
}

async function registerExternal(workspaceId: string, cacheTtlSeconds?: number) {
  env.CLICKHOUSE_EXTERNAL_TABLES = JSON.stringify([
    { workspaceId, database: 'external', table: 'sales' },
  ]);
  return (await callService({
    action: 'registerDatasource',
    name: 'Sales',
    backend: 'clickhouse',
    location: {
      kind: 'clickhouse',
      database: 'external',
      table: 'sales',
      ownership: 'external',
      ...(cacheTtlSeconds === undefined ? {} : { cacheTtlSeconds }),
    },
  })) as DataSourceRecord & {
    fields: Array<{ id: string; columnName: string; role: string; semanticType: string }>;
  };
}

async function dashboardFor(source: Awaited<ReturnType<typeof registerExternal>>) {
  const dashboard = await createDashboard();
  const widget = await addWidget(dashboard.id, {
    type: 'scorecard',
    title: 'Revenue',
    dataSourceId: source.id,
    dateRangeFieldId: source.fields.find((field) => field.columnName === 'day')!.id,
    metric: {
      source: {
        kind: 'field',
        fieldId: source.fields.find((field) => field.columnName === 'revenue')!.id,
        aggregation: 'sum',
      },
      dataType: 'currency',
    },
  });
  return {
    action: 'queryWidget',
    dashboardId: dashboard.id,
    widgetId: widget.id,
    controlState: {
      dateRange: { startDate: { fixed: '2026-08-01' }, endDate: { fixed: '2026-08-31' } },
    },
  };
}

test('external tables require exact workspace mappings and responses never contain credentials', async () => {
  const { requests } = installClickhouse();
  const owner = await signInToNewWorkspace();
  const source = await registerExternal(owner.workspaceId);
  expect(source.connectorType).toBe('clickhouse');
  expect(source.location).toMatchObject({ cacheTtlSeconds: 300 });
  expect(source.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ columnName: 'revenue', role: 'metric', semanticType: 'count' }),
    ]),
  );
  expect(JSON.stringify(source)).not.toContain('private-password');
  expect(requests[0].headers.get('X-ClickHouse-Key')).toBe('private-password');
  await signInToNewWorkspace();
  const before = requests.length;
  await expectApiError(
    callService({ action: 'registerDatasource', name: 'Other', location: source.location }),
    { status: 403, code: 'datasource_access_denied' },
  );
  await expectApiError(callService({ action: 'describeDatasource', dataSourceId: source.id }), {
    status: 404,
    code: 'datasource_not_found',
  });
  expect(requests).toHaveLength(before);
});

test.each([1, 300])(
  'external cache expires after %s seconds, and revoked mappings block an existing cache hit',
  async (ttlSeconds) => {
    const { setRevenue } = installClickhouse();
    const workspace = await signInToNewWorkspace();
    const source = await registerExternal(workspace.workspaceId, ttlSeconds);
    const query = await dashboardFor(source);
    expect(await callService(query)).toMatchObject({ cache: 'miss', rows: [{ metric_1: 42 }] });
    expect(await callService(query)).toMatchObject({ cache: 'hit' });
    setRevenue(43);
    expect(await callService(query)).toMatchObject({ cache: 'hit', rows: [{ metric_1: 42 }] });
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + ttlSeconds * 1000 + 1);
    expect(await callService(query)).toMatchObject({ cache: 'miss', rows: [{ metric_1: 43 }] });
    expect(await callService(query)).toMatchObject({ cache: 'hit' });
    env.CLICKHOUSE_EXTERNAL_TABLES = '[]';
    await expectApiError(callService(query), { status: 403, code: 'datasource_access_denied' });
    clock.mockRestore();
  },
);

test('zero TTL bypasses KV and a datasource cannot claim another workspace managed table', async () => {
  installClickhouse();
  const workspace = await signInToNewWorkspace();
  const source = await registerExternal(workspace.workspaceId, 0);
  const query = await dashboardFor(source);
  expect(await callService(query)).toMatchObject({ cache: 'miss' });
  expect(await callService(query)).toMatchObject({ cache: 'miss' });
  expect((await env.QUERY_CACHE.list()).keys).toHaveLength(0);
  await createDatabase(env.DB)
    .update(dataSources)
    .set({
      location: {
        kind: 'clickhouse',
        database: 'yresonance_another_workspace',
        table: 'other',
        ownership: 'managed',
        cacheTtlSeconds: 300,
      },
    })
    .where(eq(dataSources.id, source.id));
  await expectApiError(callService(query), { status: 403, code: 'datasource_access_denied' });
});

test('datasource policy persists, changes expiry, disables caching, and restores defaults', async () => {
  const { setRevenue } = installClickhouse();
  const workspace = await signInToNewWorkspace();
  const source = await registerExternal(workspace.workspaceId);
  const query = await dashboardFor(source);
  await callService(query);
  const policy = { mode: 'duration', ttlSeconds: 1 };
  await callService({ action: 'updateDatasource', dataSourceId: source.id, cachePolicy: policy });
  expect(
    await callService({ action: 'describeDatasource', dataSourceId: source.id }),
  ).toMatchObject({ cachePolicy: policy });
  expect(await callService(query)).toMatchObject({ cache: 'miss' });
  setRevenue(43);
  expect(await callService(query)).toMatchObject({ cache: 'hit', rows: [{ metric_1: 42 }] });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 1001);
  expect(await callService(query)).toMatchObject({ cache: 'miss', rows: [{ metric_1: 43 }] });
  clock.mockRestore();
  await callService({
    action: 'updateDatasource',
    dataSourceId: source.id,
    cachePolicy: { mode: 'disabled' },
  });
  setRevenue(44);
  expect(await callService(query)).toMatchObject({ cache: 'miss', rows: [{ metric_1: 44 }] });
  setRevenue(45);
  expect(await callService(query)).toMatchObject({ cache: 'miss', rows: [{ metric_1: 45 }] });
  await callService({
    action: 'updateDatasource',
    dataSourceId: source.id,
    cachePolicy: { mode: 'default' },
  });
  expect(await callService(query)).toMatchObject({ cache: 'hit' });
  await signInToNewWorkspace();
  await expectApiError(
    callService({ action: 'updateDatasource', dataSourceId: source.id, cachePolicy: policy }),
    { status: 404, code: 'datasource_not_found' },
  );
});

test('shared viewers fetch fresh results, replace the cache, and still require source authorization', async () => {
  const { setRevenue } = installClickhouse();
  const workspace = await signInToNewWorkspace();
  const source = await registerExternal(workspace.workspaceId);
  const query = await dashboardFor(source);
  const link = (await callService({
    action: 'shareDashboard',
    dashboardId: query.dashboardId,
    operation: { kind: 'createLink' },
  })) as { token: string };
  await callService(query);
  setRevenue(55);
  signOut();
  const sharedQuery = { ...query, shareToken: link.token };
  expect(await callService(sharedQuery)).toMatchObject({ cache: 'hit', rows: [{ metric_1: 42 }] });
  expect(await callService({ ...sharedQuery, refresh: true })).toMatchObject({
    cache: 'miss',
    rows: [{ metric_1: 55 }],
  });
  expect(await callService(sharedQuery)).toMatchObject({ cache: 'hit', rows: [{ metric_1: 55 }] });
  env.CLICKHOUSE_EXTERNAL_TABLES = '[]';
  await expectApiError(callService({ ...sharedQuery, refresh: true }), {
    status: 403,
    code: 'datasource_access_denied',
  });
});
