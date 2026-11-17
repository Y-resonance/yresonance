import { createContext, useContext } from 'react';
import { defineAuthUi, type AuthActions, type AuthUi, type BrowserSession } from '../ui';

const sessionContext = createContext<BrowserSession | null>(null);

// No browser SDK: every action is a navigation to a server route of the adapter.
const actions: AuthActions = {
  signIn: (redirectUrl) =>
    window.location.assign(`/auth/login?returnTo=${encodeURIComponent(redirectUrl)}`),
  // There is no sign-up. Accounts come from the identity provider.
  getAccess: (redirectUrl) => actions.signIn(redirectUrl),
  signOut() {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = '/auth/logout';
    document.body.appendChild(form);
    form.submit();
  },
};

/** UI half of the OpenID Connect adapter. The server resolves the session for it. */
export function oidcUi(): AuthUi {
  return defineAuthUi({
    Provider: ({ session, children }) => (
      <sessionContext.Provider value={session}>{children}</sessionContext.Provider>
    ),
    useAuth() {
      const session = useContext(sessionContext);
      return {
        isLoaded: true,
        isSignedIn: Boolean(session),
        userId: session?.userId ?? null,
        orgId: session?.orgId ?? null,
        sessionId: session?.sessionId ?? null,
        user: session?.user ?? null,
      };
    },
    useAuthActions: () => actions,
    useAuthCapabilities: () => ({ signUp: 'none', workspaces: 'single', landing: false }),
  });
}
