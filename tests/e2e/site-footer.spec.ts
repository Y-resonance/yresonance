import { expect } from '@playwright/test';
import { test } from './support/ui-test';

// The UI suite's Clerk stub is always signed in, and / shows them dashboards, not the landing page.
test('signed-in visitors get no footer links to landing sections they cannot see', async ({
  page,
}) => {
  await page.goto('/imprint');
  const footer = page.getByRole('contentinfo');

  await expect(footer.getByRole('link', { name: 'Imprint', exact: true })).toBeVisible();
  await expect(footer.getByRole('navigation', { name: 'Product' })).toHaveCount(0);
});

for (const title of ['Privacy', 'Terms']) {
  test(`the footer reaches the ${title} placeholder, which stays out of search results`, async ({
    page,
  }) => {
    await page.goto('/imprint');
    await page.getByRole('contentinfo').getByRole('link', { name: title }).click();

    await expect(page).toHaveTitle(`${title} | yresonance`);
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');

    // Crawlers read the server's HTML, which the click above never requested.
    const served = await page.request.get(page.url());
    expect(served.ok()).toBe(true);
    expect(await served.text()).toMatch(/<meta name="robots" content="noindex"/);
  });
}

test('a tall imprint page rests the footer at the bottom without scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1400 });
  await page.goto('/imprint');
  await expect(page.getByRole('contentinfo')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
  );
  expect(overflow).toBe(0);
  const gapBelowFooter = await page
    .getByRole('contentinfo')
    .evaluate((footer) => window.innerHeight - footer.getBoundingClientRect().bottom);
  expect(gapBelowFooter).toBe(0);
});
