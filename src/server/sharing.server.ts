import { type ApiRequest } from '#/api/contracts';
import { ApiError } from './errors';
import { shareLinks, dashboardGrants } from '#/db/schema';
import { and, eq, isNull } from 'drizzle-orm';
import { clerkClient } from '@clerk/tanstack-react-start/server';
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
      const users = await clerkClient().users.getUserList({
        emailAddress: [request.operation.userEmail],
        limit: 2,
      });
      const user = users.data[0];
      if (!user) throw new ApiError(404, 'user_not_found', 'No Clerk user has that email address.');
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
        const users = await clerkClient().users.getUserList({
          emailAddress: [request.operation.userEmail],
          limit: 2,
        });
        userId = users.data[0]?.id;
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
  const userPages = await Promise.all(
    chunk(grants, 100).map((page) =>
      clerkClient().users.getUserList({
        userId: page.map((grant) => grant.clerkUserId),
        limit: page.length,
      }),
    ),
  );
  const userById = new Map(userPages.flatMap((page) => page.data).map((user) => [user.id, user]));
  return {
    links: links.map((link) => ({ ...link, url: `/share/${link.token}` })),
    grants: grants.map((grant) => {
      const user = userById.get(grant.clerkUserId);
      return {
        ...grant,
        userEmail: user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses[0]?.emailAddress,
        displayName:
          [user?.firstName, user?.lastName].filter(Boolean).join(' ') ||
          user?.username ||
          undefined,
      };
    }),
  };
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
