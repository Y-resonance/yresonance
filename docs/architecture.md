## Architecture

The TanStack Start app and API run in a Cloudflare Worker. Query execution runs in a Bun Cloudflare
Container with native DuckDB. The Worker authorizes exact Parquet objects, compiles yresonance formulas
to SQL, and gives DuckDB short-lived internal URLs for those objects. The container has no internet
access or R2 credentials.

Editors register uploaded or existing CSV and Parquet files from tenant-scoped R2 prefixes.
ClickHouse is also available for managed uploads and authorized external tables. See
[ClickHouse setup and freshness](clickhouse.md) for server configuration. Auth is
Clerk, with workspaces mapped to Clerk organizations. Application data lives in D1 with Drizzle.
Signed dashboard requests batch the dashboard and workspace reads. Widget creation and updates
load datasource metadata once, then reuse it for validation, hashing, and SQL compilation before
the conditional dashboard save. Query execution batches datasource and metadata reads too.
Builder refreshes request `getDashboard` with `includeSharing: false` to avoid Clerk directory
lookups; initial loads and sharing changes retain the default sharing payload.

Nothing domain-specific is hardcoded: metrics such as VTR or CPV are workspace data, not code.

Preview workspaces automatically receive an "Example campaign data" datasource on their first
bootstrap. The build prepares 90 days of synthetic campaign delivery ending on the build date,
including Parquet conversion and inspected field metadata. Bootstrap uploads the prepared file and
registers its fields without starting the query container. `bun run dev`, `build`, `typecheck`, and
`test:integration` automatically regenerate the ignored `.generated/preview-example.json` fixture.
Seeding is enabled only by `APP_ENV=preview`;
local development and production do not seed. Completion is stored per workspace, so redeploying or
renaming the datasource does not create another example. Failed imports retry on the next bootstrap;
concurrent requests wait up to two minutes for another Worker isolate to finish. An interrupted
import's claim expires after one hour.

More detail: [docs/decisions.md](./decisions.md).

Dashboard images are uploaded by editors to `PUT /api/dashboards/:id/assets`, streamed to R2 at
`ws/<workspaceId>/assets/<assetId>/original`, and recorded in `dashboard_assets` with the
dimensions the Images binding (`IMAGES`) reads. The Worker checks the file signature and deletes
rejected files again. `GET /api/dashboards/:id/assets/:assetId?w=` authorizes like the dashboard,
including `share` tokens, and only serves images the visible dashboard shows. Widths from
`IMAGE_WIDTHS` below the original's get an AVIF or WebP variant, made once and stored next to the
original as `w<width>.<format>`. Other widths, AVIF sources, and transform errors (such as quota
error 9422) get the original. Responses are `private, immutable` with `Vary: Accept`, except that an
original served after a transform error is cached for 5 minutes so that width recovers. Workers Cache
stays off for these routes. Locally, miniflare's sharp-based mock stands in for the binding
and supports width, height, rotate and format only. The default upload limit is 20 MB, the binding's
input cap; `IMAGE_UPLOAD_MAX_BYTES` can lower it per deployment. Unreferenced assets are not yet
swept.

Datasource providers separate setup from analytics execution. Their catalog supplies the two-step
creation screen and `listDatasourceProviders`; their server implementations prepare registrations
through `DatasourceProvider`. All backends implement `AnalyticsDataBackend`, including cache
defaults. Bring your own ClickHouse uses a datasource-scoped HTTPS connection, while Bring your own
DuckDB uses S3-compatible storage. Encrypted connection records are stored separately from datasource
metadata and cascade with datasource/workspace deletion. The Worker proxies exact S3 objects to
DuckDB using encrypted expiring capabilities and query read budgets; customer credentials and
presigned storage URLs never reach the query container.

Browser API reads and writes use TanStack Query through `src/api/query.tsx`. Query clients are
created inside Start's router factory, so SSR requests never share a cache in a Worker isolate.
The Router SSR integration owns the provider and hydration. HTML responses are private and
uncacheable, as are authenticated API responses. Browser keys include the Clerk
session, user, and workspace; switching identity remounts the UI and cancels/removes the old cache.
Authenticated API reads remain client-side. The analytics configuration server function uses the
request's query client in the root loader.

API POST actions are classified as reads or mutations. Reads deduplicate and consume Query's abort
signal; writes never retry or wait offline for later replay. Mutations invalidate metadata, while
builder callbacks retain the lean dashboard refresh without sharing-directory lookups. Analytics
queries defer TTL checks to the server on mount or input changes, keep explicit dashboard refresh
semantics, and do not refetch on focus or reconnect. File
uploads are mutations with XMLHttpRequest transport for progress and cancellation. Worker-side
service requests continue using native fetch and Cloudflare bindings.

BigQuery runs through the Worker's HTTPS client, without a query container or ingestion. Provider
metadata describes table fields and OAuth setup; the GUI and WebMCP register the same source and
personal authorization reference within that workspace. `datasource_authorizations` stores encrypted
Google grants owned by their recorded creator; `datasource_connections` stores their scoped
references. The backend refreshes tokens as needed, compiles GoogleSQL, submits jobs with known IDs, polls and pages results within bounded limits,
and records duration, scanned/billed bytes, slot time and cache hits without SQL, tokens or rows.

## Request and compilation limits

The JSON API accepts at most 1 MiB and returns at most 20 validation issues. Browser API
requests must use JSON and the same origin. Bulk layout updates contain at most 1,000
placements; dashboard creation accepts at most 100 datasource IDs. Analytics forwarding
accepts at most 2 MiB and shares a 15-second deadline across request reading and forwarding.
The Worker enables `enable_request_signal` so client disconnects reach the forwarding request.

Formulas contain at most 16,000 characters. Portable formulas allow 256 tokens; native expressions
allow 1,024 tokens including whitespace. Compilation stops above
100,000 SQL characters per expression or 1,000,000 characters of intermediate work.
Calculated fields are limited to 256 per compilation, 64 dependency levels, and
1,000,000 retained SQL characters. Source listing stops at 100 pages or 10,000 objects
and rejects repeated cursors.

Each query engine queues at most 32 requests and runs one at a time. Caller cancellation
and deadlines interrupt active work as well as preventing queued work from starting.
Source description and sampling share the query engine's 30-second execution limit.
