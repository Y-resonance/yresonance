import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ui from './clerk-ui';

const clerk = vi.hoisted(() => ({
  mode: 'public' as 'public' | 'restricted' | 'waitlist' | undefined,
  openSignIn: vi.fn<(options: object) => void>(),
  openSignUp: vi.fn<(options: object) => void>(),
  openWaitlist: vi.fn<() => void>(),
}));

vi.mock('@clerk/tanstack-react-start', () => ({
  useClerk: () => ({
    __internal_environment: clerk.mode
      ? { userSettings: { signUp: { mode: clerk.mode } } }
      : undefined,
    on: () => {},
    off: () => {},
    openSignIn: clerk.openSignIn,
    openSignUp: clerk.openSignUp,
    openWaitlist: clerk.openWaitlist,
  }),
}));
vi.mock('./clerk-workspaces', () => ({ ClerkWorkspaceSetup: () => null }));

// Hooks need a render; the probe hands their result to the test.
function probe<T>(read: () => T) {
  let result!: T;
  function Probe() {
    result = read();
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return result;
}

describe('Clerk client adapter', () => {
  beforeEach(() => {
    clerk.mode = 'public';
    vi.clearAllMocks();
  });

  // Missing or changed Clerk configuration must never advertise open sign-up.
  it.each([
    ['public', 'public'],
    ['waitlist', 'waitlist'],
    ['restricted', 'none'],
    [undefined, 'none'],
  ] as const)('maps Clerk access mode %s to sign-up capability %s', (mode, signUp) => {
    clerk.mode = mode;

    expect(probe(() => ui.useAuthCapabilities()).signUp).toBe(signUp);
  });

  it.each(['public', 'waitlist', 'restricted'] as const)(
    'offers inline sign-up in the sign-in modal only when access is public (%s)',
    (mode) => {
      clerk.mode = mode;
      probe(() => ui.useAuthActions()).signIn('/datasources');

      expect(clerk.openSignIn).toHaveBeenCalledWith({
        forceRedirectUrl: '/datasources',
        signUpForceRedirectUrl: '/datasources',
        withSignUp: mode === 'public',
      });
    },
  );

  it('opens the waitlist instead of sign-up when access is waitlisted', () => {
    clerk.mode = 'waitlist';
    probe(() => ui.useAuthActions()).getAccess('/');

    expect(clerk.openWaitlist).toHaveBeenCalled();
    expect(clerk.openSignUp).not.toHaveBeenCalled();
  });
});
