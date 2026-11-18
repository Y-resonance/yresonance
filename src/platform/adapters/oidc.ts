import { createMiddleware, getGlobalStartContext } from '@tanstack/react-start';
import type { PlatformConfig } from '../config';
import {
  OIDC_ORG_ID,
  directoryMembers,
  directoryUsers,
  handleOidcRequest,
  identityOf,
  type OidcSession,
} from './oidc-flow';

// The middleware resolves the session once per request and hands it on through the context.
function currentSession() {
  const context = getGlobalStartContext() as { oidcSession?: OidcSession | null } | undefined;
  return context?.oidcSession ?? null;
}

/**
 * Server half of the generic OpenID Connect adapter, verified against Keycloak. The whole
 * deployment is one workspace, and a role in the access token makes a user admin. Sessions
 * live in an encrypted cookie; users are recorded in Postgres when they sign in.
 */
export function oidc(): PlatformConfig['auth'] {
  return {
    requestIdentity: async () => identityOf(currentSession()),
    directory: {
      users: directoryUsers,
      memberships: ({ orgId, userIds }) =>
        orgId === OIDC_ORG_ID ? directoryMembers(userIds) : Promise.resolve([]),
    },
    middleware: () =>
      createMiddleware().server(async ({ request, next }) => {
        const handled = await handleOidcRequest(request);
        if ('response' in handled) return handled.response;
        const result = await next({ context: { oidcSession: handled.session } });
        for (const cookie of handled.cookies) result.response.headers.append('Set-Cookie', cookie);
        return result;
      }),
    async browserSession() {
      const session = currentSession();
      return session
        ? {
            userId: session.userId,
            orgId: OIDC_ORG_ID,
            sessionId: session.sessionId,
            user: { name: session.name, email: session.email, imageUrl: session.imageUrl },
          }
        : null;
    },
  };
}
