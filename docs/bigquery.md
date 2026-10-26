# BigQuery setup

BigQuery is a Bring your own provider. Each datasource reads a single table or view. An editor
connects a Google account once for the workspace, and all permitted dashboard viewers use that
account's permissions, including viewers of unlisted links. Application sign-in stays with Clerk.
Queries run and are billed in the project containing the selected source.

## Google configuration

Create a Google OAuth web client in a Google Cloud project owned by your Google Workspace/Cloud
Identity organization. Configure the audience as Internal and enable the BigQuery API in the data
project. The consent request uses `openid`, `email`, and
`https://www.googleapis.com/auth/bigquery`. The app only generates SELECT queries; Google account
permissions still determine which data it may read and where it can create query jobs.

Configure these Worker secrets separately for each environment:

- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`, the exact environment URL ending in `/api/oauth/google/callback`
- `GOOGLE_OAUTH_HOSTED_DOMAIN`, your Google Workspace domain

Register the exact redirect URI with Google. Use distinct development/preview and production
clients. For local development, export these values in an ignored `.envrc` before starting Vite.
The local callback can use `http://localhost:3000/api/oauth/google/callback`. Native branch previews
need their own allowed redirect URL and matching secret value. Without configuration, the provider
remains visible but Google connection is disabled. Preserve `UPLOAD_SIGNING_SECRET`; changing it
requires re-encrypting stored customer connections and OAuth grants.

The connecting Google user needs `bigquery.jobs.create` in the data project and access to source
metadata and data. BigQuery Job User on the project and Data Viewer on the selected dataset/table
are typical grants. Views may require underlying-table access or authorized-view configuration.
Having access in the BigQuery console does not by itself prove permission to create query jobs.

## Usage and limits

Choose Google BigQuery and connect the account. Browse searchable project, dataset and table/view
columns, then select a source. Dataset location is filled automatically. Each column loads more
items on demand. Searching automatically loads the remaining pages and filters the full list.
Enter a project ID if dataset-level access does not make the project appear in the list, or choose
manual entry for the full source. Registration reads schema metadata and does not run a billable
query. Scalar text,
numeric, boolean, date, datetime, and timestamp fields are supported. Expose nested or repeated
fields through a scalar view. Required partition filters must be satisfied by generated queries;
filter-option queries currently do not carry a date range, so these sources may require a view
with a suitable bounded partition predicate.

Query caching defaults to five minutes. Set the billed-byte ceiling during datasource setup,
default 1,000,000,000 bytes per query. This is a per-query limit, not a workspace spending budget.
BigQuery job timeout is 30 seconds, with a 35-second application deadline. Results are limited to
20,000 rows and 10 MiB. Cancellation and Google's timeout are best effort. Exact median aggregates
sort values into an array, so large groups can hit Google's resource limits.

Portable BigQuery formulas do not support the remainder operator `%`. Native expressions use
`formulaDialect: "bigquery"` and GoogleSQL syntax, for example
`SAFE_DIVIDE(SUM({{revenue}}), COUNT(*))`. The editor validates these through a BigQuery dry run
against the selected table before saving. Native expressions cannot be reused with another dialect.

Reconnect or disconnect from the datasource page. Disconnect affects every source using that
workspace authorization. Reconnect preserves source IDs and makes old cached results unreachable.
A revoked refresh token marks the connection as requiring reconnection. Losing table access
produces an access error; restore permissions or connect an account with access.

WebMCP exposes generic `listDatasourceConnections`, `beginDatasourceConnection`, and
`disconnectDatasourceConnection` actions. Authorization returns a URL for the human to open and
consent. `registerDatasource` uses provider `bigquery` and connection `{ authorizationId }`.
Tokens never enter tool responses.

For example, connect `customer-project.reporting.campaigns` after verifying its location, schema,
partition requirements and query permissions through Google consent. This integration uses the
connected Google account, not a service-account key.
