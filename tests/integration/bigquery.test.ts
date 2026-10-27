import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { expect, test, vi } from 'vitest';
import { createDatabase } from '#/db/client';
import { datasourceAuthorizations } from '#/db/schema';
import { completeGoogleConnection } from '#/data/google-oauth.server';
import { executeBigquery } from '#/data/bigquery.server';
import { signOut } from './doubles/clerk';
import type { DatasourceCatalogPage } from '#/api/contracts';
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

function googleNetwork({
  domain = 'example.test',
  failedRefresh = false,
  tooManyRows = false,
} = {}) {
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
    if (url.pathname === '/bigquery/v2/projects')
      return Response.json(
        url.searchParams.has('pageToken')
          ? {
              projects: [
                { projectReference: { projectId: 'customer-project' }, friendlyName: 'Customer' },
              ],
            }
          : { nextPageToken: 'projects page/2', projects: [] },
      );
    if (url.pathname.endsWith('/datasets'))
      return Response.json({
        datasets: [{ datasetReference: { datasetId: 'reporting' }, location: 'US' }],
      });
    if (url.pathname.endsWith('/datasets/reporting/tables'))
      return Response.json({ tables: [{ tableReference: { tableId: 'sales' }, type: 'VIEW' }] });
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
    if (url.pathname.endsWith('/jobs') && request.method === 'POST') {
      const job = JSON.parse(body);
      return Response.json({
        jobReference: job.jobReference,
        ...(job.configuration?.dryRun
          ? {
              statistics: {
                query: {
                  schema: {
                    fields: [
                      {
                        name: job.configuration.query.query.includes('metric_1')
                          ? 'metric_1'
                          : 'value',
                        type: 'NUMERIC',
                      },
                    ],
                  },
                },
              },
            }
          : {}),
      });
    }
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
  expect(url.searchParams.get('hd')).toBe('example.test');
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
  const remainderField = {
    dataSourceId: source.id,
    name: 'Remainder',
    expression: 'revenue % 2',
    role: 'metric',
    semanticType: 'count',
  };
  expect(await callService({ action: 'validateCalculatedField', ...remainderField })).toMatchObject(
    {
      valid: false,
      error: { message: 'BigQuery does not support remainder (%) formulas.' },
    },
  );
  await expectApiError(callService({ action: 'upsertCalculatedField', ...remainderField }), {
    status: 400,
    code: 'invalid_query',
  });
  expect(
    await callService({
      action: 'validateMetricExpression',
      dataSourceId: source.id,
      expression: 'sum(revenue) % 2',
    }),
  ).toMatchObject({
    valid: false,
    error: { message: 'BigQuery does not support remainder (%) formulas.' },
  });
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
  // A fresh result forces the anonymous viewer through token lookup and BigQuery execution,
  // which must not depend on a Clerk session.
  expect(await callService({ ...query, shareToken: link.token, refresh: true })).toMatchObject({
    cache: 'miss',
  });
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

test('consent from outside the configured Google Workspace domain leaves no usable connection', async () => {
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

test('catalog browsing follows pagination, reads source metadata without query jobs, and rejects another workspace grant', async () => {
  const requests = googleNetwork();
  const owner = await signInToNewWorkspace();
  await completeGoogleConnection(await begin());
  const grant = (await connections()).connections[0]!;
  const browse = {
    action: 'browseDatasource' as const,
    provider: 'bigquery' as const,
    connectionId: grant.id,
  };
  const first = (await callService(browse)) as DatasourceCatalogPage;
  expect(first).toEqual({ entries: [], cursor: 'projects page/2' });
  expect(await callService({ ...browse, cursor: first.cursor })).toEqual({
    entries: [{ id: 'customer-project', label: 'Customer' }],
  });
  expect(
    requests
      .find(
        (entry) =>
          entry.url.pathname === '/bigquery/v2/projects' && entry.url.searchParams.has('pageToken'),
      )
      ?.url.searchParams.get('pageToken'),
  ).toBe('projects page/2');
  expect(await callService({ ...browse, project: 'customer-project' })).toEqual({
    entries: [{ id: 'reporting', label: 'reporting', location: 'US' }],
  });
  expect(
    await callService({ ...browse, project: 'customer-project', dataset: 'reporting' }),
  ).toEqual({
    entries: [{ id: 'sales', label: 'sales', type: 'VIEW' }],
  });
  expect(
    requests
      .filter((entry) => entry.url.hostname === 'bigquery.googleapis.com')
      .every((entry) => !entry.url.pathname.includes('/jobs')),
  ).toBe(true);
  const before = requests.length;
  await signInToNewWorkspace();
  await expectApiError(callService(browse), { status: 403, code: 'datasource_access_denied' });
  expect(requests).toHaveLength(before);
  signInAsOwner(owner);
  await callService({ action: 'disconnectDatasourceConnection', connectionId: grant.id });
  await expectApiError(callService(browse), { status: 403, code: 'datasource_access_denied' });
  expect(requests).toHaveLength(before);
});

test('native BigQuery formulas retain their dialect, validate through Google, and reject failed saves', async () => {
  const requests = googleNetwork();
  await signInToNewWorkspace();
  await completeGoogleConnection(await begin());
  const grant = (await connections()).connections[0]!;
  const source = (await callService({
    action: 'registerDatasource',
    provider: 'bigquery',
    name: 'Native sales',
    location,
    connection: { authorizationId: grant.id },
  })) as DataSourceRecord & { fields: Array<{ id: string; columnName: string }> };
  const calculated = {
    action: 'upsertCalculatedField',
    dataSourceId: source.id,
    name: 'Rounded revenue',
    canonicalName: 'rounded_revenue',
    expression: 'ROUND({{revenue}}, 2)',
    formulaDialect: 'bigquery',
    semanticType: 'currency',
    role: 'metric',
  };
  const stored = (await callService(calculated)) as { id: string; formulaDialect: string };
  expect(stored.formulaDialect).toBe('bigquery');
  const expression = 'SAFE_DIVIDE(SUM({{rounded_revenue}}), COUNT(*))';
  expect(
    await callService({
      action: 'validateMetricExpression',
      dataSourceId: source.id,
      expression,
      formulaDialect: 'bigquery',
    }),
  ).toMatchObject({ valid: true, identifiers: ['rounded_revenue'] });
  const metric = (await callService({
    action: 'upsertLibraryMetric',
    name: 'Average revenue',
    expression,
    formulaDialect: 'bigquery',
    semanticType: 'currency',
  })) as { id: string };
  expect(
    await callService({ action: 'describeDatasource', dataSourceId: source.id }),
  ).toMatchObject({
    calculatedFields: [expect.objectContaining({ id: stored.id, formulaDialect: 'bigquery' })],
    libraryMetrics: [
      expect.objectContaining({ id: metric.id, formulaDialect: 'bigquery', expression }),
    ],
  });
  const dashboard = await createDashboard();
  const nativeDefinition = {
    type: 'scorecard',
    title: 'Native average',
    dataSourceId: source.id,
    dateRangeFieldId: source.fields.find((field) => field.columnName === 'day')!.id,
    metric: {
      source: { kind: 'expression', expression, formulaDialect: 'bigquery' },
      dataType: 'number',
    },
  } as const;
  const widget = await addWidget(dashboard.id, nativeDefinition);
  const atomic = (await callService({
    action: 'updateWidget',
    dashboardId: dashboard.id,
    widgetId: widget.id,
    definition: nativeDefinition,
    libraryMetric: {
      name: 'Atomic average',
      expression,
      formulaDialect: 'bigquery',
      semanticType: 'currency',
    },
  })) as { libraryMetric: { id: string } };
  expect(await callService({ action: 'listLibraryMetrics' })).toContainEqual(
    expect.objectContaining({
      id: atomic.libraryMetric.id,
      formulaDialect: 'bigquery',
      expression,
    }),
  );
  const dryRuns = requests
    .filter((request) => request.url.pathname.endsWith('/jobs'))
    .map((request) => JSON.parse(request.body));
  expect(dryRuns.length).toBeGreaterThan(0);
  expect(dryRuns.every((job) => job.configuration.dryRun === true)).toBe(true);
  expect(
    dryRuns.some(
      (job) =>
        job.configuration.query.query.includes('SAFE_DIVIDE') &&
        job.configuration.query.query.includes('`revenue`') &&
        !job.configuration.query.query.includes('{{'),
    ),
  ).toBe(true);
  const before = requests.length;
  expect(
    await callService({
      action: 'validateMetricExpression',
      dataSourceId: source.id,
      expression,
      formulaDialect: 'duckdb',
    }),
  ).toMatchObject({ valid: false, error: { message: expect.stringContaining('requires duckdb') } });
  expect(requests.length).toBe(before);
  const originalFetch = globalThis.fetch;
  let returnIntegerSchema = true;
  let repeatedSchema = false;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    if (new URL(request.url).pathname.endsWith('/jobs') && returnIntegerSchema)
      return Response.json({
        statistics: {
          query: {
            schema: {
              fields: [
                { name: 'value', type: 'INTEGER', mode: repeatedSchema ? 'REPEATED' : 'NULLABLE' },
              ],
            },
          },
        },
      });
    if (new URL(request.url).pathname.endsWith('/jobs'))
      return Response.json(
        {
          error: {
            message: 'No matching signature for function ROUND',
            errors: [{ reason: 'invalidQuery' }],
          },
        },
        { status: 400 },
      );
    return originalFetch(input as RequestInfo, init);
  });
  const badDate = {
    ...calculated,
    name: 'Bad date',
    canonicalName: 'bad_date',
    expression: '42',
    semanticType: 'date',
  };
  expect(await callService({ ...badDate, action: 'validateCalculatedField' })).toMatchObject({
    valid: false,
    error: { message: 'Formula returns INTEGER, but date requires date.' },
  });
  await expectApiError(callService(badDate), { status: 400, code: 'invalid_query' });
  repeatedSchema = true;
  expect(
    await callService({
      action: 'validateMetricExpression',
      dataSourceId: source.id,
      expression: 'ARRAY_AGG({{revenue}})',
      formulaDialect: 'bigquery',
    }),
  ).toMatchObject({
    valid: false,
    error: { message: 'Formula returns ARRAY<INTEGER>, but count requires number.' },
  });
  returnIntegerSchema = false;
  expect(
    await callService({ ...calculated, id: stored.id, action: 'validateCalculatedField' }),
  ).toMatchObject({
    valid: false,
    error: { message: 'No matching signature for function ROUND' },
  });
  await expectApiError(
    callService({ ...calculated, name: 'Rejected field', canonicalName: 'rejected' }),
    { status: 400, code: 'invalid_query' },
  );
  expect(await callService({ action: 'listLibraryMetrics' })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: metric.id, formulaDialect: 'bigquery' }),
    ]),
  );
});
