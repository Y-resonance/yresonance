import { createMiddleware } from '@tanstack/react-start';

// Only the e2e-ui dev server resolves this module. It never grants a server-side session.
export function clerkMiddleware() {
  return createMiddleware().server(({ next }) => next());
}

export async function auth() {
  return { isAuthenticated: false, userId: null, orgId: null, orgSlug: null, orgRole: null };
}

export function clerkClient(): never {
  throw new Error('The UI suite must mock /api/rundown instead of accessing the Clerk directory.');
}
