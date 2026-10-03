import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: { include: ['tests/clickhouse/**/*.test.ts'], testTimeout: 60_000, hookTimeout: 60_000 },
});
