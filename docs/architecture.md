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

More detail: [docs/decisions.md](./decisions.md).
