import { publicPages, siteUrl } from './lib/seo';

// Keep unlisted shares and workspace URLs out of public discovery. Preview builds
// do not advertise production URLs or invite crawlers to index a test environment.
export function searchDiscoveryResponse(request: Request, appEnv: string) {
  const url = new URL(request.url);
  const production = appEnv === 'production' && url.hostname === new URL(siteUrl).hostname;
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (production && path in publicPages && (url.protocol !== 'https:' || url.pathname !== path)) {
    return Response.redirect(`${siteUrl}${path}${url.search}`, 308);
  }
  if (url.pathname !== '/robots.txt' && url.pathname !== '/sitemap.xml') return;
  const headers = {
    'Content-Type':
      url.pathname === '/robots.txt'
        ? 'text/plain; charset=utf-8'
        : 'application/xml; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  };
  const body =
    url.pathname === '/robots.txt'
      ? production
        ? `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /ingest/\n\nSitemap: ${siteUrl}/sitemap.xml\n`
        : 'User-agent: *\nDisallow: /\n'
      : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${
          production
            ? Object.keys(publicPages)
                .map((path) => `\n  <url><loc>${siteUrl}${path}</loc></url>`)
                .join('')
            : ''
        }\n</urlset>\n`;
  return new Response(request.method === 'HEAD' ? null : body, {
    status: request.method === 'GET' || request.method === 'HEAD' ? 200 : 405,
    headers: {
      ...headers,
      ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { Allow: 'GET, HEAD' }),
    },
  });
}
