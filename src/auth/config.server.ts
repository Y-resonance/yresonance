import { env } from 'cloudflare:workers';
import { z } from 'zod';

export function authProvider() {
  return z.enum(['clerk', 'keycloak']).parse(env.AUTH_PROVIDER ?? 'clerk');
}

export function keycloakSettings() {
  const settings = z
    .object({
      issuer: z.url(),
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      appUrl: z.url(),
      sessionSeconds: z.coerce.number().int().min(60).max(86400).default(3600),
    })
    .parse({
      issuer: env.KEYCLOAK_ISSUER,
      clientId: env.KEYCLOAK_CLIENT_ID,
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      appUrl: env.AUTH_APP_URL,
      sessionSeconds: env.AUTH_SESSION_SECONDS,
    });
  for (const address of [settings.issuer, settings.appUrl]) {
    const url = new URL(address);
    const local =
      env.APP_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    )
      throw new Error('Authentication URLs must use HTTPS, except loopback development URLs.');
  }
  if (new URL(settings.appUrl).pathname !== '/') throw new Error('AUTH_APP_URL must be an origin.');
  return { ...settings, appUrl: new URL(settings.appUrl).origin };
}
