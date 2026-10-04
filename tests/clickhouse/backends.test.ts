import { DuckDBInstance, type DuckDBValue } from '@duckdb/node-api';
import { afterAll, beforeAll, expect, test, vi } from 'vitest';
import { compileDatasourceQuery } from '#/data/backend-query';
import { clickhouseBackend } from '#/data/connectors/clickhouse.server';
import {
  clickhouseRequest,
  managedClickhouseDatabase,
  managedTableName,
  clickhouseTableSql,
} from '#/data/clickhouse.server';
import type { DatasourceQuery } from '#/data/connectors/contract';
import type { DataSourceRecord, FieldRecord } from '#/query/types';
import type { DashboardDocument, WidgetDefinition } from '#/domain/schema';

vi.mock('cloudflare:workers', () => ({
  env: {
    ...process.env,
    R2_BUCKET_NAME: 'backend-conformance',
    QUERY_CACHE_NAME: 'backend-conformance',
    CLICKHOUSE_DATABASE: 'yresonance_development',
  },
}));

const workspaceId = `conformance_${crypto.randomUUID()}`;
const id = `ds_${crypto.randomUUID()}`;
const table = await managedTableName(workspaceId, id);
let source: DataSourceRecord;
let sqlSource: string;
let duckdb: DuckDBInstance;
let connection: Awaited<ReturnType<DuckDBInstance['connect']>>;
const columns = [
  ['day', 'date'],
  ['name', 'text'],
  ['amount', 'count'],
  ['impressions', 'count'],
  ['money', 'count'],
] as const;
const fields: FieldRecord[] = columns.map(([columnName, semanticType]) => ({
  id: columnName,
  dataSourceId: id,
  columnName,
  canonicalName: columnName,
  label: columnName,
  role: 'dimension',
  semanticType,
  description: null,
  hidden: false,
  castTo: null,
  sampleValues: null,
  cardinality: null,
}));
const metadata = { fields, calculatedFields: [], libraryMetrics: [] };
const dashboard: DashboardDocument = {
  id: 'dashboard',
  workspaceId,
  name: 'Conformance',
  schemaVersion: 2,
  timezone: 'Europe/Berlin',
  defaultDateRange: { startDate: { fixed: '2026-08-01' }, endDate: { fixed: '2026-08-31' } },
  columns: 12,
  canvasRows: 10,
  widgets: [],
  createdBy: 'test',
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};
const definition = (
  aggregation: 'sum' | 'median' = 'sum',
): Extract<WidgetDefinition, { type: 'scorecard' }> => ({
  type: 'scorecard',
  title: 'Amount',
  dataSourceId: id,
  dateRangeFieldId: 'day',
  metric: { source: { kind: 'field', fieldId: 'amount', aggregation }, dataType: 'number' },
});

beforeAll(async () => {
  // Node requires duplex for streamed request bodies; Workers accepts them directly.
  const nativeFetch = globalThis.fetch;
  const workerFetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const streamingInit = { ...init, duplex: 'half' };
    return nativeFetch(input, streamingInit);
  };
  vi.stubGlobal('fetch', workerFetch);
  const database = managedClickhouseDatabase();
  sqlSource = clickhouseTableSql(database, table);
  source = {
    id,
    workspaceId,
    name: 'Conformance',
    connectorType: 'clickhouse',
    version: 'immutable',
    location: { kind: 'clickhouse', database, table, ownership: 'managed', cacheTtlSeconds: 300 },
  };
  await clickhouseRequest(workspaceId, `CREATE DATABASE IF NOT EXISTS "${database}"`, [], {
    readonly: false,
  });
  await clickhouseRequest(
    workspaceId,
    `CREATE TABLE ${sqlSource} (day Nullable(Date32), name Nullable(String), amount Nullable(Float64), impressions Nullable(Int64), money Nullable(Decimal(10, 2))) ENGINE = MergeTree ORDER BY tuple()`,
    [],
    { readonly: false },
  );
  const rows =
    "('2026-08-01', 'A%_', 10, 100, 10.25), ('2026-08-02', 'ätest', 20, 200, 20.75), ('2026-08-02', 'B', NULL, 300, NULL)";
  await clickhouseRequest(workspaceId, `INSERT INTO ${sqlSource} VALUES ${rows}`, [], {
    readonly: false,
  });
  duckdb = await DuckDBInstance.create();
  connection = await duckdb.connect();
  await connection.run(
    'CREATE TABLE source (day DATE, name VARCHAR, amount DOUBLE, impressions BIGINT, money DECIMAL(10, 2))',
  );
  await connection.run(`INSERT INTO source VALUES ${rows}`);
});
afterAll(async () => {
  connection?.closeSync();
  duckdb?.closeSync();
  if (sqlSource)
    await clickhouseRequest(workspaceId, `DROP TABLE IF EXISTS ${sqlSource}`, [], {
      readonly: false,
    });
  vi.unstubAllGlobals();
});

