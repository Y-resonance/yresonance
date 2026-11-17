import { env } from 'cloudflare:workers';
import type { PlatformConfig } from '../config';
export function cloudflareImages(): PlatformConfig['images'] {
  return {
    async dimensions(body) {
      const info = await env.IMAGES.info(body);
      return 'width' in info ? { width: info.width, height: info.height } : undefined;
    },
    async resize(body, width, format) {
      const result = await env.IMAGES.input(body)
        .transform({ width, fit: 'scale-down' })
        .output({
          format: format as 'image/avif' | 'image/webp' | 'image/jpeg' | 'image/png',
          quality: 80,
        });
      return result.response();
    },
  };
}
