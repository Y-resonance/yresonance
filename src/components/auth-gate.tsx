import type { ReactNode } from 'react';
import { useAuth } from '#/platform/index.ui';

// Both gates render nothing until the provider has loaded, so neither state flashes.
export function SignedIn({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && isSignedIn ? children : null;
}

export function SignedOut({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  return isLoaded && !isSignedIn ? children : null;
}
