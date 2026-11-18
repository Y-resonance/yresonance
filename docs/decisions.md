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
  names. The one query path is `queryWidget(widgetId, controlState, drillPath)`, shared by UI and tool.
- Column secrecy is explicitly not a goal. A derived metric next to its denominator makes the
  numerator derivable anyway (CPM and impressions give spend).
- Formulas have row-level calculated fields and aggregate metrics. Untagged formulas keep the
  portable syntax and AST compiler. Native SQL expressions carry an explicit `formulaDialect`
  (`bigquery`, `duckdb`, or `clickhouse`), use `{{canonical_field_name}}` references, and never
  translate between dialects. The application still owns FROM, filtering, grouping and limits.
  Structural checks exclude statements, subqueries, qualified names and data-access/system
  functions before resolving references to trusted field SQL. Backends validate native expressions
  against the actual datasource and check result types before saving: BigQuery dry runs and
  ClickHouse/DuckDB result-schema inspection. ClickHouse native calls must be built-in functions, so SQL/executable UDFs cannot
  hide external data access. Native validation may start DuckDB; portable formula saves do not.
- Control values are lenient, control keys are strict. Any value for an exposed control's field is
  accepted, because the editor chose to expose that field. Unknown keys are rejected.
- Multi-tenant from the start. A workspace is a Clerk Organization, every row carries a
  `workspaceId`, R2 keys live under a per-workspace prefix. An OIDC deployment is the exception:
  it has exactly one workspace, with no organizations, creation or switching.
- Auth UI is ours and identical for every provider. A provider supplies state, actions and
  capabilities, and keeps only its credential forms: Clerk's embedded form on hosted, the
  provider's login page on OIDC.
- Self-hosters sign in through a generic `oidc()` adapter, verified with Keycloak. Admin rights
  come from a configurable role in the token; everyone else who can log in is an editor. Users,
  roles and invitations are managed in the provider's console, never in yresonance. Users are
  recorded in Postgres at login, so no admin API credentials are needed and sharing by email
  only finds people who signed in once. OIDC deployments have no sign-up, waitlist or landing
  page. See [authentication](authentication.md).
- The query container has no internet access and no storage credentials. It reads exact,
  short-lived signed object URLs through the Worker.

## Platform

- Hosted-service configuration and operations live in `cloud/`. Shared application code and
  reusable infrastructure adapters stay in `src/`, even when our hosted service currently uses
  them. The separation describes deployment ownership; the repository remains MIT licensed.
  There is no separate enterprise edition.
