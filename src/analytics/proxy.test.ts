import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { proxyAnalyticsRequest } from './proxy.server';

const env = vi.hoisted(() => ({
  POSTHOG_ENABLED: 'true',
  POSTHOG_HOST: 'https://eu.i.posthog.com',
}));
vi.mock('cloudflare:workers', () => ({ env }));

beforeEach(() => {
  env.POSTHOG_ENABLED = 'true';
  env.POSTHOG_HOST = 'https://eu.i.posthog.com';
});
afterEach(() => vi.unstubAllGlobals());

describe('PostHog proxy', () => {
  it.each([
    ['/static/exception-autocapture.js?v=1', 'eu-assets.i.posthog.com', 'https://eu.i.posthog.com'],
    ['/array/phc_test/config?ip=0', 'eu-assets.i.posthog.com', 'https://eu.i.posthog.com'],
    ['/e/?compression=gzip-js', 'eu.i.posthog.com', 'https://eu.i.posthog.com'],
    ['/flags/?v=2', 'eu.i.posthog.com', 'https://eu.i.posthog.com'],
    ['/i/v1/logs?token=phc_test', 'eu.i.posthog.com', 'https://eu.i.posthog.com'],
    ['/array/phc_test/config', 'us-assets.i.posthog.com', 'https://us.i.posthog.com'],
    ['/static/exception-autocapture.js', 'us-assets.i.posthog.com', 'https://us.i.posthog.com'],
    ['/array/phc_test/config', 'analytics.example.com', 'https://analytics.example.com'],
  ])(
    'routes %s to the correct origin and preserves response headers',
    async (path, host, ingestionHost) => {
      env.POSTHOG_HOST = ingestionHost;
      const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
        new Response('upstream body', {
          status: 202,
          headers: { 'Cache-Control': 'public, max-age=300', 'Content-Type': 'application/json' },
        }),
      );
      vi.stubGlobal('fetch', fetchMock);

      const response = await proxyAnalyticsRequest(
        new Request(`https://yresonance.com/ingest${path}`),
      );
      const upstream = fetchMock.mock.calls[0][0];
      expect(upstream).toBeInstanceOf(Request);
      if (!(upstream instanceof Request)) throw new Error('Expected an upstream request.');
      expect(upstream.url).toBe(`https://${host}${path}`);
      expect(upstream.headers.get('host')).toBe(host);
      expect(response?.status).toBe(202);
      expect(response?.headers.get('cache-control')).toBe('public, max-age=300');
      await expect(response?.text()).resolves.toBe('upstream body');
    },
  );

  it('preserves binary POST payloads and trusted client IP without leaking app credentials', async () => {
    const payload = new Uint8Array([31, 139, 8, 0, 255, 128, 1]);
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: { 'Set-Cookie': 'third_party_cookie=secret' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxyAnalyticsRequest(
      new Request('https://yresonance.com/ingest/e/?ip=1', {
        method: 'POST',
        body: payload,
        headers: {
          Cookie: '__session=private-session',
          Authorization: 'Bearer private-token',
          Referer: 'https://yresonance.com/share/private-capability',
          'CF-Connecting-IP': '203.0.113.7',
          'X-Forwarded-For': 'forged-ip',
          'Content-Type': 'application/octet-stream',
        },
      }),
    );
    const upstream = fetchMock.mock.calls[0][0];
    if (!(upstream instanceof Request)) throw new Error('Expected an upstream request.');
    expect(upstream.method).toBe('POST');
    expect(new Uint8Array(await upstream.arrayBuffer())).toEqual(payload);
    expect(upstream.headers.get('content-type')).toBe('application/octet-stream');
    expect(upstream.headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(upstream.headers.has('cookie')).toBe(false);
    expect(upstream.headers.has('authorization')).toBe(false);
    expect(upstream.headers.has('referer')).toBe(false);
    expect(response?.headers.has('set-cookie')).toBe(false);
  });

  it('cannot use a double-slash path to proxy another host', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null));
    vi.stubGlobal('fetch', fetchMock);
    await proxyAnalyticsRequest(
      new Request('https://yresonance.com/ingest//attacker.example/path'),
    );
    const upstream = fetchMock.mock.calls[0][0];
    if (!(upstream instanceof Request)) throw new Error('Expected an upstream request.');
    expect(new URL(upstream.url).origin).toBe('https://eu.i.posthog.com');
  });

  it('leaves normal routes to the app and refuses proxy traffic when tracking is disabled', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);
    expect(proxyAnalyticsRequest(new Request('https://yresonance.com/ingestion'))).toBeUndefined();
    env.POSTHOG_ENABLED = 'false';
    expect(
      (await proxyAnalyticsRequest(new Request('https://yresonance.com/ingest/e/')))?.status,
    ).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns an uncacheable gateway error when the upstream is unavailable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockRejectedValue(new Error('network unavailable')),
    );
    const response = await proxyAnalyticsRequest(new Request('https://yresonance.com/ingest/e/'));
    expect(response?.status).toBe(502);
    expect(response?.headers.get('cache-control')).toBe('no-store');
  });
});
