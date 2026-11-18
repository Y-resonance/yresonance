import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import * as client from 'openid-client';
import { z } from 'zod';
import { openConnection, sealConnection } from '#/data/connection-secrets';
import { users } from '#/db/schema';
import { database } from '#/server/database.server';
import type { DirectoryUser } from '../config';
import { settings } from '../settings';

/** The one workspace of an OIDC deployment. */
export const OIDC_ORG_ID = 'default';

const LOGIN_PATH = '/auth/login';
const CALLBACK_PATH = '/auth/callback';
const LOGOUT_PATH = '/auth/logout';
const SESSION_COOKIE = 'yresonance_session';
const LOGIN_COOKIE = 'yresonance_login';
const LOGIN_SECONDS = 600;
// The provider decides how long a session lives through its refresh token. The cookie only
// has to outlast it.
const SESSION_COOKIE_SECONDS = 30 * 24 * 60 * 60;
// Browsers cap one cookie near 4096 bytes including its name and attributes.
const COOKIE_CHUNK = 3500;
const REFRESH_LEEWAY_MS = 30_000;
// Reachable while signed out: share links, health probes, legal pages and every API route,
// which authenticate on their own.
const publicPaths = /^\/(share|api|auth|_serverFn)\/|^\/(health|ready|imprint|privacy|terms)$/;

