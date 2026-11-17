import { env } from 'cloudflare:workers';
import type { Storage } from '../config';
export function r2(): Storage {
  return {
    get: (key, options) => env.DATA.get(key, options),
    head: (key) => env.DATA.head(key),
    put: (key, value, options) =>
      env.DATA.put(key, value, {
        onlyIf: options?.createOnly ? { etagDoesNotMatch: '*' } : undefined,
        httpMetadata: options?.contentType ? { contentType: options.contentType } : undefined,
      }),
    list: (options) => env.DATA.list(options),
    delete: (keys) => env.DATA.delete(keys),
  };
}
