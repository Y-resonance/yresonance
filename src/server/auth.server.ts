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

export async function requireSession(): Promise<SessionContext> {
  const session = await auth();
  if (!session.isAuthenticated || !session.userId)
    throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  if (!session.orgId)
    throw new ApiError(
      409,
      'organization_required',
      'Select or create a Clerk organization to use yresonance.',
    );
  const db = createDatabase(env.DB);
  let workspace = await db.query.workspaces.findFirst({
    where: eq(workspaces.clerkOrganizationId, session.orgId),
  });
  if (!workspace) {
    const id = `ws_${crypto.randomUUID()}`;
    await db
      .insert(workspaces)
      .values({
        id,
        clerkOrganizationId: session.orgId,
        name: session.orgSlug ?? 'Workspace',
        r2Prefix: `ws/${id}/`,
        createdAt: new Date().toISOString(),
      })
      .onConflictDoNothing();
    workspace = await db.query.workspaces.findFirst({
      where: eq(workspaces.clerkOrganizationId, session.orgId),
    });
  }
  if (!workspace)
    throw new ApiError(500, 'workspace_bootstrap_failed', 'The workspace could not be created.');
  return {
    userId: session.userId,
    orgId: session.orgId,
    orgSlug: session.orgSlug ?? null,
    isAdmin: session.orgRole === 'org:admin',
    workspace,
  };
}

export function requireAdmin(session: SessionContext) {
  if (!session.isAdmin)
    throw new ApiError(403, 'admin_required', 'Only workspace admins can do that.');
}
