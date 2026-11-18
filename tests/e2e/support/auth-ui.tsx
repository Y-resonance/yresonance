import { defineAuthUi } from '#/platform/ui';

function unsupportedAuth(): never {
  throw new Error('Auth interactions belong in the real Clerk browser suite.');
}

// A ready session for tests that already replace /api/yresonance. The real Clerk suite owns
// auth. The UI dev server resolves `virtual:auth-ui` to this file.
export default defineAuthUi({
  Provider: ({ children }) => children,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_demo',
    orgId: 'org_demo',
    sessionId: 'session_demo',
    user: { name: 'Demo User', email: 'demo@example.com', imageUrl: null },
  }),
  useAuthActions: () => ({
    signIn: unsupportedAuth,
    getAccess: unsupportedAuth,
    signOut: unsupportedAuth,
  }),
  useAuthCapabilities: () => ({ signUp: 'none', workspaces: 'multiple', landing: true }),
});
