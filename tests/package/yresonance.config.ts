// Deployment config of the package check's consumer project (scripts/check-package.ts).
// Every slot except the datasources is written here, the way a self-hoster adds adapters the
// package does not ship. None of these stand-ins is suitable for a real deployment.
import { createMiddleware } from '@tanstack/react-start';
import { defineConfig, type Cache, type Storage } from '@yresonance-dev/core/config';
import { currentDatasources } from '@yresonance-dev/core/adapters/datasources';

const emptyStorage: Storage = {
  get: async () => null,
  head: async () => null,
  put: async () => {
    throw new Error('The package check has no object storage.');
  },
  list: async () => ({ objects: [], truncated: false }),
  delete: async () => {},
};

const entries = new Map<string, string>();
const memoryCache: Cache = {
  get: async (key: string, type?: 'json') => {
    const value = entries.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  },
  put: async (key, value) => void entries.set(key, value),
  delete: async (key) => void entries.delete(key),
  list: async () => ({
    keys: [...entries.keys()].map((name) => ({ name })),
    list_complete: true,
  }),
};

export default defineConfig({
  database: { connectionString: () => process.env.DATABASE_URL! },
  storage: emptyStorage,
  cache: memoryCache,
  images: {
    dimensions: async () => undefined,
    resize: async (body) => new Response(body),
  },
  // One fixed admin, so the check reaches the database without an identity provider. Its UI
  // half is auth-ui.ts, named in vite.config.ts.
  auth: {
    requestIdentity: async () => ({
      userId: 'user_package_check',
      orgId: 'org_package_check',
      orgSlug: 'package-check',
      isAdmin: true,
    }),
    directory: {
      users: async () => [],
      memberships: async () => [],
    },
    middleware: () => createMiddleware().server(({ next }) => next()),
  },
  datasources: currentDatasources(),
  queryEngine: {
    url: () => process.env.QUERY_ENGINE_URL!,
    fetch: (_workspaceId, request) => fetch(request),
  },
  background: { waitUntil: (promise) => void promise.catch(console.error) },
});
