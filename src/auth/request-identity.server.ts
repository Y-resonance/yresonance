import { auth } from '@clerk/tanstack-react-start/server';
import { authProvider } from './config.server';
import { readKeycloakSession } from './keycloak.server';

// Analytics also records anonymous shared-dashboard requests without requiring a workspace.
export async function requestIdentity(request: Request) {
  if (authProvider() === 'clerk') return auth();
  const current = await readKeycloakSession(request);
  return { userId: current?.user.id ?? null, orgId: current?.session.workspaceId ?? null };
}
