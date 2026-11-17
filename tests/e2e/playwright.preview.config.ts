import { defineConfig, devices } from '@playwright/test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const target = new URL(process.env.YRESONANCE_PREVIEW_URL ?? 'https://invalid.test');
if (
  target.protocol !== 'https:' ||
  !target.hostname.endsWith('-yresonance.rundown.workers.dev') ||
  target.username ||
  target.password ||
  target.port
)
  throw new Error('Preview smoke tests require a branch preview URL on rundown.workers.dev.');

export default defineConfig({
  testDir: '.',
  testMatch: 'preview-smoke.spec.ts',
  globalSetup: './global-setup.ts',
  workers: 1,
  retries: 0,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'line',
  outputDir: join(tmpdir(), 'yresonance-preview-smoke'),
  // Login artifacts can contain credentials; keep traces, screenshots and video disabled.
  use: {
    ...devices['Desktop Chrome'],
    baseURL: target.origin,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [{ name: 'authenticated' }],
});
