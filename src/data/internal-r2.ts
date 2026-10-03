import { z } from 'zod';
import { MAX_DATASOURCE_FILE_BYTES } from '#/domain/datasource-upload';
import { isWorkspaceR2Key } from '#/domain/tenancy';
import { recordProductMetric } from '#/observability';

export const INTERNAL_R2_HOST = 'r2.yresonance.internal';
export const MAX_QUERY_SOURCE_BYTES = 500 * 1024 * 1024;
export const MAX_INGESTED_FILE_BYTES = 150 * 1024 * 1024;
const CAPABILITY_LIFETIME_SECONDS = 5 * 60;

const capabilitySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('read'),
    key: z.string().min(1),
    queryId: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('ingestion'),
    tokenId: z.string().min(1),
    sourceKey: z.string().min(1),
    destinationKey: z.string().min(1),
    expiresAt: z.number().int().positive(),
  }),
]);

export type R2Capability = z.infer<typeof capabilitySchema>;
type R2CapabilityInput =
  | Omit<Extract<R2Capability, { kind: 'read' }>, 'expiresAt'>
  | Omit<Extract<R2Capability, { kind: 'ingestion' }>, 'expiresAt'>;

export async function createR2Capability(
  capability: R2CapabilityInput & { expiresAt?: number },
  secret: string,
) {
  const payload = capabilitySchema.parse({
    ...capability,
    expiresAt: capability.expiresAt ?? Math.floor(Date.now() / 1000) + CAPABILITY_LIFETIME_SECONDS,
  });
  const encoded = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signature = await sign(encoded, secret);
  return `${encoded}.${base64UrlEncode(signature)}`;
}

export async function verifyR2Capability(token: string, secret: string, now = Date.now()) {
  const [payloadValue, signatureValue, extra] = token.split('.');
  if (!payloadValue || !signatureValue || extra !== undefined) return undefined;
  try {
    const key = await signingKey(secret, ['verify']);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      base64UrlDecode(signatureValue),
      new TextEncoder().encode(payloadValue),
    );
    if (!valid) return undefined;
    const payload = capabilitySchema.parse(
      JSON.parse(new TextDecoder().decode(base64UrlDecode(payloadValue))) as unknown,
    );
    return payload.expiresAt * 1000 >= now ? payload : undefined;
  } catch {
    return undefined;
  }
}

export function capabilityUrl(token: string) {
  return `http://${INTERNAL_R2_HOST}/capability/${token}`;
}

export function browserUploadPath(key: string) {
  return `/api/datasource-upload/${base64UrlEncode(new TextEncoder().encode(key))}`;
}

export async function handleBrowserUploadRequest(
  request: Request,
  encodedKey: string,
  environment: Cloudflare.Env,
  authorization: { userId: string; workspaceId: string; workspacePrefix: string },
) {
  if (request.method !== 'PUT') return methodNotAllowed('PUT');
  let key: string;
  try {
    key = new TextDecoder().decode(base64UrlDecode(encodedKey));
  } catch {
    return new Response('Invalid upload.', { status: 404 });
  }
  if (!isWorkspaceR2Key(authorization.workspacePrefix, key))
    return new Response('Upload is outside this workspace.', { status: 403 });
  const contentLength = validContentLength(request, MAX_DATASOURCE_FILE_BYTES);
  if (!contentLength) return new Response('A valid Content-Length is required.', { status: 413 });
  const pending = await environment.DB.prepare(
    `SELECT 1 FROM datasource_uploads
     WHERE key = ? AND workspace_id = ? AND clerk_user_id = ? AND status = 'pending'`,
  )
    .bind(key, authorization.workspaceId, authorization.userId)
    .first();
  if (!pending) return new Response('Upload is not pending.', { status: 409 });
  if (!request.body) return new Response('Upload body is required.', { status: 400 });
  const stored = await environment.DATA.put(key, request.body, {
    onlyIf: { etagDoesNotMatch: '*' },
    httpMetadata: { contentType: contentTypeForKey(key) },
  });
  if (!stored) return new Response('Upload already exists.', { status: 409 });
  return new Response(null, { status: 201, headers: { etag: stored.httpEtag } });
}

export async function handleInternalR2Request(request: Request, environment: Cloudflare.Env) {
  const url = new URL(request.url);
  if (url.hostname !== INTERNAL_R2_HOST || !url.pathname.startsWith('/capability/'))
    return new Response('Not found.', { status: 404 });
  const capability = await verifyR2Capability(
    url.pathname.slice('/capability/'.length),
    environment.INTERNAL_R2_SIGNING_SECRET,
  );
  if (!capability) return new Response('Invalid or expired capability.', { status: 403 });

  if (capability.kind === 'read') {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed('GET, HEAD');
    return serveObject(request, environment, capability.key, capability.queryId, true);
  }

  if (request.method === 'GET' || request.method === 'HEAD')
    return serveObject(request, environment, capability.sourceKey, capability.tokenId, false);
  if (request.method !== 'PUT') return methodNotAllowed('GET, HEAD, PUT');
  const contentLength = validContentLength(request, MAX_INGESTED_FILE_BYTES);
  if (!contentLength) return new Response('A valid Content-Length is required.', { status: 413 });
  if (!request.body) return new Response('Upload body is required.', { status: 400 });
  const claimedAt = new Date().toISOString();
  const claimed = await environment.DB.prepare(
    `UPDATE ingestion_tokens SET used_at = ?
     WHERE id = ? AND used_at IS NULL AND expires_at >= ?
     RETURNING id`,
  )
    .bind(claimedAt, capability.tokenId, claimedAt)
    .first();
  if (!claimed) return new Response('Ingestion token was already used.', { status: 409 });
  let stored: R2Object | null;
  try {
    stored = await environment.DATA.put(capability.destinationKey, request.body, {
      onlyIf: { etagDoesNotMatch: '*' },
      httpMetadata: { contentType: 'application/vnd.apache.parquet' },
    });
  } catch (error) {
    try {
      await environment.DB.prepare(
        'UPDATE ingestion_tokens SET used_at = NULL WHERE id = ? AND used_at = ?',
      )
        .bind(capability.tokenId, claimedAt)
        .run();
    } catch (releaseError) {
      console.warn('yresonance.ingestion_token_release_failed', {
        tokenId: capability.tokenId,
        error: releaseError instanceof Error ? releaseError.message : 'Unknown release error.',
      });
    }
    throw error;
  }
  if (!stored) return new Response('Ingestion destination already exists.', { status: 409 });
  return new Response(null, { status: 201, headers: { etag: stored.httpEtag } });
}

