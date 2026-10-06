# Uncached query performance in the branch preview

DuckDB is noticeably slower on this preview. Four widgets loading together take a median
3.84 seconds on 100,000 rows and 5.96 seconds on one million rows. ClickHouse takes
0.32 and 0.58 seconds respectively. The DuckDB container's serialized query queue amplifies
its remote Parquet read costs. These measurements establish the baseline before the
[canvas and request optimizations](2026-10-05-canvas-performance.md).

## Measurements

Client elapsed time includes the authenticated API request, response download, and result
validation. Values below are median / p95 milliseconds using nearest-rank percentiles.
At five samples, p95 is the maximum, not a stable estimate of tail latency.

| Workload | DuckDB, 100k rows | ClickHouse, 100k rows | DuckDB, 1m rows | ClickHouse, 1m rows |
| --- | ---: | ---: | ---: | ---: |
| Total impressions | 1,142 / 1,247 | 249 / 266 | 1,517 / 1,707 | 282 / 298 |
| Daily trend | 1,166 / 1,433 | 255 / 267 | 1,584 / 1,633 | 313 / 370 |
| Campaign/platform breakdown | 1,140 / 1,679 | 285 / 338 | 1,623 / 1,790 | 441 / 466 |
| Total with previous-period comparison | 1,721 / 1,917 | 249 / 283 | 2,297 / 2,437 | 288 / 297 |
| Four widgets requested concurrently | 3,839 / 4,357 | 322 / 344 | 5,955 / 6,541 | 576 / 746 |

Each serial workload has ten samples per engine at 100k rows and five at 1m rows.
Each concurrent dashboard load has five samples per engine. All 200 widget responses
were cache misses, and every workload returned matching rows across engines and iterations.
The datasource descriptions also confirmed `cachePolicy: { mode: 'disabled' }`.
ClickHouse reported scans of 100k/1m rows for queries over the populated period.
DuckDB reported fresh Parquet reads. These are application result-cache-disabled runs;
OS, database page, and object-storage caches were not flushed.

## Where the time goes

Cloudflare logs correlate 250 SQL executions to their widget requests through request IDs.
The comparison workload submits two SQL executions for one widget request.

| Median engine measurement | DuckDB, 100k rows | ClickHouse, 100k rows | DuckDB, 1m rows | ClickHouse, 1m rows |
| --- | ---: | ---: | ---: | ---: |
| Query timer, serial widget requests | 663 ms | 18 ms | 1,137 ms | 67 ms |
| Engine request timer, serial widget requests | 822 ms | 61 ms | 1,309 ms | 108 ms |
| Queue wait, concurrent widget requests | 1,356 ms | No app queue | 1,896 ms | No app queue |
| DuckDB container/transport residual, serial | 39 ms | N/A | 42 ms | N/A |

DuckDB's query timer includes instance creation, configuration, HTTP Parquet reads, SQL,
and serialization. ClickHouse's timer comes from its server's JSON statistics, so these
timers have different boundaries. The DuckDB `containerStartMs` log field is a residual
of engine round-trip time minus query and queue time. It includes transport overhead and
does not independently measure cold container startup.

DuckDB queue waits reached 2.86 seconds at 100k rows and 4.61 seconds at 1m rows.
[`createQueryExecutor`](../../container/query-executor.ts) intentionally executes one query
at a time to protect the container memory limit. Even a serial comparison widget queues
its second query behind its first. The four-widget load submits five SQL executions.

The Parquet objects were 156,434 and 1,536,777 bytes. The DuckDB path authorizes and signs
object URLs for each execution, then reads them through the Worker's internal R2 endpoint.
At 100k rows, observed internal HEAD requests had a median wall time of 67 ms and GETs
115 ms. These are individual Worker invocation times, not a complete network timeline.

The median saved-widget API duration outside the longest engine request timer was about
303/298 ms for DuckDB and 144/144 ms for ClickHouse at 100k/1m rows. This includes
preparation and cleanup. DuckDB source resolution happens before its engine timer starts,
so that extra time includes R2 metadata and D1 read-budget setup as well as dashboard,
workspace, datasource, and query metadata reads. Stage spans would be needed to divide
that remainder accurately. An authenticated `listDataSources` control had a median client
latency of 116 ms over ten requests, with one 512 ms outlier.

A local macOS control used the same `executeQueryEngineRequest` implementation, a fresh
DuckDB instance per request, and an equivalent 100k-row total query. Median elapsed time
was 5.4 ms over a local Parquet file and 12.9 ms when serving that file over localhost HTTP.
This is different hardware, so it is not a container CPU benchmark. Together with the
preview read timings, it supports remote file access as a major source of DuckDB latency;
it does not establish the exact share attributable to each network hop.

