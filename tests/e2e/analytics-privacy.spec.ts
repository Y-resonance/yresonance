import { expect } from '@playwright/test';
import { gunzipSync } from 'node:zlib';
import { readFile } from 'node:fs/promises';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('browser telemetry keeps share credentials and report names private', async ({ page }) => {
  const captures: Array<{ path: string; body: string }> = [];
  await page.addInitScript(() => {
    performance.setResourceTimingBufferSize(2000);
    const userAgent = navigator.userAgent.replace('HeadlessChrome', 'Chrome');
    Object.defineProperty(navigator, 'userAgent', { get: () => userAgent });
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'userAgentData', { get: () => undefined });
  });
  await page.route('**/ingest/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.includes('/static/')) {
      const filename = url.pathname.split('/').at(-1);
      return route.fulfill({
        contentType: 'application/javascript',
        body: await readFile(`node_modules/posthog-js/dist/${filename}`, 'utf8'),
      });
    }
    if (request.method() === 'POST') {
      const bytes = request.postDataBuffer() ?? Buffer.alloc(0);
      const body =
        bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString() : bytes.toString();
      const data = new URLSearchParams(body).get('data');
      captures.push({
        path: url.pathname,
        body: data ? Buffer.from(data, 'base64').toString() : body,
      });
    }
    await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await mockYresonanceApi(page);
  await page.goto('/dashboards/dash_demo');
  await expect(page).toHaveTitle('Client weekly | yresonance');
  await page.evaluate(async () => {
    history.replaceState(null, '', '/share/private-capability?__clerk_ticket=private-ticket');
    document.title = 'Confidential client report';
    const modulePath = '/src/analytics/browser.ts';
    const { initializeBrowserAnalytics } = (await import(
      modulePath
    )) as typeof import('../../src/analytics/browser');
    const client = initializeBrowserAnalytics({
      token: 'phc_test',
      host: '/ingest',
      environment: 'test',
    });
    client.set_config({
      request_batching: false,
      disable_compression: true,
      logs: { ...client.config.logs, flushIntervalMs: 10, maxBufferSize: 1 },
    });
    client.identify('user_test');
    client.capture('$pageview');
    client.logger.warn('api_request_failed', { action: 'getSharedDashboard', status: 500 });
    client.reloadFeatureFlags();
  });
  await expect
    .poll(() => captures.some(({ body }) => body.includes('"event":"$pageview"')))
    .toBe(true);
  await expect
    .poll(() => captures.some(({ body }) => body.includes('api_request_failed')))
    .toBe(true);
  await page.waitForFunction(() =>
    ['exception-autocapture.js', 'web-vitals-with-attribution.js'].every((asset) =>
      performance.getEntriesByType('resource').some(({ name }) => name.includes(asset)),
    ),
  );
  await page.evaluate(() => {
    setTimeout(() => {
      throw new Error('Synthetic tracking failure');
    }, 0);
  });
  await expect
    .poll(() => captures.some(({ body }) => body.includes('"event":"$exception"')))
    .toBe(true);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => captures.some(({ body }) => body.includes('"event":"$web_vitals"')))
    .toBe(true);
  const payload = JSON.stringify(captures);
  expect.soft(payload).not.toContain('private-capability');
  expect.soft(payload).not.toContain('private-ticket');
  expect.soft(payload).not.toContain('Confidential client report');
  expect.soft(captures.filter(({ path }) => path.includes('/flags/'))).toHaveLength(0);
});
