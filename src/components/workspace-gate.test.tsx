import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceGate } from './workspace-gate';

const auth = vi.hoisted(() => ({
  state: { isLoaded: true, isSignedIn: true, orgId: null as string | null },
  workspaces: 'multiple' as 'multiple' | 'single',
}));

vi.mock('#/platform/index.ui', () => ({
  useAuth: () => auth.state,
  useAuthCapabilities: () => ({ workspaces: auth.workspaces }),
  WorkspaceSetup: () => 'Provider workspace setup',
}));

const gate = () => renderToStaticMarkup(<WorkspaceGate>Private route</WorkspaceGate>);

describe('WorkspaceGate', () => {
  beforeEach(() => {
    auth.state = { isLoaded: true, isSignedIn: true, orgId: null };
    auth.workspaces = 'multiple';
  });

  it('renders the private route when a workspace is already active', () => {
    auth.state.orgId = 'org_active';

    expect(gate()).toBe('Private route');
  });

  it('hands a user without a workspace to the provider when it has several', () => {
    expect(gate()).toBe('Provider workspace setup');
  });

  it('never asks for a workspace when the provider has exactly one', () => {
    auth.workspaces = 'single';

    expect(gate()).toBe('Private route');
  });

  it('holds the private route back while the provider is loading', () => {
    auth.state.isLoaded = false;

    expect(gate()).toContain('Loading workspaces');
  });
});
