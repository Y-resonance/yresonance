# yresonance

Client reporting without the rebuild. Describe the report, fine-tune it in the browser.

yresonance is a dashboard builder for agency account managers. An agent and a human edit the same
dashboard in the same browser: the agent through [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools, the human through the GUI. Every widget is backed by a real query, and clients get a link
they can open and interrogate without ever typing a formula.

- Planned app domain: `yresonance.com`. See [the rename rollout](docs/project-rename.md) before deployment.
- Demo video: TODO add the YouTube link before submitting
- License: [MIT](./LICENSE)
- Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/)

## The problem

Account managers rebuild client dashboards every week. Looker Studio has the capabilities but is
unreliable and hard to adjust. Whatagraph is reliable but has no blends, no formulas, and costs too
much. Neither turns intent into widgets: "a targeting report on adset level" still has to be
translated into charts, fields, and filters by hand, for every new client.

yresonance lets the account manager describe the report to an agent, then fix what they already know
how to fix in the GUI, like a `CASE WHEN` that maps campaign ids to readable names. The agent sees
that change immediately because its tools read the live dashboard, not a snapshot.

## Try it with ChatGPT

1. Open the live app in the ChatGPT desktop app browser, or in Chrome with WebMCP enabled.
2. Sign in. Judges can use the editor account provided in the submission.
3. Open a dashboard, or start on the dashboards page and ask ChatGPT for a new one.

Prompts that show the full loop:

```text
Create a dashboard called "Acme Q3 video" for the Acme datasource. Add a scorecard row with
impressions, VTR and CPV, a line chart of VTR by day, a bar chart of CPV by adset, a date control
and a campaign filter.

Copy the CPV bar chart, but break it down by campaign name instead of adset.

Why did CPV rise in the last week? Compare adsets and tell me which one drove it.

Create an unlisted link for this dashboard.
```

Open the unlisted link in a fresh tab. The same question tools work there, the editing tools are
not registered.

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
- Datasources: `listDataSources`, `listR2Objects`. Writes: `registerDatasource`.
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

## Architecture

The TanStack Start app and API run in a Cloudflare Worker. Query execution runs in a Bun Cloudflare
Container with native DuckDB. The Worker authorizes exact Parquet objects, compiles yresonance formulas
to SQL, and gives DuckDB short-lived internal URLs for those objects. The container has no internet
access or R2 credentials.

Editors register uploaded or existing CSV and Parquet files from tenant-scoped R2 prefixes. Auth is
Clerk, with workspaces mapped to Clerk organizations. Application data lives in D1 with Drizzle.
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

More detail: [docs/decisions.md](./docs/decisions.md).

## Local development

```sh
bun install
bun run db:migrate:local
bun run dev
```

Upload files from the datasource registration
screen or place CSV and Parquet files in `dev-data/`. Local workspaces see those files under their
tenant-scoped `ws/<workspaceId>/` prefix. Vite serves the files with upload, deletion, and range
request support so the query container can read them without R2 credentials or a separate
object-storage service.

For example:

```sh
cp reporting_example.csv dev-data/
```

Local D1 and KV data persist in `.wrangler/`. Built and deployed containers read authorized Parquet
objects through the Worker's internal R2 handler. To work only on routes that do not query data,
start the app without local containers:

```sh
bun run dev
```

The app runs at `http://localhost:3000`. Set `YRESONANCE_PORT` to move the dev server; the local data
service follows it, so nothing stays pinned to `3000`.

Create the production build with:

```sh
bun run build
bun run deploy:dry-run
```

`GET /health` checks that the Worker can serve requests. `GET /ready` also reads D1, KV, and R2. It returns `503` and logs the failed dependency when any binding is unavailable.

## Tests

Three suites run separately, fastest first.

```sh
bun run check            # formatting, lint, types, migrations, and unit tests
bun run test:integration # the service and API route against Worker bindings
bun run test:e2e         # browser tests
```

`bun run test:integration` runs the request path inside `workerd` with isolated D1, KV, and R2
bindings. Clerk and the DuckDB query container are replaced at their network boundaries; tenancy,
grants, share links, control validation, and query caching all run for real.

`bun run test:e2e` runs two browser suites in order, each starting its own dev server on port
`3140`. Set `YRESONANCE_E2E_PORT` to change the port.

