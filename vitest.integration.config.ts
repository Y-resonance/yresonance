import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      // The suite drives the real service; only the auth adapter is replaced.
      {
        find: /^.*\/platform\/adapters\/clerk$/,
        replacement: fromRoot('./tests/integration/doubles/auth.ts'),
      },
      {
        find: '@cloudflare/containers',
        replacement: fromRoot('./tests/integration/doubles/containers.ts'),
      },
    ],
  },
  plugins: [
    cloudflareTest({
      miniflare: {
        // Date and flags match cloud/wrangler.jsonc.
        compatibilityDate: '2026-08-29',
        compatibilityFlags: ['nodejs_compat', 'enable_request_signal'],
        hyperdrives: {
          HYPERDRIVE:
            process.env.TEST_DATABASE_URL ??
            'postgres://yresonance:yresonance@localhost:5432/yresonance_test',
        },
        kvNamespaces: ['QUERY_CACHE'],
        r2Buckets: ['DATA'],
        images: { binding: 'IMAGES' },
        bindings: {
          CLOUDFLARE_ACCOUNT_ID: 'test-account',
          R2_BUCKET_NAME: 'yresonance-data-test',
          // Local mode keeps queries on the HTTP boundary the query-engine double owns.
          DATA_SOURCE_BASE_URL: 'http://query-engine.test/__dev-data',
          QUERY_DATA_SOURCE_BASE_URL: 'http://query-engine.test/__dev-data',
          APP_ENV: 'development',
          CLICKHOUSE_DATABASE: 'yresonance_development',
          QUERY_CACHE_NAME: 'yresonance-query-cache-test',
          INTERNAL_R2_SIGNING_SECRET: 'test-internal-r2-signing-secret',
          UPLOAD_SIGNING_SECRET: 'test-upload-signing-secret',
          RESET_ADMIN_TOKEN: 'test-reset-admin-token',
          GOOGLE_OAUTH_CLIENT_ID: 'test-google-client',
          GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-secret',
          GOOGLE_OAUTH_REDIRECT_URI: 'https://yresonance.test/api/oauth/google/callback',
          GOOGLE_OAUTH_HOSTED_DOMAIN: 'example.test',
          OIDC_ISSUER_URL: 'https://id.example.test/realms/acme',
          OIDC_CLIENT_ID: 'test-oidc-client',
          OIDC_CLIENT_SECRET: 'test-oidc-client-secret',
          OIDC_SESSION_SECRET: 'test-oidc-session-secret',
        },
      },
    }),
  ],
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globalSetup: ['./tests/integration/global-setup.ts'],
    setupFiles: ['./tests/integration/setup.ts'],
    // The service logs every request; keep that output for failures only.
    silent: 'passed-only',
  },
});
