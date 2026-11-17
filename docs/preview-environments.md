# Preview environments and deployment

## Preview isolation

This follows [Cloudflare's resource isolation model](https://developers.cloudflare.com/workers/previews/resources/).
Cloudflare gives each branch Preview its own Durable Object namespace and
container app. Postgres, Hyperdrive, KV, and R2 require distinct resources, so
`scripts/preview-resources.ts prepare` provisions them before the native build.
Names include a hash of the exact branch name, preserving data across pushes and
avoiding collisions between branches such as `feature/report` and `feature-report`.

The helper writes `.wrangler-branch.json` with branch bindings under `previews`,
with a Hyperdrive binding to the branch database. It applies the Postgres baseline over a direct
connection before building. Production bindings and routes stay at the
top level. Branch resources request Western Europe; containers retain `WEUR`.
Analytics use the non-production `yresonance_product_preview` dataset. ClickHouse uses one
`yresonance_preview_<branch-hash>` database per branch, created during preparation and deleted
with the branch resources on PR closure. Preview build settings and GitHub cleanup secrets
use the restricted `CLICKHOUSE_PREVIEW_*` credentials documented in [ClickHouse setup](clickhouse.md).

Cloudflare deploys the Preview, maintains its branch URL, and posts it to the PR.
The separate `env.preview` remains available for deliberate shared deployments
with `bun run deploy:preview`.

## Postgres provisioning

All non-production databases live on the single PlanetScale `preview` branch. Preparation
creates `yresonance_preview_<branch-hash>`, applies the baseline and grants the shared
`yresonance_preview_runtime` role table access. It creates that login if missing with
`NOCREATEDB NOCREATEROLE`. The role has no schema-create grants and never receives the
provisioning credentials. Each Hyperdrive config disables query caching and limits origin
connections to five. Cleanup deletes Hyperdrive first, then uses `DROP DATABASE ... WITH (FORCE)`.
Provisioning takes an advisory lock and tolerates partial retries. It refuses a fourth branch
preview on the initial 25-connection budget and reports the separate 25-Hyperdrive account cap.
Legacy D1 cleanup remains until the one-week retention window has passed.

Use a node-postgres-compatible `POSTGRES_PREVIEW_URL` in both Workers Builds and the GitHub
cleanup secret: set `sslmode=verify-full` and remove libpq’s `sslrootcert=system` parameter
(Node uses its system CA store by default). Never use this admin URL in a Hyperdrive origin or
Worker variable. Do not print database error details, which may contain credentials.

Before the first build, configure:

- Workers Builds preview variables: `POSTGRES_PREVIEW_URL` with the direct provisioning role
  connection on the preview branch (PlanetScale `postgres` permission), and
  `POSTGRES_PREVIEW_RUNTIME_PASSWORD` with a separate, stable runtime-role password.
- GitHub secret `POSTGRES_PREVIEW_URL` for cleanup, using the same compatible connection URL.
- GitHub cleanup needs Hyperdrive read/write access. Either add Hyperdrive Write to its existing
  `CLOUDFLARE_API_TOKEN`, or set a separate `CLOUDFLARE_HYPERDRIVE_API_TOKEN` secret restricted to
  Hyperdrive Write in this account. The helper uses that optional token only for Hyperdrive API
  calls; all other resources keep the existing token. Workers Builds can use the same optional
  variable or a build token that already has Hyperdrive access.
- Shared preview: provision `yresonance_preview_shared`, migrate with
  `POSTGRES_PREVIEW_SHARED_URL`, grant the same runtime role access, and create its own
  Hyperdrive with caching disabled and five origin connections. Its ID is recorded in
  `wrangler.jsonc` under `env.preview`; update that binding when recreating it.

Runtime-password rotation requires changing the Postgres role and every preview Hyperdrive
credential together. The helper does not reset an existing role's password on every build.
After the shared preview is running, measure idle `pg_stat_activity` and query durations including
`yresonance.query_read_budget` events. Raise the preview cap only after measuring idle pool use
or increasing the branch connection budget. Shared-preview copy rehearsal, query latency and
cross-branch isolation verification remain mandatory before production cutover.

## Preview build configuration

Configure Cloudflare Workers Builds with `bun run build:branch-preview` as the preview build
command and `bun run deploy:branch-preview` as the deploy command. Preparation requires
`WORKERS_CI_BRANCH` from Cloudflare and rejects `main` or detached `HEAD`; plain `wrangler preview`
against the checked-in template does not provision isolated storage.

Use the Clerk development publishable key as `VITE_CLERK_PUBLISHABLE_KEY` in the preview build
environment. Its `CLOUDFLARE_API_TOKEN` needs Worker/container deployment and Hyperdrive/KV/R2 creation,
read and write access, plus D1 deletion access for older previews. Configure the optional `CLICKHOUSE_PREVIEW_*` build and cleanup
secrets as described in [ClickHouse setup](clickhouse.md). Keep credentials unavailable to fork
builds. Workers Builds reads Bun's version from `packageManager` in `package.json`; leave
`BUN_VERSION` unset on build triggers.

Preview builds execute branch-controlled scripts with the build credentials. Same-repository
branches therefore share the trust boundary of those credentials; excluding forks does not
protect against malicious same-repository code. Resource naming isolates application data, not
API token permissions. Separating provisioning into a trusted workflow or a preview-only account
is a separate infrastructure hardening task; this guide does not imply that isolation is in place.

The GitHub cleanup workflow requires `CLOUDFLARE_WORKER_TAG` as a repository variable containing
the parent Worker's script tag. Look it up again if the Worker is recreated. Its
`CLOUDFLARE_API_TOKEN` secret needs Workers, containers, D1, KV, and R2 deletion permissions and
`Workers Builds Configuration: Edit` on a user-scoped API token, as required by the
[Builds API](https://developers.cloudflare.com/workers/ci-cd/builds/api-reference/#create-an-api-token).
Account-scoped tokens are unsupported by that API. Looking up the Worker tag additionally requires
`Workers Scripts: Read`.

### Runtime secrets

Configure these Previews Base secrets with the Clerk
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

## Preview verification and cleanup

After changing preview provisioning, verify two same-repository branches have different Postgres/Hyperdrive/KV/R2
bindings. Sign in, upload synthetic data, and execute a container-backed query in both. Data must
remain isolated and survive a new commit on the same branch. A successful build alone does not
verify container support.

On PR closure, `.github/workflows/preview.yml` checks repository ownership and runs trusted
code from the default branch. Cleanup waits for that branch's running Cloudflare builds, then
deletes its Preview, matching container apps, Hyperdrive configuration, Postgres database, legacy D1/KV/R2 resources, and ClickHouse database.
Legacy `pr-<number>` previews under both old Worker names are deleted after native cleanup succeeds.
Retry the workflow with the
closed PR number after a partial failure only while the branch has not been pushed or reused
since closure. Exact resource names do not distinguish the original Preview from one recreated
by a later push; retrying can delete the new Preview and its data. Confirm another branch's preview
still works after cleanup.

Cloudflare can retain container apps after Preview deletion. If the Preview record is already
gone, inspect `bunx wrangler containers list` and delete only verified leftovers matched to the
recorded Preview slug. Never delete by the parent Worker prefix.

Branches without PRs need explicit cleanup after their builds stop:
`bun run scripts/preview-resources.ts cleanup <branch>`, using the same account, API token, and
`CLOUDFLARE_WORKER_TAG`. For branches with a ClickHouse preview database, also supply
`CLICKHOUSE_PREVIEW_URL`, `CLICKHOUSE_PREVIEW_USER`, `CLICKHOUSE_PREVIEW_PASSWORD`,
`CLICKHOUSE_PREVIEW_ACCESS_CLIENT_ID`, and `CLICKHOUSE_PREVIEW_ACCESS_CLIENT_SECRET`.
With no `CLICKHOUSE_PREVIEW_*` values set, ClickHouse cleanup is skipped. Partial configuration
fails cleanup and leaves the ClickHouse database in place; supply all five values before retrying.
A push after closure can recreate resources and require cleanup again.
These operations delete preview data and require authorization for the target environment.

For explicit recovery before a fix merges, dispatch cleanup on the reviewed fix branch with
`use_selected_ref=true`. This opt-in runs that exact selected commit; automatic cleanup and manual
runs without the flag still use the default branch. The closed-PR and repository-ownership checks
remain required. Confirm the closed branch has not been reused before running recovery.

### Read-only cleanup diagnostics

Dispatch the `Preview cleanup` workflow with `diagnose=true` on the ref to inspect.
This mode uses the GitHub preview credentials, checks Postgres access and database ownership,
and lists Hyperdrive configurations. It does not provision or delete resources. Unlike cleanup,
the explicit diagnostic runs the selected ref so a diagnostic fix can be checked before merging.
The required `pr` input only identifies the workflow's concurrency group in this mode.

Postgres provisioning failures report the operation plus a safe SQLSTATE, connection/TLS code,
or HTTP status when available. Original error messages, SQL, connection URLs and causes stay out
of the logs because they can contain credentials.

## Cloudflare deployment

GitHub Actions deploys pushes to `main` after all jobs in the Check workflow pass. The deployment
job builds that commit, applies production Postgres migrations over a direct connection, and deploys the Worker and query container.
Deployments run one at a time and skip commits that are no longer the head of `main`.

Query containers are constrained to Western Europe (`WEUR`) in production and previews.

The `IMAGES` binding resizes dashboard images. It is declared at the top level, in `env.preview`,
and in the `previews` template that `scripts/preview-resources.ts` copies, because bindings are not
inherited. The account's 5,000 free unique transformations per month are shared by production and
every preview; past that, the free plan fails transformations with 9422 and the Worker serves the
original image.

Workers Builds handles automatic branch-preview deployment. Its production build settings exclude
all paths (`path_excludes: ["*"]`) to prevent independent production deployments on push.
GitHub Actions runs checks, deploys production, and deletes closed PR resources; it does not deploy previews.

The production job uses the repository secret `CLOUDFLARE_API_TOKEN`, which must permit Worker,
container deployment operations. It builds with `VITE_CLERK_PUBLISHABLE_KEY_PRODUCTION`
from repository variables and `POSTHOG_PROJECT_TOKEN_PRODUCTION` from repository secrets.
The existing development Clerk variable remains reserved for browser tests.


For an explicit production deployment from a local authenticated shell:

```sh
bun run deploy:production
```

The Worker expects these private resources:

| Resource | Production               | Preview                          |
| -------- | ------------------------ | -------------------------------- |
| Postgres | PlanetScale production | `yresonance_preview_shared` on the preview branch |
| KV       | `yresonance-query-cache` | `yresonance-query-cache-preview` |
| R2       | `yresonance-data`        | `yresonance-data-preview`        |

The query container has its own `container/package.json` and `container/bun.lock` holding only
`@duckdb/node-api` and `zod`, so the image ships nothing from the frontend and its dependency layer
stays cached when frontend dependencies change. `@duckdb/node-api` is also a root dev dependency
because the container unit tests run from the repository root; bump both manifests together.

The runtime image bundles JavaScript and Bun bytecode, keeps only the glibc DuckDB binding,
and uses Bun's distroless base. Native libraries and the preinstalled, signed `httpfs` extension
remain available without runtime downloads. See [container startup measurements](./container-startup.md)
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
workspace prefix. Apply the Postgres baseline to preview before opening a preview build; applying it to
production remains a separate explicit step.
