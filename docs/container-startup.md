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
docker build --platform linux/arm64 -t rundown-cold-start:optimized .
bun scripts/benchmark-query-startup.ts --rounds=15 rundown-cold-start:optimized
```

To compare two existing images, pass both image tags. The script alternates their order and removes
every container it creates. It uses loopback ports and performs no Cloudflare requests.

```sh
bun scripts/benchmark-query-startup.ts --rounds=15 rundown-cold-start:baseline rundown-cold-start:optimized
```

The final image also passed HTTP CSV reads, CSV-to-Parquet ingestion, HTTP Parquet range reads,
date conversion, parameter binding, invalid query rejection, expired request rejection, and a
successful query after those failures against an isolated local fixture server.

## Deployment boundary

No deployment or production data change was made. The Linux AMD64 baseline build crashed while
loading DuckDB under this Mac's emulation, an existing limitation also documented in the README.
The deployed architecture therefore still requires a native AMD64 build and an isolated Cloudflare
preview benchmark before these local improvements can be translated into a deployed latency claim.

The previous production request's `containerStartMs` included both startup and transport. New logs
separate `rundown.query_engine_ready.processStartupMs` inside Bun from
`rundown.query_engine_start.startupDurationMs` in the Durable Object. Together with the existing
query and queue timings, they allow a preview benchmark to distinguish process loading, container
startup, and request transport. Longer idle timeouts and prewarming were not changed.
