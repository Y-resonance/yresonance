import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BrowserSession } from '../ui';
import { oidcUi } from './oidc-ui';

const ui = oidcUi();

function stateFor(session: BrowserSession | null) {
  let state!: ReturnType<typeof ui.useAuth>;
  function Probe() {
    state = ui.useAuth();
    return null;
  }
  renderToStaticMarkup(
    <ui.Provider session={session}>
      <Probe />
    </ui.Provider>,
  );
  return state;
}

describe('OIDC UI adapter', () => {
  it('is signed in with the identity the server resolved', () => {
    const user = { name: 'Ada', email: 'ada@example.test', imageUrl: null };

    expect(stateFor({ userId: 'sub-1', orgId: 'default', sessionId: 'sid-1', user })).toEqual({
      isLoaded: true,
      isSignedIn: true,
      userId: 'sub-1',
      orgId: 'default',
      sessionId: 'sid-1',
      user,
    });
  });

  it('is loaded and signed out without a server session', () => {
    expect(stateFor(null)).toMatchObject({ isLoaded: true, isSignedIn: false, userId: null });
  });
});
