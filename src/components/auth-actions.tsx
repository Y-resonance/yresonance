import { useLocation } from '@tanstack/react-router';
import { cloneElement, useEffect, type ComponentProps, type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { useAuthActions, useAuthCapabilities } from '#/platform/index.ui';

/** Makes its child start sign-in and return to the current page afterwards. */
export function SignInAction({ children }: { children: ReactElement<{ onClick?: () => void }> }) {
  const redirectUrl = useLocation({ select: (location) => location.href });
  const { signIn } = useAuthActions();
  return cloneElement(children, { onClick: () => signIn(redirectUrl) });
}

export function GetAccessButton({ children, ...props }: ComponentProps<typeof Button>) {
  const redirectUrl = useLocation({ select: (location) => location.href });
  const { getAccess } = useAuthActions();
  const { signUp } = useAuthCapabilities();

  if (signUp === 'none') return null;

  return (
    <Button {...props} onClick={() => getAccess(redirectUrl)}>
      {signUp === 'waitlist' ? 'Join waitlist' : 'Create account'}
      {children}
    </Button>
  );
}

/** Stands in for a credential form when the provider hosts its own login page. */
export function SignInRedirect() {
  const { signIn } = useAuthActions();
  useEffect(() => signIn('/'), [signIn]);
  return null;
}
