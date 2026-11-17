import { waitUntil } from 'cloudflare:workers';
export function workersBackground() {
  return { waitUntil };
}
