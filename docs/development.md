# Development tasks

## Local Postgres

Start Postgres separately from the application:

```sh
docker compose up -d
bun run db:migrate:local
bun run dev
```

`bun run dev` checks connectivity and never starts a database. The default connection is
`postgres://yresonance:yresonance@localhost:5432/yresonance`. Override the application connection
with `CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE`. For a custom migration target,
use `DATABASE_URL=<direct connection> bunx drizzle-kit migrate`.
Compose uses Postgres 18, matching the verified PlanetScale preview branch major version.
The named volume preserves rows across restarts. The initialization SQL creates `yresonance_test`
on the first start; for an existing volume create that database manually once.

`bun run test:integration` uses the separate `yresonance_test` database on the same service.
`TEST_DATABASE_URL` may override it, but must name a database ending in `_test`. A global setup
applies the baseline once before any test workers start. Tests use generated IDs and do not reset
the database. `bun run check` remains independent of Docker. `bun run db:migrate:check` explicitly
applies migrations to the local test database when needed.

## Local data files

Upload CSV and Parquet files from the datasource registration screen or place them in
`dev-data/`. Local workspaces see those files under their tenant-scoped
`ws/<workspaceId>/` prefix. Vite serves the files with upload, deletion, and range
request support so the query engine can read them without R2 credentials or a
separate object-storage service. The local file and query routes require a loopback host and reject foreign browser origins.
The query route requires `application/json` and accepts at most 1 MiB per request.

For example:

```sh
mkdir -p dev-data
cp reporting_example.csv dev-data/
```

## Review evidence

For UI changes, exercise the affected flow and capture the relevant before/after states, including
mobile or theme variants when affected. Store screenshots, recordings, and other review artifacts
in a task-specific directory created with `mktemp -d` outside the checkout.

1. Inspect the captures for the intended behavior and for private data before publishing. Use
   synthetic data; `dkwws` links are publicly readable. Recapture anything containing credentials
   or customer data.
2. Include a short account of what was verified and any limitations. Check
   `gh pr comment --help` or `gh issue comment --help` for `--attach`. When supported, publish images
   with `gh pr comment <number> --body-file <file> --attach '<image-path>#<description>'` (or
   `gh issue comment`). Attach videos with `--attach '<video-path>'`, without an alt-text fragment.
   This command publishes the evidence; continue directly to step 4.
3. For other files or when `--attach` is unavailable, run `dkwws upload <file>` for each artifact.
   Embed image URLs with `![description](URL)` and link videos or other files with `[description](URL)`.
   Publish the body through `gh issue comment <number> --body-file <file>` or
   `gh pr comment <number> --body-file <file>`. Use `gh pr edit <number> --body-file <file>` when
   updating the PR description. This replaces the entire body: read it first with
   `gh pr view <number> --json body --jq .body`, merge the evidence into it, and write the complete
   description to the body file. Write actual newlines. Local file paths need `--attach` to upload.
4. Verify the published comment or description contains working attachments or links before reporting
   evidence as attached. If upload or publication fails, report the failure and retain the local
   captures outside the checkout for retry. If no issue or PR exists yet, return the uploaded URLs
   and attach them when one is created.

Example for an existing PR. Replace `123` with the PR number and describe the verified flow:

```sh
pr_number=123
evidence_dir=$(mktemp -d "${TMPDIR:-/tmp}/yresonance-evidence.XXXXXX")
# Save the browser capture to "$evidence_dir/after.png" before continuing.
after_url=$(dkwws upload "$evidence_dir/after.png") || exit 1
printf 'Verified: <flow and result>.\n\n![After](%s)\n' "$after_url" > "$evidence_dir/comment.md"
gh pr comment "$pr_number" --body-file "$evidence_dir/comment.md"
```

Review evidence is not a repository asset. The landing page images below are product assets and
remain versioned. Keep durable findings and reproduction instructions in docs; publish new raw
benchmark output with the issue or PR evidence.

## Landing page screenshots

`src/assets/landing/*.png` are captured from the running app, not drawn by hand:

```sh
bun run dev
CLERK_SECRET_KEY=... LANDING_USER_EMAIL=... bun run scripts/capture-landing.ts
```

The script signs in to the Clerk development instance with a sign-in token, seeds a demo datasource
and dashboard from `scripts/landing-demo-data.ts`, shares the dashboard, and writes the shared view
and the field metadata screen to `src/assets/landing`. The landing page imports these PNGs through
`vite-imagetools`, which generates lossless WebP assets automatically during development and builds.
Only the source PNGs are committed.
Reset the local environment before changing the demo data, because datasource names are unique
per workspace.

## Environment reset

The reset command requires an environment and `RESET_ADMIN_TOKEN`:

```sh
bun run reset development
YRESONANCE_PREVIEW_URL=https://preview.example bun run reset preview
bun run reset production
```

Development and preview delete yresonance's Postgres rows, R2 objects, and query-cache KV keys. Clerk users
and organizations are outside these bindings and remain untouched. Production always returns the
exact deletion plan and performs no deletion. Apply the committed Postgres baseline before using a
fresh environment.

## Database migrations and cutover