async function expectParity(query: DatasourceQuery, dataSource = source, duckSource = 'source') {
  const compiled = compileDatasourceQuery(dataSource, query, duckSource);
  const prepared = await connection.prepare(compiled.sql);
  prepared.bind(compiled.parameters as DuckDBValue[]);
  const expected = (await prepared.runAndReadAll()).getRowObjectsJson();
  const actual = await clickhouseBackend.executeQuery(dataSource, query);
  expect(actual).toEqual(expected);
  return actual;
}

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('aggregations, nulls, formulas, and empty results match DuckDB', async () => {
  for (const aggregation of [
    'sum',
    'average',
    'count',
    'countDistinct',
    'min',
    'max',
    'median',
    'standardDeviation',
    'variance',
  ] as const) {
    const widget = {
      ...definition(),
      metric: {
        source: { kind: 'field' as const, fieldId: 'amount', aggregation },
        dataType: 'number' as const,
      },
    };
    await expectParity({
      kind: 'widget',
      dashboard,
      definition: widget,
      metadata,
      controlState: {},
    });
    await expectParity({
      kind: 'widget',
      dashboard,
      definition: widget,
      metadata,
      controlState: {
        dateRange: { startDate: { fixed: '2025-01-01' }, endDate: { fixed: '2025-01-02' } },
      },
    });
  }
  for (const expression of [
    'sum(amount) / nullif(sum(impressions), 0)',
    "sum(if(contains(name, '%_'), amount, 0))",
    'sum(length(name))',
    "sum(date_part('year', day))",
    "sum(if(starts_with(name, 'ä'), amount, 0))",
    "sum(if(ends_with(name, '_'), amount, 0))",
  ]) {
    await expectParity({
      kind: 'widget',
      dashboard,
      definition: {
        ...definition(),
        metric: { source: { kind: 'expression', expression }, dataType: 'number' },
      },
      metadata,
      controlState: {},
    });
  }
});

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('date buckets, grouping sets, filtering, sorting, pagination, and scale bounds match DuckDB', async () => {
  const widget: Extract<WidgetDefinition, { type: 'table' }> = {
    type: 'table',
    title: 'Grouped',
    dataSourceId: id,
    dateRangeFieldId: 'day',
    dimensions: [{ fieldId: 'day', dateGranularity: 'day' }, { fieldId: 'name' }],
    metrics: [definition().metric],
    resultLimit: { mode: 'pagination', amount: 2 },
    showSubtotals: true,
    showSummaryRow: true,
  };
  await expectParity({
    kind: 'widget',
    dashboard,
    definition: widget,
    metadata,
    controlState: {},
    offset: 0,
  });
  await expectParity({
    kind: 'widget',
    dashboard,
    definition: widget,
    metadata,
    controlState: {},
    offset: 2,
  });
  const [bounds] = await expectParity({
    kind: 'widget',
    dashboard,
    definition: widget,
    metadata,
    controlState: {},
    scaleBounds: true,
  });
  expect(bounds).toMatchObject({ min_1: expect.anything(), max_1: expect.anything() });
  await expectParity({
    kind: 'widget',
    dashboard,
    definition: {
      ...widget,
      filter: {
        connector: 'and',
        conditions: [{ fieldId: 'name', operator: 'contains', value: 'ä' }],
      },
    },
    metadata,
    controlState: {},
  });
});

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('control searches escape wildcard characters and match Unicode text', async () => {
  for (const search of [undefined, '%_', 'Ä', "'\\?"]) {
    await expectParity({
      kind: 'controlOptions',
      field: fields[1],
      metadata,
      search,
      direction: 'ASC',
    });
  }
});

