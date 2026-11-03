import { env } from 'cloudflare:workers';
import { clerkClient } from '@clerk/tanstack-react-start/server';
import { and, eq, lt, inArray, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { datasourceAuthorizations, workspaces } from '#/db/schema';
import { database } from '#/server/database.server';
import { requireSession, type SessionContext } from '#/server/auth.server';
import { loadDataSource } from '#/server/records.server';
import { ApiError } from '#/server/errors';
import { datasourceOperation } from '#/server/datasource-operations.server';
import { sealConnection, openConnection, encodeBase64Url } from './connection-secrets';
import { loadConnection } from './connection-store.server';
import { DatasourceError } from './connectors/contract';
import { readResponseText } from './http-response';
import { readJsonResponse } from './bigquery.server';
import type { ApiRequest } from '#/api/contracts';

const scope = 'openid email https://www.googleapis.com/auth/bigquery';
const stateSchema = z.object({
  id: z.string(),
  workspaceId: z.string(),
  userId: z.string(),
  expiresAt: z.number(),
  returnTo: z.string(),
  targetId: z.string().optional(),
});
const grantSchema = z.object({
  refreshToken: z.string().min(1),
  accessToken: z.string().min(1),
  expiresAt: z.number(),
});
const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive(),
  scope: z.string().optional(),
});
export const authorizationReferenceSchema = z.object({ authorizationId: z.string().min(1) });

function configuration() {
  const config = z
    .object({
      clientId: z.string().min(1),
      clientSecret: z.string().min(1),
      redirectUri: z.url(),
      hostedDomain: z.string().min(1),
    })
    .safeParse({
      clientId: env.GOOGLE_OAUTH_CLIENT_ID,
      clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
      redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
      hostedDomain: env.GOOGLE_OAUTH_HOSTED_DOMAIN,
    });
  if (!config.success)
    throw new ApiError(503, 'connection_not_configured', 'Google connection is not configured.');
  const uri = new URL(config.data.redirectUri);
  if (uri.protocol !== 'https:' && !(uri.protocol === 'http:' && uri.hostname === 'localhost'))
    throw new ApiError(503, 'connection_not_configured', 'Google callback must use HTTPS.');
  return config.data;
}

// Same validation as configuration(), so the UI only offers "Connect" when beginning would succeed.
function configured() {
  try {
    configuration();
    return true;
  } catch {
    return false;
  }
}

// Reads the grant a datasource points at. Connection store failures are DatasourceErrors and
// need the same HTTP mapping as every other datasource operation.
function currentAuthorizationReference(dataSourceId: string, workspaceId: string) {
  return datasourceOperation(async () =>
    authorizationReferenceSchema.parse(
      await loadConnection(await loadDataSource(dataSourceId, workspaceId)),
    ),
  );
}

function oauthProvider(provider: string) {
  if (provider !== 'bigquery')
    throw new ApiError(
      400,
      'unsupported_connection',
      'This provider does not use Google authorization.',
    );
}

// Interactive setup always requires the caller's own grant. Execution resolves the saved
// datasource reference instead, after authorizing access to that datasource/dashboard.
export async function requireOwnedGoogleConnection(session: SessionContext, connectionId: string) {
  const row = await database()
    .select({ id: datasourceAuthorizations.id })
    .from(datasourceAuthorizations)
    .where(
      and(
        eq(datasourceAuthorizations.id, connectionId),
        eq(datasourceAuthorizations.workspaceId, session.workspace.id),
        eq(datasourceAuthorizations.createdBy, session.userId),
        eq(datasourceAuthorizations.provider, 'bigquery'),
        inArray(datasourceAuthorizations.status, [
          'connected',
          'reconnect_required',
          'disconnected',
        ]),
      ),
    )
    .get();
  if (!row) throw new ApiError(404, 'connection_not_found', 'Connection not found.');
}

