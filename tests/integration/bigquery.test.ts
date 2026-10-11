import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { createDatabase } from '#/db/client';
import { datasourceAuthorizations } from '#/db/schema';
import { completeGoogleConnection } from '#/data/google-oauth.server';
import { executeBigquery } from '#/data/bigquery.server';
import { signOut } from './doubles/clerk';
import type { DataSourceRecord } from '#/query/types';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  signInAsOwner,
  signInToNewWorkspace,
} from './fixtures';

const location = {
  kind: 'bigquery',
  project: 'customer-project',
  dataset: 'reporting',
  table: 'sales',
  location: 'EU',
  maximumBytesBilled: '1000000000',
};
const googleScope = 'openid email https://www.googleapis.com/auth/bigquery';

function googleNetwork({ domain = 'esome.test', failedRefresh = false, tooManyRows = false } = {}) {
  const original = globalThis.fetch;
  const requests: Array<{ url: URL; body: string; headers: Headers }> = [];
  let queryPage = 0;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (
      ![
        'oauth2.googleapis.com',
        'openidconnect.googleapis.com',
        'bigquery.googleapis.com',
      ].includes(url.hostname)
    )
      return original(input as RequestInfo, init);
    const body = await request.text();
    requests.push({ url, body, headers: request.headers });
    if (url.hostname === 'oauth2.googleapis.com') {
      if (failedRefresh && body.includes('grant_type=refresh_token'))
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({
        access_token: 'private-access-token',
        refresh_token: 'private-refresh-token',
        expires_in: body.includes('grant_type=refresh_token') ? 3600 : 1,
        scope: googleScope,
      });
    }
    if (url.hostname === 'openidconnect.googleapis.com')
      return Response.json({ email: `owner@${domain}`, email_verified: true, hd: domain });
    if (url.pathname.endsWith('/tables/sales'))
      return Response.json({
        type: 'VIEW',
        location: 'EU',
        schema: {
          fields: [
            { name: 'day', type: 'DATE' },
            { name: 'revenue', type: 'NUMERIC' },
            { name: 'year', type: 'INTEGER' },
            { name: 'enabled', type: 'BOOLEAN' },
            { name: 'accountId', type: 'INTEGER' },
          ],
        },
      });
    if (url.pathname.endsWith('/jobs') && request.method === 'POST')
      return Response.json({ jobReference: JSON.parse(body).jobReference });
    if (url.pathname.includes('/queries/')) {
      if (tooManyRows)
        return Response.json({
          jobComplete: true,
          schema: { fields: [{ name: 'metric_1', type: 'INTEGER' }] },
          rows: Array.from({ length: 20001 }, () => ({ f: [{ v: '9007199254740993' }] })),
        });
      queryPage += 1;
      if (queryPage === 1) return Response.json({ jobComplete: false });
      return Response.json({
        jobComplete: true,
        schema: { fields: [{ name: 'metric_1', type: 'NUMERIC' }] },
        rows: [{ f: [{ v: queryPage === 2 ? '42.125' : '7.875' }] }],
        ...(queryPage === 2 ? { pageToken: 'second-page' } : {}),
        totalBytesProcessed: '100',
        cacheHit: false,
      });
    }
    if (url.pathname.endsWith('/cancel')) return Response.json({});
    if (url.pathname.includes('/jobs/'))
      return Response.json({
        statistics: { query: { totalBytesBilled: '100', totalSlotMs: '10' } },
      });
    throw new Error(`Unexpected Google request: ${request.method} ${url.pathname}`);
  });
  return requests;
}

async function begin(connectionId?: string) {
  const response = (await callService({
    action: 'beginDatasourceConnection',
    provider: 'bigquery',
    connectionId,
  })) as { authorizationUrl: string };
  const url = new URL(response.authorizationUrl);
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  expect(url.searchParams.get('hd')).toBe('esome.test');
  return new Request(
    `https://yresonance.test/api/oauth/google/callback?${new URLSearchParams({ state: url.searchParams.get('state')!, code: 'one-use-code' })}`,
  );
}
async function connections() {
  return (await callService({ action: 'listDatasourceConnections', provider: 'bigquery' })) as {
    connections: Array<{ id: string; status: string; account: string }>;
  };
}