Generate changes with `bun run db:generate`. Migrations use `drizzle-kit migrate` over a direct
Postgres connection, never through Hyperdrive. Production and shared-preview migration commands
require `POSTGRES_PRODUCTION_URL` and `POSTGRES_PREVIEW_SHARED_URL` respectively.
See [the cutover runbook](postgres-cutover.md) for offline copying, row verification, maintenance,
and rollback boundaries. Production migration/deployment is a separate authorized operation.

## npm package

`bun run test:package` packs `@yresonance-dev/core`, installs the tarball into a copy of
`tests/package/` in a temporary directory, type-checks and builds that project under Node, applies
migrations with the packaged command and requests data from the running app. It needs the local
test database and refuses any database whose name does not end in `_test`. CI runs it as its own
job. Run it after changing `package.json` exports or files, `src/platform/vite.ts`,
`scripts/build-package.ts` or `bin/`.

`package.json` stays at version `0.0.0`. Pushing a tag such as `v0.2.0` runs
`.github/workflows/release.yml`, which repeats the package check, sets the version from the tag
and publishes through npm trusted publishing. npm is configured to trust that workflow by file
name, so renaming it breaks releases. The first version of a package has to be published by hand
before npm allows that configuration.

## Query container HTTP checks

`bunx vitest --run container/httpfs.test.ts` checks DuckDB's HEAD requests, byte-range responses,
redirects, overlapping reads, and explicit multi-file Parquet URL lists against a local HTTP server.
A smoke test in an isolated deployed preview is still needed for changes to Cloudflare's outbound
interception, which the local test runner does not emulate.

## PostHog

Tracking is disabled by default in every environment, and the checked-in project token is empty.
Self-hosted deployments must opt in with their own PostHog project. Supply these environment
variables to the local dev server or production build:

```sh
export POSTHOG_ENABLED=true
export POSTHOG_PROJECT_TOKEN='<your_project_token>'
export POSTHOG_HOST=https://eu.i.posthog.com
bun run dev
# Or build for your own deployment:
bun run build
```

Use `https://us.i.posthog.com` for US Cloud or your ingestion URL for a self-hosted PostHog instance.
Keep values in deployment settings or an ignored local file, not committed source. For the hosted
service, these variables belong only in Cloudflare's production build settings. Leave them unset
in preview builds to keep test traffic out of product reports. The project token is a public
browser ingestion token, not a personal API key.

The Vite build copies these settings into the generated Worker configuration. Browser telemetry
uses the same-origin `/ingest` proxy in that Worker. It routes `/static/*` and `/array/*` to the
matching EU or US assets origin, or the configured origin for self-hosted PostHog. Other requests
and server telemetry use the configured ingestion host. The proxy strips app cookies,
authorization headers, and referrers, forwards the Cloudflare client IP for geolocation, and
preserves asset cache headers. See [PostHog's proxy reference](https://posthog.com/docs/advanced/proxy/proxy-reference).

- Web analytics capture pageviews, page exits, campaign attribution, and Web Vitals.
- `product_action` records API actions with `action`, `result`, `duration_ms`, `source` (`gui` or
  `webmcp`), resource IDs, and Clerk organization ID as `workspace_id`. Theme saves add
  `theme_fields` and widget writes add `appearance_fields`: the names of the styling fields set,
  never their values. Widget writes add `widget_type`, and `text_style_fields` with the names of
  the title or text style options set; text widgets also add `text_has_links` and
  `text_has_formatting`. Text editor saves made while typing add `trigger: 'autosave'`.
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
Browser logs redact their URL attributes, and first-touch person properties are sanitized alongside
events. Feature flag requests are disabled because the app does not use them. Web Vitals and error
capture are enabled explicitly. Database errors retain stack locations but exclude SQL parameters
and their underlying causes.

Source map upload is wired into Vite but requires credentials beyond the public ingestion token.
Set `POSTHOG_UPLOAD_SOURCEMAPS=true`, `POSTHOG_PROJECT_ID` for this project, and `POSTHOG_API_KEY`
with the PostHog "Source map upload" permission preset in the production build environment.
The build injects chunk IDs, uploads maps to the configured PostHog region, and deletes maps after upload. Until
configured, minified errors have limited source context. Builds without upload credentials still work.

After deployment, create a dashboard, add a widget through both GUI and WebMCP, and change workspace.
Check the matching `product_action` and `workspace_action` events, pageviews in Web Analytics, and
`api_request_completed` in Logs. Verify errors in Error Tracking and check that a shared URL has
`/share/[redacted]` rather than its token. No production telemetry was sent during local verification.

## Production maintenance

The optional `MAINTENANCE_MODE` Worker secret stops application requests handled by the Worker
before routing, authentication, analytics and database access. `/ready` remains available.
Cloudflare may continue serving public build assets directly; those requests cannot access application data. Responses return 503,
`Retry-After: 60` and `Cache-Control: no-store`.

Set the secret to `1` to enable maintenance; delete it or set it to `0` or `false` to reopen.
Changes require production authorization. Configure it with `wrangler secret put MAINTENANCE_MODE`
and `wrangler secret delete MAINTENANCE_MODE` against the intended Worker. Secrets persist across
normal deployments. Wait for existing requests and container work to finish before exporting data.
