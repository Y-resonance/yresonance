import { defineConfig } from 'vitest/config';
import { authUiAlias } from './dev/auth-ui.ts';

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [authUiAlias()],
  },
  test: {
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx',
      'container/**/*.test.ts',
      'scripts/**/*.test.ts',
      'cloud/scripts/**/*.test.ts',
    ],
  },
});
