import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  directoryMembers,
  directoryUsers,
  handleOidcRequest,
  identityOf,
  tokenRoles,
} from '#/platform/adapters/oidc-flow';

const app = 'https://yresonance.test';
const issuer = 'https://id.example.test/realms/acme';
const clientId = 'test-oidc-client';

const jwt = (claims: object) =>
  [{ alg: 'RS256', typ: 'JWT' }, claims, 'unverified']
    .map((part) =>
      btoa(typeof part === 'string' ? part : JSON.stringify(part))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replaceAll('=', ''),
    )
    .join('.');

interface Person {
  sub: string;
  email?: string;
  name?: string;
  roles?: string[];
}

/**
 * Stands in for the identity provider's HTTP endpoints. No Keycloak runs; everything on this
 * side of the network is the real adapter.
 */
function identityProvider(person: Person) {
  const provider = {
    person,
    nonce: undefined as string | undefined,
    rejectRefresh: false,
    tokenRequests: [] as URLSearchParams[],
  };
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (!url.href.startsWith(issuer)) return original(input as RequestInfo, init);
    if (url.pathname.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        end_session_endpoint: `${issuer}/logout`,
        jwks_uri: `${issuer}/certs`,
      });
    const body = new URLSearchParams(await request.text());
    provider.tokenRequests.push(body);
    if (body.get('grant_type') === 'refresh_token' && provider.rejectRefresh)
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    const now = Math.floor(Date.now() / 1000);
    return Response.json({
      access_token: jwt({ realm_access: { roles: provider.person.roles ?? [] } }),
      token_type: 'Bearer',
      expires_in: 300,
      refresh_token: 'refresh-token',
      id_token: jwt({
        iss: issuer,
        aud: clientId,
        sub: provider.person.sub,
        email: provider.person.email,
        name: provider.person.name,
        sid: `sid-${provider.person.sub}`,
        nonce: provider.nonce,
        iat: now,
        exp: now + 300,
      }),
    });
  });
  return provider;
}

/** A browser that keeps the cookies the application sets. */
function browser() {
  const cookies = new Map<string, string>();
  return {
    cookies,
    async request(path: string, init: RequestInit = {}) {
      const headers = new Headers({ accept: 'text/html', ...init.headers });
      headers.set('cookie', [...cookies].map(([name, value]) => `${name}=${value}`).join('; '));
      const result = await handleOidcRequest(new Request(app + path, { ...init, headers }));
      const set = 'response' in result ? result.response.headers.getSetCookie() : result.cookies;
      for (const cookie of set) {
        const [pair] = cookie.split(';');
        const [name, ...value] = pair!.split('=');
        if (cookie.includes('Max-Age=0')) cookies.delete(name!);
        else cookies.set(name!, value.join('='));
      }
      return result;
    },
  };
}

type Provider = ReturnType<typeof identityProvider>;

