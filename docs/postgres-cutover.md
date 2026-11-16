# Postgres cutover

This PR prepares the database port. Do not merge it as a routine production release: every main
push deploys production. The maintenance switch from issue #160 must land separately first.
No production data or configuration is changed by local validation.

## Required external configuration

- PlanetScale Postgres in AWS Frankfurt, with the production Hyperdrive configuration already
  referenced by `wrangler.jsonc`. Keep query caching disabled. The preview origin is verified as
  Postgres 18, matching Compose/CI; verify production also uses that major before cutover.
- GitHub repository secret `POSTGRES_PRODUCTION_URL`: direct production migration connection,
  available only in the production deploy step. Never migrate through Hyperdrive.
- Preview provisioning secrets, shared database and Hyperdrive as listed in
  [preview environments](preview-environments.md#postgres-provisioning).
- Separately shipped `MAINTENANCE_MODE` Worker secret support: every request except `/ready`
  must return the maintenance page before any other work. Turning it on/off requires no build.
  The switch must persist across deployment of this port.

These values and operations require explicit authorization for their target environment.

## Rehearsal and acceptance

First rehearse on the shared preview using its retained D1 SQL export and its direct Postgres
connection. Run the same copy and verification commands below. Include null/nested JSON,
boolean fields, encrypted datasource connections, and representative dashboards. A copy failure
must leave no partially committed application rows. Existing invalid Unicode is an error, not
silently repaired by the copy tool; sampled values from future registrations are sanitized.

Verify two branch previews have separate Postgres, Hyperdrive, KV and R2 resources; sign in,
register synthetic data and execute a container query in both. Push again and confirm persistence.
Clean up one and confirm the other still works. Measure complete query duration and per-range
budget round trips (`yresonance.query_read_budget`) before cutover. Inspect idle pool connection
counts with `pg_stat_activity` before considering a larger preview cap.

## Production window

1. Announce downtime, enable the separately shipped maintenance switch and wait for outstanding
   queries to finish, including container outbound writes. Keep `/ready` reachable.
2. Export D1 with `wrangler d1 export` to an offline SQL file. Retain it securely for one week.
3. Apply the baseline using the direct production connection:
   `POSTGRES_PRODUCTION_URL=<direct URL> bun run db:migrate:production`.
4. Copy from that export locally, with the target connection and the existing encryption secret
   supplied via environment variables:

   ```sh
   DATABASE_URL='<direct URL>' UPLOAD_SIGNING_SECRET='<existing secret>' \
     bun scripts/copy-d1-to-postgres.ts copy /secure/path/d1-export.sql
   DATABASE_URL='<direct URL>' UPLOAD_SIGNING_SECRET='<existing secret>' \
     bun scripts/copy-d1-to-postgres.ts verify /secure/path/d1-export.sql
   ```

   The source is an in-memory SQLite database loaded solely from the offline export. Tables copy
   in foreign-key order within one transaction. Nonempty targets are refused. Each integer column
   reports its stored min/max and must fit signed 32-bit Postgres integer. Four JSON columns decode
   before insertion and `hidden` converts 0/1 to boolean. Invalid jsonb fails the transaction.
   `query_read_budgets` is skipped because it describes in-flight work. Every other row is compared
   by primary key with decoded JSON, and one encrypted datasource connection is opened when present.
5. Only after verification, merge the port PR during this window. CI migrates and deploys the
   Postgres build while maintenance stays enabled. No serving version then binds D1.
6. Check `/ready`, disable maintenance, open a dashboard and run a query.
7. Before reopening only: rollback the Worker to its last D1 version and revert the port merge
   if necessary. After reopening, fix forward. Never switch back to the D1 snapshot after writes
   have begun on Postgres.
8. After one week, delete retained D1 databases, export and transitional preview cleanup. D1 is
   retained only for manual recovery during this period, not as a running application database.