## Environment and limits

Measured on 2026-10-05, 08:08:20–08:12:54 UTC, or 10:08:20–10:12:54 Europe/Berlin.
The 100k and 1m runs used one isolated native branch preview and the development Clerk E2E
workspace. Its Worker version was `f3975883-df6a-49a1-89dd-c889a57e9630`, built from
`bd89240`. The benchmark itself ran from the corrected local script through an authenticated
collaborative browser. Both datasets used the same deployed application code. No production
resources were queried or changed.

The data has five columns, 28 dates in January 2026, 100 campaigns, four platforms, and
varied integer metrics. Both engines received identical CSV bytes through the application's
normal upload path. Uploads and widget creation were excluded from measurements. Setup
warms the query container, so none of these numbers represent a cold start. Results were
validated after each request. Serial engine order alternated each iteration; concurrent
engine order also alternated between dashboard loads.

The previous 28-day comparison period has no rows in this fixture. Its ClickHouse query can
therefore eliminate the scan. That workload measures handling of an empty comparison period,
not two equally populated periods. These synthetic files also do not establish performance
for many files, wide tables, high-cardinality grouping, remote users, or large result sets.
The initial exploratory run used more compressible data and is excluded from the tables.

Preview builds disable PostHog. The current PostHog integration exports API events and logs,
but has no query-stage distributed spans. This investigation used Cloudflare preview logs
and their request/trace IDs instead. It did not enable preview traffic in product analytics.
Cloudflare trace sampling also means the retained engine CSV is a log correlation record,
not a complete span tree.

## Next performance work

The first DuckDB experiment should separate remote reads from SQL in the container, then
compare authorized local Parquet reuse across requests for immutable datasource versions.
That would require bounded storage, version checks, and workspace isolation. Simply removing
the query queue would risk the memory limit without addressing the per-query read cost.

For both engines, time dashboard authorization, datasource/metadata loading, and source
resolution separately. ClickHouse already spends much more time in API preparation than in
its small aggregate queries. At this baseline, metadata reads ran in parallel within `loadQueryMetadata`. The follow-up
batches those reads and reuses metadata within creation and update requests. A further experiment would share preparation across a dashboard's widgets while preserving
per-request authorization and freshness.

## Reproduce and inspect

[`scripts/benchmark-uncached-queries.ts`](../../scripts/benchmark-uncached-queries.ts) exports
`benchmarkUncachedQueries({ api, baseUrl, rowCount, iterations })`. Supply an authenticated
API callback from a preview browser so Clerk continues refreshing its session. The callback
accepts the existing `ApiRequest` contract and returns the successful response's `data`.
Uploads use the browser's same-origin credentials. Keep the browser on the preview while
awaiting the result.

For a session JWT valid for the entire run, the Bun entry point is also available:

```sh
export YRESONANCE_PREVIEW_URL='https://t3code-benchmark-uncached-query-performance-yresonance.rundown.workers.dev'
# Supply a development Clerk session JWT with its active organization; do not commit it.
export YRESONANCE_SESSION_TOKEN='<session JWT>'
QUERY_BENCHMARK_ROWS=100000 QUERY_BENCHMARK_ITERATIONS=10 bun run scripts/benchmark-uncached-queries.ts > /tmp/uncached-100k.json
QUERY_BENCHMARK_ROWS=1000000 QUERY_BENCHMARK_ITERATIONS=5 bun run scripts/benchmark-uncached-queries.ts > /tmp/uncached-1m.json
```

A normal short-lived JWT may expire before the benchmark finishes; use the browser callback
for automatic session refresh. The script accepts native branch-preview hosts only and
creates new synthetic datasources and a dashboard on each run. Their IDs are returned in
the result. They remain available for inspection until the branch preview is cleaned up.
The script never changes caching policies on existing datasources.

Evidence:

- [Client samples](2026-10-05-uncached-client.csv)
- [Correlated engine timings](2026-10-05-uncached-engine.csv)
- [Run metadata and datasource policies](2026-10-05-uncached-metadata.json)
- [Local DuckDB control samples](2026-10-05-local-duckdb-control.jsonl)

Read preview logs through `cf observability telemetry query`, filtered by
`$workers.preview.id = 252fa8a9607547feae6600d63e624d14` and the run's exact time window.
The engine CSV contains the request, query, and trace IDs needed to narrow that lookup.
Do not query the parent Worker's production logs to reproduce this preview investigation.
