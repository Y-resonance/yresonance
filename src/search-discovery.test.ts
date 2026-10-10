import { expect, test } from 'vitest';
import { searchDiscoveryResponse } from './search-discovery';

test('Googlebot can discover public pages without exposing unlisted reports', async () => {
  const robots = searchDiscoveryResponse(
    new Request('https://yresonance.com/robots.txt', {
      headers: { 'User-Agent': 'Googlebot' },
    }),
    'production',
  )!;
  expect(robots.status).toBe(200);
  const policy = await robots.text();
  expect(policy).toContain('Allow: /\n');
  const sitemapUrl = policy.match(/^Sitemap: (.+)$/m)?.[1];
  expect(sitemapUrl).toBe('https://yresonance.com/sitemap.xml');
  const sitemap = searchDiscoveryResponse(new Request(sitemapUrl!), 'production')!;
  expect(sitemap.status).toBe(200);
  expect(sitemap.headers.get('Content-Type')).toContain('application/xml');
  const xml = await sitemap.text();
  expect([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1])).toEqual([
    'https://yresonance.com/',
    'https://yresonance.com/imprint',
  ]);
});

test('preview builds and alternate hosts do not advertise themselves for indexing', async () => {
  for (const [origin, environment] of [
    ['https://branch.example', 'preview'],
    ['https://yresonance.com', 'preview'],
    ['https://worker.workers.dev', 'production'],
  ] as const) {
    const robots = searchDiscoveryResponse(new Request(`${origin}/robots.txt`), environment)!;
    expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
    const sitemap = searchDiscoveryResponse(new Request(`${origin}/sitemap.xml`), environment)!;
    expect(await sitemap.text()).not.toContain('<loc>');
  }
});

test('public URL variants redirect once to HTTPS without losing campaign attribution', () => {
  const response = searchDiscoveryResponse(
    new Request('http://yresonance.com/imprint/?utm_source=link'),
    'production',
  )!;
  expect(response.status).toBe(308);
  expect(response.headers.get('Location')).toBe('https://yresonance.com/imprint?utm_source=link');
  expect(
    searchDiscoveryResponse(new Request(response.headers.get('Location')!), 'production'),
  ).toBeUndefined();
  expect(
    searchDiscoveryResponse(new Request('http://localhost:3000/imprint/'), 'development'),
  ).toBeUndefined();
});

test('discovery endpoints support HEAD and reject writes', async () => {
  const url = 'https://yresonance.com/sitemap.xml';
  const head = searchDiscoveryResponse(new Request(url, { method: 'HEAD' }), 'production')!;
  expect(head.status).toBe(200);
  expect(await head.text()).toBe('');
  const post = searchDiscoveryResponse(new Request(url, { method: 'POST' }), 'production')!;
  expect(post.status).toBe(405);
  expect(post.headers.get('Allow')).toBe('GET, HEAD');
});
