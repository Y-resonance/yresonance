## How yresonance uses WebMCP

Each page registers tools through `document.modelContext.registerTool()`, scoped to what the page
shows and what the signed-in user may do. Tools are unregistered through an `AbortSignal` when the
page changes. The UI keeps working in browsers without WebMCP.

Tools are generic on purpose. `addWidget`, `updateWidget`, `moveWidget`, and `updateLayout` cover
every widget type, so the agent composes them instead of learning one tool per feature. Each tool's
input schema is generated from the same Zod contract the app's own API uses, so the agent and the
GUI go through one validated path. Ids the page already knows, like the open dashboard, are
filled in by the page and removed from the schema the agent sees.

Tools by page, read-only first, then writes:

- Dashboards list: `listDashboards`, `listLibraryMetrics`. Writes: `createDashboard`.
- Dashboard editor: `listDashboards`, `listLibraryMetrics`, `getDashboard`, `queryWidget`,
  `explainWidget`, `getControlOptions`, `describeDatasource`, `previewWidget`. Writes:
  `updateDashboard`, `addWidget`, `updateWidget`, `removeWidget`, `moveWidget`, `updateLayout`,
  `copyWidget`, `upsertCalculatedField`, `updateFieldMetadata`, `upsertLibraryMetric`,
  `shareDashboard`, `createDashboard`.
- Unlisted link: `getDashboard`, `queryWidget`, `explainWidget`, `getControlOptions`,
  `describeDatasource`. No writes.
- Datasources: `listDataSources`, `listR2Objects`. Writes: `registerDatasource`, `updateDatasource`.
- Admins additionally get `updateFieldMetadata` and `upsertLibraryMetric` on the datasource and
  metrics pages.

Every tool carries `annotations.readOnlyHint`, so the agent host only asks for confirmation on
writes. `shareDashboard` and `removeWidget` say in their description that they change access or
delete data. Write tools return the stored result so the agent can verify what happened, and the
page refreshes after each write.

Security model: clients never send SQL or column names. The only query path is
`queryWidget(widgetId, controlState)`, used by the GUI and the WebMCP tool alike. Viewers and agents
on a shared link can only run queries the dashboard already defines. Formulas are written in
yresonance's own text syntax, parsed to an AST, validated, and compiled to SQL on the server.

`registerDatasource` accepts an optional `cachePolicy`; `updateDatasource` changes it for an
existing datasource. Policies are `default`, `disabled`, or `duration` with `ttlSeconds` from
1 to 86400. `queryWidget` accepts `refresh: true` to bypass and replace a cached result, including
on shared links. Expiry alone does not request data or refresh an open dashboard.
