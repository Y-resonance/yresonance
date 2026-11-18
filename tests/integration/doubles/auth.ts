/**
 * Stands in for the auth adapter in the Worker integration suite. Everything behind the
 * adapter stays real: `requireSession` still bootstraps workspaces in Postgres and the service
 * still enforces tenancy, grants, and share links against those rows.
 */
import type { DirectoryUser, PlatformConfig } from '#/platform/config';

type Auth = PlatformConfig['auth'];
type TestUser = Pick<DirectoryUser, 'id' | 'email'> & Partial<DirectoryUser>;

let activeSession: Awaited<ReturnType<Auth['requestIdentity']>> | null = null;
let users: TestUser[] = [];
const memberships = new Map<string, Set<string>>();

export function removeMembership(orgId: string, userId: string) {
  memberships.get(orgId)?.delete(userId);
}

export function signInAs(session: {
  userId: string;
  orgId?: string | null;
  orgSlug?: string | null;
  isAdmin?: boolean;
}) {
  if (session.orgId) {
    const members = memberships.get(session.orgId) ?? new Set<string>();
    members.add(session.userId);
    memberships.set(session.orgId, members);
  }
  activeSession = {
    userId: session.userId,
    orgId: session.orgId ?? null,
    orgSlug: session.orgSlug ?? null,
    isAdmin: session.isAdmin ?? false,
  };
}

export function signOut() {
  activeSession = null;
}

export function setDirectory(directoryUsers: TestUser[]) {
  users = directoryUsers;
}

export function resetAuth() {
  activeSession = null;
  users = [];
  memberships.clear();
}

/** Exported so a test can replace one lookup with `vi.spyOn`. */
export const directory: Auth['directory'] = {
  async users(query) {
    return users
      .filter((user) =>
        'userIds' in query
          ? query.userIds.includes(user.id)
          : user.email !== null && query.emails.includes(user.email),
      )
      .map((user) => ({ name: null, imageUrl: null, ...user }));
  },
  async memberships({ orgId, userIds }) {
    return userIds.filter((id) => memberships.get(orgId)?.has(id));
  },
};

// The integration config resolves the Clerk adapter module to this file.
export function clerk(): Auth {
  return {
    requestIdentity: async () =>
      activeSession ?? { userId: null, orgId: null, orgSlug: null, isAdmin: false },
    directory: {
      users: (query) => directory.users(query),
      memberships: (query) => directory.memberships(query),
    },
    middleware: () => {
      throw new Error('The integration suite calls the service without request middleware.');
    },
  };
}
