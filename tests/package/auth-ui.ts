// UI half of the fixed-admin auth stand-in in yresonance.config.ts.
import { defineAuthUi } from '@yresonance-dev/core/ui';

export default defineAuthUi({
  Provider: ({ children }) => children,
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: 'user_package_check',
    orgId: 'org_package_check',
    sessionId: 'session_package_check',
    user: { name: 'Package Check', email: 'package-check@example.com', imageUrl: null },
  }),
  useAuthActions: () => ({ signIn: () => {}, getAccess: () => {}, signOut: () => {} }),
  useAuthCapabilities: () => ({ signUp: 'none', workspaces: 'single', landing: false }),
});
