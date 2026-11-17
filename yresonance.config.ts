import { defineConfig } from './src/platform/config';
import { hyperdrive } from './src/platform/adapters/hyperdrive';
import { r2 } from './src/platform/adapters/r2';
import { workersKV } from './src/platform/adapters/workers-kv';
import { cloudflareImages } from './src/platform/adapters/cloudflare-images';
import { analyticsEngine } from './src/platform/adapters/analytics-engine';
import { clerk } from './src/platform/adapters/clerk';
import { currentDatasources } from './src/platform/adapters/datasources';
import { duckdb } from './src/platform/adapters/duckdb';
import { workersBackground } from './src/platform/adapters/workers-background';

export default defineConfig({
  database: hyperdrive(),
  storage: r2(),
  cache: workersKV(),
  images: cloudflareImages(),
  productAnalytics: analyticsEngine(),
  auth: clerk(),
  datasources: currentDatasources(),
  queryEngine: duckdb(),
  background: workersBackground(),
});
