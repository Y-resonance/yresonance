import { expect, test, type Page, type Request } from '@playwright/test';
import { mockYresonanceApi } from './support/yresonance-api';

const queriedWithStart = (start: string) => (request: Request) =>
  request.url().endsWith('/api/yresonance') &&
  request.postDataJSON()?.action === 'queryWidget' &&
  request.postDataJSON().controlState?.dateRange?.startDate?.fixed === start;

async function openPicker(page: Page) {
  const dateRange = page.getByRole('button', { name: 'Choose date range' });
  await dateRange.click();
  return {
    dateRange,
    start: page.getByRole('region', { name: 'Start date' }),
    end: page.getByRole('region', { name: 'End date' }),
  };
}

test('a campaign range keeps ending yesterday instead of freezing on the picked day', async ({
  page,
}) => {
  await mockYresonanceApi(page, { role: 'viewer' });
  await page.goto('/dashboards/dash_demo');
  const { dateRange, start, end } = await openPicker(page);

  await end.getByLabel('End date type').selectOption('yesterday');
  await start.getByRole('button', { name: /August 3rd, 2026/u }).click();
  // Edits stay a draft until applied.
  await expect(page).not.toHaveURL(/dateRange=/u);

  const query = page.waitForRequest(queriedWithStart('2026-08-03'));
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/dateRange=2026-08-03\.\.yesterday/u);
  await expect(dateRange).toContainText('Aug 3, 2026 to yesterday');
  // The server resolves the end at query time, so it is sent as a relative date.
  expect((await query).postDataJSON().controlState.dateRange.endDate).toEqual({
    relative: { amount: 1, unit: 'day', direction: 'past', anchor: 'startOfDay' },
  });

  await page.reload();
  await expect(dateRange).toContainText('Aug 3, 2026 to yesterday');
});

test('switching a yesterday end to a fixed date pins the day it showed', async ({ page }) => {
  await mockYresonanceApi(page, { role: 'viewer' });
  await page.goto('/dashboards/dash_demo?dateRange=2026-08-03..yesterday');
  const { dateRange, end } = await openPicker(page);

  await end.getByLabel('End date type').selectOption('fixed');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(page).toHaveURL(/dateRange=2026-08-03\.\.\d{4}-\d{2}-\d{2}/u);
  await expect(dateRange).not.toContainText('yesterday');
});