async function signIn(provider: Provider, visitor = browser(), returnTo = '/datasources') {
  const login = await visitor.request(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  if (!('response' in login)) throw new Error('Login did not answer.');
  const authorization = new URL(login.response.headers.get('location')!);
  provider.nonce = authorization.searchParams.get('nonce') ?? undefined;
  const callback = await visitor.request(
    `/auth/callback?code=code&state=${authorization.searchParams.get('state')}`,
  );
  if (!('response' in callback)) throw new Error('Callback did not answer.');
  return { visitor, authorization, callback: callback.response };
}

async function identity(visitor: ReturnType<typeof browser>, path = '/') {
  const result = await visitor.request(path);
  return 'response' in result ? result.response : identityOf(result.session);
}

const uniqueSub = () => `sub-${crypto.randomUUID()}`;

afterEach(() => {
  vi.useRealTimers();
});

describe('OIDC sign-in', () => {
  test('signs a user in through the code flow with PKCE and returns to the requested page', async () => {
    const sub = uniqueSub();
    const provider = identityProvider({ sub, email: 'Ada@Example.test', name: 'Ada' });

    const { visitor, authorization, callback } = await signIn(provider);

    expect(authorization.href.startsWith(`${issuer}/auth?`)).toBe(true);
    expect(Object.fromEntries(authorization.searchParams)).toMatchObject({
      client_id: clientId,
      redirect_uri: `${app}/auth/callback`,
      response_type: 'code',
      code_challenge_method: 'S256',
    });
    expect(provider.tokenRequests[0]!.get('code_verifier')).toBeTruthy();
    expect(callback.status).toBe(303);
    expect(callback.headers.get('location')).toBe('/datasources');
    expect(callback.headers.getSetCookie().every((cookie) => cookie.includes('HttpOnly'))).toBe(
      true,
    );
    // Every signed-in user works in the single workspace, as an editor unless the role says so.
    expect(await identity(visitor)).toEqual({
      userId: sub,
      orgId: 'default',
      orgSlug: null,
      isAdmin: false,
    });
  });

  test.each([
    ['https://evil.example/steal', '/'],
    ['//evil.example', '/'],
    ['/auth/login', '/'],
    ['/sign-in', '/'],
    ['/dashboards/d1?page=2', '/dashboards/d1?page=2'],
  ])('only ever returns into the application (%s)', async (returnTo, destination) => {
    const provider = identityProvider({ sub: uniqueSub() });

    const { callback } = await signIn(provider, browser(), returnTo);

    expect(callback.headers.get('location')).toBe(destination);
  });

  test('rejects a callback that does not belong to the login this browser started', async () => {
    const provider = identityProvider({ sub: uniqueSub() });
    const visitor = browser();
    await visitor.request('/auth/login');

    const callback = await visitor.request('/auth/callback?code=code&state=forged');

    expect('response' in callback && callback.response.status).toBe(400);
    expect(provider.tokenRequests).toHaveLength(0);
    expect(await identity(visitor, '/api/yresonance')).toMatchObject({ userId: null });
  });

  test('treats a session cookie it did not seal as signed out', async () => {
    const { visitor } = await signIn(identityProvider({ sub: uniqueSub() }));
    const [name, value] = [...visitor.cookies].find(([key]) =>
      key.startsWith('yresonance_session'),
    )!;
    visitor.cookies.set(name, value.slice(0, -4) + (value.endsWith('AAAA') ? 'BBBB' : 'AAAA'));

    expect(await identity(visitor, '/api/yresonance')).toMatchObject({ userId: null });
  });
});

describe('OIDC admin role', () => {
  test('makes a user with the configured realm role an admin', async () => {
    const { visitor } = await signIn(
      identityProvider({ sub: uniqueSub(), roles: ['offline_access', 'yresonance-admin'] }),
    );

    expect(await identity(visitor)).toMatchObject({ isAdmin: true });
  });

  test('reads realm roles, roles of this client and a flat roles claim', () => {
    const roles = (claims: object) => tokenRoles(jwt(claims), clientId);

    expect(roles({ realm_access: { roles: ['a'] } })).toEqual(['a']);
    expect(
      roles({ resource_access: { [clientId]: { roles: ['b'] }, other: { roles: ['x'] } } }),
    ).toEqual(['b']);
    expect(roles({ roles: ['c'] })).toEqual(['c']);
    expect(tokenRoles('opaque-access-token', clientId)).toEqual([]);
  });
});

describe('OIDC session lifetime', () => {
  test('refreshes an expired session and applies role changes made in the provider', async () => {
    const sub = uniqueSub();
    const provider = identityProvider({ sub, roles: ['yresonance-admin'] });
    const { visitor } = await signIn(provider);
    provider.person.roles = [];

    // Within the access token lifetime the provider is not asked again.
    expect(await identity(visitor)).toMatchObject({ isAdmin: true });
    expect(provider.tokenRequests).toHaveLength(1);

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 301_000 });
    expect(await identity(visitor)).toMatchObject({ userId: sub, isAdmin: false });
    expect(provider.tokenRequests[1]!.get('grant_type')).toBe('refresh_token');
    // The refreshed session replaced the cookie, so the next request needs no refresh.
    expect(await identity(visitor)).toMatchObject({ userId: sub, isAdmin: false });
    expect(provider.tokenRequests).toHaveLength(2);
  });

  test('signs the user out once the provider rejects the refresh', async () => {
    const provider = identityProvider({ sub: uniqueSub() });
    const { visitor } = await signIn(provider);
    provider.rejectRefresh = true;

    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 301_000 });

    expect(await identity(visitor, '/api/yresonance')).toMatchObject({ userId: null });
    expect([...visitor.cookies.keys()]).toEqual([]);
  });

  test('signs out through a same-origin form post and ends the provider session', async () => {
    const { visitor } = await signIn(identityProvider({ sub: uniqueSub() }));

    const link = await visitor.request('/auth/logout');
    expect('response' in link && link.response.status).toBe(405);
    expect(await identity(visitor)).toMatchObject({ userId: expect.any(String) });

    const logout = await visitor.request('/auth/logout', {
      method: 'POST',
      headers: { origin: app },
    });
    if (!('response' in logout)) throw new Error('Logout did not answer.');
    const location = new URL(logout.response.headers.get('location')!);

    expect(location.href.startsWith(`${issuer}/logout?`)).toBe(true);
    expect(location.searchParams.get('post_logout_redirect_uri')).toBe(`${app}/`);
    expect(location.searchParams.get('id_token_hint')).toBeTruthy();
    expect(await identity(visitor, '/api/yresonance')).toMatchObject({ userId: null });
  });
});

describe('OIDC signed-out visitors', () => {
  test.each(['/', '/datasources?tab=fields', '/sign-in'])(
    'sends a page visit to %s to the login and back afterwards',
    async (path) => {
      identityProvider({ sub: uniqueSub() });

      const response = await identity(browser(), path);

      expect(response).toBeInstanceOf(Response);
      expect((response as Response).headers.get('location')).toBe(
        `/auth/login?returnTo=${encodeURIComponent(path)}`,
      );
    },
  );

  test.each(['/share/unlisted-token', '/api/yresonance', '/health', '/privacy'])(
    'leaves %s reachable without a login',
    async (path) => {
      identityProvider({ sub: uniqueSub() });

      expect(await identity(browser(), path)).toEqual(identityOf(null));
    },
  );
});

describe('OIDC user directory', () => {
  test('records users at login and finds them by id or by email in any spelling', async () => {
    const sub = uniqueSub();
    const email = `${sub}@Example.test`;
    const stranger = uniqueSub();
    await signIn(identityProvider({ sub, email, name: 'Ada Lovelace' }));

    const profile = { id: sub, email: email.toLowerCase(), name: 'Ada Lovelace', imageUrl: null };
    expect(await directoryUsers({ userIds: [sub, stranger] })).toEqual([profile]);
    expect(await directoryUsers({ emails: [email.toUpperCase()] })).toEqual([profile]);
    // Someone who never signed in cannot be found, and is not a member.
    expect(await directoryUsers({ emails: [`${stranger}@example.test`] })).toEqual([]);
    expect(await directoryMembers([sub, stranger])).toEqual([sub]);
  });

  test('keeps the profile current when the user signs in again', async () => {
    const sub = uniqueSub();
    await signIn(identityProvider({ sub, name: 'Before' }));
    await signIn(identityProvider({ sub, name: 'After' }));

    expect(await directoryUsers({ userIds: [sub] })).toMatchObject([{ name: 'After' }]);
  });
});
