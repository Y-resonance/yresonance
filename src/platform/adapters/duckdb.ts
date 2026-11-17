import { settings } from '../settings';
import { env } from 'cloudflare:workers';
import { getContainer } from '@cloudflare/containers';
export function duckdb() {
  const local = () => !settings().DATA_SOURCE_BASE_URL.startsWith('r2://');
  return {
    url: () =>
      local()
        ? new URL('/__query-engine', settings().DATA_SOURCE_BASE_URL).href
        : 'http://query-engine/query',
    fetch: (workspaceId: string, request: Request) =>
      local() ? fetch(request) : getContainer(env.QUERY_ENGINE, workspaceId).fetch(request),
  };
}
