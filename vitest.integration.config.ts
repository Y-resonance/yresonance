import { fileURLToPath } from 'node:url';
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const migrations = await readD1Migrations(fromRoot('./drizzle'));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // The suite drives the real service; only Clerk's network boundary is replaced.
      '@clerk/tanstack-react-start/server': fromRoot('./tests/integration/doubles/clerk.ts'),
      '@cloudflare/containers': fromRoot('./tests/integration/doubles/containers.ts'),
    },
  },
  plugins: [
    cloudflareTest({
      miniflare: {
        // The pinned test runtime supports no later date. Flags match wrangler.jsonc.
        compatibilityDate: '2026-08-22',
        compatibilityFlags: ['nodejs_compat'],
        d1Databases: ['DB'],
        kvNamespaces: ['QUERY_CACHE'],
        r2Buckets: ['DATA'],
        bindings: {
          TEST_MIGRATIONS: migrations,
          CLOUDFLARE_ACCOUNT_ID: 'test-account',
          R2_BUCKET_NAME: 'rundown-data-test',
          // Local mode keeps queries on the HTTP boundary the query-engine double owns.
          DATA_SOURCE_BASE_URL: 'http://query-engine.test/__dev-data',
          QUERY_DATA_SOURCE_BASE_URL: 'http://query-engine.test/__dev-data',
          APP_ENV: 'development',
          QUERY_CACHE_NAME: 'rundown-query-cache-test',
          CLERK_SECRET_KEY: 'sk_test_integration',
          INTERNAL_R2_SIGNING_SECRET: 'test-internal-r2-signing-secret',
          UPLOAD_SIGNING_SECRET: 'test-upload-signing-secret',
          RESET_ADMIN_TOKEN: 'test-reset-admin-token',
        },
      },
    }),
  ],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    // The service logs every request; keep that output for failures only.
    silent: 'passed-only',
  },
});
