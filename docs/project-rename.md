# Project rename rollout

The repository now uses `yresonance`, with `https://yresonance.com/` as the public
domain. This change prepares infrastructure configuration. It does not migrate
live resources. Complete the rollout below before merging, because pushes to
`main` trigger production deployment.

## Resource mapping

| Resource | Previous name | Prepared name |
| --- | --- | --- |
| Production Worker | `rundown` | `yresonance` |
| Preview Worker | `rundown-preview` | `yresonance-preview` |
| Production D1 | `rundown-app` | `yresonance-app` |
| Preview D1 | `rundown-app-preview` | `yresonance-app-preview` |
| Production KV | `rundown-query-cache` | `yresonance-query-cache` |
| Preview KV | `rundown-query-cache-preview` | `yresonance-query-cache-preview` |
| Production R2 | `rundown-data` | `yresonance-data` |
| Preview R2 | `rundown-data-preview` | `yresonance-data-preview` |
| Production analytics | `rundown_product` | `yresonance_product` |
| Preview analytics | `rundown_product_preview` | `yresonance_product_preview` |
| Custom domain | `rundown-app.dev` | `yresonance.com` |

The D1 IDs now identify the newly provisioned `yresonance-app` and
`yresonance-app-preview` databases. Their schema, migration history, and rows
were restored from the legacy databases and verified on 2026-10-03. KV titles
changed while namespace IDs and cached data stayed the same. Both new R2 buckets
contain verified copies of the original objects, including HTTP metadata.

Backups are stored outside the repository under
`/home/decbox/.local/state/yresonance/rename-2026-10-03`. Keep the legacy databases
and buckets available for rollback. Recheck source contents with writes paused
before switching traffic, since users can change data between copying and cutover.

## Rollout prerequisites

1. Obtain explicit approval for the live migration and take D1 and R2 backups.
   Stop writes during the data cutover. Keep the old resources available for
   rollback.
2. Restore D1 into the renamed databases and update the config IDs. Update KV
   titles while preserving their IDs. Create the new private R2 buckets and
   copy all objects with their keys and metadata intact. Verify
   object counts and contents. Review persisted `data_sources.location` values
   and external datasource registrations for references to the old bucket names;
   migrate those references before switching the bindings.
3. Prepare both renamed Workers with the required Clerk, internal R2 signing,
   upload signing, and reset secrets. Preserve signing-secret values so existing
   capabilities remain valid. Reconnect Workers Builds to this repository with
   the README's build settings and variables. Review container and Durable Object
   lifecycle state, since a new Worker name creates a separate deployment target.
4. Configure `yresonance.com` in Cloudflare and Clerk. Update allowed origins,
   redirect URLs, authentication domains, and any external links. Keep the old
   domain available until bookmarks and shared dashboard URLs have migrated.
   Decide how its traffic redirects to the new domain before retiring it.
5. Update analytics consumers and log queries to the new dataset and
   `yresonance.*` event names. Historical analytics remain in the previous
   datasets. The KV cache can be repopulated; its namespace IDs are preserved.
6. Deploy and validate the shared preview first. Verify sign-in, datasource reads,
   uploads, query-container execution, dashboard editing, and shared links.
   Then authorize production cutover separately and validate the same journeys.
   Do not delete the old buckets or Workers until the rollback window ends.

PR previews use isolated `yresonance-preview-pr-<number>` resources. Cleanup also
checks `rundown-preview-pr-<number>` so PRs opened before the rename do not leak
resources. Closing this rename PR before it merges requires cleanup from its
branch as well: the current default branch only knows the previous prefix.

## Local and integration changes

Replace `RUNDOWN_*` environment variables in local shells, `.envrc` files, and
external automation with `YRESONANCE_*`. The HTTP action endpoint is now
`/api/yresonance`, health reports `yresonance`, and query-container headers use
`x-yresonance-*`. Update external callers together with the deployed application.

Local Wrangler state is not migrated by this PR. Back up local state before
switching branches if it contains data you need. Run `bun run db:migrate:local`
to initialize the renamed configuration. Landing screenshot capture requires
`LANDING_USER_EMAIL` for an existing Clerk development test user; changing the
project name does not rename that user's account.
