import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GetAccessButton, SignInAction } from './auth-actions';

const auth = vi.hoisted(() => ({
  signUp: 'public' as 'public' | 'waitlist' | 'none',
  signIn: vi.fn<(redirectUrl: string) => void>(),
  getAccess: vi.fn<(redirectUrl: string) => void>(),
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: ({ select }: { select: (location: { href: string }) => unknown }) =>
    select({ href: '/datasources?tab=fields' }),
}));

vi.mock('#/platform/index.ui', () => ({
  useAuthActions: () => ({ signIn: auth.signIn, getAccess: auth.getAccess }),
  useAuthCapabilities: () => ({ signUp: auth.signUp }),
}));

describe('authentication actions', () => {
  beforeEach(() => {
    auth.signUp = 'public';
    vi.clearAllMocks();
  });

  it('starts sign-in from its child and returns to the current URL', () => {
    const action = SignInAction({ children: <button>Sign in</button> });
    action.props.onClick?.();

    expect(auth.signIn).toHaveBeenCalledWith('/datasources?tab=fields');
  });

  it.each([
    ['public', 'Create account'],
    ['waitlist', 'Join waitlist'],
  ] as const)('labels access for %s sign-up and returns to the current URL', (signUp, label) => {
    auth.signUp = signUp;
    const button = GetAccessButton({});

    expect(renderToStaticMarkup(button)).toContain(label);
    button?.props.onClick?.(undefined as never);
    expect(auth.getAccess).toHaveBeenCalledWith('/datasources?tab=fields');
  });

  it('offers no access button when the provider has no sign-up', () => {
    auth.signUp = 'none';

    expect(renderToStaticMarkup(<GetAccessButton />)).toBe('');
  });
});
