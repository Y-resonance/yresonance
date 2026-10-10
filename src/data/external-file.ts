import { z } from 'zod';
import { openConnection, sealConnection } from './connection-secrets';
import { claimQueryReadBytes, INTERNAL_R2_HOST } from './internal-r2';

const readSchema = z.object({
  getUrl: z.url(),
  headUrl: z.url(),
  queryId: z.string().min(1),
  expiresAt: z.number(),
});

export async function externalFileUrl(
  getUrl: string,
  headUrl: string,
  queryId: string,
  environment: Cloudflare.Env,
) {
  const token = await sealConnection(
    { getUrl, headUrl, queryId, expiresAt: Date.now() + 5 * 60_000 },
    environment.INTERNAL_R2_SIGNING_SECRET,
    'external-file',
    'file-capability',
  );
  const origin = environment.DATA_SOURCE_BASE_URL.startsWith('r2://')
    ? `http://${INTERNAL_R2_HOST}`
    : new URL(environment.DATA_SOURCE_BASE_URL).origin;
  return `${origin}/api/connector-file/${token}`;
}

// Only the Worker sees presigned storage URLs. DuckDB gets an encrypted, exact-object capability.
export async function handleExternalFileRequest(
  request: Request,
  token: string,
  environment: Cloudflare.Env,
) {
  if (!['GET', 'HEAD'].includes(request.method))
    return new Response(null, { status: 405, headers: { allow: 'GET, HEAD' } });
  try {
    const read = readSchema.parse(
      await openConnection(
        token,
        environment.INTERNAL_R2_SIGNING_SECRET,
        'external-file',
        'file-capability',
      ),
    );
    if (read.expiresAt < Date.now()) return new Response('Expired capability.', { status: 403 });
    const headers = new Headers({ 'accept-encoding': 'identity' });
    const range = request.headers.get('range');
    if (range && /^bytes=(?:\d+-\d*|-\d+)$/u.test(range)) headers.set('range', range);
    const response = await fetch(request.method === 'HEAD' ? read.headUrl : read.getUrl, {
      method: request.method,
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      return new Response('Storage read failed.', { status: 502 });
    }
    const length = Number(response.headers.get('content-length'));
    if (
      !response.headers.has('content-length') ||
      !Number.isSafeInteger(length) ||
      length < 0 ||
      (request.method === 'GET' &&
        !(await claimQueryReadBytes(environment.DB, read.queryId, length)))
    ) {
      await response.body?.cancel();
      return new Response('Query read limit exceeded.', { status: 413 });
    }
    const output = new Headers({ 'cache-control': 'no-store', 'accept-ranges': 'bytes' });
    for (const name of [
      'content-length',
      'content-range',
      'content-type',
      'etag',
      'last-modified',
    ]) {
      const value = response.headers.get(name);
      if (value) output.set(name, value);
    }
    return new Response(
      request.method === 'HEAD' ? null : response.body?.pipeThrough(boundedBody(length)),
      {
        status: response.status,
        headers: output,
      },
    );
  } catch {
    return new Response('Invalid capability or storage read failed.', { status: 403 });
  }
}

// Enforce the advertised length while streaming too, so a storage server cannot bypass the budget.
function boundedBody(maximum: number) {
  let bytes = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytes += chunk.byteLength;
      if (bytes > maximum) throw new Error('Storage response exceeded its declared length.');
      controller.enqueue(chunk);
    },
  });
}