export async function createQueryReadBudget(
  queryId: string,
  workspaceId: string,
  environment: Cloudflare.Env,
) {
  const now = new Date();
  await environment.DB.prepare('DELETE FROM query_read_budgets WHERE expires_at < ?')
    .bind(now.toISOString())
    .run();
  await environment.DB.prepare(
    `INSERT INTO query_read_budgets
     (id, workspace_id, scanned_bytes, maximum_bytes, expires_at, created_at)
     VALUES (?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      queryId,
      workspaceId,
      MAX_QUERY_SOURCE_BYTES,
      new Date(now.getTime() + 10 * 60 * 1000).toISOString(),
      now.toISOString(),
    )
    .run();
}

export async function finishQueryReadBudget(queryId: string, environment: Cloudflare.Env) {
  const row = await environment.DB.prepare(
    'SELECT scanned_bytes FROM query_read_budgets WHERE id = ?',
  )
    .bind(queryId)
    .first<{ scanned_bytes: number }>();
  await environment.DB.prepare('DELETE FROM query_read_budgets WHERE id = ?').bind(queryId).run();
  return row?.scanned_bytes ?? 0;
}

async function serveObject(
  request: Request,
  environment: Cloudflare.Env,
  key: string,
  queryId: string,
  enforceBudget: boolean,
) {
  const bucket = environment.DATA;
  if (request.method === 'HEAD') {
    const object = await bucket.head(key);
    if (!object) return new Response('Not found.', { status: 404 });
    return new Response(null, { status: 200, headers: objectHeaders(object, key) });
  }
  const object = await bucket.get(key, { range: request.headers });
  if (!object) return new Response('Not found.', { status: 404 });
  const headers = objectHeaders(object, key);
  const range = normalizedRange(object.range, object.size);
  if (range) headers.set('content-range', `bytes ${range.start}-${range.end}/${object.size}`);
  const scannedBytes = range ? range.end - range.start + 1 : object.size;
  if (enforceBudget && !(await claimQueryReadBytes(environment.DB, queryId, scannedBytes)))
    return new Response('Query scanned-byte limit exceeded.', { status: 413 });
  headers.set('content-length', String(scannedBytes));
  console.info('yresonance.datasource_read', { queryId, key, scannedBytes });
  recordProductMetric('datasource_read', {
    labels: [queryId],
    numbers: [scannedBytes],
  });
  return new Response(object.body, { status: range ? 206 : 200, headers });
}

async function claimQueryReadBytes(database: D1Database, queryId: string, bytes: number) {
  const claimed = await database
    .prepare(
      `UPDATE query_read_budgets
       SET scanned_bytes = scanned_bytes + ?
       WHERE id = ? AND expires_at >= ? AND scanned_bytes + ? <= maximum_bytes
       RETURNING scanned_bytes`,
    )
    .bind(bytes, queryId, new Date().toISOString(), bytes)
    .first();
  return Boolean(claimed);
}

function objectHeaders(object: R2Object, key: string) {
  const headers = new Headers({
    'accept-ranges': 'bytes',
    'content-length': String(object.size),
    'content-type': object.httpMetadata?.contentType ?? contentTypeForKey(key),
    etag: object.httpEtag,
    'last-modified': object.uploaded.toUTCString(),
  });
  object.writeHttpMetadata(headers);
  return headers;
}

function normalizedRange(range: R2Range | undefined, size: number) {
  if (!range) return undefined;
  if ('offset' in range && range.offset !== undefined) {
    const length = range.length ?? size - range.offset;
    return { start: range.offset, end: range.offset + length - 1 };
  }
  if ('suffix' in range) return { start: Math.max(0, size - range.suffix), end: size - 1 };
  return { start: 0, end: Math.min(size, range.length ?? size) - 1 };
}

function validContentLength(request: Request, maximum: number) {
  const value = Number(request.headers.get('content-length'));
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : undefined;
}

function contentTypeForKey(key: string) {
  return key.toLocaleLowerCase('en-US').endsWith('.csv')
    ? 'text/csv; charset=utf-8'
    : 'application/vnd.apache.parquet';
}

function methodNotAllowed(allow: string) {
  return new Response('Method not allowed.', { status: 405, headers: { allow } });
}

async function sign(value: string, secret: string) {
  const key = await signingKey(secret, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)));
}

function signingKey(secret: string, usages: KeyUsage[]) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

function base64UrlEncode(value: Uint8Array) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlDecode(value: string) {
  const base64 = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}
