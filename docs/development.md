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

`public/landing/*.png` are captured from the running app, not drawn by hand:

```sh
bun run dev
CLERK_SECRET_KEY=... LANDING_USER_EMAIL=... bun run scripts/capture-landing.ts
```

The script signs in to the Clerk development instance with a sign-in token, seeds a demo datasource
and dashboard from `scripts/landing-demo-data.ts`, shares the dashboard, and writes the shared view
and the field metadata screen to `public/landing`. Reset the local environment before changing the
demo data, because datasource names are unique per workspace.

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
