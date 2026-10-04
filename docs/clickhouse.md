# ClickHouse analytics

Choose an analytics backend when registering a datasource. DuckDB remains the default.
Existing file datasources stay on DuckDB. Choosing ClickHouse for an upload creates a new
managed table; it does not migrate any existing datasource.

The application imports managed uploads through the backend's optional `managedUploads`
capability. The import returns the inspected datasource and a cleanup method for registration
success or failure. Conversion, insertion, and storage cleanup stay inside the backend;
the application owns upload claims and the registration transaction. Query-only backends
can omit this capability.

Managed CSV uploads still use the existing CSV-to-Parquet conversion. The Worker inspects
that Parquet file, creates a nullable scalar schema, and streams the file into ClickHouse.
The table is registered only after insertion succeeds. An import or registration failure
removes the new table where the server remains reachable, and keeps the original upload
available for retry. Supported import types are text, booleans, integers, floats, decimals,
dates, and timestamps. Nested file types fail before a table is created.

## Server configuration

Configure these Worker secrets in each environment that should offer ClickHouse:

- `CLICKHOUSE_URL`: the HTTPS HTTP endpoint.
- `CLICKHOUSE_DATABASE`: the managed database name, configured as a Worker variable.
- `CLICKHOUSE_USER` and `CLICKHOUSE_PASSWORD`: the restricted app account.
- `CLICKHOUSE_ACCESS_CLIENT_ID` and `CLICKHOUSE_ACCESS_CLIENT_SECRET`: required when the endpoint
  is protected by Cloudflare Access. Use a Service Auth policy for the service token.
- `CLICKHOUSE_EXTERNAL_TABLES`: optional JSON array of exact workspace/table access mappings.

Keep these values in ignored `.dev.vars` for local development. Configure preview runtime
secrets separately from production. Cloudflare's Previews Base does not inherit production
secrets. Do not make ClickHouse secrets required for starting the app: DuckDB-only environments
continue to work without them. HTTP is accepted only for loopback conformance tests.

The provisioned psimms instance is reached through `https://clickhouse.yresonance.com` in the
yresonance Cloudflare account, protected by an Access service token. The original personal-account
tunnel remains available. Private runtime configurations live in
`~/.config/yresonance/clickhouse-production.json` and `~/.config/yresonance/clickhouse-preview.json`.
Production runtime secrets and Preview Base secrets are configured separately. No external
workspace mappings have been provisioned;
configure `CLICKHOUSE_EXTERNAL_TABLES` and the matching SQL grants before using external tables.
The ClickHouse container has
`CLICKHOUSE_DEFAULT_ACCESS_MANAGEMENT=1` so its administrator can manage SQL users. The app
account has no user-management privileges.

Separate SQL users restrict production and previews to their database namespaces:

```sql
GRANT SELECT, INSERT, CREATE DATABASE, CREATE TABLE, DROP TABLE
ON yresonance_production.* TO yresonance_production;

GRANT SELECT, INSERT, CREATE DATABASE, CREATE TABLE, DROP TABLE, DROP DATABASE
ON yresonance_preview_*.* TO yresonance_preview;
```

Production uses `yresonance_production`. Native previews use `yresonance_preview_<branch-hash>`,
with the same hash of the exact branch name used for their Cloudflare resources. Preparation
creates the database before deployment and reuses it across pushes. PR-close cleanup waits for
running builds and removes only that branch database. The manual shared preview uses
`yresonance_preview_shared`.

Managed table names include a hash of the workspace id and a server-generated datasource id.
Inspection and queries verify both the environment database and the workspace table name.
Clients cannot register arbitrary managed table references. Earlier workspace databases are
left untouched; this change does not migrate their tables.

Preview provisioning uses `CLICKHOUSE_PREVIEW_URL`, `CLICKHOUSE_PREVIEW_USER`,
`CLICKHOUSE_PREVIEW_PASSWORD`, `CLICKHOUSE_PREVIEW_ACCESS_CLIENT_ID`, and
`CLICKHOUSE_PREVIEW_ACCESS_CLIENT_SECRET` in Cloudflare preview build settings and GitHub cleanup
secrets. These are the preview user credentials, not administrator or production credentials.
DuckDB-only deployments can omit all five; partial configuration fails the lifecycle operation.
Use a separate local database and local user for development.

External mappings use this shape:

```json
[
  { "workspaceId": "ws_example", "database": "reporting", "table": "campaigns" }
]
```

An administrator must also grant the app account `SELECT` on each listed external table.
The app never grants itself permissions. A mapping cannot expose a `yresonance_` managed
database as external data. Empty or absent mappings deny all external tables. Inspection,
query execution, and cache hits check the mapping, so removing it revokes access immediately.
Credentials and access mappings are never part of datasource definitions or WebMCP responses.

## Freshness

The shared Worker cache includes backend, workspace, datasource, table/file identity, metadata,
widget definition, and resolved controls. Managed uploads are immutable and use their upload
revision with a 24-hour cache lifetime. External inspection fingerprints the schema, not the
contents: external rows may change without a new version.

Every datasource has a query caching policy, configurable during registration and on its detail
page. Choose the source default, a duration, or disabled. Duration applies to both managed and
external sources; expiry runs a new query on the next request. The dashboard refresh action is
available to editors and viewers and bypasses and replaces matching cached results.

External tables default to a five-minute TTL. Set `location.cacheTtlSeconds` during registration
to configure the legacy default from 0 to 86400 seconds. Explicit `cachePolicy` takes precedence. Zero bypasses KV. A timestamp in the cache entry enforces
TTLs shorter than KV's minimum expiration of 60 seconds. Old results become unreachable after
changes to source configuration, and backend authorization runs before cache lookup.

## Verification

`bun run test:clickhouse` runs identical queries against native DuckDB and a real ClickHouse
HTTP server. CI starts a pinned ClickHouse service for this suite. Locally, set the connection
variables above before running it. The suite creates temporary managed tables and removes them;
it never reads existing application tables. Empty workspace databases remain after tests.
Worker integration tests cover registration, workspace authorization, cache expiry and bypass,
and access revocation. Browser tests cover desktop/mobile registration.
