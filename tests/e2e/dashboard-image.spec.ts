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

// Keeps uploads running until the returned function is called.
async function holdUploads(page: Page) {
  let finish = () => {};
  const held = new Promise<void>((resolve) => {
    finish = resolve;
  });
  await page.route('**/api/dashboards/dash_demo/assets?*', async (route) => {
    await held;
    await route.fallback();
  });
  return finish;
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
  const finishUpload = await holdUploads(page);
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

test('a title still being typed when an upload finishes is saved with the image', async ({
  page,
}) => {
  const state = await mockYresonanceApi(page, { role: 'editor' });
  await mockAssetRoutes(page, state.assets);
  const finishUpload = await holdUploads(page);
  const stored = () => state.dashboard.pages[0].widgets.find((item) => item.id === added);
  await addPlaceholder(page);

  await page
    .getByLabel('Image file')
    .setInputFiles({ name: 'client-logo.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
  await page.getByLabel('Title', { exact: true }).fill('Our partner');

  // Saving disables the inspector, so the field loses focus without a blur event.
  finishUpload();
  await expect
    .poll(() => stored()?.definition)
    .toMatchObject({ title: 'Our partner', assetId: 'asset_logo' });
});

for (const { field, draft, saved } of [
  { field: 'Alt text', draft: 'New alt', saved: { alt: 'New alt' } },
  { field: 'Link', draft: 'https://new.example/', saved: { href: 'https://new.example/' } },
  { field: 'Link', draft: 'http://new.example/', saved: {} },
]) {
  test(`a replacement upload finishing during the typing of ${draft} saves valid drafts`, async ({
    page,
  }) => {
    const state = await mockYresonanceApi(page, { role: 'editor' });
    const old = { ...logo, id: 'asset_old', name: 'old.png' };
    state.assets.push(old);
    state.dashboard.pages[0].widgets.push({
      id: 'w_logo',
      layout: { x: 8, y: 2, width: 4, height: 3 },
      definition: {
        type: 'image',
        assetId: old.id,
        alt: 'Old alt',
        fit: 'contain',
        href: 'https://old.example/',
      },
      definitionHash: 'hash_logo',
    });
    await mockAssetRoutes(page, state.assets);
    const finishUpload = await holdUploads(page);
    await page.goto('/dashboards/dash_demo');
    await expect(page.getByRole('status', { name: 'Changes saved' })).toBeVisible();

    await page.getByRole('button', { name: 'Edit Old alt' }).click();
    await page
      .getByLabel('Image file')
      .setInputFiles({ name: 'client-logo.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByRole('button', { name: 'Cancel' })).toBeVisible();
    await page.getByLabel(field).fill(draft);

    finishUpload();
    await expect
      .poll(() => state.dashboard.pages[0].widgets.find((item) => item.id === 'w_logo')?.definition)
      .toEqual({
        type: 'image',
        assetId: 'asset_logo',
        alt: 'Old alt',
        fit: 'contain',
        href: 'https://old.example/',
        ...saved,
      });
  });
}

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
