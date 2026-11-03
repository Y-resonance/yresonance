import { expect, type Page } from '@playwright/test';
import type { ImageAsset } from '#/domain/image-assets';
import { test } from './support/ui-test';
import { mockYresonanceApi } from './support/yresonance-api';

// A 1000×2 PNG. The asset route mock serves it for every requested width.
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAA+gAAAACCAIAAABE9mHKAAAAJklEQVR42u3QMQ0AAAgDsElBGlKRho0dTaqgmT0AAKBcFAAAQL8HjrbEiKnb4K8AAAAASUVORK5CYII=',
  'base64',
);

const logo: ImageAsset = {
  id: 'asset_logo',
  name: 'client-logo.png',
  contentType: 'image/png',
  size: png.length,
  width: 1000,
  height: 500,
  createdAt: '2026-11-01T00:00:00.000Z',
};

async function mockAssetRoutes(page: Page, assets: ImageAsset[]) {
  const uploads: string[] = [];
  await page.route('**/api/dashboards/dash_demo/assets?*', async (route) => {
    const name = new URL(route.request().url()).searchParams.get('name')!;
    uploads.push(name);
    const asset = { ...logo, name };
    assets.push(asset);
    await route.fulfill({ status: 201, json: asset });
  });
  await page.route('**/api/dashboards/dash_demo/assets/*', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: png }),
  );
  return uploads;
}

test('an editor uploads an image and places it as a widget', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  const uploads = await mockAssetRoutes(page, state.assets);
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('button', { name: 'Add Image' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add image' });
  const file = dialog.getByLabel('Image file');

  await file.setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(dialog.getByText("SVG files aren't supported yet.", { exact: false })).toBeVisible();
  expect(uploads).toEqual([]);

  await file.setInputFiles({ name: 'client-logo.png', mimeType: 'image/png', buffer: png });
  await expect(dialog).toBeHidden();
  await expect
    .poll(() => state.dashboard.pages[0].widgets.at(-1)?.definition)
    .toEqual({ type: 'image', assetId: 'asset_logo', alt: 'client logo', fit: 'contain' });
  expect(uploads).toEqual(['client-logo.png']);
});

test('viewers get a responsive image that opens its link in a new tab', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'viewer' });
  state.assets.push(logo);
  state.dashboard.pages[0].widgets.push({
    id: 'w_logo',
    layout: { x: 8, y: 2, width: 4, height: 3 },
    definition: {
      type: 'image',
      assetId: logo.id,
      alt: 'Client logo',
      fit: 'contain',
      href: 'https://client.example/campaign',
    },
    definitionHash: 'hash_logo',
  });
  await mockAssetRoutes(page, state.assets);
  await page.goto('/dashboards/dash_demo');

  const image = page.getByRole('img', { name: 'Client logo' });
  await expect(image).toBeVisible();
  const url = '/api/dashboards/dash_demo/assets/asset_logo';
  await expect(image).toHaveAttribute(
    'srcset',
    `${url}?w=320 320w, ${url}?w=640 640w, ${url}?w=960 960w, ${url} 1000w`,
  );
  await expect(image).toHaveAttribute('sizes', /\* 4 \/ 12\)$/u);
  await expect(image).toHaveAttribute('width', '1000');
  const link = page.getByRole('link', { name: 'Client logo' });
  await expect(link).toHaveAttribute('href', 'https://client.example/campaign');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});
