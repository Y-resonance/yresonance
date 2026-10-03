import { defineConfig, devices } from '@playwright/test';
import clerkConfig from './playwright.config';

const desktopOnly = [
  '**/builder-keyboard.spec.ts',
  '**/builder-selection.spec.ts',
  '**/builder-formula.spec.ts',
];
const mobileOnly = '**/builder-rows-mobile.spec.ts';
const clerkTests = ['**/authenticated-*.spec.ts', '**/public-shell.spec.ts'];

export default defineConfig({
  ...clerkConfig,
  workers: 2,
  projects: [
    {
      name: 'desktop-ui',
      testIgnore: [...clerkTests, mobileOnly],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-ui',
      testIgnore: [...clerkTests, ...desktopOnly],
      use: { ...devices['Pixel 7'] },
    },
  ],
  webServer: {
    command: 'bun run dev --mode e2e-ui',
    url: clerkConfig.use?.baseURL + '/health',
    reuseExistingServer: false,
    timeout: 120_000,
    // Mocked API tests do not need query containers or a pre-existing server.
    env: {
      YRESONANCE_PORT: process.env.YRESONANCE_E2E_PORT ?? '3140',
      YRESONANCE_ENABLE_CONTAINERS: '0',
    },
  },
});
