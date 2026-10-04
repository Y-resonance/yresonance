import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import posthog from '@posthog/rollup-plugin';
import { defineConfig } from 'vite';
import { fileDataPlugin } from './dev/file-data-plugin.ts';
import { queryEnginePlugin } from './dev/query-engine-plugin.ts';

// Browser tests run the dev server on their own port; the dev data service must follow it.
const devPort = resolveDevPort(process.env.YRESONANCE_PORT);
const devDataBaseUrl = `http://localhost:${devPort}/__dev-data`;
const enableDevContainers = process.env.YRESONANCE_ENABLE_CONTAINERS === '1';
const uploadPostHogSourceMaps = process.env.POSTHOG_UPLOAD_SOURCEMAPS === 'true';

if (uploadPostHogSourceMaps && (!process.env.POSTHOG_API_KEY || !process.env.POSTHOG_PROJECT_ID))
  throw new Error('PostHog source map upload requires POSTHOG_API_KEY and POSTHOG_PROJECT_ID.');

function resolveDevPort(value: string | undefined) {
  if (!value) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`YRESONANCE_PORT must be a port number, received "${value}".`);
  return port;
}

export default defineConfig(({ command, mode }) => ({
  build: {
    minify: 'oxc',
    sourcemap: uploadPostHogSourceMaps ? 'hidden' : false,
  },
  resolve: {
    tsconfigPaths: true,
    // UI tests replace Clerk at the module boundary. Never alias auth in a deployable build.
    ...(command === 'serve' && mode === 'e2e-ui'
      ? {
          alias: [
            {
              find: /^@clerk\/tanstack-react-start\/server$/,
              replacement: fileURLToPath(
                new URL('./tests/e2e/support/clerk-server.ts', import.meta.url),
              ),
            },
            {
              find: /^@clerk\/tanstack-react-start$/,
              replacement: fileURLToPath(
                new URL('./tests/e2e/support/clerk-ui.tsx', import.meta.url),
              ),
            },
          ],
        }
      : {}),
  },
  server: {
    port: devPort,
    strictPort: true,
    // Miniflare writes its D1/KV/trace SQLite state here on every start; not app source.
    watch: { ignored: ['**/.wrangler/**'] },
  },
  plugins: [
    fileDataPlugin(),
    queryEnginePlugin(),
    cloudflare({
      ...(process.env.YRESONANCE_PREVIEW_CONFIG
        ? { configPath: process.env.YRESONANCE_PREVIEW_CONFIG }
        : {}),
      viteEnvironment: { name: 'ssr' },
      config: (config) => ({
        dev: {
          ...config.dev,
          // Cloudflare images are amd64. DuckDB's native binding crashes when Docker emulates
          // that architecture on Apple Silicon, so local queries run in Vite instead. Linux CI
          // opts in to the real container and local R2 bindings.
          enable_containers: command !== 'serve' || enableDevContainers,
        },
        ...(command === 'serve'
          ? {
              vars: {
                APP_ENV: 'development',
                POSTHOG_ENABLED: process.env.POSTHOG_ENABLED ?? 'false',
                POSTHOG_PROJECT_TOKEN:
                  process.env.POSTHOG_PROJECT_TOKEN ?? config.vars?.POSTHOG_PROJECT_TOKEN,
                POSTHOG_HOST: process.env.POSTHOG_HOST ?? config.vars?.POSTHOG_HOST,
                QUERY_CACHE_NAME: 'yresonance-query-cache-development',
                ...(enableDevContainers
                  ? {
                      DATA_SOURCE_BASE_URL: 'r2://yresonance-data',
                      QUERY_DATA_SOURCE_BASE_URL: 'r2://yresonance-data',
                    }
                  : {
                      DATA_SOURCE_BASE_URL: devDataBaseUrl,
                      QUERY_DATA_SOURCE_BASE_URL: devDataBaseUrl,
                    }),
                INTERNAL_R2_SIGNING_SECRET:
                  process.env.INTERNAL_R2_SIGNING_SECRET ?? 'yresonance-local-internal-r2-only',
                UPLOAD_SIGNING_SECRET:
                  process.env.UPLOAD_SIGNING_SECRET ?? 'yresonance-local-upload-only',
                ...(process.env.RESET_ADMIN_TOKEN
                  ? { RESET_ADMIN_TOKEN: process.env.RESET_ADMIN_TOKEN }
                  : {}),
              },
            }
          : {}),
      }),
    }),
    tailwindcss(),
    tanstackStart(),
    viteReact({ compiler: true }),
    ...(command === 'build' && uploadPostHogSourceMaps
      ? [
          posthog({
            personalApiKey: process.env.POSTHOG_API_KEY!,
            projectId: process.env.POSTHOG_PROJECT_ID!,
            host: 'https://eu.posthog.com',
            sourcemaps: {
              enabled: true,
              deleteAfterUpload: true,
              releaseName: 'yresonance',
              releaseVersion: process.env.GITHUB_SHA,
            },
          }),
        ]
      : []),
  ],
}));
