import { createMiddleware } from '@tanstack/react-start';
import type { PlatformConfig } from '#/platform/config';

function unsupportedDirectory(): never {
  throw new Error('The UI suite must mock /api/yresonance instead of accessing the directory.');
}

// The UI dev server resolves the Clerk server adapter module to this file. It never grants a
// server-side session.
export function clerk(): PlatformConfig['auth'] {
  return {
    requestIdentity: async () => ({ userId: null, orgId: null, orgSlug: null, isAdmin: false }),
    directory: { users: unsupportedDirectory, memberships: unsupportedDirectory },
    middleware: () => createMiddleware().server(({ next }) => next()),
  };
}
