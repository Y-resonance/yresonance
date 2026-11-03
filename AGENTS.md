README.md is only for humans, don't edit it without explicit mention from users.

Data model lives in code: src/domain/schema.ts (dashboard document), src/db/schema.ts (tables), src/api/contracts.ts (API and tools)

The Dashboard Builder should be fully controllable by WebMCP tooling.
Generic tools like "addWidget", "editWidget" are preferred over very specialized tools.

Use cf CLI for investiating deployment-relevant topics.

## Evidence

Capture evidence for UI changes in a temporary directory outside the checkout. Publish screenshots
through `gh --attach` when supported, or use `dkwws upload` and embed the returned URLs in the
relevant GitHub issue or PR using `gh`.
Keep evidence files out of git. Read [the evidence workflow](docs/development.md#review-evidence)
before capturing or publishing evidence; it covers completion checks and product image assets.

## Documentation

[Documentation index](docs/index.md) separates current guides from historical measurements.

- Read [development tasks](docs/development.md) when working with local data files, landing assets, environment resets, D1 migration preflights, container HTTP checks, or telemetry.
- Read [architecture](docs/architecture.md) when changing query execution, storage, authentication, or preview example seeding.
- Read [product and architecture decisions](docs/decisions.md) before changing product behavior or architecture.
- Read [WebMCP usage](docs/webmcp-usage.md) when changing page tools, their contracts, or permissions.
- Read [BigQuery setup](docs/bigquery.md) when changing the Google connection, BigQuery query limits, or their external configuration.
- Read [ClickHouse setup](docs/clickhouse.md) when changing managed imports, external table access, preview databases, or freshness.
- Read [preview environments and deployment](docs/preview-environments.md) when changing Cloudflare deployment or preview isolation. It includes build setup, cleanup, and recovery.
