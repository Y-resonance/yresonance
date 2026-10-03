import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

const clerk = vi.hoisted(() => ({ state: 'signed-in' as 'signed-in' | 'signed-out' }));
const router = vi.hoisted(() => ({ pathname: '/' }));

vi.mock('@clerk/tanstack-react-start', () => ({
  Show: ({ when, children }: { when: string; children: ReactNode }) =>
    when === clerk.state ? children : null,
  UserButton: () => <span data-testid="user-button" />,
  SignInButton: ({ children }: { children: ReactNode }) => children,
  SignUpButton: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ isLoaded: true, isSignedIn: true, orgId: 'org_1' }),
  useUser: () => ({ isLoaded: true, user: {} }),
  useOrganizationList: () => ({ isLoaded: true }),
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
    clerk.state = 'signed-in';
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

  it('shows neither navigation nor menu button when signed out', () => {
    clerk.state = 'signed-out';
    const markup = header(renderToStaticMarkup(<AppShell>content</AppShell>));

    expect(markup).not.toContain('aria-label="Menu"');
    expect(markup).not.toContain('href="/datasources"');
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
