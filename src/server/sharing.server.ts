import { type ApiRequest } from '#/api/contracts';
import { ApiError } from './errors';
import { shareLinks, dashboardGrants } from '#/db/schema';
import { and, eq, isNull, inArray } from 'drizzle-orm';
import { authProvider } from '#/auth/config.server';
import { findWorkspaceUser, userProfiles } from '#/auth/directory.server';
import { authorizeDashboard } from './dashboard-access.server';
import { database } from './database.server';

export async function shareDashboard(request: Extract<ApiRequest, { action: 'shareDashboard' }>) {
  const access = await authorizeDashboard(request.dashboardId, 'editor');
  if (!access.session) throw new ApiError(401, 'unauthenticated', 'Sign in to manage sharing.');
  const db = database();
  if (request.operation.kind === 'createLink') {
    const token = randomToken();
    const link = {
      token,
      dashboardId: request.dashboardId,
      createdBy: access.session.userId,
      createdAt: new Date().toISOString(),
      revokedAt: null,
    };
    await db.insert(shareLinks).values(link);
    return { ...link, url: `/share/${token}` };
  }
  if (request.operation.kind === 'revokeLink') {
    await db
      .update(shareLinks)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(shareLinks.dashboardId, request.dashboardId),
          eq(shareLinks.token, request.operation.token),
        ),
      );
  } else {
    if (request.operation.kind === 'grant') {
      const user = await findWorkspaceUser(
        request.operation.userEmail,
        access.session.workspace.id,
      );
      if (!user)
        throw new ApiError(
          404,
          'user_not_found',
          authProvider() === 'keycloak'
            ? 'No workspace member has that email address. Invite them to the workspace first.'
            : 'No user has that email address.',
        );
      const values = {
        dashboardId: request.dashboardId,
        clerkUserId: user.id,
        role: request.operation.role,
        grantedBy: access.session.userId,
        grantedAt: new Date().toISOString(),
      };
      await db
        .insert(dashboardGrants)
        .values(values)
        .onConflictDoUpdate({
          target: [dashboardGrants.dashboardId, dashboardGrants.clerkUserId],
          set: values,
        });
    } else {
      let userId = request.operation.userId;
      if (!userId && request.operation.userEmail) {
        const user = await findWorkspaceUser(
          request.operation.userEmail,
          access.session.workspace.id,
        );
        userId = user?.id;
      }
      if (!userId)
        throw new ApiError(400, 'user_reference_required', 'Provide a user id or email to revoke.');
      await db
        .delete(dashboardGrants)
        .where(
          and(
            eq(dashboardGrants.dashboardId, request.dashboardId),
            eq(dashboardGrants.clerkUserId, userId),
          ),
        );
    }
  }
  return sharingState(request.dashboardId);
}

export async function sharingState(dashboardId: string) {
  const [links, grants] = await Promise.all([
    database()
      .select()
      .from(shareLinks)
      .where(and(eq(shareLinks.dashboardId, dashboardId), isNull(shareLinks.revokedAt))),
    database().select().from(dashboardGrants).where(eq(dashboardGrants.dashboardId, dashboardId)),
  ]);
  return {
    links: links.map((link) => ({ ...link, url: `/share/${link.token}` })),
    grants: await resolveCollaborators(grants),
  };
}

// Only IDs already authorized by the caller enter this lookup. Resolve each profile once
// across the overview, even when a person collaborates on multiple dashboards.
export async function dashboardCollaborators(dashboardIds: string[]) {
  const grantPages = await Promise.all(
    chunk(dashboardIds, 100).map((ids) =>
      database()
        .select({
          dashboardId: dashboardGrants.dashboardId,
          clerkUserId: dashboardGrants.clerkUserId,
          role: dashboardGrants.role,
        })
        .from(dashboardGrants)
        .where(inArray(dashboardGrants.dashboardId, ids)),
    ),
  );
  const grants = grantPages.flat();
  const collaborators = await resolveCollaborators(grants);
  return new Map(
    dashboardIds.map((id) => [id, collaborators.filter((grant) => grant.dashboardId === id)]),
  );
}

async function resolveCollaborators<T extends { clerkUserId: string }>(grants: T[]) {
  const userIds = [...new Set(grants.map((grant) => grant.clerkUserId))];
  const userPages = await Promise.all(chunk(userIds, 100).map((page) => userProfiles(page)));
  const userById = new Map(userPages.flat().map((user) => [user.id, user]));
  return grants.map((grant) => {
    const user = userById.get(grant.clerkUserId);
    return {
      ...grant,
      imageUrl: user?.imageUrl,
      userEmail: user?.email,
      displayName: user?.displayName,
    };
  });
}

function chunk<T>(values: T[], size: number) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size),
  );
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
