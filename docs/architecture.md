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
