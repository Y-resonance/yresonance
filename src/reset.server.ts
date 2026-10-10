import { env } from 'cloudflare:workers';
import { z } from 'zod';

const resetRequestSchema = z.object({
  environment: z.enum(['development', 'preview', 'production']),
});

const applicationTables = [
  'dashboard_grants',
  'share_links',
  'dashboards',
  'calculated_fields',
  'fields',
  'library_metrics',
  'datasource_connections',
  'data_sources',
  'datasource_uploads',
  'ingestion_tokens',
  'query_read_budgets',
  'workspaces',
] as const;

export async function handleResetRequest(request: Request, environment: Cloudflare.Env = env) {
  if (request.method !== 'POST')
    return Response.json(
      { error: 'Method not allowed.' },
      { status: 405, headers: { allow: 'POST' } },
    );
  if (!(await authorized(request.headers.get('authorization'), environment.RESET_ADMIN_TOKEN)))
    return Response.json({ error: 'Unauthorized.' }, { status: 401 });
  const parsed = resetRequestSchema.safeParse(await request.json().catch(() => undefined));
  if (!parsed.success)
    return Response.json({ error: 'Choose development, preview, or production.' }, { status: 400 });
  if (parsed.data.environment !== environment.APP_ENV)
    return Response.json(
      { error: `This deployment is ${environment.APP_ENV}, not ${parsed.data.environment}.` },
      { status: 409 },
    );

  const [r2Keys, kvKeys] = await Promise.all([
    listR2Keys(environment.DATA),
    listKvKeys(environment.QUERY_CACHE),
  ]);
  const plan = {
    environment: parsed.data.environment,
    d1Tables: [...applicationTables],
    r2ObjectKeys: r2Keys,
    kvNamespace: environment.QUERY_CACHE_NAME,
    kvKeys,
  };
  if (parsed.data.environment === 'production')
    return Response.json({ executed: false, reason: 'Production resets are manual.', plan });

  await environment.DB.batch(
    applicationTables.map((table) => environment.DB.prepare(`DELETE FROM ${table}`)),
  );
  for (let index = 0; index < r2Keys.length; index += 1_000)
    await environment.DATA.delete(r2Keys.slice(index, index + 1_000));
  for (let index = 0; index < kvKeys.length; index += 50)
    await Promise.all(
      kvKeys.slice(index, index + 50).map((key) => environment.QUERY_CACHE.delete(key)),
    );
  return Response.json({ executed: true, plan });
}

async function listR2Keys(bucket: R2Bucket) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({ cursor, limit: 1_000 });
    keys.push(...page.objects.map((object) => object.key));
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return keys;
}

async function listKvKeys(namespace: KVNamespace) {
  const keys: string[] = [];
  let cursor: string | undefined;
  do {
    const page = await namespace.list({ cursor, limit: 1_000 });
    keys.push(...page.keys.map((key) => key.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

async function authorized(header: string | null, expected: string) {
  const supplied = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
  const [left, right] = await Promise.all([digest(supplied), digest(expected)]);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return supplied.length > 0 && difference === 0;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}
