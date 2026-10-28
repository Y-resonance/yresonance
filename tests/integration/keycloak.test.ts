import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createDatabase } from '#/db/client';
import { authLoginStates, authSessions, authUsers } from '#/db/schema';
import { handleKeycloakAuth, readKeycloakSession } from '#/auth/keycloak.server';
import { callService, createDashboard, expectApiError } from './fixtures';

import { requestContext as context } from './doubles/request';
const db = () => createDatabase(env.DB);
const issuer = 'https://keycloak.test/realms/yresonance';
const app = 'https://yresonance.test';
const clientId = 'yresonance';
const originalProvider = env.AUTH_PROVIDER;

function encode(value: unknown) {
  return btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
async function oidcServer(overrides: Record<string, unknown> = {}, invalidSignature = false) {
  const keys = await crypto.subtle.generateKey(
    {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    },
    true,
    ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const subject = crypto.randomUUID();
  let nonce = '';
  let challenge = '';
  let tokenRequests = 0;
  let issuedIdToken = '';
  const original = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url);
    if (url.origin !== 'https://keycloak.test') return original(input as RequestInfo, init);
    if (url.pathname.endsWith('/.well-known/openid-configuration'))
      return Response.json({
        issuer,
        authorization_endpoint: `${issuer}/auth`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/certs`,
        end_session_endpoint: `${issuer}/logout`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
      });
    if (url.pathname.endsWith('/certs'))
      return Response.json({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] });
    if (url.pathname.endsWith('/token')) {
      tokenRequests += 1;
      const body = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
      const verifier = body.get('code_verifier');
      const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier ?? '')),
      );
      const actualChallenge = btoa(String.fromCharCode(...digest))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '');
      if (
        !verifier ||
        actualChallenge !== challenge ||
        body.get('redirect_uri') !== `${app}/api/auth/callback` ||
        body.get('client_secret') !== 'test-keycloak-secret'
      )
        return Response.json({ error: 'invalid_grant' }, { status: 400 });
      const now = Math.floor(Date.now() / 1000);
      const payload = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({ iss: issuer, aud: clientId, sub: subject, iat: now, exp: now + 300, nonce, email: `${subject}@example.test`, email_verified: true, name: 'Patrik', ...overrides })}`;
      const signature = new Uint8Array(
        await crypto.subtle.sign(
          'RSASSA-PKCS1-v1_5',
          keys.privateKey,
          new TextEncoder().encode(payload),
        ),
      );
      if (invalidSignature) signature[0] ^= 1;
      issuedIdToken = `${payload}.${btoa(String.fromCharCode(...signature))
        .replaceAll('+', '-')
        .replaceAll('/', '_')
        .replace(/=+$/u, '')}`;
      return Response.json({
        access_token: 'private-access-token',
        token_type: 'Bearer',
        expires_in: 300,
        id_token: issuedIdToken,
      });
    }
    throw new Error(`Unexpected OIDC endpoint: ${url.pathname}`);
  });
  return {
    setAuthorization(url: URL) {
      nonce = url.searchParams.get('nonce') ?? '';
      challenge = url.searchParams.get('code_challenge') ?? '';
    },
    tokenRequests: () => tokenRequests,
    idToken: () => issuedIdToken,
  };
}

function cookies(response: Response) {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}
async function startLogin(server: Awaited<ReturnType<typeof oidcServer>>, returnTo = '/') {
  const response = await handleKeycloakAuth(
    new Request(`${app}/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`),
    'login',
  );
  const authorization = new URL(response.headers.get('location')!);
  server.setAuthorization(authorization);
  const callback = new Request(
    `${app}/api/auth/callback?code=valid-code&state=${authorization.searchParams.get('state')}`,
    { headers: { cookie: cookies(response) } },
  );
  return { callback, response };
}
async function signIn(overrides: Record<string, unknown> = {}) {
  const server = await oidcServer(overrides);
  const { callback } = await startLogin(server);
  const response = await handleKeycloakAuth(callback, 'callback');
  expect(response.headers.get('location')).toBe('/');
  context.request = new Request(app, { headers: { cookie: cookies(response) } });
  const current = await readKeycloakSession(context.request);
  expect(current).not.toBeNull();
  return current!;
}

