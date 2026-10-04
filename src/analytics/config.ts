export const ANALYTICS_PROXY_PATH = '/ingest';

export interface AnalyticsConfig {
  token: string;
  host: string;
  uiHost: string;
  environment: string;
}

export function posthogHosts(host: string) {
  const origin = new URL(host).origin;
  if (origin === 'https://eu.i.posthog.com')
    return { assetsHost: 'https://eu-assets.i.posthog.com', uiHost: 'https://eu.posthog.com' };
  if (origin === 'https://us.i.posthog.com')
    return { assetsHost: 'https://us-assets.i.posthog.com', uiHost: 'https://us.posthog.com' };
  return { assetsHost: origin, uiHost: origin };
}

// Shared links grant access. Never send their capability tokens to analytics.
export function analyticsUrl(value: string) {
  try {
    const url = new URL(value);
    url.pathname = url.pathname.replace(/^\/share\/[^/]+/, '/share/[redacted]');
    for (const key of [...url.searchParams.keys()]) {
      if (!['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'].includes(key))
        url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function sanitizeAnalyticsProperties(
  properties: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).flatMap(([key, value]) => {
      if (
        [
          'title',
          '$title',
          '$initial_title',
          '$search',
          '$initial_search',
          '$hash',
          '$initial_hash',
        ].includes(key)
      )
        return [];
      if (typeof value === 'string') {
        const clean = [
          'url',
          'href',
          '$current_url',
          '$referrer',
          '$initial_current_url',
          '$initial_referrer',
        ].includes(key)
          ? analyticsUrl(value)
          : value
              .replace(/https?:\/\/[^\s"'<>]+/g, (url) => analyticsUrl(url) ?? '')
              .replace(/\/share\/[^/?#\s"'<>]+/g, '/share/[redacted]');
        return [[key, clean]];
      }
      if (Array.isArray(value))
        return [
          [
            key,
            value.map((item: unknown) =>
              item && typeof item === 'object' && !Array.isArray(item)
                ? sanitizeAnalyticsProperties(item as Record<string, unknown>)
                : item,
            ),
          ],
        ];
      if (value && typeof value === 'object')
        return [[key, sanitizeAnalyticsProperties(value as Record<string, unknown>)]];
      return [[key, value]];
    }),
  );
}
