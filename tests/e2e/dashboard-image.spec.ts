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

const placeholder = { type: 'image', fit: 'contain' };
const added = 'w_added_1';

async function addPlaceholder(page: Page) {
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  await page.getByRole('button', { name: 'Add widget' }).click();
  await page.getByRole('button', { name: 'Add Image' }).click();
  await expect(
    page.locator(`[data-widget-id="${added}"]`).getByText('Choose an image'),
  ).toBeVisible();
}

test('adding an image places a placeholder and the editor uploads its image in the inspector', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  const uploads = await mockAssetRoutes(page, state.assets);
  const stored = () => state.dashboard.pages[0].widgets.find((item) => item.id === added);
  await addPlaceholder(page);

  await expect(page.getByRole('dialog', { name: 'Add image' })).toBeHidden();
  expect(stored()?.definition).toEqual(placeholder);
  // Nothing to describe or link yet.
  await expect(page.getByLabel('Alt text')).toBeHidden();
  await expect(page.getByLabel('Link')).toBeHidden();

  const file = page.getByLabel('Image file');
  await file.setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg/>'),
  });
  await expect(page.getByText("SVG files aren't supported yet.", { exact: false })).toBeVisible();
  expect(uploads).toEqual([]);

  await file.setInputFiles({ name: 'client-logo.png', mimeType: 'image/png', buffer: png });
  await expect
    .poll(() => stored()?.definition)
    .toEqual({
      ...placeholder,
      assetId: 'asset_logo',
      alt: 'client logo',
    });
  await expect(page.getByAltText('client logo')).toBeVisible();
  await expect(page.getByLabel('Alt text')).toHaveValue('client logo');
  expect(uploads).toEqual(['client-logo.png']);
});

test('an editor picks a workspace image only after the widget saved it', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.assets.push(logo);
  await mockAssetRoutes(page, state.assets);
  const stored = () => state.dashboard.pages[0].widgets.find((item) => item.id === added);
  const imageRequests: boolean[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/asset_logo'))
      imageRequests.push(
        stored()?.definition.type === 'image' && 'assetId' in stored()!.definition,
      );
  });
  await addPlaceholder(page);

  await page.getByRole('button', { name: /client-logo\.png/u }).click();
  await expect(page.getByAltText('client logo')).toBeVisible();
  // The asset route refuses an image until the saved dashboard shows it.
  expect(imageRequests.length).toBeGreaterThan(0);
  expect(imageRequests).not.toContain(false);
});

test('a title typed during an upload survives it', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await mockAssetRoutes(page, state.assets);
  let finishUpload = () => {};
  const uploadHeld = new Promise<void>((resolve) => {
    finishUpload = resolve;
  });
  await page.route('**/api/dashboards/dash_demo/assets?*', async (route) => {
    await uploadHeld;
    await route.fallback();
  });
  const stored = () => state.dashboard.pages[0].widgets.find((item) => item.id === added);
  await addPlaceholder(page);

  await page
    .getByLabel('Image file')
    .setInputFiles({ name: 'client-logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  const title = page.getByLabel('Title', { exact: true });
  await title.fill('Our partner');
  await title.blur();
  await expect.poll(() => stored()?.definition).toMatchObject({ title: 'Our partner' });

  finishUpload();
  await expect
    .poll(() => stored()?.definition)
    .toMatchObject({ title: 'Our partner', assetId: 'asset_logo' });
});

test('a title is optional and clearing it removes it from the widget', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.assets.push(logo);
  state.dashboard.pages[0].widgets.push({
    id: 'w_logo',
    layout: { x: 8, y: 2, width: 4, height: 3 },
    definition: { type: 'image', assetId: logo.id, alt: 'Client logo', fit: 'contain' },
    definitionHash: 'hash_logo',
  });
  await mockAssetRoutes(page, state.assets);
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();
  const stored = () => state.dashboard.pages[0].widgets.find((item) => item.id === 'w_logo');
  const widget = page.locator('[data-widget-id="w_logo"]');

  await page.getByRole('button', { name: 'Edit Client logo' }).click();
  const title = page.getByLabel('Title', { exact: true });
  await title.fill('  Our partner ');
  await title.blur();
  await expect(widget.getByText('Our partner')).toBeVisible();
  await expect
    .poll(() => stored()?.definition)
    .toMatchObject({ title: 'Our partner', alt: 'Client logo' });

  await title.fill('');
  await title.blur();
  await expect(widget.getByText('Our partner')).toBeHidden();
  await expect.poll(() => JSON.stringify(stored()?.definition)).not.toContain('title');
});

test('viewers see a titled image but not a widget still waiting for its image', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page, { role: 'viewer' });
  state.assets.push(logo);
  state.dashboard.pages[0].widgets.push(
    {
      id: 'w_logo',
      layout: { x: 8, y: 2, width: 4, height: 3 },
      definition: {
        type: 'image',
        assetId: logo.id,
        alt: 'Client logo',
        fit: 'contain',
        title: 'Our partner',
      },
      definitionHash: 'hash_logo',
    },
    {
      id: 'w_empty',
      layout: { x: 8, y: 5, width: 4, height: 3 },
      definition: { type: 'image', fit: 'contain', title: 'Coming soon' },
      definitionHash: 'hash_empty',
    },
  );
  await mockAssetRoutes(page, state.assets);
  await page.goto('/dashboards/dash_demo');

  await expect(page.getByText('Our partner')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Client logo' })).toBeVisible();
  await expect(page.getByText('Coming soon')).toBeHidden();
  await expect(page.getByText('Choose an image')).toBeHidden();
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

test('an invalid link stays a draft and does not block other image settings', async ({ page }) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  state.assets.push(logo);
  state.dashboard.pages[0].widgets.push({
    id: 'w_logo',
    layout: { x: 8, y: 0, width: 4, height: 2 },
    definition: { type: 'image', assetId: logo.id, alt: 'Client logo', fit: 'contain' },
    definitionHash: 'hash_logo',
  });
  await mockAssetRoutes(page, state.assets);
  await page.goto('/dashboards/dash_demo');
  await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

  await page.getByRole('button', { name: 'Edit Client logo' }).click();
  const link = page.getByLabel('Link');
  await link.fill('http://client.example');
  await link.blur();
  await expect(page.getByText('Use an https:// link.')).toBeVisible();

  await page.getByLabel('Fit').selectOption('cover');
  const stored = () => state.dashboard.pages[0].widgets.find((item) => item.id === 'w_logo');
  await expect
    .poll(() => stored()?.definition)
    .toEqual({
      type: 'image',
      assetId: logo.id,
      alt: 'Client logo',
      fit: 'cover',
    });
});
