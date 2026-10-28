import * as oidc from 'openid-client';
import { env } from 'cloudflare:workers';
import { getRequest } from '@tanstack/react-start/server';
import { and, eq, gt, lt } from 'drizzle-orm';
import { z } from 'zod';
import { authLoginStates, authSessions, authUsers, workspaceMembers } from '#/db/schema';
import { database } from '#/server/database.server';
import { ApiError } from '#/server/errors';
import { openConnection, sealConnection } from '#/data/connection-secrets';
import { authProvider, keycloakSettings } from './config.server';

const profileSchema = z.object({
  sub: z.string().min(1),
  email: z.email(),
  email_verified: z.literal(true),
  name: z.string().optional(),
  preferred_username: z.string().optional(),
});

async function configuration() {
  const settings = keycloakSettings();
  return oidc.discovery(
    new URL(settings.issuer),
    settings.clientId,
    settings.clientSecret,
    undefined,
    {
      execute: [
        oidc.enableNonRepudiationChecks,
        ...(new URL(settings.issuer).protocol === 'http:' ? [oidc.allowInsecureRequests] : []),
      ],
      timeout: 10,
    },
  );
}

function cookieName(kind: 'session' | 'login') {
  return `${keycloakSettings().appUrl.startsWith('https:') ? '__Host-' : ''}yresonance-${kind}`;
}
function cookie(request: Request, kind: 'session' | 'login') {
  const name = cookieName(kind);
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}
function setCookie(kind: 'session' | 'login', value: string, seconds: number) {
  return `${cookieName(kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${keycloakSettings().appUrl.startsWith('https:') ? '; Secure' : ''}`;
}
async function tokenHash(value: string) {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function readKeycloakSession(request: Request = getRequest()) {
  const token = cookie(request, 'session');
  if (!token || token.length > 200) return null;
  const [row] = await database()
    .select({ session: authSessions, user: authUsers })
    .from(authSessions)
    .innerJoin(authUsers, eq(authUsers.id, authSessions.userId))
    .where(
      and(
        eq(authSessions.id, await tokenHash(token)),
        gt(authSessions.expiresAt, Date.now()),
        eq(authUsers.issuer, keycloakSettings().issuer),
      ),
    );
  return row ?? null;
}
export async function requireKeycloakSession() {
  if (authProvider() !== 'keycloak')
    throw new ApiError(
      400,
      'unsupported_auth_provider',
      'This action requires Keycloak authentication.',
    );
  const session = await readKeycloakSession();
  if (!session) throw new ApiError(401, 'unauthenticated', 'Sign in to continue.');
  return session;
}

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({
    Location: location,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}

export async function handleKeycloakAuth(request: Request, action: string) {
  if (authProvider() !== 'keycloak') return new Response('Not found.', { status: 404 });
  const settings = keycloakSettings();
  const url = new URL(request.url);
  if (url.origin !== settings.appUrl)
    return new Response('Authentication origin does not match AUTH_APP_URL.', { status: 400 });
  if (action === 'login' && request.method === 'GET') {
    const config = await configuration();
    const token = oidc.randomState();
    const verifier = oidc.randomPKCECodeVerifier();
    const nonce = oidc.randomNonce();
    const candidate = url.searchParams.get('returnTo') ?? '/';
    const destination = URL.parse(candidate, settings.appUrl) ?? new URL(settings.appUrl);
    const returnTo =
      destination.origin === settings.appUrl && !destination.pathname.startsWith('/api/auth/')
        ? `${destination.pathname}${destination.search}${destination.hash}`
        : '/';
    await database().delete(authLoginStates).where(lt(authLoginStates.expiresAt, Date.now()));
    await database().delete(authSessions).where(lt(authSessions.expiresAt, Date.now()));
    await database()
      .insert(authLoginStates)
      .values({
        id: await tokenHash(token),
        verifier,
        nonce,
        returnTo,
        expiresAt: Date.now() + 600_000,
      });
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${settings.appUrl}/api/auth/callback`,
      scope: 'openid email profile',
      state: token,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
    });
    return redirect(authorizationUrl.href, [setCookie('login', token, 600)]);
  }
  if (action === 'callback' && request.method === 'GET') {
    try {
      const state = url.searchParams.get('state');
      if (!state || state.length > 200 || cookie(request, 'login') !== state)
        throw new Error('Invalid login state.');
      // Delete before exchanging the code so callbacks are single-use, including concurrent replays.
      const [pending] = await database()
        .delete(authLoginStates)
        .where(
          and(
            eq(authLoginStates.id, await tokenHash(state)),
            gt(authLoginStates.expiresAt, Date.now()),
          ),
        )
        .returning();
      if (!pending) throw new Error('Expired login state.');
      const tokens = await oidc.authorizationCodeGrant(await configuration(), url, {
        pkceCodeVerifier: pending.verifier,
        expectedState: state,
        expectedNonce: pending.nonce,
        idTokenExpected: true,
      });
      const profile = profileSchema.parse(tokens.claims());
      if (!tokens.id_token) throw new Error('Missing ID token.');
      const id = `kc_${crypto.randomUUID()}`;
      const [user] = await database()
        .insert(authUsers)
        .values({
          id,
          issuer: settings.issuer,
          subject: profile.sub,
          email: profile.email.toLowerCase(),
          name: profile.name ?? profile.preferred_username ?? profile.email,
        })
        .onConflictDoUpdate({
          target: [authUsers.issuer, authUsers.subject],
          set: {
            email: profile.email.toLowerCase(),
            name: profile.name ?? profile.preferred_username ?? profile.email,
          },
        })
        .returning();
      const [membership] = await database()
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.userId, user.id))
        .limit(1);
      const token = oidc.randomState();
      const sessionId = await tokenHash(token);
      const previous = await readKeycloakSession(request);
      if (previous)
        await database().delete(authSessions).where(eq(authSessions.id, previous.session.id));
      await database()
        .insert(authSessions)
        .values({
          id: sessionId,
          userId: user.id,
          workspaceId: membership?.workspaceId ?? null,
          expiresAt: Date.now() + settings.sessionSeconds * 1000,
          encryptedIdToken: await sealConnection(
            tokens.id_token,
            env.UPLOAD_SIGNING_SECRET,
            sessionId,
            'auth-id-token',
          ),
        });
      console.info('auth_login', { provider: 'keycloak', result: 'success', userId: user.id });
      return redirect(pending.returnTo, [
        setCookie('login', '', 0),
        setCookie('session', token, settings.sessionSeconds),
      ]);
    } catch {
      console.warn('auth_login', { provider: 'keycloak', result: 'error' });
      return redirect('/sign-in?error=login_failed', [setCookie('login', '', 0)]);
    }
  }
  if (action === 'logout' && request.method === 'POST') {
    if (
      request.headers.get('origin') !== settings.appUrl ||
      request.headers.get('sec-fetch-site') === 'cross-site'
    )
      return new Response('Cross-origin request rejected.', { status: 403 });
    const current = await readKeycloakSession(request);
    let location = settings.appUrl;
    if (current) {
      // Revoke locally even if the identity provider is unavailable during logout.
      await database().delete(authSessions).where(eq(authSessions.id, current.session.id));
      try {
        const config = await configuration();
        if (config.serverMetadata().end_session_endpoint) {
          const idToken = z
            .string()
            .parse(
              await openConnection(
                current.session.encryptedIdToken,
                env.UPLOAD_SIGNING_SECRET,
                current.session.id,
                'auth-id-token',
              ),
            );
          location = oidc.buildEndSessionUrl(config, {
            id_token_hint: idToken,
            post_logout_redirect_uri: settings.appUrl,
          }).href;
        }
      } catch {
        console.warn('auth_logout', { provider: 'keycloak', result: 'provider_unavailable' });
      }
    }
    console.info('auth_logout', { provider: 'keycloak', result: 'success' });
    return redirect(location, [setCookie('session', '', 0), setCookie('login', '', 0)]);
  }
  return new Response('Not found.', { status: 404 });
}
