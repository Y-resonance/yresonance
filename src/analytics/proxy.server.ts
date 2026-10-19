import { BodyTooLargeError, readRequestBytes } from '../http/body';
import { env } from 'cloudflare:workers';
import { ANALYTICS_PROXY_PATH, posthogHosts } from './config';

export function proxyAnalyticsRequest(request: Request) {
  const url = new URL(request.url);
  if (url.pathname !== ANALYTICS_PROXY_PATH && !url.pathname.startsWith(`${ANALYTICS_PROXY_PATH}/`))
    return undefined;
  if (env.POSTHOG_ENABLED !== 'true') return Promise.resolve(new Response(null, { status: 404 }));
  return forwardAnalyticsRequest(request, url);
}

async function forwardAnalyticsRequest(request: Request, url: URL) {
  const pathname = url.pathname.slice(ANALYTICS_PROXY_PATH.length) || '/';
  const isAsset = pathname.startsWith('/static/') || pathname.startsWith('/array/');
  const upstream = new URL(isAsset ? posthogHosts(env.POSTHOG_HOST).assetsHost : env.POSTHOG_HOST);
  // Assign the path separately so a double slash cannot replace the upstream host.
  upstream.pathname = pathname;
  upstream.search = url.search;

  const headers = new Headers(request.headers);
  headers.delete('cookie');
  headers.delete('authorization');
  // Shared report URLs contain access tokens.
  headers.delete('referer');
  headers.set('Host', upstream.host);
  headers.set('X-Forwarded-For', request.headers.get('CF-Connecting-IP') ?? '');

  let response: Response;
  try {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)]);
    response = await fetch(
      new Request(upstream, {
        method: request.method,
        headers,
        body:
          request.method !== 'GET' && request.method !== 'HEAD'
            ? await readRequestBytes(request, 2 * 1024 * 1024, signal)
            : null,
        redirect: 'follow',
        signal,
      }),
      isAsset && request.method === 'GET' ? { cf: { cacheEverything: true } } : undefined,
    );
  } catch (error) {
    if (error instanceof BodyTooLargeError)
      return new Response(null, { status: 413, headers: { 'Cache-Control': 'no-store' } });
    console.warn('yresonance.analytics_proxy_failed');
    return new Response(null, { status: 502, headers: { 'Cache-Control': 'no-store' } });
  }
  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete('set-cookie');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
