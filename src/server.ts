import handler, { createServerEntry } from '@tanstack/react-start/server-entry';
import { handleResetRequest } from './reset.server';
import { trackApiRequest } from './analytics/server';
import { proxyAnalyticsRequest } from './analytics/proxy.server';

export { QueryEngineContainer } from './query-engine-container';
export { ContainerProxy } from '@cloudflare/containers';

export default createServerEntry({
  async fetch(request) {
    const proxyResponse = proxyAnalyticsRequest(request);
    if (proxyResponse) return proxyResponse;
    const startedAt = Date.now();
    const url = new URL(request.url);
    try {
      if (url.pathname === '/api/admin/reset') return await handleResetRequest(request);
      return await handler.fetch(request);
    } catch (error) {
      trackApiRequest({
        request,
        status: 500,
        error,
        errorCode: 'unhandled_server_error',
        durationMs: Date.now() - startedAt,
      });
      throw error;
    }
  },
});
