import { expect } from '@playwright/test';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

test('collaborator groups show three avatars and open the complete list in both places', async ({
  page,
  isMobile,
}) => {
  const state = await mockYresonanceApi(page);
  const collaborators = Array.from({ length: 6 }, (_, index) => ({
    clerkUserId: `user_${index}`,
    displayName: `Person ${index + 1}`,
    userEmail: `person${index + 1}@example.com`,
    role: 'editor',
    grantedAt: '2026-08-01',
  }));
  await page.route('**/api/yresonance', async (route) => {
    const request = route.request().postDataJSON();
    if (request.action === 'bootstrap')
      return route.fulfill({
        json: {
          ok: true,
          data: {
            workspace: { id: 'ws_demo', name: 'Demo workspace' },
            isAdmin: true,
            dashboards: [{ ...state.dashboard, canEdit: true, dataSourceIds: [], collaborators }],
            dataSources: [],
          },
        },
      });
    if (request.action === 'getDashboard')
      return route.fulfill({
        json: {
          ok: true,
          data: {
            dashboard: state.dashboard,
            role: 'editor',
            dataSources: [],
            sharing: { links: [], grants: collaborators },
          },
        },
      });
    return route.fallback();
  });
  await page.goto('/');
  const group = page.getByRole('button', { name: 'Show 6 collaborators' });
  await expect(group.locator('[data-slot="avatar"]')).toHaveCount(3);
  await expect(group).toContainText('+3');
  if (isMobile) await group.tap();
  else await group.hover();
  const list = page.getByRole('list', { name: 'Collaborators' });
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await expect(list).toContainText('person6@example.com');
  await page.keyboard.press('Escape');
  await page.getByRole('link', { name: 'Client weekly', exact: true }).click();
  await expect(page.getByRole('cell', { name: 'Spring sale' })).toBeVisible();
  await page.getByRole('button', { name: 'Share', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Share dashboard' });
  const modalGroup = modal.getByRole('button', { name: 'Show 6 collaborators' });
  await expect(modalGroup.locator('[data-slot="avatar"]')).toHaveCount(3);
  if (isMobile) await modalGroup.tap();
  else await modalGroup.hover();
  await expect(list.getByRole('listitem')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();
});
