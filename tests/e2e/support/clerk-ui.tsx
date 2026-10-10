import type { ReactNode } from 'react';

// A ready session for tests that already replace /api/yresonance. The real Clerk suite owns auth.
export function ClerkProvider({ children }: { children: ReactNode }) {
  return children;
}

export function useAuth() {
  return { isLoaded: true, isSignedIn: true, userId: 'user_demo', orgId: 'org_demo' };
}

export function Show({
  when,
  children,
  fallback,
}: {
  when: 'signed-in' | 'signed-out';
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return when === 'signed-in' ? children : fallback;
}

export function UserButton() {
  return <button type="button" aria-label="Account" />;
}

function unsupportedAuth() {
  throw new Error('Auth interactions belong in the real Clerk browser suite.');
}

export {
  unsupportedAuth as SignIn,
  unsupportedAuth as SignUp,
  unsupportedAuth as SignInButton,
  unsupportedAuth as SignUpButton,
  unsupportedAuth as useClerk,
  unsupportedAuth as useUser,
  unsupportedAuth as useOrganizationList,
};
