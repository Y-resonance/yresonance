import { createServerFn } from '@tanstack/react-start';
import type { AuthState } from './state';

export const getAuthState = createServerFn({ method: 'GET' }).handler(
  async (): Promise<AuthState> => {
    const { setResponseHeader } = await import('@tanstack/react-start/server');
    setResponseHeader('Cache-Control', 'private, no-store');
    const { authProvider } = await import('./config.server');
    if (authProvider() === 'clerk')
      return { provider: 'clerk', userId: null, sessionId: null, orgId: null };
    const { readKeycloakSession } = await import('./keycloak.server');
    const current = await readKeycloakSession();
    if (!current) return { provider: 'keycloak', userId: null, sessionId: null, orgId: null };
    const { database } = await import('#/server/database.server');
    const { workspaceMembers } = await import('#/db/schema');
    const { and, eq } = await import('drizzle-orm');
    const member = current.session.workspaceId
      ? await database().query.workspaceMembers.findFirst({
          where: and(
            eq(workspaceMembers.userId, current.user.id),
            eq(workspaceMembers.workspaceId, current.session.workspaceId),
          ),
        })
      : undefined;
    return {
      provider: 'keycloak',
      userId: current.user.id,
      sessionId: current.session.id,
      orgId: member?.workspaceId ?? null,
      isAdmin: member?.role === 'admin',
      name: current.user.name,
      expiresAt: current.session.expiresAt,
    };
  },
);
