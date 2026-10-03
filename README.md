# Rundown

Client reporting without the rebuild. Describe the report, fine-tune it in the browser.

Rundown is a dashboard builder for agency account managers. An agent and a human edit the same
dashboard in the same browser: the agent through [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools, the human through the GUI. Every widget is backed by a real query, and clients get a link
they can open and interrogate without ever typing a formula.

- Live app: [rundown.rundown.workers.dev](https://rundown.rundown.workers.dev)
- Demo video: TODO add the YouTube link before submitting
- License: [MIT](./LICENSE)
- Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/)

## The problem

Account managers rebuild client dashboards every week. Looker Studio has the capabilities but is
unreliable and hard to adjust. Whatagraph is reliable but has no blends, no formulas, and costs too
much. Neither turns intent into widgets: "a targeting report on adset level" still has to be
translated into charts, fields, and filters by hand, for every new client.

Rundown lets the account manager describe the report to an agent, then fix what they already know
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

## How Rundown uses WebMCP

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
Rundown's own text syntax, parsed to an AST, validated, and compiled to SQL on the server.

## Architecture

The TanStack Start app and API run in a Cloudflare Worker. Query execution runs in a Bun Cloudflare
Container with native DuckDB. The Worker authorizes exact Parquet objects, compiles Rundown formulas
to SQL, and gives DuckDB short-lived internal URLs for those objects. The container has no internet
access or R2 credentials.

Editors register uploaded or existing CSV and Parquet files from tenant-scoped R2 prefixes. Auth is
Clerk, with workspaces mapped to Clerk organizations. Application data lives in D1 with Drizzle.
Nothing domain-specific is hardcoded: metrics such as VTR or CPV are workspace data, not code.

More detail: [docs/plan.md](./docs/plan.md) and [docs/datastructure](./docs/datastructure).

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
RUNDOWN_DISABLE_CONTAINERS=1 bun run dev
```

The app runs at `http://localhost:3000`. Set `RUNDOWN_PORT` to move the dev server; the local data
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

`bun run test:e2e` starts its own dev server on port `3140`. Set `RUNDOWN_E2E_PORT` to change it, and
`RUNDOWN_E2E_REUSE_SERVER=1` to attach to a server you already started. Reuse is off by default
because attaching to an unrelated process on the port produced misleading runs; the suite also
refuses to start when the port does not answer as Rundown.

Local browser tests execute the container's DuckDB query handler inside Vite because Cloudflare's
amd64 development container is not reliable under Apple Silicon emulation. Linux CI starts the
real query container and uses local R2 for uploaded test data.

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

The app is available at [rundown.rundown.workers.dev](https://rundown.rundown.workers.dev).
Cloudflare deploys every push to `main`. The Worker deployment also builds and uploads the query
container image.

The GitHub repository is connected with these Workers Builds settings:

```text
Production branch: main
Build command: bun run build
Deploy command: bun run deploy:built
Non-production deploy command: bun run deploy:dry-run
Non-production branch builds: disabled
```

Set the `BUN_VERSION` build variable to `1.3.10`. GitHub Actions validates pull requests, including
the Wrangler deployment package. PR previews deploy through GitHub Actions, so keep Cloudflare
non-production branch builds disabled to avoid duplicate deployments.

Cloudflare no longer repeats `bun run check`. `main` is protected instead, with the three `Check`
jobs required, so only commits that already passed those checks can land on the production branch.
Each pipeline now builds the app once: GitHub Actions builds it for the deployment dry run, and
Cloudflare builds it for the release.

The named preview environment remains available for deliberate preview deployments with
`bun run deploy` or `bun run deploy:preview`. PR previews are separate Worker Previews under
`rundown-preview`. Production deployments normally come from pushes to `main`.

### Pull request previews

The `PR preview` workflow deploys same-repository PRs on opening, reopening, and each push.
Draft PRs deploy too. Changing draft state keeps the same `pr-<number>` URL and data. Fork PRs
do not receive credentials or deploy. The workflow posts the URL on the PR and checks `/ready`
for D1, KV, and R2 connectivity. This check does not exercise container queries.

Each PR gets a fresh D1 database with the branch migrations, a KV namespace, and an R2 bucket.
Cloudflare Worker Previews create separate Durable Object namespaces and container apps.
The generated configuration includes the query container and its binding under `previews`.
Analytics events use the shared `rundown_product_preview` dataset.

Closing a PR, including merging, deletes its Preview, any remaining container app, D1 database,
KV namespace, and R2 bucket with its uploads. Cleanup uses the default branch code and waits
for in-flight deployments. If cleanup fails, rerun it or dispatch `PR preview` with the closed
PR number. Cleanup discovers resources by exact PR names and tolerates already deleted resources.

GitHub needs these credentials, already configured in this repository:

| Name                         | Kind                | Purpose                                             |
| ---------------------------- | ------------------- | --------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`       | Repository secret   | Deploy Previews and manage their resources          |
| `PREVIEW_SIGNING_SECRET`     | Repository secret   | Derive stable signing and reset secrets per PR      |
| `CLERK_SECRET_KEY`           | Repository secret   | Authenticate against the Clerk development instance |
| `VITE_CLERK_PUBLISHABLE_KEY` | Repository variable | Build the browser with the same Clerk instance      |

The CI token is scoped to the yresonance account with Account Settings Read, Workers Scripts
Write, Workers KV Storage Write, D1 Write, Workers R2 Storage Write, Workers Containers Write,
and Cloudchamber Write. These permissions cover resources in the account, so only trusted
contributors should have branch write access. Production and shared preview resources are not
targeted by this workflow. No S3 credentials are needed; cleanup uses the R2 empty-bucket API.

Worker Previews require Wrangler 4.135.0 or later. Cloudflare currently describes container
support as partial. Validate an authenticated query or upload in the first deployed PR before
using it for acceptance testing. See [Cloudflare resource isolation and container cleanup](https://developers.cloudflare.com/workers/previews/resources/).

### GitHub Actions

The `Check` workflow runs three jobs: lint, types, unit tests, and a Wrangler deployment dry run;
Worker integration tests; and browser tests. The browser job needs a Clerk development instance and
fails with a list of what is missing until it is configured:

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
URL is needed. Managed CSV uploads convert to Parquet inside the query container before Rundown
registers the datasource.

## Landing page screenshots

`public/landing/*.png` are captured from the running app, not drawn by hand:

```sh
bun run dev
CLERK_SECRET_KEY=... bun run scripts/capture-landing.ts
```

The script signs in to the Clerk development instance with a sign-in token, seeds a demo datasource
and dashboard from `scripts/landing-demo-data.ts`, shares the dashboard, and writes the shared view
and the field metadata screen to `public/landing`. Reset the local environment before changing the
demo data, because datasource names are unique per workspace.

## Environment reset

The reset command requires an environment and `RESET_ADMIN_TOKEN`:

```sh
bun run reset development
RUNDOWN_PREVIEW_URL=https://preview.example bun run reset preview
bun run reset production
```

Development and preview delete Rundown's D1 rows, R2 objects, and query-cache KV keys. Clerk users
and organizations are outside these bindings and remain untouched. Production always returns the
exact deletion plan and performs no deletion. Apply the committed D1 migrations before using a
fresh environment.

For an explicit production deployment from a local authenticated shell:

```sh
bun run deploy:production
```

The Worker expects these private resources:

| Resource | Production            | Preview                       |
| -------- | --------------------- | ----------------------------- |
| D1       | `rundown-app`         | `rundown-app-preview`         |
| KV       | `rundown-query-cache` | `rundown-query-cache-preview` |
| R2       | `rundown-data`        | `rundown-data-preview`        |

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
wrangler r2 bucket create rundown-data --location weur
wrangler r2 bucket create rundown-data-preview --location weur
```

Store objects under `ws/<workspaceId>/`. Datasource registration rejects keys outside the active
workspace prefix. Apply the D1 migration to preview before opening a preview build; applying it to
production remains a separate explicit step.
