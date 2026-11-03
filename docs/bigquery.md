# BigQuery setup

BigQuery is a Bring your own provider. Each datasource reads a single table or view. An editor
connects a personal Google account within a workspace. Only that yresonance user can list, select,
browse BigQuery with, register new datasources against, reconnect, or disconnect the connection.
The server checks ownership from the authenticated session, including requests with a known
connection ID, for both GUI and WebMCP actions. Inaccessible connection IDs return 404.

Sharing a datasource deliberately shares the data it exposes through that account. Permitted
dashboard viewers, including viewers of unlisted links, query through the datasource's saved
connection. They cannot use that grant to browse BigQuery or create additional datasources.
Execution resolves the stored reference after authorizing datasource/dashboard access; callers
cannot override it. Token refresh and background fetching use encrypted server-side credentials
and do not require the owner's browser session. Application sign-in stays with Clerk.
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
personal authorization. Only its owner can manage it. Reconnect preserves source IDs and makes old cached results unreachable.
A revoked refresh token marks the connection as requiring reconnection. Losing table access
produces an access error; restore permissions or connect an account with access.

WebMCP exposes generic `listDatasourceConnections`, `beginDatasourceConnection`, and
`disconnectDatasourceConnection` actions. Authorization returns a URL for the human to open and
consent. `registerDatasource` uses provider `bigquery` and connection `{ authorizationId }`.
Tokens never enter tool responses.

For example, connect `customer-project.reporting.campaigns` after verifying its location, schema,
partition requirements and query permissions through Google consent. This integration uses the
connected Google account, not a service-account key.

## Ownership and grant lifecycle

Existing grants remain owned by their recorded `createdBy` user in the recorded workspace. No
migration or replacement of datasource references is needed. Responses expose only connection ID,
account, and status. Other members see that a datasource uses another member's connection without
receiving that connection's ID or account and cannot manage it.

Before returning query results, including cached results, the backend verifies that the owner is
still a member of the workspace through Clerk and that Google still accepts the access token through
its authenticated userinfo endpoint. These checks do not depend on the viewer's identity or an active
owner session. Verification failures fail closed; temporary Clerk or Google outages do not erase the
grant. Disconnecting clears credentials. Detected membership loss, revoked access tokens, or revoked
refresh tokens clear credentials and require explicit reconnection by the owner. Rejoining alone
does not restore a grant already marked for reconnection. Datasources never silently switch to
another member's Google account. Reconnection preserves datasource references and changes their
cache identity.

This uses the existing Clerk backend key and Google OAuth scopes and endpoints. No additional
secrets, Google configuration, Clerk webhooks, or manual deployment changes are required.
