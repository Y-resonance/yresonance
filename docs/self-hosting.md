# Self-hosting

yresonance is published as one npm package, `@yresonance-dev/core`. You install it into your own
project, choose your infrastructure in a config file, and build the app there. The hosted service
in `cloud/` is built the same way.

Today the package ships adapters for Cloudflare and Clerk only. Other infrastructure needs an
adapter written in your project, see [Your own adapters](#your-own-adapters).

## Project

Three files next to your `package.json`. [`tests/package/`](../tests/package) is a complete project that CI installs, builds
and runs on every change.

```sh
bun add @yresonance-dev/core vite
```

```ts
// vite.config.ts
import { yresonance } from '@yresonance-dev/core/vite';
import { defineConfig } from 'vite';

export default defineConfig({ plugins: [yresonance()] });
```

`yresonance()` reads `yresonance.config.ts` from the directory you run Vite in. Pass
`{ config: 'path/to/file.ts' }` for another location. The build output goes to `dist/` in your
project, and `.env` files are read from your project.

```ts
// yresonance.config.ts
import { defineConfig } from '@yresonance-dev/core/config';
import { clerk } from '@yresonance-dev/core/adapters/clerk';
import { currentDatasources } from '@yresonance-dev/core/adapters/datasources';
import { cache, images, queryEngine, storage } from './adapters';

export default defineConfig({
  database: { connectionString: () => process.env.DATABASE_URL! },
  storage,
  cache,
  images,
  auth: clerk(),
  datasources: currentDatasources(),
  queryEngine,
  background: { waitUntil: (promise) => void promise.catch(console.error) },
});
```

`./adapters` stands for your own file. The config is compiled into the server at build time. There is no runtime switch between
adapters; values such as URLs and secrets come from environment variables at runtime.

## Slots

| Slot | Purpose | Shipped adapters |
| --- | --- | --- |
| `database` | Postgres connection string | `hyperdrive` |
| `storage` | Data files and dashboard images | `r2` |
| `cache` | Query results | `workers-kv` |
| `images` | Read dimensions, resize | `cloudflare-images` |
| `auth` | Request identity, user directory, request middleware | `clerk` |
| `datasources` | Datasource providers offered to editors | `datasources` |
| `queryEngine` | Reach the DuckDB query server | `duckdb` (Cloudflare Containers) |
| `background` | Work that outlives the response | `workers-background` |
| `productAnalytics` | Optional usage data points | `analytics-engine` |

Import them as `@yresonance-dev/core/adapters/<name>`. The Cloudflare adapters only work in a
Worker.

## Your own adapters

A slot is a plain object. Its type is exported, so an adapter is a function in your project:

```ts
import type { Cache } from '@yresonance-dev/core/config';

export function redisCache(): Cache {
  return {
    get: async (key, type) => {
      /* ... */
    },
    put: async (key, value, { expirationTtl }) => {
      /* ... */
    },
    delete: async (key) => {
      /* ... */
    },
    list: async ({ cursor, limit }) => {
      /* ... */
    },
  };
}
```

`PlatformConfig` in `@yresonance-dev/core/config` describes every slot. The auth slot's
`middleware()` returns a TanStack Start request middleware, so an auth adapter also needs
`@tanstack/react-start` as a dependency of your project.

## Build and run

```sh
bunx --bun vite build
```

The build writes `dist/client` (static files) and `dist/server/server.js`, which exports a
standard `fetch` handler. Serve both from a small entry file:

```ts
// server.ts
import { join } from 'node:path';
import app from './dist/server/server.js';

const client = join(import.meta.dir, 'dist/client');

Bun.serve({
  port: Number(process.env.PORT ?? 3000),
  async fetch(request) {
    const { pathname } = new URL(request.url);
    const file = Bun.file(join(client, pathname));
    if (pathname !== '/' && (await file.exists())) return new Response(file);
    return app.fetch(request);
  },
});
```

Settings that reach the browser are compiled in, so they must be set when you build. With Clerk
that is `VITE_CLERK_PUBLISHABLE_KEY`. Server settings such as `DATABASE_URL`, `CLERK_SECRET_KEY`,
`INTERNAL_R2_SIGNING_SECRET` and `UPLOAD_SIGNING_SECRET` are read at runtime.

## Container image

```dockerfile
FROM oven/bun:1.4.4 AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY yresonance.config.ts vite.config.ts ./
ARG VITE_CLERK_PUBLISHABLE_KEY
RUN bunx --bun vite build

FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json server.ts ./
USER bun
EXPOSE 3000
CMD ["bun", "server.ts"]
```

The server imports its dependencies from `node_modules`, so the runtime stage keeps that folder.

## Database migrations

Postgres is the only application database. Apply migrations before starting a new version, for
example as an init container or a job with the same image:

```sh
DATABASE_URL=postgres://... bunx --bun yresonance migrate
```

With Node installed, `npx yresonance migrate` does the same.

## Upgrading

Raise the package version, build again, run the migrations, then start the new build.