// Clerk's SDK exposes no abort signal. Bound the wait for directory and membership reads.
async function clerkLookup<T>(request: Promise<T>) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Clerk lookup timed out.')), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function connectionOwnerName(workspaceId: string, authorizationId: string) {
  const owner = await database()
    .select({ userId: datasourceAuthorizations.createdBy })
    .from(datasourceAuthorizations)
    .where(
      and(
        eq(datasourceAuthorizations.id, authorizationId),
        eq(datasourceAuthorizations.workspaceId, workspaceId),
        eq(datasourceAuthorizations.provider, 'bigquery'),
      ),
    )
    .get();
  if (!owner) return undefined;
  try {
    const users = await clerkLookup(
      clerkClient().users.getUserList({ userId: [owner.userId], limit: 1 }),
    );
    const user = users.data.find((user) => user.id === owner.userId);
    return (
      [user?.firstName, user?.lastName].filter(Boolean).join(' ') || user?.username || undefined
    );
  } catch {
    console.warn('yresonance.datasource_connection_owner', { workspaceId, result: 'unavailable' });
    return undefined;
  }
}

export async function listDatasourceConnections(provider: string, dataSourceId?: string) {
  oauthProvider(provider);
  const session = await requireSession();
  const savedConnectionId = dataSourceId
    ? (await currentAuthorizationReference(dataSourceId, session.workspace.id)).authorizationId
    : undefined;
  const rows = await database()
    .select({
      id: datasourceAuthorizations.id,
      account: datasourceAuthorizations.account,
      status: datasourceAuthorizations.status,
    })
    .from(datasourceAuthorizations)
    .where(
      and(
        eq(datasourceAuthorizations.workspaceId, session.workspace.id),
        eq(datasourceAuthorizations.createdBy, session.userId),
        eq(datasourceAuthorizations.provider, provider),
        inArray(datasourceAuthorizations.status, [
          'connected',
          'reconnect_required',
          'disconnected',
        ]),
      ),
    );
  const currentConnectionId = rows.find((row) => row.id === savedConnectionId)?.id;
  const canManageCurrentConnection = !dataSourceId || Boolean(currentConnectionId);
  return {
    configured: configured(),
    connections: rows,
    currentConnectionId,
    canManageCurrentConnection,
    currentConnectionOwnerName:
      savedConnectionId && !canManageCurrentConnection
        ? await connectionOwnerName(session.workspace.id, savedConnectionId)
        : undefined,
  };
}

export async function beginDatasourceConnection(
  request: Extract<ApiRequest, { action: 'beginDatasourceConnection' }>,
) {
  oauthProvider(request.provider);
  const session = await requireSession();
  if (request.connectionId) await requireOwnedGoogleConnection(session, request.connectionId);
  const config = configuration();
  const db = database();
  if (request.dataSourceId) {
    const reference = await currentAuthorizationReference(
      request.dataSourceId,
      session.workspace.id,
    );
    await requireOwnedGoogleConnection(session, reference.authorizationId);
    if (reference.authorizationId !== request.connectionId)
      throw new ApiError(400, 'invalid_connection', 'Reconnect the datasource connection.');
  }
  const id = `auth_${crypto.randomUUID()}`;
  const verifier = `${crypto.randomUUID()}${crypto.randomUUID()}`.replaceAll('-', '');
  const challenge = encodeBase64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  const now = new Date().toISOString();
  await db
    .delete(datasourceAuthorizations)
    .where(
      and(
        inArray(datasourceAuthorizations.status, ['pending', 'connecting']),
        lt(datasourceAuthorizations.createdAt, new Date(Date.now() - 600_000).toISOString()),
      ),
    );
  await db.insert(datasourceAuthorizations).values({
    id,
    workspaceId: session.workspace.id,
    provider: request.provider,
    createdBy: session.userId,
    status: 'pending',
    createdAt: now,
    updatedAt: now,
    encryptedConfig: await sealConnection(
      { verifier },
      env.UPLOAD_SIGNING_SECRET,
      `${session.workspace.id}/${id}`,
      'oauth',
    ),
  });
  const state = await sealConnection(
    {
      id,
      workspaceId: session.workspace.id,
      userId: session.userId,
      expiresAt: Date.now() + 600_000,
      targetId: request.connectionId,
      returnTo: request.dataSourceId
        ? `/datasources/${encodeURIComponent(request.dataSourceId)}`
        : '/datasources/new?provider=bigquery',
    },
    env.UPLOAD_SIGNING_SECRET,
    'google-oauth-state',
    'oauth-state',
  );
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope,
    access_type: 'offline',
    prompt: 'consent',
    hd: config.hostedDomain,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  }).toString();
  return { authorizationUrl: url.href };
}