- `bun run test:e2e:ui` exercises the builder, datasource screens, and WebMCP with mocked API
  responses and a ready Clerk session double. It needs no Clerk credentials, rejects external
  browser requests, and never reuses an existing server. The auth doubles are Vite aliases enabled
  only by `vite dev --mode e2e-ui`; builds and normal development use real Clerk. Fixed-desktop
  specs run only in the desktop project, and the fixed mobile row spec runs only on mobile.
- `bun run test:e2e:clerk` exercises the public shell, auth modal, and authenticated dashboard
  flows with real Clerk. Set `YRESONANCE_E2E_REUSE_SERVER=1` to attach to an existing normal dev server.
  Reuse is off by default because an unrelated process on the port produced misleading runs;
  setup also verifies the server's yresonance health response.

The real Clerk suite executes the container's DuckDB query handler inside Vite locally because
Cloudflare's amd64 development container is not reliable under Apple Silicon emulation. Linux CI
starts the real query container and uses local R2 for uploaded test data. The mocked UI suite does
not start query containers or need database migrations.

The `authenticated` Playwright project signs a real Clerk user in with
[Clerk testing tokens](https://clerk.com/docs/testing/overview). It is skipped unless the
environment provides `VITE_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `E2E_CLERK_USER_USERNAME`,
and `E2E_CLERK_USER_PASSWORD` for a Clerk development instance. The test user needs:

- an email address using Clerk's `+clerk_test` convention, so the sign-in settles the new-device
  check with Clerk's fixed test code instead of a real inbox
- a password
- membership in a Clerk organization, because the app shows nothing until one is active

## Database

The application uses Drizzle for its schema and queries. Drizzle Kit generates SQL migrations, and Wrangler applies the committed SQL to D1.

```sh
# Generate a migration after changing src/db/schema.ts
bun run db:generate -- --name=describe-the-change

# Apply migrations to local Wrangler state
bun run db:migrate:local

# Apply migrations to the shared preview database
bun run db:migrate:preview

# Apply migrations to production explicitly
bun run db:migrate:production
```

`bun run check` applies every migration to a fresh temporary D1 database. Do not use `drizzle-kit push` against remote databases.

## Cloudflare deployment

The configured app domain is `yresonance.com`. Complete [the rename rollout](docs/project-rename.md) before merging.
Cloudflare deploys every push to `main`. The Worker deployment also builds and uploads the query
container image.

Query containers are constrained to Western Europe (`WEUR`) in production and previews.

Workers Builds handles production and branch-preview deployment. GitHub Actions
runs checks and deletes closed PR resources; it does not deploy previews.

Production settings:

```text
Production branch: main
Build command: bun run build
Deploy command: bun run deploy:built
```

Native preview settings:

```text
Preview builds: enabled
Build command: bun run build:branch-preview
Deploy command: bun run deploy:branch-preview
```

Set `BUN_VERSION=1.3.10` and the Clerk development publishable key in preview build
variables. Preview build credentials need access to provision D1, KV, and R2 in
addition to deploying Workers and containers. Configure preview runtime secrets
in Cloudflare's Previews Base; they are not inherited from production.

### Preview isolation

This follows [Cloudflare's resource isolation model](https://developers.cloudflare.com/workers/previews/resources/).
Cloudflare gives each branch Preview its own Durable Object namespace and
container app. D1, KV, and R2 require distinct resources, so
`scripts/preview-resources.ts prepare` provisions them before the native build.
Names include a hash of the exact branch name, preserving data across pushes and
avoiding collisions between branches such as `feature/report` and `feature-report`.

The helper writes `.wrangler-branch.json` with branch bindings under `previews`,
and `.wrangler-preview-migrations.json` pointing to that same D1 database. It
applies migrations before building. Production bindings and routes stay at the
top level. Branch resources request Western Europe; containers retain `WEUR`.
Analytics use the non-production `yresonance_product_preview` dataset.

Cloudflare deploys the Preview, maintains its branch URL, and posts it to the PR.
The separate `env.preview` remains available for deliberate shared deployments
with `bun run deploy:preview`.

### Secrets and activation

Complete [the native preview rollout](docs/native-previews.md) before enabling
Cloudflare preview builds. Configure these Previews Base secrets with the Clerk
**development** instance and non-production signing keys:

```sh
bunx wrangler preview base-config secret put CLERK_SECRET_KEY
bunx wrangler preview base-config secret put INTERNAL_R2_SIGNING_SECRET
bunx wrangler preview base-config secret put UPLOAD_SIGNING_SECRET
bunx wrangler preview base-config secret put RESET_ADMIN_TOKEN
```

These commands change live preview configuration and require separate approval.
Production secrets must not be copied into previews. Base-secret changes affect
new Previews; update existing Previews explicitly when rotating credentials.

### Cleanup

The `Preview cleanup` workflow runs when a same-repository PR closes. It obtains
the branch name from the closed PR, waits for Cloudflare builds on that branch to
finish, then deletes the native Preview, its D1/KV/R2 resources, and any container
apps matching its recorded Preview slug. It also removes legacy `pr-<number>`
resources during the transition. Fork PRs cannot trigger resource deletion.

Keep the repository `CLOUDFLARE_API_TOKEN` secret for cleanup and set the
`CLOUDFLARE_WORKER_TAG` repository variable to the parent Worker's script tag.
Cleanup credentials also need Workers Builds read access. Rerun failed cleanup
or dispatch the workflow with the closed PR number. If the Preview record was
already deleted, inspect leftover container apps manually before deleting them;
Cloudflare notes that container apps can remain after Preview deletion.

Native previews support containers partially. Validate a deployed authenticated
query and upload before relying on the new flow. Cloudflare readiness alone does
not prove container execution.

### GitHub Actions

The `Check` workflow runs lint, types, unit tests, and a Wrangler deployment dry run; Worker
integration tests; two parallel UI-test shards; and the real Clerk browser suite. Each UI shard
uses two workers and runs without secrets, including on fork pull requests. The real Clerk job
keeps its two-worker limit to avoid development-instance rate limiting, is skipped for forks,
and fails with a list of missing configuration until the following are configured:

| Name                         | Kind                | Purpose                           |
| ---------------------------- | ------------------- | --------------------------------- |
| `VITE_CLERK_PUBLISHABLE_KEY` | Repository variable | Loads Clerk in the browser        |
| `CLERK_SECRET_KEY`           | Repository secret   | Lets the Worker verify sessions   |
| `E2E_CLERK_USER_USERNAME`    | Repository secret   | Identifier of the Clerk test user |
| `E2E_CLERK_USER_PASSWORD`    | Repository secret   | Password of the Clerk test user   |

The test user needs a `+clerk_test` email address, a password, and membership in a Clerk
organization. The tests section above explains why.

Each environment needs `CLERK_SECRET_KEY`, `INTERNAL_R2_SIGNING_SECRET`,
`UPLOAD_SIGNING_SECRET`, and `RESET_ADMIN_TOKEN`. Use independent random values. The first signs
short-lived container capabilities, the second signs upload cleanup tokens, and the third protects
the reset route. No R2 API credential belongs in the Worker or container. Cloudflare Builds needs
`VITE_CLERK_PUBLISHABLE_KEY` as a build variable. Wrangler environments are separate Workers, so
production secrets do not carry over to preview.

Browser uploads stream through the Worker into its R2 binding. No bucket CORS policy or presigned
URL is needed. Managed CSV uploads convert to Parquet inside the query container before yresonance
registers the datasource.

## Landing page screenshots

`public/landing/*.png` are captured from the running app, not drawn by hand:

```sh
bun run dev
CLERK_SECRET_KEY=... LANDING_USER_EMAIL=... bun run scripts/capture-landing.ts
```

The script signs in to the Clerk development instance with a sign-in token, seeds a demo datasource
and dashboard from `scripts/landing-demo-data.ts`, shares the dashboard, and writes the shared view
and the field metadata screen to `public/landing`. Reset the local environment before changing the
demo data, because datasource names are unique per workspace.

## Environment reset

The reset command requires an environment and `RESET_ADMIN_TOKEN`:

```sh
bun run reset development
YRESONANCE_PREVIEW_URL=https://preview.example bun run reset preview
bun run reset production
```

Development and preview delete yresonance's D1 rows, R2 objects, and query-cache KV keys. Clerk users
and organizations are outside these bindings and remain untouched. Production always returns the
exact deletion plan and performs no deletion. Apply the committed D1 migrations before using a
fresh environment.

For an explicit production deployment from a local authenticated shell:

```sh
bun run deploy:production
```

The Worker expects these private resources:

| Resource | Production               | Preview                          |
| -------- | ------------------------ | -------------------------------- |
| D1       | `yresonance-app`         | `yresonance-app-preview`         |
| KV       | `yresonance-query-cache` | `yresonance-query-cache-preview` |
| R2       | `yresonance-data`        | `yresonance-data-preview`        |

The query container has its own `container/package.json` and `container/bun.lock` holding only
`@duckdb/node-api` and `zod`, so the image ships nothing from the frontend and its dependency layer
stays cached when frontend dependencies change. `@duckdb/node-api` is also a root dev dependency
because the container unit tests run from the repository root; bump both manifests together.

The runtime image bundles JavaScript and Bun bytecode, keeps only the glibc DuckDB binding,
and uses Bun's distroless base. Native libraries and the preinstalled, signed `httpfs` extension
remain available without runtime downloads. See [container startup measurements](docs/container-startup.md)
for the benchmark command, results, and deployment limitations.

The deployment provisions `QueryEngineContainer` as a SQLite-backed Durable Object namespace.
Production permits five `basic` instances; preview permits two. Cloudflare Builds needs container
builds enabled so Wrangler can build and push the checked-in `Dockerfile`.

To recreate the infrastructure in another Cloudflare account, enable R2 once in the dashboard and create the private buckets with:

```sh
wrangler r2 bucket create yresonance-data --location weur
wrangler r2 bucket create yresonance-data-preview --location weur
```

Store objects under `ws/<workspaceId>/`. Datasource registration rejects keys outside the active
workspace prefix. Apply the D1 migration to preview before opening a preview build; applying it to
production remains a separate explicit step.

## PostHog

The public project token and EU ingestion host are Worker variables in `wrangler.jsonc`.
Browser telemetry uses the same-origin `/ingest` proxy in the existing Worker. It routes `/static/*`
and `/array/*` to EU PostHog assets, and events, feature flags, and browser logs to the configured
ingestion host. The proxy strips app cookies, authorization headers, and referrers, forwards the
Cloudflare client IP for geolocation, and preserves asset cache headers. Server telemetry goes
directly to the ingestion host. See [PostHog's proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference).
Production enables tracking. Development and previews disable it so test traffic stays out of
product reports. To test locally, run `POSTHOG_ENABLED=true bun run dev`. The token is an ingestion
key, not a personal API key.

- Web analytics capture pageviews, page exits, campaign attribution, and Web Vitals.
- `product_action` records API actions with `action`, `result`, `duration_ms`, `source` (`gui` or
  `webmcp`), resource IDs, and Clerk organization ID as `workspace_id`.
- `workspace_action` records onboarding actions and their outcomes.
- Clerk user IDs identify signed-in visitors. Logout and account switches reset the browser identity.
- PostHog Logs receive `api_request_completed` from `yresonance-api` and API failures from
  `yresonance-web`. Only these explicit log records are exported. Existing console logs remain in
  Cloudflare. Server exports finish through `waitUntil` without delaying API responses.
- Error tracking captures browser errors, route rendering errors, API transport failures, server
  API errors with status 500 or higher, and uncaught Worker errors.

Share-link tokens and non-campaign URL parameters are redacted. Autocapture masks text and element
attributes. Report names, formulas, request bodies, and query results are not event properties.
Session recording is disabled.

Source map upload is wired into Vite but requires credentials beyond the public ingestion token.
Set `POSTHOG_UPLOAD_SOURCEMAPS=true`, `POSTHOG_PROJECT_ID` for this project, and `POSTHOG_API_KEY`
with the PostHog "Source map upload" permission preset in the production build environment.
The build injects chunk IDs, uploads maps to EU PostHog, and deletes maps after upload. Until
configured, minified errors have limited source context. Builds without upload credentials still work.

After deployment, create a dashboard, add a widget through both GUI and WebMCP, and change workspace.
Check the matching `product_action` and `workspace_action` events, pageviews in Web Analytics, and
`api_request_completed` in Logs. Verify errors in Error Tracking and check that a shared URL has
`/share/[redacted]` rather than its token. No production telemetry was sent during local verification.
