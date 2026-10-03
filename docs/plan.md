# yresonance: discovery brief and plan

Status: discovery outcome agreed on 2026-08-29 and implemented in the feature branch linked from
issue #1. Deployment credentials, remote migrations, and the live release remain external rollout
steps.

## 1. Problem and users

esome account managers build and change client dashboards on a weekly basis. Two tools are in use today and both fall short.

Looker Studio has the right capabilities (BigQuery underneath, SQL, CASE WHEN calculated fields) but is unreliable, hard to adjust, and has no support. Whatagraph is reliable and has the nicer UI, but there are no blends, no SQL, custom formulas are limited, and it is expensive.

Neither tool can turn intent into widgets. An account manager knows that "a Targeting report on adset level" matters for a client. The tool cannot infer what that looks like, so every new client means translating intent into elements by hand.

Users:

- Editors (account managers). Create dashboards, write formulas, invite others. Want to describe intent to an agent and then fine-tune in a GUI, because when they already know the fix (a CASE WHEN mapping campaign IDs to readable names) explaining it to an AI is slower than doing it.
- Viewers (clients, agency contacts). Experts in their domain, want a GUI, should never have to type. Reach dashboards via unlisted links or a viewer login.
- Admins. Everything, plus workspace-level metadata and workspace management.

## 2. Challenge context

The project is built for the OpenAI WebMCP Challenge. Time limit is not a constraint for scope decisions (agreed), but the challenge still defines how the WebMCP side gets judged.

