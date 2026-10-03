# Query container startup

Measured on 3 October 2026 using native Linux ARM64 containers in Docker Desktop on macOS.
These measurements describe local process and Docker readiness, not Cloudflare cold starts.

## Retained changes

- Multi-stage build with Bun's distroless runtime. Build tools and source files stay in the build stage.
- Bundle the query server, including Zod and DuckDB's JavaScript API, into minified CommonJS and
  precompiled Bun bytecode. The native DuckDB binding remains external.
- Remove the unused musl binding. Both base images use glibc.
- Strip unused symbols from DuckDB's native libraries. Preserve the signed `httpfs` extension.
- Copy the C++ runtime libraries required by DuckDB into the runtime image.
- Poll container readiness every 50 ms instead of the SDK's default 300 ms, preserving caller
  cancellation, timeouts, start options, and the SDK's startup failure handling.
- Use `localhost/ready` for the SDK health check. It constructs a URL by prepending `http://`;
  the previous `/ready` value did not address the intended route.

## Measurements

The final comparison alternated image order across 15 fresh containers per image. Every container
had to serve `/ready` and successfully execute `SELECT 42 AS answer` through `/query`.

| Measurement | Before | Retained image |
| --- | ---: | ---: |
| Uncompressed ARM64 image | 370.7 MB | 210.5 MB |
| Median Docker start timestamp to observed readiness | 93 ms | 67 ms |
| Median first query HTTP round trip | 12.1 ms | 11.4 ms |
| Median process initialization reported by Bun | Uninstrumented | 28.9 ms |

Docker readiness includes host CLI overhead, Docker networking, and readiness polling. It is not
an isolated process initialization measurement. The process metric uses `performance.now()` at
server startup and includes initial module loading.

Exploratory nine-run comparisons found that bundling only Zod saved about 8 ms, bundling DuckDB's
JavaScript API saved more, and bytecode compilation saved a further 12 ms. Stripping native symbols
saved 9.3 MB without a measurable startup improvement. A minimal Bun HTTP server on the same image
reached observed readiness in 61 ms and reported 4.7 ms of process initialization. It did not load
DuckDB or execute SQL.

A build-time native-binding selection experiment reduced process initialization by about 3 ms
but required custom native-module bundling. It was rejected to retain the package's platform loader.
A standalone executable experiment could not resolve the external native dependency and produced
a larger image.

The actual Containers SDK readiness loop was also exercised with a simulated port that became ready
at 110 ms. Detection took approximately 304 ms with the old interval and 159 ms with the new interval.
This isolates polling overhead; it does not measure VM allocation or Cloudflare transport.

## Reproduce

Build locally for the host's native architecture. On Apple Silicon:

```sh
docker build --platform linux/arm64 -t yresonance-cold-start:optimized .
bun scripts/benchmark-query-startup.ts --rounds=15 yresonance-cold-start:optimized
```

To compare two existing images, pass both image tags. The script alternates their order and removes
every container it creates. It uses loopback ports and performs no Cloudflare requests.

```sh
bun scripts/benchmark-query-startup.ts --rounds=15 yresonance-cold-start:baseline yresonance-cold-start:optimized
```

The final image also passed HTTP CSV reads, CSV-to-Parquet ingestion, HTTP Parquet range reads,
date conversion, parameter binding, invalid query rejection, expired request rejection, and a
successful query after those failures against an isolated local fixture server.

## Deployment boundary

The initial local experiments did not deploy anything. The Linux AMD64 baseline build crashed
while loading DuckDB under this Mac's emulation, an existing limitation also documented in the
README. Native AMD64 CI subsequently built the retained image and deployed it to PR 54's isolated
preview. The following experiments reuse that deployed image. No production deployment or
production data change was made.

The previous production request's `containerStartMs` included both startup and transport. New logs
separate `yresonance.query_engine_ready.processStartupMs` inside Bun from
`yresonance.query_engine_start.startupDurationMs` in the Durable Object. Together with the existing
query and queue timings, they allow a preview benchmark to distinguish process loading, container
startup, and request transport. Longer idle timeouts and prewarming were not changed.


## Cloudflare placement and CPU comparison

On 3 October 2026, a temporary authenticated benchmark Worker ran the same deployed image in
three isolated container applications. Each application allowed one instance. Every measured
request began with the SDK reporting `stopped`, awaited readiness with 50 ms polling, executed
its workload, and destroyed the container. Variant order rotated each round. The test used the
PR 54 image digest `cb7a7ffe8d15e24b328526116504b6df7a52a16c5d660c4694a34ed0233f9ccf`.

The variants were `basic` with default placement, `basic` constrained to `WEUR` and `EEUR`, and
`standard-2` constrained to those European regions. Cloudflare confirmed the last configuration
had 1 vCPU and 6 GiB memory, versus 0.25 vCPU and 1 GiB for `basic`.

| Median measurement | Basic, default | Basic, Europe | 1 vCPU, Europe |
| --- | ---: | ---: | ---: |
| Readiness before SELECT 42, 8 starts each | 1,166 ms | 605 ms | 655 ms |
| Readiness before example ingestion, 6 starts each | 604 ms | 826 ms | 1,000 ms |
| Example ingestion execution, 6 runs each | 442 ms | 465 ms | 484 ms |

Readiness includes platform allocation, process loading, networking between the Durable Object
and container, and the SDK health checks. Execution includes HTTP reads and upload through a
Worker fixture handler. That handler served the same synthetic campaign CSV and accepted the
Parquet output without D1 or R2. It does not reproduce the preview's complete seeding workflow.
The client measurements in the [raw results](./benchmarks/2026-10-03-cloudflare-startup.csv) also
include authentication, RPC, network transport, and container destruction before the response.

All 42 recorded starts completed successfully. Startup variance was large: the first workload's
basic/default readiness ranged from 472 to 4,648 ms. These samples do not establish a stable
percentage improvement from regional placement, or compare the PR against an unoptimized deployed
image. More CPU showed no consistent benefit for either workload, so the PR retains `basic`.
The repository constrains placement specifically to `WEUR`, rather than both regions used in this
experiment, to keep query containers near the new PR storage location hints. Existing databases
and buckets retain their original locations.

The temporary Worker and its three container applications were deleted after the comparison.

## Preview bootstrap without container startup

Build-time preparation packages a 28,906-byte Parquet file with its actual DuckDB description and
20 sample rows. The current fixture has 2,378 rows from 6 July through 3 October 2026. Its 90-day
window refreshes on each build. Runtime seeding performs one R2 upload and a D1 batch that inserts
the datasource, its fields, and the workspace completion marker. It preserves per-workspace
claims, retry cleanup, naming, and isolation. It creates no ingestion tokens and sends no query
engine requests. User-uploaded CSVs still use the normal ingestion and inspection path.

`yresonance.preview_seed_prepared` records upload time, registration time, and the prepared dataset's
end date. The existing overall seeding metric remains. A first real widget query can still start
the container. There is no new deployed end-to-end bootstrap measurement yet; the previous
9-second observation is not a measured before/after result for this change.

Integration coverage exercises concurrent first requests with an unavailable engine, upload
failures including a lost acknowledgement, registration failure after upload, abandoned claims,
workspace isolation, and persisted completion. The unavailable-engine case failed against the
previous service and passed with prepared seeding. The native DuckDB build fixture was also queried
directly to validate its row count, date range, and aggregate metrics.
