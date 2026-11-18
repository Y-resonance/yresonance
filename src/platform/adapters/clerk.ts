import { auth, clerkClient, clerkMiddleware } from '@clerk/tanstack-react-start/server';
import { z } from 'zod';
import type { PlatformConfig } from '../config';

/** Server half of the Clerk adapter. A workspace is a Clerk organization. */
export function clerk(): PlatformConfig['auth'] {
  return {
    async requestIdentity() {
      const session = await auth();
      return {
        userId: session.isAuthenticated ? session.userId : null,
        orgId: session.orgId ?? null,
        orgSlug: session.orgSlug ?? null,
        isAdmin: session.orgRole === 'org:admin',
      };
    },
    directory: {
      async users(query) {
        const users = await clerkClient().users.getUserList(
          'userIds' in query
            ? { userId: query.userIds, limit: query.userIds.length }
            : { emailAddress: query.emails, limit: query.emails.length },
        );
        return users.data.map((user) => ({
          id: user.id,
          email:
            user.primaryEmailAddress?.emailAddress ?? user.emailAddresses[0]?.emailAddress ?? null,
          name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.username || null,
          imageUrl: user.imageUrl,
        }));
      },
      async memberships({ orgId, userIds }) {
        try {
          const memberships = await clerkClient().organizations.getOrganizationMembershipList({
            organizationId: orgId,
            userId: userIds,
            limit: userIds.length,
          });
          return memberships.data.flatMap((membership) => membership.publicUserData?.userId ?? []);
        } catch (error) {
          // A deleted organization has no members.
          if (z.object({ status: z.literal(404) }).safeParse(error).success) return [];
          throw error;
        }
      },
    },
    middleware: () => clerkMiddleware(),
  };
}
