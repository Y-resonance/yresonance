import { env } from 'cloudflare:workers';
import { describe, expect, test } from 'vitest';
import { Route as uploadRoute } from '#/routes/api.dashboards.$dashboardId.assets';
import { Route as assetRoute } from '#/routes/api.dashboards.$dashboardId.assets.$assetId';
import type { ImageAsset } from '#/domain/image-assets';
import type { DashboardDocument } from '#/domain/schema';
import { setClerkDirectory, signOut } from './doubles/clerk';
import {
  addWidget,
  callService,
  createDashboard,
  expectApiError,
  newUserId,
  signInAsOwner,
  signInAsUser,
  signInToNewWorkspace,
  type TestWorkspace,
} from './fixtures';

// A real 1000×2 PNG, small enough to inline, wide enough for the 320/640/960 variants.
const png = Uint8Array.from(
  atob(
    'iVBORw0KGgoAAAANSUhEUgAAA+gAAAACCAIAAABE9mHKAAAAJklEQVR42u3QMQ0AAAgDsElBGlKRho0dTaqgmT0AAKBcFAAAQL8HjrbEiKnb4K8AAAAASUVORK5CYII=',
  ),
  (character) => character.charCodeAt(0),
);

function handler<T extends 'GET' | 'PUT'>(route: { options: { server?: unknown } }, method: T) {
  const handlers = (route.options.server as { handlers: Record<string, unknown> }).handlers;
  return handlers[method] as (context: {
    request: Request;
    params: Record<string, string>;
  }) => Promise<Response>;
}

function upload(
  dashboardId: string,
  body: Uint8Array<ArrayBuffer> | string,
  headers: Record<string, string> = {},
) {
  const length = typeof body === 'string' ? new TextEncoder().encode(body).length : body.length;
  headers = { 'content-length': String(length), ...headers };
  return handler(
    uploadRoute,
    'PUT',
  )({
    request: new Request(
      `https://yresonance.test/api/dashboards/${dashboardId}/assets?name=logo.png`,
      {
        method: 'PUT',
        headers,
        body,
      },
    ),
    params: { dashboardId },
  });
}

function fetchAsset(
  dashboardId: string,
  assetId: string,
  query = '',
  accept = 'image/webp,image/*',
) {
  return handler(
    assetRoute,
    'GET',
  )({
    request: new Request(
      `https://yresonance.test/api/dashboards/${dashboardId}/assets/${assetId}${query}`,
      { headers: { accept } },
    ),
    params: { dashboardId, assetId },
  });
}

async function storedKeys(workspace: TestWorkspace) {
  const listing = await env.DATA.list({ prefix: `${workspace.r2Prefix}assets/` });
  return listing.objects.map((object) => object.key.slice(workspace.r2Prefix.length));
}

async function dashboardWithImage() {
  const workspace = await signInToNewWorkspace();
  const dashboard = await createDashboard();
  const response = await upload(dashboard.id, png);
  expect(response.status).toBe(201);
  const asset = (await response.json()) as ImageAsset;
  await addWidget(dashboard.id, {
    type: 'image',
    assetId: asset.id,
    alt: 'Client logo',
    fit: 'contain',
  });
  return { workspace, dashboard, asset };
}

describe('dashboard image upload', () => {
  test('stores a real image with its measured size and offers it to editors and agents', async () => {
    const { workspace, dashboard, asset } = await dashboardWithImage();

    expect(asset).toMatchObject({
      name: 'logo.png',
      contentType: 'image/png',
      width: 1000,
      height: 2,
    });
    expect(await storedKeys(workspace)).toEqual([`assets/${asset.id}/original`]);
    expect(await callService({ action: 'listAssets', dashboardId: dashboard.id })).toEqual({
      assets: [asset],
      uploadLimitBytes: 20_000_000,
    });
    const opened = (await callService({ action: 'getDashboard', dashboardId: dashboard.id })) as {
      assets: ImageAsset[];
    };
    expect(opened.assets).toEqual([asset]);
  });

  test('rejects SVG and oversized files without storing anything', async () => {
    const workspace = await signInToNewWorkspace();
    const dashboard = await createDashboard();

    const svg = await upload(dashboard.id, '<svg xmlns="http://www.w3.org/2000/svg"/>');
    expect(svg.status).toBe(415);
    expect(await svg.json()).toMatchObject({ error: expect.stringContaining('SVG files') });
    const tooLarge = await upload(dashboard.id, png, { 'content-length': '20000001' });
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toMatchObject({ error: 'Images can be at most 20 MB.' });

    expect(await storedKeys(workspace)).toEqual([]);
    expect(await callService({ action: 'listAssets', dashboardId: dashboard.id })).toMatchObject({
      assets: [],
    });
  });

  test('only accepts images from the dashboard workspace', async () => {
    const { asset } = await dashboardWithImage();
    await signInToNewWorkspace();
    const other = await createDashboard();

    await expectApiError(
      addWidget(other.id, { type: 'image', assetId: asset.id, alt: 'Logo', fit: 'contain' }),
      { status: 400, code: 'unknown_asset' },
    );
  });

  test('keeps a placeholder without an image next to a real one', async () => {
    const { dashboard, asset } = await dashboardWithImage();
    await addWidget(dashboard.id, { type: 'image', fit: 'contain', title: 'Coming soon' });

    const opened = (await callService({ action: 'getDashboard', dashboardId: dashboard.id })) as {
      assets: ImageAsset[];
    };
    expect(opened.assets).toEqual([asset]);
    expect((await fetchAsset(dashboard.id, asset.id)).status).toBe(200);
  });
});

