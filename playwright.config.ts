import { defineConfig, devices } from '@playwright/test';

const port = resolvePort(process.env.YRESONANCE_E2E_PORT);
const baseURL = `http://localhost:${port}`;
// Attaching to whatever already listens on the port has produced runs against a stale build,
// so reuse is opt-in even locally.
const reuseExistingServer = process.env.YRESONANCE_E2E_REUSE_SERVER === '1';
const enableQueryContainers = Boolean(process.env.CI);

function resolvePort(value: string | undefined) {
  if (!value) return 3140;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535)
    throw new Error(`YRESONANCE_E2E_PORT must be a port number, received "${value}".`);
  return parsed;
}

const authenticatedTests = '**/authenticated-*.spec.ts';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  // Every worker shares one dev server and one Clerk development instance, and Clerk development
  // instances rate-limit hard: above two workers the app stalls before Clerk reports as loaded.
  workers: 2,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'line',
  expect: { timeout: 15_000 },
  globalSetup: './tests/e2e/global-setup.ts',
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop',
      testIgnore: authenticatedTests,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile',
      testIgnore: authenticatedTests,
      use: { ...devices['Pixel 7'] },
    },
    {
      name: 'authenticated',
      testMatch: authenticatedTests,
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `${enableQueryContainers ? 'YRESONANCE_ENABLE_CONTAINERS=1 ' : ''}bun run dev`,
    url: `${baseURL}/health`,
    reuseExistingServer,
    timeout: 120_000,
    // Vite reads the port from here and points the dev data service at the same origin.
    env: { YRESONANCE_PORT: String(port) },
  },
});