- Self-hosters install the application as one npm package, `@yresonance-dev/core`, write their
  own `yresonance.config.ts` and build in their own infrastructure (#182). A prebuilt image was
  rejected because self-hosting must be fully configurable, including adapters the package does
  not ship. The hosted service is the first consumer: `cloud/` builds through the same Vite
  plugin with its own config file and Worker entry.
- "No package split" still holds and means: one package from this repository, adapters as
  subpath exports, no monorepo and no package per adapter. It never ruled out publishing the
  application.
- The package ships the app as source and the installing project's Vite build compiles it.
  Routes and components need TanStack Start's compile step in the final build, and a prebuilt
  client could not select client code, such as the auth UI, at build time. What a self-hoster
  imports directly is prepared at pack time: type declarations for the config and adapters, and
  the Vite plugin as JavaScript. Adapters stay source at runtime because they must share module
  instances with the app.
- Deployment services are selected at build time in one typed `yresonance.config.ts` using
  `defineConfig`, with one adapter per slot; ours is `cloud/yresonance.config.ts`. Only the
  server platform entry imports the config, through the `yresonance:config` module the Vite
  plugin resolves. There is no runtime platform switch. Contracts follow current application
  needs rather than full vendor APIs. Our configuration keeps all existing services and all five
  providers. Alternative storage, cache and Node hosting adapters, and optional
  datasources/query execution, are later work. Auth is the one slot with a second, UI half; the
  build derives it from the `auth` entry, so the config stays one file. A self-hoster with an
  auth adapter of their own names its UI half in the Vite plugin options. The datasource catalog
  stays static because client code imports it.

- One Cloudflare deploy: Worker (TanStack Start app and API) plus the query container. Postgres through Hyperdrive with
  Drizzle for application data, R2 for data files, KV for query results, Clerk for auth.
- Postgres is the only application database, including customer-hosted deployments. Keeping a
  second SQLite dialect would require two schemas and migration histories. Hosted environments
  use PlanetScale in Frankfurt. Hyperdrive query caching stays disabled because dashboard
  `updated_at` values enforce optimistic concurrency.
- Previews share one PlanetScale branch, with one database per preview and a shared restricted
  runtime role. Cross-preview database access is accepted for synthetic data. Provisioning uses
  separate admin credentials. The initial cap is three branch previews plus the shared preview,
  allowing five pooled connections each on a branch with 25 connections.
- Production cutover uses downtime and a prior maintenance-switch release. Rollback is permitted
  only before reopening; afterwards we fix forward. Retain D1 and its offline export for one week
  for manual recovery. See [the cutover runbook](postgres-cutover.md).
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
  caching. Each datasource can keep its default, set a result lifetime, or disable caching.
  Expiry runs a new query on the next request; open dashboards do not auto-refresh.
  Editors and viewers can fetch fresh results for the displayed dashboard and replace matching
  cached results. Workspace access mappings are checked before reading cached external results.
- The dashboard header shows "Data available through" the earliest of the latest dates in each
  date field the shown page's widgets filter by, so every widget there has data up to that day.
  It is per page so a stale source elsewhere does not hold the date back. It is derived from the
  data, uses the same datasource cache lifetime, and follows the refresh action. If any source
  fails or has no dated rows, no date is shown rather than one that overstates freshness.
- Managed CSV uploads are converted to Parquet before registration. ClickHouse imports stream
  the inspected Parquet into one database per environment, with workspace-scoped tables. Production
  and previews use separate SQL users. Preview databases follow branch lifecycles. External tables on the managed ClickHouse host require
  explicit server-side workspace mappings and SQL grants. Bring your own connections use the customer
  account's SQL grants. Existing DuckDB sources are not migrated.
  The optional backend `managedUploads` capability owns import and cleanup; the application
  coordinates upload claims and commits registration without calling either engine directly.

## Behavior

- Dashboards have ordered pages. Shares and grants cover the dashboard. Hidden pages are drafts:
  viewers cannot read their definitions or query their widgets, and their controls do not filter
  published pages. A dashboard may have no published pages. It must keep at least one stored page.
  Viewer navigation is omitted when only one page is available. Editors keep the page tab, its
  action menu, and a trailing add button available even with one stored page.
- Date and filter selections survive page navigation. Removing a populated page requires explicit
  confirmation, and widget IDs stay unique across the dashboard so query and control references
  remain stable when a widget moves.

- Controls work across datasources like in Looker Studio: a control applies to every widget whose
  datasource has a field with the same canonical name. Where none matches, the control is ignored
  for that widget, not rejected.
- Tools are generic (`addWidget`, `updateWidget`, `moveWidget`) rather than one per feature. Their
  input schemas are generated from the zod contracts the API validates with, so tool and API cannot
  drift. Descriptions state what a tool returns, because ChatGPT ignores `outputSchema`.
- Bars and lines on two explicit axes are a separate `combo` widget, so `line` and `bar`
  definitions keep their shape. Each axis is formatted from one data type, so mixing units on one
  axis is rejected.
- Widget backgrounds and borders resolve field by field: the widget's `appearance`, then the
  dashboard theme's `widgetDefaults`, then the app default, which matches the plain card. Colours
  are theme references that follow the brand and dark mode, or hex values rendered as stored. The
  brand chart palette leaves semantic colours alone. Themes belong to the dashboard; a later
  workspace theme should be copied into new dashboards, never inherited live, so finished client
  reports never restyle silently.
- Dashboard-wide settings live on their own page, `/dashboards/:id/settings`, opened next to Share.
  The builder's inspector only edits the selected widget.
- `updateWidget` takes a full definition. No deep patches, because patches on arrays such as
  `metrics` are ambiguous.
- `addWidget` accepts only width and height and appends at the bottom. Agents do not compute
  coordinates.
- Widgets may overlap, so editors can layer a text widget behind a group of charts. Paint order is
  the order of `page.widgets`: later widgets sit on top. Overlap is allowed for every widget type,
  and a widget underneath is a pure background; moving it does not move the widgets on top.
  Grouping is a separate topic. The stacked phone layout keeps reading order (top to bottom, left
  to right) and ignores overlap.
- Bar, pie and line charts drill down through editor-defined levels (`drillDimensions`). The
  viewer only supplies clicked values as `drillPath`, which `queryWidget` turns into equality
  filters, so the security model holds. Drill state stays inside one widget; cross-filtering other
  widgets is a separate topic. Clicked levels cannot be dates because a date bucket is not an
  equality filter. Tables are excluded: they already show several dimensions with subtotals.
- Comparison runs as a second query with a shifted date range.
- Relative dates resolve in the dashboard's timezone, default `Europe/Berlin`.
- Yesterday is the latest queryable day because the current day's data is incomplete. Every range is
  cut off there when it resolves, and presets end there without saying so in their labels. Ranges
  saved with a "today" end load as the matching yesterday presets.
- A custom range can pair a fixed start with an end that stays on yesterday, so "campaign start to
  yesterday" stays current. The start is not derived from data; editors enter it.
- Text widgets store versioned Markdown (`markdown-v1`), never HTML. The renderer allows a small
  subset, and only https: and mailto: links, which open in a new tab, so agent and API content is
  safe too. Older text is read as Markdown and stored as such on the next save; there is no bulk
  migration, and it is not escaped to keep its old look because no production content depends on it
  yet. Editing happens in the inspector or its pop-out dialog, and the editor loads lazily so
  viewers never download it. Text saves while typing so long text survives a closed tab. There are
  no drafts, so anyone loading the dashboard can see half-written text.
  Styling is an open object owned by each renderer.
- Images are resized with the Cloudflare Images binding and each variant is stored in R2, so it is
  transformed and billed once. `cf.image` bills every viewed variant monthly, `/cdn-cgi/image/`
  cannot read private R2 objects and caches publicly, and hosted Images caps uploads at 10 MB.
  Asset responses are never `public`: Workers Cache ignores cookies, so it could serve an image
  to a removed collaborator. They are immutable, except that an original served because a transform
  failed is cached for 5 minutes, so that width recovers.
- Adding an image widget places a placeholder and the editor picks the image in the inspector, like
  every other widget's settings. Viewers don't see a widget without an image, so a published page
  never shows an empty box.

## Deferred

Data catalog beyond the field lookup table. Ingestion and transformation pipelines. Blends and
cross-source fields. Nested filter groups. Percent-of-total comparison modes. Stacked bars and
breakdowns in combo charts. Manual axis ranges. Per-workspace R2 buckets.

## Datasource providers

- Datasource creation first selects a provider, then opens a dedicated setup screen. Providers are
  grouped as Managed and Bring your own. Managed DuckDB and ClickHouse use deployment credentials;
  Bring your own DuckDB reads S3-compatible CSV/Parquet files, and Bring your own ClickHouse reads
  a customer table over HTTPS.
- `DatasourceProvider` owns registration validation and preparation. `AnalyticsDataBackend` owns
  inspection, query execution, validation, cache identity, cache defaults, and optional managed
  uploads. Registration and dashboard services call these interfaces. Provider definitions supply
  setup fields and capabilities to the UI and WebMCP discovery.
- Customer connections are encrypted in a separate Postgres table, bound to the workspace and datasource.
  They never enter datasource records, API responses, or telemetry. AES-GCM uses a purpose-separated
  HKDF key derived from `UPLOAD_SIGNING_SECRET`; preserve that secret across deployments. Changing
  it requires re-encrypting existing connections before switching keys.
- Customer connections are read-only. Use public HTTPS endpoints and read-only storage/database
  accounts. S3 credentials remain in the Worker. DuckDB reads exact objects through encrypted,
  five-minute capabilities, with the same scanned-byte budget as managed data. The query container
  still has no internet or storage credentials. Bring your own sources default to five-minute
  query caching; S3 object ETags also contribute to the cache identity.

## BigQuery connections

- Bring your own BigQuery uses one table or view and bills query jobs to that table's project.
  Editors authorize a Google Workspace account through an Internal OAuth app. The grant is
  personal to the connecting yresonance user within a workspace and powers every permitted
  dashboard viewer, including unlisted links. Only the owner can browse or manage the grant;
  sharing a datasource shares its exposed data without sharing the grant for new sources.
  Google authorization is separate from Clerk login. The application only generates read queries.
- Reusable OAuth grants live separately from datasource metadata. Access and refresh tokens are
  encrypted with workspace/authorization binding. Callbacks use expiring, single-use state bound to
  the initiating Clerk user and workspace, plus PKCE. Google verifies the account's hosted domain.
  Disconnecting blocks cached results; reconnecting keeps datasource IDs and changes cache identity.
- Workspace admins can explicitly replace one datasource's Google connection with a new personal
  grant after confirmation and consent, even if the original reference cannot be decrypted. This
  preserves datasource/field/dashboard IDs without transferring ownership of the old grant or
  changing other datasources. Both OAuth endpoints enforce admin access; the callback atomically
  saves the new grant and reference only if the original reference is unchanged.
- Registration inspects metadata without scanning data. Nested/repeated fields require a scalar
  view. Query jobs have a configurable billed-byte ceiling, default 1 GB, a 30-second job timeout,
  and result limits of 20,000 rows / 10 MiB. Failed requests attempt cancellation; Google cancellation
  and job timeout are best effort, while the billed-byte ceiling bounds each query.
