import { cloudflare } from '@cloudflare/vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileDataPlugin } from './dev/file-data-plugin.ts';
import { queryEnginePlugin } from './dev/query-engine-plugin.ts';

// Browser tests run the dev server on their own port; the dev data service must follow it.
const devPort = resolveDevPort(process.env.RUNDOWN_PORT);
const devDataBaseUrl = `http://localhost:${devPort}/__dev-data`;
const enableDevContainers = process.env.RUNDOWN_ENABLE_CONTAINERS === '1';

function resolveDevPort(value: string | undefined) {
  if (!value) return 3000;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`RUNDOWN_PORT must be a port number, received "${value}".`);
  return port;
}

export default defineConfig(({ command }) => ({
  build: {
    minify: 'oxc',
  },
  resolve: {
    tsconfigPaths: true,
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
      ...(process.env.RUNDOWN_PR_CONFIG ? { configPath: process.env.RUNDOWN_PR_CONFIG } : {}),
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
                QUERY_CACHE_NAME: 'rundown-query-cache-development',
                ...(enableDevContainers
                  ? {
                      DATA_SOURCE_BASE_URL: 'r2://rundown-data',
                      QUERY_DATA_SOURCE_BASE_URL: 'r2://rundown-data',
                    }
                  : {
                      DATA_SOURCE_BASE_URL: devDataBaseUrl,
                      QUERY_DATA_SOURCE_BASE_URL: devDataBaseUrl,
                    }),
                INTERNAL_R2_SIGNING_SECRET:
                  process.env.INTERNAL_R2_SIGNING_SECRET ?? 'rundown-local-internal-r2-only',
                UPLOAD_SIGNING_SECRET:
                  process.env.UPLOAD_SIGNING_SECRET ?? 'rundown-local-upload-only',
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
  ],
}));
