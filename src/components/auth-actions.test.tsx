import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GetAccessButton, SignInAction } from './auth-actions';

const clerk = vi.hoisted(() => ({ mode: 'public' as 'public' | 'waitlist' | 'restricted' }));

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (location: { href: string }) => unknown }) =>
    select({ href: '/datasources?tab=fields' }),
}));

vi.mock('@clerk/tanstack-react-start', () => ({
  useClerk: () => ({ __internal_environment: { userSettings: { signUp: { mode: clerk.mode } } } }),
  SignInButton: ({
    children,
    mode,
    forceRedirectUrl,
    signUpForceRedirectUrl,
    withSignUp,
  }: {
    children: ReactNode;
    mode: string;
    forceRedirectUrl: string;
    signUpForceRedirectUrl: string;
    withSignUp: boolean;
  }) => (
    <span
      data-mode={mode}
      data-redirect={forceRedirectUrl}
      data-switch-redirect={signUpForceRedirectUrl}
      data-with-sign-up={withSignUp}
    >
      {children}
    </span>
  ),
  SignUpButton: ({
    children,
    mode,
    forceRedirectUrl,
    signInForceRedirectUrl,
  }: {
    children: ReactNode;
    mode: string;
    forceRedirectUrl: string;
    signInForceRedirectUrl: string;
  }) => (
    <span
      data-mode={mode}
      data-redirect={forceRedirectUrl}
      data-switch-redirect={signInForceRedirectUrl}
    >
      {children}
    </span>
  ),
}));

describe('authentication actions', () => {
  beforeEach(() => {
    clerk.mode = 'public';
  });
  it.each([
    [
      'sign in',
      <SignInAction key="sign-in">
        <button>Sign in</button>
      </SignInAction>,
    ],
    ['sign up', <GetAccessButton key="sign-up" />],
  ])('opens %s in a modal and returns every path through the current URL', (_, action) => {
    const html = renderToStaticMarkup(action);

    expect(html).toContain('data-mode="modal"');
    expect(html).toContain('data-redirect="/datasources?tab=fields"');
    expect(html).toContain('data-switch-redirect="/datasources?tab=fields"');
  });

  it.each(['public', 'waitlist', 'restricted'] as const)(
    'offers inline sign-up only when access is public (%s)',
    (mode) => {
      clerk.mode = mode;
      const html = renderToStaticMarkup(
        <SignInAction>
          <button>Sign in</button>
        </SignInAction>,
      );

      expect(html).toContain(`data-with-sign-up="${mode === 'public'}"`);
    },
  );
});
