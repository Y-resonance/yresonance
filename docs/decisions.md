# yresonance: decisions

Why yresonance is built the way it is. The code is the source of truth for how it works
(`src/domain/schema.ts` for the dashboard document, `src/db/schema.ts` for tables,
`src/api/contracts.ts` for the API and tool surface). This file only records choices the code cannot
explain. Update it when a decision changes, not when an implementation detail does.

## Product

- Users are editors (account managers), viewers (clients, via unlisted link or login) and admins.
  Editors describe intent to an external agent and fine-tune in the GUI. Viewers never have to type.
- No AI agent inside the app. Intent inference is done by the external agent (ChatGPT, Chrome)
  using what `describeDatasource` returns.
- Every builder action and every consumption question is a WebMCP tool, and the GUI exposes the
  same actions. Login is not a tool. File upload stays GUI-only because tools accept JSON only.
- The whole app is usable on mobile. The stored grid describes the large-screen layout; nothing
  mobile-specific is stored.
- Nothing domain-specific is hardcoded. Field semantics and the metric library are workspace data,
  editable in the UI and through tools.

## Security model

- Viewers can only trigger queries a dashboard already defines. Clients never send SQL or column
  names. The one query path is `queryWidget(widgetId, controlState)`, shared by UI and tool.
- Column secrecy is explicitly not a goal. A derived metric next to its denominator makes the
  numerator derivable anyway (CPM and impressions give spend).
- Formulas use yresonance's own text syntax at two levels: row-level calculated fields and aggregate
  metrics. The backend parses an AST, checks it against field metadata and compiles SQL with
  trusted identifiers. Saving a formula never starts DuckDB.
- Control values are lenient, control keys are strict. Any value for an exposed control's field is
  accepted, because the editor chose to expose that field. Unknown keys are rejected.
- Multi-tenant from the start. A workspace is a Clerk Organization, every row carries a
  `workspaceId`, R2 keys live under a per-workspace prefix.
- The query container has no internet access and no storage credentials. It reads exact,
  short-lived signed object URLs through the Worker.

## Platform

- One Cloudflare deploy: Worker (TanStack Start app and API) plus the query container. D1 with
  Drizzle for application data, R2 for data files, KV for query results, Clerk for auth.
- DuckDB remains the default analytics backend, running natively in a Bun container per workspace.
  DuckDB inside the Worker (Ducklings) hit the Worker memory limit on real datasources. Datasources
  can also use ClickHouse through its HTTPS endpoint, with credentials kept on the Worker.
  Widget and formula definitions are shared; each backend compiles its SQL dialect.
- R2 SQL was evaluated and not chosen: it needs Iceberg tables, not plain files.
- The backend resolves prefixes to explicit object lists. DuckDB never lists or globs R2.
- Caching is lazy and has no invalidation code. The key covers the widget definition, the fields
  and formulas it depends on, the resolved control state and the datasource version, so any change
  makes old entries unreachable. Managed uploads expire after 24 hours. External ClickHouse tables
  have no reliable content revision and use a configurable TTL, default five minutes. Zero disables
  caching. Workspace access mappings are checked before reading cached external results.
- Managed CSV uploads are converted to Parquet before registration. ClickHouse imports stream
  the inspected Parquet into a database per workspace and environment. External tables require
  explicit server-side workspace mappings and SQL grants. Existing DuckDB sources are not migrated.
  The optional backend `managedUploads` capability owns import and cleanup; the application
  coordinates upload claims and commits registration without calling either engine directly.

## Behavior

- Controls work across datasources like in Looker Studio: a control applies to every widget whose
  datasource has a field with the same canonical name. Where none matches, the control is ignored
  for that widget, not rejected.
- Tools are generic (`addWidget`, `updateWidget`, `moveWidget`) rather than one per feature. Their
  input schemas are generated from the zod contracts the API validates with, so tool and API cannot
  drift. Descriptions state what a tool returns, because ChatGPT ignores `outputSchema`.
- `updateWidget` takes a full definition. No deep patches, because patches on arrays such as
  `metrics` are ambiguous.
- `addWidget` accepts only width and height and appends at the bottom. Agents do not compute
  coordinates. Widgets cannot overlap.
- Comparison runs as a second query with a shifted date range.
- Relative dates resolve in the dashboard's timezone, default `Europe/Berlin`.
- Rich text is stored as versioned JSON, never as HTML. Styling is an open object owned by each
  renderer.

## Deferred

Data catalog beyond the field lookup table. Ingestion and transformation pipelines. Blends and
cross-source fields. Nested filter groups. Percent-of-total comparison modes. Line chart axis
override. Per-workspace R2 buckets.
