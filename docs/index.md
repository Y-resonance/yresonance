# Documentation

Code defines the data model and contracts: `src/domain/schema.ts`, `src/db/schema.ts`, and
`src/api/contracts.ts`. These guides cover intent, boundaries, and operational tasks.

## Current guides

| Guide | Read when |
| --- | --- |
| [Decisions](decisions.md) | Changing product behavior or architecture; records reasons and deferred scope. |
| [Architecture](architecture.md) | Changing query execution, storage, authentication, or preview seeding. |
| [Development](development.md) | Working with local data, review evidence, landing assets, resets, migrations, container HTTP checks, or telemetry. |
| [Authentication](authentication.md) | Changing auth adapters or the auth UI, or self-hosting with Keycloak or another OIDC provider. |
| [WebMCP](webmcp-usage.md) | Changing page tools, their contracts, or permissions. |
| [BigQuery](bigquery.md) | Configuring Google authorization or changing query limits. |
| [ClickHouse](clickhouse.md) | Configuring managed/external tables, credentials, preview databases, or freshness. |
| [Preview environments and deployment](preview-environments.md) | Changing deployments, preview isolation, build setup, cleanup, or recovery. |
| [Self-hosting](self-hosting.md) | Changing the npm package, its exports, the Vite plugin, or what a self-hoster has to do. |

## Historical measurements

Retained for methodology, reproduction, and the reasoning behind performance changes. These are
measurements of dated commits and environments, not current service performance or deployment
instructions. The accompanying raw files in `benchmarks/` support those measurements.

- [Container startup, 2026-10-03](container-startup.md): image optimization and placement experiments.
- [Uncached queries, 2026-10-05](benchmarks/2026-10-05-uncached-queries.md): baseline and engine comparison.
- [Canvas performance, 2026-10-05](benchmarks/2026-10-05-canvas-performance.md): request and UI optimizations.

## Consolidated or removed

- `native-previews.md`: build configuration, verification, cleanup, and recovery moved into
  [the deployment guide](preview-environments.md). The one-time activation checklist is retired.
- `d1-migrations.md`: the D1 preflight retired with the Postgres port. Use
  [the cutover runbook](postgres-cutover.md) for offline exports and verification.
- `httpfs-proof.md`: local test instructions and the platform verification boundary moved into
  [development](development.md#query-container-http-checks); the executable proof remains in
  `container/httpfs.test.ts`.
- `project-rename.md`: retired one-time rollout plan. Current names are in configuration; migration
  and rollback history remain available in Git history.
- `architecture.png`: retired diagram with the old API route and no ClickHouse or BigQuery paths.
  [Architecture](architecture.md) is the maintained reference.
- `discovery/`, `evidence/`, and `review-evidence/`: historical screenshots removed from the current
  tree. They remain in Git history. New evidence follows
  [the upload and GitHub workflow](development.md#review-evidence).

- [Postgres cutover](postgres-cutover.md): direct migrations, offline copy, verification and rollback.
