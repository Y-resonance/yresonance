import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider } from '#/auth/provider';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';
import { LandingPage } from './landing-page';

// Search behavior has browser coverage; shell tests own navigation and responsive layout.
vi.mock('./global-search', () => ({ GlobalSearch: () => null }));

const clerk = vi.hoisted(() => ({
  forbidden: false,
  state: 'signed-in' as 'signed-in' | 'signed-out',
  mode: 'public' as 'public' | 'restricted' | 'waitlist' | undefined,
}));
const router = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('@clerk/tanstack-react-start', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    when === clerk.state ? children : null,
  UserButton: () => <span data-testid="user-button" />,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  useClerk: () => {
    if (clerk.forbidden) throw new Error('Clerk is unavailable in Keycloak mode.');
    return {
      __internal_environment: clerk.mode
        ? { userSettings: { signUp: { mode: clerk.mode } } }
        : undefined,
    };
  },
  useAuth: () => ({ isLoaded: true, isSignedIn: clerk.state === 'signed-in', orgId: 'org_1' }),
  useUser: () => ({ isLoaded: true, user: {} }),
  useOrganizationList: () => ({ isLoaded: true }),
}));

// Mirrors how the router merges activeProps and inactiveProps onto the anchor,
// so the shell's active-section marking is exercised rather than assumed.
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: async () => {} }),
  Link: ({
    to,
    children,
    className,
    activeProps,
    inactiveProps,
    activeOptions,
    ...props
  }: {
    to: string;
    children: ReactNode;
    className?: string;
    activeProps?: { className?: string };
    inactiveProps?: { className?: string };
    activeOptions?: { exact?: boolean };
  }) => {
    const active = activeOptions?.exact
      ? router.pathname === to
      : router.pathname === to || router.pathname.startsWith(`${to}/`);
    return (
      <a
        href={to}
        className={[className, active ? activeProps?.className : inactiveProps?.className]
          .filter(Boolean)
          .join(' ')}
        {...props}
      >
        {children}
      </a>
    );
  },
  useLocation: ({ select }: { select: (location: { href: string }) => unknown }) =>
    select({ href: router.pathname }),
}));

const header = (markup: string) => markup.slice(0, markup.indexOf('</header>'));

describe('signed-in application shell', () => {
  beforeEach(() => {
    clerk.state = 'signed-in';
    router.pathname = '/';
  });

  it('keeps the destination links out of the header row until sm', () => {
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));
    const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));

    expect(nav).toContain('hidden');
    expect(nav).toContain('sm:flex');
    for (const href of ['/', '/datasources']) expect(nav).toContain(`href="${href}"`);
    expect(nav).not.toContain('href="/metrics"');
  });

  it('offers a menu button that only exists below sm', () => {
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));
    const menu = markup.slice(markup.indexOf('aria-label="Menu"'));

    expect(markup).toContain('aria-label="Menu"');
    expect(menu.slice(0, menu.indexOf('>'))).toContain('sm:hidden');
  });

  it('shows neither navigation nor menu button when signed out', () => {
    clerk.state = 'signed-out';
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));

    expect(markup).not.toContain('aria-label="Menu"');
    expect(markup).not.toContain('href="/datasources"');
  });
});

describe('signed-out access actions', () => {
  it.each([
    ['public', 'Create account'],
    ['waitlist', 'Join waitlist'],
    ['restricted', null],
    [undefined, null],
  ] as const)('follows Clerk access mode %s', (mode, label) => {
    clerk.state = 'signed-out';
    clerk.mode = mode;
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));

    expect(markup).toContain('Sign in');
    expect(markup.includes('Create account')).toBe(label === 'Create account');
    expect(markup.includes('Join waitlist')).toBe(label === 'Join waitlist');
  });
});

// Scoped to the nav so the "yresonance" wordmark does not shadow the Dashboards link.
const navLinkFor = (markup: string, href: string) => {
  const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));
  const start = nav.indexOf(`href="${href}"`);
  return nav.slice(nav.lastIndexOf('<a', start), nav.indexOf('>', start));
};

describe('active section marking', () => {
  beforeEach(() => {
    clerk.state = 'signed-in';
  });

  it('marks only the section the route belongs to', () => {
    router.pathname = '/datasources';
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));

    expect(navLinkFor(markup, '/datasources')).toContain('border-foreground');
    expect(navLinkFor(markup, '/datasources')).toContain('text-foreground');
    expect(navLinkFor(markup, '/')).toContain('text-muted-foreground');
  });

  it('keeps datasources marked on a datasource detail route', () => {
    router.pathname = '/datasources/ds_1';
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));

    expect(navLinkFor(markup, '/datasources')).toContain('border-foreground');
  });

  it('leaves dashboards unmarked away from the root, since every route starts with it', () => {
    router.pathname = '/datasources';
    const markup = header(renderWithAuth(<AppShell>content</AppShell>));

    expect(navLinkFor(markup, '/')).toContain('border-transparent');
    expect(navLinkFor(markup, '/')).not.toContain('border-foreground');
  });
});

function renderWithAuth(children: ReactNode) {
  return renderToStaticMarkup(
    <AuthProvider state={{ provider: 'clerk', userId: null, orgId: null, sessionId: null }}>
      {children}
    </AuthProvider>,
  );
}

it('renders Keycloak pages when Clerk services are unavailable', () => {
  clerk.forbidden = true;
  try {
    const signedOut = header(
      renderToStaticMarkup(
        <AuthProvider state={{ provider: 'keycloak', userId: null, orgId: null, sessionId: null }}>
          <AppShell>
            <LandingPage />
          </AppShell>
        </AuthProvider>,
      ),
    );
    expect(signedOut).toContain('Sign in');
    expect(signedOut).not.toContain('Create account');
    expect(signedOut).not.toContain('Join waitlist');
    const signedIn = header(
      renderToStaticMarkup(
        <AuthProvider
          state={{
            provider: 'keycloak',
            userId: 'kc_user',
            orgId: 'workspace',
            sessionId: 'session',
          }}
        >
          <QueryClientProvider client={new QueryClient()}>
            <AppShell>content</AppShell>
          </QueryClientProvider>
        </AuthProvider>,
      ),
    );
    expect(signedIn).toContain('aria-label="Workspaces"');
    expect(signedIn).not.toContain('data-testid="user-button"');
  } finally {
    clerk.forbidden = false;
  }
});