beforeEach(() => {
  Object.assign(env, {
    AUTH_PROVIDER: 'keycloak',
    AUTH_APP_URL: app,
    KEYCLOAK_ISSUER: issuer,
    KEYCLOAK_CLIENT_ID: clientId,
    KEYCLOAK_CLIENT_SECRET: 'test-keycloak-secret',
  });
});
afterEach(() => {
  env.AUTH_PROVIDER = originalProvider;
});

test('OIDC login validates PKCE, binds the browser, consumes callbacks once, and keeps tokens off the browser', async () => {
  const server = await oidcServer();
  const { callback, response: login } = await startLogin(server, '/datasources');
  expect(login.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Lax');
  expect(login.headers.get('set-cookie')).toContain('Secure');
  const foreign = new Request(callback.url);
  expect((await handleKeycloakAuth(foreign, 'callback')).headers.get('location')).toBe(
    '/sign-in?error=login_failed',
  );
  expect(server.tokenRequests()).toBe(0);
  const response = await handleKeycloakAuth(callback, 'callback');
  expect(response.headers.get('location')).toBe('/datasources');
  expect(response.headers.get('cache-control')).toBe('no-store');
  const browserCookie = cookies(response);
  expect(browserCookie).not.toContain('private-access-token');
  const current = await readKeycloakSession(
    new Request(app, { headers: { cookie: browserCookie } }),
  );
  expect(current?.user.name).toBe('Patrik');
  expect(current?.session.encryptedIdToken).not.toBe(server.idToken());
  expect(browserCookie).not.toContain(server.idToken());
  expect((await handleKeycloakAuth(callback, 'callback')).headers.get('location')).toBe(
    '/sign-in?error=login_failed',
  );
  expect(server.tokenRequests()).toBe(1);
  expect(await db().query.authLoginStates.findFirst()).toBeUndefined();
});

test.each([
  ['wrong issuer', { iss: 'https://attacker.test' }, false],
  ['wrong audience', { aud: 'another-client' }, false],
  ['wrong nonce', { nonce: 'another-login' }, false],
  ['expired token', { exp: 1 }, false],
  ['unverified email', { email_verified: false }, false],
  ['invalid signature', {}, true],
] as const)(
  'rejects %s without issuing an app session',
  async (_name, claims, invalidSignature) => {
    const server = await oidcServer(claims, invalidSignature);
    const { callback } = await startLogin(server);
    const before = await db().select().from(authSessions);
    const response = await handleKeycloakAuth(callback, 'callback');
    expect(response.headers.get('location')).toBe('/sign-in?error=login_failed');
    expect(await db().select().from(authSessions)).toHaveLength(before.length);
  },
);

test('login rejects external return destinations and expired state; logout requires same-origin POST and revokes the session', async () => {
  const server = await oidcServer();
  const { callback } = await startLogin(server, 'https://attacker.test');
  const response = await handleKeycloakAuth(callback, 'callback');
  expect(response.headers.get('location')).toBe('/');
  const browserCookie = cookies(response);
  const logout = (origin: string) =>
    new Request(`${app}/api/auth/logout`, {
      method: 'POST',
      headers: { origin, cookie: browserCookie },
    });
  expect((await handleKeycloakAuth(logout('https://attacker.test'), 'logout')).status).toBe(403);
  expect(
    await readKeycloakSession(new Request(app, { headers: { cookie: browserCookie } })),
  ).not.toBeNull();
  expect((await handleKeycloakAuth(new Request(`${app}/api/auth/logout`), 'logout')).status).toBe(
    404,
  );
  const signedOut = await handleKeycloakAuth(logout(app), 'logout');
  const logoutUrl = new URL(signedOut.headers.get('location')!);
  expect(logoutUrl.href).toContain(`${issuer}/logout`);
  expect(logoutUrl.searchParams.get('id_token_hint')).toBe(server.idToken());
  expect(
    await readKeycloakSession(new Request(app, { headers: { cookie: browserCookie } })),
  ).toBeNull();
  const expired = await startLogin(server);
  await db().update(authLoginStates).set({ expiresAt: 1 });
  expect((await handleKeycloakAuth(expired.callback, 'callback')).headers.get('location')).toBe(
    '/sign-in?error=login_failed',
  );
});

test('workspace invitations, admin roles, dashboard grants, and removals are enforced against real membership rows', async () => {
  const owner = await signIn();
  const ownerRequest = context.request;
  await expectApiError(callService({ action: 'bootstrap' }), {
    status: 409,
    code: 'organization_required',
  });
  const workspace = (await callService({ action: 'createWorkspace', name: 'Team' })) as {
    id: string;
  };
  const dashboard = await createDashboard();
  await expectApiError(
    callService({ action: 'updateWorkspaceMember', userId: owner.user.id, role: 'remove' }),
    { status: 409, code: 'member_update_rejected' },
  );
  const colleague = await signIn();
  const colleagueRequest = context.request;
  context.request = ownerRequest;
  await callService({
    action: 'inviteWorkspaceMember',
    email: colleague.user.email.toUpperCase(),
    role: 'member',
  });
  const outsider = await signIn();
  const outsiderRequest = context.request;
  await expectApiError(callService({ action: 'selectWorkspace', workspaceId: workspace.id }), {
    status: 403,
    code: 'workspace_access_denied',
  });
  context.request = colleagueRequest;
  const invitations = (await callService({ action: 'listWorkspaces' })) as {
    invitations: { id: string }[];
  };
  expect(invitations.invitations).toHaveLength(1);
  context.request = outsiderRequest;
  await expectApiError(
    callService({
      action: 'acceptWorkspaceInvitation',
      invitationId: invitations.invitations[0].id,
    }),
    { status: 404, code: 'invitation_not_found' },
  );
  context.request = colleagueRequest;
  await callService({
    action: 'acceptWorkspaceInvitation',
    invitationId: invitations.invitations[0].id,
  });
  await expectApiError(callService({ action: 'listWorkspaceMembers' }), {
    status: 403,
    code: 'admin_required',
  });
  await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
    status: 403,
    code: 'dashboard_access_denied',
  });
  context.request = ownerRequest;
  await callService({
    action: 'shareDashboard',
    dashboardId: dashboard.id,
    operation: { kind: 'grant', userEmail: colleague.user.email, role: 'viewer' },
  });
  context.request = colleagueRequest;
  expect(await callService({ action: 'getDashboard', dashboardId: dashboard.id })).toMatchObject({
    role: 'viewer',
  });
  context.request = ownerRequest;
  await callService({ action: 'updateWorkspaceMember', userId: colleague.user.id, role: 'admin' });
  await callService({ action: 'updateWorkspaceMember', userId: owner.user.id, role: 'member' });
  await expectApiError(
    callService({ action: 'inviteWorkspaceMember', email: outsider.user.email, role: 'admin' }),
    { status: 403, code: 'admin_required' },
  );
  context.request = colleagueRequest;
  await callService({ action: 'updateWorkspaceMember', userId: owner.user.id, role: 'admin' });
  context.request = ownerRequest;
  await callService({ action: 'updateWorkspaceMember', userId: colleague.user.id, role: 'remove' });
  context.request = colleagueRequest;
  await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
    status: 409,
    code: 'organization_required',
  });
  // Rejoining must not restore a grant removed with the old membership.
  context.request = ownerRequest;
  await callService({
    action: 'inviteWorkspaceMember',
    email: colleague.user.email,
    role: 'member',
  });
  context.request = colleagueRequest;
  const next = (await callService({ action: 'listWorkspaces' })) as {
    invitations: { id: string }[];
  };
  await callService({ action: 'acceptWorkspaceInvitation', invitationId: next.invitations[0].id });
  await expectApiError(callService({ action: 'getDashboard', dashboardId: dashboard.id }), {
    status: 403,
    code: 'dashboard_access_denied',
  });
  await db()
    .update(authSessions)
    .set({ expiresAt: 1 })
    .where(eq(authSessions.id, colleague.session.id));
  await expectApiError(callService({ action: 'listWorkspaces' }), {
    status: 401,
    code: 'unauthenticated',
  });
  expect(
    await db().query.authUsers.findFirst({ where: eq(authUsers.id, outsider.user.id) }),
  ).toBeDefined();
});
