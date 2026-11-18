import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { authUiAlias } from './src/platform/auth-ui-alias.ts';

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: [
      authUiAlias({
        config: fromRoot('./cloud/yresonance.config.ts'),
        adapters: fromRoot('./src/platform/adapters'),
      }),
    ],
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