test('managed Parquet imports are queryable and a failed import removes its table', async () => {
  const { mkdtemp, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createServer } = await import('node:http');
  const { ingestClickhouseUpload, removeClickhouseUpload } =
    await import('#/data/clickhouse-ingestion.server');
  const { env } = await import('cloudflare:workers');
  const directory = await mkdtemp(join(tmpdir(), 'clickhouse-parquet-'));
  const path = join(directory, 'source.parquet');
  await connection.run(`COPY source TO '${path}' (FORMAT PARQUET)`);
  let bytes = await readFile(path);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-length': String(bytes.byteLength) }).end(bytes);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Test source failed to bind.');
  const bindings = env as unknown as Record<string, unknown>;
  const oldBase = bindings.DATA_SOURCE_BASE_URL;
  bindings.DATA_SOURCE_BASE_URL = `http://127.0.0.1:${address.port}`;
  const importId = `ds_${crypto.randomUUID()}`;
  const inspection = {
    version: 'file-revision',
    description: (await connection.runAndReadAll('DESCRIBE source')).getRowObjectsJson() as Array<{
      column_name: string;
      column_type: string;
    }>,
    samples: [],
  };
  let location: Awaited<ReturnType<typeof ingestClickhouseUpload>> | undefined;
  try {
    location = await ingestClickhouseUpload(workspaceId, importId, 'source.parquet', inspection);
    const imported = { ...source, id: importId, location };
    await expect(
      clickhouseBackend.inspect({ ...imported, workspaceId: 'another-workspace' }),
    ).rejects.toThrow('This ClickHouse table belongs to another workspace.');
    const result = await clickhouseBackend.executeQuery(imported, {
      kind: 'widget',
      dashboard,
      definition: { ...definition(), dataSourceId: importId },
      metadata,
      controlState: {},
    });
    expect(result).toEqual([{ metric_1: 30 }]);
    bytes = Buffer.from('not a Parquet file');
    const failureId = `ds_${crypto.randomUUID()}`;
    await expect(
      ingestClickhouseUpload(workspaceId, failureId, 'invalid.parquet', inspection),
    ).rejects.toThrow('ClickHouse could not complete the request.');
    const exists = await clickhouseRequest(
      workspaceId,
      `EXISTS TABLE ${clickhouseTableSql(location.database, await managedTableName(workspaceId, failureId))} FORMAT JSON`,
    );
    expect(exists?.data).toEqual([{ result: 0 }]);
  } finally {
    bindings.DATA_SOURCE_BASE_URL = oldBase;
    if (location) await removeClickhouseUpload(workspaceId, location.database, location.table);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('preview databases retain data across builds and cleanup removes only the closed branch', async () => {
  const { managePreviewClickhouse } = await import('../../scripts/clickhouse-preview');
  const { previewClickhouseDatabase } = await import('../../scripts/preview-config');
  for (const key of ['URL', 'USER', 'PASSWORD', 'ACCESS_CLIENT_ID', 'ACCESS_CLIENT_SECRET']) {
    vi.stubEnv(
      `CLICKHOUSE_PREVIEW_${key}`,
      process.env[`CLICKHOUSE_${key}`] ?? 'unused-local-access-token',
    );
  }
  const branch = `conformance/${crypto.randomUUID()}/report`;
  const otherBranch = branch.replaceAll('/', '-');
  const database = previewClickhouseDatabase(branch);
  const otherDatabase = previewClickhouseDatabase(otherBranch);
  try {
    await managePreviewClickhouse('prepare', branch);
    await managePreviewClickhouse('prepare', otherBranch);
    await clickhouseRequest(
      workspaceId,
      `CREATE TABLE "${database}".retained (amount UInt8) ENGINE = Memory`,
      [],
      { readonly: false },
    );
    await clickhouseRequest(workspaceId, `INSERT INTO "${database}".retained VALUES (42)`, [], {
      readonly: false,
    });
    await managePreviewClickhouse('prepare', branch);
    expect(
      (
        await clickhouseRequest(
          workspaceId,
          `SELECT amount FROM "${database}".retained FORMAT JSON`,
        )
      )?.data,
    ).toEqual([{ amount: 42 }]);
    await managePreviewClickhouse('cleanup', branch);
    await managePreviewClickhouse('cleanup', branch);
    expect(
      (await clickhouseRequest(workspaceId, `EXISTS DATABASE "${database}" FORMAT JSON`))?.data,
    ).toEqual([{ result: 0 }]);
    expect(
      (await clickhouseRequest(workspaceId, `EXISTS DATABASE "${otherDatabase}" FORMAT JSON`))
        ?.data,
    ).toEqual([{ result: 1 }]);
    await expect(managePreviewClickhouse('cleanup', 'main')).rejects.toThrow(
      'non-production branch',
    );
  } finally {
    await managePreviewClickhouse('cleanup', branch);
    await managePreviewClickhouse('cleanup', otherBranch);
    vi.unstubAllEnvs();
  }
});

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('decimal and integer aggregates preserve numeric JSON types', async () => {
  for (const fieldId of ['money', 'impressions']) {
    for (const aggregation of [
      'sum',
      'average',
      'count',
      'countDistinct',
      'min',
      'max',
      'median',
    ] as const) {
      await expectParity({
        kind: 'widget',
        dashboard,
        definition: {
          ...definition(),
          metric: { source: { kind: 'field', fieldId, aggregation }, dataType: 'number' },
        },
        metadata,
        controlState: {},
      });
    }
  }
  for (const expression of [
    'sum(money) / 1000',
    'sum(money / 1000)',
    'sum(money) / sum(impressions)',
  ]) {
    await expectParity({
      kind: 'widget',
      dashboard,
      definition: {
        ...definition(),
        metric: { source: { kind: 'expression', expression }, dataType: 'number' },
      },
      metadata,
      controlState: {},
    });
  }
});

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('nullable fields cast to text retain null dimensions and formula inputs', async () => {
  await expectParity({
    kind: 'widget',
    dashboard,
    definition: {
      type: 'table',
      title: 'Nullable identifiers',
      dataSourceId: id,
      dateRangeFieldId: 'day',
      dimensions: [{ fieldId: 'money' }],
      metrics: [{ source: { kind: 'expression', expression: 'count(money)' }, dataType: 'number' }],
      resultLimit: { mode: 'top', amount: 10 },
    },
    metadata: {
      ...metadata,
      fields: fields.map((field) =>
        field.id === 'money'
          ? { ...field, role: 'dimension' as const, semanticType: 'id' as const, castTo: 'VARCHAR' }
          : field,
      ),
    },
    controlState: {},
  });
});

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('Unicode formulas and rounding preserve DuckDB behavior', async () => {
  for (const expression of [
    "sum(if(upper(name) = 'ÄTEST', amount, 0))",
    "sum(if(lower('ÄTEST') = name, amount, 0))",
    'sum(round(amount / 4))',
    'sum(round(-amount / 4))',
    'round(sum(amount) / 12)',
    'round(round(sum(amount) / 12, 1))',
    'round(2.5, nullif(1, 1))',
    'round(sum(amount), null)',
    'sum(round(amount / 8, 1))',
    'sum(round(-amount / 8, 1))',
    'sum(round(amount * 2.5, -1))',
    'sum(round(money, 1))',
    'round(sum(money), 1)',
    'sum(round(impressions, -2))',
  ]) {
    await expectParity({
      kind: 'widget',
      dashboard,
      definition: {
        ...definition(),
        metric: { source: { kind: 'expression', expression }, dataType: 'number' },
      },
      metadata,
      controlState: {},
    });
  }
});

// oxlint-disable-next-line vitest/expect-expect -- expectParity compares real engine results.
test('large integer medians and closely spaced large values retain precision', async () => {
  if (source.location.kind !== 'clickhouse') throw new Error('ClickHouse fixture required.');
  const edgeId = `ds_${crypto.randomUUID()}`;
  const edgeSource = {
    ...source,
    id: edgeId,
    location: { ...source.location, table: await managedTableName(workspaceId, edgeId) },
  };
  const edgeSql = clickhouseTableSql(edgeSource.location.database, edgeSource.location.table);
  const rows =
    "('2026-08-01', 'A', 1000000000, 5000000000000000000, NULL), ('2026-08-02', 'B', 1000000001, 6000000000000000000, NULL), ('2026-08-02', 'C', NULL, NULL, NULL)";
  await connection.run('CREATE TABLE edge_source AS SELECT * FROM source WHERE false');
  await connection.run(`INSERT INTO edge_source VALUES ${rows}`);
  await clickhouseRequest(workspaceId, `CREATE TABLE ${edgeSql} AS ${sqlSource}`, [], {
    readonly: false,
  });
  try {
    await clickhouseRequest(workspaceId, `INSERT INTO ${edgeSql} VALUES ${rows}`, [], {
      readonly: false,
    });
    for (const [fieldId, aggregation] of [
      ['impressions', 'median'],
      ['amount', 'variance'],
      ['amount', 'standardDeviation'],
    ] as const) {
      await expectParity(
        {
          kind: 'widget',
          dashboard,
          definition: {
            ...definition(),
            dataSourceId: edgeId,
            metric: { source: { kind: 'field', fieldId, aggregation }, dataType: 'number' },
          },
          metadata,
          controlState: {},
        },
        edgeSource,
        'edge_source',
      );
    }
  } finally {
    await clickhouseRequest(workspaceId, `DROP TABLE IF EXISTS ${edgeSql}`, [], {
      readonly: false,
    });
    await connection.run('DROP TABLE edge_source');
  }
});
