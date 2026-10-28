import { ClerkProvider, useAuth as useClerkAuth } from '@clerk/tanstack-react-start';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { AuthState } from './state';

type AuthValue = AuthState & { isLoaded: boolean; isSignedIn: boolean };
const authContext = createContext<AuthValue | null>(null);

export function AuthProvider({ state, children }: { state: AuthState; children: ReactNode }) {
  if (state.provider === 'clerk')
    return (
      <ClerkProvider signInUrl="/sign-in" signUpUrl="/sign-up">
        <ClerkAuthBridge>{children}</ClerkAuthBridge>
      </ClerkProvider>
    );
  return <KeycloakAuthBridge state={state}>{children}</KeycloakAuthBridge>;
}
function KeycloakAuthBridge({ state, children }: { state: AuthState; children: ReactNode }) {
  useEffect(() => {
    const key = 'yresonance-auth';
    const identity = JSON.stringify([state.sessionId, state.userId, state.orgId]);
    // A login, logout, or workspace switch in another tab must discard this tab's
    // identity-scoped UI and cache before the user continues working.
    function changed(event: StorageEvent) {
      if (event.key === key && event.newValue !== identity) window.location.reload();
    }
    window.addEventListener('storage', changed);
    try {
      window.localStorage.setItem(key, identity);
    } catch {
      /* Storage can be disabled by the browser. */
    }
    const expiry = state.expiresAt
      ? window.setTimeout(() => window.location.reload(), Math.max(0, state.expiresAt - Date.now()))
      : undefined;
    return () => {
      window.removeEventListener('storage', changed);
      window.clearTimeout(expiry);
    };
  }, [state.sessionId, state.userId, state.orgId, state.expiresAt]);
  return (
    <authContext.Provider value={{ ...state, isLoaded: true, isSignedIn: Boolean(state.userId) }}>
      {children}
    </authContext.Provider>
  );
}
function ClerkAuthBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, orgId, sessionId } = useClerkAuth();
  return (
    <authContext.Provider
      value={{
        provider: 'clerk',
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        userId: userId ?? null,
        orgId: orgId ?? null,
        sessionId: sessionId ?? null,
      }}
    >
      {children}
    </authContext.Provider>
  );
}
export function useAuthProvider() {
  return useContext(authContext)?.provider ?? 'clerk';
}
export function useAuth() {
  const state = useContext(authContext);
  if (!state) throw new Error('AuthProvider is missing.');
  return state;
}
export function Show({
  when,
  children,
}: {
  when: 'signed-in' | 'signed-out';
  children: ReactNode;
}) {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && (when === 'signed-in' ? isSignedIn : !isSignedIn) ? children : null;
}