From the official rules ([Devpost](https://webmcp.devpost.com/rules)):

- Four equally weighted criteria: WebMCP leverage, execution (complete product, not a proof of concept), potential impact, creativity.
- Judges test in the ChatGPT desktop app's built-in browser or in Chrome with WebMCP enabled. They may use credentials the entrant provides.
- Deliverables: live URL, public repository with an open source license, video under 3 minutes, text description.

From ChatGPT's WebMCP docs ([learn.chatgpt.com/docs/webmcp](https://learn.chatgpt.com/docs/webmcp)):

- ChatGPT calls `document.modelContext.registerTool()`. Supported fields: `name`, `description`, `inputSchema`, `annotations.readOnlyHint`, `execute`.
- Not supported: `outputSchema`, declarative form attributes, tools inside iframes (same-origin or not).
- ChatGPT reviews each invocation and asks the user to confirm consequential actions (deletions, permission changes). Tool output is treated as untrusted.
- Works in the ChatGPT desktop app browser, ChatGPT Work, Codex. Not in Enterprise or Education workspaces. Test with a personal account if the esome workspace is Enterprise.
- Guidance from the docs: keep inputs focused, document side effects, return verification data, reuse the app's own auth, keep the normal UI working in browsers without WebMCP.

From the spec ([webmachinelearning.github.io/webmcp](https://webmachinelearning.github.io/webmcp/)): tools are registered per document, unregistered through an `AbortSignal`, and a `toolchange` event fires on add or remove. `provideContext` and `clearContext` no longer exist.

## 3. Decisions

1. Stack: TanStack Start + React, shadcn/ui including shadcn charts, Tailwind. Playwright for e2e. Bun for tooling.
2. Hosting: Cloudflare Workers, paid plan (already upgraded). One deploy for the app, API, and query
   engine container.
3. Query engine: native DuckDB in a Bun Cloudflare Container, reading authorized Parquet URLs over
   HTTPFS. Container egress intercepts the internal hostname and reads R2 through the Worker's
   binding. The container has no internet access or storage credentials.
4. Application data: Cloudflare D1 with Drizzle.
5. Auth: Clerk. Workspaces map to Clerk Organizations.
6. Security model: viewers can only trigger queries the dashboard already defines. Column secrecy is explicitly not a goal, because a derived metric next to its denominator makes the numerator derivable anyway (CPM and impressions give spend).
7. Clients never send SQL or column names. The one query endpoint is `queryWidget(widgetId, controlState)`, used by both the UI and the WebMCP tool.
8. Formulas use yresonance's parsed text syntax at two levels: row-level calculated fields and
   aggregate metrics. The backend validates an AST and compiles it to SQL. Users cannot submit SQL.
9. Field semantics come from a lookup table per datasource that users maintain. A real catalog is deferred.
10. Metric library is workspace-level data, configurable in the UI and via a tool. Nothing domain-specific is hardcoded.
11. Caching is lazy. Key = hash(widget definition and referenced calculated fields) + normalized control state + datasource version. No cron.
12. Multi-tenant from the start. Every row carries a `workspaceId`; R2 keys live under a per-workspace prefix.
13. Editors can upload one CSV or Parquet file up to 100 MB through the Worker. The query container
    converts managed CSV uploads to Parquet before registration. Existing workspace objects and
    prefixes can also be registered.
14. Controls across datasources behave like Looker Studio: a control applies to every widget whose datasource has a matching field, matched on canonical name from the lookup table.
15. Every builder action and every consumption question is a WebMCP tool, and the GUI exposes the same actions. Login is not a tool.
16. No AI agent inside the app. Intent inference is done by the external agent (ChatGPT, Chrome) using what `describeDatasource` returns.
17. The whole app is usable on mobile. Desktop is the main target, but every screen (viewer, editor, datasource admin, sharing) works on a phone. CSS is written mobile-first in the Tailwind way: base styles target the smallest screen, `sm:`/`md:`/`lg:` add layout for larger ones. No screen is desktop-only.

## 4. Architecture

Components, deployed as one Worker and its query container:

- TanStack Start app. SSR routes, client-side dashboard editor and viewer, WebMCP tool registration in the client.
- Server functions / API routes. Auth via Clerk, authorization against D1, query compilation, cache lookup, DuckDB execution.
- D1. Workspaces, memberships, datasources, field metadata, calculated fields, library metrics, dashboards, dashboard grants, share links, query cache index.
- R2. One bucket. Data files under `ws/<workspaceId>/...`. Optionally cached query results as objects if KV turns out too small.
- KV. Query result cache keyed by hash. Global, eventually consistent, fine for dashboard results.
- DuckDB query container. One named container per workspace. It reads exact, short-lived internal
  object URLs and has no credentials or general internet access.

Request flow for a viewer opening a dashboard:

1. Route loader resolves the dashboard by id or share token, checks the grant, returns the dashboard document and default control state.
2. Client renders widgets and calls `queryWidget` for each, with the current control state.
3. Server validates control state against the dashboard's controls, computes the cache key, and
   returns a cached result or sends the authorized source and compiled query to the workspace's
   private query container.
4. Client registers view-mode WebMCP tools once the dashboard has loaded.

Request flow for an editor adding a widget through ChatGPT:

1. ChatGPT calls `addWidget` with a widget definition.
2. The tool's `execute` calls the same server function the GUI uses. Server validates the definition (schema, field references, expression compiles), appends the widget, stores the dashboard.
3. Server returns the stored widget including its id and the compiled SQL. The UI updates through the same client state the GUI uses, so the user watches the widget appear.

## 5. Tenancy, roles, sharing

Workspace = Clerk Organization. A Clerk org admin is the app admin. Any org member may create dashboards (editor). Confirm on Clerk's pricing page that organizations are included on the current plan; not verified during discovery.

Per dashboard, D1 holds grants: `editor` or `viewer` for a Clerk user id. The creator is an editor. Editors can add editors and viewers. Admins see everything in the workspace.

Unlisted links. A share link is a random, non-guessable token stored in D1 that resolves to exactly one dashboard. Anyone with the link reads the dashboard and calls `queryWidget` for its widgets, nothing else. Editors create and revoke links. Links are workspace-independent from the viewer's perspective; the server derives the workspace from the dashboard.

R2 isolation. Datasource registration lists objects under `ws/<workspaceId>/` via the R2 binding and
refuses any key outside it. Each query gets signed capabilities for the resolved object list. The
internal handler rejects any other object and all query writes.

Judging access. Provide a test account with editor rights and at least one unlisted dashboard in the submission.

## 6. Datasources and field metadata

A datasource points at one R2 object or a prefix. The backend resolves prefixes to explicit object
lists before compiling `read_parquet(['url-a', 'url-b'])`. DuckDB never lists or globs R2.

Registration: an editor or admin uploads a CSV or Parquet file or picks an existing object or prefix.
The Worker runs `DESCRIBE` and seeds the lookup table automatically. Numeric columns become metrics,
text becomes dimensions, and date-like columns become dates. Admins then correct only the metadata
that matters. With 200 columns nobody annotates by hand.

Lookup table, one row per column:

- `columnName`: raw column in the file.
- `canonicalName`: stable name used for cross-datasource control matching and by the metric library (e.g. `campaign`, `impressions`, `media_cost`). Defaults to the column name.
- `label`: display name.
- `role`: `dimension | metric | date | id`.
- `semanticType`: `currency | count | ratio | text | date | id`.
- `description`: free text, this is what the agent reads.
- `hidden`: exclude from `describeDatasource` and from the field picker.
- `castTo`: optional override for the inferred type, needed for 64-bit ids that must stay `VARCHAR`.

Calculated fields belong to the datasource. They use the custom row-level formula language and are
evaluated before aggregation. Examples include `if(dsp = 'PI', outbound_clicks, clicks)` and
`if(platform = 'FB' or platform = 'FAN', 'FB', platform)`. They appear in the field list with a role
and semantic type like any column.

Datasource version is the R2 object etag (or the concatenated etags of the prefix listing). It is part of every cache key.

Known problems in `reporting_example.csv`: `Date` is a JavaScript `Date.toString()` dump. Managed
CSV ingestion recognizes this format and stores its local calendar day as a physical Parquet `DATE`.
`AccountId`, `CampaignId`, `AdSetId`, `AdId` exceed 2^53 and must be `VARCHAR`.

## 7. Formulas and validation

Two levels, mirroring Looker Studio and the esome calculated fields guide:

- Row-level calculated fields on the datasource. Example: `if(dsp = 'PI', outbound_clicks, clicks)`.
- Aggregate metric formulas on widgets. Example: `sum(media_cost) / sum(impressions) * 1000`.

Metric library. Workspace-level list of named aggregate expressions written against canonical names
(`sum(media_cost) / sum(impressions) * 1000`). A library metric applies to a datasource when every
canonical name it references exists there. The compiler rewrites canonical names to the datasource's
columns. Seed the esome workspace with CTR, CPM, VTR, and CPV. Effective clicks and platform
consolidation are row-level calculated fields. Seeding is data, editable in the UI and via
`upsertLibraryMetric`.

The language supports literals, canonical field names, arithmetic, comparisons, boolean operators,
and allowlisted functions. Aggregate formulas require field references to sit inside `sum`, `avg`,
`min`, `max`, `count`, or `count_distinct`.

Validation, in this order:

1. Parse into an AST. SQL statements, comments, paths, table functions, and unknown functions fail.
2. Resolve identifiers against stored field metadata and check operand and return types.
3. Compile the validated AST with trusted column identifiers. Saving never starts DuckDB.

## 8. Query pipeline

`queryWidget(widgetId, controlState)`:

1. Resolve widget and dashboard; check the caller's grant or share token.
2. Validate `controlState`. Allowed keys are the dashboard's date control and the fields exposed as controls. Values are lenient: any value for the control's field is accepted, because options paginate and the editor already chose to expose that field. Unknown keys are rejected.
3. Resolve control state per widget. A control on canonical name `campaign` applies to this widget if its datasource has a field with that canonical name and compatible type; otherwise it is ignored for this widget, not rejected. Date controls apply through the widget's `dateRangeFieldId`.
4. Cache key = sha256(widget definition JSON + referenced calculated field definitions + referenced library metric definitions) + sha256(normalized resolved control state) + datasource version. Look up in KV.
5. On miss, compile SQL from the definition: `SELECT dims, metric expressions FROM read_parquet(...) WHERE date range AND filters GROUP BY dims ORDER BY ... LIMIT ...`. Comparison runs as a second query with the shifted range. Run in DuckDB, store the result in KV, return.

Editing a widget changes its hash, so old cache entries become unreachable and expire by TTL. No invalidation code. Editing a calculated field changes the hash of every widget referencing it for the same reason.

`previewWidget` runs the same pipeline on an unsaved definition, without touching the cache.

`explainWidget` returns the compiled SQL plus the metric and calculated field definitions and descriptions, so a viewer or agent can see what a number means.

Query-container constraints: each workspace runs one query at a time. Each query has a 30 second
execution timeout, a 192 MB DuckDB memory limit, two DuckDB threads, a cumulative 500 MB Parquet
read budget across HTTP range requests, and a 5 MB JSON result limit. Container disks are ephemeral,
and 64-bit integers are serialized losslessly.

## 9. Dashboards, widgets, controls

Dashboard document (stored as JSON in D1 with `schemaVersion`) holds name, timezone, default date range, widgets with grid placement, and the control definitions.

Widget types kept: scorecard, gauge, line, bar, pie, table, control, date control, text. All cards get a `title`.

Layout: fixed column grid, no overlap, free placement. Widgets stay where they are dropped and empty rows are allowed. The document stores `canvasRows` so empty trailing rows survive refresh. `addWidget` accepts only `width` and `height` and appends at the bottom. `moveWidget` sets one placement; `updateLayout` stores every placement and `canvasRows` from an interactive rearrangement in one write. Agents do not compute coordinates when adding widgets.

Row insertion controls appear at valid cuts between occupied sections. The persistent bottom insertion control sits after the final stored canvas row, so no grid rows appear beneath it.

Controls publish values into dashboard control state. A filter control on a field applies across datasources by canonical name (decision 14). The date control applies to every widget.

Responsive behavior. The stored grid describes the large-screen layout. On small screens widgets stack in a single column in grid order (row by row, left to right) and controls move into a sticky bar or sheet at the top; tables scroll horizontally inside their card. Nothing mobile-specific is stored. The editor follows the same rule: drag and resize are pointer features that appear at `md:` and up, while every edit action (title, metrics, filters, formulas, layout size) is also reachable through forms and menus that work with touch. Datasource admin, the lookup table, and sharing are plain forms and lists and get the same mobile-first treatment.

## 10. Changes to `docs/datastructure`

To be rewritten in a separate step. The deltas agreed in discovery:

- Add a `DataSource` document: R2 key or prefix, version, lookup table rows (section 6), calculated fields.
- Add `Workspace`, `DashboardGrant`, `ShareLink`, `LibraryMetric`.
- `Metric` becomes a union: `{ fieldId, aggregation }` | `{ libraryMetricId }` | `{ expression }`. Drop the ambiguous `formula` + `metricFieldId` pairing. `userDefinedName`, `dataType`, `displayFormat`, `styling` stay.
- `Comparison.valueMode` is replaced by `mode: none | previousPeriod | previousYear`. The percent-of-total family is a table calculation, a different feature, deferred.
- `Filter.conditions` stays flat with one `and | or` connector. Nested groups deferred.
- Drop `DataSourceFieldRef` cross-source form; blends are out of scope.
- Add `title` to `CardBase`, `timezone` and `defaultDateRange` to `Dashboard`.
- Keep `GridPlacement` in storage; do not expose x/y on `addWidget`.
- Resolve the open questions with the defaults in section 12.

## 11. WebMCP tool surface

All tools are registered with `document.modelContext.registerTool` and unregistered through an `AbortSignal` tied to the route or mode. Descriptions carry the context the agent needs (which dashboard is open, what mode). Each tool calls the same server function the GUI calls. Tools return the resulting state so the agent can verify and chain.

Feature detection: `if ("modelContext" in document)`. The GUI must work without it.

View mode. Registered when a dashboard is open, for signed-in users and for unlisted viewers. All `readOnlyHint: true`.

- `listDashboards()` returns id, name, datasources per dashboard the caller can see.
- `getDashboard()` returns the open dashboard: widgets with definitions and titles, controls, current control state, timezone.
- `describeDatasource(datasourceId)` returns fields from the lookup table (canonical name, label, role, semantic type, description, sample values, cardinality), calculated fields with their expressions and descriptions, applicable library metrics with expressions and descriptions. This is the tool that makes "build a targeting report" possible without naming columns.
- `queryWidget(widgetId, controlState?)` returns rows and the applied control state. The consumption tool: "why did CTR drop for the AT Easter campaign last week" resolves to one or more of these calls.
- `explainWidget(widgetId)` returns the compiled SQL and plain-language definitions of every metric and calculated field involved.
- `getControlOptions(controlId, search?)` returns selectable values for a control.

Edit mode. Registered in addition to view mode when the caller has an editor or admin grant and the editor UI is open.

- `createDashboard({ name, datasourceIds, timezone?, defaultDateRange? })`.
- `updateDashboard({ name?, timezone?, defaultDateRange? })`.
- `addWidget({ definition, width, height })` appends and returns the stored widget with id and compiled SQL.
- `updateWidget({ widgetId, definition })` takes a full definition (read with `getDashboard` first). No deep patches, because patches on arrays such as `metrics` are ambiguous.
- `removeWidget({ widgetId })`. ChatGPT will ask the user to confirm; that is expected.
- `moveWidget({ widgetId, x, y, width?, height? })`.
- `previewWidget({ definition, controlState? })` runs without saving, returns rows or a compile error. Lets the agent check a formula before committing.
- `copyWidget({ fromDashboardId, widgetId })` copies an existing widget into the open dashboard, remapping the datasource if canonical names match.
- `upsertCalculatedField({ datasourceId, name, expression, role, semanticType, description })`.
- `updateFieldMetadata({ datasourceId, columnName, patch })` edits the lookup table row.
- `upsertLibraryMetric({ name, expression, semanticType, description })`, workspace-level.
- `shareDashboard({ action: createLink | revokeLink | grant | revoke, userEmail?, role? })`.

Datasource mode. Registered for editors and admins on the datasource route.

- `listR2Objects({ prefix? })` within the workspace prefix.
- `registerDatasource({ key | prefix, name })` runs `DESCRIBE`, seeds the lookup table, returns it.

Local file selection and upload bytes remain GUI-only because WebMCP tools accept JSON inputs.

Input schemas are JSON Schema `type: object` documents generated from the same zod schemas the server validates with, so tool and API cannot drift. Because ChatGPT ignores `outputSchema`, every description states what the tool returns.

## 12. Defaults decided without further discussion

- Comparison runs as a second query with a shifted date range.
- Relative dates resolve in the dashboard's timezone, default `Europe/Berlin`.
- Sort applies after aggregation and before the limit. Secondary sort is allowed on every multi-row widget.
- Gauge upper limit is a manual value or a library metric; manual wins when both are set.
- Widgets cannot overlap.
- Line charts put the first metric on the left axis and additional metrics on the right axis; no override yet.
- Styling stays an open object owned by each renderer.
- Rich text is stored as the editor's versioned JSON, never as HTML.
- Cache TTL 24 hours; datasource version in the key handles data refreshes.

## 13. Risks and spikes, in order

1. Resolved: the Ducklings Worker stayed within the compressed bundle limit but hit the Worker memory
   limit on real datasources. The implementation uses native DuckDB in the Bun container and keeps
   temporary-table isolation for user expressions.
2. ChatGPT desktop browser discovering tools on a Clerk-authenticated TanStack Start page, including after client-side navigation. Register tools after hydration, re-register on route change.
3. Memory. Source materialization still means memory grows with the decoded datasource. Observe real
   query sizes before raising the container instance size above `basic`.
4. Cold start. Container sleep is set to ten minutes. Measure first-query latency in preview and
   adjust the sleep window from evidence.
5. Tool selection quality with roughly 20 tools. If ChatGPT picks wrong tools, merge (`upsertCalculatedField` and `upsertLibraryMetric` into one) or sharpen descriptions before adding more.

## 14. Deferred

Data catalog beyond the lookup table. Ingestion and transformation. Blends and cross-source fields. Nested filter groups. Percent-of-total comparison modes. Line chart axis override. Per-workspace R2 buckets. Expression grammar with function allowlist. Any AI agent inside the app.

## 15. Sources

- [WebMCP Challenge official rules](https://webmcp.devpost.com/rules)
- [ChatGPT WebMCP docs](https://learn.chatgpt.com/docs/webmcp)
- [WebMCP specification](https://webmachinelearning.github.io/webmcp/)
- [State of WebMCP, July 2026](https://www.spronta.com/blog/state-of-webmcp-july-2026/)
- [DuckDB Node.js Neo client](https://duckdb.org/docs/stable/clients/node_neo/overview)
- [Cloudflare Workers pricing and limits](https://developers.cloudflare.com/workers/platform/pricing/)
- [R2 SQL limitations](https://developers.cloudflare.com/r2-sql/reference/limitations-best-practices/) (evaluated and not chosen: needs Iceberg tables, not plain files)
- [esome Looker Studio calculated fields guide](https://lookerstudio-guide.esome.info/guides/common-calculated-fields.html)
