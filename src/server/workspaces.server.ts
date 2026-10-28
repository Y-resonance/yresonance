import { and, eq, gt, inArray, sql } from 'drizzle-orm';
import type { ApiRequest } from '#/api/contracts';
import {
  authSessions,
  authUsers,
  dashboardGrants,
  dashboards,
  workspaceInvitations,
  workspaceMembers,
  workspaces,
} from '#/db/schema';
import { requireKeycloakSession } from '#/auth/keycloak.server';
import { requireAdmin, requireSession } from './auth.server';
import { database } from './database.server';
import { ApiError } from './errors';

export async function listWorkspaces() {
  const { user, session } = await requireKeycloakSession();
  const [memberships, invitations] = await Promise.all([
    database()
      .select({ id: workspaces.id, name: workspaces.name, role: workspaceMembers.role })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(eq(workspaceMembers.userId, user.id)),
    database()
      .select({
        id: workspaceInvitations.id,
        name: workspaces.name,
        role: workspaceInvitations.role,
      })
      .from(workspaceInvitations)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
      .where(
        and(
          eq(workspaceInvitations.email, user.email),
          gt(workspaceInvitations.expiresAt, Date.now()),
        ),
      ),
  ]);
  return { memberships, invitations, activeWorkspaceId: session.workspaceId };
}

export async function createWorkspace(name: string) {
  const { user, session } = await requireKeycloakSession();
  const id = `ws_${crypto.randomUUID()}`;
  await database().batch([
    database()
      .insert(workspaces)
      .values({
        id,
        name,
        clerkOrganizationId: `local:${id}`,
        r2Prefix: `ws/${id}/`,
        createdAt: new Date().toISOString(),
      }),
    database().insert(workspaceMembers).values({ workspaceId: id, userId: user.id, role: 'admin' }),
    database().update(authSessions).set({ workspaceId: id }).where(eq(authSessions.id, session.id)),
  ]);
  return { id, name };
}

export async function selectWorkspace(workspaceId: string) {
  const { user, session } = await requireKeycloakSession();
  const member = await database().query.workspaceMembers.findFirst({
    where: and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, user.id)),
  });
  if (!member)
    throw new ApiError(403, 'workspace_access_denied', 'You are not a member of that workspace.');
  await database().update(authSessions).set({ workspaceId }).where(eq(authSessions.id, session.id));
  return { workspaceId };
}

export async function acceptWorkspaceInvitation(invitationId: string) {
  const { user, session } = await requireKeycloakSession();
  // Insert and consume in the same D1 transaction. The predicate binds invitations
  // to the verified email from the identity provider, never an email supplied by the browser.
  const invitation = database()
    .select({
      workspaceId: workspaceInvitations.workspaceId,
      userId: sql<string>`${user.id}`.as('user_id'),
      role: workspaceInvitations.role,
    })
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.email, user.email),
        gt(workspaceInvitations.expiresAt, Date.now()),
      ),
    );
  const [inserted] = await database().batch([
    database().insert(workspaceMembers).select(invitation).onConflictDoNothing().returning(),
    database()
      .delete(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.id, invitationId),
          eq(workspaceInvitations.email, user.email),
          gt(workspaceInvitations.expiresAt, Date.now()),
        ),
      ),
  ]);
  const member = inserted[0];
  if (!member)
    throw new ApiError(
      404,
      'invitation_not_found',
      'This invitation is unavailable or you are already a member.',
    );
  await database()
    .update(authSessions)
    .set({ workspaceId: member.workspaceId })
    .where(eq(authSessions.id, session.id));
  return { workspaceId: member.workspaceId };
}