describe('dashboard image serving', () => {
  test('creates an allowed variant once, then serves it from storage', async () => {
    const { workspace, dashboard, asset } = await dashboardWithImage();

    const first = await fetchAsset(dashboard.id, asset.id, '?w=640');
    expect(first.status).toBe(200);
    expect(first.headers.get('content-type')).toBe('image/webp');
    expect(first.headers.get('cache-control')).toBe('private, max-age=31536000, immutable');
    expect(first.headers.get('vary')).toBe('Accept');
    const created = new Uint8Array(await first.arrayBuffer());
    expect(await storedKeys(workspace)).toContain(`assets/${asset.id}/w640.webp`);

    const second = await fetchAsset(dashboard.id, asset.id, '?w=640');
    expect(new Uint8Array(await second.arrayBuffer())).toEqual(created);
  });

  test('serves the original without a new variant for other widths', async () => {
    const { workspace, dashboard, asset } = await dashboardWithImage();

    for (const query of ['?w=500', '?w=1280', '']) {
      const response = await fetchAsset(dashboard.id, asset.id, query);
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(new Uint8Array(await response.arrayBuffer())).toEqual(png);
    }
    expect(await storedKeys(workspace)).toEqual([`assets/${asset.id}/original`]);
  });

  test('falls back to the original and stores nothing when a transform fails', async () => {
    const { workspace, dashboard, asset } = await dashboardWithImage();
    const bindings = env as unknown as Record<string, unknown>;
    const images = bindings.IMAGES;
    bindings.IMAGES = {
      input: () => {
        throw Object.assign(new Error('Quota exceeded'), { code: 9422 });
      },
    };
    try {
      const response = await fetchAsset(dashboard.id, asset.id, '?w=640');
      expect(response.headers.get('content-type')).toBe('image/png');
      expect(response.headers.get('cache-control')).toBe('private, max-age=300');
    } finally {
      bindings.IMAGES = images;
    }
    expect(await storedKeys(workspace)).toEqual([`assets/${asset.id}/original`]);
  });

  test('follows dashboard access for viewers, share links, removed collaborators and copies', async () => {
    const { workspace, dashboard, asset } = await dashboardWithImage();
    const viewerId = newUserId();
    setClerkDirectory([{ id: viewerId, emailAddress: 'viewer@example.com' }]);
    await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'grant', userEmail: 'viewer@example.com', role: 'viewer' },
    });
    const link = (await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'createLink' },
    })) as { token: string };
    const copy = (await callService({
      action: 'duplicateDashboard',
      dashboardId: dashboard.id,
      name: 'Copy',
    })) as DashboardDocument;
    expect((await fetchAsset(copy.id, asset.id, '?w=320')).status).toBe(200);

    signInAsUser(workspace, viewerId);
    expect((await fetchAsset(dashboard.id, asset.id)).status).toBe(200);
    signOut();
    expect((await fetchAsset(dashboard.id, asset.id, `?share=${link.token}`)).status).toBe(200);
    expect((await fetchAsset(dashboard.id, asset.id)).status).toBe(401);

    signInAsOwner(workspace);
    await callService({
      action: 'shareDashboard',
      dashboardId: dashboard.id,
      operation: { kind: 'revoke', userId: viewerId },
    });
    signInAsUser(workspace, viewerId);
    expect((await fetchAsset(dashboard.id, asset.id)).status).toBe(403);

    // Another dashboard in the same workspace cannot be used to reach an image it does not show.
    signInAsOwner(workspace);
    const unrelated = await createDashboard();
    expect((await fetchAsset(unrelated.id, asset.id)).status).toBe(404);
  });
});
