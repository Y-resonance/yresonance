import { clerkClient } from '@clerk/tanstack-react-start/server';
import { and, eq, inArray } from 'drizzle-orm';
import { authUsers, workspaceMembers } from '#/db/schema';
import { ApiError } from '#/server/errors';
import { database } from '#/server/database.server';
import { authProvider, keycloakSettings } from './config.server';

export async function findWorkspaceUser(email: string, workspaceId: string) {
  if (authProvider() === 'clerk') {
    const users = await clerkClient().users.getUserList({ emailAddress: [email], limit: 2 });
    return users.data[0];
  }
  const users = await database()
    .select({ id: authUsers.id })
    .from(authUsers)
    .innerJoin(workspaceMembers, eq(workspaceMembers.userId, authUsers.id))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(authUsers.email, email.toLowerCase()),
        eq(authUsers.issuer, keycloakSettings().issuer),
      ),
    )
    .limit(2);
  if (users.length > 1)
    throw new ApiError(
      409,
      'ambiguous_user',
      'More than one workspace member has that email address.',
    );
  return users[0];
}

export async function userProfiles(ids: string[]) {
  if (!ids.length) return [];
  if (authProvider() === 'keycloak') {
    const users = await database()
      .select()
      .from(authUsers)
      .where(and(inArray(authUsers.id, ids), eq(authUsers.issuer, keycloakSettings().issuer)));
    return users.map((user) => ({
      id: user.id,
      displayName: user.name,
      email: user.email,
      imageUrl: undefined,
    }));
  }
  const users = await clerkClient().users.getUserList({ userId: ids, limit: ids.length });
  return users.data.map((user) => ({
    id: user.id,
    displayName:
      [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || undefined,
    email: user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress,
    imageUrl: user.imageUrl,
  }));
}
