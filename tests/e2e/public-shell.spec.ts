import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from 'zod';

const environmentResponse = z.looseObject({
  user_settings: z.looseObject({
    sign_up: z.looseObject({ mode: z.enum(['public', 'restricted', 'waitlist']) }),
  }),
});

async function setAccessMode(page: Page, mode: 'public' | 'waitlist') {
  // Override only this browser's configuration. Never change the shared Clerk instance.
  await page.route('**/v1/environment*', async (route) => {
    const response = await route.fetch();
    const body = environmentResponse.parse(await response.json());
    body.user_settings.sign_up.mode = mode;
    await route.fulfill({ response, json: body });
  });
}

test.beforeEach(async ({ page }) => {
  await setAccessMode(page, 'public');
});

const opacityOf = (locator: Locator) =>
  locator.evaluate((element) => Number(getComputedStyle(element).opacity));

test('the signed-out product shell is usable', async ({ page }) => {
  await page.goto('/');

  await expect(
    page.getByRole('heading', {
      level: 1,
      name: /Build client reporting dashboards/,
    }),
  ).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(page.getByRole('main').getByRole('button', { name: 'Sign in' })).toBeVisible();
  await expect(
    page.getByRole('main').getByRole('button', { name: 'Create account' }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('contentinfo').getByRole('link', { name: 'Imprint and creator' }),
  ).toBeVisible();
});

test('the footer links to the imprint', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('contentinfo').getByRole('link', { name: 'Imprint and creator' }).click();

  await expect(page).toHaveURL('/imprint');
  await expect(page).toHaveTitle('Imprint and creator | yresonance');
  await expect(page.getByRole('heading', { level: 1, name: 'Imprint' })).toBeVisible();
  await expect(page.getByText('Patrik Simms', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'patriksimms@outlook.de' })).toHaveAttribute(
    'href',
    'mailto:patriksimms@outlook.de',
  );
});

test('waitlist access opens in place from the landing page', async ({ page }) => {
  await setAccessMode(page, 'waitlist');
  await page.goto('/?entry=waitlist');
  const initialUrl = page.url();

  await expect(page.getByRole('button', { name: 'Join waitlist', exact: true })).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Create account' })).toHaveCount(0);
  await expect(page.getByText(/Access is by invitation/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Get early access to yresonance.' })).toHaveCount(
    1,
  );
  await page.getByRole('main').getByRole('button', { name: 'Join waitlist' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('textbox', { name: 'Email address' })).toBeVisible();
  expect(page.url()).toBe(initialUrl);
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  expect(page.url()).toBe(initialUrl);
});

test('authentication opens in place and closing it preserves the URL', async ({ page }) => {
  await page.goto('/?entry=landing');
  const initialUrl = page.url();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean((window as Window & { Clerk?: { loaded?: boolean } }).Clerk?.loaded),
      ),
    )
    .toBe(true);

  await page.getByRole('main').getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(page.url()).toBe(initialUrl);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(page.url()).toBe(initialUrl);
});

test('the landing page serves both product screenshots', async ({ page }) => {
  await page.goto('/');

  for (const name of [/yresonance dashboard/, /yresonance datasource screen/]) {
    const screenshot = page.getByRole('img', { name });
    // Both load lazily, so each has to come near the viewport before it is fetched.
    await screenshot.scrollIntoViewIfNeeded();
    await expect
      .poll(() => screenshot.evaluate((image: HTMLImageElement) => image.naturalWidth))
      .toBeGreaterThan(0);
  }
});

test('sections below the fold reveal once they are scrolled into view', async ({ page }) => {
  await page.goto('/');

  const cta = page
    .locator('.reveal-on-scroll')
    .filter({ hasText: 'Point yresonance at a file you already have' });
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await expect.poll(() => opacityOf(cta)).toBeGreaterThan(0.95);
  await expect(cta.getByRole('button', { name: 'Create account' })).toBeVisible();
});

test('reduced motion renders every section without scrolling', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const opacities = await page
    .locator('.reveal-on-scroll')
    .evaluateAll((elements) =>
      elements.map((element) => Number(getComputedStyle(element).opacity)),
    );
  expect(opacities.length).toBeGreaterThan(0);
  expect(opacities.every((opacity) => opacity === 1)).toBe(true);
});

test('health and readiness retain distinct contracts', async ({ request }) => {
  const health = await request.get('/health');
  expect(health.ok()).toBe(true);
  await expect(health.json()).resolves.toMatchObject({ status: 'ok' });

  const readiness = await request.get('/ready');
  expect([200, 503]).toContain(readiness.status());
  await expect(readiness.json()).resolves.toHaveProperty('status');
});
