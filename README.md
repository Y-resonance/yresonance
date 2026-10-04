# yresonance

[yresonance](https://yresonance.com)
License: [MIT](./LICENSE)
Built for the [OpenAI WebMCP Challenge](https://webmcp.devpost.com/)

yresonance is a dashboard builder for advertisers & advertising agencies. An agent and a human edit the same
dashboard in the same browser: the agent through [WebMCP](https://webmachinelearning.github.io/webmcp/)
tools, the human through the GUI. Every widget is backed by a real query, and clients get a link
they can open and interrogate without ever typing a formula.

## Documentation

- [Architecture](docs/architecture.md)
- [Product and architecture decisions](docs/decisions.md)
- [WebMCP usage](docs/webmcp-usage.md)
- [Preview environments and deployment](docs/preview-environments.md)
- [Local data, landing screenshots, and environment resets](docs/development.md)

## Usage with ChatGPT App

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

## Local development

```sh
bun install
bun run db:migrate:local
bun run dev
```

Upload CSV and Parquet files from the datasource registration screen or place them in
`dev-data/`. See [development tasks](docs/development.md) for local file setup, landing
page screenshots, and environment resets.

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
