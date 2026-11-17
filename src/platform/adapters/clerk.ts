import { auth, clerkClient, clerkMiddleware } from '@clerk/tanstack-react-start/server';
import type { PlatformConfig } from '../config';
export function clerk(): PlatformConfig['auth'] {
  return {
    requestIdentity: () => auth(),
    directory: {
      users: (query) => clerkClient().users.getUserList(query),
      memberships: (query) => clerkClient().organizations.getOrganizationMembershipList(query),
    },
    middleware: () => clerkMiddleware(),
  };
}
