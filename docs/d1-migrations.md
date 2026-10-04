# D1 foreign key preflight

Before applying `0010_cascading-foreign-keys.sql` to a remote database, run the read-only
checks in `scripts/check-d1-orphans.sql` against that database. Set `CLOUDFLARE_ACCOUNT_ID`
to the account in `wrangler.jsonc`, then run:

```sh
cf d1 query <database-id> --sql "$(cat scripts/check-d1-orphans.sql)"
```

Every `orphan_count` must be zero. If any are positive, investigate and resolve those rows
before migrating. The migration refuses orphaned rows and rolls back rather than removing them.

On 2026-10-03, production returned zero orphans for all 12 relations. The configured preview
database had only `0000_initial-workspaces.sql` applied, zero workspaces, and no child tables.
Neither remote database was modified. Repeat the checks before deployment because data can change.

D1 always enables foreign keys. The migration rebuilds datasources and dashboards before adding
foreign keys to their children. Rebuilding children first would make dropping the old parents
cascade to those children, even with `PRAGMA defer_foreign_keys` enabled.
[Cloudflare's SQL documentation](https://developers.cloudflare.com/d1/sql-api/sql-statements/)
explains this behavior.

Foreign keys enforce parent existence and cascade deletes. Workspace filters still enforce tenant
isolation, and widget references inside dashboard JSON still require application validation.
