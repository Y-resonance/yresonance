# Development tasks

## Local data files

Upload CSV and Parquet files from the datasource registration screen or place them in
`dev-data/`. Local workspaces see those files under their tenant-scoped
`ws/<workspaceId>/` prefix. Vite serves the files with upload, deletion, and range
request support so the query engine can read them without R2 credentials or a
separate object-storage service.

For example:

```sh
mkdir -p dev-data
cp reporting_example.csv dev-data/
```

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

Development and preview delete yresonance's D1 rows, R2 objects, and query-cache KV keys. Clerk users
and organizations are outside these bindings and remain untouched. Production always returns the
exact deletion plan and performs no deletion. Apply the committed D1 migrations before using a
fresh environment.

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
