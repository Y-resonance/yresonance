# Native preview rollout

This prepares Cloudflare-native branch previews. It does not enable builds,
change live secrets, provision remote resources, or migrate production data.
Complete the project rename rollout separately before production deployment.

## Isolation

Cloudflare creates a separate Worker, Durable Object namespace, and container app
for each native Preview. Its [resource documentation](https://developers.cloudflare.com/workers/previews/resources/)
requires explicit D1, KV, and R2 bindings to separate those stores.

Every non-production branch gets a D1 database, KV namespace, and private R2
bucket named `yresonance-branch-<hash>`. The hash uses the exact branch name.
The helper reuses those resources on subsequent builds and generates both the
Preview bindings and a migration config pointing to the same D1 database.
It rejects `main` and detached `HEAD` before accessing Cloudflare.

The checked-in `previews` block supplies preview variables, analytics, containers,
and Durable Object bindings. Storage bindings come from the helper, so use
`build:branch-preview` before `deploy:branch-preview`. Plain `wrangler preview`
with the checked-in template alone does not supply the application's storage.
The existing `env.preview` remains a manual shared staging deployment.

## Activation after approval

1. Merge the configuration before enabling native builds. Remove the old GitHub
   preview deployment by landing this PR. Existing PR previews remain eligible
   for legacy cleanup. Production migration still requires its separate approval.
2. Set the GitHub repository variable `CLOUDFLARE_WORKER_TAG` to the parent
   `yresonance` Worker's script tag, currently
   `afc669177af249c590f7538cdc439f54`. Verify it if the Worker is recreated.
   Retain the repository `CLOUDFLARE_API_TOKEN` cleanup secret. It needs Workers,
   containers, D1, KV, and R2 deletion permissions, plus Workers Builds read access.
3. Configure Cloudflare's preview build environment with `BUN_VERSION=1.3.10`,
   `VITE_CLERK_PUBLISHABLE_KEY` from the Clerk development instance, and
   `CLOUDFLARE_API_TOKEN` with Worker/container deployment and D1/KV/R2 creation,
   read, write, and migration permissions. Add the five `CLICKHOUSE_PREVIEW_*` variables from
   [ClickHouse setup](clickhouse.md) as preview build secrets and GitHub repository cleanup secrets
   when ClickHouse is enabled. Do not expose these credentials to
   fork builds or copy production Clerk keys.
4. Set the Previews Base runtime secrets using the development Clerk instance
   and non-production signing keys. Supply values interactively:

   ```sh
   bunx wrangler preview base-config secret put CLERK_SECRET_KEY
   bunx wrangler preview base-config secret put INTERNAL_R2_SIGNING_SECRET
   bunx wrangler preview base-config secret put UPLOAD_SIGNING_SECRET
   bunx wrangler preview base-config secret put RESET_ADMIN_TOKEN
   ```

   New Previews inherit base secrets. Rotations require explicit updates to
   existing Previews as well.
5. Enable Cloudflare preview builds. Set the preview build command to
   `bun run build:branch-preview` and deploy command to
   `bun run deploy:branch-preview`. Keep production on `main` with
   `bun run build` and `bun run deploy:built`. Cloudflare supplies
   `WORKERS_CI_BRANCH`; the helper requires it rather than guessing a branch.
6. Push two same-repository PR branches. Confirm Cloudflare publishes both URLs
   and their DB, QUERY_CACHE, and DATA bindings have different IDs/names.
   Sign in, upload a dataset, and run a container-backed query in each.
   Confirm data written in one preview is absent from the other and survives a
   new commit on the same branch. Cloudflare documents partial container support,
   so a successful build alone is insufficient verification.
7. Close a test PR. Confirm the GitHub cleanup workflow waits for its running
   native builds, removes its Preview and matching container apps, and deletes
   only that branch's D1/KV/R2 and ClickHouse database. Verify the other preview still works.

## Cleanup and recovery

Cleanup checks the PR is closed and belongs to this repository, and runs trusted
code from the default branch. It also deletes legacy `pr-<number>` previews under
both old Worker names. Retry the workflow with its closed PR number if a service
fails. Exact storage names make retries safe after partial deletion.

Cloudflare can retain a container app after deleting its Preview. The helper
uses the recorded Preview slug to match only that Preview's container apps.
If its Preview record was already removed, inspect `bunx wrangler containers list`
and delete verified leftovers manually. Never delete by the parent Worker prefix.

Branches without PRs do not trigger PR-close cleanup. After their builds stop,
run `bun run scripts/preview-resources.ts cleanup <branch>` with the same account,
API token, and `CLOUDFLARE_WORKER_TAG`. A new push on a closed branch can create
resources again; avoid pushing it after cleanup or run cleanup again.

The non-production analytics dataset is shared. Application data and query cache
are isolated per branch. Production bindings and the public domain are unchanged
by this preview rollout.
