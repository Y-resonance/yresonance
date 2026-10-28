import type { ReactNode } from 'react';
import { AuthProvider } from '#/auth/provider';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceGate } from './workspace-gate';

const clerk = vi.hoisted(() => ({
  auth: { isLoaded: true, isSignedIn: true, orgId: null as string | null },
  user: { isLoaded: true, user: { createOrganizationEnabled: true } },
  organizationList: {
    isLoaded: true,
    createOrganization: vi.fn<(params: { name: string }) => Promise<{ id: string }>>(),
    setActive: vi.fn<(params: { organization: string }) => Promise<void>>(),
    userInvitations: {
      data: [] as Array<{
        id: string;
        publicOrganizationData: { id: string; name: string };
        accept: () => Promise<unknown>;
      }>,
      error: null,
      isLoading: false,
      isFetching: false,
      hasNextPage: false,
      fetchNext: vi.fn<() => void>(),
      revalidate: vi.fn<() => Promise<void>>(),
    },
    userMemberships: {
      data: [] as Array<{ id: string; organization: { id: string; name: string } }>,
      error: null,
      isLoading: false,
      isFetching: false,
      hasNextPage: false,
      fetchNext: vi.fn<() => void>(),
      revalidate: vi.fn<() => Promise<void>>(),
    },
  },
}));

vi.mock('@clerk/tanstack-react-start', () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => clerk.auth,
  useUser: () => clerk.user,
  useOrganizationList: () => clerk.organizationList,
}));

describe('WorkspaceGate', () => {
  beforeEach(() => {
    clerk.auth.orgId = null;
    clerk.user.user.createOrganizationEnabled = true;
    clerk.organizationList.userInvitations.data = [];
    clerk.organizationList.userMemberships.data = [];
  });

  it('renders the private route when an organization is already active', () => {
    clerk.auth.orgId = 'org_active';

    expect(renderWithAuth(<WorkspaceGate>Private route</WorkspaceGate>)).toBe('Private route');
  });

  it('shows pending invitations before existing memberships', () => {
    clerk.organizationList.userInvitations.data = [
      {
        id: 'invitation',
        publicOrganizationData: { id: 'org_invited', name: 'Invited workspace' },
        accept: vi.fn<() => Promise<unknown>>(),
      },
    ];
    clerk.organizationList.userMemberships.data = [
      {
        id: 'membership',
        organization: { id: 'org_existing', name: 'Existing workspace' },
      },
    ];

    const html = renderWithAuth(<WorkspaceGate>Private route</WorkspaceGate>);

    expect(html.indexOf('Pending invitations')).toBeLessThan(html.indexOf('Your workspaces'));
    expect(html).toContain('Invited workspace');
    expect(html).toContain('Existing workspace');
    expect(html).not.toContain('Private route');
  });

  it('makes workspace creation the primary choice for a new user', () => {
    const html = renderWithAuth(<WorkspaceGate>Private route</WorkspaceGate>);

    expect(html).toContain('Create a workspace');
    expect(html).toContain('name="workspaceName"');
    expect(html).not.toContain('Pending invitations');
    expect(html).not.toContain('Your workspaces');
  });
});

function renderWithAuth(children: ReactNode) {
  return renderToStaticMarkup(
    <AuthProvider state={{ provider: 'clerk', userId: null, orgId: null, sessionId: null }}>
      {children}
    </AuthProvider>,
  );
}
