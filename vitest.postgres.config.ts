import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ['tests/postgres/**/*.test.ts'],
    globalSetup: ['./tests/integration/global-setup.ts'],
  },
});
