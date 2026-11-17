import { env } from 'cloudflare:workers';
export function hyperdrive() {
  return { connectionString: () => env.HYPERDRIVE.connectionString };
}