export async function completeGoogleConnection(request: Request) {
  const session = await requireSession();
  const config = configuration();
  let state: z.infer<typeof stateSchema>;
  try {
    state = stateSchema.parse(
      await openConnection(
        new URL(request.url).searchParams.get('state') ?? '',
        env.UPLOAD_SIGNING_SECRET,
        'google-oauth-state',
        'oauth-state',
      ),
    );
  } catch {
    throw new ApiError(
      400,
      'invalid_oauth_state',
      'Google authorization expired. Start connecting again.',
    );
  }
  if (
    state.expiresAt < Date.now() ||
    state.workspaceId !== session.workspace.id ||
    state.userId !== session.userId
  )
    throw new ApiError(
      400,
      'invalid_oauth_state',
      'Return to the workspace where you started connecting.',
    );
  const db = database();
  // Claim once before contacting Google. A replay cannot replace an existing authorization.
  const [pending] = await db
    .update(datasourceAuthorizations)
    .set({ status: 'connecting' })
    .where(
      and(
        eq(datasourceAuthorizations.id, state.id),
        eq(datasourceAuthorizations.workspaceId, state.workspaceId),
        eq(datasourceAuthorizations.createdBy, session.userId),
        eq(datasourceAuthorizations.status, 'pending'),
      ),
    )
    .returning();
  if (!pending?.encryptedConfig)
    throw new ApiError(
      400,
      'invalid_oauth_state',
      'Google authorization expired. Start connecting again.',
    );
  const targetId = state.targetId ?? state.id;
  let phase = 'exchange';
  try {
    const code = new URL(request.url).searchParams.get('code');
    if (!code) throw new Error('Consent declined.');
    const { verifier } = z
      .object({ verifier: z.string() })
      .parse(
        await openConnection(
          pending.encryptedConfig,
          env.UPLOAD_SIGNING_SECRET,
          `${state.workspaceId}/${state.id}`,
          'oauth',
        ),
      );
    const tokens = tokenSchema.parse(
      await googleJson('https://oauth2.googleapis.com/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
          code,
          code_verifier: verifier,
          grant_type: 'authorization_code',
        }),
      }),
    );
    if (
      !tokens.refresh_token ||
      !tokens.scope?.split(' ').includes('https://www.googleapis.com/auth/bigquery')
    )
      throw new Error('Missing authorization.');
    phase = 'account';
    const account = z
      .object({ email: z.email(), email_verified: z.literal(true), hd: z.string() })
      .parse(
        await googleJson('https://openidconnect.googleapis.com/v1/userinfo', {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        }),
      );
    if (account.hd.toLowerCase() !== config.hostedDomain.toLowerCase())
      throw new Error('Workspace domain mismatch.');
    phase = 'save';
    const encryptedConfig = await sealConnection(
      {
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
      },
      env.UPLOAD_SIGNING_SECRET,
      `${state.workspaceId}/${targetId}`,
      'oauth',
    );
    const updated = await db
      .update(datasourceAuthorizations)
      .set({
        encryptedConfig,
        account: account.email,
        status: 'connected',
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(datasourceAuthorizations.id, targetId),
          eq(datasourceAuthorizations.workspaceId, state.workspaceId),
          eq(datasourceAuthorizations.createdBy, session.userId),
          inArray(
            datasourceAuthorizations.status,
            state.targetId ? ['connected', 'reconnect_required', 'disconnected'] : ['connecting'],
          ),
        ),
      )
      .returning({ id: datasourceAuthorizations.id });
    if (!updated.length) throw new Error('Connection removed.');
    if (state.targetId)
      await db.delete(datasourceAuthorizations).where(eq(datasourceAuthorizations.id, state.id));
    console.info('yresonance.datasource_connection', {
      workspaceId: state.workspaceId,
      provider: 'bigquery',
      result: 'connected',
    });
    return oauthRedirect(state.returnTo);
  } catch {
    await db.delete(datasourceAuthorizations).where(eq(datasourceAuthorizations.id, state.id));
    console.warn('yresonance.datasource_connection', {
      workspaceId: state.workspaceId,
      provider: 'bigquery',
      result: 'failed',
      phase,
    });
    const url = new URL(state.returnTo, config.redirectUri);
    url.searchParams.set('connectionError', 'google_authorization_failed');
    return oauthRedirect(`${url.pathname}${url.search}`);
  }
}