const sessionSchema = z.object({
  userId: z.string(),
  // Stable for one login, so browser caches keyed by it never cross identities.
  sessionId: z.string(),
  isAdmin: z.boolean(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  imageUrl: z.string().nullable(),
  // When the access token, and with it the role snapshot, expires. Epoch milliseconds.
  expiresAt: z.number(),
  refreshToken: z.string().optional(),
  idToken: z.string(),
});
export type OidcSession = z.infer<typeof sessionSchema>;

const loginSchema = z.object({
  state: z.string(),
  verifier: z.string(),
  nonce: z.string(),
  returnTo: z.string(),
});

const profileSchema = z.object({
  sub: z.string().min(1),
  sid: z.string().optional(),
  email: z.string().optional(),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
  picture: z.string().optional(),
});

// Keycloak lists realm roles under realm_access and client roles under resource_access.
// Other providers commonly use a flat roles claim.
const rolesSchema = z.object({
  realm_access: z.object({ roles: z.array(z.string()) }).optional(),
  resource_access: z
    .record(z.string(), z.object({ roles: z.array(z.string()).optional() }))
    .optional(),
  roles: z.array(z.string()).optional(),
});

function oidcSettings() {
  const env = settings();
  const required = {
    issuer: env.OIDC_ISSUER_URL,
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    sessionSecret: env.OIDC_SESSION_SECRET,
  };
  for (const [name, value] of Object.entries(required))
    if (!value) throw new Error(`The oidc() auth adapter is missing its ${name} setting.`);
  return { ...required, adminRole: env.OIDC_ADMIN_ROLE || 'yresonance-admin' };
}

let discovered: { issuer: string; configuration: Promise<client.Configuration> } | undefined;

// Provider metadata rarely changes. Discover once and retry after a failure.
function configuration() {
  const { issuer, clientId, clientSecret } = oidcSettings();
  if (discovered?.issuer !== issuer) {
    const pending = client.discovery(new URL(issuer), clientId, clientSecret, undefined, {
      execute: new URL(issuer).protocol === 'http:' ? [client.allowInsecureRequests] : [],
      timeout: 10,
    });
    discovered = { issuer, configuration: pending };
    pending.catch(() => {
      if (discovered?.configuration === pending) discovered = undefined;
    });
  }
  return discovered.configuration;
}

/**
 * Roles carried by an access token. The token came straight from the provider's token
 * endpoint over TLS, so its payload is read without verifying the signature again. An opaque
 * access token carries no roles.
 */
export function tokenRoles(accessToken: string, clientId: string) {
  const payload = accessToken.split('.')[1];
  if (!payload) return [];
  try {
    const claims = rolesSchema.parse(
      JSON.parse(atob(payload.replaceAll('-', '+').replaceAll('_', '/'))),
    );
    return [
      ...(claims.realm_access?.roles ?? []),
      ...(claims.resource_access?.[clientId]?.roles ?? []),
      ...(claims.roles ?? []),
    ];
  } catch {
    return [];
  }
}

function sessionFromTokens(
  tokens: client.TokenEndpointResponse & client.TokenEndpointResponseHelpers,
  previous?: OidcSession,
): OidcSession {
  const { clientId, adminRole } = oidcSettings();
  // A refresh may omit the ID token and the refresh token. Keep what the login returned.
  const claims = tokens.claims();
  const profile = claims ? profileSchema.parse(claims) : undefined;
  const idToken = tokens.id_token ?? previous?.idToken;
  if (!idToken) throw new Error('The provider returned no ID token.');
  const userId = profile?.sub ?? previous?.userId;
  if (!userId) throw new Error('The provider returned no subject.');
  return {
    userId,
    sessionId: previous?.sessionId ?? profile?.sid ?? crypto.randomUUID(),
    isAdmin: tokenRoles(tokens.access_token, clientId).includes(adminRole),
    email: profile ? (profile.email?.toLowerCase() ?? null) : (previous?.email ?? null),
    name: profile ? (profile.name ?? profile.preferred_username ?? null) : (previous?.name ?? null),
    imageUrl: profile ? (profile.picture ?? null) : (previous?.imageUrl ?? null),
    // Without expires_in the snapshot is re-checked after five minutes.
    expiresAt: Date.now() + (tokens.expiresIn() ?? 300) * 1000,
    refreshToken: tokens.refresh_token ?? previous?.refreshToken,
    idToken,
  };
}

function readCookie(request: Request, name: string) {
  const cookies = new Map(
    (request.headers.get('cookie') ?? '').split(';').map((entry) => {
      const [key, ...value] = entry.trim().split('=');
      return [key, value.join('=')] as const;
    }),
  );
  // Large values are split across name.0, name.1, ...
  let value = '';
  for (let index = 0; cookies.has(`${name}.${index}`); index += 1)
    value += cookies.get(`${name}.${index}`);
  return value || undefined;
}

function writeCookie(request: Request, name: string, value: string, seconds: number) {
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const attributes = `Path=/; HttpOnly; SameSite=Lax${secure}`;
  const chunks = Array.from({ length: Math.ceil(value.length / COOKIE_CHUNK) }, (_, index) =>
    value.slice(index * COOKIE_CHUNK, (index + 1) * COOKIE_CHUNK),
  );
  const stale = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((entry) => entry.trim().split('=')[0])
    .filter(
      (key) => key.startsWith(`${name}.`) && Number(key.slice(name.length + 1)) >= chunks.length,
    );
  return [
    ...chunks.map((chunk, index) => `${name}.${index}=${chunk}; ${attributes}; Max-Age=${seconds}`),
    ...stale.map((key) => `${key}=; ${attributes}; Max-Age=0`),
  ];
}

const seal = (value: unknown, purpose: string) =>
  sealConnection(value, oidcSettings().sessionSecret, 'oidc', purpose);

async function unseal<T>(value: string | undefined, purpose: string, schema: z.ZodType<T>) {
  if (!value) return undefined;
  try {
    return schema.parse(await openConnection(value, oidcSettings().sessionSecret, 'oidc', purpose));
  } catch {
    // Tampered, expired-format or foreign cookies count as signed out.
    return undefined;
  }
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

function loginUrl(request: Request) {
  const url = new URL(request.url);
  return `${LOGIN_PATH}?returnTo=${encodeURIComponent(url.pathname + url.search)}`;
}

async function recordUser(session: OidcSession) {
  const values = {
    id: session.userId,
    email: session.email,
    name: session.name,
    imageUrl: session.imageUrl,
    lastSeenAt: new Date().toISOString(),
  };
  // An address belongs to whoever signed in with it last, so a share by email never reaches
  // a previous owner. The lock makes simultaneous sign-ins with one address take turns.
  const email = session.email;
  await database().transaction(async (tx) => {
    if (email) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
      await tx
        .update(users)
        .set({ email: null })
        .where(and(eq(users.email, email), ne(users.id, session.userId)));
    }
    await tx.insert(users).values(values).onConflictDoUpdate({ target: users.id, set: values });
  });
}

async function login(request: Request) {
  const url = new URL(request.url);
  const destination = URL.parse(url.searchParams.get('returnTo') ?? '/', url.origin);
  // Only ever return into this application, and never into a route that starts sign-in again.
  // A path may still begin with "//" after dot segments are resolved ("/.//host"), which a
  // browser reads as another host.
  const returnTo =
    destination?.origin === url.origin &&
    !/^\/(\/|auth\/|sign-in|sign-up)/.test(destination.pathname)
      ? destination.pathname + destination.search + destination.hash
      : '/';
  const pending = {
    state: client.randomState(),
    verifier: client.randomPKCECodeVerifier(),
    nonce: client.randomNonce(),
    returnTo,
  };
  const authorizationUrl = client.buildAuthorizationUrl(await configuration(), {
    redirect_uri: url.origin + CALLBACK_PATH,
    scope: 'openid email profile',
    state: pending.state,
    nonce: pending.nonce,
    code_challenge: await client.calculatePKCECodeChallenge(pending.verifier),
    code_challenge_method: 'S256',
  });
  return redirect(
    authorizationUrl.href,
    writeCookie(request, LOGIN_COOKIE, await seal(pending, 'login'), LOGIN_SECONDS),
  );
}

async function callback(request: Request) {
  const clearLogin = writeCookie(request, LOGIN_COOKIE, '', 0);
  try {
    const pending = await unseal(readCookie(request, LOGIN_COOKIE), 'login', loginSchema);
    if (!pending) throw new Error('The login attempt expired.');
    const tokens = await client.authorizationCodeGrant(
      await configuration(),
      new URL(request.url),
      {
        pkceCodeVerifier: pending.verifier,
        expectedState: pending.state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      },
    );
    const session = sessionFromTokens(tokens);
    await recordUser(session);
    console.info('yresonance.auth_login', { result: 'success', isAdmin: session.isAdmin });
    return redirect(pending.returnTo, [
      ...clearLogin,
      ...writeCookie(
        request,
        SESSION_COOKIE,
        await seal(session, 'session'),
        SESSION_COOKIE_SECONDS,
      ),
    ]);
  } catch (error) {
    console.warn('yresonance.auth_login', {
      result: 'error',
      reason: error instanceof Error ? error.message : 'unknown',
    });
    const headers = new Headers({ 'Content-Type': 'text/html; charset=utf-8' });
    for (const cookie of clearLogin) headers.append('Set-Cookie', cookie);
    return new Response(`<p>Sign-in failed. <a href="${LOGIN_PATH}">Try again</a></p>`, {
      status: 400,
      headers,
    });
  }
}

async function logout(request: Request) {
  const url = new URL(request.url);
  // Sign-out is a same-origin form post, so another site cannot end the session. The browser's
  // Sec-Fetch-Site decides, because Origin is "null" under Referrer-Policy: no-referrer. Origin
  // covers clients that do not send it.
  const fetchSite = request.headers.get('sec-fetch-site');
  const sameOrigin = fetchSite
    ? fetchSite === 'same-origin'
    : request.headers.get('origin') === url.origin;
  if (request.method !== 'POST' || !sameOrigin)
    return new Response('Sign out from the application.', { status: 405 });
  const session = await unseal(readCookie(request, SESSION_COOKIE), 'session', sessionSchema);
  let location = '/';
  if (session) {
    try {
      const provider = await configuration();
      if (provider.serverMetadata().end_session_endpoint)
        location = client.buildEndSessionUrl(provider, {
          id_token_hint: session.idToken,
          post_logout_redirect_uri: `${url.origin}/`,
        }).href;
    } catch {
      // The local session still ends when the provider is unreachable.
      console.warn('yresonance.auth_logout', { result: 'provider_unavailable' });
    }
  }
  console.info('yresonance.auth_logout', { result: 'success' });
  return redirect(location, writeCookie(request, SESSION_COOKIE, '', 0));
}

/** Reads the session cookie and refreshes it once the access token has expired. */
async function resolveSession(request: Request) {
  const session = await unseal(readCookie(request, SESSION_COOKIE), 'session', sessionSchema);
  if (!session) return { session: null, cookies: [] };
  if (session.expiresAt - REFRESH_LEEWAY_MS > Date.now()) return { session, cookies: [] };
  const clear = writeCookie(request, SESSION_COOKIE, '', 0);
  if (!session.refreshToken) return { session: null, cookies: clear };
  try {
    const refreshed = sessionFromTokens(
      await client.refreshTokenGrant(await configuration(), session.refreshToken),
      session,
    );
    if (refreshed.userId !== session.userId) throw new Error('The refreshed subject changed.');
    return {
      session: refreshed,
      cookies: writeCookie(
        request,
        SESSION_COOKIE,
        await seal(refreshed, 'session'),
        SESSION_COOKIE_SECONDS,
      ),
    };
  } catch (error) {
    // A rejected refresh token ends the session. An unreachable or failing provider only
    // fails this request, so an outage does not sign everyone out.
    const rejected = error instanceof client.ResponseBodyError && error.error === 'invalid_grant';
    console.warn('yresonance.auth_refresh', { result: rejected ? 'rejected' : 'unavailable' });
    return { session: null, cookies: rejected ? clear : [] };
  }
}

/**
 * Handles one request for the OIDC adapter. It answers the auth routes itself and sends
 * signed-out page visits to the login. Otherwise it returns the session plus cookies the
 * caller must add to its response.
 */
export async function handleOidcRequest(
  request: Request,
): Promise<{ response: Response } | { session: OidcSession | null; cookies: string[] }> {
  const { pathname } = new URL(request.url);
  if (pathname === LOGIN_PATH) return { response: await login(request) };
  if (pathname === CALLBACK_PATH) return { response: await callback(request) };
  if (pathname === LOGOUT_PATH) return { response: await logout(request) };
  const resolved = await resolveSession(request);
  const isPageVisit =
    request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html');
  if (!resolved.session && isPageVisit && !publicPaths.test(pathname))
    return { response: redirect(loginUrl(request), resolved.cookies) };
  return resolved;
}

export function identityOf(session: OidcSession | null) {
  return session
    ? { userId: session.userId, orgId: OIDC_ORG_ID, orgSlug: null, isAdmin: session.isAdmin }
    : { userId: null, orgId: null, orgSlug: null, isAdmin: false };
}

export async function directoryUsers(
  query: { userIds: string[] } | { emails: string[] },
): Promise<DirectoryUser[]> {
  return database()
    .select({ id: users.id, email: users.email, name: users.name, imageUrl: users.imageUrl })
    .from(users)
    .where(
      'userIds' in query
        ? inArray(users.id, query.userIds)
        : inArray(
            users.email,
            query.emails.map((email) => email.toLowerCase()),
          ),
    );
}

/** Everyone who has signed in belongs to the single workspace. */
export async function directoryMembers(userIds: string[]) {
  const rows = await database()
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, userIds));
  return rows.map((row) => row.id);
}
