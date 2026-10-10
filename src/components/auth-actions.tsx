import { SignInButton, SignUpButton, useClerk } from '@clerk/tanstack-react-start';
import { useLocation } from '@tanstack/react-router';
import type { ComponentProps, ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { useSignUpMode } from '#/hooks/use-sign-up-mode';

export function SignInAction({ children }: { children: ReactElement }) {
  const redirectUrl = useLocation({ select: (location) => location.href });
  const mode = useSignUpMode();

  return (
    <SignInButton
      mode="modal"
      forceRedirectUrl={redirectUrl}
      signUpForceRedirectUrl={redirectUrl}
      withSignUp={mode === 'public'}
    >
      {children}
    </SignInButton>
  );
}

export function GetAccessButton({ children, ...props }: ComponentProps<typeof Button>) {
  const redirectUrl = useLocation({ select: (location) => location.href });
  const clerk = useClerk();
  const mode = useSignUpMode();

  if (mode === 'waitlist') {
    return (
      <Button {...props} onClick={() => clerk.openWaitlist()}>
        Join waitlist
        {children}
      </Button>
    );
  }

  if (mode !== 'public') return null;

  return (
    <SignUpButton mode="modal" forceRedirectUrl={redirectUrl} signInForceRedirectUrl={redirectUrl}>
      <Button {...props}>
        Create account
        {children}
      </Button>
    </SignUpButton>
  );
}
