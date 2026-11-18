import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

// Search behavior has browser coverage; shell tests own navigation and responsive layout.
vi.mock('./global-search', () => ({ GlobalSearch: () => null }));

const auth = vi.hoisted(() => ({
  isSignedIn: true,
  signUp: 'public' as 'public' | 'waitlist' | 'none',
}));
const router = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('#/platform/index.ui', () => ({
  useAuth: () => ({
    isLoaded: true,
    isSignedIn: auth.isSignedIn,
    orgId: 'org_1',
    user: { name: 'Ada Lovelace', email: 'ada@example.com', imageUrl: null },
  }),
  useAuthActions: () => ({ signIn: () => {}, getAccess: () => {}, signOut: () => {} }),
  useAuthCapabilities: () => ({ signUp: auth.signUp, workspaces: 'multiple', landing: true }),
}));

// Mirrors how the router merges activeProps and inactiveProps onto the anchor,
// so the shell's active-section marking is exercised rather than assumed.
vi.mock('@tanstack/react-router', () => ({
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
    auth.isSignedIn = true;
    router.pathname = '/';
  });

  it('keeps the destination links out of the header row until sm', () => {
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));
    const nav = markup.slice(markup.indexOf('<nav'), markup.indexOf('</nav>'));

    expect(nav).toContain('hidden');
    expect(nav).toContain('sm:flex');
    for (const href of ['/', '/datasources']) expect(nav).toContain(`href="${href}"`);
    expect(nav).not.toContain('href="/metrics"');
  });

  it('offers a menu button that only exists below sm', () => {
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));
    const menu = markup.slice(markup.indexOf('aria-label="Menu"'));

    expect(markup).toContain('aria-label="Menu"');
    expect(menu.slice(0, menu.indexOf('>'))).toContain('sm:hidden');
  });

  it('offers the account menu instead of sign-in', () => {
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

    expect(markup).toContain('aria-label="Account"');
    expect(markup).not.toContain('Sign in');
  });

  it('shows neither navigation, menu button nor account menu when signed out', () => {
    auth.isSignedIn = false;
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

    expect(markup).not.toContain('aria-label="Menu"');
    expect(markup).not.toContain('aria-label="Account"');
    expect(markup).not.toContain('href="/datasources"');
  });
});

describe('signed-out access actions', () => {
  it.each([
    ['public', 'Create account'],
    ['waitlist', 'Join waitlist'],
    ['none', null],
  ] as const)('follows the sign-up capability %s', (signUp, label) => {
    auth.isSignedIn = false;
    auth.signUp = signUp;
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

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
    auth.isSignedIn = true;
  });

  it('marks only the section the route belongs to', () => {
    router.pathname = '/datasources';
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

    expect(navLinkFor(markup, '/datasources')).toContain('border-foreground');
    expect(navLinkFor(markup, '/datasources')).toContain('text-foreground');
    expect(navLinkFor(markup, '/')).toContain('text-muted-foreground');
  });

  it('keeps datasources marked on a datasource detail route', () => {
    router.pathname = '/datasources/ds_1';
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

    expect(navLinkFor(markup, '/datasources')).toContain('border-foreground');
  });

  it('leaves dashboards unmarked away from the root, since every route starts with it', () => {
    router.pathname = '/datasources';
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

    expect(navLinkFor(markup, '/')).toContain('border-transparent');
    expect(navLinkFor(markup, '/')).not.toContain('border-foreground');
  });
});