test('Google consent is workspace-bound and single-use; queries refresh privately, paginate, cache, disconnect and reconnect', async () => {
  const requests = googleNetwork();
  const owner = await signInToNewWorkspace();
  const callback = await begin();
  await signInToNewWorkspace();
  await expectApiError(completeGoogleConnection(callback), {
    code: 'invalid_oauth_state',
    status: 400,
  });
  expect(requests).toHaveLength(0);
  signInAsOwner(owner);
  expect((await completeGoogleConnection(callback)).status).toBe(303);
  await expectApiError(completeGoogleConnection(callback), {
    code: 'invalid_oauth_state',
    status: 400,
  });
  const grant = (await connections()).connections[0]!;
  const source = (await callService({
    action: 'registerDatasource',
    provider: 'bigquery',
    name: 'Customer sales',
    location,
    connection: { authorizationId: grant.id },
  })) as DataSourceRecord & {
    fields: Array<{ id: string; columnName: string; role: string; castTo: string | null }>;
  };
  expect(source.fields.find((field) => field.columnName === 'revenue')).toMatchObject({
    role: 'metric',
    castTo: 'NUMERIC',
  });
  expect(source.fields.find((field) => field.columnName === 'year')?.castTo).toBe('INT64');
  expect(source.fields.find((field) => field.columnName === 'enabled')).toMatchObject({
    role: 'dimension',
    castTo: 'STRING',
  });
  expect(source.fields.find((field) => field.columnName === 'accountId')?.castTo).toBe('VARCHAR');
  expect(requests.filter((entry) => entry.url.pathname.endsWith('/jobs'))).toHaveLength(0);
  const stored = await createDatabase(env.DB).query.datasourceAuthorizations.findFirst({
    where: eq(datasourceAuthorizations.id, grant.id),
  });
  expect(stored!.encryptedConfig).not.toContain('private-refresh-token');
  expect(JSON.stringify(await connections())).not.toContain('private-');
  expect(
    JSON.stringify(await callService({ action: 'describeDatasource', dataSourceId: source.id })),
  ).not.toContain('private-');

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
      dataType: 'number',
    },
  });
  const query = {
    action: 'queryWidget',
    dashboardId: dashboard.id,
    widgetId: widget.id,
    controlState: {},
  };
  expect(await callService(query)).toMatchObject({
    rows: [{ metric_1: '42.125' }, { metric_1: '7.875' }],
    cache: 'miss',
  });
  const submission = requests.find((entry) => entry.url.pathname.endsWith('/jobs'))!;
  const job = JSON.parse(submission.body);
  expect(job.jobReference).toMatchObject({ projectId: 'customer-project', location: 'EU' });
  expect(job.configuration.query).toMatchObject({
    useLegacySql: false,
    maximumBytesBilled: '1000000000',
    parameterMode: 'POSITIONAL',
  });
  expect(job.configuration.query.query).toContain('`customer-project.reporting.sales`');
  expect(job.configuration.query.query).toContain('BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)');
  expect(requests.some((entry) => entry.url.searchParams.get('pageToken') === 'second-page')).toBe(
    true,
  );
  expect(requests.some((entry) => entry.body.includes('grant_type=refresh_token'))).toBe(true);
  expect(await callService(query)).toMatchObject({ cache: 'hit' });
  const link = (await callService({
    action: 'shareDashboard',
    dashboardId: dashboard.id,
    operation: { kind: 'createLink' },
  })) as { token: string };
  signOut();
  expect(await callService({ ...query, shareToken: link.token })).toMatchObject({ cache: 'hit' });
  signInAsOwner(owner);
  await callService({ action: 'disconnectDatasourceConnection', connectionId: grant.id });
  await expectApiError(callService(query), { code: 'datasource_access_denied', status: 403 });
  const reconnect = await begin(grant.id);
  expect((await completeGoogleConnection(reconnect)).status).toBe(303);
  expect((await connections()).connections).toEqual([
    expect.objectContaining({ id: grant.id, status: 'connected' }),
  ]);
  expect(await callService(query)).toMatchObject({ cache: 'miss' });
  await signInToNewWorkspace();
  expect((await connections()).connections).toEqual([]);
  await expectApiError(
    callService({
      action: 'registerDatasource',
      provider: 'bigquery',
      name: 'Stolen',
      location,
      connection: { authorizationId: grant.id },
    }),
    { code: 'datasource_access_denied', status: 403 },
  );
});

test('non-esome consent leaves no usable connection', async () => {
  googleNetwork({ domain: 'external.test' });
  await signInToNewWorkspace();
  const response = await completeGoogleConnection(await begin());
  expect(response.headers.get('Location')).toContain('connectionError=google_authorization_failed');
  expect((await connections()).connections).toEqual([]);
});

test('revoked refresh tokens produce a persistent reconnect state rather than a successful connection', async () => {
  googleNetwork({ failedRefresh: true });
  await signInToNewWorkspace();
  await completeGoogleConnection(await begin());
  const grant = (await connections()).connections[0]!;
  await expectApiError(
    callService({
      action: 'registerDatasource',
      provider: 'bigquery',
      name: 'Revoked',
      location,
      connection: { authorizationId: grant.id },
    }),
    { code: 'datasource_access_denied', status: 403 },
  );
  expect((await connections()).connections[0]!.status).toBe('reconnect_required');
});

test('oversized BigQuery results fail without partial rows and cancel the known job', async () => {
  const requests = googleNetwork({ tooManyRows: true });
  await expect(
    executeBigquery(
      'test-token',
      { project: 'customer-project', location: 'EU', maximumBytesBilled: '1000' },
      { sql: 'SELECT ?', parameters: ["value'; DROP TABLE sales; --"] },
      'workspace-test',
    ),
  ).rejects.toThrow('BigQuery returned too much data.');
  const submission = JSON.parse(
    requests.find((entry) => entry.url.pathname.endsWith('/jobs'))!.body,
  );
  expect(submission.configuration.query).toMatchObject({
    query: 'SELECT ?',
    maximumBytesBilled: '1000',
    queryParameters: [
      {
        parameterType: { type: 'STRING' },
        parameterValue: { value: "value'; DROP TABLE sales; --" },
      },
    ],
  });
  const cancelled = requests.find((entry) => entry.url.pathname.endsWith('/cancel'))!;
  expect(cancelled.url.pathname).toContain(submission.jobReference.jobId);
  expect(cancelled.url.searchParams.get('location')).toBe('EU');
});
