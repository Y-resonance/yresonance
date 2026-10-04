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

Complete [the native preview rollout](./native-previews.md) before enabling
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

## Cloudflare deployment

Cloudflare deploys every push to `main`. The Worker deployment also builds and uploads the query
container image.

Query containers are constrained to Western Europe (`WEUR`) in production and previews.

Workers Builds handles production and branch-preview deployment. GitHub Actions
runs checks and deletes closed PR resources; it does not deploy previews.


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
workspace prefix. Apply the D1 migration to preview before opening a preview build; applying it to
production remains a separate explicit step.
