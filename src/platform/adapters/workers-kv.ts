import { env } from 'cloudflare:workers';
import type { Cache } from '../config';
export function workersKV(): Cache {
  return {
    get: <T = string>(key: string, type?: 'json') =>
      type === 'json'
        ? env.QUERY_CACHE.get<T>(key, 'json')
        : (env.QUERY_CACHE.get(key) as Promise<T | null>),
    put: (key, value, options) => env.QUERY_CACHE.put(key, value, options),
    delete: (key) => env.QUERY_CACHE.delete(key),
    list: (options) => env.QUERY_CACHE.list(options),
  };
}
