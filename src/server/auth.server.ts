import { authProvider } from '#/auth/config.server';
import { requireKeycloakSession } from '#/auth/keycloak.server';
import { workspaceMembers } from '#/db/schema';
import { and } from 'drizzle-orm';
import { auth } from '@clerk/tanstack-react-start/server';
import { eq } from 'drizzle-orm';
import { env } from 'cloudflare:workers';
import { createDatabase } from '#/db/client';
import { workspaces } from '#/db/schema';
import { ApiError } from './errors';

export interface SessionContext {
  userId: string;
  orgId: string;
  orgSlug: string | null;
  isAdmin: boolean;
  workspace: typeof workspaces.$inferSelect;
}

export async function requireIdentity() {
  if (authProvider() === 'keycloak') {
    const { session, user } = await requireKeycloakSession();
    const member = session.workspaceId
      ? await createDatabase(env.DB).query.workspaceMembers.findFirst({
          where: and(
            eq(workspaceMembers.workspaceId, session.workspaceId),
            eq(workspaceMembers.userId, user.id),
          ),
        })
      : undefined;
    if (!member)
      throw new ApiError(409, 'organization_required', 'Select or create a workspace to continue.');
    return {
      userId: user.id,
      orgId: `local:${member.workspaceId}`,
      orgSlug: null,
      isAdmin: member.role === 'admin',
    };
  }
  const session = await auth();
  if (!session.isAuthenticated || !session.userId)
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  if (!session.orgId)
    throw new ApiError(
      409,
      'organization_required',
      'Select or create a Clerk organization to use yresonance.',
    );
  return {
    userId: session.userId,
    orgId: session.orgId,
    orgSlug: session.orgSlug,
    isAdmin: session.orgRole === 'org:admin',
  };
}

export async function requireSession(): Promise<SessionContext> {
  const identity = await requireIdentity();
  const workspace = await createDatabase(env.DB).query.workspaces.findFirst({
    where: eq(workspaces.clerkOrganizationId, identity.orgId),
  });
  return workspaceSession(identity, workspace);
}

export async function workspaceSession(
  identity: Awaited<ReturnType<typeof requireIdentity>>,
  workspace: typeof workspaces.$inferSelect | undefined,
): Promise<SessionContext> {
  const db = createDatabase(env.DB);
  if (!workspace && authProvider() === 'keycloak')
    throw new ApiError(403, 'workspace_access_denied', 'Workspace access is required.');
  if (!workspace) {
    const id = `ws_${crypto.randomUUID()}`;
    await db
      .insert(workspaces)
      .values({
        id,
        clerkOrganizationId: identity.orgId,
        name: identity.orgSlug ?? 'Workspace',
        r2Prefix: `ws/${id}/`,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.clerkOrganizationId, identity.orgId),
    });
  }
  if (!workspace)
    throw new ApiError(500, 'workspace_bootstrap_failed', 'The workspace could not be created.');
  return {
    userId: identity.userId,
    orgId: identity.orgId,
    orgSlug: identity.orgSlug ?? null,
    isAdmin: identity.isAdmin,
    workspace,
  };
}

export function requireAdmin(session: SessionContext) {
  if (!session.isAdmin)
    throw new ApiError(403, 'admin_required', 'Only workspace admins can do that.');
}
