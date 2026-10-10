/**
 * Stands in for `@clerk/tanstack-react-start/server` in the Worker integration suite.
 * Everything below Clerk stays real: `requireSession` still bootstraps workspaces in D1
 * and the service still enforces tenancy, grants, and share links against those rows.
 */

interface ActiveSession {
  userId: string;
  orgId: string | null;
  orgSlug: string | null;
  orgRole: string | null;
}

interface DirectoryUser {
  id: string;
  emailAddress: string;
  firstName?: string;
  imageUrl?: string;
}

let activeSession: ActiveSession | null = null;
let directory: DirectoryUser[] = [];

export function signInAs(session: {
  userId: string;
  orgId?: string | null;
  orgSlug?: string | null;
  isAdmin?: boolean;
}) {
  activeSession = {
    userId: session.userId,
    orgId: session.orgId ?? null,
    orgSlug: session.orgSlug ?? null,
    orgRole: session.isAdmin ? 'org:admin' : 'org:member',
  };
}

export function signOut() {
  activeSession = null;
}

export function setClerkDirectory(users: DirectoryUser[]) {
  directory = users;
}

export function resetClerk() {
  activeSession = null;
  directory = [];
}

export async function auth() {
  if (!activeSession)
    return { isAuthenticated: false, userId: null, orgId: null, orgSlug: null, orgRole: null };
  return { isAuthenticated: true, ...activeSession };
}

export function clerkClient() {
  return {
    users: {
      getUserList: async ({
        emailAddress,
        userId,
      }: {
        emailAddress?: string[];
        userId?: string[];
        limit?: number;
      }) => ({
        data: directory
          .filter(
            (user) =>
              (!emailAddress || emailAddress.includes(user.emailAddress)) &&
              (!userId || userId.includes(user.id)),
          )
          .map((user) => ({
            id: user.id,
            firstName: user.firstName ?? null,
            imageUrl: user.imageUrl,
            lastName: null,
            username: null,
            primaryEmailAddress: { emailAddress: user.emailAddress },
            emailAddresses: [{ id: user.id, emailAddress: user.emailAddress }],
          })),
      }),
    },
  };
}

export function clerkMiddleware() {
  return () => undefined;
}