export async function listWorkspaceMembers() {
  await requireKeycloakSession();
  const session = await requireSession();
  requireAdmin(session);
  const [members, invitations] = await Promise.all([
    database()
      .select({
        userId: authUsers.id,
        name: authUsers.name,
        email: authUsers.email,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, session.workspace.id)),
    database()
      .select({
        id: workspaceInvitations.id,
        email: workspaceInvitations.email,
        role: workspaceInvitations.role,
        expiresAt: workspaceInvitations.expiresAt,
      })
      .from(workspaceInvitations)
      .where(
        and(
          eq(workspaceInvitations.workspaceId, session.workspace.id),
          gt(workspaceInvitations.expiresAt, Date.now()),
        ),
      ),
  ]);
  return { members, invitations };
}

export async function inviteWorkspaceMember(
  request: Extract<ApiRequest, { action: 'inviteWorkspaceMember' }>,
) {
  await requireKeycloakSession();
  const session = await requireSession();
  requireAdmin(session);
  const email = request.email.toLowerCase();
  const [existing] = await database()
    .select({ id: authUsers.id })
    .from(workspaceMembers)
    .innerJoin(authUsers, eq(authUsers.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, session.workspace.id), eq(authUsers.email, email)));
  if (existing)
    throw new ApiError(409, 'already_member', 'That person is already a workspace member.');
  await database()
    .insert(workspaceInvitations)
    .values({
      id: `inv_${crypto.randomUUID()}`,
      workspaceId: session.workspace.id,
      email,
      role: request.role,
      expiresAt: Date.now() + 7 * 86400_000,
    })
    .onConflictDoUpdate({
      target: [workspaceInvitations.workspaceId, workspaceInvitations.email],
      set: { role: request.role, expiresAt: Date.now() + 7 * 86400_000 },
    });
  return listWorkspaceMembers();
}

export async function updateWorkspaceMember(
  request: Extract<ApiRequest, { action: 'updateWorkspaceMember' }>,
) {
  await requireKeycloakSession();
  const session = await requireSession();
  requireAdmin(session);
  const workspaceId = session.workspace.id;
  // SQLite evaluates this guard inside the write, protecting the last admin even
  // when two admins try to remove or demote one another concurrently.
  const predicate = and(
    eq(workspaceMembers.workspaceId, workspaceId),
    eq(workspaceMembers.userId, request.userId),
    sql`(${workspaceMembers.role} != 'admin' OR EXISTS (SELECT 1 FROM workspace_members other WHERE other.workspace_id = ${workspaceId} AND other.role = 'admin' AND other.user_id != ${request.userId}))`,
  );
  if (request.role === 'remove') {
    const [removed] = await database().batch([
      database().delete(workspaceMembers).where(predicate).returning(),
      database()
        .delete(dashboardGrants)
        .where(
          and(
            eq(dashboardGrants.clerkUserId, request.userId),
            inArray(
              dashboardGrants.dashboardId,
              database()
                .select({ id: dashboards.id })
                .from(dashboards)
                .where(eq(dashboards.workspaceId, workspaceId)),
            ),
            sql`NOT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${workspaceId} AND user_id = ${request.userId})`,
          ),
        ),
    ]);
    if (!removed.length)
      throw new ApiError(
        409,
        'member_update_rejected',
        'The member was not found or is the last workspace admin.',
      );
  } else {
    const updated = await database()
      .update(workspaceMembers)
      .set({ role: request.role })
      .where(
        request.role === 'admin'
          ? and(
              eq(workspaceMembers.workspaceId, workspaceId),
              eq(workspaceMembers.userId, request.userId),
            )
          : predicate,
      )
      .returning();
    if (!updated.length)
      throw new ApiError(
        409,
        'member_update_rejected',
        'The member was not found or is the last workspace admin.',
      );
  }
  return { updated: true };
}

export async function revokeWorkspaceInvitation(invitationId: string) {
  await requireKeycloakSession();
  const session = await requireSession();
  requireAdmin(session);
  await database()
    .delete(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.id, invitationId),
        eq(workspaceInvitations.workspaceId, session.workspace.id),
      ),
    );
  return listWorkspaceMembers();
}
