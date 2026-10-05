import { z } from 'zod';
import type { ApiRequest } from '../src/api/contracts';
import type { WidgetDefinition } from '../src/domain/schema';

const sourceSchema = z.object({
  id: z.string(),
  cachePolicy: z.object({ mode: z.literal('disabled') }),
  fields: z.array(z.object({ id: z.string(), columnName: z.string() })),
});
const resultSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())),
  comparisonRows: z.array(z.record(z.string(), z.unknown())).optional(),
  cache: z.literal('miss'),
});
type Api = (request: ApiRequest) => Promise<unknown>;

// Run in an authenticated preview browser, or with a short-lived Clerk session token below.
// Creates new synthetic sources and a dashboard. Branch-preview cleanup owns their lifetime.
export async function benchmarkUncachedQueries({
  api,
  baseUrl,
  rowCount = 100_000,
  iterations = 10,
  uploadHeaders = {},
}: {
  api: Api;
  baseUrl: string;
  rowCount?: number;
  iterations?: number;
  uploadHeaders?: Record<string, string>;
}) {
  const url = new URL(baseUrl);
  if (!url.hostname.endsWith('.workers.dev') || url.protocol !== 'https:')
    throw new Error('Use a Cloudflare preview URL.');
  z.number().int().min(1).max(1_000_000).parse(rowCount);
  z.number().int().min(1).max(100).parse(iterations);
  const startedAt = new Date().toISOString();
  const name = `Uncached benchmark ${startedAt} ${rowCount}`;
  const csv = ['Date,Campaign,Platform,Impressions,Clicks'];
  for (let index = 0; index < rowCount; index++)
    csv.push(
      `2026-01-${String((index % 28) + 1).padStart(2, '0')},Campaign ${index % 100},Platform ${index % 4},${1000 + (index % 1000)},${index % 100}`,
    );
  const contents = csv.join('\n');
  const uploadBytes = new TextEncoder().encode(contents).byteLength;
  const sources = [];
  for (const backend of ['duckdb', 'clickhouse'] as const) {
    const upload = z
      .object({ key: z.string(), uploadUrl: z.string(), cleanupToken: z.string() })
      .parse(
        await api({
          action: 'prepareDatasourceUpload',
          fileName: 'uncached-benchmark.csv',
          fileSize: uploadBytes,
          format: 'csv',
        }),
      );
    const response = await fetch(new URL(upload.uploadUrl, baseUrl), {
      method: 'PUT',
      headers: { ...uploadHeaders, 'content-type': 'text/csv' },
      body: contents,
    });
    if (!response.ok) throw new Error(`Upload failed: HTTP ${response.status}`);
    const registered = z.object({ id: z.string() }).parse(
      await api({
        action: 'registerDatasource',
        name: `${name} ${backend}`,
        backend,
        location: { kind: 'object', key: upload.key, format: 'csv' },
        cleanupToken: upload.cleanupToken,
        cachePolicy: { mode: 'disabled' },
      }),
    );
    const source = sourceSchema.parse(
      await api({ action: 'describeDatasource', dataSourceId: registered.id }),
    );
    sources.push({ backend, source });
  }
  const dashboard = z.object({ id: z.string() }).parse(
    await api({
      action: 'createDashboard',
      name,
      dataSourceIds: sources.map(({ source }) => source.id),
      timezone: 'Europe/Berlin',
      defaultDateRange: {
        startDate: { fixed: '2026-01-01' },
        endDate: { fixed: '2026-01-28' },
      },
    }),
  );
  const widgets = [];
  for (const { backend, source } of sources) {
    const field = (column: string) => {
      const found = source.fields.find((entry) => entry.columnName === column);
      if (!found) throw new Error(`Missing field: ${column}`);
      return found.id;
    };
    const metric = {
      source: {
        kind: 'field' as const,
        fieldId: field('Impressions'),
        aggregation: 'sum' as const,
      },
      dataType: 'number' as const,
    };
    const common = { dataSourceId: source.id, dateRangeFieldId: field('Date') };
    const definitions = [
      { ...common, type: 'scorecard', title: 'Total', metric },
      {
        ...common,
        type: 'line',
        title: 'Daily trend',
        dimension: { fieldId: field('Date'), dateGranularity: 'day' },
        metrics: [metric],
      },
      {
        ...common,
        type: 'table',
        title: 'Campaign breakdown',
        dimensions: [{ fieldId: field('Campaign') }, { fieldId: field('Platform') }],
        metrics: [metric],
        resultLimit: { mode: 'top', amount: 100 },
        sort: [{ target: { kind: 'metric', index: 0 }, direction: 'desc' }],
      },
      {
        ...common,
        type: 'scorecard',
        title: 'Comparison',
        metric,
        comparison: { mode: 'previousPeriod' },
      },
    ] satisfies WidgetDefinition[];
    for (const definition of definitions) {
      const added = z.object({ widget: z.object({ id: z.string() }) }).parse(
        await api({
          action: 'addWidget',
          dashboardId: dashboard.id,
          definition,
          width: 6,
          height: 4,
        }),
      );
      widgets.push({ backend, workload: definition.title, widgetId: added.widget.id });
    }
  }
  const samples = [];
  const expected = new Map<string, string>();
  const measure = async (widget: (typeof widgets)[number], phase: string, iteration: number) => {
    const start = performance.now();
    const result = resultSchema.parse(
      await api({ action: 'queryWidget', dashboardId: dashboard.id, widgetId: widget.widgetId }),
    );
    const durationMs = performance.now() - start;
    // Normalize numeric JSON representation and row ordering across both engines.
    const canonicalRows = (rows: typeof result.rows) =>
      rows
        .map((row) =>
          JSON.stringify(
            Object.entries(row)
              .sort()
              .map(([key, value]) => [key, value == null ? null : String(value)]),
          ),
        )
        .sort();
    const canonical = JSON.stringify([
      canonicalRows(result.rows),
      canonicalRows(result.comparisonRows ?? []),
    ]);
    const previous = expected.get(widget.workload);
    if (previous !== undefined && previous !== canonical)
      throw new Error(`Results differ for ${widget.backend} ${widget.workload}`);
    expected.set(widget.workload, canonical);
    return {
      ...widget,
      phase,
      iteration,
      timestamp: new Date().toISOString(),
      durationMs,
      cache: result.cache,
      resultRows: result.rows.length,
    };
  };
  // Alternate engine order to reduce drift. Setup has already warmed DuckDB; no cold-start claim.
  for (let iteration = 0; iteration < iterations; iteration++) {
    for (let workload = 0; workload < 4; workload++) {
      const pair = [widgets[workload]!, widgets[workload + 4]!];
      if (iteration % 2) pair.reverse();
      for (const widget of pair) samples.push(await measure(widget, 'serial', iteration));
    }
  }
  for (const backend of ['duckdb', 'clickhouse'] as const) {
    const backendWidgets = widgets.filter((widget) => widget.backend === backend);
    for (let iteration = 0; iteration < Math.min(iterations, 5); iteration++) {
      const start = performance.now();
      samples.push(
        ...(await Promise.all(
          backendWidgets.map((widget) => measure(widget, 'concurrent', iteration)),
        )),
      );
      samples.push({
        backend,
        workload: 'All four widgets',
        phase: 'dashboard',
        iteration,
        timestamp: new Date().toISOString(),
        durationMs: performance.now() - start,
      });
    }
  }
  return {
    baseUrl,
    startedAt,
    endedAt: new Date().toISOString(),
    rowCount,
    uploadBytes,
    iterations,
    dashboardId: dashboard.id,
    sources: sources.map(({ backend, source }) => ({
      backend,
      id: source.id,
      cachePolicy: source.cachePolicy,
    })),
    samples,
  };
}

if (import.meta.main) {
  const baseUrl = z.url().parse(process.env.YRESONANCE_PREVIEW_URL);
  const token = z.string().min(1).parse(process.env.YRESONANCE_SESSION_TOKEN);
  const headers = { Authorization: `Bearer ${token}` };
  const api: Api = async (input) => {
    const response = await fetch(new URL('/api/yresonance', baseUrl), {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify(input),
    });
    const body = z
      .discriminatedUnion('ok', [
        z.object({ ok: z.literal(true), data: z.unknown() }),
        z.object({ ok: z.literal(false), error: z.object({ message: z.string() }) }),
      ])
      .parse(await response.json());
    if (!body.ok) throw new Error(`${input.action}: ${body.error.message}`);
    return body.data;
  };
  const result = await benchmarkUncachedQueries({ api, baseUrl, uploadHeaders: headers });
  console.log(JSON.stringify(result, null, 2));
}