export async function disconnectDatasourceConnection(connectionId: string) {
  const session = await requireSession();
  const rows = await database()
    .update(datasourceAuthorizations)
    .set({
      encryptedConfig: null,
      status: 'disconnected',
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(datasourceAuthorizations.id, connectionId),
        eq(datasourceAuthorizations.workspaceId, session.workspace.id),
        eq(datasourceAuthorizations.createdBy, session.userId),
        eq(datasourceAuthorizations.provider, 'bigquery'),
      ),
    )
    .returning({ id: datasourceAuthorizations.id });
  if (!rows.length) throw new ApiError(404, 'connection_not_found', 'Connection not found.');
  return { id: connectionId, status: 'disconnected' };
}

export async function googleAccessToken(workspaceId: string, authorizationId: string) {
  const db = database();
  const row = await db.query.datasourceAuthorizations.findFirst({
    where: and(
      eq(datasourceAuthorizations.id, authorizationId),
      eq(datasourceAuthorizations.workspaceId, workspaceId),
      eq(datasourceAuthorizations.provider, 'bigquery'),
      eq(datasourceAuthorizations.status, 'connected'),
    ),
  });
  if (!row?.encryptedConfig) throw reconnectError();
  const workspace = await db.query.workspaces.findFirst({ where: eq(workspaces.id, workspaceId) });
  if (!workspace) throw reconnectError();
  const encryptedGrant = row.encryptedConfig;
  const revision = row.updatedAt;
  let isMember: boolean;
  try {
    const memberships = await clerkLookup(
      clerkClient().organizations.getOrganizationMembershipList({
        organizationId: workspace.clerkOrganizationId,
        userId: [row.createdBy],
        limit: 1,
      }),
    );
    isMember = memberships.data.some(
      (membership) => membership.publicUserData?.userId === row.createdBy,
    );
  } catch (error) {
    if (z.object({ status: z.literal(404) }).safeParse(error).success) isMember = false;
    else
      throw new DatasourceError(
        'datasource_connector_failed',
        'Google connection membership could not be verified.',
      );
  }
  async function revoke(unchanged: SQL): Promise<never> {
    await db
      .update(datasourceAuthorizations)
      .set({ status: 'reconnect_required', encryptedConfig: null })
      .where(
        and(
          eq(datasourceAuthorizations.id, authorizationId),
          eq(datasourceAuthorizations.workspaceId, workspaceId),
          eq(datasourceAuthorizations.status, 'connected'),
          unchanged,
        ),
      );
    throw reconnectError();
  }
  // Refresh rotates credentials within the same authorization revision. Membership loss must
  // revoke that refreshed grant too, while preserving a newer explicit reconnect/disconnect.
  if (!isMember) return revoke(eq(datasourceAuthorizations.updatedAt, revision));
  async function verifiedToken(accessToken: string, expectedConfig = encryptedGrant) {
    // Check the grant even on cache hits: a revoked access token must not serve cached data.
    const response = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10_000),
      redirect: 'manual',
    }).catch(() => {
      throw new DatasourceError(
        'datasource_connector_failed',
        'Google authorization is unavailable.',
      );
    });
    if (response.status === 401)
      return revoke(eq(datasourceAuthorizations.encryptedConfig, expectedConfig));
    if (!response.ok)
      throw new DatasourceError(
        'datasource_connector_failed',
        'Google authorization is unavailable.',
      );
    // Disconnect or reconnect may have completed while the external checks were pending.
    const current = await db
      .select({ id: datasourceAuthorizations.id })
      .from(datasourceAuthorizations)
      .where(
        and(
          eq(datasourceAuthorizations.id, authorizationId),
          eq(datasourceAuthorizations.workspaceId, workspaceId),
          eq(datasourceAuthorizations.provider, 'bigquery'),
          eq(datasourceAuthorizations.status, 'connected'),
          eq(datasourceAuthorizations.encryptedConfig, expectedConfig),
          eq(datasourceAuthorizations.updatedAt, revision),
        ),
      )
      .get();
    if (!current) throw reconnectError();
    return { accessToken, revision };
  }
  const grant = grantSchema.parse(
    await openConnection(
      row.encryptedConfig,
      env.UPLOAD_SIGNING_SECRET,
      `${workspaceId}/${authorizationId}`,
      'oauth',
    ),
  );
  if (grant.expiresAt > Date.now() + 60_000) return verifiedToken(grant.accessToken);
  const config = configuration();
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: grant.refreshToken,
      grant_type: 'refresh_token',
    }),
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  });
  if (!response.ok) {
    const error = z
      .object({ error: z.string() })
      .safeParse(await readJsonResponse(response, 16_384));
    if (error.success && error.data.error === 'invalid_grant') {
      await db
        .update(datasourceAuthorizations)
        .set({ status: 'reconnect_required', encryptedConfig: null })
        .where(
          and(
            eq(datasourceAuthorizations.id, authorizationId),
            eq(datasourceAuthorizations.encryptedConfig, row.encryptedConfig),
          ),
        );
      throw reconnectError();
    }
    throw new DatasourceError(
      'datasource_connector_failed',
      'Google authorization is unavailable.',
    );
  }
  const tokens = tokenSchema.parse(await readJsonResponse(response, 16_384));
  const encryptedConfig = await sealConnection(
    {
      ...grant,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? grant.refreshToken,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    },
    env.UPLOAD_SIGNING_SECRET,
    `${workspaceId}/${authorizationId}`,
    'oauth',
  );
  const updated = await db
    .update(datasourceAuthorizations)
    .set({ encryptedConfig })
    .where(
      and(
        eq(datasourceAuthorizations.id, authorizationId),
        eq(datasourceAuthorizations.encryptedConfig, row.encryptedConfig),
        eq(datasourceAuthorizations.status, 'connected'),
      ),
    )
    .returning({ id: datasourceAuthorizations.id });
  if (!updated.length) return googleAccessToken(workspaceId, authorizationId);
  return verifiedToken(tokens.access_token, encryptedConfig);
}

function reconnectError() {
  return new DatasourceError(
    'datasource_access_denied',
    'Reconnect the Google account on the datasource page.',
  );
}
async function googleJson(url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(10_000),
    redirect: 'manual',
  });
  if (!response.ok) throw new Error('Google authorization failed.');
  return JSON.parse(await readResponseText(response, 16_384)) as unknown;
}
function oauthRedirect(path: string) {
  return new Response(null, {
    status: 303,
    headers: { Location: path, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}
